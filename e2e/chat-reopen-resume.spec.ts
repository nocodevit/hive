import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { execSync } from 'child_process'
import { mkdirSync, rmSync, existsSync, readdirSync, readFileSync } from 'fs'

/**
 * Chat reopen → Resume → send e2e: the EXACT user-reported bug.
 *
 * User's words: "本地dev server hive 启动agent，有session后 关闭，再打开hive,
 * 然后start page , 点击 resume！ … 加载了对话，但是完全没有任何 reaction".
 * i.e. after CLOSING the whole app and REOPENING it, clicking Resume loads
 * the conversation history (replaySessionHistory reads the local JSONL) but
 * sending a message gets NO response.
 *
 * Why a separate spec from chat-compact-resume: that one resumes a session
 * within a SINGLE app lifetime (the in-memory `sessions` Map still holds the
 * claudeSid + startOpts). This bug only shows after a FULL app restart, when
 * the Map is empty and the renderer must rebuild the session purely from
 * StartChooser → chat.start({resumeSid}). So the test MUST close the
 * ElectronApplication and relaunch it against the SAME HIVE_DATA_DIR.
 *
 * Flow:
 *   1. create project + agent, Start new, send turn 1, wait reply
 *   2. app.close()  ← the "关闭 hive" step
 *   3. relaunch electron, same HIVE_DATA_DIR  ← "再打开 hive"
 *   4. open agent → StartChooser → click Resume → confirm latest session
 *   5. wait for history to load AND the live child to come up
 *   6. send turn 2 → ASSERT a reply arrives (the bug = no reply)
 *
 * On failure we dump the v1.7.136 `_meta` spawn/stderr/exit records from the
 * chat log so the root cause (why the resumed claude produced no response)
 * is visible in CI output instead of being silently swallowed.
 *
 * Cost: ~2 short claude turns per run.
 */

const PROJECT_ROOT = join(__dirname, '..')
const HIVE_DATA_DIR = join(require('os').tmpdir(), 'hive-e2e-reopen-resume')
const HIVE_PORT = 17816

const FIXTURE_DIR = join(require('os').homedir(), 'FrontEndProjects', 'hive-e2e-fixture')
// Fixture lives under $HOME with a DOT-FREE name, faithfully matching the
// user's real ~/Development/<project> paths. Two macOS-only pitfalls this
// avoids, both of which would falsely disable Resume by making
// getPrevSessionInfo derive a ~/.claude/projects bucket that doesn't match
// what claude actually wrote:
//   - os.tmpdir() (/var/folders/…) → claude canonicalizes via the /private
//     symlink to /private/var/folders/…; getPrevSessionInfo does a plain
//     string replace and never adds /private → bucket mismatch.
//   - a leading-dot dir (e.g. .hive-e2e) → claude replaces '.' with '-' in
//     its bucket slug, but getPrevSessionInfo only replaces '/' → mismatch.
// Real projects (~/Development/psle-alex-web) have neither, so a plain
// dot-free $HOME dir reproduces the real environment.
const TMP_FIXTURE = join(require('os').homedir(), 'hive-e2e-reopen-resume-fixture')

let projectFolder: string
let app: ElectronApplication
let page: Page

async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  const a = await electron.launch({
    args: [join(PROJECT_ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_ENV: 'test', HEADLESS: '1', HIVE_PORT: String(HIVE_PORT), HIVE_DATA_DIR }
  })
  const p = await a.firstWindow({ timeout: 60000 })
  await p.waitForLoadState('domcontentloaded')
  await p.waitForTimeout(1500)
  // Stub the folder picker so "Browse" resolves to our fixture repo.
  await a.evaluate(({ ipcMain }, picked) => {
    try { ipcMain.removeHandler('dialog:selectFolder') } catch {}
    ipcMain.handle('dialog:selectFolder', async () => picked)
  }, projectFolder)
  return { app: a, page: p }
}

async function send(p: Page, text: string, marker: string, waitMs = 90000) {
  const input = p.locator('textarea').first()
  await input.fill(`${text} — say exactly: ${marker}`)
  await input.press('Enter')
  await expect(input).toHaveValue('', { timeout: 5000 })
  await p.waitForFunction((m) => {
    const body = document.body.innerText || ''
    let count = 0, idx = 0
    while ((idx = body.indexOf(m, idx)) !== -1) { count++; idx += m.length }
    return count >= 2
  }, marker, { timeout: waitMs, polling: 500 })
}

/** Dump the v1.7.136 forensic records so a failed resume explains itself. */
function dumpChatLogMeta(): string {
  try {
    const dir = join(HIVE_DATA_DIR, 'chat-logs')
    if (!existsSync(dir)) return '<no chat-logs dir>'
    const files = readdirSync(dir).filter(f => f.endsWith('.jsonl'))
    const lines: string[] = []
    for (const f of files) {
      for (const ln of readFileSync(join(dir, f), 'utf8').split('\n')) {
        if (ln.includes('"_meta"')) lines.push(`${f}: ${ln}`)
      }
    }
    return lines.length ? lines.join('\n') : '<no _meta records>'
  } catch (e) {
    return `<dump failed: ${e}>`
  }
}

