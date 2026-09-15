import { expect, it } from 'vitest'
import { emptyTree, addChild, addChildAfterSibling, removeSubtrees, findNode, forestRoots, moveSubtree, createFloating, detachSubtree } from './model.ts'
import { createTopic, copyTopic, moveTopic, topicOwner, setTopicLayout } from './topics.ts'
import { beginConnection } from './relationship.ts'

it('adds independent trees without converting old floating nodes or changing existing IDs', () => {
  const old = createFloating(emptyTree(), 10, 20).map
  const result = createTopic(old, 700, 500)
  expect(result.map.root).toEqual(old.root)
  expect(result.map.floating).toEqual(old.floating)
  expect(result.map.topics?.[0]).toMatchObject({ x: 700, y: 500 }) // v15：结构落 node.structure，遗留字段不再写
  expect(result.map.topics?.[0].node.structure).toBe('right')
  expect(result.map.topics?.[0].layoutMode).toBeUndefined()
  expect(findNode(result.map, result.id)?.text).toBe('独立主题')
  expect(forestRoots(result.map)).toHaveLength(3)
})

it('edits, copies with fresh IDs and deletes a complete independent tree with relationship cleanup', () => {
  const first = createTopic(emptyTree(), 700, 500)
  const child = addChild(first.map, first.id, 'child')
  const sibling = addChildAfterSibling(child.map, child.id, 'sibling')
  expect(findNode(sibling.map, first.id)?.children).toHaveLength(2)
  const linked = beginConnection(sibling.map, [child.id, sibling.map.root.id]).map
  const copied = copyTopic(linked, first.id)
  expect(copied.map.topics).toHaveLength(2)
  expect(new Set(forestRoots(copied.map).map(n => n.id)).size).toBe(3)
  expect(copied.map.topics![1].node.children[0].id).not.toBe(child.id)
  const removed = removeSubtrees(linked, [first.id])
  expect(removed.topics ?? []).toHaveLength(0)
  expect(removed.objects ?? []).toHaveLength(0)
})

it('moves and lays out one tree only and rejects cross-topic structural attachment', () => {
  const a = createTopic(emptyTree(), 100, 200)
  const b = createTopic(a.map, 800, 400)
  const child = addChild(b.map, a.id, 'child')
  const moved = moveTopic(child.map, a.id, 300, 300)
  expect(moved.topics![1]).toEqual(child.map.topics![1])
  expect(moved.root).toEqual(child.map.root)
  expect(topicOwner(moved, child.id)?.node.id).toBe(a.id)
  expect(moveSubtree(moved, child.id, { kind: 'child', id: b.id })).toBe(moved)
  expect(setTopicLayout(moved, a.id, 'left').topics![0].node.structure).toBe('left') // v15：写节点 structure 并删遗留字段
})

it('detaches a topic descendant without losing it and deletes its anchored annotations with the parent', () => {
  const topic = createTopic(emptyTree(), 100, 200)
  const child = addChild(topic.map, topic.id, 'child')
  const detached = detachSubtree(child.map, child.id, 500, 600)
  expect(detached.floating?.[0].node.id).toBe(child.id)
  expect(detached.topics![0].node.children).toHaveLength(0)
  child.map.objects = [{ id: 'boundary', seed: 1, kind: 'boundary', anchor: { parentId: topic.id, start: 0, count: 2 } }]
  expect(removeSubtrees(child.map, [topic.id]).objects ?? []).toHaveLength(0)
})
