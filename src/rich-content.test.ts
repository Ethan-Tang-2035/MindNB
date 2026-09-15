import { validTree } from './docs.ts'
import { copyNode } from './topics.ts'
import { describe, it, expect } from 'vitest'
import { createTable, createCycle, createFlow, createTimeline, createPyramid, createCircleMap, createGlossaryTable, insertContent, findContent } from './content.ts'
import { createNode, type MindMap } from './model.ts'
import { computeLayout } from './layout.ts'
import { embeddedLayout } from './content-geometry.ts'
import { contentPrimitives } from './content-render.ts'
import { editTableDimension, parseGrid, pasteGrid } from './tables.ts'
import { makeInk, hitsStroke, erasesStroke, inkIntersects, embedInk, worldStroke } from './ink.ts'
import { SnapshotHistory } from './history.ts'
import type { InkStroke } from './objects.ts'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { STICKERS } from './stickers.ts'

describe('table editing', () => {
  it('preserves empty columns, quoted line breaks and escaped quotes from Excel', () => {
    expect(parseGrid('名称\t备注\t\r\nA\t"多行\n\"\"引号\"\""\t末尾\r\n')).toEqual([['名称', '备注', ''], ['A', '多行\n"引号"', '末尾']])
  })
  it('expands pasted grids without executing formulas and remaps cell fills on structural edits', () => {
    const table = createTable(); table.fills['1,1'] = '#ff0000'
    pasteGrid(table, 'a\tb\tc\td\n=SUM(A1)\t\t\t4', 2, 1)
    expect(table.columnWidths).toHaveLength(5); expect(table.cells[3][1]).toBe('=SUM(A1)')
    editTableDimension(table, 'row', 1, false); expect(table.fills['2,1']).toBe('#ff0000')
    editTableDimension(table, 'column', 0, true); expect(table.fills['2,0']).toBe('#ff0000')
    editTableDimension(table, 'row', 2, true); expect(table.fills).toEqual({})
  })
  it('never deletes the final cell', () => {
    const table = createTable()
    for (let i = 0; i < 5; i++) { editTableDimension(table, 'row', 0, true); editTableDimension(table, 'column', 0, true) }
    expect(table.cells).toHaveLength(1); expect(table.columnWidths).toHaveLength(1)
  })
})

describe('rich content layout and rendering', () => {
  it.each(['above', 'below', 'left', 'right'] as const)('keeps every media box and text inside its %s container', orientation => {
    const node = { ...createNode('标题'), contentLayout: orientation, contents: [createTable(), createCycle(), createFlow(), createTimeline(), createPyramid(), createCircleMap(), createGlossaryTable()] }
    const g = embeddedLayout(node, { w: 120, h: 40 })
    for (const b of [g.text, ...g.items.map(i => i.box)]) {
      expect(b.x).toBeGreaterThanOrEqual(0); expect(b.y).toBeGreaterThanOrEqual(0)
      expect(b.x + b.w).toBeLessThanOrEqual(g.size.w); expect(b.y + b.h).toBeLessThanOrEqual(g.size.h)
    }
  })
  it('expands tree layout and correctly positions embedded content in independent topics', () => {
    const node = createNode('节点'); node.contents = [createTable()]
    const map: MindMap = { root: createNode('根', [node]), topics: [{ node: structuredClone(node), x: 900, y: 300, layoutMode: 'right' }] }
    map.topics![0].node.id = 'topic'
    const layout = computeLayout(map, 1200, 800, () => ({ w: 60, h: 28 }))
    for (const n of layout.nodes.filter(n => n.contentBoxes)) {
      expect(n.w).toBeGreaterThanOrEqual(360)
      const b = n.contentBoxes![0].box
      expect(b.x).toBeGreaterThan(n.x); expect(b.y).toBeGreaterThan(n.y)
      expect(b.x + b.w).toBeLessThan(n.x + n.w + .01)
    }
  })
  it('builds shared drawing instructions for edited cycles and tables', () => {
    const cycle = createCycle(); cycle.steps.push({ id: 'four', text: '改进' })
    const forward = contentPrimitives(cycle, '#000').primitives
    cycle.clockwise = false
    const backward = contentPrimitives(cycle, '#000').primitives
    expect(forward).not.toEqual(backward)
    expect(backward.filter(p => p.type === 'text')).toHaveLength(4)
    const table = createTable(); table.cells[0][0] = '<script>文本</script>'
    expect(contentPrimitives(table, '#000').primitives.some(p => p.type === 'text' && p.value.includes('<script>'))).toBe(true)
  })
})

