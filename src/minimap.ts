import { toolbarIcon } from './icons.ts'
import { setTooltip } from './tooltip.ts'
import { anchoredSiblingBox, summaryGeomOf, type Rect, type Layout } from './layout.ts'
import { objectBBox } from './objects.ts'
import type { MindMap } from './model.ts'
import { edgeGeometry } from './edge-geometry.ts'
import type { View } from './render.ts'

export function minimapContentBoxes(layout: Layout, map: MindMap): Rect[] {
  const boxes: Rect[] = [...layout.nodes]
  for (const object of map.objects ?? []) {
    let box = objectBBox(object)
    if (object.kind === 'boundary') box = anchoredSiblingBox(object.anchor, layout.nodes, layout.links)
    if (object.kind === 'summary') box = summaryGeomOf(object.anchor, object.text, layout.nodes, layout.links, text => text.length * 14, object.seed)?.text ?? null
    if (object.kind === 'edge') {
      const endpoint = (id: string) => layout.nodes.find(n => n.id === id) ?? objectBBox(map.objects?.find(o => o.id === id) ?? object)
      const a = endpoint(object.from), b = endpoint(object.to)
      if (a && b) {
        const curve = edgeGeometry(a, b, object, layout.nodes)
        const x = Math.min(curve.from.x, curve.to.x, curve.control.x), y = Math.min(curve.from.y, curve.to.y, curve.control.y)
        box = { x, y, w: Math.max(curve.from.x, curve.to.x, curve.control.x) - x, h: Math.max(curve.from.y, curve.to.y, curve.control.y) - y }
      }
    }
    if (box) boxes.push(box)
  }
  return boxes
}

export function minimapTransform(boxes: Rect[], viewport: Rect, width = 200, height = 120) {
  const finite = [...boxes, viewport].filter(b => [b.x, b.y, b.w, b.h].every(Number.isFinite))
  const minX = Math.min(0, ...finite.map(b => b.x))
  const minY = Math.min(0, ...finite.map(b => b.y))
  const maxX = Math.max(minX + 1, ...finite.map(b => b.x + b.w))
  const maxY = Math.max(minY + 1, ...finite.map(b => b.y + b.h))
  const k = Math.min((width - 16) / (maxX - minX), (height - 16) / (maxY - minY))
  return { k, tx: (width - (maxX - minX) * k) / 2 - minX * k, ty: (height - (maxY - minY) * k) / 2 - minY * k }
}

export function viewportRect(view: View, width: number, height: number): Rect {
  return { x: -view.tx / view.k, y: -view.ty / view.k, w: width / view.k, h: height / view.k }
}

export function mountMinimap(parent: HTMLElement, navigate: (x: number, y: number) => void, fit: () => void) {
  const host = document.createElement('section')
  host.id = 'minimap'
  host.setAttribute('aria-label', '导航缩略图')
  host.innerHTML = '<header><span>导航缩略图</span><button type="button" aria-label="查看当前范围全部内容">全部</button><button type="button" aria-label="收起导航缩略图" aria-expanded="true">−</button></header><svg viewBox="0 0 200 120" role="img" aria-label="内容位置与取景框"></svg>'
  const svg = host.querySelector('svg')!
  const [fitButton, toggle] = host.querySelectorAll('button')
  fitButton.replaceChildren(toolbarIcon('zoom-fit')!)
  setTooltip(fitButton, '查看当前范围全部内容')
  toggle.replaceChildren(toolbarIcon('minimap-collapse')!)
  setTooltip(toggle, '收起导航缩略图')
  fitButton.onclick = fit
  toggle.onclick = () => {
    const collapsed = host.classList.toggle('collapsed')
    toggle.replaceChildren(toolbarIcon(collapsed ? 'minimap-expand' : 'minimap-collapse')!)
    toggle.setAttribute('aria-expanded', String(!collapsed))
    setTooltip(toggle, collapsed ? '展开导航缩略图' : '收起导航缩略图')
  }
  let transform = { k: 1, tx: 0, ty: 0 }
  let viewport: Rect = { x: 0, y: 0, w: 1, h: 1 }
  let drag: { pointer: number; transform: View; dx: number; dy: number } | null = null
  const point = (e: PointerEvent, t: View) => {
    const b = svg.getBoundingClientRect()
    return { x: ((e.clientX - b.left) * 200 / b.width - t.tx) / t.k, y: ((e.clientY - b.top) * 120 / b.height - t.ty) / t.k }
  }
  svg.onpointerdown = e => {
    if (e.button !== 0) return
    e.preventDefault()
    const p = point(e, transform)
    const inside = p.x >= viewport.x && p.x <= viewport.x + viewport.w && p.y >= viewport.y && p.y <= viewport.y + viewport.h
    drag = { pointer: e.pointerId, transform: { ...transform }, dx: inside ? viewport.x + viewport.w / 2 - p.x : 0, dy: inside ? viewport.y + viewport.h / 2 - p.y : 0 }
    svg.setPointerCapture(e.pointerId)
    navigate(p.x + drag.dx, p.y + drag.dy)
  }
  svg.onpointermove = e => {
    if (!drag || drag.pointer !== e.pointerId) return
    const p = point(e, drag.transform)
    navigate(p.x + drag.dx, p.y + drag.dy)
  }
  svg.onpointerup = svg.onpointercancel = () => { drag = null }
  parent.append(host)
  return {
    update(boxes: Rect[], view: View, width: number, height: number) {
      viewport = viewportRect(view, width, height)
      transform = drag?.transform ?? minimapTransform(boxes, viewport)
      svg.replaceChildren()
      for (const [i, box] of [...boxes, viewport].entries()) {
        const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
        const isView = i === boxes.length
        const values = { x: box.x * transform.k + transform.tx, y: box.y * transform.k + transform.ty, width: Math.max(1, box.w * transform.k), height: Math.max(1, box.h * transform.k) }
        for (const [key, value] of Object.entries(values)) r.setAttribute(key, String(value))
        r.setAttribute('class', isView ? 'minimap-viewport' : 'minimap-content')
        svg.append(r)
      }
    },
    unmount: () => host.remove(),
  }
}
