import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedTree } from '../src/model.ts'
import { VaultRepository } from './vault.ts'
import { confined, localFiles, macFiles } from './file-access.ts'
import { createPortable, imageObjects, readPortable, type SaveRequest } from '../src/vault-format.ts'

let base: string, root: string, state: string
beforeEach(async () => { base = await mkdtemp(join(tmpdir(), 'mindnb-vault-')); root = join(base, 'vault'); state = join(base, 'device-a'); await mkdir(root) })
afterEach(async () => { await rm(base, { recursive: true, force: true }) })
const request = (text: string, editedAt = Date.now() - 10000): SaveRequest => {
  const tree = seedTree(); tree.root.text = text
  return { meta: { id: 'document-1', nameOverride: null, createdAt: 1, updatedAt: editedAt }, tree, editedAt, sequence: 1 }
}
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1cAAAAASUVORK5CYII=', 'base64'))
function withImage() {
  const r = request('图片迁移')
  r.tree.objects = [{ kind: 'image', id: 'image-1', seed: 1, src: `data:image/png;base64,${Buffer.from(png).toString('base64')}`, x: 800, y: 400, w: 80, h: 80 }]
  return r
}
describe('vault durability and external changes', () => {
  it('reopens documents and keeps views local to each device', async () => {
    const a = await VaultRepository.open(root, state)
    await a.save(request('离线内容')); await a.saveView('document-1', { dx: 42, dy: 12, k: 1.2 })
    const reopened = await VaultRepository.open(root, state)
    expect((await reopened.snapshot()).documents[0].tree.root.text).toBe('离线内容')
    expect((await reopened.snapshot()).views['document-1'].k).toBe(1.2)
    const b = await VaultRepository.open(root, join(base, 'device-b'))
    expect((await b.snapshot()).views).toEqual({})
  })
  it('late arriving older edits cannot overwrite latest edit, and losers are recoverable', async () => {
    const a = await VaultRepository.open(root, state)
    const older = await a.save(request('10点', 1000))
    const latest = await a.save(request('11点', 2000))
    const path = join(root, 'documents/document-1.mindnb.json')
    await writeFile(path, JSON.stringify(older))
    expect((await a.snapshot()).documents[0].tree.root.text).toBe('11点')
    expect(JSON.parse(await readFile(path, 'utf8')).revision).toEqual(latest.revision)
    expect((await a.save(request('迟到离线修改', 1500))).tree.root.text).toBe('11点')
    expect((await a.history('document-1')).map(d => d.tree.root.text)).toContain('迟到离线修改')
    expect((await a.restore('document-1', older.revision.id)).tree.root.text).toBe('10点')
  })
  it('failed disk commit recovers its journal after process restart', async () => {
    let fail = true
    const broken = { ...localFiles, async replace(path: string, bytes: Uint8Array, expected?: Uint8Array | null) {
      if (fail && path.endsWith('.mindnb.json')) throw new Error('disk full')
      await localFiles.replace(path, bytes, expected)
    } }
    const a = await VaultRepository.open(root, state, broken)
    await expect(a.save(request('待恢复'))).rejects.toThrow('disk full')
    fail = false
    const b = await VaultRepository.open(root, state, broken)
    expect((await b.snapshot()).documents[0].tree.root.text).toBe('待恢复')
  })
  it('an unavailable document is retained and never silently recreated', async () => {
    const a = await VaultRepository.open(root, state)
    await a.save(request('保留'))
    await rm(join(root, 'documents/document-1.mindnb.json'))
    const snapshot = await a.snapshot()
    expect(snapshot.documents[0].tree.root.text).toBe('保留')
    expect(snapshot.warnings.join()).toContain('暂不可用')
    await expect(a.save(request('新修改'))).rejects.toThrow('位置暂不可用')
    expect(await readdir(join(root, 'documents'))).toEqual([])
  })
  it('corrupt or future external documents never replace a valid local copy', async () => {
    const a = await VaultRepository.open(root, state)
    const good = await a.save(request('保留'))
    const path = join(root, 'documents/document-1.mindnb.json')
    await writeFile(path, '{broken')
    expect((await a.snapshot()).documents[0].tree.root.text).toBe('保留')
    const future = structuredClone(good); future.tree.root.text = '未来'; future.revision.editedAt = Date.now() + 999999; future.revision.id = 'future'
    await writeFile(path, JSON.stringify(future))
    expect((await a.snapshot()).documents[0].tree.root.text).toBe('保留')
  })
  it('rejects traversal and symlink assets', async () => {
    await expect(confined(root, '../secret')).rejects.toThrow()
    await symlink(base, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(confined(root, 'escape/file')).rejects.toThrow('符号链接')
  })
  it('tombstone survives restart and wins over old external data', async () => {
    const a = await VaultRepository.open(root, state)
    const old = await a.save(request('被删除', 1000))
    const deletion = request('被删除', 2000); deletion.meta.deletedAt = 2000
    await a.save(deletion)
    await writeFile(join(root, 'documents/document-1.mindnb.json'), JSON.stringify(old))
    const b = await VaultRepository.open(root, state)
    expect((await b.snapshot()).documents[0].meta.deletedAt).toBe(2000)
  })
})
describe('portable import/export', () => {
  it('imports bundled images offline, deduplicates the same original after edits and reexports', async () => {
    const portable = await createPortable(withImage().tree, '迁移', async () => png)
    const a = await VaultRepository.open(root, state), id = await a.import(portable)
    const doc = (await a.snapshot()).documents[0]
    const src = imageObjects(doc.tree)[0].src
    expect(src).toMatch(/^mindnb:\/\/asset\//)
    expect(new Uint8Array(await a.readAsset(src.split('/').at(-1)!))).toEqual(png)
    doc.tree.root.text = '桌面新修改'
    await a.save({ tree: doc.tree, meta: doc.meta, editedAt: Date.now(), sequence: 2 })
    expect(await a.import(portable)).toBe(id)
    expect((await a.snapshot()).documents).toHaveLength(1)
    const exported = await createPortable(doc.tree, '导出', src => a.readAsset(src.split('/').at(-1)!))
    expect((await readPortable(exported)).tree.root.text).toBe('桌面新修改')
    const different = await createPortable(request('另一个包').tree, '同ID不同内容', async () => png)
    expect(await a.import(different)).not.toBe(id)
  })
  it('late assets allow text edits and trigger a resource refresh once available', async () => {
    const a = await VaultRepository.open(root, state)
    const doc = await a.save(withImage())
    const filename = imageObjects(doc.tree)[0].src.split('/').at(-1)!
    await rm(join(root, 'assets', filename))
    await expect(a.readAsset(filename)).rejects.toThrow()
    doc.tree.root.text = '图片暂缺仍可编辑'
    const saved = await a.save({ ...request('编辑', Date.now()), tree: doc.tree })
    expect(saved.tree.root.text).toBe('图片暂缺仍可编辑')
    expect(imageObjects(saved.tree)).toHaveLength(1)
    const before = (await a.snapshot()).assetsVersion
    await writeFile(join(root, 'assets', filename), png)
    expect((await a.snapshot()).assetsVersion).toBeGreaterThan(before)
  })
})
it.skipIf(process.platform !== 'darwin' || !process.env.MINDNB_TEST_NATIVE)('Foundation coordinated read and compare-and-replace', async () => {
  const files = macFiles(join(process.cwd(), 'dist-desktop/native/file-access'))
  const a = await VaultRepository.open(root, state, files)
  await a.save(withImage())
  expect((await a.snapshot()).documents).toHaveLength(1)
  const path = join(root, 'vault.json')
  await expect(files.replace(path, Buffer.from('bad'), Buffer.from('outdated'))).rejects.toThrow('外部修改')
  expect(JSON.parse(Buffer.from(await files.read(path)).toString()).format).toBe('mindnb-vault')
})
it('cloud conflict copies with the same document ID choose latest edit regardless of filename', async () => {
  const a = await VaultRepository.open(root, state)
  const original = await a.save(request('旧内容', 1000))
  const copy = structuredClone(original); copy.tree.root.text = '冲突副本的新内容'; copy.revision.editedAt = 2000; copy.revision.id = 'conflict-copy'
  await writeFile(join(root, 'documents/z-conflicted-copy.mindnb.json'), JSON.stringify(copy))
  const snapshot = await a.snapshot()
  expect(snapshot.documents).toHaveLength(1)
  expect(snapshot.documents[0].tree.root.text).toBe('冲突副本的新内容')
  expect(JSON.parse(await readFile(join(root, 'documents/document-1.mindnb.json'), 'utf8')).revision.id).toBe('conflict-copy')
})
it('a missing external document can be recovered as a new file without recreating the old path', async () => {
  const a = await VaultRepository.open(root, state)
  const original = await a.save(request('丢失后恢复'))
  await rm(join(root, 'documents/document-1.mindnb.json')); await a.snapshot()
  const recovered = await a.restore('document-1', original.revision.id)
  expect(recovered.meta.id).not.toBe('document-1')
  expect(recovered.tree.root.text).toBe('丢失后恢复')
  expect(await readdir(join(root, 'documents'))).toEqual([recovered.meta.id + '.mindnb.json'])
})

it('archives known middle version when disk reverted before the next local save', async () => {
  const a = await VaultRepository.open(root, state)
  const old = await a.save(request('old', 1000))
  await a.save(request('middle', 2000))
  await writeFile(join(root, 'documents/document-1.mindnb.json'), JSON.stringify(old))
  await a.save(request('new', 3000))
  expect((await a.history('document-1')).map(d => d.tree.root.text)).toEqual(['middle', 'old'])
})
it('external updates, import and restore keep recent-document order across restarts', async () => {
  const a = await VaultRepository.open(root, state)
  const first = await a.save({ ...request('A', 1000), order: ['document-1'] })
  const second = request('B', 2000); second.meta.id = 'document-2'; second.order = ['document-2', 'document-1']
  const b = await a.save(second)
  const external = structuredClone(first); external.revision.editedAt = 3000; external.revision.id = 'external-order'; external.meta.updatedAt = 3000
  await writeFile(join(root, 'documents/document-1.mindnb.json'), JSON.stringify(external))
  expect((await a.snapshot()).documentOrder).toEqual(['document-1', 'document-2'])
  const reopened = await VaultRepository.open(root, state)
  expect((await reopened.snapshot()).documentOrder).toEqual(['document-1', 'document-2'])
  const id = await reopened.import(await createPortable(request('C').tree, 'C', async () => png))
  expect((await reopened.snapshot()).documentOrder).toEqual([id, 'document-1', 'document-2'])
  await reopened.restore('document-2', b.revision.id)
  expect((await (await VaultRepository.open(root, state)).snapshot()).documentOrder).toEqual(['document-2', id, 'document-1'])
})

it('opens a previous vault and documents without changing their identity or losing edits', async () => {
  const { LEGACY_BRAND } = await import('../src/legacy-brand.ts')
  const old = { format: LEGACY_BRAND.documentFormat, version: 1, ...request('原有内容'), revision: { editedAt: 1000, sequence: 1, deviceId: 'old-device', id: 'old-revision' } }
  await mkdir(join(root, 'documents'))
  await writeFile(join(root, 'vault.json'), JSON.stringify({ format: LEGACY_BRAND.vaultFormat, version: 1, id: 'same-vault' }))
  const path = join(root, 'documents', 'document-1.' + LEGACY_BRAND.extension + '.json')
  await writeFile(path, JSON.stringify(old))
  const repo = await VaultRepository.open(root, state)
  expect(repo.id).toBe('same-vault')
  const doc = (await repo.snapshot()).documents[0]
  expect(doc.tree.root.text).toBe('原有内容')
  expect(doc.format).toBe('mindnb-document')
  expect(doc.revision.id).toBe('old-revision')
  await repo.save(request('继续编辑'))
  expect((await (await VaultRepository.open(root, state)).snapshot()).documents[0].tree.root.text).toBe('继续编辑')
  expect(JSON.parse(await readFile(join(root, 'vault.json'), 'utf8')).format).toBe('mindnb-vault')
})

describe('permanent deletion', () => {
  it('rejects active documents and removes deleted copies, history and views across reopen', async () => {
    const repo = await VaultRepository.open(root, state)
    await repo.save(request('保留', 1000))
    await expect(repo.permanentlyDelete('document-1')).rejects.toThrow('回收站')
    await expect(repo.permanentlyDelete('../escape')).rejects.toThrow('无效')
    const deleted = request('删除', 2000); deleted.meta.deletedAt = 2000
    await repo.save(deleted)
    await repo.saveView('document-1', { dx: 0, dy: 0, k: 1 })
    await writeFile(join(root, 'documents/copy.mindnb.json'), await readFile(join(root, 'documents/document-1.mindnb.json')))
    expect((await repo.history('document-1')).length).toBeGreaterThan(0)
    await repo.permanentlyDelete('document-1')
    expect((await repo.snapshot()).documents).toEqual([])
    expect(await repo.history('document-1')).toEqual([])
    const reopened = await VaultRepository.open(root, state)
    expect((await reopened.snapshot()).documents).toEqual([])
    expect((await reopened.snapshot()).views).toEqual({})
    expect(await readdir(join(root, 'documents'))).toEqual([])
  })
})
