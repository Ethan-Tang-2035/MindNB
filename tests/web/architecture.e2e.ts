import { test, expect, type Page } from '@playwright/test'
import { emptyTree, createNode, type MindMap } from '../../src/model.ts'
import { INDEX_KEY, docKey, viewKey } from '../../src/docs.ts'
import { assignToPage, createPage, updatePage } from '../../src/paper-pages.ts'

const id = 'architecture-acceptance'
async function start(page: Page, tree: MindMap) {
  await page.addInitScript(({ tree, index, doc, view, id }) => {
    if (localStorage.getItem(index)) return
    localStorage.setItem(index, JSON.stringify([{ id, createdAt: 1, updatedAt: 1, nameOverride: 'Architecture acceptance' }]))
    localStorage.setItem(doc, JSON.stringify(tree))
    localStorage.setItem(view, JSON.stringify({ coordinateVersion: 2, tx: 0, ty: 0, k: 1, dx: 0, dy: 0 }))
  }, { tree, index: INDEX_KEY, doc: docKey(id), view: viewKey(id), id })
  await page.goto('/#/doc/' + id)
  await page.waitForFunction(() => !!(window as any).__mindNB)
  await page.evaluate(() => document.fonts.ready)
}
async function stored(page: Page): Promise<MindMap> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), docKey(id))
}
async function point(page: Page, id: string, fx = .5, fy = .5) {
  return page.evaluate(({ id, fx, fy }) => {
    const s = (window as any).__mindNB, n = [...s.nodes, ...s.objects].find((n: any) => n.id === id)
    return { x: (n.x + n.w * fx) * s.view.k + s.view.tx, y: (n.y + n.h * fy) * s.view.k + s.view.ty, k: s.view.k }
  }, { id, fx, fy })
}
async function click(page: Page, id: string) { const p = await point(page, id); await page.mouse.click(p.x, p.y) }

test('resize and group drag preview are cancellable and commit one durable undo step', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  let map = emptyTree(); map.visualStyle = 'clear'; map.rootPosition = { x: 850, y: 180 }
  map.objects = [
    { id: 'group', kind: 'group', seed: 1, x: 250, y: 400, w: 200, h: 150 },
    { id: 'image', kind: 'image', seed: 2, x: 280, y: 430, w: 80, h: 60, src: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="#559966"/></svg>') },
  ]
  const made = createPage(map, { x: 200, y: 350, preset: 'custom' })
  map = updatePage(assignToPage(made.map, made.id, ['group', 'image']), made.id, { w: 400, h: 300, overflow: 'grow' })
  await start(page, map)
  await click(page, 'image')
  const before = await stored(page), handle = await point(page, 'image', 1, 1)
  await page.mouse.move(handle.x, handle.y); await page.mouse.down()
  await page.mouse.move(handle.x + 330, handle.y + 240, { steps: 10 })
  expect(await stored(page)).toEqual(before)
  await page.keyboard.press('Escape'); await page.mouse.up()
  expect(await stored(page)).toEqual(before)
  await expect(page.locator('#toolbar-undo-btn')).toBeDisabled()
  await page.mouse.move(handle.x, handle.y); await page.mouse.down()
  await page.mouse.move(handle.x + 330, handle.y + 240, { steps: 10 }); await page.mouse.up()
  const resized = await stored(page)
  expect(resized.objects!.find(o => o.id === 'image')).toMatchObject({ w: 410 })
  expect(resized.pages![0].w).toBeGreaterThan(before.pages![0].w)
  await page.locator('#toolbar-undo-btn').click(); expect(await stored(page)).toEqual(before)
  await expect(page.locator('#toolbar-undo-btn')).toBeDisabled()

  const groupPoint = await point(page, 'group', .05, .5)
  await page.mouse.move(groupPoint.x, groupPoint.y); await page.mouse.down()
  await page.mouse.move(groupPoint.x + 220 * groupPoint.k, groupPoint.y + 120 * groupPoint.k, { steps: 10 })
  expect(await stored(page)).toEqual(before)
  await page.keyboard.press('Escape'); await page.mouse.up()
  expect(await stored(page)).toEqual(before)
  await page.mouse.move(groupPoint.x, groupPoint.y); await page.mouse.down()
  await page.mouse.move(groupPoint.x + 220 * groupPoint.k, groupPoint.y + 120 * groupPoint.k, { steps: 10 }); await page.mouse.up()
  const moved = await stored(page)
  expect(moved.objects!.find(o => o.id === 'group')).toMatchObject({ x: 470, y: 520 })
  expect(moved.objects!.find(o => o.id === 'image')).toMatchObject({ x: 500, y: 550 })
  expect(moved.pages![0].w).toBeGreaterThan(before.pages![0].w)
  await page.locator('#toolbar-undo-btn').click(); expect(await stored(page)).toEqual(before)
  await expect(page.locator('#toolbar-undo-btn')).toBeDisabled()
  await page.locator('#toolbar-redo-btn').click(); expect(await stored(page)).toEqual(moved)
  await page.reload(); await page.waitForFunction(() => !!(window as any).__mindNB)
  expect(await stored(page)).toEqual(moved); expect(errors).toEqual([])
})

test('node border controls show mixed overrides and apply one undoable selection edit', async ({ page }) => {
  const map = emptyTree(); map.visualStyle = 'clear'; map.rootPosition = { x: 450, y: 250 }
  map.floating = [
    { node: { ...createNode('First'), id: 'first', style: { shape: 'rounded', borderWidth: 1 } }, x: 300, y: 400 },
    { node: { ...createNode('Second'), id: 'second', style: { shape: 'rounded', borderWidth: 4 } }, x: 550, y: 500 },
  ]
  await start(page, map)
  await click(page, 'first'); await page.keyboard.down('Meta'); await click(page, 'second'); await page.keyboard.up('Meta')
  const control = page.getByLabel('节点边框粗细', { exact: true })
  await expect(control).toHaveValue('__mixed__')
  await control.evaluate(el => { for (let p = el.parentElement; p; p = p.parentElement) if (p instanceof HTMLDetailsElement) p.open = true })
  const before = await stored(page)
  await control.selectOption('4')
  expect((await stored(page)).floating!.map(f => f.node.style!.borderWidth)).toEqual([4, 4])
  await page.locator('#toolbar-undo-btn').click(); expect(await stored(page)).toEqual(before)
})
