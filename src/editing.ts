/** 编辑态的纯语义层：按键 → 提交动作；IME 组词期间一切快捷键旁路。 */
import { addChild, addChildAfterSibling, findParent, setCollapsed, type MindMap } from './model.ts'

export const DEFAULT_NODE_TEXT = '分支主题'

/** A forest root or drill focus has no visible sibling slot; Enter adds a child there. */
export function insertFromNode(map: MindMap, id: string, placement: 'sibling' | 'child', focusId = map.root.id) {
  if (placement === 'sibling' && id !== focusId && findParent(map, id)) return addChildAfterSibling(map, id, DEFAULT_NODE_TEXT)
  const added = addChild(map, id, DEFAULT_NODE_TEXT)
  return added.id ? { ...added, map: setCollapsed(added.map, id, false) } : added
}

export interface EditOutcome {
  action: 'commit'
  /** 提交后新建：sibling=同级，child=子级，null=仅提交 */
  create: 'sibling' | 'child' | null
}

/**
 * 编辑态按键语义。
 * 组词期间（compositionstart→compositionend）返回 null —— 输入法上屏优先，绝不触发建节点。
 * Shift+Enter 也返回 null —— 交回文本框插入换行。
 */
export function keyAction(key: string, composing: boolean, shift = false): EditOutcome | null {
  if (composing) return null
  if (key === 'Enter') return shift ? null : { action: 'commit', create: 'sibling' }
  if (key === 'Tab') return { action: 'commit', create: 'child' }
  if (key === 'Escape') return { action: 'commit', create: null }
  return null
}

/** 空文字提交回退为默认文案，避免不可见节点 */
export function resolveCommitText(text: string): string {
  const t = text.trim()
  return t === '' ? DEFAULT_NODE_TEXT : t
}
