import { newId, type MindMap } from './model.ts'
import { newSeed, removeObjects, type InkObject, type InkStroke } from './objects.ts'
import { insertContent } from './content.ts'
import type { Rect } from './layout.ts'

export type Point = { x: number; y: number }
export function strokePath(points: Point[]): string {
  return points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ') + (points.length === 1 ? 'l.01 .01' : '')
}

export function makeInk(strokes: InkStroke[]): InkObject {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity, pad = 4
  for (const stroke of strokes) {
    pad = Math.max(pad, stroke.width)
    for (const p of stroke.points) {
      left = Math.min(left, p.x); top = Math.min(top, p.y)
      right = Math.max(right, p.x); bottom = Math.max(bottom, p.y)
    }
  }
  if (!Number.isFinite(left)) { left = 0; top = 0; right = 0; bottom = 0 }
  left -= pad; top -= pad
  const w = Math.max(40, right - left + pad), h = Math.max(40, bottom - top + pad)
  return { id: newId(), seed: newSeed(), kind: 'ink', x: left, y: top, w, h, sourceWidth: w, sourceHeight: h,
    strokes: strokes.map(s => ({ ...s, points: s.points.map(p => ({ x: p.x - left, y: p.y - top })) })) }
}

export function worldStroke(ink: InkObject, stroke: InkStroke): InkStroke {
  return { ...stroke, width: stroke.width * Math.max(ink.w / ink.sourceWidth, ink.h / ink.sourceHeight), points: stroke.points.map(p => ({ x: ink.x + p.x * ink.w / ink.sourceWidth, y: ink.y + p.y * ink.h / ink.sourceHeight })) }
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const length = dx * dx + dy * dy
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
}

export function hitsStroke(point: Point, stroke: InkStroke, radius: number): boolean {
  return stroke.points.some((b, i) => distanceToSegment(point, stroke.points[Math.max(0, i - 1)], b) <= radius + stroke.width / 2)
}

/** 笔画命中容差（屏幕像素）：点击、悬停与绘画轻点识别共用，缩放时换算到画布坐标 */
export const INK_HIT_TOLERANCE_PX = 6

/** 轻点判定阈值（屏幕像素）：整个手势相对按下位置的最大位移不超过它才算轻点 */
export const TAP_SELECT_PX = 3

/** 单幅笔迹的真实笔画命中（词汇见 CONTEXT.md「手绘笔迹」）：可见宽度外扩 tolerancePx 屏幕像素，
 * tolerancePx 按当前缩放换算到画布坐标 —— 50%/100%/200% 表现一致。包围盒只做快速排除，不参与命中 */
export function inkHit(ink: InkObject, point: Point, tolerancePx: number, zoom: number): boolean {
  const radius = tolerancePx / zoom
  const k = Math.max(ink.w / ink.sourceWidth, ink.h / ink.sourceHeight)
  const overhang = (Math.max(4, ...ink.strokes.map(s => s.width)) * k) / 2
  if (point.x < ink.x - radius - overhang || point.x > ink.x + ink.w + radius + overhang) return false
  if (point.y < ink.y - radius - overhang || point.y > ink.y + ink.h + radius + overhang) return false
  return ink.strokes.some(stroke => hitsStroke(point, worldStroke(ink, stroke), radius))
}

/** 点击/悬停/轻点识别共用的整幅命中：inks 按渲染顺序传入（后=顶层），重叠时命中最上层 */
export function hitInkAt(inks: InkObject[], point: Point, tolerancePx: number, zoom: number): InkObject | null {
  for (let i = inks.length - 1; i >= 0; i--) if (inkHit(inks[i], point, tolerancePx, zoom)) return inks[i]
  return null
}

/** 绘画手势判定（纯函数，单测覆盖）：旧笔迹上轻点 → 选择；空白轻点、超阈值位移 → 绘画。
 * maxDispPx 取整个手势的最大位移 —— 超过阈值后即使回到按下点也属于绘画 */
export function tapOrDraw(maxDispPx: number, hitInk: boolean): 'select' | 'draw' {
  return hitInk && maxDispPx <= TAP_SELECT_PX ? 'select' : 'draw'
}

/** 混合态检测（词汇见 CONTEXT.md「整幅笔迹样式」）：全部笔画一致 → 该值；不一致或空笔画 → null */
export function uniformInkStyle(ink: InkObject): { color: string | null; width: number | null } {
  const first = ink.strokes[0]
  if (!first) return { color: null, width: null }
  return {
    color: ink.strokes.every(s => s.color === first.color) ? first.color : null,
    width: ink.strokes.every(s => s.width === first.width) ? first.width : null,
  }
}

