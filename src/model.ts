/** 领域模型：树是唯一事实源。词汇见 CONTEXT.md（节点、分支、子树、折叠/展开、分支换色、节点样式覆盖、
 * 分支形状、线条、终点、渐变粗细、填充纹理、边框颜色、色卡）。 */

import type { BranchShape, EndpointKind, FillPattern, LineShape, LineStroke, TaperDir, ThemeId } from './theme.ts'
import { normalizeLineShape, resolveTheme, pairedInkFor } from './theme.ts'
import type { PaperDensity, PaperStyleId } from './paper.ts'
import { isDarkColor } from './paper.ts'
import { docStructureOf, normalizeStructure, type Structure } from './structure.ts'
import type { CanvasObject } from './objects.ts'
import { removeEdgeRefs } from './objects.ts'
import type { Content } from './content.ts'
import type { FontId } from './fonts.ts'

/** 节点样式覆盖：稀疏可选字段，仅作用于本节点，不波及后代（词汇见 CONTEXT.md） */
export interface NodeStyle {
  /** Visual metrics retained across text box/node conversion; never a tree depth. */
  layoutDepth?: 0 | 1 | 2
  /** Preserve existing line breaks during identity conversion, until text geometry is edited. */
  wrapWidth?: number
  /** Raster watercolor/paper texture behind editable node text. */
  backdrop?: 'brush' | 'paper'
  /** Resolved theme defaults on layout copies; never written back into node data. */
  visualStyle?: 'clear'
  fontSize?: number
  font?: FontId
  /** 边框线型（票 07 扩 'double' 手绘双线）：盒形描边样式；缺省=实线（遗留形状 'dashed' 的盒默认虚线） */
  borderLine?: 'solid' | 'dashed' | 'dotted' | 'double'
  borderWidth?: number
  /** 形状覆盖；缺省=层级默认（d0 椭圆 / d1 圆角框 / d≥2 无框）；词表见 levels.NodeShape */
  shape?: 'ellipse' | 'rounded' | 'underline' | 'none' | 'cloud' | 'bubble' | 'burst' | 'banner' | 'dashed'
  /** 字号档位（相对层级基准乘算，见 levels.ts） */
  size?: 's' | 'm' | 'l' | 'xl'
  /** 加粗 */
  bold?: boolean
  /** 颜色覆盖：该节点文字与描边同色 */
  color?: string
  /** 填充色覆盖（v9 票 03）：盒形底色；缺省=层级默认（d0 rootFill、其余分支色浅底）。词表=主题色板 */
  fill?: string
  /** 填充纹理（票 06）：实心/无填充/排线纹理；缺省=实心。纹理笔画用填充色着色、纸底透出 */
  fillPattern?: FillPattern
  /** 边框颜色（票 07）：描边自己的颜色；缺省跟随文字/描边色（现状行为） */
  borderColor?: string
  /** 斜体（v9 票 03）：霞鹜文楷无真斜体，渲染走合成斜体 —— 字形倾斜不改步进宽度，度量路径不掺 italic */
  italic?: boolean
  /** 文字对齐（v9 票 03）：缺省=盒形默认（盒形居中、下划线/无框随文贴侧）；固定宽度（票 06）下差异可见 */
  align?: 'left' | 'center' | 'right'
  /** 固定宽度（v9 票 06）：px，量测前钳位 60~600；缺省=适应（宽随文字自动换行） */
  width?: number
  /** 节点级文字装饰（富文本一期，词汇见 CONTEXT.md「节点样式覆盖」）：
   * wavy=波浪线、highlight=荧光高亮、badge=编号徽章（'1'～'7'，面板循环）、strike=删除线（v9 票 03，与波浪线可叠加）；
   * 整体可 null 删除 */
  deco?: { wavy?: boolean; highlight?: string; badge?: string; strike?: boolean }
}

export interface NodeData {
  /** Short secondary title; independently editable in the text inspector. */
  subtitle?: string
  note?: import('./node-details.ts').NodeNote
  icon?: import('./node-details.ts').NodeIcon
  contents?: Content[]
  contentLayout?: 'above' | 'below' | 'left' | 'right'
  id: string
  text: string
  /** 手绘抖动种子，节点创建时生成、随数据持久化，保证形状稳定 */
  seed: number
  /** 折叠：隐藏全部后代，只影响显示不删数据 */
  collapsed?: boolean
  /** 结构覆盖（v15 票 01，ADR-0012）：决定「本节点的子分支」怎么排布，作用于后代直至下一个显式设置；
   * 解析链 = 自身显式 > 最近祖先显式 > 文档默认结构（resolveStructure，词表 9 种见 structure.ts）。
   * 词汇见 CONTEXT.md「结构」 */
  structure?: Structure
  /** 钉定侧别（v15 票 01）：仅父节点生效结构为 map（平衡）时被引擎消费；缺省 = 跟随自动平衡。
   * 词汇见 CONTEXT.md「钉定侧别」（交互在票 03，引擎消费在票 02） */
  sideOverride?: 'left' | 'right'
  /** 分支换色：本节点显式色（连线+文字+描边），后代从该色继续逐级续轮（ADR-0013）；
   * v15 票 06 写入口径放开到任意节点（中心主题除外）—— 作用于该节点的后代子树 */
  branchColor?: string
  /** 分支级形状覆盖（v15 票 06 头覆盖推广：任意节点可设，作用于该节点的后代子树连线；ADR-0009）。
   * 遗留 'dashed'（v9 混装值）合法、读取归一为 曲线×虚线；新写入只落 BranchShape 词表 */
  branchShape?: BranchShape | 'dashed'
  /** 分支级线条覆盖（票 02）：实/虚/波浪实/波浪虚/无；缺省=文档级 */
  branchLine?: LineStroke
  /** 分支级终点覆盖（票 02）：缺省=文档级 → 无 */
  branchEndpoint?: EndpointKind
  /** 分支级渐变方向覆盖（票 02）：渐细/渐粗/fixed（固定宽）；缺省=文档级 → 固定宽 */
  branchTaper?: TaperDir | 'fixed'
  /** 分支级线宽覆盖（v9 票 07）：px，v15 票 06 头覆盖推广为任意节点；缺省=文档级 lineWidth（主题基准） */
  branchWidth?: number
  /** 节点样式覆盖 */
  style?: NodeStyle
  children: NodeData[]
}

