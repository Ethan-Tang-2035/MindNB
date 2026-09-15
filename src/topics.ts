import { createNode, newId, findParent, setStructure, withinSubtree, type MindMap, type NodeData, type LayoutMode } from './model.ts'
import { normalizeStructure, type Structure } from './structure.ts'
import type { CanvasObject } from './objects.ts'
import { rekeyContents } from './content.ts'

export function topicOwner(map: MindMap, id: string) {
  return map.topics?.find(t => withinSubtree(map, t.node.id, id)) ?? null
}

export function createTopic(map: MindMap, x: number, y: number) {
  const node = createNode('独立主题')
  node.structure = 'right' as const // v15：新写入落节点 structure（原 layoutMode:'right' 读取等价）
  return { map: { ...map, schemaVersion: map.schemaVersion ?? 10 as const, topics: [...(map.topics ?? []), { node, x, y }] }, id: node.id }
}

export function moveTopic(map: MindMap, id: string, x: number, y: number): MindMap {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !map.topics?.some(t => t.node.id === id && (t.x !== x || t.y !== y))) return map
  return { ...map, topics: map.topics.map(t => t.node.id === id ? { ...t, x, y } : t) }
}

/** 独立主题结构（v15 迁移，票 01）：写节点 structure 并删除遗留 layoutMode（setStructure），
 * 读取经 topicStructureOf 兼容旧字段 —— 存量渲染不变；词表收 Structure（'balanced' 归一 'map'） */
export function setTopicLayout(map: MindMap, id: string, layoutMode: LayoutMode | Structure): MindMap {
  if (!map.topics?.some(t => t.node.id === id)) return map
  return setStructure(map, id, normalizeStructure(layoutMode) ?? 'right')
}

export function copyTopic(map: MindMap, id: string): { map: MindMap; id: string } {
  const topic = map.topics?.find(t => t.node.id === id)
  if (!topic) return { map, id: '' }
  const copy = structuredClone(topic)
  const ids = new Map<string, string>()
  const rekey = (n: NodeData) => { const old = n.id; n.id = newId(); ids.set(old, n.id); rekeyContents(n); n.children.forEach(rekey) }
  rekey(copy.node)
  copy.x += 80
  copy.y += 80
  const objects = (map.objects ?? []).flatMap<CanvasObject>(o => {
    if (o.kind === 'edge' && ids.has(o.from) && ids.has(o.to)) return [{ ...structuredClone(o), id: newId(), from: ids.get(o.from)!, to: ids.get(o.to)! }]
    if ((o.kind === 'boundary' || o.kind === 'summary') && ids.has(o.anchor.parentId)) return [{ ...structuredClone(o), id: newId(), anchor: { ...o.anchor, parentId: ids.get(o.anchor.parentId)! } }]
    return []
  })
  return { map: { ...map, topics: [...(map.topics ?? []), copy], ...(objects.length ? { objects: [...(map.objects ?? []), ...objects] } : {}) }, id: copy.node.id }
}

/** Copy an ordinary branch beside its source, with independently owned content. */
export function copyNode(map: MindMap, id: string): { map: MindMap; id: string } {
  if (!findParent(map, id)) return { map, id: '' }
  const next = structuredClone(map), parent = findParent(next, id)!
  const index = parent.children.findIndex(n => n.id === id)
  const copy = structuredClone(parent.children[index])
  const rekey = (n: NodeData) => { n.id = newId(); rekeyContents(n); n.children.forEach(rekey) }
  rekey(copy); parent.children.splice(index + 1, 0, copy)
  return { map: next, id: copy.id }
}
