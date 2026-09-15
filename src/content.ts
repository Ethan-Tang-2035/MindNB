import { findNode, forestRoots, newId, type MindMap, type NodeData } from './model.ts'
import { findObject, newSeed, type CanvasObject, type TableObject, type CycleObject, type FlowObject, type TimelineObject, type PyramidObject, type CircleMapObject } from './objects.ts'
import { flowSize, timelineSize, pyramidSize, circleMapSize } from './content-render.ts'

export type Content = Extract<CanvasObject, { kind: 'image' | 'sticker' | 'table' | 'cycle' | 'flow' | 'timeline' | 'pyramid' | 'circleMap' | 'ink' }>

export function isContent(object: CanvasObject | null | undefined): object is Content {
  return !!object && ['image', 'sticker', 'table', 'cycle', 'flow', 'timeline', 'pyramid', 'circleMap', 'ink'].includes(object.kind)
}

export function allNodes(map: MindMap): NodeData[] {
  const visit = (n: NodeData): NodeData[] => [n, ...n.children.flatMap(visit)]
  return forestRoots(map).flatMap(visit)
}

export function findContent(map: MindMap, id: string): { content: Content; owner: NodeData | null } | null {
  const object = findObject(map, id)
  if (isContent(object)) return { content: object, owner: null }
  for (const node of allNodes(map)) {
    const content = node.contents?.find(c => c.id === id)
    if (content) return { content, owner: node }
  }
  return null
}

export function insertContent(map: MindMap, content: Content, nodeId: string | null): MindMap {
  if (findContent(map, content.id)) return map
  if (nodeId && !findNode(map, nodeId)) return map
  const next = structuredClone(map)
  next.schemaVersion = map.schemaVersion === 12 ? 12 : 11
  const node = nodeId ? findNode(next, nodeId) : null
  if (node) node.contents = [...(node.contents ?? []), structuredClone(content)]
  else next.objects = [...(next.objects ?? []), structuredClone(content)]
  return next
}

export function updateContent(map: MindMap, id: string, edit: (content: Content) => void): MindMap {
  if (!findContent(map, id)) return map
  const next = structuredClone(map)
  edit(findContent(next, id)!.content)
  return next
}

export function removeContent(map: MindMap, id: string): MindMap {
  const hit = findContent(map, id)
  if (!hit) return map
  const next = structuredClone(map)
  if (hit.owner) {
    const owner = findNode(next, hit.owner.id)!
    owner.contents = owner.contents!.filter(c => c.id !== id)
  } else next.objects = (next.objects ?? []).filter(o => o.id !== id && !(o.kind === 'edge' && (o.from === id || o.to === id)))
  return next
}

export function transferContent(map: MindMap, id: string, targetId: string | null, position = { x: 0, y: 0 }): MindMap {
  const hit = findContent(map, id)
  if (!hit || hit.owner?.id === targetId || (!hit.owner && !targetId) || (targetId && !findNode(map, targetId))) return map
  const next = structuredClone(map)
  const content = findContent(next, id)!.content
  if (hit.owner) {
    const owner = findNode(next, hit.owner.id)!
    owner.contents = owner.contents!.filter(c => c.id !== id)
  } else next.objects = (next.objects ?? []).filter(o => o.id !== id)
  if (targetId) {
    const target = findNode(next, targetId)!
    target.contents = [...(target.contents ?? []), content]
    next.objects = (next.objects ?? []).flatMap<CanvasObject>(o => {
      if (o.kind !== 'edge') return [o]
      const edge = { ...o, from: o.from === id ? targetId : o.from, to: o.to === id ? targetId : o.to }
      return edge.from === edge.to ? [] : [edge]
    })
  } else next.objects = [...(next.objects ?? []), { ...content, ...position }]
  return next
}

export { rekeyContents } from './content-identity.ts'

export function createTable(x = 0, y = 0): TableObject {
  return { id: newId(), seed: newSeed(), kind: 'table', x, y, w: 360, h: 120, cells: [['项目', '负责人', '进度'], ['事项一', '', '进行中'], ['事项二', '', '待开始']], columnWidths: [120, 120, 120], header: true, fills: {} }
}

export function createCycle(x = 0, y = 0): CycleObject {
  return { id: newId(), seed: newSeed(), kind: 'cycle', x, y, w: 320, h: 260, steps: ['计划', '执行', '检查'].map(text => ({ id: newId(), text })), clockwise: true, color: '#37956f', sketch: true }
}

/** 流程图（词汇见 CONTEXT.md「流程图」）：默认 3 步「准备/执行/复盘」横向；颜色缺省同循环图绿 */
export function createFlow(x = 0, y = 0): FlowObject {
  const flow: FlowObject = { id: newId(), seed: newSeed(), kind: 'flow', x, y, w: 0, h: 0, steps: ['准备', '执行', '复盘'].map(text => ({ id: newId(), text })), direction: 'right', color: '#37956f', sketch: true }
  return Object.assign(flow, flowSize(flow))
}

/** 时间轴（词汇见 CONTEXT.md「时间轴」）：默认 3 个时刻「开始/推进/交付」，时间标注留空，横向 */
export function createTimeline(x = 0, y = 0): TimelineObject {
  const timeline: TimelineObject = { id: newId(), seed: newSeed(), kind: 'timeline', x, y, w: 0, h: 0, items: ['开始', '推进', '交付'].map(text => ({ id: newId(), time: '', text })), direction: 'right', color: '#37956f', sketch: true }
  return Object.assign(timeline, timelineSize(timeline))
}

/** 金字塔图（词汇见 CONTEXT.md「金字塔图」）：默认自底向上「基础/方法/目标」3 层 */
export function createPyramid(x = 0, y = 0): PyramidObject {
  const pyramid: PyramidObject = { id: newId(), seed: newSeed(), kind: 'pyramid', x, y, w: 0, h: 0, items: ['基础', '方法', '目标'].map(text => ({ id: newId(), text })), color: '#37956f', sketch: true }
  return Object.assign(pyramid, pyramidSize(pyramid))
}

/** 圆圈图（词汇见 CONTEXT.md「圆圈图」）：默认中心「主题」+ 联想一～联想四 */
export function createCircleMap(x = 0, y = 0): CircleMapObject {
  const circle: CircleMapObject = { id: newId(), seed: newSeed(), kind: 'circleMap', x, y, w: 0, h: 0, center: { id: newId(), text: '主题' }, items: ['联想一', '联想二', '联想三', '联想四'].map(text => ({ id: newId(), text })), color: '#37956f', sketch: true }
  return Object.assign(circle, circleMapSize(circle))
}

/** 术语表（词汇见 CONTEXT.md「术语表」）：表格的「词条＋解释」两列预设——零新机制，只换一组默认 cells */
export function createGlossaryTable(x = 0, y = 0): TableObject {
  return { ...createTable(x, y), cells: [['词条', '解释'], ['词条一', ''], ['词条二', '']], columnWidths: [110, 250] }
}
