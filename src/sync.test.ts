import { insertContent, createTable, createCycle, transferContent } from './content.ts'
import { makeInk } from './ink.ts'
/**
 * 同步引擎单测（票 05）：两台「设备」= FakeStorage + createDocStore + withSync，
 * 共享一个模拟服务端语义的 FakeRemote（服务器时钟打点、条件写 409、墓碑）。不经网络。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createDocStore, isTombstone, type DocMeta, type StorageLike, type StoredView } from './docs.ts'
import { mergeIndex } from './index-merge.ts'
import { ConflictError, NetworkError, type PingVerdict, type PutDocBody, type RemoteClient } from './remote.ts'
import { withSync, BASELINES_KEY, PENDING_DELETES_KEY, SYNCED_KEY, type SyncHooks } from './sync.ts'
import type { MindMap } from './model.ts'

/** 浏览器 localStorage 的内存替身（与 docs.test.ts 同款） */
class FakeStorage implements StorageLike {
  map = new Map<string, string>()
  getItem(k: string): string | null {
    return this.map.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v)
  }
  removeItem(k: string): void {
    this.map.delete(k)
  }
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const treeOf = (text: string): MindMap =>
  ({ root: { id: 'r', text, seed: 1, children: [] } }) as unknown as MindMap

/** 模拟服务端（spec §① 语义的最小实现）：服务器时钟、条件写、墓碑、视图打点 */
class FakeRemote {
  index: DocMeta[] = []
  docs = new Map<string, string>()
  views = new Map<string, StoredView>()
  clock = 10_000
  offline = false
  putDocCalls: Array<{ id: string; body: PutDocBody; keepalive?: boolean }> = []
  deleteCalls: string[] = []

  private stamp(): number {
    return ++this.clock
  }
  async ping(): Promise<PingVerdict> {
    return this.offline ? 'network' : 'ok'
  }
  private guard(): void {
    if (this.offline) throw new NetworkError('offline')
  }
  async getIndex(): Promise<DocMeta[]> {
    this.guard()
    return clone(this.index)
  }
  async putIndex(entries: DocMeta[]): Promise<DocMeta[]> {
    this.guard()
    this.index = mergeIndex(this.index, entries, { now: this.clock })
    return clone(this.index)
  }
  async getDoc(id: string): Promise<MindMap | null> {
    this.guard()
    const raw = this.docs.get(id)
    return raw ? (JSON.parse(raw) as MindMap) : null
  }
  async putDoc(id: string, body: PutDocBody): Promise<DocMeta[]> {
    this.guard()
    this.putDocCalls.push({ id, body: clone(body) })
    const entry = this.index.find((m) => m.id === id)
    if (entry && isTombstone(entry) && !body.force) throw new ConflictError('deleted', null)
    if (!body.force && entry && entry.updatedAt > (body.baseUpdatedAt ?? 0)) throw new ConflictError('entry', clone(entry))
    this.docs.set(id, JSON.stringify(body.tree))
    const t = this.stamp()
    if (entry) {
      entry.updatedAt = t
      if (typeof body.nameOverride === 'string') entry.nameOverride = body.nameOverride
      if (body.force) entry.deletedAt = null
    } else {
      this.index.unshift({ id, createdAt: t, updatedAt: t, nameOverride: body.nameOverride ?? null })
    }
    return clone(this.index)
  }
  async deleteDoc(id: string): Promise<DocMeta[]> {
    this.guard()
    this.deleteCalls.push(id)
    const entry = this.index.find((m) => m.id === id)
    if (entry && !isTombstone(entry)) entry.deletedAt = this.stamp()
    return clone(this.index)
  }
  async putView(id: string, view: { dx: number; dy: number; k: number }): Promise<StoredView> {
    this.guard()
    const stored: StoredView = { ...view, updatedAt: this.stamp() }
    this.views.set(id, stored)
    return stored
  }
  async getView(id: string): Promise<StoredView | null> {
    this.guard()
    return this.views.get(id) ?? null
  }
  async getVersions(): Promise<number[]> {
    return []
  }
  async getVersion(): Promise<null> {
    return null
  }
}

