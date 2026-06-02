-- note_tags 加 updated_at（之前漏写，SyncManager pull 用 updated_at 增量同步）
alter table note_tags
  add column if not exists updated_at timestamp with time zone not null default now();
