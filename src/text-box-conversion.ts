import { findNode, type MindMap, type NodeStyle } from './model.ts'
import { findObject, type TextBoxObject } from './objects.ts'
import { computeWorldLayout } from './layout.ts'
import type { Measurer, LaidNode } from './layout.ts'
import { effectiveShape, effectiveStyle } from './levels.ts'
import { layoutTextBox } from './text-box.ts'
import { nodePaint } from './render.ts'
import { inkOf, paperOf, resolveTheme, fillPatternOf, borderColorOf } from './theme.ts'
import { pageAppearance, pageNodeColors } from './paper-pages.ts'
import { ownerIndex, pageById } from './paper-pages.ts'

export function textBoxConversionReason(map: MindMap, id: string): string | null {
  if (findObject(map, id)?.kind === 'textBox') return null
  const n = findNode(map, id)
  if (!n) return '请选择文本框或游离节点'
  if (!map.floating?.some(f => f.node.id === id)) return '仅无父节点的游离节点可转为文本框'
  if (n.children.length) return '此节点仍有子节点，请先处理子树'
  const names: Record<string,string> = { subtitle:'副标题', note:'注释', icon:'节点图标', contents:'内嵌内容', contentLayout:'内嵌排版', structure:'结构预设', sideOverride:'侧别预设', collapsed:'折叠状态' }
  for (const [key,value] of Object.entries(n)) {
    if (['id','text','seed','style','children'].includes(key) || value === undefined || value === false || value === '' || Array.isArray(value) && !value.length) continue
    return `此节点包含${names[key] ?? (key.startsWith('branch') ? '分支预设' : '节点专属信息')}，转换前请先处理`
  }
  if (n.style?.backdrop) return '此节点包含手绘底色，转换前请先清除'
  return null
}

function frozenStyle(map: MindMap, n: LaidNode): NodeStyle {
  const local = pageAppearance(map, pageById(map, ownerIndex(map).get(n.id)))
  const theme = { ...resolveTheme(local), ink: inkOf(local), paper: paperOf(local) }
  const depth = n.node.style?.layoutDepth ?? n.depth
  const shape = effectiveShape(depth, n.node.style)
  const color = pageNodeColors(map).get(n.id) ?? theme.ink
  const paint = nodePaint(shape, depth, n.node.style, color, theme, ownerIndex(map).has(n.id))
  return { ...n.node.style, layoutDepth: Math.min(2, depth) as 0|1|2, shape, align:n.node.style?.align ?? 'center',
    font: n.node.style?.font ?? map.font ?? 'handwritten',
    fontSize: effectiveStyle(depth, { ...n.node.style, size:'m' }).fontPx,
    width: n.node.style?.width ?? n.w, wrapWidth:effectiveStyle(depth,n.node.style).maxTextW, color: paint.textFill, fill: paint.fill,
    borderColor: borderColorOf(n.node.style, local) ?? paint.stroke,
    borderWidth: n.node.style?.borderWidth ?? (n.node.style?.visualStyle === 'clear' && depth === 0 ? 2.8 : 2.4),
    fillPattern: fillPatternOf(n.node.style, local) }
}

/** Keep identity stable so page membership and every relationship remain intact. */
export function convertTextIdentity(map: MindMap, id: string, measure: Measurer): { map: MindMap; reason: string | null } {
  const reason = textBoxConversionReason(map,id)
  if (reason) return { map, reason }
  const object = findObject(map,id), next = structuredClone(map)
  const owners = ownerIndex(map), colors = pageNodeColors(map)
  for (const edge of next.objects ?? []) if (edge.kind === 'edge' && edge.from === id && edge.color === undefined) {
    const local = pageAppearance(map,pageById(map,owners.get(edge.id)))
    edge.color = findNode(map,id) ? colors.get(id) ?? inkOf(local) : inkOf(local)
  }
  if (object?.kind === 'textBox') {
    const local = pageAppearance(map,pageById(map,owners.get(id)))
    const n = layoutTextBox(local,object,measure)
    next.objects = next.objects!.filter(o => o.id !== id)
    next.floating = [...(next.floating ?? []), { x:object.x,y:object.y,node:{ id,seed:object.seed,text:object.text,children:[],style:frozenStyle(map,n) } }]
  } else {
    const n = computeWorldLayout(map,measure).nodes.find(n=>n.id===id)!
    const box:TextBoxObject = { kind:'textBox',id,seed:n.node.seed,text:n.node.text,x:n.x,y:n.y,w:n.w,h:n.h,style:frozenStyle(map,n) }
    next.floating = next.floating!.filter(f=>f.node.id!==id)
    next.objects = [...(next.objects ?? []),box]
  }
  return { map: next, reason:null }
}
