import { setTooltip } from './tooltip.ts'
import type { MindMap } from './model.ts'
import { newId } from './model.ts'
import { newSeed, type InkObject, type InkStroke } from './objects.ts'
import { erasesStroke, hitInkAt, INK_HIT_TOLERANCE_PX, inkIntersects, makeInk, strokePath, TAP_SELECT_PX, tapOrDraw, worldStroke, type Point } from './ink.ts'
import { toolbarIcon } from './icons.ts'
import type { View } from './render.ts'

/** 主画布当前工具（词汇见 CONTEXT.md「选择工具」「连续绘画」）：
 * 纯查看态，不进文档数据、不进撤销历史；面板按钮与顶部选择按钮共享同一状态 */
export type CanvasTool = 'select' | 'pen' | 'highlight' | 'erase' | 'box'

export interface InkHost {
  map(): MindMap
  view(): View
  point(x: number, y: number): Point
  changeView(view: View): void
  commit(ink: InkObject): void
  erase(hits: Map<string, Set<string>>): void
  select(ids: string[]): void
  redraw(): void
  embed(): void
  /** 工具变化时回调（面板按钮、轻点选择、收起面板都会触发）：main 侧同步顶部按钮、光标与互斥态 */
  onToolChange?(tool: CanvasTool): void
}

