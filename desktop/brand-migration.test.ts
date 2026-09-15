import { expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { migrateUserData } from './brand-migration.ts'
import { LEGACY_BRAND } from '../src/legacy-brand.ts'
it('copies the old device state even when Electron has created an empty new profile, and preserves both profiles', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mindnb-profile-'))
  try {
    const old = join(root, LEGACY_BRAND.dataDirectories[0]), next = join(root, 'MindNB')
    await mkdir(join(old, 'vault-state'), { recursive: true }); await mkdir(next)
    await writeFile(join(old, 'vault-location.json'), '{"path":"/existing/vault"}')
    await writeFile(join(old, 'vault-state/device.json'), '{"id":"same-device"}')
    await migrateUserData(root, next)
    expect(await readFile(join(next, 'vault-state/device.json'), 'utf8')).toBe('{"id":"same-device"}')
    expect(await readFile(join(old, 'vault-location.json'), 'utf8')).toContain('/existing/vault')
    await writeFile(join(next, 'vault-location.json'), '{"path":"/new/vault"}')
    await migrateUserData(root, next)
    expect(await readFile(join(next, 'vault-location.json'), 'utf8')).toContain('/new/vault')
  } finally { await rm(root, { recursive: true, force: true }) }
})
