import { setActionContent } from './ui-controls.ts'
/** Document metadata has its own name; renaming never edits the root node. */
export function openRenameDialog(name: string, saveName: (name: string) => void) {
  const dialog = document.createElement('dialog')
  dialog.className = 'media-dialog rename-dialog'
  dialog.setAttribute('aria-labelledby', 'rename-dialog-title')
  const form = document.createElement('form')
  const title = document.createElement('h2')
  title.id = 'rename-dialog-title'
  title.textContent = '重命名文档'
  const label = document.createElement('label')
  label.className = 'dialog-field'
  label.textContent = '文档名称'
  const input = document.createElement('input')
  input.name = 'name'
  input.value = name
  input.required = true
  input.autocomplete = 'off'
  label.append(input)
  const actions = document.createElement('footer')
  actions.className = 'dialog-actions'
  const cancel = document.createElement('button')
  cancel.type = 'button'
  setActionContent(cancel, '取消', 'close')
  cancel.onclick = () => dialog.close()
  const save = document.createElement('button')
  save.type = 'submit'
  save.className = 'dialog-primary'
  setActionContent(save, '保存名称', 'confirm')
  input.oninput = () => { save.disabled = !input.value.trim() }
  // The Enter used to accept an IME candidate must not submit the form.
  input.onkeydown = event => { if (event.key === 'Enter' && event.isComposing) event.preventDefault() }
  form.onsubmit = event => {
    event.preventDefault()
    const next = input.value.trim()
    if (!next) { input.focus(); return }
    if (next !== name) saveName(next)
    dialog.close()
  }
  actions.append(cancel, save)
  form.append(title, label, actions)
  dialog.append(form)
  dialog.onclose = () => dialog.remove()
  document.body.append(dialog)
  dialog.showModal()
  input.focus()
  input.select()
}
