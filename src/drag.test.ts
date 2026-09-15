import { describe, it, expect } from 'vitest'
import { computeDropHint, subtreeMemberIds, nearestMagnetTarget, landingBox } from './drag.ts'
import type { Layout } from './layout.ts'
import { computeLayout, type Measurer } from './layout.ts'
import { moveSubtree, attachFloating, type MindMap } from './model.ts'

/** 假测量器：宽度 = 字数 × 12，高按层级（与 layout.test.ts 同規格） */
const fakeMeasure: Measurer = (text, depth) => ({ w: text.length * 12, h: depth === 0 ? 48 : depth === 1 ? 20 : 16 })

const node = (id: string, children: MindMap['root']['children'] = []) => ({ id, text: id, seed: 1, children })

/** 右侧逻辑图：root → A(a1,a2)、B(b1)、C */
const map: MindMap = {
  layoutMode: 'right',
  root: {
    id: 'root',
    text: '中心主题',
    seed: 1,
    children: [node('A', [node('a1'), node('a2')]), node('B', [node('b1')]), node('C')],
  },
}
const layout = computeLayout(map, 1200, 800, fakeMeasure)
const laid = new Map(layout.nodes.map((n) => [n.id, n]))
/** 节点中心（画布坐标） */
const center = (id: string) => {
  const n = laid.get(id)!
  return { x: n.x + n.w / 2, y: n.y + n.h / 2 }
}

describe('拖动落点判定（computeDropHint）', () => {
  it('落在节点包围盒内 = 挂为其子节点', () => {
    expect(computeDropHint(map, layout, 'A', center('B'))).toEqual({ kind: 'child', id: 'B' })
    expect(computeDropHint(map, layout, 'a1', center('A'))).toEqual({ kind: 'child', id: 'A' })
    // 中心主题可作目标
    expect(computeDropHint(map, layout, 'b1', center('root'))).toEqual({ kind: 'child', id: 'root' })
  })

  it('拖到自身或自身后代上无效（落点为空）', () => {
    expect(computeDropHint(map, layout, 'A', center('A'))).toBeNull() // 自身包围盒
    expect(computeDropHint(map, layout, 'A', center('a2'))).toBeNull() // 后代包围盒
  })

  it('落在兄弟间空隙 = 插入该位置（锚为段内第一个非成员）', () => {
    const a = laid.get('A')!
    const a2 = laid.get('a2')!
    // A 下缘外 4px（GAP_Y=14 空隙上半部）：空隙整段属于「A 之后」→ 锚为 B、插在 B 前
    const gap = { x: a.x + 10, y: a.y + a.h + 4 }
    const hint = computeDropHint(map, layout, 'C', gap)
    expect(hint).toMatchObject({ kind: 'sibling', anchorId: 'B', before: true })
    // 深层兄弟间：a1 与 a2 的空隙，拖 b1 进去
    const deepGap = { x: a2.x + 10, y: laid.get('a1')!.y + laid.get('a1')!.h + 4 }
    expect(computeDropHint(map, layout, 'b1', deepGap)).toMatchObject({ kind: 'sibling', anchorId: 'a2', before: true })
  })

  it('拖自身时落在自己旧位旁边的空隙：锚解析跳过被拖节点自身', () => {
    // 拖 B，落在 A|B 空隙（B 旧位之上）：段内第一个非成员从 B 往下找 → C，插在 C 前
    // （摘除 B 后插在 C 前 = 回到原位，moveSubtree 判为无变更）
    const a = laid.get('A')!
    const hint = computeDropHint(map, layout, 'B', { x: a.x + 10, y: a.y + a.h + 4 })
    expect(hint).toMatchObject({ kind: 'sibling', anchorId: 'C', before: true })
  })

  it('空白处落点为空（不产生变更）', () => {
    expect(computeDropHint(map, layout, 'A', { x: 1100, y: 40 })).toBeNull()
  })

  it('subtreeMemberIds：含自身与全部后代', () => {
    expect([...subtreeMemberIds(map, 'A')].sort()).toEqual(['A', 'a1', 'a2']) // hmm sort: A < a1? 'A'<'a1' ascii yes
    expect([...subtreeMemberIds(map, 'C')]).toEqual(['C'])
  })
})

// ---- 磁吸（v6，词汇见 CONTEXT.md「磁吸」） ----

