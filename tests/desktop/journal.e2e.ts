import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('handbook imports, renders textures, expands details and exports transparent artwork', async () => {
  test.setTimeout(90000)
  const base = await mkdtemp(join(tmpdir(), 'mindnb-journal-'))
  await mkdir(join(base, 'vault'))
  const output = test.info().outputPath('journal')
  await mkdir(output, { recursive: true })
  const app = await electron.launch({ args: [resolve('.')], env: { ...process.env, MINDNB_DESKTOP_DATA: join(base, 'app'), MINDNB_DESKTOP_VAULT: join(base, 'vault'), MINDNB_DESKTOP_IMPORT: resolve('tests/fixtures/meal-journal.mindnb') } })
  try {
    const page = await app.firstWindow(), errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await expect(page).toHaveURL(/#\/doc\//)
    await page.evaluate(() => document.fonts.ready)
    await expect(page.locator('#canvas')).toBeVisible()
    await page.getByRole('button', { name: '适应窗口', exact: true }).click()
    await expect(page.locator('#canvas [data-id="friday"] text')).toContainText('周五 · 合成示例')
    const images = page.locator('#canvas image')
    expect(await images.count()).toBeGreaterThan(20)
    await page.screenshot({ path: join(output, 'native-preview.png') })
    await page.getByRole('button', { name: /导出/ }).first().click()
    await page.getByLabel('导出格式').selectOption('png')
    const pngPath = join(output, '合成图文样例-总览.png')
    await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, pngPath)
    await page.getByRole('button', { name: '导出', exact: true }).last().click()
    await expect(page.getByRole('dialog', { name: '导出文档' }).getByRole('status')).toHaveText('文件已保存', { timeout: 30000 })
    await expect.poll(() => readFile(pngPath).then(b => b.length, () => 0)).toBeGreaterThan(100000)
    await page.getByRole('dialog', { name: '导出文档' }).getByRole('button', { name: '关闭' }).click()
    // The new controls must be reachable in the actual inspector.
    const header = await page.locator('#canvas [data-id="friday"] > text').boundingBox()
    await page.mouse.click(header!.x + 20, header!.y + 12)
    if (await page.getByRole('button', { name: '展开格式面板', exact: true }).count()) await page.getByRole('button', { name: '展开格式面板', exact: true }).click()
    const appearance = page.locator('.node-appearance-group')
    if (!(await appearance.evaluate(el => (el as HTMLDetailsElement).open))) await appearance.locator('summary').first().click()
    await expect(page.getByLabel('手绘底色', { exact: true })).toHaveValue('brush')
    await page.getByLabel('手绘底色', { exact: true }).selectOption('paper')
    await page.keyboard.press('ControlOrMeta+z')
    await expect(page.getByLabel('手绘底色', { exact: true })).toHaveValue('brush')
    await page.getByRole('button', { name: '收起格式面板', exact: true }).click()
    // Native selection and keyboard expand/collapse retain all synthetic detail.
    const meal = await page.locator('#canvas [data-id="friday-1"] text').boundingBox()
    await page.mouse.click(meal!.x + 20, meal!.y + 15)
    await page.keyboard.press('-')
    await expect(page.locator('#canvas [data-id="friday-1-ingredients"]')).toBeAttached()
    await page.keyboard.press('-')
    await expect(page.locator('#canvas [data-id="friday-1-ingredients"]')).not.toBeAttached()
    await page.reload()
    await expect(page.locator('#canvas [data-id="friday"]')).toBeAttached()
    const files = await readdir(join(base, 'vault/documents'))
    const doc = JSON.parse(await readFile(join(base, 'vault/documents', files[0]), 'utf8'))
    expect(doc.tree.root.children).toHaveLength(7)
    expect(doc.tree.root.children[4].structure).toBe('journal')
    expect(doc.tree.root.children[4].contents[1].placement).toBe('overlay')
    expect(errors).toEqual([])
  } finally { await app.close(); await rm(base, { recursive: true, force: true }) }
})
