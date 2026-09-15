import { expect, it } from 'vitest'
import { createDocStore, validTree, type StorageLike } from './docs.ts'
import { emptyTree, addChild, createFloating } from './model.ts'
import { createTopic } from './topics.ts'
import { insertContent, createFlow, createTimeline, createPyramid, createCircleMap, createGlossaryTable } from './content.ts'
import { enterDrill } from './drill.ts'
import { beginConnection, reconnectEdge } from './relationship.ts'
import { SnapshotHistory } from './history.ts'
class Memory implements StorageLike {
  data = new Map<string, string>()
  getItem(k: string) { return this.data.get(k) ?? null }
  setItem(k: string, v: string) { this.data.set(k, v) }
  removeItem(k: string) { this.data.delete(k) }
}

it('round trips old and new content, copies, and drill view separately from content history', () => {
  const storage = new Memory(), store = createDocStore(storage)
  const doc = store.create()
  const old = createFloating(emptyTree(), 10, 20).map
  store.save(doc.id, old)
  expect(store.loadTree(doc.id)).toEqual(old)
  const topic = createTopic(old, 800, 300)
  const child = addChild(topic.map, topic.id, 'child')
  const link = beginConnection(child.map, [old.root.id, topic.id])
  const next = reconnectEdge(link.map, link.selected!, 'to', child.id)
  store.save(doc.id, next)
  const before = store.list()
  const drill = enterDrill(next, [], topic.id, { tx: 20, ty: 30, k: .7 }, { ids: [topic.id], primary: topic.id }, { width: 1000, height: 800 })
  store.saveView(doc.id, { dx: 3, dy: 5, k: 1, drill })
  expect(store.list()).toEqual(before)
  expect(createDocStore(storage).loadView(doc.id)?.drill).toEqual(drill)
  expect(createDocStore(storage).loadTree(doc.id)).toEqual(next)
  expect(store.loadTree(store.copy(doc.id)!.id)).toEqual(next)
  const history = new SnapshotHistory<typeof next>()
  history.record(old)
  expect(history.undo(next)).toEqual(old)
  expect(history.redo(old)).toEqual(next)
})

it('rejects malformed independent trees, duplicate IDs and invalid coordinates', () => {
  const added = createTopic(emptyTree(), 100, 100).map
  expect(validTree(added)).toBe(true)
  const duplicate = structuredClone(added)
  duplicate.topics![0].node.id = duplicate.root.id
  expect(validTree(duplicate)).toBe(false)
  expect(validTree({ ...added, topics: [{ ...added.topics![0], x: 'bad' }] })).toBe(false)
})

it('v11 图表族（流程图/时间轴/金字塔图/圆圈图/术语表）持久化往返与坏数据拒载', () => {
  let map = emptyTree()
  for (const content of [createFlow(), createTimeline(), createPyramid(), createCircleMap(), createGlossaryTable()]) map = insertContent(map, content, null)
  expect(validTree(map)).toBe(true)
  const storage = new Memory(), store = createDocStore(storage)
  const doc = store.create()
  store.save(doc.id, map)
  expect(createDocStore(storage).loadTree(doc.id)).toEqual(map)
  for (const [kind, field] of [['flow', 'steps'], ['timeline', 'items'], ['pyramid', 'items'], ['circleMap', 'center']] as const) {
    const broken = structuredClone(map)
    const obj = broken.objects!.find(o => o.kind === kind) as unknown as Record<string, unknown>
    obj[field] = null
    expect(validTree(broken)).toBe(false)
  }
})
