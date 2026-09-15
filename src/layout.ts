import { usesClearStyle } from './theme.ts'
import type { MindMap, NodeData, NodeStyle } from './model.ts'
import { docStructureOf, normalizeStructure, topicStructureOf, type Structure } from './structure.ts'
import { objectBBox } from './objects.ts'
import { effectiveStyle, effectiveShape, type LevelStyle } from './levels.ts'
import { wrapLines } from './wrap.ts'
import { edgeGeometry } from './edge-geometry.ts'
import { embeddedLayout, journalMediaSize } from './content-geometry.ts'
import { nodeStyleDefaults } from './fonts.ts'

/** 布局接缝：文字测量由外部注入（DOM 用 canvas，测试用假测量器）；
 * style 为节点生效样式（含覆盖，见 levels.effectiveStyle），缺省即层级基准 */
export interface Size {
  w: number
  h: number
}
export type Measurer = (text: string, depth: number, style?: LevelStyle) => Size

export type Side = 'left' | 'right'

/** 通用矩形（画布或屏幕坐标，视使用处） */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface LaidNode {
  textBox?: Rect
  contentBoxes?: Array<{ id: string; box: Rect }>
  id: string
  node: NodeData
  /** 0 = 中心主题 */
  depth: number
  side: Side
  /** 包围盒左上角，画布坐标（缩放前） */
  x: number
  y: number
  w: number
  h: number
  branchIndex: number
}

export interface LaidLink {
  /** Preserve hierarchy for grouping/navigation without painting a line. */
  hidden?: boolean
  /** Curve corridor used to clear a journal’s image/text body. */
  controlX?: number
  from: string
  to: string
  x1: number
  y1: number
  x2: number
  y2: number
  branchIndex: number
}

/** 鱼骨主刺（v15 票 02，ADR-0012）：鱼骨头的水平主线，非父子连线 —— 不进 links（锚定兄弟组/
 * 导航按 links 的父子序），由 render/exporter 单独绘制（颜色随鱼骨头节点、线宽随其分支） */
export interface LaidSpine {
  /** 鱼骨头节点 id（取色/线宽锚） */
  from: string
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface Layout {
  nodes: LaidNode[]
  links: LaidLink[]
  root: LaidNode
  spines?: LaidSpine[]
}

export const GAP_X = 56
export const FIRST_GAP_X = 96
export const GAP_Y = 12

/** 组织结构图（v15 票 02）：父子垂直间距（bus 段长）/ 兄弟水平间距 */
export const ORG_VGAP = 46
export const ORG_HGAP = 24
/** 树形图（v15 票 02）：子级缩进 / 行距（紧凑缩进列表） */
export const TREE_INDENT = 26
export const TREE_VGAP = 8
/** 鱼骨图（v15 票 02，ADR-0012）：头缘→首肋 / 肋位最小间距 / 肋竖刺长 */
export const FISH_SPINE_GAP = 24
export const FISH_RIB_STEP = 56
export const FISH_RISE = 46

/** 根锚点让位的水平留边：可见树尽量不贴画布左右缘（与 main.ts fitToWindow 的 FIT_MARGIN 同值，
 * 票据 v6-07）。画布宽（svg 宽）已扣除右侧面板的 flex 占位，布局层无需感知面板存在。 */
export const EDGE_MARGIN = 60

/** 文字尺寸 → 节点包围盒：宽随文字，高随行数（单行不低于层级盒高）。
 * 宽高都留真实余量：canvas 度量与 SVG 实际渲染存在亚像素/字体回退偏差，
 * 手绘抖动描边还会向内侵蚀 —— 零余量时文字必然压线/出框。
 * 节点样式覆盖（字号档位）同步放大行高/盒高/内边距/折行宽。 */
export function textBoxSize(text: string, depth: number, measure: Measurer, st?: NodeStyle, subtitle?: string): Size {
  const s = effectiveStyle(depth, st)
  const t = measure(text, depth, s)
  const textW = t.w * 1.06 + 4 // 6% + 4px 安全余量，吸收字体度量漂移
  // 编号徽章占行首：圆径 + 间隙计入盒宽（渲染见 render.appendNode 装饰层）
  const badgeW = st?.deco?.badge ? s.fontPx * 1.6 + 4 : 0
  // 固定宽度（v9 票 06）：盒宽=显式值（钳位 60~600），文字在其内折行（折行宽已由 levels 反推）；
  // 高度仍随行数走 —— 超长文本盒不爆宽但可长高
  // Conversion freezes already measured geometry, which can be narrower than
  // the resize minimum or wider than its maximum. Ordinary width edits clear
  // wrapWidth and resume the interactive limits.
  const retainedWidth = st?.wrapWidth !== undefined && Number.isFinite(st.wrapWidth) && st.wrapWidth > 0
    && st.width !== undefined && Number.isFinite(st.width) && st.width > 0
  let w = st?.width !== undefined
    ? retainedWidth ? st.width : Math.min(600, Math.max(60, st.width))
    : Math.max(textW + badgeW, s.minTextW ?? 0) + s.padX * 2
  let h = Math.max(s.boxH, t.h + 10)
  // 椭圆内接修正：多行文字块按矩形摆放在盒中心，而椭圆在偏离中心的行上比盒窄 ——
  // 长文中心主题首行两端戳出曲线（用户报告；实测首行外缘归一化半径 1.23）。
  // 对最外行视觉外缘（基线含 +0.38em 居中偏移，见 render；上伸 0.88em → 外缘 +0.5em）
  // 解椭圆方程，把盒放大到安全内接圈 s=0.88（余量吸收抖动描边侵蚀）。
  // 单行不动：单行块在盒中心，椭圆最宽处 ≥ 盒宽，现有余量足够。
  if (effectiveShape(depth, st) === 'ellipse' && t.h > s.lineH) {
    const lines = Math.max(2, Math.round(t.h / s.lineH))
    const extremeDy = ((lines - 1) / 2) * s.lineH + 0.5 * s.fontPx
    const SEC = 0.88
    h = Math.max(h, (2 * extremeDy) / SEC) // 硬下限：极行归一化半径 ≤ 0.88
    h = Math.max(h, (2 * extremeDy) / 0.6) // 舒适目标：极行 ≤ 0.6，宽度不致畸宽
    const v = extremeDy / (h / 2)
    w = Math.max(w, t.w / Math.sqrt(SEC * SEC - v * v) + 8)
  }
  if (st?.backdrop === 'brush') h = Math.max(s.lineH + 16, t.h + 14)
  if (subtitle) h = Math.max(h, t.h + s.fontPx * 0.8 + 24)
  if (st?.backdrop === 'paper') h = Math.max(h, w / 2.7)
  return { w, h }
}

/** 树的包围盒（节点盒并集；缩略图适配与「适应窗口」共用） */
export interface TreeBBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function treeBBox(nodes: LaidNode[]): TreeBBox {
  const boxes = nodes.flatMap(n => [n, ...(n.contentBoxes ?? []).map(c => c.box)])
  const xs = boxes.flatMap(b => [b.x, b.x + b.w])
  const ys = boxes.flatMap(b => [b.y, b.y + b.h])
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}

/** 锚定兄弟盒并集（v9 票 09/10，ADR-0004）：外框/概要的派生几何 —— 不存坐标，
 * 渲染时从布局读「锚定父下第 start..start+count-1 个兄弟」的盒并集推导。
 * 任一成员缺失（理论上级联已消亡）返回 null。pad 为外扩内边距。 */
export function anchoredSiblingBox(
  anchor: { parentId: string; start: number; count: number },
  nodes: LaidNode[],
  links: Array<{ from: string; to: string }>,
  pad = 12,
): Rect | null {
  const childIds = links.filter((l) => l.from === anchor.parentId).map((l) => l.to)
  const ids = childIds.slice(anchor.start, anchor.start + anchor.count)
  if (ids.length < anchor.count || anchor.count < 1) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const id of ids) {
    const n = nodes.find((x) => x.id === id)
    if (!n) return null
    minX = Math.min(minX, n.x)
    minY = Math.min(minY, n.y)
    maxX = Math.max(maxX, n.x + n.w)
    maxY = Math.max(maxY, n.y + n.h)
  }
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 }
}

