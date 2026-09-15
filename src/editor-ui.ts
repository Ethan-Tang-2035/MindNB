import type { Content } from './content.ts'
import type { Rect } from './layout.ts'
import type { SelectionModel } from './selection.ts'

export function feedbackFor(id: string, selected: SelectionModel, editing: string | null = null, source: string | null = null, target: string | null = null) {
  if (id === editing) return 'editing'
  if (id === source) return 'source'
  if (id === target) return 'target'
  if (id === selected.primary) return 'primary'
  return selected.ids.includes(id) ? 'selected' : 'idle'
}

export function toolbarPosition(node: Rect, width: number, height: number, obstacles: Rect[] = [], toolbarWidth = 240, toolbarHeight = 40): { x: number; y: number } | null {
  const x = Math.max(8, Math.min(width - toolbarWidth - 8, node.x + node.w / 2 - toolbarWidth / 2))
  const y = node.y - 52 >= 64 ? node.y - 52 : node.y + node.h + 12
  const candidates = [{ x, y: Math.max(64, Math.min(height - 56, y)) },
    { x, y: node.y + node.h + 12 }, { x: node.x + node.w + 12, y: node.y + node.h / 2 - 20 },
    { x: node.x - toolbarWidth - 12, y: node.y + node.h / 2 - 20 },
    ...Array.from({ length: 4 }, (_, i) => ({ x, y: node.y - 100 - i * 48 })),
    ...Array.from({ length: 4 }, (_, i) => ({ x, y: node.y + node.h + 60 + i * 48 }))]
  return candidates.find(p => p.x >= 8 && p.x + toolbarWidth <= width - 8 && p.y >= 64 && p.y + toolbarHeight <= height - 8 &&
    !obstacles.some(b => p.x < b.x + b.w + 6 && p.x + toolbarWidth > b.x - 6 && p.y < b.y + b.h + 6 && p.y + toolbarHeight > b.y - 6)) ?? null
}

/** 图表中文名（词汇见 CONTEXT.md「图表」「条目」）：面板标题/内容卡片/编辑器对话框共用的单一事实源 */
export const CONTENT_NAMES: Record<Content['kind'], string> = {
  image: '图片', sticker: '贴纸', table: '表格', cycle: '循环图',
  flow: '流程图', timeline: '时间轴', pyramid: '金字塔图', circleMap: '圆圈图', ink: '手绘笔迹',
}

export type PanelContext = 'canvas' | 'textBox' | 'node' | 'edge' | 'image' | 'sticker' | 'group' | 'boundary' | 'summary' | 'mixed' | 'table' | 'cycle' | 'flow' | 'timeline' | 'pyramid' | 'circleMap' | 'ink'
export function panelContext(kinds: Exclude<PanelContext, 'canvas' | 'mixed'>[]): PanelContext {
  if (!kinds.length) return 'canvas'
  return kinds.every(k => k === kinds[0]) ? kinds[0] : 'mixed'
}
