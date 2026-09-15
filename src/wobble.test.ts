import { describe, it, expect } from 'vitest'
import { rng, hashSeed, wobbleLine, wobbleCurve, wobbleEllipse, wobbleRoundRect, wobbleElbow, smoothClosedPath } from './wobble.ts'

describe('wobble 生成器（手绘形状接缝）', () => {
  it('同一种子产出完全相同的路径（稳定可复现）', () => {
    expect(wobbleLine(0, 0, 300, 0, 42)).toBe(wobbleLine(0, 0, 300, 0, 42))
    expect(wobbleCurve(0, 0, 300, 120, 42)).toBe(wobbleCurve(0, 0, 300, 120, 42))
    expect(wobbleEllipse(100, 100, 60, 30, 7)).toBe(wobbleEllipse(100, 100, 60, 30, 7))
    expect(wobbleRoundRect(0, 0, 120, 44, 14, 9)).toBe(wobbleRoundRect(0, 0, 120, 44, 14, 9))
  })

  it('不同种子产出不同路径（手绘感）', () => {
    expect(wobbleLine(0, 0, 300, 0, 42)).not.toBe(wobbleLine(0, 0, 300, 0, 43))
    expect(wobbleEllipse(100, 100, 60, 30, 7)).not.toBe(wobbleEllipse(100, 100, 60, 30, 8))
  })

  it('路径是合法的 SVG path：M 开头、含贝塞尔段', () => {
    for (const d of [
      wobbleLine(0, 0, 300, 120, 1),
      wobbleEllipse(0, 0, 50, 25, 2),
      wobbleRoundRect(0, 0, 100, 40, 10, 3),
    ]) {
      expect(d.startsWith('M ')).toBe(true)
      expect(d).toContain(' C ')
    }
    expect(smoothClosedPath([])).toBe('')
  })

  it('曲线连线：两端仍在锚点附近，中段明显偏离直线（自然弧线）', () => {
    const d = wobbleCurve(0, 0, 300, 120, 42, 0)
    expect(d.startsWith('M ')).toBe(true)
    expect(d).toContain(' C ')
    // 直线中点 (150,60)：曲线中段应有明显偏离（水平切线的三次贝塞尔特性）
    const nums = d.match(/-?[\d.]+/g)!.map(Number)
    let maxDev = 0
    for (let i = 2; i < nums.length - 2; i += 2) {
      const x = nums[i]
      const y = nums[i + 1]
      if (x > 40 && x < 260) maxDev = Math.max(maxDev, Math.abs(y - (x * 120) / 300))
    }
    expect(maxDev).toBeGreaterThan(10)
  })

  it('hashSeed 对同一字符串稳定', () => {
    expect(hashSeed('n1')).toBe(hashSeed('n1'))
    expect(hashSeed('n1')).not.toBe(hashSeed('n2'))
  })

  it('rng 输出落在 [0,1)', () => {
    const rand = rng(123)
    for (let i = 0; i < 1000; i++) {
      const v = rand()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('wobbleElbow 折线连线', () => {
  it('同种子同路径（形状稳定）；首尾钉在端点附近；含平滑曲线段', () => {
    const a = wobbleElbow(0, 0, 200, 80, 42)
    const b = wobbleElbow(0, 0, 200, 80, 42)
    expect(a).toBe(b)
    expect(a.startsWith('M ')).toBe(true)
    expect(a).toContain(' C ')
    const m = /M (-?[\d.]+) (-?[\d.]+)/.exec(a)!
    expect(Math.hypot(+m[1], +m[2])).toBeLessThan(2)
    const last = a.trim().split(' ').slice(-2).map(Number)
    expect(Math.hypot(last[0] - 200, last[1] - 80)).toBeLessThan(2)
  })
})

import { wobbleArc, wobbleCloud, wobbleBubble, wobbleBurst, wobbleBanner } from './wobble.ts'

describe('v9 海报形状（票据 05/07）', () => {
  it('wobbleArc：种子稳定、端点扰动不偏离、方向无关', () => {
    const a = wobbleArc(0, 0, 300, 200, 42)
    const b = wobbleArc(0, 0, 300, 200, 42)
    expect(a).toBe(b)
    expect(wobbleArc(0, 0, 300, 200, 43)).not.toBe(a)
    // 首尾扰动减半（±0.4·amp）：起点仍在端点 ~1px 邻域内
    const m = /^M (-?[\d.]+) (-?[\d.]+)/.exec(a)!
    expect(Math.abs(parseFloat(m[1]))).toBeLessThan(1)
    expect(Math.abs(parseFloat(m[2]))).toBeLessThan(1)
    // 纵向线也能出弧（方向无关）
    expect(wobbleArc(0, 0, 0, 300, 42)).toMatch(/^M/)
  })

  it('wobbleCloud/Bubble/Burst/Banner：确定性 + 合法路径', () => {
    const fns = [
      () => wobbleCloud(100, 100, 80, 50, 7),
      () => wobbleBubble(10, 10, 200, 80, 7),
      () => wobbleBurst(100, 100, 90, 70, 7),
      () => wobbleBanner(10, 10, 300, 50, 7),
    ]
    for (const f of fns) {
      expect(f()).toBe(f())
      expect(f()).toMatch(/^M/)
    }
    // 气泡带尾巴（框路径外的下沉段）
    expect(wobbleBubble(10, 10, 200, 80, 7)).toContain('L')
    // 云/星闭合
    expect(wobbleCloud(100, 100, 80, 50, 7).endsWith('Z')).toBe(true)
    expect(wobbleBurst(100, 100, 90, 70, 7).endsWith('Z')).toBe(true)
  })
})
