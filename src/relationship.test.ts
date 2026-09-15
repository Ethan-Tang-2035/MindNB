import { describe, expect, it } from 'vitest'
import { emptyTree, createNode, removeSubtree } from './model.ts'
import { beginConnection, connectTo, isEndpoint, reconnectEdge } from './relationship.ts'
import { edgeGeometry, hitCurve, pointOnCurve } from './edge-geometry.ts'
import { SnapshotHistory } from './history.ts'
import { moveObject, removeObjects } from './objects.ts'
import { validTree } from './docs.ts'
import { embedInk, eraseInkStrokes, makeInk } from './ink.ts'

function fixture() {
  const map = emptyTree()
  map.root.children = [createNode('A'), createNode('B')]
  return map
}

describe('relationship creation', () => {
  it('removes dangling lines when a drawing is embedded or completely erased, but keeps partially erased endpoints', () => {
    const map = fixture()
    const ink = makeInk(['first', 'second'].map((id, i) => ({ id, color: '#123456', width: 3, opacity: 1, points: [{ x: i * 20, y: 30 }] })))
    map.objects = [ink]
    const linked = beginConnection(map, [map.root.id, ink.id]).map
    const partial = eraseInkStrokes(linked, new Map([[ink.id, new Set(['first'])]]))
    expect(partial.objects?.some(o => o.kind === 'edge')).toBe(true)
    const erased = eraseInkStrokes(partial, new Map([[ink.id, new Set(['second'])]]))
    expect(erased.objects ?? []).toHaveLength(0)
    const embedded = embedInk(linked, [ink.id], map.root.id)
    expect(embedded.root.contents?.[0].kind).toBe('ink')
    expect(embedded.objects ?? []).toHaveLength(0)
    expect(eraseInkStrokes(linked, new Map([['missing', new Set(['first'])]]))).toBe(linked)
  })
  it('connects native pen marks to nodes and each other, survives save, move, reconnect and undo', () => {
    const map = fixture()
    map.objects = ['dot-a', 'dot-b'].map((id, i) => ({
      id, kind: 'ink' as const, seed: i + 1, x: 100 + i * 100, y: 200, w: 6, h: 6,
      sourceWidth: 6, sourceHeight: 6,
      strokes: [{ id: id + '-stroke', color: '#679C54', width: 5, opacity: 1, points: [{ x: 3, y: 3 }] }],
    }))
    const first = beginConnection(map, [map.root.id, 'dot-a'])
    expect(first.selected).toBeTruthy()
    const linked = beginConnection(first.map, ['dot-a', 'dot-b'])
    expect(linked.selected).toBeTruthy()
    const saved = JSON.parse(JSON.stringify(linked.map))
    expect(validTree(saved)).toBe(true)
    const moved = moveObject(saved, 'dot-a', 300, 400)
    expect(moved.objects?.find(o => o.id === first.selected)).toMatchObject({ from: map.root.id, to: 'dot-a' })
    const reconnected = reconnectEdge(moved, first.selected!, 'to', 'dot-b')
    expect(reconnected.objects?.find(o => o.id === first.selected)).toMatchObject({ to: 'dot-b' })
    const history = new SnapshotHistory<typeof map>()
    history.record(reconnected)
    const removed = removeObjects(reconnected, ['dot-b'])
    expect(removed.objects?.some(o => o.kind === 'edge')).toBe(false)
    expect(history.undo(removed)).toEqual(reconnected)
  })
  it('supports no selection, one selection and two selections through one workflow', () => {
    for (const count of [0, 1, 2]) {
      const map = fixture()
      const [a, b] = map.root.children.map(n => n.id)
      let result = beginConnection(map, [a, b].slice(0, count))
      if (count === 0) result = connectTo(result.map, result.state, a)
      if (count < 2) result = connectTo(result.map, result.state, b)
      expect(result.state).toBeNull()
      expect(result.map.objects).toEqual([expect.objectContaining({ kind: 'edge', from: a, to: b })])
      expect(map.objects).toBeUndefined()
    }
  })
  it('creates a floating endpoint and edge atomically; cancel is only a view change', () => {
    const map = fixture()
    const started = beginConnection(map, [map.root.id])
    expect(started.map).toBe(map)
    const done = connectTo(map, started.state, null, { x: 150, y: 200 })
    expect(done.map.floating?.[0]).toMatchObject({ x: 150, y: 200 })
    expect(done.map.objects?.[0]).toMatchObject({ from: map.root.id, to: done.map.floating?.[0].node.id })
    expect(map.floating).toBeUndefined()
  })
  it('rejects self, deleted source, and non-endpoint objects without writing data', () => {
    const map = fixture()
    map.objects = [{ id: 'group', seed: 1, kind: 'group', x: 0, y: 0, w: 10, h: 10 }]
    const a = map.root.children[0].id
    const started = beginConnection(map, [a])
    expect(connectTo(map, started.state, a).map).toBe(map)
    expect(connectTo(map, started.state, 'group').map).toBe(map)
    expect(isEndpoint(map, 'group')).toBe(false)
    const deleted = removeSubtree(map, a)
    expect(connectTo(deleted, started.state, map.root.id)).toMatchObject({ map: deleted, state: null })
  })
})

describe('relationship editing', () => {
  it('reconnects valid endpoints with undo, rejects invalid and identical endpoints', () => {
    const map = fixture()
    const [a, b] = map.root.children.map(n => n.id)
    const linked = beginConnection(map, [a, b]).map
    const id = linked.objects![0].id
    const history = new SnapshotHistory<typeof map>()
    history.record(linked)
    const next = reconnectEdge(linked, id, 'from', map.root.id)
    expect(next.objects![0]).toMatchObject({ from: map.root.id, to: b })
    expect(reconnectEdge(next, id, 'to', 'missing')).toBe(next)
    expect(reconnectEdge(next, id, 'to', map.root.id)).toBe(next)
    expect(history.undo(next)).toEqual(linked)
  })
  it('uses the rendered curve and fixed screen-pixel hit tolerance at every zoom', () => {
    const curve = edgeGeometry({ x: 0, y: 0, w: 80, h: 40 }, { x: 300, y: 80, w: 80, h: 40 })
    expect(curve.from.x).toBe(80)
    const mid = pointOnCurve(curve, 0.5)
    for (const k of [0.2, 0.4, 1, 2.5]) {
      expect(hitCurve(curve, { x: mid.x, y: mid.y + 6 / k }, k)).toBe(true)
      expect(hitCurve(curve, { x: mid.x, y: mid.y + 30 / k }, k)).toBe(false)
    }
  })
  it('keeps relationship labels out of endpoint and intervening node text', () => {
    const a = { x: 300, y: 100, w: 120, h: 40 }, b = { x: 300, y: 300, w: 120, h: 40 }
    const middle = { x: 300, y: 200, w: 120, h: 40 }
    const curve = edgeGeometry(a, b, { label: '设计反馈', control: { x: 0, y: 0 } }, [a, b, middle])
    expect(curve.label).toEqual({ x: 360, y: 194 })
  })
})
