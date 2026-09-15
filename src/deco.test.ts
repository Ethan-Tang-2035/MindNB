/** deco.ts 几何单测（票据 09 重构：render/exporter 共用「画什么」层） */
import { describe, expect, it } from 'vitest'
import { blockGeom, highlightLineDs, wavyD, badgeGeom, strikeDs, textLayoutOf, braceD } from './deco.ts'

const geom = (lineWs: number[], centered = true) =>
  blockGeom(lineWs, { centered, side: 'right', x: 100, w: 400, midY: 200, lineH: 24 })


describe('blockGeom', () => {
  it('居中：块左缘按最长行居中', () => {
    const g = geom([100, 60])
    expect(g.width).toBe(100)
    expect(g.left).toBe(100 + 200 - 50)
    expect(g.height).toBe(48)
    expect(g.top).toBe(200 - 24)
  })

  it('随文对齐（深层节点右行）：块贴左缘 x+6', () => {
    const g = geom([80], false)
    expect(g.left).toBe(106)
  })

  it('随文对齐（左行）：块右缘贴 x+w-6', () => {
    const g = blockGeom([80], { centered: false, side: 'left', x: 100, w: 400, midY: 200, lineH: 24 })
    expect(g.left).toBe(100 + 400 - 6 - 80)
  })
})

describe('highlightLineDs（票据 09 口径=逐行）', () => {
  it('每行一片；各行 x 随行宽在块内居中；互不越块', () => {
    const g = geom([100, 60])
    const ds = highlightLineDs(g, 42)
    expect(ds).toHaveLength(2)
    expect(highlightLineDs(g, 42)).toEqual(ds) // 种子稳定
    // 行片高度 = 行高-2、行距恰好 lineH（y 逐行推进）
    expect(ds[0]).toMatch(/^M/)
  })
})

describe('wavyD / badgeGeom', () => {
  it('波浪线起于块左缘底缘下方，含 Q 波段', () => {
    const d = wavyD(geom([120]))
    expect(d.startsWith('M')).toBe(true)
    expect(d).toContain('Q')
  })

  it('徽章圆心在块左缘外 r+4、首行行中；半径=0.72×字号', () => {
    const bg = badgeGeom(geom([120]), 24, 20)
    expect(bg.r).toBeCloseTo(14.4)
    const g = geom([120])
    expect(bg.cx).toBeCloseTo(g.left - bg.r - 4)
    expect(bg.cy).toBeCloseTo(g.top + 12)
  })
})

describe('strikeDs（v9 票 03：删除线）', () => {
  it('每行一道；y 在各行行中；种子稳定', () => {
    const g = geom([100, 60])
    const ds = strikeDs(g, 42)
    expect(ds).toHaveLength(2)
    expect(strikeDs(g, 42)).toEqual(ds)
    expect(ds[0]).toMatch(/^M/)
  })
})

describe('textLayoutOf（v9 票 03：对齐）', () => {
  it('盒形缺省居中：anchor middle、x 盒心', () => {
    const tl = textLayoutOf('rounded', undefined, 'right', { x: 100, w: 400 })
    expect(tl.centered).toBe(true)
    expect(tl.anchor).toBe('middle')
    expect(tl.x).toBe(300)
    expect(tl.canvasAlign).toBe('center')
  })
  it('显式左对齐：块贴左缘、anchor start', () => {
    const tl = textLayoutOf('rounded', 'left', 'left', { x: 100, w: 400 })
    expect(tl.centered).toBe(false)
    expect(tl.geomSide).toBe('right')
    expect(tl.anchor).toBe('start')
    expect(tl.x).toBe(106)
    expect(tl.canvasAlign).toBe('left')
  })
  it('无框形状缺省随文：右行=左对齐贴 x+6，左行=右对齐贴 x+w-6', () => {
    const r = textLayoutOf('none', undefined, 'right', { x: 100, w: 400 })
    expect(r.anchor).toBe('start')
    expect(r.x).toBe(106)
    const l = textLayoutOf('none', undefined, 'left', { x: 100, w: 400 })
    expect(l.anchor).toBe('end')
    expect(l.x).toBe(494)
  })
  it('显式对齐覆盖随文默认', () => {
    const tl = textLayoutOf('none', 'center', 'right', { x: 100, w: 400 })
    expect(tl.centered).toBe(true)
    expect(tl.anchor).toBe('middle')
  })
})

describe('braceD（v9 票 10：概要括号）', () => {
  it('一笔双臂：M 起于顶、含两段 C、终于底；dir=-1 镜像', () => {
    const d = braceD(100, 10, 110, 14, 1)
    expect(d.startsWith('M 100 10')).toBe(true)
    expect(d.split('C')).toHaveLength(3)
    expect(braceD(100, 10, 110, 14, -1)).not.toBe(d)
  })
})
