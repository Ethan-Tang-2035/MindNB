/** 主题定义与解析。词汇见 CONTEXT.md（主题、手绘风、分支形状、线条、色卡）。
 * 全部主题都在手绘家族内变化：换纸底/墨色/分支色板/默认线形，抖动笔触不变。 */

import type { MindMap, NodeData } from './model.ts'
import { branchHeads, findNode, findParent } from './model.ts'
import type { EndpointKind, FillTexture } from './strokes.ts'
import type { PaperDensity, PaperStyleId } from './paper.ts'
import { isDarkColor } from './paper.ts'

export type ThemeId =
  | 'clear' | 'crayon' | 'plain' | 'kraft' | 'indigo' | 'night'
  | 'charcoal' | 'chalkboard' | 'blueprint' | 'watercolor' | 'journal'

/** 分支形状（几何维度，ADR-0009 线形解耦）：曲线/直线/折线/圆角折线/弧线 */
export type BranchShape = 'curve' | 'straight' | 'elbow' | 'roundElbow' | 'arc'

/** 线条（笔画维度，ADR-0009 线形解耦）：实线/虚线/波浪实线/波浪虚线/无线条 */
export type LineStroke = 'solid' | 'dashed' | 'wavy' | 'wavyDashed' | 'none'

/** 遗留线形（v9 单字段混装 形状×虚线）：读取归一（normalizeLineShape），新写入不产生该值 */
export type LineShape = 'curve' | 'straight' | 'elbow' | 'dashed'

/** 渐变方向（粗细维度，词汇见 CONTEXT.md「渐变粗细」）：渐细=父粗子细，渐粗=父细子粗；缺省=固定宽 */
export type TaperDir = 'thin' | 'thick'

/** 填充模式（词汇见 CONTEXT.md「填充纹理」）：实心/无填充 + 5 种排线纹理；缺省=实心 */
export type FillPattern = 'solid' | 'none' | FillTexture

/** 终点词表从原语库转出口（域内统一从 theme 引用，与 BranchShape 等同住） */
export type { EndpointKind, FillTexture } from './strokes.ts'

/** 遗留线形归一（ADR-0009）：'dashed' → 曲线×虚线；其余 → 形状×实线。零迁移，仅读取归一。
 * 入参放宽到 BranchShape：新旧词表共用字段（branchShape）里的非 dashed 值原样通过 */
export function normalizeLineShape(ls: LineShape | BranchShape): { shape: BranchShape; stroke: LineStroke } {
  return ls === 'dashed' ? { shape: 'curve', stroke: 'dashed' } : { shape: ls, stroke: 'solid' }
}

export interface Theme {
  id: ThemeId
  name: string
  /** 纸底色 */
  paper: string
  /** 墨色：文字/描边/浮层基色 */
  ink: string
  /** 中心主题填充 */
  rootFill: string
  /** 分支色板：彩虹分支逐级续轮取色（ADR-0013），每个分支点的子分支从「父色下一位」起连转 */
  palette: string[]
  /** 默认线形（文档未显式覆盖时生效；遗留字段，v12 起由 branchShape/branchLine 两维度接替） */
  lineShape: LineShape
  /** 默认分支形状与线条（v12，ADR-0009 两正交维度的主题默认） */
  branchShape: BranchShape
  branchLine: LineStroke
  /** 默认纸型（v14 票 01，ADR-0010）：缺省 blank=空白（存量主题不带即现状） */
  paperStyle?: PaperStyleId
  /** 浮层配色（编辑框/格式面板/选中环）：夜航需深底浅字 */
  chrome: { bg: string; fg: string; border: string }
}

/** 10 个内置主题。crayon 即 v4 现状（回归线）：常量与 render.ts 旧硬编码逐一对应。
 * v14 票 04 扩 5 主题（勾选页 T1–T5）：暗色系（炭黑岩/小黑板/蓝图）+ 纸感系（水彩纸/方格手账）；
 * 蓝图/方格手账携带差异化默认线形与默认纸型（ADR-0009/0010 维度默认值）。 */
