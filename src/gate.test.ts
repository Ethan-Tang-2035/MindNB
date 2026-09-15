/**
 * 密码门决策表单测（票 03）：进门决策表是纯函数；门的 DOM 壳由浏览器走查验证（票 08）。
 */
import { describe, it, expect } from 'vitest'
import { decideEntry } from './gate.ts'

describe('decideEntry', () => {
  it('有密码 + 验证通过 → enter', () => expect(decideEntry('pw', 'ok')).toBe('enter'))
  it('有密码 + 断网 → enter-offline（网络失败 ≠ 密码错误，照常进）', () =>
    expect(decideEntry('pw', 'network')).toBe('enter-offline'))
  it('有密码 + 服务端缺 env → enter-offline（服务器无从校验，不拦用户）', () =>
    expect(decideEntry('pw', 'not_configured')).toBe('enter-offline'))
  it('有密码 + 无 /api（纯本地 dev）→ enter-offline', () => expect(decideEntry('pw', 'absent')).toBe('enter-offline'))
  it('有密码 + 401（改密后）→ gate（清存储密码重弹门）', () => expect(decideEntry('pw', 'unauthorized')).toBe('gate'))
  it('无密码 + 服务活着 → gate（正常弹门）', () => expect(decideEntry(null, 'unauthorized')).toBe('gate'))
  it('无密码 + 断网 → gate-offline（需要联网验证密码）', () => expect(decideEntry(null, 'network')).toBe('gate-offline'))
  it('无密码 + 服务端缺 env → gate-offline', () => expect(decideEntry(null, 'not_configured')).toBe('gate-offline'))
  it('无密码 + 无 /api → enter-local（纯本地模式不弹门，verify 脚本照常跑）', () =>
    expect(decideEntry(null, 'absent')).toBe('enter-local'))
})