/** 遗留布局模式值域（文档级三选一时代）：'balanced' 读取归一为 'map'（normalizeStructure）。
 * 「布局模式」退役为旧称，词汇见 CONTEXT.md「结构」 */
export type LayoutMode = 'right' | 'left' | 'balanced'

export interface MindMap {
  /** 持久纸页按数组顺序输出；不与分组框的几何包含语义混用。 */
  pages?: import('./paper-pages.ts').PaperPage[]
  /** 中心主题在世界坐标中的中心位置；缺省兼容固定 (600, 400)。 */
  rootPosition?: { x: number; y: number }
  /** Editor typography/geometry is independent of the paper/color theme. */
  visualStyle?: 'clear'
  /** Optional visual controls; omitted fields preserve legacy document appearance. */
  levelFontSizes?: [number, number, number]
  levelLineWidths?: [number, number, number]
  hierarchicalLines?: boolean
  branchColorMode?: 'branch' | 'cycle'
  spacing?: 'comfortable' | 'compact'
  font?: FontId
  nodeBorderLine?: NodeStyle['borderLine']
  nodeBorderWidth?: number
  /** 10/11 保持兼容读取；12 标记持久纸页及主树世界坐标。旧客户端不保证正确编辑 12。 */
  schemaVersion?: 10 | 11 | 12
  topics?: IndependentTopic[]
  root: NodeData
  /** 文档默认结构（v15 语义升级，ADR-0012）：全链未显式设置时的兜底；读取经 docStructureOf 归一
   * （缺省含存量数据 = 'right'；遗留 'balanced' = 'map'）。新写入落 Structure 词表（setDocStructure） */
  layoutMode?: LayoutMode | Structure
  /** 主题 id；缺省=蜡笔米黄（词汇见 CONTEXT.md「主题」） */
  theme?: ThemeId
  /** 线形显式覆盖（遗留字段，v9 词表）：读取归一（ADR-0009），新写入走 branchShape/branchLine */
  lineShape?: LineShape
  /** 文档级默认分支形状（票 02，ADR-0009）；缺省=遗留 lineShape 归一 → 主题默认 */
  branchShape?: BranchShape
  /** 文档级默认线条（票 02）；缺省=遗留 lineShape 是否 'dashed' → 主题默认 */
  branchLine?: LineStroke
  /** 文档级默认终点（票 02）；缺省=无 */
  branchEndpoint?: EndpointKind
  /** 文档级默认渐变方向（票 02）；缺省=固定宽 */
  branchTaper?: TaperDir
  /** 色卡（票 02/08，词汇见 CONTEXT.md「色卡」）：六色轮转；'mono'=单色（彩虹关闭）；缺省=跟随主题色板 */
  branchPalette?: string[] | 'mono'
  /** 文档默认填充纹理（票 06，沿 nodeBorderLine 先例）；缺省=实心 */
  nodeFillPattern?: FillPattern
  /** 文档默认边框颜色（票 07）；缺省=跟随文字/描边色 */
  nodeBorderColor?: string
  /** 分支线粗细（v9 票 04）：文档级覆盖，px；缺省=主题基准 2.4（theme.DEFAULT_LINE_WIDTH） */
  lineWidth?: number
  /** 背景纸底（v9 票 04）：文档级覆盖；缺省=主题纸底。词表=PAPER_CHOICES */
  paper?: string
  /** 纸型（v14 票 01，ADR-0010）：文档级覆盖；缺省=主题默认纸型 → blank（词汇见 CONTEXT.md「纸型」） */
  paperStyle?: PaperStyleId
  /** 纸型密度（v14 票 01）：文档级覆盖；缺省=疏 */
  paperDensity?: PaperDensity
  /** Pattern strength; paper color and foreground ink remain independent. */
  paperOpacity?: number
  /** 墨色（v14 票 01，ADR-0011）：文档级覆盖，仅由暗纸联动写入；缺省=主题墨色 */
  ink?: string
  /** 游离集合（词汇见 CONTEXT.md「游离节点」；模型见 ADR-0002）：脱离树、手工定位的子树，
 * 挂接回树上即丢弃坐标恢复自动布局 */
  floating?: FloatingNode[]
  /** 画布对象（词汇见 CONTEXT.md「画布对象」；模型见 ADR-0003）：数组顺序即对象间 z 序 */
  objects?: CanvasObject[]
}

/** 游离节点：头 + 画布坐标（包围盒左上角）；头可携带整棵子树、可折叠、可删除 */
export interface FloatingNode {
  node: NodeData
  x: number
  y: number
}

/** 独立主题（词汇见 CONTEXT.md）：layoutMode 为遗留字段（读取迁移见 topicStructureOf），
 * v15 起结构的唯一事实源是 node.structure；对主题根的写入会同步删除遗留字段（setStructure） */
export interface IndependentTopic extends FloatingNode { layoutMode?: LayoutMode }

/** 旧引擎读取口径（v15 票 02 引擎换装前）：把结构词表退化为旧三值 ——
 * 'map' → 'balanced'；右向族（right/treeRight/fishRight/orgUp/orgDown）→ 'right'；
 * 左向族（left/treeLeft/fishLeft）→ 'left'；缺省 'right'。存量文档值域不变、逐值透传 */
