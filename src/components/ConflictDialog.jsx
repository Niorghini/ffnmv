/**
 * ConflictBanner + ConflictDialog —— 冲突解决 UI
 * - 顶部红条：⚠ N 条冲突
 * - 点击展开对话框
 *   - 三个选项：用本地 / 用云端 / 手动合并（编辑双栏）
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, X, Check } from 'lucide-react'
import { useConflictsStore } from '@/stores/useConflictsStore'
import { db } from '@/lib/db'
import { notesRepo } from '@/repositories/notesRepo'
import { tagsRepo } from '@/repositories/tagsRepo'
import { pickWinner } from '@/lib/conflict'

export const ConflictBanner = () => {
  const { conflicts, unread, load } = useConflictsStore()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    load()
  }, [load])

  if (conflicts.length === 0) return null

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed top-3 left-1/2 -translate-x-1/2 z-40 px-3 py-1.5 bg-red-500 text-white text-xs rounded-full shadow-md flex items-center gap-2 hover:opacity-90"
      >
        <AlertTriangle size={14} />
        <span>{unread} 条冲突待处理</span>
      </button>
      {open && <ConflictDialog onClose={() => setOpen(false)} />}
    </>
  )
}

const ConflictDialog = ({ onClose }) => {
  const { conflicts, clear } = useConflictsStore()
  const [index, setIndex] = useState(0)
  const conflict = conflicts[index]

  if (!conflict) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h2 className="text-base font-semibold">
            冲突 {index + 1} / {conflicts.length}
            <span className="ml-2 text-xs text-gray-400">
              {conflict.entity_type} · {String(conflict.entity_id).slice(0, 8)}
            </span>
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 grid grid-cols-2 gap-3 p-4 overflow-y-auto">
          <div>
            <div className="text-xs text-gray-500 mb-1">本地版本</div>
            <pre className="text-xs bg-bg-main p-3 rounded-lg overflow-auto max-h-96 whitespace-pre-wrap break-words">
              {JSON.stringify(conflict.local_data, null, 2)}
            </pre>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">云端版本</div>
            <pre className="text-xs bg-bg-main p-3 rounded-lg overflow-auto max-h-96 whitespace-pre-wrap break-words">
              {JSON.stringify(conflict.cloud_data, null, 2)}
            </pre>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
          <div className="text-xs text-gray-400">
            LWW 推荐：
            {pickWinner(conflict.local_data, conflict.cloud_data) === conflict.cloud_data ? '云端' : '本地'}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => resolve(conflict, 'local')}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              用本地
            </button>
            <button
              onClick={() => resolve(conflict, 'cloud')}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              用云端
            </button>
            <button
              onClick={async () => {
                await resolve(conflict, 'merge')
                if (index < conflicts.length - 1) {
                  setIndex(index + 1)
                } else {
                  onClose()
                }
              }}
              className="px-3 py-1.5 text-sm bg-[#0077B6] text-white rounded-lg hover:bg-[#005f8c] transition-colors"
            >
              <Check size={14} className="inline mr-1" />
              接受 LWW
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const resolve = async (conflict, choice) => {
  const { entity_type, entity_id, local_data, cloud_data } = conflict
  const winner = pickWinner(local_data, cloud_data)
  // 自动：若用户选 LWW 胜出版本，写回本地并标记 sync_status=pending 让 push 覆盖云端
  // 若用户选另一边：写回对应版本
  let chosen
  if (choice === 'local') chosen = local_data
  else if (choice === 'cloud') chosen = cloud_data
  else chosen = winner // LWW 胜出

  const finalRow = {
    ...chosen,
    sync_status: 'pending',
    last_synced_at: null,
  }
  if (entity_type === 'notes') {
    await notesRepo._putDirect(finalRow)
  } else if (entity_type === 'tags') {
    await tagsRepo._putDirect(finalRow)
  } else if (entity_type === 'note_tags') {
    await db.note_tags.put(finalRow)
  }
  // 删除冲突记录
  await db.conflicts.delete(conflict.id)
  // 通知 UI:EFF-002 带 rows 让 store 走增量
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('data-updated', {
      detail: { entityType: entity_type, rows: [finalRow] },
    }))
  }
}