export const THEMES: Theme[] = [
  {
    id: 'crayon',
    name: '蜡笔米黄',
    paper: '#FBF1DC',
    ink: '#4A3F35',
    rootFill: '#F9C74F',
    palette: ['#E4572E', '#3F88C5', '#37956F', '#9B5DE5', '#F15BB5', '#F5A623', '#5E6FA3', '#C0563B'],
    lineShape: 'curve',
    branchShape: 'curve',
    branchLine: 'solid',
    chrome: { bg: '#FFFCF0', fg: '#4A3F35', border: '#4A3F35' },
  },
  {
    id: 'plain',
    name: '素笺',
    paper: '#FCFBF6',
    ink: '#3A3D42',
    rootFill: '#DCE3EC',
    palette: ['#6E8CAD', '#7FA08A', '#A98BA6', '#C2A578', '#8BA3B5', '#B08968', '#7B8FA1', '#9C9A6B'],
    lineShape: 'curve',
    branchShape: 'curve',
    branchLine: 'solid',
    chrome: { bg: '#FFFFFF', fg: '#3A3D42', border: '#3A3D42' },
  },
  {
    id: 'kraft',
    name: '牛皮纸',
    paper: '#DDBE8C',
    ink: '#453322',
    rootFill: '#B87333',
    palette: ['#8C4A2F', '#6F7D4F', '#9C6B4F', '#7A5C43', '#A8763E', '#5E6B4A', '#94564A', '#7D6B5D'],
    lineShape: 'curve',
    branchShape: 'curve',
    branchLine: 'solid',
    chrome: { bg: '#EAD3A8', fg: '#453322', border: '#453322' },
  },
  {
    id: 'indigo',
    name: '靛蓝',
    paper: '#F4F6FA',
    ink: '#2C3646',
    rootFill: '#B9C6DE',
    palette: ['#3D5A98', '#4E7CA1', '#6B5EA8', '#4E8A7E', '#7A5FA8', '#3E7C6E', '#8A6FA0', '#4A6E8C'],
    lineShape: 'curve',
    branchShape: 'curve',
    branchLine: 'solid',
    chrome: { bg: '#FFFFFF', fg: '#2C3646', border: '#2C3646' },
  },
  {
    id: 'night',
    name: '夜航',
    paper: '#2A2A33',
    ink: '#E8E4D8',
    rootFill: '#46557A',
    palette: ['#FF9F80', '#8AD8C8', '#A3B7E8', '#E8A3C8', '#F2D38A', '#B5E08A', '#D8A8E8', '#8AC8E8'],
    lineShape: 'curve',
    branchShape: 'curve',
    branchLine: 'solid',
    chrome: { bg: '#3A3A45', fg: '#E8E4D8', border: '#E8E4D8' },
  },
  {
    id: 'charcoal',
    name: '炭黑岩',
    paper: '#23232B',
    ink: '#ECE7DA',
    rootFill: '#6B6F7E',
    palette: ['#F2927F', '#8FD3C3', '#A9BBEE', '#EFA9CD', '#F2D38A', '#B5E08A', '#8AC8E8', '#D8A8E8'],
    lineShape: 'curve',
    branchShape: 'curve',
    branchLine: 'solid',
    chrome: { bg: '#33333D', fg: '#ECE7DA', border: '#ECE7DA' },
  },
  {
    id: 'chalkboard',
    name: '小黑板',
    paper: '#2F4038',
    ink: '#F3EFE4',
    rootFill: '#55685C',
    palette: ['#F5C169', '#EE9A8C', '#A7CDA5', '#9BB8DD', '#E4A2C6', '#D8C9A5', '#B5E08A', '#F2D38A'],
    lineShape: 'curve',
    branchShape: 'curve',
    branchLine: 'solid',
    chrome: { bg: '#3E5147', fg: '#F3EFE4', border: '#F3EFE4' },
  },
  {
    id: 'blueprint',
    name: '蓝图',
    paper: '#1F2C4C',
    ink: '#E8EEF9',
    rootFill: '#33507F',
    palette: ['#7FB3E8', '#8FD3C3', '#F2C879', '#E89BB4', '#B39DE8', '#9AD1F0', '#A3E8D8', '#F0D8A8'],
    lineShape: 'curve',
    branchShape: 'straight',
    branchLine: 'dashed',
    paperStyle: 'grid',
    chrome: { bg: '#2A3A60', fg: '#E8EEF9', border: '#E8EEF9' },
  },
  {
    id: 'watercolor',
    name: '水彩纸',
    paper: '#FDFBF5',
    ink: '#4C4A57',
    rootFill: '#F4D8E0',
    palette: ['#E98FA8', '#8FBFE8', '#93CBA8', '#B79FE0', '#F0C987', '#8FB5B0', '#E8A3A3', '#A8C8E0'],
    lineShape: 'curve',
    branchShape: 'curve',
    branchLine: 'solid',
    chrome: { bg: '#FFFFFF', fg: '#4C4A57', border: '#4C4A57' },
  },
  {
    id: 'journal',
    name: '方格手账',
    paper: '#F7F1E3',
    ink: '#4E463C',
    rootFill: '#F2C94C',
    palette: ['#E4703F', '#4E96A8', '#7FA85C', '#C97BA0', '#8B7FC4', '#D9A441', '#C0563B', '#6E8CAD'],
    lineShape: 'curve',
    branchShape: 'roundElbow',
    branchLine: 'wavy',
    paperStyle: 'secGrid',
    chrome: { bg: '#FFFCF0', fg: '#4E463C', border: '#4E463C' },
  },
]

