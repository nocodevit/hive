// Electron wiring for the wake word (wakeController.ts): IPC handlers,
// the helper binary location, cloud transcription settings, start at
// launch and kill on quit. index.ts calls registerButlerWakeIpc once.

import { app, BrowserWindow, ipcMain } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import type { AgentRow } from './butlerApi'
import { buildVocabPrompt, pickModel, resolveUtterance } from './voiceTranscribe'
import { createWakeController } from './wakeController'

export interface ButlerWakeIpcDeps {
  butlerDir: string
  loadData: () => Record<string, unknown>
  rows: () => AgentRow[]
  isLive: (chatId: string) => boolean
  sendMessage: (chatId: string, text: string) => { ok: boolean; error?: string }
  isDictating: () => boolean
}

function helperPath(): string | null {
  const dev = join(__dirname, '..', '..', 'scripts', 'hive-speech')
  if (existsSync(dev)) return dev
  const prod = join(process.resourcesPath, 'scripts', 'hive-speech')
  return existsSync(prod) ? prod : null
}

export function registerButlerWakeIpc(deps: ButlerWakeIpcDeps) {
  const wake = createWakeController({
    dir: deps.butlerDir,
    helperPath,
    rows: deps.rows,
    isLive: deps.isLive,
    sendMessage: deps.sendMessage,
    isDictating: deps.isDictating,
    resolveText: async audio => {
      const data = deps.loadData()
      const prefs = (data.appPrefs || {}) as { openaiApiKey?: unknown; voiceModel?: unknown }
      // The phrase is in the prompt so a recording that still starts with
      // it comes back spelled the way stripWake expects.
      const prompt = ['Hola Butler', buildVocabPrompt(data, 80)].filter(Boolean).join(', ')
      const { text } = await resolveUtterance(audio, {
        apiKey: typeof prefs.openaiApiKey === 'string' ? prefs.openaiApiKey.trim() : '',
        model: pickModel(prefs.voiceModel),
        prompt,
        onError: msg => console.error(`[Hive] wake command transcription failed, using macOS result: ${msg}`)
      })
      return text
    },
    emit: ev => {
      for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('wake:event', ev)
    }
  })

  ipcMain.handle('wake:state', () => wake.getState())
  ipcMain.handle('wake:setEnabled', (_e, enabled: unknown) => wake.setEnabled(enabled === true))
  ipcMain.handle('wake:send', (_e, id: unknown, agentId: unknown) =>
    typeof id === 'string' ? wake.send(id, typeof agentId === 'string' ? agentId : undefined) : { ok: false, error: 'unknown_proposal' })
  ipcMain.handle('wake:dismiss', (_e, id: unknown) => { if (typeof id === 'string') wake.dismiss(id); return { ok: true } })

  void app.whenReady().then(() => wake.init())
  app.on('before-quit', () => wake.kill())
  for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => wake.kill())
  return wake
}