export function layoutModeOf(map: MindMap): LayoutMode {
  switch (docStructureOf(map)) {
    case 'map': return 'balanced'
    case 'left': case 'treeLeft': case 'fishLeft': return 'left'
    default: return 'right'
  }
}

/** 切换文档默认结构（v15 新写入入口）；null = 清除覆盖回 'right'。
 * 进撤销历史（v9 文档属性惯例；UI 接线在票 05） */
export function setDocStructure(map: MindMap, structure: Structure | null): MindMap {
  if (structure === null) {
    if (map.layoutMode === undefined) return map
    const next = clone(map)
    delete next.layoutMode
    return next
  }
  const norm = normalizeStructure(structure) ?? 'right'
  return map.layoutMode === norm ? map : { ...map, layoutMode: norm }
}

/** 旧面板入口（MODE_CHOICES 三选一）：写入口径统一走 setDocStructure（'balanced' 归一落 'map'），
 * 渲染经 layoutModeOf 归一回 'balanced' —— 存量行为不变；票 05 由九结构选择器接替 */
export function setLayoutMode(map: MindMap, mode: LayoutMode): MindMap {
  return setDocStructure(map, normalizeStructure(mode) ?? 'right')
}

/** 节点结构覆盖（v15 票 01）：任意树上/游离/独立主题节点可设；null = 清除（跟随上级）。
 * 作用于该节点的后代子树（引擎在票 02 消费）；进撤销历史（节点字段随 root/floating/topics 快照） */
export function setStructure(map: MindMap, id: string, structure: Structure | null): MindMap {
  const next = clone(map)
  const node = findNode(next, id)
  if (!node) return map
  if (structure === null) delete node.structure
  else node.structure = normalizeStructure(structure) ?? 'right'
  // 独立主题根：同步删除遗留 layoutMode —— 新写入只落新字段（红线 5 惯例），
  // 且避免「清除跟随」被遗留值复活
  const topic = next.topics?.find((t) => t.node === node)
  if (topic) delete topic.layoutMode
  return next
}

/** 钉定侧别（v15 票 01，ADR-0012）：仅父节点生效结构为 map 时被引擎消费（票 02/03）；
 * null = 清除覆盖、恢复自动平衡；进撤销历史 */
export function setSide(map: MindMap, id: string, side: 'left' | 'right' | null): MindMap {
  const next = clone(map)
  const node = findNode(next, id)
  if (!node) return map
  if (side === null) delete node.sideOverride
  else node.sideOverride = side
  return next
}

/** map 级结构解析（v15 票 01）：沿父链向上找最近显式结构 ——
 * 独立主题根兼容遗留 layoutMode（两字段皆缺则落文档默认，对齐旧下钻 owner?.layoutMode ?? map.layoutMode；
 * 注意与 topicStructureOf 的 'right' 缺省不同：那是旧「直接渲染」路径的缺省，两条旧路径本就不同）。
 * 游离头无父链直达文档默认。下钻切图（drill.scopedMap）用它把「下钻根的生效结构」物化为子图文档默认 */
export function effectiveStructureOf(map: MindMap, id: string): Structure {
  let cur = findNode(map, id)
  if (!cur) return docStructureOf(map)
  const doc = docStructureOf(map)
  for (;;) {
    const s = normalizeStructure(cur.structure)
    if (s) return s
    const topic = map.topics?.find((t) => t.node === cur)
    if (topic) return normalizeStructure(topic.layoutMode) ?? doc
    const parent = findParent(map, cur.id)
    if (!parent) return doc
    cur = parent
  }
}

/** Preserve custom formatting by default for model callers. The editor can also
 * apply the theme's colors to an imported, explicitly styled document. */
export function setTheme(map: MindMap, theme: ThemeId, colors: 'preserve' | 'theme' = 'preserve'): MindMap {
  if (colors === 'preserve') return { ...map, visualStyle: 'clear', theme }
  const next: MindMap = { ...structuredClone(map), visualStyle: 'clear', theme }
  delete next.paper
  delete next.ink
  delete next.branchPalette
  delete next.nodeBorderColor
  const visit = (node: NodeData) => {
    delete node.branchColor
    if (node.style) {
      delete node.style.color
      delete node.style.fill
      delete node.style.borderColor
    }
    if (node.icon) delete node.icon.color
    node.children.forEach(visit)
  }
  ;[next.root, ...(next.floating ?? []).map(f => f.node), ...(next.topics ?? []).map(t => t.node)].forEach(visit)
  return next
}

/** 分支线粗细覆盖（v9 票 04）；null = 清除覆盖、回主题基准 */
export function setLineWidth(map: MindMap, width: number | null): MindMap {
  if (width === null) {
    if (map.lineWidth === undefined) return map
    const next = clone(map)
    delete next.lineWidth
    return next
  }
  return { ...map, lineWidth: width }
}

/** 背景纸底覆盖（v9 票 04）；null = 清除覆盖、回主题纸底 */
export function setPaper(map: MindMap, color: string | null): MindMap {
  if (color === null) {
    if (map.paper === undefined) return map
    const next = clone(map)
    delete next.paper
    return next
  }
  return { ...map, paper: color }
}

/** 纸型覆盖（v14 票 01，ADR-0010）；null = 清除覆盖、回主题默认纸型（词汇见 CONTEXT.md「纸型」） */
export function setPaperStyle(map: MindMap, style: PaperStyleId | null): MindMap {
  if (style === null) {
    if (map.paperStyle === undefined) return map
    const next = clone(map)
    delete next.paperStyle
    return next
  }
  return { ...map, paperStyle: style }
}

/** 纸型密度覆盖（v14 票 01）；null = 清除覆盖、回疏档 */
export function setPaperDensity(map: MindMap, density: PaperDensity | null): MindMap {
  if (density === null) {
    if (map.paperDensity === undefined) return map
    const next = clone(map)
    delete next.paperDensity
    return next
  }
  return { ...map, paperDensity: density }
}

