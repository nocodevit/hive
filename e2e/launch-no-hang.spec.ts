import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { execSync } from 'child_process'
import { mkdirSync, rmSync, existsSync, writeFileSync, openSync, writeSync, closeSync } from 'fs'
import { tmpdir } from 'os'

/**
 * Relaunch with a chat left open must not freeze the app.
 *
 * The "Resume where you left off?" prompt looks up each open chat's last
 * session. That lookup read whole chat logs (hundreds of MB for a long-lived
 * agent) and JSON.parsed every line on the main thread — the window froze
 * with a spinning cursor for seconds. It now runs in a worker thread, so the
 * main process keeps answering while the prompt loads.
 *
 * Seed: one agent with an open-chat record whose cwd has no
 * ~/.claude/projects bucket, plus a ~200MB Hive chat log for it — the exact
 * path that parses the whole log.
 */

const PROJECT_ROOT = join(__dirname, '..')
const HIVE_DATA_DIR = join(tmpdir(), 'hive-e2e-launch-no-hang')
const HIVE_PORT = 17821
const FIXTURE_CWD = join(tmpdir(), 'hive-e2e-launch-no-hang-cwd')
const AGENT_ID = 'agent-nohang-1'
const LOG_BYTES = 200 * 1024 * 1024
const MAX_MAIN_GAP_MS = 750

let app: ElectronApplication
let page: Page

function seed() {
  for (const d of [HIVE_DATA_DIR, FIXTURE_CWD]) {
    if (existsSync(d)) rmSync(d, { recursive: true })
    mkdirSync(d, { recursive: true })
  }
  const zone = { id: 'zone-nohang', name: 'nohang', path: FIXTURE_CWD, type: 'rnd', hasGit: false }
  writeFileSync(join(HIVE_DATA_DIR, 'data.json'), JSON.stringify({
    projects: [{ id: 'proj-nohang', name: 'No Hang E2E', officePath: FIXTURE_CWD, zones: [zone] }],
    agents: [{ id: AGENT_ID, projectId: 'proj-nohang', zoneId: zone.id, name: '[TEST] No Hang', role: 'Engineering', type: 'coding', department: 'R&D', group: '', order: 1, status: 'done', soul: '', enabledSkills: [] }],
    appPrefs: {},
    taskGroups: []
  }))
  writeFileSync(join(HIVE_DATA_DIR, 'open-chats.json'), JSON.stringify([{ agentId: AGENT_ID, cwd: FIXTURE_CWD, since: Date.now() - 60_000 }]))

  const logDir = join(HIVE_DATA_DIR, 'chat-logs')
  mkdirSync(logDir, { recursive: true })
  const line = JSON.stringify({ type: 'assistant', session_id: 'aaaaaaaa-0000-0000-0000-000000000000', message: { content: [{ type: 'text', text: 'x'.repeat(60) }] } }) + '\n'
  const chunk = Buffer.from(line.repeat(Math.floor((4 * 1024 * 1024) / line.length)))
  const fd = openSync(join(logDir, `chat-${AGENT_ID}-${Date.now()}.jsonl`), 'w')
  try {
    for (let written = 0; written < LOG_BYTES; written += chunk.length) writeSync(fd, chunk)
  } finally {
    closeSync(fd)
  }
}

test.beforeAll(async () => {
  seed()
  execSync('npx electron-vite build', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 60000 })
})

test.afterAll(async () => {
  if (app) await app.close().catch(() => {})
  for (const d of [HIVE_DATA_DIR, FIXTURE_CWD]) if (existsSync(d)) rmSync(d, { recursive: true })
})

test('relaunch with an open chat keeps the main process responsive while the resume prompt loads', async () => {
  app = await electron.launch({
    args: [join(PROJECT_ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_ENV: 'test', HEADLESS: '1', HIVE_PORT: String(HIVE_PORT), HIVE_DATA_DIR }
  })
  // Probe the main process from the moment it starts, not just after the
  // window loads: the stall happens while the renderer's first IPCs run.
  let maxGap = 0
  let failures = 0
  let done = false
  const probe = (async () => {
    let last = Date.now()
    while (!done) {
      try {
        await app.evaluate(() => 0)
      } catch {
        failures++
      }
      const now = Date.now()
      maxGap = Math.max(maxGap, now - last)
      last = now
      await new Promise(r => setTimeout(r, 25))
    }
  })()

  page = await app.firstWindow({ timeout: 60000 })
  const dialog = page.getByRole('dialog', { name: 'Resume where you left off?' })
  await expect(dialog).toBeVisible({ timeout: 60000 })
  done = true
  await probe

  expect(failures, 'main-process evaluate failed while the prompt loaded').toBe(0)
  expect(maxGap, `main process stalled ${maxGap}ms`).toBeLessThan(MAX_MAIN_GAP_MS)
  await expect(dialog.getByText('[TEST] No Hang')).toBeVisible()
})
