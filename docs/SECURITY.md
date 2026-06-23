# ffnmv 安全说明

> 适用版本:v1.3.1 起
> 最后更新:2026-06-23
> 配套 migration:`supabase/migrations/20260102000000_harden_rls_and_audit.sql`

本文档面向运维 / 安全审计 / 新加入的工程师,说明 ffnmv 当前的安全姿态、防御层与运维检查清单。

---

## 1. 威胁模型

### 1.1 资产

| 资产 | 位置 | 敏感度 |
|------|------|--------|
| 用户笔记内容 | `public.notes.content` | 高(可能含私人/工作内容) |
| 标签命名 | `public.tags.name` | 中(反映兴趣/分类) |
| 用户邮箱 | `auth.users.email` | 中 |
| 密码 | GoTrue bcrypt 哈希 | 高 |
| 会话 token | 客户端 localStorage / Android Keystore | 高 |

### 1.2 攻击者画像与缓解

| 攻击者 | 攻击面 | 缓解 |
|--------|--------|------|
| **未认证互联网扫描器** | PostgREST `/rest/v1/notes` 公共端点 | RLS 拒绝 anon;`enable_anonymous_sign_ins=false`;`grant all ... from anon` 已 revoke |
| **已认证用户互攻** | A 拿到合法 token 后试图读/改/删 B 的笔记 | RLS WITH CHECK + user_id 不可变触发器 + 软删守卫,3 层兜底 |
| **XSS 注入者** | `<script>` 偷走 localStorage 里的 `ffn-sb-session` | 当前无 dangerousHTML;web 端 React 默认转义;token 自动 1h 刷新 |
| **中间人** | HTTP 嗅探 | 全栈 HTTPS(ZeroSSL wildcard `*.aicyber.chat`);PostgREST 强制 HTTPS |
| **离职设备持有者** | 旧设备保留登录态 | 改密可强制所有会话失效;客户端 `signOutAndCleanup` 全清 |

### 1.3 不在范围

- 端到端加密(E2EE):当前为传输 + 静态加密(Postgres at-rest),服务端可读明文。如需 E2EE 需重做 sync 协议。
- 防物理访问设备:依赖 OS 级锁屏 + Keystore 加密。
- 抗国家级流量分析:超出单应用范围。

---

## 2. 信任边界

```
┌────────────────────────────────────────────────────────────────────┐
│                          客户端(不可信)                              │
│  • Web 浏览器:React 18 + Vite,token 落 localStorage               │
│  • Android:Capacitor + secureStorageAdapter(Android Keystore)    │
│  • 只持有 anon public key,绝无 service_role                       │
└────────────────────────────────────────────────────────────────────┘
                                │ HTTPS + JWT in Authorization header
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│                     PostgREST / Realtime(半可信)                    │
│  • URL:https://ffn.aicyber.chat/rest/v1                            │
│  • JWT 验证 → 设置 request.jwt.claim.sub                           │
│  • 不应用业务规则,纯协议层                                          │
└────────────────────────────────────────────────────────────────────┘
                                │ SQL over TLS(同机 unix socket 或 5432)
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│                      Postgres + RLS(可信)                          │
│  • RLS 策略(authenticated 角色):auth.uid() = row.user_id          │
│  • 触发器:审计字段维护 + user_id 不可变 + 软删守卫                  │
│  • Realtime publication:WAL → Realtime → 客户端                     │
└────────────────────────────────────────────────────────────────────┘
```

**关键不变量**:任何客户端(包括合法登录用户)无法绕过 RLS 与触发器直接接触行数据。

---

## 3. 认证配置

见 `supabase/config.toml` 第 156-200 行;prod 的实际值在 `/opt/supabase/docker/.env` 由 `ops/deploy-rate-limit.sh` 部署。