/** 墨色覆盖（v14 票 01）；null = 清除覆盖、回主题墨色 */
export function setInk(map: MindMap, color: string | null): MindMap {
  if (color === null) {
    if (map.ink === undefined) return map
    const next = clone(map)
    delete next.ink
    return next
  }
  return { ...map, ink: color }
}

/** 纸底选择唯一入口（v14 票 03，ADR-0011 暗纸联动）：面板纸底色板与「恢复默认」都走这里。
 * 暗纸 × 生效墨为深色 → 写入文档级墨色覆盖=配套浅墨（文字/描边/垫片经 inkOf 全链跟随）；
 * 生效墨已是浅色（暗色主题）不产生覆盖；单向不回滚 —— null/浅纸不动已写入的 ink */
export function applyPaperChoice(map: MindMap, color: string | null): MindMap {
  const base = setPaper(map, color)
  if (color === null) return base
  const paired = pairedInkFor(color)
  if (!paired) return base
  const effective = base.ink ?? resolveTheme(base).ink
  return isDarkColor(effective) ? { ...base, ink: paired } : base
}

/** 文档级遗留线形物化（ADR-0009 写入前置）：把 lineShape 摊开到新维度字段后删除遗留键 ——
 * 新写入只落新词表（不产生 'dashed'，红线 5），信息零丢失。clone 后原地调用 */
function materializeDocLine(map: MindMap): void {
  if (map.lineShape === undefined) return
  const norm = normalizeLineShape(map.lineShape)
  if (map.branchShape === undefined) map.branchShape = norm.shape
  if (map.branchLine === undefined && norm.stroke !== 'solid') map.branchLine = norm.stroke
  delete map.lineShape
}

/** 文档级默认分支形状（票 04 画布 tab「分支默认·形状」）；null=跟随（含清遗留 lineShape） */
export function setDocBranchShape(map: MindMap, shape: BranchShape | null): MindMap {
  const next = clone(map)
  materializeDocLine(next)
  if (shape === null) delete next.branchShape
  else next.branchShape = shape
  return next
}

/** 文档级默认线条（票 04 画布 tab「分支默认·线条」）；null=跟随 */
export function setDocBranchLine(map: MindMap, stroke: LineStroke | null): MindMap {
  const next = clone(map)
  materializeDocLine(next)
  if (stroke === null) delete next.branchLine
  else next.branchLine = stroke
  return next
}

/** 文档级默认终点（票 05）；null=跟随（回无） */
export function setDocEndpoint(map: MindMap, kind: EndpointKind | null): MindMap {
  if (kind === null) {
    if (map.branchEndpoint === undefined) return map
    const next = clone(map)
    delete next.branchEndpoint
    return next
  }
  return { ...map, branchEndpoint: kind }
}

/** 文档级默认渐变方向（票 05）；null=跟随（回固定宽） */
export function setDocTaper(map: MindMap, dir: TaperDir | null): MindMap {
  if (dir === null) {
    if (map.branchTaper === undefined) return map
    const next = clone(map)
    delete next.branchTaper
    return next
  }
  return { ...map, branchTaper: dir }
}

/** 文档默认填充纹理（票 06）；null=复位实心 */
export function setDocFillPattern(map: MindMap, pattern: FillPattern | null): MindMap {
  if (pattern === null || pattern === 'solid') {
    if (map.nodeFillPattern === undefined) return map
    const next = clone(map)
    delete next.nodeFillPattern
    return next
  }
  return { ...map, nodeFillPattern: pattern }
}

/** 文档默认边框颜色（票 07）；null=复位跟随文字/描边色 */
export function setDocBorderColor(map: MindMap, color: string | null): MindMap {
  if (color === null) {
    if (map.nodeBorderColor === undefined) return map
    const next = clone(map)
    delete next.nodeBorderColor
    return next
  }
  return { ...map, nodeBorderColor: color }
}

/** 色卡（票 08）：文档级分支配色方案；'mono'=单色（彩虹关闭）；null=复位「跟随主题」。空数组无效 */
export function setBranchPalette(map: MindMap, palette: string[] | 'mono' | null): MindMap {
  if (palette === null) {
    if (map.branchPalette === undefined) return map
    const next = clone(map)
    delete next.branchPalette
    return next
  }
  if (palette !== 'mono' && palette.length === 0) return map
  return { ...map, branchPalette: palette }
}

/** 节点样式覆盖增量修改：patch 中 null 值表示删键；结果为空时删掉 style 字段（保持数据干净） */
export type StylePatch = { [K in keyof NodeStyle]: NodeStyle[K] | null }

/** A new width or typography setting resumes ordinary wrapping. Color edits preserve it. */
export function resetConversionWrapping(style: NodeStyle, patch: StylePatch): void {
  if (patch.wrapWidth === undefined && (['width','shape','fontSize','font','size','bold','deco','visualStyle','layoutDepth'] as const).some(key => patch[key] !== undefined)) delete style.wrapWidth
}

/** patch 应用语义（单/批量共用）：null 删键，结果空则删 style 字段 */
function applyStylePatch(node: NodeData, patch: StylePatch): void {
  const merged: NodeStyle = { ...node.style }
  resetConversionWrapping(merged, patch)
  const entries = Object.entries(patch) as Array<[keyof NodeStyle, NodeStyle[keyof NodeStyle] | null]>
  for (const [k, v] of entries) {
    if (v === null) delete merged[k]
    // 稀疏覆盖即动态键值合并：TS 无法关联 k 与 v 的具体字段类型，经 Record 写入
    else (merged as Record<string, unknown>)[k] = v
  }
  if (Object.keys(merged).length === 0) delete node.style
  else node.style = merged
}

