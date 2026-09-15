import { setActionContent } from './ui-controls.ts'
import { toolbarIcon } from './icons.ts'
import type { InkObject, InkStroke } from './objects.ts'
import { newId } from './model.ts'
import { SnapshotHistory } from './history.ts'
import { appendContent } from './content-render.ts'
import { erasesStroke, strokePath } from './ink.ts'

export function openInkEditor(content: InkObject, save: (ink: InkObject) => void): HTMLDialogElement {
  let draft = structuredClone(content)
  const history = new SnapshotHistory<InkObject>(100)
  const dialog = document.createElement('dialog'); dialog.className = 'content-dialog ink-dialog'; dialog.setAttribute('aria-label', '编辑笔迹')
  const title = document.createElement('h2'); title.className = 'ui-dialog-heading'; title.append(toolbarIcon('insert-ink-btn')!, document.createTextNode('编辑笔迹'))
  const tools = document.createElement('div'); tools.className = 'content-editor-tools'
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', `0 0 ${draft.sourceWidth} ${draft.sourceHeight}`); svg.setAttribute('aria-label', '笔迹画幅'); svg.classList.add('ink-editor-canvas'); svg.style.aspectRatio = `${draft.sourceWidth} / ${draft.sourceHeight}`
  const footer = document.createElement('footer')
  const addButton = (parent: HTMLElement, text: string, action: () => void) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.onclick = action; parent.append(b); return b }
  const compact = (button: HTMLButtonElement, icon: string, label: string) => setActionContent(button, label, icon, true)
  let tool: 'pen' | 'highlight' | 'erase' = 'pen'
  const modeButtons = new Map<string, HTMLButtonElement>()
  for (const [id, label] of [['pen', '画笔'], ['highlight', '荧光笔'], ['erase', '整笔橡皮擦']] as const) {
    const button = addButton(tools, label, () => { tool = id; for (const [mode, b] of modeButtons) b.setAttribute('aria-pressed', String(mode === tool)) }); compact(button, `ink-${id}-btn`, label); modeButtons.set(id, button)
  }
  modeButtons.get('pen')!.setAttribute('aria-pressed', 'true')
  const color = document.createElement('input'); color.type = 'color'; color.value = '#4a3f35'; color.setAttribute('aria-label', '笔迹颜色')
  const width = document.createElement('input'); width.type = 'range'; width.min = '1'; width.max = '20'; width.value = '3'; width.setAttribute('aria-label', '笔迹粗细'); tools.append(color, width)
  const redraw = () => { svg.replaceChildren(); appendContent(svg, draft, { x: 0, y: 0, w: draft.sourceWidth, h: draft.sourceHeight }, '#4a3f35'); undo.disabled = !history.canUndo; redo.disabled = !history.canRedo }
  const undo = addButton(tools, '撤销笔迹', () => { const previous = history.undo(draft); if (previous) { draft = previous; redraw() } })
  const redo = addButton(tools, '重做笔迹', () => { const next = history.redo(draft); if (next) { draft = next; redraw() } })
  compact(undo, 'toolbar-undo-btn', '撤销笔迹')
  compact(redo, 'toolbar-redo-btn', '重做笔迹')
  let active: { pointer: number; stroke: InkStroke; preview: SVGPathElement; erased: Set<string>; erase: boolean } | null = null
  const point = (e: PointerEvent) => {
    const transform = svg.getScreenCTM()
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(transform?.inverse())
    return { x: Math.max(0, Math.min(draft.sourceWidth, p.x)), y: Math.max(0, Math.min(draft.sourceHeight, p.y)) }
  }
  const markErase = (e: PointerEvent) => {
    const p = point(e)
    for (const stroke of draft.strokes) if (erasesStroke(active?.stroke.points.at(-1) ?? p, p, stroke, 10)) active?.erased.add(stroke.id)
    active?.stroke.points.push(p)
  }
  svg.onpointerdown = e => {
    e.preventDefault()
    if (e.pointerType === 'touch' || e.button !== 0 || active) return
    const p = point(e), preview = document.createElementNS(svg.namespaceURI, 'path') as SVGPathElement
    const stroke: InkStroke = { id: newId(), points: [p], color: color.value, width: Number(width.value) * (tool === 'highlight' ? 4 : 1), opacity: tool === 'highlight' ? .35 : 1 }
    for (const [key, value] of Object.entries({ fill: 'none', stroke: stroke.color, 'stroke-width': stroke.width, opacity: stroke.opacity, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', d: strokePath(stroke.points) })) preview.setAttribute(key, String(value))
    active = { pointer: e.pointerId, stroke, preview, erased: new Set(), erase: tool === 'erase' }
    if (tool !== 'erase') svg.append(preview)
    else markErase(e)
    svg.setPointerCapture(e.pointerId)
  }
  svg.onpointermove = e => {
    if (!active || active.pointer !== e.pointerId) return
    if (active.erase) { const events = e.getCoalescedEvents?.() ?? []; for (const event of events.length ? events : [e]) markErase(event); return }
    const events = e.getCoalescedEvents?.() ?? []
    for (const event of events.length ? events : [e]) active.stroke.points.push(point(event))
    active.preview.setAttribute('d', strokePath(active.stroke.points))
  }
  svg.onpointerup = svg.onpointercancel = e => {
    if (!active || active.pointer !== e.pointerId) return
    const current = active; active = null; current.preview.remove()
    if (e.type === 'pointercancel') { redraw(); return }
    if (!current.erase || current.erased.size) {
      history.record(draft); draft = structuredClone(draft)
      if (current.erase) draft.strokes = draft.strokes.filter(s => !current.erased.has(s.id))
      else draft.strokes.push(current.stroke)
    }
    redraw()
  }
  dialog.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); e.stopPropagation(); (e.shiftKey ? redo : undo).click() }
  })
  setActionContent(addButton(footer, '取消', () => dialog.close()), '取消', 'close')
  const done = addButton(footer, '完成', () => { save(draft); dialog.close() }); setActionContent(done, '完成', 'confirm'); done.classList.add('primary-button')
  dialog.addEventListener('close', () => dialog.remove(), { once: true })
  dialog.append(title, tools, svg, footer); document.body.append(dialog); dialog.showModal(); redraw()
  return dialog
}
