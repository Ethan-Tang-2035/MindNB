import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('closing while home assets load exits without a startup error dialog', async () => {
  test.setTimeout(10_000)
  const base = await mkdtemp(join(tmpdir(), 'mindnb-startup-'))
  await mkdir(join(base, 'vault'))
  const app = await electron.launch({
    args: ['-r', resolve('tests/helpers/delay-startup-image.cjs'), resolve('.')],
    env: { ...process.env, MINDNB_DESKTOP_DATA: join(base, 'app'), MINDNB_DESKTOP_VAULT: join(base, 'vault') },
  })
  const pid = await app.evaluate(() => process.pid)
  let exited = false
  app.once('close', () => { exited = true })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('#home')).toBeVisible()
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.isLoading())).toBe(true)
    const closed = app.waitForEvent('close', { timeout: 5000 })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    await closed
  } finally {
    if (!exited) {
      try { process.kill(pid, 'SIGKILL') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
    }
    await rm(base, { recursive: true, force: true })
  }
})
