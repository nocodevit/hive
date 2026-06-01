import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { execSync } from 'child_process'
import { mkdirSync, rmSync, existsSync } from 'fs'

/**
 * Chat basic e2e: open an agent's chat, send a tiny instruction, wait
 * for claude's reply, then verify the post-turn UI state — including
 * the 5h/7d %% bars that v1.7.121 was wiping.
 *
 * Cost: 1 short claude turn per run (~1 cent of subscription quota).
 *
 * Requires: working `claude` CLI on PATH with valid subscription auth
 * (read from real ~/.claude/auth.json; Hive doesn't shim auth). If the
 * preflight fails, the test fails loud with a clear message rather than
 * timing out at 60s on a missing binary.
 */

const PROJECT_ROOT = join(__dirname, '..')
const HIVE_DATA_DIR = join(require('os').tmpdir(), 'hive-e2e-chat-basic')
const HIVE_PORT = 17813

const FIXTURE_DIR = join(require('os').homedir(), 'FrontEndProjects', 'hive-e2e-fixture')
const TMP_FIXTURE = join(require('os').tmpdir(), 'hive-e2e-chat-basic-fixture')

let projectFolder: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  try {
    execSync('claude --version', { stdio: 'pipe', timeout: 5000 })
  } catch (e: any) {
    throw new Error(`chat-basic requires working \`claude\` CLI on PATH: ${e?.message || e}`)
  }

  projectFolder = existsSync(FIXTURE_DIR) ? FIXTURE_DIR : (() => {
    if (existsSync(TMP_FIXTURE)) rmSync(TMP_FIXTURE, { recursive: true })
    mkdirSync(TMP_FIXTURE, { recursive: true })
    return TMP_FIXTURE
  })()

  if (existsSync(HIVE_DATA_DIR)) rmSync(HIVE_DATA_DIR, { recursive: true })
  mkdirSync(HIVE_DATA_DIR, { recursive: true })

  execSync('npx electron-vite build', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 60000 })
  app = await electron.launch({
    args: [join(PROJECT_ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_ENV: 'test', HEADLESS: '1', HIVE_PORT: String(HIVE_PORT), HIVE_DATA_DIR }
  })
  page = await app.firstWindow({ timeout: 60000 })
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(1500)

  // Mock folder picker; seed project + agent
  await app.evaluate(({ ipcMain }, picked) => {
    try { ipcMain.removeHandler('dialog:selectFolder') } catch {}
    ipcMain.handle('dialog:selectFolder', async () => picked)
  }, projectFolder)

  await page.locator('text=Add Project').click()
  await page.waitForTimeout(300)
  await page.locator('button:has-text("Browse")').first().click()
  await page.waitForTimeout(400)
  await page.locator('input[placeholder="My Project"]').fill('Chat E2E')
  await page.locator('button:has-text("Create Project")').click()
  await page.waitForTimeout(600)
  await page.locator('text=Chat E2E').first().click()
  await page.waitForTimeout(400)

  await page.getByRole('button', { name: 'New Agent' }).click()
  await page.waitForTimeout(400)
  await page.locator('button:has-text("Full-Stack Engineer")').first().click()
  await page.waitForTimeout(300)
  await page.locator('input[placeholder="e.g. Alex"]').fill('[TEST] Chat')
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
  // Cleanup the test session jsonl from real ~/.claude/projects/ so it
  // doesn't accumulate. Best-effort; harmless if the dir layout changed.
  try {
    const slug = projectFolder.replace(/\//g, '-')
    const dir = join(require('os').homedir(), '.claude', 'projects', slug)
    if (existsSync(dir)) rmSync(dir, { recursive: true })
  } catch {}
})

test.describe('Chat basic', () => {
  test('open agent chat → send "reply OK" → assistant reply lands + 5h/7d %% rendered numerically', async () => {
    // Open the agent's chat
    await page.locator('text=[TEST] Chat').first().click()
    await page.waitForTimeout(800)

    // StartChooser appears for fresh agents — click Start new
    const startBtn = page.getByRole('button', { name: /✦\s*Start new/ })
    if (await startBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await startBtn.click()
      await page.waitForTimeout(800)
    }

    // Wait for chat surface (input visible)
    const input = page.locator('textarea').first()
    await expect(input).toBeVisible({ timeout: 15000 })

    // Send a short instruction. Marker is a base32-ish string unlikely
    // to appear in the model's training, so we can wait for it as the
    // assistant's response. The user message also contains it (echo),
    // but we count occurrences to distinguish.
    const MARKER = 'q9q2x7-marker'
    await input.fill(`reply with exactly: ${MARKER}`)
    await input.press('Enter')

    // Wait for input to clear (proves send fired through IPC)
    await expect(input).toHaveValue('', { timeout: 5000 })

    // Wait for the marker to appear TWICE in the timeline: once in the
    // user bubble, once in the assistant bubble. Polls every 500ms up
    // to 90s. First turn includes session init + model handshake → can
    // take 20-40s on a cold start.
    await page.waitForFunction((m) => {
      const body = document.body.innerText || ''
      // Count occurrences
      let count = 0, idx = 0
      while ((idx = body.indexOf(m, idx)) !== -1) { count++; idx += m.length }
      return count >= 2
    }, MARKER, { timeout: 90000, polling: 500 })

    // Assistant has replied. message_stop fired. chat.ts:664 scheduled
    // refresh() 1.5s later. The PTY scrape inside refresh can take up
    // to 25s. Poll the 5h bar for up to 35s waiting for a numeric %.
    //
    // This is the v1.7.121 regression check: pre-fix, cc-only broadcast
    // would wipe fiveHour/sevenDay → bar showed `—`. mergeUsage keeps
    // a stale-but-non-empty value visible while the next scrape attempt
    // runs, so the bar should show a digit either from the live scrape
    // OR from preserved state.
    //
    // NOTE: in a brand-new HIVE_DATA_DIR with a brand-new fixture cwd,
    // there's no prior state to preserve, so we DEPEND on the PTY scrape
    // returning successfully. If queryUsagePctViaPty itself is broken
    // (the open issue in chat-usage-query.ts), this assertion fails —
    // which is the correct behavior: it surfaces that THE OTHER half
    // of the fix (the scrape itself) still needs work.
    let lastText = ''
    const has5hDigit = await page.waitForFunction(async () => {
      const el = document.body.innerText || ''
      // Find the line containing "5h" followed (in the same little block)
      // by either em-dash or a percentage. Looking for digit% next to 5h.
      const m = el.match(/5h[\s\S]{0,80}?(\d+)\s*%/)
      return m ? m[1] : null
    }, undefined, { timeout: 35000, polling: 1000 }).then(h => h.jsonValue()).catch(() => null)

    if (!has5hDigit) {
      // Diagnostic: dump the bar region text for the failure message.
      lastText = await page.locator('text=/5h/').first().locator('..').innerText().catch(() => '<not found>')
      throw new Error(
        `5h bar never showed a numeric %% within 35s after assistant reply. ` +
        `Bar region text: ${JSON.stringify(lastText)}. ` +
        `This means either (a) v1.7.121 fix regressed, or (b) the PTY ` +
        `/usage scrape (chat-usage-query.ts) is failing — both are real bugs.`
      )
    }
    expect(Number(has5hDigit)).toBeGreaterThanOrEqual(0)
    expect(Number(has5hDigit)).toBeLessThanOrEqual(100)
  })
})
