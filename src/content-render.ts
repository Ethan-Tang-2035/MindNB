import { readableColor } from './paper-pages.ts'
import type { Content } from './content.ts'
import type { Rect, Size } from './layout.ts'
import type { FlowObject, TimelineObject, PyramidObject, CircleMapObject } from './objects.ts'
import { contentSize } from './content-geometry.ts'
import { stickerOf } from './stickers.ts'
import { wobbleRoundRect, wobbleLine, wobbleEllipse, wobblePolygon, round2 } from './wobble.ts'
import { wrapLines } from './wrap.ts'

type Primitive =
  | { type: 'path'; d: string; color: string; width: number; fill?: string; opacity?: number }
  | { type: 'rect'; x: number; y: number; w: number; h: number; fill: string; stroke?: string; radius?: number }
  | { type: 'text'; x: number; y: number; value: string; color: string; size: number; anchor?: 'middle' | 'start'; bold?: boolean }
  | { type: 'image'; src: string; x: number; y: number; w: number; h: number }

const line = (x1: number, y1: number, x2: number, y2: number) => `M${x1} ${y1}L${x2} ${y2}`
const widthOf = (text: string) => [...text].reduce((w, c) => w + (/[^\x00-\xff]/.test(c) ? 14 : 8), 0)

/** 图表条目块宽（与循环图步骤块一致，v11 各图共用） */
const BLOCK_W = 110
/** 派生种子：同图内第 i 个手绘笔画用 content.seed 异化，随数据持久、渲染稳定 */
const strokeSeed = (seed: number, i: number, salt: number) => (seed ^ (Math.imul(i + 1, salt) >>> 0)) >>> 0

export function tableRowHeights(content: Extract<Content, { kind: 'table' }>): number[] {
  return content.cells.map(row => Math.max(40, ...row.map((text, c) => wrapLines(text, Math.max(24, (content.columnWidths[c] ?? 120) - 20), widthOf).length * 20 + 16)))
}

/** 条目块折行与块高（v11 图表共用：块宽 BLOCK_W、折行宽 -16、行高 18、上下留白 20，minH 兜底） */
function entryBlockGeom(texts: string[], minH: number) {
  const labels = texts.map(t => wrapLines(t, BLOCK_W - 16, widthOf))
  const heights = labels.map(ls => Math.max(minH, ls.length * 18 + 20))
  return { labels, heights }
}

/** 流程图几何（自动测宽高：步骤数 × 单步尺寸 + 间距，文字折行）；flowSize 供工厂/编辑器同步 w/h */
function flowGeom(content: FlowObject) {
  const { labels, heights } = entryBlockGeom(content.steps.map(s => s.text), 0)
  const bh = Math.max(52, ...heights)
  const gap = 40
  const n = content.steps.length
  const w = content.direction === 'right' ? n * BLOCK_W + (n - 1) * gap : BLOCK_W
  const h = content.direction === 'right' ? bh : n * bh + (n - 1) * gap
  return { labels, bh, gap, w, h }
}

export function flowSize(content: FlowObject): Size {
  const g = flowGeom(content)
  return { w: g.w, h: g.h }
}

/** 时间轴几何：主轴 + 逐时刻刻度点；横向沿轴排、文字块上下交错，纵向左右交错；timePad 为时间标注预留 */
function timelineGeom(content: TimelineObject) {
  const { labels, heights } = entryBlockGeom(content.items.map(it => it.text), 38)
  const bhs = heights
  const maxBh = Math.max(38, ...bhs)
  const n = content.items.length
  const times = content.items.map(it => it.time ? wrapLines(it.time, BLOCK_W - 8, widthOf) : [])
  const timePad = Math.max(0, ...times.map(ls => ls.length * 16 + 6))
  const margin = 24 + timePad, gapAxis = 20, slot = 150
  const alongV = maxBh + timePad + 32
  const band = gapAxis + timePad + maxBh
  const horizontal = content.direction === 'right'
  const w = horizontal ? 48 + n * slot : (BLOCK_W + gapAxis + 24) * 2
  const h = horizontal ? band * 2 : margin * 2 + (n - 1) * alongV + maxBh
  return { labels, times, timePad, bhs, maxBh, margin, gapAxis, slot, alongV, horizontal, w, h }
}

export function timelineSize(content: TimelineObject): Size {
  const g = timelineGeom(content)
  return { w: g.w, h: g.h }
}

