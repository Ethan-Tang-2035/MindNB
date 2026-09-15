import type { Rect } from './layout.ts'
import type { View } from './render.ts'

/** All overlays and pointer coordinates use window pixels; this is the visible cutout. */
export function editorViewport(width: number, height: number, left: number, right: number, bottom = 72): Rect {
  return { x: left, y: 76, w: Math.max(1, width - left - right), h: Math.max(1, height - 76 - bottom) }
}

/** Reveal without changing scale; large targets show their leading edge. */
export function revealRect(view: View, box: Rect, viewport: Rect): View {
  const margin = Math.min(24, viewport.w / 8, viewport.h / 8)
  const shift = (start: number, size: number, min: number, available: number) =>
    start < min ? min - start : start + Math.min(size, available) > min + available ? min + available - start - Math.min(size, available) : 0
  return { ...view,
    tx: view.tx + shift(box.x * view.k + view.tx, box.w * view.k, viewport.x + margin, viewport.w - margin * 2),
    ty: view.ty + shift(box.y * view.k + view.ty, box.h * view.k, viewport.y + margin, viewport.h - margin * 2),
  }
}

/** Keep an overlay fully inside its available screen rectangle, shrinking if necessary. */
export function boundedOverlay(box: Rect, bounds: Rect): Rect {
  const w = Math.min(box.w, bounds.w), h = Math.min(box.h, bounds.h)
  return {x:Math.max(bounds.x,Math.min(box.x,bounds.x+bounds.w-w)),y:Math.max(bounds.y,Math.min(box.y,bounds.y+bounds.h-h)),w,h}
}
