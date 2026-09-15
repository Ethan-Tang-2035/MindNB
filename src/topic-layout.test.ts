import { expect, it } from 'vitest'
import { computeLayout } from './layout.ts'
import { createTopic, moveTopic, setTopicLayout } from './topics.ts'
import { addChild, emptyTree } from './model.ts'
const measure = () => ({ w: 80, h: 24 })

it('independently positions each topic and its subtree at any viewport width', () => {
  const a = createTopic(emptyTree(), 800, 500)
  const b = createTopic(addChild(a.map, a.id, 'child').map, -500, 200)
  const before = computeLayout(b.map, 1280, 720, measure)
  const after = computeLayout(moveTopic(b.map, a.id, 950, 540), 1280, 720, measure)
  const root = before.nodes.find(n => n.id === a.id)!
  expect(root).toMatchObject({ x: 800, y: 500, depth: 0 })
  const child = after.nodes.find(n => n.id === b.map.topics![0].node.children[0].id)!
  const old = before.nodes.find(n => n.id === child.id)!
  expect(child.x - old.x).toBe(150)
  expect(child.y - old.y).toBe(40)
  expect(after.nodes.find(n => n.id === b.id)).toEqual(before.nodes.find(n => n.id === b.id))
  expect(computeLayout(b.map, 375, 650, measure).nodes.find(n => n.id === a.id)).toEqual(root)
  const left = computeLayout(setTopicLayout(b.map, a.id, 'left'), 1280, 720, measure)
  expect(left.nodes.find(n => n.id === child.id)!.x).toBeLessThan(800)
})

it('lays out 100 independent trees without duplicate IDs or missing content', () => {
  let map = emptyTree()
  for (let i = 0; i < 100; i++) map = createTopic(map, i * 500, 0).map
  const layout = computeLayout(map, 1280, 720, measure)
  expect(layout.nodes).toHaveLength(101)
  expect(new Set(layout.nodes.map(n => n.id)).size).toBe(101)
})
