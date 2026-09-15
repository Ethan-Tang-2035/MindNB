/**
 * GET /api/docs/:id/versions/:savedAt —— 单个版本内容（票 06）。
 */
import { vercelStore } from '../../../../server/blob-store.ts'
import { makeVersionsHandler } from '../../../../server/handlers.ts'
import type { HttpReq } from '../../../../server/http.ts'
import type { ResLike } from '../../../../server/auth.ts'

const handler = makeVersionsHandler(vercelStore)

export default function versionOne(req: HttpReq, res: ResLike): Promise<void> {
  return handler(req, res)
}
