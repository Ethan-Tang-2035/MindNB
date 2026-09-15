/**
 * API Routes 的 HTTP 小工具：请求体读取（5MB 上限）、JSON 解析、id 校验、路径提取。
 * req 形状对齐 Node IncomingMessage（AsyncIterable<Buffer>）：Vercel 函数与 vite 中间件通用；
 * 单测注入手写 async iterator（spec §①：JSON 体超 5MB → 400）。
 */
import type { ReqLike } from './auth.ts'

export const MAX_BODY_BYTES = 5 * 1024 * 1024

/** id 必须匹配 [\w-]+（与前端路由正则一致，spec §① 请求校验） */
export const ID_RE = /^[\w-]+$/

export interface HttpReq extends ReqLike {
  method?: string
  url?: string
}

/** 读满请求体；超上限返回 null（调用方回 400）。无体请求（GET/DELETE）返回空字节 */
export async function readBody(req: HttpReq): Promise<Uint8Array | null> {
  const it = (req as unknown as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]
  if (typeof it !== 'function') return new Uint8Array()
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const c of req as unknown as AsyncIterable<Uint8Array>) {
    const buf = c instanceof Uint8Array ? c : new Uint8Array(c as ArrayBuffer)
    size += buf.length
    if (size > MAX_BODY_BYTES) return null
    chunks.push(buf)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

export type JsonOutcome = { ok: true; value: unknown } | { ok: false; error: 'too_large' | 'bad_json' }

export async function readJson(req: HttpReq): Promise<JsonOutcome> {
  const raw = await readBody(req)
  if (raw === null) return { ok: false, error: 'too_large' }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(raw)) }
  } catch {
    return { ok: false, error: 'bad_json' }
  }
}

/** 从 url 提取路径段（去 query）；不匹配返回 null */
export function pathCapture(url: string | undefined, re: RegExp): string | null {
  const path = (url ?? '').split('?')[0]
  const m = re.exec(path)
  return m ? m[1] : null
}
