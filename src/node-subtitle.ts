import type { NodeData } from './model.ts'
import type { Rect } from './layout.ts'
import { effectiveStyle } from './levels.ts'

/** A short secondary line stays attached to the title, including during layout changes. */
export function subtitleGeometry(node: NodeData, box: Rect, depth: number, titleLines = 1, measure?: (text: string, fontPx: number) => number) {
  if (!node.subtitle) return undefined
  const s = effectiveStyle(depth, node.style), fontPx = Math.round(s.fontPx * 0.55)
  let text = node.subtitle.replace(/\s+/g, ' ')
  if (measure && measure(text, fontPx) > box.w - 24) {
    const chars = [...text]
    while (chars.length && measure(chars.join('') + '…', fontPx) > box.w - 24) chars.pop()
    text = chars.join('') + '…'
  }
  return { text, fontPx, titleBox: { ...box, y: box.y - fontPx * 0.7 }, x: box.x + box.w / 2, y: box.y + box.h / 2 + s.lineH * titleLines / 2 + fontPx * 0.45 }
}
