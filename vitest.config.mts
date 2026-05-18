import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    include: [
      'src/main/__tests__/**/*.test.ts',
      'src/renderer/src/**/__tests__/**/*.test.{ts,tsx}'
    ],
    // Default node environment for main-process tests; per-file
    // `// @vitest-environment jsdom` annotation flips renderer tests
    // (anything that mounts React components) to jsdom. This keeps
    // the main-process suite fast — jsdom alone adds ~150ms cold start.
    environment: 'node',
    setupFiles: ['./vitest.setup.ts']
  }
})
