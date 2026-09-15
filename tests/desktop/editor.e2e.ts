import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { seedTree } from '../../src/model.ts'
import { createPortable, readPortable } from '../../src/vault-format.ts'
let base: string, app: ElectronApplication, page: Page
async function launch(portable?: string, noVault = false, profileDirectory?: string) {
  app = await electron.launch({ args: [resolve('.'), ...(profileDirectory ? [`--user-data-dir=${profileDirectory}`] : [])], env: { ...process.env, MINDNB_DESKTOP_DATA: join(base, 'app'), MINDNB_DESKTOP_VAULT: noVault ? '' : join(base, 'vault'), ...(portable ? { MINDNB_DESKTOP_IMPORT: portable } : {}) } })
  page = await app.firstWindow()
  page.on('pageerror', e => console.error('Renderer error:', e.message))
  await expect(page.locator(noVault ? '#desktop-welcome' : '#desktop-files')).toBeVisible()
}
test.beforeEach(async () => { base = await mkdtemp(join(tmpdir(), 'mindnb-electron-')); await mkdir(join(base, 'vault')) })
test.afterEach(async () => { await app?.close(); await rm(base, { recursive: true, force: true }) })
async function documentOnDisk() {
  const directory = join(base, 'vault/documents')
  let names: string[] = []
  // UI updates are optimistic; wait for a committed document, not a temporary
  // atomic-write file or an empty directory during the first save.
  await expect.poll(async () => {
    names = (await readdir(directory)).filter(name => name.endsWith('.mindnb.json'))
    return names.length
  }).toBeGreaterThan(0)
  return JSON.parse(await readFile(join(directory, names[0]), 'utf8'))
}
async function geometry() {
  return page.evaluate(() => {
    const s = (window as unknown as { __mindNB: { view: { tx: number; ty: number; k: number }; nodes: unknown[]; objects: unknown[] } }).__mindNB
    return { view: { ...s.view }, nodes: s.nodes, objects: s.objects }
  })
}
test('create, edit, half-screen resize, close-flush and reopen preserve content and geometry', async () => {
  await launch()
  await page.getByText('新建导图', { exact: true }).click()
  await expect(page.locator('#canvas')).toBeVisible()
  await page.waitForFunction(() => !!(window as unknown as { __mindNB: unknown }).__mindNB)
  const state = await geometry()
  const first = state.nodes[0] as { x: number; y: number; w: number; h: number }
  await page.mouse.dblclick(first.x * state.view.k + state.view.tx + first.w * state.view.k / 2, first.y * state.view.k + state.view.ty + first.h * state.view.k / 2)
  await page.locator('#node-editor').fill('桌面离线保存')
  await page.locator('#node-editor').press('Escape')
  await expect.poll(async () => (await documentOnDisk()).tree.root.text).toBe('桌面离线保存')
  await page.evaluate(() => document.fonts.ready)
  const before = await geometry()
  for (const width of [700, 600, 560, 1200]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 800), width)
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width)
    await expect.poll(geometry).toEqual(before)
    expect(await page.locator('#canvas').evaluate(el => el.clientHeight)).toBe(await page.evaluate(() => window.innerHeight))
  }
  await page.screenshot({ path: test.info().outputPath('desktop-wide.png') })
  // Close while a text field is still active; the flush handshake must commit it.
  await page.mouse.dblclick(first.x + before.view.tx + first.w / 2, first.y + before.view.ty + first.h / 2)
  await page.locator('#node-editor').fill('关闭时也保存')
  const editingBox = await page.locator('#node-editor').boundingBox()
  await page.locator('#node-editor').dispatchEvent('compositionstart', { data: '保存' })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(650, 740))
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(650)
  await expect(page.locator('#node-editor')).toHaveValue('关闭时也保存')
  expect(await page.locator('#node-editor').boundingBox()).toEqual(editingBox)
  await page.locator('#node-editor').dispatchEvent('compositionend', { data: '保存' })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await expect.poll(async () => (await documentOnDisk()).tree.root.text).toBe('关闭时也保存')
  await app.close(); await launch()
  await page.locator('.card').filter({ has: page.locator('.card-name', { hasText: '关闭时也保存' }) }).locator('.card-thumb').click()
  await expect(page.locator('#canvas')).toBeVisible()
  expect((await documentOnDisk()).tree.root.text).toBe('关闭时也保存')
})
test('OS-open imports full portable package and renderer can export it offline', async () => {
  const tree = seedTree(); tree.root.text = '可迁移资料'
  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1cAAAAASUVORK5CYII=', 'base64'))
  tree.objects = [{ id: 'img1', kind: 'image', seed: 1, src: 'data:image/png;base64,' + Buffer.from(png).toString('base64'), x: 850, y: 400, w: 80, h: 80 }]
  const bytes = await createPortable(tree, '可迁移资料', async () => png), path = join(base, 'source.mindnb')
  await writeFile(path, bytes); await launch(path)
  await expect(page).toHaveURL(/#\/doc\//)
  await expect(page.locator('#canvas image').first()).toBeVisible()
  const image = page.locator('#canvas image').first()
  const source = await image.getAttribute('href') ?? await image.getAttribute('xlink:href')
  expect(source).toMatch(/^mindnb:\/\/asset\//)
  expect(await page.evaluate(async src => (await fetch(src!)).ok, source)).toBe(true)
  await page.evaluate(() => document.fonts.ready)
  const initial = await geometry()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(650, 740))
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(650)
  await expect.poll(geometry).toEqual(initial)
  await expect(page.locator('#app')).toHaveClass(/panel-hidden/)
  await page.screenshot({ path: test.info().outputPath('desktop-half-screen.png') })
  await expect(page.getByRole('button', { name: '导入 .mindnb', exact: true })).not.toBeVisible()
  // The document is available before its cloud image; retry without reopening the app.
  const assetPath = join(base, 'vault/assets', source!.split('/').at(-1)!)
  await rm(assetPath); await page.reload()
  await expect(page.locator('[data-asset-placeholder]')).toHaveCount(1)
  await writeFile(assetPath, png)
  await expect(page.locator('[data-asset-placeholder]')).toHaveCount(0)
  expect(await page.evaluate(async src => (await fetch(src!)).ok, source)).toBe(true)
  // Exercise the actual export UI and download path.
  await page.getByRole('button', { name: /导出/ }).first().click()
  await page.getByLabel('导出格式').selectOption('mindnb')
  const exportPath = join(base, 'exported.mindnb')
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, exportPath)
  await page.getByRole('button', { name: '导出', exact: true }).last().click()
  await expect.poll(async () => readFile(exportPath).then(bytes => bytes.length, () => 0)).toBeGreaterThan(0)
  const decoded = await readPortable(await readFile(exportPath))
  expect(decoded.tree.root.text).toBe('可迁移资料')
  expect(decoded.assets.size).toBe(1)
  expect(await readFile(path)).toEqual(Buffer.from(bytes))
  // Vault images use a different host from the editor. Canvas-based exports must
  // retain the image without tainting the canvas (also shared by JPEG and PDF).
  for (const format of ['png', 'jpeg', 'pdf']) {
    await page.getByLabel('导出格式').selectOption(format)
    const imageExportPath = join(base, `with-local-image.${format}`)
    await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, imageExportPath)
    await page.getByRole('button', { name: '导出', exact: true }).last().click()
    await expect(page.getByRole('dialog', { name: '导出文档' }).getByRole('status')).toHaveText('文件已保存')
    await expect.poll(() => readFile(imageExportPath).then(bytes => bytes.length, () => 0)).toBeGreaterThan(0)
    const output = await readFile(imageExportPath)
    const signature = format === 'png' ? '89504e47' : format === 'jpeg' ? 'ffd8' : '25504446'
    expect(output.subarray(0, signature.length / 2).toString('hex')).toBe(signature)
  }
})
test('external updates refresh the open editor and never interrupt active typing', async () => {
  await launch(); await page.getByText('新建导图', { exact: true }).click()
  await expect(page.locator('#canvas')).toBeVisible()
  await expect(page.locator('#desktop-save-state')).toContainText('已保存到本机')
  const old = await documentOnDisk(), path = join(base, 'vault/documents', old.meta.id + '.mindnb.json')
  const external = structuredClone(old); external.tree.root.text = '外部更新'; external.revision.editedAt = Math.max(Date.now(), old.revision.editedAt + 1); external.revision.id = 'external-1'
  await writeFile(path, JSON.stringify(external))
  await expect(page.locator('#canvas tspan').filter({ hasText: '外部更新' })).toBeVisible()
  const state = await geometry(), first = state.nodes[0] as { x: number; y: number; w: number; h: number }
  await page.mouse.dblclick((first.x + first.w / 2) * state.view.k + state.view.tx, (first.y + first.h / 2) * state.view.k + state.view.ty)
  await page.locator('#node-editor').fill('继续本机输入')
  const next = structuredClone(external); next.tree.root.text = '输入期间到达'; next.revision.editedAt = Math.max(Date.now(), external.revision.editedAt + 1); next.revision.id = 'external-2'
  await writeFile(path, JSON.stringify(next))
  await page.evaluate(async () => (window as unknown as { __documentSession: { refresh(): Promise<void> } }).__documentSession.refresh())
  await expect(page.locator('#node-editor')).toHaveValue('继续本机输入')
  await page.locator('#node-editor').press('Escape')
  await expect.poll(async () => (await documentOnDisk()).tree.root.text).toBe('继续本机输入')
  await writeFile(path, JSON.stringify(old))
  await expect.poll(async () => (await documentOnDisk()).tree.root.text).toBe('继续本机输入')
})
test('reload flushes active input and deleted documents can be restored from the recycle bin', async () => {
  await launch(); await page.getByText('新建导图', { exact: true }).click()
  await page.waitForFunction(() => !!(window as unknown as { __mindNB: unknown }).__mindNB)
  const s = await geometry(), n = s.nodes[0] as { x: number; y: number; w: number; h: number }
  await page.mouse.dblclick((n.x + n.w / 2) * s.view.k + s.view.tx, (n.y + n.h / 2) * s.view.k + s.view.ty)
  await page.locator('#node-editor').fill('可以恢复的文档')
  await app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu()!.items.find(x => x.label === '视图')!.submenu!
    const reload = menu.items.find(x => x.label === '重新载入')!
    reload.click()
  })
  await expect.poll(async () => (await documentOnDisk()).tree.root.text).toBe('可以恢复的文档')
  await expect(page.locator('#canvas tspan').filter({ hasText: '可以恢复的文档' })).toBeVisible()
  await page.getByRole('button', { name: '回到首页' }).click()
  await page.getByRole('button', { name: '文档操作', exact: true }).click()
  await page.getByRole('button', { name: '删除', exact: true }).click()
  await expect(page.locator('.modal-text')).toContainText('回收站')
  await page.locator('.modal').getByRole('button', { name: '删除', exact: true }).click()
  await expect(page.locator('.card[data-id]')).toHaveCount(0)
  await page.getByRole('button', { name: '回收站', exact: true }).click()
  await page.getByRole('dialog', { name: '回收站' }).getByRole('button', { name: '恢复', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '回收站' })).toContainText('回收站是空的')
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.locator('.card[data-id] .card-thumb').click()
  await expect(page.locator('#canvas tspan').filter({ hasText: '可以恢复的文档' })).toBeVisible()
  expect((await documentOnDisk()).meta.deletedAt).toBeNull()
})

