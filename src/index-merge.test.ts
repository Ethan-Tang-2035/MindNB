import { describe, it, expect } from 'vitest'
import { mergeIndex, TOMBSTONE_RETENTION_MS } from './index-merge.ts'
import type { DocMeta } from './docs.ts'

const DAY = 24 * 60 * 60_000

/** 造条目：只关心 id/updatedAt/deletedAt，其余字段占位 */
function meta(id: string, updatedAt: number, extra: Partial<DocMeta> = {}): DocMeta {
  return { id, createdAt: 0, updatedAt, nameOverride: null, ...extra }
}
const tomb = (id: string, deletedAt: number): DocMeta => meta(id, deletedAt, { deletedAt })

describe('mergeIndex：较新者胜', () => {
  it('双向比较：base 较新保 base，incoming 较新保 incoming', () => {
    const base = [meta('a', 100), meta('b', 50)]
    const incoming = [meta('a', 80), meta('b', 70)]
    const merged = mergeIndex(base, incoming)
    expect(merged.find((m) => m.id === 'a')!.updatedAt).toBe(100)
    expect(merged.find((m) => m.id === 'b')!.updatedAt).toBe(70)
  })

  it('平手保 base 方', () => {
    const base = [meta('a', 100, { nameOverride: 'base名' })]
    const incoming = [meta('a', 100, { nameOverride: 'incoming名' })]
    expect(mergeIndex(base, incoming)[0].nameOverride).toBe('base名')
  })

  it('incoming 新条目插最前（保持其相对顺序），base 已有 id 位次不变', () => {
    const base = [meta('a', 1), meta('b', 2), meta('c', 3)]
    const incoming = [meta('d', 9), meta('b', 50), meta('e', 8)]
    expect(mergeIndex(base, incoming).map((m) => m.id)).toEqual(['d', 'e', 'a', 'b', 'c'])
  })
})

describe('mergeIndex：墓碑参与比较', () => {
  it('较新墓碑覆盖活条目（删除向所有设备传播）', () => {
    const merged = mergeIndex([meta('a', 100)], [tomb('a', 200)])
    expect(merged[0].deletedAt).toBe(200)
  })

  it('较新活条目覆盖墓碑（force 复活路径）', () => {
    const merged = mergeIndex([tomb('a', 100)], [meta('a', 200)])
    expect(merged[0].deletedAt).toBeUndefined()
    expect(merged[0].updatedAt).toBe(200)
  })

  it('旧索引缺 deletedAt 字段：视为未删除，照常比较与保留', () => {
    const legacy = JSON.parse(JSON.stringify([meta('a', 100)])) as DocMeta[] // 无 deletedAt 键
    const merged = mergeIndex(legacy, [])
    expect(merged).toHaveLength(1)
    expect('deletedAt' in merged[0]).toBe(false)
  })
})

describe('mergeIndex：30 天墓碑清理（服务端场景）', () => {
  const now = 100 * DAY
  it('传 now：超期墓碑彻底移除，临期墓碑保留，活条目不受影响', () => {
    const base = [tomb('old', now - TOMBSTONE_RETENTION_MS - 1), tomb('fresh', now - TOMBSTONE_RETENTION_MS), meta('live', 1)]
    const merged = mergeIndex(base, [], { now })
    expect(merged.map((m) => m.id)).toEqual(['fresh', 'live']) // 恰满 30 天 = 未超期，保留
  })

  it('不传 now（客户端场景）：超期墓碑原样保留', () => {
    const base = [tomb('old', now - TOMBSTONE_RETENTION_MS - DAY)]
    expect(mergeIndex(base, []).map((m) => m.id)).toEqual(['old'])
  })
})

describe('mergeIndex：纯函数', () => {
  it('不修改入参数组与条目', () => {
    const base = [meta('a', 1)]
    const incoming = [meta('a', 2), meta('b', 3)]
    const baseSnap = JSON.parse(JSON.stringify(base))
    const incomingSnap = JSON.parse(JSON.stringify(incoming))
    mergeIndex(base, incoming)
    expect(base).toEqual(baseSnap)
    expect(incoming).toEqual(incomingSnap)
  })
})
