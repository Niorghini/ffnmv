import React, { useState, useEffect } from 'react'
import { MemosProvider, useMemos } from './hooks/useMemos'
import Editor from './components/Editor'
import MemoList from './components/MemoList'
import Sidebar from './components/Sidebar'
import SearchBar from './components/SearchBar'
import MigrationBanner from './components/MigrationBanner'
import { Loader2, LogOut, Cloud, CloudOff } from 'lucide-react'
import logoUrl from '/logo.png'
import { getCloudUser, logoutCloud } from './utils/db'
import db from './utils/db'

function AppContent() {
  const { isLoading, isMigrating, isSyncing } = useMemos()
  const [cloudUser, setCloudUser] = useState(null)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [wsStatus, setWsStatus] = useState('not-started')

  // 监听云端用户和连接状态
  useEffect(() => {
    const user = getCloudUser()
    const sub1 = user.subscribe(u => setCloudUser(u))

    const wsSub = db.cloud.webSocketStatus.subscribe(status => {
      setWsStatus(status)
    })

    return () => {
      sub1.unsubscribe()
      wsSub.unsubscribe()
    }
  }, [])

  // 点击空白关闭菜单
  useEffect(() => {
    if (!showUserMenu) return
    const handler = (e) => {
      // 忽略用户菜单区域内的点击
      if (e.target.closest('.user-menu')) return
      setShowUserMenu(false)
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [showUserMenu])

  const handleLogout = async () => {
    await logoutCloud()
    setShowUserMenu(false)
  }

  if (isLoading || isMigrating) {
    return (
      <div className="min-h-screen bg-bg-main flex items-center justify-center">
        <div className="text-center">
          <Loader2 size={32} className="animate-spin text-[#0077B6] mx-auto mb-3" />
          <p className="text-gray-400 text-sm">
            {isMigrating ? '正在迁移数据...' : isSyncing ? '正在同步云端数据...' : '加载中...'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg-main">
      {/* 离线提示 */}
      {(wsStatus === 'disconnected' || wsStatus === 'error') && (
        <div className="bg-gray-100 border-b border-gray-200 py-2 text-center text-sm text-gray-400">
          请注意：离线状态
        </div>
      )}
      <MigrationBanner />
      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* 头部 */}
        <header className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <img
                src={logoUrl}
                alt="ffn"
                className="h-12"
              />
              <p className="text-sm text-gray-400">发布的想法都很牛！</p>
            </div>

            {/* 云端登录信息 */}
            {cloudUser && cloudUser.email && (
              <div className="relative user-menu">
                <button
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 rounded-xl hover:bg-blue-100 transition-colors"
                >
                  {wsStatus === 'connected' ? (
                    <Cloud size={14} className="text-green-500" />
                  ) : wsStatus === 'disconnected' || wsStatus === 'error' ? (
                    <CloudOff size={14} className="text-red-400" />
                  ) : (
                    <Cloud size={14} className="text-[#0077B6] animate-pulse" />
                  )}
                  <span className={`text-sm font-medium ${wsStatus === 'connected' ? 'text-[#0077B6]' : wsStatus === 'disconnected' || wsStatus === 'error' ? 'text-gray-400' : 'text-[#0077B6]'} ${wsStatus === 'connecting' ? 'animate-flash-email' : ''}`}>
                    {cloudUser.email}
                  </span>
                </button>
                {showUserMenu && (
                  <div className="absolute right-0 top-full mt-2 bg-white rounded-xl shadow-lg border border-gray-100 py-1 min-w-[160px] z-50">
                    <div className="px-3 py-2 border-b border-gray-100">
                      <p className="text-xs text-gray-400">已登录</p>
                      <p className="text-sm text-gray-700 truncate">{cloudUser.email}</p>
                    </div>
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-50 transition-colors"
                    >
                      <LogOut size={14} />
                      退出登录
                    </button>
                  </div>
                )}
              </div>
            )}

            {!cloudUser && (
              <div className="flex items-center gap-1.5 text-xs text-gray-400">
                <Cloud size={14} />
                <span>本地模式</span>
              </div>
            )}
          </div>
        </header>

        {/* 主内容 */}
        <div className="flex flex-col lg:flex-row gap-6">
          {/* 左侧：编辑器 + 列表 */}
          <div className="flex-1 space-y-6">
            <Editor />
            <SearchBar />
            <MemoList />
          </div>

          {/* 右侧：侧边栏 */}
          <div className="lg:w-80 space-y-4">
            <Sidebar />
          </div>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <MemosProvider>
      <AppContent />
    </MemosProvider>
  )
}