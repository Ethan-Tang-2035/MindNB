import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { PageOutput } from './page-output.ts'
import { emptyTree } from './model.ts'
import { createPage } from './paper-pages.ts'

const png = new Blob([new Uint8Array(readFileSync(new URL('../tests/fixtures/monday.png', import.meta.url)))], { type: 'image/png' })
const measure = (text: string) => ({ w: text.length * 10, h: 24 })

it('uses document page order and the exact preview bytes without editing the source', async () => {
  const a = createPage(emptyTree(), { x: 1000, y: 0 }), b = createPage(a.map, { x: 0, y: 0 })
  const before = structuredClone(b.map)
  let renders = 0
  const output = new PageOutput(b.map, { pageIds: [b.id, a.id], format: 'png', width: 1080, fit: false }, { measure, raster: async () => { renders++; return png } })
  const preview = await output.render(a.id)
  b.map.pages![0].name = 'changed after snapshot'
  const files = await output.files('notebook')
  expect(files.map(f => f.name.slice(0, 2))).toEqual(['01', '02'])
  expect(files[0].name).not.toContain('changed')
  expect(files[0].blob).toBe(preview.blob)
  expect(renders).toBe(2)
  expect(before.pages![0].x).toBe(1000)
})

it('bounds large PDF paper dimensions and produces deterministic output', async () => {
  const { map, id } = createPage(emptyTree(), { x: 0, y: 0 })
  map.pages![0].w = 20000; map.pages![0].h = 20000
  const make = () => new PageOutput(map, { pageIds: [id], format: 'pdf', width: 100, fit: false }, { measure, raster: async () => png })
  const first = await make().files('large'), second = await make().files('large')
  const bytes = new Uint8Array(await first[0].blob.arrayBuffer())
  expect(new Uint8Array(await second[0].blob.arrayBuffer())).toEqual(bytes)
  expect(Buffer.from(bytes).toString('latin1')).toMatch(/\/MediaBox \[0 0 14000\. 14000\.\]/)
})

it('rejects empty or unknown selections and does not deliver partial files after a raster failure', async () => {
  const a = createPage(emptyTree(), { x: 0, y: 0 }), b = createPage(a.map, { x: 1000, y: 0 })
  const options = { pageIds: [], format: 'png' as const, width: 1080, fit: false }, drawing = { measure, raster: async () => png }
  expect(() => new PageOutput(b.map, options, drawing)).toThrow(/至少一张/)
  expect(() => new PageOutput(b.map, { ...options, pageIds: ['missing'] }, drawing)).toThrow(/不存在/)
  const output = new PageOutput(b.map, { ...options, pageIds: [a.id, b.id] }, { measure, raster: async (_map, options) => { if (options.pageId === b.id) throw new Error('missing image'); return png } })
  await expect(output.render(a.id)).resolves.toMatchObject({ blob: png })
  await expect(output.files('partial')).rejects.toThrow('missing image')
})