/** 整幅笔迹样式：只修改 patch 给出的属性，其余（含透明度、轨迹形状）原样保留。
 * 改粗细后重算安全边界 —— 笔画点不动，需要更大边距时平移源坐标并按原缩放扩盒，
 * 世界坐标与缩放比都不变，改完不跳位、不被包围盒裁切 */
export function restyleInk(ink: InkObject, patch: { color?: string; width?: number }): InkObject {
  const next = structuredClone(ink)
  for (const stroke of next.strokes) {
    if (patch.color !== undefined) stroke.color = patch.color
    if (patch.width !== undefined) stroke.width = patch.width
  }
  if (patch.width === undefined || !next.strokes.length) return next
  const pad = Math.max(4, ...next.strokes.map(s => s.width))
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const stroke of next.strokes) for (const p of stroke.points) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  const growLeft = Math.max(0, pad - minX)
  const growTop = Math.max(0, pad - minY)
  const growRight = Math.max(0, maxX + pad - next.sourceWidth)
  const growBottom = Math.max(0, maxY + pad - next.sourceHeight)
  if (!growLeft && !growTop && !growRight && !growBottom) return next
  const kx = next.w / next.sourceWidth, ky = next.h / next.sourceHeight
  for (const stroke of next.strokes) for (const p of stroke.points) { p.x += growLeft; p.y += growTop }
  next.x -= growLeft * kx
  next.y -= growTop * ky
  next.sourceWidth += growLeft + growRight
  next.sourceHeight += growTop + growBottom
  next.w += (growLeft + growRight) * kx
  next.h += (growTop + growBottom) * ky
  return next
}

/** 就地变体（供内容面板在 updateContent 的 clone 上直接改，不必枚举笔迹字段）：语义同 restyleInk */
export function restyleInkInPlace(ink: InkObject, patch: { color?: string; width?: number }): void {
  const next = restyleInk(ink, patch)
  ink.x = next.x; ink.y = next.y; ink.w = next.w; ink.h = next.h
  ink.sourceWidth = next.sourceWidth; ink.sourceHeight = next.sourceHeight
  ink.strokes = next.strokes
}

/** Swept eraser: test whole movement segments, so fast gestures cannot skip thin strokes. */
export function erasesStroke(a: Point, b: Point, stroke: InkStroke, radius: number): boolean {
  const cross = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  return stroke.points.some((d, i) => {
    const c = stroke.points[Math.max(0, i - 1)]
    const overlap = Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) && Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <= Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))
    if (overlap && cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0) return true
    return Math.min(distanceToSegment(a, c, d), distanceToSegment(b, c, d), distanceToSegment(c, a, b), distanceToSegment(d, a, b)) <= radius + stroke.width / 2
  })
}

export function inkIntersects(ink: InkObject, box: Rect): boolean {
  // Clip each segment against the selection rectangle, including its stroke radius.
  return ink.strokes.some(stroke => {
    const s = worldStroke(ink, stroke), radius = s.width / 2
    return s.points.some((b, i) => {
      const a = s.points[Math.max(0, i - 1)]
      let enter = 0, leave = 1
      for (const [start, delta, min, max] of [
        [a.x, b.x - a.x, box.x - radius, box.x + box.w + radius],
        [a.y, b.y - a.y, box.y - radius, box.y + box.h + radius],
      ]) {
        if (!delta) { if (start < min || start > max) return false; continue }
        const t1 = (min - start) / delta, t2 = (max - start) / delta
        enter = Math.max(enter, Math.min(t1, t2)); leave = Math.min(leave, Math.max(t1, t2))
        if (enter > leave) return false
      }
      return true
    })
  })
}

export function embedInk(map: MindMap, ids: string[], owner: string): MindMap {
  const inks = (map.objects ?? []).filter((o): o is InkObject => o.kind === 'ink' && ids.includes(o.id))
  if (!inks.length) return map
  const content = makeInk(inks.flatMap(o => o.strokes.map(s => worldStroke(o, s))))
  const added = insertContent(map, content, owner)
  if (added === map) return map
  return removeObjects(added, inks.map(ink => ink.id))
}

/** Erasing the last stroke removes its object and any attached relationships together. */
export function eraseInkStrokes(map: MindMap, hits: Map<string, Set<string>>): MindMap {
  const next = structuredClone(map), empty: string[] = []
  let changed = false
  for (const object of next.objects ?? []) {
    if (object.kind !== 'ink' || !hits.has(object.id)) continue
    const strokes = object.strokes.filter(stroke => !hits.get(object.id)!.has(stroke.id))
    if (strokes.length === object.strokes.length) continue
    changed = true
    object.strokes = strokes
    if (!strokes.length) empty.push(object.id)
  }
  return changed ? removeObjects(next, empty) : map
}
