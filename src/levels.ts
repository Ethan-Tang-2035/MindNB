/** 层级样式表：层级 → 字体/字重/盒高/内边距 的唯一事实源。
 * 被 layout（包围盒）、render（字体测量）、main（编辑框字号）共用；
 * 改这里就是改视觉 —— levels.test.ts 锁死数值防意外漂移。 */

import type { NodeStyle } from './model.ts'
import type { FontId } from './fonts.ts'

/** 节点形状：层级默认 + 节点覆盖共用词表（椭圆/圆角框/下划线/无框纯文字） */
export type NodeShape = 'ellipse' | 'rounded' | 'underline' | 'none' | 'cloud' | 'bubble' | 'burst' | 'banner' | 'dashed'

/** 层级默认形状 */
export function defaultShapeOf(depth: number): NodeShape {
  return depth === 0 ? 'ellipse' : depth === 1 ? 'rounded' : 'none'
}

export interface LevelStyle {
  font?: FontId
  /** 字号 px */
  fontPx: number
  /** 字重（SVG font-weight） */
  weight: number
  /** 单行行高（多行盒高 = max(boxH, 行数×lineH)） */
  lineH: number
  /** 文字标称高（单行测量回填） */
  textH: number
  /** 节点包围盒高（单行时） */
  boxH: number
  /** 水平内边距（盒宽 = 文字宽 + padX×2） */
  padX: number
  /** 自动折行的最大文字宽 */
  maxTextW: number
  /** 最小文字宽（仅中心主题） */
  minTextW?: number
}

export const LEVEL_STYLES: LevelStyle[] = [
  { fontPx: 26, weight: 700, lineH: 36, textH: 48, boxH: 92, padX: 32, maxTextW: 220, minTextW: 120 }, // depth 0 中心主题
  { fontPx: 19, weight: 500, lineH: 28, textH: 24, boxH: 48, padX: 20, maxTextW: 220 }, // depth 1 一级分支
  { fontPx: 17, weight: 400, lineH: 24, textH: 20, boxH: 34, padX: 9, maxTextW: 220 }, // depth ≥2 深层节点
]

export const CLEAR_LEVEL_STYLES: LevelStyle[] = [
  { fontPx: 36, weight: 700, lineH: 40, textH: 40, boxH: 96, padX: 32, maxTextW: 360, minTextW: 300 },
  { fontPx: 28, weight: 700, lineH: 32, textH: 32, boxH: 68, padX: 24, maxTextW: 260, minTextW: 128 },
  { fontPx: 21, weight: 400, lineH: 27, textH: 27, boxH: 34, padX: 10, maxTextW: 280 },
]

/** 深于 2 层沿用最深层样式 */
export const levelStyle = (depth: number): LevelStyle => LEVEL_STYLES[Math.min(depth, LEVEL_STYLES.length - 1)]

/** 字号档位 → 乘数（相对层级基准） */
export type SizeStep = NodeStyle['size']
const SIZE_MULT: Record<NonNullable<SizeStep>, number> = { s: 0.82, m: 1, l: 1.22, xl: 1.48 }

/** 生效样式 = 层级基准 ⊕ 节点样式覆盖：字号档位整体乘算（含行高/盒高/内边距/折行宽，
 * 保证大字节点折行与盒算同步放大），bold 直接压 700。无覆盖时返回基准本身。 */
export function effectiveStyle(depth: number, st?: NodeStyle): LevelStyle {
  depth = st?.layoutDepth ?? depth
  const profile = st?.visualStyle === 'clear' ? CLEAR_LEVEL_STYLES[Math.min(depth, 2)] : levelStyle(depth)
  const fontScale = st?.fontSize ? st.fontSize / profile.fontPx : 1
  const base = st?.fontSize ? { ...profile, fontPx: st.fontSize, lineH: Math.round(profile.lineH * fontScale), textH: Math.round(profile.textH * fontScale), boxH: Math.round(profile.boxH * fontScale) } : profile
  if (!st) return base
  const m = st.size ? SIZE_MULT[st.size] : 1
  const scaled: LevelStyle = {
    ...base,
    ...(st.font ? { font: st.font } : {}),
    fontPx: Math.round(base.fontPx * m),
    weight: st.bold === undefined ? base.weight : st.bold ? 700 : 400,
    lineH: Math.round(base.lineH * m),
    textH: Math.round(base.textH * m),
    boxH: Math.round(base.boxH * m),
    padX: Math.round(base.padX * m),
    maxTextW: Math.round(base.maxTextW * m),
    minTextW: base.minTextW === undefined ? undefined : Math.round(base.minTextW * m),
  }
  if (st.visualStyle === 'clear' && depth >= 2 && st.shape === 'rounded') {
    scaled.boxH = Math.max(scaled.boxH, 46 * m)
    scaled.padX = 24 * m
    scaled.minTextW = 48 * m
  }
  // 固定宽度（v9 票 06）：折行宽从盒宽反推（扣除内边距与徽章占位）——
  // measure/wrap 路径同参数，文本在固定盒内按 maxTextW 折行（boxSize 的盒宽直接取固定值）
  if (st.width !== undefined) {
    const fixedW = Math.min(600, Math.max(60, st.width))
    const badgeW = st.deco?.badge ? scaled.fontPx * 1.6 + 4 : 0
    scaled.maxTextW = Math.max(40, fixedW - scaled.padX * 2 - badgeW)
  }
  if (st.wrapWidth !== undefined) scaled.maxTextW = Math.max(1, Math.min(2000, st.wrapWidth))
  return scaled
}

/** 生效形状 = 节点覆盖 ?? 层级默认 */
export function effectiveShape(depth: number, st?: NodeStyle): NodeShape {
  depth = st?.layoutDepth ?? depth
  return st?.shape ?? (st?.visualStyle === 'clear' ? (depth < 2 ? 'rounded' : 'underline') : defaultShapeOf(depth))
}