/** 金字塔按实际层高推导斜边：从顶层向下排，确保文字上缘也落在三角形内。 */
function pyramidGeom(content: PyramidObject) {
  const n = content.items.length
  const lines = content.items.map((it, i) => wrapLines(it.text, Math.min(360, 96 + (n - 1 - i) * 64), widthOf))
  const lh: number[] = []
  const slope = .75 // 每向下 1px，左右斜边各展开 .75px
  let h = 0
  for (let i = n - 1; i >= 0; i--) {
    const textH = lines[i].length * 18
    const textW = Math.max(0, ...lines[i].map(widthOf))
    // 居中文字上缘 y = h + 层高/2 - textH/2；该处可用宽须容纳文字及留白。
    lh[i] = Math.max(44, textH + 26, (textW + 28) / slope - 2 * h + textH)
    h += lh[i]
  }
  return { lines, lh, w: Math.max(240, 2 * slope * h), h }
}

export function pyramidSize(content: PyramidObject): Size {
  const g = pyramidGeom(content)
  return { w: g.w, h: g.h }
}

/** 圆圈图几何：中心圆半径随中心文字折行；环半径随词条块与数量自适应（照循环图外接公式，下限 96） */
function circleMapGeom(content: CircleMapObject) {
  const centerLines = wrapLines(content.center.text, 96, widthOf)
  const cr = Math.max(44, (centerLines.length * 18) / 2 + 24)
  const { labels, heights } = entryBlockGeom(content.items.map(it => it.text), 44)
  const bhs = heights
  const bh = Math.max(44, ...bhs)
  const count = content.items.length
  const radius = count > 0 ? Math.max(96, cr + Math.hypot(BLOCK_W, bh) / 2 + 24, (Math.hypot(BLOCK_W, bh) + 26) / (2 * Math.sin(Math.PI / Math.max(3, count)))) : cr + 24
  return { centerLines, cr, labels, bhs, bh, count, radius, w: radius * 2 + BLOCK_W + 24, h: radius * 2 + bh + 24 }
}

export function circleMapSize(content: CircleMapObject): Size {
  const g = circleMapGeom(content)
  return { w: g.w, h: g.h }
}

/** 条目块图元（v11 图表共用）：sketch=手绘圆角块，否则规整圆角矩形 */
function entryBlock(style: { color: string; sketch: boolean }, seed: number, x: number, y: number, h: number): Primitive {
  return style.sketch
    ? { type: 'path', d: wobbleRoundRect(x, y, BLOCK_W, h, 14, seed, 2), color: style.color, width: 1.8, fill: '#fffdf8' }
    : { type: 'rect', x, y, w: BLOCK_W, h, fill: '#fffdf8', stroke: style.color, radius: 4 }
}

/** 块内居中折行文字（v11 图表共用）：cy 为块中心 */
function entryText(p: Primitive[], cx: number, cy: number, lines: string[], ink: string): void {
  lines.forEach((value, j) => p.push({ type: 'text', x: cx, y: cy + (j - (lines.length - 1) / 2) * 18 + 5, value, size: 14, color: ink, anchor: 'middle' }))
}

