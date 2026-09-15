/**
 * 远端调用客户端 —— spec §②。统一附带 Authorization（访问密码，词汇见 CONTEXT.md），
 * 错误收拢三型：AuthError（密码错/缺）/ ConflictError（条件写被拒）/ NetworkError（不可达）。
 * 「网络失败 ≠ 密码错误」的判定全押在这三型的区分上；单测注入 fake fetch，不经真实网络。
 */
import type { DocMeta, StoredView, ViewState } from './docs.ts'
import type { MindMap } from './model.ts'

/** 访问密码的本地存储 key（CONTEXT.md：存在浏览器里，换设备需重新输入） */
export const ACCESS_KEY_STORAGE = 'mindnb:access-key'

/** 密码错/缺 → 密码门挡住或清存储密码重弹门 */
export class AuthError extends Error {
  constructor(message = 'unauthorized') {
    super(message)
    this.name = 'AuthError'
  }
}

/** 条件写被拒（spec §①）：kind='entry' 远端较新（带远端条目）；'deleted' 文档已被他端删除 */
export class ConflictError extends Error {
  readonly kind: 'entry' | 'deleted'
  readonly entry: DocMeta | null
  constructor(kind: 'entry' | 'deleted', entry: DocMeta | null) {
    super(kind === 'deleted' ? 'remote deleted' : 'remote newer')
    this.name = 'ConflictError'
    this.kind = kind
    this.entry = entry
  }
}

/** 不可达 / 服务端未配置 / 意外状态：网络失败 ≠ 401，门据此放行离线缓存 */
export class NetworkError extends Error {
  constructor(message = 'network') {
    super(message)
    this.name = 'NetworkError'
  }
}

/** ping 的分类结果（探测永不抛错，分类交门决策） */
export type PingVerdict = 'ok' | 'unauthorized' | 'not_configured' | 'network' | 'absent'

export interface PutDocBody {
  tree: MindMap
  nameOverride?: string | null
  baseUpdatedAt?: number
  force?: boolean
}

export interface RemoteOptions {
  /** 单测注入；默认 globalThis.fetch */
  fetchImpl?: typeof globalThis.fetch
  /** API 前缀，默认 '/api' */
  base?: string
  /** 当前访问密码提供者（null = 未提供） */
  password?: () => string | null
}

export interface PushOptions {
  /** pagehide 兜底：浏览器保证请求活过页面卸载（载荷上限约 64KB，超限由调用方放弃） */
  keepalive?: boolean
}

export function createRemote(opts: RemoteOptions = {}) {
  const base = opts.base ?? '/api'
  const passwordOf = opts.password ?? (() => null)

  async function raw(path: string, init: RequestInit): Promise<Response> {
    const fetchImpl = opts.fetchImpl ?? globalThis.fetch
    if (typeof fetchImpl !== 'function') throw new NetworkError('fetch unavailable')
    try {
      return await fetchImpl(base + path, init)
    } catch (e) {
      throw new NetworkError(e instanceof Error ? e.message : String(e))
    }
  }

  function authHeaders(password: string | null, json: boolean): Record<string, string> {
    const h: Record<string, string> = {}
    if (password) h.Authorization = 'Bearer ' + password
    if (json) h['Content-Type'] = 'application/json'
    return h
  }

  /** 状态 → 错误三型的统一映射；404 交调用方按「远端没有」处理，其余非 2xx 一律抛 */
  async function guard(res: Response): Promise<'ok' | 'notfound'> {
    if (res.status === 401) throw new AuthError()
    if (res.status === 409) {
      const body = (await res.json().catch(() => null)) as { error?: string; entry?: DocMeta } | null
      if (body?.error === 'deleted') throw new ConflictError('deleted', null)
      throw new ConflictError('entry', body?.entry ?? null)
    }
    if (res.status === 404) return 'notfound'
    if (res.status === 500) throw new NetworkError('server_not_configured')
    if (!res.ok) throw new NetworkError('HTTP ' + res.status)
    return 'ok'
  }

  async function getJson<T>(path: string): Promise<T | null> {
    const res = await raw(path, { headers: authHeaders(passwordOf(), false) })
    if ((await guard(res)) === 'notfound') return null
    return (await res.json()) as T
  }

  async function sendJson<T>(method: 'PUT' | 'DELETE', path: string, body?: unknown, push?: PushOptions): Promise<T> {
    const res = await raw(path, {
      method,
      headers: authHeaders(passwordOf(), body !== undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
      keepalive: push?.keepalive,
    })
    await guard(res)
    return (await res.json()) as T
  }

  return {
    /** 密码门与重连探测（票 01 端点）：不抛错，返回分类 */
    async ping(password: string | null): Promise<PingVerdict> {
      try {
        const res = await raw('/ping', { headers: authHeaders(password, false) })
        if (res.status === 204) return 'ok'
        if (res.status === 401) return 'unauthorized'
        if (res.status >= 500) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null
          // 5xx 一律「远端不可用」：502/503 等代理错误不是「没有 /api」，绝不能当 absent 跳门
          return body?.error === 'server_not_configured' ? 'not_configured' : 'network'
        }
        // 404 / 200-HTML（vite dev 无 /api 的 SPA 回退）等：不是远端 API
        return 'absent'
      } catch {
        return 'network'
      }
    },

    /** GET /api/index → 全量索引（远端尚无索引 → []） */
    async getIndex(): Promise<DocMeta[]> {
      const j = await getJson<{ index: DocMeta[] }>('/index')
      return j?.index ?? []
    },

    /** PUT /api/index → 合并后全量索引（仅首连迁移批量并条目，服务端逐 id 保留较新） */
    async putIndex(entries: DocMeta[]): Promise<DocMeta[]> {
      const j = await sendJson<{ index: DocMeta[] }>('PUT', '/index', { entries })
      return j.index
    },

    async getDoc(id: string): Promise<MindMap | null> {
      const j = await getJson<{ tree: MindMap }>('/docs/' + id)
      return j?.tree ?? null
    },

    /** 条件写（spec §① 流程）：409 → ConflictError；成功 → 合并后全量索引 */
    async putDoc(id: string, body: PutDocBody, push?: PushOptions): Promise<DocMeta[]> {
      const j = await sendJson<{ index: DocMeta[] }>('PUT', '/docs/' + id, body, push)
      return j.index
    },

    /** 删除 = 索引打墓碑（幂等：已删再删仍 200） */
    async deleteDoc(id: string, push?: PushOptions): Promise<DocMeta[]> {
      const j = await sendJson<{ index: DocMeta[] }>('DELETE', '/docs/' + id, undefined, push)
      return j.index
    },

    /** PUT 视图 → 带服务端 updatedAt 的 StoredView（客户端即得比较基线） */
    async putView(id: string, view: ViewState, push?: PushOptions): Promise<StoredView> {
      return await sendJson<StoredView>('PUT', '/views/' + id, view, push)
    },

    async getView(id: string): Promise<StoredView | null> {
      return await getJson<StoredView>('/views/' + id)
    },

    /** 版本 savedAt 降序列表（票 06 端点） */
    async getVersions(id: string): Promise<number[]> {
      const j = await getJson<{ versions: number[] }>('/docs/' + id + '/versions')
      return j?.versions ?? []
    },

    async getVersion(id: string, savedAt: number): Promise<{ savedAt: number; tree: MindMap } | null> {
      return await getJson<{ savedAt: number; tree: MindMap }>('/docs/' + id + '/versions/' + savedAt)
    },
  }
}

export type RemoteClient = ReturnType<typeof createRemote>
