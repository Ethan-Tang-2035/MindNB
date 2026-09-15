import { worldViewFields, validExtent } from '../src/work-extent.ts'
/**
 * API Routes handler（spec §①）—— 框架无关的一份实现：
 * Vercel 的 api/*.ts 是薄包装，本地 shim（MINDNB_REMOTE vite 中间件）与单测复用同一实现。
 * 约定：全部路由先过鉴权三态；全部写操作响应 {index} 全量索引（拉取搭车在推送回包上）；
 * 远端一切 updatedAt 由服务器打点（服务器时钟原则，spec §①）。
 */
import { checkAccess, sendError, sendJson, type ResLike } from './auth.ts'
import type { BlobStore } from './blob-store.ts'
import { ID_RE, pathCapture, readJson, type HttpReq } from './http.ts'
import { mergeIndex } from '../src/index-merge.ts'
import { docKey, INDEX_KEY, isTombstone, validTree, viewKey, type DocMeta } from '../src/docs.ts'
import { validDrillFrames } from '../src/drill.ts'

/** 版本快照 key 布局（票 06 使用；spec「数据布局」） */
export const VERSION_PREFIX = (docId: string) => `mindnb:v2:ver:${docId}:`
export const versionKey = (docId: string, savedAt: number) => `mindnb:v2:ver:${docId}:${savedAt}`

/** 统一异常兜底：handler 内任何意外（含存储故障）→ 500，不让函数裸抛 */
function guarded(fn: (req: HttpReq, res: ResLike) => Promise<void>) {
  return async (req: HttpReq, res: ResLike): Promise<void> => {
    try {
      await fn(req, res)
    } catch {
      if (res.statusCode === 0 || res.statusCode === 200) sendError(res, 500, 'internal')
    }
  }
}

/** 鉴权三态：true = 通过可继续；false = 已应答（401/500） */
function authOk(req: HttpReq, res: ResLike): boolean {
  const verdict = checkAccess(req)
  if (verdict === 'not_configured') {
    sendError(res, 500, 'server_not_configured')
    return false
  }
  if (verdict === 'unauthorized') {
    sendError(res, 401, 'unauthorized')
    return false
  }
  return true
}

async function loadIndex(store: BlobStore): Promise<DocMeta[]> {
  const raw = await store.get(INDEX_KEY)
  if (raw === null) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('index_corrupt')
  }
  if (!Array.isArray(parsed)) throw new Error('index_corrupt')
  return parsed as DocMeta[]
}

function saveIndex(store: BlobStore, index: DocMeta[]): Promise<void> {
  return store.put(INDEX_KEY, JSON.stringify(index))
}

/** 索引条目的最低可信形状（PUT /api/index 的 entries 校验） */
function validMeta(v: unknown): v is DocMeta {
  const m = v as DocMeta
  return (
    !!m && typeof m.id === 'string' && ID_RE.test(m.id) &&
    typeof m.createdAt === 'number' && Number.isFinite(m.createdAt) &&
    typeof m.updatedAt === 'number' && Number.isFinite(m.updatedAt)
  )
}

/** GET/PUT /api/index —— PUT 逐 id 保留较新（共享 index-merge，不自写合并） */
export function makeIndexHandler(store: BlobStore) {
  return guarded(async (req, res) => {
    if (!authOk(req, res)) return
    if (req.method === 'GET') {
      return sendJson(res, 200, { index: await loadIndex(store) })
    }
    if (req.method === 'PUT') {
      const body = await readJson(req)
      if (!body.ok) return sendError(res, 400, body.error)
      const entries = (body.value as { entries?: unknown }).entries
      if (!Array.isArray(entries) || !entries.every(validMeta)) return sendError(res, 400, 'bad_request')
      const base = await loadIndex(store)
      const now = Date.now()
      const merged = mergeIndex(base, entries as DocMeta[], { now })
      // 超期墓碑被清理：同轮删对应 doc/view blob（spec 边界细则；version blob 由 keep-10 自然淘汰）
      const alive = new Set(merged.map((m) => m.id))
      for (const m of base) {
        if (isTombstone(m) && !alive.has(m.id)) {
          await store.del(docKey(m.id))
          await store.del(viewKey(m.id))
        }
      }
      await saveIndex(store, merged)
      return sendJson(res, 200, { index: merged })
    }
    return sendError(res, 405, 'method_not_allowed')
  })
}

const DOCS_PATH = /^\/api\/docs\/([^/?]+)$/

