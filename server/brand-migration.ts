import type { BlobStore } from './blob-store.ts'
import { LEGACY_BRAND } from '../src/legacy-brand.ts'
/** New writes use the current namespace; existing cloud data remains readable. */
export function withLegacyReads(store: BlobStore): BlobStore {
  const previous = (key: string) => key.startsWith('mindnb:') ? LEGACY_BRAND.storagePrefix + key.slice('mindnb:'.length) : key
  return {
    async get(key) {
      const value = await store.get(key)
      return value !== null || previous(key) === key ? value : store.get(previous(key))
    },
    put: (key, value) => store.put(key, value),
    async del(key) {
      // Remove the fallback first so a partial failure cannot resurrect deleted content.
      if (previous(key) !== key) await store.del(previous(key))
      await store.del(key)
    },
    async list(prefix) {
      const current = await store.list(prefix)
      if (previous(prefix) === prefix) return current
      const old = await store.list(previous(prefix))
      return [...new Set([...current, ...old.map(k => 'mindnb:' + k.slice(LEGACY_BRAND.storagePrefix.length))])]
    },
  }
}
