import { describe, it, expect } from 'vitest'
import { computeWorldLayout, contentBBox, collectPlacements, type Measurer } from './layout.ts'
import { embeddedLayout } from './content-geometry.ts'
import { createNode, type MindMap, type NodeData } from './model.ts'
import { validTree } from './docs.ts'
import { createPortable, readPortable } from './vault-format.ts'

const measure: Measurer = (_text, _depth, style) => ({ w: 150, h: (style?.lineH ?? 27) * 2 })
const image = { id: 'photo', kind: 'image' as const, seed: 1, x: 0, y: 0, w: 220, h: 220, src: 'data:image/png;base64,iVBORw0KGgo=' }
const journal = (): NodeData => ({ ...createNode('周五 · 轻松一锅'), structure: 'journal', style: { width: 530, shape: 'none', backdrop: 'brush' }, contents: [image], children: [createNode('早餐'), createNode('午餐'), createNode('晚餐')] })

describe('手帐图文与节点旁装饰', () => {
  it('标题不被图片撑成卡片，图片在标题下方且与三餐分列', () => {
    const day = journal(), map: MindMap = { root: day }
    const layout = computeWorldLayout(map, measure), title = layout.root, picture = title.contentBoxes![0].box
    expect(title.h).toBeLessThan(picture.h)
    expect(picture.y).toBeGreaterThan(title.y + title.h)
    for (const n of layout.nodes.slice(1)) expect(n.x).toBeGreaterThan(picture.x + picture.w)
    expect(layout.links).toHaveLength(3)
    expect(layout.links.every(l => l.hidden)).toBe(true)
    expect(collectPlacements(day, 'right').get(day.children[0].id)?.place).toBe('right')
  })
  it.each(['left', 'right'] as const)('平衡导图 %s 侧的手帐图文完整预留高度，展开后也不覆盖下一天', side => {
    const first = journal(), second = journal(); first.sideOverride = second.sideOverride = side
    second.contents = [{ ...image, id: 'second-photo' }]
    first.children[0].children = Array.from({ length: 7 }, () => createNode('食材或步骤'))
    const map: MindMap = { root: { ...createNode('一周'), structure: 'map', children: [first, second] } }
    const layout = computeWorldLayout(map, measure)
    const firstNodes = layout.nodes.filter(n => n.branchIndex === 0)
    const bounds = contentBBox(firstNodes, { root: first })
    const nextTitle = layout.nodes.find(n => n.id === second.id)!
    expect(bounds.maxY).toBeLessThan(nextTitle.y)
  })
  it('装饰不会撑大标题，负偏移纳入导出范围，序列化保留装饰与底色', async () => {
    const day = journal(); day.contents!.push({ ...image, id: 'flower', placement: 'overlay', x: -100, y: -90, w: 80, h: 80 })
    const parts = embeddedLayout(day, { w: 530, h: 60 })
    expect(parts.size).toEqual({ w: 530, h: 60 })
    const map: MindMap = { root: day }, layout = computeWorldLayout(map, measure)
    expect(contentBBox(layout.nodes, map).minX).toBe(layout.root.x - 100)
    expect(contentBBox(layout.nodes, map).minY).toBe(layout.root.y - 90)
    const bytes = await createPortable(map, '手帐', async () => new Uint8Array([137,80,78,71,13,10,26,10]))
    const loaded = await readPortable(bytes)
    expect(loaded.tree.root.contents![1]).toMatchObject({ placement: 'overlay', x: -100, y: -90 })
    expect(loaded.tree.root.style?.backdrop).toBe('brush')
    expect(validTree(map)).toBe(true)
    Object.assign(day.contents![1], { placement: 'garbage' })
    expect(validTree(map)).toBe(false)
  })
})

it('手帐左侧曲线绕开三餐正文，根部按上下方向分开连接', async () => {
  const { linkSamples } = await import('./strokes.ts')
  const first = journal(), last = journal()
  first.sideOverride = last.sideOverride = 'left'
  first.style!.width = last.style!.width = 280
  last.contents = [{ ...image, id: 'last-photo' }]
  const map: MindMap = { visualStyle: 'clear', root: { ...createNode('一周'), style: { shape: 'none', backdrop: 'paper', width: 500 }, structure: 'map', children: [first, last] } }
  const layout = computeWorldLayout(map, measure)
  for (const link of layout.links.filter(l => !l.hidden)) for (const point of linkSamples(link, 'curve')) {
    for (const meal of layout.nodes.filter(n => n.depth === 2)) {
      expect(point.x > meal.x && point.x < meal.x + meal.w && point.y > meal.y && point.y < meal.y + meal.h).toBe(false)
    }
  }
  const visible = layout.links.filter(l => !l.hidden)
  expect(visible[0].y1).not.toBe(visible[1].y1)
})

it('文档默认手帐与节点显式手帐布局一致，不修改原数据', () => {
  const root = journal(), explicit = computeWorldLayout({ root }, measure)
  delete root.structure
  const inherited = computeWorldLayout({ root, layoutMode: 'journal' }, measure)
  expect(inherited.nodes.map(({ x, y, w, h }) => ({ x, y, w, h }))).toEqual(explicit.nodes.map(({ x, y, w, h }) => ({ x, y, w, h })))
  expect(root.structure).toBeUndefined()
})
