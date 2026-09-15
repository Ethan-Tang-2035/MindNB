import { createDocStore, documentCache, type DocMeta, type StorageLike, type ViewState } from './docs.ts'
import type { MindMap } from './model.ts'
import type { DesktopAPI, VaultDocument, VaultSnapshot, SaveRequest } from './vault-format.ts'

export class MemoryStorage implements StorageLike {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
  clear() { this.values.clear() }
}
/** The legacy editor uses a synchronous memory session. All durable I/O is async,
 * observable through status and flush; memory success is never reported as disk success. */
export function createDesktopStore(api: DesktopAPI, hooks: { changed(): void; status(text: string, failed: boolean): void; busy(): boolean; beforeFlush?(): void }) {
  const memory = new MemoryStorage(), local = createDocStore(memory), cache = documentCache(memory)
  const revisions = new Map<string, string>(), dirty = new Map<string, number>(), failures = new Map<string, string>()
  const editTimes = new Map<string, number>()
  let clockAdjusted = false
  const requests = new Map<string, SaveRequest>()
  const saveOutcomes = new Map<string, { sequence: number; superseded: boolean }>()
  let sequence = 0, pending: Promise<unknown> = Promise.resolve(), snapshot: VaultSnapshot | null = null, refreshing = false
  const metaOf = (id: string) => local.list().find(m => m.id === id)
  function upsert(doc: VaultDocument, preservePosition = false) {
    editTimes.set(doc.meta.id, doc.revision.editedAt)
    cache.replace(doc.meta, doc.tree, preservePosition ? 'preserve' : 'front')
    revisions.set(doc.meta.id, doc.revision.id)
  }
  function report() {
    const error = failures.values().next().value
    hooks.status(error ? `保存失败：${error}（点击重试）` : dirty.size ? '正在保存到本机…' : clockAdjusted ? '已保存到本机（设备时钟落后，沿用文档时间）' : '已保存到本机', !!error)
  }
  function schedule(id: string, meta: DocMeta, tree: MindMap) {
    const now = Date.now(), parentTime = editTimes.get(id) ?? 0
    if (parentTime > now) clockAdjusted = true
    const editedAt = Math.max(now, parentTime + 1)
    editTimes.set(id, editedAt)
    const seq = ++sequence, request = { order: local.list().map(meta => meta.id), requestId: crypto.randomUUID(), meta: { ...structuredClone(meta), updatedAt: editedAt }, tree: structuredClone(tree), editedAt, sequence: seq }
    requests.set(id, request)
    enqueue(id, request)
  }
  function enqueue(id: string, request: SaveRequest) {
    const seq = request.sequence
    dirty.set(id, seq); report()
    pending = pending.catch(() => undefined).then(async () => {
      try {
        const doc = await api.save(request)
        editTimes.set(id, Math.max(editTimes.get(id) ?? 0, doc.revision.editedAt))
        // A superseded response is still significant while UI editing delays upsert.
        const outcome = saveOutcomes.get(id)
        if (!outcome || seq >= outcome.sequence) saveOutcomes.set(id, { sequence: seq, superseded: doc.revision.id !== request.requestId })
        if (dirty.get(id) !== seq) return
        dirty.delete(id); failures.delete(id); requests.delete(id)
        const replaced = doc.revision.id !== request.requestId
        // A save response must never tear down an active textarea or pointer gesture.
        // Keep the old revision marker so a later idle refresh applies the winner.
        if (replaced && hooks.busy()) return
        upsert(doc, !replaced)
        if (replaced) hooks.changed()
      } catch (e) { failures.set(id, e instanceof Error ? e.message : String(e)) }
      finally { report() }
    })
  }
  const store = {
    ...local,
    save(id: string, tree: MindMap) { local.save(id, tree); const meta = metaOf(id); if (meta) schedule(id, meta, tree) },
    create() { const meta = local.create(); schedule(meta.id, meta, local.loadTree(meta.id)!); return meta },
    copy(id: string) { const meta = local.copy(id); if (meta) schedule(meta.id, meta, local.loadTree(meta.id)!); return meta },
    rename(id: string, name: string) { local.rename(id, name); const meta = metaOf(id), tree = local.loadTree(id); if (meta && tree) schedule(id, meta, tree) },
    remove(id: string) {
      const meta = metaOf(id), tree = local.loadTree(id)
      if (meta && tree) { local.remove(id); schedule(id, { ...meta, deletedAt: Date.now(), updatedAt: Date.now() }, tree) }
    },
    saveView(id: string, view: ViewState) {
      local.saveView(id, view)
      pending = pending.catch(() => undefined).then(() => api.saveView(id, view)).then(() => { failures.delete(`view:${id}`); report() }, e => { failures.set(`view:${id}`, String(e)); report() })
    },
  }
  async function refresh(reset = false) {
    if (refreshing || (!reset && (dirty.size || hooks.busy()))) return
    refreshing = true
    try {
      await pending
      const next = await api.snapshot()
      if (dirty.size || (!reset && hooks.busy())) return
      if (reset) { memory.clear(); cache.replaceIndex([]); revisions.clear(); editTimes.clear(); saveOutcomes.clear(); clockAdjusted = false }
      let changed = reset || (snapshot?.assetsVersion !== next?.assetsVersion)
      snapshot = next
      for (const doc of next?.documents ?? []) {
        if (revisions.get(doc.meta.id) !== doc.revision.id) { upsert(doc); changed = true }
      }
      if (next || reset) {
        const order = new Map((next?.documentOrder ?? []).map((id, i) => [id, i]))
        const index = cache.index()
        index.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity) || b.updatedAt - a.updatedAt)
        cache.replaceIndex(index)
      }
      for (const [id, view] of Object.entries(next?.views ?? {})) cache.replaceView(id, view)
      if (changed) hooks.changed()
      if (next?.warnings.length) hooks.status(next.warnings.join('；'), true)
      else report()
    } catch (e) { hooks.status(`资料库暂不可用：${String(e)}`, true) }
    finally { refreshing = false }
  }
  async function flush(id?: string) {
    hooks.beforeFlush?.()
    // New edits may enqueue while awaiting a previous write. Confirm the settled queue.
    let observed: Promise<unknown>
    do { observed = pending; await observed } while (observed !== pending)
    if (failures.size || dirty.size) throw new Error(failures.values().next().value || '仍有未保存内容')
    if (id === undefined) return
    if (saveOutcomes.get(id)?.superseded) {
      throw Object.assign(new Error('本次保存已被资料库中的较新版本取代，请重新读取文档'), { code: 'SAVE_SUPERSEDED' })
    }
    if (!saveOutcomes.has(id) && !revisions.has(id)) throw new Error('文档尚未获得资料库保存确认')
  }
  async function retry() {
    for (const id of failures.keys()) {
      if (id.startsWith('view:')) { const docId = id.slice(5), view = local.loadView(docId); if (view) store.saveView(docId, view); continue }
      const request = requests.get(id)
      if (request) enqueue(id, request)
    }
    await flush()
  }
  return { store, refresh, flush, retry, get snapshot() { return snapshot } }
}
