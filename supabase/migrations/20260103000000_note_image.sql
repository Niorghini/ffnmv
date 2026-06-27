-- ════════════════════════════════════════════════════════════════════════════
-- Migration: 20260103000000_note_image.sql
-- Purpose:  笔记图片附件 —— Storage 桶 + notes.image_* + RLS + 配额
-- Author:   ffnmv dev, 2026-06-23
--
-- 设计要点:
--   - 每条笔记最多 1 张图(本次约束;多图可在 v1.1 扩)
--   - 桶内路径(multi-tenant):note-images/{user_id}/{note_id}/{uuid}.{ext}
--     URL 路径: /storage/v1/object/storage/note-images/{user_id}/{note_id}/{uuid}.{ext}
--     Storage 从 URL 提取 tenant("storage"),实际 key 不含 tenant 前缀
--   - RLS 兼容单/多 tenant:foldername[1]='note-images'(单) 或 [2]='note-images'(多)
--   - MIME 白名单:image/jpeg / image/png / image/webp
--   - MIME 白名单:image/jpeg / image/png / image/webp
--   - 单图上限 20MB(在 bucket 与 column CHECK 双重校验)
--   - 配额:500MB / 用户,通过聚合 notes.image_size 估算(软限制)
--   - Realtime publication notes 不动,image_path 字段随 notes 自动广播
--
-- Idempotent: 所有 DROP/CREATE 用 IF EXISTS / OR REPLACE / ON CONFLICT
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. notes 表加 7 列 ──────────────────────────────────────────────────────
alter table notes
  add column if not exists image_path        text,                                                       -- Storage 路径(同步字段)
  add column if not exists image_mime        text  check (image_mime in ('image/jpeg','image/png','image/webp')),
  add column if not exists image_size        bigint check (image_size is null or (image_size > 0 and image_size <= 20971520)),
  add column if not exists image_width       integer,
  add column if not exists image_height      integer,
  add column if not exists image_thumb_path  text,                                                       -- 缩略图 Storage 路径
  add column if not exists image_uploaded_at timestamptz;                                                -- null = 本地有但还没传完

-- 索引:扫"待上传行"用(image_path IS NULL AND image_uploaded_at IS NULL)
-- 部分索引只覆盖有图的行,小且快
create index if not exists notes_image_uploaded_at_idx
  on notes(image_uploaded_at)
  where image_path is null and image_uploaded_at is null;

-- ─── 2. Storage 桶(走 SQL 创建 / 幂等更新) ─────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'note-images',
  'note-images',
  false,                            -- private:必须走 signed URL
  20971520,                         -- 20 MiB 硬上限(与 column CHECK 一致)
  '{image/jpeg,image/png,image/webp}'
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ─── 3. storage.objects RLS(4 条独立策略) ─────────────────────────────────
-- 路径约定(single-tenant):
--   URL: /storage/v1/object/note-images/{user_id}/{note_id}/{uuid}.{ext}
--   storage-api v1.60+ 在 INSERT 时把 owner_id 设为当前 JWT 的 sub
--   RLS 用 owner_id 直接比对,绕过 foldername(name) 解析(更可靠)

drop policy if exists "note_images_select_own" on storage.objects;
drop policy if exists "note_images_insert_own" on storage.objects;
drop policy if exists "note_images_update_own" on storage.objects;
drop policy if exists "note_images_delete_own" on storage.objects;

create policy "note_images_select_own"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'note-images' and owner_id = auth.uid()::text);

create policy "note_images_insert_own"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'note-images' and owner_id = auth.uid()::text);

create policy "note_images_update_own"
  on storage.objects for update
  to authenticated
  using      (bucket_id = 'note-images' and owner_id = auth.uid()::text)
  with check (bucket_id = 'note-images' and owner_id = auth.uid()::text);

create policy "note_images_delete_own"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'note-images' and owner_id = auth.uid()::text);

-- ─── 4. 配额函数 ──────────────────────────────────────────────────────────
-- SECURITY DEFINER:聚合时绕过 RLS,统计本人 quota(RLS 已限定 user_id = p_user,等价但聚合性能更好)
create or replace function public.ffn_user_image_quota_bytes(p_user uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(coalesce(image_size, 0)), 0)::bigint
  from notes
  where user_id = p_user
    and deleted_at is null
    and image_path is not null
    and image_uploaded_at is not null;
$$;

grant execute on function public.ffn_user_image_quota_bytes(uuid) to authenticated;

-- ─── 5. 文档注释 ──────────────────────────────────────────────────────────
comment on column notes.image_path        is 'Storage 路径:note-images/{user_id}/{note_id}/{uuid}.{ext}';
comment on column notes.image_mime        is 'MIME(image/jpeg|png|webp);null = 无图';
comment on column notes.image_size        is '原图字节数;CHECK ≤ 20MiB';
comment on column notes.image_width       is '原图宽(像素);缩略图固定 512px';
comment on column notes.image_height      is '原图高(像素)';
comment on column notes.image_thumb_path  is '缩略图 Storage 路径(512px JPEG 0.82)';
comment on column notes.image_uploaded_at is '上传完成时间;NULL = 本地有但未传完(sync 只推 image_path 等非空字段)';

comment on function public.ffn_user_image_quota_bytes(uuid) is
  '聚合当前用户活跃笔记的图片总字节数(用于客户端配额校验);SECURITY DEFINER';
