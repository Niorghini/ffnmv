-- ════════════════════════════════════════════════════════════════════════════
-- Migration: 20260625000000_attachment_thumb_sm.sql
-- Purpose:  attachments.kind 增加 'thumb-sm'(列表场景用 256px 缩略图)
-- Author:   ffnmv dev, 2026-06-25
--
-- 背景:
--   当前 attachments.kind 只有 'original' / 'thumb' 两类,thumb 固定 512px
--   列表场景(NoteList 行高 120px)解 512px 缩略图偏重,首屏解码 + IndexedDB 体积
--   都受影响。新增 256px 'thumb-sm',Notes 列表用,详情页仍用 512px 'thumb'。
--
-- 兼容性:
--   旧 note 仍只有 original + thumb,NoteImage 渲染会降级到 thumb(代码层处理)
--   旧设备 sync 下来的 image_thumb_path 仍是 512px,thumb-sm 不会自动生成
--   旧数据由 imageDownloadQueue 在后台按需补全(下个 PR 接入)
--
-- Idempotent:DO $$ BEGIN ... EXCEPTION WHEN ... 模式
-- ════════════════════════════════════════════════════════════════════════════

-- 1. 取消旧 CHECK
alter table public.attachments drop constraint if exists attachments_kind_check;

-- 2. 加新 CHECK,允许 thumb-sm
alter table public.attachments
  add constraint attachments_kind_check
  check (kind in ('original', 'thumb', 'thumb-sm'));

-- 3. 文档
comment on column public.attachments.kind is
  'original = 原图;thumb = 512px 缩略图(详情页);thumb-sm = 256px 缩略图(列表)';
