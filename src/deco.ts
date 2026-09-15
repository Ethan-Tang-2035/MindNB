/** 节点装饰与文字块几何（render/exporter 共用的「画什么」层，ADR-0003 票据 09）：
 * 这里只回答「画什么、摆哪里」（返回路径 d 串与坐标），SVG 与 canvas 各自负责「怎么画」。
 * 徽章占位口径与 layout.boxSize 的加宽（fontPx*1.6+4）必须同步。 */

import { round2, wobbleLine, wobbleRoundRect } from './wobble.ts'
import type { NodeShape } from './levels.ts'

/** 文字块几何：行宽实测后的块左缘/块顶/块宽高（锚点分侧：居中形状居中，下划线/无框随文对齐）。
 * centered/lineH 随块走（Data Clumps 收口）：装饰函数不再让调用方复传。 */
export interface TextBlockGeom {
  left: number
  top: number
  width: number
  height: number
  lineWs: number[]
  centered: boolean
  lineH: number
}

export function blockGeom(
  lineWs: number[],
  opts: { centered: boolean; side: 'left' | 'right'; x: number; w: number; midY: number; lineH: number },
): TextBlockGeom {
  const width = Math.max(0, ...lineWs)
  const height = lineWs.length * opts.lineH
  const left = opts.centered
    ? opts.x + opts.w / 2 - width / 2
    : opts.side === 'right'
      ? opts.x + 6
      : opts.x + opts.w - 6 - width
  return { left, top: opts.midY - height / 2, width, height, lineWs, centered: opts.centered, lineH: opts.lineH }
}

/** 行内左缘：居中文本各行居中收窄，随文对齐各行贴块缘 */
export function lineLeft(g: TextBlockGeom, i: number): number {
  return g.centered ? g.left + (g.width - g.lineWs[i]) / 2 : g.left
}

/** 荧光高亮：逐行底色手绘圆角片（票据 09 口径=逐行；不改布局） */
export function highlightLineDs(g: TextBlockGeom, seed: number): string[] {
  return g.lineWs.map((lw, i) => {
    const lx = lineLeft(g, i)
    const ly = g.top + i * g.lineH + 1
    return wobbleRoundRect(lx - 3, ly, lw + 6, g.lineH - 2, 5, (seed ^ (0x68e31da4 + i)) >>> 0, 1)
  })
}

/** 波浪线：文字块底缘一道 Q 波（宽随块宽） */
export function wavyD(g: TextBlockGeom): string {
  const y = g.top + g.height + 4
  const amp = 2.4
  const waves = Math.max(2, Math.round(g.width / 14))
  const step = g.width / waves
  let d = `M ${round2(g.left)} ${round2(y)}`
  for (let i = 0; i < waves; i++) {
    const x0 = g.left + i * step
    d += ` Q ${round2(x0 + step / 2)} ${round2(y + (i % 2 === 0 ? amp : -amp))} ${round2(x0 + step)} ${round2(y)}`
  }
  return d
}

/** 编号徽章摆放：首行行首圆（占位口径与 layout.boxSize 的 badgeW 同源） */
export function badgeGeom(g: TextBlockGeom, lineH: number, fontPx: number): { cx: number; cy: number; r: number } {
  const r = fontPx * 0.72
  return { cx: g.left - r - 4, cy: g.top + lineH / 2, r }
}

/** 概要大括号（v9 票 10）：双臂单尖点，一笔 C 曲线；dir=1 尖点朝右（内容在左，像「⎫」收拢）。
 * 真手绘抖动由调用方对 depth 做种子微差（summaryGeomOf），路径本身保持平滑弧线。 */
export function braceD(x: number, top: number, bottom: number, depth: number, dir: 1 | -1): string {
  const mid = (top + bottom) / 2
  const hTop = mid - top
  const hBot = bottom - mid
  const dx = (t: number) => round2(x + dir * depth * t)
  return (
    `M ${round2(x)} ${round2(top)}` +
    ` C ${dx(0.7)} ${round2(top + hTop * 0.12)}, ${dx(0.9)} ${round2(top + hTop * 0.72)}, ${dx(1)} ${round2(mid)}` +
    ` C ${dx(0.9)} ${round2(mid + hBot * 0.28)}, ${dx(0.7)} ${round2(bottom - hBot * 0.12)}, ${round2(x)} ${round2(bottom)}`
  )
}

/** 删除线（v9 票 03）：逐行文字中部一道手绘短直线（一笔，wobble 家族）；与波浪线可叠加 */
export function strikeDs(g: TextBlockGeom, seed: number): string[] {
  return g.lineWs.map((lw, i) => {
    const lx = lineLeft(g, i)
    const y = g.top + i * g.lineH + g.lineH / 2
    return wobbleLine(lx - 2, y, lx + lw + 2, y, (seed ^ (0x51ab3ef7 + i)) >>> 0, 0.6)
  })
}

/** 文字对齐：缺省=盒形默认（盒形居中；下划线/无框随文贴侧）
 * anchor 是 SVG text-anchor；canvasAlign 直接对应 canvas textAlign */
export type TextAlign = 'left' | 'center' | 'right'

export function textLayoutOf(
  shape: NodeShape,
  align: TextAlign | undefined,
  side: 'left' | 'right',
  box: { x: number; w: number },
): { centered: boolean; geomSide: 'left' | 'right'; x: number; anchor: 'middle' | 'start' | 'end'; canvasAlign: TextAlign } {
  const boxLike = shape !== 'underline' && shape !== 'none'
  const a: TextAlign = align ?? (boxLike ? 'center' : side === 'right' ? 'left' : 'right')
  return {
    centered: a === 'center',
    geomSide: a === 'left' ? 'right' : 'left', // blockGeom 的 side 参数：'right'=块贴左缘（起点对齐）
    x: a === 'center' ? box.x + box.w / 2 : a === 'left' ? box.x + 6 : box.x + box.w - 6,
    anchor: a === 'center' ? 'middle' : a === 'left' ? 'start' : 'end',
    canvasAlign: a,
  }
}
