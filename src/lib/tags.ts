/**
 * 标签工具：解析 + 自动标签建议
 * - parseTags 从文本中抽取 #xxx
 * - stripTagHash 去掉前导 #
 * - AUTO_TAG_RULES 复用 v0.7.0 关键词规则（保留中文友好分类）
 */

const TAG_RE = /#([\w一-鿿-]+)/g

export const parseTags = (content: string): string[] => {
  if (!content) return []
  const matches = content.match(TAG_RE) || []
  return [...new Set(matches.map((m) => m.slice(1)))]
}

export const stripTagHash = (tag: string): string =>
  tag.startsWith('#') ? tag.slice(1) : tag

export const extractTagNames = (content: string): string[] => {
  return [...new Set(parseTags(content))]
}

export interface AutoTagRule {
  keywords: string[]
  tag: string
  weight: number
}

// 复用的关键词规则（v0.7.0 的 autoTag.js 整体搬过来）
export const AUTO_TAG_RULES: AutoTagRule[] = [
  { keywords: ['todo', '待办', '计划', '要做', '待做', '任务', '做一下', '记得'], tag: '待办', weight: 1 },
  { keywords: ['反思', '复盘', '回顾', '总结', '思考', '悟到', '感悟', '体会'], tag: '反思', weight: 1 },
  { keywords: ['读书', '阅读', '书摘', '学到', '学习', '知识点', '课程', '教程'], tag: '学习', weight: 1 },
  { keywords: ['灵感', '想法', '突发奇想', '脑洞', '创意', 'idea'], tag: '灵感', weight: 1 },
  { keywords: ['为什么', '怎么', '如何', '疑问', '不懂', '问题', '是什么', '什么意思'], tag: '问题', weight: 1 },
  { keywords: ['https://', 'http://', 'www.', '.com', '.cn', '.org'], tag: '链接', weight: 2 },
  { keywords: ['重要', '紧急', '关键', '核心', '必须'], tag: '重要', weight: 1 },
  { keywords: ['项目', '需求', '功能', '迭代', '上线', '版本'], tag: '项目', weight: 1 },
  { keywords: ['会议', '沟通', '讨论', '评审', '对齐', '同步'], tag: '会议', weight: 1 },
  { keywords: ['@'], tag: '提及', weight: 2 },
  { keywords: ['！', '!!', '!!!'], tag: '重要', weight: 1 },
  { keywords: ['花了', '买了', '消费', '支出', '收入', '工资', '赚钱', '钱'], tag: '财务', weight: 1 },
  { keywords: ['开心', '高兴', '快乐', '幸福', '满足'], tag: '情绪', weight: 1 },
  { keywords: ['难过', '伤心', '生气', '焦虑', '压力', '崩溃'], tag: '情绪', weight: 1 },
]

export const suggestAutoTags = (content: string): string[] => {
  if (!content) return []
  const lower = content.toLowerCase()
  const matched = new Map<string, number>()
  for (const rule of AUTO_TAG_RULES) {
    for (const kw of rule.keywords) {
      if (lower.includes(kw.toLowerCase())) {
        matched.set(rule.tag, (matched.get(rule.tag) || 0) + rule.weight)
        break
      }
    }
  }
  return [...matched.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag)
}

// 稳定颜色：从 name 哈希出 hex 颜色，保证同名 tag 颜色一致
export const colorFromName = (name: string): string => {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 55%, 55%)`
}

/**
 * 派发数据变更事件（SyncManager 监听后会立即同步,Stores 监听后做增量更新）
 * EFF-002: 支持带 rows(新增/更新行) 或 removed(删除 id 列表) 让 Store 走增量
 * 不带 → 走全量 reload(向后兼容)
 */
export interface EmitDataUpdatedOptions {
  rows?: unknown[]
  removed?: string[] | Set<string>
  source?: 'pull' | 'push' | 'cleanup' | 'realtime' | 'local'
}

export const emitDataUpdated = (
  entityType: string,
  options: EmitDataUpdatedOptions = {},
): void => {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('data-updated', { detail: { entityType, ...options } }))
}