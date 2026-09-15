import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/web',
  testMatch: '**/*.e2e.ts',
  outputDir: 'test-results/web',
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    channel: process.env.PLAYWRIGHT_CHANNEL === 'chrome' ? 'chrome' : undefined,
    headless: true,
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    baseURL: 'http://127.0.0.1:5179',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5179 --strictPort',
    url: 'http://127.0.0.1:5179',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