test('welcome page guides vault selection and stays usable in a narrow window', async () => {
  const profileDirectory = join(base, 'isolated-profile')
  await launch(undefined, true, profileDirectory)
  expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(profileDirectory)
  await expect(page.getByRole('heading', { name: '选择你的资料库' })).toBeVisible()
  await expect(page.locator('#desktop-save-state')).not.toBeVisible()
  await expect(page.getByRole('button', { name: '回收站', exact: true })).not.toBeVisible()
  await page.screenshot({ path: test.info().outputPath('welcome-wide.png') })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(600, 720))
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(600)
  await page.getByRole('button', { name: '选择资料库' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: test.info().outputPath('welcome-narrow.png') })
  expect(await page.locator('#desktop-welcome').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }) })
  await page.getByRole('button', { name: '选择资料库' }).click()
  await expect(page.locator('#desktop-welcome')).toBeVisible()
  await expect(page.getByRole('button', { name: '选择资料库' })).toBeEnabled()
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, join(base, 'vault'))
  await page.getByRole('button', { name: '选择资料库' }).click()
  await expect(page.locator('#desktop-welcome')).not.toBeVisible()
  await expect(page.getByText('新建导图', { exact: true })).toBeVisible()
  await expect(page.locator('#desktop-files')).toBeVisible()
})

