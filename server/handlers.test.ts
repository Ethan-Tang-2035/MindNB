/**
 * API Routes handler 单测（票 04）：MemoryBlobStore + 手写 req/res，不经网络与真实 Blob。
 * 覆盖 spec §①：index 往返与合并、docs 条件写四路（创建/冲突/墓碑/复活）、views 打点、
 * 鉴权三态、id/JSON 体校验。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeIndexHandler, makeDocsHandler, makeViewsHandler, makeVersionsHandler } from './handlers'
import { MemoryBlobStore } from './local-store'
import { docKey, INDEX_KEY, viewKey, type DocMeta } from '../src/docs'
import type { ResLike } from './auth'
import type { HttpReq } from './http'

/** 测试专用 dev 口令，非真实密码 */
const KEY = 'test-access-key'
const AUTH = { authorization: 'Bearer ' + KEY }
let savedKey: string | undefined

beforeEach(() => {
  savedKey = process.env.MINDNB_ACCESS_KEY
  process.env.MINDNB_ACCESS_KEY = KEY
})
afterEach(() => {
  if (savedKey === undefined) delete process.env.MINDNB_ACCESS_KEY
  else process.env.MINDNB_ACCESS_KEY = savedKey
})

class FakeRes implements ResLike {
  statusCode = 0
  headers: Record<string, string> = {}
  body = ''
  setHeader(name: string, value: string): void {
    this.headers[name] = value
  }
  end(chunk?: string): void {
    this.body = chunk ?? ''
  }
  get json(): unknown {
    return JSON.parse(this.body)
  }
}

function makeReq(method: string, url: string, opts: { auth?: boolean; json?: unknown; raw?: Uint8Array } = {}): HttpReq {
  const chunks: Uint8Array[] = []
  if (opts.json !== undefined) chunks.push(new TextEncoder().encode(JSON.stringify(opts.json)))
  if (opts.raw) chunks.push(opts.raw)
  const headers = opts.auth === false ? {} : AUTH
  return {
    method,
    url,
    headers,
    [Symbol.asyncIterator]() {
      let i = 0
      return {
        next: async (): Promise<IteratorResult<Uint8Array>> =>
          i < chunks.length ? { value: chunks[i++], done: false } : { value: undefined as never, done: true },
      }
    },
  } as HttpReq & AsyncIterable<Uint8Array>
}

const tree = { root: { id: 'r', text: '中心主题', seed: 1, children: [] } }
const meta = (id: string, updatedAt: number, extra: Partial<DocMeta> = {}): DocMeta => ({
  id,
  createdAt: 1,
  updatedAt,
  nameOverride: null,
  ...extra,
})

async function call(handler: (req: HttpReq, res: ResLike) => Promise<void>, req: HttpReq): Promise<FakeRes> {
  const res = new FakeRes()
  await handler(req, res)
  return res
}

describe('鉴权三态（全部路由共用 server/auth.ts）', () => {
  const routes: Array<[string, (s: MemoryBlobStore) => (req: HttpReq, res: ResLike) => Promise<void>, HttpReq]> = [
    ['index', makeIndexHandler, makeReq('GET', '/api/index', { auth: false })],
    ['docs', makeDocsHandler, makeReq('GET', '/api/docs/d1', { auth: false })],
    ['views', makeViewsHandler, makeReq('PUT', '/api/views/d1', { auth: false, json: { dx: 0, dy: 0, k: 1 } })],
    ['versions', makeVersionsHandler, makeReq('GET', '/api/docs/d1/versions', { auth: false })],
  ]
  it.each(routes)('%s：缺 Authorization → 401', async (_label, mk, req) => {
    const res = await call(mk(new MemoryBlobStore()), req)
    expect(res.statusCode).toBe(401)
    expect(res.json).toEqual({ error: 'unauthorized' })
  })
  it.each(routes)('%s：错密码 → 401', async (_label, mk, req) => {
    const bad = { ...req, headers: { authorization: 'Bearer wrong-' + KEY } }
    const res = await call(mk(new MemoryBlobStore()), bad)
    expect(res.statusCode).toBe(401)
  })
  it('缺 MINDNB_ACCESS_KEY → 500 server_not_configured（判定优先于 401）', async () => {
    delete process.env.MINDNB_ACCESS_KEY
    const res = await call(makeIndexHandler(new MemoryBlobStore()), makeReq('GET', '/api/index', { auth: false }))
    expect(res.statusCode).toBe(500)
    expect(res.json).toEqual({ error: 'server_not_configured' })
  })
})

