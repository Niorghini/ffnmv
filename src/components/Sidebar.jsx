import React, { useRef, useState } from 'react'
import { Calendar, Hash, FileText, TrendingUp, Download, Upload, HardDrive, CheckCircle2, Circle, Archive, ChevronDown, ChevronUp, Filter } from 'lucide-react'
import TagList from './TagList'
import { useMemos } from '../hooks/useMemos'

export default function Sidebar() {
  const { stats, storageInfo, exportData, importData, statusStats, statusFilter, filterByStatus, markAllAsProcessed } = useMemos()
  const fileInputRef = useRef(null)
  const [storageExpanded, setStorageExpanded] = useState(false)

  const handleExport = async () => {
    await exportData()
  }

  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleImport = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const count = await importData(file)
      alert(`成功导入 ${count} 条记录`)
    } catch (err) {
      alert('导入失败：' + err.message)
    }
    e.target.value = ''
  }

  const handleMarkAllProcessed = async () => {
    if (statusStats.unprocessed === 0) {
      alert('没有未处理的记录')
      return
    }
    if (confirm(`确定将 ${statusStats.unprocessed} 条未处理的记录全部标记为已处理？`)) {
      const count = await markAllAsProcessed()
      if (count !== null) {
        // silent success
      }
    }
  }

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  const filterTabs = [
    { key: 'unprocessed', label: '未处理', count: statusStats.unprocessed, icon: Circle },
    { key: 'processed', label: '已处理', count: statusStats.processed, icon: CheckCircle2 },
    { key: 'all', label: '全部', count: statusStats.processed + statusStats.unprocessed, icon: Archive },
  ]

  return (
    <div className="space-y-4">
      {/* 状态筛选 */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium text-gray-800 flex items-center gap-2">
            <Filter size={16} className="text-gray-400" />
            筛选
          </h3>
          {statusStats.unprocessed > 0 && statusFilter !== 'processed' && (
            <button
              onClick={handleMarkAllProcessed}
              className="text-xs text-[#0077B6] hover:text-[#005f8c] flex items-center gap-1"
            >
              一键已处理
            </button>
          )}
        </div>
        <div className="flex gap-1">
          {filterTabs.map(tab => {
            const Icon = tab.icon
            const isActive = statusFilter === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => filterByStatus(tab.key)}
                className={`
                  flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-xl text-sm transition-all
                  ${isActive
                    ? 'bg-[#0077B6] text-white'
                    : 'bg-blue-50 text-[#0077B6] hover:bg-blue-100'
                  }
                `}
              >
                <Icon size={14} />
                <span className="whitespace-nowrap">{tab.label}</span>
                <span className={`text-xs ${isActive ? 'text-white/70' : 'text-[#0077B6]/60'}`}>
                  {tab.count}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
        <h3 className="font-medium text-gray-800 mb-3 flex items-center gap-2">
          <TrendingUp size={16} className="text-gray-400" />
          统计
        </h3>
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center p-2 bg-gray-50 rounded-xl">
            <div className="text-2xl font-bold text-[#0077B6]">{stats.today}</div>
            <div className="text-xs text-gray-400 mt-1">今日</div>
          </div>
          <div className="text-center p-2 bg-gray-50 rounded-xl">
            <div className="text-2xl font-bold text-[#0077B6]">{stats.thisMonth}</div>
            <div className="text-xs text-gray-400 mt-1">本月</div>
          </div>
          <div className="text-center p-2 bg-gray-50 rounded-xl">
            <div className="text-2xl font-bold text-[#0077B6]">{stats.total}</div>
            <div className="text-xs text-gray-400 mt-1">全部</div>
          </div>
        </div>
      </div>

      {/* 存储信息 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
        <div className="flex items-center justify-between px-4 pt-4 pb-3">
          <h3 className="font-medium text-gray-800 flex items-center gap-2">
            <HardDrive size={16} className="text-gray-400" />
            存储
          </h3>
          <div className="flex items-center gap-2">
            {!storageExpanded && (
              <span className="text-xs text-gray-400">{formatBytes(storageInfo.used)}</span>
            )}
            <button
              onClick={() => setStorageExpanded(!storageExpanded)}
              className="text-gray-400 hover:text-gray-600"
            >
              {storageExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
        </div>

        {storageExpanded && (
          <>
            <div className="px-4 pb-2 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">已用空间</span>
                <span className="text-gray-700 font-medium">
                  {formatBytes(storageInfo.used)}
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-1.5">
                <div
                  className="bg-[#0077B6] h-1.5 rounded-full transition-all"
                  style={{ width: `${Math.min(storageInfo.percentage, 100)}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-gray-400">
                <span>{storageInfo.percentage}% 已用</span>
                <span>总量 {formatBytes(storageInfo.quota)}</span>
              </div>
            </div>

            {/* 导入导出按钮 */}
            <div className="flex gap-2 px-4 pb-4">
              <button
                onClick={handleExport}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm text-[#0077B6] bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors"
              >
                <Download size={14} />
                导出
              </button>
              <button
                onClick={handleImportClick}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm text-[#0077B6] bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors"
              >
                <Upload size={14} />
                导入
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleImport}
                className="hidden"
              />
            </div>
          </>
        )}
      </div>

      {/* 标签列表 */}
      <TagList />
    </div>
  )
}