test('empty vault shows a sample card that creates exactly one editable document when opened', async () => {
  await launch()
  await expect(page.locator('.clear-sample-button')).toHaveCount(0)
  await expect(page.locator('.sample-card')).toBeVisible()
  await expect(page.locator('.sample-card .card-name')).toHaveText('学习用思维导图（示例）')
  expect(await readdir(join(base, 'vault/documents'))).toHaveLength(0)
  expect(await page.locator('.home-logo').evaluate(el => getComputedStyle(el).boxShadow)).toBe('none')
  await expect(page.locator('.desktop-action svg')).toHaveCount(3)
  await page.screenshot({ path: test.info().outputPath('home-empty-wide.png') })
  await page.reload()
  await expect(page.locator('.sample-card')).toBeVisible()
  expect(await readdir(join(base, 'vault/documents'))).toHaveLength(0)
  await page.getByRole('button', { name: '打开学习用思维导图（示例）' }).click()
  await expect(page.locator('#canvas')).toBeVisible()
  await expect.poll(async () => (await readdir(join(base, 'vault/documents'))).length).toBe(1)
  await expect.poll(async () => (await documentOnDisk()).tree.root.text).toBe('学习用思维导图（示例）')
  await page.evaluate(() => { location.hash = '#/' })
  await expect(page.locator('#home')).toBeVisible()
  await expect(page.locator('.sample-card')).toHaveCount(0)
  expect(await readdir(join(base, 'vault/documents'))).toHaveLength(1)
  await expect(page.locator('#desktop-save-state')).toContainText('已保存到本机')
  await page.screenshot({ path: test.info().outputPath('home-saved-wide.png') })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(600, 720))
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(600)
  for (const button of await page.locator('.desktop-action').all()) await expect(button).toBeVisible()
  expect(await page.locator('#desktop-files').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.screenshot({ path: test.info().outputPath('home-saved-narrow.png') })
})

