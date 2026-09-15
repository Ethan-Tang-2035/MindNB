import { test, expect, _electron as electron, type Page, type ElectronApplication, type Locator } from '@playwright/test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { validTree } from '../../src/docs.ts'
import { readPortable } from '../../src/vault-format.ts'
import { nodeColorsOf, resolveTheme } from '../../src/theme.ts'
import { isDarkColor } from '../../src/paper.ts'

// Synthetic fixture preserving styling, raster dimensions and collapsed detail cases.
const fixture = resolve(process.env.MINDNB_AUDIT_FIXTURE || 'tests/fixtures/meal-plan.mindnb')
const evidence = process.env.MINDNB_AUDIT_OUTPUT || join(tmpdir(), 'mindnb-full-audit')
let app: ElectronApplication, page: Page, base: string, docId: string
let results: Array<{ action: string; result: string; detail?: string }> = [], errors: string[] = []
test.beforeEach(async () => {
  results = []; errors = []
  base = await mkdtemp(join(tmpdir(), 'mindnb-audit-')); await mkdir(join(base, 'vault')); await mkdir(evidence, { recursive: true })
  app = await electron.launch({ args: [resolve('.')], env: { ...process.env, MINDNB_DESKTOP_DATA: join(base, 'app'), MINDNB_DESKTOP_VAULT: join(base, 'vault'), MINDNB_DESKTOP_IMPORT: fixture } })
  page = await app.firstWindow(); page.setDefaultTimeout(3500)
  page.on('pageerror', e => errors.push(e.message))
  await expect(page).toHaveURL(/#\/doc\//)
  await page.evaluate(() => document.fonts.ready)
  docId = page.url().split('/').at(-1)!
  await page.getByRole('button', { name: '适应窗口', exact: true }).click()
})
test.afterEach(async ({}, info) => {
  await writeFile(join(evidence, info.title.replace(/[^a-zA-Z0-9-]/g, '_') + '.json'), JSON.stringify({ test: info.title, results, errors }, null, 2))
  await page?.screenshot({ path: join(evidence, info.title.replace(/[^a-zA-Z0-9-]/g, '_') + '.png') }).catch(() => {})
  await app?.close(); await rm(base, { recursive: true, force: true })
})
async function disk() { return JSON.parse(await readFile(join(base, 'vault/documents', docId + '.mindnb.json'), 'utf8')) }
async function health() {
  await expect(page.locator('#canvas')).toBeVisible()
  await expect(page.locator('#desktop-save-state')).toContainText('已保存到本机')
  expect(validTree((await disk()).tree)).toBe(true)
  expect(errors).toEqual([])
}
async function check(action: string, run: () => Promise<void>) {
  try { await run(); results.push({ action, result: 'PASS' }); console.log('PASS', action) }
  catch (e) { results.push({ action, result: 'FAIL', detail: String(e).slice(0, 1800) }); console.log('FAIL', action, String(e).slice(0,250)); if (!await page.locator('dialog[open]').count()) await page.keyboard.press('Escape').catch(() => {}) }
}
function verdict() { expect(results.filter(r => r.result === 'FAIL')).toEqual([]); expect(errors).toEqual([]) }
async function openDetails(scope: Locator) {
  for (const summary of await scope.locator('details > summary').all()) {
    if (await summary.isVisible() && !await summary.evaluate(el => (el.parentElement as HTMLDetailsElement).open)) await summary.click()
  }
}
async function selectNode(id?: string) {
  const s = await page.evaluate(() => (window as any).__mindNB)
  const n = s.nodes.find((n: any) => id ? n.id === id : n.depth === 0)
  await page.mouse.click((n.x + n.w / 2) * s.view.k + s.view.tx, (n.y + n.h / 2) * s.view.k + s.view.ty)
  await expect.poll(() => page.evaluate(() => (window as any).__mindNB.primaryId)).toBe(n.id)
}
async function nodePanel() { await selectNode(); await page.locator('#style-panel').getByRole('button', { name: '节点', exact: true }).click(); await openDetails(page.locator('#style-panel')) }
async function chartMenu() { await page.locator('#toolbar-more-btn').click(); await page.locator('#charts-menu-btn').click() }
async function blankPoint() {
  return page.evaluate(() => {
    const s = (window as any).__mindNB, panel = document.getElementById('style-panel')!, right = panel.getBoundingClientRect().left
    let best = { x: 130, y: 140, distance: -1 }
    for (let x = 130; x < right - 40; x += 60) for (let y = 140; y < innerHeight - 180; y += 60) {
      const distance = Math.min(...[...s.nodes, ...s.objects.filter((o: any) => Number.isFinite(o.x))].map((n: any) => {
        const left=n.x*s.view.k+s.view.tx, top=n.y*s.view.k+s.view.ty, w=n.w*s.view.k, h=n.h*s.view.k
        return Math.hypot(Math.max(left-x,0,x-left-w),Math.max(top-y,0,y-top-h))
      }))
      if (distance > best.distance) best={x,y,distance}
    }
    return best
  })
}

test('audit-canvas-all-settings', async () => {
  test.setTimeout(240000)
  const panel = page.locator('#style-panel')
  await panel.getByRole('button', { name: '画布', exact: true }).click(); await openDetails(panel)
  // Keep the imported custom swatches available while enumerating later menus.
  // The default full-color application is asserted by the dedicated theme test.
  await panel.getByRole('checkbox', { name: '保留自定义配色', exact: true }).check()
  // Exhaust every actual option, including the two different popup implementations.
  const pickerLabels = await panel.locator('.setting-trigger,.popover-trigger').evaluateAll(es => es.filter(e => (e as HTMLElement).checkVisibility()).map(e => e.getAttribute('aria-label')!))
  for (const label of pickerLabels) {
    const trigger = panel.getByRole('button', { name: label, exact: true, includeHidden: true })
    await check('画布/' + label + '/菜单键盘', async () => { await trigger.click(); await page.keyboard.press('Escape'); await expect(trigger).toHaveAttribute('aria-expanded', 'false') })
    await trigger.click()
    const menu = page.locator('.setting-menu:visible,.popover-grid:visible,[role=grid]:visible').last()
    await expect(menu).toBeVisible()
    const choices = await menu.locator('button').evaluateAll(es => es.map(e => ({ label: e.getAttribute('aria-label') || e.textContent!.trim(), value: (e as HTMLElement).dataset.value })))
    choices.sort((a,b) => Number(b.label === '自定义') - Number(a.label === '自定义'))
    await page.keyboard.press('Escape')
    for (const c of choices) await check('画布/' + label + '/' + c.label, async () => {
      if (label === '文档默认粗细') await panel.getByLabel('线宽模式').selectOption('uniform')
      await trigger.click()
      const pop = page.locator('.setting-menu:visible,.popover-grid:visible,[role=grid]:visible').last()
      await expect(pop).toBeVisible()
      await pop.getByRole('button', { name: c.label, exact: true }).click()
      await expect(trigger).toHaveAttribute('aria-expanded', 'false'); await health()
    })
  }
  for (const select of await panel.locator('select').all()) {
    if (!await select.isVisible()) continue
    const label = await select.getAttribute('aria-label')
    const options = await select.locator('option:not(:disabled)').evaluateAll(es => es.map(e => ({ value: (e as HTMLOptionElement).value, label: e.textContent })))
    for (const option of options) await check('画布/' + label + '/' + option.label, async () => { await select.selectOption(option.value); await expect(select).toHaveValue(option.value); await health() })
  }
  for (const name of ['布局紧凑', '布局舒展']) await check(name, async () => { await panel.getByRole('button', { name, exact: true }).click(); await expect(panel.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true'); await health() })
  for (const input of await panel.locator('input[type=number]').all()) if (await input.isVisible() && await input.isEnabled()) {
    const name = await input.getAttribute('aria-label') || await input.getAttribute('title') || 'number'
    await check('画布/' + name, async () => { const min = await input.getAttribute('min') || '1'; await input.fill(min); await input.press('Tab'); await health() })
  }
  await page.reload(); await health(); verdict()
})

test('audit-node-all-settings', async () => {
  test.setTimeout(240000); await nodePanel()
  const panel = page.locator('#style-panel')
  const labels = await panel.locator('.setting-trigger,.popover-trigger').evaluateAll(es => es.filter(e => (e as HTMLElement).checkVisibility()).map(e => e.getAttribute('aria-label')!))
  for (const label of labels) {
    const trigger = panel.getByRole('button', { name: label, exact: true }); await trigger.click()
    await expect(page.locator('.setting-menu:visible,[role=grid]:visible').last()).toBeVisible()
    const names = await page.locator('.setting-menu:visible,[role=grid]:visible').last().locator('button').evaluateAll(es => es.map(e => e.getAttribute('aria-label') || e.textContent!.trim()))
    await page.keyboard.press('Escape')
    for (const name of names) await check('节点/' + label + '/' + name, async () => { await trigger.click(); await expect(page.locator('.setting-menu:visible,[role=grid]:visible').last()).toBeVisible(); await page.locator('.setting-menu:visible,[role=grid]:visible').last().getByRole('button', { name, exact: true }).click(); await health() })
  }
  for (const select of await panel.locator('select').all()) if (await select.isVisible()) {
    const name = await select.getAttribute('aria-label')
    for (const value of await select.locator('option:not(:disabled)').evaluateAll(es => es.map(e => (e as HTMLOptionElement).value))) await check('节点/' + name + '/' + value, async () => { await openDetails(panel); await select.selectOption(value); await expect(select).toHaveValue(value); await health() })
  }
  const buttons = panel.locator('.seg-btn:visible,.swatch:visible,.panel-actions button:visible')
  const count = await buttons.count()
  for (let i = 0; i < count; i++) {
    const button = buttons.nth(i), name = await button.getAttribute('title') || await button.innerText()
    if (await button.isEnabled()) await check('节点/' + name, async () => { await button.click(); await health() })
  }
  for (const input of await panel.locator('input[type=number],input[type=text]').all()) if (await input.isVisible() && await input.isEnabled()) {
    const name = await input.getAttribute('aria-label') || await input.getAttribute('title') || 'number'
    await check('节点/' + name, async () => { await input.fill(await input.getAttribute('type') === 'number' ? '180' : '测试副标题'); await input.press('Tab'); await health() })
  }
  await page.reload(); await health(); verdict()
})

for (const [kind, label] of [['table','表格'],['glossary','术语表'],['cycle','循环图'],['flow','流程图'],['timeline','时间轴'],['pyramid','金字塔图'],['circleMap','圆圈图']] as const) test('audit-chart-' + kind, async () => {
  test.setTimeout(90000); await selectNode(); await chartMenu(); await page.locator('#insert-' + kind + '-btn').click()
  const contentPanel = page.locator('#content-panel'); if (!await contentPanel.evaluate(el => (el as HTMLDetailsElement).open)) await contentPanel.locator('summary').click()
  await contentPanel.getByRole('button', { name: '编辑内容', exact: true }).last().click()
  const dialog = page.getByRole('dialog', { name: '编辑' + (kind === 'glossary' ? '表格' : label), exact: true })
  await expect(dialog).toBeVisible()
  const inputs = dialog.locator('textarea,input[type=text]')
  await inputs.first().fill('测试内容')
  for (const button of await dialog.locator('.content-editor-tools button').all()) {
    const name = await button.innerText(); await check(label + '/' + name, async () => { await button.click(); await expect(dialog).toBeVisible() })
  }
  if (kind !== 'table' && kind !== 'glossary') {
    for (const name of ['下移','上移']) await check(label + '/' + name, async () => { const bs = dialog.getByRole('button', { name, exact: true }); for (const b of await bs.all()) if (await b.isEnabled()) { await b.click(); break } })
    await check(label + '/删除条目', async () => { await dialog.getByRole('button', { name: /^删除/ }).first().click() })
  }
  for (const input of await dialog.locator('input[type=number]').all()) await check(label + '/列宽', async () => { await input.fill('160'); await input.press('Tab') })
  for (const input of await dialog.locator('input[type=color]').all()) await check(label + '/颜色', async () => { await input.fill('#338855'); await input.dispatchEvent('change') })
  await dialog.getByRole('button', { name: '完成', exact: true }).click(); await health()
  if (!await contentPanel.evaluate(el => (el as HTMLDetailsElement).open)) await contentPanel.locator('summary').click(); await contentPanel.getByRole('button', { name: '编辑内容', exact: true }).last().click()
  await dialog.getByRole('button', { name: '取消', exact: true }).click(); await health()
  await page.reload(); await health(); verdict()
})

test('audit-export-every-format-and-scope', async () => {
  test.setTimeout(180000)
  await page.getByRole('button', { name: '导出文档', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '导出文档' }), format = dialog.getByLabel('导出格式')
  const formats = await format.locator('option').evaluateAll(es => es.map(e => ({ value: (e as HTMLOptionElement).value, name: e.textContent })))
  for (const f of formats) for (const scope of ['all','current']) await check('导出/' + f.name + '/' + scope, async () => {
    await format.selectOption(f.value); await dialog.getByLabel('导出范围').selectOption(scope)
    const path = join(base, f.value + '-' + scope)
    await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, path)
    // The click starts CPU-heavy export work; use the export deadline, not the
    // 3.5-second timeout reserved for ordinary inspector interactions.
    await dialog.getByRole('button', { name: '导出', exact: true }).click({ timeout: 30000 })
    await expect(dialog.getByRole('status')).toHaveText('文件已保存', { timeout: 30000 })
    await expect.poll(() => readFile(path).then(b => b.length, () => 0)).toBeGreaterThan(0)
    if (f.value === 'mindnb') expect((await readPortable(await readFile(path))).tree.root.text).toContain('合成图文回归样例')
    if (f.value === 'md') expect(await readFile(path, 'utf8')).not.toMatch(/mindnb:\/\/asset\//)
  })
  await dialog.getByRole('button', { name: '关闭', exact: true }).click(); await health(); verdict()
})

test('audit-navigation-context-and-history', async () => {
  test.setTimeout(120000)
  const state = () => page.evaluate(() => (window as any).__mindNB)
  await check('缩放/缩小/放大/100%/适应窗口', async () => {
    const k = (await state()).view.k
    await page.getByRole('button', { name: '缩小', exact: true }).click(); expect((await state()).view.k).toBeLessThan(k)
    await page.getByRole('button', { name: '放大', exact: true }).click(); expect((await state()).view.k).toBeCloseTo(k, 2)
    await page.getByRole('button', { name: '恢复 100% 缩放', exact: true }).click(); expect((await state()).view.k).toBeCloseTo(1, 6)
    await page.getByRole('button', { name: '适应窗口', exact: true }).click()
  })
  await check('格式面板/收起与展开', async () => {
    await page.locator('#panel-toggle-btn').click(); await expect(page.locator('#app')).toHaveClass(/panel-hidden/)
    await page.locator('#panel-toggle-btn').click(); await expect(page.locator('#app')).not.toHaveClass(/panel-hidden/)
  })
  await check('更多工具/导航缩略图/全部/收起/展开/定位/拖动', async () => {
    await page.locator('#toolbar-more-btn').click(); await page.getByRole('button', { name: '显示 / 隐藏缩略图', exact: true }).click()
    await expect(page.locator('#minimap')).toBeVisible()
    await page.getByRole('button', { name: '查看当前范围全部内容' }).click()
    await page.getByRole('button', { name: '收起导航缩略图' }).click(); await expect(page.locator('#minimap')).toHaveClass(/collapsed/)
    await page.getByRole('button', { name: '展开导航缩略图' }).click()
    const b = (await page.locator('#minimap > svg').boundingBox())!; await page.mouse.click(b.x + 20, b.y + 20)
    await page.mouse.move(b.x + 30, b.y + 30); await page.mouse.down(); await page.mouse.move(b.x + 70, b.y + 55, { steps: 6 }); await page.mouse.up()
    await page.getByRole('button', { name: '适应窗口', exact: true }).click()
  })
  const rootId = (await disk()).tree.root.id
  await selectNode(rootId)
  await check('节点工具栏/新增子级/编辑/撤销/重做', async () => {
    const count = (await disk()).tree.root.children.length
    await page.locator('#node-child').click(); await page.locator('#node-editor').fill('新增测试节点'); await page.locator('#node-editor').press('Escape'); await health()
    expect((await disk()).tree.root.children.length).toBe(count + 1)
    await page.locator('#toolbar-undo-btn').click(); await health()
    await page.locator('#toolbar-redo-btn').click(); await health()
    expect(JSON.stringify((await disk()).tree)).toContain('新增测试节点')
  })
  await check('节点工具栏/新增同级', async () => { await page.locator('#node-sibling').click(); await page.locator('#node-editor').fill('测试同级'); await page.locator('#node-editor').press('Escape'); await health(); expect(JSON.stringify((await disk()).tree)).toContain('测试同级') })
  const context = async (label: string) => { await page.locator('#node-more').click(); await page.getByRole('menuitem', { name: label, exact: true }).click() }
  await check('右键菜单/编辑文字', async () => { await context('编辑文字'); await page.locator('#node-editor').fill('编辑测试同级'); await page.locator('#node-editor').press('Escape'); await health() })
  await check('右键菜单/复制样式/粘贴样式', async () => { await context('复制样式'); await context('粘贴样式'); await health() })
  await check('右键菜单/复制节点及子树/删除', async () => {
    const count = (await disk()).tree.root.children.length
    await context('复制此节点及子树'); await health(); expect((await disk()).tree.root.children.length).toBe(count + 1)
    await context('删除所选内容（含子树）'); await health(); expect((await disk()).tree.root.children.length).toBe(count)
  })
  await check('分支/折叠与展开/下钻与返回', async () => {
    await page.getByRole('button', { name: '适应窗口', exact: true }).click(); const child = (await disk()).tree.root.children[0].id; await selectNode(child)
    const count = (await state()).nodes.length
    await context('折叠 / 展开'); expect((await state()).nodes.length).toBeLessThan(count)
    await context('折叠 / 展开'); expect((await state()).nodes.length).toBe(count)
    await context('聚焦此分支'); expect((await state()).drillPath).toContain(child)
    await page.locator('#drill-path button').first().click(); expect((await state()).drillPath).toEqual([])
  })
  await check('独立主题/新增/复制/列表定位', async () => {
    await page.locator('#insert-menu-btn').click(); await page.locator('#insert-topic-btn').click()
    await page.locator('#node-editor').fill('测试独立主题'); await page.locator('#node-editor').press('Escape'); await health()
    expect((await disk()).tree.topics).toHaveLength(1)
    await context('复制独立主题'); await health(); expect((await disk()).tree.topics).toHaveLength(2)
    const topicId = (await disk()).tree.topics[0].node.id
    await page.getByRole('button', { name: '图层', exact: true }).click()
    const topicRow = page.locator(`[data-layer-id="${topicId}"]`)
    await expect(topicRow).toBeVisible(); await topicRow.click()
    await expect(topicRow).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: '收起左侧面板', exact: true }).click()
  })
  await check('首页/文档操作/复制/历史/重命名/取消删除', async () => {
    await page.getByRole('button', { name: '回到首页' }).click(); await expect(page.locator('#home')).toBeVisible()
    await page.getByRole('button', { name: '文档操作', exact: true }).first().click()
    await page.getByRole('button', { name: '复制', exact: true }).click(); await expect(page.locator('.card[data-id]')).toHaveCount(2)
    await page.getByRole('button', { name: '文档操作', exact: true }).first().click(); await page.getByRole('button', { name: '版本历史', exact: true }).click()
    const history = page.getByRole('dialog',{name:'本机版本历史'}); await expect(history).toBeVisible(); await history.getByRole('button',{name:'关闭',exact:true}).click()
  })
  verdict()
})

test('audit-theme-visual-effect-undo-and-reopen', async () => {
  const before = (await disk()).tree
  const panel = page.locator('#style-panel')
  await panel.getByRole('button', { name: '画布', exact: true }).click()
  await check('主题/勾选保留自定义配色/切换/撤销/取消勾选', async () => {
    const preserve = panel.getByRole('checkbox', { name: '保留自定义配色', exact: true })
    await expect(preserve).not.toBeChecked(); await preserve.check()
    await panel.getByRole('button', { name: '主题', exact: true }).click()
    await page.getByRole('dialog', { name: '主题选项' }).getByRole('button', { name: '夜航', exact: true }).click()
    await health(); const preserved = (await disk()).tree
    expect(preserved.theme).toBe('night'); expect(preserved.root).toEqual(before.root)
    expect(preserved.paper).toBe(before.paper); expect(preserved.branchPalette).toEqual(before.branchPalette)
    await page.locator('#toolbar-undo-btn').click(); await health(); expect((await disk()).tree).toEqual(before)
    await preserve.uncheck()
  })
  await page.screenshot({ path: join(evidence, 'theme-before.png') })
  await panel.getByRole('button', { name: '主题', exact: true }).click()
  await page.getByRole('dialog', { name: '主题选项' }).getByRole('button', { name: '小黑板', exact: true }).click()
  await health(); const after = (await disk()).tree
  await page.screenshot({ path: join(evidence, 'theme-after.png') })
  await check('主题/自定义餐谱切换后实际纸底与节点配色变化', async () => {
    expect(after.theme).toBe('chalkboard'); expect(after.paper).toBeUndefined(); expect(after.ink).toBeUndefined(); expect(after.branchPalette).toBeUndefined()
    expect(after.root.style.color).toBeUndefined(); expect(after.root.style.fill).toBeUndefined(); expect(after.root.children[0].branchColor).toBeUndefined()
    expect(after.root.text).toBe(before.root.text); expect(after.root.contents).toEqual(before.root.contents)
    expect(after.root.style.width).toBe(before.root.style.width); expect(after.root.style.fontSize).toBe(before.root.style.fontSize)
  })
  if (after.root.style?.backdrop) await check('主题/手帐纸片标题可读/手绘底色跟随分支/PNG与SVG导出', async () => {
    const colors = nodeColorsOf(after), theme = resolveTheme(after)
    for (const node of after.root.children.filter((n: any) => n.style?.backdrop === 'brush')) {
      const href = await page.locator(`#canvas [data-id="${node.id}"] > image`).first().getAttribute('href')
      expect(decodeURIComponent(href!)).toContain(`flood-color="${colors.get(node.id)}"`)
    }
    const titleInk = await page.locator(`#canvas [data-id="${after.root.id}"] > text`).first().getAttribute('fill')
    expect(isDarkColor(titleInk!)).toBe(true)
    expect(titleInk).not.toBe(theme.ink)
    await page.getByRole('button', { name: '导出文档', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '导出文档' })
    for (const format of ['png','svg']) {
      const path = join(evidence, 'journal-themed.' + format)
      await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, path)
      await dialog.getByLabel('导出格式').selectOption(format)
      await dialog.getByRole('button', { name: '导出', exact: true }).click()
      await expect(dialog.getByRole('status')).toHaveText('文件已保存', { timeout: 30000 })
      await expect.poll(() => readFile(path).then(b => b.length, () => 0)).toBeGreaterThan(100000)
      if (format === 'svg') expect(await readFile(path, 'utf8')).toContain(`fill="${titleInk}"`)
    }
    await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  })
  await check('主题/一步撤销恢复原始手帐/重做/重启', async () => {
    await page.locator('#toolbar-undo-btn').click(); await health(); expect((await disk()).tree).toEqual(before)
    await page.locator('#toolbar-redo-btn').click(); await health(); expect((await disk()).tree).toEqual(after)
    await page.reload(); await health(); expect((await disk()).tree).toEqual(after)
  })
  verdict()
})

test('audit-note-media-and-embedded-content', async () => {
  test.setTimeout(180000); await selectNode()
  await check('注释/输入/粗体/斜体/列表/链接/关闭回读/删除/撤销', async () => {
    await page.locator('#node-note').click(); const note = page.locator('#node-note-panel'), input = note.getByLabel('注释正文')
    await input.fill('注释测试'); for (const label of ['粗体','斜体','列表','链接']) await note.getByRole('button', { name: label, exact: true }).click()
    await note.getByRole('button', { name: '关闭注释', exact: true }).click(); await health(); expect((await disk()).tree.root.note.markdown).toContain('注释测试')
    await page.locator('#node-note').click(); await note.getByRole('button', { name: '重试保存', exact: true }).click(); await note.getByRole('button', { name: '删除注释', exact: true }).click(); await note.getByRole('button', { name: '关闭注释', exact: true }).click(); await health(); expect((await disk()).tree.root.note).toBeUndefined()
    await page.locator('#toolbar-undo-btn').click(); await health(); expect((await disk()).tree.root.note).toBeDefined()
  })
  const media = page.getByRole('dialog', { name: '添加到节点', exact: true })
  await check('素材/打开关闭/无效文件', async () => {
    await page.locator('#node-media').click(); await media.getByLabel('上传节点图片').setInputFiles({ name: 'wrong.txt', mimeType: 'text/plain', buffer: Buffer.from('test') })
    await expect(media.getByRole('status')).toContainText('PNG'); await media.getByRole('button', { name: '关闭素材' }).click()
  })
  await check('素材/图片上传', async () => { await page.locator('#node-media').click(); await media.getByLabel('上传节点图片').setInputFiles(resolve('tests/fixtures/monday.png')); await expect(media).not.toBeVisible(); await health(); expect((await disk()).tree.root.contents.length).toBe(2) })
  await page.locator('#node-media').click(); await media.getByRole('button', { name: '图标', exact: true }).click()
  const icons = await media.locator('.node-icon-grid button').evaluateAll(es => es.map(e => e.getAttribute('aria-label')!)); await media.getByRole('button', { name: '关闭素材' }).click()
  for (const icon of icons) await check('素材/图标/' + icon, async () => { await page.locator('#node-media').click(); await media.getByRole('button', { name: '图标', exact: true }).click(); await media.getByLabel('搜索节点图标').fill(icon); await media.getByRole('button', { name: icon, exact: true }).click(); await health(); expect((await disk()).tree.root.icon).toBeDefined() })
  await check('素材/图标颜色/移除', async () => { await page.locator('#node-media').click(); await media.getByRole('button', { name: '图标', exact: true }).click(); await media.getByLabel('图标颜色').fill('#CC7744'); await media.getByRole('button', { name: '移除图标', exact: true }).click(); await health(); expect((await disk()).tree.root.icon).toBeUndefined() })
  await check('素材/插画/分类/类型/搜索/插入', async () => {
    await page.locator('#node-media').click(); await media.getByRole('button', { name: '插画', exact: true }).click()
    for (const select of await media.locator('select').all()) { const options = await select.locator('option').evaluateAll(es => es.map(e => (e as HTMLOptionElement).value)); for (const value of options) { await select.selectOption(value); await expect(select).toHaveValue(value) } await select.selectOption('') }
    await media.getByLabel('搜索插图').fill('impossible-search-123'); await expect(media.locator('.sticker-cell')).toHaveCount(0)
    await media.getByLabel('搜索插图').fill(''); await media.locator('.sticker-cell').first().click(); await health()
  })
  const panel = page.locator('#content-panel'), show = async () => { if (!await panel.evaluate(el => (el as HTMLDetailsElement).open)) await panel.locator('summary').click() }
  await check('内嵌内容/连续调整图文排列保持面板展开', async () => { await show(); await panel.getByLabel('图文排列').selectOption('above'); await expect(panel.getByLabel('图文排列')).toBeVisible() })
  await check('内嵌内容/查看原图/替换/宽度', async () => {
    await show(); await panel.getByRole('button', { name: '查看原图', exact: true }).first().click(); await expect(page.locator('dialog img')).toBeVisible(); await page.locator('dialog').getByRole('button', { name: '关闭', exact: true }).click()
    await panel.locator('input[type=file]').first().setInputFiles(resolve('tests/fixtures/friday.png')); await health(); await show()
    await panel.getByLabel('图片宽度', { exact: true }).first().fill('200'); await panel.getByLabel('图片宽度', { exact: true }).first().press('Tab'); await health()
  })
  await check('内嵌内容/装饰摆放/偏移/排序', async () => {
    await show(); await panel.getByLabel('摆放方式', { exact: true }).first().selectOption('overlay'); await show()
    for (const name of ['左右偏移','上下偏移']) { await panel.getByLabel(name).first().fill('50'); await panel.getByLabel(name).first().press('Tab'); await show() }
    await panel.getByRole('button', { name: '下移', exact: true }).first().click(); await show(); await panel.getByRole('button', { name: '上移', exact: true }).first().click(); await health()
  })
  await check('内嵌内容/移到画布/撤销/删除内容', async () => { await show(); await panel.getByRole('button', { name: '移到画布', exact: true }).first().click(); await health(); expect((await disk()).tree.objects.some((o: any) => o.kind === 'image')).toBe(true); await page.locator('#toolbar-undo-btn').click(); await health(); await show(); const count = (await disk()).tree.root.contents.length; await panel.getByRole('button', { name: '删除内容', exact: true }).last().click(); await health(); expect((await disk()).tree.root.contents.length).toBe(count - 1) })
  await page.reload(); await health(); verdict()
})

test('audit-ink-and-canvas-objects', async () => {
  test.setTimeout(120000)
  const drag = async (x: number, y: number, dx = 80, dy = 30) => { await page.mouse.move(x,y); await page.mouse.down(); await page.mouse.move(x+dx,y+dy,{steps:8}); await page.mouse.up() }
  await check('手绘/画笔/荧光笔/颜色/粗细/连续绘画/整笔擦除/撤销', async () => {
    await page.locator('#ink-mode-btn').click(); await page.locator('#ink-pen-btn').click(); await page.getByLabel('画笔颜色').fill('#339966'); await page.getByLabel('画笔粗细').fill('5')
    await drag(180,220); await drag(180,280); await health(); expect((await disk()).tree.objects.filter((o: any) => o.kind === 'ink')).toHaveLength(2)
    await page.locator('#ink-highlight-btn').click(); await drag(180,330); await health(); expect((await disk()).tree.objects.filter((o: any) => o.kind === 'ink')).toHaveLength(3)
    await page.locator('#ink-erase-btn').click(); await drag(180,220); await health(); expect((await disk()).tree.objects.filter((o: any) => o.kind === 'ink')).toHaveLength(2)
    await page.locator('#toolbar-undo-btn').click(); await health(); expect((await disk()).tree.objects.filter((o: any) => o.kind === 'ink')).toHaveLength(3)
  })
  await check('手绘/框选/选择/收起', async () => { await page.locator('#ink-box-btn').click(); await drag(160,200,150,170); expect((await page.evaluate(() => (window as any).__mindNB.selectedIds)).length).toBeGreaterThan(0); await page.locator('#ink-embed-btn').click(); const d = page.getByRole('dialog',{name:'笔迹放入节点'}); await d.getByRole('button',{name:'取消',exact:true}).click(); await page.locator('#ink-embed-btn').click(); await d.getByLabel('笔迹目标节点').selectOption((await disk()).tree.root.id); await d.getByRole('button',{name:'放入节点',exact:true}).click(); await health(); expect((await disk()).tree.root.contents.some((c: any) => c.kind === 'ink')).toBe(true); await page.locator('#toolbar-undo-btn').click(); await health(); await page.locator('#ink-select-btn').click(); await page.locator('#ink-close-btn').click(); await expect(page.locator('#ink-toolbar')).not.toBeVisible(); await expect(page.locator('#tool-select-btn')).toHaveAttribute('aria-pressed','true') })
  await page.getByRole('button', { name: '适应窗口', exact: true }).click(); await selectNode()
  await check('节点内手绘/画笔/荧光笔/橡皮/撤销/重做/完成', async () => {
    await chartMenu(); await page.locator('#insert-ink-btn').click(); const d = page.getByRole('dialog', { name: '编辑笔迹' }), b = (await d.locator('svg.ink-editor-canvas').boundingBox())!
    await drag(b.x+80,b.y+80); await d.getByRole('button', { name: '荧光笔', exact: true }).click(); await drag(b.x+80,b.y+160)
    await d.getByRole('button', { name: '撤销笔迹' }).click(); await d.getByRole('button', { name: '重做笔迹' }).click()
    await d.getByRole('button', { name: '整笔橡皮擦' }).click(); await drag(b.x+80,b.y+80)
    await d.getByRole('button', { name: '完成', exact: true }).click(); await health(); expect((await disk()).tree.root.contents.some((c: any) => c.kind === 'ink')).toBe(true)
  })
  await check('插入/空白分组框/描边/删除/撤销', async () => {
    await page.locator('#insert-menu-btn').click(); await page.locator('#insert-group-btn').click(); await health()
    expect((await disk()).tree.objects.some((o: any) => o.kind === 'group')).toBe(true)
    const p = page.locator('#style-panel'); await p.getByRole('button', { name: '虚线', exact: true }).click(); await p.getByRole('button', { name: '实线', exact: true }).click(); await p.getByRole('button', { name: '删除', exact: true }).click(); await health(); await page.locator('#toolbar-undo-btn').click(); await health()
  })
  await page.reload(); await health(); verdict()
})

test('audit-relationships-boundaries-summaries-and-transfer', async () => {
  test.setTimeout(150000)
  const panel = page.locator('#style-panel')
  const clickNode = async (id: string, mod = false) => {
    const s = await page.evaluate(() => (window as any).__mindNB), n = s.nodes.find((n: any) => n.id === id)
    if (mod) await page.keyboard.down('ControlOrMeta')
    await page.mouse.click((n.x+n.w/2)*s.view.k+s.view.tx, (n.y+n.h/2)*s.view.k+s.view.ty)
    if (mod) await page.keyboard.up('ControlOrMeta')
  }
  const a = (await disk()).tree.root.children[0].id, b = (await disk()).tree.root.children[1].id
  await check('关系线/选两节点创建/标签', async () => {
    await clickNode(a); await clickNode(b,true); await page.locator('#toolbar-more-btn').click(); await page.locator('#link-btn').click(); await health()
    expect((await disk()).tree.objects.filter((o: any) => o.kind === 'edge')).toHaveLength(1)
    await panel.getByLabel('关系线标签', {exact:true}).fill('测试关系'); await panel.getByLabel('关系线标签', {exact:true}).press('Tab'); await health(); expect((await disk()).tree.objects.find((o: any) => o.kind === 'edge').label).toBe('测试关系')
  })
  for (const name of ['关系线线形','关系线箭头']) {
    const select = panel.getByLabel(name,{exact:true})
    for (const value of await select.locator('option').evaluateAll(es => es.map(e => (e as HTMLOptionElement).value))) await check(name + '/' + value, async () => { await select.selectOption(value); await expect(select).toHaveValue(value); await health() })
  }
  await check('关系线/宽度/颜色/层级/重置', async () => {
    await panel.getByLabel('关系线宽度').fill('6'); await panel.getByLabel('关系线宽度').dispatchEvent('change')
    for (const button of await panel.locator('.swatch:visible').all()) await button.click()
    for (const name of ['置顶','上移','下移','置底']) { const bt = panel.getByRole('button',{name,exact:true}); if (await bt.isEnabled()) await bt.click() }
    await panel.getByRole('button',{name:'重置关系线'}).click(); await health(); expect((await disk()).tree.objects.find((o: any) => o.kind === 'edge').width).toBeUndefined()
  })
  for (const [kind,name] of [['boundary','外框'],['summary','概要']] as const) await check('多选/' + name + '/创建编辑删除撤销', async () => {
    await clickNode(a); await clickNode(b,true)
    await page.locator('#insert-menu-btn').click(); await page.locator('#'+kind+'-btn').click(); await health()
    expect((await disk()).tree.objects.some((o: any) => o.kind === kind)).toBe(true)
    if (kind === 'boundary') {
      for (const label of ['虚线','实线']) await panel.getByRole('button',{name:label,exact:true}).click()
      for (const button of await panel.locator('.swatch:visible').all()) await button.click()
    }
    await panel.getByRole('button',{name:'删除',exact:true}).click(); await health(); expect((await disk()).tree.objects.some((o: any) => o.kind === kind)).toBe(false)
    await page.locator('#toolbar-undo-btn').click(); await health(); expect((await disk()).tree.objects.some((o: any) => o.kind === kind)).toBe(true)
  })
  await check('独立图片/插入/描边/原图/移入节点/删除', async () => {
    const p = await blankPoint(); await page.mouse.click(p.x,p.y); await expect.poll(() => page.evaluate(() => (window as any).__mindNB.selectedIds.length)).toBe(0); await page.locator('#insert-menu-btn').click()
    const chooser = page.waitForEvent('filechooser'); await page.locator('#insert-image-btn').click(); await (await chooser).setFiles(resolve('tests/fixtures/friday.png')); await health()
    await expect.poll(async () => (await disk()).tree.objects?.some((o: any) => o.kind === 'image')).toBe(true); const image = (await disk()).tree.objects.find((o: any) => o.kind === 'image')
    await panel.getByRole('button',{name:'描边框',exact:true}).click(); await health(); expect((await disk()).tree.objects.find((o: any) => o.id === image.id).framed).toBe(true)
    await panel.getByRole('button',{name:'查看原图',exact:true}).click(); await page.locator('dialog').getByRole('button',{name:'关闭',exact:true}).click()
    await panel.getByLabel('移入目标节点').selectOption(a); await panel.getByRole('button',{name:'移入节点',exact:true}).click(); await health()
    expect((await disk()).tree.objects.some((o: any) => o.id === image.id)).toBe(false)
  })
  await check('插入/贴纸/分类搜索/画布放置', async () => {
    const p = await blankPoint(); await page.mouse.click(p.x,p.y); await expect.poll(() => page.evaluate(() => (window as any).__mindNB.selectedIds.length)).toBe(0); await page.locator('#insert-menu-btn').click(); await page.locator('#insert-sticker-btn').click()
    const pop = page.locator('.toolbar-pop'); await pop.getByLabel('插图类型').selectOption('sketch'); await pop.locator('.sticker-cell').first().click(); await health(); await expect.poll(async () => (await disk()).tree.objects?.some((o: any) => o.kind === 'sticker')).toBe(true)
  })
  await page.reload(); await health(); verdict()
})

test('audit-drag-keyboard-and-file-lifecycle', async () => {
  test.setTimeout(120000)
  const state = () => page.evaluate(() => (window as any).__mindNB)
  const point = async (id: string) => { const s = await state(), n = s.nodes.find((n: any) => n.id === id); return {x:(n.x+n.w/2)*s.view.k+s.view.tx,y:(n.y+n.h/2)*s.view.k+s.view.ty} }
  const root = (await disk()).tree.root.id
  await check('键盘/F2编辑/Escape/Tab新建/Enter同级/方向导航/Delete/撤销重做', async () => {
    await selectNode(root); await page.keyboard.press('F2'); await page.locator('#node-editor').fill('键盘测试'); await page.locator('#node-editor').press('Escape'); await health(); expect((await disk()).tree.root.text).toBe('键盘测试')
    await page.keyboard.press('Tab'); await page.locator('#node-editor').fill('键盘子级'); await page.locator('#node-editor').press('Escape')
    await page.keyboard.press('Enter'); await page.locator('#node-editor').fill('键盘同级'); await page.locator('#node-editor').press('Escape'); await health()
    for (const key of ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight']) { await page.keyboard.press(key); expect((await state()).primaryId).toBeTruthy() }
    const id = (await disk()).tree.root.children.find((n: any) => n.text === '键盘同级').id
    await page.getByRole('button',{name:'适应窗口',exact:true}).click(); await selectNode(id); await page.keyboard.press('Delete'); await health(); expect((await disk()).tree.root.children.some((n: any) => n.id === id)).toBe(false)
    await page.keyboard.press('ControlOrMeta+z'); await health(); expect((await disk()).tree.root.children.some((n: any) => n.id === id)).toBe(true)
    await page.keyboard.press('ControlOrMeta+Shift+z'); await health(); expect((await disk()).tree.root.children.some((n: any) => n.id === id)).toBe(false)
  })
  await check('鼠标/拖节点成为游离节点/重新挂接/撤销', async () => {
    await page.getByRole('button',{name:'适应窗口',exact:true}).click()
    const id = (await disk()).tree.root.children.find((n: any) => n.text === '键盘子级').id, from = await point(id), empty = await blankPoint()
    await page.mouse.move(from.x,from.y); await page.mouse.down(); await page.mouse.move(empty.x,empty.y,{steps:15}); await page.mouse.up(); await health(); await expect.poll(async () => (await disk()).tree.floating?.some((f: any) => f.node.id === id)).toBe(true)
    const floating = await point(id), target = await point(root); await page.mouse.move(floating.x,floating.y); await page.mouse.down(); await page.mouse.move(target.x,target.y,{steps:15}); await page.mouse.up(); await health(); expect((await disk()).tree.root.children.some((n: any) => n.id === id)).toBe(true)
    await page.locator('#toolbar-undo-btn').click(); await health(); expect((await disk()).tree.floating?.some((f: any) => f.node.id === id)).toBe(true); await page.locator('#toolbar-undo-btn').click(); await health()
  })
  await check('鼠标/双击空白游离节点/框选/全选', async () => {
    const p = await blankPoint(); await page.mouse.dblclick(p.x,p.y); await page.locator('#node-editor').fill('游离内容'); await page.locator('#node-editor').press('Escape'); await health(); expect((await disk()).tree.floating.some((f: any) => f.node.text === '游离内容')).toBe(true)
    await page.keyboard.down('Shift'); await page.mouse.move(90,120); await page.mouse.down(); await page.mouse.move(700,600,{steps:10}); await page.mouse.up(); await page.keyboard.up('Shift'); expect((await state()).selectedIds.length).toBeGreaterThan(0)
    await page.keyboard.press('ControlOrMeta+a'); expect((await state()).selectedIds.length).toBeGreaterThan(1)
  })
  await check('资料库/选择取消/导入取消', async () => {
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled:true,filePaths:[] }) })
    await page.getByRole('button',{name:'回到首页'}).click()
    await page.getByRole('button',{name:'选择资料库',exact:true}).click(); await expect(page.locator('#home')).toBeVisible()
    await page.getByRole('button',{name:'导入 .mindnb',exact:true}).click(); await expect(page.locator('#home')).toBeVisible(); await page.locator('.card[data-id] .card-thumb').click(); await health()
  })
  await check('首页/历史版本恢复/取消删除/确认删除/回收站恢复/重新打开', async () => {
    await page.getByRole('button',{name:'回到首页'}).click(); await page.getByRole('button',{name:'文档操作',exact:true}).click(); await page.getByRole('button',{name:'版本历史',exact:true}).click()
    const history = page.getByRole('dialog',{name:'本机版本历史'}); await history.getByRole('button',{name:/^恢复 /}).first().click(); await expect(history).not.toBeVisible(); await health()
    await page.getByRole('button',{name:'回到首页'}).click(); await page.getByRole('button',{name:'文档操作',exact:true}).click(); await page.getByRole('button',{name:'删除',exact:true}).click(); await page.locator('.modal').getByRole('button',{name:'取消',exact:true}).click(); await expect(page.locator('.card[data-id]')).toHaveCount(1)
    await page.getByRole('button',{name:'文档操作',exact:true}).click(); await page.getByRole('button',{name:'删除',exact:true}).click(); await page.locator('.modal').getByRole('button',{name:'删除',exact:true}).click(); await expect(page.locator('.card[data-id]')).toHaveCount(0)
    await page.getByRole('button',{name:'回收站',exact:true}).click(); await page.getByRole('dialog',{name:'回收站'}).getByRole('button',{name:'恢复',exact:true}).click(); await expect(page.getByRole('dialog',{name:'回收站'})).toContainText('回收站是空的'); await page.getByRole('dialog',{name:'回收站'}).getByRole('button',{name:'关闭',exact:true}).click(); await page.locator('.card[data-id] .card-thumb').click(); await health()
  })
  verdict()
})

test('audit-paper-strength-undo-redo', async () => {
  await page.getByRole('button', { name: '纸张', exact: true }).click()
  await page.locator('#document-paper > summary').click()
  const before = (await disk()).tree
  await page.getByLabel('文档纸纹浓度', { exact: true }).selectOption('0.25'); await health(); expect((await disk()).tree.paperOpacity).toBe(0.25)
  await check('纸纹浓度/撤销完整恢复/重做/回读', async () => {
    await page.locator('#toolbar-undo-btn').click(); await health(); expect((await disk()).tree).toEqual(before)
    await page.locator('#toolbar-redo-btn').click(); await health(); expect((await disk()).tree.paperOpacity).toBe(0.25)
  })
  verdict()
})