function validPutDocBody(v: unknown): v is { tree: unknown; nameOverride?: string | null; baseUpdatedAt?: number; force?: boolean } {
  const b = v as Record<string, unknown>
  if (!b || typeof b !== 'object') return false
  if (!('tree' in b)) return false
  if (b.nameOverride !== undefined && b.nameOverride !== null && typeof b.nameOverride !== 'string') return false
  if (b.baseUpdatedAt !== undefined && (typeof b.baseUpdatedAt !== 'number' || !Number.isFinite(b.baseUpdatedAt) || b.baseUpdatedAt < 0)) return false
  if (b.force !== undefined && typeof b.force !== 'boolean') return false
  return true
}

/** 版本快照最小间隔（spec §⑤：连续保存只留 1 份锚点，原地覆写）；常量可调 */
export const VERSION_MIN_GAP_MS = 5 * 60_000
/** 版本保留份数（spec §⑤） */
export const VERSION_KEEP = 10

export interface DocsHandlerOptions {
  now?: () => number
  minGapMs?: number
}

/** 列出版本 savedAt（升序） */
async function listVersionStamps(store: BlobStore, docId: string): Promise<number[]> {
  const prefix = VERSION_PREFIX(docId)
  const keys = await store.list(prefix)
  return keys
    .map((k) => Number(k.slice(prefix.length)))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b)
}

/**
 * 保存触发服务端快照（spec §① 步骤③、§⑤）：
 * 旧 blob 存在且与新内容字节不等才留（不产生伪版本）；
 * 距最近版本 < 最小间隔 → 原地覆写该版本（保留原 savedAt 锚点）；否则新建；keep-10。
 * 快照体用字符串拼接嵌入旧 JSON：字节原样平移，服务端不做语义 diff（spec 边界细则）。
 */
async function snapshotOldContent(
  store: BlobStore,
  docId: string,
  oldJson: string,
  newJson: string,
  now: number,
  minGapMs: number,
): Promise<void> {
  if (oldJson === newJson) return
  const stamps = await listVersionStamps(store, docId)
  const latest = stamps.length ? stamps[stamps.length - 1] : null
  const body = '{"savedAt":' + (latest ?? now) + ',"tree":' + oldJson + '}'
  if (latest !== null && now - latest < minGapMs) {
    await store.put(versionKey(docId, latest), body) // 锚点不变，内容覆写为「最近一次被替换下来的旧版」
  } else {
    await store.put(versionKey(docId, now), body)
    stamps.push(now)
  }
  const excess = stamps.length - VERSION_KEEP // keep-10：超额删最旧
  if (excess > 0) {
    for (const s of stamps.slice(0, excess)) await store.del(versionKey(docId, s))
  }
}

/**
 * GET/PUT/DELETE /api/docs/:id —— spec §① 服务端流程：
 * ① 墓碑且非 force → 409 deleted（force 视为复活：清墓碑）
 * ② 非 force 且 entry.updatedAt > baseUpdatedAt → 409 conflict（带远端条目）
 * ③ 被替换的旧内容入版本快照（5 分钟最小间隔 + keep-10）
 * ④ 写 doc、entry.updatedAt = 服务器 now、nameOverride 有则更新、写回索引
 */
export function makeDocsHandler(store: BlobStore, opts: DocsHandlerOptions = {}) {
  const nowFn = opts.now ?? Date.now
  const minGapMs = opts.minGapMs ?? VERSION_MIN_GAP_MS
  return guarded(async (req, res) => {
    if (!authOk(req, res)) return
    const id = pathCapture(req.url, DOCS_PATH)
    if (id === null || !ID_RE.test(id)) return sendError(res, 400, 'bad_request')

    if (req.method === 'GET') {
      const raw = await store.get(docKey(id))
      if (raw === null) return sendError(res, 404, 'not_found')
      return sendJson(res, 200, { tree: JSON.parse(raw) })
    }

    if (req.method === 'PUT') {
      const body = await readJson(req)
      if (!body.ok) return sendError(res, 400, body.error)
      if (!validPutDocBody(body.value) || !validTree(body.value.tree)) return sendError(res, 400, 'bad_request')
      const { tree, nameOverride, baseUpdatedAt, force } = body.value
      const index = await loadIndex(store)
      const entry = index.find((m) => m.id === id)
      if (entry && isTombstone(entry) && !force) return sendError(res, 409, 'deleted')
      if (!force && entry && entry.updatedAt > (baseUpdatedAt ?? 0)) {
        return sendJson(res, 409, { error: 'conflict', entry })
      }
      const now = nowFn()
      // ③ 版本快照：被替换的旧内容入版本（字节不等才留）
      const newJson = JSON.stringify(tree)
      const oldJson = await store.get(docKey(id))
      if (oldJson !== null) await snapshotOldContent(store, id, oldJson, newJson, now, minGapMs)
      await store.put(docKey(id), newJson)
      if (entry) {
        entry.updatedAt = now
        if (typeof nameOverride === 'string' && nameOverride.trim() !== '') entry.nameOverride = nameOverride.trim()
        else if (nameOverride === null) entry.nameOverride = null
        if (force) entry.deletedAt = null // 复活：清墓碑
      } else {
        // 远端无条目 → 直接创建（忽略 base；spec §①）
        index.unshift({
          id,
          createdAt: now,
          updatedAt: now,
          nameOverride: typeof nameOverride === 'string' && nameOverride.trim() !== '' ? nameOverride.trim() : null,
        })
      }
      await saveIndex(store, index)
      return sendJson(res, 200, { index })
    }

    if (req.method === 'DELETE') {
      const index = await loadIndex(store)
      const entry = index.find((m) => m.id === id)
      // 幂等：远端从未有过该条目 → 原样返回（不为不存在的文档造墓碑）
      if (entry && !isTombstone(entry)) {
        entry.deletedAt = Date.now() // 墓碑由服务器打点；blob 留待 30 天清理
        await saveIndex(store, index)
      }
      return sendJson(res, 200, { index })
    }

    return sendError(res, 405, 'method_not_allowed')
  })
}

