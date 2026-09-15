import { selectionFormat } from './selection-format.ts'
import { domMeasurer } from './render.ts'
import { mountTextBoxPanel } from './text-box-panel.ts'
import { setActionContent } from './ui-controls.ts'
import { mountCustomColorInput } from './custom-color-input.ts'
import { mountCanvasSettings, settingPicker, structureChoices, structureIcon } from './canvas-settings.ts'
import { FONTS, type FontId } from './fonts.ts'
import { mountClearPanel } from './clear-panel.ts'
/**
 * 格式面板（编辑器右侧常驻，v9 双 tab，词汇见 CONTEXT.md「格式面板」）：
 * 样式 tab = 节点区 + 对象区（选中节点/画布对象后自动切换过去）；节点区 v15 票 06 三分类：
 * ① 结构（节点结构九宫格 + 跟随上级 + 解析链提示 + 分支线族[换色/形状/线条/终点/粗细]，作用后代）
 * ② 文本 ③ 形状（节点形状 + 边框 + 填充合一）；置底横切小动作：应用到子主题 / 应用到同级 / 清除节点样式。
 * 画布 tab = 文档样式四分类（v15 票 05：名称行 + ①结构/②主题/③纸张/④线形，点空白后自动切换过去）。
 * tab 亦可手动点击，粘性规则：每次选择态变化自动跳到对应 tab，手动切换只在两次选择变化之间有效。
 * 所有改动经 host.mutate 提交 —— 进撤销历史、自动保存（v5 grill Q12）。
 * 配色随主题：sync() 把 theme.chrome 写进面板 CSS 变量（夜航=深底浅字）。
 * v9 票 02：插入区与导出 PNG 迁入顶部工具栏，面板只承载样式控件。
 */
import {
  THEMES,
  resolveTheme,
  lineWidthOf,
  paperStyleOf,
  paperDensityOf,
  PAPER_CHOICES,
  PALETTE_CARDS,
  docBranchShapeOf,
  docBranchLineOf,
  linkStyleOf,
  fillPatternOf,
  borderColorOf,
  normalizeLineShape,
  type BranchShape,
  type EndpointKind,
  type LineStroke,
  type TaperDir,
  type ThemeId,
} from './theme.ts'
import {
  setTheme,
  effectiveStructureOf,
  setDocBranchShape,
  setDocBranchLine,
  setDocEndpoint,
  setDocTaper,
  setDocStructure,
  setLineWidth,
  applyPaperChoice,
  setPaperStyle,
  setPaperDensity,
  setBranchShapes,
  setBranchLines,
  setBranchEndpoints,
  setBranchTapers,
  setBranchWidths,
  setDocFillPattern,
  setDocBorderColor,
  setBranchPalette,
  setNodesStyle,
  clearNodesStyle,
  setBranchColors,
  findNode,
  type MindMap,
  type NodeData,
  type NodeStyle,
} from './model.ts'
import { PAPER_STYLES, paperTileSpec, type PaperDensity, type PaperStyleId } from './paper.ts'
import { findObject, updateObject, type CanvasObject, type ObjectPatch } from './objects.ts'
import { ENDPOINT_KINDS, endpointGlyph, fillPatternSpec, type FillTexture } from './strokes.ts'
import { type NodeShape } from './levels.ts'
import { strictUniform, nextBadge } from './selection.ts'
import { panelContext, CONTENT_NAMES } from './editor-ui.ts'
import { setStructure, findParent, propagateStyle } from './model.ts'
import { STRUCTURES, docStructureOf, normalizeStructure, type Structure } from './structure.ts'

export interface PanelHost {
  editText?(): void
  convertText?(): void
  duplicateText?(): void
  getMap(): MindMap
  /** 多选集合（词汇见 CONTEXT.md「多选」）：节点区控件对全部选中节点生效 */
  getSelectedIds(): string[]
  /** 主选中（词汇见 CONTEXT.md「主选中」） */
  getPrimaryId(): string | null
  getDepth?(id: string): number | undefined
  /** 记撤销快照 → 保存 → 重绘（与结构编辑同一条路径）；批量操作组合一次提交 = 一步撤销 */
  mutate(next: MindMap): void
  /** 对象层级：front=置顶 up=上移 down=下移 back=置底（对选中对象生效） */
  zOrder(action: 'front' | 'up' | 'down' | 'back'): void
  /** 关系线标签修改（选中单个 edge 时） */
  setEdgeLabel(id: string, label: string | null): void
  command?(command: 'child' | 'sibling' | 'delete' | 'drill' | 'link'): void
  locate?(id: string): void
  /** 文档名称（v15 票 05，名称行）：following = nameOverride 为空（跟随中心主题文字） */
  getDocName?(): { name: string; following: boolean }
  /** 写固定名（文档 meta，不进撤销历史、不动树）；空串由调用方拦截 */
  renameDoc?(name: string): void
}

export interface StylePanel {
  /** 地图/选中态变化后同步活性与高亮（draw() 内调用） */
  sync(): void
  unmount(): void
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/** 手绘弯钩下拉箭头（data URI，描边色 = 主题墨色，需 %转义）。
 *  SVG 路径与 style.css :root --chevron 同源：改一处须同步另一处。 */
function selectChevron(color: string): string {
  const c = encodeURIComponent(color)
  return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='9' viewBox='0 0 12 9'%3E%3Cpath d='M2 2.5 Q 6 8.5 10 2' fill='none' stroke='${c}' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E")`
}

/** 分支形状图标（票 04，ADR-0009 五形状，viewBox 44×16） */
function branchShapeIcon(shape: BranchShape): string {
  const common = `fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`
  switch (shape) {
    case 'curve':
      return `<path d="M4 13 Q 16 2 40 7" ${common}/>`
    case 'straight':
      return `<path d="M4 12 L 40 5" ${common}/>`
    case 'elbow':
      return `<path d="M4 4 H 22 V 12 H 40" ${common}/>`
    case 'roundElbow':
      return `<path d="M4 13 H 15 Q 19 13 19 9 V 8 Q 19 4 23 4 H 40" ${common}/>`
    case 'arc':
      return `<path d="M4 12 Q 22 2 40 9" ${common}/>`
  }
}

/** 线条图标（票 04，五笔画样式，viewBox 44×16）；none 由 popover 显示文字 */
function strokeIcon(stroke: LineStroke): string {
  const common = `fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"`
  switch (stroke) {
    case 'solid':
      return `<path d="M4 8 H 40" ${common}/>`
    case 'dashed':
      return `<path d="M4 8 H 40" ${common} stroke-dasharray="6 4"/>`
    case 'wavy':
      return `<path d="M4 8 Q 8 3 12 8 T 20 8 T 28 8 T 36 8 T 42 8" ${common}/>`
    case 'wavyDashed':
      return `<path d="M4 8 Q 8 3 12 8 T 20 8 T 28 8 T 36 8 T 42 8" ${common} stroke-dasharray="6 4"/>`
    case 'none':
      return ''
  }
}

/** 终点图标（票 05）：短连线 + 末端字形（原语库同源几何）；none 显示文字 */
function endpointIcon(kind: EndpointKind): string {
  if (kind === 'none') return ''
  const g = endpointGlyph(kind, 33, 8, 0, 4.4)
  return `<path d="M 5 8 L 26 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`
    + `<path d="${g.d}" fill="${g.filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
}

/** 粗细图标（票 05）：5 档固定=粗细不同的横线；渐变=楔形 */
function widthIcon(pick: number | 'thin' | 'thick'): string {
  if (pick === 'thin') return `<polygon points="7,7.1 38,3.5 38,12.5 7,8.9" fill="currentColor"/>`
  if (pick === 'thick') return `<polygon points="7,3.5 38,7.1 38,8.9 7,12.5" fill="currentColor"/>`
  return `<path d="M6 8 H 39" fill="none" stroke="currentColor" stroke-width="${Math.max(1.4, pick * 1.6)}" stroke-linecap="round"/>`
}

/** 边框线型图标（票 07）：实/虚/点/手绘双线 */
function borderLineIcon(kind: 'solid' | 'dashed' | 'dotted' | 'double'): string {
  const base = `fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"`
  switch (kind) {
    case 'solid':
      return `<rect x="5" y="3" width="34" height="10" rx="4" ${base}/>`
    case 'dashed':
      return `<rect x="5" y="3" width="34" height="10" rx="4" ${base} stroke-dasharray="6 4"/>`
    case 'dotted':
      return `<rect x="5" y="3" width="34" height="10" rx="4" ${base} stroke-dasharray="2 3.5"/>`
    case 'double':
      return `<rect x="5" y="2.5" width="34" height="11" rx="4" ${base}/><rect x="9.5" y="5.5" width="25" height="5" rx="2.5" ${base} stroke-width="1.3"/>`
  }
}

/** 颜色圆点图标（票 07 边框颜色 / 色卡颜色共用）；'follow'=斜杠圆 */
function colorDotIcon(color: string | 'follow'): string {
  if (color === 'follow') return `<circle cx="22" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M17.5 12.5 L 26.5 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`
  return `<circle cx="22" cy="8" r="6.5" fill="${color}" stroke="rgba(74,63,53,0.25)" stroke-width="1"/>`
}

/** 形状按钮迷你图标（26×18） */
function shapeIcon(shape: NodeShape): string {
  const stroke = 'currentColor'
  const common = `fill="none" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round"`
  switch (shape) {
    case 'ellipse':
      return `<ellipse cx="13" cy="9" rx="10" ry="6" ${common}/>`
    case 'rounded':
      return `<rect x="3" y="4" width="20" height="10" rx="4" ${common}/>`
    case 'underline':
      return `<path d="M7 4 v7 M7 4 h9 M19 4 v7" ${common}/><path d="M4 15 H 22" ${common}/>`
    case 'none':
      return `<path d="M8 4 v8 M8 4 h8 M18 4 v8 M12 4 v8" ${common}/>`
    case 'cloud':
      return `<path d="M6 13 a4 4 0 0 1 1-7.5 a4.5 4.5 0 0 1 8.6-1 a3.8 3.8 0 0 1 3.4 6.3 a3.2 3.2 0 0 1-2 2.2 Z" ${common}/>`
    case 'bubble':
      return `<rect x="3" y="3.5" width="20" height="9" rx="4" ${common}/><path d="M8 12.5 L6 16 L11.5 12.8" ${common}/>`
    case 'burst':
      return `<path d="M13 2 L15 6.5 L19.5 5 L17.5 9 L22 11 L17.5 13 L19.5 17 L15 15.5 L13 20 L11 15.5 L6.5 17 L8.5 13 L4 11 L8.5 9 L6.5 5 L11 6.5 Z" ${common}/>`
    case 'banner':
      return `<path d="M3 4.5 H 23 L20 9 L23 13.5 H 3 L6 9 Z" ${common}/>`
    case 'dashed':
      return `<rect x="3" y="4" width="20" height="10" rx="4" ${common} stroke-dasharray="4 3"/>`
  }
}

function svgEl(markup: string, viewBox = '0 0 40 14'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', viewBox)
  svg.innerHTML = markup
  return svg
}

// ---- popover 图标网格选择器（票 03，spec 决策 8）：图形词汇（纹理/形状/线条/终点/粗细/色卡）
// 统一「当前值按钮 → 手绘风浮层图标网格单选」。供 04–08 各票复用；
// 浮层挂 body（面板 overflow:auto 会裁剪 absolute 子元素），fixed 定位随触发钮，点外/Esc/滚动关闭。
interface PopoverItem<T> {
  value: T
  label: string
  /** SVG inner markup（viewBox 40×14 或 26×18）；无则显示文字 */
  icon?: string
  iconViewBox?: string
  /** 色卡圆环缩略图（票 08）：6 段扇形的颜色数组；'ink'=单色实心环 */
  ring?: string[] | 'ink'
}

const popoverCloseStack: Array<() => void> = []

export function mountPopover<T extends string>(opts: {
  ariaLabel: string
  /** 网格高亮目标：显式值 / 'follow'（跟随项高亮）/ null 或其他值（无高亮，混合态） */
  current: () => T | null
  /** 触发钮展示值（缺省=current）：可返回生效值（跟随中也展示实际生效的图标，XMind 同款） */
  display?: () => T | null
  items: () => Array<PopoverItem<T>>
  onPick: (value: T) => void
  columns?: number
}): { wrap: HTMLDivElement; trigger: HTMLButtonElement; sync: () => void; close: () => void } {
  const wrap = document.createElement('div')
  wrap.className = 'popover-wrap'
  const trigger = document.createElement('button')
  trigger.className = 'popover-trigger'
  trigger.setAttribute('aria-haspopup', 'grid')
  trigger.setAttribute('aria-expanded', 'false')
  trigger.setAttribute('aria-label', opts.ariaLabel)
  const triggerIcon = svgEl('', '0 0 40 14')
  triggerIcon.classList.add('popover-ic')
  const triggerText = document.createElement('span')
  triggerText.className = 'popover-text'
  const triggerChev = svgEl(`<path d="M14 5 Q 20 12 26 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`, '0 0 40 16')
  triggerChev.classList.add('popover-chev')
  trigger.append(triggerIcon, triggerText, triggerChev)
  wrap.appendChild(trigger)

  let panel: HTMLDivElement | null = null
  /** 浮层定位：右对齐触发钮、向下展开，越出视口底部则翻转向上；两向都放不下时钳在视口内 */
  const position = () => {
    if (!panel) return
    const r = trigger.getBoundingClientRect()
    const pw = panel.offsetWidth
    const ph = panel.offsetHeight
    let x = r.right - pw
    let y = r.bottom + 6
    if (y + ph > window.innerHeight - 8) y = r.top - ph - 6
    y = Math.max(8, Math.min(y, window.innerHeight - ph - 8))
    panel.style.left = `${Math.max(8, Math.min(x, window.innerWidth - pw - 8))}px`
    panel.style.top = `${y}px`
    panel.style.visibility = ''
  }
  const close = () => {
    panel?.remove()
    panel = null
    trigger.setAttribute('aria-expanded', 'false')
    document.removeEventListener('mousedown', onDoc, true)
    document.removeEventListener('keydown', onKey, true)
    wrap.closest('#style-panel')?.removeEventListener('scroll', onScroll)
    window.removeEventListener('resize', onScroll)
    const i = popoverCloseStack.indexOf(close)
    if (i >= 0) popoverCloseStack.splice(i, 1)
  }
  /** 面板滚动时浮层跟随重定位（挂 body + fixed 定位，不随面板内容滚动） —— 不关闭，保持选择上下文 */
  const onScroll = () => position()
  const onDoc = (e: Event) => {
    if (panel && !panel.contains(e.target as Node) && !trigger.contains(e.target as Node)) close()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close()
  }
  const open = () => {
    // 手绘风浮层（随主题 chrome 配色）：CSS 变量从面板继承 —— 挂 body 后需显式拷贝
    const styleRoot = document.getElementById('style-panel')
    // 触发钮在面板深处时先滚入视野，浮层才能贴着它展开（滚动事件随后触发 position 重定位）
    trigger.scrollIntoView({ block: 'nearest' })
    panel = document.createElement('div')
    panel.className = 'popover-panel'
    panel.style.gridTemplateColumns = `repeat(${opts.columns ?? 4}, auto)`
    panel.setAttribute('role', 'grid')
    panel.setAttribute('aria-label', opts.ariaLabel)
    for (const style of ['--panel-bg', '--panel-fg', '--panel-border'] as const) {
      if (styleRoot) panel.style.setProperty(style, styleRoot.style.getPropertyValue(style))
    }
    const cur = opts.current()
    for (const item of opts.items()) {
      const cell = document.createElement('button')
      cell.className = 'popover-cell'
      cell.dataset.value = item.value
      cell.title = item.label
      cell.setAttribute('aria-label', item.label)
      if (item.ring) {
        cell.appendChild(ringThumb(item.ring))
      } else if (item.icon) {
        const ic = svgEl(item.icon, item.iconViewBox ?? '0 0 40 14')
        ic.classList.add('popover-cell-ic')
        cell.appendChild(ic)
      } else {
        cell.textContent = item.label
      }
      if (item.value === cur) cell.classList.add('active')
      cell.addEventListener('click', () => {
        opts.onPick(item.value)
        close()
        sync() // 选中后立即回填触发钮图标（下一次 draw 的 sync 也会刷）
      })
      panel.appendChild(cell)
    }
    document.body.appendChild(panel)
    panel.style.visibility = 'hidden'
    requestAnimationFrame(position)
    trigger.setAttribute('aria-expanded', 'true')
    document.addEventListener('mousedown', onDoc, true)
    document.addEventListener('keydown', onKey, true)
    styleRoot?.addEventListener('scroll', onScroll)
    window.addEventListener('resize', onScroll)
    popoverCloseStack.push(close)
    if (popoverCloseStack.length > 1) popoverCloseStack[0]() // 互斥：同时只开一个浮层
  }
  trigger.addEventListener('click', () => (panel ? close() : open()))

  function sync(): void {
    const cur = opts.current()
    const shown = (opts.display ?? opts.current)()
    const item = opts.items().find((i) => i.value === shown)
    triggerText.textContent = ''
    if (item?.ring) {
      triggerIcon.innerHTML = ''
      triggerIcon.replaceChildren(ringThumb(item.ring, true))
      triggerIcon.classList.add('has-ring')
    } else if (item?.icon) {
      triggerIcon.classList.remove('has-ring')
      triggerIcon.setAttribute('viewBox', item.iconViewBox ?? '0 0 40 14')
      triggerIcon.innerHTML = item.icon
    } else {
      triggerIcon.classList.remove('has-ring')
      triggerIcon.innerHTML = ''
      triggerText.textContent = item?.label ?? ''
    }
    if (wrap.closest('.canvas-settings')) {
      const chosen = opts.items().find(i => i.value === cur) ?? item
      triggerText.textContent = chosen?.label ?? '自定义'
      trigger.title = triggerText.textContent
    }
    if (panel) {
      for (const cell of panel.querySelectorAll<HTMLButtonElement>('.popover-cell')) {
        cell.classList.toggle('active', cell.dataset.value === cur)
      }
    }
  }
  sync()
  return { wrap, trigger, sync, close }
}

/** 色卡圆环缩略图（票 08，XMind 同款）：6 段扇形甜甜圈；'ink'=单色实心环 */
function ringThumb(ring: string[] | 'ink', small = false): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.classList.add('ring-thumb')
  if (small) svg.classList.add('small')
  if (ring === 'ink') {
    svg.innerHTML = `<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="5"/>`
    return svg
  }
  const n = Math.max(1, ring.length)
  const segs = ring
    .map((c, i) => {
      const a0 = (i / n) * Math.PI * 2 - Math.PI / 2
      const a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2
      const x0 = 12 + Math.cos(a0) * 8.5
      const y0 = 12 + Math.sin(a0) * 8.5
      const x1 = 12 + Math.cos(a1) * 8.5
      const y1 = 12 + Math.sin(a1) * 8.5
      return `<path d="M ${x0.toFixed(2)} ${y0.toFixed(2)} A 8.5 8.5 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}" fill="none" stroke="${c}" stroke-width="5"/>`
    })
    .join('')
  svg.innerHTML = segs
  return svg
}

