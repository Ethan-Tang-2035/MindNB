import { setActionContent } from './ui-controls.ts'
/**
 * 覆盖警告对话框（票 07；spec §④，词汇见 CONTEXT.md「覆盖警告」）。
 * 引擎推送吃 409 conflict 后暂停该文档并回调到这里，两个出口：
 * 覆盖远端 = force 重发（对方内容被顶掉，其下次拉取见新）；
 * 放弃本机修改 = 回到远端 tree+meta（调用方清撤销历史并重载编辑器）。
 * Esc / 点遮罩 = 放弃本机修改：默认走不毁他人数据的保守方向。
 */
import { relTime } from './docs.ts'

export interface ConflictDialogOptions {
  docName: string
  /** 远端条目更新时间（服务器时钟）；null = 回包没带条目，文案降级 */
  remoteUpdatedAt: number | null
  onOverwrite: () => void
  onDiscard: () => void
}

export function showConflictDialog(opts: ConflictDialogOptions): { unmount(): void } {
  let alive = true
  const disposers: Array<() => void> = []
  const on = (target: EventTarget, type: string, fn: EventListener, capture?: boolean) => {
    target.addEventListener(type, fn, capture)
    disposers.push(() => target.removeEventListener(type, fn, capture))
  }

  const mask = document.createElement('div')
  mask.className = 'modal-mask conflict-mask'
  const card = document.createElement('div')
  card.className = 'modal conflict-card'

  const title = document.createElement('div')
  title.className = 'conflict-title'
  title.textContent = '覆盖警告'
  const text = document.createElement('div')
  text.className = 'modal-text'
  const when = opts.remoteUpdatedAt === null ? '' : '（' + relTime(opts.remoteUpdatedAt, Date.now()) + '）'
  text.textContent = '《' + opts.docName + '》远端有更新的修改' + when + '。继续保存会顶掉对方的版本；也可放弃本机修改、回到远端内容。'

  const btns = document.createElement('div')
  btns.className = 'modal-btns'
  const discardBtn = document.createElement('button')
  setActionContent(discardBtn, '放弃本机修改', 'reset')
  const overwriteBtn = document.createElement('button')
  overwriteBtn.className = 'danger'
  setActionContent(overwriteBtn, '覆盖远端', 'confirm')
  btns.append(discardBtn, overwriteBtn)
  card.append(title, text, btns)
  mask.appendChild(card)
  document.getElementById('app')!.appendChild(mask)

  function unmount(): void {
    if (!alive) return
    alive = false
    for (const d of disposers) d()
    mask.remove()
  }

  overwriteBtn.addEventListener('click', () => {
    unmount()
    opts.onOverwrite()
  })
  discardBtn.addEventListener('click', () => {
    unmount()
    opts.onDiscard()
  })
  on(mask, 'click', (e) => {
    if (e.target === mask) {
      unmount()
      opts.onDiscard()
    }
  })
  on(window, 'keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Escape') {
      unmount()
      opts.onDiscard()
    }
  })
  return { unmount }
}
