import { describe, expect, it } from 'vitest'
import { AgentError, applyAgentOperations, documentSummary, EditRevisions } from './agent-api.ts'
import { createNode, emptyTree, findNode, setText, type MindMap } from './model.ts'
import { createTable } from './content.ts'
import { findObject } from './objects.ts'
import { ownerIndex, pageById } from './paper-pages.ts'
import { validTree } from './docs.ts'
import type { Measurer } from './layout.ts'

const measure: Measurer = (text, _depth, style) => {
  const width = style?.maxTextW ?? 220, px = style?.fontPx ?? 20
  const lines = text.split('\n')
  return {
    w: Math.min(width, Math.max(...lines.map(line => line.length * px))),
    h: lines.reduce((rows, line) => rows + Math.max(1, Math.ceil(line.length * px / width)), 0) * (style?.lineH ?? 28),
  }
}
const page = (ref = 'paper', x = 300, y = 200) => ({ type: 'page.create', ref, name: '阅读手账', x, y, width: 900, height: 1200, paperStyle: 'grid' })
const text = (ref = 'caption') => ({ type: 'text.create', ref, pageId: 'paper', x: 30, y: 40, text: '独立说明', width: 240 })
const tree = (root: unknown = { text: '知识', ref: 'root', children: [{ text: '行动', ref: 'child' }] }) => ({ type: 'tree.create', ref: 'tree', pageId: 'paper', x: 80, y: 180, root })
const apply = (map: MindMap, ops: unknown) => applyAgentOperations(map, ops, measure)

function rejectsWithoutMutation(map: MindMap, ops: unknown, code = 'INVALID_ARGUMENT') {
  const before = structuredClone(map)
  expect(() => apply(map, ops)).toThrowError(AgentError)
  try { apply(map, ops) } catch (error) { expect(error).toMatchObject({ code }) }
  expect(map).toEqual(before)
}

