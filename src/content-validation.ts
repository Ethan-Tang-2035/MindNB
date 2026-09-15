/** Validate owned rich content before local or remote documents reach the renderer. */
export function validContent(value: unknown, claim: (id: unknown) => boolean): boolean {
  if (!value || typeof value !== 'object') return false
  const c = value as Record<string, unknown>
  const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0
  const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
  const text = (v: unknown): v is string => typeof v === 'string'
  const direction = (v: unknown): v is 'right' | 'down' => v === 'right' || v === 'down'
  if (!claim(c.id) || !finite(c.x) || !finite(c.y)) return false
  if (c.placement !== undefined && (c.placement !== 'overlay' || !['image', 'sticker'].includes(String(c.kind)))) return false
  if (c.kind === 'sticker') return text(c.icon) && positive(c.size)
  if (!positive(c.w) || !positive(c.h)) return false
  if (c.kind === 'image') return text(c.src)
  if (c.kind === 'table') return Array.isArray(c.columnWidths) && c.columnWidths.length > 0 && c.columnWidths.every(positive) &&
    Array.isArray(c.cells) && c.cells.length > 0 && c.cells.every(row => Array.isArray(row) && row.length === (c.columnWidths as unknown[]).length && row.every(text)) &&
    typeof c.header === 'boolean' && !!c.fills && typeof c.fills === 'object' && !Array.isArray(c.fills) && Object.values(c.fills).every(text)
  if (c.kind === 'cycle') return Array.isArray(c.steps) && c.steps.length > 0 && c.steps.every(s => s && claim(s.id) && text(s.text)) &&
    typeof c.clockwise === 'boolean' && typeof c.sketch === 'boolean' && text(c.color)
  if (c.kind === 'flow') return Array.isArray(c.steps) && c.steps.length > 0 && c.steps.every(s => s && claim(s.id) && text(s.text)) &&
    direction(c.direction) && typeof c.sketch === 'boolean' && text(c.color)
  if (c.kind === 'timeline') return Array.isArray(c.items) && c.items.length > 0 && c.items.every(s => s && claim(s.id) && text(s.time) && text(s.text)) &&
    direction(c.direction) && typeof c.sketch === 'boolean' && text(c.color)
  if (c.kind === 'pyramid') return Array.isArray(c.items) && c.items.length > 0 && c.items.every(s => s && claim(s.id) && text(s.text)) &&
    typeof c.sketch === 'boolean' && text(c.color)
  if (c.kind === 'circleMap') {
    const center = c.center as { id?: unknown; text?: string } | null | undefined
    return !!center && claim(center.id) && text(center.text) && Array.isArray(c.items) && c.items.length > 0 &&
      c.items.every(s => s && claim(s.id) && text(s.text)) && typeof c.sketch === 'boolean' && text(c.color)
  }
  if (c.kind === 'ink') return positive(c.sourceWidth) && positive(c.sourceHeight) && Array.isArray(c.strokes) && c.strokes.every(s =>
    s && claim(s.id) && text(s.color) && positive(s.width) && finite(s.opacity) && s.opacity >= 0 && s.opacity <= 1 &&
    Array.isArray(s.points) && s.points.length > 0 && s.points.every((p: { x?: unknown; y?: unknown } | null) => p && finite(p.x) && finite(p.y)))
  return false
}