export function contentPrimitives(content: Content, ink: string, pageLocal=false): { width: number; height: number; primitives: Primitive[] } {
  const p: Primitive[] = []
  const blockInk=pageLocal?readableColor(ink,'#fffdf8'):ink
  let { w: width, h: height } = contentSize(content)
  if (content.kind === 'image') {
    if (content.framed) p.push({ type: 'path', d: wobbleRoundRect(-6, -6, width + 12, height + 12, 10, content.seed, 2), color: ink, width: 2.2 })
    p.push({ type: 'image', src: content.src, x: 0, y: 0, w: width, h: height })
  } else if (content.kind === 'sticker') {
    const def = stickerOf(content.icon)
    width = height = 24
    if (def?.src) p.push({ type: 'image', src: def.src, x: 0, y: 0, w: 24, h: 24 })
    else if (def) {
      for (const d of def.stroke) p.push({ type: 'path', d, color: ink, width: 1.8 * 24 / content.size })
      for (const d of def.fill ?? []) p.push({ type: 'path', d, color: 'none', width: 0, fill: ink })
    }
  } else if (content.kind === 'table') {
    width = content.columnWidths.reduce((s, w) => s + w, 0)
    const heights = tableRowHeights(content)
    height = heights.reduce((s, h) => s + h, 0)
    let y = 0
    content.cells.forEach((row, r) => {
      let x = 0
      row.forEach((value, c) => {
        const w = content.columnWidths[c] ?? 120, h = heights[r]
        p.push({ type: 'rect', x, y, w, h, fill: content.fills[`${r},${c}`] ?? (content.header && r === 0 ? '#ede4cf' : '#fffdf8'), stroke: '#b8aa96' })
        const lines = wrapLines(value, Math.max(24, w - 20), widthOf)
        lines.forEach((value, i) => p.push({ type: 'text', x: x + 10, y: y + 25 + i * 20, value, size: 14, color: pageLocal?readableColor(ink,content.fills[`${r},${c}`]??(content.header&&r===0?'#ede4cf':'#fffdf8')):ink, bold: content.header && r === 0 }))
        x += w
      })
      y += heights[r]
    })
  } else if (content.kind === 'cycle') {
    const count = content.steps.length
    const bw = 110
    const labels = content.steps.map(step => wrapLines(step.text, bw - 16, widthOf))
    const bh = Math.max(52, ...labels.map(lines => lines.length * 18 + 20))
    const radius = Math.max(86, (Math.hypot(bw, bh) + 24) / (2 * Math.sin(Math.PI / Math.max(3, count))))
    width = Math.max(width, radius * 2 + bw + 24); height = Math.max(height, radius * 2 + bh + 24)
    const cx = width / 2, cy = height / 2
    const centers = content.steps.map((_, i) => {
      const a = -Math.PI / 2 + (content.clockwise ? 1 : -1) * i * 2 * Math.PI / count
      return { x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius }
    })
    if (count > 1) centers.forEach((a, i) => {
      const b = centers[(i + 1) % count], dx = b.x - a.x, dy = b.y - a.y
      const length = Math.hypot(dx, dy)
      const inset = Math.min((bw / 2 + 7) / Math.max(.001, Math.abs(dx / length)), (bh / 2 + 7) / Math.max(.001, Math.abs(dy / length)))
      const start = { x: a.x + dx / length * inset, y: a.y + dy / length * inset }
      const end = { x: b.x - dx / length * inset, y: b.y - dy / length * inset }
      const control = count === 2 ? { x: (start.x + end.x) / 2 - dy * .45, y: (start.y + end.y) / 2 + dx * .45 } : content.sketch ? { x: (start.x + end.x) / 2 + 4, y: (start.y + end.y) / 2 - 4 } : null
      const d = control ? `M${start.x} ${start.y}Q${control.x} ${control.y} ${end.x} ${end.y}` : line(start.x, start.y, end.x, end.y)
      p.push({ type: 'path', d, color: content.color, width: 2 })
      const tangent = control ?? start, tangentLength = Math.hypot(end.x - tangent.x, end.y - tangent.y)
      const ux = (end.x - tangent.x) / tangentLength, uy = (end.y - tangent.y) / tangentLength
      p.push({ type: 'path', d: `M${end.x - ux * 9 - uy * 4} ${end.y - uy * 9 + ux * 4}L${end.x} ${end.y}L${end.x - ux * 9 + uy * 4} ${end.y - uy * 9 - ux * 4}`, color: content.color, width: 2 })
    })
    if (count === 1) {
      const c = centers[0], right = c.x + bw / 2, bottom = c.y + bh / 2
      p.push({ type: 'path', d: `M${right} ${c.y}C${right + 45} ${c.y} ${right + 45} ${bottom + 45} ${c.x} ${bottom + 8}M${c.x + 3} ${bottom + 18}L${c.x} ${bottom + 8}L${c.x + 10} ${bottom + 10}`, color: content.color, width: 2 })
    }
    centers.forEach((center, i) => {
      p.push({ type: 'rect', x: center.x - bw / 2, y: center.y - bh / 2, w: bw, h: bh, fill: '#fffdf8', stroke: content.color, radius: content.sketch ? 14 : 4 })
      const lines = labels[i]
      lines.forEach((value, j) => p.push({ type: 'text', x: center.x, y: center.y + (j - (lines.length - 1) / 2) * 18 + 5, value, size: 14, color: blockInk, anchor: 'middle' }))
    })
  } else if (content.kind === 'flow') {
    // 流程图（词汇见 CONTEXT.md「流程图」）：首尾不闭合的线性步骤链，末步无出箭头（区别于循环图回环）
    const g = flowGeom(content)
    width = Math.max(width, g.w); height = Math.max(height, g.h)
    const n = content.steps.length
    const x0 = (width - g.w) / 2, y0 = (height - g.h) / 2
    const centers = content.steps.map((_, i) => content.direction === 'right'
      ? { x: x0 + BLOCK_W / 2 + i * (BLOCK_W + g.gap), y: height / 2 }
      : { x: width / 2, y: y0 + g.bh / 2 + i * (g.bh + g.gap) })
    // 沿链轴方向的半长：横向为块半宽，纵向为块半高（箭头两端各留 5px 缘距）
    const half = (content.direction === 'right' ? BLOCK_W : g.bh) / 2 + 5
    centers.forEach((center, i) => {
      if (i < n - 1) {
        const b = centers[i + 1]
        const dx = b.x - center.x, dy = b.y - center.y, len = Math.hypot(dx, dy) || 1
        const ux = dx / len, uy = dy / len
        const start = { x: center.x + ux * half, y: center.y + uy * half }
        const end = { x: b.x - ux * half, y: b.y - uy * half }
        p.push({ type: 'path', d: content.sketch ? wobbleLine(start.x, start.y, end.x, end.y, strokeSeed(content.seed, i, 0x9e37), 1.6) : line(start.x, start.y, end.x, end.y), color: content.color, width: 2 })
        p.push({ type: 'path', d: `M${end.x - ux * 9 - uy * 4} ${end.y - uy * 9 + ux * 4}L${end.x} ${end.y}L${end.x - ux * 9 + uy * 4} ${end.y - uy * 9 - ux * 4}`, color: content.color, width: 2 })
      }
      p.push(entryBlock(content, strokeSeed(content.seed, i, 0x85eb), center.x - BLOCK_W / 2, center.y - g.bh / 2, g.bh))
      entryText(p, center.x, center.y, g.labels[i], blockInk)
    })
  } else if (content.kind === 'timeline') {
    // 时间轴（词汇见 CONTEXT.md「时间轴」）：手绘主轴 + 逐时刻刻度点；横向文字块沿轴上下交错，纵向左右交错
    const g = timelineGeom(content)
    width = Math.max(width, g.w); height = Math.max(height, g.h)
    const axis = content.sketch
      ? wobbleLine(g.horizontal ? 14 : width / 2, g.horizontal ? height / 2 : 14, g.horizontal ? width - 14 : width / 2, g.horizontal ? height / 2 : height - 14, content.seed, 1.8)
      : line(g.horizontal ? 14 : width / 2, g.horizontal ? height / 2 : 14, g.horizontal ? width - 14 : width / 2, g.horizontal ? height / 2 : height - 14)
    p.push({ type: 'path', d: axis, color: content.color, width: 2 })
    content.items.forEach((item, i) => {
      const flip = i % 2 === 1
      const pos = g.horizontal
        ? { x: 24 + g.slot / 2 + i * g.slot, y: height / 2 }
        : { x: width / 2, y: g.margin + g.maxBh / 2 + i * g.alongV }
      const r = 4.5
      const tick = content.sketch
        ? wobbleEllipse(pos.x, pos.y, r, r, strokeSeed(content.seed, i, 0x9e37), 1)
        : `M${pos.x - r} ${pos.y}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`
      p.push({ type: 'path', d: tick, color: content.color, width: 1.6, fill: content.color })
      const bh = g.bhs[i]
      const bx = g.horizontal ? pos.x - BLOCK_W / 2 : flip ? pos.x + g.gapAxis : pos.x - g.gapAxis - BLOCK_W
      const by = g.horizontal ? (flip ? pos.y + g.gapAxis + g.timePad : pos.y - g.gapAxis - bh) : pos.y - bh / 2
      p.push(entryBlock(content, strokeSeed(content.seed, i, 0x85eb), bx, by, bh))
      // 时间标注小字置于事件文字上方（空串不显示）
      g.times[i].forEach((value, j, ls) => p.push({ type: 'text', x: bx + BLOCK_W / 2, y: by - 6 - (ls.length - 1 - j) * 16, value, size: 12, color: ink, anchor: 'middle' }))
      entryText(p, bx + BLOCK_W / 2, by + bh / 2, g.labels[i], blockInk)
    })
  } else if (content.kind === 'pyramid') {
    // 金字塔图（词汇见 CONTEXT.md「金字塔图」）：自底向上逐层收窄的手绘梯形堆叠，顶层收为三角形
    const g = pyramidGeom(content)
    width = Math.max(width, g.w); height = Math.max(height, g.h)
    const H = g.h
    const cxm = width / 2
    const apexY = (height - H) / 2
    // 顶点 y 处的半宽：从顶点 0 线性放大到底层 W/2（梯形收窄的几何基础）
    const halfAt = (y: number) => (g.w / 2) * ((y - apexY) / H)
    let y2 = apexY + H
    content.items.forEach((_, i) => {
      const lh = g.lh[i]
      const y1 = y2 - lh
      const pts = [
        { x: cxm - halfAt(y1), y: y1 },
        { x: cxm + halfAt(y1), y: y1 },
        { x: cxm + halfAt(y2), y: y2 },
        { x: cxm - halfAt(y2), y: y2 },
      ]
      if (content.sketch) p.push({ type: 'path', d: wobblePolygon(pts, strokeSeed(content.seed, i, 0x85eb), 2), color: content.color, width: 1.8, fill: '#fffdf8' })
      else p.push({ type: 'path', d: pts.map((pt, k) => `${k ? 'L' : 'M'}${round2(pt.x)} ${round2(pt.y)}`).join(' ') + ' Z', color: content.color, width: 1.8, fill: '#fffdf8' })
      entryText(p, cxm, (y1 + y2) / 2, g.lines[i], blockInk)
      y2 = y1
    })
  } else if (content.kind === 'circleMap') {
    // 圆圈图（词汇见 CONTEXT.md「圆圈图」）：中心手绘圆 + 联想词条沿外环均布 + 中心到各词条的短辐条
    const g = circleMapGeom(content)
    width = Math.max(width, g.w); height = Math.max(height, g.h)
    const c = { x: width / 2, y: height / 2 }
    const cr = g.cr
    p.push({
      type: 'path',
      d: content.sketch
        ? wobbleEllipse(c.x, c.y, cr, cr, content.seed, 2.5)
        : `M${round2(c.x - cr)} ${round2(c.y)}a${cr} ${cr} 0 1 0 ${cr * 2} 0a${cr} ${cr} 0 1 0 ${-cr * 2} 0`,
      color: content.color, width: 1.8, fill: '#fffdf8',
    })
    entryText(p, c.x, c.y, g.centerLines, blockInk)
    const centers = content.items.map((_, i) => {
      const a = -Math.PI / 2 + i * 2 * Math.PI / Math.max(1, g.count)
      return { x: c.x + Math.cos(a) * g.radius, y: c.y + Math.sin(a) * g.radius }
    })
    // 辐条：中心圆缘 → 联想块缘（照循环图缘距算法，留 6px）
    centers.forEach((t, i) => {
      const dx = t.x - c.x, dy = t.y - c.y, len = Math.hypot(dx, dy) || 1
      const ux = dx / len, uy = dy / len
      const inset = Math.min((BLOCK_W / 2 + 6) / Math.max(.001, Math.abs(ux)), (g.bhs[i] / 2 + 6) / Math.max(.001, Math.abs(uy)))
      const start = { x: c.x + ux * (cr + 4), y: c.y + uy * (cr + 4) }
      const end = { x: t.x - ux * inset, y: t.y - uy * inset }
      p.push({ type: 'path', d: content.sketch ? wobbleLine(start.x, start.y, end.x, end.y, strokeSeed(content.seed, i, 0x9e37), 1.4) : line(start.x, start.y, end.x, end.y), color: content.color, width: 1.6 })
    })
    centers.forEach((t, i) => {
      p.push(entryBlock(content, strokeSeed(content.seed, i, 0x85eb), t.x - BLOCK_W / 2, t.y - g.bhs[i] / 2, g.bhs[i]))
      entryText(p, t.x, t.y, g.labels[i], blockInk)
    })
  } else {
    width = content.sourceWidth; height = content.sourceHeight
    for (const stroke of content.strokes) {
      if (!stroke.points.length) continue
      const points = stroke.points
      const d = points.map((pt, i) => `${i ? 'L' : 'M'}${pt.x} ${pt.y}`).join(' ') + (points.length === 1 ? `l.01 .01` : '')
      p.push({ type: 'path', d, color: stroke.color, width: stroke.width, opacity: stroke.opacity })
    }
  }
  return { width: Math.max(1, width), height: Math.max(1, height), primitives: p }
}

