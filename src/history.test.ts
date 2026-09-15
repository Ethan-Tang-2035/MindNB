import { describe, it, expect } from 'vitest'
import { SnapshotHistory } from './history.ts'

describe('快照栈', () => {
  it('record → undo/redo 往返恢复', () => {
    const h = new SnapshotHistory<string>()
    h.record('v1')
    h.record('v2')
    expect(h.undo('v3')).toBe('v2')
    expect(h.undo('v2')).toBe('v1')
    expect(h.canUndo).toBe(false)
    expect(h.undo('v1')).toBeNull()
    expect(h.redo('v1')).toBe('v2')
    expect(h.redo('v2')).toBe('v3')
    expect(h.canRedo).toBe(false)
    expect(h.redo('v3')).toBeNull()
  })

  it('新变更清空重做侧', () => {
    const h = new SnapshotHistory<string>()
    h.record('a') // 变更 1 前，状态 a
    h.record('b') // 变更 2 前，状态 b
    expect(h.undo('c')).toBe('b') // 从 c 撤销回 b
    h.record('b') // 分叉：变更 3 前，当前状态 b；重做侧应被清空
    expect(h.canRedo).toBe(false)
    expect(h.undo('d')).toBe('b') // 再撤销仍回到 b
  })

  it('超过上限丢弃最旧', () => {
    const h = new SnapshotHistory<number>(3)
    h.record(1)
    h.record(2)
    h.record(3)
    h.record(4)
    expect(h.undo(5)).toBe(4)
    expect(h.undo(4)).toBe(3)
    expect(h.undo(3)).toBe(2)
    expect(h.undo(2)).toBeNull() // 1 已被丢弃
  })
})