/** 概要几何（v9 票 10，ADR-0004）：括号 + 文字盒，随锚定兄弟盒并集外侧派生。
 * dir=1 尖点朝右（兄弟在右侧逻辑位）；文字 14px 折行 140。任一锚定成员缺失返回 null。 */
export interface SummaryGeom {
  bracket: { x: number; top: number; bottom: number; depth: number; dir: 1 | -1 }
  text: Rect
  lines: string[]
}

export function summaryGeomOf(
  anchor: { parentId: string; start: number; count: number },
  text: string,
  nodes: LaidNode[],
  links: Array<{ from: string; to: string }>,
  widthOf: (s: string) => number,
  seed = 0,
): SummaryGeom | null {
  const box = anchoredSiblingBox(anchor, nodes, links, 0)
  if (!box) return null
  const firstId = links.filter((l) => l.from === anchor.parentId).map((l) => l.to)[anchor.start]
  const firstNode = nodes.find((n) => n.id === firstId)
  if (!firstNode) return null
  const dir: 1 | -1 = firstNode.side === 'right' ? 1 : -1
  const depth = 14 + (seed % 7) // 手绘微差：括号深度随种子轻微变化
  const top = box.y
  const bottom = box.y + box.h
  const bx = dir === 1 ? box.x + box.w : box.x
  const lines = text ? wrapLines(text, 140, widthOf) : ['']
  const textW = Math.max(24, ...lines.map(widthOf)) + 12
  const textH = lines.length * 18 + 8
  const midY = box.y + box.h / 2
  const tx = dir === 1 ? bx + depth + 8 : bx - depth - 8 - textW
  return {
    bracket: { x: bx, top, bottom, depth, dir },
    text: { x: tx, y: midY - textH / 2, w: textW, h: textH },
    lines,
  }
}

