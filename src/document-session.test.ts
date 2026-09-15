import { expect, it, vi } from 'vitest'
import { documentCache, createDocStore } from './docs.ts'
import { createDesktopStore, MemoryStorage } from './desktop-store.ts'
import { createDocumentSession } from './document-session.ts'
import type { DesktopAPI, SaveRequest, VaultDocument } from './vault-format.ts'

it('external replacement preserves timestamps, list position and device view', () => {
  const memory = new MemoryStorage(), store = createDocStore(memory, () => 100), cache = documentCache(memory)
  const a = store.create(), b = store.create(), tree = store.loadTree(a.id)!
  cache.replaceView(a.id, { dx: 10, dy: 20, k: 2, updatedAt: 50 })
  cache.replace({ ...a, updatedAt: 80 }, { ...tree, root: { ...tree.root, text: 'external' } })
  expect(store.list().map(m => m.id)).toEqual([b.id, a.id])
  expect(store.list()[1].updatedAt).toBe(80)
  expect(store.loadTree(a.id)?.root.text).toBe('external')
  expect(store.loadStoredView(a.id)).toEqual({ dx: 10, dy: 20, k: 2, updatedAt: 50 })
  cache.remove(a.id)
  expect(store.loadTree(a.id)).toBeNull()
  expect(store.loadView(a.id)).toBeNull()
  expect(store.list().map(m => m.id)).toEqual([b.id])
})

it('desktop confirmation includes the editor flush and writes queued during an earlier save', async () => {
  const snapshot = vi.fn(async () => null)
  let release: (() => void) | undefined
  let first = true
  const save = vi.fn(async (request: SaveRequest): Promise<VaultDocument> => {
    if (first) { first = false; await new Promise<void>(resolve => { release = resolve }) }
    return { format: 'mindnb-document', version: 1, tree: request.tree, meta: request.meta,
      revision: { id: request.requestId!, deviceId: 'test', sequence: request.sequence, editedAt: request.editedAt } }
  })
  const beforeFlush = vi.fn()
  const runtime = createDesktopStore({ save, snapshot } as unknown as DesktopAPI, { changed() {}, status() {}, busy: () => false, beforeFlush })
  const session = createDocumentSession({ kind: 'desktop', runtime })
  await session.start()
  const doc = session.store.create()
  session.activate(doc.id)
  const confirmed = runtime.flush(doc.id)
  await vi.waitFor(() => expect(release).toBeDefined())
  session.store.rename(doc.id, 'queued later')
  release!()
  await confirmed
  expect(beforeFlush).toHaveBeenCalledOnce()
  expect(save.mock.calls.at(-1)![0].meta.nameOverride).toBe('queued later')
  expect(session.store.list()[0].nameOverride).toBe('queued later')
})
