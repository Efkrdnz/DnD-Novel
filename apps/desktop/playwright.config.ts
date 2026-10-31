import { defineConfig } from '@playwright/test'

// End-to-end checks against the built Electron app (run `pnpm e2e`, which builds first).
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',
  timeout: 90_000,
  workers: 1,
  reporter: 'list',
  outputDir: 'e2e/results',
})
