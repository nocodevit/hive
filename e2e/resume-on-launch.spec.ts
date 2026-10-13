import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { execSync } from 'child_process'
import { mkdirSync, rmSync, existsSync, readFileSync, realpathSync } from 'fs'
import { tmpdir, homedir } from 'os'

/**
 * Opening Hive offers to resume the chats that were still open when it
 * last closed — and only those. Real claude; three short turns.
 */

const PROJECT_ROOT = join(__dirname, '..')
// Real path: on macOS os.tmpdir() is a symlink (/var → /private/var) and
// claude files a session under the resolved path, so the unresolved one
// would look like a project with no saved sessions.
const TMP = realpathSync(tmpdir())
const HIVE_DATA_DIR = join(TMP, 'hive-e2e-resume-on-launch')
const FIXTURE = join(TMP, 'hive-e2e-resume-on-launch-fixture')
const HIVE_PORT = 17823
const TASK_AVA = 'Do not use any tools. Reply with exactly: ava-kept-open'
const TASK_BEN = 'Do not use any tools. Reply with exactly: ben-closed-by-hand'

let app: ElectronApplication | undefined
let page: Page

async function launch() {
  app = await electron.launch({
    args: [join(PROJECT_ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_ENV: 'test', HEADLESS: '1', HIVE_PORT: String(HIVE_PORT), HIVE_DATA_DIR }
  })
  page = await app.firstWindow({ timeout: 60000 })
  await page.waitForLoadState('domcontentloaded')
  await app.evaluate(({ ipcMain }, picked) => {
    try { ipcMain.removeHandler('dialog:selectFolder') } catch {}
    ipcMain.handle('dialog:selectFolder', async () => picked)
  }, FIXTURE)
}
async function quit() {
  await app?.close().catch(() => {})
  app = undefined
}
const liveAgents = async (): Promise<Record<string, boolean>> => {
  const token = readFileSync(join(HIVE_DATA_DIR, 'api-token'), 'utf-8').trim()
  const res = await fetch(`http://127.0.0.1:${HIVE_PORT}/agents`, { headers: { 'X-Hive-Token': token } })
  const body = await res.json()
  return Object.fromEntries(body.agents.map((a: any) => [a.agent, a.chatLive]))
}
async function addAgent(name: string) {
  await page.getByRole('button', { name: 'New Agent' }).click()
  await page.getByRole('button', { name: /Full-Stack Engineer/ }).first().click()
  await page.getByPlaceholder('e.g. Alex').fill(name)
  await page.getByRole('button', { name: 'Next: Skills' }).click()
  await page.getByRole('button', { name: 'Next: Settings' }).click()
  await page.getByRole('button', { name: 'Create Agent' }).click()
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible()
}
async function startAndSend(name: string, task: string, marker: string) {
  await page.getByText(name, { exact: true }).first().click()
  await page.getByRole('button', { name: /Start new/ }).click()
  const input = page.getByTestId('hive-chat-input').and(page.locator(':visible'))
  await expect(input).toBeVisible({ timeout: 20000 })
  await input.fill(task)
  await input.press('Enter')
  await expect.poll(async () => (await page.locator('body').innerText()).split(marker).length - 1, { timeout: 90000 }).toBeGreaterThanOrEqual(2)
}

test.beforeAll(async () => {
  try {
    execSync('claude --version', { stdio: 'pipe', timeout: 5000 })
  } catch (e: any) {
    throw new Error(`resume-on-launch requires a working \`claude\` CLI on PATH: ${e?.message || e}`)
  }
  for (const d of [HIVE_DATA_DIR, FIXTURE]) {
    if (existsSync(d)) rmSync(d, { recursive: true })
    mkdirSync(d, { recursive: true })
  }
  execSync('npx electron-vite build', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 60000 })
})

test.afterAll(async () => {
  await quit()
  for (const d of [HIVE_DATA_DIR, FIXTURE]) if (existsSync(d)) rmSync(d, { recursive: true })
  try {
    const dir = join(homedir(), '.claude', 'projects', FIXTURE.replace(/[/.]/g, '-'))
    if (existsSync(dir)) rmSync(dir, { recursive: true })
  } catch {}
})