describe('GET/PUT /api/index', () => {
  it('空远端 GET → {index: []}', async () => {
    const res = await call(makeIndexHandler(new MemoryBlobStore()), makeReq('GET', '/api/index'))
    expect(res.statusCode).toBe(200)
    expect(res.json).toEqual({ index: [] })
  })
  it('PUT 逐 id 保留较新（调用共享 index-merge）并回全量', async () => {
    const store = new MemoryBlobStore()
    await store.put(INDEX_KEY, JSON.stringify([meta('a', 10), meta('b', 20)]))
    const res = await call(makeIndexHandler(store), makeReq('PUT', '/api/index', { json: { entries: [meta('a', 5), meta('c', 30)] } }))
    const index = (res.json as { index: DocMeta[] }).index
    expect(index.find((m) => m.id === 'a')?.updatedAt).toBe(10) // base 较新保 base
    expect(index.find((m) => m.id === 'c')?.updatedAt).toBe(30)
  })
  it('超 30 天墓碑：条目清除且 doc/view blob 同轮删除', async () => {
    const store = new MemoryBlobStore()
    const old = Date.now() - 31 * 24 * 60 * 60_000
    await store.put(INDEX_KEY, JSON.stringify([meta('gone', old, { deletedAt: old })]))
    await store.put(docKey('gone'), 'x')
    await store.put(viewKey('gone'), 'y')
    const res = await call(makeIndexHandler(store), makeReq('PUT', '/api/index', { json: { entries: [meta('keep', 1)] } }))
    expect((res.json as { index: DocMeta[] }).index.map((m) => m.id)).toEqual(['keep'])
    expect(await store.get(docKey('gone'))).toBeNull()
    expect(await store.get(viewKey('gone'))).toBeNull()
  })
  it('entries 非法（缺 updatedAt）→ 400', async () => {
    const res = await call(makeIndexHandler(new MemoryBlobStore()), makeReq('PUT', '/api/index', { json: { entries: [{ id: 'a' }] } }))
    expect(res.statusCode).toBe(400)
  })
})

