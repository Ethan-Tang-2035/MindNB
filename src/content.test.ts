import { describe, it, expect } from 'vitest'
import { createNode, findNode, removeSubtree, setCollapsed, type MindMap } from './model.ts'
import { insertContent, transferContent, findContent, updateContent, createTable, createCycle, createFlow, createTimeline, createPyramid, createCircleMap, createGlossaryTable } from './content.ts'
import { SnapshotHistory } from './history.ts'
import { copyTopic, copyNode } from './topics.ts'
import { computeLayout } from './layout.ts'
import { isEndpoint } from './relationship.ts'
import { flowSize, timelineSize, pyramidSize, circleMapSize, contentPrimitives } from './content-render.ts'
import type { FlowObject } from './objects.ts'
import { validTree } from './docs.ts'

const image = () => ({ kind: 'image' as const, id: 'img', seed: 1, src: 'data:image/png;base64,x', x: 10, y: 20, w: 200, h: 100 })
const fixture = (): MindMap => ({ root: { ...createNode('根'), id: 'root', children: [{ ...createNode('目标'), id: 'target' }, { ...createNode('其他'), id: 'other' }] }, objects: [image(), { kind: 'edge', id: 'e', seed: 1, from: 'img', to: 'other' }, { kind: 'edge', id: 'self', seed: 2, from: 'target', to: 'img' }] })
describe('content ownership', () => {
  it('rebinds relationships and removes resulting self-links in one reversible transition', () => {
    const before = fixture(), history = new SnapshotHistory<MindMap>()
    history.record(before)
    const embedded = transferContent(before, 'img', 'target')
    expect(findContent(embedded, 'img')?.owner?.id).toBe('target')
    expect(embedded.objects).toEqual([{ kind: 'edge', id: 'e', seed: 1, from: 'target', to: 'other' }])
    expect(history.undo(embedded)).toEqual(before)
    expect(history.redo(before)).toEqual(embedded)
    expect(before.objects).toHaveLength(3)
  })
  it('detaching keeps relationships on the former owner and preserves content', () => {
    const map = transferContent(transferContent(fixture(), 'img', 'target'), 'img', null, { x: 500, y: 900 })
    expect(findContent(map, 'img')).toEqual({ content: { ...image(), x: 500, y: 900 }, owner: null })
    expect(map.objects?.find(o => o.kind === 'edge')).toMatchObject({ from: 'target', to: 'other' })
  })
  it('deleting the owner removes its embedded content and external relationships', () => {
    const map = removeSubtree(transferContent(fixture(), 'img', 'target'), 'target')
    expect(findContent(map, 'img')).toBeNull()
    expect(map.objects ?? []).toHaveLength(0)
  })
  it('does not expose cells, steps or embedded content as endpoints', () => {
    const table = createTable(), cycle = createCycle()
    let map = insertContent(fixture(), table, 'target')
    map = insertContent(map, cycle, null)
    expect(isEndpoint(map, table.id)).toBe(false)
    expect(isEndpoint(map, cycle.id)).toBe(true)
    expect(isEndpoint(map, cycle.steps[0].id)).toBe(false)
  })
  it('rekeys copied content and isolates edits', () => {
    const map: MindMap = { root: createNode('根'), topics: [{ node: { ...createNode('独立'), id: 'topic', contents: [createTable()] }, x: 0, y: 0, layoutMode: 'right' }] }
    const copy = copyTopic(map, 'topic')
    const original = map.topics![0].node.contents![0]
    const content = findNode(copy.map, copy.id)!.contents![0]
    expect(content.id).not.toBe(original.id)
    const changed = updateContent(copy.map, content.id, c => { if (c.kind === 'table') c.cells[0][0] = '修改' })
    expect(findContent(changed, original.id)!.content).toEqual(original)
  })
  it('rejects invalid owners without mutating the document', () => {
    const map = fixture()
    expect(transferContent(map, 'img', 'missing')).toBe(map)
    expect(insertContent(map, createTable(), 'missing')).toBe(map)
  })
  it('hides embedded content together with its owner when an ancestor folds', () => {
    const map = transferContent(fixture(), 'img', 'target')
    const folded = setCollapsed(map, 'root', true)
    const layout = computeLayout(folded, 1000, 800, () => ({ w: 50, h: 20 }))
    expect(layout.nodes.map(n => n.id)).toEqual(['root'])
    expect(findContent(folded, 'img')?.owner?.id).toBe('target')
    expect(JSON.parse(JSON.stringify(map))).toEqual(map)
  })
})

