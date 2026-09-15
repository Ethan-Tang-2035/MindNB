import { worldViewFields } from './work-extent.ts'
/**
 * 同步引擎 —— spec §②§③。withSync(store) 代理接在唯一存储注入点，全部调用点无感：
 * UI 继续同步读写本地缓存；引擎异步一轮一轮收发（in-flight 互斥，后到触发合并为补跑）。
 * 推送全程条件写（baseUpdatedAt = 本机该文档的上次同步基线），409 进覆盖警告（票 07）。
 * 基线单独落盘（mindnb:v2:baselines）：刷新后「本地是否脏」仍可判定，防全量重推与静默覆盖。
 * 词汇见 CONTEXT.md（远端、本地缓存、访问密码、墓碑）。
 */
import type { DocMeta, DocStore, StorageLike, StoredView } from './docs.ts'
import { documentCache, isTombstone, validTree } from './docs.ts'
import type { MindMap } from './model.ts'
import { mergeIndex } from './index-merge.ts'
import { AuthError, ConflictError, NetworkError, ACCESS_KEY_STORAGE, type RemoteClient } from './remote.ts'

/** 首连迁移完成标记（spec「数据布局」） */
export const SYNCED_KEY = 'mindnb:v2:synced'
/** 离线删除意图：防「删了又被拉回来」 */
export const PENDING_DELETES_KEY = 'mindnb:v2:pending-deletes'
/** 基线表：docId → 本机内容所依据的远端 updatedAt */
export const BASELINES_KEY = 'mindnb:v2:baselines'
/** keepalive fetch 载荷上限（spec 边界细则：超限放弃本次，下轮补推） */
export const KEEPALIVE_LIMIT = 64 * 1024

export interface PendingDelete { id: string; deletedAt: number }

export interface SyncHooks {
  /** 条件写 409 conflict → 引擎暂停该文档推送，UI 弹覆盖警告（票 07） */
  onConflict?: (docId: string, remoteEntry: DocMeta | null) => void
  /** 本地缓存被远端改写（拉取/墓碑清除/推送回包打点）→ 首页刷新 */
  onChanged?: () => void
  /** 文档被远端删除（墓碑传播 / 409 deleted）→ 编辑器若开着要退出 */
  onDeleted?: (docId: string) => void
  /** 放弃本机修改后：清该文档撤销历史 + 重载编辑器（票 07） */
  onDiscarded?: (docId: string) => void
}

export interface SyncOptions {
  remote: RemoteClient
  storage: StorageLike
  hooks?: SyncHooks
  /** 文档防抖推送间隔（spec：2s） */
  docDebounceMs?: number
  /** 视图防抖推送间隔（spec：3s） */
  viewDebounceMs?: number
  now?: () => number
}

