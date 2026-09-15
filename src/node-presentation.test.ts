import { expect, it } from 'vitest'
import { nodePresentation } from './node-presentation.ts'
import { emptyTree } from './model.ts'
import { resolveTheme } from './theme.ts'
import type { LaidNode } from './layout.ts'

it('places multiline titles, subtitle and decorations in a single ordered presentation', () => {
  const map = emptyTree()
  const node: LaidNode = { id: 'note', node: { id: 'note', seed: 7, text: 'Alpha\nBeta', subtitle: 'Caption', children: [], style: { shape: 'none', fontSize: 20, align: 'left', deco: { strike: true, highlight: '#ffee00' } } }, x: 10, y: 20, w: 200, h: 100, depth: 2, side: 'right', branchIndex: 0 }
  const plan = nodePresentation(node, { map, theme: resolveTheme(map), colors: new Map(), pageLocal: false, measure: text => text.length * 10 })
  const texts = plan.filter(p => p.kind === 'text')
  expect(texts.map(p => p.text)).toEqual(['Alpha', 'Beta', 'Caption'])
  expect(texts[1].y - texts[0].y).toBeGreaterThan(20)
  expect(texts[0].x).toBe(16)
  expect(plan[0].kind).toBe('path')
  expect(plan.at(-1)?.kind).toBe('path')
})

it('keeps explicit text color and emits textured double borders with a text halo', () => {
  const map = emptyTree(), theme = { ...resolveTheme(map), paper: '#101820', ink: '#ffffff' }
  const node: LaidNode = { id: 'note', node: { id: 'note', seed: 7, text: 'Title', children: [], style: { shape: 'rounded', color: '#ff3399', borderColor: '#123456', borderWidth: 4, borderLine: 'double', fillPattern: 'hatchPencil' } }, x: 10, y: 20, w: 200, h: 100, depth: 1, side: 'right', branchIndex: 0 }
  const before = structuredClone(node)
  const plan = nodePresentation(node, { map, theme, colors: new Map(), pageLocal: true, measure: text => text.length * 10 })
  const paths = plan.filter(p => p.kind === 'path'), text = plan.find(p => p.kind === 'text')!
  expect(paths).toHaveLength(2)
  expect(paths[0]).toMatchObject({ texture: 'hatchPencil', stroke: '#123456', width: 4 })
  expect(paths[1]).toMatchObject({ fill: 'none', stroke: '#123456', width: 3 })
  expect(text).toMatchObject({ color: '#ff3399', halo: 3 })
  expect(node).toEqual(before)
})
