import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, mkdir, rm, readFile, readdir, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createPortable, readPortable } from '../../src/vault-format.ts'
import { seedTree } from '../../src/model.ts'

let base: string, app: ElectronApplication, page: Page
test.beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'mindnb-menu-'))
  await mkdir(join(base, 'vault'))
  app = await electron.launch({ args: [resolve('.')], env: { ...process.env, MINDNB_DESKTOP_DATA: join(base, 'app'), MINDNB_DESKTOP_VAULT: join(base, 'vault') } })
  page = await app.firstWindow()
  await expect(page.locator('#desktop-files')).toBeVisible()
})
test.afterEach(async () => { await app?.close(); await rm(base, { recursive: true, force: true }) })
const enabled = (id: string) => app.evaluate(({ Menu }, id) => Menu.getApplicationMenu()!.getMenuItemById(id)!.enabled, id)
async function command(id: string) {
  await expect.poll(() => enabled(id)).toBe(true)
  await app.evaluate(({ Menu, BrowserWindow }, id) => {
    const item = Menu.getApplicationMenu()!.getMenuItemById(id)!
    const window = BrowserWindow.getAllWindows()[0]
    item.click({ shiftKey: false, ctrlKey: false, altKey: false, metaKey: false }, window, window.webContents)
  }, id)
}
async function create() { await command('new'); await expect(page.locator('#canvas')).toBeVisible() }
async function tree() {
  // The first native save is asynchronous; wait for its file before reading it.
  let files: string[] = []
  await expect.poll(async () => {
    files = (await readdir(join(base, 'vault/documents'))).filter(name => name.endsWith('.mindnb.json'))
    return files.length
  }).toBeGreaterThan(0)
  return JSON.parse(await readFile(join(base, 'vault/documents', files[0]), 'utf8')).tree
}

test('File menu exposes document commands and disables export on home', async () => {
  const items = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.find(i => i.label === '文件')!.submenu!.items.map(i => ({ id: i.id, label: i.label, enabled: i.enabled, accelerator: i.accelerator })))
  expect(items).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'new', label: '新建导图', accelerator: 'CmdOrCtrl+N' }),
    expect.objectContaining({ id: 'save', label: '保存', enabled: false }),
    expect.objectContaining({ id: 'export-png', label: '导出为 PNG…', enabled: false, accelerator: 'CmdOrCtrl+Shift+E' }),
    expect.objectContaining({ id: 'export', label: '导出其他格式…', enabled: false }),
  ]))
})

test('desktop provides native export save instead of untracked downloads', async () => {
  expect(await page.evaluate(() => typeof window.mindNBDesktop?.saveExport)).toBe('function')
})

