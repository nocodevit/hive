import { resolve } from 'path'
import { readFileSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'))

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // sessionInfoWorker.js runs next to index.js on a worker thread (sessionInfo.ts).
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts'), sessionInfoWorker: resolve(__dirname, 'src/main/sessionInfoWorker.ts') } } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version)
    },
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        // Upstream package.json sets "module": "lib/xterm.mjs" but the file actually
        // lives in lib-headless/ — bypass the broken field by pointing directly at the ESM bundle.
        '@xterm/headless': resolve('node_modules/@xterm/headless/lib-headless/xterm-headless.mjs')
      }
    },
    plugins: [react()]
  }
})
