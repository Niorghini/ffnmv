/**
 * Supabase Database 类型（手动维护，对齐 supabase/migrations/20260101000000_init.sql）
 * - 仅含 3 张表：notes / tags / note_tags
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
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}