/** 画布对象（词汇见 CONTEXT.md「画布对象」；模型决策见 ADR-0003）：
 * 独立于树、自带画布坐标的元素。objects 数组顺序即对象间 z 序（后=顶层）；
 * 渲染层序固定：分组框 < 关系线 < 图片/贴纸（见 render.ts），组框与关系线不参与互相压盖。
 * 全部函数纯：clone 后改副本，原 map 不动（与 model.ts 同规）。 */

import type { MindMap, NodeStyle } from './model.ts'
import type { Rect } from './layout.ts'

export interface BaseObject {
  id: string
  /** 手绘抖动种子：创建时生成、随数据持久化，保证描边稳定 */
  seed: number
}

/** Independent typography, without a node's hierarchy or embedded content. */
export interface TextBoxObject extends BaseObject {
  kind: 'textBox'
  text: string
  x: number; y: number; w: number; h: number
  style: NodeStyle
}

/** 图片（词汇见 CONTEXT.md「图片」）：src=压缩后的 data URL；framed=手绘描边框 */
export interface ImageObject extends BaseObject {
  /** When owned by a node, x/y are offsets from its title box. */
  placement?: 'overlay'
  kind: 'image'
  src: string
  x: number
  y: number
  w: number
  h: number
  framed?: boolean
}

/** 贴纸（词汇见 CONTEXT.md「贴纸」）：icon=贴纸库 id（src/stickers.ts），正方形 size */
export interface StickerObject extends BaseObject {
  placement?: 'overlay'
  kind: 'sticker'
  icon: string
  x: number
  y: number
  size: number
}

export interface TableObject extends BaseObject {
  kind: 'table'
  x: number; y: number; w: number; h: number
  cells: string[][]
  columnWidths: number[]
  header: boolean
  fills: Record<string, string>
}

export interface CycleObject extends BaseObject {
  kind: 'cycle'
  x: number; y: number; w: number; h: number
  steps: Array<{ id: string; text: string }>
  clockwise: boolean
  color: string
  sketch: boolean
}

/** 流程图（词汇见 CONTEXT.md「流程图」）：首尾不闭合的线性步骤链；条目不是思维导图节点（ADR-0007）。
 * 复制模式：字段样式照 CycleObject，不抽公共基类（v11 spec Q6） */
export interface FlowObject extends BaseObject {
  kind: 'flow'
  x: number; y: number; w: number; h: number
  steps: Array<{ id: string; text: string }>
  /** 展开方向：right=横向左右排列，down=纵向上下排列 */
  direction: 'right' | 'down'
  color: string
  sketch: boolean
}

/** 时间轴（词汇见 CONTEXT.md「时间轴」）：主轴 + 时刻；time 为可选时间标注（空串=不显示） */
export interface TimelineObject extends BaseObject {
  kind: 'timeline'
  x: number; y: number; w: number; h: number
  items: Array<{ id: string; time: string; text: string }>
  direction: 'right' | 'down'
  color: string
  sketch: boolean
}

/** 金字塔图（词汇见 CONTEXT.md「金字塔图」）：自底向上逐层收窄，顶层收为三角形；items[0] 为底层，无方向字段 */
export interface PyramidObject extends BaseObject {
  kind: 'pyramid'
  x: number; y: number; w: number; h: number
  items: Array<{ id: string; text: string }>
  color: string
  sketch: boolean
}

/** 圆圈图（词汇见 CONTEXT.md「圆圈图」）：中心词条 + 环绕联想词条，辐条相连；条目不是思维导图节点 */
export interface CircleMapObject extends BaseObject {
  kind: 'circleMap'
  x: number; y: number; w: number; h: number
  center: { id: string; text: string }
  items: Array<{ id: string; text: string }>
  color: string
  sketch: boolean
}

export interface InkStroke {
  id: string
  points: Array<{ x: number; y: number }>
  color: string
  width: number
  opacity: number
}

export interface InkObject extends BaseObject {
  kind: 'ink'
  x: number; y: number; w: number; h: number
  sourceWidth: number; sourceHeight: number
  strokes: InkStroke[]
}

