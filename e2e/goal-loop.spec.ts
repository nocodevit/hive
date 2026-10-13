import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { execSync } from 'child_process'
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs'
import { tmpdir, homedir } from 'os'

/**
 * A stuck `/goal`: Claude has nothing left to do, but the goal's Stop hook
 * keeps sending it back, all inside one turn. Before this fix anything the
 * user typed — `/goal clear` included — only queued behind that loop.
 *
 * Real claude. The loop comes from a Stop hook in the fixture project that
 * always blocks — the same mechanism /goal uses, minus the model deciding
 * on its own whether the goal is hopeless (which made a real /goal end
 * after 0–5 rounds, at random). Claude Code itself gives up after 9
 * blocked rounds, so each loop lasts under a minute. Costs a few dozen
 * one-word turns.
 */

const PROJECT_ROOT = join(__dirname, '..')
const HIVE_DATA_DIR = join(tmpdir(), 'hive-e2e-goal-loop')
const FIXTURE = join(tmpdir(), 'hive-e2e-goal-loop-fixture')
const HIVE_PORT = 17821
const MARKER = 'g4t-preempt-marker'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  try {
    execSync('claude --version', { stdio: 'pipe', timeout: 5000 })
  } catch (e: any) {
    throw new Error(`goal-loop requires a working \`claude\` CLI on PATH: ${e?.message || e}`)
  }
  for (const d of [HIVE_DATA_DIR, FIXTURE]) {
    if (existsSync(d)) rmSync(d, { recursive: true })
    mkdirSync(d, { recursive: true })
  }
  mkdirSync(join(FIXTURE, '.claude'), { recursive: true })
  writeFileSync(join(FIXTURE, '.claude', 'settings.local.json'), JSON.stringify({
    hooks: { Stop: [{ hooks: [{ type: 'command', command: "echo 'not done yet: keep waiting' >&2; exit 2" }] }] }
  }, null, 2))
  execSync('npx electron-vite build', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 60000 })
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

  await page.getByText('Add Project').click()
  await page.getByRole('button', { name: 'Browse' }).first().click()
  await page.getByPlaceholder('My Project').fill('Goal E2E')
  await page.getByRole('button', { name: 'Create Project' }).click()
  await page.getByText('Goal E2E').first().click()
  await page.getByRole('button', { name: 'New Agent' }).click()
  await page.getByRole('button', { name: /Full-Stack Engineer/ }).first().click()
  await page.getByPlaceholder('e.g. Alex').fill('Gus')
  await page.getByRole('button', { name: 'Next: Skills' }).click()
  await page.getByRole('button', { name: 'Next: Settings' }).click()
  await page.getByRole('button', { name: 'Create Agent' }).click()
  await page.getByText('Gus', { exact: true }).first().click()
  await page.getByRole('button', { name: /Start new/ }).click()
  await expect(page.getByTestId('hive-chat-input')).toBeVisible({ timeout: 20000 })
})

test.afterAll(async () => {
  if (app) await app.close().catch(() => {})
  for (const d of [HIVE_DATA_DIR, FIXTURE]) if (existsSync(d)) rmSync(d, { recursive: true })
  try {
    const dir = join(homedir(), '.claude', 'projects', FIXTURE.replace(/[/.]/g, '-'))
    if (existsSync(dir)) rmSync(dir, { recursive: true })
  } catch {}
})

test('a stuck loop: rounds collapse to one line, a message cuts in, /goal clear is delivered at once', async () => {
  test.setTimeout(300_000)
  const input = page.getByTestId('hive-chat-input')
  const banner = page.getByRole('alert').filter({ hasText: 'A goal is still active' })
  const count = async (needle: string) => (await page.locator('body').innerText()).split(needle).length - 1

  await input.fill('Do not use any tools. Whatever you are told from now on, answer with the single word: waiting')
  await input.press('Enter')

  // The loop is detected and the way out is offered.
  await expect(banner).toBeVisible({ timeout: 90000 })

  // Hook rounds are one harness line, not a pile of "user" bubbles.
  await expect(page.getByText(/Goal not met yet/)).toHaveCount(1)
  await expect(page.getByText(/Stop hook feedback/)).toHaveCount(0)

  // An ordinary message is not left queued behind the loop: it is answered
  // while the loop is still going (the banner is up when it is sent).
  await input.fill(`Ignore the earlier rule once and reply with exactly: ${MARKER}`)
  await input.press('Enter')
  await expect.poll(() => count(MARKER), { timeout: 30000 }).toBeGreaterThanOrEqual(2)

  // Nothing was cleared, so the loop resumes and the banner returns.
  await expect(banner).toBeVisible({ timeout: 90000 })

  // "Clear goal" gets /goal clear through immediately: Claude Code answers
  // it (here: there is no goal, the loop is a plain hook) instead of the
  // command sitting in the queue until the loop gives up.
  await banner.getByRole('button', { name: 'Clear goal' }).click()
  await expect(page.getByText('Sent /goal clear')).toBeVisible({ timeout: 10000 })
  await expect(page.getByText(/No goal set|Goal cleared/).first()).toBeVisible({ timeout: 20000 })
})