describe('PUT /api/docs/:id 条件写', () => {
  it('远端无条目 → 直接创建（忽略 base），索引置顶', async () => {
    const store = new MemoryBlobStore()
    const res = await call(makeDocsHandler(store), makeReq('PUT', '/api/docs/d1', { json: { tree, baseUpdatedAt: 999 } }))
    expect(res.statusCode).toBe(200)
    const index = (res.json as { index: DocMeta[] }).index
    expect(index).toHaveLength(1)
    expect(index[0].id).toBe('d1')
    expect(await store.get(docKey('d1'))).toBe(JSON.stringify(tree))
  })
  it('远端较新 → 409 conflict 带远端条目', async () => {
    const store = new MemoryBlobStore()
    await store.put(INDEX_KEY, JSON.stringify([meta('d1', 100)]))
    const res = await call(makeDocsHandler(store), makeReq('PUT', '/api/docs/d1', { json: { tree, baseUpdatedAt: 50 } }))
    expect(res.statusCode).toBe(409)
    expect(res.json).toMatchObject({ error: 'conflict', entry: { id: 'd1', updatedAt: 100 } })
    expect(await store.get(docKey('d1'))).toBeNull() // 冲突写不落
  })
  it('baseUpdatedAt 缺省按 0；平手（=远端）放行', async () => {
    const store = new MemoryBlobStore()
    await store.put(INDEX_KEY, JSON.stringify([meta('d1', 100)]))
    const res = await call(makeDocsHandler(store), makeReq('PUT', '/api/docs/d1', { json: { tree } }))
    expect(res.statusCode).toBe(409) // 缺省 0 < 100 → 冲突
    const res2 = await call(makeDocsHandler(store), makeReq('PUT', '/api/docs/d1', { json: { tree, baseUpdatedAt: 100 } }))
    expect(res2.statusCode).toBe(200) // 平手放行
    const index = (res2.json as { index: DocMeta[] }).index
    expect(index[0].updatedAt).toBeGreaterThan(100) // 服务器打点
  })
  it('改名走 nameOverride', async () => {
    const store = new MemoryBlobStore()
    const h = makeDocsHandler(store)
    await call(h, makeReq('PUT', '/api/docs/d1', { json: { tree } }))
    const res = await call(h, makeReq('PUT', '/api/docs/d1', { json: { tree, nameOverride: '新名字', baseUpdatedAt: (await loadMeta(store, 'd1')).updatedAt } }))
    expect(((res.json as { index: DocMeta[] }).index)[0].nameOverride).toBe('新名字')
  })
  it('删除打墓碑 → 再 PUT 得 409 deleted → force 复活清墓碑', async () => {
    const store = new MemoryBlobStore()
    const h = makeDocsHandler(store)
    await call(h, makeReq('PUT', '/api/docs/d1', { json: { tree } }))
    const del = await call(h, makeReq('DELETE', '/api/docs/d1'))
    expect(del.statusCode).toBe(200)
    const tomb = ((del.json as { index: DocMeta[] }).index)[0]
    expect(typeof tomb.deletedAt).toBe('number')
    expect(await store.get(docKey('d1'))).not.toBeNull() // blob 留待 30 天清理
    const blocked = await call(h, makeReq('PUT', '/api/docs/d1', { json: { tree, baseUpdatedAt: tomb.updatedAt } }))
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json).toEqual({ error: 'deleted' })
    const revived = await call(h, makeReq('PUT', '/api/docs/d1', { json: { tree, force: true } }))
    expect(revived.statusCode).toBe(200)
    expect(((revived.json as { index: DocMeta[] }).index)[0].deletedAt).toBeNull()
  })
  it('DELETE 幂等：未知 id 原样返回索引，不造墓碑', async () => {
    const res = await call(makeDocsHandler(new MemoryBlobStore()), makeReq('DELETE', '/api/docs/nope'))
    expect(res.statusCode).toBe(200)
    expect((res.json as { index: DocMeta[] }).index).toEqual([])
  })
  it('GET：命中 → {tree}；未知 → 404', async () => {
    const store = new MemoryBlobStore()
    const h = makeDocsHandler(store)
    expect((await call(h, makeReq('GET', '/api/docs/d1'))).statusCode).toBe(404)
    await call(h, makeReq('PUT', '/api/docs/d1', { json: { tree } }))
    expect((await call(h, makeReq('GET', '/api/docs/d1'))).json).toEqual({ tree })
  })
})

async function loadMeta(store: MemoryBlobStore, id: string): Promise<DocMeta> {
  const index = JSON.parse((await store.get(INDEX_KEY))!) as DocMeta[]
  return index.find((m) => m.id === id)!
}

describe('请求校验（spec §①）', () => {
  it('id 不匹配 [\\w-]+ → 400', async () => {
    const res = await call(makeDocsHandler(new MemoryBlobStore()), makeReq('GET', '/api/docs/bad.id%20x'))
    expect(res.statusCode).toBe(400)
  })
  it('JSON 体超 5MB → 400', async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 10)
    const res = await call(makeDocsHandler(new MemoryBlobStore()), makeReq('PUT', '/api/docs/d1', { raw: big }))
    expect(res.statusCode).toBe(400)
    expect(res.json).toEqual({ error: 'too_large' })
  })
  it('非法 JSON → 400 bad_json；坏树 → 400 bad_request', async () => {
    const h = makeDocsHandler(new MemoryBlobStore())
    expect((await call(h, makeReq('PUT', '/api/docs/d1', { raw: new TextEncoder().encode('{nope') }))).json).toEqual({ error: 'bad_json' })
    expect((await call(h, makeReq('PUT', '/api/docs/d1', { json: { tree: { root: { id: 1 } } } }))).statusCode).toBe(400)
  })
  it('未知方法 → 405', async () => {
    expect((await call(makeIndexHandler(new MemoryBlobStore()), makeReq('POST', '/api/index'))).statusCode).toBe(405)
  })
})