function device(remote: RemoteClient, storage = new FakeStorage(), hooks: SyncHooks = {}) {
  const wrapped = withSync(createDocStore(storage, () => ++localClock), { remote, storage, hooks, docDebounceMs: 0, viewDebounceMs: 0 })
  return { storage, store: wrapped.store, engine: wrapped.engine }
}
let localClock = 100_000

beforeEach(() => {
  localClock = 100_000
})

describe('首连迁移（spec §③）', () => {
  it('prepends a newly pulled remote document while preserving existing local order', async () => {
    const remote = new FakeRemote(), a = device(remote)
    const older = a.store.create(), newer = a.store.create()
    await a.engine.syncRound()
    await remote.putDoc('remote-new', { tree: treeOf('remote new') })
    await a.engine.syncRound()
    expect(a.store.list().map(m => m.id)).toEqual(['remote-new', newer.id, older.id])
    expect(a.store.loadTree('remote-new')?.root.text).toBe('remote new')
  })
  it('uses the already verified access key for the startup probe', async () => {
    const remote = new FakeRemote()
    const ping = vi.spyOn(remote, 'ping')
    const a = device(remote)
    a.storage.setItem('mindnb:access-key', 'test-verified-key')
    await a.engine.start()
    expect(ping).toHaveBeenCalledWith('test-verified-key')
    await a.engine.syncRound()
  })
  it('preserves drill view on first migration, normal sync, and pagehide flush', async () => {
    const remote = new FakeRemote()
    const a = device(remote)
    const doc = a.store.create()
    const drill = [{ id: 'r', view: { tx: 20, ty: 30, k: .7 }, selection: { ids: ['r'], primary: 'r' } }]
    a.store.saveView(doc.id, { dx: 5, dy: 6, k: 1, drill })
    await a.engine.syncRound()
    expect(remote.views.get(doc.id)?.drill).toEqual(drill)
    const b = device(remote)
    await b.engine.syncRound()
    expect(b.store.loadView(doc.id)?.drill).toEqual(drill)
    a.store.saveView(doc.id, { dx: 10, dy: 6, k: 1, drill: [] })
    await a.engine.syncRound()
    expect(remote.views.get(doc.id)?.drill).toEqual([])
    a.store.saveView(doc.id, { dx: 10, dy: 6, k: 1, drill })
    a.engine.flushNow()
    await new Promise(r => setTimeout(r, 0))
    expect(remote.views.get(doc.id)?.drill).toEqual(drill)
  })
  it('A 设备 3 篇本地文档首连 → 远端索引/doc/view 齐；B 空设备连上看到同样 3 篇', async () => {
    const remote = new FakeRemote()
    const a = device(remote)
    const ids = [a.store.create().id, a.store.create().id, a.store.create().id]
    for (const id of ids) a.store.save(id, treeOf('文档' + id))
    a.store.saveView(ids[0], { dx: 5, dy: 6, k: 1.2 })
    await a.engine.syncRound()
    expect(remote.index.filter((m) => !isTombstone(m))).toHaveLength(3)
    for (const id of ids) expect(remote.docs.has(id)).toBe(true)
    expect(remote.views.get(ids[0])?.dx).toBe(5)
    expect(a.storage.getItem(SYNCED_KEY)).toBe('1')
    // 迁移后本地条目已对齐服务器时钟：无脏、无重复推送
    const before = remote.putDocCalls.length
    await a.engine.syncRound()
    expect(remote.putDocCalls.length).toBe(before)
    // 空设备 B
    const b = device(remote)
    await b.engine.syncRound()
    expect(b.store.list().map((m) => m.id).sort()).toEqual([...ids].sort())
    expect(b.store.loadTree(ids[0])?.root.text).toBe('文档' + ids[0])
    expect(b.storage.getItem(SYNCED_KEY)).toBe('1')
  })
  it('迁移幂等：中断（离线）不写完成标记，恢复后可重跑', async () => {
    const remote = new FakeRemote()
    const a = device(remote)
    const id = a.store.create().id
    a.store.save(id, treeOf('半路'))
    remote.offline = true
    await a.engine.syncRound()
    remote.offline = false
    expect(a.storage.getItem(SYNCED_KEY)).toBeNull()
    await a.engine.syncRound()
    expect(a.storage.getItem(SYNCED_KEY)).toBe('1')
    expect(remote.docs.has(id)).toBe(true)
  })
})

