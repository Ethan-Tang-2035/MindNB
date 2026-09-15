import { expect, it } from 'vitest'
import { withLegacyReads } from './brand-migration.ts'
import { LEGACY_BRAND } from '../src/legacy-brand.ts'
it('reads existing cloud documents and versions, prefers new writes, and prevents deletion resurrection', async () => {
  const old = LEGACY_BRAND.storagePrefix, data = new Map([[old + 'v2:doc:a', 'old'], [old + 'v2:ver:a:1', 'snapshot']])
  const store = withLegacyReads({ get: async k => data.get(k) ?? null, put: async (k, v) => { data.set(k, v) }, del: async k => { data.delete(k) }, list: async p => [...data.keys()].filter(k => k.startsWith(p)) })
  expect(await store.get('mindnb:v2:doc:a')).toBe('old')
  expect(await store.list('mindnb:v2:ver:a:')).toEqual(['mindnb:v2:ver:a:1'])
  await store.put('mindnb:v2:doc:a', 'new')
  expect(await store.get('mindnb:v2:doc:a')).toBe('new')
  expect(data.get(old + 'v2:doc:a')).toBe('old')
  await store.del('mindnb:v2:doc:a')
  expect(await store.get('mindnb:v2:doc:a')).toBeNull()
})
