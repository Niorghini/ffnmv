/**
 * MainApp —— v0.7.0 风格 2 栏布局
 * - 顶部：logo + slogan（v0.7.0 风格）
 * - max-w-6xl 居中容器
 * - 左栏 flex-1：Editor（顶部）+ SearchBar + NoteList
 * - 右栏 lg:w-80：Sidebar（sync + 状态筛选 + 标签 + 操作）
 */
import { useEffect } from 'react'
import { getSyncManager } from '@/lib/syncInstance'
import { useAuthStore } from '@/stores/useAuthStore'
import { useNotesStore } from '@/stores/useNotesStore'
import Editor from '@/components/Editor'
import SearchBar from '@/components/SearchBar'
import NoteList from '@/components/NoteList'
import Sidebar from '@/components/Sidebar'
import UserMenu from '@/components/UserMenu'
import { ConflictBanner } from '@/components/ConflictDialog'
import logoUrl from '/logo.png'

const MainApp = () => {
  const { user } = useAuthStore()
  const { activeId, setActiveId, activeTagId, setActiveTagId, searchQuery, setSearchQuery, load } = useNotesStore()

  useEffect(() => {
    void load()
  }, [load])

  const handleSelect = (id: string) => {
    setActiveId(id)
  }

  const handleSync = async () => {
    await getSyncManager().fullSync()
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
              <UserMenu onSync={handleSync} />
            )}
          </div>
        </header>

        <div className="flex flex-col lg:flex-row gap-6">
          <div className="flex-1 space-y-6 min-w-0">
            <Editor
              key="new"
              note={undefined}
              onSaved={() => {}}
              onCancel={() => {}}
            />
            <SearchBar value={searchQuery} onChange={setSearchQuery} />
            <NoteList
              activeId={activeId}
              onSelect={handleSelect}
              onTagClick={(_e, tagId) => setActiveTagId(tagId === activeTagId ? null : tagId)}
            />
          </div>
          <div className="lg:w-80 space-y-4 shrink-0">
            <Sidebar onConflictClick={() => {}} />
          </div>
        </div>
      </div>
      <ConflictBanner />
    </div>
  )
}

export default MainApp