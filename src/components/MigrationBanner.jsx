import React from 'react'
import { Database, Loader2 } from 'lucide-react'
import { useMemos } from '../hooks/useMemos'

export default function MigrationBanner() {
  const { isMigrating, migrationProgress } = useMemos()

  if (!isMigrating) return null

  const percentage = migrationProgress.total > 0
    ? Math.round((migrationProgress.current / migrationProgress.total) * 100)
    : 0

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-[#0077B6] text-white py-3 px-4 shadow-lg">
      <div className="max-w-6xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Database size={18} />
          <span className="font-medium">正在迁移旧数据...</span>
          <span className="text-white/80 text-sm">
            {migrationProgress.current} / {migrationProgress.total} 条
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Loader2 size={16} className="animate-spin" />
          <span>{percentage}%</span>
        </div>
      </div>
      <div className="max-w-6xl mx-auto mt-2">
        <div className="w-full bg-white/20 rounded-full h-1.5">
          <div
            className="bg-white h-1.5 rounded-full transition-all duration-300"
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
    </div>
  )
}