export function createSyncEngine(store: DocStore, opts: SyncOptions) {
  const remote = opts.remote
  const storage = opts.storage
  const hooks = opts.hooks ?? {}
  const docDebounceMs = opts.docDebounceMs ?? 2000
  const viewDebounceMs = opts.viewDebounceMs ?? 3000
  const now = opts.now ?? Date.now

  /** 本轮待推：本地脏文档/视图 id */
  const pendingDocs = new Set<string>()
  const pendingViews = new Set<string>()
  /** 脏判定：updatedAt 超过基线，或本轮明确标脏（防设备时钟落后于服务器时钟时漏推） */
  function isDirty(id: string, updatedAt: number, baselines: Record<string, number>): boolean {
    return updatedAt > (baselines[id] ?? -1) || pendingDocs.has(id)
  }
  /** 覆盖警告暂停表：409 conflict 后不再推，直到用户裁决（票 07） */
  const pausedDocs = new Set<string>()
  /** 编辑器正打开的文档：拉取旁路（票 07）——内存里的树是旧版，拉新会「刷新基线却留着旧内存」，
   *  随后的保存就会带新基线静默顶掉对方；不拉则保存必吃 409 → 覆盖警告，符合 spec §④ */
  const openDocs = new Set<string>()
  /** 最近一次见到的远端索引（拉取搭车在推送回包上，随时刷新） */
  let remoteIndex: DocMeta[] = []
  let inFlight: Promise<void> | null = null
  let rerun = false
  /** fail-soft：无 /api 的纯本地 dev → 永久纯缓存模式（spec §②） */
  let disabled = false
  let docTimer: ReturnType<typeof setTimeout> | null = null
  let viewTimer: ReturnType<typeof setTimeout> | null = null
  let started = false

  // ---- 本地缓存裸读写（key 布局与 docs.ts 同源；引擎要写「不触顶、不刷时间」的远端值） ----

  function readJSON<T>(key: string, fallback: T): T {
    try {
      const v = JSON.parse(storage.getItem(key) ?? '') as T
      return v === null ? fallback : v
    } catch {
      return fallback
    }
  }

  const cache = documentCache(storage)
  const readLocalIndex = cache.index
  const writeLocalIndex = cache.replaceIndex
  function readBaselines(): Record<string, number> {
    return readJSON<Record<string, number>>(BASELINES_KEY, {})
  }
  function writeBaselines(b: Record<string, number>): void {
    storage.setItem(BASELINES_KEY, JSON.stringify(b))
  }
  function readPendingDeletes(): PendingDelete[] {
    return readJSON<PendingDelete[]>(PENDING_DELETES_KEY, [])
  }
  function writePendingDeletes(list: PendingDelete[]): void {
    storage.setItem(PENDING_DELETES_KEY, JSON.stringify(list))
  }

  /** 本地彻底清除一个文档（墓碑传播）：数据 key + 索引条目 + 基线 + 各待推表 */
  function purgeLocal(id: string): void {
    cache.remove(id)
    const b = readBaselines()
    if (id in b) {
      delete b[id]
      writeBaselines(b)
    }
    pendingDocs.delete(id)
    pendingViews.delete(id)
    pausedDocs.delete(id)
    writePendingDeletes(readPendingDeletes().filter((p) => p.id !== id))
  }

  /** 拉取远端文档写入本地缓存：不触顶、不刷时间（那是本地编辑语义）；条目整体取远端值（服务器时钟）。
   *  远端数据损坏/缺失 → 保留本地内容、console.warn（spec 边界细则：宁缺毋滥） */
  async function pullDoc(entry: DocMeta, baselines: Record<string, number>): Promise<void> {
    const tree = await remote.getDoc(entry.id)
    if (!tree || !validTree(tree)) {
      console.warn('[mindnb] 远端树缺失或校验失败，保留本地内容：' + entry.id)
      return
    }
    cache.replace(entry, tree)
    baselines[entry.id] = entry.updatedAt
  }

  function upsertLocalEntry(m: DocMeta): void {
    cache.replace(m)
  }

  // ---- 调度 ----

  function scheduleDoc(): void {
    if (docTimer) clearTimeout(docTimer)
    docTimer = setTimeout(() => {
      docTimer = null
      void syncRound()
    }, docDebounceMs)
  }
  function scheduleView(): void {
    if (viewTimer) clearTimeout(viewTimer)
    viewTimer = setTimeout(() => {
      viewTimer = null
      void syncRound()
    }, viewDebounceMs)
  }

  /** 一轮 sync：同一时刻只允许一轮，后到触发合并为跑完补一轮（spec 边界细则） */
  function syncRound(): Promise<void> {
    if (disabled) return Promise.resolve()
    if (inFlight) {
      rerun = true
      return inFlight
    }
    inFlight = (async () => {
      do {
        rerun = false
        try {
          await runOnce()
        } catch (e) {
          if (e instanceof AuthError) return // 密码失效：下次 boot 的门处理
          if (e instanceof NetworkError) return // 一轮失败静默，等下次触发重试（无退避，单用户）
          console.warn('[mindnb] sync 轮次异常', e)
          return
        }
      } while (rerun)
    })().finally(() => {
      inFlight = null
    })
    return inFlight
  }

  async function runOnce(): Promise<void> {
    let changed = false
    if (!storage.getItem(SYNCED_KEY)) {
      await migrate()
      changed = true
    }
    await flushPendingDeletes()
    remoteIndex = await remote.getIndex()

    // ① 远端墓碑 → 本地清除（删除向所有设备传播；离线删除意图同步了就该出队）
    for (const r of remoteIndex) {
      if (isTombstone(r)) {
        const local = readLocalIndex().some((m) => m.id === r.id)
        if (local || readPendingDeletes().some((p) => p.id === r.id)) {
          purgeLocal(r.id)
          hooks.onDeleted?.(r.id)
          changed = true
        }
      }
    }

    // ② 文档差分：脏（本地 > 基线）→ 条件推；远端 > 基线且本地不脏 → 拉；平手不动
    const baselines = readBaselines()
    const localRaw = readLocalIndex()
    const dirty = new Set<string>()
    for (const L of localRaw) {
      if (!isTombstone(L) && isDirty(L.id, L.updatedAt, baselines)) dirty.add(L.id)
    }
    for (const id of [...pendingDocs]) if (dirty.has(id) === false && readLocalIndex().some((m) => m.id === id)) pendingDocs.delete(id)

    // 远端较新且本地不脏 → 拉
    for (const R of remoteIndex) {
      if (isTombstone(R)) continue
      const base = baselines[R.id] ?? -1
      const L = localRaw.find((m) => m.id === R.id)
      if (R.updatedAt > base && !(L && dirty.has(L.id)) && !openDocs.has(R.id)) {
        await pullDoc(R, baselines)
        changed = true
      }
    }

    // 本地脏 → 条件推（暂停表里的等用户裁决，不推）
    for (const L of localRaw) {
      if (!dirty.has(L.id) || pausedDocs.has(L.id)) continue
      const tree = store.loadTree(L.id)
      if (!tree) continue // 数据 key 缺失（异常态）：只靠索引合并补条目，不推树
      try {
        const index = await remote.putDoc(L.id, {
          tree,
          nameOverride: L.nameOverride ?? undefined,
          baseUpdatedAt: baselines[L.id] ?? 0,
        })
        remoteIndex = index
        const served = index.find((m) => m.id === L.id)
        if (served) {
          upsertLocalEntry(served) // 服务器时钟覆盖本地打点（spec 服务器时钟原则）
          baselines[L.id] = served.updatedAt
        }
        pendingDocs.delete(L.id)
        changed = true
      } catch (e) {
        if (e instanceof ConflictError) {
          if (e.kind === 'deleted') {
            purgeLocal(L.id) // 409 deleted：静默清除，不弹警告（票 07）
            hooks.onDeleted?.(L.id)
            changed = true
          } else {
            pausedDocs.add(L.id) // 409 conflict：暂停该文档推送，弹覆盖警告
            if (e.entry) {
              remoteIndex = mergeIndex(remoteIndex, [e.entry])
            }
            hooks.onConflict?.(L.id, e.entry)
          }
        } else if (e instanceof NetworkError) {
          throw e // 断网：整轮中止，等下次触发
        }
      }
    }
    writeBaselines(baselines)

    // ③ 索引收尾：脏条目的本地值不被远端旧值覆盖（时钟偏差保护），其余按 id 取较新合并。
    //    开着的文档且远端比基线新 = 本轮跳过了拉取（编辑器内存是旧版）：条目也不许提升，
    //    否则本地条目冒充「比基线新 → 脏」，下轮拿旧树去推 → 假 409 卡死（票 07 走查实录）
    const fresh = readLocalIndex()
    const bNow = readBaselines()
    const dirtyNow = new Set(fresh.filter((m) => isDirty(m.id, m.updatedAt, bNow)).map((m) => m.id))
    const incoming = remoteIndex.filter(
      (r) => !dirtyNow.has(r.id) && !isTombstone(r) && !(openDocs.has(r.id) && r.updatedAt > (bNow[r.id] ?? -1)),
    )
    writeLocalIndex(mergeIndex(fresh, incoming))

    // ④ 视图：StoredView.updatedAt 比较，最后使用设备说了算
    await reconcileViews()

    if (changed) hooks.onChanged?.()
  }

  async function reconcileViews(): Promise<void> {
    const ids = new Set<string>()
    for (const m of readLocalIndex()) if (!isTombstone(m)) ids.add(m.id)
    for (const r of remoteIndex) if (!isTombstone(r)) ids.add(r.id)
    for (const id of ids) {
      const lv = cache.view(id)
      let rv: StoredView | null
      try {
        rv = await remote.getView(id)
      } catch (e) {
        if (e instanceof NetworkError) throw e
        continue
      }
      const lNewer = lv && (!rv || lv.updatedAt! > rv.updatedAt!)
      const rNewer = rv && (!lv || rv.updatedAt! > lv.updatedAt!)
      try {
        if (rNewer) {
          cache.replaceView(id, rv)
          pendingViews.delete(id)
        } else if (lNewer) {
          const served = await remote.putView(id, { ...worldViewFields(lv!), dx: lv!.dx, dy: lv!.dy, k: lv!.k, ...(lv!.drill ? { drill: lv!.drill } : {}) })
          cache.replaceView(id, served) // 服务端打点回写：基线即服务器时钟
          pendingViews.delete(id)
        }
      } catch (e) {
        if (e instanceof NetworkError) throw e
        if (!(e instanceof AuthError)) console.warn('[mindnb] 视图同步失败', id, e)
      }
    }
  }

  // ---- 首连迁移（spec §③）：幂等、中断可重跑、全部成功才写完成标记 ----

  async function migrate(): Promise<void> {
    const remoteIdx = await remote.getIndex()
    const localRaw = readLocalIndex()
    const baselines = readBaselines()
    for (const L of localRaw) {
      const R = remoteIdx.find((m) => m.id === L.id)
      if (isTombstone(L)) continue // 本地墓碑：条目交给批量合并，不推树
      if (!R || L.updatedAt > R.updatedAt) {
        const tree = store.loadTree(L.id)
        if (!tree) continue
        const index = await remote.putDoc(L.id, { tree, nameOverride: L.nameOverride ?? undefined, baseUpdatedAt: R?.updatedAt ?? 0 })
        // 迁移即对齐基线：本地条目采纳服务器打点，否则随后的 reconcile 会把每篇都判脏、
        // 带过期 base 重推 → 首连就吃一串假 409
        const served = index.find((m) => m.id === L.id)
        if (served) {
          upsertLocalEntry(served)
          baselines[L.id] = served.updatedAt
        }
      } else {
        // 远端较新 → 跳过上传；基线中性化到本地值，让本轮 reconcile 按「远端 > 基线」拉新
        baselines[L.id] = L.updatedAt
      }
    }
    writeBaselines(baselines)
    await remote.putIndex(readLocalIndex()) // 批量并条目（含墓碑；逐 id 保留较新，幂等）
    for (const L of readLocalIndex()) {
      if (isTombstone(L)) continue
      const v = cache.view(L.id)
      if (v) await remote.putView(L.id, { ...worldViewFields(v), dx: v.dx, dy: v.dy, k: v.k, ...(v.drill ? { drill: v.drill } : {}) })
    }
    storage.setItem(SYNCED_KEY, '1')
  }

  // ---- 离线删除意图 ----

  async function flushPendingDeletes(): Promise<void> {
    const list = readPendingDeletes()
    if (!list.length) return
    for (const p of [...list]) {
      const index = await remote.deleteDoc(p.id) // 幂等；网络错会抛 → 整轮中止，意图留在表里
      remoteIndex = index
      writePendingDeletes(readPendingDeletes().filter((x) => x.id !== p.id))
    }
  }

  // ---- pagehide 兜底：keepalive 直推，超限/失败放弃本次、下轮补推 ----

  function flushNow(): void {
    if (disabled) return
    for (const p of readPendingDeletes()) {
      void remote.deleteDoc(p.id, { keepalive: true }).catch(() => {})
    }
    const baselines = readBaselines()
    for (const id of [...pendingDocs]) {
      if (pausedDocs.has(id)) continue
      const L = readLocalIndex().find((m) => m.id === id)
      const tree = L ? store.loadTree(id) : null
      if (!tree) continue
      const body = { tree, nameOverride: L!.nameOverride ?? undefined, baseUpdatedAt: baselines[id] ?? 0 }
      if (JSON.stringify(body).length > KEEPALIVE_LIMIT) continue // 超限：下轮补推
      void remote.putDoc(id, body, { keepalive: true }).then(() => pendingDocs.delete(id)).catch(() => {})
    }
    for (const id of [...pendingViews]) {
      const v = cache.view(id)
      if (!v) continue
      void remote.putView(id, { ...worldViewFields(v), dx: v.dx, dy: v.dy, k: v.k, ...(v.drill ? { drill: v.drill } : {}) }, { keepalive: true }).then(() => pendingViews.delete(id)).catch(() => {})
    }
  }

  // ---- 生命周期 ----

  function onVisibility(): void {
    if (documentHidden()) flushNow()
    else void syncRound()
  }
  function documentHidden(): boolean {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden'
  }

  return {
    /** 代理要挂的钩子（withSync 用） */
    markDoc(id: string): void {
      if (disabled) return
      // 时钟落后保护：本地打点若不高于基线，抬到基线+1，保证「保存过 = 脏」可判定
      const baselines = readBaselines()
      const base = baselines[id]
      if (base != null) {
        const metas = readLocalIndex()
        const m = metas.find((x) => x.id === id)
        if (m && m.updatedAt <= base) {
          m.updatedAt = base + 1
          writeLocalIndex(metas)
        }
      }
      pendingDocs.add(id)
      scheduleDoc()
    },
    markView(id: string): void {
      if (disabled) return
      pendingViews.add(id)
      scheduleView()
    },
    recordPendingDelete(id: string): void {
      if (disabled) return
      const list = readPendingDeletes().filter((p) => p.id !== id)
      list.push({ id, deletedAt: now() })
      writePendingDeletes(list)
      pendingDocs.delete(id)
      pendingViews.delete(id)
      pausedDocs.delete(id)
    },
    /** 鉴权通过后调用：探测 /api 存在性（fail-soft），挂生命周期，跑首轮 */
    async start(): Promise<void> {
      if (started) return
      started = true
      const v = await remote.ping(storage.getItem(ACCESS_KEY_STORAGE))
      if (v === 'absent') {
        disabled = true
        console.warn('[mindnb] 未检测到 /api，同步引擎转纯缓存模式（vercel dev / MINDNB_REMOTE 可启用远端）')
        return
      }
      if (typeof window !== 'undefined') {
        window.addEventListener('pagehide', flushNow)
        window.addEventListener('online', () => void syncRound())
        window.addEventListener('focus', () => void syncRound())
        document.addEventListener('visibilitychange', onVisibility)
      }
      void syncRound()
    },
    syncRound,
    /** 编辑器开/关文档（main.ts 路由调用）：开着不拉，关上补一轮 */
    setOpen(id: string, open: boolean): void {
      if (open) openDocs.add(id)
      else openDocs.delete(id)
    },
    /** 删除等「不走 save 的写」也要触发轮次（pending-deletes 不能干等下一次 focus） */
    scheduleRound(): void {
      scheduleDoc()
    },
    flushNow,
    /** 票 07 接口：冲突裁决 */
    async resolveConflict(id: string, choice: 'overwrite' | 'discard'): Promise<void> {
      pausedDocs.delete(id)
      if (choice === 'overwrite') {
        const L = readLocalIndex().find((m) => m.id === id)
        const tree = L ? store.loadTree(id) : null
        if (L && tree) {
          const index = await remote.putDoc(id, { tree, nameOverride: L.nameOverride ?? undefined, force: true })
          remoteIndex = index
          const served = index.find((m) => m.id === id)
          if (served) {
            upsertLocalEntry(served)
            const b = readBaselines()
            b[id] = served.updatedAt
            writeBaselines(b)
          }
          pendingDocs.delete(id)
          hooks.onChanged?.()
        }
        void syncRound()
        return
      }
      // 放弃本机修改：重拉远端 tree+meta 写本地（引擎调用方负责清撤销历史与重载编辑器）
      const R = remoteIndex.find((m) => m.id === id)
      if (R && !isTombstone(R)) {
        const b = readBaselines()
        await pullDoc(R, b)
        writeBaselines(b)
      }
      pendingDocs.delete(id)
      hooks.onDiscarded?.(id)
    },
    /** 测试与走查用内省 */
    _state: () => ({ disabled, pendingDocs: [...pendingDocs], pendingViews: [...pendingViews], pausedDocs: [...pausedDocs], synced: !!storage.getItem(SYNCED_KEY) }),
  }
}

export type SyncEngine = ReturnType<typeof createSyncEngine>

/**
 * 存储代理：DocStore 唯一注入点的一行替换（spec §②）。
 * save/saveView/create/copy/rename 额外登记防抖推送；remove 先记 pending-deletes 再走原逻辑；其余方法直通。
 */
export function withSync(store: DocStore, opts: SyncOptions): { store: DocStore; engine: SyncEngine } {
  const engine = createSyncEngine(store, opts)
  const proxied: DocStore = {
    ...store,
    save(id: string, map: MindMap): void {
      store.save(id, map)
      engine.markDoc(id)
    },
    saveView(id: string, view: Parameters<DocStore['saveView']>[1]): void {
      store.saveView(id, view)
      engine.markView(id)
    },
    rename(id: string, name: string): void {
      store.rename(id, name)
      engine.markDoc(id)
    },
    remove(id: string): void {
      engine.recordPendingDelete(id)
      store.remove(id)
      engine.scheduleRound()
    },
    copy(id: string) {
      const m = store.copy(id)
      if (m) engine.markDoc(m.id)
      return m
    },
    create() {
      const m = store.create()
      engine.markDoc(m.id)
      return m
    },
  }
  return { store: proxied, engine }
}