describe('v11 流程图（票 01）', () => {
  it('工厂默认值：3 步「准备/执行/复盘」横向展开，绿手绘，尺寸随默认内容自适应', () => {
    const flow = createFlow()
    expect(flow.kind).toBe('flow')
    expect(flow.steps.map(s => s.text)).toEqual(['准备', '执行', '复盘'])
    expect(flow.direction).toBe('right')
    expect(flow.color).toBe('#37956f')
    expect(flow.sketch).toBe(true)
    expect(new Set(flow.steps.map(s => s.id)).size).toBe(3)
    expect(flowSize(flow)).toEqual({ w: flow.w, h: flow.h })
  })
  it('方向开关换几何（纵向高大于宽）；加步骤尺寸增长；末步无出箭头', () => {
    const flow = createFlow()
    const down = flowSize({ ...flow, direction: 'down' })
    expect(down.w).toBeLessThan(down.h)
    const grown = flowSize({ ...flow, steps: [...flow.steps, { id: 's-x', text: '收尾' }] })
    expect(grown.w).toBeGreaterThan(flow.w)
    const plan = contentPrimitives(flow, '#000')
    const closed = plan.primitives.filter(p => p.type === 'path' && p.d.includes('Z'))
    const open = plan.primitives.filter(p => p.type === 'path' && !p.d.includes('Z'))
    expect(plan.primitives.filter(p => p.type === 'text')).toHaveLength(3)
    expect(closed).toHaveLength(3) // 3 个手绘步骤块
    expect(open).toHaveLength(4) // 2 段箭杆 + 2 个箭头（末步无出箭头，区别于循环图回环）
  })
  it('条目不是节点：步骤不作关系线端点，整图可以', () => {
    const flow = createFlow()
    let map = insertContent(fixture(), flow, 'target')
    map = insertContent(map, createFlow(), null)
    expect(isEndpoint(map, flow.id)).toBe(false) // 内嵌内容不作端点（ADR-0007/0008）
    const independent = map.objects!.find(o => o.kind === 'flow') as FlowObject
    expect(isEndpoint(map, independent.id)).toBe(true)
    expect(isEndpoint(map, independent.steps[0].id)).toBe(false)
  })
  it('复制流程图重生成图与条目 id；坏数据拒载', () => {
    const flow = createFlow()
    const map = insertContent(fixture(), flow, 'target')
    const copy = copyNode(map, 'target')
    const a = map.root.children[0].contents![0] as FlowObject
    const b = copy.map.root.children[1].contents![0] as FlowObject
    expect(b.id).not.toBe(a.id)
    expect(b.steps.every((s, i) => s.id !== a.steps[i].id)).toBe(true)
    const broken = structuredClone(copy.map)
    ;(broken.root.children[1].contents![0] as { steps: unknown }).steps = null
    expect(validTree(broken)).toBe(false)
  })
})

describe('v11 时间轴（票 02）', () => {
  it('工厂默认值：3 个时刻「开始/推进/交付」，时间标注留空，横向', () => {
    const timeline = createTimeline()
    expect(timeline.kind).toBe('timeline')
    expect(timeline.items.map(i => i.text)).toEqual(['开始', '推进', '交付'])
    expect(timeline.items.every(i => i.time === '')).toBe(true)
    expect(timeline.direction).toBe('right')
    expect(timeline.color).toBe('#37956f')
    expect(timeline.sketch).toBe(true)
    expect(new Set(timeline.items.map(i => i.id)).size).toBe(3)
  })
  it('time 空/非空渲染分支：空不画时间标注，填上则画', () => {
    const timeline = createTimeline()
    expect(contentPrimitives(timeline, '#000').primitives.filter(p => p.type === 'text' && p.size === 12)).toHaveLength(0)
    timeline.items[1].time = '第二周'
    const marked = contentPrimitives(timeline, '#000')
    expect(marked.primitives.filter(p => p.type === 'text' && p.size === 12)).toHaveLength(1)
    expect(marked.primitives.some(p => p.type === 'text' && p.value === '第二周')).toBe(true)
  })
  it('方向开关换几何；加删时刻改尺寸；刻度点与时刻一一对应', () => {
    const timeline = createTimeline()
    const down = timelineSize({ ...timeline, direction: 'down' })
    expect(down.w).toBeLessThan(timeline.w)
    expect(down.h).toBeGreaterThan(timeline.h)
    const grown = timelineSize({ ...timeline, items: [...timeline.items, { id: 't-x', time: '', text: '收尾' }] })
    expect(grown.w).toBeGreaterThan(timeline.w)
    const plan = contentPrimitives(timeline, '#000')
    expect(plan.primitives.filter(p => p.type === 'text' && p.size === 14)).toHaveLength(3)
    expect(plan.primitives.filter(p => p.type === 'path' && p.d.includes('Z'))).toHaveLength(6) // 3 个刻度点 + 3 个时刻块（手绘态均为闭合笔画）
  })
  it('条目不是节点：时刻不作端点；复制重生成 id；坏数据拒载', () => {
    const timeline = createTimeline()
    let map = insertContent(fixture(), timeline, 'target')
    map = insertContent(map, createTimeline(), null)
    expect(isEndpoint(map, timeline.id)).toBe(false)
    const independent = map.objects!.find(o => o.kind === 'timeline')!
    expect(isEndpoint(map, independent.id)).toBe(true)
    const copy = copyNode(map, 'target')
    const a = map.root.children[0].contents![0]
    const b = copy.map.root.children[1].contents![0]
    if (a.kind === 'timeline' && b.kind === 'timeline') {
      expect(b.id).not.toBe(a.id)
      expect(b.items.every((s, i) => s.id !== a.items[i].id)).toBe(true)
    } else throw new Error('kind 漂移')
    const broken = structuredClone(copy.map)
    ;(broken.root.children[1].contents![0] as { items: unknown }).items = 'bad'
    expect(validTree(broken)).toBe(false)
  })
})

