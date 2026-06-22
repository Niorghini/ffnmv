/**
 * 数据导入导出
 * - exportData(): 导出全部 notes / tags / note_tags 为 JSON
 * - importData(obj): 合并导入（按 id/[note_id+tag_id] 去重覆盖）
 *   - 导入后所有记录 sync_status 设为 pending，由 sync 系统推送到云端
 *   - 软删记录（deleted_at 非空）保留：完整还原状态
 *
 * 文件结构：
 * {
 *   "version": 1,
 *   "exportedAt": "2026-06-03T...",
 *   "notes": [...],
 *   "tags": [...],
 *   "noteTags": [...]
 * }
 */
import { db } from './db'
import type { Note, Tag, NoteTag, SyncStatus } from '@/types'

const EXPORT_VERSION = 1

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

const isRecordArray = (v: unknown): v is Record<string, unknown>[] =>
  Array.isArray(v) && v.every((x) => isObject(x))

export interface ExportData {
  version: number
  exportedAt: string
  notes: Note[]
  tags: Tag[]
  noteTags: NoteTag[]
}

export interface ImportStats {
  added: number
  updated: number
}

export interface ImportResult {
  notes: ImportStats
  tags: ImportStats
  noteTags: ImportStats
}

/**
 * 导出所有数据
 */
export const exportData = async (): Promise<ExportData> => {
  const [notes, tags, noteTags] = await Promise.all([
    db.notes.toArray(),
    db.tags.toArray(),
    db.note_tags.toArray(),
  ])
  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    notes,
    tags,
    noteTags,
  }
}

/**
 * 序列化为可下载的 JSON 字符串
 */
export const exportDataAsJson = async (): Promise<string> => {
  const data = await exportData()
  return JSON.stringify(data, null, 2)
}

export interface ValidateResult {
  ok: boolean
  error?: string
}

/**
 * 校验导入文件结构
 * - 必需字段：version, notes (array), tags (array), noteTags (array)
 */
export const validateImport = (raw: unknown): ValidateResult => {
  if (!isObject(raw)) {
    return { ok: false, error: '文件不是有效的 JSON 对象' }
  }
  if (raw.version !== EXPORT_VERSION) {
    return { ok: false, error: `不支持的版本：${String(raw.version)}（当前仅支持 v${EXPORT_VERSION}）` }
  }
  if (!isRecordArray(raw.notes)) {
    return { ok: false, error: 'notes 字段缺失或格式错误' }
  }
  if (!isRecordArray(raw.tags)) {
    return { ok: false, error: 'tags 字段缺失或格式错误' }
  }
  if (!isRecordArray(raw.noteTags)) {
    return { ok: false, error: 'noteTags 字段缺失或格式错误' }
  }
  return { ok: true }
}

/**
 * 合并导入（按主键 upsert：notes/tags 用 id，noteTags 用 [note_id+tag_id]）
 * - 顺序：notes → tags → note_tags（避免外键悬空）
 * - 所有记录 sync_status 设为 'pending'，由 sync 系统推到云端
 * - 返回统计：{ added, updated, unchanged } 按表分别
 */
export const importData = async (raw: unknown): Promise<ImportResult> => {
  const v = validateImport(raw)
  if (!v.ok) throw new Error(v.error)

  // 把 imported records 的 sync_status 强制设为 pending
  const forcePending = <T extends object>(r: T): T & { sync_status: SyncStatus } => ({
    ...r,
    sync_status: 'pending',
  })

  const notesIn = (raw as ExportData).notes.map(forcePending)
  const tagsIn = (raw as ExportData).tags.map(forcePending)
  const noteTagsIn = (raw as ExportData).noteTags.map(forcePending)

  // 统计：插入 vs 更新
  const countDiff = async <K>(
    table: { bulkGet(keys: K[]): Promise<(unknown | undefined)[]> },
    items: unknown[],
    keyFn: (x: unknown) => K,
  ): Promise<ImportStats> => {
    const keys = items.map(keyFn)
    const existing = await table.bulkGet(keys)
    let added = 0
    let updated = 0
    for (let i = 0; i < items.length; i++) {
      if (existing[i] === undefined) added++
      else updated++
    }
    return { added, updated }
  }

  const noteStats = await countDiff(db.notes, notesIn, (n) => (n as Note).id)
  const tagStats = await countDiff(db.tags, tagsIn, (t) => (t as Tag).id)
  const linkStats = await countDiff(db.note_tags, noteTagsIn, (l) => [
    (l as NoteTag).note_id,
    (l as NoteTag).tag_id,
  ])

  await db.transaction('rw', db.notes, db.tags, db.note_tags, async () => {
    if (notesIn.length) await db.notes.bulkPut(notesIn as never[])
    if (tagsIn.length) await db.tags.bulkPut(tagsIn as never[])
    if (noteTagsIn.length) await db.note_tags.bulkPut(noteTagsIn as never[])
  })

  return {
    notes: noteStats,
    tags: tagStats,
    noteTags: linkStats,
  }
}