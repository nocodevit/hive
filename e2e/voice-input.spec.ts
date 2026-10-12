import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { execSync } from 'child_process'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { tmpdir, homedir } from 'os'

/**
 * Voice input, window side: the composer's mic pill → App → input box.
 * The microphone helper is replaced by a stub in the main process (the
 * `speech:*` IPC handlers), which then plays the helper's part by sending
 * the same `speech:transcript` lines main would. No microphone, no cloud.
 *
 * Starts one claude session (no turn is sent), like chat-basic.spec.ts.
 */

const PROJECT_ROOT = join(__dirname, '..')
const HIVE_DATA_DIR = join(tmpdir(), 'hive-e2e-voice-input')
const FIXTURE = join(tmpdir(), 'hive-e2e-voice-input-fixture')
const HIVE_PORT = 17819

let app: ElectronApplication
let page: Page

const calls = () => app.evaluate(() => (globalThis as any).__speechCalls as Array<{ op: string; lang?: string }>)
const line = (text: string) =>
  app.evaluate(({ BrowserWindow }, l) => BrowserWindow.getAllWindows()[0].webContents.send('speech:transcript', l), text)

test.beforeAll(async () => {
  try {
    execSync('claude --version', { stdio: 'pipe', timeout: 5000 })
  } catch (e: any) {
    throw new Error(`voice-input requires a working \`claude\` CLI on PATH: ${e?.message || e}`)
  }
  for (const d of [HIVE_DATA_DIR, FIXTURE]) {
    if (existsSync(d)) rmSync(d, { recursive: true })
    mkdirSync(d, { recursive: true })
  }
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
    const g = globalThis as any
    g.__speechCalls = []
    for (const ch of ['speech:start', 'speech:stop']) { try { ipcMain.removeHandler(ch) } catch {} }
    ipcMain.handle('speech:start', (_e, opts) => { g.__speechCalls.push({ op: 'start', lang: opts?.lang }); return { ok: true } })
    ipcMain.handle('speech:stop', () => { g.__speechCalls.push({ op: 'stop' }); return { ok: true } })
  }, FIXTURE)

  await page.getByText('Add Project').click()
  await page.getByRole('button', { name: 'Browse' }).first().click()
  await page.getByPlaceholder('My Project').fill('Voice E2E')
  await page.getByRole('button', { name: 'Create Project' }).click()
  await page.getByText('Voice E2E').first().click()
  await page.getByRole('button', { name: 'New Agent' }).click()
  await page.getByRole('button', { name: /Full-Stack Engineer/ }).first().click()
  await page.getByPlaceholder('e.g. Alex').fill('Vera')
  await page.getByRole('button', { name: 'Next: Skills' }).click()
  await page.getByRole('button', { name: 'Next: Settings' }).click()
  await page.getByRole('button', { name: 'Create Agent' }).click()
  await page.getByText('Vera', { exact: true }).first().click()
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

test('mic pill: start in 中文, preview, finals land in the input in order, stop', async () => {
  const input = page.getByTestId('hive-chat-input')

  await page.getByRole('button', { name: 'Voice input' }).click()
  await expect(page.getByRole('button', { name: 'Stop listening' })).toBeVisible()
  expect(await calls()).toEqual([{ op: 'start', lang: 'zh-CN' }])

  // Live preview shows next to the mic, and does not touch the input.
  await line('partial:我现在想说')
  await expect(page.getByText('我现在想说', { exact: true })).toBeVisible()
  await expect(input).toHaveValue('')

  // A finished sentence goes into the input and the preview clears.
  await line('final:我现在想说 project，completion date 是明天')
  await expect(input).toHaveValue('我现在想说 project，completion date 是明天')
  await expect(page.getByText('我现在想说', { exact: true })).toBeHidden()

  // The next sentence is appended: no stray space after Chinese punctuation…
  await line('final:by end of day')
  await expect(input).toHaveValue('我现在想说 project，completion date 是明天by end of day')
  // …and a space only between two Latin words.
  await line('final:please')
  await expect(input).toHaveValue('我现在想说 project，completion date 是明天by end of day please')

  // Nothing was sent to the agent — dictation only fills the box (a send
  // would have emptied it), and Send is there for the user to press.
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled()

  await page.getByRole('button', { name: 'Stop listening' }).click()
  await expect(page.getByRole('button', { name: 'Voice input' })).toBeVisible()
  expect((await calls()).map(c => c.op)).toEqual(['start', 'stop'])

  // Lines after stop are ignored.
  await line('final:should not appear')
  await expect(input).not.toHaveValue(/should not appear/)
})

test('language chip switches the next session to English', async () => {
  await page.getByRole('button', { name: '中', exact: true }).click()
  await expect(page.getByRole('button', { name: 'EN', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Voice input' }).click()
  await expect(page.getByRole('button', { name: 'Stop listening' })).toBeVisible()
  expect((await calls()).at(-1)).toEqual({ op: 'start', lang: 'en-US' })
  await page.getByRole('button', { name: 'Stop listening' }).click()
  await expect(page.getByRole('button', { name: 'Voice input' })).toBeVisible()
  await page.getByRole('button', { name: 'EN', exact: true }).click()
})

test('a cloud failure is shown; a helper that dies resets the button', async () => {
  await page.getByRole('button', { name: 'Voice input' }).click()
  await expect(page.getByRole('button', { name: 'Stop listening' })).toBeVisible()

  await line('notice:cloud transcription failed (openai_http_401) — using macOS recognition')
  await expect(page.getByRole('status')).toContainText('openai_http_401')
  // Still listening: the fallback keeps voice input working.
  await expect(page.getByRole('button', { name: 'Stop listening' })).toBeVisible()

  await line('exit:audio engine failed to start')
  await expect(page.getByRole('button', { name: 'Voice input' })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('audio engine failed to start')

  // Starting again clears the old message.
  await page.getByRole('button', { name: 'Voice input' }).click()
  await expect(page.getByRole('button', { name: 'Stop listening' })).toBeVisible()
  await expect(page.getByRole('status')).toHaveCount(0)
  await page.getByRole('button', { name: 'Stop listening' }).click()
})