describe('双设备收敛', () => {
  it('各自离线新建 → 联网后两边都有（验收 4）', async () => {
    const remote = new FakeRemote()
    const a = device(remote)
    const b = device(remote)
    await a.engine.syncRound()
    await b.engine.syncRound() // 两边都完成迁移（空）
    remote.offline = true
    const idX = a.store.create().id
    a.store.save(idX, treeOf('X'))
    const idY = b.store.create().id
    b.store.save(idY, treeOf('Y'))
    await a.engine.syncRound()
    await b.engine.syncRound()
    remote.offline = false
    await a.engine.syncRound()
    await b.engine.syncRound()
    await a.engine.syncRound() // A 的下一次触发（focus/online）吃到 B 的推送
    expect(a.store.list().map((m) => m.id).sort()).toEqual([idX, idY].sort())
    expect(b.store.list().map((m) => m.id).sort()).toEqual([idX, idY].sort())
  })
  it('同文档先后修改 → 收敛为较新者，updatedAt 为服务器时钟（验收 5）', async () => {
    const remote = new FakeRemote()
    const a = device(remote)
    const id = a.store.create().id
    a.store.save(id, treeOf('第一版'))
    await a.engine.syncRound()
    const serverTs = remote.index.find((m) => m.id === id)!.updatedAt
    // B 基于同一份远端内容修改
    const b = device(remote)
    await b.engine.syncRound()
    b.store.save(id, treeOf('B 的版本'))
    await b.engine.syncRound()
    // A 再改（A 的基线已被 B 的推送作废 → 409 → 覆盖裁决走 force）
    a.store.save(id, treeOf('A 的终版'))
    const conflicts: string[] = []
    const a2 = { onConflict: (docId: string) => conflicts.push(docId) }
    void a2
    await a.engine.syncRound()
    expect(conflicts.length + (remote.index.find((m) => m.id === id)!.updatedAt > serverTs ? 1 : 0)).toBeGreaterThan(0)
    // 最终远端 = B 的版本（A 未裁决前被暂停，不覆盖）
    expect((await remote.getDoc(id))!.root.text).toBe('B 的版本')
    // A 的推送被暂停：等票 07 的对话框裁决；此处直接走引擎裁决 API
    await a.engine.resolveConflict(id, 'discard')
    expect(a.store.loadTree(id)?.root.text).toBe('B 的版本') // 放弃本机 = 回到远端
  })
})

describe('删除传播与离线删除', () => {
  it('A 删除 → B 联网后消失；远端索引带墓碑（验收 6）', async () => {
    const remote = new FakeRemote()
    const a = device(remote)
    const id = a.store.create().id
    await a.engine.syncRound()
    const b = device(remote)
    await b.engine.syncRound()
    expect(b.store.list().some((m) => m.id === id)).toBe(true)
    a.store.remove(id)
    await a.engine.syncRound()
    expect(isTombstone(remote.index.find((m) => m.id === id)!)).toBe(true)
    await b.engine.syncRound()
    expect(b.store.list().some((m) => m.id === id)).toBe(false)
    expect(b.storage.getItem('mindnb:v2:doc:' + id)).toBeNull()
  })
  it('remove 自动触发轮次：pending-deletes 即时清空（不等下一次 focus）', async () => {
    const remote = new FakeRemote()
    const a = device(remote)
    const id = a.store.create().id
    await a.engine.syncRound()
    a.store.remove(id)
    await new Promise((r) => setTimeout(r, 30)) // 让防抖定时器自己跑
    expect(a.storage.getItem(PENDING_DELETES_KEY)).toBe('[]')
    expect(isTombstone(remote.index.find((m) => m.id === id)!)).toBe(true)
  })
  it('离线删除不被 reconcile 拉回（pending-deletes 先行）', async () => {
    const remote = new FakeRemote()
    const a = device(remote)
    const id = a.store.create().id
    a.store.save(id, treeOf('要删'))
    await a.engine.syncRound()
    remote.offline = true
    a.store.remove(id)
    await a.engine.syncRound() // 失败：意图留在 pending-deletes
    expect(JSON.parse(a.storage.getItem(PENDING_DELETES_KEY)!).length).toBe(1)
    remote.offline = false
    await a.engine.syncRound()
    expect(a.storage.getItem(PENDING_DELETES_KEY)).toBe('[]')
    expect(isTombstone(remote.index.find((m) => m.id === id)!)).toBe(true)
    // 再跑一轮也不会把文档拉回来
    await a.engine.syncRound()
    expect(a.store.list().some((m) => m.id === id)).toBe(false)
  })
})