test('restart offers the chats left open, ticked by default; Resume brings them back; Not now forgets them', async () => {
  test.setTimeout(420_000)
  const dialog = () => page.getByRole('dialog', { name: 'Resume where you left off?' })

  // ── First run: nothing to offer on a fresh install. ────────────────
  await launch()
  await page.getByText('Add Project').click()
  await expect(dialog()).toHaveCount(0)
  await page.getByRole('button', { name: 'Browse' }).first().click()
  await page.getByPlaceholder('My Project').fill('Relaunch E2E')
  await page.getByRole('button', { name: 'Create Project' }).click()
  await page.getByText('Relaunch E2E').first().click()
  await addAgent('Ava')
  await addAgent('Ben')
  await addAgent('Cy')   // never started

  // Ben runs first and is closed by hand; Ava is then started and left
  // running. (Agents in a folder without git share one session bucket, and
  // resume picks its newest session — so the one left open goes last.)
  await startAndSend('Ben', TASK_BEN, 'ben-closed-by-hand')
  await page.getByRole('button', { name: 'close ✕' }).and(page.locator(':visible')).click()
  await page.getByRole('button', { name: 'OK · close session' }).click()
  await expect.poll(liveAgents, { timeout: 15000 }).toMatchObject({ Ben: false })
  await startAndSend('Ava', TASK_AVA, 'ava-kept-open')
  await expect.poll(liveAgents, { timeout: 15000 }).toMatchObject({ Ava: true, Ben: false, Cy: false })

  // ── Quit and reopen. ───────────────────────────────────────────────
  await quit()
  await launch()

  await expect(dialog()).toBeVisible({ timeout: 15000 })
  await expect(dialog()).toContainText('1 agent had its chat open')
  // Project, agent, the last task and its context are listed…
  const ava = dialog().getByRole('checkbox', { name: 'Relaunch E2E / Ava' })
  await expect(ava).toBeChecked()
  await expect(dialog()).toContainText('Ava')
  await expect(dialog()).toContainText('Relaunch E2E')
  await expect(dialog()).toContainText(TASK_AVA)
  await expect(dialog()).toContainText(/context \d+%/)
  // …and only the chat that was actually open: not the one closed by hand,
  // not the agent that never ran.
  await expect(dialog()).not.toContainText('Ben')
  await expect(dialog()).not.toContainText('Cy')
  // Nothing has been started yet.
  expect(await liveAgents()).toMatchObject({ Ava: false, Ben: false, Cy: false })

  // Everything ticked by default; Select all toggles; Resume needs a pick.
  const selectAll = dialog().getByRole('checkbox', { name: 'Select all' })
  await expect(selectAll).toBeChecked()
  await expect(dialog().getByRole('button', { name: 'Resume (1)' })).toBeEnabled()
  await ava.uncheck()
  await expect(selectAll).not.toBeChecked()
  await expect(dialog()).toContainText('0 of 1 selected')
  await expect(dialog().getByRole('button', { name: 'Resume', exact: true })).toBeDisabled()
  await selectAll.check()
  await expect(ava).toBeChecked()

  await dialog().getByRole('button', { name: 'Resume (1)' }).click()
  await expect(dialog()).toHaveCount(0)
  await expect.poll(liveAgents, { timeout: 120000 }).toMatchObject({ Ava: true, Ben: false, Cy: false })

  // The resumed chat carries its history.
  await page.getByText('Relaunch E2E').first().click()
  await page.getByText('Ava', { exact: true }).first().click()
  await expect(page.getByText('ava-kept-open').first()).toBeVisible({ timeout: 30000 })

  // ── Ava is open again at the next quit → offered again; "Not now" drops it. ──
  await quit()
  await launch()
  await expect(dialog()).toBeVisible({ timeout: 15000 })
  await dialog().getByRole('button', { name: 'Not now' }).click()
  await expect(dialog()).toHaveCount(0)
  expect(await liveAgents()).toMatchObject({ Ava: false })

  await quit()
  await launch()
  await expect(page.getByText('Add Project')).toBeVisible({ timeout: 15000 })
  await page.getByText('Relaunch E2E').first().click()
  await expect(page.getByText('Ava', { exact: true }).first()).toBeVisible()
  await expect(dialog()).toHaveCount(0)
})