test.beforeAll(async () => {
  try {
    execSync('claude --version', { stdio: 'pipe', timeout: 5000 })
  } catch (e: any) {
    throw new Error(`chat-reopen-resume requires working \`claude\` CLI on PATH: ${e?.message || e}`)
  }

  projectFolder = existsSync(FIXTURE_DIR) ? FIXTURE_DIR : (() => {
    if (existsSync(TMP_FIXTURE)) rmSync(TMP_FIXTURE, { recursive: true })
    mkdirSync(TMP_FIXTURE, { recursive: true })
    return TMP_FIXTURE
  })()

  if (existsSync(HIVE_DATA_DIR)) rmSync(HIVE_DATA_DIR, { recursive: true })
  mkdirSync(HIVE_DATA_DIR, { recursive: true })

  execSync('npx electron-vite build', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 60000 })
  ;({ app, page } = await launchApp())

  // Create project + agent
  await page.locator('text=Add Project').click()
  await page.waitForTimeout(300)
  await page.locator('button:has-text("Browse")').first().click()
  await page.waitForTimeout(400)
  await page.locator('input[placeholder="My Project"]').fill('Reopen E2E')
  await page.locator('button:has-text("Create Project")').click()
  await page.waitForTimeout(600)
  await page.locator('text=Reopen E2E').first().click()
  await page.waitForTimeout(400)

  await page.getByRole('button', { name: 'New Agent' }).click()
  await page.waitForTimeout(400)
  await page.locator('button:has-text("Full-Stack Engineer")').first().click()
  await page.waitForTimeout(300)
  await page.locator('input[placeholder="e.g. Alex"]').fill('[TEST] Reopen')
  await page.getByRole('button', { name: 'Next: Skills' }).click()
  await page.waitForTimeout(200)
  await page.getByRole('button', { name: 'Next: Settings' }).click()
  await page.waitForTimeout(200)
  await page.getByRole('button', { name: 'Create Agent' }).click()
  await page.waitForTimeout(800)
})

test.afterAll(async () => {
  if (app) await app.close().catch(() => {})
  if (existsSync(HIVE_DATA_DIR)) rmSync(HIVE_DATA_DIR, { recursive: true })
  if (projectFolder === TMP_FIXTURE && existsSync(TMP_FIXTURE)) {
    rmSync(TMP_FIXTURE, { recursive: true })
  }
  try {
    const slug = projectFolder.replace(/\//g, '-')
    const dir = join(require('os').homedir(), '.claude', 'projects', slug)
    if (existsSync(dir)) rmSync(dir, { recursive: true })
  } catch {}
})

test.describe('Chat reopen → Resume → send', () => {
  test('after closing + reopening the app, Resume then send still gets a reply', async () => {
    // ── 1. fresh session + first turn (creates the JSONL on disk) ──────
    await page.locator('text=[TEST] Reopen').first().click()
    await page.waitForTimeout(800)
    const startBtn = page.getByRole('button', { name: /✦\s*Start new/ })
    if (await startBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await startBtn.click()
      await page.waitForTimeout(800)
    }
    await send(page, 'first turn before restart', 'mark-pre-restart-AAA')

    // ── 2. CLOSE the whole app (关闭 hive) ─────────────────────────────
    await app.close()
    app = undefined as any

    // ── 3. REOPEN against the same HIVE_DATA_DIR (再打开 hive) ──────────
    ;({ app, page } = await launchApp())

    // Select project (sidebar lists only agents of the selected project).
    await page.locator('text=Reopen E2E').first().click()
    await page.waitForTimeout(500)

    // ── 4. open the agent → StartChooser → Resume → confirm latest ─────
    await page.locator('text=[TEST] Reopen').first().click()
    await page.waitForTimeout(800)

    // The 4-way picker's Resume button (label "Resume", desc "pick session").
    const resumeBtn = page.locator('button').filter({ hasText: /↻\s*Resume/ }).first()
    await expect(resumeBtn).toBeVisible({ timeout: 10000 })
    await resumeBtn.click()
    await page.waitForTimeout(800)

    // openPicker has a UX shortcut: when exactly ONE session is on disk it
    // skips the inline picker and launches immediately (single-session case,
    // which this fixture is). When 2+ sessions exist a Confirm button appears
    // carrying the sid suffix ("↻ Resume <8hex>"). Handle both: click Confirm
    // if it shows up, otherwise the resume already launched.
    const confirmBtn = page.locator('button').filter({ hasText: /Resume\s+[0-9a-f]{8}/ }).first()
    if (await confirmBtn.isVisible({ timeout: 2500 }).catch(() => false)) {
      await confirmBtn.click()
    }

    // ── 5. history loads from the local JSONL replay ───────────────────
    await expect(page.locator('text=mark-pre-restart-AAA').first()).toBeVisible({ timeout: 30000 })

    // ── 6. THE BUG CHECK: send a new turn, a reply MUST arrive ─────────
    try {
      await send(page, 'second turn after resume', 'mark-post-resume-BBB', 120000)
    } catch (e) {
      // If the resumed child was dead, the v1.7.137 surface shows "Message
      // not sent (...)". Either way, dump the forensic _meta records so the
      // root cause is visible instead of a bare timeout.
      const surfaced = await page.evaluate(() => {
        const body = document.body.innerText || ''
        const m = body.match(/Message not sent \(([^)]+)\)/)
        return m ? m[1] : null
      })
      throw new Error(
        `[REOPEN-RESUME BUG] No reply after Resume + send.` +
        (surfaced ? ` send() surfaced error: ${surfaced}.` : ` send() reported ok but claude produced no stream.`) +
        `\n--- chat-log _meta records ---\n${dumpChatLogMeta()}\n--- original ---\n${e}`
      )
    }
  })
})