describe('视图与兜底', () => {
  it('preserves stable world coordinates and extent when another device opens the document', async()=>{
    const remote=new FakeRemote(),a=device(remote),id=a.store.create().id
    await a.engine.syncRound()
    const v={dx:0,dy:0,k:1,coordinateVersion:2 as const,tx:-250,ty:10,extents:{document:{minX:-480,minY:0,maxX:1800,maxY:800}}}
    a.store.saveView(id,v);await a.engine.syncRound();const b=device(remote);await b.engine.syncRound();expect(b.store.loadView(id)).toEqual(v)
  })

  it('视图最后使用设备说了算（验收 10）', async () => {
    const remote = new FakeRemote()
    const a = device(remote)
    const id = a.store.create().id
    await a.engine.syncRound()
    a.store.saveView(id, { dx: 100, dy: -50, k: 2 })
    await a.engine.syncRound()
    const b = device(remote)
    await b.engine.syncRound()
    expect(b.store.loadView(id)).toEqual({ dx: 100, dy: -50, k: 2 })
  })
  it('pagehide 兜底：flushNow 用 keepalive 直推挂起文档', async () => {
    const remote = new FakeRemote()
    const a = device(remote)
    const id = a.store.create().id
    a.store.save(id, treeOf('兜底'))
    await a.engine.syncRound()
    a.store.save(id, treeOf('兜底2'))
    // 不走防抖轮次，直接 flushNow（模拟 pagehide）
    a.engine.flushNow()
    await new Promise((r) => setTimeout(r, 10))
    const last = remote.putDocCalls.at(-1)!
    expect(last.id).toBe(id)
    expect((last.body.tree as { root: { text: string } }).root.text).toBe('兜底2')
  })
})

