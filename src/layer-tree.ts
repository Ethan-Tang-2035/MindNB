import { forestRoots, type MindMap, type NodeData } from './model.ts'
import { ownerIndex } from './paper-pages.ts'
import { CONTENT_NAMES } from './editor-ui.ts'

export interface LayerEntry { id: string; label: string; kind: string; children: LayerEntry[] }
export interface LayerGroup { id: string; label: string; page: boolean; children: LayerEntry[] }
export function layerGroups(map: MindMap): LayerGroup[] {
  const owners = ownerIndex(map)
  const groups: LayerGroup[] = (map.pages ?? []).map((p, i) => ({ id: p.id, label: `${String(i + 1).padStart(2, '0')}  ${p.name}`, page: true, children: [] }))
  const outside: LayerGroup = { id: 'outside', label: '页外内容', page: false, children: [] }
  groups.push(outside)
  const byId = new Map(groups.map(g => [g.id, g]))
  const add = (entry: LayerEntry) => (byId.get(owners.get(entry.id) ?? '') ?? outside).children.push(entry)
  const node = (n: NodeData): LayerEntry => ({ id: n.id, label: n.text || '未命名节点', kind: 'node', children: n.children.map(node) })
  forestRoots(map).forEach(n => add(node(n)))
  const names: Record<string, string> = { ...CONTENT_NAMES, textBox: '文本框', edge: '关系线', boundary: '外框', summary: '概要', group: '分组框' }
  for (const o of map.objects ?? []) {
    const detail = 'text' in o ? o.text : 'label' in o ? o.label : o.kind === 'table' ? o.cells[0]?.join(' · ') : ''
    add({ id: o.id, label: detail ? `${names[o.kind]} · ${detail}` : names[o.kind] ?? o.kind, kind: o.kind, children: [] })
  }
  return groups
}