/** 清晰手绘 keeps the original theme fallback at index zero for old documents. */
THEMES.push({
  id: 'clear', name: '清晰手绘', paper: '#FCFBF7', ink: '#182338', rootFill: '#FFF0B8',
  palette: ['#F8783D', '#368BEC', '#369B57', '#9B6AE5', '#CA6D9D', '#459EA3'],
  lineShape: 'curve', branchShape: 'curve', branchLine: 'solid', paperStyle: 'blank',
  chrome: { bg: '#FFFFFF', fg: '#182338', border: '#DEE3EB' },
})

/** Legacy documents retain their renderer fallback until opened in the modern editor. */
export function usesClearStyle(map: MindMap): boolean {
  return map.visualStyle === 'clear' || map.theme === 'clear'
}

export const CLEAR_LINE_WIDTHS = [8, 5, 3.2] as const
export function levelLineWidthOf(map: MindMap, depth: number): number {
  const hierarchical = map.hierarchicalLines ?? usesClearStyle(map)
  return map.lineWidth ?? (hierarchical ? (map.levelLineWidths ?? CLEAR_LINE_WIDTHS)[Math.min(2, Math.max(0, depth - 1))] : DEFAULT_LINE_WIDTH)
}

/** 内置色卡（票 08，词汇见 CONTEXT.md「色卡」）：6 卡 × 6 色，绝对色值不随主题自适应。
 * 蜡笔=默认主题色板前 6；靛蓝/夜航=同名主题色板前 6；糖果=高饱和；莫兰迪=低饱和灰调；大地=暖棕。 */
export interface PaletteCard {
  id: string
  name: string
  colors: string[]
}

export const PALETTE_CARDS: PaletteCard[] = [
  { id: 'crayon', name: '蜡笔', colors: ['#E4572E', '#3F88C5', '#37956F', '#9B5DE5', '#F15BB5', '#F5A623'] },
  { id: 'indigo', name: '靛蓝', colors: ['#3D5A98', '#4E7CA1', '#6B5EA8', '#4E8A7E', '#7A5FA8', '#3E7C6E'] },
  { id: 'night', name: '夜航', colors: ['#FF9F80', '#8AD8C8', '#A3B7E8', '#E8A3C8', '#F2D38A', '#B5E08A'] },
  { id: 'candy', name: '糖果', colors: ['#FF5D8F', '#FF9F1C', '#FFD166', '#06D6A0', '#4CC9F0', '#B388EB'] },
  { id: 'morandi', name: '莫兰迪', colors: ['#8F9E8B', '#C2B8A3', '#A79E93', '#9D8F8F', '#B0A8B8', '#8B9DA5'] },
  { id: 'earth', name: '大地', colors: ['#A0674B', '#C19A6B', '#8C6D4F', '#B08968', '#7D5A44', '#9C7B5C'] },
  { id: 'pastel', name: '粉彩', colors: ['#F4B6C2', '#A8D8EA', '#B8E0C2', '#F9E2AE', '#C9B6E4', '#F4D8CB'] },
  { id: 'retro', name: '复古', colors: ['#C06E52', '#8A9A5B', '#D9A566', '#6E7F80', '#A5677B', '#8C6D4F'] },
]

