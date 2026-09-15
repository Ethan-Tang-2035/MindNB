import { agentTempPrefix, agentSocketPath } from '../helpers/agent-runtime.ts'
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve, relative, dirname } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { readPortable } from '../../src/vault-format.ts'

test('真实 MCP stdio → 本机 bridge → Electron：原生对象、版本、导出与重启恢复', async () => {
  test.setTimeout(150_000)
  const base = await realpath(await mkdtemp(agentTempPrefix('mnb-e2e-')))
  await chmod(base, 0o700)
  const profile = join(base, 'profile'), vault = join(base, 'vault'), assets = join(base, 'assets'), output = join(base, 'exports'), socket = agentSocketPath(base)
  for (const path of [profile, vault, assets, output]) await mkdir(path)
  await writeFile(join(profile, 'vault-location.json'), JSON.stringify({ path: vault }))
  await copyFile(resolve('public/brand/icon-32.png'), join(assets, 'sticker.png'))
  let app: ElectronApplication | undefined, client: Client | undefined
  let page!: Page
  const errors: string[] = []
  const launch = async () => {
    // Deliberately poison old test env variables: explicit --user-data-dir must win.
    app = await electron.launch({ ...(process.env.MINDNB_PACKAGED_EXECUTABLE ? { executablePath: process.env.MINDNB_PACKAGED_EXECUTABLE } : {}), args: [...(process.env.MINDNB_PACKAGED_EXECUTABLE ? [] : [resolve('.')]), `--user-data-dir=${profile}`, `--agent-bridge=${socket}`, `--agent-assets=${assets}`, `--agent-output=${output}`], env: { ...process.env, MINDNB_DESKTOP_DATA: join(base, 'unused-profile') } })
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message))
    expect(await realpath(await app.evaluate(({ app }) => app.getPath('userData')))).toBe(profile)
    await expect(page.locator('#home')).toBeVisible()
    if (process.platform !== 'win32') {
      await expect.poll(async () => (await stat(socket).catch(() => null))?.isSocket()).toBe(true)
      expect((await stat(socket)).mode & 0o777).toBe(0o600)
    }
    client = new Client({ name: 'mindnb-desktop-acceptance', version: '1.0.0' })
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve(process.env.MINDNB_PACKAGED_MCP || 'dist-desktop/mcp-server.mjs'), `--socket=${socket}`], stderr: 'pipe' }))
  }
  const call = async (name: string, args: Record<string, unknown> = {}, allowError = false): Promise<Record<string, any>> => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const result = await client!.callTool({ name, arguments: args })
      const contents = result.content as Array<{ type: string; text?: string; data?: string; mimeType?: string }>
      const text = contents.find(item => item.type === 'text')?.text
      const value = text ? JSON.parse(text) : {}
      if (result.isError && (value.code ?? value.error?.code) === 'BUSY') { await page.waitForTimeout(120); continue }
      if (!allowError && result.isError) throw new Error(`${name}: ${text}`)
      return { ...value, isError: Boolean(result.isError), content: contents }
    }
    throw new Error(`${name} stayed BUSY`)
  }
  try {
    await launch()
    expect((await client!.listTools()).tools).toHaveLength(7)
    expect((await call('describe_capabilities')).operations['page.create']).toBeTruthy()
    expect((await call('list_assets', { limit: 2 })).assets.length).toBeGreaterThan(0)
    const created = await call('create_document', { name: '可编辑手账 MCP 回归' })
    const documentId = created.documentId as string
    expect(created.persisted).toBe(true)
    const batch = { documentId, expectedEditRevision: created.editRevision, requestId: 'initial-layout', operations: [
      { type: 'page.create', ref: 'page1', name: '认识自己', x: 0, y: 0, width: 800, height: 1100, paper: '#fff8ee' },
      { type: 'text.create', ref: 'title', pageId: 'page1', x: 40, y: 45, width: 560, text: '从今天的小行动开始', style: { font: 'sans', fontSize: 28, color: '#563c58' } },
      { type: 'tree.create', ref: 'tree', pageId: 'page1', x: 250, y: 350, asRoot: true, root: { text: '我的方向', style: { font: 'sans', fontSize: 22 }, children: [{ ref: 'child', text: '今天做一小步' }] } },
      { type: 'image.create', ref: 'image', pageId: 'page1', x: 700, y: 40, width: 32, height: 32, assetPath: 'sticker.png' },
      { type: 'page.create', ref: 'page2', name: '行动便签', x: 880, y: 0, width: 800, height: 1100, paper: '#eef7f0' },
      { type: 'text.create', ref: 'note', pageId: 'page2', x: 40, y: 50, width: 560, text: '保留原生文字，明天还能继续修改。', style: { font: 'sans', fontSize: 24 } },
    ] }
    const applied = await call('apply_operations', batch)
    expect(applied.persisted).toBe(true)
    const ids = applied.ids as Record<string, string>
    const replay = await call('apply_operations', batch)
    expect(replay.replayed).toBe(true); expect(replay.ids).toEqual(ids)
    let current = await call('read_document', { documentId })
    expect(current.pages).toHaveLength(2); expect(current.objects).toHaveLength(3)
    expect(current.trees[0].children[0]).toMatchObject({ id: ids.child, text: '今天做一小步' })
    expect(current.objects.find((object: any) => object.id === ids.image)).toMatchObject({ kind: 'image', hasImage: true })
    expect(JSON.stringify(current)).not.toContain('data:image/')
    const stale = await call('apply_operations', { documentId, expectedEditRevision: created.editRevision, requestId: 'stale', operations: [{ type: 'object.text', id: ids.title, text: '不该写入' }] }, true)
    expect(stale).toMatchObject({ isError: true, code: 'REVISION_CONFLICT' })
    const atomicFailure = await call('apply_operations', { documentId, expectedEditRevision: current.editRevision, requestId: 'atomic-failure', operations: [{ type: 'object.text', id: ids.title, text: '不该写入' }, { type: 'not.supported' }] }, true)
    expect(atomicFailure).toMatchObject({ isError: true, code: 'INVALID_ARGUMENT' })
    const unchanged = await call('read_document', { documentId })
    expect(unchanged.editRevision).toBe(current.editRevision)
    expect(unchanged.objects.find((object: any) => object.id === ids.title).text).toBe('从今天的小行动开始')
    const edited = await call('apply_operations', { documentId, expectedEditRevision: current.editRevision, requestId: 'edit-real-content', operations: [{ type: 'object.text', id: ids.title, text: '可以修改的可爱手账' }, { type: 'node.text', id: ids.child, text: '写下第一步，保留树结构' }] })
    current = await call('read_document', { documentId, pageId: ids.page1 })
    expect(current.pages).toHaveLength(1); expect(current.editRevision).toBe(edited.editRevision)
    const preview = await call('render_preview', { documentId, pageId: ids.page1, expectedEditRevision: edited.editRevision })
    const image = preview.content.find((item: any) => item.type === 'image')
    expect(image.mimeType).toBe('image/png')
    expect(Buffer.from(image.data, 'base64').subarray(0, 8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]))
    expect(await page.evaluate(async data => { const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode(); return img.width }, image.data)).toBe(1080)
    for (const format of ['mindnb', 'png', 'pdf']) {
      const exported = await call('export_document', { documentId, format, expectedEditRevision: edited.editRevision, name: '可编辑手账 MCP 回归' })
      expect(exported.paths).toHaveLength(format === 'png' ? 2 : 1)
      for (const path of exported.paths) {
        expect(relative(output, dirname(path))).toBe('')
        const bytes = await readFile(path); expect(bytes.length).toBeGreaterThan(100)
        if (format === 'mindnb') {
          const portable = await readPortable(bytes)
          expect(portable.tree.pages).toHaveLength(2)
          expect(portable.tree.root.children[0].text).toBe('写下第一步，保留树结构')
          expect(portable.tree.objects!.find(object => object.id === ids.title)).toMatchObject({ kind: 'textBox', text: '可以修改的可爱手账' })
          expect(portable.assets.size).toBe(1)
        } else if (format === 'pdf') expect(bytes.toString('ascii', 0, 5)).toBe('%PDF-')
      }
      // Retry after the ZIP/PDF clock tick: identical content must reuse paths.
      await page.waitForTimeout(2100)
      const retried = await call('export_document', { documentId, format, expectedEditRevision: edited.editRevision, name: '可编辑手账 MCP 回归' })
      expect(retried.paths).toEqual(exported.paths)
    }
    // Reload keeps the main-process bridge alive but must invalidate all old edit tokens.
    await page.reload()
    await expect(page.locator('#canvas')).toBeVisible()
    const reloaded = await call('read_document', { documentId })
    expect(reloaded.editRevision).not.toBe(edited.editRevision)
    const oldSessionReplay = await call('apply_operations', batch, true)
    expect(oldSessionReplay).toMatchObject({ isError: true, code: 'REVISION_CONFLICT' })
    expect((await call('read_document', { documentId })).pages).toHaveLength(2)
    // The final unsaved UI edit exercises the existing close/flush path, not just MCP save.
    await page.locator(`[data-textbox-id="${ids.title}"]`).dblclick()
    await page.getByLabel('文本框文字', { exact: true }).fill('关闭时最后一笔仍然可编辑')
    await client!.close(); client = undefined
    await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    await app!.close(); app = undefined
    const documents = await readdir(join(vault, 'documents'))
    const stored = JSON.parse(await readFile(join(vault, 'documents', documents.find(name => name.includes(documentId))!), 'utf8'))
    expect(stored.tree.objects.find((object: any) => object.id === ids.title).text).toBe('关闭时最后一笔仍然可编辑')
    await launch()
    const restored = await call('read_document', { documentId })
    expect(restored.objects.find((object: any) => object.id === ids.title).text).toBe('关闭时最后一笔仍然可编辑')
    expect(restored.pages).toHaveLength(2)
    await page.locator(`.card[data-id="${documentId}"] .card-thumb`).click()
    await expect(page.locator(`[data-textbox-id="${ids.title}"]`)).toContainText('关闭时最后一笔仍然可编辑')
    expect(errors).toEqual([])
  } finally { await client?.close(); await app?.close(); await rm(base, { recursive: true, force: true }) }
})
