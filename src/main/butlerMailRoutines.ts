// Wiring for Butler email + daily routines: builds the stores, the mail
// module, the launchd scheduler and the routine runner from Hive's real
// pieces, registers their IPC, and handles a --butler-routine launch.
// index.ts calls setupButlerMailRoutines once (marker [butler:mail-routines]).

import { todoFromApproval } from './butlerTodosIpc'
import { butlerJiraCall, createJiraConnectionStore, createJiraRestCaller, normalizeConnection, type Call } from './jiraRest'
import { execFile, execFileSync } from 'child_process'
import { readJiraConfig, runHandleJira } from './handleJira'
import { discoverPrompt, parseDiscovery, readJiraSettings, writeJiraSettings, readJiraMd } from './butlerJiraSettings'
import { butlerDayText, waitingLines } from './butlerDay'
import { createCaseLog } from './feishuCases'
import { jiraCaller } from './butlerJira'
import { claudeJsonPath, jiraTools } from './butlerTools'
import { homedir } from 'os'
import { join } from 'path'
import type { App, IpcMain, SafeStorage } from 'electron'
import { createAccountStore, createPasswordStore, mailDir, type MailCrypto } from './butlerMailStore'
import { createButlerMail } from './butlerMail'
import { createMailClients } from './butlerMailClients'
import { createClaudeRunner } from './butlerClaude'
import { createRoutineScheduler, readRoutineSettings } from './butlerRoutines'
import { agentDays, createRoutineRunner, type AgentInfo, type RoutineRunDeps, type RoutineRunner } from './butlerRoutineRun'
import type { RoutineRunRecord } from '../shared/butler-routines'
import { startRoutineMode, type RoutineMode } from './butlerRoutineMode'
import { registerButlerMailIpc } from './butlerMailIpc'
import { registerButlerRoutinesIpc } from './butlerRoutinesIpc'
import { butlerDir } from './butler'
import type { Approvals } from './approvals'

export interface ButlerMailRoutinesDeps {
  /** Butler › Todo: follow-ups handle-jira drafts become todos. */
  todos?: { add: (i: import('./butlerTodos').TodoInput) => unknown; all: () => import('./butlerTodos').Todo[] }
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
  dispatch?: RoutineRunDeps['dispatch']
}

