import { withLegacyReads } from './brand-migration.ts'
/**
 * Blob 存储抽象 —— 服务端 handler 与远端存储的唯一接触面（spec §①、§⑥）。
 * 生产用 vercelStore（access:'private'，API Routes 是唯一入口）；
 * 单测与本地 shim（MINDNB_REMOTE vite 中间件）用 server/local-store.ts 的替身。
 * key 即 blob pathname，原样平移本地 localStorage 布局（spec「数据布局」）。
 */
import { get, put, del, list } from '@vercel/blob'

export interface BlobStore {
  /** 不存在 → null（不抛） */
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
  /** 幂等：不存在不抛 */
  del(key: string): Promise<void>
  /** 前缀下全部 key（顺序不保证，调用方自行排序） */
  list(prefix: string): Promise<string[]>
}

export const vercelStore: BlobStore = withLegacyReads({
  async get(key) {
    // useCache:false —— 线上实录：默认走 CDN 缓存，同 key 覆写后其他函数实例会读到旧版
    // （索引是读-改-写热键，条件写/墓碑判定依赖最新值）；直连 origin 保证强一致，代价是读略慢
    const res = await get(key, { access: 'private', useCache: false })
    if (!res || res.stream === null) return null
    return await new Response(res.stream).text()
  },
  async put(key, value) {
    await put(key, value, { access: 'private', addRandomSuffix: false, allowOverwrite: true })
  },
  async del(key) {
    try {
      await del(key)
    } catch (e) {
      // 删不存在的 key 视为幂等成功；其余错误上抛给 handler 转 500
      if (e instanceof Error && e.name === 'BlobNotFoundError') return
      throw e
    }
  },
  async list(prefix) {
    const keys: string[] = []
    let cursor: string | undefined
    do {
      const page = await list({ prefix, ...(cursor ? { cursor } : {}) })
      for (const b of page.blobs) keys.push(b.pathname)
      cursor = page.hasMore ? page.cursor : undefined
    } while (cursor)
    return keys
  },
})
