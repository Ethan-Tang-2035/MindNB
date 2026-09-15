import { expect, it } from 'vitest'
import { feedbackFor, toolbarPosition, panelContext } from './editor-ui.ts'

it('distinguishes primary, multiple, editing and connection states without changing selection', () => {
  const selection = { ids: ['a', 'b'], primary: 'b' }
  expect(feedbackFor('a', selection)).toBe('selected')
  expect(feedbackFor('b', selection)).toBe('primary')
  expect(feedbackFor('a', selection, 'a')).toBe('editing')
  expect(feedbackFor('a', selection, null, 'a', 'b')).toBe('source')
  expect(feedbackFor('b', selection, null, 'a', 'b')).toBe('target')
  expect(selection).toEqual({ ids: ['a', 'b'], primary: 'b' })
})

it('keeps the floating toolbar inside the canvas and away from a node at the top edge', () => {
  expect(toolbarPosition({ x: 300, y: 65, w: 70, h: 40 }, 375, 650)).toEqual({ x: 127, y: 117 })
  expect(toolbarPosition({ x: 0, y: 200, w: 100, h: 40 }, 375, 650)).toEqual({ x: 8, y: 148 })
})

it('places a floating toolbar beside dense siblings instead of covering their text', () => {
  const nodes = [{ x: 360, y: 235, w: 130, h: 48 }, { x: 360, y: 295, w: 130, h: 48 }, { x: 360, y: 355, w: 130, h: 48 }]
  expect(toolbarPosition(nodes[1], 960, 900, nodes)).toEqual({ x: 502, y: 299 })
})

it('chooses only relevant panel controls', () => {
  expect(panelContext([])).toBe('canvas')
  expect(panelContext(['node', 'node'])).toBe('node')
  expect(panelContext(['edge'])).toBe('edge')
  expect(panelContext(['image'])).toBe('image')
  expect(panelContext(['node', 'image'])).toBe('mixed')
})