const ns = 'http://www.w3.org/2000/svg'
function element(tag: string, attrs: Record<string, string | number>) {
  const e = document.createElementNS(ns, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v))
  return e
}

export function appendContent(parent: SVGElement, content: Content, box: Rect, ink: string, pageLocal=false) {
  const plan = contentPrimitives(content, ink, pageLocal)
  const group = element('g', { transform: `translate(${box.x} ${box.y}) scale(${box.w / plan.width} ${box.h / plan.height})`, 'data-content-id': content.id })
  for (const p of plan.primitives) {
    let node: SVGElement
    if (p.type === 'image') node = element('image', { href: p.src, x: p.x, y: p.y, width: p.w, height: p.h, preserveAspectRatio: 'xMidYMid meet' })
    else if (p.type === 'rect') node = element('rect', { x: p.x, y: p.y, width: p.w, height: p.h, rx: p.radius ?? 0, fill: p.fill, stroke: p.stroke ?? 'none', 'stroke-width': 1.4 })
    else if (p.type === 'path') node = element('path', { d: p.d, fill: p.fill ?? 'none', stroke: p.color, 'stroke-width': p.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: p.opacity ?? 1 })
    else {
      node = element('text', { x: p.x, y: p.y, 'font-size': p.size, 'font-weight': p.bold ? 700 : 400, 'text-anchor': p.anchor ?? 'start', fill: p.color })
      node.textContent = p.value
    }
    group.append(node)
  }
  parent.append(group)
}

