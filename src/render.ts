import { nodePresentation, fillPatternId, outlinePath } from './node-presentation.ts'
import { layoutTextBox, reflowTextBoxes } from './text-box.ts'
import { paperLayers } from './page-render.ts'
import { ownerIndex, pageAppearance, pageById, pageNodeColors } from './paper-pages.ts'
import { usesClearStyle } from './theme.ts'
import { iconElement } from './node-details.ts'
import { fontStack } from './fonts.ts'
import type { MindMap } from './model.ts'
import { edgeGeometry } from './edge-geometry.ts'
import { feedbackFor } from './editor-ui.ts'
import { findObject, objectBBox, type CanvasObject } from './objects.ts'
import { appendContent } from './content-render.ts'
import { isContent } from './content.ts'
import { computeWorldLayout, type Layout, type Measurer, type LaidNode, type Side } from './layout.ts'
import { effectiveShape, levelStyle, type LevelStyle } from './levels.ts'
import { resolveTheme, paperOf, paperStyleOf, paperDensityOf, inkOf, type Theme, linkStyleOf, branchLineWidthOf, type LineStroke, type TaperDir } from './theme.ts'
import { paperTileSpec } from './paper.ts'
import { wrapLines } from './wrap.ts'
import { hashSeed, wobbleCurve, wobbleEllipse, wobbleLine, wobbleRoundRect, wobbleElbow, rng, smoothOpenPath, type Pt } from './wobble.ts'
import { wavyAlong, wavyPoints, linkSamples, linkEndTangent, endpointGlyph, taperedStroke, TAPER_THIN_RATIO, fillPatternSpec, type LinkGeom, type LinkShapeName, type EndpointKind, type EndpointGlyph } from './strokes.ts'
import { anchoredSiblingBox, summaryGeomOf } from './layout.ts'
import { braceD } from './deco.ts'
import type { Rect } from './layout.ts'

/** 统一字体栈：canvas 度量与 SVG 渲染必须同栈 —— 回退不一致时度量漂移，文字会出框。
 * style.css 的 font-family 需与此保持同步。 */
export const FONT_STACK = `"LXGW WenKai", "Kaiti SC", "STKaiti", serif`

export interface View {
  tx: number
  ty: number
  k: number
}
export const IDENTITY: View = { tx: 0, ty: 0, k: 1 }

const SVG_NS = 'http://www.w3.org/2000/svg'

let sharedCtx: CanvasRenderingContext2D | null = null
/** 文字实测共用 context（与 domMeasurer 同栈同参）。导出给 main.ts 的命中判定复用：
 * 悬停光标每帧都要量概要文字，按次新建 canvas 会不停申请 2D context（浏览器有上限，
 * 超了就开始回收已有的，反而拖慢渲染）。调用方约定：measureText 前就地设 ctx.font。 */
export function measureCtx(): CanvasRenderingContext2D {
  if (!sharedCtx) sharedCtx = document.createElement('canvas').getContext('2d')!
  return sharedCtx
}

function el(tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v))
  return e
}

/** DOM 文字测量器：真实字体度量 + 按最大宽折行；返回显示宽与总行高。
 * style 为节点生效样式（含覆盖），缺省即层级基准 */
export function domMeasurer(): Measurer {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  return (text, depth, style) => {
    const s = style ?? levelStyle(depth)
    ctx.font = `${s.weight} ${s.fontPx}px ${fontStack(s.font)}`
    const widthOf = (str: string) => ctx.measureText(str).width
    const lines = wrapLines(text, s.maxTextW, widthOf)
    return { w: Math.max(0, ...lines.map(widthOf)), h: lines.length * s.lineH }
  }
}

/** 编辑/绘制共用的折行 */
export function textLines(text: string, depth: number, style?: LevelStyle): string[] {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const s = style ?? levelStyle(depth)
  ctx.font = `${s.weight} ${s.fontPx}px ${fontStack(s.font)}`
  return wrapLines(text, s.maxTextW, (str) => ctx.measureText(str).width)
}

/** 拖动态的渲染描述：原位置淡化成员、ghost 随光标、落点预示 */
export interface DragRender {
  /** 被拖子树成员（原位置半透明） */
  memberIds: Set<string>
  /** 光标屏幕坐标 */
  sx: number
  sy: number
  /** 拖起时的画布命中点（ghost 平移基准：该点钉在光标下） */
  grab: { x: number; y: number }
  /** 落点预示：落点占位符（landingBox dry-run 预演盒，挂接与插入共用——「显示会挂靠在哪里」） */
  hint: { kind: 'slot'; box: Rect; color: string } | null
  /** 磁吸吸力：ghost 朝目标方向的屏幕偏移（≤10px，随距离渐强） */
  pull?: { dx: number; dy: number }
  /** 牵引线颜色（目标分支色）：child/磁吸预示即画（词汇见 CONTEXT.md「磁吸」） */
  linkColor?: string
  /** 牵引线锚点：目标盒（画布坐标）——牵引线从盒缘最近点画到光标 */
  linkTo?: Rect
}

export interface DeleteButton {
  id: string
  /** 画布坐标 */
  cx: number
  cy: number
  r: number
}

