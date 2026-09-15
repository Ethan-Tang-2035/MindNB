import { reflowTextBoxes } from './text-box.ts'
import { setActionContent } from './ui-controls.ts'
import { menuIcon, toolbarIcon } from './icons.ts'
import { setTooltip } from './tooltip.ts'
import { createBrandIcon } from './brand.ts'
/**
 * 首页：文档卡片网格。词汇见 CONTEXT.md（首页、卡片、缩略图、新建卡片、名称）。
 * 设计决策见 .scratch/v3-multi-doc/spec.md：点卡片进入、点名称改名、⋯ 菜单（重命名/复制/删除）、删除轻确认无回收站。
 */
import { render, domMeasurer } from './render.ts'
import { computeWorldLayout, contentBBox } from './layout.ts'
import { displayNameOf, relTime, type DocStore, type DocMeta } from './docs.ts'
import type { MindMap } from './model.ts'
import { clearSampleTree } from './clear-sample.ts'

/** 缩略图内边距（画布坐标四周留白） */
const THUMB_PAD = 20

/** 用真实渲染管线把整棵树缩放进卡片缩略图（恒定种子 → 与编辑器内同形）。版本历史预览共用此管线（票 06） */
export function renderThumb(svg: SVGSVGElement, map: MindMap): void {
  map = reflowTextBoxes(map, domMeasurer())
  // 与 render() 内部同参预算布局（根锚点随 vw），保证包围盒与实际绘制一致
  const vw = svg.clientWidth || window.innerWidth
  const vh = svg.clientHeight || window.innerHeight
  const lay = computeWorldLayout(map, domMeasurer())
  if (!lay.nodes.length) return
  const { minX, minY, maxX, maxY } = contentBBox(lay.nodes, map)
  const bw = maxX - minX
  const bh = maxY - minY
  const k = Math.min((vw - THUMB_PAD * 2) / bw, (vh - THUMB_PAD * 2) / bh, 1)
  render(svg, map, { k, tx: vw / 2 - ((minX + maxX) / 2) * k, ty: vh / 2 - ((minY + maxY) / 2) * k })
  // Scale the complete thumbnail when the card changes size, without clipping branches.
  svg.setAttribute('viewBox', `0 0 ${vw} ${vh}`)
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
}

