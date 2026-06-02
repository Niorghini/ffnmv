-- 同步状态字段补齐
-- 原迁移漏了 sync_status 和 last_synced_at，SyncManager push 时携带这两个字段被 PostgREST 拒收
-- 加上这俩字段，3 表一致

alter table notes
  add column if not exists sync_status text check (sync_status in ('pending', 'synced', 'failed')) not null default 'pending',
  add column if not exists last_synced_at timestamp with time zone;

alter table tags
  add column if not exists sync_status text check (sync_status in ('pending', 'synced', 'failed')) not null default 'pending',
  add column if not exists last_synced_at timestamp with time zone;

alter table note_tags
  add column if not exists sync_status text check (sync_status in ('pending', 'synced', 'failed')) not null default 'pending',
  add column if not exists last_synced_at timestamp with time zone;