describe('覆盖警告引擎侧（票 07）', () => {
  /** 造冲突：a/b 同步 v1 → b 先推 → a 后推吃 409 */
  async function setupConflict() {
    const remote = new FakeRemote()
    const conflicts: Array<[string, DocMeta | null]> = []
    const deleted: string[] = []
    const a = device(remote, new FakeStorage(), {
      onConflict: (id, e) => conflicts.push([id, e]),
      onDeleted: (id) => deleted.push(id),
    })
    const b = device(remote)
    const id = a.store.create().id
    a.store.save(id, treeOf('v1'))
    await a.engine.syncRound()
    await b.engine.syncRound()
    b.store.save(id, treeOf('B 抢先'))
    await b.engine.syncRound()
    a.store.save(id, treeOf('A 后到'))
    return { remote, a, b, id, conflicts, deleted }
  }
  it('409 conflict → 暂停该文档推送 + onConflict 带远端条目；后续轮次不再推', async () => {
    const { remote, a, id, conflicts, deleted } = await setupConflict()
    await a.engine.syncRound()
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0][0]).toBe(id)
    expect(conflicts[0][1]?.updatedAt).toBeGreaterThan(0)
    expect(deleted).toHaveLength(0)
    const calls = remote.putDocCalls.length
    await a.engine.syncRound() // 暂停中：不重推（等用户裁决）
    expect(remote.putDocCalls.length).toBe(calls)
    expect(a.engine._state().pausedDocs).toEqual([id])
  })
  it('覆盖远端 = force 重发成功，解除暂停', async () => {
    const { remote, a, id } = await setupConflict()
    await a.engine.syncRound()
    await a.engine.resolveConflict(id, 'overwrite')
    expect((await remote.getDoc(id))!.root.text).toBe('A 后到')
    expect(a.engine._state().pausedDocs).toEqual([])
    expect(a.engine._state().pendingDocs).toEqual([])
  })
  it('放弃本机修改 = 本地 tree+meta 回远端、解除脏、onDiscarded', async () => {
    const remote = new FakeRemote()
    const discarded: string[] = []
    const a = device(remote, new FakeStorage(), { onDiscarded: (id) => discarded.push(id) })
    const b = device(remote)
    const id = a.store.create().id
    a.store.save(id, treeOf('v1'))
    await a.engine.syncRound()
    await b.engine.syncRound()
    b.store.save(id, treeOf('B 抢先'))
    await b.engine.syncRound()
    a.store.save(id, treeOf('A 后到'))
    await a.engine.syncRound() // 409 → 暂停
    await a.engine.resolveConflict(id, 'discard')
    expect(a.store.loadTree(id)?.root.text).toBe('B 抢先')
    expect(discarded).toEqual([id])
    const calls = remote.putDocCalls.length
    await a.engine.syncRound() // 已回远端：不再推
    expect(remote.putDocCalls.length).toBe(calls)
  })
  it('编辑器开着的文档不拉新；保存必吃 409 而非静默顶掉；关闭后补拉（票 07 根因）', async () => {
    const remote = new FakeRemote()
    const a = device(remote)
    const b = device(remote)
    const id = a.store.create().id
    a.store.save(id, treeOf('v1'))
    await a.engine.syncRound()
    await b.engine.syncRound() // b 拉 v1，基线对齐
    b.engine.setOpen(id, true) // 模拟 b 编辑器开着
    a.store.save(id, treeOf('A 的新版'))
    await a.engine.syncRound()
    await b.engine.syncRound()
    expect(b.store.loadTree(id)?.root.text).toBe('v1') // 开着不拉
    b.store.save(id, treeOf('B 的编辑')) // 基于旧 v1 的编辑
    await b.engine.syncRound()
    expect((await remote.getDoc(id))!.root.text).toBe('A 的新版') // 不静默顶掉 A
    b.engine.setOpen(id, false)
    await b.engine.syncRound()
    expect(b.store.loadTree(id)?.root.text).toBe('B 的编辑') // 关闭也不自动拉：脏+暂停，等裁决（对话框跨路由存活）
    await b.engine.resolveConflict(id, 'discard') // 裁决放弃 → 回到远端
    expect(b.store.loadTree(id)?.root.text).toBe('A 的新版')
  })
  it('开着的文档：远端条目不得提升进本地索引（假脏→假409卡死回归）', async () => {
    const remote = new FakeRemote()
    const a = device(remote)
    const b = device(remote)
    const id = a.store.create().id
    a.store.save(id, treeOf('v1'))
    await a.engine.syncRound()
    await b.engine.syncRound()
    b.store.save(id, treeOf('B 更新'))
    await b.engine.syncRound()
    // a 编辑器开着该文档：轮次既不拉也不许把远端条目并进本地索引
    a.engine.setOpen(id, true)
    await a.engine.syncRound()
    const entry1 = JSON.parse(a.storage.getItem('mindnb:v2:docs')!).find((m: DocMeta) => m.id === id)
    const bl1 = JSON.parse(a.storage.getItem(BASELINES_KEY)!)
    expect(entry1.updatedAt).toBe(bl1[id]) // 条目与基线保持齐平 = 不冒充脏
    const calls = remote.putDocCalls.length
    await a.engine.syncRound()
    expect(remote.putDocCalls.length).toBe(calls) // 也没有多推一次
    expect(a.engine._state().pausedDocs).toEqual([]) // 没吃假 409
    // 关闭编辑器 → 补拉正常
    a.engine.setOpen(id, false)
    await a.engine.syncRound()
    expect(a.store.loadTree(id)?.root.text).toBe('B 更新')
  })
  it('409 deleted → 静默清除本地，不弹覆盖警告', async () => {
    const { remote, a, b, id, conflicts, deleted } = await setupConflict()
    // b 删除该文档并同步（远端成墓碑）
    b.store.remove(id)
    await b.engine.syncRound()
    a.store.save(id, treeOf('A 后到')) // a 不知情，照常推
    await a.engine.syncRound()
    expect(deleted).toEqual([id])
    expect(conflicts).toHaveLength(0) // 不弹覆盖警告
    expect(a.store.list().some((m) => m.id === id)).toBe(false)
    expect(a.storage.getItem('mindnb:v2:doc:' + id)).toBeNull()
    expect(remote.deleteCalls).toContain(id)
  })
})