export async function preloadContentImages(contents: Content[], extraSources: string[] = []): Promise<Map<string, HTMLImageElement>> {
  const sources = new Set([...extraSources, ...contents.flatMap(c => contentPrimitives(c, '#4a3f35').primitives.flatMap(p => p.type === 'image' ? [p.src] : []))])
  const images = new Map<string, HTMLImageElement>()
  await Promise.all([...sources].map(src => new Promise<void>((resolve, reject) => {
    const image = new Image()
    // mindnb://asset and mindnb://app are different origins. Request CORS before
    // loading so locally stored images remain safe for PNG/JPEG/PDF canvases.
    image.crossOrigin = 'anonymous'
    const timer=setTimeout(()=>{image.onload=null;image.onerror=null;reject(new Error('插图加载超时，请重试：'+src.slice(0,80)))},15000)
    image.onload = () => { clearTimeout(timer);images.set(src, image); resolve() }
    image.onerror = () => {clearTimeout(timer);reject(new Error('插图加载失败：' + src.slice(0, 80)))}
    image.src = src
  })))
  return images
}

export function paintContent(ctx: CanvasRenderingContext2D, content: Content, box: Rect, ink: string, images: Map<string, HTMLImageElement>, font: string, pageLocal=false) {
  const plan = contentPrimitives(content, ink, pageLocal)
  ctx.save()
  ctx.translate(box.x, box.y); ctx.scale(box.w / plan.width, box.h / plan.height)
  for (const p of plan.primitives) {
    ctx.save()
    if (p.type === 'image') {
      const im = images.get(p.src)
      if (im) {
        const k = Math.min(p.w / im.naturalWidth, p.h / im.naturalHeight)
        const w = im.naturalWidth * k, h = im.naturalHeight * k
        ctx.drawImage(im, p.x + (p.w - w) / 2, p.y + (p.h - h) / 2, w, h)
      }
    } else if (p.type === 'rect') {
      ctx.beginPath(); ctx.roundRect(p.x, p.y, p.w, p.h, p.radius ?? 0)
      if (p.fill !== 'none') { ctx.fillStyle = p.fill; ctx.fill() }
      if (p.stroke) { ctx.strokeStyle = p.stroke; ctx.lineWidth = 1.4; ctx.stroke() }
    } else if (p.type === 'path') {
      const path = new Path2D(p.d)
      ctx.globalAlpha = p.opacity ?? 1
      if (p.fill && p.fill !== 'none') { ctx.fillStyle = p.fill; ctx.fill(path) }
      if (p.color !== 'none' && p.width > 0) { ctx.strokeStyle = p.color; ctx.lineWidth = p.width; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(path) }
    } else {
      ctx.font = `${p.bold ? 700 : 400} ${p.size}px ${font}`
      ctx.textAlign = p.anchor === 'middle' ? 'center' : 'left'; ctx.textBaseline = 'alphabetic'
      ctx.fillStyle = p.color; ctx.fillText(p.value, p.x, p.y)
    }
    ctx.restore()
  }
  ctx.restore()
}
