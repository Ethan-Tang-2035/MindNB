import { describe, it, expect } from 'vitest'
import {
  PAPER_STYLES,
  spacingOf,
  paperTileSpec,
  isDarkColor,
  type PaperStyleId,
} from './paper.ts'
import { PAPER_CHOICES, DARK_PAPERS, pairedInkFor } from './theme.ts'

const NON_BLANK: Array<Exclude<PaperStyleId, 'blank'>> = ['ruled', 'grid', 'secGrid', 'dots', 'wavyRuled']

describe('纸型词表（v14 票 01，ADR-0010）', () => {
  it('6 种纸型包含可显式选择的空白', () => {
    expect(PAPER_STYLES.map((s) => s.id)).toEqual(['blank', 'ruled', 'grid', 'secGrid', 'dots', 'wavyRuled'])
  })

  it('密度：密 < 疏；已知档位（34 疏 → 20 密）', () => {
    for (const s of NON_BLANK) {
      expect(spacingOf(s, 'dense')).toBeLessThan(spacingOf(s, 'loose'))
    }
    expect(spacingOf('ruled', 'loose')).toBe(34)
    expect(spacingOf('ruled', 'dense')).toBe(20)
    expect(spacingOf('dots', 'dense')).toBe(16)
  })
})

describe('paperTileSpec：渲染与导出共用的瓦片规格', () => {
  it('blank → 空 spec（渲染端不建 pattern 层，R1 回归线）', () => {
    const t = paperTileSpec('blank', 'loose')
    expect(t.paths).toHaveLength(0)
    expect(t.dots).toHaveLength(0)
  })

  it('确定性：同参两次调用深等（恒定种子，画布与导出位图一致）', () => {
    for (const s of NON_BLANK) {
      for (const d of ['loose', 'dense'] as const) {
        expect(paperTileSpec(s, d)).toEqual(paperTileSpec(s, d))
      }
    }
  })

  it('几何合法：pts 在瓦片内（±2 抖动容差）、o∈(0,1)、w>0；dots r>0', () => {
    for (const s of NON_BLANK) {
      const t = paperTileSpec(s, 'loose')
      expect(t.size).toBeGreaterThan(0)
      for (const p of t.paths) {
        expect(p.w).toBeGreaterThan(0)
        expect(p.o).toBeGreaterThan(0)
        expect(p.o).toBeLessThan(1)
        for (const [x, y] of p.pts) {
          expect(x).toBeGreaterThanOrEqual(-2)
          expect(x).toBeLessThanOrEqual(t.size + 2)
          expect(y).toBeGreaterThanOrEqual(-2)
          expect(y).toBeLessThanOrEqual(t.size + 2)
        }
      }
      for (const d of t.dots) {
        expect(d.r).toBeGreaterThan(0)
        expect(d.o).toBeGreaterThan(0)
        expect(d.o).toBeLessThan(1)
      }
    }
  })

  it('重复瓦片的横纵笔画在两档密度下首尾连续', () => {
    for (const style of NON_BLANK) {
      for (const density of ['loose', 'dense'] as const) {
        const tile = paperTileSpec(style, density)
        for (const { pts } of tile.paths) {
          const first = pts[0], last = pts[pts.length - 1]
          if (first[0] === 0 && last[0] === tile.size) {
            expect(last[1], `${style}/${density} 横线接缝`).toBe(first[1])
          } else {
            expect(first[1]).toBe(0)
            expect(last[1]).toBe(tile.size)
            expect(last[0], `${style}/${density} 竖线接缝`).toBe(first[0])
          }
        }
      }
    }
  })

  it('波浪横线 ≠ 横线：笔画起伏更大', () => {
    const ruled = paperTileSpec('ruled', 'loose')
    const wavy = paperTileSpec('wavyRuled', 'loose')
    const flat = Math.max(...ruled.paths[0].pts.map(([, y]) => Math.abs(y - (ruled.size - 1))))
    const wave = Math.max(...wavy.paths[0].pts.map(([, y]) => Math.abs(y - (wavy.size - 1))))
    expect(wave).toBeGreaterThan(flat * 1.5)
  })

  it('手账方眼：细格(0.08) + 粗格(0.2) 两组，粗格 2 笔（边缘线）；票 05 全体低对比', () => {
    const t = paperTileSpec('secGrid', 'loose')
    const fine = t.paths.filter((p) => p.o === 0.08)
    const bold = t.paths.filter((p) => p.o === 0.2)
    expect(fine.length).toBeGreaterThan(0)
    expect(bold).toHaveLength(2)
    expect(fine.every((p) => p.w < bold[0].w)).toBe(true)
    // 票 05：对比度上限护栏 —— 任何纹样笔画不透明度不超过 0.25（正文优先级高于纸底）
    for (const style of ['ruled', 'grid', 'secGrid', 'wavyRuled'] as const) {
      for (const p of paperTileSpec(style, 'loose').paths) expect(p.o).toBeLessThan(0.25)
    }
    expect(paperTileSpec('dots', 'loose').dots[0].o).toBeLessThan(0.25)
  })

  it('点阵：恰好 1 圆点居中', () => {
    const t = paperTileSpec('dots', 'loose')
    expect(t.paths).toHaveLength(0)
    expect(t.dots).toHaveLength(1)
    expect(t.dots[0].x).toBeCloseTo(t.size / 2)
    expect(t.dots[0].y).toBeCloseTo(t.size / 2)
  })
})

describe('暗色判定与配套墨（ADR-0011）', () => {
  it('isDarkColor：暗纸/暗墨 true，浅纸/浅墨 false', () => {
    expect(isDarkColor('#2A2A33')).toBe(true) // 夜航纸
    expect(isDarkColor('#23232B')).toBe(true) // 炭黑
    expect(isDarkColor('#4A3F35')).toBe(true) // 蜡笔墨
    expect(isDarkColor('#FBF1DC')).toBe(false) // 蜡笔纸
    expect(isDarkColor('#ECE7DA')).toBe(false) // 炭黑配套浅墨
    expect(isDarkColor('#F7E2DE')).toBe(false) // 马卡龙粉
  })

  it('不变式：PAPER_CHOICES 中每个暗色纸都必须登记配套浅墨（缺一即面板联动漏色）', () => {
    for (const c of PAPER_CHOICES) {
      if (isDarkColor(c)) {
        expect(pairedInkFor(c)).toBeDefined()
      }
    }
    expect(DARK_PAPERS.length).toBeGreaterThanOrEqual(3)
  })

  it('pairedInkFor 大小写不敏感；浅色纸返回 undefined', () => {
    expect(pairedInkFor('#23232b')).toBe('#ECE7DA')
    expect(pairedInkFor('#23232B')).toBe('#ECE7DA')
    expect(pairedInkFor('#FBF1DC')).toBeUndefined()
    expect(pairedInkFor('#F7E2DE')).toBeUndefined()
  })
})
