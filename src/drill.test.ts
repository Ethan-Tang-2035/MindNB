import { expect, it } from 'vitest'
import { createNode, emptyTree, removeSubtree, setText, setCollapsed } from './model.ts'
import { enterDrill, returnDrill, reconcileDrill, scopedMap, type DrillFrame } from './drill.ts'
const view = { tx: 30, ty: -20, k: .8 }
const viewport = { width: 1000, height: 800 }

function fixture() {
  const map = emptyTree()
  map.root.children = [createNode('A', [createNode('B', [createNode('C', [createNode('D')])])]), createNode('outside')]
  return map
}

it('enters three levels, blocks the fourth and restores view and selection along any path', () => {
  const map = fixture()
  let frames: DrillFrame[] = []
  let node = map.root
  for (let i = 0; i < 3; i++) {
    node = node.children[0]
    frames = enterDrill(map, frames, node.id, { ...view, tx: i * 100 }, { ids: [node.id], primary: node.id }, viewport)
    expect(frames).toHaveLength(i + 1)
  }
  expect(enterDrill(map, frames, node.children[0].id, view, { ids: [], primary: null }, viewport)).toBe(frames)
  expect(returnDrill(frames, 1, viewport)).toMatchObject({ frames: [frames[0]], view: { ...view, tx: 100 } })
  expect(returnDrill(frames, 0, viewport)).toMatchObject({ frames: [], view: { ...view, tx: 0 }, selection: { ids: [map.root.children[0].id] } })
})

it('filters external relationships without deleting data, edits original IDs and recovers after deletion', () => {
  const map = fixture(), a = map.root.children[0], b = a.children[0]
  map.objects = [{ id: 'internal', seed: 1, kind: 'edge', from: a.id, to: b.id }, { id: 'external', seed: 2, kind: 'edge', from: a.id, to: map.root.id }]
  const frames = enterDrill(map, [], a.id, view, { ids: [a.id], primary: a.id }, viewport)
  const scoped = scopedMap(map, a.id)
  expect(scoped.root.id).toBe(a.id)
  expect(scoped.objects?.map(o => o.id)).toEqual(['internal'])
  expect(map.objects).toHaveLength(2)
  expect(scopedMap(setText(map, b.id, 'edited'), a.id).root.children[0].text).toBe('edited')
  expect(reconcileDrill(removeSubtree(map, a.id), frames, viewport)).toMatchObject({ frames: [], view })
})

it('persists relative frame offsets and restores a centered view on a narrower device', () => {
  const map = fixture(), id = map.root.children[0].id
  const frames = enterDrill(map, [], id, { tx: 240, ty: 225, k: .5 }, { ids: [id], primary: id }, { width: 960, height: 900 })
  expect(frames[0].view).toEqual({ dx: 0, dy: 0, k: .5 })
  const restored = returnDrill(JSON.parse(JSON.stringify(frames)), 0, { width: 375, height: 600 })
  expect(restored?.view).toEqual({ tx: 93.75, ty: 150, k: .5 })
})

it('keeps collapse edits visible in drill scope without changing source data on entry', () => {
  const map = fixture(), id = map.root.children[0].id
  const collapsed = setCollapsed(map, id, true)
  expect(scopedMap(collapsed, id).root.collapsed).toBe(true)
  expect(map.root.children[0].collapsed).toBeUndefined()
  expect(scopedMap(setCollapsed(collapsed, id, false), id).root.collapsed).toBeUndefined()
})
