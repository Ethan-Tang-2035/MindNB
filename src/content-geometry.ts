import type { NodeData } from './model.ts'
import type { Size } from './layout.ts'
import type { Content } from './content.ts'

export function contentSize(content: Content): Size {
  return content.kind === 'sticker' ? { w: content.size, h: content.size } : { w: content.w, h: content.h }
}

export const isOverlay = (c: Content) => (c.kind === 'image' || c.kind === 'sticker') && c.placement === 'overlay'

export function journalMediaSize(node: NodeData): Size {
  const items = (node.contents ?? []).filter(c => !isOverlay(c)).map(contentSize)
  return { w: Math.max(0, ...items.map(i => i.w)), h: items.reduce((h, i) => h + i.h, 0) + Math.max(0, items.length - 1) * 12 }
}

export function embeddedLayout(node: NodeData, text: Size) {
  const iconWidth = node.icon ? (node.icon.size ?? 24) + 12 : 0
  const rawText = text
  text = { w: text.w + iconWidth, h: Math.max(text.h, node.icon?.size ?? 0) }
  const overlays = (node.contents ?? []).filter(isOverlay).map(content => ({ content, box: { x: content.x, y: content.y, ...contentSize(content) } }))
  const contents = (node.contents ?? []).filter(c => !isOverlay(c))
  if (!contents.length) return { size: text, text: { x: iconWidth, y: 0, w: rawText.w, h: text.h }, items: overlays }
  const gap = 12, padding = 16
  const items = contents.map(content => {
    const size = contentSize(content)
    // 嵌入缩放钳位：图表类（table/cycle/flow 及后续时间轴/金字塔图/圆圈图）高度上限 600，图片/贴纸/笔迹 260（v11 决策）
    const clampH = content.kind !== 'image' && content.kind !== 'sticker' && content.kind !== 'ink' ? 600 : 260
    const scale = content.kind === 'image' || content.kind === 'sticker' ? 1 : Math.min(1, 360 / Math.max(1, size.w), clampH / Math.max(1, size.h))
    return { content, box: { x: 0, y: 0, w: size.w * scale, h: size.h * scale } }
  })
  const mediaW = Math.max(...items.map(i => i.box.w))
  const mediaH = items.reduce((h, i) => h + i.box.h, 0) + gap * (items.length - 1)
  if (node.structure === 'journal') {
    let y = text.h + 16
    for (const item of items) { item.box.y = y; y += item.box.h + gap }
    return { size: text, text: { x: iconWidth, y: 0, w: rawText.w, h: text.h }, items: [...items, ...overlays] }
  }
  const horizontal = node.contentLayout === 'left' || node.contentLayout === 'right'
  const size = horizontal
    ? { w: text.w + mediaW + gap + padding * 2, h: Math.max(text.h, mediaH) + padding * 2 }
    : { w: Math.max(text.w, mediaW) + padding * 2, h: text.h + mediaH + gap + padding * 2 }
  const before = node.contentLayout === 'above' || node.contentLayout === 'left'
  const textBox = horizontal
    ? { x: padding + (before ? mediaW + gap : 0), y: (size.h - text.h) / 2, ...text }
    : { x: (size.w - text.w) / 2, y: padding + (before ? mediaH + gap : 0), ...text }
  const mediaX = horizontal ? padding + (before ? 0 : text.w + gap) : (size.w - mediaW) / 2
  let mediaY = horizontal ? (size.h - mediaH) / 2 : padding + (before ? 0 : text.h + gap)
  for (const item of items) {
    item.box.x = mediaX + (mediaW - item.box.w) / 2
    item.box.y = mediaY
    mediaY += item.box.h + gap
  }
  return { size, text: { ...textBox, x: textBox.x + iconWidth, w: rawText.w }, items: [...items, ...overlays] }
}
