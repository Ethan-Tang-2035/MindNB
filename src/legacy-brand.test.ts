import { expect, it } from 'vitest'
import { LEGACY_BRAND, migrateBrowserStorage, isPortablePath } from './legacy-brand.ts'
import { seedTree } from './model.ts'
import { createDocStore } from './docs.ts'
function storage() {
  const map = new Map<string, string>()
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v) }, removeItem: (k: string) => { map.delete(k) } }
}
it('copies legacy documents, views, credentials and sync state, keeping the source intact', () => {
  const s = storage(), p = LEGACY_BRAND.storagePrefix, tree = seedTree()
  s.setItem(p + 'v2:docs', JSON.stringify([{ id: 'a', createdAt: 1, updatedAt: 1, nameOverride: '旧资料' }]))
  s.setItem(p + 'v2:doc:a', JSON.stringify(tree))
  s.setItem(p + 'v2:view:a', JSON.stringify({ dx: 12, dy: 34, k: 2 }))
  s.setItem(p + 'access-key', 'test-only')
  s.setItem(p + 'v2:baselines', '{"a":1}')
  const before = new Map(s.map)
  migrateBrowserStorage(s)
  const store = createDocStore(s)
  expect(store.loadTree('a')).toEqual(tree)
  expect(store.loadView('a')).toMatchObject({ dx: 12, dy: 34, k: 2 })
  for (const [k, v] of before) {
    expect(s.getItem(k)).toBe(v)
    expect(s.getItem('mindnb:' + k.slice(p.length))).toBe(v)
  }
  s.setItem('mindnb:v2:docs', '[]')
  migrateBrowserStorage(s)
  expect(createDocStore(s).list()).toEqual([])
})
it('does not commit an index if copying data fails, and can resume', () => {
  const s = storage(), p = LEGACY_BRAND.storagePrefix
  s.setItem(p + 'v2:docs', '[{"id":"a"}]'); s.setItem(p + 'v2:doc:a', '{}')
  expect(() => migrateBrowserStorage({ ...s, setItem: () => { throw new Error('quota') } })).toThrow('quota')
  expect(s.getItem('mindnb:v2:docs')).toBeNull()
  migrateBrowserStorage(s)
  expect(s.getItem('mindnb:v2:doc:a')).toBe('{}')
})
it('rejects a corrupt old index without initializing an empty new store', () => {
  const s = storage(); s.setItem(LEGACY_BRAND.storagePrefix + 'v2:docs', '{}')
  expect(() => migrateBrowserStorage(s)).toThrow('迁移已停止')
  expect(s.getItem('mindnb:v2:docs')).toBeNull()
})
it('recognizes new and previous portable files case-insensitively', () => {
  expect(isPortablePath('Notes.MINDNB')).toBe(true)
  expect(isPortablePath('Notes.' + LEGACY_BRAND.extension)).toBe(true)
  expect(isPortablePath('Notes.mindnb.exe')).toBe(false)
})
