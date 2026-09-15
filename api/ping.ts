/**
 * GET /api/ping —— 鉴权基座三态（票 01；spec §①）。
 * 正确访问密码 → 204；错/缺 Authorization → 401；服务端缺 MINDNB_ACCESS_KEY → 500。
 * 密码门（票 03）与重连探测（票 05）都打这里。
 */
import { checkAccess, sendError, sendNoContent } from '../server/auth.ts'
import type { ReqLike, ResLike } from '../server/auth.ts'

export default function ping(req: ReqLike, res: ResLike): void {
  const verdict = checkAccess(req)
  if (verdict === 'not_configured') return sendError(res, 500, 'server_not_configured')
  if (verdict === 'unauthorized') return sendError(res, 401, 'unauthorized')
  return sendNoContent(res)
}
