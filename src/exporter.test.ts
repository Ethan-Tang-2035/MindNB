import { afterEach, expect, it, vi } from 'vitest'
import { exportPNG, exportSize, planPNGExport } from './exporter.ts'
import type { MindMap } from './model.ts'

afterEach(() => vi.unstubAllGlobals())

function topicMap(x: number): MindMap {
  return {
    root: { id: 'root', text: 'Root', seed: 1, children: [], style: { width: 80, shape: 'rounded' } },
    topics: [{
      node: { id: 'topic', text: 'Topic', seed: 2, children: [], style: { width: 80, shape: 'rounded' } },
      x, y: 314, layoutMode: 'right',
    }],
  }
}

it.each([
  { x: 280, delta: -280, symptom: 'extra gap' },
  { x: 600, delta: 40, symptom: 'overlap' },
])('exports a 960px canvas in a 1280px window without $symptom', async ({ x, delta }) => {
  const ctx = {
    measureText: () => ({ width: 10 }),
    save: vi.fn(), restore: vi.fn(), scale: vi.fn(), translate: vi.fn(), fillRect: vi.fn(),
    fill: vi.fn(), stroke: vi.fn(), setLineDash: vi.fn(), fillText: vi.fn(),
  }
  const canvas = {
    width: 0, height: 0,
    getContext: () => ctx,
    toBlob: (callback: BlobCallback) => callback(new Blob([], { type: 'image/png' })),
  }
  vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 720 })
  vi.stubGlobal('document', { createElement: () => canvas, fonts: { load: vi.fn().mockResolvedValue([]) } })
  vi.stubGlobal('Path2D', class {})

  const blob = await exportPNG(topicMap(x), { width: 960, height: 720 })

  const root = ctx.fillText.mock.calls.find(([text]) => text === 'Root')!
  const topic = ctx.fillText.mock.calls.find(([text]) => text === 'Topic')!
  expect(topic[1] - root[1]).toBe(delta)
  expect(topic[2] - root[2]).toBe(-40)
  expect(canvas.width).toBe(x===280?880:400)
  expect(canvas.height).toBe(424)
  expect(blob.type).toBe('image/png')
})

it('plans export in stable world coordinates, independent of viewport size', () => {
  const plan = planPNGExport(topicMap(600), { width: 960, height: 600 }, () => ({ w: 10, h: 36 }))

  expect(planPNGExport(topicMap(600), {width:1920,height:1080}, () => ({w:10,h:36}))).toEqual(plan)
  expect(plan.layout.root).toMatchObject({ x: 560, y: 354, w: 80, h: 92 })
  expect(plan.layout.nodes.find(n => n.id === 'topic')).toMatchObject({ x: 600, y: 314, w: 80, h: 92 })
  expect(plan.bounds).toEqual({ minX: 560, minY: 314, maxX: 680, maxY: 446 })
  expect(plan.width).toBe(200)
  expect(plan.height).toBe(212)
  expect(plan.size).toEqual({ width: 400, height: 424, scale: 2 })
})

it('exports ordinary documents at double resolution', () => {
  expect(exportSize(800, 600)).toEqual({ width: 1600, height: 1200, scale: 2 })
})

it('fits large multi-topic documents within browser bitmap limits without clipping', () => {
  const result = exportSize(50000, 4000)
  expect(result.width).toBe(8192)
  expect(result.height).toBeLessThanOrEqual(8192)
  expect(result.width / result.scale).toBeCloseTo(50000)
  expect(result.height / result.scale).toBeGreaterThanOrEqual(4000)
})