export function mountInkInput(svg: SVGSVGElement, host: InkHost) {
  const panel = document.createElement('div'); panel.id = 'ink-toolbar'; panel.hidden = true; panel.setAttribute('role', 'toolbar'); panel.setAttribute('aria-label', '手绘工具')
  let mode: CanvasTool = 'select' // 进入文档默认选择工具（顶部箭头与面板选择钮同源）
  let active: { id: number; points: Point[]; preview: SVGPathElement; mode: CanvasTool; stroke: InkStroke; erased: Map<string, Set<string>>; down: Point; maxDisp: number } | null = null
  const buttons = new Map<string, HTMLButtonElement>()
  const sync = () => { for (const [key, b] of buttons) b.setAttribute('aria-pressed', String(mode === key)) }
  const mkIconBtn = (id: string, name: string, onClick: () => void) => {
    const b = document.createElement('button'); b.type = 'button'; b.id = id
    setTooltip(b, name)
    b.append(toolbarIcon(id) ?? document.createTextNode(name))
    b.onclick = onClick
    return b
  }
  /** 取消未完成手势：不留 preview、不留半成品，释放指针捕获（工具切换/收起面板共用）。
   *  先置空 active 再释放捕获：releasePointerCapture 可能（实现相关）同步派发 lostpointercapture，
   *  否则监听器会重入并重复处理同一个手势 */
  const cancelActive = () => {
    if (!active) return
    const { id, preview } = active
    active = null
    if (svg.hasPointerCapture(id)) svg.releasePointerCapture(id)
    preview.remove()
  }
  /** 统一的工具切换入口：互斥态清理由 main 的 onToolChange 收口，这里只保证手势与高亮一致 */
  const setTool = (tool: CanvasTool) => {
    if (mode === tool) { sync(); return }
    cancelActive() // 工具切换取消未完成手势
    mode = tool
    sync()
    host.onToolChange?.(mode)
  }
  for (const [key, name, id] of [['select', '选择', 'ink-select-btn'], ['pen', '画笔', 'ink-pen-btn'], ['highlight', '荧光笔', 'ink-highlight-btn'], ['erase', '整笔橡皮擦', 'ink-erase-btn'], ['box', '框选笔迹', 'ink-box-btn']] as const) {
    const b = mkIconBtn(id, name, () => setTool(key)); buttons.set(key, b); panel.append(b)
  }
  const color = document.createElement('input'); color.type = 'color'; color.value = '#4a3f35'; color.setAttribute('aria-label', '画笔颜色')
  const width = document.createElement('input'); width.type = 'range'; width.min = '1'; width.max = '20'; width.value = '3'; width.setAttribute('aria-label', '画笔粗细')
  const embed = mkIconBtn('ink-embed-btn', '笔迹放入节点', host.embed)
  // 收起后回到选择工具，不留隐藏的绘画模式（词汇见 CONTEXT.md「选择工具」）
  const closePanel = () => { panel.hidden = true; cancelActive(); setTool('select') }
  const close = mkIconBtn('ink-close-btn', '收起', () => closePanel())
  panel.append(color, width, embed, close); document.getElementById('app')!.append(panel); sync()
  const listeners: Array<() => void> = []
  const on = (type: string, listener: (e: PointerEvent) => void) => { svg.addEventListener(type, listener as EventListener, { capture: true, passive: false }); listeners.push(() => svg.removeEventListener(type, listener as EventListener, true)) }
  const touches = new Map<number, Point>()
  let touchStart: Point | null = null, moved = false, previousDistance = 0, previousCenter: Point | null = null
  let lastTap = 0, lastTapPoint: Point | null = null
  const center = () => { const p = [...touches.values()]; return { x: p.reduce((s, p) => s + p.x, 0) / p.length, y: p.reduce((s, p) => s + p.y, 0) / p.length } }
  const distance = () => { const p = [...touches.values()]; return p.length >= 2 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0 }
  const preview = () => {
    if (!active) return
    if (!active.preview.isConnected) svg.append(active.preview)
    const { points, mode, stroke, erased } = active
    const v = host.view(); active.preview.setAttribute('transform', `translate(${v.tx} ${v.ty}) scale(${v.k})`)
    if (mode === 'box') {
      const a = points[0], b = points.at(-1)!
      active.preview.setAttribute('d', `M${a.x} ${a.y}H${b.x}V${b.y}H${a.x}Z`)
    } else if (mode === 'erase') {
      const p = points.at(-1)!
      for (const object of host.map().objects ?? []) if (object.kind === 'ink') {
        for (const s of object.strokes) if (erasesStroke(points.at(-2) ?? p, p, worldStroke(object, s), 10 / v.k)) {
          if (!erased.has(object.id)) erased.set(object.id, new Set())
          erased.get(object.id)!.add(s.id)
        }
      }
      active.preview.setAttribute('d', `M${p.x - 8 / v.k} ${p.y}h${16 / v.k}`)
    } else active.preview.setAttribute('d', strokePath(points))
    active.preview.setAttribute('stroke', mode === 'box' || mode === 'erase' ? '#2475b0' : stroke.color)
  }
  on('pointerdown', e => {
    if (e.button !== 0 && e.pointerType !== 'touch') return
    if (e.pointerType === 'touch') {
      e.preventDefault(); e.stopImmediatePropagation()
      if (active) return
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY }); svg.setPointerCapture(e.pointerId)
      if (touches.size === 1) { touchStart = { x: e.clientX, y: e.clientY }; moved = false }
      else moved = true
      previousCenter = center(); previousDistance = distance(); return
    }
    if (panel.hidden || mode === 'select') return
    e.preventDefault(); e.stopImmediatePropagation()
    if (active || touches.size) return
    const p = host.point(e.clientX, e.clientY)
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    const stroke = { id: newId(), points: [p], color: color.value, width: Number(width.value) * (mode === 'highlight' ? 4 : 1), opacity: mode === 'highlight' ? .35 : 1 }
    path.setAttribute('fill', mode === 'box' ? '#2475b015' : 'none'); path.setAttribute('stroke-width', String(mode === 'box' ? 1.5 / host.view().k : stroke.width)); path.setAttribute('opacity', String(stroke.opacity)); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round'); path.setAttribute('pointer-events', 'none'); path.dataset.inkPreview = ''
    svg.append(path)
    // 连续绘画：按下即起笔并保留开头采样点；是否「轻点转选择」等抬起时按整个手势的最大位移判定
    active = { id: e.pointerId, points: stroke.points, stroke, preview: path, mode, erased: new Map(), down: { x: e.clientX, y: e.clientY }, maxDisp: 0 }
    svg.setPointerCapture(e.pointerId); preview()
  })
  on('pointermove', e => {
    if (touches.has(e.pointerId)) {
      e.preventDefault(); e.stopImmediatePropagation()
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (touchStart && Math.hypot(e.clientX - touchStart.x, e.clientY - touchStart.y) > 5) moved = true
      const c = center(), d = distance(), v = host.view()
      if (previousCenter && moved) {
        const k = d && previousDistance ? Math.max(.05, Math.min(2.5, v.k * d / previousDistance)) : v.k
        const factor = k / v.k
        host.changeView({ k, tx: c.x - (previousCenter.x - v.tx) * factor, ty: c.y - (previousCenter.y - v.ty) * factor })
      }
      previousCenter = c; previousDistance = d; return
    }
    if (!active || active.id !== e.pointerId) return
    e.preventDefault(); e.stopImmediatePropagation()
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : []
    for (const event of events.length ? events : [e]) {
      active.maxDisp = Math.max(active.maxDisp, Math.hypot(event.clientX - active.down.x, event.clientY - active.down.y))
      const p = host.point(event.clientX, event.clientY), last = active.points.at(-1)!
      if (Math.hypot(p.x - last.x, p.y - last.y) > .3 / host.view().k) active.points.push(p)
      if (active.mode === 'erase') preview()
    }
    preview()
  })
  const end = (e: PointerEvent) => {
    if (touches.has(e.pointerId)) {
      e.preventDefault(); e.stopImmediatePropagation()
      touches.delete(e.pointerId)
      if (!touches.size && !moved && e.type !== 'pointercancel' && touchStart) {
        const opts = { bubbles: true, clientX: e.clientX, clientY: e.clientY, button: 0 }
        const hit = document.elementFromPoint(e.clientX, e.clientY)
        const target = hit && svg.contains(hit) ? hit : svg
        target.dispatchEvent(new MouseEvent('mousedown', opts)); target.dispatchEvent(new MouseEvent('mouseup', opts))
        if (Date.now() - lastTap < 350 && lastTapPoint && Math.hypot(e.clientX - lastTapPoint.x, e.clientY - lastTapPoint.y) < 24) {
          const nextHit = document.elementFromPoint(e.clientX, e.clientY)
          ;(nextHit && svg.contains(nextHit) ? nextHit : svg).dispatchEvent(new MouseEvent('dblclick', opts))
          lastTap = 0; lastTapPoint = null
        } else { lastTap = Date.now(); lastTapPoint = { x: e.clientX, y: e.clientY } }
      }
      previousCenter = touches.size ? center() : null; previousDistance = distance(); return
    }
    if (!active || active.id !== e.pointerId) return
    e.preventDefault(); e.stopImmediatePropagation()
    const current = active; active = null; current.preview.remove()
    if (e.type === 'pointercancel') { host.redraw(); return }
    if (current.mode === 'box') {
      const a = current.points[0], b = current.points.at(-1)!
      const box = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }
      host.select((host.map().objects ?? []).filter((o): o is InkObject => o.kind === 'ink' && inkIntersects(o, box)).map(o => o.id))
    } else if (current.mode === 'erase') host.erase(current.erased)
    else {
      // 画笔/荧光笔：旧笔迹上轻点 → 切到选择工具并选中整幅笔迹（不创建新点、不进内容历史）；
      // 空白轻点 → 画一个点；超过阈值位移 → 从原按下位置绘画（开头采样点已保留）
      const hit = current.maxDisp <= TAP_SELECT_PX
        ? hitInkAt((host.map().objects ?? []).filter((o): o is InkObject => o.kind === 'ink'), current.stroke.points[0], INK_HIT_TOLERANCE_PX, host.view().k)
        : null
      if (tapOrDraw(current.maxDisp, !!hit) === 'select') { setTool('select'); host.select([hit!.id]); return }
      host.commit(makeInk([current.stroke]))
    }
  }
  on('pointerup', end); on('pointercancel', end)
  // 指针捕获异常丢失（未经 up/cancel）：按取消收口，不留 preview 或半成品
  on('lostpointercapture', e => {
    if (!active || active.id !== e.pointerId) return
    active.preview.remove(); active = null; host.redraw()
  })
  return {
    close: () => closePanel(),
    busy: () => active !== null,
    toggle: () => { panel.hidden = !panel.hidden; if (panel.hidden) closePanel() },
    tool: () => mode,
    setTool,
    unmount: () => { listeners.forEach(f => f()); active?.preview.remove(); panel.remove() },
  }
}

export function blankInk(): InkObject {
  return { id: newId(), seed: newSeed(), kind: 'ink', x: 0, y: 0, w: 320, h: 220, sourceWidth: 640, sourceHeight: 440, strokes: [] }
}
