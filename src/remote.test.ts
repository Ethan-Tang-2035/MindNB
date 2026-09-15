/**
 * remote 客户端单测（票 03）：错误三型 + ping 分类 + 头/体约定。全部注入 fake fetch，不经真实网络。
 */
import { describe, it, expect } from 'vitest'
import { createRemote, AuthError, ConflictError, NetworkError, type PutDocBody } from './remote.ts'
import type { DocMeta } from './docs.ts'

type Call = { url: string; init: RequestInit }

function fakeFetch(reply: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = []
  const impl = async (url: unknown, init: RequestInit = {}) => {
    const call = { url: String(url), init }
    calls.push(call)
    return reply(call)
  }
  return { impl: impl as unknown as typeof globalThis.fetch, calls }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const meta: DocMeta = { id: 'd1', createdAt: 1, updatedAt: 5, nameOverride: null }

describe('createRemote：Authorization 附带', () => {
  it('有密码 → 每请求带 Bearer 头', async () => {
    const { impl, calls } = fakeFetch(() => json({ index: [] }))
    const remote = createRemote({ fetchImpl: impl, password: () => 'sekret' })
    await remote.getIndex()
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer sekret')
  })
  it('无密码 → 不带 Authorization 头', async () => {
    const { impl, calls } = fakeFetch(() => json({ index: [] }))
    const remote = createRemote({ fetchImpl: impl, password: () => null })
    await remote.getIndex()
    expect(calls[0].init.headers).not.toHaveProperty('Authorization')
  })
})

describe('createRemote：错误三型', () => {
  it('401 → AuthError', async () => {
    const { impl } = fakeFetch(() => json({ error: 'unauthorized' }, 401))
    const remote = createRemote({ fetchImpl: impl, password: () => 'x' })
    await expect(remote.getIndex()).rejects.toBeInstanceOf(AuthError)
  })
  it('409 conflict → ConflictError(entry) 带远端条目', async () => {
    const remoteEntry = { ...meta, updatedAt: 99 }
    const { impl } = fakeFetch(() => json({ error: 'conflict', entry: remoteEntry }, 409))
    const remote = createRemote({ fetchImpl: impl, password: () => 'x' })
    const body: PutDocBody = { tree: { root: { id: 'r', text: 't', seed: 1, children: [] } } as never, baseUpdatedAt: 5 }
    await expect(remote.putDoc('d1', body)).rejects.toMatchObject({
      name: 'ConflictError',
      kind: 'entry',
      entry: remoteEntry,
    })
  })
  it('409 deleted → ConflictError(deleted)', async () => {
    const { impl } = fakeFetch(() => json({ error: 'deleted' }, 409))
    const remote = createRemote({ fetchImpl: impl, password: () => 'x' })
    const p = remote.putDoc('d1', { tree: {} as never })
    await expect(p).rejects.toBeInstanceOf(ConflictError)
    await remote.putDoc('d1', { tree: {} as never }).catch((e: ConflictError) => {
      expect(e.kind).toBe('deleted')
      expect(e.entry).toBeNull()
    })
  })
  it('fetch 抛错 → NetworkError（网络失败 ≠ 401）', async () => {
    const { impl } = fakeFetch(() => {
      throw new TypeError('Failed to fetch')
    })
    const remote = createRemote({ fetchImpl: impl, password: () => 'x' })
    await expect(remote.getIndex()).rejects.toBeInstanceOf(NetworkError)
  })
  it('500 server_not_configured → NetworkError（不是密码错）', async () => {
    const { impl } = fakeFetch(() => json({ error: 'server_not_configured' }, 500))
    const remote = createRemote({ fetchImpl: impl, password: () => 'x' })
    await expect(remote.getIndex()).rejects.toBeInstanceOf(NetworkError)
  })
})

describe('createRemote：端点往返形状', () => {
  it('GET doc 404 → null；200 → tree', async () => {
    let found = false
    const { impl } = fakeFetch(() => (found ? json({ tree: { root: { id: 'r' } } }) : new Response(null, { status: 404 })))
    const remote = createRemote({ fetchImpl: impl, password: () => 'x' })
    expect(await remote.getDoc('nope')).toBeNull()
    found = true
    expect(await remote.getDoc('d1')).toEqual({ root: { id: 'r' } })
  })
  it('PUT doc 成功 → 回包 index；JSON 体带 baseUpdatedAt/force', async () => {
    const { impl, calls } = fakeFetch(() => json({ index: [meta] }))
    const remote = createRemote({ fetchImpl: impl, password: () => 'x' })
    const out = await remote.putDoc('d1', { tree: { x: 1 } as never, baseUpdatedAt: 7, force: true })
    expect(out).toEqual([meta])
    expect(calls[0].url).toBe('/api/docs/d1')
    expect(calls[0].init.method).toBe('PUT')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ tree: { x: 1 }, baseUpdatedAt: 7, force: true })
    expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })
  it('DELETE doc → 回包 index', async () => {
    const { impl, calls } = fakeFetch(() => json({ index: [{ ...meta, deletedAt: 10 }] }))
    const remote = createRemote({ fetchImpl: impl, password: () => 'x' })
    const out = await remote.deleteDoc('d1')
    expect(out[0].deletedAt).toBe(10)
    expect(calls[0].init.method).toBe('DELETE')
  })
  it('PUT view → StoredView 原样回（服务端打点 updatedAt）；keepalive 透传', async () => {
    const { impl, calls } = fakeFetch(() => json({ dx: 1, dy: 2, k: 1.5, updatedAt: 77 }))
    const remote = createRemote({ fetchImpl: impl, password: () => 'x' })
    const v = await remote.putView('d1', { dx: 1, dy: 2, k: 1.5 }, { keepalive: true })
    expect(v).toEqual({ dx: 1, dy: 2, k: 1.5, updatedAt: 77 })
    expect(calls[0].init.keepalive).toBe(true)
  })
  it('GET index 空远端（404）→ []', async () => {
    const { impl } = fakeFetch(() => new Response(null, { status: 404 }))
    const remote = createRemote({ fetchImpl: impl, password: () => 'x' })
    expect(await remote.getIndex()).toEqual([])
  })
})

describe('ping：分类不抛错', () => {
  const cases: [Response | 'throw', string, 'ok' | 'unauthorized' | 'not_configured' | 'network' | 'absent'][] = [
    [new Response(null, { status: 204 }), '有密码', 'ok'],
    [json({ error: 'unauthorized' }, 401), '错密码', 'unauthorized'],
    [json({ error: 'server_not_configured' }, 500), '缺 env', 'not_configured'],
    [new Response('bad gateway', { status: 502 }), '代理 5xx', 'network'],
    [new Response('<!doctype html>', { status: 200 }), 'vite 无 /api', 'absent'],
    [new Response(null, { status: 404 }), '路由缺失', 'absent'],
    ['throw', '断网', 'network'],
  ]
  for (const [reply, label, want] of cases) {
    it(`${label} → ${want}`, async () => {
      const { impl } = fakeFetch(() => {
        if (reply === 'throw') throw new TypeError('down')
        return reply
      })
      const remote = createRemote({ fetchImpl: impl })
      expect(await remote.ping('pw')).toBe(want)
    })
  }
})