/** 主题解析：缺省（含存量文档）回蜡笔米黄 —— 零迁移 */
export function resolveTheme(map: MindMap): Theme {
  return THEMES.find((t) => t.id === map.theme) ?? THEMES[0]
}

// ---- 分支形状 × 线条 解析链（票 02，ADR-0009）：头覆盖 → 文档级 → 主题默认，两维度各自独立 ----

/** 文档级遗留归一读取：新字段优先；无新字段时把遗留 lineShape 归一摊开（'dashed' → 曲线×虚线） */
export function docBranchShapeOf(map: MindMap): BranchShape {
  return map.branchShape ?? (map.lineShape ? normalizeLineShape(map.lineShape).shape : resolveTheme(map).branchShape)
}

/** 文档级线条：新字段优先；无则看遗留 lineShape 是否 'dashed'；再回主题默认 */
export function docBranchLineOf(map: MindMap): LineStroke {
  return map.branchLine ?? (map.lineShape === 'dashed' ? 'dashed' : resolveTheme(map).branchLine)
}

/** 分支头形状覆盖（遗留 'dashed' 归一为曲线；其余值新旧词表共用） */
function headShapeOverride(map: MindMap, i: number): BranchShape | undefined {
  const v = branchHeads(map)[i]?.branchShape
  return v === undefined ? undefined : normalizeLineShape(v).shape
}

/** 分支头线条覆盖：branchLine 优先；遗留 branchShape='dashed' 折算虚线（形状×虚线归一） */
function headStrokeOverride(map: MindMap, i: number): LineStroke | undefined {
  const head = branchHeads(map)[i]
  if (head?.branchLine) return head.branchLine
  return head?.branchShape === 'dashed' ? 'dashed' : undefined
}

/** 分支连线最终形状：头覆盖 → 文档级 → 主题默认（词汇见 CONTEXT.md「分支形状」） */
export function branchShapeOf(map: MindMap, branchIndex: number): BranchShape {
  return headShapeOverride(map, branchIndex) ?? docBranchShapeOf(map)
}

/** 分支连线最终线条：头覆盖 → 文档级 → 主题默认（词汇见 CONTEXT.md「线条」） */
export function branchStrokeOf(map: MindMap, branchIndex: number): LineStroke {
  return headStrokeOverride(map, branchIndex) ?? docBranchLineOf(map)
}

/** 分支终点（词汇见 CONTEXT.md「终点」）：头覆盖 → 文档级 → 无（主题不带终点默认） */
export function branchEndpointOf(map: MindMap, branchIndex: number): EndpointKind {
  return branchHeads(map)[branchIndex]?.branchEndpoint ?? map.branchEndpoint ?? 'none'
}

/** 分支渐变方向（词汇见 CONTEXT.md「渐变粗细」）：头覆盖 → 文档级 → 固定宽（undefined） */
export function branchTaperOf(map: MindMap, branchIndex: number): TaperDir | undefined {
  const override = branchHeads(map)[branchIndex]?.branchTaper
  return override === 'fixed' ? undefined : override ?? map.branchTaper
}

/** 分支线默认粗细（v9 票 04：文档级 lineWidth 覆盖的基准，= 现渲染实测值） */
export const DEFAULT_LINE_WIDTH = 2.4

/** 分支线粗细：文档级显式覆盖优先，缺省=主题基准（全部主题同基准 2.4） */
export function lineWidthOf(map: MindMap): number {
  return map.lineWidth ?? DEFAULT_LINE_WIDTH
}

/** 画布纸底：文档级覆盖优先（v9 票 04），缺省=主题纸底 */
export function paperOf(map: MindMap): string {
  return map.paper ?? resolveTheme(map).paper
}

/** 纸型（v14 票 01，ADR-0010）：文档级覆盖 → 主题默认 → blank（词汇见 CONTEXT.md「纸型」） */
export function paperStyleOf(map: MindMap): PaperStyleId {
  return map.paperStyle ?? resolveTheme(map).paperStyle ?? 'blank'
}

