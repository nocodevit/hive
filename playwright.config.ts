import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // Per-test timeout — kept tight to surface real hangs fast.
  // beforeAll hooks inherit this; several specs run `electron-vite
  // build` inside beforeAll which on slow disks (e.g. when the user's
  // disk is near-full) routinely takes 30-90s. Increase to 120s so we
  // don't lose 30 specs to "did not run" when the build is slow.
  timeout: 120000,
  retries: 0,
  use: {
    trace: 'on-first-retry',
  },
})
