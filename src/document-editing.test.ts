import { expect, it, vi } from 'vitest'
import { DocumentEditing } from './document-editing.ts'
import { emptyTree } from './model.ts'
import { moveObject, resizeObject } from './objects.ts'
import { assignToPage, createPage, pageById, updatePage } from './paper-pages.ts'

const measure = (text: string) => ({ w: text.length * 12, h: 24 })

it('previews repeated resizing without saving, then grows the page in one undoable commit', () => {
  const save = vi.fn(), editing = new DocumentEditing({ measure, save, maxBytes: 1_000_000 })
  let map = emptyTree()
  map.objects = [{ id: 'image', kind: 'image', seed: 1, src: 'data:image/png;base64,AA==', x: 20, y: 20, w: 80, h: 60 }]
  const page = createPage(map, { x: 0, y: 0 })
  map = updatePage(assignToPage(page.map, page.id, ['image']), page.id, { w: 200, h: 200, overflow: 'grow' })
  editing.stage(resizeObject(map, 'image', 250, 200))
  editing.stage(resizeObject(map, 'image', 400, 300))
  expect(save).not.toHaveBeenCalled()
  expect(editing.canUndo).toBe(false)
  const committed = editing.finish(map)
  expect(pageById(committed, page.id)!.w).toBeGreaterThanOrEqual(420)
  expect(save).toHaveBeenCalledTimes(1)
  expect(editing.undo(committed)).toEqual(map)
  expect(editing.undo(map)).toBeNull()
  expect(editing.redo(map)).toEqual(committed)
})

it('cancels a group movement without changing storage or undo history', () => {
  const save = vi.fn(), editing = new DocumentEditing({ measure, save, maxBytes: 1_000_000 })
  const map = { ...emptyTree(), objects: [{ id: 'group', kind: 'group' as const, seed: 1, x: 0, y: 0, w: 100, h: 100 }] }
  editing.stage(moveObject(map, 'group', 200, 300))
  editing.cancel()
  expect(editing.finish(map)).toBe(map)
  expect(save).not.toHaveBeenCalled()
  expect(editing.canUndo).toBe(false)
})

it('rejects oversized edits and failed persistence without consuming history', () => {
  const save = vi.fn(), map = emptyTree()
  const editing = new DocumentEditing({ measure, save, maxBytes: 1000 })
  const next = { ...map, root: { ...map.root, text: 'committed' } }
  const committed = editing.commit(map, next)
  expect(() => editing.commit(committed, { ...next, root: { ...next.root, text: 'x'.repeat(2000) } })).toThrow(/容量/)
  save.mockImplementationOnce(() => { throw new Error('disk unavailable') })
  expect(() => editing.undo(committed)).toThrow('disk unavailable')
  expect(editing.undo(committed)).toEqual(map)
  expect(editing.canUndo).toBe(false)
})

it('assigns only newly created content and honors explicit page-free placement', () => {
  const editing = new DocumentEditing({ measure, save() {}, maxBytes: 1_000_000 })
  const { map, id } = createPage(emptyTree(), { x: 0, y: 0 })
  const next = { ...map, objects: [{ id: 'image', kind: 'image' as const, seed: 1, src: 'data:image/png;base64,AA==', x: 20, y: 20, w: 80, h: 60 }] }
  expect(pageById(editing.commit(map, next, { selectedPageId: id }), id)?.members).toContain('image')
  expect(pageById(editing.commit(map, next, { explicitMembership: true }), id)?.members).not.toContain('image')
})
