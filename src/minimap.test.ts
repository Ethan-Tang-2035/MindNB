import { computeLayout } from './layout.ts'
import { createNode, type MindMap } from './model.ts'
import { describe, it, expect } from 'vitest'
import { minimapTransform, viewportRect, minimapContentBoxes } from './minimap.ts'

describe('navigation minimap', () => {
  it('inverts pan and zoom to the actual viewport', () => {
    expect(viewportRect({ tx: 100, ty: -60, k: 2 }, 800, 600)).toEqual({ x: -50, y: 30, w: 400, h: 300 })
  })
  it('keeps far content and a lost viewport within the miniature', () => {
    const boxes = [{ x: -20000, y: 10000, w: 50, h: 70 }, { x: 40000, y: -9000, w: 900, h: 400 }]
    const viewport = { x: 8000, y: 8000, w: 1200, h: 800 }
    const t = minimapTransform(boxes, viewport)
    for (const b of [...boxes, viewport]) {
      expect(b.x * t.k + t.tx).toBeGreaterThanOrEqual(7.99)
      expect((b.x + b.w) * t.k + t.tx).toBeLessThanOrEqual(192.01)
      expect(b.y * t.k + t.ty).toBeGreaterThanOrEqual(7.99)
      expect((b.y + b.h) * t.k + t.ty).toBeLessThanOrEqual(112.01)
    }
  })
  it('handles empty and zero-size content without invalid scales', () => {
    const t = minimapTransform([], { x: 0, y: 0, w: 0, h: 0 })
    expect(Number.isFinite(t.k) && t.k > 0).toBe(true)
  })
})

it('includes anchored annotations and remote edge controls in minimap bounds', () => {
  const root = createNode('根'); root.children = [createNode('甲'), createNode('乙')]
  const map: MindMap = { root, objects: [
    { id: 'summary', kind: 'summary', seed: 1, anchor: { parentId: root.id, start: 0, count: 2 }, text: '概要内容' },
    { id: 'edge', kind: 'edge', seed: 2, from: root.children[0].id, to: root.children[1].id, control: { x: 10000, y: 10000 } },
  ] }
  const layout = computeLayout(map, 800, 600, () => ({ w: 80, h: 30 }))
  const boxes = minimapContentBoxes(layout, map)
  expect(boxes.length).toBe(layout.nodes.length + 2)
  expect(Math.max(...boxes.map(b => b.x + b.w))).toBeGreaterThanOrEqual(10000)
})
