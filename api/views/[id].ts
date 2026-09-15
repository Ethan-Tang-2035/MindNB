/**
 * GET/PUT /api/views/:id —— 视图存储形态 + 服务端 updatedAt 打点（票 04；spec §①）。
 */
import { vercelStore } from '../../server/blob-store.ts'
import { makeViewsHandler } from '../../server/handlers.ts'
import type { HttpReq } from '../../server/http.ts'
import type { ResLike } from '../../server/auth.ts'

const handler = makeViewsHandler(vercelStore)

export default function views(req: HttpReq, res: ResLike): Promise<void> {
  return handler(req, res)
}