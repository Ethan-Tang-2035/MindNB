import { expect, it, vi } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { seedTree } from './model.ts'
import { compareRevision, createPortable, readPortable, imageObjects } from './vault-format.ts'
it('portable archive rejects traversal, unknown versions and missing resource references', async () => {
  await expect(readPortable(zipSync({ '../escape': strToU8('x') }))).rejects.toThrow('路径')
  await expect(readPortable(zipSync({ 'document.json': strToU8(JSON.stringify({ format: 'mindnb-portable', version: 9, name: 'x', tree: seedTree() })) }))).rejects.toThrow('版本')
  const tree = seedTree(); tree.objects = [{ kind: 'image', id: 'i', seed: 1, src: 'asset:' + '0'.repeat(64) + '.png', x: 0, y: 0, w: 10, h: 10 }]
  await expect(readPortable(zipSync({ 'document.json': strToU8(JSON.stringify({ format: 'mindnb-portable', version: 1, name: 'x', tree })) }))).rejects.toThrow('图片缺失')
})
it('portable roundtrip preserves full model, annotations and geometry', async () => {
  const tree = seedTree(); tree.root.note = { version: 1, markdown: '备注' }
  const bytes = await createPortable(tree, '完整文档', async () => { throw new Error('unexpected image') })
  expect((await readPortable(bytes)).tree).toEqual(tree)
  expect(imageObjects(tree)).toEqual([])
})
it('exports identical portable bytes across retries at different times', async () => {
  const tree = seedTree()
  const read = async () => { throw new Error('unexpected image') }
  vi.useFakeTimers()
  try {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const first = await createPortable(tree, '重试', read)
    vi.setSystemTime(new Date('2026-01-02T12:34:56Z'))
    expect(await createPortable(tree, '重试', read)).toEqual(first)
    expect(await createPortable(tree, '不同名称', read)).not.toEqual(first)
  } finally { vi.useRealTimers() }
})
it('revision comparison is deterministic, prioritizes edit time over arrival', () => {
  const a = { editedAt: 1000, sequence: 999, deviceId: 'z', id: 'a' }
  expect(compareRevision(a, { ...a, editedAt: 2000, sequence: 0 })).toBeLessThan(0)
  expect(compareRevision(a, { ...a, id: 'b' })).toBeLessThan(0)
})

it('imports the previous portable envelope and exports only the new envelope', async () => {
  const { LEGACY_BRAND } = await import('./legacy-brand.ts')
  const { unzipSync, strFromU8 } = await import('fflate')
  const tree = seedTree()
  const old = zipSync({ 'document.json': strToU8(JSON.stringify({ format: LEGACY_BRAND.portableFormat, version: 1, name: '旧版资料', tree })) })
  const imported = await readPortable(old)
  expect(imported.tree).toEqual(tree)
  const next = await createPortable(imported.tree, imported.name, async () => { throw new Error('unused') })
  expect(JSON.parse(strFromU8(unzipSync(next)['document.json'])).format).toBe('mindnb-portable')
})
