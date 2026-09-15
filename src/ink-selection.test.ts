import { describe, expect, it } from 'vitest'
import { makeInk, worldStroke, inkHit, hitInkAt, tapOrDraw, restyleInk, uniformInkStyle, INK_HIT_TOLERANCE_PX, TAP_SELECT_PX, type Point } from './ink.ts'
import type { InkObject, InkStroke } from './objects.ts'

const stroke = (id: string, points: Point[], width = 3, color = '#333333', opacity = 1): InkStroke => ({ id, points, color, width, opacity })
const horizontal = (): InkObject => makeInk([stroke('h', [{ x: 0, y: 0 }, { x: 200, y: 0 }])])
const dot = (): InkObject => makeInk([stroke('d', [{ x: 10, y: 10 }])])

/** 线段世界坐标中点/端点探针（从 worldStroke 取真实世界坐标，不假定 makeInk 的重排偏移） */
const worldPoints = (ink: InkObject) => worldStroke(ink, ink.strokes[0]).points
const probeMid = (ink: InkObject): Point => { const p = worldPoints(ink); return { x: (p[0].x + p[p.length - 1].x) / 2, y: p[0].y } }

describe('笔画命中（A05：点击/悬停/轻点共用；容差按屏幕像素）', () => {
  it('容差常量符合需求：命中外扩 6 屏幕像素、轻点阈值 3 屏幕像素', () => {
    expect(INK_HIT_TOLERANCE_PX).toBe(6)
    expect(TAP_SELECT_PX).toBe(3)
  })

  it('线段：线上与容差内命中，容差外不命中；50%/100%/200% 缩放表现一致', () => {
    const ink = horizontal()
    for (const k of [0.5, 1, 2]) {
      const mid = probeMid(ink)
      expect(inkHit(ink, mid, INK_HIT_TOLERANCE_PX, k)).toBe(true)
      // 垂直偏移 5 屏幕像素（画布 5/k）：在「可见半宽 1.5 + 6」内 → 命中
      expect(inkHit(ink, { x: mid.x, y: mid.y + 5 / k }, INK_HIT_TOLERANCE_PX, k)).toBe(true)
      // 偏移 20 屏幕像素（画布 20/k）：超出 → 不命中（包围盒内的空白不误选）
      expect(inkHit(ink, { x: mid.x, y: mid.y + 20 / k }, INK_HIT_TOLERANCE_PX, k)).toBe(false)
      // 端点命中；点状笔画在端点处命中
      const end = worldPoints(ink).at(-1)!
      expect(inkHit(ink, end, INK_HIT_TOLERANCE_PX, k)).toBe(true)
      expect(inkHit(dot(), worldPoints(dot())[0], INK_HIT_TOLERANCE_PX, k)).toBe(true)
      const dp = worldPoints(dot())[0]
      expect(inkHit(dot(), { x: dp.x + 40 / k, y: dp.y }, INK_HIT_TOLERANCE_PX, k)).toBe(false)
    }
  })

  it('包围盒空白穿透：多幅笔迹重叠时，上层空白让位、笔画重叠选最上层', () => {
    const bottom = horizontal()
    // 上层一幅笔迹：包围盒与 bottom 重叠，但笔画远离探测点
    const top = makeInk([stroke('t', [{ x: 500, y: 500 }, { x: 700, y: 500 }])])
    top.x = bottom.x + 10; top.y = bottom.y + 10 // 平移盒子但不平移笔画：盒重叠、笔画错开
    const probe = probeMid(bottom)
    // 命中上层空白 → 穿透命中下层
    expect(hitInkAt([bottom, top], probe, INK_HIT_TOLERANCE_PX, 1)).toBe(bottom)
    // 上层笔画真正覆盖探测点 → 选最上层
    const covering = makeInk([stroke('c', [{ x: probe.x - 50, y: probe.y }, { x: probe.x + 50, y: probe.y }], 3, '#000000')])
    expect(hitInkAt([bottom, covering], probe, INK_HIT_TOLERANCE_PX, 1)).toBe(covering)
    expect(hitInkAt([covering, bottom], probe, INK_HIT_TOLERANCE_PX, 1)).toBe(bottom)
    // 都不命中 → null
    expect(hitInkAt([], probe, INK_HIT_TOLERANCE_PX, 1)).toBeNull()
  })

  it('已缩放笔迹命中随缩放换算：缩小后选得中、放大后选区不过宽', () => {
    const ink = horizontal()
    ink.w *= 2; ink.h *= 2 // 放大 200%（源画幅不变）：世界半宽 3、命中半径 6/2=3 → 合计 6 画布像素
    const mid = probeMid(ink)
    expect(inkHit(ink, mid, INK_HIT_TOLERANCE_PX, 2)).toBe(true)
    expect(inkHit(ink, { x: mid.x, y: mid.y + 5 }, INK_HIT_TOLERANCE_PX, 2)).toBe(true) // 5 < 6 命中
    expect(inkHit(ink, { x: mid.x, y: mid.y + 7 }, INK_HIT_TOLERANCE_PX, 2)).toBe(false) // 7 > 6 不命中
  })
})