| 配置项 | 值 | 备注 |
|--------|-----|------|
| `enable_signup` | `true` | 邮箱密码自助注册 |
| `enable_anonymous_sign_ins` | **`false`** | **禁止匿名登录** |
| `minimum_password_length` | `8` | 与前端 Login.jsx / Settings.jsx 一致 |
| `password_requirements` | (空) | 仅长度,不强制字符集 |
| `enable_refresh_token_rotation` | `true` | refresh token 一次性 |
| `jwt_expiry` | `3600`(1h) | access token |
| `enable_confirmations` | `false` | 注册无需邮箱验证(简化体验;生产可改) |
| `enable_signup` (email) | `true` | |
| `double_confirm_changes` | `true` | 改邮箱需双确认 |
| MFA / TOTP / WebAuthn | **未启用** | v1.x 暂不启用;v2.0 评估 |

**未启用的特性**(已知风险):
- **邮箱验证关闭**:邮箱被冒用即可注册;建议 v1.4 开启 `enable_confirmations=true`
- **MFA 未启用**:单密码保护;建议 v2.0 启用 TOTP
- **rate limit**:本地配置值;prod 值由 ops 部署脚本控制

---

## 4. 授权模型(RLS)

### 4.1 总览

3 张业务表 × 4 个动作(SELECT/INSERT/UPDATE/DELETE)= **12 条最小权限策略** + **6 个触发器**。

### 4.2 策略矩阵

| 表 | SELECT | INSERT | UPDATE | DELETE |
|----|--------|--------|--------|--------|
| `notes` | `USING (auth.uid() = user_id)` | `WITH CHECK (auth.uid() = user_id)` | `USING` + `WITH CHECK` 双校验 | `USING` |
| `tags` | 同上 | 同上 | 同上 | 同上 |
| `note_tags` | 同上 | 同上 | 同上 | 同上 |

所有策略 `TO authenticated`;`anon` 角色无任何 GRANT(防御性深度)。

### 4.3 为什么拆分 FOR ALL

旧版 `for all using (auth.uid() = user_id)` 存在两个 Postgres 语义陷阱:

1. **USING 子句对 INSERT 不评估**。没有 WITH CHECK 时,客户端可以 INSERT 任意 `user_id` 的行,然后被自己的 SELECT 看见 → 数据脏。
2. **UPDATE 时 USING 只校验 OLD**。攻击者可以把自己行的 `user_id` 改成受害账户 → 行所有权被"赠送"。

新版把每个动作拆开,每个动作独立声明 USING(老行)和/或 WITH CHECK(新行)。

### 4.4 user_id 不可变

即使 RLS WITH CHECK 限制了 user_id 必须等于 auth.uid(),UPDATE 路径仍可能把 OLD.user_id(A)改成 NEW.user_id(B)。`ffn_prevent_user_id_change` 触发器在 BEFORE UPDATE 阶段 raise:

```
ffn: user_id is immutable (entity=, old=, new=)
```

### 4.5 角色权限矩阵

| 角色 | notes | tags | note_tags |
|------|-------|------|-----------|
| `anon` | 无 GRANT | 无 GRANT | 无 GRANT |
| `authenticated` | SELECT/INSERT/UPDATE/DELETE(经 RLS 限定本人) | 同上 | 同上 |
| `service_role` | 全部(绕过 RLS,运维专用) | 同上 | 同上 |
| `supabase_admin` / `supabase_auth_admin` | 表 owner 路径(系统级) | 同上 | 同上 |

`service_role` **仅存在于自托管 Supabase 服务端**,用于后台维护(数据库备份/迁移/Realtime WAL 读取);客户端代码 0 引用。

---

## 5. 审计字段

三张表均增加:

| 列 | 类型 | 来源 | 用途 |
|----|------|------|------|
| `created_by` | `uuid references auth.users(id)` | `ffn_set_audit_on_insert` 触发器 | 越权事件溯源"谁创建" |
| `updated_by` | `uuid references auth.users(id)` | INSERT / UPDATE 触发器 | "谁最后改" |
| `device_id` | `text` | 从 `last_sync_device` 复制 | 跨设备同步冲突溯源 |