/** 纸型密度（v14 票 01）：文档级覆盖 → 疏；不随主题 */
export function paperDensityOf(map: MindMap): PaperDensity {
  return map.paperDensity ?? 'loose'
}

/** 生效墨色（v14 票 01）：文档级覆盖（ADR-0011 暗纸联动写入）优先，缺省=主题墨色。
 * render/exporter 的 theme patch 统一用本函数覆盖 ink，文字/描边/垫片自动跟随 */
export function inkOf(map: MindMap): string {
  return map.ink ?? resolveTheme(map).ink
}

/** 纸底色板（v9 票 04 → v14 票 03 改显式清单）：现有 5 主题纸底 + 炭黑/黑板墨绿/图纸深蓝（暗色，
 * 配套墨见下方 DARK_PAPERS，ADR-0011）+ 马卡龙粉。 */
export const PAPER_CHOICES: string[] = [
  '#FBF1DC', '#FCFBF6', '#DDBE8C', '#F4F6FA', '#2A2A33',
  '#23232B', '#2F4038', '#1F2C4C', '#F7E2DE',
]

/** 暗色纸与配套浅墨（v14 票 03，ADR-0011）：从 THEMES 派生 —— 暗色主题的纸底/墨色即一对配套色，
 * 改主题色不失效（评审修复：不再手抄色值对）。PAPER_CHOICES 若新增暗色纸，先让它成为某主题纸底。 */
export const DARK_PAPERS: ReadonlyArray<{ paper: string; ink: string }> = THEMES
  .filter((t) => isDarkColor(t.paper))
  .map((t) => ({ paper: t.paper, ink: t.ink }))

/** 暗色纸的配套浅墨；浅色纸返回 undefined（不联动）。大小写不敏感 */
export function pairedInkFor(paper: string): string | undefined {
  return DARK_PAPERS.find((d) => d.paper.toLowerCase() === paper.toLowerCase())?.ink
}

/** 分支级线宽覆盖（v9 票 07）：按 branchIndex 索引，缺省位=undefined 跟随文档 */
export function branchWidthOverridesOf(map: MindMap): (number | undefined)[] {
  return branchHeads(map).map(n => n.branchWidth)
}

/** 分支连线最终线宽：头覆盖 → 文档级 → 主题基准（v9 票 07） */
export function branchLineWidthOf(map: MindMap, branchIndex: number): number {
  return branchWidthOverridesOf(map)[branchIndex] ?? lineWidthOf(map)
}

/** 分支连线样式逐节点解析链（v15 票 06）：自子节点沿父链向上取每维度最近的显式设置（头覆盖推广到任意节点），
 * 全链未设回文档级默认。链 = 子节点自身 → … → 森林根（含分支头/独立主题根/游离头）。
 * 各维度独立解析：branchShape（遗留 'dashed' 归一 曲线×虚线，同 materializeHeadLine 口径）、
 * branchLine（branchLine 优先，遗留 branchShape='dashed' 折算虚线）、branchWidth、
 * branchTaper（'fixed' = 显式固定宽 → taper=undefined，且该维度就此定格，不再向上取）、branchEndpoint。
 * 存量文档（覆盖只落在 depth-1 头上）下与旧 branchXxxOf(map, headIndex) 逐字段等价（回归测试锁定）。 */
