import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import ping from './ping'
import { bearerToken, safeEqual, type ReqLike, type ResLike } from '../server/auth'

/** 测试专用 dev 口令，非真实密码 */
const KEY = 'dev-access-key-1234'
let savedKey: string | undefined

beforeEach(() => {
  savedKey = process.env.MINDNB_ACCESS_KEY
  process.env.MINDNB_ACCESS_KEY = KEY
})
afterEach(() => {
  if (savedKey === undefined) delete process.env.MINDNB_ACCESS_KEY
  else process.env.MINDNB_ACCESS_KEY = savedKey
})

function reqWith(authorization?: string): ReqLike {
  return { headers: authorization === undefined ? {} : { authorization } }
}

function fakeRes(): ResLike & { statusCode: number; body?: string; header(name: string): string | undefined } {
  const headers: Record<string, string> = {}
  return {
    statusCode: 0,
    body: undefined,
    setHeader(name: string, value: string) { headers[name] = value },
    header(name: string) { return headers[name] },
    end(chunk?: string) { this.body = chunk },
  }
}

describe('GET /api/ping 三态', () => {
  it('正确密码 → 204，无响应体', () => {
    const res = fakeRes()
    ping(reqWith(`Bearer ${KEY}`), res)
    expect(res.statusCode).toBe(204)
    expect(res.body).toBeUndefined()
  })

  it('错密码 → 401 {error:"unauthorized"}', () => {
    const res = fakeRes()
    ping(reqWith('Bearer wrong-key'), res)
    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.body!)).toEqual({ error: 'unauthorized' })
  })

  it('缺 Authorization 头 → 401', () => {
    const res = fakeRes()
    ping(reqWith(), res)
    expect(res.statusCode).toBe(401)
  })

  it('非 Bearer scheme → 401（哪怕口令值正确）', () => {
    const res = fakeRes()
    ping(reqWith(`Basic ${KEY}`), res)
    expect(res.statusCode).toBe(401)
  })

  it('服务端缺 MINDNB_ACCESS_KEY → 500 server_not_configured（优先于 401）', () => {
    delete process.env.MINDNB_ACCESS_KEY
    const res = fakeRes()
    ping(reqWith(`Bearer ${KEY}`), res) // 即便带了「正确」口令
    expect(res.statusCode).toBe(500)
    expect(JSON.parse(res.body!)).toEqual({ error: 'server_not_configured' })
  })

  it('MINDNB_ACCESS_KEY 为空串 → 等同缺失（500），空串不接受为口令', () => {
    process.env.MINDNB_ACCESS_KEY = ''
    const res = fakeRes()
    ping(reqWith('Bearer '), res)
    expect(res.statusCode).toBe(500)
  })

  it('500/401 响应带 JSON Content-Type', () => {
    const res = fakeRes()
    ping(reqWith('Bearer nope'), res)
    expect(res.header('Content-Type')).toContain('application/json')
  })
})

describe('bearerToken 解析', () => {
  it('Bearer 前缀大小写不敏感，取回 token', () => {
    expect(bearerToken(`Bearer ${KEY}`)).toBe(KEY)
    expect(bearerToken(`bearer ${KEY}`)).toBe(KEY)
    expect(bearerToken(`  BEARER  ${KEY}  `)).toBe(KEY)
  })
  it('缺头 / 空串 / 无 token / 非 Bearer / 数组空元素 → null', () => {
    expect(bearerToken(undefined)).toBeNull()
    expect(bearerToken('')).toBeNull()
    expect(bearerToken('Bearer')).toBeNull()
    expect(bearerToken('Basic abc')).toBeNull()
    expect(bearerToken([])).toBeNull()
  })
})

describe('safeEqual 时序安全比较', () => {
  it('等值 true；不等 false；长度不等不抛错', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcdef')).toBe(false) // 原生 timingSafeEqual 长度不等会抛，包装后不抛
    expect(safeEqual('', '')).toBe(true)
  })
})
