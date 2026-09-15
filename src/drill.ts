import { effectiveStructureOf, findNode, withinSubtree, type MindMap, type NodeData } from './model.ts'
import type { SelectionModel } from './selection.ts'
import type { View } from './render.ts'

export interface DrillViewport { width: number; height: number }

export interface DrillFrame {
  id: string
  /** Relative offsets follow the document-view contract; absolute views are legacy snapshots. */
  view: { dx: number; dy: number; k: number } | View
  selection: SelectionModel
}

export function enterDrill(map: MindMap, frames: DrillFrame[], id: string, view: View, selection: SelectionModel, viewport: DrillViewport): DrillFrame[] {
  const focus = frames.at(-1)?.id
  if (frames.length >= 3 || !findNode(map, id) || focus === id || (focus && !withinSubtree(map, focus, id))) return frames
  const stored = { dx: view.tx + viewport.width / 2 * (view.k - 1), dy: view.ty + viewport.height / 2 * (view.k - 1), k: view.k }
  return [...frames, { id, view: stored, selection: structuredClone(selection) }]
}

export function returnDrill(frames: DrillFrame[], level: number, viewport: DrillViewport) {
  const frame = frames[level]
  if (!frame || level < 0) return null
  const stored = frame.view
  const view = 'dx' in stored ? { tx: stored.dx - viewport.width / 2 * (stored.k - 1), ty: stored.dy - viewport.height / 2 * (stored.k - 1), k: stored.k } : { ...stored }
  return { frames: frames.slice(0, level), view, selection: structuredClone(frame.selection) }
}

export function reconcileDrill(map: MindMap, frames: DrillFrame[], viewport: DrillViewport) {
  const invalid = frames.findIndex((f, i) => !findNode(map, f.id) || (i > 0 && !withinSubtree(map, frames[i - 1].id, f.id)))
  return invalid < 0 ? null : returnDrill(frames, invalid, viewport)
}

export function scopedMap(map: MindMap, focus?: string | null): MindMap {
  const node = focus ? findNode(map, focus) : null
  if (!node) return map
  const ids = new Set<string>()
  const walk = (n: NodeData) => { ids.add(n.id); n.children.forEach(walk) }
  walk(node)
  // v15 票 01：把「下钻根的生效结构」（最近显式祖先，含独立主题遗留 layoutMode）物化为子图文档默认，
  // 等价旧 owner?.layoutMode ?? map.layoutMode —— 存量渲染不变
  return { ...map, root: node, pages: undefined, rootPosition: undefined, layoutMode: effectiveStructureOf(map, node.id),
    topics: [], floating: [], objects: (map.objects ?? []).filter(o => {
      if (o.kind === 'edge') return ids.has(o.from) && ids.has(o.to)
      if (o.kind === 'boundary' || o.kind === 'summary') return ids.has(o.anchor.parentId)
      return false
    }) }
}

export function validDrillFrames(value: unknown): value is DrillFrame[] {
  return Array.isArray(value) && value.length <= 3 && value.every(f => f && typeof f.id === 'string' && f.view && typeof f.view === 'object' &&
    ('dx' in f.view ? [f.view.dx, f.view.dy, f.view.k] : [f.view.tx, f.view.ty, f.view.k]).every(Number.isFinite) && f.view.k > 0 && Array.isArray(f.selection?.ids) && f.selection.ids.every((id: unknown) => typeof id === 'string') &&
    (f.selection.primary === null || f.selection.ids.includes(f.selection.primary)))
}