/** 分组框（词汇见 CONTEXT.md「分组框」）：几何包含成员，框本身无成员清单 */
export interface GroupObject extends BaseObject {
  kind: 'group'
  x: number
  y: number
  w: number
  h: number
  /** true=虚线框（缺省虚线）；false=实线 */
  dashed?: boolean
}

/** 外框（词汇见 CONTEXT.md「外框」；机制决策见 ADR-0004）：锚定兄弟组的标注框。
 * 不存坐标 —— 渲染时从布局读锚定兄弟盒并集推导（layout.anchoredSiblingBox）；
 * dashed 缺省实线；color 缺省跟随锚定兄弟的分支色 */
export interface BoundaryObject extends BaseObject {
  kind: 'boundary'
  anchor: { parentId: string; start: number; count: number }
  dashed?: boolean
  color?: string
}

/** 概要（词汇见 CONTEXT.md「概要」；ADR-0004）：锚定兄弟组的括号标注；文字不是树上节点。
 * 同外框：不存坐标，渲染时从锚定兄弟盒并集外侧推导 */
export interface SummaryObject extends BaseObject {
  kind: 'summary'
  anchor: { parentId: string; start: number; count: number }
  text: string
}

/** 关系线（词汇见 CONTEXT.md「关系线」）：两端引用画布对象 id 或任意节点 id */
export interface EdgeObject extends BaseObject {
  kind: 'edge'
  from: string
  to: string
  label?: string
  /** 线色（v9 票 05）：缺省=跟随 from 端（节点取其分支色、对象取主题墨色）；显式色限主题色板 */
  color?: string
  lineStyle?: 'curve' | 'straight' | 'dashed'
  width?: number
  arrow?: 'end' | 'start' | 'both' | 'none'
  /** Offset from the endpoint midpoint, so moving endpoints carries the bend. */
  control?: { x: number; y: number }
}

export type CanvasObject =
  | TextBoxObject
  | ImageObject
  | StickerObject
  | GroupObject
  | EdgeObject
  | BoundaryObject
  | SummaryObject
  | TableObject
  | CycleObject
  | FlowObject
  | TimelineObject
  | PyramidObject
  | CircleMapObject
  | InkObject

/** 各型最小尺寸钳位 */
export const OBJECT_MIN = { image: 40, sticker: 24, group: 60 } as const

/** 稀疏属性 patch（StylePatch 同款语义，model.ts）：null 删键；id/kind 不可改（见 updateObject） */
export type ObjectPatch = {
  lineStyle?: EdgeObject['lineStyle'] | null
  width?: number | null
  arrow?: EdgeObject['arrow'] | null
  control?: EdgeObject['control'] | null
  framed?: boolean | null
  dashed?: boolean | null
  label?: string | null
  /** 关系线线色（v9 票 05）；null=清除回跟随 */
  color?: string | null
  /** 概要文字（v9 票 10） */
  text?: string | null
}

export function newSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0
}

/** 对象包围盒（画布坐标）；关系线无包围盒（命中走线距，见 main.ts） */
export function objectBBox(obj: CanvasObject): Rect | null {
  if ('w' in obj) return { x: obj.x, y: obj.y, w: obj.w, h: obj.h }
  if (obj.kind === 'sticker') return { x: obj.x, y: obj.y, w: obj.size, h: obj.size }
  return null
}

export function findObject(map: MindMap, id: string): CanvasObject | null {
  return (map.objects ?? []).find((o) => o.id === id) ?? null
}

export function addObject(map: MindMap, obj: CanvasObject): MindMap {
  const next = cloneMap(map)
  next.objects = [...(next.objects ?? []), obj]
  return next
}

/** 克隆内定位（move/resize/update 共用）：原 map 有该对象才克隆，返回克隆体里的可变引用 */
function locateInClone(map: MindMap, id: string): { next: MindMap; obj: CanvasObject } | null {
  if (!findObject(map, id)) return null
  const next = cloneMap(map)
  return { next, obj: next.objects!.find((o) => o.id === id)! }
}

