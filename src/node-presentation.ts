import type { MindMap, NodeStyle, NodeData } from './model.ts'
import type { LaidNode, Rect } from './layout.ts'
import type { FontId } from './fonts.ts'
import type { Content } from './content.ts'
import { effectiveStyle, effectiveShape, type NodeShape } from './levels.ts'
import { fillPatternOf, borderColorOf, pairedInkFor, type Theme, type FillTexture } from './theme.ts'
import { readableColor } from './paper-pages.ts'
import { isDarkColor } from './paper.ts'
import { isOverlay } from './content-geometry.ts'
import { subtitleGeometry } from './node-subtitle.ts'
import { backdropSource } from './node-backdrop.ts'
import { wrapLines } from './wrap.ts'
import { blockGeom, highlightLineDs, wavyD, strikeDs, badgeGeom, textLayoutOf } from './deco.ts'
import { hashSeed, wobbleEllipse, wobbleLine, wobbleRoundRect, wobbleCloud, wobbleBubble, wobbleBurst, wobbleBanner } from './wobble.ts'

export type NodeMark =
  | { kind: 'path'; d: string; fill: string; opacity: number; stroke: string; width: number; dash?: number[]; texture?: FillTexture; seed: number; x: number; y: number }
  | { kind: 'text'; role: 'title' | 'caption'; text: string; x: number; y: number; size: number; weight: number; font?: FontId; italic: boolean; anchor: 'start' | 'middle' | 'end'; color: string; halo: number; paper: string }
  | { kind: 'image'; src: string; box: Rect }
  | { kind: 'icon'; icon: NonNullable<NodeData['icon']>; box: Rect; color: string }
  | { kind: 'content'; content: Content; box: Rect; ink: string; pageLocal: boolean; font?: FontId }

/** Final appearance after inherited defaults; shared by drawing and format controls. */
export function nodeAppearance(node: Pick<NodeData, 'style' | 'contents'>, depth: number, map: MindMap, theme: Theme, branchColor: string, pageLocal: boolean) {
  const style = node.style
  const shape = node.contents?.some(c => !isOverlay(c)) && !style?.shape ? 'rounded' : effectiveShape(depth, style)
  const paint = nodePaint(shape, depth, style, branchColor, theme, pageLocal)
  return {
    shape, paint, pattern: fillPatternOf(style, map),
    borderColor: borderColorOf(style, map) ?? paint.stroke,
    borderLine: style?.borderLine ?? (shape === 'dashed' ? 'dashed' : 'solid'),
    borderWidth: style?.borderWidth ?? (style?.visualStyle === 'clear' && depth === 0 ? 2.8 : 2.4),
  }
}

