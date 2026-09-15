import { setActionContent } from './ui-controls.ts'
import { toolbarIcon } from './icons.ts'
import { setTooltip } from './tooltip.ts'
/**
 * 版本历史面板（票 06）。词汇见 CONTEXT.md「版本历史」（≠ 撤销历史：那是编辑器内存里的回退步）。
 * 首页 ⋯ 菜单打开：savedAt 新→旧列表（relTime 显示），点行预览（renderThumb 与卡片缩略图同管线），
 * 恢复 = 走普通保存链路写回本地缓存（当前内容先自动进版本 —— 服务端快照，spec §⑤）。
 * 离线：面板只读远端，给「需要联网查看版本历史」+ 重试，不假装可用。
 */
import { renderThumb } from './home.ts'
import { relTime, type DocStore } from './docs.ts'
import type { MindMap } from './model.ts'
import { NetworkError, type RemoteClient } from './remote.ts'

export interface VersionsPanelOptions {
  remote: RemoteClient
  store: DocStore
  docId: string
  docName: string
  /** 恢复成功后：首页缩略图要按新内容刷新（main.ts 重挂首页） */
  onRestored?: () => void
}

export function mountVersionsPanel(opts: VersionsPanelOptions): { unmount(): void } {
  const { remote, store, docId, docName } = opts
  let alive = true
  const disposers: Array<() => void> = []
  const on = (target: EventTarget, type: string, fn: EventListener, capture?: boolean) => {
    target.addEventListener(type, fn, capture)
    disposers.push(() => target.removeEventListener(type, fn, capture))
  }

  const mask = document.createElement('div')
  mask.className = 'modal-mask ver-mask'
  const card = document.createElement('div')
  card.className = 'modal ver-card'

  const head = document.createElement('div')
  head.className = 'ver-head'
  const title = document.createElement('div')
  title.className = 'ver-title'
  title.textContent = '版本历史'
  const sub = document.createElement('div')
  sub.className = 'ver-sub'
  sub.textContent = docName
  const closeBtn = document.createElement('button')
  closeBtn.className = 'ver-close'
  closeBtn.append(toolbarIcon('close')!)
  setTooltip(closeBtn, '关闭版本历史')
  closeBtn.setAttribute('aria-label', '关闭')
  head.append(title, sub, closeBtn)

  const body = document.createElement('div')
  body.className = 'ver-body'
  const list = document.createElement('div')
  list.className = 'ver-list'
  const previewWrap = document.createElement('div')
  previewWrap.className = 'ver-preview-wrap'
  const preview = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  preview.setAttribute('class', 'ver-preview')
  const previewHint = document.createElement('div')
  previewHint.className = 'ver-preview-hint'
  previewHint.textContent = '点左侧版本可预览'
  previewWrap.append(preview, previewHint)
  body.append(list, previewWrap)

  const status = document.createElement('div')
  status.className = 'ver-status'

  card.append(head, status, body)
  mask.appendChild(card)
  document.getElementById('app')!.appendChild(mask)

  /** 已取回的版本内容缓存：预览与恢复共用，恢复零额外往返 */
  const cache = new Map<number, MindMap>()
  let activeRow: HTMLElement | null = null

  function setStatus(text: string, retry = false): void {
    status.textContent = text
    status.style.display = text ? 'block' : 'none'
    status.innerHTML = ''
    status.textContent = text
    if (retry) {
      const btn = document.createElement('button')
      btn.className = 'ver-retry'
      setActionContent(btn, '重试', 'refresh')
      btn.addEventListener('click', () => void load())
      status.appendChild(btn)
    }
  }

  async function fetchVersion(savedAt: number): Promise<MindMap | null> {
    const hit = cache.get(savedAt)
    if (hit) return hit
    try {
      const v = await remote.getVersion(docId, savedAt)
      if (v) cache.set(savedAt, v.tree)
      return v?.tree ?? null
    } catch (e) {
      if (e instanceof NetworkError) setStatus('需要联网查看版本历史', true)
      return null
    }
  }

  function row(savedAt: number): HTMLElement {
    const r = document.createElement('div')
    r.className = 'ver-row'
    const t = document.createElement('span')
    t.className = 'ver-time'
    t.textContent = relTime(savedAt, Date.now())
    t.title = new Date(savedAt).toLocaleString()
    const restore = document.createElement('button')
    restore.className = 'ver-restore'
    setActionContent(restore, '恢复', 'reset')
    let confirming = false
    const cancel = document.createElement('button')
    cancel.className = 'ver-cancel'
    setActionContent(cancel, '取消', 'close')
    cancel.style.display = 'none'
    cancel.addEventListener('click', (e) => {
      e.stopPropagation()
      confirming = false
      setActionContent(restore, '恢复', 'reset')
      cancel.style.display = 'none'
    })
    restore.addEventListener('click', (e) => {
      e.stopPropagation()
      if (!confirming) {
        // 两步确认（删除确认同款克制）：恢复会把当前内容顶进版本历史
        confirming = true
        setActionContent(restore, '确认恢复？当前内容会进入版本历史', 'reset')
        cancel.style.display = ''
        return
      }
      void doRestore(savedAt)
    })
    r.append(t, restore, cancel)
    r.addEventListener('click', () => void showPreview(savedAt, r))
    return r
  }

  async function showPreview(savedAt: number, r: HTMLElement): Promise<void> {
    const tree = await fetchVersion(savedAt)
    if (!alive || !tree) return
    activeRow?.classList.remove('active')
    r.classList.add('active')
    activeRow = r
    previewHint.textContent = relTime(savedAt, Date.now()) + ' 的快照'
    renderThumb(preview, tree)
  }

  async function doRestore(savedAt: number): Promise<void> {
    const tree = await fetchVersion(savedAt)
    if (!tree) return
    // 走普通保存链路：本地缓存 + 防抖推送；服务端把被替换的当前内容先入版本（spec §⑤）
    store.save(docId, tree)
    close()
    opts.onRestored?.()
  }

  async function load(): Promise<void> {
    list.innerHTML = ''
    setStatus('正在读取版本…')
    try {
      const stamps = await remote.getVersions(docId)
      if (!alive) return
      if (!stamps.length) {
        setStatus('还没有历史版本 —— 改动保存后自动生成')
        return
      }
      setStatus('')
      for (const s of stamps) list.appendChild(row(s))
    } catch {
      if (!alive) return
      setStatus('需要联网查看版本历史', true)
    }
  }

  function close(): void {
    unmount()
  }

  on(closeBtn, 'click', close)
  on(mask, 'click', (e) => {
    if (e.target === mask) close()
  })
  on(window, 'keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Escape') close()
  })

  function unmount(): void {
    if (!alive) return
    alive = false
    for (const d of disposers) d()
    mask.remove()
  }

  void load()
  return { unmount }
}
