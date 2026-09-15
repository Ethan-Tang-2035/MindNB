/**
 * GET/PUT /api/index —— 索引往返（票 04；spec §①）。
 * 注意：Vercel 把本文件同时挂在 /api 与 /api/index；客户端统一走 /api/index。
 */
import { vercelStore } from '../server/blob-store.ts'
import { makeIndexHandler } from '../server/handlers.ts'
import type { HttpReq } from '../server/http.ts'
import type { ResLike } from '../server/auth.ts'

const handler = makeIndexHandler(vercelStore)

export default function index(req: HttpReq, res: ResLike): Promise<void> {
  return handler(req, res)
}
