/**
 * 自动标签建议规则
 */

// 自动标签规则：关键词 → 标签
const AUTO_TAG_RULES = [
  // 待办/任务相关
  { keywords: ['todo', '待办', '计划', '要做', '待做', '任务', '做一下', '记得'], tag: '待办', weight: 1 },
  // 反思/复盘
  { keywords: ['反思', '复盘', '回顾', '总结', '思考', '悟到', '感悟', '体会'], tag: '反思', weight: 1 },
  // 读书/学习
  { keywords: ['读书', '阅读', '书摘', '学到', '学习', '知识点', '课程', '教程', '学习'], tag: '学习', weight: 1 },
  // 灵感/想法
  { keywords: ['灵感', '想法', '突发奇想', '脑洞', '创意', 'idea'], tag: '灵感', weight: 1 },
  // 问题/疑问
  { keywords: ['为什么', '怎么', '如何', '疑问', '不懂', '问题', '是什么', '什么意思'], tag: '问题', weight: 1 },
  // 链接
  { keywords: ['https://', 'http://', 'www.', '.com', '.cn', '.org'], tag: '链接', weight: 2 },
  // 重要/紧急
  { keywords: ['重要', '紧急', '关键', '核心', '必须'], tag: '重要', weight: 1 },
  // 项目
  { keywords: ['项目', '需求', '功能', '迭代', '上线', '版本'], tag: '项目', weight: 1 },
  // 会议/沟通
  { keywords: ['会议', '沟通', '讨论', '评审', '对齐', '同步'], tag: '会议', weight: 1 },
  // 人
  { keywords: ['@'], tag: '提及', weight: 2 },
  // 情绪/感叹
  { keywords: ['！', '!!', '!!!'], tag: '重要', weight: 1, matchMode: 'content' },
  // 财务/金钱
  { keywords: ['花了', '买了', '消费', '支出', '收入', '工资', '赚钱', '钱'], tag: '财务', weight: 1 },
  // 健康/身体
  { keywords: ['身体', '健康', '锻炼', '运动', '跑步', '睡眠', '休息'], tag: '健康', weight: 1 },
  // 习惯
  { keywords: ['习惯', '坚持', '自律', '养成', '每天'], tag: '习惯', weight: 1 },
]

/**
 * 分析内容，生成标签建议
 * @param {string} content
 * @returns {string[]} 建议的标签数组（不含 # 前缀）
 */
export const suggestTags = (content) => {
  if (!content || !content.trim()) return []

  const suggested = new Set()
  const lowerContent = content.toLowerCase()

  for (const rule of AUTO_TAG_RULES) {
    let matched = false

    if (rule.matchMode === 'content') {
      // 匹配内容本身（区分大小写等）
      matched = rule.keywords.some(kw => content.includes(kw))
    } else {
      // 匹配小写内容
      matched = rule.keywords.some(kw => lowerContent.includes(kw.toLowerCase()))
    }

    if (matched) {
      // 避免重复标签（多个规则可能匹配同一标签）
      suggested.add(rule.tag)
    }
  }

  return Array.from(suggested)
}

/**
 * 检查是否已有某标签（防止重复建议）
 * @param {string} content
 * @param {string} tag
 */
const hasExistingTag = (content, tag) => {
  return content.includes(`#${tag}`)
}

/**
 * 获取过滤后的建议（排除已有标签）
 * @param {string} content
 * @returns {string[]}
 */
export const getFilteredSuggestions = (content) => {
  const suggestions = suggestTags(content)
  return suggestions.filter(tag => !hasExistingTag(content, tag))
}