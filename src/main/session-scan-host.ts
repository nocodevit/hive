/// <reference types="electron-vite/node" />
// Main-process singleton for session-scan.ts. The worker inherits process.env,
// so HIVE_DATA_DIR isolation applies there too.
import createWorker from './session-scan-worker?nodeWorker'
import { createSessionScanClient } from './session-scan'
import type { PrevSessionInfo, RecentSession } from './chat-recent-sessions'

const client = createSessionScanClient(() => createWorker({}))

export const scanPrevSessionInfo = (cwd: string, chatId?: string) =>
  client.call<PrevSessionInfo | null>('getPrevSessionInfo', cwd, chatId)

export const scanRecentSessions = (cwd: string, limit = 5) =>
  client.call<RecentSession[]>('getRecentSessions', cwd, limit)