**写入保证**:
- INSERT:触发器在 BEFORE INSERT 把 `auth.uid()` 写入 `created_by` / `updated_by`,从 `last_sync_device` 写入 `device_id`
- UPDATE:触发器把 `auth.uid()` 写入 `updated_by`,刷新 `device_id`
- 客户端无法伪造(即使注入 payload,触发器覆盖)

**回溯示例**(发现某条 note 被非本人修改):

```sql
select id, content, created_by, updated_by, device_id, updated_at
from notes
where user_id = auth.uid()
  and (updated_by <> user_id or device_id not in (<my_devices>))
order by updated_at desc;
```

---

## 6. service_role 隔离

**客户端代码审查结果(2026-06-23)**:0 处 `service_role` 引用。

| 检查项 | 结果 |
|--------|------|
| `src/` / `public/` / `index.html` / `capacitor.config.json` 中 `service_role` 字符串 | 0 命中 |
| `import.meta.env.VITE_SUPABASE_SERVICE_ROLE` 读取 | 0 处 |
| `.env.*` 中的 `*SERVICE_ROLE*` key | 0 处 |
| 手动构造 `Authorization: Bearer ...` 绕过 supabase-js | 0 处 |

service_role 仅在以下位置使用:
- Supabase 自托管容器内部(`/opt/supabase/docker/.env`)
- 后台运维脚本(数据库备份、迁移验证)
- Realtime 服务读取 WAL

**部署约束**(运维 SOP):
- 任何 `.env*` 文件不得包含 `SERVICE_ROLE` 字串;CI 检查 grep 拦截
- 前端构建产物 `dist/` 不应包含任何 JWT(`eyJ` 前缀)由真实 service_role 签发的 token
- Android APK 反编译检查不应出现 service_role 字串

---

## 7. 软删除保护

### 7.1 业务规则

- `deleted_at IS NULL`:活跃行,可任意 UPDATE 业务字段
- `deleted_at IS NOT NULL`:Trash,业务字段只读,只能 restore(置 NULL)
- 软删期间 sync 字段(`sync_status` / `last_synced_at` / `version` / `updated_at`)仍可写

### 7.2 实现

`ffn_protect_notes_soft_deleted` / `ffn_protect_tags_soft_deleted` 触发器:
- 若 `OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NOT NULL AND (业务字段 is distinct)`
- → `raise exception 'ffn: cannot modify business fields on soft-deleted ... (restore first)'`

### 7.3 同步影响

| 同步场景 | 是否 raise | 说明 |
|----------|-----------|------|
| A 软删 → push → cloud 更新 deleted_at | 否 | deleted_at 是 sync 字段,允许 |
| cloud 的 deleted_at 拉到 B 本地 | 否 | 拉取是 INSERT/UPDATE,B 端触发器检查 OLD.deleted_at(本地),与 cloud 行无关 |
| B restore → push → cloud 清除 deleted_at | 否 | NEW.deleted_at IS NULL,不触发守卫 |
| 任意端在 deleted_at 非空时改 content | **是** | raise,要求先 restore |

---

## 8. Realtime 安全

### 8.1 客户端订阅

`src/lib/syncManager.ts:394,399,404` 订阅时显式带 filter:

```ts
postgres_changes,
  { event: '*', schema: 'public', table: 'notes', filter: `user_id=eq.${this.userId}` }
```

### 8.2 服务端 RLS

- Supabase Cloud 2024+:postgres_changes 默认 server-side 应用 RLS
- 自托管 Tencent Lighthouse(118.89.118.126):依赖 Supabase 版本 ≥ 2.x;若版本较老,client-side filter 是唯一保护
- **当前配置两层都有**:client-side filter 永远存在,服务端 RLS 加固后更严格

### 8.3 publication

3 张表已在 `supabase_realtime` publication(init.sql 第 21/45/65 行)。本 migration 不动 publication,不影响 Realtime。

---

## 9. 同步协议安全

### 9.1 同步 upsert

`src/lib/syncManager.ts:319-331`:

```ts
const items = pending.map((row) => ({
  ...row,
  user_id: this.userId,             // ← 来自 supabase.auth.getUser()
  last_sync_device: row.last_sync_device || this.deviceId,
  updated_at: row.updated_at || nowIso(this.clock),
}))

const { error } = await supabase
  .from(entity)
  .upsert(items, { onConflict })
```

### 9.2 RLS 校验链

1. **PostgREST** 把 payload + JWT 转给 Postgres
2. **INSERT/UPDATE 策略**:`WITH CHECK (auth.uid() = user_id)` 校验 `this.userId === auth.uid()`(永远成立,因二者来自同一会话)
3. **`ffn_prevent_user_id_change` 触发器**:UPSERT 命中已有行时,user_id 不能变
4. **`ffn_protect_*_soft_deleted` 触发器**:行已在 trash 时,业务字段不能改

任一层失败 → raise exception → PostgREST 返回 4xx → 前端 `console.warn` 不阻塞 sync(仅本次失败,下次重试)。

### 9.3 Factory Reset / hardDelete

依赖 RLS DELETE 限定本人行(删除本人全部 / 删除本人某行)。无 bypass。

---

## 10. 部署与回滚

### 10.1 部署顺序(灰度)

| 阶段 | 目标 | 验证 |
|------|------|------|
| 1. 本地 | `supabase start && supabase db reset` | migration idempotent,无报错 |
| 2. Test server | 163.7.3.215 上 `supabase db push` | psql 查策略 / 触发器 / 索引齐全 |
| 3. Canary | ffn-pre/canary 域(若仍存在) | 同步无回归,snapshot 通过 |
| 4. **Prod**(118.89.118.126) | `supabase db push` | **需用户显式确认**(2026-06-20 约定) |

### 10.2 部署前 checklist

- [ ] 本地 `supabase db reset` 通过
- [ ] 12 条 RLS 策略 + 6 个触发器已就位(`pg_policies` / `pg_trigger` 查询确认)
- [ ] 三表 `created_by` / `updated_by` / `device_id` 索引已建
- [ ] 现有 sync 自动化测试全部通过(`npm run test`)
- [ ] 双账号 RLS smoke test:A 不能读写 B 的行

### 10.3 RLS smoke test(双账号互攻)

```ts
// 仅本地 tmp 跑,不进 commit
import { createClient } from '@supabase/supabase-js'

const A = createClient(URL, ANON_KEY)  // user A 已登录
const B_ID = '...'                      // user B 的 uuid

// 1. A 试图 insert B 名下行
const { error: e1 } = await A.from('notes').insert({
  id: crypto.randomUUID(),
  user_id: B_ID,                         // ← 伪造
  content: 'pwned',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  version: 1,
  last_sync_device: 'attacker',
})
console.log('expect 42501 / new row violates row-level security policy:', e1?.code)

// 2. A 试图 UPDATE 自己行把 user_id 改成 B
const { error: e2 } = await A.from('notes')
  .update({ user_id: B_ID })
  .eq('id', '<A 自己某 note id>')
console.log('expect ffn: user_id is immutable:', e2?.message)

// 3. A 软删自己的 note 后改 content
const { error: e3 } = await A.from('notes')
  .update({ content: 'changed after delete' })
  .eq('id', '<A 自己某 soft-deleted note id>')
console.log('expect ffn: cannot modify business fields on soft-deleted:', e3?.message)

// 4. A 试图 delete B 的行
const { data: d4 } = await A.from('notes').delete().eq('id', '<B 的 note id>').select()
console.log('expect empty array (RLS 限定本人):', d4)
```

### 10.4 回滚 SOP(若 prod 同步被新策略阻断)

