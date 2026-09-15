import { describe, it, expect } from 'vitest'
import { selectionAfterToggle, marqueeHits, selectionAfterMarquee, uniformOf, strictUniform, nextBadge } from './selection.ts'

const nodes = [
  { id: 'a', x: 0, y: 0, w: 100, h: 40 },
  { id: 'b', x: 200, y: 0, w: 100, h: 40 },
  { id: 'c', x: 400, y: 100, w: 100, h: 40 },
]

describe('选区状态机（v7 多选）', () => {
  it('selectionAfterToggle 加入/移除，主选中顺延', () => {
    expect(selectionAfterToggle({ ids: [], primary: null }, 'a')).toEqual({ ids: ['a'], primary: 'a' })
    expect(selectionAfterToggle({ ids: ['a', 'b'], primary: 'b' }, 'a')).toEqual({ ids: ['b'], primary: 'b' })
    expect(selectionAfterToggle({ ids: ['a', 'b'], primary: 'b' }, 'b')).toEqual({ ids: ['a'], primary: 'a' })
    expect(selectionAfterToggle({ ids: ['a'], primary: 'a' }, 'a')).toEqual({ ids: [], primary: null })
  })

  it('marqueeHits 相交判定（非包含）：负宽高归一、边缘贴合不算、层序保持', () => {
    expect(marqueeHits(nodes, { x: 50, y: 10, w: 200, h: 20 })).toEqual(['a', 'b'])
    expect(marqueeHits(nodes, { x: 100, y: 0, w: 100, h: 40 })).toEqual([]) // 仅贴 a 右缘与 b 左缘，零面积接触不算
    expect(marqueeHits(nodes, { x: 150, y: 0, w: 60, h: 40 })).toEqual(['b']) // 有实际重叠才算
    expect(marqueeHits(nodes, { x: 250, y: 10, w: -100, h: 20 })).toEqual(['b']) // 负宽归一 → 150..250 仅与 b 相交
    expect(marqueeHits(nodes, { x: 500, y: 200, w: 10, h: 10 })).toEqual([])
    expect(marqueeHits(nodes, { x: -50, y: -50, w: 1000, h: 1000 })).toEqual(['a', 'b', 'c'])
  })

  it('selectionAfterMarquee 替换/追加；追加空命中主选中不变', () => {
    expect(selectionAfterMarquee({ ids: ['a'], primary: 'a' }, ['b', 'c'], false)).toEqual({ ids: ['b', 'c'], primary: 'c' })
    expect(selectionAfterMarquee({ ids: ['a'], primary: 'a' }, [], false)).toEqual({ ids: [], primary: null })
    const added = selectionAfterMarquee({ ids: ['a'], primary: 'a' }, ['b', 'c'], true)
    expect(added).toEqual({ ids: ['a', 'b', 'c'], primary: 'c' }) // 追加 + 主选中=最后命中
    expect(selectionAfterMarquee({ ids: ['a', 'b'], primary: 'b' }, ['b'], true)).toEqual({ ids: ['a', 'b'], primary: 'b' }) // 去重
    expect(selectionAfterMarquee({ ids: ['a', 'b'], primary: 'b' }, [], true)).toEqual({ ids: ['a', 'b'], primary: 'b' })
  })

  it('uniformOf 全体同值/全体未定义/混合', () => {
    expect(uniformOf([undefined, undefined])).toBeNull()
    expect(uniformOf([])).toBeNull()
    expect(uniformOf(['a', undefined, 'a'])).toBe('a')
    expect(uniformOf(['a', 'b'])).toBe('mixed')
    expect(uniformOf([true, true])).toBe(true)
    expect(uniformOf([true, false])).toBe('mixed')
  })
})

describe('strictUniform（严格一致：undefined 不跳过）', () => {
  it('全体同值/全体未设/部分覆盖即为混合', () => {
    expect(strictUniform(['l', 'l'])).toBe('l')
    expect(strictUniform([undefined, undefined])).toBeUndefined()
    expect(strictUniform([])).toBeUndefined()
    expect(strictUniform(['l', undefined])).toBe('mixed')
    expect(strictUniform(['l', 'm'])).toBe('mixed')
    expect(strictUniform([true, true])).toBe(true)
    expect(strictUniform([true, undefined])).toBe('mixed')
  })
})

describe('nextBadge 循环（评审 Spec-④ 修复：混合态不得产出 NaN）', () => {
  it('无→①→…→⑦→无；混合态/坏值从①起算', () => {
    expect(nextBadge(undefined)).toBe('1')
    expect(nextBadge('1')).toBe('2')
    expect(nextBadge('6')).toBe('7')
    expect(nextBadge('7')).toBeNull()
    expect(nextBadge('mixed')).toBe('1')
    expect(nextBadge('bogus')).toBe('1')
  })
})