describe('agent operation batches', () => {
  it('creates a valid independent result without mutating or sharing source data', () => {
    const original = emptyTree(), before = structuredClone(original)
    const result = apply(original, [page(), text(), tree()])
    expect(validTree(result.map)).toBe(true)
    expect(original).toEqual(before)
    expect(result.map).not.toBe(original)
    result.map.root.text = 'result-only edit'
    expect(original).toEqual(before)
  })

  it('rolls back earlier edits and creations when a later operation fails', () => {
    const original = emptyTree()
    rejectsWithoutMutation(original, [
      { type: 'node.text', id: original.root.id, text: 'would change' },
      page(), text(),
      { type: 'node.text', id: 'missing', text: 'fail' },
    ], 'NOT_FOUND')
  })

  it('resolves nested refs, keeps text independent, and records explicit paper membership', () => {
    const { map, ids } = apply(emptyTree(), [page(), text(), tree(),
      { type: 'node.add_child', parentId: 'child', ref: 'grandchild', text: '下一步' },
      { type: 'object.text', id: 'caption', text: '独立正文' },
      { type: 'node.text', id: 'grandchild', text: '明天行动' },
    ])
    expect(ids.tree).toBe(ids.root)
    expect(findNode(map, ids.caption)).toBeNull()
    expect(findObject(map, ids.caption)).toMatchObject({ kind: 'textBox', text: '独立正文', x: 330, y: 240 })
    expect(findNode(map, ids.child)?.children).toMatchObject([{ id: ids.grandchild, text: '明天行动' }])
    expect(pageById(map, ids.paper)?.members).toEqual([ids.caption, ids.root])
    expect(ownerIndex(map).get(ids.grandchild)).toBe(ids.paper)
    expect(ownerIndex(map).has(map.root.id)).toBe(false)
  })

  it('uses explicit ownership when an object geometrically overlaps another page', () => {
    const { map, ids } = apply(emptyTree(), [page(), page('second', 1500, 200), text(),
      { type: 'object.move', id: 'caption', pageId: 'second', x: -1170, y: 40 },
    ])
    expect(findObject(map, ids.caption)).toMatchObject({ x: 330, y: 240 })
    expect(ownerIndex(map).get(ids.caption)).toBe(ids.second)
    expect(pageById(map, ids.paper)?.members).not.toContain(ids.caption)
    expect(pageById(map, ids.second)?.members).toEqual([ids.caption])
  })

  it('applies one style to real nodes and independent text without changing identity', () => {
    const { map, ids } = apply(emptyTree(), [page(), text(), tree(),
      { type: 'style', ids: ['root', 'caption'], style: { fontSize: 28, color: '#ab3366', bold: true } },
    ])
    expect(findNode(map, ids.root)?.style).toMatchObject({ fontSize: 28, color: '#ab3366', bold: true })
    expect(findObject(map, ids.caption)).toMatchObject({ kind: 'textBox', style: { fontSize: 28, color: '#ab3366', bold: true } })
  })

  it.each([
    { type: 'node.text', id: 'caption', text: 'wrong identity' },
    { type: 'node.add_child', parentId: 'caption', text: 'wrong parent' },
    { type: 'object.text', id: 'root', text: 'wrong identity' },
    { type: 'object.move', id: 'root', pageId: 'paper', x: 0, y: 0 },
    { type: 'style', ids: ['root', 'missing'], style: { bold: true } },
    { type: 'page.update', id: 'missing', name: 'unknown' },
  ])('rejects an invalid target without partial effects: $type', op => {
    rejectsWithoutMutation(emptyTree(), [page(), text(), tree(), op], 'NOT_FOUND')
  })

  it.each([
    { color: '#fff' }, { fill: 'red' }, { shape: 'triangle' }, { font: 'unknown' },
    { width: 601 }, { fontSize: Infinity }, { borderWidth: -1 }, { bold: 'yes' }, { hiddenField: true },
  ])('rejects invalid styles: %j', style => {
    rejectsWithoutMutation(emptyTree(), [page(), { ...text(), style }])
  })

  it.each([
    { ...page(), unexpected: true },
    { ...tree(), root: { text: 'root', source: 'unsupported' } },
    { ...tree(), structure: 'unsupported' },
    { ...text(), width: NaN },
    { type: 'unsupported' },
  ])('rejects unknown fields and malformed arguments: %j', op => {
    rejectsWithoutMutation(emptyTree(), [page(), { ...op, ref: 'other' }])
  })

  it('rejects duplicate refs across different object kinds', () => {
    rejectsWithoutMutation(emptyTree(), [page(), text('paper')])
  })

  it('populates a pristine center while retaining its identity and moving its membership', () => {
    const initial = apply(emptyTree(), [page()]), originalId = initial.map.root.id
    pageById(initial.map, initial.ids.paper)!.members.push(originalId)
    const result = apply(initial.map, [page('destination', 1500, 200), { ...tree(), pageId: 'destination', asRoot: true },
      { type: 'node.text', id: 'root', text: '新中心' },
    ])
    expect(result.map.root.id).toBe(result.ids.root)
    expect(result.ids.tree).toBe(originalId)
    expect(result.ids.root).toBe(originalId)
    expect(result.map.root.seed).toBe(initial.map.root.seed)
    expect(result.map.rootPosition).toEqual({ x: 1580, y: 380 })
    expect(pageById(result.map, initial.ids.paper)?.members).toEqual([])
    expect(pageById(result.map, result.ids.destination)?.members).toEqual([originalId])
    expect(findNode(result.map, originalId)?.text).toBe('新中心')
  })

  it('preserves free relationship endpoints when populating the center', () => {
    const original = emptyTree(), other = createNode('独立文字')
    original.floating = [{ node: other, x: 10, y: 20 }]
    original.objects = [{ id: 'relationship', seed: 1, kind: 'edge', from: original.root.id, to: other.id, label: '保留连接' }]
    const result = apply(original, [page(), { ...tree(), asRoot: true }])
    expect(result.map.objects).toEqual(original.objects)
    expect(findNode(result.map, original.root.id)?.text).toBe('知识')
  })

  it.each([
    { style: { color: '#ff0000' } }, { structure: 'left' }, { sideOverride: 'left' },
    { contentLayout: 'below' }, { collapsed: true }, { branchColor: '#ff0000' },
    { branchLine: 'dashed' }, { branchWidth: 5 },
  ])('rejects customized center metadata without losing it: %j', patch => {
    const original = emptyTree()
    Object.assign(original.root, patch)
    rejectsWithoutMutation(original, [page(), { ...tree(), asRoot: true }])
  })

  it('does not overwrite a manually positioned center', () => {
    const original = emptyTree()
    original.rootPosition = { x: 123, y: 456 }
    rejectsWithoutMutation(original, [page(), { ...tree(), asRoot: true }])
  })

  it('never discards notes, attached content or existing descendants through asRoot', () => {
    const maps = [emptyTree(), emptyTree(), emptyTree()]
    maps[0].root.note = { version: 1, markdown: '这里已有用户保存的来源' }
    maps[1].root.contents = [createTable()]
    maps[2].root.children = [createNode('已有孩子')]
    for (const map of maps) rejectsWithoutMutation(map, [page(), { ...tree(), asRoot: true }])
  })
})