const VIEWS_PATH = /^\/api\/views\/([^/?]+)$/

/**
 * GET/PUT /api/views/:id —— 服务端打 updatedAt 存储并回传（客户端即得比较基线）。
 * 视图无条件写：LWW 由引擎按 StoredView.updatedAt 比较后决定推/拉（spec §①）。
 */
export function makeViewsHandler(store: BlobStore) {
  return guarded(async (req, res) => {
    if (!authOk(req, res)) return
    const id = pathCapture(req.url, VIEWS_PATH)
    if (id === null || !ID_RE.test(id)) return sendError(res, 400, 'bad_request')

    if (req.method === 'GET') {
      const raw = await store.get(viewKey(id))
      if (raw === null) return sendError(res, 404, 'not_found')
      return sendJson(res, 200, JSON.parse(raw))
    }

    if (req.method === 'PUT') {
      const body = await readJson(req)
      if (!body.ok) return sendError(res, 400, body.error)
      const v = body.value as Record<string, unknown>
      const okView =
        v && typeof v === 'object' &&
        typeof v.dx === 'number' && Number.isFinite(v.dx) &&
        typeof v.dy === 'number' && Number.isFinite(v.dy) &&
        typeof v.k === 'number' && Number.isFinite(v.k) && v.k > 0
      if (!okView) return sendError(res, 400, 'bad_request')
      if (v.drill !== undefined && !validDrillFrames(v.drill)) return sendError(res, 400, 'bad_request')
      if(v.coordinateVersion !== undefined && (v.coordinateVersion !== 2 || worldViewFields(v).coordinateVersion !== 2 || v.extents !== undefined && (!v.extents || typeof v.extents !== 'object' || Array.isArray(v.extents) || !Object.values(v.extents).every(validExtent)))) return sendError(res,400,'bad_request')
      const stored = { ...worldViewFields(v), dx: v.dx as number, dy: v.dy as number, k: v.k as number, ...(validDrillFrames(v.drill) ? { drill: v.drill } : {}), updatedAt: Date.now() }
      await store.put(viewKey(id), JSON.stringify(stored))
      return sendJson(res, 200, stored)
    }

    return sendError(res, 405, 'method_not_allowed')
  })
}

const VERSIONS_PATH = /^\/api\/docs\/([^/?]+)\/versions$/
const VERSION_ONE_PATH = /^\/api\/docs\/([^/?]+)\/versions\/([^/?]+)$/

/**
 * GET /api/docs/:id/versions → {versions:[savedAt…]} 新→旧；
 * GET /api/docs/:id/versions/:savedAt → {savedAt, tree}；无版本 404。
 * 只读端点：版本历史不参与合并，故无 PUT/DELETE（spec §①）。
 */
export function makeVersionsHandler(store: BlobStore) {
  return guarded(async (req, res) => {
    if (!authOk(req, res)) return
    if (req.method !== 'GET') return sendError(res, 405, 'method_not_allowed')

    const one = VERSION_ONE_PATH.exec((req.url ?? '').split('?')[0])
    if (one) {
      const [, id, savedAtRaw] = one
      if (!ID_RE.test(id) || !/^\d+$/.test(savedAtRaw)) return sendError(res, 400, 'bad_request')
      const raw = await store.get(versionKey(id, Number(savedAtRaw)))
      if (raw === null) return sendError(res, 404, 'not_found')
      return sendJson(res, 200, JSON.parse(raw))
    }

    const id = pathCapture(req.url, VERSIONS_PATH)
    if (id === null || !ID_RE.test(id)) return sendError(res, 400, 'bad_request')
    const stamps = await listVersionStamps(store, id)
    return sendJson(res, 200, { versions: stamps.reverse() }) // 新→旧
  })
}
