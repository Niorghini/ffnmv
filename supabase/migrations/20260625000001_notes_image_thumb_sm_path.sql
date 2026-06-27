-- ════════════════════════════════════════════════════════════════════════════
-- Migration: 20260625000001_notes_image_thumb_sm_path.sql
-- Purpose:  notes 表加 image_thumb_sm_path 列(256px 缩略图 Storage 路径)
-- Author:   ffnmv dev, 2026-06-25
--
-- 背景:
--   imageProcessor 在 v1.3.2+ 出三级缩略图(original / thumb 512px / thumb-sm 256px)。
--   前两级(image_path / image_thumb_path)的 Storage 路径已写到 notes 表,
--   但 thumb-sm 路径没写。ListView 用 thumb-sm 渲染,跨设备 sync 时缺这个字段
--   会导致 imageDownloadQueue.enqueue 拿不到 thumb-sm 路径,降级到 thumb(512px),
--   浪费带宽 + 首屏更慢。
--
--   也解决:本地 Note 类型有 image_thumb_sm_path 字段,upsert 时 PostgREST 报
--   PGRST204 'Could not find column' 拒绝整个 sync push。
--
-- Idempotent:  IF NOT EXISTS / IF EXISTS 模式
-- ════════════════════════════════════════════════════════════════════════════

-- 1. 加列(空值默认,旧 note 历史记录 thumb-sm=null,list 降级到 thumb)
alter table notes
  add column if not exists image_thumb_sm_path text;

-- 2. 文档
comment on column notes.image_thumb_sm_path is
  '小缩略图 Storage 路径(256px JPEG 0.80,列表页用);null = 没生成过 thumb-sm(老 note 或上传失败)';