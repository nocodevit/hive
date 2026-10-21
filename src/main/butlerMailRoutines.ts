// Wiring for Butler email + daily routines: builds the stores, the mail
// module, the launchd scheduler and the routine runner from Hive's real
// pieces, registers their IPC, and handles a --butler-routine launch.
// index.ts calls setupButlerMailRoutines once (marker [butler:mail-routines]).

import { execFile, execFileSync } from 'child_process'
import { readJiraConfig, runHandleJira } from './handleJira'
import { jiraCaller } from './butlerJira'
import { claudeJsonPath } from './butlerTools'
import { homedir } from 'os'
import { join } from 'path'
import type { App, IpcMain, SafeStorage } from 'electron'
import { createAccountStore, createPasswordStore, mailDir, type MailCrypto } from './butlerMailStore'
import { createButlerMail } from './butlerMail'
import { createMailClients } from './butlerMailClients'
import { createClaudeRunner } from './butlerClaude'
import { createRoutineScheduler, readRoutineSettings } from './butlerRoutines'
import { agentDays, createRoutineRunner, type AgentInfo, type RoutineRunner } from './butlerRoutineRun'
import type { RoutineRunRecord } from '../shared/butler-routines'
import { startRoutineMode, type RoutineMode } from './butlerRoutineMode'
import { registerButlerMailIpc } from './butlerMailIpc'
import { registerButlerRoutinesIpc } from './butlerRoutinesIpc'
import { butlerDir } from './butler'
import type { Approvals } from './approvals'

export interface ButlerMailRoutinesDeps {
  app: App
  ipcMain: IpcMain
  safeStorage: SafeStorage
  openExternal: (url: string) => void
  dataDir: string
  /** The Butler folder with its bundled files written. */
  folder: () => string
  approvals: Approvals
  claudeBin: () => string
  agents: () => AgentInfo[]
  agentCwd: (agentId: string) => string | null
  feishu: {
    accessToken: () => Promise<{ ok: boolean; token?: string; error?: string }>
    getStatus: () => { state: string; openId?: string }
  }
  /** Today's meetings as text for the morning plan ('' when none). */
  calendar?: (date: string) => Promise<string>
  /** Another normal Hive launch: show (or reopen) the window. */
  reopen?: () => void
  onRoutineRun?: (rec: RoutineRunRecord) => void
}

export function setupButlerMailRoutines(d: ButlerMailRoutinesDeps): { mode: RoutineMode; runner: RoutineRunner } {
  const folder = butlerDir(d.dataDir)
  const isolated = !!process.env.HIVE_DATA_DIR
  // Isolated test data dirs may keep passwords in plain files (never the Keychain).
  const plain = isolated && process.env.HIVE_MAIL_PLAIN_STORE === '1'
  const crypto: MailCrypto = plain
    ? { encrypt: s => Buffer.from(s, 'utf8'), decrypt: b => b.toString('utf8') }
    : { encrypt: s => d.safeStorage.encryptString(s), decrypt: b => d.safeStorage.decryptString(b) }

  const runClaude = createClaudeRunner({ bin: d.claudeBin, cwd: d.folder })
  const mail = createButlerMail({
    folder,
    accounts: createAccountStore(mailDir(folder)),
    passwords: createPasswordStore(mailDir(folder), crypto),
    clients: createMailClients(),
    runClaude,
    approvals: d.approvals
  })

  // An isolated data dir gets its own LaunchAgents folder and no real launchctl.
  const realLaunchd = !isolated || process.env.HIVE_LAUNCHD_REAL === '1'
  const scheduler = createRoutineScheduler({
    agentsDir: isolated ? join(d.dataDir, 'LaunchAgents') : join(homedir(), 'Library', 'LaunchAgents'),
    launchctl: args => realLaunchd
      ? new Promise(resolve => execFile('/bin/launchctl', args, { timeout: 15_000 }, (err, _out, stderr) =>
        resolve({ code: err ? (typeof (err as any).code === 'number' ? (err as any).code : 1) : 0, stderr: String(stderr || '') })))
      : Promise.resolve({ code: 0, stderr: '' }),
    uid: process.getuid?.() ?? 501,
    program: () => (d.app.isPackaged ? [process.execPath] : [process.execPath, d.app.getAppPath()]),
    logDir: join(folder, 'logs'),
    bundleId: 'com.hive.app',
    env: isolated ? { HIVE_DATA_DIR: d.dataDir } : undefined
  })

  const runner = createRoutineRunner({
    calendar: d.calendar,
    handleJira: async () => {
      const cfg = readJiraConfig(folder)
      if (!cfg) return null
      const call = jiraCaller(folder, claudeJsonPath(homedir()))
      if (!call) throw new Error('Jira not connected')
      return (await runHandleJira({ folder, call, write: p => runClaude(p), approvals: d.approvals }, cfg)).text
    },
    onRun: d.onRoutineRun,
    // State and journal live at the plain path; only a claude run (runClaude's
    // cwd is d.folder) installs the Butler files.
    folder: () => folder,
    runClaude,
    settings: () => readRoutineSettings(folder),
    mail,
    agents: d.agents,
    activity: since => agentDays({
      logDir: join(d.dataDir, 'chat-logs'),
      agents: d.agents(),
      since,
      cwdOf: d.agentCwd,
      gitLog: (cwd, s) => execFileSync('git', ['-C', cwd, 'log', `--since=@${Math.floor(s / 1000)}`, '--oneline', '-n', '10'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] })
        .split('\n').filter(Boolean)
    }),
    feishu: {
      token: d.feishu.accessToken,
      openId: () => { const s = d.feishu.getStatus(); return s.state === 'signed_in' && s.openId ? s.openId : null },
      getJson: async (url, token) => {
        const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) })
        return r.json()
      }
    }
  })

  // Bring installed LaunchAgents up to what this version writes (e.g. the
  // bundle id that makes Login Items say "Hive"). No-op when current.
  { const rs = readRoutineSettings(folder); if (rs.saved) void scheduler.sync(rs) }

  registerButlerMailIpc({ ipcMain: d.ipcMain, mail, openExternal: d.openExternal })
  // Settings and journal reads/writes use the plain path: opening Settings
  // must not install the Butler folder (only running a routine does).
  registerButlerRoutinesIpc({ ipcMain: d.ipcMain, folder: () => folder, scheduler, runner })

  return { runner, mode: startRoutineMode(d.app, process.argv, (id, opts) => runner.run(id, opts), msg => console.log(`[butler] ${msg}`), d.reopen) }
}