describe('agent limits', () => {
  it('enforces operation count and nonempty batches', () => {
    rejectsWithoutMutation(emptyTree(), [])
    rejectsWithoutMutation(emptyTree(), Array.from({ length: 201 }, (_, i) => page(`p${i}`)))
  })

  it('allows 400 created nodes but rejects the 401st across tree and child operations', () => {
    const root = { text: 'root', ref: 'root', children: Array.from({ length: 398 }, () => ({ text: 'leaf' })) }
    const ops = [page(), tree(root), { type: 'node.add_child', parentId: 'root', text: '400th' }]
    const result = apply(emptyTree(), ops)
    expect(findNode(result.map, result.ids.root)?.children).toHaveLength(399)
    rejectsWithoutMutation(emptyTree(), [...ops, { type: 'node.add_child', parentId: 'root', text: '401st' }])
  })

  it('rejects an oversized tree and nesting beyond the supported depth', () => {
    rejectsWithoutMutation(emptyTree(), [page(), tree({ text: 'root', children: Array.from({ length: 400 }, () => ({ text: 'leaf' })) })])
    type InputNode = { text: string; children: InputNode[] }
    let nested: InputNode = { text: 'leaf', children: [] }
    for (let depth = 0; depth < 13; depth++) nested = { text: 'branch', children: [nested] }
    rejectsWithoutMutation(emptyTree(), [page(), tree(nested)])
  })
})

describe('document context and edit tokens', () => {
  it('summarizes only the requested page with its child bounds and without image bodies', () => {
    const result = apply(emptyTree(), [page(), page('other', 1600, 200), text(), tree(),
      { type: 'text.create', pageId: 'other', ref: 'otherText', x: 20, y: 30, text: '别页文字' },
      { type: 'image.create', pageId: 'paper', ref: 'photo', x: 10, y: 10, width: 20, height: 20, dataURL: 'data:image/png;base64,AA==' },
    ])
    const summary = documentSummary(result.map, measure, result.ids.paper)
    expect(summary.pages.map(p => p.id)).toEqual([result.ids.paper])
    expect(summary.trees).toMatchObject([{ id: result.ids.root, children: [{ id: result.ids.child }] }])
    expect(summary.bounds.map(b => b.id)).toEqual(expect.arrayContaining([result.ids.root, result.ids.child]))
    expect(summary.objects.map(o => o.id)).not.toContain(result.ids.otherText)
    expect(summary.objects.find(o => o.id === result.ids.photo)).toMatchObject({ hasImage: true })
    expect(JSON.stringify(summary)).not.toContain('data:image')
    expect(() => documentSummary(result.map, measure, 'missing')).toThrowError(AgentError)
  })

  it('preserves note and attached structured content in context but strips embedded image data', () => {
    const map = emptyTree(), table = createTable()
    map.root.note = { version: 1, markdown: '来源与个人备注' }
    map.root.contents = [table, { id: 'inline', seed: 1, kind: 'image', x: 0, y: 0, w: 20, h: 20, src: 'data:image/png;base64,AA==' }]
    const summary = documentSummary(map, measure)
    expect(summary.trees).toMatchObject([{ note: map.root.note, contents: [{ id: table.id, kind: 'table', cells: table.cells }, { id: 'inline', kind: 'image' }] }])
    expect(JSON.stringify(summary)).not.toContain('data:image')
    expect(map.root.contents[1]).toMatchObject({ src: 'data:image/png;base64,AA==' })
  })

  it('changes tokens after UI edits and undo, while unchanged remounts retain the token', () => {
    const revisions = new EditRevisions(), original = emptyTree()
    const first = revisions.get('doc', original)
    expect(revisions.get('doc', structuredClone(original))).toBe(first)
    const edited = setText(original, original.root.id, '来自 UI 的修改')
    const afterEdit = revisions.get('doc', edited)
    expect(afterEdit).toBeGreaterThan(first)
    const afterUndo = revisions.get('doc', structuredClone(original))
    expect(afterUndo).toBeGreaterThan(afterEdit)
    expect(afterUndo).not.toBe(first)
    expect(revisions.get('doc', structuredClone(original))).toBe(afterUndo)
    expect(revisions.get('doc', edited)).toBeGreaterThan(afterUndo)
  })

  it('detects external reloads and keeps document tokens independent across editor switches', () => {
    const revisions = new EditRevisions(), map = emptyTree()
    const a = revisions.get('a', map), b = revisions.get('b', structuredClone(map))
    expect(b).toBeGreaterThan(a)
    const external = structuredClone(map)
    external.root.note = { version: 1, markdown: '外部更新' }
    expect(revisions.get('a', external)).toBeGreaterThan(b)
    expect(revisions.get('b', structuredClone(map))).toBe(b)
  })
})

it('removes only requested standalone cover objects and clears page membership atomically', () => {
  const made=apply(emptyTree(),[page(),text(),tree()])
  const removed=apply(made.map,[{type:'object.remove',ids:[made.ids.caption]}])
  expect(findObject(removed.map,made.ids.caption)).toBeNull()
  expect(pageById(removed.map,made.ids.paper)!.members).not.toContain(made.ids.caption)
  expect(findNode(removed.map,made.ids.tree)?.text).toBe('知识')
  expect(findObject(made.map,made.ids.caption)).toBeDefined()
  expect(validTree(removed.map)).toBe(true)
  rejectsWithoutMutation(made.map,[{type:'object.remove',ids:[made.ids.caption,made.ids.tree]}],'NOT_FOUND')
})
