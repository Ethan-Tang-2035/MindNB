import { createFloating, findNode, newId, type MindMap } from './model.ts'
import { addObject, findObject, newSeed } from './objects.ts'

export type ConnectionState = { from: string | null } | null
export interface ConnectionResult { map: MindMap; state: ConnectionState; selected?: string }

/** 可作关系线端点的独立内容 kind（词汇见 CONTEXT.md「关系线端点」）：图表整图可接，图表条目不可 */
const ENDPOINT_KINDS = new Set(['textBox', 'image', 'sticker', 'table', 'cycle', 'flow', 'timeline', 'pyramid', 'circleMap', 'ink'])

export function isEndpoint(map: MindMap, id: string): boolean {
  const obj = findObject(map, id)
  return !!findNode(map, id) || (obj !== null && ENDPOINT_KINDS.has(obj.kind))
}

export function beginConnection(map: MindMap, selected: string[]): ConnectionResult {
  const ids = [...new Set(selected)].filter(id => isEndpoint(map, id))
  if (ids.length === 2) return connectTo(map, { from: ids[0] }, ids[1])
  return { map, state: { from: ids.length === 1 ? ids[0] : null } }
}

export function reconnectEdge(map: MindMap, id: string, end: 'from' | 'to', target: string): MindMap {
  const edge = findObject(map, id)
  if (edge?.kind !== 'edge' || !isEndpoint(map, target) || edge[end] === target || edge[end === 'from' ? 'to' : 'from'] === target) return map
  const next = structuredClone(map)
  const obj = next.objects!.find(o => o.id === id)!
  if (obj.kind === 'edge') obj[end] = target
  return next
}

export function connectTo(map: MindMap, state: ConnectionState, target: string | null, blank?: { x: number; y: number }): ConnectionResult {
  if (!state || (state.from && !isEndpoint(map, state.from))) return { map, state: null }
  if (target && (!isEndpoint(map, target) || target === state.from)) return { map, state }
  if (!state.from) return { map, state: { from: target } }
  let next = map
  if (!target) {
    if (!blank) return { map, state }
    const added = createFloating(map, blank.x, blank.y)
    next = added.map
    target = added.id
  }
  const id = newId()
  return { map: addObject(next, { id, kind: 'edge', seed: newSeed(), from: state.from, to: target }), state: null, selected: id }
}