/** Both drawing adapters consume these ordered marks; neither interprets node styles. */
export function nodePresentation(source: LaidNode, context: {
  map: MindMap
  theme: Theme
  colors: ReadonlyMap<string, string>
  pageLocal: boolean
  measure(text: string, size: number, weight: number, font?: FontId): number
  zoom?: number
}): NodeMark[] {
  const { map, theme, colors, pageLocal, measure } = context
  const n = { ...source, depth: source.node.style?.layoutDepth ?? source.depth }
  const style = n.node.style, s = effectiveStyle(n.depth, style)
  const widthOf = (text: string) => measure(text, s.fontPx, s.weight, s.font)
  const lines = wrapLines(n.node.text, s.maxTextW, widthOf)
  const subtitle = subtitleGeometry(n.node, n.textBox ?? n, n.depth, lines.length, (text, size) => measure(text, size, 400, style?.font))
  const textBox = subtitle?.titleBox ?? n.textBox ?? n
  const branchColor = n.depth === 0 ? theme.ink : colors.get(n.id) ?? theme.ink
  const { shape, paint, pattern, borderColor: stroke, borderLine: line, borderWidth: width } = nodeAppearance(n.node, n.depth, map, theme, branchColor, pageLocal)
  const paths = nodeShapePaths(shape, { ...n, seed: n.node.seed, clear: style?.visualStyle === 'clear' })
  const tl = textLayoutOf(shape, style?.align, n.side, { x: textBox.x, w: textBox.w })
  const geom = blockGeom(lines.map(widthOf), { centered: tl.centered, side: tl.geomSide, x: textBox.x, w: textBox.w, midY: textBox.y + textBox.h / 2, lineH: s.lineH })
  const marks: NodeMark[] = []
  const path = (d: string, fill: string, opacity: number, stroke: string, width: number, dash?: number[], texture?: FillTexture) => {
    marks.push({ kind: 'path', d, fill, opacity, stroke, width, dash, texture, seed: n.node.seed, x: n.x, y: n.y })
  }
  const text = (value: string, x: number, y: number, size: number, weight: number, anchor: 'start' | 'middle' | 'end', italic = false, halo = 0, role: 'title' | 'caption' = 'caption') => {
    marks.push({ kind: 'text', role, text: value, x, y, size, weight, anchor, italic, halo, color: paint.textFill, paper: theme.paper, font: s.font })
  }
  const backdrop = backdropSource(style, n.depth === 0 ? theme.rootFill : branchColor)
  if (backdrop) marks.push({ kind: 'image', src: backdrop, box: n })
  if (n.node.icon) {
    const size = n.node.icon.size ?? 24
    marks.push({ kind: 'icon', icon: n.node.icon, box: { x: textBox.x - size - 8, y: textBox.y + (textBox.h - size) / 2, w: size, h: size }, color: style?.backdrop ? paint.textFill : theme.ink })
  }
  const deco = style?.deco
  if (deco?.highlight) for (const d of highlightLineDs(geom, n.node.seed)) path(d, deco.highlight, .55, 'none', 0)
  if (paths.base && !style?.backdrop) {
    const textured = pattern !== 'solid' && pattern !== 'none'
    path(paths.base, pattern === 'none' ? 'none' : paint.fill, textured || n.depth === 0 ? 1 : paint.fillOpacity, stroke, width, line === 'dotted' ? [2, 5] : line === 'dashed' ? [9, 7] : undefined, textured ? pattern : undefined)
    if (line === 'double') {
      const inner = doubleLinePath(shape, { ...n, seed: n.node.seed })
      if (inner) path(inner, 'none', 1, stroke, Math.max(1.2, width * .75))
    }
  }
  lines.forEach((line, i) => text(line, tl.x, textBox.y + textBox.h / 2 + (i - (lines.length - 1) / 2) * s.lineH + .38 * s.fontPx, s.fontPx, s.weight, tl.anchor, !!style?.italic, nodeTextHalo(shape, pattern), 'title'))
  if (subtitle) text(subtitle.text, subtitle.x, subtitle.y, subtitle.fontPx, 400, 'middle')
  if (shape === 'underline' && paths.underline) path(paths.underline, 'none', 1, style?.visualStyle === 'clear' ? branchColor : paint.textFill, style?.visualStyle === 'clear' ? Math.max(1 / (context.zoom ?? 1), 1.2) : 2.2)
  if (deco?.wavy) path(wavyD(geom), 'none', 1, paint.textFill, 1.8)
  if (deco?.strike) for (const d of strikeDs(geom, n.node.seed)) path(d, 'none', 1, paint.textFill, 1.8)
  if (deco?.badge) {
    const badge = badgeGeom(geom, s.lineH, s.fontPx)
    path(wobbleEllipse(badge.cx, badge.cy, badge.r, badge.r, (n.node.seed ^ 0x2545f491) >>> 0, 1), theme.paper, 1, paint.textFill, 1.8)
    text(deco.badge, badge.cx, badge.cy + s.fontPx * .36, s.fontPx * .9, 700, 'middle')
  }
  for (const placement of n.contentBoxes ?? []) {
    const content = n.node.contents?.find(c => c.id === placement.id)
    if (content) marks.push({ kind: 'content', content, box: placement.box, ink: theme.ink, pageLocal, font: s.font })
  }
  return marks
}

