import { usesClearStyle } from './theme.ts'
import type { MindMap, NodeData, NodeStyle } from './model.ts'
import type { CanvasObject } from './objects.ts'

export type FontId = 'handwritten' | 'sans' | 'serif' | 'mono'
export const FONTS: Array<{ id: FontId; name: string; family: string }> = [
  { id: 'handwritten', name: '手写 · 霞鹜文楷', family: 'LXGW WenKai' },
  { id: 'sans', name: '黑体 · Noto Sans SC', family: 'Mind Sans SC' },
  { id: 'serif', name: '宋体 · Noto Serif SC', family: 'Mind Serif SC' },
  { id: 'mono', name: '等宽 · Noto Mono SC', family: 'Mind Mono SC' },
]
export function fontStack(id: FontId = 'handwritten'): string {
  const family = FONTS.find(f => f.id === id)?.family ?? FONTS[0].family
  return `"${family}", ${id === 'mono' ? 'monospace' : id === 'sans' ? 'sans-serif' : 'serif'}`
}

export function nodeStyleDefaults(map: MindMap, style?: NodeStyle, depth = 0, hasChildren = false): NodeStyle | undefined {
  if (!map.font && !map.nodeBorderLine && !map.nodeBorderWidth && !usesClearStyle(map) && !map.levelFontSizes) return style
  return {
    ...(usesClearStyle(map) ? { visualStyle: 'clear' as const, ...(depth >= 2 && hasChildren ? { shape: 'rounded' as const } : {}) } : {}),
    fontSize: map.levelFontSizes?.[Math.min(2, depth)],
    fillPattern: map.nodeFillPattern,
    font: map.font, borderLine: map.nodeBorderLine, borderWidth: map.nodeBorderWidth, ...style,
  }
}

/** 图表内文字采样（字体预载用）：按 kind 收集条目文字 */
function contentTexts(c: CanvasObject): string[] {
  if (c.kind === 'table') return c.cells.flat()
  if (c.kind === 'cycle') return c.steps.map(s => s.text)
  if (c.kind === 'flow') return c.steps.map(s => s.text)
  if (c.kind === 'timeline') return c.items.map(s => `${s.time}${s.text}`)
  if (c.kind === 'pyramid') return c.items.map(s => s.text)
  if (c.kind === 'circleMap') return [c.center.text, ...c.items.map(s => s.text)]
  return []
}

export async function loadMapFonts(map: MindMap): Promise<void> {
  const text = new Map<FontId, string>()
  const visit = (n: NodeData) => {
    const id = n.style?.font ?? map.font ?? 'handwritten'
    const extra = (n.contents ?? []).flatMap(contentTexts)
    text.set(id, (text.get(id) ?? '') + n.text + extra.join(''))
    n.children.forEach(visit)
  }
  ;[map.root, ...(map.floating ?? []).map(f => f.node), ...(map.topics ?? []).map(t => t.node)].forEach(visit)
  for (const box of map.objects ?? []) if (box.kind === 'textBox') { const id = box.style.font ?? map.font ?? 'handwritten'; text.set(id, (text.get(id) ?? '') + box.text) }
  const independent = (map.objects ?? []).flatMap(contentTexts).join('')
  const id = map.font ?? 'handwritten'
  text.set(id, (text.get(id) ?? '') + independent)
  await Promise.all([...text].map(([id, sample]) => document.fonts.load(`400 20px "${(FONTS.find(f => f.id === id) ?? FONTS[0]).family}"`, sample || '中文Aa')))
}