test('document rename keeps its metadata name, keyboard behavior and portable export after reopening', async () => {
  await launch()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.getByText('新建导图', { exact: true }).click()
  const title = page.locator('#editor-doc-title'), dialog = page.getByRole('dialog', { name: '重命名文档' })
  const input = dialog.getByLabel('文档名称', { exact: true })
  await title.press('Space')
  await expect(dialog).toBeVisible()
  await input.fill('界面修复后的文档名称')
  await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true })
  await expect(dialog).toBeVisible()
  await input.press('Enter')
  await expect(title).toHaveText('界面修复后的文档名称')
  await expect.poll(async () => (await documentOnDisk()).meta.nameOverride).toBe('界面修复后的文档名称')
  const root = (await documentOnDisk()).tree.root.text
  expect(root).not.toBe('界面修复后的文档名称')
  await title.click()
  await expect(input).toHaveValue('界面修复后的文档名称')
  await input.fill('   ')
  await expect(dialog.getByRole('button', { name: '保存名称' })).toBeDisabled()
  await input.press('Enter')
  await expect(dialog).toBeVisible()
  await input.fill('取消的修改')
  await input.press('Escape')
  await expect(title).toHaveText('界面修复后的文档名称')
  await page.reload()
  await expect(title).toHaveText('界面修复后的文档名称')
  await title.click()
  await expect(input).toHaveValue('界面修复后的文档名称')
  const field = await input.boundingBox(), actions = await dialog.locator('footer').boundingBox()
  expect(actions!.y).toBeGreaterThan(field!.y + field!.height)
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.screenshot({ path: test.info().outputPath('rename-wide.png') })
  await dialog.getByRole('button', { name: '取消' }).click()
  await page.getByRole('button', { name: '导出文档', exact: true }).click()
  const exportedPath = join(base, '界面修复后的文档名称.mindnb')
  // Electron owns downloads; preserve its suggested filename in the temporary folder.
  await app.evaluate(({ dialog }, folder) => { dialog.showSaveDialog = async (_window: unknown, options?: import('electron').SaveDialogOptions) => ({ canceled: false, filePath: folder + '/' + options!.defaultPath!.split(/[\\/]/).at(-1) }) }, base)
  await page.getByRole('dialog', { name: '导出文档' }).getByRole('button', { name: '导出', exact: true }).click()
  await expect.poll(async () => readFile(exportedPath).then(bytes => bytes.length, () => 0)).toBeGreaterThan(0)
  const portable = await readPortable(await readFile(exportedPath))
  expect(portable.name).toBe('界面修复后的文档名称')
  expect(portable.tree.root.text).toBe(root)
  expect(errors).toEqual([])
})

