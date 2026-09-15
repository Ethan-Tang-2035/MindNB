import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import type { DesktopCommand, DesktopMenuState } from '../src/desktop-commands.ts'

export function installMenu(window: BrowserWindow, reload: () => void) {
  let state: DesktopMenuState = { vault: false, document: false, modal: false, textEditing: false, canUndo: false, canRedo: false, node: false, sibling: false }
  const command = (id: DesktopCommand, label: string, accelerator?: string): MenuItemConstructorOptions => ({
    id, label, accelerator, enabled: false,
    click: () => {
      if (state.textEditing && (id === 'undo' || id === 'redo')) window.webContents[id]()
      else window.webContents.send('desktop:command', id)
    },
  })
  const menu = Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { label: '文件', submenu: [
      command('new', '新建导图', 'CmdOrCtrl+N'),
      command('import', '导入 .mindnb…', 'CmdOrCtrl+O'),
      { type: 'separator' }, command('save', '保存', 'CmdOrCtrl+S'), command('rename', '重命名…'),
      { type: 'separator' }, command('export-png', '导出为 PNG…', 'CmdOrCtrl+Shift+E'),
      command('export', '导出其他格式…', 'CmdOrCtrl+Alt+E'),
      { type: 'separator' }, command('choose-vault', '选择资料库…', 'CmdOrCtrl+Shift+O'),
      { type: 'separator' }, { role: 'close', label: '关闭窗口' },
    ] },
    { label: '编辑', submenu: [
      command('undo', '撤销', 'CmdOrCtrl+Z'), command('redo', '重做', 'CmdOrCtrl+Shift+Z'),
      { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' },
      { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' },
    ] },
    { label: '节点', submenu: [
      command('child', '新增子级', 'CmdOrCtrl+Alt+Return'), command('sibling', '新增同级', 'CmdOrCtrl+Shift+Return'),
      command('edit-node', '编辑节点文字', 'F2'), command('link', '添加关系线', 'CmdOrCtrl+Shift+R'),
    ] },
    { label: '视图', submenu: [
      command('home', '回到首页', 'CmdOrCtrl+Shift+H'), { type: 'separator' },
      command('zoom-in', '放大', 'CmdOrCtrl+Plus'), command('zoom-out', '缩小', 'CmdOrCtrl+-'),
      command('zoom-reset', '实际大小', 'CmdOrCtrl+1'), command('zoom-fit', '适应窗口', 'CmdOrCtrl+0'),
      { type: 'separator' }, command('panel', '显示／隐藏格式面板', 'CmdOrCtrl+Alt+I'),
      { role: 'togglefullscreen', label: '进入／退出全屏' },
      { type: 'separator' }, { id: 'reload', label: '重新载入', accelerator: 'CmdOrCtrl+R', click: reload },
    ] },
    { label: '窗口', submenu: [{ role: 'minimize', label: '最小化' }, { role: 'zoom', label: '缩放窗口' }, { type: 'separator' }, { role: 'front', label: '全部置于前台' }] },
  ])
  Menu.setApplicationMenu(menu)
  return (next: DesktopMenuState) => {
    state = next
    const enable = (id: string, enabled: boolean) => { menu.getMenuItemById(id)!.enabled = enabled }
    const document = state.document && !state.modal
    for (const id of ['import', 'choose-vault', 'reload']) enable(id, !state.modal)
    enable('new', state.vault && !state.modal)
    for (const id of ['save', 'rename', 'export-png', 'export', 'home', 'zoom-in', 'zoom-out', 'zoom-reset', 'zoom-fit', 'panel']) enable(id, document)
    enable('undo', state.textEditing || (document && state.canUndo))
    enable('redo', state.textEditing || (document && state.canRedo))
    for (const id of ['child', 'edit-node']) enable(id, document && !state.textEditing && state.node)
    enable('sibling', document && !state.textEditing && state.sibling)
    enable('link', document && !state.textEditing)
  }
}
