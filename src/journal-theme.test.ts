import { expect, it } from 'vitest'
import { backdropSource } from './node-backdrop.ts'
import { nodePaint } from './render.ts'
import { THEMES } from './theme.ts'
import { isDarkColor } from './paper.ts'

it('brush texture follows its resolved theme fill when no explicit fill exists', () => {
  // The renderer/exporter supply the resolved fill instead of a fixed pink default.
  expect(decodeURIComponent(backdropSource({ backdrop: 'brush' }, '#368BEC')!)).toContain('flood-color="#368BEC"')
})

it('light paper artwork retains readable title text after selecting a dark theme', () => {
  const theme = THEMES.find(t => t.id === 'chalkboard')!
  expect(isDarkColor(nodePaint('none', 0, { backdrop: 'paper' }, theme.ink, theme).textFill)).toBe(true)
})

it('brush titles use readable text on the themed fill while respecting an explicit text color', () => {
  const theme = THEMES.find(t => t.id === 'chalkboard')!
  expect(isDarkColor(nodePaint('none', 1, { backdrop: 'brush' }, '#EAC5D0', theme).textFill)).toBe(true)
  expect(nodePaint('none', 1, { backdrop: 'brush', color: '#123456' }, '#EAC5D0', theme).textFill).toBe('#123456')
})