// ---- popover 选项词表与图标（票 04，ADR-0009） ----
const BRANCH_SHAPE_ITEMS: BranchShape[] = ['curve', 'straight', 'elbow', 'roundElbow', 'arc']
const BRANCH_SHAPE_NAMES: Record<BranchShape, string> = { curve: '曲线', straight: '直线', elbow: '折线', roundElbow: '圆角折线', arc: '弧线' }
const LINE_STROKE_ITEMS: LineStroke[] = ['solid', 'dashed', 'wavy', 'wavyDashed', 'none']
const LINE_STROKE_NAMES: Record<LineStroke, string> = { solid: '实线', dashed: '虚线', wavy: '波浪实线', wavyDashed: '波浪虚线', none: '无' }

/** 粗细选择词表（票 05）：5 档固定宽 + 渐细/渐粗 + 跟随，共 8 项（spec 决策 9） */
const ENDPOINT_NAMES: Record<EndpointKind, string> = { none: '无', dot: '圆点', arrow: '箭头', triangle: '实心三角', square: '方块', diamond: '菱形', bar: '竖杠', circleHollow: '空心圆' }
type WidthPick = 'follow' | 'thin' | 'thick' | 'w1.2' | 'w1.6' | 'w2.4' | 'w3' | 'w4'
const WIDTH_PICK_ITEMS: Array<Exclude<WidthPick, 'follow'>> = ['thin', 'thick', 'w1.2', 'w1.6', 'w2.4', 'w3', 'w4']
const WIDTH_PICK_NAMES: Record<Exclude<WidthPick, 'follow'>, string> = { thin: '渐细（父粗子细）', thick: '渐粗（父细子粗）', 'w1.2': '极细', 'w1.6': '细', 'w2.4': '中等', w3: '粗', w4: '特粗' }
const widthPickIcon = (p: Exclude<WidthPick, 'follow'>): string => (p === 'thin' || p === 'thick' ? widthIcon(p) : widthIcon(Number(p.slice(1))))
/** 数据 → 选项值：头/文档字段映射到粗细 popover 词表 */
const widthPickOf = (taper: TaperDir | 'fixed' | undefined, width: number | undefined): WidthPick => {
  if (taper === 'thin' || taper === 'thick') return taper
  if (width !== undefined) {
    const hit = WIDTH_PICK_ITEMS.find((p) => p.startsWith('w') && Number(p.slice(1)) === width)
    if (hit) return hit
  }
  return 'follow'
}

/** 填充纹理图标（票 06）：3×2 tile 平铺预览（原语库同源线段）；实心/无填充由调用方给图标/文字 */
function textureIcon(kind: FillTexture, seed = 7): string {
  const spec = fillPatternSpec(kind, seed)
  let tiles = ''
  for (let ty = -1; ty <= 2; ty++)
    for (let tx = -1; tx <= 3; tx++)
      tiles += `<path d="${spec.d}" transform="translate(${tx * spec.w} ${ty * spec.h})" fill="none" stroke="currentColor" stroke-width="${spec.strokeW}" stroke-linecap="round"/>`
  return tiles
}

/** 纸型缩略图与画布共用瓦片规格；小尺寸预览加强笔画以便辨认，空白只显示纸边。 */
function paperStyleIcon(style: PaperStyleId): string {
  const tile = paperTileSpec(style, 'loose')
  let marks = ''
  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 2; tx++) {
      let content = ''
      for (const p of tile.paths) {
        content += `<path d="M ${p.pts.map(([x, y]) => `${x} ${y}`).join(' L ')}" fill="none" stroke="currentColor" stroke-width="${Math.max(0.5, p.w * 0.7)}" opacity="${p.o / 0.36}" vector-effect="non-scaling-stroke"/>`
      }
      for (const d of tile.dots) {
        content += `<circle cx="${d.x}" cy="${d.y}" r="${d.r * 1.5}" fill="currentColor" opacity="${d.o / 0.36}"/>`
      }
      marks += `<svg x="${1 + tx * 10}" y="${1 + ty * 10}" width="10" height="10" viewBox="0 0 ${tile.size} ${tile.size}">${content}</svg>`
    }
  }
  return `<svg width="22" height="14" viewBox="0 0 22 14" aria-hidden="true" focusable="false"><rect x="0.5" y="0.5" width="21" height="13" rx="1" fill="none" stroke="currentColor" opacity="0.5"/>${marks}</svg>`
}

/** 布局模式三选一（旧「布局模式」行）：v15 票 05 由 STRUCTURES 九宫格取代，词表见 structure.ts */

/** 节点结构解析（v15 票 06，提示行）：沿父链找最近显式结构 —— 自身显式 / 最近祖先显式 / 文档默认。
 * 口径对齐 model.effectiveStructureOf（含独立主题根遗留 layoutMode 兼容、游离头无父链直达文档默认），
 * 额外带出来源与来源节点文本（「继承自「谁」」） */
function structureResolutionOf(
  map: MindMap,
  id: string,
): { structure: Structure; source: 'self' | 'ancestor' | 'doc'; fromText?: string } {
  const doc = docStructureOf(map)
  let cur = findNode(map, id)
  if (!cur) return { structure: doc, source: 'doc' }
  for (;;) {
    const self = normalizeStructure(cur.structure)
    if (self) {
      return cur.id === id
        ? { structure: self, source: 'self' }
        : { structure: self, source: 'ancestor', fromText: cur.text }
    }
    const topic = map.topics?.find((t) => t.node === cur)
    if (topic) {
      // 独立主题根：遗留 layoutMode 兼容读取（到主题根即止，主题根之上无父链）
      const legacy = normalizeStructure(topic.layoutMode)
      if (legacy) {
        return cur.id === id
          ? { structure: legacy, source: 'self' }
          : { structure: legacy, source: 'ancestor', fromText: cur.text }
      }
      return { structure: doc, source: 'doc' }
    }
    const parent = findParent(map, cur.id)
    if (!parent) return { structure: doc, source: 'doc' }
    cur = parent
  }
}

