import { startAgentBridge, type BridgeRequest, type BridgeResponse } from './agent-bridge.ts'
import { savePageFiles } from './page-files.ts'
import { LEGACY_BRAND, isPortablePath } from '../src/legacy-brand.ts'
import { migrateUserData } from './brand-migration.ts'
import { app, BrowserWindow, dialog, ipcMain, protocol, net, shell, session } from 'electron'
import { installMenu } from './menu.ts'
import type { ExportSaveRequest } from '../src/desktop-commands.ts'
import { readFile, mkdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { VaultRepository } from './vault.ts'
import { atomicWrite, confined, localFiles, macFiles } from './file-access.ts'
import { MAX_PACKAGE_BYTES, imageType } from '../src/vault-format.ts'

protocol.registerSchemesAsPrivileged([{ scheme: 'mindnb', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])
app.setName('MindNB')
// Respect Electron's explicit profile directory for isolated desktop verification.
const profileDirectory = app.commandLine.getSwitchValue('user-data-dir')
app.setPath('userData', profileDirectory ? resolve(profileDirectory) : !app.isPackaged && process.env.MINDNB_DESKTOP_DATA ? resolve(process.env.MINDNB_DESKTOP_DATA) : join(app.getPath('appData'), 'MindNB'))
let window: BrowserWindow | null = null, vault: VaultRepository | null = null, allowClose = false, ready = false
const queuedFiles: string[] = []
app.on('open-file', (event, path) => { event.preventDefault(); queuedFiles.push(path); if (ready) void drainFiles() })
const lock = app.requestSingleInstanceLock()
if (!lock) app.quit()
else {
  app.on('second-instance', (_event, argv) => { queuedFiles.push(...argv.filter(isPortablePath)); window?.show(); window?.focus(); if (ready) void drainFiles() })
  void start().catch(async e => {
    // Closing during loadURL aborts navigation; it is not a startup failure.
    if (allowClose) return
    await dialog.showMessageBox({ type: 'error', message: '桌面应用无法启动', detail: String(e) })
    app.exit(1)
  })
}
const dataDir = () => app.getPath('userData')
const configPath = () => join(dataDir(), 'vault-location.json')
function fileAccess() {
  return process.platform === 'darwin' ? macFiles(join(app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'dist-desktop'), 'native', 'file-access')) : localFiles
}
async function selectVault(): Promise<boolean> {
  const result = await dialog.showOpenDialog(window!, { title: '选择资料库文件夹（可位于 iCloud Drive）', properties: ['openDirectory', 'createDirectory'] })
  if (result.canceled) return false
  const next = await VaultRepository.open(result.filePaths[0], join(dataDir(), 'vault-state'), fileAccess())
  await atomicWrite(configPath(), Buffer.from(JSON.stringify({ path: next.root })))
  vault = next
  return true
}
function repository() { if (!vault) throw new Error('请先选择资料库'); return vault }
async function importPath(path: string) {
  if (!isPortablePath(path)) throw new Error('请选择 .mindnb 文件')
  if ((await stat(path)).size > MAX_PACKAGE_BYTES) throw new Error('文档包过大')
  if (!vault && !await selectVault()) return null
  const id = await repository().import(await readFile(path))
  window?.webContents.send('vault:changed')
  return id
}
async function drainFiles() {
  while (queuedFiles.length) {
    try { const id = await importPath(queuedFiles.shift()!); if (id) window?.webContents.send('vault:open', id) }
    catch (e) { await dialog.showMessageBox(window!, { type: 'error', message: '文档导入失败', detail: String(e) }) }
  }
}
async function flushRenderer() {
  if (!ready || !window) return
  const target = window.webContents, token = randomUUID()
  await new Promise<void>((ok, no) => {
    const done = () => { clearTimeout(timer); ipcMain.removeListener('vault:flushed', receive) }
    const receive = (event: Electron.IpcMainEvent, id: string, error: string | null) => {
      if (event.sender !== target || id !== token) return
      done(); error ? no(new Error(error)) : ok()
    }
    const timer = setTimeout(() => { done(); no(new Error('等待保存超时')) }, 15_000)
    ipcMain.on('vault:flushed', receive); target.send('vault:flush', token)
  })
  await vault?.idle()
}
async function start() {
  await app.whenReady()
  if (!profileDirectory && !process.env.MINDNB_DESKTOP_DATA) await migrateUserData(app.getPath('appData'), dataDir())
  await mkdir(dataDir(), { recursive: true })
  let startupError = ''
  try {
    const path = !app.isPackaged && process.env.MINDNB_DESKTOP_VAULT || JSON.parse(await readFile(configPath(), 'utf8')).path
    if (path) vault = await VaultRepository.open(path, join(dataDir(), 'vault-state'), fileAccess())
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') startupError = String(e) }
  const publicRoot = resolve(app.getAppPath(), 'dist')
  protocol.handle('mindnb', async request => {
    try {
      const url = new URL(request.url)
      if (url.hostname === 'asset') {
        const [, vaultId, id, extra] = url.pathname.split('/')
        if (extra || !vault || vaultId !== vault.id) return new Response('Not found', { status: 404 })
        const bytes = await vault.readAsset(id)
        return new Response(bytes as Uint8Array<ArrayBuffer>, { headers: { 'Content-Type': imageType(bytes).mime, 'Access-Control-Allow-Origin': 'mindnb://app', 'Cache-Control': 'no-store' } })
      }
      if (url.hostname !== 'app') return new Response('Forbidden', { status: 403 })
      const path = await confined(publicRoot, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname).slice(1))
      const response = await net.fetch(pathToFileURL(path).href)
      response.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' mindnb: data: blob:; font-src 'self' data:; connect-src 'self' mindnb: data: blob:; worker-src 'self' blob:")
      return response
    } catch { return new Response('File unavailable', { status: 404 }) }
  })
  const productIcon = join(publicRoot, 'brand', 'icon-512.png')
  if (process.platform === 'darwin') app.dock?.setIcon(productIcon)
  app.setAboutPanelOptions({ applicationName: 'MindNB', applicationVersion: app.getVersion(), iconPath: productIcon, credits: '把想法连成清晰的思维导图。' })
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, respond) => respond(false))
  window = new BrowserWindow({ width: 1200, height: 800, minWidth: 560, minHeight: 420, show: false, title: 'MindNB', icon: productIcon,
    webPreferences: { preload: join(app.getAppPath(), 'dist-desktop', 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } })
  window.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) void shell.openExternal(url); return { action: 'deny' } })
  window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('mindnb://app/')) event.preventDefault() })
  function handle(channel: string, run: (...args: any[]) => unknown) {
    ipcMain.handle(channel, (event, ...args) => {
      if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || !event.senderFrame.url.startsWith('mindnb://app/')) throw new Error('Unauthorized IPC')
      return run(...args)
    })
  }
  handle('vault:snapshot', async () => vault ? vault.snapshot() : null)
  handle('vault:choose', async () => { return await selectVault() ? repository().snapshot() : null })
  handle('vault:save', request => repository().save(request))
  handle('vault:view', (id, view) => repository().saveView(id, view))
  handle('vault:history', id => repository().history(id))
  handle('vault:restore', (id, revision) => repository().restore(id, revision))
  handle('vault:permanently-delete', async id => {
    const target = repository()
    const doc = (await target.snapshot()).documents.find(d => d.meta.id === id)
    if (!doc || doc.meta.deletedAt == null) throw new Error('只能永久删除回收站中的文档')
    const result = await dialog.showMessageBox(window!, {
      type: 'warning', title: '永久删除文档',
      message: `永久删除「${doc.meta.nameOverride ?? doc.tree.root.text}」？`,
      detail: '文档及本机版本历史将被删除，无法恢复。',
      buttons: ['取消', '永久删除'], defaultId: 0, cancelId: 0, noLink: true,
    })
    if (result.response !== 1) return false
    await target.permanentlyDelete(id)
    return true
  })
  handle('vault:import', async () => {
    const result = await dialog.showOpenDialog(window!, { title: '导入可编辑文档', filters: [{ name: 'MindNB', extensions: ['mindnb', LEGACY_BRAND.extension] }], properties: ['openFile'] })
    return result.canceled ? null : importPath(result.filePaths[0])
  })
  const updateMenu = installMenu(window, () => { void flushRenderer().then(() => window?.webContents.reload()).catch(e => dialog.showMessageBox(window!, { type: 'error', message: '保存失败，未重新载入', detail: String(e) })) })
  handle('desktop:menu-state', updateMenu)
  let savingExport = false
  handle('desktop:export', async (request: ExportSaveRequest) => {
    if (savingExport) throw new Error('请先完成当前导出')
    if (!request || typeof request.name !== 'string' || !['mindnb', 'png', 'jpg', 'svg', 'pdf', 'md', 'docx', 'xlsx', 'opml', 'textbundle.zip'].includes(request.extension)
      || !(request.bytes instanceof Uint8Array) || !request.bytes.length || request.bytes.length > MAX_PACKAGE_BYTES) throw new Error('无效的导出文件')
    savingExport = true
    try {
      const name = (request.name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().slice(0, 100) || '思维导图') + '.' + request.extension
      const result = await dialog.showSaveDialog(window!, {
        title: '导出文档', buttonLabel: '保存', defaultPath: join(app.getPath('downloads'), name),
        filters: [{ name: request.extension.toUpperCase(), extensions: [request.extension.split('.').at(-1)!] }],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      })
      if (result.canceled || !result.filePath) return { canceled: true }
      await atomicWrite(result.filePath, request.bytes)
      return { canceled: false, path: result.filePath }
    } finally { savingExport = false }
  })
  handle('desktop:export-pages', async (files: ExportSaveRequest[]) => {
    if(savingExport)throw new Error('请先完成当前导出')
    savingExport=true
    try {const chosen=await dialog.showOpenDialog(window!,{title:'选择纸页图片保存文件夹',buttonLabel:'保存纸页',properties:['openDirectory','createDirectory']});if(chosen.canceled||!chosen.filePaths[0])return{canceled:true};return{canceled:false,paths:await savePageFiles(chosen.filePaths[0],files)}}finally{savingExport=false}
  })
  window.on('close', event => {
    if (allowClose) return
    event.preventDefault()
    void flushRenderer().then(() => { allowClose = true; window?.close() }).catch(async e => {
      const answer = await dialog.showMessageBox(window!, { type: 'warning', message: '仍有内容未保存', detail: `${String(e)}\n继续等待可以重试保存。`, buttons: ['继续编辑', '仍然退出'], defaultId: 0, cancelId: 0 })
      if (answer.response === 1) { allowClose = true; window?.close() }
    })
  })
  // Register before navigation: the user can close while startup assets load.
  let poll: ReturnType<typeof setInterval> | undefined
  window.once('closed', () => {
    if (poll) clearInterval(poll)
    window = null
    ready = false
    app.quit()
  })
  await window.loadURL('mindnb://app/')
  if (!window) return
  window.show(); ready = true
  const agentSocket = app.commandLine.getSwitchValue('agent-bridge')
  if (agentSocket) {
    const target = window.webContents
    const dispatch = (request: BridgeRequest) => new Promise<BridgeResponse>((ok, fail) => {
      const finish = () => { clearTimeout(timer); ipcMain.removeListener('agent:response', receive) }
      const receive = (event: Electron.IpcMainEvent, id: string, response: BridgeResponse) => {
        if (event.sender !== target || event.senderFrame !== target.mainFrame || !event.senderFrame.url.startsWith('mindnb://app/') || id !== request.id) return
        finish()
        if (!response || typeof response !== 'object' || (!('result' in response) && !('error' in response))) { fail(new Error('Invalid renderer response')); return }
        ok(response)
      }
      const timer = setTimeout(() => { finish(); fail(new Error('Renderer response expired')) }, 50_000)
      ipcMain.on('agent:response', receive)
      if (target.isDestroyed()) { finish(); fail(new Error('MindNB window is closed')); return }
      target.send('agent:request', request)
    })
    const bridge = await startAgentBridge({ socketPath: agentSocket, outputDirectory: app.commandLine.getSwitchValue('agent-output') || undefined, assetsDirectory: app.commandLine.getSwitchValue('agent-assets') || undefined, dispatch })
    app.once('before-quit', () => { void bridge.close() })
    window.setTitle('MindNB · Agent 接口已启用')
  }
  if (startupError) await dialog.showMessageBox(window, { type: 'warning', message: '上次资料库暂不可用，请重新选择', detail: startupError })
  queuedFiles.push(...process.argv.filter(isPortablePath))
  if (!app.isPackaged && process.env.MINDNB_DESKTOP_IMPORT) queuedFiles.push(process.env.MINDNB_DESKTOP_IMPORT)
  await drainFiles()
  if (window) poll = setInterval(() => window?.webContents.send('vault:changed'), 3000)
}
