import { _electron as electron, expect } from '@playwright/test'
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const executablePath = process.env.MINDNB_PACKAGED_EXECUTABLE
if (!executablePath) throw new Error('Set MINDNB_PACKAGED_EXECUTABLE to the installed preview executable')
const { version } = JSON.parse(await readFile('package.json', 'utf8'))
const base = await mkdtemp(join(tmpdir(), 'mindnb-installed-'))
const profile = join(base, 'profile'), vault = join(base, 'vault')
await mkdir(vault)
let app
async function launch() {
  app = await electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], timeout: 30000 })
  const info = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), profile: app.getPath('userData') }))
  expect(info.packaged).toBe(true)
  expect(info.version).toBe(version)
  expect(info.profile).toBe(profile)
  return app.firstWindow()
}
try {
  let page = await launch()
  await expect(page.getByRole('heading', { name: '选择你的资料库' })).toBeVisible()
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, vault)
  await page.getByRole('button', { name: '选择资料库', exact: true }).click()
  await page.getByText('新建导图', { exact: true }).click()
  await page.locator('#canvas tspan').filter({ hasText: '中心主题' }).first().dblclick()
  const title = `保存验收 ${version}`
  await page.locator('#node-editor').fill(title)
  await page.locator('#node-editor').press('Escape')
  await expect(page.locator('#desktop-save-state')).toContainText('已保存到本机')
  let document
  await expect.poll(async () => {
    const files = (await readdir(join(vault, 'documents'))).filter(name => name.endsWith('.mindnb.json'))
    if (files.length !== 1) return null
    document = JSON.parse(await readFile(join(vault, 'documents', files[0]), 'utf8'))
    return document.tree.root.text
  }).toBe(title)
  await app.close(); app = undefined
  page = await launch()
  await expect(page.locator('#desktop-files')).toBeVisible()
  await page.evaluate(id => { location.hash = `#/doc/${id}` }, document.meta.id)
  await expect(page.locator('#canvas tspan').filter({ hasText: title })).toBeVisible()
  await page.getByRole('button', { name: '导出文档', exact: true }).click()
  for (const [format, signature] of [['png', '89504e470d0a1a0a'], ['pdf', '255044462d'], ['docx', '504b0304'], ['xlsx', '504b0304'], ['mindnb', '504b0304']]) {
    await page.getByLabel('导出格式').selectOption(format)
    const output = join(base, `installed-export.${format}`)
    await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, output)
    await page.getByRole('dialog', { name: '导出文档' }).getByRole('button', { name: '导出', exact: true }).click({ timeout: 30000 })
    await expect(page.getByRole('dialog', { name: '导出文档' }).getByRole('status')).toHaveText('文件已保存', { timeout: 30000 })
    expect((await readFile(output)).subarray(0, signature.length / 2).toString('hex')).toBe(signature)
  }
  console.log(`Installed preview passed: ${process.platform}/${process.arch}, version ${version}, create/save/reopen/PNG/PDF/Word/Excel/portable export.`)
} finally {
  await app?.close()
  await rm(base, { recursive: true, force: true })
}