export function setNodeStyle(map: MindMap, id: string, patch: StylePatch): MindMap {
  const next = clone(map)
  const node = findNode(next, id)
  if (!node) return map
  applyStylePatch(node, patch)
  return next
}

/** 批量节点样式覆盖（词汇见 CONTEXT.md「多选」）：语义同 setNodeStyle，单次 clone；
 * 不存在的 id 静默跳过，全部跳过时原样返回（不产生空变更/空撤销步） */
export function setNodesStyle(map: MindMap, ids: string[], patch: StylePatch): MindMap {
  const next = clone(map)
  let touched = 0
  for (const id of ids) {
    const node = findNode(next, id)
    if (!node) continue
    applyStylePatch(node, patch)
    touched++
  }
  return touched ? next : map
}

/** 清除节点全部样式覆盖（红线 1：新增 NodeStyle 字段必须同步进本清单 —— v9 票 03 教训） */
export function clearNodeStyle(map: MindMap, id: string): MindMap {
  return setNodeStyle(map, id, {
    font: null, borderLine: null, borderWidth: null,
    shape: null,
    size: null,
    bold: null,
    color: null,
    fill: null,
    fillPattern: null,
    borderColor: null,
    italic: null,
    align: null,
    width: null,
    deco: null,
  })
}

/** 清除一批节点的全部样式覆盖（批量清除节点样式按钮；清单同 clearNodeStyle） */
export function clearNodesStyle(map: MindMap, ids: string[]): MindMap {
  return setNodesStyle(map, ids, {
    font: null, borderLine: null, borderWidth: null,
    shape: null,
    size: null,
    bold: null,
    color: null,
    fill: null,
    fillPattern: null,
    borderColor: null,
    italic: null,
    align: null,
    width: null,
    deco: null,
  })
}

/** 整套节点样式传播（v15 票 06，D4）：subtree = 把 id 的整套 NodeStyle 原样复制到其全部后代
 *  （覆盖式，整对象替换；源无样式 = 清空后代样式）；siblings = 复制到同父全部兄弟（不含自身）。
 *  不可变、进撤销历史（节点字段随 root/floating/topics 快照）；无后代/无父/未知 id 原样返回 */
export function propagateStyle(map: MindMap, id: string, scope: 'subtree' | 'siblings'): MindMap {
  const next = clone(map)
  const source = findNode(next, id)
  if (!source) return map
  const apply = (n: NodeData) => {
    if (source.style) n.style = structuredClone(source.style)
    else delete n.style
  }
  if (scope === 'subtree') {
    let touched = false
    const walk = (n: NodeData): void => {
      for (const c of n.children) {
        apply(c)
        touched = true
        walk(c)
      }
    }
    walk(source)
    return touched ? next : map
  }
  const parent = findParent(next, id)
  if (!parent) return map
  let touched = false
  for (const sib of parent.children) {
    if (sib.id === id) continue
    apply(sib)
    touched = true
  }
  return touched ? next : map
}

/** 分支换色（v15 票 06 头覆盖推广）：任意节点（树上/游离森林/独立主题）生效，中心主题除外
 * （中心主题无入向连线，换色无意义）—— 作用于该节点的后代子树：自身连线/文字/描边用该色，
 * 后代从该色继续逐级续轮（ADR-0013）；null = 清除回主题色板。中心主题/未知 id 原样返回 */
export function setBranchColor(map: MindMap, id: string, color: string | null): MindMap {
  if (id === map.root.id) return map
  const next = clone(map)
  const node = findNode(next, id)
  if (!node) return map
  if (color === null) delete node.branchColor
  else node.branchColor = color
  return next
}

/** 批量分支换色（词汇见 CONTEXT.md「多选」）：语义同 setBranchColor（任意节点生效、中心主题跳过），
 * 单次 clone；中心主题/未知 id 静默跳过，全部跳过时原样返回 */
export function setBranchColors(map: MindMap, ids: string[], color: string | null): MindMap {
  const next = clone(map)
  let touched = 0
  for (const id of ids) {
    if (id === next.root.id) continue
    const node = findNode(next, id)
    if (!node) continue
    if (color === null) delete node.branchColor
    else node.branchColor = color
    touched++
  }
  return touched ? next : map
}

/** 节点原位改写（v9 票 07 提炼；v15 票 06 头覆盖推广）：单次 clone；存在的节点即生效
 * （分支线族覆盖自票 06 起作用于任意节点的后代子树，直到下一个显式设置），
 * 不存在的 id 静默跳过；全部跳过时原样返回 */
function editAnyNode(map: MindMap, ids: string[], edit: (node: NodeData) => void): MindMap {
  const next = clone(map)
  let touched = 0
  for (const id of ids) {
    const node = findNode(next, id)
    if (!node) continue
    touched++
    edit(node)
  }
  return touched ? next : map
}

/** 覆盖新维度写入前置（ADR-0009）：把遗留 branchShape='dashed'（形状×虚线混装值）
 * 物化为 曲线×虚线 两字段；新写入只落新词表（红线 5），信息零丢失。editAnyNode 内原地调用 */
function materializeHeadLine(node: NodeData): void {
  if (node.branchShape === 'dashed') {
    node.branchShape = 'curve'
    if (node.branchLine === undefined) node.branchLine = 'dashed'
  }
}

/** 分支级形状覆盖（票 06 样式 tab·结构组）；任意节点可设（作用于后代子树），null=形状维度跟随文档（遗留 'dashed' 先物化再清） */
export function setBranchShapes(map: MindMap, ids: string[], shape: BranchShape | null): MindMap {
  return editAnyNode(map, ids, (node) => {
    materializeHeadLine(node)
    if (shape === null) delete node.branchShape
    else node.branchShape = shape
  })
}