describe('GET/PUT /api/views/:id', () => {
  it('round trips stable world views and rejects inverted extents',async()=>{
    const h=makeViewsHandler(new MemoryBlobStore()),view={dx:0,dy:0,k:1,coordinateVersion:2,tx:20,ty:-30,extents:{document:{minX:-480,minY:0,maxX:1800,maxY:800}}}
    const put=await call(h,makeReq('PUT','/api/views/d1',{json:view}));expect(put.statusCode).toBe(200);expect(put.json).toMatchObject(view)
    expect((await call(h,makeReq('GET','/api/views/d1'))).json).toMatchObject(view)
    expect((await call(h,makeReq('PUT','/api/views/d1',{json:{...view,extents:{document:{minX:5,minY:0,maxX:0,maxY:800}}}}))).statusCode).toBe(400)
  })

  it('preserves validated v10 drill frames across devices and rejects malformed paths', async () => {
    const h = makeViewsHandler(new MemoryBlobStore())
    const drill = [{ id: 'a', view: { tx: 10, ty: 20, k: .8 }, selection: { ids: ['a'], primary: 'a' } }]
    const put = await call(h, makeReq('PUT', '/api/views/d1', { json: { dx: 0, dy: 0, k: 1, drill } }))
    expect(put.statusCode).toBe(200)
    expect(put.json).toMatchObject({ drill })
    expect((await call(h, makeReq('GET', '/api/views/d1'))).json).toMatchObject({ drill })
    expect((await call(h, makeReq('PUT', '/api/views/d1', { json: { dx: 0, dy: 0, k: 1, drill: [{}] } }))).statusCode).toBe(400)
  })
  it('PUT 返回带服务端 updatedAt 的 StoredView；GET 同形', async () => {
    const store = new MemoryBlobStore()
    const h = makeViewsHandler(store)
    const put = await call(h, makeReq('PUT', '/api/views/d1', { json: { dx: 10, dy: -4, k: 1.5 } }))
    expect(put.statusCode).toBe(200)
    expect(put.json).toMatchObject({ dx: 10, dy: -4, k: 1.5 })
    expect(typeof (put.json as { updatedAt?: number }).updatedAt).toBe('number')
    const get = await call(h, makeReq('GET', '/api/views/d1'))
    expect(get.json).toEqual(put.json)
  })
  it('GET 未知 → 404；非法视图（k≤0 / 缺字段）→ 400', async () => {
    const h = makeViewsHandler(new MemoryBlobStore())
    expect((await call(h, makeReq('GET', '/api/views/nope'))).statusCode).toBe(404)
    expect((await call(h, makeReq('PUT', '/api/views/d1', { json: { dx: 0, dy: 0, k: 0 } }))).statusCode).toBe(400)
    expect((await call(h, makeReq('PUT', '/api/views/d1', { json: { dx: 0, dy: 0 } }))).statusCode).toBe(400)
  })
})

