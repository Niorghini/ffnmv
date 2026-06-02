/**
 * M1 临时 App 壳：左侧笔记列表 + 右侧编辑器 + 顶部 v0.7.0 清理提示
 * M5 会重写为完整三栏（标签 | 笔记 | 编辑）
 */
import { useEffect, useState } from 'react'
import { openDb, wasLegacyCleaned, markLegacyCleaned } from '@/lib/db'
import NoteList from '@/components/NoteList'
import Editor from '@/components/Editor'
import Toast from '@/components/Toast'

export default function App() {
  const [activeId, setActiveId] = useState(null)
  const [activeNote, setActiveNote] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [showLegacyToast, setShowLegacyToast] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    openDb()
      .then(async () => {
        const wasCleaned = wasLegacyCleaned()
        if (!wasCleaned) {
          setShowLegacyToast(true)
          markLegacyCleaned()
        }
        setReady(true)
      })
      .catch((err) => {
        console.error('DB open failed:', err)
        setReady(true)
      })
  }, [])

  useEffect(() => {
    if (!activeId) {
      setActiveNote(null)
      return
    }
    const load = async () => {
      const { db } = await import('@/lib/db')
      const n = await db.notes.get(activeId)
      setActiveNote(n)
    }
    load()
  }, [activeId, refreshKey])

  const refresh = () => setRefreshKey((k) => k + 1)

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-screen text-gray-500 text-sm">
        加载中...
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-bg-main">
      <header className="px-4 py-3 bg-white border-b border-gray-200 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-primary">发法牛 v1.2</h1>
        <div className="text-xs text-gray-400">M1 临时壳 · 待接入登录 + 同步</div>
      </header>
      <div className="flex-1 flex overflow-hidden">
        <aside className="w-[40%] max-w-md border-r border-gray-200 bg-bg-card">
          <NoteList activeId={activeId} onSelect={setActiveId} refreshKey={refreshKey} />
        </aside>
        <main className="flex-1 bg-white">
          <Editor key={activeId || 'new'} note={activeNote} onSaved={refresh} />
        </main>
      </div>
      {showLegacyToast && (
        <Toast
          message="检测到 v0.7.0 本地数据，已自动清理。新版数据采用新结构。"
          duration={6000}
          onClose={() => setShowLegacyToast(false)}
        />
      )}
    </div>
  )
}
