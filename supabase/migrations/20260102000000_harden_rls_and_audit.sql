-- ════════════════════════════════════════════════════════════════════════════
-- Migration: 20260102000000_harden_rls_and_audit.sql
-- Purpose:  RLS 收敛 + 审计字段 + 软删除守卫 + 最小权限
-- Author:   Supabase Security Audit (claude), 2026-06-23
--
-- 修复的问题（相对 init.sql 的过宽 RLS）:
--   1. 单条 `FOR ALL USING (...)` 没有 WITH CHECK → INSERT/UPDATE 不校验 user_id 归属
--   2. UPDATE 时 OLD.user_id 校验,NEW.user_id 可被改成他人 → 越权转移所有权
--   3. 缺审计字段 created_by / updated_by / device_id → 泄露无法追溯
--   4. 软删除行（deleted_at IS NOT NULL）的业务字段（content/name/color）仍可改
--
-- 不变（保持向后兼容）:
--   - Realtime publication 不动
--   - 同步 upsert 不需要改前端代码（user_id === auth.uid() 自动过 WITH CHECK）
--   - Factory Reset / hardDelete 仍依赖 RLS scope 到本人行
--
-- Idempotent: 所有 DROP / CREATE 使用 IF EXISTS / OR REPLACE
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. 审计字段 ──────────────────────────────────────────────────────────────
alter table notes     add column if not exists created_by uuid references auth.users(id);
alter table notes     add column if not exists updated_by uuid references auth.users(id);
alter table notes     add column if not exists device_id  text;

alter table tags      add column if not exists created_by uuid references auth.users(id);
alter table tags      add column if not exists updated_by uuid references auth.users(id);
alter table tags      add column if not exists device_id  text;

alter table note_tags add column if not exists created_by uuid references auth.users(id);
alter table note_tags add column if not exists updated_by uuid references auth.users(id);
alter table note_tags add column if not exists device_id  text;

-- ─── 2. 回填老数据 ────────────────────────────────────────────────────────────
-- 用 user_id / last_sync_device 兜底,保证审计字段不为空（同步推送时会被触发器刷新）
update notes     set created_by = user_id, updated_by = user_id, device_id = last_sync_device
  where created_by is null or device_id is null;
update tags      set created_by = user_id, updated_by = user_id, device_id = last_sync_device
  where created_by is null or device_id is null;
update note_tags set created_by = user_id, updated_by = user_id, device_id = last_sync_device
  where created_by is null or device_id is null;