/** 分支级线条覆盖（票 06 样式 tab·结构组）；任意节点可设，null=线条维度跟随文档 */
export function setBranchLines(map: MindMap, ids: string[], stroke: LineStroke | null): MindMap {
  return editAnyNode(map, ids, (node) => {
    materializeHeadLine(node)
    if (stroke === null) delete node.branchLine
    else node.branchLine = stroke
  })
}

/** 分支级终点覆盖（票 06）；任意节点可设，null=跟随文档 */
export function setBranchEndpoints(map: MindMap, ids: string[], kind: EndpointKind | null): MindMap {
  return editAnyNode(map, ids, (node) => {
    if (kind === null) delete node.branchEndpoint
    else node.branchEndpoint = kind
  })
}

/** 分支级渐变方向覆盖（票 06）；任意节点可设，null=跟随文档；fixed=显式固定宽 */
export function setBranchTapers(map: MindMap, ids: string[], dir: TaperDir | 'fixed' | null): MindMap {
  return editAnyNode(map, ids, (node) => {
    if (dir === null) delete node.branchTaper
    else node.branchTaper = dir
  })
}

/** 分支级线宽覆盖（v9 票 07）：语义同 setBranchShapes；任意节点可设，null=清除回文档级 */
export function setBranchWidths(map: MindMap, ids: string[], width: number | null): MindMap {
  return editAnyNode(map, ids, (node) => {
    if (width === null) delete node.branchWidth
    else node.branchWidth = width
  })
}

// ---- 游离节点（词汇见 CONTEXT.md；模型见 ADR-0002） ----

/** 从单棵子树根摘除 id 所在节点（就地修改），返回被摘子树；不在其中返回 null */
function detachFrom(root: NodeData, id: string): NodeData | null {
  const i = root.children.findIndex((c) => c.id === id)
  if (i >= 0) return root.children.splice(i, 1)[0]
  for (const c of root.children) {
    const found = detachFrom(c, id)
    if (found) return found
  }
  return null
}

/** 新建游离节点（空文字，双击空白处创建后直接进编辑态） */
export function createFloating(map: MindMap, x: number, y: number): { map: MindMap; id: string } {
  const next = clone(map)
  const node = createNode('')
  next.floating = [...(next.floating ?? []), { node, x, y }]
  return { map: next, id: node.id }
}

/** 游离：把树上子树摘下转为游离（坐标为包围盒左上角，画布坐标）；中心主题不可游离 */
export function detachSubtree(map: MindMap, id: string, x: number, y: number): MindMap {
  if (map.root.id === id) return map
  if (map.topics?.some(t => t.node.id === id)) return map
  if (findFloatingOwner(map, id)) return map // 已游离：位置更新走 moveFloating
  const next = clone(map)
  const roots = forestRoots(next)
  const anchor = findSiblingAnchorInRoots(roots, id)
  let moving: NodeData | null = null
  for (const root of roots) { moving = detachFrom(root, id); if (moving) break }
  if (!moving) return map
  if (anchor) adjustAnchorsOnRemove(next, anchor.parent.id, anchor.index)
  next.floating = [...(next.floating ?? []), { node: moving, x, y }]
  return next
}

/** 磁吸挂回：游离头并回目标为其末子，丢弃坐标，目标折叠则展开（与树上挂接一致） */
export function attachFloating(map: MindMap, id: string, targetId: string): MindMap {
  if (!isFloatingHead(map, id)) return map
  if (withinSubtree(map, id, targetId)) return map // 吸到自身后代无效
  const next = clone(map)
  const fi = next.floating!.findIndex((f) => f.node.id === id)
  const moving = next.floating!.splice(fi, 1)[0].node
  if (next.floating!.length === 0) delete next.floating
  const parent = findNode(next, targetId)
  if (!parent) return map
  parent.children.push(moving)
  if (parent.collapsed) delete parent.collapsed // 挂接后自动展开，子树不凭空消失
  return next
}

/** 游离头手工定位（无碰撞避让，重叠是用户自己的排版责任） */
export function moveFloating(map: MindMap, id: string, x: number, y: number): MindMap {
  if (!isFloatingHead(map, id)) return map
  const next = clone(map)
  const f = next.floating!.find((e) => e.node.id === id)!
  f.x = x
  f.y = y
  return next
}

export function newId(): string {
  return crypto.randomUUID()
}

export function createNode(text: string, children: NodeData[] = []): NodeData {
  return { id: newId(), text, seed: (Math.random() * 0xffffffff) >>> 0, children }
}

function clone(map: MindMap): MindMap {
  return structuredClone(map)
}

/** 全部子树根（树 + 游离森林）：寻址/遍历统一入口（ADR-0002） */
export function forestRoots(map: MindMap): NodeData[] {
  return [map.root, ...(map.floating ?? []).map((f) => f.node), ...(map.topics ?? []).map(t => t.node)]
}

export function branchHeads(map: MindMap): NodeData[] {
  return [...map.root.children, ...(map.floating ?? []).map(f => f.node), ...(map.topics ?? []).flatMap(t => t.node.children.length ? t.node.children : [t.node])]
}

/** id 所在游离条目（id 为游离头则返回该条目；在其子树内则返回所属条目） */
export function findFloatingOwner(map: MindMap, id: string): FloatingNode | null {
  for (const f of map.floating ?? []) {
    if (f.node.id === id) return f
    const stack = [...f.node.children]
    while (stack.length) {
      const n = stack.pop()!
      if (n.id === id) return f
      stack.push(...n.children)
    }
  }
  return null
}

/** id 是否游离头 */
export function isFloatingHead(map: MindMap, id: string): boolean {
  return (map.floating ?? []).some((f) => f.node.id === id)
}

