/** Previous release identifiers, used only to read existing data during the rebrand. */
import type { StorageLike } from './docs.ts'
export const LEGACY_BRAND = {
  storagePrefix: 'my-mind:',
  extension: 'mymind',
  documentFormat: 'my-mind-document',
  portableFormat: 'my-mind-portable',
  vaultFormat: 'my-mind-vault',
  accessKeyEnv: 'MY_MIND_ACCESS_KEY',
  dataDirectories: ['My Mind', 'my-mind'],
} as const

/** Copy before switching the index; preserve the source and never merge two active stores. */
export function migrateBrowserStorage(storage: StorageLike & { length?: number; key?(index: number): string | null }): void {
  if (storage.getItem('mindnb:v2:docs') !== null) return
  const prefix = LEGACY_BRAND.storagePrefix
  const keys = new Set(['v1', 'access-key', 'v2:synced', 'v2:pending-deletes', 'v2:baselines'].map(k => prefix + k))
  for (let i = 0; i < (storage.length ?? 0); i++) {
    const key = storage.key?.(i)
    if (key?.startsWith(prefix)) keys.add(key)
  }
  const index = storage.getItem(prefix + 'v2:docs')
  if (index !== null) {
    const entries: unknown = JSON.parse(index)
    if (!Array.isArray(entries)) throw new Error('旧版文档索引损坏，迁移已停止，原数据保留')
    for (const entry of entries) {
      if (!entry || typeof entry.id !== 'string') throw new Error('旧版文档索引损坏，迁移已停止，原数据保留')
      keys.add(prefix + 'v2:doc:' + entry.id); keys.add(prefix + 'v2:view:' + entry.id)
    }
  }
  keys.delete(prefix + 'v2:docs')
  for (const key of keys) {
    const value = storage.getItem(key), target = 'mindnb:' + key.slice(prefix.length)
    if (value !== null && storage.getItem(target) === null) storage.setItem(target, value)
  }
  if (index !== null) storage.setItem('mindnb:v2:docs', index)
}
export function isPortablePath(path: string): boolean {
  const suffix = path.toLowerCase().split('.').pop()
  return suffix === 'mindnb' || suffix === LEGACY_BRAND.extension
}