describe('fail-soft 与基线', () => {
  it('无 /api（ping absent）→ start 后转纯缓存：save 照常、零远端调用、不抛错', async () => {
    const calls: string[] = []
    const ghost: RemoteClient = {
      ping: async () => 'absent',
      getIndex: async () => {
        calls.push('index')
        return []
      },
      putIndex: async () => [],
      getDoc: async () => null,
      putDoc: async () => {
        calls.push('putDoc')
        return []
      },
      deleteDoc: async () => [],
      putView: async () => ({ dx: 0, dy: 0, k: 1 }),
      getView: async () => null,
      getVersions: async () => [],
      getVersion: async () => null,
    }
    const d = device(ghost)
    await d.engine.start()
    const id = d.store.create().id
    d.store.save(id, treeOf('纯本地'))
    await d.engine.syncRound()
    expect(calls).toEqual([])
    expect(d.store.loadTree(id)?.root.text).toBe('纯本地')
  })
  it('基线表：推送成功后本地条目与基线对齐服务器时钟（服务器时钟原则）', async () => {
    const remote = new FakeRemote()
    const a = device(remote)
    const id = a.store.create().id
    a.store.save(id, treeOf('打点'))
    await a.engine.syncRound()
    const entry = JSON.parse(a.storage.getItem('mindnb:v2:docs')!).find((m: DocMeta) => m.id === id)
    const baselines = JSON.parse(a.storage.getItem(BASELINES_KEY)!)
    expect(entry.updatedAt).toBe(baselines[id])
    expect(entry.updatedAt).toBeLessThan(100_000) // 服务器时钟（远小于本地时钟起点）
  })
})

describe('rich content synchronization', () => {
  it('round-trips embedded structures, ink, fonts and ownership across two devices', async () => {
    const remote = new FakeRemote(), a = device(remote), b = device(remote)
    const id = a.store.create().id
    let map: MindMap = { ...treeOf('图文中文'), font: 'serif' }
    map = insertContent(map, createTable(), map.root.id)
    const cycle = createCycle(); map = insertContent(map, cycle, null)
    map = insertContent(map, makeInk([{ id: 'stroke', points: [{ x: 10, y: 10 }, { x: 30, y: 30 }], color: '#ff0000', width: 4, opacity: .35 }]), map.root.id)
    a.store.save(id, map); await a.engine.syncRound(); await b.engine.syncRound()
    expect(b.store.loadTree(id)).toEqual(map)
    const embedded = transferContent(b.store.loadTree(id)!, cycle.id, map.root.id)
    b.store.save(id, embedded); await b.engine.syncRound(); await a.engine.syncRound()
    expect(a.store.loadTree(id)).toEqual(embedded)
    // Restoring an earlier complete snapshot preserves the same ownership semantics.
    a.store.save(id, map); await a.engine.syncRound(); await b.engine.syncRound()
    expect(b.store.loadTree(id)).toEqual(map)
  })
})
