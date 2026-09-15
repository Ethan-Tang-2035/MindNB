import { borderPoint, type Rect } from './layout.ts'
import type { EdgeObject } from './objects.ts'

export interface Point { x: number; y: number }
export interface EdgeCurve { from: Point; to: Point; control: Point; d: string; label: Point; arrows: string[] }

export function pointOnCurve(c: Pick<EdgeCurve, 'from' | 'to' | 'control'>, t: number): Point {
  const u = 1 - t
  return { x: u * u * c.from.x + 2 * u * t * c.control.x + t * t * c.to.x,
    y: u * u * c.from.y + 2 * u * t * c.control.y + t * t * c.to.y }
}

export function edgeGeometry(a: Rect, b: Rect, edge: Partial<EdgeObject> = {}, obstacles: Rect[] = [a, b]): EdgeCurve {
  const from = borderPoint(a, { x: b.x + b.w / 2, y: b.y + b.h / 2 })
  const to = borderPoint(b, { x: a.x + a.w / 2, y: a.y + a.h / 2 })
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
  const dx = to.x - from.x, dy = to.y - from.y
  const bend = Math.abs(dy) > Math.abs(dx) ? .8 : .15
  const offset = edge.lineStyle === 'straight' ? { x: 0, y: 0 } : edge.control ?? { x: -dy * bend, y: dx * bend + ((edge.seed ?? 0) % 5 - 2) * .4 }
  const control = { x: mid.x + offset.x, y: mid.y + offset.y }
  const arrows: string[] = []
  const arrowAt = (tip: Point) => {
    const angle = Math.atan2(tip.y - control.y, tip.x - control.x)
    const wing = (d: number) => `${tip.x - 10 * Math.cos(angle + d)} ${tip.y - 10 * Math.sin(angle + d)}`
    arrows.push(`M${wing(.45)} L${tip.x} ${tip.y} L${wing(-.45)}`)
  }
  if (!edge.arrow || edge.arrow === 'end' || edge.arrow === 'both') arrowAt(to)
  if (edge.arrow === 'start' || edge.arrow === 'both') arrowAt(from)
  const c = { from, to, control }
  const label = pointOnCurve(c, .5)
  if (edge.label) {
    const half = Math.max(14, [...edge.label].reduce((w, ch) => w + (ch.charCodeAt(0) > 255 ? 14 : 8), 0) / 2)
    const overlaps = (p: Point) => obstacles.some(n => p.x + half > n.x - 8 && p.x - half < n.x + n.w + 8 && p.y - 22 < n.y + n.h && p.y + 4 > n.y)
    if (overlaps(label)) {
      const candidates = obstacles.flatMap(n => [{ x: label.x, y: n.y - 6 }, { x: label.x, y: n.y + n.h + 24 },
        { x: n.x - half - 12, y: label.y }, { x: n.x + n.w + half + 12, y: label.y }])
      candidates.sort((a, b) => Math.hypot(a.x - label.x, a.y - label.y) - Math.hypot(b.x - label.x, b.y - label.y))
      const free = candidates.find(p => !overlaps(p))
      if (free) Object.assign(label, free)
    }
  }
  return { ...c, d: `M${from.x} ${from.y} Q${control.x} ${control.y} ${to.x} ${to.y}`, label, arrows }
}

export function hitCurve(curve: EdgeCurve, point: Point, zoom: number): boolean {
  const length = Math.hypot(curve.control.x - curve.from.x, curve.control.y - curve.from.y) + Math.hypot(curve.to.x - curve.control.x, curve.to.y - curve.control.y)
  const steps = Math.max(24, Math.min(4096, Math.ceil(length * zoom / 4)))
  let a = curve.from
  for (let i = 1; i <= steps; i++) {
    const b = pointOnCurve(curve, i / steps)
    const dx = b.x - a.x, dy = b.y - a.y
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)))
    if (Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy) * zoom <= 9) return true
    a = b
  }
  return false
}
