-- notes 加 archived_at（自动归档功能用的本地字段，PRD SQL 漏了）
alter table notes
  add column if not exists archived_at timestamp with time zone;
