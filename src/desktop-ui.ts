import { setActionContent } from './ui-controls.ts'
import { setTooltip } from './tooltip.ts'
import { createElement, FolderOpen, FileInput, Trash2, type IconNode } from 'lucide'
import { createBrandIcon } from './brand.ts'
import type { createDesktopStore } from './desktop-store.ts'
import type { DesktopAPI } from './vault-format.ts'
import { renderThumb } from './home.ts'

export function updateDesktopSaveState(text: string, failed: boolean, retryable = failed) {
  const state = document.getElementById('desktop-save-state')
  if (state) { state.textContent = text; state.title = text; state.dataset.failed = String(failed) }
  const retry = document.getElementById('desktop-save-retry')
  if (retry) retry.hidden = !retryable
}

export function mountDesktopControls(api: DesktopAPI, runtime: ReturnType<typeof createDesktopStore>) {
  const welcome = document.createElement('main'); welcome.id = 'desktop-welcome'
  welcome.innerHTML = `
    <div class="welcome-layout">
      <section class="welcome-intro">
        <div class="welcome-brand"><span>MindNB</span></div>
        <h1>从一个文件夹<br>开始整理想法。</h1>
        <p class="welcome-description">把灵感、计划与笔记连在一起。<br>文档和图片保存在自己的电脑里，随时可以带走。</p>
        <svg class="welcome-map" viewBox="0 0 400 170" role="img" aria-label="想法连接灵感、计划与下一步的思维导图示意">
          <path d="M155 85C205 85 205 30 254 30M155 85h98M155 85c50 0 50 55 99 55" fill="none" stroke="#bdcbbc" stroke-width="2"/>
          <rect x="10" y="59" width="148" height="52" rx="16" fill="#e4ecdf"/><text x="84" y="90" text-anchor="middle">一个新想法</text>
          <g fill="#fff" stroke="#e1e5dc"><rect x="254" y="10" width="94" height="40" rx="12"/><rect x="254" y="65" width="94" height="40" rx="12"/><rect x="254" y="120" width="94" height="40" rx="12"/></g>
          <g text-anchor="middle"><text x="301" y="35">灵感</text><text x="301" y="90">计划</text><text x="301" y="145">下一步</text></g>
        </svg>
      </section>
      <section class="welcome-setup" aria-labelledby="welcome-title">
        <div class="welcome-folder"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 10V7a2 2 0 0 1 2-2h7l3 4h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V10Zm0 2h24"/></svg></div>
        <h2 id="welcome-title">选择你的资料库</h2>
        <p>资料库就是一个文件夹，用来存放你的所有导图和图片。</p>
        <button class="welcome-primary" type="button">选择资料库 <span aria-hidden="true">↗</span></button>
        <p class="welcome-hint">可以新建一个文件夹，也可以打开已有资料库。</p>
        <div class="welcome-migration"><strong>已经在网页版写过内容？</strong><p>先选择资料库，再导入从网页版导出的 <span>.mindnb</span> 文件，即可继续编辑。</p></div>
        <p class="welcome-error" role="alert" hidden></p>
      </section>
      <footer class="welcome-footer"><span><i></i>本地保存</span><span>无需账号</span><span>离线可用</span></footer>
    </div>`
  const brandIcon = createBrandIcon('welcome-logo')
  brandIcon.alt = ''
  welcome.querySelector('.welcome-brand')!.prepend(brandIcon)
  document.body.append(welcome)
  const welcomeChoose = welcome.querySelector<HTMLButtonElement>('.welcome-primary')!
  setActionContent(welcomeChoose, '选择资料库', 'choose-vault')
  welcome.querySelector('.welcome-folder')!.replaceChildren(createElement(FolderOpen, { 'aria-hidden': 'true' }))
  const welcomeError = welcome.querySelector<HTMLElement>('.welcome-error')!
  const bar = document.createElement('div'); bar.id = 'desktop-files'
  const choose = document.createElement('button'), open = document.createElement('button')
  const action = (button: HTMLButtonElement, icon: IconNode, accessibleName: string, caption = accessibleName) => {
    button.type = 'button'
    button.className = 'desktop-action'
    setTooltip(button, accessibleName)
    button.setAttribute('aria-label', accessibleName)
    button.append(createElement(icon, { width: 20, height: 20, 'stroke-width': 1.7, 'aria-hidden': 'true' }))
    button.append(document.createTextNode(caption))
  }
  action(choose, FolderOpen, '选择资料库', '资料库')
  action(open, FileInput, '导入 .mindnb', '导入')
  const state = document.createElement('span'); state.id = 'desktop-save-state'; state.setAttribute('role', 'status'); state.textContent = '本地资料库'
  const retry = document.createElement('button'); retry.id = 'desktop-save-retry'; retry.type = 'button'; setActionContent(retry, '重试保存', 'refresh'); retry.hidden = true
  retry.onclick = async () => { retry.disabled = true; try { await runtime.retry() } catch { /* The store reports the failure. */ } finally { retry.disabled = false } }
  const saveStatus = document.createElement('div'); saveStatus.className = 'desktop-save-status'; saveStatus.append(state, retry)
  const showError = (error: unknown) => updateDesktopSaveState(String(error), true, !retry.hidden)
  function update() {
    const vault = runtime.snapshot
    setTooltip(choose, vault ? `选择资料库 · 当前：${vault.name}` : '选择资料库')
    choose.setAttribute('aria-label', '选择资料库')
    choose.title = vault ? `当前资料库：${vault.path}` : '选择资料库'
    document.body.classList.toggle('vault-missing', !vault)
  }
  const chooseVault = async () => {
    choose.disabled = true; welcomeChoose.disabled = true; welcomeError.hidden = true
    try { await runtime.flush(); if (await api.chooseVault()) { location.hash = '#/'; await runtime.refresh(true) }; update() }
    catch (e) { showError(e); welcomeError.textContent = '无法打开这个文件夹：' + String(e); welcomeError.hidden = false } finally { choose.disabled = false; welcomeChoose.disabled = false }
  }
  choose.onclick = chooseVault
  welcomeChoose.onclick = () => choose.click()
  async function importFile() {
    await runtime.flush()
    const id = await api.importFile()
    if (id) { await runtime.refresh(true); update(); location.hash = '#/doc/' + id }
  }
  open.onclick = () => { void importFile().catch(showError) }
  api.onOpen(id => { if (!id) { open.click(); return }; void runtime.flush().then(() => runtime.refresh(true)).then(() => { update(); location.hash = '#/doc/' + id }).catch(showError) })
  api.onChanged(() => { void runtime.refresh().then(update).catch(showError) })
  api.onFlush(async () => { await runtime.flush() })
  const trash = document.createElement('button'); action(trash, Trash2, '回收站')
  trash.onclick = () => { void runtime.flush().then(() => runtime.refresh()).then(() => showDeletedDocuments(api, runtime)).catch(showError) }
  const actions = document.createElement('div'); actions.className = 'desktop-actions'
  actions.append(choose, open, trash)
  // Home is remounted after library updates; reconnect its persistent controls.
  const placeActions = () => {
    const host = document.getElementById('home-library-actions')
    if (host && actions.parentElement !== host) host.append(actions)
  }
  new MutationObserver(placeActions).observe(document.getElementById('app')!, { childList: true, subtree: true })
  bar.append(saveStatus); document.body.append(bar); placeActions(); update()
  return { update, chooseVault, importFile }
}
export function showLocalHistory(api: DesktopAPI, runtime: ReturnType<typeof createDesktopStore>, id: string, changed: () => void) {
  const dialog = document.createElement('dialog'); dialog.className = 'media-dialog'; dialog.setAttribute('aria-label', '本机版本历史')
  const title = document.createElement('h2'); title.textContent = '本机版本历史'
  const note = document.createElement('p'); note.textContent = '保留本机保存前及收到的被替换版本。'
  const close = document.createElement('button'); setActionContent(close, '关闭', 'close'); close.onclick = () => dialog.close()
  const actions = document.createElement('footer'); actions.className = 'dialog-actions'; actions.append(close)
  dialog.append(title, note, actions); document.body.append(dialog); dialog.showModal(); dialog.onclose = () => dialog.remove()
  void api.history(id).then(versions => {
    if (!versions.length) note.textContent = '尚无旧版本。'
    for (const version of versions) {
      const row = document.createElement('section'), preview = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), button = document.createElement('button')
      row.className = 'local-history-row'
      preview.style.cssText = 'width:100%;height:140px'; row.append(preview, button); dialog.insertBefore(row, actions); renderThumb(preview, version.tree)
      setActionContent(button, `恢复 ${new Date(version.revision.editedAt).toLocaleString()}`, 'reset')
      button.onclick = async () => { button.disabled = true; try { await runtime.flush(); const restored = await api.restore(id, version.revision.id); await runtime.refresh(); location.hash = '#/doc/' + restored.meta.id; changed(); dialog.close() } catch (e) { note.textContent = String(e); button.disabled = false } }
    }
  }).catch(e => { note.textContent = String(e) })
  return { unmount() { dialog.close(); dialog.remove() } }
}

