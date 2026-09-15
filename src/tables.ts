import type { TableObject } from './objects.ts'
import { tableRowHeights } from './content-render.ts'

export function parseGrid(text: string): string[][] {
  const rows: string[][] = [[]]
  let value = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"' && (quoted || !value.length)) {
      if (quoted && text[i + 1] === '"') { value += '"'; i++ }
      else quoted = !quoted
    } else if (!quoted && (c === '\t' || c === '\n' || c === '\r')) {
      rows.at(-1)!.push(value); value = ''
      if (c !== '\t') {
        if (c === '\r' && text[i + 1] === '\n') i++
        rows.push([])
      }
    } else value += c
  }
  if (value || rows.at(-1)!.length || rows.length === 1) rows.at(-1)!.push(value)
  else rows.pop()
  return rows
}

export function sizeTable(table: TableObject): void {
  table.w = table.columnWidths.reduce((a, b) => a + b, 0)
  table.h = tableRowHeights(table).reduce((a, b) => a + b, 0)
}

export function pasteGrid(table: TableObject, text: string, row: number, column: number): void {
  const pasted = parseGrid(text)
  const cols = Math.max(table.columnWidths.length, column + Math.max(0, ...pasted.map(r => r.length)))
  while (table.columnWidths.length < cols) table.columnWidths.push(120)
  while (table.cells.length < row + pasted.length) table.cells.push([])
  for (const r of table.cells) while (r.length < cols) r.push('')
  pasted.forEach((r, y) => r.forEach((v, x) => { table.cells[row + y][column + x] = v }))
  sizeTable(table)
}

export function editTableDimension(table: TableObject, axis: 'row' | 'column', index: number, remove: boolean): void {
  const length = axis === 'row' ? table.cells.length : table.columnWidths.length
  if (remove && length <= 1) return
  const at = Math.max(0, Math.min(index, remove ? length - 1 : length))
  if (axis === 'row') table.cells.splice(at, remove ? 1 : 0, ...(remove ? [] : [Array(table.columnWidths.length).fill('') as string[]]))
  else {
    table.columnWidths.splice(at, remove ? 1 : 0, ...(remove ? [] : [120]))
    table.cells.forEach(r => r.splice(at, remove ? 1 : 0, ...(remove ? [] : [''])))
  }
  const fills: Record<string, string> = {}
  for (const [key, color] of Object.entries(table.fills)) {
    const coords = key.split(',').map(Number)
    const dim = axis === 'row' ? 0 : 1
    if (remove && coords[dim] === at) continue
    if (coords[dim] >= at) coords[dim] += remove ? -1 : 1
    fills[coords.join(',')] = color
  }
  table.fills = fills
  sizeTable(table)
}
