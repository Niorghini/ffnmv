-- ════════════════════════════════════════════════════════════════════════════
-- Migration: 20260124000000_note_image_rls_multitenant.sql
-- Purpose:  更新 note-images RLS 策略兼容 multi-tenant 模式
-- Author:   ffnmv dev, 2026-06-24
--
-- 背景:
--   测试服务器 Storage v1.60.4 在 single-tenant 模式下(TENANT_ID=空)会
--   从 Host header 推导 tenant 并 prepend 到 object key 上,导致 key 以 "/" 开头被拒。
--   改用 multi-tenant 模式(TENANT_ID=storage),前端 URL 路径包含 tenant 前缀:
--     /storage/v1/object/storage/note-images/{user_id}/{note_id}/{uuid}.{ext}
--   Storage 从 URL 提取 tenant("storage"),实际 key 仍是 note-images/{user_id}/...
--
--   RLS foldername 解析:
--     multi-tenant: foldername[0]="storage", [1]="note-images", [2]=user_id
--     single-tenant: foldername[0]="note-images", [1]=user_id
--
--  此 migration 用 CASE 兼容两种模式。
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists "note_images_select_own" on storage.objects;
drop policy if exists "note_images_insert_own" on storage.objects;
drop policy if exists "note_images_update_own" on storage.objects;
drop policy if exists "note_images_delete_own" on storage.objects;

create policy "note_images_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'note-images'
    and auth.uid()::text = (
      case
        when (storage.foldername(name))[1] = 'note-images' then (storage.foldername(name))[2]
        when (storage.foldername(name))[2] = 'note-images' then (storage.foldername(name))[3]
        else null
      end
    )
  );

create policy "note_images_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'note-images'
    and auth.uid()::text = (
      case
        when (storage.foldername(name))[1] = 'note-images' then (storage.foldername(name))[2]
        when (storage.foldername(name))[2] = 'note-images' then (storage.foldername(name))[3]
        else null
      end
    )
  );

create policy "note_images_update_own"
  on storage.objects for update
  to authenticated
  using      (bucket_id = 'note-images' and auth.uid()::text = (
    case
      when (storage.foldername(name))[1] = 'note-images' then (storage.foldername(name))[2]
      when (storage.foldername(name))[2] = 'note-images' then (storage.foldername(name))[3]
      else null
    end
  ))
  with check (bucket_id = 'note-images' and auth.uid()::text = (
    case
      when (storage.foldername(name))[1] = 'note-images' then (storage.foldername(name))[2]
      when (storage.foldername(name))[2] = 'note-images' then (storage.foldername(name))[3]
      else null
    end
  ));

create policy "note_images_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'note-images'
    and auth.uid()::text = (
      case
        when (storage.foldername(name))[1] = 'note-images' then (storage.foldername(name))[2]
        when (storage.foldername(name))[2] = 'note-images' then (storage.foldername(name))[3]
        else null
      end
    )
  );