export interface RenderResult extends Layout {
  /** 悬停节点展示的折叠气泡（屏幕画布坐标） */
  bubbles: Array<{ id: string; side: Side; x: number; y: number }>
  /** 选中节点的删除钮（中心主题不显示） */
  deleteBtn: DeleteButton | null
  /** 单选带盒对象时的缩放手柄（画布坐标，右下角） */
  objHandle: { id: string; cx: number; cy: number; r: number } | null
}

/** 对象盒（含拖动中的临时偏移）；关系线无盒返回 null */
function objectBox(o: CanvasObject, offsets?: ReadonlyMap<string, { dx: number; dy: number }>): Rect | null {
  const b = objectBBox(o)
  if (!b) return null
  const d = offsets?.get(o.id)
  return d ? { ...b, x: b.x + d.dx, y: b.y + d.dy } : b
}


export { fillPatternId, nodeFillAttr, nodeTextHalo, nodeShapePaths, outlinePath, doubleLinePath, nodePaint } from './node-presentation.ts'

/** 单个节点的形状+文字（基座与拖动 ghost 共用）。颜色解析见 nodePaint。 */
function appendNode(g: SVGElement, n: LaidNode, theme: Theme, nodeColors: ReadonlyMap<string, string>, map: MindMap, patternDefs: SVGElement[], scope: string, zoom = 1) {
  const grp = el('g', { 'data-id': n.id, 'font-family': fontStack(n.node.style?.font) })
  const marks = nodePresentation(n, { map, theme, colors: nodeColors, pageLocal: ownerIndex(map).has(n.id), zoom,
    measure: (text, size, weight, font) => { const ctx = measureCtx(); ctx.font = `${weight} ${size}px ${fontStack(font)}`; return ctx.measureText(text).width },
  })
  let title: SVGElement | null = null
  for (const mark of marks) {
    if (mark.kind === 'path') {
      let fill = mark.fill
      if (mark.texture) {
        const id = fillPatternId(n.id, mark.texture, scope)
        fill = `url(#${id})`
        if (!patternDefs.some(d => d.getAttribute('id') === id)) {
          const spec = fillPatternSpec(mark.texture, mark.seed)
          const pattern = el('pattern', { id, patternUnits: 'userSpaceOnUse', x: Math.round(mark.x), y: Math.round(mark.y), width: spec.w, height: spec.h })
          pattern.append(el('path', { d: spec.d, fill: 'none', stroke: mark.fill, 'stroke-width': spec.strokeW, 'stroke-linecap': 'round' }))
          patternDefs.push(pattern)
        }
      }
      grp.append(el('path', { d: mark.d, fill, 'fill-opacity': mark.opacity, stroke: mark.stroke, 'stroke-width': mark.width, 'stroke-linecap': 'round', ...(mark.dash ? { 'stroke-dasharray': mark.dash.join(' ') } : {}) }))
    } else if (mark.kind === 'text') {
      const attrs = { x: mark.x, 'text-anchor': mark.anchor, 'font-family': fontStack(mark.font), 'font-size': mark.size, 'font-weight': mark.weight, fill: mark.color,
        ...(mark.italic ? { 'font-style': 'italic' } : {}), ...(mark.halo ? { stroke: mark.paper, 'stroke-width': mark.halo, 'stroke-linejoin': 'round', 'paint-order': 'stroke' } : {}) }
      if (mark.role === 'title') {
        if (!title) { title = el('text', attrs); grp.append(title) }
        const span = el('tspan', { x: mark.x, y: mark.y }); span.textContent = mark.text; title.append(span)
      } else { const text = el('text', { ...attrs, y: mark.y }); text.textContent = mark.text; grp.append(text) }
    } else if (mark.kind === 'image') {
      grp.append(el('image', { href: mark.src, x: mark.box.x, y: mark.box.y, width: mark.box.w, height: mark.box.h, preserveAspectRatio: 'none' }))
    } else if (mark.kind === 'icon') {
      const icon = iconElement(mark.icon, mark.color)
      icon.setAttribute('x', String(mark.box.x)); icon.setAttribute('y', String(mark.box.y)); grp.append(icon)
    } else {
      appendContent(grp, mark.content, mark.box, mark.ink, mark.pageLocal)
    }
  }
  g.append(grp)
  return grp
}

/** 连线几何路径：按分支形状选基线（主线/ghost/导出器共用同一选择）。
 * 手绘抖动在此叠加；波浪起伏在 linkRenderD 层叠加（先基线后正弦，互不混音） */
export function linkPath(l: LinkGeom, shape: LinkShapeName, seed: number): string {
  if (shape === 'curve' && l.controlX !== undefined) return `M${l.x1} ${l.y1} C${l.controlX} ${l.y1},${l.controlX} ${l.y2},${l.x2} ${l.y2}`
  switch (shape) {
    case 'straight':
      return wobbleLine(l.x1, l.y1, l.x2, l.y2, seed, 1.4)
    case 'elbow':
      return wobbleElbow(l.x1, l.y1, l.x2, l.y2, seed)
    case 'roundElbow':
    case 'arc':
      return smoothOpen(linkSamples(l, shape), seed)
    case 'curve':
      return wobbleCurve(l.x1, l.y1, l.x2, l.y2, seed, 1.8)
  }
}

