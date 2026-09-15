import { rm } from 'node:fs/promises'

// Generated outputs only. Vaults, fixtures, design sources and issue history are not build output.
for (const directory of ['dist', 'dist-desktop', 'release', 'test-results', 'playwright-report']) {
  await rm(new URL(`../${directory}/`, import.meta.url), { recursive: true, force: true })
}
