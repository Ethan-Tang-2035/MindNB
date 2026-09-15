import { expect, it, vi } from 'vitest'
import { createDesktopStore } from './desktop-store.ts'
import type { DesktopAPI, SaveRequest, VaultDocument } from './vault-format.ts'
function fixture() {
  const save = vi.fn(async (r: SaveRequest): Promise<VaultDocument> => ({ format: 'mindnb-document', version: 1, meta: r.meta, tree: r.tree, revision: { editedAt: r.editedAt, sequence: r.sequence, id: r.requestId ?? String(r.sequence), deviceId: 'test' } }))
  const api = { save, saveView: vi.fn(async () => {}), snapshot: vi.fn(async () => null) } as unknown as DesktopAPI
  const hooks = { changed: vi.fn(), status: vi.fn(), busy: () => false }
  return { save, hooks, runtime: createDesktopStore(api, hooks) }
}
it('failed deletion retries the same edit timestamp and tombstone', async () => {
  const { runtime, save } = fixture()
  const doc = runtime.store.create(); await runtime.flush()
  save.mockRejectedValueOnce(new Error('磁盘满'))
  runtime.store.remove(doc.id)
  await expect(runtime.flush()).rejects.toThrow('磁盘满')
  const failed = save.mock.calls.at(-1)![0]
  await runtime.retry()
  expect(save.mock.calls.at(-1)![0]).toEqual(failed)
  expect(failed.meta.deletedAt).toBeTypeOf('number')
  expect(runtime.store.list()).toEqual([])
})
it('a queued older save never replaces a newer in-memory edit', async () => {
  const { runtime } = fixture()
  const doc = runtime.store.create()
  const tree = runtime.store.loadTree(doc.id)!; tree.root.text = '最终内容'
  runtime.store.save(doc.id, tree)
  await runtime.flush()
  expect(runtime.store.loadTree(doc.id)!.root.text).toBe('最终内容')
})
it('editing an observed clock-ahead document remains newer than its parent', async () => {
  const { runtime, save } = fixture()
  const doc = runtime.store.create(); await runtime.flush()
  const parentTime = Date.now() + 60000
  // A newer revision won an earlier request; the adapter now knows that parent time.
  save.mockImplementationOnce(async r => ({ format: 'mindnb-document', version: 1, meta: r.meta, tree: r.tree, revision: { editedAt: parentTime, sequence: 1, id: 'remote', deviceId: 'b' } }))
  runtime.store.save(doc.id, runtime.store.loadTree(doc.id)!); await runtime.flush()
  runtime.store.save(doc.id, runtime.store.loadTree(doc.id)!); await runtime.flush()
  expect(save.mock.calls.at(-1)![0].editedAt).toBeGreaterThan(parentTime)
})
it('a save reply with an external winner defers remount while the editor is busy', async () => {
  const { runtime, save, hooks } = fixture()
  const doc = runtime.store.create(); await runtime.flush()
  hooks.busy = () => true
  hooks.changed.mockClear()
  save.mockImplementationOnce(async r => ({ format: 'mindnb-document', version: 1, meta: r.meta, tree: r.tree, revision: { editedAt: r.editedAt + 100, sequence: 1, id: 'remote', deviceId: 'b' } }))
  runtime.store.save(doc.id, runtime.store.loadTree(doc.id)!); await runtime.flush()
  expect(hooks.changed).not.toHaveBeenCalled()
  const observed = save.mock.calls.at(-1)![0].editedAt + 100
  hooks.busy = () => false
  runtime.store.save(doc.id, runtime.store.loadTree(doc.id)!); await runtime.flush()
  expect(save.mock.calls.at(-1)![0].editedAt).toBeGreaterThan(observed)
})
it('copy confirmation preserves the copy next to its original', async () => {
  const { runtime } = fixture()
  const a = runtime.store.create(); await runtime.flush()
  const b = runtime.store.create(); await runtime.flush()
  const copy = runtime.store.copy(a.id)!; await runtime.flush()
  expect(runtime.store.list().map(d => d.id)).toEqual([b.id, a.id, copy.id])
})

it('agent flush rejects an external winner even when busy defers applying it', async () => {
  const { runtime, save, hooks } = fixture()
  const doc = runtime.store.create(); await runtime.flush(doc.id)
  hooks.busy = () => true
  save.mockImplementationOnce(async r => ({ format: 'mindnb-document', version: 1, meta: r.meta, tree: r.tree, revision: { editedAt: r.editedAt + 100, sequence: 1, id: 'remote-winner', deviceId: 'b' } }))
  runtime.store.save(doc.id, runtime.store.loadTree(doc.id)!)
  await expect(runtime.flush()).resolves.toBeUndefined()
  await expect(runtime.flush(doc.id)).rejects.toMatchObject({ code: 'SAVE_SUPERSEDED' })
  hooks.busy = () => false
  runtime.store.save(doc.id, runtime.store.loadTree(doc.id)!)
  await expect(runtime.flush(doc.id)).resolves.toBeUndefined()
})
it('agent flush follows the newest save for its document without another document poisoning it', async () => {
  const { runtime, save } = fixture()
  const first = runtime.store.create(); await runtime.flush(first.id)
  const second = runtime.store.create(); await runtime.flush(second.id)
  const external = async (r: SaveRequest): Promise<VaultDocument> => ({ format: 'mindnb-document', version: 1, meta: r.meta, tree: r.tree, revision: { editedAt: r.editedAt + 100, sequence: 1, id: 'external', deviceId: 'b' } })
  save.mockImplementationOnce(external)
  runtime.store.save(first.id, runtime.store.loadTree(first.id)!)
  await expect(runtime.flush(first.id)).rejects.toMatchObject({ code: 'SAVE_SUPERSEDED' })
  await expect(runtime.flush(second.id)).resolves.toBeUndefined()
  save.mockImplementationOnce(external)
  runtime.store.save(first.id, runtime.store.loadTree(first.id)!)
  runtime.store.save(first.id, runtime.store.loadTree(first.id)!)
  await expect(runtime.flush(first.id)).resolves.toBeUndefined()
})