/** 填充纹理 pattern id（票 06）：同 SVG 内同节点同 kind 恒同 id；scope 隔离不同 SVG，避免缩略图串色（验收红线） */
export function fillPatternId(nodeId: string, kind: FillTexture, scope = ''): string {
  return `pat-${scope}${hashSeed(nodeId)}-${kind}`
}

/** 节点填充的 fill 属性取值（render/exporter 共用口径）：实心=填充色、无=纸底透出、纹理=pattern 引用 */
export function nodeFillAttr(pattern: ReturnType<typeof fillPatternOf>, nodeId: string, solidColor: string, scope = ''): string {
  if (pattern === 'none') return 'none'
  if (pattern === 'solid') return solidColor
  return `url(#${fillPatternId(nodeId, pattern, scope)})`
}

/** 纹理线条与文字同色时，用纸底色描边隔开，画布/导出保持一致。 */
export function nodeTextHalo(shape: NodeShape, pattern: ReturnType<typeof fillPatternOf>): number {
  return shape !== 'none' && shape !== 'underline' && pattern !== 'solid' && pattern !== 'none' ? 3 : 0
}

/** 节点形状路径（render/exporter 共用「画什么」）：base=基座轮廓（underline/none 为 null），
 * underline=下划线形随附的底缘线。宽度统一 2.4（原椭圆 2.5 并档，肉眼不可分）。 */
export function nodeShapePaths(shape: NodeShape, box: { x: number; y: number; w: number; h: number; seed: number; clear?: boolean }): { base: string | null; underline?: string } {
  if (box.clear && shape === 'rounded') {
    const { x, y, w, h } = box, r = Math.min(40, h / 2)
    return { base: `M${x+r} ${y} H${x+w-r} Q${x+w} ${y} ${x+w} ${y+r} V${y+h-r} Q${x+w} ${y+h} ${x+w-r} ${y+h} H${x+r} Q${x} ${y+h} ${x} ${y+h-r} V${y+r} Q${x} ${y} ${x+r} ${y} Z` }
  }
  if (box.clear && shape === 'underline') return { base: null, underline: `M${box.x} ${box.y + box.h - 2} H${box.x + box.w}` }
  switch (shape) {
    case 'ellipse':
      return { base: wobbleEllipse(box.x + box.w / 2, box.y + box.h / 2, box.w / 2, box.h / 2, box.seed, 2) }
    case 'rounded':
      return { base: outlinePath(box, box.seed) }
    case 'dashed':
      return { base: outlinePath(box, box.seed) }
    case 'cloud':
      return { base: wobbleCloud(box.x + box.w / 2, box.y + box.h / 2, box.w / 2 + 8, box.h / 2 + 6, box.seed, 2) }
    case 'bubble':
      return { base: wobbleBubble(box.x, box.y, box.w, box.h, box.seed, 1.2) }
    case 'burst':
      return { base: wobbleBurst(box.x + box.w / 2, box.y + box.h / 2, box.w / 2 + 10, box.h / 2 + 8, box.seed) }
    case 'banner':
      return { base: wobbleBanner(box.x, box.y, box.w, box.h, box.seed, 1.6) }
    case 'underline':
      return { base: null, underline: wobbleLine(box.x + 4, box.y + box.h - 2, box.x + box.w - 4, box.y + box.h - 2, (box.seed ^ 0x7f4a7c15) >>> 0, 0.8) }
    case 'none':
      return { base: null }
  }
}

/** 生成节点与锚定兄弟组外框共用的轮廓路径（票 03：amp 1.1，描边宽度由调用方样式决定）。
 * 节点=自身盒；外框=锚定兄弟盒并集外扩 pad、圆角 16 对齐节点轮廓。
 * 供 render 与 exporter 双端调用，保证画布与 PNG 一致。 */
export function outlinePath(box: { x: number; y: number; w: number; h: number }, seed: number): string {
  return wobbleRoundRect(box.x, box.y, box.w, box.h, 16, seed, 1.1)
}