describe('ink model', () => {
  const stroke: InkStroke = { id: 'stroke', color: '#123456', width: 4, opacity: 1, points: [{ x: 100, y: 200 }, { x: 200, y: 200 }] }
  it('preserves world positions through normalization and detects the whole segment', () => {
    const ink = makeInk([stroke]); expect(worldStroke(ink, ink.strokes[0]).points).toEqual(stroke.points)
    expect(hitsStroke({ x: 150, y: 202 }, stroke, 3)).toBe(true)
    expect(hitsStroke({ x: 150, y: 240 }, stroke, 3)).toBe(false)
  })
  it('embeds multiple selected drawings in one reversible action', () => {
    let map: MindMap = { root: createNode('根') }
    const first = makeInk([stroke]), second = makeInk([{ ...stroke, id: 'second', points: [{ x: 300, y: 500 }] }])
    map = insertContent(insertContent(map, first, null), second, null)
    const history = new SnapshotHistory<MindMap>(); history.record(map)
    const next = embedInk(map, [first.id, second.id], map.root.id)
    expect(next.root.contents![0].kind).toBe('ink')
    const embedded = next.root.contents![0]; if (embedded.kind === 'ink') expect(embedded.strokes).toHaveLength(2)
    expect(next.objects ?? []).toHaveLength(0); expect(history.undo(next)).toEqual(map)
    expect(findContent(next, first.id)).toBeNull()
  })
})

describe('vendored illustration assets', () => {
  it('includes 200 distinct colorful stickers and 30 scene settings with real files and Chinese labels', () => {
    const assets = JSON.parse(readFileSync('public/illustrations/manifest.json', 'utf8')) as Array<{ id: string; scene: boolean; src: string; name: string; category: string; composition?: string }>
    expect(assets.filter(a => !a.scene).length).toBeGreaterThanOrEqual(200)
    expect(new Set(assets.filter(a => a.scene).map(a => a.composition)).size).toBeGreaterThanOrEqual(30)
    expect(new Set(assets.map(a => a.id)).size).toBe(assets.length)
    for (const a of assets) { expect(existsSync('public' + a.src)).toBe(true); expect(a.name).toMatch(/[\u4e00-\u9fff]/); expect(STICKERS.some(s => s.id === a.id)).toBe(true) }
    expect(new Set(assets.map(a => a.category)).size).toBe(6)
    expect(readdirSync('public/illustrations/fluent').length).toBeGreaterThan(200)
  })
})

it('selects crossing segments and erases along fast pointer movements', () => {
  const s: InkStroke = { id: 's', points: [{ x: 0, y: 50 }, { x: 100, y: 50 }], color: '#000', width: 2, opacity: 1 }
  expect(erasesStroke({ x: 50, y: 0 }, { x: 50, y: 100 }, s, 2)).toBe(true)
  expect(erasesStroke({ x: 150, y: 0 }, { x: 150, y: 100 }, s, 2)).toBe(false)
  expect(inkIntersects(makeInk([s]), { x: 40, y: 40, w: 20, h: 20 })).toBe(true)
  expect(inkIntersects(makeInk([s]), { x: 140, y: 40, w: 20, h: 20 })).toBe(false)
})
it('normalizes a long drawing without exceeding the argument stack', () => {
  const ink = makeInk([{ id: 'long', points: Array.from({ length: 150000 }, (_, x) => ({ x, y: 20 })), color: '#000', width: 2, opacity: 1 }])
  expect(ink.strokes[0].points).toHaveLength(150000)
})

it('copies a child branch with independent content and rejects malformed ownership on load', () => {
  const child = createNode('子节点'), root = createNode('根'); root.children.push(child)
  let map: MindMap = { root }
  map = insertContent(map, createCycle(), child.id)
  expect(validTree(map)).toBe(true)
  const copied = copyNode(map, child.id)
  expect(copied.map.root.children).toHaveLength(2)
  expect(copied.map.root.children[1].contents![0].id).not.toBe(map.root.children[0].contents![0].id)
  expect(validTree(copied.map)).toBe(true)
  const duplicate = structuredClone(map); duplicate.objects = [...duplicate.root.children[0].contents!]
  expect(validTree(duplicate)).toBe(false)
  const broken = structuredClone(map); (broken.root.children[0].contents![0] as any).steps = null
  expect(validTree(broken)).toBe(false)
  expect(map.root.children).toHaveLength(1)
})

it('keeps twelve cycle steps disjoint and renders every line of long labels', () => {
  const cycle = createCycle(); cycle.steps = Array.from({ length: 12 }, (_, i) => ({ id: `step-${i}`, text: `步骤${i} 多行内容必须全部显示` }))
  const plan = contentPrimitives(cycle, '#000'), boxes = plan.primitives.filter(p => p.type === 'rect')
  expect(boxes).toHaveLength(12)
  boxes.forEach((a, i) => boxes.slice(i + 1).forEach(b => {
    expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true)
  }))
  expect(plan.primitives.filter(p => p.type === 'text').map(p => p.value).join('')).toContain('必须全部显示')
})
it('rejects invalid font IDs and null floating entries without throwing', () => {
  expect(validTree({ root: createNode('根'), floating: [null] })).toBe(false)
  expect(validTree({ root: createNode('根'), font: 'invalid' })).toBe(false)
  expect(validTree({ root: createNode('根'), font: ['sans'] })).toBe(false)
  expect(validTree({ root: createNode('根'), font: { toString: null } })).toBe(false)
})
