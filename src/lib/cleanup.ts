/**
 * 软删除清理（PRD 4.1）
 * - 30 天前 deleted_at 的行硬删
 * - 启动时跑一次
 */
import { db, nowIso } from '@/lib/db'
import { emitDataUpdated } from '@/lib/tags'

const RETAIN_DAYS = 30

export interface CleanupStats {
  notes: number
  tags: number
  note_tags: number
  conflicts: number
}

export const runCleanup = async ({ now = Date.now() }: { now?: number } = {}): Promise<CleanupStats> => {
  const cutoff = new Date(now - RETAIN_DAYS * 86400000).toISOString()
  const ts = nowIso()
  const stats: CleanupStats = { notes: 0, tags: 0, note_tags: 0, conflicts: 0 }

  await db.transaction(
    'rw',
    [db.notes, db.tags, db.note_tags, db.conflicts, db.sync_queue],
    async () => {
      // notes
      const oldNotes = await db.notes
        .where('deleted_at').below(cutoff)
        .toArray()
      for (const n of oldNotes) {
        await db.notes.delete(n.id)
        await db.sync_queue
          .where('entity_id').equals(n.id)
          .and((q) => q.entity_type === 'notes')
          .delete()
        stats.notes++
      }

      // tags
      const oldTags = await db.tags
        .where('deleted_at').below(cutoff)
        .toArray()
      for (const t of oldTags) {
        await db.tags.delete(t.id)
        await db.sync_queue
          .where('entity_id').equals(t.id)
          .and((q) => q.entity_type === 'tags')
          .delete()
        stats.tags++
      }

      // note_tags
      const oldLinks = await db.note_tags
        .where('deleted_at').below(cutoff)
        .toArray()
      for (const l of oldLinks) {
        await db.note_tags.delete([l.note_id, l.tag_id])
        stats.note_tags++
      }

      // conflicts：清空已解决（暂定 30 天前的）
      const oldConflicts = await db.conflicts
        .where('created_at').below(cutoff)
        .toArray()
      for (const c of oldConflicts) {
        await db.conflicts.delete(c.id)
        stats.conflicts++
      }
    },
  )

  if (stats.notes || stats.tags || stats.note_tags) emitDataUpdated('notes')
  return stats
}