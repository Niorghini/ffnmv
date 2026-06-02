/**
 * tags 工具测试
 */
import { describe, it, expect } from 'vitest'
import { parseTags, stripTagHash, extractTagNames, suggestAutoTags, colorFromName } from '@/lib/tags'

describe('parseTags', () => {
  it('提取 #tag，去重', () => {
    expect(parseTags('hello #foo world #bar #foo')).toEqual(['foo', 'bar'])
  })
  it('中文标签', () => {
    expect(parseTags('今天 #学习 了 React')).toEqual(['学习'])
  })
  it('无标签返回空', () => {
    expect(parseTags('hello world')).toEqual([])
  })
  it('空字符串安全', () => {
    expect(parseTags('')).toEqual([])
    expect(parseTags(null)).toEqual([])
  })
})

describe('stripTagHash', () => {
  it('去掉前导 #', () => {
    expect(stripTagHash('#foo')).toBe('foo')
    expect(stripTagHash('foo')).toBe('foo')
  })
})

describe('extractTagNames', () => {
  it('去 # 且去重', () => {
    expect(extractTagNames('#foo #bar #foo')).toEqual(['foo', 'bar'])
  })
})

describe('suggestAutoTags', () => {
  it('匹配"待办"关键词 → 标签"待办"', () => {
    expect(suggestAutoTags('明天要做的事')).toContain('待办')
  })
  it('匹配 http 链接', () => {
    expect(suggestAutoTags('看 https://example.com')).toContain('链接')
  })
  it('无匹配返回空', () => {
    expect(suggestAutoTags('hello world')).toEqual([])
  })
})

describe('colorFromName', () => {
  it('同名同色', () => {
    expect(colorFromName('foo')).toBe(colorFromName('foo'))
  })
  it('不同名大概率异色', () => {
    expect(colorFromName('alpha')).not.toBe(colorFromName('zulu'))
  })
  it('输出 hsl(...)', () => {
    expect(colorFromName('x')).toMatch(/^hsl\(/)
  })
})