describe('v11 术语表（票 05）', () => {
  it('工厂默认值：词条+解释两列预设，其余与 createTable 一致', () => {
    const glossary = createGlossaryTable()
    expect(glossary.kind).toBe('table')
    expect(glossary.cells).toEqual([['词条', '解释'], ['词条一', ''], ['词条二', '']])
    expect(glossary.columnWidths).toEqual([110, 250])
    expect(glossary.header).toBe(true)
    expect(glossary.fills).toEqual({})
    expect(insertContent(fixture(), glossary, 'target')).not.toBe(fixture())
    expect(validTree({ ...fixture(), objects: [glossary] })).toBe(true)
  })
})

describe('v11 金字塔图（票 03）', () => {
  it('工厂默认值：自底向上「基础/方法/目标」，无方向字段', () => {
    const pyramid = createPyramid()
    expect(pyramid.kind).toBe('pyramid')
    expect(pyramid.items.map(i => i.text)).toEqual(['基础', '方法', '目标'])
    expect('direction' in pyramid).toBe(false)
    expect(pyramid.color).toBe('#37956f')
    expect(pyramid.sketch).toBe(true)
  })
  it('几何极端：2 层与 5 层都得到有限正尺寸，逐层闭合笔画齐全', () => {
    for (const count of [2, 5]) {
      const pyramid = createPyramid()
      pyramid.items = Array.from({ length: count }, (_, i) => ({ id: `p-${i}`, text: `第${i}层` }))
      const plan = contentPrimitives(pyramid, '#000')
      expect(Number.isFinite(plan.width)).toBe(true); expect(plan.width).toBeGreaterThan(0)
      expect(Number.isFinite(plan.height)).toBe(true); expect(plan.height).toBeGreaterThan(0)
      expect(plan.primitives.filter(p => p.type === 'path' && p.d.includes('Z'))).toHaveLength(count)
      expect(plan.primitives.flatMap(p => p.type === 'text' ? [p.value] : []).join('')).toBe(pyramid.items.map(it => it.text).join(''))
    }
  })
  it('增删层尺寸自适应；复制重生成 id；坏数据拒载；条目不作端点', () => {
    const pyramid = createPyramid()
    const taller = pyramidSize({ ...pyramid, items: [...pyramid.items, { id: 'p-x', text: '愿景' }] })
    expect(taller.h).toBeGreaterThan(pyramid.h)
    let map = insertContent(fixture(), pyramid, 'target')
    map = insertContent(map, createPyramid(), null)
    expect(isEndpoint(map, pyramid.id)).toBe(false)
    const independent = map.objects!.find(o => o.kind === 'pyramid')!
    expect(isEndpoint(map, independent.id)).toBe(true)
    const copy = copyNode(map, 'target')
    const a = map.root.children[0].contents![0]
    const b = copy.map.root.children[1].contents![0]
    if (a.kind === 'pyramid' && b.kind === 'pyramid') {
      expect(b.id).not.toBe(a.id)
      expect(b.items.every((s, i) => s.id !== a.items[i].id)).toBe(true)
    } else throw new Error('kind 漂移')
    const broken = structuredClone(copy.map)
    ;(broken.root.children[1].contents![0] as { items: unknown }).items = 3
    expect(validTree(broken)).toBe(false)
  })
})