export function mountStylePanel(host: PanelHost): StylePanel {
  const root = document.createElement('aside')
  root.id = 'style-panel'
  root.setAttribute('aria-label', '上下文格式面板')
  const contextHeading = document.createElement('h2')
  contextHeading.className = 'context-heading'
  root.append(contextHeading)
  let clearAdvanced = false
  const clearPanel = mountClearPanel(host, () => {
    clearAdvanced = !clearAdvanced
    canvasPage.style.display = clearAdvanced ? '' : 'none'
  })
  root.append(clearPanel.root)

  // ---- 双 tab（词汇见 CONTEXT.md「格式面板」「画布 tab」）----
  type PanelTab = 'style' | 'canvas'
  const tabBar = document.createElement('div')
  tabBar.className = 'panel-tabs'
  const tabButtons: Array<{ el: HTMLButtonElement; tab: PanelTab }> = []
  for (const [t, label] of [
    ['canvas', '画布'],
    ['style', '所选内容'],
  ] as Array<[PanelTab, string]>) {
    const btn = document.createElement('button')
    btn.className = 'panel-tab'
    btn.dataset.tab = t // 供 UI 自动化定位
    btn.textContent = label
    btn.addEventListener('click', () => selectTab(t)) // 手动切换：在下一次选择态变化前有效
    tabBar.appendChild(btn)
    tabButtons.push({ el: btn, tab: t })
  }
  root.appendChild(tabBar)
  tabBar.hidden = false

  const stylePage = document.createElement('div')
  stylePage.className = 'tab-page'
  stylePage.dataset.page = 'style' // 供 UI 自动化定位
  const canvasPage = document.createElement('div')
  canvasPage.className = 'tab-page'
  canvasPage.dataset.page = 'canvas'
  root.append(stylePage, canvasPage)
  const textBoxPanel=mountTextBoxPanel(host);stylePage.append(textBoxPanel.root)

  /** tab 切换（手动点击与选择态驱动共用）：控件常驻 DOM，只切 display —— sync 高亮不受切页影响 */
  let selectedContextLabel = '节点'
  function selectTab(next: PanelTab): void {
    contextHeading.textContent = next === 'canvas' ? '画布设置' : selectedContextLabel
    for (const { el, tab } of tabButtons) el.classList.toggle('active', tab === next)
    stylePage.style.display = next === 'style' ? '' : 'none'
    canvasPage.style.display = next === 'canvas' ? '' : 'none'
  }
  selectTab('canvas') // 初始由首次 sync 按选择态纠正；先落画布避免首帧双页同显
  /** 上次选区签名（ids 顺序串）：变化即选择态变化 → 自动跳对应 tab */
  let lastSignature: string | null = null

  // ---- 名称行（v15 票 05，文档信息行，置于最顶、不属于四分类）：编辑即写固定名（doc meta，
  // 不进撤销历史）；未手动改过时空值 + 占位「跟随中心主题文字」；空提交 no-op 回到当前显示 ----
  const nameLabel = document.createElement('div')
  nameLabel.className = 'panel-label'
  nameLabel.textContent = '名称'
  const nameInput = document.createElement('input')
  nameInput.type = 'text'
  nameInput.id = 'doc-name-input'
  nameInput.className = 'doc-name-input'
  nameInput.setAttribute('aria-label', '文档名称')
  nameInput.placeholder = '跟随中心主题文字'
  /** 回填当前名（聚焦中不打断编辑；host 未提供 getDocName 时整行隐藏） */
  function syncName(): void {
    const info = host.getDocName?.()
    if (!info) {
      nameLabel.style.display = 'none'
      nameInput.style.display = 'none'
      return
    }
    if (document.activeElement === nameInput) return
    nameInput.value = info.following ? '' : info.name
    nameInput.placeholder = '跟随中心主题文字'
  }
  const commitName = () => {
    const v = nameInput.value.trim()
    if (v === '') {
      syncName() // 空输入 no-op：显示回到当前值
      return
    }
    host.renameDoc?.(v)
  }
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      commitName()
      nameInput.blur()
    }
  })
  nameInput.addEventListener('blur', commitName)

  // ---- ① 结构（v15 票 05，取代「布局模式」三选一）：9 种默认结构九宫格（词表 structure.ts）。
  // 语义 = 全链未显式设结构节点的兜底；点击经 setDocStructure 写 doc.layoutMode（进撤销历史） ----
  const structureLabel = document.createElement('div')
  structureLabel.className = 'panel-label'
  structureLabel.textContent = '结构'
  const structureRow = document.createElement('div')
  structureRow.className = 'structure-grid'
  const structureBtns: Array<{ el: HTMLButtonElement; id: Structure }> = []
  for (const s of STRUCTURES) {
    const btn = document.createElement('button')
    btn.className = 'seg-btn'
    btn.title = s.name
    btn.setAttribute('aria-label', s.name)
    btn.textContent = s.short
    btn.addEventListener('click', () => {
      if (docStructureOf(host.getMap()) === s.id) return
      host.mutate(setDocStructure(host.getMap(), s.id)) // 与主题/线形同权，进撤销历史
    })
    structureRow.appendChild(btn)
    structureBtns.push({ el: btn, id: s.id })
  }

  // ---- 文档区：主题 ----
  const themeLabel = document.createElement('div')
  themeLabel.className = 'panel-label'
  themeLabel.textContent = '主题'
  const themeRow = document.createElement('div')
  themeRow.className = 'theme-row'
  const themeCards: Array<{ el: HTMLButtonElement; id: ThemeId }> = []
  for (const t of THEMES) {
    const card = document.createElement('button')
    card.className = 'theme-card'
    card.title = t.name
    card.style.background = t.paper
    const strokes = document.createElementNS(SVG_NS, 'svg')
    strokes.setAttribute('viewBox', '0 0 40 18')
    strokes.innerHTML = t.palette
      .slice(0, 3)
      .map((c, i) => `<path d="M4 ${5 + i * 5} Q 14 ${1 + i * 5} 36 ${4 + i * 5}" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/>`)
      .join('')
    const name = document.createElement('span')
    name.className = 'theme-name'
    name.textContent = t.name
    name.style.color = t.ink
    card.append(strokes, name)
    card.addEventListener('click', () => host.mutate(setTheme(host.getMap(), t.id)))
    themeRow.appendChild(card)
    themeCards.push({ el: card, id: t.id })
  }

  // ---- 分支默认（票 04，取代旧「线形」行 —— ADR-0009：形状×线条两个独立维度的 popover；
  // 遗留 'dashed' 显式覆盖的文档显示为 曲线×虚线 高亮）。高亮=显式覆盖值；触发钮图标=生效值
  const docLineExplicit = (map: MindMap): boolean => map.branchShape !== undefined || map.branchLine !== undefined || map.lineShape !== undefined
  const branchDefaultsShapeLabel = document.createElement('div')
  branchDefaultsShapeLabel.className = 'panel-sublabel'
  branchDefaultsShapeLabel.textContent = '形状'
  const docShapePop = mountPopover<BranchShape | 'follow'>({
    ariaLabel: '文档默认分支形状',
    columns: 3,
    current: () => (docLineExplicit(host.getMap()) ? docBranchShapeOf(host.getMap()) : 'follow'),
    display: () => docBranchShapeOf(host.getMap()),
    items: () => [
      { value: 'follow', label: '跟随主题', icon: branchShapeIcon(docBranchShapeOf(host.getMap())) },
      ...BRANCH_SHAPE_ITEMS.map((s) => ({ value: s, label: BRANCH_SHAPE_NAMES[s], icon: branchShapeIcon(s) })),
    ],
    onPick: (v) => host.mutate(setDocBranchShape(host.getMap(), v === 'follow' ? null : v)),
  })
  const branchDefaultsLineLabel = document.createElement('div')
  branchDefaultsLineLabel.className = 'panel-sublabel'
  branchDefaultsLineLabel.textContent = '线条'
  const docLinePop = mountPopover<LineStroke | 'follow'>({
    ariaLabel: '文档默认线条',
    columns: 3,
    current: () => (docLineExplicit(host.getMap()) ? docBranchLineOf(host.getMap()) : 'follow'),
    display: () => docBranchLineOf(host.getMap()),
    items: () => [
      { value: 'follow', label: '跟随主题', icon: strokeIcon(docBranchLineOf(host.getMap())) },
      ...LINE_STROKE_ITEMS.map((s) => ({ value: s, label: LINE_STROKE_NAMES[s], icon: strokeIcon(s) })),
    ],
    onPick: (v) => host.mutate(setDocBranchLine(host.getMap(), v === 'follow' ? null : v)),
  })

  // 分支默认·终点/粗细（票 05，文档级）：终点 popover（跟随主题 + 8 种）+ 粗细 popover（5 档 + 渐细/渐粗 + 跟随）
  const docEndpointLabel = document.createElement('div')
  docEndpointLabel.className = 'panel-sublabel'
  docEndpointLabel.textContent = '终点'
  const docEndpointPop = mountPopover<EndpointKind | 'follow'>({
    ariaLabel: '文档默认终点',
    columns: 3,
    current: () => host.getMap().branchEndpoint ?? 'follow',
    display: () => host.getMap().branchEndpoint ?? 'none',
    items: () => [
      { value: 'follow', label: '跟随主题', icon: endpointIcon(host.getMap().branchEndpoint ?? 'none') },
      ...ENDPOINT_KINDS.map((k) => ({ value: k, label: ENDPOINT_NAMES[k], icon: endpointIcon(k) })),
    ],
    onPick: (v) => host.mutate(setDocEndpoint(host.getMap(), v === 'follow' ? null : v)),
  })
  const docWidthLabel = document.createElement('div')
  docWidthLabel.className = 'panel-sublabel'
  docWidthLabel.textContent = '粗细'
  const docWidthPop = mountPopover<WidthPick | 'mixed'>({
    ariaLabel: '文档默认粗细',
    columns: 3,
    current: () => widthPickOf(host.getMap().branchTaper, host.getMap().lineWidth),
    display: () => {
      const map = host.getMap()
      const pick = widthPickOf(map.branchTaper, map.lineWidth)
      return pick === 'follow' ? widthPickOf(undefined, lineWidthOf(map)) : pick
    },
    items: () => {
      const map = host.getMap()
      const effTaper = map.branchTaper
      const effWidth = map.lineWidth ?? lineWidthOf(map)
      return [
        { value: 'follow' as const, label: '跟随主题', icon: widthIcon(effTaper ?? effWidth) },
        ...WIDTH_PICK_ITEMS.map((p) => ({ value: p, label: WIDTH_PICK_NAMES[p], icon: widthPickIcon(p) })),
      ]
    },
    onPick: (v) => {
      const map = host.getMap()
      if (v === 'follow' || v === 'mixed') host.mutate(setDocTaper(setLineWidth(map, null), null))
      else if (v === 'thin' || v === 'thick') host.mutate(setDocTaper(map, v))
      else host.mutate(setDocTaper(setLineWidth(map, Number(v.slice(1))), null))
    },
  })

  // 纸底（v9 票 04 → v14 票 03 改走联动入口）：9 色纸底 + 恢复默认（跟随主题纸底）。
  // v15 票 05：纸底/纸型/密度 三行并作「纸张」一组，此为组内小标
  const paperLabel = document.createElement('div')
  paperLabel.className = 'panel-sublabel'
  paperLabel.textContent = '纸底'
  const paperRow = document.createElement('div')
  paperRow.className = 'swatch-row'
  const paperFollow = document.createElement('button')
  paperFollow.className = 'swatch follow'
  paperFollow.title = '恢复默认（跟随主题纸底）'
  paperFollow.textContent = '／'
  paperFollow.addEventListener('click', () => host.mutate(applyPaperChoice(host.getMap(), null)))
  paperRow.appendChild(paperFollow)
  const paperSwatches: HTMLButtonElement[] = []
  for (const c of PAPER_CHOICES) {
    const b = document.createElement('button')
    b.className = 'swatch'
    b.title = c
    b.style.background = c
    b.addEventListener('click', () => host.mutate(applyPaperChoice(host.getMap(), c)))
    paperRow.appendChild(b)
    paperSwatches.push(b)
  }

  // 纸型（v14 票 01/03，ADR-0010）：跟随主题 + 空白 + 5 式（词汇见 CONTEXT.md「纸型」）；文档覆盖时非「跟随主题」高亮
  const styleLabel = document.createElement('div')
  styleLabel.className = 'panel-sublabel'
  styleLabel.textContent = '纸型'
  const styleRow = document.createElement('div')
  styleRow.className = 'seg-row'
  const styleFollowBtn = document.createElement('button')
  styleFollowBtn.className = 'seg-btn'
  styleFollowBtn.title = '跟随主题（主题默认纸型，缺省空白）'
  styleFollowBtn.textContent = '跟随'
  styleFollowBtn.addEventListener('click', () => host.mutate(setPaperStyle(host.getMap(), null)))
  styleRow.appendChild(styleFollowBtn)
  const styleBtns: Array<{ el: HTMLButtonElement; id: PaperStyleId }> = []
  for (const s of PAPER_STYLES) {
    const btn = document.createElement('button')
    btn.className = 'seg-btn paper-style-btn'
    btn.title = s.name
    btn.setAttribute('aria-label', s.name)
    btn.innerHTML = paperStyleIcon(s.id)
    btn.append(document.createTextNode(s.name))
    btn.addEventListener('click', () => host.mutate(setPaperStyle(host.getMap(), s.id)))
    styleRow.appendChild(btn)
    styleBtns.push({ el: btn, id: s.id })
  }

  // 密度（v14 票 01）：疏/密两档；纸型为空白时整行隐藏（无纹样可调）
  const densityLabel = document.createElement('div')
  densityLabel.className = 'panel-sublabel'
  densityLabel.textContent = '密度'
  const densityRow = document.createElement('div')
  densityRow.className = 'seg-row'
  const densityBtns: Array<{ el: HTMLButtonElement; id: PaperDensity }> = []
  for (const [id, name] of [['loose', '疏'], ['dense', '密']] as Array<[PaperDensity, string]>) {
    const btn = document.createElement('button')
    btn.className = 'seg-btn'
    btn.title = id === 'loose' ? '疏（默认间距）' : '密（间距 ×0.6）'
    btn.textContent = name
    btn.addEventListener('click', () => host.mutate(setPaperDensity(host.getMap(), id)))
    densityRow.appendChild(btn)
    densityBtns.push({ el: btn, id })
  }

  // 画布 tab 包裹（词汇见 CONTEXT.md「文档样式」「画布 tab」）：v15 票 05 四分类 ——
  // 名称行 / ① 结构 / ② 主题（主题卡+全局字体+色卡+节点默认）/ ③ 纸张（纸底/纸型/密度）/ ④ 线形
  const secStructure = document.createElement('div')
  secStructure.className = 'canvas-sec'
  const structureDetails = document.createElement('details');const structureSummary=document.createElement('summary');structureSummary.textContent='默认结构';structureDetails.append(structureSummary,structureRow);secStructure.append(structureDetails)
  const secTheme = document.createElement('div')
  secTheme.className = 'canvas-sec'
  secTheme.append(themeLabel, themeRow)
  const branchDefaultsLabel = document.createElement('div')
  branchDefaultsLabel.className = 'panel-label'
  branchDefaultsLabel.textContent = '线形'
  const secBranchDefaults = document.createElement('div')
  secBranchDefaults.className = 'canvas-sec'
  const branchDefaultsRow = document.createElement('div')
  branchDefaultsRow.className = 'popover-duo'
  const docShapeCell = document.createElement('div')
  docShapeCell.append(branchDefaultsShapeLabel, docShapePop.wrap)
  const docLineCell = document.createElement('div')
  docLineCell.append(branchDefaultsLineLabel, docLinePop.wrap)
  branchDefaultsRow.append(docShapeCell, docLineCell)
  const branchDefaultsRow2 = document.createElement('div')
  branchDefaultsRow2.className = 'popover-duo'
  const docEndpointCell = document.createElement('div')
  docEndpointCell.append(docEndpointLabel, docEndpointPop.wrap)
  const docWidthCell = document.createElement('div')
  docWidthCell.append(docWidthLabel, docWidthPop.wrap)
  branchDefaultsRow2.append(docEndpointCell, docWidthCell)
  secBranchDefaults.append(branchDefaultsRow, branchDefaultsRow2)
  // 节点默认（v15 票 05）：主题组内的紧凑子行 —— 文档级节点外观默认（边框/填充），
  // 控件创建在下方 labeledSelect/popover 段，最终装配见 docSection.append
  const secNodeDefaults = document.createElement('div')
  secNodeDefaults.className = 'canvas-sec node-defaults-sec'
  const docSection = document.createElement('div')
  docSection.className = 'panel-section'
  canvasPage.appendChild(docSection)
  // 主题列表迁往顶部工具栏「插入」菜单、动作行删除（v15 票 05）：导出 PNG/新增独立主题工具栏已有，
  // 查看全部由导航缩略图「全部」承接 —— 面板不再有主题列表与动作行

  // ---- 对象区（选中画布对象时激活）：分组框虚/实线、图片描边框 ----
  const objectSection = document.createElement('div')
  objectSection.className = 'panel-section object-section'
  const objectLabel = document.createElement('div')
  objectLabel.className = 'panel-label'
  objectLabel.textContent = '对象'
  objectSection.appendChild(objectLabel)

  const objGroupRow = document.createElement('div')
  objGroupRow.className = 'seg-row'
  const dashBtn = document.createElement('button')
  dashBtn.className = 'seg-btn'
  dashBtn.textContent = '虚线'
  dashBtn.title = '分组框虚线'
  const solidBtn = document.createElement('button')
  solidBtn.className = 'seg-btn'
  solidBtn.textContent = '实线'
  solidBtn.title = '分组框实线'
  objGroupRow.append(dashBtn, solidBtn)
  const objImageRow = document.createElement('div')
  objImageRow.className = 'seg-row'
  const frameBtn = document.createElement('button')
  frameBtn.className = 'seg-btn'
  frameBtn.textContent = '描边框'
  frameBtn.title = '图片手绘描边框 开/关'
  objImageRow.appendChild(frameBtn)
  objectSection.append(objGroupRow, objImageRow)

  // 关系线标签输入（选中单个 edge 时显示；入口按钮在插入区，对节点/对象源都可达）
  const objEdgeRow = document.createElement('div')
  objEdgeRow.className = 'seg-row'
  const edgeLabel = document.createElement('input')
  edgeLabel.type = 'text'
  edgeLabel.className = 'edge-label-input'
  edgeLabel.placeholder = '线标签…'
  edgeLabel.setAttribute('aria-label', '关系线标签')
  objEdgeRow.appendChild(edgeLabel)
  objectSection.appendChild(objEdgeRow)

  // 关系线颜色（v9 票 05）：跟随 from 端 + 主题色板（随主题重建）；单选关系线时显示
  const edgeColorRow = document.createElement('div')
  edgeColorRow.className = 'swatch-row'
  objectSection.appendChild(edgeColorRow)
  const edgeCustomColor = mountCustomColorInput('关系线', color => {
    const id = host.getPrimaryId()
    if (id && findObject(host.getMap(), id)?.kind === 'edge') host.mutate(updateObject(host.getMap(), id, { color }))
  })
  objectSection.append(edgeCustomColor.root)
  const edgeSettings = document.createElement('div')
  edgeSettings.className = 'edge-settings'
  const edgeShape = document.createElement('select')
  edgeShape.setAttribute('aria-label', '关系线线形')
  for (const [value, text] of [['curve', '曲线'], ['straight', '直线'], ['dashed', '虚线']]) edgeShape.add(new Option(text, value))
  const edgeArrow = document.createElement('select')
  edgeArrow.setAttribute('aria-label', '关系线箭头')
  for (const [value, text] of [['end', '终点箭头'], ['start', '起点箭头'], ['both', '双向箭头'], ['none', '无箭头']]) edgeArrow.add(new Option(text, value))
  const edgeWidth = document.createElement('input')
  edgeWidth.type = 'range'
  edgeWidth.min = '1'
  edgeWidth.max = '8'
  edgeWidth.step = '0.2'
  edgeWidth.setAttribute('aria-label', '关系线宽度')
  for (const [text, control] of [['线形', edgeShape], ['箭头', edgeArrow], ['宽度', edgeWidth]] as const) {
    const label = document.createElement('label')
    label.textContent = text
    label.append(control)
    edgeSettings.append(label)
  }
  const resetEdge = document.createElement('button')
  setActionContent(resetEdge, '重置关系线', 'reset')
  resetEdge.addEventListener('click', () => {
    const id = host.getPrimaryId()
    if (id) host.mutate(updateObject(host.getMap(), id, { lineStyle: null, arrow: null, width: null, control: null, color: null }))
  })
  edgeSettings.append(resetEdge)
  objectSection.append(edgeSettings)
  const patchEdge = (patch: ObjectPatch) => {
    const id = host.getPrimaryId()
    if (id && findObject(host.getMap(), id)?.kind === 'edge') host.mutate(updateObject(host.getMap(), id, patch))
  }
  edgeShape.addEventListener('change', () => patchEdge({ lineStyle: edgeShape.value as 'curve' | 'straight' | 'dashed' }))
  edgeArrow.addEventListener('change', () => patchEdge({ arrow: edgeArrow.value as 'end' | 'start' | 'both' | 'none' }))
  edgeWidth.addEventListener('change', () => patchEdge({ width: Number(edgeWidth.value) }))

  // 外框颜色（v9 票 09）：跟随锚定兄弟分支色 + 主题色板（随主题重建）；单选外框时显示
  const boundaryColorRow = document.createElement('div')
  boundaryColorRow.className = 'swatch-row'
  objectSection.appendChild(boundaryColorRow)

  // 层级行：置顶/上移/下移/置底（选中对象时）
  const zRow = document.createElement('div')
  zRow.className = 'seg-row'
  const Z_ENTRIES: Array<['front' | 'up' | 'down' | 'back', string]> = [
    ['front', '置顶'],
    ['up', '上移'],
    ['down', '下移'],
    ['back', '置底'],
  ]
  const zBtns: Array<{ el: HTMLButtonElement; action: 'front' | 'up' | 'down' | 'back' }> = []
  for (const [action, label] of Z_ENTRIES) {
    const b = document.createElement('button')
    b.className = 'seg-btn'
    b.textContent = label
    b.addEventListener('click', () => host.zOrder(action))
    zRow.appendChild(b)
    zBtns.push({ el: b, action })
  }
  objectSection.appendChild(zRow)

  edgeLabel.addEventListener('change', () => {
    const ids = host.getSelectedIds()
    if (ids.length !== 1) return
    const o = findObject(host.getMap(), ids[0])
    if (!o || o.kind !== 'edge') return
    const v = edgeLabel.value.trim()
    host.setEdgeLabel(ids[0], v === '' ? null : v)
  })

  const applyObj = (id: string, patch: ObjectPatch) => host.mutate(updateObject(host.getMap(), id, patch))
  /** 单选分组框或外框（虚/实线按钮的作用对象） */
  const singleSelectedGroupOrBoundary = () => {
    const ids = host.getSelectedIds()
    if (ids.length !== 1) return null
    const o = findObject(host.getMap(), ids[0])
    if (!o || (o.kind !== 'group' && o.kind !== 'boundary')) return null
    return o
  }
  dashBtn.addEventListener('click', () => {
    const o = singleSelectedGroupOrBoundary()
    if (o) applyObj(o.id, { dashed: true })
  })
  solidBtn.addEventListener('click', () => {
    const o = singleSelectedGroupOrBoundary()
    if (o) applyObj(o.id, { dashed: false })
  })
  frameBtn.addEventListener('click', () => {
    const img = singleSelectedOfKind('image')
    if (img) applyObj(img.id, img.framed ? { framed: null } : { framed: true })
  })

  stylePage.appendChild(objectSection)
  const deleteObject = document.createElement('button')
  setActionContent(deleteObject, '删除', 'delete')
  deleteObject.addEventListener('click', () => host.command?.('delete'))
  objectSection.append(deleteObject)

  // ---- 节点区 ----
  const nodeSection = document.createElement('div')
  nodeSection.className = 'panel-section node-section'

  const nodeLabel = document.createElement('div')
  nodeLabel.className = 'panel-label'
  nodeLabel.textContent = '节点'
  nodeSection.appendChild(nodeLabel)
  // v15 票 06 删除项：动作行（+子级/+同级/关系线/下钻 —— Tab/Enter/顶部工具栏/上下文菜单/F6 已有等价入口）、
  // 「独立主题布局」select（被下方节点级结构九宫格取代：任意节点可设，作用其后代子树）。

  // ---- 节点区分组（v15 票 06 三分类）：① 结构 / ② 文本 / ③ 形状（形状+边框+填充合一）----
  // details 折叠组（复用「装饰」模式），默认全展开；存量控件原位迁入、行为不变；
  // 置底横切小动作（传播/清除）不占分类，见下方 styleActions
  const panelGroup = (title: string): HTMLDetailsElement => {
    const d = document.createElement('details')
    d.className = 'panel-group'
    d.open = true
    const s = document.createElement('summary')
    s.textContent = title
    d.appendChild(s)
    return d
  }
  const groupStructure = panelGroup('分支线样式')
  groupStructure.open = false
  const groupText = panelGroup('文字');groupText.classList.add('node-text-group')
  const groupShape = panelGroup('外观');groupShape.classList.add('node-appearance-group')
  const groupMore=panelGroup('更多样式');groupMore.open=false
  nodeSection.append(groupText, groupShape, groupStructure,groupMore)
  nodeLabel.hidden = true

  // ---- ① 结构·节点结构九宫格 + 跟随上级（v15 票 06）：设的是「本节点的子分支怎么排」，
  // 作用于后代直至下一个显式设置（ADR-0012）；高亮看主选中节点的显式覆盖，无显式 → 跟随上级亮；
  // 点击作用于全部选中节点（逐 id 归并成一次 mutate = 一步撤销） ----
  const nodeStructureRow = document.createElement('div')
  nodeStructureRow.className = 'structure-grid'
  const nodeStructureBtns: Array<{ el: HTMLButtonElement; id: Structure | null }> = []
  const applyNodeStructure = (structure: Structure | null) => {
    const ids = host.getSelectedIds()
    if (!ids.length) return
    let next = host.getMap()
    for (const id of ids) next = setStructure(next, id, structure)
    if (next !== host.getMap()) host.mutate(next)
  }
  for (const s of STRUCTURES) {
    const btn = document.createElement('button')
    btn.className = 'seg-btn'
    btn.title = s.name
    btn.setAttribute('aria-label', s.name)
    btn.textContent = s.short
    btn.addEventListener('click', () => applyNodeStructure(s.id))
    nodeStructureRow.appendChild(btn)
    nodeStructureBtns.push({ el: btn, id: s.id })
  }
  const structureFollowBtn = document.createElement('button')
  structureFollowBtn.className = 'seg-btn'
  structureFollowBtn.title = '跟随上级（清除本节点结构覆盖，回落最近祖先显式设置）'
  structureFollowBtn.setAttribute('aria-label', '跟随上级')
  structureFollowBtn.textContent = '跟随上级'
  structureFollowBtn.addEventListener('click', () => applyNodeStructure(null))
  nodeStructureRow.appendChild(structureFollowBtn)
  nodeStructureBtns.push({ el: structureFollowBtn, id: null })
  // 解析链提示：显示当前生效结构与来源（自设 / 继承自哪个祖先 / 文档默认）；非单选节点时隐藏
  const structureHint = document.createElement('div')
  structureHint.className = 'panel-sublabel'
  const nodeStructurePicker=settingPicker('子节点排列',()=>[{value:'follow',label:host.getPrimaryId()&&findParent(host.getMap(),host.getPrimaryId()!)?'跟随上级':'跟随文档',icon:structureIcon(effectiveStructureOf(host.getMap(),host.getPrimaryId()??''))},...structureChoices()],()=>{const values=host.getSelectedIds().map(id=>findNode(host.getMap(),id)?.structure??'follow');return new Set(values).size>1?'__mixed__':values[0]??'follow'},v=>applyNodeStructure(v==='follow'?null:v as Structure))
  const childArrangement=panelGroup('子节点排列');childArrangement.open=false;childArrangement.append(nodeStructurePicker.root,structureHint)
  groupMore.append(childArrangement)
  const branchScope=document.createElement('p');branchScope.className='panel-sublabel';branchScope.textContent='沿用节点与后代分支的继承范围，直到下一个显式设置。';groupStructure.append(branchScope)

  type SegEntry<T> = { el: HTMLButtonElement; value: T | 'follow' }
  const segRow = <T extends string>(parent: HTMLElement, label: string, entries: Array<[T | 'follow', string, string?]>) => {
    const lab = document.createElement('div')
    lab.className = 'panel-sublabel'
    lab.textContent = label
    const row = document.createElement('div')
    row.className = 'seg-row'
    const btns: SegEntry<T>[] = []
    for (const [value, text, markup] of entries) {
      const btn = document.createElement('button')
      btn.className = 'seg-btn'
      btn.title = text
      if (markup) {
        const ic = svgEl(markup, '0 0 26 18')
        ic.classList.add('shape-ic')
        btn.appendChild(ic)
      } else btn.textContent = text
      row.appendChild(btn)
      btns.push({ el: btn, value })
    }
    parent.append(lab, row)
    return btns
  }

  // 形状：跟随层级 / 椭圆 / 圆角框 / 下划线 / 无框 / 云朵 / 气泡 / 爆炸星 / 桃带 / 虚线框（形状与边框组）
  const shapeBtns = segRow<NodeShape>(groupShape, '形状', [
    ['follow', '跟随层级'],
    ['ellipse', '椭圆', shapeIcon('ellipse')],
    ['rounded', '圆角框', shapeIcon('rounded')],
    ['underline', '下划线', shapeIcon('underline')],
    ['none', '无框', shapeIcon('none')],
    ['cloud', '云朵', shapeIcon('cloud')],
    ['bubble', '气泡', shapeIcon('bubble')],
    ['burst', '爆炸星', shapeIcon('burst')],
    ['banner', '桃带', shapeIcon('banner')],
    ['dashed', '虚线框', shapeIcon('dashed')],
  ])
  shapeBtns.forEach(({ el, value }) =>
    el.addEventListener('click', () => {
      const ids = host.getSelectedIds()
      if (!ids.length) return
      host.mutate(setNodesStyle(host.getMap(), ids, { shape: value === 'follow' ? null : value }))
    }),
  )

  const subtitleLabel = document.createElement('label'); subtitleLabel.className = 'font-control'; subtitleLabel.textContent = '副标题'
  const subtitleInput = document.createElement('input'); subtitleInput.type = 'text'; subtitleInput.maxLength = 120; subtitleInput.setAttribute('aria-label', '节点副标题'); subtitleInput.placeholder = '添加一行说明'
  subtitleInput.onchange = () => { const next = structuredClone(host.getMap()); for (const id of host.getSelectedIds()) { const n = findNode(next, id); if (n) { if (subtitleInput.value.trim()) n.subtitle = subtitleInput.value.trim(); else delete n.subtitle } } host.mutate(next) }
  subtitleLabel.append(subtitleInput); groupText.append(subtitleLabel)
  // 字号：跟随 / 小 / 中 / 大 / 特大（文本组）
  const sizeBtns = segRow<NonNullable<NodeStyle['size']>>(groupText, '字号', [
    ['follow', '跟随'],
    ['s', '小'],
    ['m', '中'],
    ['l', '大'],
    ['xl', '特大'],
  ])
  sizeBtns.forEach(({ el, value }) =>
    el.addEventListener('click', () => {
      const ids = host.getSelectedIds()
      if (!ids.length) return
      host.mutate(setNodesStyle(host.getMap(), ids, { size: value === 'follow' ? null : value, fontSize: null }))
    }),
  )

  const fontSizeLabel = document.createElement('label')
  fontSizeLabel.className = 'font-control'
  fontSizeLabel.append('字号 · px')
  const fontSizeInput = document.createElement('input')
  fontSizeInput.type = 'number'
  fontSizeInput.min = '8'
  fontSizeInput.max = '96'
  fontSizeInput.step = '1'
  fontSizeInput.className = 'width-input'
  fontSizeInput.setAttribute('aria-label', '节点字号')
  fontSizeInput.placeholder = '跟随'
  fontSizeInput.addEventListener('change', () => {
    const text = fontSizeInput.value.trim()
    if (fontSizeInput.validity.badInput) return
    const size = text ? Math.min(96, Math.max(8, Math.round(Number(text)))) : null
    if (size !== null && !Number.isFinite(size)) return
    fontSizeInput.value = size === null ? '' : String(size)
    host.mutate(selectionFormat(host.getMap(), host.getSelectedIds(), host.getDepth).apply({ fontSize: size, size: null }, domMeasurer()))
  })
  fontSizeInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); fontSizeInput.blur() } })
  fontSizeLabel.append(fontSizeInput)
  groupText.append(fontSizeLabel)

  // 字重：跟随 / 常规 / 加粗（文本组）
  const weightBtns = segRow<'regular' | 'bold'>(groupText, '字重', [
    ['follow', '跟随'],
    ['regular', '常规'],
    ['bold', '加粗'],
  ])
  weightBtns.forEach(({ el, value }) =>
    el.addEventListener('click', () => {
      const ids = host.getSelectedIds()
      if (!ids.length) return
      host.mutate(setNodesStyle(host.getMap(), ids, { bold: value === 'follow' ? null : value === 'bold' }))
    }),
  )

  // 颜色：跟随分支 + 当前主题色板（随主题变）
  const colorWrap = document.createElement('div')
  const colorLabel = document.createElement('div')
  colorLabel.className = 'panel-sublabel'
  colorLabel.textContent = '颜色'
  const colorRow = document.createElement('div')
  colorRow.className = 'swatch-row'
  colorWrap.append(colorLabel, colorRow)
  groupText.appendChild(colorWrap)
  const nodeCustomColor = mountCustomColorInput('文字', color => host.mutate(selectionFormat(host.getMap(), host.getSelectedIds(), host.getDepth).apply({ color }, domMeasurer())))
  groupText.append(nodeCustomColor.root)

  // 填充（v9 票 03）：盒形底色，跟随=层级默认（中心主题纸底圆、其余分支色浅底）；色板随主题
  // v15 票 06：与边框一起并入「形状」组（③ 形状 = 节点形状 + 边框 + 填充），装配见 groupShape.append
  const fillWrap = document.createElement('div')
  const fillLabel = document.createElement('div')
  fillLabel.className = 'panel-sublabel'
  fillLabel.textContent = '填充'
  const fillRow = document.createElement('div')
  fillRow.className = 'swatch-row'
  fillWrap.append(fillLabel, fillRow)
  const fillCustomColor = mountCustomColorInput('填充', fill => host.mutate(selectionFormat(host.getMap(), host.getSelectedIds(), host.getDepth).apply({ fill }, domMeasurer())))
  fillWrap.append(fillCustomColor.root)

  // 填充纹理（票 06，节点级）：跟随=实心；无填充/实心/5 纹理 共 7 项
  const TEXTURE_ITEMS: Array<FillTexture | 'solid' | 'none'> = ['solid', 'none', 'marker', 'hatchMarker', 'hatchPencil', 'hThick', 'hThin']
  const TEXTURE_NAMES: Record<string, string> = { solid: '实心', none: '无填充', marker: '粗擦块', hatchMarker: '斜排线马克', hatchPencil: '斜排线铅笔', hThick: '粗横线', hThin: '细横线' }
  const textureCellIcon = (k: FillTexture | 'solid' | 'none'): string =>
    k === 'solid' ? `<rect x="6" y="3" width="32" height="10" rx="3" fill="currentColor"/>` : k === 'none' ? '' : textureIcon(k)
  const fillPatternLabel = document.createElement('div')
  fillPatternLabel.className = 'panel-sublabel'
  fillPatternLabel.textContent = '纹理'
  const fillPatternPop = mountPopover<FillTexture | 'solid' | 'none' | 'follow' | 'mixed'>({
    ariaLabel: '填充纹理',
    columns: 4,
    current: () => {
      const nodes = host.getSelectedIds().map((id) => findNode(host.getMap(), id)).filter((n): n is NonNullable<typeof n> => !!n)
      if (!nodes.length) return 'follow'
      const u = selectionFormat(host.getMap(), host.getSelectedIds(), host.getDepth).explicit('fillPattern')
      return u === undefined ? 'follow' : (u as FillTexture | 'solid' | 'none' | 'mixed')
    },
    display: () => {
      const first = host.getSelectedIds().map((id) => findNode(host.getMap(), id)).find((n): n is NonNullable<typeof n> => !!n)
      return first ? fillPatternOf(first.style, host.getMap()) : 'solid'
    },
    items: () => [
      { value: 'follow' as const, label: '跟随', icon: textureCellIcon(fillPatternOf(host.getSelectedIds().map((id) => findNode(host.getMap(), id)).find((n): n is NonNullable<typeof n> => !!n)?.style, host.getMap())) },
      ...TEXTURE_ITEMS.map((k) => ({ value: k, label: TEXTURE_NAMES[k], icon: textureCellIcon(k) })),
    ],
    onPick: (v) => {
      const ids = host.getSelectedIds()
      if (!ids.length || v === 'mixed') return
      host.mutate(setNodesStyle(host.getMap(), ids, { fillPattern: v === 'follow' ? null : v }))
    },
  })
  const fillPatternCell = document.createElement('div')
  fillPatternCell.append(fillPatternLabel, fillPatternPop.wrap)

  // 文本（v9 票 03）：斜体 / 删除线 开关（点按切换；批量混合态全灭）
  const textStyleWrap = document.createElement('div')
  const textStyleLabel = document.createElement('div')
  textStyleLabel.className = 'panel-sublabel'
  textStyleLabel.textContent = '文本'
  const textStyleRow = document.createElement('div')
  textStyleRow.className = 'seg-row'
  const italicBtn = document.createElement('button')
  italicBtn.className = 'seg-btn'
  italicBtn.id = 'style-italic-btn'
  setActionContent(italicBtn, '斜体', 'note-italic', true)
  italicBtn.title = '斜体（合成斜体，不改变量宽）'
  const strikeBtn = document.createElement('button')
  strikeBtn.className = 'seg-btn'
  strikeBtn.id = 'style-strike-btn'
  setActionContent(strikeBtn, '删除线', 'style-strike', true)
  strikeBtn.title = '文字中部手绘删除线'
  textStyleRow.append(italicBtn, strikeBtn)
  textStyleWrap.append(textStyleLabel, textStyleRow)
  groupText.appendChild(textStyleWrap)

  // 对齐（v9 票 03）：跟随（盒形默认）/ 左 / 中 / 右；固定宽度下差异可见（票 06 联调）
  const alignWrap = document.createElement('div')
  const alignLabel = document.createElement('div')
  alignLabel.className = 'panel-sublabel'
  alignLabel.textContent = '对齐'
  const alignRow = document.createElement('div')
  alignRow.className = 'seg-row'
  type AlignChoice = 'follow' | 'left' | 'center' | 'right'
  const ALIGN_CHOICES: Array<[AlignChoice, string]> = [
    ['follow', '跟随'],
    ['left', '左'],
    ['center', '中'],
    ['right', '右'],
  ]
  const alignBtns: Array<{ el: HTMLButtonElement; choice: AlignChoice }> = []
  for (const [choice, label] of ALIGN_CHOICES) {
    const btn = document.createElement('button')
    btn.className = 'seg-btn'
    btn.title = label
    if (choice === 'follow') btn.textContent = label
    else setActionContent(btn, { left: '左对齐', center: '居中对齐', right: '右对齐' }[choice], `align-${choice}`, true)
    btn.addEventListener('click', () => {
      const ids = host.getSelectedIds()
      if (!ids.length) return
      host.mutate(setNodesStyle(host.getMap(), ids, { align: choice === 'follow' ? null : choice }))
    })
    alignRow.appendChild(btn)
    alignBtns.push({ el: btn, choice })
  }
  alignWrap.append(alignLabel, alignRow)
  groupText.appendChild(alignWrap)

  // 宽度（v9 票 06）：适应（跟随=自动换行）/ 固定 PX（钳位 60~600，布局层执行）
  const widthWrap = document.createElement('div')
  const nodeWidthLabel = document.createElement('div')
  nodeWidthLabel.className = 'panel-sublabel'
  nodeWidthLabel.textContent = '宽度'
  const widthCtlRow = document.createElement('div')
  widthCtlRow.className = 'seg-row'
  const widthFitBtn = document.createElement('button')
  widthFitBtn.className = 'seg-btn'
  widthFitBtn.id = 'width-fit-btn'
  widthFitBtn.textContent = '适应'
  widthFitBtn.title = '宽度适应文字（自动换行）'
  widthFitBtn.addEventListener('click', () => {
    const ids = host.getSelectedIds()
    if (!ids.length) return
    host.mutate(setNodesStyle(host.getMap(), ids, { width: null }))
  })
  const widthInput = document.createElement('input')
  widthInput.type = 'number'
  widthInput.id = 'width-px-input'
  widthInput.className = 'width-input'
  widthInput.min = '60'
  widthInput.max = '600'
  widthInput.step = '10'
  widthInput.placeholder = 'PX'
  widthInput.title = '固定宽度（60–600px），文字在其内按对齐排布'
  widthInput.addEventListener('change', () => {
    const ids = host.getSelectedIds()
    if (!ids.length) return
    const v = widthInput.value.trim()
    if (v === '') {
      host.mutate(setNodesStyle(host.getMap(), ids, { width: null }))
      return
    }
    const n = Math.round(Number(v))
    if (!Number.isFinite(n)) return
    host.mutate(setNodesStyle(host.getMap(), ids, { width: Math.min(600, Math.max(60, n)) }))
  })
  widthCtlRow.append(widthFitBtn, widthInput)
  widthWrap.append(nodeWidthLabel, widthCtlRow)
  groupMore.appendChild(widthWrap)

  // 装饰（票据 09，富文本一期）：波浪线 / 荧光高亮 / 编号徽章 —— 文本组成员（分组化后不再是独立 details）
  const DECO_HIGHLIGHTS = ['#FFE066', '#B7E4C7', '#A9D6E5', '#FFC8DD']
  const decoWrap = document.createElement('div')
  const decoLabel = document.createElement('div')
  decoLabel.className = 'panel-sublabel'
  decoLabel.textContent = '装饰'
  const decoRow = document.createElement('div')
  decoRow.className = 'seg-row'
  const wavyBtn = document.createElement('button')
  wavyBtn.className = 'seg-btn'
  wavyBtn.id = 'deco-wavy-btn'
  wavyBtn.textContent = '波浪线'
  wavyBtn.title = '文字底部手绘波浪线'
  const hlSwatches: HTMLButtonElement[] = []
  const hlWrap = document.createElement('div')
  hlWrap.className = 'swatch-row'
  const hlNone = document.createElement('button')
  hlNone.className = 'swatch follow'
  hlNone.title = '无高亮'
  hlNone.textContent = '／'
  hlWrap.appendChild(hlNone)
  for (const c of DECO_HIGHLIGHTS) {
    const b = document.createElement('button')
    b.className = 'swatch'
    b.title = c
    b.style.background = c
    hlWrap.appendChild(b)
    hlSwatches.push(b)
  }
  const BADGE_LABELS = ['徽章', '①', '②', '③', '④', '⑤', '⑥', '⑦'] // index 0 = 无
  const badgeBtn = document.createElement('button')
  badgeBtn.className = 'seg-btn'
  badgeBtn.id = 'deco-badge-btn'
  badgeBtn.textContent = '徽章'
  badgeBtn.title = '编号徽章循环：无 → ① → … → ⑦ → 无'
  decoRow.append(wavyBtn, badgeBtn)
  decoWrap.append(decoLabel, decoRow, hlWrap)
  groupMore.appendChild(decoWrap)

  /** deco 稀疏 patch：fn 返回 null 表示整体删 deco；空对象同样视为删除 */
  const applyDeco = (fn: (d: NonNullable<NodeStyle['deco']>) => NonNullable<NodeStyle['deco']> | null) => {
    const ids = host.getSelectedIds()
    if (!ids.length) return
    let next = host.getMap()
    for (const id of ids) {
      const n = findNode(next, id)
      if (!n) continue
      const cur = n.style?.deco ?? {}
      const nd = fn(cur)
      const patch = { deco: nd === null || Object.keys(nd).length === 0 ? null : nd }
      next = setNodesStyle(next, [id], patch)
    }
    if (next !== host.getMap()) host.mutate(next)
  }
  wavyBtn.addEventListener('click', () => {
    const ids = host.getSelectedIds()
    const anyWavy = ids.some((id) => findNode(host.getMap(), id)?.style?.deco?.wavy)
    applyDeco((d) => ({ ...d, wavy: !anyWavy }))
  })
  hlNone.addEventListener('click', () => applyDeco((d) => {
    const { highlight: _drop, ...rest } = d
    return rest as NonNullable<NodeStyle['deco']>
  }))
  hlSwatches.forEach((b, i) =>
    b.addEventListener('click', () => applyDeco((d) => ({ ...d, highlight: DECO_HIGHLIGHTS[i] }))),
  )
  badgeBtn.addEventListener('click', () => {
    const ids = host.getSelectedIds()
    if (!ids.length) return
    const next = nextBadge(strictUniform(ids.map((id) => findNode(host.getMap(), id)?.style?.deco?.badge)))
    applyDeco((d) => {
      const { badge: _drop, ...rest } = d
      return next === null ? (rest as NonNullable<NodeStyle['deco']>) : { ...rest, badge: next }
    })
  })

  /** 选区全部节点 id（v15 票 06 头覆盖推广）：分支换色/分支线族对任意选中节点生效，
   * 作用于该节点的后代子树（「子节点跟随父节点」）；中心主题由模型层跳过 */
  const selectedStyleIds = (): string[] => host.getSelectedIds()

  italicBtn.addEventListener('click', () => {
    const ids = host.getSelectedIds()
    if (!ids.length) return
    const anyItalic = ids.some((id) => findNode(host.getMap(), id)?.style?.italic)
    host.mutate(setNodesStyle(host.getMap(), ids, { italic: !anyItalic }))
  })
  strikeBtn.addEventListener('click', () => {
    const ids = host.getSelectedIds()
    const anyStrike = ids.some((id) => findNode(host.getMap(), id)?.style?.deco?.strike)
    applyDeco((d) => ({ ...d, strike: !anyStrike }))
  })

  // 分支换色（v15 票 06 并入①结构组，作用后代）：任意节点可选色
  const branchWrap = document.createElement('div')
  const branchLabel = document.createElement('div')
  branchLabel.className = 'panel-sublabel'
  branchLabel.textContent = '分支换色'
  const branchRow = document.createElement('div')
  branchRow.className = 'swatch-row'
  branchWrap.append(branchLabel, branchRow)
  groupStructure.appendChild(branchWrap)

  // 分支线（v9 票 07 → 票 04 升级 → v15 票 06 并入①结构组）：节点级 形状/线条/终点/粗细 覆盖，
  // 作用于该节点的后代子树连线（无 depth-1 门控）
  const branchStyleWrap = document.createElement('div')
  const branchStyleLabel = document.createElement('div')
  branchStyleLabel.className = 'panel-sublabel'
  branchStyleLabel.textContent = '分支线'
  /** 选区节点覆盖的严格归一（遗留 'dashed' 先归一为形状维度）：undefined=全跟随；'mixed'=混合无高亮 */
  const selNodesUniform = <T,>(read: (node: NodeData) => T | undefined): T | undefined | 'mixed' => {
    const nodes = selectedStyleIds().map((id) => findNode(host.getMap(), id)).filter((n): n is NodeData => !!n)
    return strictUniform(nodes.map(read))
  }
  /** 主选中节点的生效解析（触发钮展示用）：逐节点解析链 linkStyleOf，无主选中回 null */
  const primaryLinkStyle = () => {
    const id = host.getPrimaryId()
    return id && findNode(host.getMap(), id) ? linkStyleOf(host.getMap(), id) : null
  }
  const branchShapePop = mountPopover<BranchShape | 'follow' | 'mixed'>({
    ariaLabel: '分支形状',
    columns: 3,
    current: () => {
      const u = selNodesUniform((h) => (h.branchShape === undefined ? undefined : normalizeLineShape(h.branchShape).shape))
      return u === undefined ? 'follow' : u
    },
    display: () => primaryLinkStyle()?.shape ?? null,
    items: () => {
      const eff = primaryLinkStyle()
      return [
        { value: 'follow' as const, label: '跟随文档', icon: eff ? branchShapeIcon(eff.shape) : undefined },
        ...BRANCH_SHAPE_ITEMS.map((s) => ({ value: s, label: BRANCH_SHAPE_NAMES[s], icon: branchShapeIcon(s) })),
      ]
    },
    onPick: (v) => {
      const ids = selectedStyleIds()
      if (!ids.length || v === 'mixed') return
      host.mutate(setBranchShapes(host.getMap(), ids, v === 'follow' ? null : v))
    },
  })
  const branchLinePop = mountPopover<LineStroke | 'follow' | 'mixed'>({
    ariaLabel: '分支线条',
    columns: 3,
    current: () => {
      const u = selNodesUniform((h) => h.branchLine)
      return u === undefined ? 'follow' : u
    },
    display: () => primaryLinkStyle()?.stroke ?? null,
    items: () => {
      const eff = primaryLinkStyle()
      return [
        { value: 'follow' as const, label: '跟随文档', icon: eff ? strokeIcon(eff.stroke) : undefined },
        ...LINE_STROKE_ITEMS.map((s) => ({ value: s, label: LINE_STROKE_NAMES[s], icon: strokeIcon(s) })),
      ]
    },
    onPick: (v) => {
      const ids = selectedStyleIds()
      if (!ids.length || v === 'mixed') return
      host.mutate(setBranchLines(host.getMap(), ids, v === 'follow' ? null : v))
    },
  })
  const branchPopRow = document.createElement('div')
  branchPopRow.className = 'popover-duo'
  const branchShapeCell = document.createElement('div')
  branchShapeCell.append(Object.assign(document.createElement('div'), { className: 'panel-sublabel', textContent: '形状' }), branchShapePop.wrap)
  const branchLineCell = document.createElement('div')
  branchLineCell.append(Object.assign(document.createElement('div'), { className: 'panel-sublabel', textContent: '线条' }), branchLinePop.wrap)
  branchPopRow.append(branchShapeCell, branchLineCell)
  // 分支级 终点/粗细（票 05）：终点 popover（跟随文档 + 8 种）+ 粗细 popover（5 档 + 渐变 + 跟随）
  const branchEndpointPop = mountPopover<EndpointKind | 'follow' | 'mixed'>({
    ariaLabel: '分支终点',
    columns: 3,
    current: () => {
      const u = selNodesUniform((h) => h.branchEndpoint)
      return u === undefined ? 'follow' : u
    },
    display: () => primaryLinkStyle()?.endpoint ?? 'none',
    items: () => {
      const eff = primaryLinkStyle()
      return [
        { value: 'follow' as const, label: '跟随文档', icon: endpointIcon(eff?.endpoint ?? 'none') },
        ...ENDPOINT_KINDS.map((k) => ({ value: k, label: ENDPOINT_NAMES[k], icon: endpointIcon(k) })),
      ]
    },
    onPick: (v) => {
      const ids = selectedStyleIds()
      if (!ids.length || v === 'mixed') return
      host.mutate(setBranchEndpoints(host.getMap(), ids, v === 'follow' ? null : v))
    },
  })
  const branchWidthPop = mountPopover<WidthPick | 'mixed'>({
    ariaLabel: '分支粗细',
    columns: 3,
    current: () => {
      const u = selNodesUniform((n) => widthPickOf(n.branchTaper, n.branchWidth))
      return u === 'mixed' ? 'mixed' : u === undefined ? 'follow' : (u as WidthPick)
    },
    display: () => {
      const ls = primaryLinkStyle()
      return ls ? widthPickOf(ls.taper, ls.width) : widthPickOf(undefined, lineWidthOf(host.getMap()))
    },
    items: () => {
      const ls = primaryLinkStyle()
      const eff = ls ? widthPickOf(ls.taper, ls.width) : null
      return [
        { value: 'follow' as const, label: '跟随文档', icon: widthIcon(eff && eff !== 'follow' ? (eff === 'thin' || eff === 'thick' ? eff : Number(eff.slice(1))) : lineWidthOf(host.getMap())) },
        ...WIDTH_PICK_ITEMS.map((p) => ({ value: p, label: WIDTH_PICK_NAMES[p], icon: widthPickIcon(p) })),
      ]
    },
    onPick: (v) => {
      const ids = selectedStyleIds()
      if (!ids.length || v === 'mixed') return
      const map = host.getMap()
      if (v === 'follow') host.mutate(setBranchTapers(setBranchWidths(map, ids, null), ids, null))
      else if (v === 'thin' || v === 'thick') host.mutate(setBranchTapers(map, ids, v))
      else host.mutate(setBranchTapers(setBranchWidths(map, ids, Number(v.slice(1))), ids, 'fixed'))
    },
  })
  const branchPopRow2 = document.createElement('div')
  branchPopRow2.className = 'popover-duo'
  const branchEndpointCell = document.createElement('div')
  branchEndpointCell.append(Object.assign(document.createElement('div'), { className: 'panel-sublabel', textContent: '终点' }), branchEndpointPop.wrap)
  const branchWidthCell = document.createElement('div')
  branchWidthCell.append(Object.assign(document.createElement('div'), { className: 'panel-sublabel', textContent: '粗细' }), branchWidthPop.wrap)
  branchPopRow2.append(branchEndpointCell, branchWidthCell)
  branchStyleWrap.append(branchStyleLabel, branchPopRow, branchPopRow2)
  groupStructure.appendChild(branchStyleWrap)

  // ---- 置底横切小动作（v15 票 06，D4 传播 + 清除）：不占三分类，选中节点时常驻 ----
  const styleActions = document.createElement('div')
  styleActions.className = 'panel-actions'
  const applySubtreeBtn = document.createElement('button')
  setActionContent(applySubtreeBtn, '应用到子主题', 'add-node-btn')
  applySubtreeBtn.title = '把主选中节点的整套节点样式复制到其全部后代（覆盖式，一步撤销）'
  applySubtreeBtn.addEventListener('click', () => {
    const id = host.getPrimaryId()
    if (id) host.mutate(propagateStyle(host.getMap(), id, 'subtree'))
  })
  const applySiblingsBtn = document.createElement('button')
  setActionContent(applySiblingsBtn, '应用到同级', 'node-sibling')
  applySiblingsBtn.title = '把主选中节点的整套节点样式复制到同父全部兄弟（不含自身）'
  applySiblingsBtn.addEventListener('click', () => {
    const id = host.getPrimaryId()
    if (id) host.mutate(propagateStyle(host.getMap(), id, 'siblings'))
  })
  const clearBtn = document.createElement('button')
  clearBtn.className = 'clear-btn'
  setActionContent(clearBtn, '清除节点样式', 'reset')
  clearBtn.addEventListener('click', () => {
    const ids = host.getSelectedIds()
    if (!ids.length) return
    host.mutate(clearNodesStyle(host.getMap(), ids))
  })
  styleActions.append(applySubtreeBtn, applySiblingsBtn, clearBtn)
  nodeSection.appendChild(styleActions)
  const labeledSelect = (parent: HTMLElement, name: string, options: Array<[string, string]>, change: (value: string) => void) => {
    const label = document.createElement('label'); label.className = 'font-control'; label.textContent = name
    const select = document.createElement('select'); select.setAttribute('aria-label', name)
    for (const [value, text] of options) select.add(new Option(text, value))
    select.onchange = () => change(select.value); label.append(select); parent.append(label); return select
  }
  const fontOptions: Array<[string, string]> = FONTS.map(f => [f.id, f.name])
  const nodeFont = labeledSelect(groupText, '节点字体', [['', '跟随文档'], ...fontOptions], value => host.mutate(selectionFormat(host.getMap(), host.getSelectedIds(), host.getDepth).apply({ font: value ? value as FontId : null }, domMeasurer())))
  const mixedFontOption=new Option('混合','__mixed__');mixedFontOption.disabled=true;nodeFont.add(mixedFontOption)
  groupText.querySelector('summary')!.after(nodeFont.parentElement!) // 字体行置顶（spec 分组词序：字体在最前）
  // 全局字体（v15 票 05 自「默认节点」组提入主题组）：文档级默认字体，选中节点未覆盖时生效
  const documentFont = labeledSelect(secTheme, '文档默认字体', fontOptions, value => host.mutate({ ...host.getMap(), font: value as FontId }))
  const borders: Array<[string, string]> = [['solid', '实线'], ['dashed', '虚线'], ['dotted', '点线'], ['double', '双线']]
  // 节点边框线形（票 07）：popover（跟随/实/虚/点/双线），取代文字 select
  const BORDER_LINE_ITEMS: Array<NonNullable<NodeStyle['borderLine'&{}]> | 'solid'> = ['solid', 'dashed', 'dotted', 'double'] as Array<NonNullable<NodeStyle['borderLine']>>
  const BORDER_LINE_NAMES: Record<string, string> = { solid: '实线', dashed: '虚线', dotted: '点线', double: '手绘双线' }
  const nodeBorderPop = mountPopover<NonNullable<NodeStyle['borderLine']> | 'follow' | 'mixed'>({
    ariaLabel: '节点边框线形',
    columns: 5,
    current: () => {
      const nodes = host.getSelectedIds().map((id) => findNode(host.getMap(), id)).filter((n): n is NonNullable<typeof n> => !!n)
      if (!nodes.length) return 'follow'
      const u = selectionFormat(host.getMap(), host.getSelectedIds(), host.getDepth).explicit('borderLine')
      return u === undefined ? 'follow' : (u as NonNullable<NodeStyle['borderLine']>)
    },
    display: () => {
      const first = host.getSelectedIds().map((id) => findNode(host.getMap(), id)).find((n): n is NonNullable<typeof n> => !!n)
      return (first?.style?.borderLine ?? 'follow') as NonNullable<NodeStyle['borderLine']> | 'follow'
    },
    items: () => [
      { value: 'follow' as const, label: '跟随文档', icon: borderLineIcon('solid') },
      ...BORDER_LINE_ITEMS.map((k) => ({ value: k, label: BORDER_LINE_NAMES[k], icon: borderLineIcon(k) })),
    ],
    onPick: (v) => {
      const ids = host.getSelectedIds()
      if (!ids.length || v === 'mixed') return
      host.mutate(setNodesStyle(host.getMap(), ids, { borderLine: v === 'follow' ? null : v }))
    },
  })
  const borderLineLabel = document.createElement('div')
  borderLineLabel.className = 'panel-sublabel'
  borderLineLabel.textContent = '边框线形'
  const borderLineCell = document.createElement('div')
  borderLineCell.append(borderLineLabel, nodeBorderPop.wrap)

  // 节点边框颜色（票 07）：popover（跟随 + 主题色板）；显式后仅描边变，文字/装饰仍随文字色
  const nodeBorderColorPop = mountPopover<string | 'follow' | 'mixed'>({
    ariaLabel: '节点边框颜色',
    columns: 5,
    current: () => {
      const nodes = host.getSelectedIds().map((id) => findNode(host.getMap(), id)).filter((n): n is NonNullable<typeof n> => !!n)
      if (!nodes.length) return 'follow'
      const u = selectionFormat(host.getMap(), host.getSelectedIds(), host.getDepth).explicit('borderColor')
      return u === undefined ? 'follow' : u
    },
    display: () => {
      const first = host.getSelectedIds().map((id) => findNode(host.getMap(), id)).find((n): n is NonNullable<typeof n> => !!n)
      return first ? (borderColorOf(first.style, host.getMap()) ?? 'follow') : 'follow'
    },
    items: () => [
      { value: 'follow' as const, label: '跟随文字色', icon: colorDotIcon('follow') },
      ...resolveTheme(host.getMap()).palette.map((c) => ({ value: c, label: c, icon: colorDotIcon(c) })),
    ],
    onPick: (v) => {
      const ids = host.getSelectedIds()
      if (!ids.length || v === 'mixed') return
      host.mutate(setNodesStyle(host.getMap(), ids, { borderColor: v === 'follow' ? null : v }))
    },
  })
  const borderColorLabel = document.createElement('div')
  borderColorLabel.className = 'panel-sublabel'
  borderColorLabel.textContent = '边框颜色'
  const borderColorCell = document.createElement('div')
  borderColorCell.append(borderColorLabel, nodeBorderColorPop.wrap)
  groupShape.append(borderLineCell, borderColorCell)
  const documentBorder = labeledSelect(secNodeDefaults, '默认节点边框', [['', '跟随形状'], ...borders], value => host.mutate({ ...host.getMap(), nodeBorderLine: value ? value as NodeStyle['borderLine'] : undefined }))
  const widths: Array<[string, string]> = [['1', '细'], ['2.4', '标准'], ['4', '粗']]
  const nodeBorderWidth = labeledSelect(groupShape, '节点边框粗细', [['__mixed__', '混合'], ['', '跟随文档'], ...widths], value => host.mutate(selectionFormat(host.getMap(), host.getSelectedIds(), host.getDepth).apply({ borderWidth: value ? Number(value) : null }, domMeasurer())))
  const nodeBackdrop = labeledSelect(groupShape, '手绘底色', [['__mixed__', '混合'], ['', '无'], ['brush', '水彩色带'], ['paper', '撕纸便签']], value => host.mutate(selectionFormat(host.getMap(), host.getSelectedIds(), host.getDepth).apply({ backdrop: value ? value as NodeStyle['backdrop'] : null }, domMeasurer())))
  nodeBorderWidth.options[0].disabled = true
  nodeBackdrop.options[0].disabled = true
  // ③ 形状组装配（v15 票 06：原「形状与边框」+「填充」合一）：节点形状 → 边框（线形/颜色/粗细）→ 填充（颜色/纹理）
  const shapeChoices=document.createElement('details');const shapeSummary=document.createElement('summary');shapeSummary.textContent='节点形状';const shapeRow=shapeBtns[0].el.parentElement!;shapeRow.previousElementSibling?.remove();shapeChoices.append(shapeSummary,shapeRow);groupShape.querySelector('summary')!.after(shapeChoices,fillWrap)
  const borderDetails=document.createElement('details');const borderSummary=document.createElement('summary');borderSummary.textContent='边框';borderDetails.append(borderSummary,borderLineCell,borderColorCell,nodeBorderWidth.parentElement!);groupShape.append(borderDetails);fillWrap.append(fillPatternCell)
  const documentBorderWidth = labeledSelect(secNodeDefaults, '默认边框粗细', widths, value => host.mutate({ ...host.getMap(), nodeBorderWidth: Number(value) }))
  const nodeDefaultsLabel = document.createElement('div')
  nodeDefaultsLabel.className = 'panel-sublabel'
  nodeDefaultsLabel.textContent = '节点默认'
  secNodeDefaults.prepend(nodeDefaultsLabel)

  // 默认边框颜色（票 07，文档级）：跟随文字色 + 主题色板
  const docBorderColorLabel = document.createElement('label')
  docBorderColorLabel.className = 'font-control'
  docBorderColorLabel.textContent = '默认边框颜色'
  const docBorderColorPop = mountPopover<string | 'follow'>({
    ariaLabel: '默认边框颜色',
    columns: 5,
    current: () => host.getMap().nodeBorderColor ?? 'follow',
    display: () => host.getMap().nodeBorderColor ?? 'follow',
    items: () => [
      { value: 'follow' as const, label: '跟随文字色', icon: colorDotIcon('follow') },
      ...resolveTheme(host.getMap()).palette.map((c) => ({ value: c, label: c, icon: colorDotIcon(c) })),
    ],
    onPick: (v) => host.mutate(setDocBorderColor(host.getMap(), v === 'follow' ? null : v)),
  })
  docBorderColorLabel.prepend(docBorderColorPop.wrap)
  secNodeDefaults.appendChild(docBorderColorLabel)

  // ---- 色卡（票 08，词汇见 CONTEXT.md「色卡」「彩虹分支」）：文档级分支配色；
  // 圆环缩略图网格（单色/跟随主题/6 卡），选中环高亮；显式色卡为绝对色值，主题切换不清除（spec 决策 10）
  // v15 票 05：原独立组并入「主题」组（开关语义不变）
  const paletteLabel = document.createElement('div')
  paletteLabel.className = 'panel-sublabel'
  paletteLabel.textContent = '色卡'
  const PALETTE_SECTION = document.createElement('div')
  PALETTE_SECTION.className = 'canvas-sec'
  const palettePop = mountPopover<string | 'follow' | 'mono' | '__current'>({
    ariaLabel: '色卡',
    columns: 4,
    current: () => {
      const bp = host.getMap().branchPalette
      if (bp === undefined) return 'follow'
      if (bp === 'mono') return 'mono'
      const card = PALETTE_CARDS.find((c) => c.colors.join() === (bp as string[]).join())
      return card?.id ?? '__current'
    },
    display: () => {
      const bp = host.getMap().branchPalette
      if (bp === undefined) return 'follow'
      if (bp === 'mono') return 'mono'
      const card = PALETTE_CARDS.find((c) => c.colors.join() === (bp as string[]).join())
      return card?.id ?? '__current'
    },
    items: () => {
      const bp = host.getMap().branchPalette
      const items: Array<{ value: string | 'follow' | 'mono' | '__current'; label: string; ring: string[] | 'ink' }> = [
        { value: 'mono', label: '单色（关闭彩虹分支）', ring: 'ink' },
        { value: 'follow', label: '跟随主题', ring: resolveTheme(host.getMap()).palette },
        ...PALETTE_CARDS.map((c) => ({ value: c.id, label: c.name, ring: c.colors })),
      ]
      if (bp !== undefined && bp !== 'mono' && !PALETTE_CARDS.some((c) => c.colors.join() === (bp as string[]).join())) {
        items.push({ value: '__current', label: '自定义色卡', ring: bp as string[] })
      }
      return items
    },
    onPick: (v) => {
      const map = host.getMap()
      if (v === 'follow') host.mutate(setBranchPalette(map, null))
      else if (v === 'mono') host.mutate(setBranchPalette(map, 'mono'))
      else {
        const card = PALETTE_CARDS.find((c) => c.id === v)
        if (card) host.mutate(setBranchPalette(map, card.colors))
      }
    },
  })
  PALETTE_SECTION.append(paletteLabel, palettePop.wrap)
  // ③ 纸张（v15 票 05）：纸底 / 纸型 / 密度 三行合一组（原三个独立组）
  const paperSectionLabel = document.createElement('div')
  paperSectionLabel.className = 'panel-label'
  paperSectionLabel.textContent = '纸张'
  const secPaper = document.createElement('div')
  secPaper.className = 'canvas-sec'
  secPaper.append(paperSectionLabel, paperLabel, paperRow, styleLabel, styleRow, densityLabel, densityRow)
  // 四分类装配：名称行 → ① 结构 → ② 主题（主题卡 + 全局字体 + 色卡 + 节点默认）→ ③ 纸张 → ④ 线形；
  // 全局字体标签在创建时（上方 labeledSelect）已先入 secTheme，色卡组与节点默认随后
  secTheme.append(PALETTE_SECTION, secNodeDefaults)
  nameLabel.hidden=true;nameInput.hidden=true

  // 默认填充纹理（票 06，文档级）：跟随主题=实心；无/5 纹理（显式实心=清除，不单设项）
  const docFillPatternLabel = document.createElement('label')
  docFillPatternLabel.className = 'font-control'
  docFillPatternLabel.textContent = '默认填充纹理'
  const docFillPatternPop = mountPopover<FillTexture | 'none' | 'follow'>({
    ariaLabel: '默认填充纹理',
    columns: 4,
    current: () => (host.getMap().nodeFillPattern ?? 'follow') as FillTexture | 'none' | 'follow',
    display: () => (host.getMap().nodeFillPattern ?? 'follow') as FillTexture | 'none' | 'follow',
    items: () => [
      { value: 'follow' as const, label: '实心（跟随主题）', icon: textureCellIcon('solid') },
      { value: 'none' as const, label: TEXTURE_NAMES.none, icon: textureCellIcon('none') },
      ...(['marker', 'hatchMarker', 'hatchPencil', 'hThick', 'hThin'] as FillTexture[]).map((k) => ({ value: k, label: TEXTURE_NAMES[k], icon: textureCellIcon(k) })),
    ],
    onPick: (v) => host.mutate(setDocFillPattern(host.getMap(), v === 'follow' ? null : v)),
  })
  docFillPatternLabel.prepend(docFillPatternPop.wrap)
  secNodeDefaults.appendChild(docFillPatternLabel)

  const [sizes, lines] = [...clearPanel.root.querySelectorAll('fieldset')]
  const canvasSettings = mountCanvasSettings(host, {
    font: documentFont, sizes, border: documentBorder, borderWidth: documentBorderWidth,
    borderColor: docBorderColorPop.wrap, fillPattern: docFillPatternPop.wrap,
    branchShape: docShapePop.wrap, branchLine: docLinePop.wrap, endpoint: docEndpointPop.wrap,
    width: docWidthPop.wrap, lines,
  })
  canvasSettings.root.addEventListener('settings-collapse', () => {
    for (const pop of [docShapePop, docLinePop, docEndpointPop, docWidthPop, docBorderColorPop, docFillPatternPop]) pop.close()
  })
  docSection.replaceChildren(canvasSettings.root)


  stylePage.append(nodeSection,textBoxPanel.root,objectSection)
  document.getElementById('app')!.appendChild(root)

  /** 色板行重建（主题/调色变化时）：follow + 8 色板；返回 follow 按钮以便高亮 */
  function rebuildSwatchRow(row: HTMLDivElement, onPick: (color: string | null) => void): HTMLButtonElement {
    row.innerHTML = ''
    const follow = document.createElement('button')
    follow.className = 'swatch follow'
    follow.title = '跟随'
    follow.textContent = '／'
    follow.addEventListener('click', () => onPick(null))
    row.appendChild(follow)
    for (const c of resolveTheme(host.getMap()).palette) {
      const b = document.createElement('button')
      b.className = 'swatch'
      b.title = c
      b.style.background = c
      b.addEventListener('click', () => onPick(c))
      row.appendChild(b)
    }
    return follow
  }

  let colorFollow: HTMLButtonElement | null = null
  let branchFollow: HTMLButtonElement | null = null
  let fillFollow: HTMLButtonElement | null = null
  let colorSwatches: HTMLButtonElement[] = []
  let branchSwatches: HTMLButtonElement[] = []
  let fillSwatches: HTMLButtonElement[] = []
  let edgeColorFollow: HTMLButtonElement | null = null
  let edgeColorSwatches: HTMLButtonElement[] = []
  let boundaryColorFollow: HTMLButtonElement | null = null
  let boundaryColorSwatches: HTMLButtonElement[] = []
  /** null = 尚未建过（首次 sync 必建）；此后仅主题变化时重建 */
  let builtTheme: string | null | undefined // undefined = 尚未建过；null = 无显式主题

  function rebuildSwatches(): void {
    const t = host.getMap().theme ?? null
    if (t === builtTheme) return
    builtTheme = t
    colorFollow = rebuildSwatchRow(colorRow, (c) => {
      const ids = host.getSelectedIds()
      if (!ids.length) return
      host.mutate(setNodesStyle(host.getMap(), ids, { color: c }))
    })
    colorSwatches = Array.from(colorRow.querySelectorAll<HTMLButtonElement>('button.swatch:not(.follow)'))
    fillFollow = rebuildSwatchRow(fillRow, (c) => {
      const ids = host.getSelectedIds()
      if (!ids.length) return
      host.mutate(setNodesStyle(host.getMap(), ids, { fill: c }))
    })
    fillSwatches = Array.from(fillRow.querySelectorAll<HTMLButtonElement>('button.swatch:not(.follow)'))
    edgeColorFollow = rebuildSwatchRow(edgeColorRow, (c) => {
      const id = host.getSelectedIds()[0]
      const o = id ? findObject(host.getMap(), id) : null
      if (!o || o.kind !== 'edge') return
      applyObj(o.id, { color: c })
    })
    edgeColorSwatches = Array.from(edgeColorRow.querySelectorAll<HTMLButtonElement>('button.swatch:not(.follow)'))
    boundaryColorFollow = rebuildSwatchRow(boundaryColorRow, (c) => {
      const id = host.getSelectedIds()[0]
      const o = id ? findObject(host.getMap(), id) : null
      if (!o || o.kind !== 'boundary') return
      applyObj(o.id, { color: c })
    })
    boundaryColorSwatches = Array.from(boundaryColorRow.querySelectorAll<HTMLButtonElement>('button.swatch:not(.follow)'))
    branchFollow = rebuildSwatchRow(branchRow, (c) => {
      // 选区全部节点一起换色（v15 票 06 头覆盖推广，作用于各节点的后代子树）；中心主题由模型层跳过
      const ids = selectedStyleIds()
      if (!ids.length) return
      host.mutate(setBranchColors(host.getMap(), ids, c))
    })
    branchSwatches = Array.from(branchRow.querySelectorAll<HTMLButtonElement>('button.swatch:not(.follow)'))
  }

  function sync(): void {
    nodeStructurePicker.sync()
    const map = host.getMap()
    const theme = resolveTheme(map)
    // 配色随主题（CSS 变量注入，夜航=深底浅字）；下拉箭头 SVG 随墨色重着色
    const uiDark = matchMedia('(prefers-color-scheme: dark)').matches
    root.style.setProperty('--panel-bg', uiDark ? '#242925' : '#f4f5f0')
    root.style.setProperty('--panel-fg', uiDark ? '#edf0eb' : '#303a32')
    root.style.setProperty('--panel-border', uiDark ? '#424940' : '#dfe3d9')
    root.style.setProperty('--select-chevron', selectChevron(theme.chrome.fg))

    // 粘性 tab（v9 票 01，词汇见 CONTEXT.md「格式面板」）：每次选择态变化自动跳对应 tab ——
    // 点空白（选区空）→ 画布；选中 ≥1 节点/对象 → 样式；手动切换只在两次选择变化之间有效。
    // 签名 = ids 顺序串：主选中换人不换集合时不跳（同 tab 无视觉差异）
    const ids = host.getSelectedIds()
    const format = selectionFormat(map, ids, host.getDepth)
    if (document.activeElement !== subtitleInput) subtitleInput.value = (host.getPrimaryId() ? findNode(map, host.getPrimaryId()!) : null)?.subtitle ?? ''
    const selectedFont = format.explicit('font'); nodeFont.value = selectedFont === 'mixed' ? '__mixed__' : selectedFont ?? ''
    documentFont.value = map.font ?? 'handwritten'
    documentBorder.value = map.nodeBorderLine ?? ''
    const backdrop = format.explicit('backdrop'), borderWidth = format.explicit('borderWidth')
    nodeBackdrop.value = backdrop === 'mixed' ? '__mixed__' : backdrop ?? ''
    nodeBorderWidth.value = borderWidth === 'mixed' ? '__mixed__' : String(borderWidth ?? '')
    nodeBorderPop.sync()
    nodeBorderColorPop.sync()
    docBorderColorPop.sync()
    palettePop.sync()
    documentBorderWidth.value = String(map.nodeBorderWidth ?? 2.4)
    const signature = ids.join('\n')
    const context = panelContext(ids.map(id => findObject(map, id)?.kind ?? 'node'))
    // 主题列表已迁往顶部工具栏「插入」菜单（v15 票 05），面板不再重建列表；
    // 「独立主题布局」select 已删（v15 票 06）—— 节点级结构九宫格接管（见 groupStructure）
    syncName()
    root.dataset.context = context
    selectedContextLabel = ({ canvas: '画布', node: '节点', textBox:'文本框', edge: '关系线', group: '分组框', boundary: '外框', summary: '概要', mixed: '多选', ...CONTENT_NAMES })[context]
    if(context==='mixed') selectedContextLabel=[...new Set(ids.map(id=>findObject(map,id)?.kind==='textBox'?'文本框':findNode(map,id)?'节点':CONTENT_NAMES[findObject(map,id)?.kind as keyof typeof CONTENT_NAMES]??'元素'))].join(' + ')+`（${ids.length}）`
    textBoxPanel.sync()
    contextHeading.textContent = canvasPage.style.display === 'none' ? selectedContextLabel : '画布设置'
    objectSection.style.display = context !== 'canvas' && context !== 'node' ? '' : 'none'
    nodeSection.style.display = context === 'node' ? '' : 'none'
    edgeSettings.hidden = context !== 'edge'
    edgeCustomColor.root.hidden = context !== 'edge'
    const selectedEdge = ids.length === 1 ? findObject(map, ids[0]) : null
    if (selectedEdge?.kind === 'edge') {
      edgeCustomColor.sync(selectedEdge.color)
      edgeShape.value = selectedEdge.lineStyle ?? 'curve'
      edgeArrow.value = selectedEdge.arrow ?? 'end'
      if (document.activeElement !== edgeWidth) edgeWidth.value = String(selectedEdge.width ?? 2.2)
    }
    if (signature !== lastSignature) {
      lastSignature = signature
      selectTab(ids.length === 0 ? 'canvas' : 'style')
    }

    clearPanel.root.hidden = true
    clearPanel.sync()
    canvasSettings.sync()
    tabButtons[1].el.textContent = context === 'canvas' ? '所选内容' : selectedContextLabel
    tabButtons[1].el.disabled = ids.length === 0
    root.classList.toggle('is-clear', theme.id === 'clear')
    themeCards.forEach(({ el, id }) => el.classList.toggle('active', theme.id === id))
    // 默认结构高亮（画布 tab ①）：docStructureOf 归一读取（缺省含存量 = 'right'，遗留 'balanced' = 'map'）
    const structure = docStructureOf(map)
    structureBtns.forEach(({ el, id }) => el.classList.toggle('active', id === structure))
    // 色板行随主题重建：必须在下方未选中早退之前 —— 否则无选中时切主题色板陈旧
    rebuildSwatches()
    // 分支默认 形状/线条/终点/粗细（票 04/05）：popover 触发钮图标随生效值刷新
    docShapePop.sync()
    docLinePop.sync()
    docEndpointPop.sync()
    docWidthPop.sync()
    docFillPatternPop.sync()
    fillPatternPop.sync()
    // 背景颜色（v9 票 04）→ 纸底（v14 票 03 改名，词汇 CONTEXT.md「纸底」）
    paperFollow.classList.toggle('active', map.paper === undefined)
    paperSwatches.forEach((b) => b.classList.toggle('active', map.paper !== undefined && b.title === map.paper))
    // 跟随主题与显式空白分别高亮；只有跟随操作清除文档覆盖。
    styleFollowBtn.classList.toggle('active', map.paperStyle === undefined)
    for (const b of styleBtns) b.el.classList.toggle('active', map.paperStyle === b.id)
    const styleBlank = paperStyleOf(map) === 'blank'
    densityLabel.style.display = styleBlank ? 'none' : ''
    densityRow.style.display = styleBlank ? 'none' : ''
    const effDensity = paperDensityOf(map)
    for (const b of densityBtns) b.el.classList.toggle('active', b.id === effDensity)

    // 对象区（词汇见 CONTEXT.md「画布对象」）：单选分组框/图片时亮起对应行
    const selObjs = host
      .getSelectedIds()
      .map((id) => findObject(map, id))
      .filter((o): o is NonNullable<typeof o> => !!o)
    const oneObj = selObjs.length === 1 && ids.length === 1 ? selObjs[0] : null
    const isGroupObj = oneObj?.kind === 'group'
    const isImageObj = oneObj?.kind === 'image'
    const isEdgeObj = oneObj?.kind === 'edge'
    const isBoundaryObj = oneObj?.kind === 'boundary'
    objGroupRow.style.display = isGroupObj || isBoundaryObj ? '' : 'none'
    objImageRow.style.display = isImageObj ? '' : 'none'
    objEdgeRow.style.display = isEdgeObj ? '' : 'none'
    edgeColorRow.style.display = isEdgeObj ? '' : 'none'
    boundaryColorRow.style.display = isBoundaryObj ? '' : 'none'
    if (isEdgeObj && document.activeElement !== edgeLabel) edgeLabel.value = (oneObj as { label?: string }).label ?? ''
    zRow.style.display = selObjs.length >= 1 && selObjs.length===ids.length ? '' : 'none'
    objectSection.classList.toggle('disabled', !oneObj && selObjs.length === 0)
    const dashedFlag = (oneObj as { dashed?: boolean } | null)?.dashed
    // 分组框缺省虚线（dashed!==false 即虚）；外框缺省实线（dashed===true 才虚）
    dashBtn.classList.toggle('active', (isGroupObj && dashedFlag !== false) || (isBoundaryObj && dashedFlag === true))
    solidBtn.classList.toggle('active', (isGroupObj && dashedFlag === false) || (isBoundaryObj && dashedFlag !== true))
    frameBtn.classList.toggle('active', isImageObj && !!(oneObj as { framed?: boolean }).framed)
    // 关系线颜色高亮（v9 票 05）
    const edgeColor = isEdgeObj ? (oneObj as { color?: string }).color : undefined
    edgeColorFollow?.classList.toggle('active', edgeColor === undefined || edgeColor === null)
    edgeColorSwatches.forEach((b) => b.classList.toggle('active', typeof edgeColor === 'string' && b.title === edgeColor))
    // 外框颜色高亮（v9 票 09）
    const boundaryColor = isBoundaryObj ? (oneObj as { color?: string }).color : undefined
    boundaryColorFollow?.classList.toggle('active', boundaryColor === undefined || boundaryColor === null)
    boundaryColorSwatches.forEach((b) => b.classList.toggle('active', typeof boundaryColor === 'string' && b.title === boundaryColor))

    // 选区 → 节点集合：样式 tab 节点区活性（无选中时置灰；对象区上方已按选区构成处理）
    const nodes = ids.map((id) => findNode(map, id)).filter((n): n is NonNullable<typeof n> => !!n)
    nodeSection.classList.toggle('disabled', nodes.length === 0)
    if (!nodes.length) return
    const hasChildren = nodes.some(n=>n.children.length>0)
    if(hasChildren||nodes.some(n=>findParent(map,n.id)))nodeSection.insertBefore(groupStructure,groupMore)
    else groupMore.append(groupStructure)
    if(hasChildren)nodeSection.insertBefore(childArrangement,groupStructure)
    else groupMore.prepend(childArrangement)
    const supportedShapes=format.shapes
    fillWrap.hidden=supportedShapes.some(shape=>shape==='none'||shape==='underline')
    borderDetails.hidden=supportedShapes.some(shape=>shape==='none')

    // ① 结构组（v15 票 06）：九宫格高亮 = 主选中节点的显式结构覆盖；无显式 → 「跟随上级」亮。
    // 网格点击对全部选中节点生效（见 applyNodeStructure）；解析链提示仅单选节点时显示（多选无单一来源可述）
    const primaryNode = host.getPrimaryId() ? findNode(map, host.getPrimaryId()!) : null
    const primaryStructure = normalizeStructure(primaryNode?.structure) ?? null
    for (const { el, id } of nodeStructureBtns) el.classList.toggle('active', id === primaryStructure)
    if (ids.length === 1 && primaryNode) {
      const r = structureResolutionOf(map, primaryNode.id)
      const name = STRUCTURES.find((s) => s.id === r.structure)?.name ?? r.structure
      structureHint.textContent =
        r.source === 'self'
          ? `生效：${name} · 自设`
          : r.source === 'ancestor'
            ? `生效：${name} · 继承自「${r.fromText}」`
            : `生效：${name} · 文档默认`
      structureHint.style.display = ''
    } else {
      structureHint.style.display = 'none'
    }

    // 批量混合态（词汇见 CONTEXT.md「多选」）：全体一致才亮，任一不一致 → 按钮组无高亮，点击即全覆盖。
    // active 用严格一致（部分覆盖部分跟随 = 视觉不一致 = 全灭）；effective 用宽松一致（生效值全体相同即亮）
    const shapes = format.explicit('shape')
    const effShapes = format.effective('shape')
    shapeBtns.forEach(({ el, value }) => {
      el.classList.toggle('active', value === 'follow' ? shapes === undefined : shapes === value)
      el.classList.toggle('effective', value !== 'follow' && effShapes === value)
    })
    const sizes = format.explicit('size')
    const hasExactFontSize = nodes.some(n => n.style?.fontSize !== undefined)
    sizeBtns.forEach(({ el, value }) => el.classList.toggle('active', !hasExactFontSize && (value === 'follow' ? sizes === undefined : sizes === value)))
    const bolds = format.explicit('bold')
    weightBtns.forEach(({ el, value }) => {
      el.classList.toggle(
        'active',
        value === 'follow' ? bolds === undefined : value === 'bold' ? bolds === true : bolds === false,
      )
    })

    // 装饰态（批量混合态同款语义，词汇见 CONTEXT.md「多选」）
    const wavys = format.decoration('wavy')
    wavyBtn.classList.toggle('active', wavys === true)
    const hls = format.decoration('highlight')
    hlNone.classList.toggle('active', hls === undefined || hls === null)
    hlSwatches.forEach((b, i) => b.classList.toggle('active', hls === DECO_HIGHLIGHTS[i]))
    const badges = format.decoration('badge')
    badgeBtn.textContent = typeof badges === 'string' ? (BADGE_LABELS[Number(badges)] ?? '徽章') : '徽章'

    const colors = format.explicit('color')
    nodeCustomColor.sync(colors)
    colorFollow?.classList.toggle('active', colors === undefined)
    colorSwatches.forEach((b) => b.classList.toggle('active', typeof colors === 'string' && b.title === colors))
    // 填充/斜体/删除线/对齐（v9 票 03）：批量混合态同款语义
    const fills = format.explicit('fill')
    fillCustomColor.sync(fills)
    fillFollow?.classList.toggle('active', fills === undefined)
    fillSwatches.forEach((b) => b.classList.toggle('active', typeof fills === 'string' && b.title === fills))
    const italics = format.explicit('italic')
    italicBtn.classList.toggle('active', italics === true)
    const strikes = format.decoration('strike')
    strikeBtn.classList.toggle('active', strikes === true)
    const aligns = format.explicit('align')
    alignBtns.forEach(({ el, choice }) => {
      el.classList.toggle('active', choice === 'follow' ? aligns === undefined : aligns === choice)
      el.classList.toggle('effective', choice === 'center' && aligns === undefined)
    })
    // 宽度（v9 票 06）：全体一致才回填输入框；适应亮=全体无覆盖
    const widths = format.explicit('width')
    const fontSizes = format.explicit('fontSize')
    if (document.activeElement !== fontSizeInput) fontSizeInput.value = typeof fontSizes === 'number' ? String(fontSizes) : ''
    fontSizeInput.placeholder = fontSizes === 'mixed' ? '多种字号' : '跟随'
    widthFitBtn.classList.toggle('active', widths === undefined)
    if (document.activeElement !== widthInput) widthInput.value = typeof widths === 'number' ? String(widths) : ''
    widthInput.placeholder = typeof widths === 'number' ? String(widths) : 'PX'
    // 分支换色 / 分支线（v15 票 06 并入①结构组、头覆盖推广）：对全部选中节点生效，无 depth-1 门控 ——
    // 节点区整体随选区显隐，分支子组不再单独隐藏
    branchShapePop.sync()
    branchLinePop.sync()
    branchEndpointPop.sync()
    branchWidthPop.sync()
    const branchCols = strictUniform(nodes.map((n) => n.branchColor))
    branchFollow?.classList.toggle('active', branchCols === undefined)
    branchSwatches.forEach((b) => b.classList.toggle('active', typeof branchCols === 'string' && b.title === branchCols))
  }

  /** 单选对象且类型匹配时返回该对象（对象区按钮作用对象） */
  function singleSelectedOfKind<K extends CanvasObject['kind']>(kind: K): Extract<CanvasObject, { kind: K }> | null {
    const ids = host.getSelectedIds()
    if (ids.length !== 1) return null
    const o = findObject(host.getMap(), ids[0])
    if (!o || o.kind !== kind) return null
    return o as Extract<CanvasObject, { kind: K }>
  }

  rebuildSwatches()
  sync()

  return {
    sync,
    unmount() {
      canvasSettings.unmount()
      nodeStructurePicker.unmount()
      for (const popover of [docShapePop, docLinePop, docEndpointPop, docWidthPop,
        fillPatternPop, branchShapePop, branchLinePop, branchEndpointPop, branchWidthPop,
        nodeBorderPop, nodeBorderColorPop, docBorderColorPop, palettePop, docFillPatternPop]) {
        popover.close()
      }
      root.remove()
    },
  }
}