describe('绘画手势判定（A03/A04：轻点转选择，超阈值仍绘画）', () => {
  it('旧笔迹上轻点 → 选择；空白轻点 → 绘画（点）', () => {
    expect(tapOrDraw(0, true)).toBe('select')
    expect(tapOrDraw(TAP_SELECT_PX, true)).toBe('select')
    expect(tapOrDraw(0, false)).toBe('draw')
  })

  it('超过阈值即绘画：即使光标回到按下点（最大位移判定）', () => {
    expect(tapOrDraw(TAP_SELECT_PX + 0.1, true)).toBe('draw')
    expect(tapOrDraw(80, true)).toBe('draw')
    expect(tapOrDraw(80, false)).toBe('draw')
  })
})

describe('整幅笔迹样式（A09：只改操作的属性；混合态；缩放后不跳位不裁切）', () => {
  it('只改颜色：所有笔画变色，粗细、透明度、几何原样保留', () => {
    const ink = makeInk([stroke('a', [{ x: 0, y: 0 }, { x: 100, y: 0 }], 2, '#ff0000'), stroke('b', [{ x: 0, y: 20 }, { x: 100, y: 20 }], 8, '#00ff00', 0.35)])
    const next = restyleInk(ink, { color: '#123456' })
    expect(next.strokes.map(s => s.color)).toEqual(['#123456', '#123456'])
    expect(next.strokes.map(s => s.width)).toEqual([2, 8])
    expect(next.strokes.map(s => s.opacity)).toEqual([1, 0.35])
    expect(next.x).toBe(ink.x); expect(next.y).toBe(ink.y)
    expect(next.w).toBe(ink.w); expect(next.h).toBe(ink.h)
    expect(next.strokes).toEqual(ink.strokes.map(s => ({ ...s, color: '#123456' })))
  })

  it('只改粗细：所有笔画变粗，颜色、透明度保留', () => {
    const ink = makeInk([stroke('a', [{ x: 0, y: 0 }, { x: 100, y: 0 }], 2, '#ff0000', 0.35), stroke('b', [{ x: 0, y: 20 }, { x: 100, y: 20 }], 8, '#00ff00', 1)])
    const next = restyleInk(ink, { width: 10 })
    expect(next.strokes.map(s => s.width)).toEqual([10, 10])
    expect(next.strokes.map(s => s.color)).toEqual(['#ff0000', '#00ff00'])
    expect(next.strokes.map(s => s.opacity)).toEqual([0.35, 1])
  })

  it('混合态检测：一致返回该值，不一致返回 null', () => {
    const mixed = makeInk([stroke('a', [{ x: 0, y: 0 }, { x: 10, y: 0 }], 2, '#ff0000'), stroke('b', [{ x: 0, y: 20 }, { x: 10, y: 20 }], 8, '#ff0000')])
    expect(uniformInkStyle(mixed)).toEqual({ color: '#ff0000', width: null })
    const uniformed = restyleInk(mixed, { width: 5 })
    expect(uniformInkStyle(uniformed)).toEqual({ color: '#ff0000', width: 5 })
    expect(uniformInkStyle({ ...mixed, strokes: [] })).toEqual({ color: null, width: null })
  })

  it('已缩放笔迹改粗细：笔画世界坐标与缩放比不变，边距足以容纳新宽度', () => {
    const ink = horizontal()
    ink.w *= 2; ink.h *= 2 // 200% 放大态
    const before = worldStroke(ink, ink.strokes[0])
    const next = restyleInk(ink, { width: 12 })
    // 缩放比不变
    expect(next.w / next.sourceWidth).toBeCloseTo(ink.w / ink.sourceWidth, 9)
    expect(next.h / next.sourceHeight).toBeCloseTo(ink.h / ink.sourceHeight, 9)
    // 世界坐标不跳位（浮点误差容 1e-9）
    const after = worldStroke(next, next.strokes[0])
    before.points.forEach((p, i) => {
      expect(after.points[i].x).toBeCloseTo(p.x, 9)
      expect(after.points[i].y).toBeCloseTo(p.y, 9)
    })
    // 新边距（makeInk 同款：外扩 max(4, 最大宽度)）覆盖所有笔画，不再被包围盒裁切
    for (const p of next.strokes[0].points) {
      expect(p.x).toBeGreaterThanOrEqual(12 - 1e-9)
      expect(next.sourceWidth - p.x).toBeGreaterThanOrEqual(12 - 1e-9)
    }
  })

  it('宽度不需要更多边距时几何完全不动', () => {
    const ink = makeInk([stroke('a', [{ x: 0, y: 0 }, { x: 100, y: 0 }], 8, '#ff0000')])
    const next = restyleInk(ink, { width: 4 })
    expect(next.x).toBe(ink.x); expect(next.y).toBe(ink.y)
    expect(next.w).toBe(ink.w); expect(next.h).toBe(ink.h)
    expect(next.sourceWidth).toBe(ink.sourceWidth); expect(next.sourceHeight).toBe(ink.sourceHeight)
  })
})