describe('v11 圆圈图（票 04）', () => {
  it('工厂默认值：中心「主题」+ 联想一～联想四', () => {
    const circle = createCircleMap()
    expect(circle.kind).toBe('circleMap')
    expect(circle.center.text).toBe('主题')
    expect(circle.items.map(i => i.text)).toEqual(['联想一', '联想二', '联想三', '联想四'])
    expect(circle.color).toBe('#37956f')
    expect(circle.sketch).toBe(true)
  })
  it('3～8 词条环布局极端：块数=词条数+中心圆，尺寸有限为正', () => {
    for (const count of [3, 8]) {
      const circle = createCircleMap()
      circle.items = Array.from({ length: count }, (_, i) => ({ id: `c-${i}`, text: `联想${i}` }))
      const plan = contentPrimitives(circle, '#000')
      expect(Number.isFinite(plan.width)).toBe(true); expect(plan.width).toBeGreaterThan(0)
      expect(plan.primitives.filter(p => p.type === 'path' && p.d.includes('Z'))).toHaveLength(count + 1)
      expect(plan.primitives.filter(p => p.type === 'text').length).toBeGreaterThanOrEqual(count + 1)
    }
  })
  it('加删联想词尺寸自适应；复制重生成 center 与 items id；坏数据拒载；条目不作端点', () => {
    const circle = createCircleMap()
    const wider = circleMapSize({ ...circle, items: [...circle.items, { id: 'c-x', text: '联想五' }] })
    expect(wider.w).toBeGreaterThanOrEqual(circle.w)
    const crowded = circleMapSize({ ...circle, items: Array.from({ length: 12 }, (_, i) => ({ id: `c-${i}`, text: `联想 ${i}` })) })
    expect(crowded.w).toBeGreaterThan(wider.w)
    let map = insertContent(fixture(), circle, 'target')
    map = insertContent(map, createCircleMap(), null)
    expect(isEndpoint(map, circle.id)).toBe(false)
    const independent = map.objects!.find(o => o.kind === 'circleMap')!
    expect(isEndpoint(map, independent.id)).toBe(true)
    expect(isEndpoint(map, circle.center.id)).toBe(false)
    const copy = copyNode(map, 'target')
    const a = map.root.children[0].contents![0]
    const b = copy.map.root.children[1].contents![0]
    if (a.kind === 'circleMap' && b.kind === 'circleMap') {
      expect(b.id).not.toBe(a.id)
      expect(b.center.id).not.toBe(a.center.id)
      expect(b.items.every((s, i) => s.id !== a.items[i].id)).toBe(true)
    } else throw new Error('kind 漂移')
    const broken = structuredClone(copy.map)
    ;(broken.root.children[1].contents![0] as { center: unknown }).center = null
    expect(validTree(broken)).toBe(false)
  })
})

describe('diagram text geometry regressions', () => {
  it.each(['right', 'down'] as const)('keeps timeline blocks and multiline dates inside %s bounds', direction => {
    const c = createTimeline(); c.direction = direction; c.sketch = false
    c.items.forEach(it => { it.time = '2026 年 9 月 8 日 · 项目正式开始，里程碑说明' })
    Object.assign(c, timelineSize(c))
    const plan = contentPrimitives(c, '#000')
    for (const p of plan.primitives) {
      if (p.type === 'rect') {
        expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x + p.w).toBeLessThanOrEqual(plan.width)
        expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y + p.h).toBeLessThanOrEqual(plan.height)
      } else if (p.type === 'text') {
        expect(p.y - p.size).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(plan.height)
        expect(p.value.length).toBeLessThan(20)
      }
    }
  })
  it('leaves a gap between a long circle-map center and every satellite', () => {
    const c = createCircleMap(); c.sketch = false
    c.center.text = '中心主题需要完整显示，不能与联想词条重叠。'.repeat(8)
    Object.assign(c, circleMapSize(c))
    const plan = contentPrimitives(c, '#000')
    const center = plan.primitives.find(p => p.type === 'path')!
    if (center.type !== 'path') throw new Error('center circle missing')
    const radius = Number(center.d.match(/a([\d.]+)/)![1])
    for (const p of plan.primitives) if (p.type === 'rect') {
      const dx = Math.max(p.x - plan.width / 2, 0, plan.width / 2 - p.x - p.w)
      const dy = Math.max(p.y - plan.height / 2, 0, plan.height / 2 - p.y - p.h)
      expect(Math.hypot(dx, dy)).toBeGreaterThan(radius + 12)
    }
  })
  it('keeps pyramid text inside the sloping edges for multiline and reordered layers', () => {
    const c = createPyramid(); c.sketch = false
    c.items[0].text = '这是一段需要换行显示并且必须留在金字塔斜边以内的长文字'.repeat(3)
    for (let i = 0; i < 3; i++) {
      Object.assign(c, pyramidSize(c))
      const plan = contentPrimitives(c, '#000')
      for (const p of plan.primitives) if (p.type === 'text') {
        const textWidth = [...p.value].reduce((w, ch) => w + (/[^\x00-\xff]/.test(ch) ? 14 : 8), 0)
        expect(textWidth + 12).toBeLessThanOrEqual(plan.width * (p.y - p.size) / plan.height)
      }
      c.items.push(c.items.shift()!)
    }
  })
})