test('menu creates, edits, saves, renames and undoes/redoes the document', async () => {
  await create()
  await command('edit-node')
  await page.locator('#node-editor').fill('菜单保存的文字')
  await command('save')
  await expect(page.locator('#node-editor')).toHaveCount(0)
  await expect.poll(async () => (await tree()).root.text).toBe('菜单保存的文字')
  await command('undo')
  await expect.poll(async () => (await tree()).root.text).toBe('中心主题')
  await command('redo')
  await expect.poll(async () => (await tree()).root.text).toBe('菜单保存的文字')
  await command('rename')
  await expect.poll(() => enabled('new')).toBe(false)
  await expect.poll(() => enabled('export-png')).toBe(false)
  await page.getByRole('dialog').getByRole('textbox').fill('系统菜单改名')
  await page.getByRole('button', { name: '保存名称' }).click()
  await expect(page.locator('#editor-doc-title')).toHaveText('系统菜单改名')
  await command('child')
  await page.locator('#node-editor').fill('子节点')
  await command('save')
  await command('sibling')
  await page.locator('#node-editor').fill('同级节点')
  await command('save')
  await expect.poll(async () => (await tree()).root.children.map((n: { text: string }) => n.text)).toEqual(['子节点', '同级节点'])
  await command('link')
  await expect(page.locator('#link-btn')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await command('home')
  await expect(page.locator('.card-name', { hasText: '系统菜单改名' })).toBeVisible()
  await expect.poll(() => enabled('save')).toBe(false)
})

test('text undo and clipboard roles stay inside the focused editor', async () => {
  await create(); await command('edit-node')
  await page.locator('#node-editor').press('End')
  await page.keyboard.type('abc')
  await command('undo')
  await expect(page.locator('#node-editor')).toHaveValue('中心主题')
  await command('redo')
  await expect(page.locator('#node-editor')).toHaveValue('中心主题abc')
  await expect.poll(() => enabled('child')).toBe(false)
  // MenuItem.click(event, window, webContents) differs from a constructor callback.
  // Check each effect so a no-op cut/paste sequence cannot pass this regression.
  async function role(name: 'selectAll' | 'cut' | 'paste') {
    const configured = await app.evaluate(({ Menu }, name) => Menu.getApplicationMenu()!.items.find(i => i.label === '编辑')!.submenu!.items.some(i => i.role?.toLowerCase() === name.toLowerCase()), name)
    expect(configured).toBe(true)
    if (process.platform === 'darwin') {
      // AppKit native roles do not run through MenuItem's JS callback.
      // Exercise their text-editing shortcuts; native menu clicks need OS-level QA.
      await page.locator('#node-editor').press({ selectAll: 'Meta+A', cut: 'Meta+X', paste: 'Meta+V' }[name])
    } else {
      await app.evaluate(({ Menu, BrowserWindow }, name) => {
        const menu = Menu.getApplicationMenu()!.items.find(i => i.label === '编辑')!.submenu!
        const window = BrowserWindow.getAllWindows()[0]
        const item = menu.items.find(i => i.role?.toLowerCase() === name.toLowerCase())!
        item.click({ shiftKey: false, ctrlKey: false, altKey: false, metaKey: false }, window, window.webContents)
      }, name)
    }
  }
  await role('selectAll')
  await expect.poll(() => page.locator('#node-editor').evaluate((el: HTMLTextAreaElement) => el.selectionEnd - el.selectionStart)).toBe('中心主题abc'.length)
  await role('cut')
  await expect(page.locator('#node-editor')).toHaveValue('')
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('中心主题abc')
  await role('paste')
  await expect(page.locator('#node-editor')).toHaveValue('中心主题abc')
  await command('save')
  await expect.poll(async () => (await tree()).root.text).toBe('中心主题abc')
})

test('view menu changes zoom/panel and reload flushes active text', async () => {
  await create()
  await command('zoom-out'); await expect(page.locator('#zoom-pct')).toHaveText('83%')
  await command('zoom-in'); await expect(page.locator('#zoom-pct')).toHaveText('100%')
  await command('zoom-out'); await command('zoom-fit'); await expect(page.locator('#zoom-pct')).toHaveText('100%')
  await command('zoom-out')
  await command('zoom-reset'); await expect(page.locator('#zoom-pct')).toHaveText('100%')
  await command('panel'); await expect(page.locator('#app')).toHaveClass(/panel-hidden/)
  await command('panel'); await expect(page.locator('#app')).not.toHaveClass(/panel-hidden/)
  await command('edit-node'); await page.locator('#node-editor').fill('重载前保存')
  await command('reload')
  await expect.poll(async () => (await tree()).root.text).toBe('重载前保存')
  await expect(page.locator('#canvas tspan', { hasText: '重载前保存' })).toBeVisible()
})

test('native export writes PNG and portable bytes, cancel/failure never report success', async () => {
  await create(); await page.evaluate(() => document.fonts.ready)
  await command('export-png')
  const dialog = page.getByRole('dialog', { name: '导出文档' })
  await expect(dialog.getByLabel('导出格式')).toHaveValue('png')
  await expect.poll(() => enabled('export-png')).toBe(false)
  const path = join(base, 'native.png')
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, path)
  await dialog.getByRole('button', { name: '导出', exact: true }).click()
  await expect(dialog.getByRole('status')).toHaveText('文件已保存')
  expect((await readFile(path)).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  await expect(dialog.getByText(path, { exact: true })).toBeVisible()
  await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' }) })
  await dialog.getByRole('button', { name: '导出', exact: true }).click()
  await expect(dialog.getByRole('status')).toHaveText('已取消导出')
  await expect(dialog.getByText(path, { exact: true })).toHaveCount(0)
  // Renaming a temporary file over a directory must fail, then allow a retry.
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, join(base, 'vault'))
  await dialog.getByRole('button', { name: '导出', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText('导出失败：')
  await expect(dialog.getByRole('button', { name: '导出', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: '关闭' }).click()
  await command('export')
  await expect(dialog.getByLabel('导出格式')).toHaveValue('mindnb')
  const portable = join(base, 'native.mindnb')
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, portable)
  await dialog.getByRole('button', { name: '导出', exact: true }).click()
  await expect(dialog.getByRole('status')).toHaveText('文件已保存')
  expect((await readPortable(await readFile(portable))).tree.root.text).toBe('中心主题')
})

test('File import and vault selection use the existing storage workflow', async () => {
  const source = seedTree(); source.root.text = '菜单导入'
  const path = join(base, 'import.mindnb')
  await writeFile(path, await createPortable(source, '菜单导入', async () => new Uint8Array()))
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, path)
  await command('import')
  await expect(page.locator('#editor-doc-title')).toHaveText('菜单导入')
  const nextVault = join(base, 'next-vault'); await mkdir(nextVault)
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, nextVault)
  await command('choose-vault')
  await expect(page.locator('#home')).toBeVisible()
  await expect(page.locator('.card-name', { hasText: '菜单导入' })).toHaveCount(0)
  expect(await page.evaluate(async () => (await window.mindNBDesktop!.snapshot())!.path)).toBe(await realpath(nextVault))
  await expect.poll(() => enabled('new')).toBe(true)
})