function showDeletedDocuments(api: DesktopAPI, runtime: ReturnType<typeof createDesktopStore>) {
  const dialog = document.createElement('dialog'); dialog.className = 'media-dialog trash-dialog'; dialog.setAttribute('aria-label', '回收站')
  const title = document.createElement('h2'); title.textContent = '回收站'
  const status = document.createElement('p'); status.className = 'trash-status'; status.setAttribute('role', 'status')
  const list = document.createElement('div'); list.className = 'trash-list'
  const footer = document.createElement('footer'); footer.className = 'trash-footer'
  const pagination = document.createElement('nav'); pagination.setAttribute('aria-label', '回收站分页')
  const previous = document.createElement('button'), next = document.createElement('button'), count = document.createElement('span')
  previous.textContent = '上一页'; next.textContent = '下一页'
  const close = document.createElement('button'); setActionContent(close, '关闭', 'close'); close.onclick = () => dialog.close()
  pagination.append(previous, count, next); footer.append(pagination, close)
  dialog.append(title, status, list, footer)
  let page = 0, busy = false
  const pageSize = 8
  function render() {
    const deleted = (runtime.snapshot?.documents.filter(d => d.meta.deletedAt != null) ?? [])
      .sort((a, b) => b.meta.deletedAt! - a.meta.deletedAt! || a.meta.id.localeCompare(b.meta.id))
    const pages = Math.max(1, Math.ceil(deleted.length / pageSize))
    page = Math.min(page, pages - 1)
    status.textContent = deleted.length ? `共 ${deleted.length} 条 · 每页 ${pageSize} 条` : '回收站是空的。'
    count.textContent = `${page + 1} / ${pages}`
    previous.disabled = busy || page === 0; next.disabled = busy || page === pages - 1
    list.replaceChildren()
    for (const doc of deleted.slice(page * pageSize, (page + 1) * pageSize)) {
      const row = document.createElement('div'); row.className = 'trash-row'
      const info = document.createElement('div'), name = document.createElement('strong'), date = document.createElement('small')
      name.textContent = doc.meta.nameOverride ?? doc.tree.root.text; name.title = name.textContent
      date.textContent = `删除于 ${new Date(doc.meta.deletedAt!).toLocaleString()}`
      info.append(name, date)
      const restore = document.createElement('button'), remove = document.createElement('button')
      setActionContent(restore, '恢复', 'reset'); remove.textContent = '永久删除'; remove.className = 'trash-delete'
      const run = async (permanent: boolean) => {
        if (busy) return
        busy = true
        for (const button of dialog.querySelectorAll('button')) button.disabled = true
        try {
          if (permanent) await api.permanentlyDelete(doc.meta.id)
          else await api.restore(doc.meta.id, doc.revision.id)
          await runtime.refresh(true)
          busy = false; render()
        } catch (e) { busy = false; render(); status.textContent = String(e) }
        close.disabled = false
      }
      restore.onclick = () => void run(false); remove.onclick = () => void run(true)
      row.append(info, restore, remove); list.append(row)
    }
  }
  previous.onclick = () => { page--; render() }; next.onclick = () => { page++; render() }
  render(); document.body.append(dialog); dialog.showModal(); dialog.onclose = () => dialog.remove()
}

