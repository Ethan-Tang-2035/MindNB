import { describe, it, expect } from 'vitest'
import { wrapLines } from './wrap.ts'

// 假宽度：每字符 10px，空格也是 10px
const w10 = (s: string) => s.length * 10

describe('文字折行', () => {
  it('不超宽的单行原样返回', () => {
    expect(wrapLines('短句', 220, w10)).toEqual(['短句'])
  })

  it('显式换行优先，保留为多行', () => {
    expect(wrapLines('第一行\n第二行', 220, w10)).toEqual(['第一行', '第二行'])
  })

  it('CJK 超宽逐字断行', () => {
    const lines = wrapLines('一二三四五六七八九十一二三四五六七八九', 100, w10) // 每行最多 10 字
    expect(lines).toEqual(['一二三四五六七八九十', '一二三四五六七八九'])
  })

  it('ASCII 优先在空格处断行', () => {
    const lines = wrapLines('aa bb cc dd ee ff gg hh', 100, w10) // 每行容纳 10 字符，含空格
    expect(lines).toEqual(['aa bb cc', 'dd ee ff', 'gg hh'])
  })

  it('超长单词强制断行（URL 不撑破盒子）', () => {
    const lines = wrapLines('aaaaaaaaaaaaaaaaaaaa', 100, w10)
    expect(lines).toEqual(['aaaaaaaaaa', 'aaaaaaaaaa'])
  })

  it('空串返回单空行', () => {
    expect(wrapLines('', 100, w10)).toEqual([''])
  })
})

it('空格恰好超宽时继续折行，不丢失后续文字或添加空行', () => {
  expect(wrapLines('abcdefghij delivery complete', 100, w10)).toEqual(['abcdefghij', 'delivery', 'complete'])
  expect(wrapLines('abcdefghij ', 100, w10)).toEqual(['abcdefghij'])
})