```sql
-- 在 prod psql 内手敲(需 service_role 连接)

-- 1. 删除新策略
do $$
declare r record;
begin
  for r in (select policyname, tablename from pg_policies
            where schemaname='public' and policyname in (
              'notes_select_own','notes_insert_own','notes_update_own','notes_delete_own',
              'tags_select_own','tags_insert_own','tags_update_own','tags_delete_own',
              'note_tags_select_own','note_tags_insert_own','note_tags_update_own','note_tags_delete_own'
            )) loop
    execute format('drop policy %I on %I.%I', r.policyname, 'public', r.tablename);
  end loop;
end $$;

-- 2. 删除触发器(函数保留无害)
drop trigger notes_audit_insert      on notes;
drop trigger notes_audit_update      on notes;
drop trigger notes_immutable_uid     on notes;
drop trigger notes_protect_soft_deleted on notes;
drop trigger tags_audit_insert       on tags;
drop trigger tags_audit_update       on tags;
drop trigger tags_immutable_uid      on tags;
drop trigger tags_protect_soft_deleted on tags;
drop trigger note_tags_audit_insert  on note_tags;
drop trigger note_tags_audit_update  on note_tags;
drop trigger note_tags_immutable_uid on note_tags;

-- 3. 重建原策略(恢复最小 sync 通路)
create policy "Users can access their own notes"     on notes     for all using (auth.uid() = user_id);
create policy "Users can access their own tags"      on tags      for all using (auth.uid() = user_id);
create policy "Users can access their own note_tags" on note_tags for all using (auth.uid() = user_id);

-- 4. 撤销新 revoke / 还原 grant(若之前撤销 anon 影响了什么)
grant select, insert, update, delete on notes      to authenticated;
grant select, insert, update, delete on tags       to authenticated;
grant select, insert, update, delete on note_tags  to authenticated;
```

**审计字段不回滚**:`created_by` / `updated_by` / `device_id` 保留,无副作用。

### 10.5 后续迁移

- 验证 1 周无回归后,可考虑加 NOT NULL 约束到 `device_id` / `updated_by`(可选)
- 评估是否在 v1.4 把 `last_sync_device` 重命名为 `device_id`(消除冗余)
- 评估 v2.0 启用 MFA / 邮箱验证

---

## 附录 A:验证 SQL(部署后跑)

```sql
-- 1. 策略齐全(应 12 行)
select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename in ('notes','tags','note_tags')
order by tablename, cmd, policyname;

-- 2. 触发器齐全(应 11 行:3 insert + 3 update + 3 immutable + 2 soft-deleted)
select tgname, tgrelid::regclass
from pg_trigger
where tgrelid in ('public.notes'::regclass, 'public.tags'::regclass, 'public.note_tags'::regclass)
  and not tgisinternal
order by tgrelid::regclass::text, tgname;

-- 3. 审计字段存在
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name in ('notes','tags','note_tags')
  and column_name in ('created_by','updated_by','device_id')
order by table_name, column_name;

-- 4. anon 无任何 GRANT
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee = 'anon';

-- 5. Realtime publication 未受影响
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
order by tablename;
```

## 附录 B:相关文件

| 路径 | 角色 |
|------|------|
| `supabase/config.toml` | 认证、JWT、密码、端口、Realtime 配置 |
| `supabase/migrations/20260101000000_init.sql` | 初始 schema + 过宽 RLS |
| `supabase/migrations/20260101000100_add_sync_columns.sql` | 同步状态字段 |
| `supabase/migrations/20260101000200_note_tags_updated_at.sql` | note_tags 时间戳 |
| `supabase/migrations/20260101000300_notes_archived_at.sql` | notes 归档字段 |
| `supabase/migrations/20260102000000_harden_rls_and_audit.sql` | **本安全加固** |
| `src/lib/supabase.ts` | 客户端单例(anon key) |
| `src/lib/auth.ts` | signUp / signIn / signOut 封装 |
| `src/lib/syncManager.ts` | 同步核心(upsert 携带 user_id) |
| `src/lib/factoryReset.ts` | 清空本地 + 云端(依赖 RLS scope) |
| `src/repositories/{notes,tags,noteTags}Repo.ts` | 业务 CRUD |
| `docs/SECURITY.md` | **本文档** |