/** 双线内描边路径（票 07）：沿盒形轮廓向内偏移 ≈2.5px 的第二道抖动描边（同种子派生，连笔感）。
 * 仅盒形适用（underline/none 无框返回 null）；与形状族全部兼容 */
export function doubleLinePath(shape: NodeShape, box: { x: number; y: number; w: number; h: number; seed: number }): string | null {
  if (shape === 'underline' || shape === 'none') return null
  const inset = 2.5
  return nodeShapePaths(shape, {
    x: box.x + inset,
    y: box.y + inset,
    w: Math.max(4, box.w - inset * 2),
    h: Math.max(4, box.h - inset * 2),
    seed: (box.seed ^ 0x5a5a5a5a) >>> 0,
  }).base
}

/** 节点涂料（render/exporter 共用）：盒形文字用墨色、纯文字形状用分支色 —— 与 v4 层级默认一致。
 * v9 票 03：fill 覆盖节点盒底色（缺省=层级默认 rootFill/分支色浅底），描边与文字色不随填充走 */
function baseNodePaint(shape: NodeShape, depth: number, st: NodeStyle | undefined, branchColor: string, theme: Theme) {
  const boxLike = shape !== 'underline' && shape !== 'none'
  const color = st?.color
  if (st?.backdrop) {
    const fill = st.backdrop === 'paper' ? '#FCF5E5' : st.fill ?? (depth === 0 ? theme.rootFill : branchColor)
    const preferredInk = isDarkColor(fill) ? '#FFFFFF' : '#303A32'
    const ink = isDarkColor(theme.ink) !== isDarkColor(fill) ? theme.ink : preferredInk
    return { fill, fillOpacity: 1, stroke: color ?? branchColor, textFill: color ?? ink }
  }
  if (st?.visualStyle === 'clear' || theme.id === 'clear') {
    const filled = depth === 1 && boxLike && (!st?.fillPattern || st.fillPattern === 'solid')
    return {
      fill: st?.fill ?? (depth === 0 ? theme.rootFill : branchColor),
      fillOpacity: depth < 2 ? 1 : 0.18,
      stroke: color ?? (depth === 0 ? theme.ink : st?.borderLine || st?.borderWidth || st?.fillPattern && st.fillPattern !== 'solid' ? branchColor : 'none'),
      textFill: color ?? (filled ? (pairedInkFor(theme.paper) ? theme.paper : '#FFFFFF') : theme.ink),
    }
  }
  return {
    fill: st?.fill ?? (depth === 0 ? theme.rootFill : branchColor),
    fillOpacity: depth === 0 ? 1 : 0.13,
    stroke: color ?? (depth === 0 ? theme.ink : branchColor),
    textFill: color ?? (boxLike ? theme.ink : branchColor),
  }
}

/** Page-local defaults keep contrast against the actual node fill, including yellow root cards. */
export function nodePaint(shape:NodeShape,depth:number,st:NodeStyle|undefined,branchColor:string,theme:Theme,pageLocal=false){
  const paint=baseNodePaint(shape,depth,st,branchColor,theme)
  if(pageLocal&&!st?.color){let bg=theme.paper
    if(st?.backdrop||(shape!=='none'&&shape!=='underline'&&(!st?.fillPattern||st.fillPattern==='solid'))){
      if(paint.fillOpacity===1)bg=paint.fill
      else if(/^#[0-9a-f]{6}$/i.test(paint.fill)&&/^#[0-9a-f]{6}$/i.test(theme.paper)){bg='#'+[1,3,5].map(i=>Math.round(parseInt(paint.fill.slice(i,i+2),16)*paint.fillOpacity+parseInt(theme.paper.slice(i,i+2),16)*(1-paint.fillOpacity)).toString(16).padStart(2,'0')).join('')}
    }
    paint.textFill=readableColor(paint.textFill,bg)
  }
  return paint
}
