/**
 * Supabase Database 类型（手动维护，对齐 supabase/migrations/）
 * - 3 张业务表:notes / tags / note_tags
 * - 1 个 RPC:ffn_user_image_quota_bytes(v1.3.2+ 图片附件)
 * - Insert/Update 用 Partial<Row> 简化（生产可生成更精确的类型）
 * - 未来如需严格 Insert/Update 字段约束，用 `supabase gen types typescript` 重新生成
 */
import type { Note, Tag, NoteTag } from '@/types'

export type Database = {
  public: {
    Tables: {
      notes: {
        Row: Note
        Insert: Partial<Note>
        Update: Partial<Note>
      }
      tags: {
        Row: Tag
        Insert: Partial<Tag>
        Update: Partial<Tag>
      }
      note_tags: {
        Row: NoteTag
        Insert: Partial<NoteTag>
        Update: Partial<NoteTag>
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      ffn_user_image_quota_bytes: {
        Args: { p_user: string }
        Returns: number
      }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