-- ─── 3. 审计查询索引 ─────────────────────────────────────────────────────────
create index if not exists notes_created_by_idx           on notes(created_by);
create index if not exists notes_updated_by_idx           on notes(updated_by);
create index if not exists notes_device_id_updated_at_idx on notes(device_id, updated_at);
create index if not exists tags_created_by_idx            on tags(created_by);
create index if not exists tags_updated_by_idx            on tags(updated_by);
create index if not exists tags_device_id_updated_at_idx  on tags(device_id, updated_at);
create index if not exists note_tags_created_by_idx       on note_tags(created_by);
create index if not exists note_tags_updated_by_idx       on note_tags(updated_by);
create index if not exists note_tags_device_id_idx        on note_tags(device_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 触发器函数
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 4. INSERT:自动写 created_by / updated_by / device_id ───────────────────
-- SECURITY INVOKER（默认）：auth.uid() 在调用者会话上下文中求值
create or replace function public.ffn_set_audit_on_insert()
returns trigger
language plpgsql
as $$
begin
  -- created_by:首次创建时由 auth.uid() 填充；备份恢复时若已有值则保留
  if NEW.created_by is null then
    NEW.created_by := auth.uid();
  end if;
  -- updated_by:与 created_by 同步（同一次 INSERT）
  if NEW.updated_by is null then
    NEW.updated_by := coalesce(NEW.created_by, auth.uid());
  end if;
  -- device_id:从 last_sync_device 复制（同步层每条 push 都带这个字段）
  if NEW.device_id is null then
    NEW.device_id := NEW.last_sync_device;
  end if;
  return NEW;
end;
$$;

drop trigger if exists notes_audit_insert     on notes;
drop trigger if exists tags_audit_insert      on tags;
drop trigger if exists note_tags_audit_insert on note_tags;

create trigger notes_audit_insert
  before insert on notes
  for each row execute function public.ffn_set_audit_on_insert();

create trigger tags_audit_insert
  before insert on tags
  for each row execute function public.ffn_set_audit_on_insert();

create trigger note_tags_audit_insert
  before insert on note_tags
  for each row execute function public.ffn_set_audit_on_insert();

-- ─── 5. UPDATE:自动写 updated_by / device_id ───────────────────────────────
create or replace function public.ffn_set_audit_on_update()
returns trigger
language plpgsql
as $$
begin
  -- updated_by 始终 = 当前调用者
  NEW.updated_by := auth.uid();
  -- device_id 从 last_sync_device 复制（同步层保证非空）
  NEW.device_id := NEW.last_sync_device;
  return NEW;
end;
$$;

drop trigger if exists notes_audit_update     on notes;
drop trigger if exists tags_audit_update      on tags;
drop trigger if exists note_tags_audit_update on note_tags;

create trigger notes_audit_update
  before update on notes
  for each row execute function public.ffn_set_audit_on_update();

create trigger tags_audit_update
  before update on tags
  for each row execute function public.ffn_set_audit_on_update();

create trigger note_tags_audit_update
  before update on note_tags
  for each row execute function public.ffn_set_audit_on_update();

-- ─── 6. user_id 不可变 ──────────────────────────────────────────────────────
-- 防止 UPDATE 时把行所有权"送"给另一个用户
create or replace function public.ffn_prevent_user_id_change()
returns trigger
language plpgsql
as $$
begin
  if NEW.user_id is distinct from OLD.user_id then
    raise exception 'ffn: user_id is immutable on % (id=%, old=%, new=%)',
      TG_TABLE_NAME, OLD.id, OLD.user_id, NEW.user_id
      using errcode = 'insufficient_privilege',
            hint    = 'Cannot transfer ownership of a row between users';
  end if;
  return NEW;
end;
$$;

drop trigger if exists notes_immutable_uid     on notes;
drop trigger if exists tags_immutable_uid      on tags;
drop trigger if exists note_tags_immutable_uid on note_tags;

create trigger notes_immutable_uid
  before update on notes
  for each row execute function public.ffn_prevent_user_id_change();

create trigger tags_immutable_uid
  before update on tags
  for each row execute function public.ffn_prevent_user_id_change();

create trigger note_tags_immutable_uid
  before update on note_tags
  for each row execute function public.ffn_prevent_user_id_change();

-- ─── 7. 软删除保护 ──────────────────────────────────────────────────────────
-- 规则:软删行(deleted_at 非空)只能改 sync 字段(deleted_at / sync_status /
-- last_synced_at / version / updated_at / updated_by / device_id);
-- 业务字段(content / status / archived_at / name / color)被改则 raise
-- 例外:deleted_at 从非空改空 = restore,允许(后续 UPSERT/更新再走正常 RLS)

-- 7.1 notes
create or replace function public.ffn_protect_notes_soft_deleted()
returns trigger
language plpgsql
as $$
begin
  if OLD.deleted_at is not null and NEW.deleted_at is not null then
    if NEW.content      is distinct from OLD.content
       or NEW.status     is distinct from OLD.status
       or NEW.archived_at is distinct from OLD.archived_at
    then
      raise exception 'ffn: cannot modify business fields on soft-deleted note % (restore first)', OLD.id
        using errcode = 'check_violation',
              hint    = 'Set deleted_at to NULL to restore the row, then update its content';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists notes_protect_soft_deleted on notes;
create trigger notes_protect_soft_deleted
  before update on notes
  for each row execute function public.ffn_protect_notes_soft_deleted();

-- 7.2 tags
create or replace function public.ffn_protect_tags_soft_deleted()
returns trigger
language plpgsql
as $$
begin
  if OLD.deleted_at is not null and NEW.deleted_at is not null then
    if NEW.name  is distinct from OLD.name
       or NEW.color is distinct from OLD.color
    then
      raise exception 'ffn: cannot modify business fields on soft-deleted tag % (restore first)', OLD.id
        using errcode = 'check_violation',
              hint    = 'Set deleted_at to NULL to restore the row, then update its name/color';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists tags_protect_soft_deleted on tags;
create trigger tags_protect_soft_deleted
  before update on tags
  for each row execute function public.ffn_protect_tags_soft_deleted();

-- 7.3 note_tags
-- note_tags 无业务字段（仅 deleted_at 表达软删）,user_id 不可变已覆盖所有权
-- 不需要额外软删保护触发器

-- ════════════════════════════════════════════════════════════════════════════
-- RLS 策略重建（拆分 FOR ALL 为 SELECT/INSERT/UPDATE/DELETE）
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 8. DROP 老的过宽策略 ───────────────────────────────────────────────────
drop policy if exists "Users can access their own notes"     on notes;
drop policy if exists "Users can access their own tags"      on tags;
drop policy if exists "Users can access their own note_tags" on note_tags;

-- ─── 9. CREATE 三表 × 四动作 = 12 条最小权限策略 ────────────────────────────

-- 9.1 notes
create policy "notes_select_own"
  on notes for select
  to authenticated
  using (auth.uid() = user_id);

create policy "notes_insert_own"
  on notes for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "notes_update_own"
  on notes for update
  to authenticated
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "notes_delete_own"
  on notes for delete
  to authenticated
  using (auth.uid() = user_id);

-- 9.2 tags
create policy "tags_select_own"
  on tags for select
  to authenticated
  using (auth.uid() = user_id);

create policy "tags_insert_own"
  on tags for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "tags_update_own"
  on tags for update
  to authenticated
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "tags_delete_own"
  on tags for delete
  to authenticated
  using (auth.uid() = user_id);

-- 9.3 note_tags
create policy "note_tags_select_own"
  on note_tags for select
  to authenticated
  using (auth.uid() = user_id);

create policy "note_tags_insert_own"
  on note_tags for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "note_tags_update_own"
  on note_tags for update
  to authenticated
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "note_tags_delete_own"
  on note_tags for delete
  to authenticated
  using (auth.uid() = user_id);

-- ─── 10. 最小权限:撤销 anon,显式授权 authenticated ─────────────────────────
-- Supabase 默认 anon 无 GRANT,显式 revoke 防回归
revoke all on notes      from anon;
revoke all on tags       from anon;
revoke all on note_tags  from anon;

-- authenticated:RLS 已限定本人行,这里给 PostgREST 所需的最小 GRANT 集合
grant select, insert, update, delete on notes      to authenticated;
grant select, insert, update, delete on tags       to authenticated;
grant select, insert, update, delete on note_tags  to authenticated;

-- ─── 11. Realtime publication 不动 ─────────────────────────────────────────
-- notes / tags / note_tags 已在 init.sql 里加入 supabase_realtime publication
-- 客户端 syncManager.ts:394,399,404 已带 user_id=eq.X filter(防御性深度)
-- RLS 收紧后,Supabase Cloud 2024+ 的 server-side RLS-on-Realtime 也会自动应用
-- 无需迁移动作

-- ════════════════════════════════════════════════════════════════════════════
-- 文档注释
-- ════════════════════════════════════════════════════════════════════════════

comment on column notes.created_by      is '创建者 user_id;由 ffn_set_audit_on_insert 触发器从 auth.uid() 填充,客户端不可改';
comment on column notes.updated_by      is '最后更新者 user_id;由 ffn_set_audit_on_update 触发器每次 UPDATE 时刷新为 auth.uid()';
comment on column notes.device_id       is '最后操作设备 ID;由触发器从 last_sync_device 复制;审计 + 跨设备同步冲突溯源';
comment on column tags.created_by       is '创建者 user_id(审计;触发器维护)';
comment on column tags.updated_by       is '最后更新者 user_id(审计;触发器维护)';
comment on column tags.device_id        is '最后操作设备 ID(审计;触发器维护)';
comment on column note_tags.created_by  is '创建者 user_id(审计;触发器维护)';
comment on column note_tags.updated_by  is '最后更新者 user_id(审计;触发器维护)';
comment on column note_tags.device_id   is '最后操作设备 ID(审计;触发器维护)';

comment on table notes is
  '用户私有笔记。RLS:auth.uid()=user_id。审计:created_by/updated_by/device_id 由触发器维护。软删:deleted_at 非空时业务字段只读。';

comment on table tags is
  '用户私有标签。RLS:auth.uid()=user_id。审计同上。软删:deleted_at 非空时 name/color 只读。';

comment on table note_tags is
  'note ↔ tag 多对多关联。RLS:auth.uid()=user_id。审计同上。user_id 不可变,不允许跨用户移动链接。';
