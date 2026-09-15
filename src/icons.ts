import { createElement, GitFork, Images, StickyNote, Waypoints, House, Undo2, Redo2, Plus, CornerDownLeft, Focus, Ellipsis,
  Download, PanelRight, ListTree, Map, Image, Sticker, SquareDashed, Group, Braces, Shapes,
  Table, IterationCw, Workflow, ChartGantt, Triangle, CircleDot, BookA, PenLine,
  Signature, MousePointer2, Pencil, Highlighter, Eraser, SquareDashedMousePointer, Import, ChevronDown,
  X, Bold, Italic, List, Link, Copy, ClipboardPaste, Paintbrush, TextCursorInput, ListCollapse, Trash2, History, Minus, Maximize, ChevronUp,
  Check, ArrowUp, ArrowDown, ArrowUpDown, ArrowLeftRight, RotateCw, RotateCcw, Rows3, Columns3, TableProperties,
  FilePlus2, Files, FileOutput, FileInput, FolderOpen, LayoutGrid, SlidersHorizontal, Strikethrough, AlignLeft, AlignCenter, AlignRight, type IconNode } from 'lucide'

const icons: Record<string, IconNode> = {
  'confirm': Check, 'add': Plus, 'edit': Pencil, 'delete': Trash2, 'copy': Copy, 'reset': RotateCcw, 'refresh': RotateCw,
  'move-up': ArrowUp, 'move-down': ArrowDown, 'horizontal': ArrowLeftRight, 'vertical': ArrowUpDown,
  'clockwise': RotateCw, 'counterclockwise': RotateCcw, 'sketch': Pencil, 'regular': Shapes,
  'add-row': Rows3, 'add-column': Columns3, 'table-header': TableProperties, 'clear-fill': Eraser,
  'page-list-btn': Files, 'insert-page-btn': FilePlus2, 'place-in-page-btn': FileInput, 'export-pages': FileOutput,
  'page-grid': LayoutGrid, 'page-settings': SlidersHorizontal, 'move-out': FileOutput, 'move-in': Import, 'choose-vault': FolderOpen,
  'rename': TextCursorInput, 'style-strike': Strikethrough, 'align-left': AlignLeft, 'align-center': AlignCenter, 'align-right': AlignRight,
  'close': X, 'note-bold': Bold, 'note-italic': Italic, 'note-list': List, 'note-link': Link,
  'zoom-in': Plus, 'zoom-out': Minus, 'zoom-fit': Maximize, 'minimap-collapse': ChevronDown, 'minimap-expand': ChevronUp,
  'toolbar-home-btn': House, 'toolbar-more-btn': Ellipsis, 'toolbar-undo-btn': Undo2, 'toolbar-redo-btn': Redo2,
  'insert-textbox-btn': TextCursorInput,
  'insert-topic-btn': CircleDot, 'insert-topics-btn': ListTree, 'minimap-toggle-btn': Map,
  'add-node-btn': GitFork, 'insert-menu-btn': Plus, 'link-btn': Waypoints,
  'drill-btn': Focus, 'export-png-btn': Download, 'panel-toggle-btn': PanelRight,
  'insert-image-btn': Image, 'insert-sticker-btn': Sticker, 'insert-group-btn': SquareDashed,
  'group-selection-btn': Group, 'boundary-btn': SquareDashed, 'summary-btn': Braces,
  'node-child': GitFork, 'node-media': Images, 'node-note': StickyNote, 'node-sibling': CornerDownLeft, 'node-link': Waypoints,
  'node-drill': Focus, 'node-more': Ellipsis,
  // 图表菜单（从插入菜单拆出）：每项左侧的示意 icon
  'charts-menu-btn': Shapes,
  'insert-table-btn': Table, 'insert-cycle-btn': IterationCw, 'insert-flow-btn': Workflow,
  'insert-timeline-btn': ChartGantt, 'insert-pyramid-btn': Triangle, 'insert-circleMap-btn': CircleDot,
  'insert-glossary-btn': BookA, 'insert-ink-btn': PenLine,
  // 主画布当前工具：顶部常驻选择箭头（与手绘面板选择钮同状态）
  'tool-select-btn': MousePointer2,
  // 手绘：工具栏开关 + 手绘工具条各选项
  'ink-mode-btn': Signature,
  'ink-select-btn': MousePointer2, 'ink-pen-btn': Pencil, 'ink-highlight-btn': Highlighter,
  'ink-erase-btn': Eraser, 'ink-box-btn': SquareDashedMousePointer, 'ink-embed-btn': Import, 'ink-close-btn': ChevronDown,
}

export function toolbarIcon(id: string): SVGElement | null {
  return icons[id] ? createElement(icons[id], { width: 20, height: 20, 'stroke-width': 1.7, 'aria-hidden': 'true', class: 'tbar-ic' }) : null
}

/** Shared action vocabulary for text-bearing menus. */
const menuIcons: Record<string, IconNode> = {
  '复制文本框': Copy, '转为节点': GitFork, '转为文本框': TextCursorInput,
  '编辑文字': Pencil, '复制样式': Paintbrush, '粘贴样式': ClipboardPaste,
  '选择后代': ListTree, '折叠 / 展开': ListCollapse,
  '新增子级': GitFork, '新增同级': CornerDownLeft,
  '素材（图片、图标、插画）': Images, '节点注释': StickyNote,
  '关系线': Waypoints, '聚焦此分支': Focus, '新增独立主题': CircleDot,
  '复制此节点及子树': Copy, '复制独立主题': Copy,
  '删除所选内容（含子树）': Trash2,
  '重命名': TextCursorInput, '复制': Copy, '版本历史': History, '删除': Trash2,
  '全图 PNG': Download, '当前范围 PNG': Download,
}
export function menuIcon(label: string): SVGElement {
  const icon = menuIcons[label]
  if (!icon) throw new Error(`Missing menu icon: ${label}`)
  return createElement(icon, { width: 20, height: 20, 'stroke-width': 1.7, 'aria-hidden': 'true', class: 'tbar-ic' })
}