export function linkStyleOf(
  map: MindMap,
  childId: string,
): { shape: BranchShape; stroke: LineStroke; width: number; taper: TaperDir | undefined; endpoint: EndpointKind } {
  let shape: BranchShape | undefined
  let stroke: LineStroke | undefined
  let width: number | undefined
  let taper: TaperDir | undefined
  let taperDone = false
  let endpoint: EndpointKind | undefined
  let depth = 0
  for (let n = findNode(map, childId); n; n = findParent(map, n.id)) {
    depth++
    // Floating roots are rendered at the primary-topic level.
    if (map.floating?.some(f => f.node.id === n.id)) depth++
  }
  let cur: NodeData | null = findNode(map, childId)
  while (cur) {
    if (shape === undefined && cur.branchShape !== undefined) shape = normalizeLineShape(cur.branchShape).shape
    if (stroke === undefined) {
      if (cur.branchLine !== undefined) stroke = cur.branchLine
      else if (cur.branchShape === 'dashed') stroke = 'dashed'
    }
    if (width === undefined && cur.branchWidth !== undefined) width = cur.branchWidth
    if (!taperDone && cur.branchTaper !== undefined) {
      taperDone = true
      taper = cur.branchTaper === 'fixed' ? undefined : cur.branchTaper
    }
    if (endpoint === undefined && cur.branchEndpoint !== undefined) endpoint = cur.branchEndpoint
    if (shape !== undefined && stroke !== undefined && width !== undefined && taperDone && endpoint !== undefined) break
    cur = findParent(map, cur.id)
  }
  return {
    shape: shape ?? docBranchShapeOf(map),
    stroke: stroke ?? docBranchLineOf(map),
    width: width ?? levelLineWidthOf(map, depth - 1),
    taper: taperDone ? taper : map.branchTaper,
    endpoint: endpoint ?? map.branchEndpoint ?? 'none',
  }
}

/** 节点填充模式（票 06）：节点覆盖 → 文档默认 → 实心 */
export function fillPatternOf(style: { fillPattern?: FillPattern } | undefined, map: MindMap): FillPattern {
  return style?.fillPattern ?? map.nodeFillPattern ?? 'solid'
}

/** 节点边框颜色（票 07）：节点覆盖 → 文档默认 → undefined（跟随文字/描边色，现状行为） */
export function borderColorOf(style: { borderColor?: string } | undefined, map: MindMap): string | undefined {
  return style?.borderColor ?? map.nodeBorderColor
}

/** 全部森林节点（树 + 游离 + 独立主题）的生效色（v15 票 04，ADR-0013 彩虹逐级续轮）：
 * 每个分支点的子分支从「父色基准 +1」起连续取色（模色卡长度），任意深度都在转。
 * - 显式 branchColor 最高优先（单色模式亦然）：覆盖自身；命中色卡则重置后代续轮基准（最近显式祖先获胜），
 *   未命中色卡则后代按原轮连续（轮转不打断也不重置）。
 * - 单色（branchPalette='mono'）= 彩虹关闭：非显式节点全用墨色。
 * - 森林根（中心主题/游离头/独立主题根）基准=无色：自身非显式即墨色，其子从色卡 0 位重新起轮
 *   （一级分支即经典彩虹）。连线颜色取其指向子节点的生效色（render/exporter 同源）。
 * 有意变更存量渲染（ADR-0013，v14 R1 红线不适用）：旧「按一级分支序号整树同色」语义废弃。
 * 词汇见 CONTEXT.md「彩虹分支」「色卡」「分支换色」。 */
export function nodeColorsOf(map: MindMap): Map<string, string> {
  const theme = resolveTheme(map)
  const palette = map.branchPalette === 'mono' ? [] as string[] : (map.branchPalette ?? theme.palette)
  const len = palette.length
  const ink = inkOf(map)
  const colors = new Map<string, string>()
  const NO_COLOR = -1 // 根基准：无色（不参与轮转，兜底墨色）
  const sameBranch = (map.branchColorMode ?? (usesClearStyle(map) ? 'branch' : 'cycle')) === 'branch'
  const walk = (n: NodeData, base: number, pos: number, root: boolean, inherited?: string): void => {
    let rot = NO_COLOR
    if (!root && len > 0) rot = sameBranch && base !== NO_COLOR ? base : (((base + 1 + pos) % len) + len) % len
    let color = n.branchColor ?? (sameBranch && inherited ? inherited : rot === NO_COLOR ? ink : palette[rot])
    if (n.branchColor) { const hit = palette.indexOf(n.branchColor); if (hit >= 0) rot = hit }
    colors.set(n.id, color)
    n.children.forEach((c, i) => walk(c, rot, i, false, !root && sameBranch ? color : undefined))
  }
  walk(map.root, NO_COLOR, 0, true)
  for (const f of map.floating ?? []) walk(f.node, NO_COLOR, 0, true)
  for (const t of map.topics ?? []) walk(t.node, NO_COLOR, 0, true)
  return colors
}
