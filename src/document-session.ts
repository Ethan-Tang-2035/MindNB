import type { createDesktopStore } from './desktop-store.ts'
import type { withSync } from './sync.ts'

type Backend =
  | { kind: 'desktop'; runtime: ReturnType<typeof createDesktopStore> }
  | { kind: 'web'; runtime: ReturnType<typeof withSync> }

/** Own the open-document lifecycle without making a desktop adapter impersonate web sync. */
export function createDocumentSession(backend: Backend) {
  let openId: string | null = null
  const refresh = () => backend.kind === 'desktop' ? backend.runtime.refresh() : backend.runtime.engine.syncRound()
  return {
    store: backend.runtime.store,
    refresh,
    async start() {
      if (backend.kind === 'desktop') await backend.runtime.refresh(true)
      else void backend.runtime.engine.start() // Web cache opens while remote discovery proceeds.
    },
    activate(id: string | null) {
      if (id === openId) return
      const previous = openId
      openId = id
      if (backend.kind === 'web') {
        if (previous) backend.runtime.engine.setOpen(previous, false)
        if (id) backend.runtime.engine.setOpen(id, true)
        else void refresh()
      } else if (!id) void refresh()
    },
    resolveConflict(id: string, decision: 'overwrite' | 'discard') {
      if (backend.kind !== 'web') return Promise.reject(new Error('桌面资料库不使用远端覆盖警告'))
      return backend.runtime.engine.resolveConflict(id, decision)
    },
    state() {
      return backend.kind === 'web' ? backend.runtime.engine._state() : { desktop: true, openId }
    },
  }
}