test('narrow editor keeps rename and layer navigation accessible', async () => {
  await launch()
  await page.getByText('新建导图', { exact: true }).click()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(560, 600))
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(560)
  await page.getByRole('button', { name: '更多工具', exact: true }).click()
  await page.getByRole('button', { name: '重命名文档', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '重命名文档' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('文档名称').fill('窄窗口中的文档')
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.screenshot({ path: test.info().outputPath('rename-narrow.png') })
  await dialog.getByRole('button', { name: '保存名称' }).click()
  await page.getByRole('button', { name: '图层', exact: true }).click()
  const panel = page.locator('#editor-left-panel')
  await expect(panel).toBeVisible()
  const root = (await documentOnDisk()).tree.root.id
  await page.locator(`[data-layer-id="${root}"]`).click()
  await expect(panel).not.toBeVisible()
  await expect(page.locator(`#canvas [data-id="${root}"]`)).toBeInViewport()
  await page.getByRole('button', { name: '展开格式面板', exact: true }).click()
  await expect(page.locator('#style-panel')).toBeVisible()
  await expect(page.locator(`#canvas [data-id="${root}"]`)).toBeInViewport()
  await page.screenshot({ path: test.info().outputPath('navigation-narrow.png') })

})

test('desktop home contains labeled library actions and an explicit retry only after save failure', async () => {
  await launch()
  await expect(page.locator('#vault-name, .desktop-vault')).toHaveCount(0)
  await expect(page.locator('.desktop-action')).toHaveText(['资料库', '导入', '回收站'])
  await expect(page.locator('#desktop-save-state')).toHaveRole('status')
  await expect(page.locator('#desktop-save-retry')).not.toBeVisible()
  // Native dialogs are stubbed only in this isolated temporary test vault.
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }) })
  await page.getByRole('button', { name: '选择资料库', exact: true }).click()
  await expect(page.locator('#home')).toBeVisible()
  await page.getByRole('button', { name: '导入 .mindnb', exact: true }).click()
  await page.getByRole('button', { name: '回收站', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '回收站' })).toContainText('回收站是空的')
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByText('新建导图', { exact: true }).click()
  await expect(page.locator('#desktop-save-state')).toContainText('已保存到本机')
  await documentOnDisk()
  // Replace the test document directory with a file to exercise real I/O failure and recovery.
  // Windows can briefly hold directory handles while a completed save is being indexed.
  const documents = join(base, 'vault/documents'), backup = join(base, 'documents-backup')
  const { rename } = await import('node:fs/promises')
  await expect.poll(async () => {
    try { await rename(documents, backup); return true }
    catch (error) {
      if (process.platform === 'win32' && ['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '')) return false
      throw error
    }
  }, { timeout: 5000 }).toBe(true)
  await writeFile(documents, 'temporarily unavailable')
  try {
    await page.locator('#editor-doc-title').click()
    await page.getByLabel('文档名称', { exact: true }).fill('失败后重试保存')
    await page.getByRole('button', { name: '保存名称' }).click()
    await expect(page.locator('#desktop-save-state')).toHaveAttribute('data-failed', 'true')
    await expect(page.getByRole('button', { name: '重试保存' })).toBeVisible()
    await expect(page.getByRole('button', { name: '选择资料库', exact: true })).not.toBeVisible()
    await expect(page.getByRole('button', { name: '重试保存' })).toBeVisible()
  } finally {
    await rm(documents, { force: true })
    await rename(backup, documents)
  }
  await page.getByRole('button', { name: '重试保存' }).click()
  await expect(page.locator('#desktop-save-state')).toContainText('已保存到本机')
  await expect(page.locator('#desktop-save-retry')).not.toBeVisible()
  await expect.poll(async () => (await documentOnDisk()).meta.nameOverride).toBe('失败后重试保存')
})

