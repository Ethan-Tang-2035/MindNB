import { expect, it } from 'vitest'
import { selectionFormat } from './selection-format.ts'
import { emptyTree, createNode } from './model.ts'
import { createTextBox } from './text-box.ts'
import { createTable } from './content.ts'

it('distinguishes mixed explicit overrides from matching effective values', () => {
  const map = emptyTree()
  map.nodeBorderWidth = 4
  const a = createNode('a'), b = createNode('b')
  b.style = { borderWidth: 4 }
  map.root.children = [a, b]
  const format = selectionFormat(map, [a.id, b.id])
  expect(format.explicit('borderWidth')).toBe('mixed')
  expect(format.effective('borderWidth')).toBe(4)
  b.style.borderWidth = 1
  expect(selectionFormat(map, [a.id, b.id]).effective('borderWidth')).toBe('mixed')
})

it('reports the actual rounded shape for embedded content and the clear center border width', () => {
  const map = emptyTree()
  map.visualStyle = 'clear'
  const parent = createNode('parent'), child = createNode('table')
  child.contents = [createTable()]
  parent.children = [child]; map.root.children = [parent]
  expect(selectionFormat(map, [child.id]).effective('shape')).toBe('rounded')
  expect(selectionFormat(map, [map.root.id]).effective('borderWidth')).toBe(2.8)
})

it('applies common text formatting atomically while preserving node and text-box identity', () => {
  const measure = (text: string) => ({ w: text.length * 10, h: 24 })
  const created = createTextBox(emptyTree(), 0, 0, measure, 'caption')
  const ids = [created.map.root.id, created.id], format = selectionFormat(created.map, ids)
  expect(format.supported).toBe(true)
  const next = format.apply({ bold: true, color: '#aabbcc' }, measure)
  expect(next.root.style).toMatchObject({ bold: true, color: '#aabbcc' })
  expect(next.objects?.[0]).toMatchObject({ kind: 'textBox', style: { bold: true, color: '#aabbcc' } })
  expect(format.apply({ backdrop: 'paper' }, measure)).toBe(created.map)
  const mixed = { ...created.map, objects: [...created.map.objects!, { id: 'image', kind: 'image' as const, seed: 1, src: 'data:image/png;base64,AA==', x: 0, y: 0, w: 10, h: 10 }] }
  const unsupported = selectionFormat(mixed, [mixed.root.id, 'image'])
  expect(unsupported.supported).toBe(false)
  expect(unsupported.apply({ bold: true }, measure)).toBe(mixed)
})