export function findNode(map: MindMap, id: string): NodeData | null {
  for (const root of forestRoots(map)) {
    if (root.id === id) return root
    const stack = [...root.children]
    while (stack.length) {
      const n = stack.pop()!
      if (n.id === id) return n
      stack.push(...n.children)
    }
  }
  return null
}

export function findParent(map: MindMap, id: string): NodeData | null {
  for (const root of forestRoots(map)) {
    if (root.children.some((c) => c.id === id)) return root
    const stack = [...root.children]
    while (stack.length) {
      const n = stack.pop()!
      if (n.children.some((c) => c.id === id)) return n
      stack.push(...n.children)
    }
  }
  return null
}

/** 锚定兄弟组维护（v9 票 09/10，ADR-0004）：兄弟插入/删除后原位调整全部锚定区间。
 * 只在已 clone 的 next 上原地调用（model 各变更加 clone 后调这里）。
 * 插入@i：start > i → start++（区间前插入后移；区间内插入被范围吸收，不改 count）
 * 删除@i：i < start → start--；start ≤ i < start+count → count--；count < 2 → 对象级联消亡 */
function adjustAnchorsOnInsert(map: MindMap, parentId: string, index: number): void {
  for (const o of map.objects ?? []) {
    if (o.kind !== 'boundary' && o.kind !== 'summary') continue
    if (o.anchor.parentId !== parentId) continue
    if (o.anchor.start > index) o.anchor.start++
  }
}

function adjustAnchorsOnRemove(map: MindMap, parentId: string, index: number): void {
  const objects = map.objects
  if (!objects) return
  for (let k = objects.length - 1; k >= 0; k--) {
    const o = objects[k]
    if (o.kind !== 'boundary' && o.kind !== 'summary') continue
    if (o.anchor.parentId !== parentId) continue
    if (index < o.anchor.start) {
      o.anchor.start--
    } else if (index < o.anchor.start + o.anchor.count) {
      o.anchor.count--
      if (o.anchor.count < 2) map.objects = objects.filter((x) => x !== o)
    }
  }
  if (map.objects?.length === 0) delete map.objects
}

/** 新建子节点（追加到父节点末尾），返回新树与新建节点 id */

export function addChild(map: MindMap, parentId: string, text: string): { map: MindMap; id: string } {
  const next = clone(map)
  const parent = findNode(next, parentId)
  if (!parent) return { map, id: '' }
  const child = createNode(text)
  parent.children.push(child)
  return { map: next, id: child.id }
}

/** 子树全体成员 id（含根）：删除时喂给 removeEdgeRefs，清掉引用任意后代的关系线（ADR-0003） */
function subtreeIdsOf(n: NodeData): string[] {
  const out = [n.id]
  for (const c of n.children) out.push(...subtreeIdsOf(c))
  return out
}

/** 删除整棵子树（树上或游离森林内）；删除游离头即删除该游离条目；中心主题不可删除 */
export function removeSubtree(map: MindMap, id: string): MindMap {
  if (map.root.id === id) return map
  const node = findNode(map, id)
  if (!node) return map
  const members = subtreeIdsOf(node)
  const next = clone(map)
  if (next.topics?.some(t => t.node.id === id)) {
    next.topics = next.topics.filter(t => t.node.id !== id)
  } else if (isFloatingHead(next, id)) {
    next.floating = (next.floating ?? []).filter((f) => f.node.id !== id)
    if (next.floating.length === 0) delete next.floating
  } else {
    const anchor = findSiblingAnchorInRoots(forestRoots(next), id) // 摘除前定位（父+索引）
    for (const root of forestRoots(next)) if (detachFrom(root, id)) break
    if (anchor) adjustAnchorsOnRemove(next, anchor.parent.id, anchor.index)
  }
  // 关系线级联（ADR-0003）：子树全体成员的引用都清（不只根，防悬空半截线）
  return removeEdgeRefs(next, members)
}

/** 批量删除子树（词汇见 CONTEXT.md「多选」）：语义同 removeSubtree，单次 clone；
 * 中心主题跳过；同批祖先先删则后代自然找不到（无害）；全部无效时原样返回 */
export function removeSubtrees(map: MindMap, ids: string[]): MindMap {
  const next = clone(map)
  let touched = 0
  const removedIds: string[] = []
  for (const id of ids) {
    if (next.root.id === id) continue
    const node = findNode(next, id)
    if (next.topics?.some(t => t.node.id === id)) {
      removedIds.push(...subtreeIdsOf(node!))
      next.topics = next.topics.filter(t => t.node.id !== id)
      touched++
      continue
    }
    if (isFloatingHead(next, id)) {
      removedIds.push(...(node ? subtreeIdsOf(node) : [id]))
      next.floating = (next.floating ?? []).filter((f) => f.node.id !== id)
      if (next.floating.length === 0) delete next.floating
      touched++
      continue
    }
    const anchor = findSiblingAnchorInRoots(forestRoots(next), id) // 摘除前定位
    let removed = false
    for (const root of forestRoots(next)) {
      if (detachFrom(root, id)) {
        removed = true
        break
      }
    }
    if (removed) {
      touched++
      if (anchor) adjustAnchorsOnRemove(next, anchor.parent.id, anchor.index)
      removedIds.push(...(node ? subtreeIdsOf(node) : [id]))
    }
  }
  if (!touched) return map
  // 关系线级联：删节点则引用它的边一并删（ADR-0003）；无边可级联时原样返回 next
  return removeEdgeRefs(next, removedIds)
}

function findSiblingAnchor(n: NodeData, siblingId: string): { parent: NodeData; index: number } | null {
  for (let i = 0; i < n.children.length; i++) {
    if (n.children[i].id === siblingId) return { parent: n, index: i }
    const deep = findSiblingAnchor(n.children[i], siblingId)
    if (deep) return deep
  }
  return null
}

