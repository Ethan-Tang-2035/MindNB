import { withLegacyReads } from '../server/brand-migration.ts'
/**
 * MINDNB_REMOTE 本地 shim —— 无 Vercel 账号也能全链路验证（票 04 冒烟、票 08 走查）：
 * FileBlobStore（磁盘目录顶替 Blob store）+ 与生产同一份 server/handlers.ts。
 * 只在 `MINDNB_REMOTE=1 npm run dev` 时挂载；纯 `npm run dev` 无 /api → 引擎 fail-soft（spec §②）。
 */
import ping from '../api/ping.ts'
import { makeIndexHandler, makeDocsHandler, makeViewsHandler, makeVersionsHandler } from '../server/handlers.ts'
import { FileBlobStore } from '../server/local-store.ts'
import { sendError } from '../server/auth.ts'
import type { HttpReq } from '../server/http.ts'

export interface RemoteMiddleware {
  (req: HttpReq, res: Parameters<ReturnType<typeof makeIndexHandler>>[1], next: () => void): void
}

export function createRemoteMiddleware(dir: string): RemoteMiddleware {
  const store = withLegacyReads(new FileBlobStore(dir))
  const index = makeIndexHandler(store)
  const docs = makeDocsHandler(store)
  const views = makeViewsHandler(store)
  const versions = makeVersionsHandler(store)
  return (req, res, next) => {
    const path = (req.url ?? '').split('?')[0]
    let call: ((r: HttpReq, s: typeof res) => Promise<void>) | null = null
    if (path === '/api/ping') call = (r, s) => Promise.resolve(ping(r, s))
    else if (path === '/api/index' || path === '/api') call = index
    // 宽松匹配路径段：id 合法性交 handler 校验（与 Vercel 动态路由行为一致：坏 id → 400 而非 SPA 回退）
    else if (/^\/api\/docs\/[^/]+\/versions(\/[^/]+)?$/.test(path)) call = versions
    else if (/^\/api\/docs\/[^/]+$/.test(path)) call = docs
    else if (/^\/api\/views\/[^/]+$/.test(path)) call = views
    if (!call) return next()
    void call(req, res).catch(() => sendError(res, 500, 'internal'))
  }
}