test('home library controls and 20-item trash support pagination, cancel, permanent delete and restore', async () => {
  const { VaultRepository } = await import('../../desktop/vault.ts')
  const repo = await VaultRepository.open(join(base, 'vault'), join(base, 'seed-state'))
  for (let i = 0; i < 20; i++) {
    const tree = seedTree(); tree.root.text = `测试文档 ${String(i + 1).padStart(2, '0')} · 较长标题用于检查紧凑列表`
    await repo.save({ meta: { id: `trash-${i}`, nameOverride: null, createdAt: 1, updatedAt: 1000 + i, deletedAt: 1000 + i }, tree, editedAt: 1000 + i, sequence: 0 })
  }
  await launch(undefined, false, join(base, 'profile'))
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await expect(page).toHaveTitle('MindNB')
  await expect(page.locator('#home-library-actions .desktop-action')).toHaveCount(3)
  await page.screenshot({ path: test.info().outputPath('mindnb-home-library.png') })
  await page.getByRole('button', { name: '新建导图', exact: true }).click()
  await expect(page.locator('.desktop-action')).toHaveCount(0)
  await page.getByRole('button', { name: '回到首页' }).click()
  await page.getByRole('button', { name: '回收站', exact: true }).click()
  const trash = page.getByRole('dialog', { name: '回收站' })
  await expect(trash.locator('.trash-row')).toHaveCount(8)
  await expect(trash).toContainText('共 20 条')
  await page.screenshot({ path: test.info().outputPath('mindnb-trash-20.png') })
  await trash.getByRole('button', { name: '下一页' }).click()
  await expect(trash.locator('nav')).toContainText('2 / 3')
  await trash.getByRole('button', { name: '下一页' }).click()
  await expect(trash.locator('.trash-row')).toHaveCount(4)
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }) })
  await trash.getByRole('button', { name: '永久删除', exact: true }).first().click()
  await expect(trash.getByRole('button', { name: '关闭', exact: true })).toBeEnabled()
  await expect(trash).toContainText('共 20 条')
  await expect(trash.locator('.trash-row')).toHaveCount(4)
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }) })
  for (let i = 0; i < 4; i++) {
    await trash.getByRole('button', { name: '永久删除', exact: true }).first().click()
    await expect(trash).toContainText(`共 ${19 - i} 条`)
    await expect(trash.getByRole('button', { name: '关闭', exact: true })).toBeEnabled()
  }
  await expect(trash.locator('nav')).toContainText('2 / 2')
  await trash.getByRole('button', { name: '恢复', exact: true }).first().click()
  await expect(trash).toContainText('共 15 条')
  await expect(trash.getByRole('button', { name: '关闭', exact: true })).toBeEnabled()
  await expect(page).toHaveURL(/#\/$/)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(560, 420))
  await expect(trash.getByRole('button', { name: '关闭', exact: true })).toBeInViewport()
  await page.screenshot({ path: test.info().outputPath('mindnb-trash-narrow.png') })
  await trash.getByRole('button', { name: '关闭', exact: true }).click()
  await app.close(); await launch(undefined, false, join(base, 'profile'))
  await page.getByRole('button', { name: '回收站', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '回收站' })).toContainText('共 15 条')
  expect(errors).toEqual([])
})

test('editor canvas reaches the bottom with floating controls that do not overlap', async () => {
  await launch(undefined, false, join(base, 'profile'))
  await page.getByRole('button', { name: '新建导图', exact: true }).click()
  await expect(page.locator('#canvas')).toBeVisible()
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  for (const [width, height] of [[1200, 800], [700, 600], [560, 420]]) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size[0], size[1]), [width, height])
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
    await expect.poll(() => page.locator('#app').evaluate(el => parseFloat(getComputedStyle(el).getPropertyValue('--canvas-bottom')))).toBe(0)
    expect(await page.evaluate(() => document.elementFromPoint(150, innerHeight - 3)?.closest('#canvas')?.id)).toBe('canvas')
    const rail = await page.locator('#editor-left-rail').boundingBox()
    expect(rail!.y + rail!.height).toBe(height)
    const status = await page.locator('.desktop-save-status').boundingBox()
    expect(status!.y + status!.height).toBeLessThanOrEqual(height)
    const zoom = page.locator('#zoom-bar')
    if (await zoom.isVisible()) {
      const box = await zoom.boundingBox()
      expect(box!.y + box!.height).toBeGreaterThanOrEqual(height - 24)
      expect(status!.x + status!.width).toBeLessThanOrEqual(box!.x)
    }
    const toolbar = page.locator('#node-toolbar')
    if (await toolbar.isVisible()) {
      const box = await toolbar.boundingBox()
      expect(box!.height).toBeLessThan(90)
      expect(box!.y + box!.height).toBeLessThanOrEqual(height)
    }
    const panel = page.locator('#style-panel')
    if (await panel.isVisible()) {
      const box = await panel.boundingBox()
      expect(box!.y + box!.height).toBe(height)
    }
    await page.screenshot({ path: test.info().outputPath(`mindnb-floating-${width}.png`) })
  }
  expect(errors).toEqual([])
})
