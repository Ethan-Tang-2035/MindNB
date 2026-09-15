import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/desktop',
  testMatch: '**/*.e2e.ts',
  outputDir: 'test-results/desktop',
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
})