/** 在同级节点之后插入新节点（不改变其他子级顺序），返回新树与新建节点 id（树上/游离森林内均可） */
export function addChildAfterSibling(map: MindMap, siblingId: string, text: string): { map: MindMap; id: string } {
  const next = clone(map)
  const anchor = findSiblingAnchorInRoots(forestRoots(next), siblingId)
  if (!anchor) return { map, id: '' }
  const child = createNode(text)
  anchor.parent.children.splice(anchor.index + 1, 0, child)
  adjustAnchorsOnInsert(next, anchor.parent.id, anchor.index + 1)
  return { map: next, id: child.id }
}

/** 拖动落点：挂为目标节点的子节点（挂接），或插入到同父某兄弟旁（重排）。词汇见 CONTEXT.md「挂接」。 */
export type MoveTarget =
  | { kind: 'child'; id: string }
  | { kind: 'sibling'; id: string; before: boolean }

/** target 是否落在 id 的子树内（含 id 自身）——挂接落点的合法性判定 */
export function withinSubtree(map: MindMap, id: string, target: string): boolean {
  if (id === target) return true
  const start = findNode(map, id)
  if (!start) return false
  const stack = [...start.children]
  while (stack.length) {
    const n = stack.pop()!
    if (n.id === target) return true
    stack.push(...n.children)
  }
  return false
}

function findSiblingAnchorInRoots(roots: NodeData[], siblingId: string): { parent: NodeData; index: number } | null {
  for (const r of roots) {
    const hit = findSiblingAnchor(r, siblingId)
    if (hit) return hit
  }
  return null
}

/** 挂接/重排：把整棵子树移动到新位置（树上/游离森林间通用：含游离↔树互挂）。
 * 中心主题不可拖；目标为自身或自身后代时原样返回（拖到自身后代上无效）。
 * sibling 锚按 id 定位（先摘下再查找，天然规避摘除后索引位移）；
 * 被移动的是游离头时同步删除其游离条目（坐标丢弃，恢复自动布局）。 */
export function moveSubtree(map: MindMap, id: string, target: MoveTarget): MindMap {
  if (map.root.id === id) return map
  const owner = (nodeId: string) => map.topics?.find(t => withinSubtree(map, t.node.id, nodeId))
  if (map.topics?.some(t => t.node.id === id) || owner(id) !== owner(target.id)) return map
  if (withinSubtree(map, id, target.id)) return map
  const next = clone(map)
  let moving: NodeData | null = null
  const fi = (next.floating ?? []).findIndex((f) => f.node.id === id)
  if (fi >= 0) {
    moving = next.floating!.splice(fi, 1)[0].node
    if (next.floating!.length === 0) delete next.floating
  }
  if (!moving) {
    // 树上摘除：先定位（父+索引）再摘，随后触发锚定删除事件（游离源无树区间，无需事件）
    const fromAnchor = findSiblingAnchorInRoots(forestRoots(next), id)
    for (const root of forestRoots(next)) {
      const found = detachFrom(root, id)
      if (found) {
        moving = found
        break
      }
    }
    if (moving && fromAnchor) adjustAnchorsOnRemove(next, fromAnchor.parent.id, fromAnchor.index)
  }
  if (!moving) return map
  if (target.kind === 'child') {
    const parent = findNode(next, target.id)
    if (!parent) return map
    parent.children.push(moving) // 末尾追加：区间后插入，锚定无需调整
  } else {
    const anchor = findSiblingAnchorInRoots(forestRoots(next), target.id)
    if (!anchor) return map
    const at = anchor.index + (target.before ? 0 : 1)
    anchor.parent.children.splice(at, 0, moving)
    adjustAnchorsOnInsert(next, anchor.parent.id, at)
  }
  // 落回原位（如拖到自身旧位置旁边的空隙）：结构不变则不算变更，不进撤销历史
  return JSON.stringify(next) === JSON.stringify(map) ? map : next
}

export function setText(map: MindMap, id: string, text: string): MindMap {
  const next = clone(map)
  const node = findNode(next, id)
  if (node) node.text = text
  return next
}

export function setCollapsed(map: MindMap, id: string, collapsed: boolean): MindMap {
  const next = clone(map)
  const node = findNode(next, id)
  if (node && node.children.length > 0) {
    if (collapsed) node.collapsed = true
    else delete node.collapsed
  }
  return next
}

/** 首次打开的空图：单个中心主题（main 里会将其置于选中态），默认右侧逻辑图 */
export function emptyTree(): MindMap {
  return { root: createNode('中心主题'), layoutMode: 'right', theme: 'clear' }
}

/** 演示种子树（测试用，平衡模式 — 左右侧导航行为依赖它） */
export function seedTree(): MindMap {
  return {
    layoutMode: 'balanced',
    root: {
      id: 'root-demo',
      text: '中心主题',
      seed: 101,
      children: [
        {
          id: 'b0',
          text: '出行计划',
          seed: 202,
          children: [
            { id: 'b0a', text: '订机票', seed: 203, children: [{ id: 'b0a1', text: '比价网站', seed: 204, children: [] }] },
            { id: 'b0b', text: '订酒店', seed: 205, children: [] },
            { id: 'b0c', text: '签证材料', seed: 206, children: [] },
          ],
        },
        { id: 'b1', text: '读书笔记', seed: 302, children: [{ id: 'b1a', text: '摘录与感想', seed: 303, children: [] }] },
        {
          id: 'b2',
          text: '产品想法',
          seed: 402,
          children: [
            { id: 'b2a', text: '手绘风导图', seed: 403, children: [{ id: 'b2a1', text: '抖动线条', seed: 404, children: [] }] },
            { id: 'b2b', text: '快捷键优先', seed: 405, children: [] },
          ],
        },
        { id: 'b3', text: '灵感速记', seed: 502, children: [] },
      ],
    },
  }
}
