/**
 * GET /api/docs/:id/versions —— 版本 savedAt 列表（票 06）。
 * 与单条版本共用 server/handlers.ts 的 makeVersionsHandler（按 URL 分流）。
 */
import { vercelStore } from '../../../server/blob-store.ts'
import { makeVersionsHandler } from '../../../server/handlers.ts'
import type { HttpReq } from '../../../server/http.ts'
import type { ResLike } from '../../../server/auth.ts'

const handler = makeVersionsHandler(vercelStore)

export default function versions(req: HttpReq, res: ResLike): Promise<void> {
  return handler(req, res)
}
