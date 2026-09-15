import { describe, it, expect } from 'vitest'
import { LEVEL_STYLES, levelStyle, effectiveStyle } from './levels.ts'

describe('层级样式表（视觉数值锁）', () => {
  it('三级样式数值与设计共识一致（防静默视觉漂移）', () => {
    expect(LEVEL_STYLES[0]).toEqual({ fontPx: 26, weight: 700, lineH: 36, textH: 48, boxH: 92, padX: 32, maxTextW: 220, minTextW: 120 })
    expect(LEVEL_STYLES[1]).toEqual({ fontPx: 19, weight: 500, lineH: 28, textH: 24, boxH: 48, padX: 20, maxTextW: 220 })
    expect(LEVEL_STYLES[2]).toEqual({ fontPx: 17, weight: 400, lineH: 24, textH: 20, boxH: 34, padX: 9, maxTextW: 220 })
  })

  it('深层节点沿用最深层样式', () => {
    expect(levelStyle(2)).toBe(LEVEL_STYLES[2])
    expect(levelStyle(5)).toBe(LEVEL_STYLES[2])
  })
})

describe('固定宽度（v9 票 06）：levels 折行宽反推', () => {
  const base = LEVEL_STYLES[1] // depth 1：padX 20、maxTextW 220

  it('width=200 → maxTextW = 200 - padX*2（无徽章）', () => {
    const s = effectiveStyle(1, { width: 200 })
    expect(s.maxTextW).toBe(200 - 20 * 2)
  })

  it('徽章占位再扣除；钳位 60~600；下限保护 40', () => {
    const s = effectiveStyle(1, { width: 200, deco: { badge: '1' } })
    expect(s.maxTextW).toBe(200 - 20 * 2 - (Math.round(base.fontPx * 1) * 1.6 + 4))
    expect(effectiveStyle(1, { width: 9999 }).maxTextW).toBe(600 - 20 * 2)
    expect(effectiveStyle(1, { width: 10 }).maxTextW).toBe(40) // 下限保护
    expect(effectiveStyle(1, { width: 60, size: 'xl' }).maxTextW).toBeGreaterThanOrEqual(40)
  })

  it('无 width 时折行宽不变（回归线）', () => {
    expect(effectiveStyle(1, {}).maxTextW).toBe(220)
  })
})
