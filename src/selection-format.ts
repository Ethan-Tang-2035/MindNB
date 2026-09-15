import { findNode, type MindMap, type NodeData, type NodeStyle } from './model.ts'
import { findObject } from './objects.ts'
import { nodeStyleDefaults } from './fonts.ts'
import { effectiveStyle } from './levels.ts'
import { pageAppearance, pageById, ownerIndex, pageNodeColors } from './paper-pages.ts'
import { resolveTheme, inkOf, paperOf } from './theme.ts'
import { nodeAppearance } from './node-presentation.ts'
import { supportsTextStyle, setTextSelectionStyle, textBoxStyle, type StylePatch } from './text-box.ts'
import { strictUniform } from './selection.ts'
import type { Measurer } from './layout.ts'

function nodeDepth(map: MindMap, id: string): number {
  function walk(node: NodeData, depth: number): number | undefined {
    if (node.id === id) return depth
    for (const child of node.children) { const found = walk(child, depth + 1); if (found !== undefined) return found }
  }
  for (const root of [map.root, ...(map.topics ?? []).map(t => t.node)]) {
    const depth = walk(root, 0); if (depth !== undefined) return depth
  }
  for (const floating of map.floating ?? []) { const depth = walk(floating.node, 1); if (depth !== undefined) return depth }
  return 2
}

/** A selection's capabilities and values have one interpretation for all format controls. */
export function selectionFormat(map: MindMap, ids: string[], visibleDepth?: (id: string) => number | undefined) {
  const supported = supportsTextStyle(map, ids)
  const hasBox = ids.some(id => findObject(map, id)?.kind === 'textBox')
  const explicitStyles = ids.map(id => {
    const object = findObject(map, id)
    return object?.kind === 'textBox' ? object.style : findNode(map, id)?.style ?? {}
  })
  let resolved: NodeStyle[] | undefined
  function styles() {
    if (resolved) return resolved
    if (!supported) return []
    const owners = ownerIndex(map), colors = pageNodeColors(map)
    resolved = ids.map(id => {
      const object = findObject(map, id), node = findNode(map, id)
      const depth = visibleDepth?.(id) ?? nodeDepth(map, id)
      const local = pageAppearance(map, pageById(map, owners.get(id)))
      const st = object?.kind === 'textBox' ? textBoxStyle(local, object) : nodeStyleDefaults(local, node?.style, depth, !!node?.children.length)
      const actualDepth = st?.layoutDepth ?? depth
      const effective = effectiveStyle(actualDepth, st)
      const theme = { ...resolveTheme(local), paper: paperOf(local), ink: inkOf(local) }
      const { shape, paint, borderColor, borderLine, borderWidth, pattern } = nodeAppearance({ style: st, contents: node?.contents }, actualDepth, local, theme, actualDepth === 0 ? theme.ink : colors.get(id) ?? theme.ink, owners.has(id))
      return { ...st, font: st?.font ?? map.font ?? 'handwritten', fontSize: effective.fontPx, bold: effective.weight >= 700,
        italic: st?.italic ?? false, align: st?.align ?? 'center', shape, color: paint.textFill, fill: paint.fill,
        borderColor, borderLine, borderWidth, fillPattern: pattern } satisfies NodeStyle
    })
    return resolved
  }
  return {
    supported, hasBox, single: supported && ids.length === 1,
    explicit<K extends keyof NodeStyle>(key: K) { return supported ? strictUniform(explicitStyles.map(style => style[key])) : undefined },
    effective<K extends keyof NodeStyle>(key: K) { return strictUniform(styles().map(style => style[key])) },
    decoration<K extends keyof NonNullable<NodeStyle['deco']>>(key: K) { return supported ? strictUniform(explicitStyles.map(style => style.deco?.[key])) : undefined },
    get shapes() { return styles().map(style => style.shape) },
    apply(patch: StylePatch, measure: Measurer) { return setTextSelectionStyle(map, ids, patch, measure) },
  }
}

export type SelectionFormat = ReturnType<typeof selectionFormat>
