import { describe, expect, it } from 'vitest'
import { computeLayout, EDGE_MARGIN, FIRST_GAP_X, GAP_X, type Measurer } from './layout.ts'
import type { MindMap, NodeData } from './model.ts'

const measure: Measurer = (text) => ({ w: text.length * 12, h: 20 })
const node = (id: string, children: NodeData[] = [], extra: Partial<NodeData> = {}): NodeData =>
  ({ id, text: id, seed: 1, children, ...extra })

describe('默认视觉精修布局回归', () => {
  it.each(['orgUp', 'orgDown', 'treeLeft', 'treeRight', 'fishLeft', 'fishRight'] as const)('%s：长短节点的多层树不重叠', (layoutMode) => {
    const root = node('root', Array.from({ length: 4 }, (_, i) => node(`b${i}`, [
      node(`leaf${i}`, [], { style: { width: i % 2 ? 220 : 80 } }), node(`short${i}`),
    ])))
    const layout = computeLayout({ root, layoutMode }, 2400, 1000, measure)
    for (let i = 0; i < layout.nodes.length; i++) {
      for (const b of layout.nodes.slice(i + 1)) {
        const a = layout.nodes[i]
        expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h, `${a.id}/${b.id}`).toBe(false)
      }
    }
  })
  it.each(['orgUp', 'orgDown'] as const)('%s 混排方向分支：子树与相邻兄弟不重叠', (layoutMode) => {
    for (const structure of ['left', 'right', 'map'] as const) {
      const root = node('r', [node('a', [node('c'), node('d')], { structure }), node('b')])
      const layout = computeLayout({ root, layoutMode }, 1200, 800, measure)
      for (let i = 0; i < layout.nodes.length; i++) {
        for (const b of layout.nodes.slice(i + 1)) {
          const a = layout.nodes[i]
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
          expect(overlap, `${structure}: ${a.id}/${b.id}`).toBe(false)
        }
      }
    }
  })
  it.each(['left', 'right', 'map'] as const)('%s：长短分支按父盒缘排布，左向节点不侵入父节点', (layoutMode) => {
    const root = node('root', [
      node('wide', [node('leaf', [], { style: { width: 300 } })], { style: { width: 420 }, sideOverride: 'left' }),
      node('short', [node('short-leaf')], { sideOverride: 'right' }),
    ])
    const layout = computeLayout({ root, layoutMode }, 2400, 800, measure)
    for (const link of layout.links) {
      const parent = layout.nodes.find(n => n.id === link.from)!
      const child = layout.nodes.find(n => n.id === link.to)!
      const gap = child.side === 'left' ? parent.x - child.x - child.w : child.x - parent.x - parent.w
      expect(gap, `${parent.id} → ${child.id}`).toBeCloseTo(parent.depth === 0 ? FIRST_GAP_X : GAP_X)
    }
  })

  it.each(['left', 'right'] as const)('%s：放得下的单侧树保留视口留边', (layoutMode) => {
    const root = node('root', [node('a', [node('b', [], { style: { width: 80 } })], { style: { width: 180 } })])
    const layout = computeLayout({ root, layoutMode }, 780, 500, measure)
    expect(Math.min(...layout.nodes.map(n => n.x))).toBeGreaterThanOrEqual(EDGE_MARGIN - 1e-6)
    expect(Math.max(...layout.nodes.map(n => n.x + n.w))).toBeLessThanOrEqual(780 - EDGE_MARGIN + 1e-6)
  })

  it('不对称平衡树按两侧真实范围让位，不因共享最大宽度导致可见内容溢出', () => {
    const root = node('root', [
      node('wide', [], { style: { width: 420 }, sideOverride: 'right' }),
      node('small', [], { style: { width: 60 }, sideOverride: 'left' }),
    ])
    const layout = computeLayout({ root, layoutMode: 'map' }, 1100, 500, measure)
    expect(Math.min(...layout.nodes.map(n => n.x))).toBeGreaterThanOrEqual(EDGE_MARGIN - 1e-6)
    expect(Math.max(...layout.nodes.map(n => n.x + n.w))).toBeLessThanOrEqual(1100 - EDGE_MARGIN + 1e-6)
  })

  it('压缩布局不修改内容、显式样式或游离节点与独立主题锚点', () => {
    const map: MindMap = {
      root: node('root', [node('a', [node('b')])]),
      floating: [{ node: node('floating', [node('f-child')], { structure: 'left' }), x: 110, y: 210 }],
      topics: [{ node: node('topic', [node('t-child')], { structure: 'left', style: { width: 180 } }), x: 410, y: 510 }],
    }
    const before = structuredClone(map)
    const layout = computeLayout(map, 780, 500, measure)
    expect(map).toEqual(before)
    for (const [id, x, y] of [['floating', 110, 210], ['topic', 410, 510]] as const) {
      expect(layout.nodes.find(n => n.id === id)).toMatchObject({ x, y })
    }
  })
})