/** 盒缘与「从盒心指向目标」方向的交点（关系线锚点，render/exporter 共用） */
export function borderPoint(box: Rect, toward: { x: number; y: number }): { x: number; y: number } {
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const dx = toward.x - cx
  const dy = toward.y - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }
  const sx = dx !== 0 ? box.w / 2 / Math.abs(dx) : Infinity
  const sy = dy !== 0 ? box.h / 2 / Math.abs(dy) : Infinity
  const s = Math.min(sx, sy)
  return { x: cx + dx * s, y: cy + dy * s }
}

/** 内容包围盒（树 + 画布对象，画布坐标）：适应窗口与缩略图适配共用 ——
 * 只算节点盒会把对象裁出画面（v8 检查点发现） */
export function contentBBox(nodes: LaidNode[], map: MindMap): TreeBBox {
  const boxes = [...nodes.flatMap(n => [n, ...(n.contentBoxes ?? []).map(c => c.box)]), ...(map.pages ?? [])]
  const xs = boxes.flatMap(b => [b.x, b.x + b.w])
  const ys = boxes.flatMap(b => [b.y, b.y + b.h])
  for (const o of map.objects ?? []) {
    if (o.kind === 'edge') {
      const box = (id: string) => nodes.find(n => n.id === id) ?? objectBBox((map.objects ?? []).find(obj => obj.id === id) ?? o)
      const a = box(o.from), b = box(o.to)
      if (a && b) {
        const c = edgeGeometry(a, b, o, nodes)
        xs.push(c.from.x, c.to.x, c.control.x, c.label.x - (o.label?.length ?? 0) * 8, c.label.x + (o.label?.length ?? 0) * 8)
        ys.push(c.from.y, c.to.y, c.control.y, c.label.y - 24)
      }
    }
    const b = objectBBox(o)
    if (!b) continue
    xs.push(b.x, b.x + b.w)
    ys.push(b.y, b.y + b.h)
  }
  if (xs.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}

// ==================== v15 票 02：结构解析与退化（ADR-0012） ====================

/** 节点的排布方式 =「本节点的子分支怎么排」，词表即 Structure 九种 */
export type Placement = Structure

export interface NodePlacement {
  place: Placement
  /** 本节点是否显式设置（false = 跟随上级/文档默认） */
  explicit: boolean
  /** 解析链原值：自身显式 > 最近祖先显式 > 文档默认（未做容器退化） */
  resolved: Structure
}

/** 链解析（纯数据）：每节点记录自身显式值与解析结果（最近显式祖先沿链下传） */
function resolveChains(root: NodeData, docDefault: Structure): Map<string, { explicit: Structure | undefined; resolved: Structure }> {
  const out = new Map<string, { explicit: Structure | undefined; resolved: Structure }>()
  const walk = (n: NodeData, nearest: Structure | undefined) => {
    const explicit = normalizeStructure(n.structure)
    out.set(n.id, { explicit, resolved: explicit ?? nearest ?? docDefault })
    for (const c of n.children) walk(c, explicit ?? nearest)
  }
  walk(root, undefined)
  return out
}

/** 退化规则（ADR-0012 容器退化）：
 * - 显式设置 → 即为该词（显式节点才是新的平衡中心/鱼骨头/组织头…）。
 * - 鱼骨肋上的非显式子项 → 沿刺方向的垂直挂列表（tree*；org 本就纵向，透传）。
 * - map/fish 非显式继承到深层 → 沿流向（平衡按所在侧、鱼骨沿主刺）；
 *   流向为空（仅森林根）不退化 —— 文档默认 map/fish 让根直接成为头。 */
function placeOf(explicit: Structure | undefined, resolved: Structure, flow: Side | undefined, parentPl: Placement | undefined): Placement {
  if (explicit) return explicit
  if (resolved === 'journal' && parentPl !== undefined) return 'right'
  if (parentPl === 'fishRight' || parentPl === 'fishLeft') {
    if (resolved === 'orgUp' || resolved === 'orgDown') return resolved
    return parentPl === 'fishRight' ? 'treeRight' : 'treeLeft'
  }
  if (resolved === 'map' || resolved === 'fishRight' || resolved === 'fishLeft') return flow ?? resolved
  return resolved
}

/** 全树排布解析（纯数据 + 可选盒测）。map 父级的子项流向 = 分侧结果：提供 boxSize 时按引擎
 * 同口径（贪心 + 钉定，高度用方向口径）分侧；缺省以右侧占位（侧别精度不影响「父级是否平衡」门控）。 */
export function collectPlacements(
  root: NodeData,
  docDefault: Structure,
  boxSize?: (n: NodeData, depth: number) => { w: number; h: number },
): Map<string, NodePlacement> {
  const chains = resolveChains(root, docDefault)
  const dirExtent = (n: NodeData, depth: number): number => {
    if (!boxSize) return 1
    const { h } = boxSize(n, depth)
    if (n.collapsed || n.children.length === 0) return h
    const kids = n.children.reduce((s, c) => s + dirExtent(c, depth + 1), 0)
    return Math.max(h, kids + GAP_Y * (n.children.length - 1))
  }
  const out = new Map<string, NodePlacement>()
  const walk = (n: NodeData, depth: number, flow: Side | undefined, parentPl: Placement | undefined) => {
    const info = chains.get(n.id)!
    const place = placeOf(info.explicit, info.resolved, flow, parentPl)
    out.set(n.id, { place, explicit: !!info.explicit, resolved: info.resolved })
    if (n.children.length === 0) return
    if (place === 'map' && !n.collapsed) {
      const sums = { left: 0, right: 0 }
      for (const c of n.children) if (c.sideOverride) sums[c.sideOverride] += dirExtent(c, depth + 1) + GAP_Y
      n.children.forEach((c) => {
        const side: Side = c.sideOverride ?? (sums.left < sums.right ? 'left' : 'right')
        if (!c.sideOverride) sums[side] += dirExtent(c, depth + 1) + GAP_Y
        walk(c, depth + 1, side, place)
      })
      return
    }
    let childFlow: Side | undefined = flow
    if (place === 'right' || place === 'treeRight' || place === 'fishRight') childFlow = 'right'
    else if (place === 'left' || place === 'treeLeft' || place === 'fishLeft') childFlow = 'left'
    n.children.forEach((c) => walk(c, depth + 1, childFlow, place))
  }
  walk(root, 0, undefined, undefined)
  return out
}

// ==================== 布局引擎（v15 票 02：九结构逐段递归，ADR-0012） ====================

/** 方向族层间隙（本轮票 01）：子列 = 父盒缘 + 层间隙，根首层用 FIRST_GAP_X。
 * 各分支按实际内容尺寸排布 —— 跨分支不再共享全树列宽（spec 接受旧图自动重排），
 * 同父兄弟仍在同一列缘（组内对齐保留），不同分支的深层按各自内容错列。 */
const edgeGapOf = (depth: number): number => (depth === 0 ? FIRST_GAP_X : GAP_X)

export function computeLayout(map: MindMap, vw: number, vh: number, measure: Measurer, stable = false): Layout {
  if (!map.root.structure && docStructureOf(map) === 'journal') map = { ...map, root: { ...map.root, structure: 'journal' } }
  if (map.font || map.nodeBorderLine || map.nodeBorderWidth || usesClearStyle(map) || map.levelFontSizes) {
    const styled = (node: NodeData, depth = 0): NodeData => ({ ...node, style: nodeStyleDefaults(map, node.style, depth, node.children.length > 0), children: node.children.map(c => styled(c, depth + 1)) })
    map = { ...map, root: styled(map.root), floating: map.floating?.map(f => ({ ...f, node: styled(f.node, 1) })), topics: map.topics?.map(t => ({ ...t, node: styled(t.node) })) }
  }
  const boxSize = (_text: string, depth: number, measure: Measurer, st: NodeStyle | undefined, node?: NodeData): Size => {
    const text = textBoxSize(_text, depth, measure, st, node?.subtitle)
    return node ? embeddedLayout(node, text).size : text
  }
  const comfortable = (map.spacing ?? (usesClearStyle(map) ? 'comfortable' : 'compact')) === 'comfortable'
  const gapY = (depth: number) => comfortable ? (depth === 0 ? 48 : 10) : GAP_Y
  const edgeGap = (depth: number) => comfortable ? (depth === 0 ? 124 : depth === 1 ? 88 : 64) : edgeGapOf(depth)
  const docDefault = docStructureOf(map)
  // 链解析：主树 + 游离森林（游离树的文档默认恒为 right = 旧口径；显式结构仍生效）
  const chains = resolveChains(map.root, docDefault)
  for (const f of map.floating ?? []) for (const [k, v] of resolveChains(f.node, 'right')) chains.set(k, v)
  const sizeOf = (n: NodeData, depth: number) => boxSize(n.text, depth, measure, n.style, n)
  const placeIn = (n: NodeData, flow: Side | undefined, parentPl: Placement | undefined): Placement => {
    const info = chains.get(n.id)!
    return placeOf(info.explicit, info.resolved, flow, parentPl)
  }

  const nodes: LaidNode[] = []
  const links: LaidLink[] = []
  const spines: LaidSpine[] = []
  let mainCount = 0 // 让位平移只作用于主树（游离/独立主题锚定绝对坐标）

  // ---- 度量 ----
  /** 方向口径高度（分侧贪心用；与旧引擎 extent 完全同式 = 存量等价红线） */
  const dirExtent = (n: NodeData, depth: number): number => {
    const { h } = sizeOf(n, depth)
    if (n.collapsed || n.children.length === 0) return h
    const kids = n.children.reduce((s, c) => s + dirExtent(c, depth + 1), 0)
    return Math.max(h, kids + gapY(depth) * (n.children.length - 1))
  }
  /** 平衡分侧（贪心 + 钉定，ADR-0012「侧别钉定」）：钉定高度预载入 sums，
   * 未钉定贪心（sums.left < sums.right → 左，平手放右 —— 与旧 assignSide 逐值一致） */
  const assignSides = (n: NodeData, depth: number): Side[] => {
    const sums = { left: 0, right: 0 }
    for (const c of n.children) if (c.sideOverride) sums[c.sideOverride] += dirExtent(c, depth + 1) + gapY(depth)
    return n.children.map((c) => {
      const side: Side = c.sideOverride ?? (sums.left < sums.right ? 'left' : 'right')
      if (!c.sideOverride) sums[side] += dirExtent(c, depth + 1) + gapY(depth)
      return side
    })
  }
  /** 子树占位高度（按 place 分派的精确口径；供父级堆叠） */
  const extentOf = (n: NodeData, depth: number, flow: Side | undefined, parentPl: Placement | undefined): number => {
    const place = placeIn(n, flow, parentPl)
    const { h } = sizeOf(n, depth)
    if (place === 'journal') {
      const kids = n.collapsed ? [] : n.children
      const height = kids.reduce((sum, c) => sum + extentOf(c, depth + 1, 'right', place), 0) + Math.max(0, kids.length - 1) * 10
      return h + 16 + Math.max(journalMediaSize(n).h, height)
    }
    if (n.collapsed || n.children.length === 0) return h
    switch (place) {
      case 'right': case 'left': {
        const kids = n.children.reduce((s, c) => s + extentOf(c, depth + 1, place, place), 0)
        return Math.max(h, kids + gapY(depth) * (n.children.length - 1))
      }
      case 'map': {
        const sides = assignSides(n, depth)
        let best = 0
        for (const side of ['left', 'right'] as Side[]) {
          const idx = n.children.map((_, i) => i).filter((i) => sides[i] === side)
          if (!idx.length) continue
          const total = idx.reduce((s, i) => s + extentOf(n.children[i], depth + 1, side, 'map'), 0) + gapY(depth) * (idx.length - 1)
          best = Math.max(best, total)
        }
        return Math.max(h, best)
      }
      case 'orgUp': case 'orgDown':
        return h + ORG_VGAP + Math.max(...n.children.map((c) => extentOf(c, depth + 1, flow, place)))
      case 'treeRight': case 'treeLeft': {
        const kidFlow: Side = place === 'treeRight' ? 'right' : 'left'
        const kids = n.children.reduce((s, c) => s + extentOf(c, depth + 1, kidFlow, place), 0)
        return h + TREE_VGAP + kids + TREE_VGAP * (n.children.length - 1)
      }
      case 'fishRight': case 'fishLeft': {
        let up = 0, down = 0
        const kidFlow: Side = place === 'fishRight' ? 'right' : 'left'
        n.children.forEach((c, i) => {
          const e = extentOf(c, depth + 1, kidFlow, place)
          if (i % 2 === 0) up = Math.max(up, e)
          else down = Math.max(down, e)
        })
        return Math.max(h, 2 * FISH_RISE + up + down)
      }
    }
  }
  /** 子树水平宽度（组织图横排 / 树形图对齐 / 鱼骨肋距用；方向族按各分支实际内容宽取最大链） */
  const subWOf = (n: NodeData, depth: number, flow: Side | undefined, parentPl: Placement | undefined): number => {
    const place = placeIn(n, flow, parentPl)
    const { w } = sizeOf(n, depth)
    if (place === 'journal') {
      const kids = n.collapsed ? [] : n.children
      return Math.max(w, journalMediaSize(n).w + 24 + Math.max(0, ...kids.map(c => subWOf(c, depth + 1, 'right', place))))
    }
    if (n.collapsed || n.children.length === 0) return w
    switch (place) {
      case 'right': case 'left': case 'map': {
        let best = 0
        for (const c of n.children) {
          const cFlow: Side | undefined = place === 'map' ? undefined : place
          best = Math.max(best, subWOf(c, depth + 1, cFlow, place))
        }
        return w + edgeGap(depth) + best
      }
      case 'orgUp': case 'orgDown': {
        const kids = n.children.reduce((s, c) => s + centeredWidthOf(c, depth + 1, flow, place), 0) + ORG_HGAP * (n.children.length - 1)
        return Math.max(w, kids)
      }
      case 'treeRight': case 'treeLeft': {
        const kidFlow: Side = place === 'treeRight' ? 'right' : 'left'
        const kids = Math.max(0, ...n.children.map((c) => subWOf(c, depth + 1, kidFlow, place)))
        return Math.max(w, TREE_INDENT + kids)
      }
      case 'fishRight': case 'fishLeft': {
        const ribs = ribPositionsOf(n, depth, place)
        return w + ribs.end + ribs.halves[ribs.halves.length - 1]
      }
    }
  }
  /** 组织图把子树头放在预留区中央；单向子树需在两侧都留出最长伸展量，避免后代侵入相邻区。 */
  const centeredWidthOf = (n: NodeData, depth: number, flow: Side | undefined, parentPl: Placement): number => {
    const width = subWOf(n, depth, flow, parentPl)
    const place = placeIn(n, flow, parentPl)
    return place === 'orgUp' || place === 'orgDown' ? width : 2 * width - sizeOf(n, depth).w
  }
  /** 鱼骨肋位（相对头出刺缘的偏移；肋位按各肋半宽顺推不互压，含主刺终点偏移） */
  const ribPositionsOf = (n: NodeData, depth: number, place: Placement): { ribX: number[]; halves: number[]; end: number } => {
    const kidFlow: Side = place === 'fishRight' ? 'right' : 'left'
    const halves = n.children.map((c) => subWOf(c, depth + 1, kidFlow, place) / 2)
    const ribX: number[] = []
    let prevEdge = 0
    n.children.forEach((_, i) => {
      const x = i === 0
        ? FISH_SPINE_GAP + halves[i]
        : Math.max(ribX[i - 1] + FISH_RIB_STEP, prevEdge + 16 + halves[i])
      ribX.push(x)
      prevEdge = x + halves[i]
    })
    const end = (ribX.length ? ribX[ribX.length - 1] + halves[halves.length - 1] : 0) + FISH_RIB_STEP * 0.4
    return { ribX, halves, end }
  }

  // ---- 摆放 ----
  const emitNode = (n: NodeData, depth: number, side: Side, x: number, centerY: number, w: number, h: number, branchIndex: number): LaidNode => {
    const laid: LaidNode = { id: n.id, node: n, depth, side: depth === 0 ? 'right' : side, x, y: centerY - h / 2, w, h, branchIndex }
    nodes.push(laid)
    return laid
  }
  /** 方向流连线锚点（票 04：子缘外让 4 → 0.5，曲线端紧贴轮廓不脱节；父缘内收 6 藏入盒底不变） */
  const emitDirLink = (parent: LaidNode, child: LaidNode, side: Side, branchIndex: number) => {
    const right = side === 'right'
    const spreadRoot = usesClearStyle(map) && parent.depth === 0 && (effectiveShape(parent.depth, parent.node.style) === 'rounded' || parent.node.style?.backdrop === 'paper')
    links.push({
      from: parent.id, to: child.id, branchIndex,
      ...(!right && child.node.structure === 'journal' ? { controlX: parent.x - 32 } : {}),
      x1: right ? parent.x + parent.w - (spreadRoot ? 32 : 6) : parent.x + (spreadRoot ? 32 : 6),
      y1: spreadRoot
        ? parent.y + parent.h / 2 + Math.max(-parent.h / 2 + (parent.node.style?.backdrop ? 24 : 3), Math.min(parent.h / 2 - (parent.node.style?.backdrop ? 24 : 3), (child.y + child.h / 2 - parent.y - parent.h / 2) / 3))
        : usesClearStyle(map) && effectiveShape(parent.depth, parent.node.style) === 'underline' ? parent.y + parent.h - 2 : parent.y + parent.h / 2,
      x2: right ? child.x - 0.5 : child.x + child.w + 0.5,
      y2: child.y + child.h / 2,
    })
  }
  /** 子列缘（票 01）：子列 = 父盒缘 + 层间隙 —— 各分支按自身内容尺寸排布 */
  const kidEdge = (laid: LaidNode, depth: number, side: Side, childWidth: number): number =>
    side === 'right' ? laid.x + laid.w + edgeGap(depth) : laid.x - edgeGap(depth) - childWidth

  /** 子级摆放总入口（n 已摆放为 laid；按 n 的 place 分派）。
   * branchIndex：深度 1 的子级 = 各自分支头序号（存量口径），更深层沿用父的 */
  const placeChildren = (n: NodeData, laid: LaidNode, depth: number, branchIndex: number, flow: Side | undefined, parentPl: Placement) => {
    if (n.collapsed || n.children.length === 0) return
    switch (parentPl) {
      case 'journal': {
        let y = laid.y + laid.h + 16
        const x = laid.x + journalMediaSize(n).w + 24
        n.children.forEach((c, i) => {
          const { w, h } = sizeOf(c, depth + 1)
          const extent = extentOf(c, depth + 1, 'right', parentPl)
          const bi = depth === 0 ? i : branchIndex
          const cl = emitNode(c, depth + 1, 'right', x, y + extent / 2, w, h, bi)
          links.push({ from: n.id, to: c.id, branchIndex: bi, x1: laid.x + laid.w, y1: laid.y + laid.h / 2, x2: cl.x, y2: cl.y + cl.h / 2, hidden: true })
          placeChildren(c, cl, depth + 1, bi, 'right', placeIn(c, 'right', parentPl))
          y += extent + 10
        })
        break
      }
      case 'right': case 'left': {
        const kidExtents = n.children.map((c) => extentOf(c, depth + 1, parentPl, parentPl))
        const total = kidExtents.reduce((s, e) => s + e, 0) + gapY(depth) * (n.children.length - 1)
        let start = laid.y + laid.h / 2 - total / 2
        n.children.forEach((c, i) => {
          const { w, h } = sizeOf(c, depth + 1)
          const bi = depth === 0 ? i : branchIndex
          const cl = emitNode(c, depth + 1, parentPl, kidEdge(laid, depth, parentPl, w), start + (placeIn(c, parentPl, parentPl) === 'journal' ? h : kidExtents[i]) / 2, w, h, bi)
          emitDirLink(laid, cl, parentPl, bi)
          placeChildren(c, cl, depth + 1, bi, parentPl, placeIn(c, parentPl, parentPl))
          start += kidExtents[i] + gapY(depth)
        })
        break
      }
      case 'map': {
        const sides = assignSides(n, depth)
        for (const side of ['left', 'right'] as Side[]) {
          const idx = n.children.map((_, i) => i).filter((i) => sides[i] === side)
          if (!idx.length) continue
          const kidExtents = idx.map((i) => extentOf(n.children[i], depth + 1, side, 'map'))
          const total = kidExtents.reduce((s, e) => s + e, 0) + gapY(depth) * (idx.length - 1)
          let start = laid.y + laid.h / 2 - total / 2
          idx.forEach((i, k) => {
            const c = n.children[i]
            const { w, h } = sizeOf(c, depth + 1)
            const bi = depth === 0 ? i : branchIndex
            const cl = emitNode(c, depth + 1, side, kidEdge(laid, depth, side, placeIn(c, side, 'map') === 'journal' ? subWOf(c, depth + 1, side, 'map') : w), start + (placeIn(c, side, 'map') === 'journal' ? h : kidExtents[k]) / 2, w, h, bi)
            emitDirLink(laid, cl, side, bi)
            placeChildren(c, cl, depth + 1, bi, side, placeIn(c, side, 'map'))
            start += kidExtents[k] + gapY(depth)
          })
        }
        break
      }
      case 'orgUp': case 'orgDown': {
        const down = parentPl === 'orgDown'
        const kidWs = n.children.map((c) => centeredWidthOf(c, depth + 1, flow, parentPl))
        const total = kidWs.reduce((s, w) => s + w, 0) + ORG_HGAP * (n.children.length - 1)
        let x = laid.x + laid.w / 2 - total / 2
        n.children.forEach((c, i) => {
          const { w, h } = sizeOf(c, depth + 1)
          const ccx = x + kidWs[i] / 2
          const cy = down ? laid.y + laid.h + ORG_VGAP + h / 2 : laid.y - ORG_VGAP - h / 2
          const bi = depth === 0 ? i : branchIndex
          const cl = emitNode(c, depth + 1, 'right', ccx - w / 2, cy, w, h, bi)
          links.push({
            from: n.id, to: c.id, branchIndex: bi,
            x1: laid.x + laid.w / 2, y1: down ? laid.y + laid.h : laid.y,
            x2: ccx, y2: down ? cl.y : cl.y + cl.h,
          })
          placeChildren(c, cl, depth + 1, bi, flow, placeIn(c, flow, parentPl))
          x += kidWs[i] + ORG_HGAP
        })
        break
      }
      case 'treeRight': case 'treeLeft': {
        placeTreeList(n, laid, depth, branchIndex, parentPl, false)
        break
      }
      case 'fishRight': case 'fishLeft': {
        const dir = parentPl === 'fishRight' ? 1 : -1
        const spineY = laid.y + laid.h / 2
        const headEdge = dir > 0 ? laid.x + laid.w : laid.x
        const { ribX, end } = ribPositionsOf(n, depth, parentPl)
        spines.push({ from: n.id, x1: headEdge, y1: spineY, x2: headEdge + dir * end, y2: spineY })
        n.children.forEach((c, i) => {
          const up = i % 2 === 0
          const { w, h } = sizeOf(c, depth + 1)
          const ccx = headEdge + dir * ribX[i]
          const cy = up ? spineY - FISH_RISE - h / 2 : spineY + FISH_RISE + h / 2
          const bi = depth === 0 ? i : branchIndex
          const cl = emitNode(c, depth + 1, dir > 0 ? 'right' : 'left', ccx - w / 2, cy, w, h, bi)
          links.push({ from: n.id, to: c.id, branchIndex: bi, x1: ccx, y1: spineY, x2: cl.x + cl.w / 2, y2: up ? cl.y + cl.h : cl.y })
          if (c.collapsed) return // 折叠肋：只摆肋盒本身，不摆其垂直挂列表
          // 肋排深层：非显式子项已退化为 tree*（垂直挂列表）—— 上肋向上挂、下肋向下挂；
          // 显式设置其他结构的肋子按其自身几何（growUp 不适用）
          const cPlace = placeIn(c, dir > 0 ? 'right' : 'left', parentPl)
          if ((cPlace === 'treeRight' || cPlace === 'treeLeft') && !chains.get(c.id)!.explicit) {
            placeTreeList(c, cl, depth + 1, bi, cPlace, up)
          } else {
            placeChildren(c, cl, depth + 1, bi, dir > 0 ? 'right' : 'left', cPlace)
          }
        })
        break
      }
    }
  }

  /** 树形图子级：紧凑缩进列表（growUp = 鱼骨上肋的向上挂）；连线沿用方向流锚点式样 */
  const placeTreeList = (n: NodeData, laid: LaidNode, depth: number, branchIndex: number, place: Placement, growUp: boolean) => {
    const rightward = place === 'treeRight'
    const side: Side = rightward ? 'right' : 'left'
    const kidExtents = n.children.map((c) => extentOf(c, depth + 1, side, place))
    let cursor = growUp ? laid.y - TREE_VGAP : laid.y + laid.h + TREE_VGAP
    n.children.forEach((c, i) => {
      const { w, h } = sizeOf(c, depth + 1)
      const x = rightward ? laid.x + TREE_INDENT : laid.x - TREE_INDENT - w
      const cy = growUp ? cursor - kidExtents[i] / 2 : cursor + kidExtents[i] / 2
      const bi = depth === 0 ? i : branchIndex
      const cl = emitNode(c, depth + 1, side, x, cy, w, h, bi)
      emitDirLink(laid, cl, side, bi)
      placeChildren(c, cl, depth + 1, bi, side, placeIn(c, side, place))
      cursor += (growUp ? -1 : 1) * (kidExtents[i] + TREE_VGAP)
    })
  }

  // ---- 主树 ----
  const rootPlace = placeIn(map.root, undefined, undefined)
  const rootSize = sizeOf(map.root, 0)
  const rootW0 = rootSize.w
  const cx = map.rootPosition?.x ?? vw / 2
  const cy = map.rootPosition?.y ?? vh / 2
  const rootNode: LaidNode = {
    id: map.root.id, node: map.root, depth: 0, side: 'right',
    x: cx - rootSize.w / 2, y: cy - rootSize.h / 2, w: rootSize.w, h: rootSize.h, branchIndex: -1,
  }
  nodes.push(rootNode)

  // 按主树实际左右范围统一让位，支持不对称平衡树与混排；随后再添加绝对定位的游离/独立主题。
  placeChildren(map.root, rootNode, 0, -1, undefined, rootPlace)
  mainCount = nodes.length
  if (!stable && !map.rootPosition && nodes.length > 1) {
    const bb = treeBBox(nodes.slice(0, mainCount))
    const leftExt = cx - bb.minX
    const rightExt = bb.maxX - cx
    const hasLeft = bb.minX < rootNode.x - 1e-6
    const hasRight = bb.maxX > rootNode.x + rootNode.w + 1e-6
    const lo = EDGE_MARGIN + leftExt
    const hi = vw - EDGE_MARGIN - rightExt
    let target = cx
    if (lo <= hi) target = Math.min(Math.max(cx, lo), hi)
    else {
      const pref = hasRight && !hasLeft ? hi : hasLeft && !hasRight ? lo : cx
      target = Math.min(Math.max(pref, EDGE_MARGIN + rootW0 / 2), vw - EDGE_MARGIN - rootW0 / 2)
    }
    const dx = target - cx
    if (Math.abs(dx) > 1e-9) {
      for (let i = 0; i < mainCount; i++) nodes[i].x += dx
      for (const l of links) { l.x1 += dx; l.x2 += dx; if (l.controlX !== undefined) l.controlX += dx }
      for (const s of spines) { s.x1 += dx; s.x2 += dx }
    }
  }

  // ---- 游离森林（ADR-0002）：每棵以游离头为根、锚定 (x,y)；头的深度档取 1（与一级分支同视觉）。
  // 游离树的文档默认恒为 right（旧口径）；头上的显式结构照常生效（v15） ----
  for (const [fi, f] of (map.floating ?? []).entries()) {
    const branchIndex = map.root.children.length + fi
    const headPlace = placeIn(f.node, undefined, undefined)
    const headSize = sizeOf(f.node, 1)
    const headLaid = emitNode(f.node, 1, 'right', f.x, f.y + headSize.h / 2, headSize.w, headSize.h, branchIndex)
    placeChildren(f.node, headLaid, 1, branchIndex, 'right', headPlace)
  }

  // ---- 独立主题（ADR-0002）：递归整图布局后平移锚定（结构随主题根解析，v15 票 01 迁移口径） ----
  let branchOffset = map.root.children.length + (map.floating?.length ?? 0)
  for (const topic of map.topics ?? []) {
    const local = computeLayout({ ...map, root: topic.node, rootPosition: undefined, pages: undefined, floating: undefined, topics: undefined, objects: undefined, layoutMode: topicStructureOf(topic) }, 1000, 800, measure)
    const dx = topic.x - local.root.x, dy = topic.y - local.root.y
    for (const n of local.nodes) nodes.push({ ...n, x: n.x + dx, y: n.y + dy, branchIndex: branchOffset + Math.max(0, n.branchIndex) })
    for (const l of local.links) links.push({ ...l, ...(l.controlX !== undefined ? { controlX: l.controlX + dx } : {}), x1: l.x1 + dx, x2: l.x2 + dx, y1: l.y1 + dy, y2: l.y2 + dy, branchIndex: branchOffset + l.branchIndex })
    for (const s of local.spines ?? []) spines.push({ ...s, x1: s.x1 + dx, x2: s.x2 + dx })
    branchOffset += Math.max(1, topic.node.children.length)
  }

  for (const n of nodes) {
    if (!n.node.contents?.length && !n.node.icon) continue
    const parts = embeddedLayout(n.node, textBoxSize(n.node.text, n.depth, measure, n.node.style, n.node.subtitle))
    n.textBox = { ...parts.text, x: n.x + parts.text.x, y: n.y + parts.text.y }
    n.contentBoxes = parts.items.map(item => ({ id: item.content.id, box: { ...item.box, x: n.x + item.box.x, y: n.y + item.box.y } }))
  }
  return { nodes, links, root: rootNode, spines }
}

/** 编辑器、缩略图、导出共用的稳定世界布局；旧布局函数保留用于旧文档参照与迁移。 */
export function computeWorldLayout(map: MindMap, measure: Measurer): Layout {
  return computeLayout(map, 1200, 800, measure, true)
}