/** Keep unavailable cloud images visible as a bounded placeholder, without editing the model. */
export function markUnavailableImages(svg: SVGSVGElement) {
  for (const image of svg.querySelectorAll<SVGImageElement>('image')) {
    if (!(image.getAttribute('href') ?? image.getAttribute('xlink:href') ?? '').startsWith('mindnb://asset/')) continue
    image.addEventListener('error', () => {
      if (!image.isConnected || image.nextElementSibling?.hasAttribute('data-asset-placeholder')) return
      const placeholder = document.createElementNS(svg.namespaceURI, 'rect')
      for (const attr of ['x', 'y', 'width', 'height', 'transform']) { const value = image.getAttribute(attr); if (value !== null) placeholder.setAttribute(attr, value) }
      placeholder.setAttribute('fill', '#eeeee6'); placeholder.setAttribute('stroke', '#999b90'); placeholder.setAttribute('stroke-dasharray', '4 4')
      placeholder.setAttribute('pointer-events', 'none'); placeholder.setAttribute('data-asset-placeholder', '')
      const title = document.createElementNS(svg.namespaceURI, 'title'); title.textContent = '图片暂不可用，文件下载后自动恢复'; placeholder.append(title)
      image.after(placeholder)
      image.addEventListener('load', () => placeholder.remove(), { once: true })
    }, { once: true })
  }
}
