import { LEGACY_BRAND } from '../src/legacy-brand.ts'
/**
 * API Routes 共享鉴权地基 —— spec §①「统一约定」的唯一实现（票 04 的全部路由复用本模块）。
 * 放在 api/ 之外：Vercel 把 api/ 下每个文件都注册为函数，helper 混入会变成幽灵端点。
 * 词汇见 CONTEXT.md（访问密码）。
 */
import { createHash, timingSafeEqual } from 'node:crypto'

/** Vercel Node runtime req 的最小形状（只声明本项目用到的部分，免装 @vercel/node） */
export interface ReqLike {
  headers: Record<string, string | string[] | undefined>
}

/** Vercel Node runtime res 的最小形状 */
export interface ResLike {
  statusCode: number
  setHeader(name: string, value: string): void
  end(chunk?: string): void
}

export type AuthVerdict = 'ok' | 'unauthorized' | 'not_configured'

/** 从 Authorization 头提取 Bearer token；缺头或 scheme 不符返回 null（scheme 大小写不敏感） */
export function bearerToken(header: string | string[] | undefined): string | null {
  const raw = Array.isArray(header) ? header[0] : header
  if (!raw) return null
  const m = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(raw.trim())
  return m ? m[1] : null
}

/** 时序安全比较：两侧先 SHA-256 定长再 timingSafeEqual——长度不等不抛错，也不泄漏口令长度 */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(
    createHash('sha256').update(a, 'utf8').digest(),
    createHash('sha256').update(b, 'utf8').digest(),
  )
}

/**
 * 三态鉴权判定。缺 env 优先于 401：服务器无从校验任何口令属服务端配置问题（500），
 * 不该伪装成「密码错」误导用户改密码。
 */
export function checkAccess(req: ReqLike): AuthVerdict {
  const key = process.env.MINDNB_ACCESS_KEY ?? process.env[LEGACY_BRAND.accessKeyEnv]
  if (!key) return 'not_configured'
  const token = bearerToken(req.headers.authorization)
  if (token === null) return 'unauthorized'
  return safeEqual(token, key) ? 'ok' : 'unauthorized'
}

export function sendNoContent(res: ResLike): void {
  res.statusCode = 204
  res.end()
}

export function sendError(res: ResLike, status: number, error: string): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify({ error }))
}

export function sendJson(res: ResLike, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}
