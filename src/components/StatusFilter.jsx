/**
 * StatusFilter —— 三段式 tab 风格（v0.7.0）
 * - bg-bg-main 包裹，内白卡
 * - 当前选中 bg-white + shadow-sm + text-primary
 */
const StatusFilter = ({ value, onChange }) => {
  const tabs = [
    { value: 'all', label: '全部' },
    { value: 'pending', label: '未处理' },
    { value: 'completed', label: '已处理' },
  ]
  return (
    <div className="flex bg-bg-main rounded-lg p-0.5 text-sm">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={`flex-1 py-1.5 rounded-md transition-all duration-200 ${
            value === t.value
              ? 'bg-white text-[#0077B6] font-medium shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export default StatusFilter
