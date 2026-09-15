import { cp, access, mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { LEGACY_BRAND } from '../src/legacy-brand.ts'
const exists = (path: string) => access(path).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e })
/** Preserve device identity, pending writes and history; keep the original profile as backup. */
export async function migrateUserData(appData: string, destination: string): Promise<void> {
  if (await exists(join(destination, 'vault-location.json'))) return
  for (const name of LEGACY_BRAND.dataDirectories) {
    const source = join(appData, name)
    if (!await exists(join(source, 'vault-location.json'))) continue
    await mkdir(destination, { recursive: true })
    const staging = join(destination, '.migration-' + randomUUID())
    try {
      await mkdir(staging)
      if (await exists(join(source, 'vault-state')) && !await exists(join(destination, 'vault-state'))) {
        await cp(join(source, 'vault-state'), join(staging, 'vault-state'), { recursive: true, errorOnExist: true, force: false })
        await rename(join(staging, 'vault-state'), join(destination, 'vault-state'))
      }
      await cp(join(source, 'vault-location.json'), join(staging, 'vault-location.json'), { errorOnExist: true, force: false })
      await rename(join(staging, 'vault-location.json'), join(destination, 'vault-location.json'))
    } finally { await rm(staging, { recursive: true, force: true }) }
    return
  }
}
