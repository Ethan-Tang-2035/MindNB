/**
 * 全屏访问密码门 —— spec §②。boot 时无存储密码或 ping 得 401 → 挡住 #app；
 * 输对进首页并记住（存浏览器，刷新不再问）；网络失败 ≠ 密码错误：
 * 有缓存有密码照常进（本地缓存模式），无密码则「需要联网验证密码」可重试。
 * 词汇见 CONTEXT.md（访问密码、本地缓存）。决策表是纯函数（node 环境可单测），DOM 壳浏览器验证。
 */
import { createBrandIcon } from './brand.ts'
import type { StorageLike } from './docs.ts'
import type { PingVerdict, RemoteClient } from './remote.ts'
import { ACCESS_KEY_STORAGE } from './remote.ts'

export type GateDecision =
  | 'enter' // 远端验证通过，直接放行
  | 'enter-offline' // 有密码但远端不可达/未配置/无 /api → 本地缓存模式照常进
  | 'enter-local' // 无密码且无 /api（纯 npm run dev）→ 纯本地模式，不弹门
  | 'gate' // 弹门：首次使用，或存储密码被服务端拒绝（改密后，先清存储密码）
  | 'gate-offline' // 弹门并提示「需要联网验证密码」

/** 进门决策表（纯函数）：stored = 浏览器里的访问密码，v = ping 分类 */
export function decideEntry(stored: string | null, v: PingVerdict): GateDecision {
  if (v === 'ok') return 'enter'
  if (stored) return v === 'unauthorized' ? 'gate' : 'enter-offline'
  if (v === 'absent') return 'enter-local'
  if (v === 'network' || v === 'not_configured') return 'gate-offline'
  return 'gate' // 无密码 + 服务活着（401 只是「没带口令」）：正常弹门
}

/**
 * 应用入口的守门人：resolve 后才允许挂载界面。
 * 主.ts 只在 promise 完成后接 hashchange + route()，门挡住时 #app 保持空白。
 */
export async function ensureAccess(remote: RemoteClient, storage: StorageLike): Promise<void> {
  const stored = storage.getItem(ACCESS_KEY_STORAGE)
  const decision = decideEntry(stored, await remote.ping(stored))
  switch (decision) {
    case 'enter':
      return
    case 'enter-offline':
      console.warn('[mindnb] 远端不可达，进入本地缓存模式（恢复联网后写回）')
      return
    case 'enter-local':
      console.warn('[mindnb] 未检测到 /api，纯本地模式运行（vercel dev 可启用远端）')
      return
    case 'gate':
      if (stored) storage.removeItem(ACCESS_KEY_STORAGE) // 改密后：清存储密码重新弹门
      await showGate(remote, storage, stored ? '访问密码已变更，请重新输入' : null)
      return
    case 'gate-offline':
      await showGate(remote, storage, '需要联网验证密码，检查网络后重试')
      return
  }
}

/** 门本体：手绘风纸色遮罩挡住一切；错密码内联报错、不放行、不清空已输入 */
function showGate(remote: RemoteClient, storage: StorageLike, initialHint: string | null): Promise<void> {
  return new Promise((resolve) => {
    const mask = document.createElement('div')
    mask.className = 'gate-mask'
    const card = document.createElement('div')
    card.className = 'gate-card'
    const title = document.createElement('div')
    title.className = 'gate-title'
    const logo = createBrandIcon('gate-logo')
    logo.alt = ''
    title.append(logo, document.createTextNode('MindNB'))
    const sub = document.createElement('div')
    sub.className = 'gate-sub'
    sub.textContent = '输入访问密码开始'
    const input = document.createElement('input')
    input.className = 'gate-input'
    input.type = 'password'
    input.placeholder = '访问密码'
    input.autocomplete = 'current-password'
    const err = document.createElement('div')
    err.className = 'gate-error'
    err.setAttribute('role', 'alert')
    const btn = document.createElement('button')
    btn.className = 'gate-btn'
    btn.textContent = '进入'
    card.append(title, sub, input, err, btn)
    mask.appendChild(card)
    document.body.appendChild(mask)
    if (initialHint) err.textContent = initialHint
    input.focus()

    let busy = false
    const submit = async (): Promise<void> => {
      if (busy) return
      const pw = input.value
      if (!pw.trim()) {
        err.textContent = '请输入访问密码'
        input.focus()
        return
      }
      busy = true
      btn.disabled = true
      err.textContent = ''
      const v = await remote.ping(pw)
      busy = false
      btn.disabled = false
      if (v === 'ok') {
        storage.setItem(ACCESS_KEY_STORAGE, pw) // 记住：刷新不再问
        mask.remove()
        resolve()
        return
      }
      err.textContent = v === 'unauthorized' ? '访问密码不正确' : '需要联网验证密码'
      input.focus()
    }
    btn.addEventListener('click', () => void submit())
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void submit()
    })
  })
}