export function mountHome(
  store: DocStore,
  open: (id: string) => void,
  onDocRemoved?: (id: string) => void,
  /** 版本历史入口（票 06）：面板本体在 versions.ts，home 只递 id 与显示名 */
  onShowVersions?: (id: string, name: string) => void,
): { unmount(): void } {
  const rootEl = document.createElement('div')
  rootEl.id = 'home'
  const title = document.createElement('h1')
  title.className = 'home-title'
  const logo = createBrandIcon('home-logo')
  title.append(logo, document.createTextNode('我的导图'))
  const grid = document.createElement('div')
  grid.className = 'home-grid'
  const libraryActions = document.createElement('div')
  libraryActions.id = 'home-library-actions'
  rootEl.append(title, libraryActions, grid)
  document.getElementById('app')!.appendChild(rootEl)

  /** 临时收尾（菜单浮层）：refresh/unmount 都要冲 —— refresh 会拆掉浮层所在 DOM，监听必须同步清 */
  const transient: Array<() => void> = []
  /** 字体事件撞上忙 UI 的挂起标记：下一次空闲 refresh 兑现 */
  let pendingFontRefresh = false
  /** 持续收尾（确认框）：只随 unmount 清 —— 它挂在 rootEl 下不随 refresh 拆除，
   * 若误入 transient，字体子集就绪回调（loadingdone → refresh）会把打开中的确认框静默关掉（验收走查实录） */
  const sustained: Array<() => void> = []
  const unregister = (arr: Array<() => void>, fn: () => void) => {
    const i = arr.indexOf(fn)
    if (i >= 0) arr.splice(i, 1)
  }
  /** 先整批摘下再逐个调：避免 closer 内部的 splice 边冲边改同一数组（splice(-1) 误删相邻项） */
  const flush = (list: Array<() => void>) => list.splice(0).forEach((f) => f())

  function refresh(): void {
    // 字体懒加载事件（loadingdone）会在菜单浮层/行内改名进行中到达，而 refresh 拆掉其宿主 DOM：
    // 忙时推迟到下一次空闲刷新（remote-truth 票 05 端到端走查发现的既有尾巴；确认框在 rootEl 下不受影响）
    if (rootEl.querySelector('.menu-pop, .card-name-input')) {
      pendingFontRefresh = true
      return
    }
    pendingFontRefresh = false
    flush(transient)
    grid.innerHTML = ''
    grid.appendChild(newCard())
    const documents = store.list()
    if (!documents.length) grid.appendChild(sampleCard())
    for (const meta of documents) {
      const tree = store.loadTree(meta.id)
      if (!tree) continue
      grid.appendChild(docCard(meta, tree))
    }
  }


  // ---- 新建卡片（网格首格，与文档卡片同构） ----
  function newCard(): HTMLElement {
    const card = document.createElement('button')
    card.type = 'button'
    card.setAttribute('aria-label', '新建导图')
    card.className = 'card new-card'
    const thumb = document.createElement('div')
    thumb.className = 'card-thumb'
    const plus = document.createElement('span')
    plus.className = 'new-plus'
    plus.append(toolbarIcon('add')!)
    thumb.appendChild(plus)
    const meta = document.createElement('div')
    meta.className = 'card-meta'
    const name = document.createElement('div')
    name.className = 'card-name'
    name.textContent = '新建导图'
    meta.appendChild(name)
    card.append(thumb, meta)
    card.addEventListener('click', () => {
      const created = store.create()
      open(created.id)
    })
    return card
  }

  /** Empty-library preview; create a real editable document only when opened. */
  function sampleCard(): HTMLElement {
    const tree = clearSampleTree()
    tree.root.text = '学习用思维导图（示例）'
    const card = document.createElement('button')
    card.type = 'button'
    card.className = 'card sample-card'
    card.setAttribute('aria-label', '打开学习用思维导图（示例）')
    const thumb = document.createElement('div')
    thumb.className = 'card-thumb'
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.classList.add('card-thumb-svg')
    thumb.append(svg)
    const meta = document.createElement('div')
    meta.className = 'card-meta'
    const name = document.createElement('div')
    name.className = 'card-name'
    name.textContent = tree.root.text
    const hint = document.createElement('div')
    hint.className = 'card-time'
    hint.textContent = '打开即可编辑'
    meta.append(name, hint)
    card.append(thumb, meta)
    card.onclick = () => {
      card.disabled = true
      const document = store.create()
      store.save(document.id, tree)
      open(document.id)
    }
    requestAnimationFrame(() => { if (card.isConnected) renderThumb(svg, tree) })
    return card
  }

  function docCard(meta: DocMeta, tree: MindMap): HTMLElement {
    const name = displayNameOf(meta, tree.root.text)
    const card = document.createElement('div')
    card.className = 'card'
    card.dataset.id = meta.id
    const thumb = document.createElement('div')
    thumb.className = 'card-thumb'
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.classList.add('card-thumb-svg')
    thumb.appendChild(svg)
    const menuBtn = document.createElement('button')
    menuBtn.className = 'card-menu'
    menuBtn.append(toolbarIcon('toolbar-more-btn')!)
    setTooltip(menuBtn, '文档操作')
    const metaEl = document.createElement('div')
    metaEl.className = 'card-meta'
    const nameEl = document.createElement('div')
    nameEl.className = 'card-name'
    nameEl.textContent = name
    nameEl.title = '点击重命名'
    const timeEl = document.createElement('div')
    timeEl.className = 'card-time'
    timeEl.textContent = relTime(meta.updatedAt, Date.now())
    metaEl.append(nameEl, timeEl)
    card.append(thumb, menuBtn, metaEl)

    card.addEventListener('click', () => {
      // 改名中的点击不进文档（input 自己 stopPropagation，这里到不了）
      open(meta.id)
    })
    nameEl.addEventListener('click', (e) => {
      e.stopPropagation()
      startRename(card, meta, name)
    })
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      openMenu(card, meta, name)
    })
    // 缩略图须在卡片进 DOM 后渲染（render 依赖 clientWidth）
    requestAnimationFrame(() => {
      if (card.isConnected) renderThumb(svg, tree)
    })
    return card
  }

  // ---- 行内改名：Enter/失焦提交，Esc/空串取消 ----
  function startRename(card: HTMLElement, meta: DocMeta, current: string): void {
    const nameEl = card.querySelector<HTMLElement>('.card-name')!
    if (nameEl.querySelector('input')) return
    const input = document.createElement('input')
    input.className = 'card-name-input'
    input.value = current
    input.addEventListener('click', (e) => e.stopPropagation())
    let settled = false
    const commit = (apply: boolean) => {
      if (settled) return
      settled = true // Removing a focused input can synchronously fire blur.
      const v = input.value.trim()
      input.remove()
      nameEl.textContent = current
      if (apply && v && v !== current) store.rename(meta.id, v)
      refresh()
    }
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') commit(true)
      else if (e.key === 'Escape') commit(false)
    })
    input.addEventListener('blur', () => commit(true))
    nameEl.textContent = ''
    nameEl.appendChild(input)
    input.focus()
    input.select()
  }

  // ---- ⋯ 菜单 ----
  function openMenu(card: HTMLElement, meta: DocMeta, name: string): void {
    flush(transient)
    const pop = document.createElement('div')
    pop.className = 'menu-pop'
    const close = () => {
      pop.remove()
      document.removeEventListener('mousedown', onDoc, true)
      document.removeEventListener('keydown', onKey, true)
      unregister(transient, close)
      if (pendingFontRefresh) refresh() // 忙时挂起的字体刷新：菜单一关就兑现（refresh 已先清标记，无递归）
    }
    const onDoc = (e: Event) => {
      if (!pop.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    const item = (label: string, fn: () => void) => {
      const b = document.createElement('button')
      b.className = label === '删除' ? 'menu-item danger' : 'menu-item'
      b.append(menuIcon(label), document.createTextNode(label))
      b.addEventListener('click', (e) => {
        e.stopPropagation()
        close()
        fn()
      })
      pop.appendChild(b)
    }
    item('重命名', () => startRename(card, meta, name))
    item('复制', () => {
      store.copy(meta.id)
      refresh()
    })
    item('版本历史', () => onShowVersions?.(meta.id, name))
    item('删除', () => confirmDelete(meta, name))
    card.appendChild(pop)
    document.addEventListener('mousedown', onDoc, true)
    document.addEventListener('keydown', onKey, true)
    transient.push(close)
  }

  // ---- 删除轻确认（无回收站） ----
  function confirmDelete(meta: DocMeta, name: string): void {
    const mask = document.createElement('div')
    mask.className = 'modal-mask'
    const modal = document.createElement('div')
    modal.className = 'modal'
    const text = document.createElement('div')
    text.className = 'modal-text'
    text.textContent = window.mindNBDesktop ? `将「${name}」移入回收站，可恢复。` : `删除「${name}」后不可恢复`
    const btns = document.createElement('div')
    btns.className = 'modal-btns'
    const cancel = document.createElement('button')
    setActionContent(cancel, '取消', 'close')
    const del = document.createElement('button')
    del.className = 'danger'
    setActionContent(del, '删除', 'delete')
    btns.append(cancel, del)
    modal.append(text, btns)
    mask.appendChild(modal)
    rootEl.appendChild(mask)
    const close = () => {
      mask.remove()
      document.removeEventListener('keydown', onKey, true)
      unregister(sustained, close)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    cancel.addEventListener('click', close)
    mask.addEventListener('mousedown', (e) => {
      if (e.target === mask) close()
    })
    del.addEventListener('click', () => {
      store.remove(meta.id)
      onDocRemoved?.(meta.id)
      close()
      refresh()
    })
    document.addEventListener('keydown', onKey, true)
    sustained.push(close)
    del.focus()
  }

  refresh()

  // 中文 webfont 按字形子集懒加载：字体到位后重测宽度重渲缩略图（与编辑器同策略）
  const rerender = () => refresh()
  document.fonts?.ready.then(rerender)
  document.fonts?.addEventListener('loadingdone', rerender)

  return {
    unmount() {
      flush(transient)
      flush(sustained)
      document.fonts?.removeEventListener('loadingdone', rerender)
      rootEl.remove()
    },
  }
}