/** 未采基线的手绘抖动闭合（roundElbow/arc 共用）：逐点轻抖后平滑 */
function smoothOpen(pts: Pt[], seed: number): string {
  const rand = rng(seed)
  const out = pts.map((p, i) => ({ x: p.x + (rand() - 0.5) * 1.6, y: p.y + (rand() - 0.5) * 1.6 }))
  if (out.length > 1) {
    out[0] = pts[0]
    out[out.length - 1] = pts[pts.length - 1] // 端点钉死
  }
  return smoothOpenPath(out)
}

/** 连线最终渲染描述（票 04：形状 × 线条 组合单源）：
 * d=路径（波浪=基线+正弦，其余=基线+抖动）；dashed=虚线叠加；null=无线条（终点随隐，spec 决策 5） */
export function linkRenderD(
  l: LinkGeom,
  shape: LinkShapeName,
  stroke: LineStroke,
  seed: number,
): { d: string; dashed: boolean } | null {
  if (stroke === 'none') return null
  if (stroke === 'wavy' || stroke === 'wavyDashed') {
    return { d: wavyAlong(linkSamples(l, shape), seed), dashed: stroke === 'wavyDashed' }
  }
  return { d: linkPath(l, shape, seed), dashed: stroke === 'dashed' }
}

/** 连线完整绘制描述（票 05：含渐变粗细，主线/ghost/导出器三处同源）。
 * 渐变 × 实线/波浪 → 变宽轮廓（fill 模式）；渐变 × 虚线 → 退回中心线走 dash（变宽轮廓无法 dash，spec 决策 5）；
 * 无线条 → null（终点随隐）。endpoint 非空时调用方在子节点端画字形。 */
export interface LinkPaintStyle {
  smooth?: boolean
  shape: LinkShapeName
  stroke: LineStroke
  width: number
  taper?: TaperDir
  endpoint: EndpointKind
}

export interface LinkPaint {
  d: string
  mode: 'stroke' | 'fill'
  dashed: boolean
  /** 子节点端终点字形（endpoint='none' 或无线条时为 undefined） */
  endpoint?: EndpointGlyph
  endpointFilled?: boolean
}

/** 终点字形尺寸：随线宽微调（spec 票 05），渐细端按局部宽缩小 */
export function endpointSize(width: number, taper?: TaperDir): number {
  const local = taper === 'thin' ? width * TAPER_THIN_RATIO : width
  return Math.max(3, Math.min(8, local * 2.1))
}

export function linkPaint(l: LinkGeom, s: LinkPaintStyle, seed: number): LinkPaint | null {
  if (s.stroke === 'none') return null
  const tapered = (s.taper === 'thin' || s.taper === 'thick') && (s.stroke === 'solid' || s.stroke === 'wavy')
  let d: string
  let dashed = false
  let mode: 'stroke' | 'fill' = 'stroke'
  if (tapered) {
    const base = s.stroke === 'wavy' ? wavyPoints(linkSamples(l, s.shape), seed) : linkSamples(l, s.shape)
    const [w0, w1] = s.taper === 'thin' ? [s.width, s.width * TAPER_THIN_RATIO] : [s.width * TAPER_THIN_RATIO, s.width]
    d = taperedStroke(base, w0, w1, seed)
    mode = 'fill'
  } else {
    const r = linkRenderD(l, s.shape, s.stroke, seed)
    if (!r) return null
    d = r.d
    if (s.smooth && s.shape === 'curve' && s.stroke === 'solid') {
      const bend = (l.x2 - l.x1) * 0.5
      d = `M${l.x1} ${l.y1} C${l.controlX ?? l.x1 + bend} ${l.y1},${l.controlX ?? l.x2 - bend} ${l.y2},${l.x2} ${l.y2}`
    }
    dashed = r.dashed
  }
  const result: LinkPaint = { d, mode, dashed }
  if (s.endpoint !== 'none') {
    const size = endpointSize(s.width, s.taper)
    const angle = linkEndTangent(l, s.shape)
    const glyph = endpointGlyph(s.endpoint, l.x2, l.y2, angle, size)
    result.endpoint = glyph
    result.endpointFilled = glyph.filled
  }
  return result
}

const patternScopes = new WeakMap<SVGSVGElement, string>()
let nextPatternScope = 0

