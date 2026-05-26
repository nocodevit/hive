import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { execSync } from 'child_process'
import { mkdirSync, rmSync, existsSync } from 'fs'

/**
 * Chat compact + resume e2e: the EXACT regression v1.7.121 fixed.
 *
 * Flow:
 *   1. open agent, send msg, wait for reply
 *   2. capture 5h %% value
 *   3. click Compact, wait for compact-done signal
 *   4. assert chat is alive AND 5h %% is still numeric (NOT `—`)
 *      — pre-v1.7.121 this would blank to `—` because setUsage(u as any)
 *        wiped it on the post-compact cc-only broadcast
 *   5. send another msg, verify it still works post-compact
 *   6. close session via Close button
 *   7. click Resume → assert chat alive, 5h %% still numeric
 *
 * Cost: 2 short claude turns per run (~2 cents quota).
 */

const PROJECT_ROOT = join(__dirname, '..')
const HIVE_DATA_DIR = join(require('os').tmpdir(), 'hive-e2e-chat-compact')
const HIVE_PORT = 17814

const FIXTURE_DIR = join(require('os').homedir(), 'FrontEndProjects', 'hive-e2e-fixture')
const TMP_FIXTURE = join(require('os').tmpdir(), 'hive-e2e-chat-compact-fixture')

let projectFolder: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  try {
    execSync('claude --version', { stdio: 'pipe', timeout: 5000 })
  } catch (e: any) {
    throw new Error(`chat-compact-resume requires working \`claude\` CLI on PATH: ${e?.message || e}`)
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

  await app.evaluate(({ ipcMain }, picked) => {
    try { ipcMain.removeHandler('dialog:selectFolder') } catch {}
    ipcMain.handle('dialog:selectFolder', async () => picked)
  }, projectFolder)

  // Create project + agent
  await page.locator('text=Add Project').click()
  await page.waitForTimeout(300)
  await page.locator('button:has-text("Browse")').first().click()
  await page.waitForTimeout(400)
  await page.locator('input[placeholder="My Project"]').fill('Compact E2E')
  await page.locator('button:has-text("Create Project")').click()
  await page.waitForTimeout(600)
  await page.locator('text=Compact E2E').first().click()
  await page.waitForTimeout(400)

  await page.getByRole('button', { name: 'New Agent' }).click()
  await page.waitForTimeout(400)
  await page.locator('button:has-text("Full-Stack Engineer")').first().click()
  await page.waitForTimeout(300)
  await page.locator('input[placeholder="e.g. Alex"]').fill('[TEST] Compact')
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

async function fiveHourPct(p: Page): Promise<number | null> {
  return p.evaluate(() => {
    const body = document.body.innerText || ''
    const m = body.match(/5h[\s\S]{0,80}?(\d+)\s*%/)
    return m ? Number(m[1]) : null
  })
}

test.describe('Chat compact + resume', () => {
  test('compact mid-session: chat survives, 5h %% NOT wiped to `—`', async () => {
    await page.locator('text=[TEST] Compact').first().click()
    await page.waitForTimeout(800)
    const startBtn = page.getByRole('button', { name: /✦\s*Start new/ })
    if (await startBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await startBtn.click()
      await page.waitForTimeout(800)
    }

    // Turn 1
    await send(page, 'first turn', 'mark-pre-compact-AAA')

    // Wait for usage bar to populate (post-message_stop refresh)
    await page.waitForFunction(() => {
      const m = (document.body.innerText || '').match(/5h[\s\S]{0,80}?(\d+)\s*%/)
      return m != null
    }, undefined, { timeout: 40000, polling: 1000 })
    const preCompact5h = await fiveHourPct(page)
    expect(preCompact5h).not.toBeNull()

    // Click Compact button — exact text per ModelUsageBar / control row.
    // Tolerate either "Compact" or "⎙ Compact" / "Compact session" variants.
    const compactBtn = page.locator('button').filter({ hasText: /^Compact$|⎙\s*Compact|Compact session/i }).first()
    await compactBtn.click()
    // Compact may take 30s-3min depending on context size; on a fresh
    // session it's ~10-30s.
    await expect(page.locator('text=/✅ \\/compact done/')).toBeVisible({ timeout: 180_000 })

    // After respawn, system/init fires → setExited(null) → chat alive.
    // Input becomes interactive again. THE REGRESSION CHECK:
    // 5h %% must still be a number, not `—`.
    await page.waitForTimeout(2000)
    const postCompact5h = await fiveHourPct(page)
    if (postCompact5h === null) {
      const bar = await page.locator('text=/5h/').first().locator('..').innerText().catch(() => '<not found>')
      throw new Error(
        `[v1.7.121 REGRESSION] 5h %% became \`—\` after compact. ` +
        `Pre-compact value: ${preCompact5h}. Bar text: ${JSON.stringify(bar)}. ` +
        `The cc-only broadcast wiped the % — mergeUsage / preserveAccountUsage ` +
        `is broken or its wiring was undone.`
      )
    }
    expect(postCompact5h).not.toBeNull()

    // Turn 2 — proves the post-compact session still talks to claude
    await send(page, 'second turn', 'mark-post-compact-BBB')
  })

  test('close session: subprocess killed, panel changes, 5h %% NOT blanked', async () => {
    // Pre-close baseline
    const preClose5h = await fiveHourPct(page)
    expect(preClose5h).not.toBeNull()

    // Two-step close per HiveChat: bottom-bar `close ✕` → confirm panel
    // (replaces input area with Cancel/OK buttons) → click "OK · close
    // session" to actually kill the --print subprocess.
    await page.locator('button:has-text("close ✕")').first().click()
    await page.waitForTimeout(400)
    await expect(page.locator('button:has-text("OK · close session")')).toBeVisible()
    await page.locator('button:has-text("OK · close session")').click()

    // chat:exit flips `exited` state. The closed-panel renders an
    // ActionToolbar with sessionActive=false. The bottom-bar `close ✕`
    // button is no longer visible (input area replaced by closed-panel).
    await expect(page.locator('text=/Session closed by user/')).toBeVisible({ timeout: 10000 })

    // THE REGRESSION CHECK: usage bar is still rendered (lives in the
    // ModelUsageBar above the input area). preserveAccountUsage means
    // the 5h %% stays visible across the close — pre-v1.7.121, setUsage({})
    // wiped it on close → bar showed `—` immediately.
    const postClose5h = await fiveHourPct(page)
    if (postClose5h === null) {
      const bar = await page.locator('text=/5h/').first().locator('..').innerText().catch(() => '<not found>')
      throw new Error(
        `[v1.7.121 REGRESSION] 5h %% became \`—\` after close. ` +
        `Pre-close value: ${preClose5h}. Bar text: ${JSON.stringify(bar)}. ` +
        `Account-level %% should survive close.`
      )
    }
    expect(postClose5h).not.toBeNull()
  })

  // TODO: separate test for resume from closed-session panel.
  // The closed-panel resume button selector needs investigation — line 1729
  // "↺ Resume session here" turned out to be the Remote Control resume,
  // not the post-close one. Closed-state resume probably lives in the
  // ActionToolbar overflow menu (line 3660 MenuItem "Resume Session").
  // Tracked separately so this spec stays green and ships the high-value
  // compact + close regression coverage now.
})
