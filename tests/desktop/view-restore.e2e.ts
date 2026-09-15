import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { VaultRepository } from '../../desktop/vault.ts'
import { emptyTree } from '../../src/model.ts'
import type { ViewState } from '../../src/docs.ts'

let base: string, app: ElectronApplication
test.beforeEach(async () => { base = await mkdtemp(join(tmpdir(), 'mindnb-view-restore-')) })
test.afterEach(async () => { await app?.close(); await rm(base, { recursive: true, force: true }) })

for (const kind of ['paper', 'nodes', 'valid', 'pan-tall', 'pan-small'] as const) test(`恢复已保存视图：${kind}`, async () => {
  const panCase = kind.startsWith('pan-')
  const tree = emptyTree(), id = randomUUID(), now = Date.now()
  tree.root.text = '恢复视图验收'; tree.rootPosition = { x: 600, y: 400 }
  if (kind !== 'nodes') tree.pages = Array.from({ length: 9 }, (_, i) => ({
    id: randomUUID(), name: `纸页 ${i + 1}`, preset: 'a4', overflow: 'show',
    x: 203 + (panCase ? i : i % 2) * 858, y: 100 + (panCase ? 0 : Math.floor(i / 2)) * 1187, w: 794, h: 1123,
    members: i === 0 ? [tree.root.id] : [],
  }))
  const root = join(base, 'vault')
  await mkdir(join(root, 'documents'), { recursive: true })
  await writeFile(join(root, 'documents', `${id}.mindnb.json`), JSON.stringify({
    format: 'mindnb-document', version: 1, meta: { id, createdAt: now, updatedAt: now, nameOverride: null }, tree,
    revision: { editedAt: now, sequence: 0, deviceId: randomUUID(), id: randomUUID() },
  }))
  const repo = await VaultRepository.open(root, join(base, 'app', 'vault-state'))
  // Old horizontal work extents outlive the grid arrangement; ordinary clamping cannot recover this view.
  const saved: ViewState = { dx: 0, dy: 0, coordinateVersion: 2, drill: [], k: 0.43633125556544977,
    tx: kind === 'valid' ? 100 : -2607.7195013357086, ty: kind === 'valid' ? 76 : -723,
    extents: { document: { minX: -480, minY: 0, maxX: 8101, maxY: kind === 'pan-small' ? 1463 : 6211 } } }
  await repo.saveView(id, saved)
  app = await electron.launch({ args: [resolve('.')], env: { ...process.env,
    MINDNB_DESKTOP_DATA: join(base, 'app'), MINDNB_DESKTOP_VAULT: root } })
  const page = await app.firstWindow(), errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await expect(page.locator('#desktop-files')).toBeVisible()
  await page.evaluate(id => { location.hash = `/doc/${id}` }, id)
  await page.waitForFunction(() => !!(window as any).__mindNB)
  const node = page.locator(`#canvas [data-id="${tree.root.id}"]`)
  if (panCase) {
    await page.locator('#zoom-bar').getByRole('button', { name: '适应窗口', exact: true }).click()
    const before = await page.evaluate(() => ({ ...(window as any).__mindNB.view }))
    // The fit command must center actual pages, even when the remembered workspace is taller.
    const bounds = await page.locator('.paper-page-control').first().boundingBox()
    expect.soft(bounds!.y + bounds!.height / 2).toBeCloseTo((76 + await page.evaluate(() => innerHeight)) / 2, 0)
    await expect.soft(page.locator('.paper-page-title').first()).toBeInViewport({ ratio: 1 })
    // Ordinary blank drag and Space+drag both move the camera by the pointer displacement.
    for (const space of [false, true]) {
      const prior = await page.evaluate(() => ({ ...(window as any).__mindNB.view }))
      if (space) await page.keyboard.down('Space')
      await page.mouse.move(500, 650); await page.mouse.down()
      await page.mouse.move(580, 550, { steps: 5 }); await page.mouse.up()
      if (space) await page.keyboard.up('Space')
      const after = await page.evaluate(() => ({ ...(window as any).__mindNB.view }))
      expect(after.tx - prior.tx).toBeCloseTo(80, 3)
      expect(after.ty - prior.ty).toBeCloseTo(-100, 3)
      expect(after.k).toBe(before.k)
    }
  }
  await expect(node).toBeInViewport({ timeout: 2000 })
  const restored = await page.evaluate(() => ({ ...(window as any).__mindNB.view }))
  if (kind === 'valid') expect(restored).toEqual({ k: saved.k, tx: saved.tx, ty: saved.ty })
  // View persistence is debounced and crosses IPC. Reload only after the saved
  // camera reaches disk, so this checks restoration of a durably saved view.
  const stateRoot = join(base, 'app', 'vault-state')
  const stateDirectory = (await readdir(stateRoot)).find(name => name.startsWith(`${repo.id}-`))!
  await expect.poll(async () => {
    const view = JSON.parse(await readFile(join(stateRoot, stateDirectory, 'views.json'), 'utf8'))[id]
    return { k: view.k, tx: view.tx, ty: view.ty }
  }).toEqual(restored)
  await page.reload()
  await expect(node).toBeInViewport()
  expect(await page.evaluate(() => ({ ...(window as any).__mindNB.view }))).toEqual(restored)
  expect(errors).toEqual([])
})