describe('版本历史（票 06：服务端快照 + 只读端点）', () => {
  const T1 = 1_000_000
  const GAP = 6 * 60_000 // 超过 5 分钟最小间隔
  const treeV = (t: string) => ({ root: { id: 'r', text: t, seed: 1, children: [] } })

  /** 依次在 T1、T1+GAP、… 保存 v1..vn，返回 store 与 docs handler */
  async function saveSeries(store: MemoryBlobStore, n: number, start = 1) {
    let clock = T1 + (start - 1) * GAP
    const docs = makeDocsHandler(store, { now: () => clock })
    for (let i = start; i <= n; i++) {
      const res = await call(docs, makeReq('PUT', '/api/docs/d1', {
        json: { tree: treeV('v' + i), baseUpdatedAt: clock - 1 },
      }))
      expect(res.statusCode).toBe(200)
      clock += GAP
    }
    return docs
  }

  it('第二次保存 → 被替换的旧内容入版本；列表新→旧、单条可取', async () => {
    const store = new MemoryBlobStore()
    await saveSeries(store, 2)
    const h = makeVersionsHandler(store)
    const list = await call(h, makeReq('GET', '/api/docs/d1/versions'))
    expect(list.json).toEqual({ versions: [T1 + GAP] }) // 第二次写入时刻为锚点
    const one = await call(h, makeReq('GET', '/api/docs/d1/versions/' + (T1 + GAP)))
    expect((one.json as { tree: { root: { text: string } } }).tree.root.text).toBe('v1') // 旧内容
    expect((one.json as { savedAt: number }).savedAt).toBe(T1 + GAP)
  })
  it('字节相等的保存不产生版本（无伪版本）', async () => {
    const store = new MemoryBlobStore()
    let clock = T1
    const docs = makeDocsHandler(store, { now: () => clock })
    await call(docs, makeReq('PUT', '/api/docs/d1', { json: { tree: treeV('v1') } }))
    clock = T1 + GAP
    await call(docs, makeReq('PUT', '/api/docs/d1', { json: { tree: treeV('v1'), baseUpdatedAt: T1 } }))
    const list = await call(makeVersionsHandler(store), makeReq('GET', '/api/docs/d1/versions'))
    expect(list.json).toEqual({ versions: [] })
  })
  it('最小间隔内的再保存 → 原地覆写：锚点不变、内容换成最新被替换的旧版', async () => {
    const store = new MemoryBlobStore()
    let clock = T1
    const docs = makeDocsHandler(store, { now: () => clock })
    await call(docs, makeReq('PUT', '/api/docs/d1', { json: { tree: treeV('v1') } }))
    clock = T1 + GAP // v1 → 版本@T1+GAP
    await call(docs, makeReq('PUT', '/api/docs/d1', { json: { tree: treeV('v2'), baseUpdatedAt: T1 } }))
    clock = T1 + GAP + 60_000 // 距锚点 1 分钟 < 5 分钟 → 覆写
    await call(docs, makeReq('PUT', '/api/docs/d1', { json: { tree: treeV('v3'), baseUpdatedAt: T1 + GAP } }))
    const h = makeVersionsHandler(store)
    const list = await call(h, makeReq('GET', '/api/docs/d1/versions'))
    expect(list.json).toEqual({ versions: [T1 + GAP] })
    const one = await call(h, makeReq('GET', '/api/docs/d1/versions/' + (T1 + GAP)))
    expect((one.json as { tree: { root: { text: string } } }).tree.root.text).toBe('v2')
  })
  it('keep-10：12 次间隔保存后只留最近 10 份，最旧被删', async () => {
    const store = new MemoryBlobStore()
    await saveSeries(store, 12)
    const list = await call(makeVersionsHandler(store), makeReq('GET', '/api/docs/d1/versions'))
    const versions = (list.json as { versions: number[] }).versions
    expect(versions).toHaveLength(10)
    expect(versions[0]).toBe(T1 + 11 * GAP) // 新→旧
    expect(versions[9]).toBe(T1 + 2 * GAP) // v1、v2 对应的最旧两份已删
    const gone = await call(makeVersionsHandler(store), makeReq('GET', '/api/docs/d1/versions/' + (T1 + GAP)))
    expect(gone.statusCode).toBe(404)
  })
  it('端点校验：坏 id → 400；savedAt 非数字 → 400；PUT → 405；从未有版本的文档 → 空列表', async () => {
    const store = new MemoryBlobStore()
    const h = makeVersionsHandler(store)
    expect((await call(h, makeReq('GET', '/api/docs/bad.id/versions'))).statusCode).toBe(400)
    expect((await call(h, makeReq('GET', '/api/docs/d1/versions/abc'))).statusCode).toBe(400)
    expect((await call(h, makeReq('PUT', '/api/docs/d1/versions', { json: {} }))).statusCode).toBe(405)
    const empty = await call(h, makeReq('GET', '/api/docs/d1/versions'))
    expect(empty.json).toEqual({ versions: [] })
  })
  it('复活路径：force 覆盖墓碑时旧内容（删除前版本）也入快照', async () => {
    const store = new MemoryBlobStore()
    let clock = T1
    const docs = makeDocsHandler(store, { now: () => clock })
    await call(docs, makeReq('PUT', '/api/docs/d1', { json: { tree: treeV('v1') } }))
    await call(docs, makeReq('DELETE', '/api/docs/d1'))
    clock = T1 + GAP
    const revive = await call(docs, makeReq('PUT', '/api/docs/d1', { json: { tree: treeV('v2'), force: true } }))
    expect(revive.statusCode).toBe(200)
    const list = await call(makeVersionsHandler(store), makeReq('GET', '/api/docs/d1/versions'))
    expect((list.json as { versions: number[] }).versions).toEqual([T1 + GAP])
  })
})
