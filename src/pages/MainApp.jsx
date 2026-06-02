/**
 * MainApp —— v0.7.0 风格 2 栏布局
 * - 顶部：logo + slogan（v0.7.0 风格）
 * - max-w-6xl 居中容器
 * - 左栏 flex-1：Editor（顶部）+ SearchBar + NoteList
 * - 右栏 lg:w-80：Sidebar（sync + 状态筛选 + 标签 + 操作）
 */
import { useEffect, useState } from 'react'
import { db } from '@/lib/db'
import { getSyncManager } from '@/lib/syncInstance'
import { useAuthStore } from '@/stores/useAuthStore'
import { useNotesStore } from '@/stores/useNotesStore'
import Editor from '@/components/Editor'
import SearchBar from '@/components/SearchBar'
import NoteList from '@/components/NoteList'
import Sidebar from '@/components/Sidebar'
import { ConflictBanner } from '@/components/ConflictDialog'
import logoUrl from '/logo.png'

const MainApp = () => {
  const { user } = useAuthStore()
  const { activeId, setActiveId, searchQuery, setSearchQuery, load } = useNotesStore()
  const [activeNote, setActiveNote] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!activeId) {
      setActiveNote(null)
      return
    }
    db.notes.get(activeId).then(setActiveNote)
  }, [activeId, refreshKey])

  useEffect(() => {
    const handler = () => {
      setRefreshKey((k) => k + 1)
      if (activeId) db.notes.get(activeId).then(setActiveNote)
    }
    window.addEventListener('data-updated', handler)
    return () => window.removeEventListener('data-updated', handler)
  }, [activeId])

  const handleSelect = (id) => {
    setActiveId(id)
  }

  const handleSaved = () => {
    setRefreshKey((k) => k + 1)
  }

  const handleSync = async () => {
    await getSyncManager().fullSync()
    setRefreshKey((k) => k + 1)
  }

  return (
    <div className="min-h-screen bg-bg-main">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <header className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <img src={logoUrl} alt="发法牛" className="h-12" />
              <p className="text-sm text-gray-400">发布的想法都很牛！</p>
            </div>
            {user && (
              <div className="text-xs text-gray-400">{user.email}</div>
            )}
          </div>
        </header>

        <div className="flex flex-col lg:flex-row gap-6">
          <div className="flex-1 space-y-6 min-w-0">
            <Editor
              key={activeId || 'new'}
              note={activeNote}
              onSaved={handleSaved}
              onCancel={() => setActiveId(null)}
            />
            <SearchBar value={searchQuery} onChange={setSearchQuery} />
            <NoteList
              activeId={activeId}
              onSelect={handleSelect}
              refreshKey={refreshKey}
            />
          </div>
          <div className="lg:w-80 space-y-4 shrink-0">
            <Sidebar onSync={handleSync} onConflictClick={() => {}} />
          </div>
        </div>
      </div>
      <ConflictBanner />
    </div>
  )
}

export default MainApp