/** 平移：只对带坐标的对象生效；关系线锚定端点，随端走，不直接平移 */
export function moveObject(map: MindMap, id: string, x: number, y: number): MindMap {
  const hit = locateInClone(map, id)
  if (!hit || !('x' in hit.obj)) return map
  // TS 无法窄化 union 的多态写回，与 model.applyStylePatch 同款断言
  const t = hit.obj
  t.x = x
  t.y = y
  return hit.next
}

/** 缩放：图片/分组框改 w/h，贴纸改 size（等比正方形）；均钳最小尺寸 */
export function resizeObject(map: MindMap, id: string, w: number, h: number): MindMap {
  const hit = locateInClone(map, id)
  if (!hit || !('x' in hit.obj)) return map
  const t = hit.obj
  if (t.kind === 'sticker') t.size = Math.max(OBJECT_MIN.sticker, Math.round(Math.max(w, h)))
  else if (t.kind === 'image') {
    t.w = Math.max(OBJECT_MIN.image, Math.round(w))
    t.h = Math.max(OBJECT_MIN.image, Math.round(h))
  } else {
    t.w = Math.max(OBJECT_MIN.group, Math.round(w))
    t.h = Math.max(OBJECT_MIN.group, Math.round(h))
  }
  return hit.next
}

/** 稀疏属性 patch：null 删键（framed/dashed/label 等可空字段）；id/kind 不可改 */
export function updateObject(map: MindMap, id: string, patch: ObjectPatch): MindMap {
  const hit = locateInClone(map, id)
  if (!hit) return map
  // patch 键与对象字段的动态关联 TS 无法精确收窄，经 Record 写入（与 model.applyStylePatch 同款）
  const t = hit.obj as unknown as Record<string, unknown>
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'id' || k === 'kind') continue
    if (v === null) delete t[k]
    else t[k] = v
  }
  return hit.next
}

/** 批量删对象；级联删除两端引用被删 id 的关系线 */
export function removeObjects(map: MindMap, ids: string[]): MindMap {
  const set = new Set(ids)
  const objects = map.objects ?? []
  if (!objects.some((o) => set.has(o.id))) return map
  const next = cloneMap(map)
  next.objects = next.objects!.filter((o) => {
    if (set.has(o.id)) return false
    if (o.kind === 'edge' && (set.has(o.from) || set.has(o.to))) return false
    return true
  })
  if (next.objects.length === 0) delete next.objects
  return next
}

/** 删节点时的边级联：ids 为被删节点 id，引用它们的 edge 一并删除（ADR-0003） */
export function removeEdgeRefs(map: MindMap, ids: string[]): MindMap {
  if (!map.objects?.some((o) => o.kind === 'edge' || o.kind === 'boundary' || o.kind === 'summary')) return map
  const set = new Set(ids)
  const next = cloneMap(map)
  next.objects = next.objects!.filter((o) => !(o.kind === 'edge' && (set.has(o.from) || set.has(o.to))) &&
    !((o.kind === 'boundary' || o.kind === 'summary') && set.has(o.anchor.parentId)))
  if (next.objects.length === 0) delete next.objects
  return next
}

/** 置顶/上移：向数组尾（顶层）移动一步或直达末位 */
export function raiseObject(map: MindMap, id: string, toTop = false): MindMap {
  const objects = map.objects ?? []
  const i = objects.findIndex((o) => o.id === id)
  if (i < 0 || i === objects.length - 1) return map
  const next = cloneMap(map)
  const arr = next.objects!
  const [obj] = arr.splice(i, 1)
  arr.splice(toTop ? arr.length : i + 1, 0, obj)
  return next
}

/** 置底/下移：向数组头（底层）移动一步或直达首位 */
export function lowerObject(map: MindMap, id: string, toBottom = false): MindMap {
  const objects = map.objects ?? []
  const i = objects.findIndex((o) => o.id === id)
  if (i <= 0) return map
  const next = cloneMap(map)
  const arr = next.objects!
  const [obj] = arr.splice(i, 1)
  arr.splice(toBottom ? 0 : i - 1, 0, obj)
  return next
}

function cloneMap(map: MindMap): MindMap {
  return structuredClone(map)
}
