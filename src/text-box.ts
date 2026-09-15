import { findNode, newId, setNodesStyle, resetConversionWrapping, type MindMap, type NodeStyle } from './model.ts'
import { findObject, newSeed, type TextBoxObject } from './objects.ts'
import { textBoxSize, type LaidNode, type Measurer } from './layout.ts'
import { inkOf, resolveTheme, usesClearStyle } from './theme.ts'

export const TEXT_BOX_DEFAULTS: NodeStyle = { layoutDepth: 2, shape: 'none', fontSize: 20, size: 'm', align: 'left', fillPattern: 'none', borderLine: 'solid', borderWidth: 2.4 }
export type StylePatch = { [K in keyof NodeStyle]?: NodeStyle[K] | null }

export function textBoxStyle(map: MindMap, box: TextBoxObject): NodeStyle {
  return { ...TEXT_BOX_DEFAULTS, ...(usesClearStyle(map) ? { visualStyle: 'clear' as const } : {}), font: map.font,
    fill: resolveTheme(map).rootFill, borderColor: inkOf(map), ...box.style, width: box.style.width ?? box.w }
}

export function layoutTextBox(map: MindMap, box: TextBoxObject, measure: Measurer): LaidNode {
  const style = textBoxStyle(map, box), depth = style.layoutDepth ?? 2
  const size = textBoxSize(box.text, depth, measure, style)
  return { id: box.id, node: { id: box.id, seed: box.seed, text: box.text, children: [], style }, depth,
    side: 'right', branchIndex: -1, x: box.x, y: box.y, ...size }
}

export function createTextBox(map: MindMap, x: number, y: number, measure: Measurer, text = ''): { map: MindMap; id: string } {
  const box: TextBoxObject = { id: newId(), seed: newSeed(), kind: 'textBox', text, x, y, w: 240, h: 40,
    style: { ...TEXT_BOX_DEFAULTS, width:240, ...(usesClearStyle(map) ? { visualStyle: 'clear' as const } : {}) } }
  const laid = layoutTextBox(map, box, measure); box.w = laid.w; box.h = laid.h
  return { map: { ...map, objects: [...(map.objects ?? []), box] }, id: box.id }
}

export function reflowTextBoxes(map: MindMap, measure: Measurer): MindMap {
  let changed = false
  const objects = map.objects?.map(box => {
    if (box.kind !== 'textBox') return box
    const { w, h } = layoutTextBox(map, box, measure)
    if (Math.abs(box.w - w) < .01 && Math.abs(box.h - h) < .01) return box
    changed = true; return { ...box, w, h }
  })
  return changed ? { ...map, objects } : map
}

export function editTextBox(map: MindMap, id: string, patch: { text?: string; w?: number }, measure: Measurer): MindMap {
  if (findObject(map, id)?.kind !== 'textBox' || (patch.w !== undefined && !Number.isFinite(patch.w))) return map
  const next = { ...map, objects: map.objects!.map(o => o.id === id ? { ...o, ...patch, ...(patch.w === undefined ? {} : { w: Math.min(600, Math.max(60, patch.w)), style:{ ...(o.kind==='textBox'?o.style:{}),width:Math.min(600,Math.max(60,patch.w)),wrapWidth:undefined } }) } : o) }
  return reflowTextBoxes(next, measure)
}

export function supportsTextStyle(map: MindMap, ids: string[]): boolean {
  return !!ids.length && ids.every(id => !!findNode(map, id) || findObject(map, id)?.kind === 'textBox')
}

/** Atomic intersection: never silently update only part of a heterogeneous selection. */
export function setTextSelectionStyle(map: MindMap, ids: string[], patch: StylePatch, measure: Measurer): MindMap {
  if (!supportsTextStyle(map, ids) || patch.backdrop && ids.some(id=>findObject(map,id)?.kind==='textBox')) return map
  let next = setNodesStyle(map, ids.filter(id => !!findNode(map, id)), patch)
  const chosen = new Set(ids)
  next = { ...next, objects: next.objects?.map(o => {
    if (o.kind !== 'textBox' || !chosen.has(o.id)) return o
    const style = { ...o.style }
    resetConversionWrapping(style,patch)
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete (style as Record<string, unknown>)[key]
      else if (value !== undefined) (style as Record<string, unknown>)[key] = value
    }
    return { ...o, style, ...(patch.width === undefined ? {} : { w: patch.width ?? 240 }) }
  }) }
  return reflowTextBoxes(next, measure)
}

export function duplicateTextBox(map: MindMap, id: string): { map: MindMap; id: string } {
  const box = findObject(map, id)
  if (box?.kind !== 'textBox') return { map, id: '' }
  const copy = { ...structuredClone(box), id: newId(), x: box.x + 24, y: box.y + 24 }
  return { map: { ...map, objects: [...(map.objects ?? []), copy], pages: map.pages?.map(p => p.members.includes(id) ? { ...p, members: [...p.members, copy.id] } : p) }, id: copy.id }
}

export function validTextBox(v: unknown): v is TextBoxObject {
  if (!v || typeof v !== 'object') return false
  const o = v as TextBoxObject, s = o.style
  if (o.kind !== 'textBox' || typeof o.id !== 'string' || !o.id || typeof o.text !== 'string' || !Number.isFinite(o.seed)
    || ![o.x, o.y, o.w, o.h].every(Number.isFinite) || o.w <= 0 || o.w > 2000 || o.h <= 0 || !s || typeof s !== 'object' || Array.isArray(s)) return false
  // Measured legacy nodes can be smaller than a newly resized text box.
  if (o.w < 60 && !(Number.isFinite(s.wrapWidth) && s.wrapWidth! > 0 && Number.isFinite(s.width) && s.width! > 0)) return false
  const oneOf = (v: unknown, values: unknown[]) => v === undefined || values.includes(v)
  if (!oneOf(s.font, ['handwritten','sans','serif','mono']) || !oneOf(s.layoutDepth,[0,1,2]) || !oneOf(s.size,['s','m','l','xl'])
    || !oneOf(s.shape,['none','ellipse','rounded','underline','cloud','bubble','burst','banner','dashed'])
    || !oneOf(s.align,['left','center','right']) || !oneOf(s.borderLine,['solid','dashed','dotted','double'])
    || !oneOf(s.visualStyle,['clear']) || s.backdrop !== undefined
    || !oneOf(s.fillPattern,['solid','none','marker','hatchMarker','hatchPencil','hThick','hThin'])) return false
  for (const key of ['fontSize','borderWidth','width','wrapWidth'] as const) if (s[key] !== undefined && (!Number.isFinite(s[key]) || s[key]! < 0 || s[key]! > 2000)) return false
  for (const key of ['color','fill','borderColor'] as const) if (s[key] !== undefined && typeof s[key] !== 'string') return false
  for (const key of ['bold','italic'] as const) if (s[key] !== undefined && typeof s[key] !== 'boolean') return false
  return s.deco === undefined || (!!s.deco && typeof s.deco === 'object' && !Array.isArray(s.deco))
}
