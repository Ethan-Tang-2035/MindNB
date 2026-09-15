import { describe, it, expect } from 'vitest'
import { keyAction, resolveCommitText, DEFAULT_NODE_TEXT, insertFromNode } from './editing.ts'
import { emptyTree, createFloating, findNode, setCollapsed } from './model.ts'
import { createTopic } from './topics.ts'

describe('编辑态按键语义', () => {
  it('uses the same Enter insertion rule for center, floating and independent roots', () => {
    const root = emptyTree()
    const floating = createFloating(root, 100, 200)
    const topic = createTopic(floating.map, 300, 400)
    for (const id of [root.root.id, floating.id, topic.id]) {
      const inserted = insertFromNode(topic.map, id, 'sibling')
      expect(inserted.id).not.toBe('')
      expect(findNode(inserted.map, id)?.children.map(n => n.id)).toContain(inserted.id)
      expect(findNode(topic.map, id)?.children).toHaveLength(0)
    }
  })

  it('inserts a sibling normally, but a child at the current drill focus, expanding it', () => {
    const root = emptyTree()
    const first = insertFromNode(root, root.root.id, 'child')
    const sibling = insertFromNode(first.map, first.id, 'sibling')
    expect(sibling.map.root.children).toHaveLength(2)
    const child = insertFromNode(first.map, first.id, 'sibling', first.id)
    expect(findNode(child.map, first.id)?.children).toHaveLength(1)
    const collapsed = setCollapsed(child.map, first.id, true)
    expect(findNode(insertFromNode(collapsed, first.id, 'child').map, first.id)?.collapsed).toBeUndefined()
    expect(insertFromNode(root, 'missing', 'child')).toEqual({ map: root, id: '' })
  })
  it('组词期间一律旁路：Enter/Tab/Escape 都不产生动作', () => {
    expect(keyAction('Enter', true)).toBeNull()
    expect(keyAction('Tab', true)).toBeNull()
    expect(keyAction('Escape', true)).toBeNull()
  })

  it('非组词：Enter=提交+建同级，Tab=提交+建子，Esc=仅提交；Shift+Enter=换行不提交', () => {
    expect(keyAction('Enter', false)).toEqual({ action: 'commit', create: 'sibling' })
    expect(keyAction('Enter', false, true)).toBeNull()
    expect(keyAction('Tab', false)).toEqual({ action: 'commit', create: 'child' })
    expect(keyAction('Escape', false)).toEqual({ action: 'commit', create: null })
  })

  it('普通字符键不产生动作', () => {
    expect(keyAction('a', false)).toBeNull()
    expect(keyAction('ArrowLeft', false)).toBeNull()
  })

  it('空文字提交回退默认文案', () => {
    expect(resolveCommitText('')).toBe(DEFAULT_NODE_TEXT)
    expect(resolveCommitText('   ')).toBe(DEFAULT_NODE_TEXT)
    expect(resolveCommitText(' 想法 ')).toBe('想法')
    expect(DEFAULT_NODE_TEXT).toBe('分支主题')
  })
})