export function render(
  svg: SVGSVGElement,
  map: MindMap,
  view: View = IDENTITY,
  selectedIds: ReadonlySet<string> = new Set(),
  hoverId: string | null = null,
  drag?: DragRender,
  /** 编辑中的节点：底层不再绘制（编辑框不透明覆盖，避免旧字透出） */
  hiddenId: string | null = null,
  /** 框选矩形（屏幕坐标，词汇见 CONTEXT.md「框选」）；仅在拖拽进行中传入 */
  marquee?: { x0: number; y0: number; x1: number; y1: number } | null,
  /** 对象拖动中的临时位移（画布坐标增量，id → 偏移）：松手才 mutate，拖动中只改渲染 */
  objectOffsets?: ReadonlyMap<string, { dx: number; dy: number }>,
  interaction?: { primary: string | null; from?: string | null; target?: string | null; pointer?: { x: number; y: number }; invalid?: boolean },
): RenderResult {
  map = reflowTextBoxes(map, domMeasurer())
  let scope = patternScopes.get(svg)
  if (!scope) {
    scope = `svg${++nextPatternScope}-`
    patternScopes.set(svg, scope)
  }
  svg.innerHTML = ''
  // v9 票 04：文档级背景覆盖在此收口 —— 后续全部 theme.paper 用法（画布底/文字垫片/徽章底）自动跟随
  // v14 票 02：ink 经 inkOf 收口（ADR-0011 暗纸联动写入的文档级覆盖全链跟随）
  const theme = { ...resolveTheme(map), paper: paperOf(map), ink: inkOf(map) }
  const nodeColors = pageNodeColors(map)
  svg.style.background = theme.paper

  const layout = computeWorldLayout(map, domMeasurer())

  const g = el('g', { transform: `translate(${view.tx} ${view.ty}) scale(${view.k})` })
  svg.appendChild(g)

  // ---- 纸型层（v14 票 02，ADR-0010）：世界坐标 pattern rect，随视图平移缩放 = 真实纸张。
  // blank 不建层（R1 回归线）；pointer-events:none 不拦交互（R4）；图案对齐世界原点，与导出一致（R3） ----
  const paperStyle = paperStyleOf(map)
  if (paperStyle !== 'blank') {
    const tile = paperTileSpec(paperStyle, paperDensityOf(map))
    const patId = `${scope}paper`
    const defs = el('defs', {})
    const pat = el('pattern', { id: patId, width: tile.size, height: tile.size, patternUnits: 'userSpaceOnUse' })
    for (const p of tile.paths) {
      pat.appendChild(
        el('path', {
          d: 'M ' + p.pts.map(([x, y]) => `${x} ${y}`).join(' L '),
          fill: 'none',
          stroke: theme.ink,
          'stroke-width': p.w,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          opacity: p.o * (map.paperOpacity ?? 1),
        }),
      )
    }
    for (const d of tile.dots) {
      pat.appendChild(el('circle', { cx: d.x, cy: d.y, r: d.r, fill: theme.ink, opacity: d.o * (map.paperOpacity ?? 1) }))
    }
    defs.appendChild(pat)
    svg.appendChild(defs)
    const k = view.k || 1
    const wpx = svg.clientWidth || window.innerWidth
    const hpx = svg.clientHeight || window.innerHeight
    g.insertBefore(
      el('rect', {
        x: -view.tx / k,
        y: -view.ty / k,
        width: wpx / k,
        height: hpx / k,
        fill: `url(#${patId})`,
        'pointer-events': 'none',
      }),
      g.firstChild,
    )
  }

  const pages = paperLayers(g, map, view, scope)
  const owners = ownerIndex(map)
  const themeFor = (id: string) => { const local=pageAppearance(map,pageById(map,owners.get(id)));return {...resolveTheme(local),paper:paperOf(local),ink:inkOf(local)} }
  const dragging = !!drag
  const objects = map.objects ?? []
  const boxOfId = (id: string): Rect | null => {
    const n = layout.nodes.find((x) => x.id === id)
    if (n) return { x: n.x, y: n.y, w: n.w, h: n.h }
    const o = findObject(map, id)
    return o ? objectBox(o, objectOffsets) : null
  }

  // ---- 对象层·分组框（ADR-0003 层序：分组框 < 树连线 < 关系线 < 树节点 < 图片/贴纸） ----
  for (const o of objects) {
    if (o.kind !== 'group') continue
    const g = pages.groupFor(o.id), theme = themeFor(o.id)
    const b = objectBox(o, objectOffsets)!
    g.appendChild(
      el('path', {
        d: wobbleRoundRect(b.x, b.y, b.w, b.h, 18, o.seed, 1.4),
        fill: theme.ink,
        'fill-opacity': 0.025,
        stroke: theme.ink,
        'stroke-width': 1.8,
        'stroke-linecap': 'round',
        ...(o.dashed === false ? {} : { 'stroke-dasharray': '9 7' }),
      }),
    )
  }

  // ---- 对象层·外框（v9 票 09，ADR-0004）：与分组框同层（树节点之下）。
  // 几何随布局派生（anchoredSiblingBox）；颜色缺省跟随锚定兄弟的分支色 ----
  for (const o of objects) {
    if (o.kind !== 'boundary') continue
    const g = pages.groupFor(o.id), theme = themeFor(o.id)
    const b = anchoredSiblingBox(o.anchor, layout.nodes, layout.links)
    if (!b) continue // 锚定成员缺失（级联应已消亡）：防御性跳过
    const parentNode = layout.nodes.find((n) => n.id === o.anchor.parentId)
    const strokeC = o.color ?? (parentNode ? nodeColors.get(parentNode.id) ?? theme.ink : theme.ink)
    g.appendChild(
      el('path', {
        d: outlinePath(b, o.seed), // 票 03：外框与节点轮廓同一笔触（r16 · amp1.1）
        fill: strokeC,
        'fill-opacity': 0.04,
        stroke: strokeC,
        'stroke-width': 2.4,
        'stroke-linecap': 'round',
        ...(o.dashed === true ? { 'stroke-dasharray': '9 7' } : {}),
      }),
    )
  }

  // ---- 对象层·概要（v9 票 10，ADR-0004）：括号 + 文字盒（树节点之下），几何随布局派生 ----
  for (const o of objects) {
    if (o.kind !== 'summary') continue
    const g = pages.groupFor(o.id), theme = themeFor(o.id)
    const mctx = measureCtx()
    mctx.font = `14px ${FONT_STACK}`
    const gm = summaryGeomOf(o.anchor, o.text, layout.nodes, layout.links, (s) => mctx.measureText(s).width, o.seed)
    if (!gm) continue
    const { bracket, text } = gm
    g.appendChild(
      el('path', {
        d: braceD(bracket.x, bracket.top, bracket.bottom, bracket.depth, bracket.dir),
        fill: 'none',
        stroke: theme.ink,
        'stroke-width': 1.8,
        'stroke-linecap': 'round',
      }),
    )
    g.appendChild(
      el('path', {
        d: wobbleRoundRect(text.x, text.y, text.w, text.h, 8, o.seed, 1),
        fill: theme.paper,
        stroke: theme.ink,
        'stroke-width': 1.2,
      }),
    )
    const t = el('text', { x: text.x + 6, 'font-size': 14, fill: theme.ink, 'font-family': FONT_STACK })
    gm.lines.forEach((ln, i) => {
      const ts = el('tspan', { x: text.x + 6, y: text.y + 15 + i * 18 })
      ts.textContent = ln
      t.appendChild(ts)
    })
    g.appendChild(t)
  }

  // ---- 鱼骨主刺（v15 票 02，ADR-0012）：鱼骨头节点的水平主线，画在树连线之下；
  // 颜色随鱼骨头节点生效色、线宽随其分支（略粗于连线以立骨架） ----
  for (const s of layout.spines ?? []) {
    const g = pages.groupFor(s.from), theme = themeFor(s.from)
    if (dragging && drag!.memberIds.has(s.from)) continue // 拖动中骨架随 ghost
    const head = layout.nodes.find((n) => n.id === s.from)
    const color = nodeColors.get(s.from) ?? theme.ink
    g.appendChild(el('path', {
      d: `M ${s.x1} ${s.y1} L ${s.x2} ${s.y2}`,
      fill: 'none',
      stroke: color,
      'stroke-width': branchLineWidthOf(map, head?.branchIndex ?? -1) + 0.6,
      'stroke-linecap': 'round',
    }))
  }

  // 连线在最底层；被拖子树相关连线全部隐藏（原位置只留空位，视觉上「线条消失」）。
  // 线形/线宽按分支解析（v9 票 07）：头覆盖 → 文档级 → 主题默认；wobble 抖动幅度恒定（封顶，不随线宽放大）
  for (const l of layout.links) {
    const g = pages.groupFor(l.to), theme = themeFor(l.to)
    if (l.hidden) continue
    if (dragging && (drag!.memberIds.has(l.from) || drag!.memberIds.has(l.to))) continue
    // 形状 × 线条 × 终点 × 渐变 全单源解析（票 06 头覆盖推广：自子节点沿父链逐节点解析）；
    // 线色随子节点生效色（v15 票 04，ADR-0013）
    const ls = linkStyleOf(map, l.to)
    if (usesClearStyle(map)) ls.width = Math.max(ls.width, 1 / view.k)
    const color = nodeColors.get(l.to) ?? theme.ink
    const painted = linkPaint(l, {
      shape: ls.shape,
      stroke: ls.stroke,
      width: ls.width,
      smooth: usesClearStyle(map),
      taper: ls.taper,
      endpoint: ls.endpoint,
    }, hashSeed(l.to))
    if (!painted) continue
    g.appendChild(
      painted.mode === 'fill'
        ? el('path', { d: painted.d, fill: color, stroke: 'none' })
        : el('path', {
            d: painted.d,
            fill: 'none',
            stroke: color,
            'stroke-width': ls.width,
            'stroke-linecap': 'round',
            ...(painted.dashed ? { 'stroke-dasharray': '9 7' } : {}),
          }),
    )
    if (painted.endpoint) {
      g.appendChild(el('path', {
        d: painted.endpoint.d,
        fill: painted.endpointFilled ? color : 'none',
        stroke: painted.endpointFilled ? 'none' : color,
        'stroke-width': 2,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      }))
    }
  }

  // ---- 对象层·关系线：两端锚定端元盒缘最近点，手绘弧线＋箭头，标签纸底光晕 ----
  for (const o of objects) {
    if (o.kind !== 'edge') continue
    const g = pages.groupFor(o.id), theme = themeFor(o.id)
    const a = boxOfId(o.from)
    const b = boxOfId(o.to)
    if (!a || !b) continue // 端元缺失（理论上级联已删线）：防御性跳过
    const curve = edgeGeometry(a, b, o, layout.nodes)
    // 线色（v9 票 05）：跟随 from 端（节点=分支色，对象=墨色）或显式自选；箭头随线色
    const fromNode = layout.nodes.find((n) => n.id === o.from)
    const edgeColor = o.color ?? (fromNode ? nodeColors.get(o.from) ?? theme.ink : theme.ink)
    const edgeCommon = { fill: 'none', stroke: edgeColor, 'stroke-width': o.width ?? 2.2, 'stroke-linecap': 'round' }
    g.appendChild(el('path', { d: curve.d, ...edgeCommon, 'data-edge-id': o.id, ...(o.lineStyle === 'dashed' ? { 'stroke-dasharray': '9 7' } : {}) }))
    for (const d of curve.arrows) g.appendChild(el('path', { d, ...edgeCommon }))
    if (o.label) {
      const t = el('text', {
        x: curve.label.x,
        y: curve.label.y - 7,
        'text-anchor': 'middle',
        'font-size': 14,
        fill: theme.ink,
        stroke: theme.paper,
        'stroke-width': 6,
        'paint-order': 'stroke',
        'font-family': FONT_STACK,
      })
      t.textContent = o.label
      g.appendChild(t)
    }
  }

  const patternDefs: SVGElement[] = [] // 填充纹理 defs（票 06）：节点循环内收集、循环后插入
  for (const n of layout.nodes) {
    if (dragging && drag!.memberIds.has(n.id)) {
      // 原位置：跳过（ghost 随光标整棵随行）
      continue
    }
    if (hiddenId && n.id === hiddenId) continue // 编辑中：底层节点让位给不透明编辑框
    appendNode(pages.groupFor(n.id), n, themeFor(n.id), nodeColors, pageAppearance(map,pageById(map,owners.get(n.id))), patternDefs, scope, view.k)
  }
  // Content shares geometry with the PNG renderer.
  for (const o of objects) {
    if (o.kind === 'textBox' && o.id !== hiddenId) {
      const local = pageAppearance(map, pageById(map, owners.get(o.id)))
      const n = layoutTextBox(local, o, domMeasurer()), offset = objectOffsets?.get(o.id)
      if (offset) { n.x += offset.dx; n.y += offset.dy }
      const group = appendNode(pages.groupFor(o.id), n, themeFor(o.id), new Map(), local, patternDefs, scope, view.k)
      group.removeAttribute('data-id'); group.setAttribute('data-textbox-id', o.id)
    }
    if (isContent(o)) { const g=pages.groupFor(o.id), theme=themeFor(o.id); const cg = el('g', { 'font-family': fontStack(map.font) }); appendContent(cg, o, objectBox(o, objectOffsets)!, theme.ink,owners.has(o.id)); g.append(cg) }
  }

  if (patternDefs.length) {
    const defs = el('defs', {})
    for (const p of patternDefs) defs.appendChild(p)
    g.insertBefore(defs, g.firstChild)
  }

  // 选中态：手绘虚线环，贴着节点外扩一圈（多选成员全部同款、主选中不特殊标记，
  // 词汇见 CONTEXT.md「多选」；拖动中的被拖节点/编辑中的节点不重复画环）
  for (const sid of selectedIds) {
    if (sid === hiddenId || (dragging && drag!.memberIds.has(sid))) continue
    const n = layout.nodes.find((x) => x.id === sid)
    if (n) {
      const pad = 7
      const state = feedbackFor(sid, { ids: [...selectedIds], primary: interaction?.primary ?? [...selectedIds].at(-1) ?? null }, hiddenId, interaction?.from, interaction?.target)
      const common = {
        fill: 'none',
        'stroke-width': state === 'primary' ? 2.6 : 1.5,
        'vector-effect': 'non-scaling-stroke',
        'data-selection': state,
        stroke: '#527ca2',
        'stroke-linecap': 'round',
        opacity: state === 'primary' ? 1 : 0.65,
      }
      if (effectiveShape(n.depth, n.node.style) === 'ellipse') {
        g.appendChild(
          el('path', {
            d: wobbleEllipse(n.x + n.w / 2, n.y + n.h / 2, n.w / 2 + pad, n.h / 2 + pad, 1, 0),
            ...common,
          }),
        )
      } else {
        g.appendChild(
          el('path', {
            d: wobbleRoundRect(n.x - pad, n.y - pad, n.w + pad * 2, n.h + pad * 2, 8, 1, 0),
            ...common,
          }),
        )
      }
      continue
    }
    // 对象选中环：带盒对象画虚线框；关系线加粗半透明高亮自身曲线
    const obj = findObject(map, sid)
    if (!obj) continue
    const seed2 = obj.seed ^ 0x5f356495
    const box = objectBox(obj, objectOffsets)
    if (box) {
      g.appendChild(
        el('path', {
          d: wobbleRoundRect(box.x - 6, box.y - 6, box.w + 12, box.h + 12, 14, seed2, 2),
          fill: 'none',
          stroke: theme.ink,
          'stroke-width': 1.6,
          'vector-effect': 'non-scaling-stroke',
          'stroke-linecap': 'round',
          opacity: 0.75,
        }),
      )
    } else if (obj.kind === 'edge') {
      const a = boxOfId(obj.from)
      const b = boxOfId(obj.to)
      if (a && b) {
        const curve = edgeGeometry(a, b, obj, layout.nodes)
        g.appendChild(
          el('path', {
            d: curve.d,
            fill: 'none',
            stroke: theme.ink,
            'stroke-width': 6,
            'stroke-linecap': 'round',
            opacity: 0.22,
            'vector-effect': 'non-scaling-stroke',
          }),
        )
        if (selectedIds.size === 1) {
          g.appendChild(el('path', { d: `M${curve.from.x} ${curve.from.y} L${curve.control.x} ${curve.control.y} L${curve.to.x} ${curve.to.y}`, fill: 'none', stroke: theme.ink, opacity: .3, 'stroke-width': 1 / view.k }))
          for (const end of ['from', 'to', 'control'] as const) {
            const p = curve[end]
            g.appendChild(el('circle', { cx: p.x, cy: p.y, r: (end === 'control' ? 5 : 7) / view.k, fill: theme.paper, stroke: theme.ink, 'stroke-width': 2 / view.k, 'data-edge-handle': end, 'data-edge': obj.id }))
          }
        }
      }
    }
  }

  if (interaction?.from || interaction?.target) {
    for (const [id, state] of [[interaction.from, 'source'], [interaction.target, 'target']] as const) {
      const b = id ? boxOfId(id) : null
      if (!b) continue
      g.appendChild(el('rect', { x: b.x - 6, y: b.y - 6, width: b.w + 12, height: b.h + 12, rx: 6,
        fill: 'none', stroke: state === 'source' ? '#16856a' : interaction.invalid ? '#c54242' : '#267cc0', 'stroke-width': 3 / view.k, 'data-connection': state }))
    }
    const a = interaction.from ? boxOfId(interaction.from) : null
    const b = interaction.target ? boxOfId(interaction.target) : null
    const p = interaction.pointer
    if (a && p) g.appendChild(el('path', { d: edgeGeometry(a, b ?? { ...p, w: 0, h: 0 }).d,
      fill: 'none', stroke: interaction.invalid ? '#c54242' : '#16856a', 'stroke-width': 2 / view.k, opacity: .7, 'data-connection': 'preview' }))
  }

  // 落点预示：落点占位符（画布坐标）——分支色半透明填充＋虚线描边，XMind 同款「底部阴影」：
  // 所见即松手后挂靠/插入的真实位置（landingBox dry-run，原位时无预示不画）
  if (drag?.hint) {
    const b = drag.hint.box
    const pad = 6
    g.appendChild(
      el('path', {
        d: wobbleRoundRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2, 16, hashSeed('landing'), 2),
        fill: drag.hint.color,
        'fill-opacity': 0.15,
        stroke: drag.hint.color,
        'stroke-width': 2.4,
        'stroke-dasharray': '9 7',
        'stroke-linecap': 'round',
        opacity: 0.9,
      }),
    )
  }

  // 拖动 ghost：整棵子树跟随光标（拖起点钉在光标下），半透明 —— 与落点占位符形成
  // 「手持 vs 落点」对比（XMind 同款）；磁吸态叠加吸力偏移（pull ≤10px，朝目标）
  if (drag) {
    const gx = drag.sx - view.k * drag.grab.x + (drag.pull?.dx ?? 0)
    const gy = drag.sy - view.k * drag.grab.y + (drag.pull?.dy ?? 0)
    const ghost = el('g', { transform: `translate(${gx} ${gy}) scale(${view.k})`, opacity: '0.55' })
    for (const l of layout.links) {
    const theme = themeFor(l.to)
    if (l.hidden) continue
      if (!drag.memberIds.has(l.from) || !drag.memberIds.has(l.to)) continue
      const ls = linkStyleOf(map, l.to)
    if (usesClearStyle(map)) ls.width = Math.max(ls.width, 1 / view.k) // ghost 与实线同源解析
      const color = nodeColors.get(l.to) ?? theme.ink
      const painted = linkPaint(l, {
        shape: ls.shape,
        stroke: ls.stroke,
        width: ls.width,
      smooth: usesClearStyle(map),
        taper: ls.taper,
        endpoint: ls.endpoint,
      }, hashSeed(l.to))
      if (!painted) continue
      ghost.appendChild(
        painted.mode === 'fill'
          ? el('path', { d: painted.d, fill: color, stroke: 'none' })
          : el('path', {
              d: painted.d,
              fill: 'none',
              stroke: color,
              'stroke-width': ls.width,
              'stroke-linecap': 'round',
              ...(painted.dashed ? { 'stroke-dasharray': '9 7' } : {}),
            }),
      )
      if (painted.endpoint) {
        ghost.appendChild(el('path', {
          d: painted.endpoint.d,
          fill: painted.endpointFilled ? color : 'none',
          stroke: painted.endpointFilled ? 'none' : color,
          'stroke-width': 2,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        }))
      }
    }
    for (const n of layout.nodes) {
      if (!drag.memberIds.has(n.id)) continue
      appendNode(ghost, n, theme, nodeColors, map, patternDefs, scope, view.k)
    }
    // ghost 的 appendNode 在主 defs 插入之后才收集 pattern（票 06）：补插遗漏的，否则拖动中纹理节点 fill 引用落空
    const ghostPats = patternDefs.filter((p) => !p.parentNode)
    if (ghostPats.length) {
      const ghostDefs = el('defs', {})
      for (const p of ghostPats) ghostDefs.appendChild(p)
      ghost.insertBefore(ghostDefs, ghost.firstChild)
    }
    // 挂到 svg 而非 g：ghost 自带 translate(gx,gy) scale(k) 已按视口空间计算
    // （gx = sx − k·grab），若再嵌套在带视图变换的 g 里会双重缩放（k²）+ 平移偏移
    svg.appendChild(ghost)

    // 半透明磁吸牵引线（词汇见 CONTEXT.md「磁吸」）：目标盒缘最近点 → 光标，目标分支色；
    // 屏幕空间绘制。不画「盒缘到 ghost 盒缘」—— 磁吸距离内两盒几乎贴合，那条线只有几像素
    // 且会被 ghost 自身遮住；画到光标才能始终可见地表达「这个目标已被连线锁定」。
    // 光标已在目标盒内时占位符已足够，不画。
    if (drag.linkColor && drag.linkTo) {
      const t = drag.linkTo
      const tx0 = t.x * view.k + view.tx
      const ty0 = t.y * view.k + view.ty
      const ex = Math.max(tx0, Math.min(tx0 + t.w * view.k, drag.sx))
      const ey = Math.max(ty0, Math.min(ty0 + t.h * view.k, drag.sy))
      if (ex !== drag.sx || ey !== drag.sy) {
        svg.appendChild(
          el('path', {
            d: wobbleLine(ex, ey, drag.sx, drag.sy, hashSeed('magnet-link'), 1.2),
            stroke: drag.linkColor,
            'stroke-width': 2.6,
            'stroke-linecap': 'round',
            fill: 'none',
            'stroke-dasharray': '10 6',
            opacity: 0.75,
          }),
        )
      }
    }
  }

  // 折叠气泡：悬停节点朝外一侧（根节点两侧各一）；叶子不显示；拖动中/编辑中不出现
  const bubbles: Array<{ id: string; side: Side; x: number; y: number }> = []
  if (hoverId && hoverId !== hiddenId && !dragging) {
    const n = layout.nodes.find((x) => x.id === hoverId)
    if (n && n.node.children.length > 0) {
      const by = n.y + n.h / 2
      const r = 11
      const drawBubble = (bx: number, side: Side) => {
        bubbles.push({ id: n.id, side, x: bx, y: by })
        g.appendChild(
          el('path', {
            d: wobbleEllipse(bx, by, r, r, n.node.seed ^ 0x1b873593, 1.2),
            fill: theme.paper,
            stroke: theme.ink,
            'stroke-width': 1.6,
          }),
        )
        const collapsed = !!n.node.collapsed
        const arm = 5
        // 横臂（＋/－ 共有）
        g.appendChild(
          el('path', {
            d: wobbleLine(bx - arm, by, bx + arm, by, (n.node.seed ^ 0x2c1b3c6d) >>> 0, 0.5),
            stroke: theme.ink,
            'stroke-width': 1.8,
            'stroke-linecap': 'round',
          }),
        )
        if (collapsed) {
          g.appendChild(
            el('path', {
              d: wobbleLine(bx, by - arm, bx, by + arm, (n.node.seed ^ 0x297a2ed3) >>> 0, 0.5),
              stroke: theme.ink,
              'stroke-width': 1.8,
              'stroke-linecap': 'round',
            }),
          )
        }
      }
      if (n.depth === 0) {
        if (n.node.collapsed) {
          // 折叠的主节点：可见子级为零，不能以「有可见分支」为前提 —— 直接在右侧画 ＋
          drawBubble(n.x + n.w + 16, 'right')
        } else {
          if (layout.nodes.some((x) => x.depth === 1 && x.side === 'right')) drawBubble(n.x + n.w + 16, 'right')
          if (layout.nodes.some((x) => x.depth === 1 && x.side === 'left')) drawBubble(n.x - 16, 'left')
        }
      } else {
        drawBubble(n.side === 'right' ? n.x + n.w + 16 : n.x - 16, n.side)
      }
    }
  }

  // 删除钮：恰好选中一个节点（非中心主题）时右上角的手绘 × 圆钮；拖动中/多选中不出现
  // （多选批量删除走键盘，一步撤销兜底）
  const deleteBtn: DeleteButton | null = null


  // 缩放手柄：恰好选中一个带盒对象（非拖动态）时右下角的等比缩放柄（画布坐标，
  // 恒定屏幕尺寸 9px：除以 view.k 后绘制）
  let objHandle: RenderResult['objHandle'] = null
  if (selectedIds.size === 1 && !dragging) {
    const sid = [...selectedIds][0]
    const obj = (map.objects ?? []).find((o) => o.id === sid)
    const box = obj ? objectBox(obj, objectOffsets) : null
    if (obj && box) {
      const hs = 9 / view.k
      const cx = box.x + box.w
      const cy = box.y + box.h
      g.appendChild(
        el('path', {
          d: wobbleRoundRect(cx - hs, cy - hs, hs * 2, hs * 2, 3, (obj.seed ^ 0x2545f491) >>> 0, 0.6),
          fill: theme.paper,
          stroke: theme.ink,
          'stroke-width': 1.6,
        }),
      )
      objHandle = { id: obj.id, cx, cy, r: 12 }
    }
  }

  // 框选矩形：屏幕空间虚线手绘风，不进视图变换 g（词汇见 CONTEXT.md「框选」）
  if (marquee) {
    const x = Math.min(marquee.x0, marquee.x1)
    const y = Math.min(marquee.y0, marquee.y1)
    const w = Math.abs(marquee.x1 - marquee.x0)
    const h = Math.abs(marquee.y1 - marquee.y0)
    if (w > 2 && h > 2) {
      svg.appendChild(
        el('path', {
          d: wobbleRoundRect(x, y, w, h, 10, hashSeed('marquee'), 2),
          fill: theme.ink,
          'fill-opacity': 0.05,
          stroke: theme.ink,
          'stroke-width': 1.6,
          'stroke-dasharray': '8 6',
          'stroke-linecap': 'round',
          opacity: 0.8,
        }),
      )
    }
  }

  return { ...layout, bubbles, deleteBtn, objHandle }
}