export function setupButlerMailRoutines(d: ButlerMailRoutinesDeps): { mode: RoutineMode; runner: RoutineRunner; jiraCall: () => Call | null } {
  const folder = butlerDir(d.dataDir)
  const isolated = !!process.env.HIVE_DATA_DIR
  // Isolated test data dirs may keep passwords in plain files (never the Keychain).
  const plain = isolated && process.env.HIVE_MAIL_PLAIN_STORE === '1'
  const crypto: MailCrypto = plain
    ? { encrypt: s => Buffer.from(s, 'utf8'), decrypt: b => b.toString('utf8') }
    : { encrypt: s => d.safeStorage.encryptString(s), decrypt: b => d.safeStorage.decryptString(b) }

  const runClaude = createClaudeRunner({ bin: d.claudeBin, cwd: d.folder })
  const jiraConn = createJiraConnectionStore(folder, crypto)
  const jiraCall = () => butlerJiraCall(folder, claudeJsonPath(homedir()), jiraConn)?.call ?? null
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
    // The model's Jira: Stargate / MCP tools, else ./hive jira over direct REST.
    jira: () => jiraTools(folder, claudeJsonPath(homedir())) ?? (jiraCall() ? { server: 'rest', read: ['Bash(./hive jira:*)'] } : null),
    calendar: d.calendar,
    // What waits for the owner: Approve cards, then open todos due today or overdue (morning plan input).
    waiting: () => {
      const today = new Date().toISOString().slice(0, 10)
      const due = (d.todos?.all() ?? []).filter(t => t.status === 'open' && t.due && t.due <= today).map(t => `${t.title} (todo, due ${t.due})`)
      return [...waitingLines(d.approvals.all()), ...due]
    },
    butlerToday: since => butlerDayText(createCaseLog(folder).all(), d.approvals.all(), since),
    handleJira: async () => {
      const cfg = readJiraConfig(folder)
      if (!cfg) return null
      const call = jiraCall()
      if (!call) throw new Error('Jira not connected (Settings › Jira › Connection)')
      return (await runHandleJira({ folder, call, write: p => runClaude(`${p}\n\n# The owner's Jira (settings)\n${readJiraMd(folder)}`), approvals: d.approvals, followUp: card => { d.todos?.add(todoFromApproval(card, 'butler')) } }, cfg)).text
    },
    onRun: d.onRoutineRun,
    dispatch: d.dispatch,
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

  // Settings › Jira: the owner's company specifics (not a skill), and "Set up from Jira".
  const connView = () => {
    const c = jiraConn.read()
    const using = butlerJiraCall(folder, claudeJsonPath(homedir()), jiraConn)?.via ?? null
    return { ...c, hasToken: jiraConn.hasToken(), mcp: !!jiraCaller(folder, claudeJsonPath(homedir())), using }
  }
  d.ipcMain.handle('jira:get', () => ({ settings: readJiraSettings(folder), connected: !!jiraCall(), connection: connView() }))
  d.ipcMain.handle('jira:saveConnection', (_e, raw: unknown, token: unknown) => {
    jiraConn.save(raw, typeof token === 'string' ? token : token === null ? null : undefined)
    return connView()
  })
  // Test: who Jira says you are, over the chosen way (a typed token is tried without saving it).
  d.ipcMain.handle('jira:testConnection', async (_e, raw: unknown, token: unknown) => {
    const c = normalizeConnection(raw)
    let call: Call | null
    if (c.mode !== 'mcp' && c.url && typeof token === 'string' && token.trim()) call = createJiraRestCaller(c, token.trim())
    else call = butlerJiraCall(folder, claudeJsonPath(homedir()), { read: () => c, token: () => jiraConn.token() })?.call ?? null
    if (!call) return { ok: false, error: c.mode === 'mcp' ? 'No Jira tools in Stargate / MCP' : 'Add the Jira URL and a token' }
    try {
      const me = JSON.parse(await call('jira_get_user_profile', {}))
      return { ok: true, name: me.displayName || me.name || me.emailAddress || 'signed in' }
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) } }
  })
  d.ipcMain.handle('jira:save', (_e, raw: unknown) => {
    const s = writeJiraSettings(folder, raw)
    return s ? { ok: true, settings: s } : { ok: false, error: 'Pick the product project first' }
  })
  d.ipcMain.handle('jira:discover', async () => {
    const tools = jiraTools(folder, claudeJsonPath(homedir()))
    // Without Jira tools in Stargate / MCP, the model reads Jira through ./hive jira (direct REST).
    const rest = !tools && !!jiraCall()
    if (!tools && !rest) return { ok: false, error: 'Jira is not connected (Settings › Jira › Connection)' }
    try {
      const prompt = rest ? `${discoverPrompt()}\nYou have no jira_* tools: use ./hive jira search "<JQL>" --fields <list> --max 100, ./hive jira get KEY, ./hive jira transitions KEY, ./hive jira me instead.` : discoverPrompt()
      const draft = parseDiscovery(await runClaude(prompt, { allowedTools: tools ? tools.read : ['Bash(./hive jira:*)'] }))
      return draft ? { ok: true, draft } : { ok: false, error: 'Could not work it out — fill it in by hand' }
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) } }
  })
  // Settings and journal reads/writes use the plain path: opening Settings
  // must not install the Butler folder (only running a routine does).
  registerButlerRoutinesIpc({ ipcMain: d.ipcMain, folder: () => folder, scheduler, runner, markMailRead: key => mail.markRead(key) })

  return { runner, jiraCall, mode: startRoutineMode(d.app, process.argv, (id, opts) => runner.run(id, opts), msg => console.log(`[butler] ${msg}`), d.reopen) }
}
