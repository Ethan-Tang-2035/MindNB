/**
 * GET/PUT/DELETE /api/docs/:id —— 文档条件写（票 04；spec §① 服务端流程）。
 * id 校验与全部业务语义在 server/handlers.ts（与本地 shim、单测共用一份实现）。
 */
import { vercelStore } from '../../server/blob-store.ts'
import { makeDocsHandler } from '../../server/handlers.ts'
import type { HttpReq } from '../../server/http.ts'
import type { ResLike } from '../../server/auth.ts'

const handler = makeDocsHandler(vercelStore)

export default function docs(req: HttpReq, res: ResLike): Promise<void> {
  return handler(req, res)
}