describe('nearestMagnetTarget', () => {
  const mkLayout = (boxes: Array<[number, number, number, number]>): Layout =>
    ({ nodes: boxes.map(([x, y, w, h], i) => ({ id: 'n' + i, node: { id: 'n' + i, text: '', seed: 1, children: [] }, depth: 1, side: 'right', x, y, w, h, branchIndex: 0 })), links: [], root: null as never })

  it('半径内取最近；半径外不命中；成员排除', () => {
    const layout = mkLayout([[0, 0, 40, 20], [200, 0, 40, 20]])
    const view = { tx: 0, ty: 0, k: 1 }
    expect(nearestMagnetTarget(layout, new Set(), { x: -30, y: 0, w: 20, h: 20 }, view)).toBe('n0') // 左缘外 10
    expect(nearestMagnetTarget(layout, new Set(), { x: 230, y: 0, w: 20, h: 20 }, view)).toBe('n1')
    // 两盒间隙 60 > 48（ghost 100..120，距 n0 右缘 60、距 n1 左缘 80）
    expect(nearestMagnetTarget(layout, new Set(), { x: 100, y: 10, w: 20, h: 20 }, view)).toBeNull()
    expect(nearestMagnetTarget(layout, new Set(['n0']), { x: -30, y: 0, w: 20, h: 20 }, view)).toBeNull()
  })

  it('按两盒边缘距离判定（XMind 同款）：A 盒缘贴 B 盒缘即吸，与光标位置无关', () => {
    const layout = mkLayout([[0, 0, 300, 60]])
    const view = { tx: 0, ty: 0, k: 1 }
    // ghost 盒在 B 右缘外 15px、纵向重叠 → 边缘间隙 15
    expect(nearestMagnetTarget(layout, new Set(), { x: 315, y: 10, w: 40, h: 20 }, view)).toBe('n0')
    // 盒缘间隙 49：不命中
    expect(nearestMagnetTarget(layout, new Set(), { x: 349, y: 10, w: 40, h: 20 }, view)).toBeNull()
    // 两盒重叠：间隙为 0
    expect(nearestMagnetTarget(layout, new Set(), { x: 100, y: 10, w: 40, h: 20 }, view)).toBe('n0')
  })

  it('角对角按欧氏距离；纵向堆叠的上下贴边同样命中', () => {
    const layout = mkLayout([[0, 0, 300, 60]])
    const view = { tx: 0, ty: 0, k: 1 }
    expect(nearestMagnetTarget(layout, new Set(), { x: 330, y: 80, w: 40, h: 20 }, view)).toBe('n0') // dx30 dy20 → 36
    expect(nearestMagnetTarget(layout, new Set(), { x: 360, y: 110, w: 40, h: 20 }, view)).toBeNull() // dx60 dy50 → 78
    // B 正下方 20px：纵向贴边
    expect(nearestMagnetTarget(layout, new Set(), { x: 0, y: 80, w: 40, h: 20 }, view)).toBe('n0')
  })

  it('ghost 与 B 横向重叠时纵向贴边命中（点语义会误判为远）', () => {
    const layout = mkLayout([[0, 0, 300, 60]])
    const view = { tx: 0, ty: 0, k: 1 }
    // ghost 左半在 B 正下方、横向范围重叠：盒缘间隙只剩纵向 10px → 命中；
    // 若退化为 ghost 左上角点语义，角距 100px → 漏判（用户报告的「纵向靠近不吸」）
    expect(nearestMagnetTarget(layout, new Set(), { x: -100, y: 70, w: 300, h: 30 }, view)).toBe('n0')
  })

  it('半径内取最近；成员排除', () => {
    const layout = mkLayout([[0, 0, 40, 20], [200, 0, 40, 20]])
    const view = { tx: 0, ty: 0, k: 1 }
    expect(nearestMagnetTarget(layout, new Set(), { x: -30, y: 0, w: 20, h: 20 }, view)).toBe('n0') // 左缘外 10
    expect(nearestMagnetTarget(layout, new Set(), { x: 230, y: 0, w: 20, h: 20 }, view)).toBe('n1')
    expect(nearestMagnetTarget(layout, new Set(['n0']), { x: -30, y: 0, w: 20, h: 20 }, view)).toBeNull()
  })

  it('缩放下按屏幕像素判定：k=2 时候选盒屏幕矩形翻倍，ghost 已是屏幕坐标', () => {
    const layout = mkLayout([[0, 0, 40, 20]]) // 屏幕矩形 [0,0,80,40]
    expect(nearestMagnetTarget(layout, new Set(), { x: 90, y: 10, w: 20, h: 20 }, { tx: 0, ty: 0, k: 2 })).toBe('n0') // 缘外 10
    expect(nearestMagnetTarget(layout, new Set(), { x: 130, y: 10, w: 20, h: 20 }, { tx: 0, ty: 0, k: 2 })).toBeNull() // 缘外 50
  })
})

// ---- 落点占位符（dry-run 预演，词汇见 CONTEXT.md「磁吸」） ----

describe('landingBox', () => {
  it('child 预示：返回松手后真实布局盒（与 dry-run 布局全等）', () => {
    const next = moveSubtree(map, 'C', { kind: 'child', id: 'A' })
    const c = computeLayout(next, 1200, 800, fakeMeasure).nodes.find((n) => n.id === 'C')!
    expect(landingBox(map, 'C', { kind: 'child', id: 'A' }, fakeMeasure, 1200, 800)).toEqual({
      x: c.x,
      y: c.y,
      w: c.w,
      h: c.h,
    })
  })

  it('浮动头 child 预示：走 attachFloating（丢弃坐标、展开折叠目标）', () => {
    const fmap: MindMap = { ...map, floating: [{ x: 900, y: 700, node: node('F') }] }
    const next = attachFloating(fmap, 'F', 'B')
    const f = computeLayout(next, 1200, 800, fakeMeasure).nodes.find((n) => n.id === 'F')!
    expect(landingBox(fmap, 'F', { kind: 'child', id: 'B' }, fakeMeasure, 1200, 800)).toEqual({
      x: f.x,
      y: f.y,
      w: f.w,
      h: f.h,
    })
  })

  it('sibling 预示：返回插入后真实布局盒', () => {
    const next = moveSubtree(map, 'C', { kind: 'sibling', id: 'A', before: true })
    const c = computeLayout(next, 1200, 800, fakeMeasure).nodes.find((n) => n.id === 'C')!
    expect(landingBox(map, 'C', { kind: 'sibling', anchorId: 'A', before: true, x1: 0, x2: 0, y: 0 }, fakeMeasure, 1200, 800)).toEqual({
      x: c.x,
      y: c.y,
      w: c.w,
      h: c.h,
    })
  })

  it('原位（dry-run 无变更）返回 null：不画占位符', () => {
    // 拖 B 插到 C 前半段锚解析后 = 回原位，moveSubtree 返回原引用
    expect(landingBox(map, 'B', { kind: 'sibling', anchorId: 'C', before: true, x1: 0, x2: 0, y: 0 }, fakeMeasure, 1200, 800)).toBeNull()
  })
})
