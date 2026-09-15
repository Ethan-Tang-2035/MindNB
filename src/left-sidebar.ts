import { createElement, Layers, Files, ChevronRight, X, Type, Image, Pencil, Table2, Waypoints, Frame, Shapes, type IconNode } from 'lucide'
import type { MindMap } from './model.ts'
import { layerGroups, type LayerEntry } from './layer-tree.ts'
import './left-sidebar.css'

export type LeftTab = 'layers' | 'paper'
interface Host { map(): MindMap; selected(): string[]; locate(id: string): void; selectPage(id: string): void; changed(open: boolean): void }
export function mountLeftSidebar(host: Host) {
  const app = document.getElementById('app')!
  const rail = document.createElement('nav'); rail.id = 'editor-left-rail'; rail.setAttribute('aria-label', '文档导航')
  const panel = document.createElement('aside'); panel.id = 'editor-left-panel'; panel.setAttribute('aria-label', '文档内容'); panel.hidden = true
  const header = document.createElement('header'), title = document.createElement('h2')
  const close = document.createElement('button'); close.type = 'button'; close.setAttribute('aria-label', '收起左侧面板'); close.append(createElement(X))
  header.append(title, close)
  const layers = document.createElement('div'); layers.id = 'layer-list'; layers.setAttribute('aria-label', '图层列表')
  const paper = document.createElement('div'); paper.id = 'paper-panel'; paper.hidden = true
  const status = document.createElement('p'); status.className = 'navigation-status'; status.setAttribute('role', 'status'); status.hidden = true
  panel.append(header, status, layers, paper); app.append(rail, panel); app.classList.add('with-left-navigation')
  let active: LeftTab | null = null, lastMap: MindMap | null = null, lastSelection = ''
  const collapsed = new Set<string>(), rows = new Map<string, HTMLButtonElement>()
  const buttons = new Map<LeftTab, HTMLButtonElement>()
  for (const [id, label, icon] of [['layers', '图层', Layers], ['paper', '纸张', Files]] as const) {
    const b = document.createElement('button'); b.type = 'button'; b.id = id === 'paper' ? 'page-list-btn' : 'layers-btn'; b.setAttribute('aria-label', label); b.setAttribute('aria-controls', 'editor-left-panel'); b.setAttribute('aria-expanded', 'false'); b.append(createElement(icon), Object.assign(document.createElement('span'), { textContent: label })); b.onclick = () => show(active === id ? null : id); rail.append(b); buttons.set(id, b)
  }
  function show(next: LeftTab | null) {
    if (next===active) return
    active = next; panel.hidden = !next; layers.hidden = next !== 'layers'; paper.hidden = next !== 'paper'; title.textContent = next === 'paper' ? '纸张' : '图层'
    app.classList.toggle('left-panel-open', !!next)
    for (const [id, b] of buttons) { b.setAttribute('aria-expanded', String(next === id)); b.classList.toggle('active', next === id) }
    host.changed(!!next)
    sync()
  }
  close.onclick = () => show(null)
  const icons: Record<string, IconNode> = { node: Type, image: Image, sticker: Shapes, ink: Pencil, table: Table2, edge: Waypoints, group: Frame }
  function entry(item: LayerEntry, parent: HTMLElement, depth: number) {
    const li = document.createElement('li'), row = document.createElement('div'); row.className = 'layer-row'; row.style.setProperty('--depth', String(depth))
    const nested = document.createElement('ul'); nested.hidden = collapsed.has(item.id)
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'layer-expand'; toggle.append(createElement(ChevronRight)); toggle.setAttribute('aria-label', `展开或收起：${item.label}`)
    if (!item.children.length) { toggle.disabled = true; toggle.setAttribute('aria-hidden', 'true'); toggle.tabIndex = -1 }
    const expanded = () => toggle.setAttribute('aria-expanded', String(!nested.hidden))
    expanded(); toggle.onclick = () => { nested.hidden = !nested.hidden; if (nested.hidden) collapsed.add(item.id); else collapsed.delete(item.id); expanded() }
    const b = document.createElement('button'); b.type = 'button'; b.className = 'layer-item'; b.dataset.layerId = item.id; b.title = item.label; b.append(createElement(icons[item.kind] ?? Shapes), Object.assign(document.createElement('span'), { textContent: item.label })); b.onclick = () => { status.hidden = true; host.locate(item.id) }; rows.set(item.id, b)
    row.append(toggle, b); li.append(row); parent.append(li)
    if (item.children.length) { li.append(nested); item.children.forEach(child => entry(child, nested, depth + 1)) }
  }
  function sync() {
    const map = host.map()
    if (lastMap !== map) {
      const focusId = (document.activeElement as HTMLElement)?.dataset.layerId
      lastMap = map; rows.clear(); layers.replaceChildren()
      for (const g of layerGroups(map)) {
        const section = document.createElement('section'); section.className = 'layer-group'
        const heading = document.createElement('button'); heading.type = 'button'; heading.className = 'layer-group-heading'; heading.append(createElement(g.page ? Files : Layers), Object.assign(document.createElement('span'), { textContent: g.label })); heading.onclick = () => { if (g.page) host.selectPage(g.id); else { list.hidden = !list.hidden; heading.setAttribute('aria-expanded', String(!list.hidden)) } }
        const count = document.createElement('small'); count.textContent = String(g.children.length); heading.append(count)
        const list = document.createElement('ul'); section.append(heading, list); layers.append(section)
        g.children.forEach(item => entry(item, list, 0))
        if (!g.children.length) list.append(Object.assign(document.createElement('li'), { className: 'layer-empty', textContent: '暂无内容' }))
      }
      if (focusId) rows.get(focusId)?.focus({ preventScroll: true })
    }
    const selected = new Set(host.selected())
    for (const [id, b] of rows) { b.classList.toggle('selected', selected.has(id)); b.setAttribute('aria-pressed', String(selected.has(id))) }
    const selectionKey = [...selected].join(',')
    if (selectionKey !== lastSelection) {
      lastSelection = selectionKey
      const chosen = rows.get([...selected].at(-1) ?? '')
      for (let parent = chosen?.parentElement; parent && parent !== layers; parent = parent.parentElement) {
        if (parent.tagName !== 'UL' || !parent.hidden) continue
        parent.hidden = false
        const row = parent.previousElementSibling
        row?.querySelector('.layer-expand')?.setAttribute('aria-expanded', 'true')
        const id = row?.querySelector<HTMLElement>('[data-layer-id]')?.dataset.layerId
        if (id) collapsed.delete(id)
      }
      if (active === 'layers') chosen?.scrollIntoView({block:'nearest'})
    }
  }
  layers.addEventListener('keydown', e => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return
    const visible = [...layers.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')].filter(b => !!b.getClientRects().length)
    const index = visible.indexOf(document.activeElement as HTMLButtonElement)
    e.preventDefault(); e.stopPropagation(); visible[e.key === 'Home' ? 0 : e.key === 'End' ? visible.length - 1 : Math.max(0, Math.min(visible.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus()
  })
  return { paper, sync, show, active: () => active, notice(text: string) { status.textContent = text; status.hidden = !text }, unmount() { rail.remove(); panel.remove(); app.classList.remove('with-left-navigation', 'left-panel-open'); for (const key of ['--canvas-left', '--canvas-right', '--canvas-top', '--canvas-bottom']) app.style.removeProperty(key) } }
}
