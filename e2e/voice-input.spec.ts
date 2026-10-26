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

const calls = () => app.evaluate(() => (globalThis as any).__speechCalls as Array<{ op: string }>)
const line = (text: string) =>
  app.evaluate(({ BrowserWindow }, l) => BrowserWindow.getAllWindows()[0].webContents.send('speech:transcript', l), text)

/**
 * The input's value once `ms` (longer than the auto-send pause) has really
 * elapsed. Throws if it changed in the meantime, i.e. something was sent.
 */
async function stillUnsentAfter(ms: number, input: ReturnType<Page['getByTestId']>): Promise<string> {
  const before = await input.inputValue()
  const until = Date.now() + ms
  await expect.poll(async () => {
    expect(await input.inputValue()).toBe(before)
    return Date.now() >= until
  }, { timeout: ms + 3000, intervals: [250] }).toBe(true)
  return before
}

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
    ipcMain.handle('speech:start', () => { g.__speechCalls.push({ op: 'start' }); return { ok: true } })
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

test('mic pill: start, preview, finals land in the input in order, stop', async () => {
  const input = page.getByTestId('hive-chat-input')

  await page.getByRole('button', { name: 'Voice input' }).click()
  await expect(page.getByRole('button', { name: 'Stop listening' })).toBeVisible()
  expect(await calls()).toEqual([{ op: 'start' }])

  // Live preview shows in full inside the input box, and does not touch the typed text.
  await line('partial:我现在想说')
  await expect(page.getByLabel('Hearing')).toHaveText('🎙 我现在想说')
  await expect(input).toHaveValue('')

  // A finished sentence goes into the input and the preview clears.
  await line('final:我现在想说 project，completion date 是明天')
  await expect(input).toHaveValue('我现在想说 project，completion date 是明天')
  await expect(page.getByLabel('Hearing')).toBeHidden()

  // The next sentence is appended: no stray space after Chinese punctuation…
  await line('final:by end of day')
  await expect(input).toHaveValue('我现在想说 project，completion date 是明天by end of day')
  // …and a space only between two Latin words.
  await line('final:please')
  await expect(input).toHaveValue('我现在想说 project，completion date 是明天by end of day please')

  // Nothing was sent to the agent — dictation only fills the box (a send
  // would have emptied it), and Send is there for the user to press.
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
  // Auto-send is off by default: no countdown, however long the pause.
  await expect(page.getByRole('button', { name: 'Auto send' })).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('button', { name: /秒后发送/ })).toHaveCount(0)

  await page.getByRole('button', { name: 'Stop listening' }).click()
  await expect(page.getByRole('button', { name: 'Voice input' })).toBeVisible()
  expect((await calls()).map(c => c.op)).toEqual(['start', 'stop'])

  // Lines after stop are ignored.
  await line('final:should not appear')
  await expect(input).not.toHaveValue(/should not appear/)
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

test('hold 🎙: the pair becomes a recording bar with a waveform; let go keeps the words, let go on ✕ drops them', async () => {
  const input = page.getByTestId('hive-chat-input')
  await input.fill('')
  const before = (await calls()).length
  const mic = page.getByRole('button', { name: 'Voice input' })
  const box = (await mic.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  const bar = page.getByRole('group', { name: 'Recording' })
  await expect(bar).toBeVisible()
  await expect(bar.getByRole('button', { name: 'Cancel recording' })).toBeVisible()
  await expect.poll(async () => (await calls()).slice(before).map(c => c.op)).toEqual(['start'])
  for (const db of [-55, -30, -18, -25]) await line(`level:${db}`)
  await expect(bar.getByRole('img', { name: 'Live waveform' })).toBeVisible()
  await expect(page.getByText('Release to finish')).toBeVisible()
  await line('final:按住说的话')
  await expect(input).toHaveValue('按住说的话')
  await page.mouse.up()
  await expect(bar).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Voice input' })).toBeVisible()
  expect((await calls()).slice(before).map(c => c.op)).toEqual(['start', 'stop'])

  // Hold again, slide onto ✕, let go: listening stops and nothing more lands.
  const mark = (await calls()).length
  await page.getByRole('button', { name: 'Voice input' }).hover()
  await page.mouse.down()
  await expect(bar).toBeVisible()
  await line('partial:不要了')
  const x = (await bar.getByRole('button', { name: 'Cancel recording' }).boundingBox())!
  await page.mouse.move(x.x + x.width / 2, x.y + x.height / 2, { steps: 4 })
  await expect(page.getByText('Release to cancel')).toBeVisible()
  await page.mouse.up()
  await expect(bar).toHaveCount(0)
  await expect.poll(async () => (await calls()).slice(mark).map(c => c.op)).toEqual(['start', 'stop'])
  await line('final:不要了')
  await expect(input).toHaveValue('按住说的话')
  await expect(page.getByLabel('Hearing')).toBeHidden()
})

test('let go: the bar shrinks back with its waveform fading, not cut off; reduced motion turns the animation off', async () => {
  const mic = page.getByRole('button', { name: 'Voice input' })
  await mic.hover()
  await page.mouse.down()
  const bar = page.getByRole('group', { name: 'Recording' })
  await expect(bar).toBeVisible()
  await expect.poll(() => bar.evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(250)
  await page.mouse.up()
  const group = page.getByRole('group', { name: 'Attach and voice' })
  // Mid-shrink the waveform is still there (fading), then it goes.
  expect(await group.evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(70)
  await expect(group.getByRole('img', { name: 'Live waveform' })).toHaveCount(0)
  await expect.poll(() => group.evaluate(el => el.getBoundingClientRect().width)).toBeLessThan(70)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await group.evaluate(el => getComputedStyle(el).transitionDuration)).toMatch(/^0s/)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
})

test('＋ attaches files: their paths go into the input', async () => {
  await app.evaluate(({ ipcMain }) => {
    try { ipcMain.removeHandler('dialog:selectFiles') } catch {}
    ipcMain.handle('dialog:selectFiles', async () => ['/tmp/a.png', '/tmp/my notes.md'])
  })
  const input = page.getByTestId('hive-chat-input')
  await input.fill('看下')
  await page.getByRole('button', { name: 'Attach files' }).click()
  await expect(input).toHaveValue('看下 /tmp/a.png "/tmp/my notes.md" ')
  await input.fill('')
})

test('auto-send: counts down after the last sentence, cancels on speech or typing, then sends and keeps listening', async () => {
  const input = page.getByTestId('hive-chat-input')
  const countdown = page.getByRole('button', { name: /秒后发送/ })
  const MARKER = 'v9x-autosend-marker'
  await input.fill('')

  await page.getByRole('button', { name: 'Auto send' }).click()
  await expect(page.getByRole('button', { name: 'Auto send' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Voice input' }).click()
  await expect(page.getByRole('button', { name: 'Stop listening' })).toBeVisible()

  // Two sentences back to back: no countdown while the second is on its way.
  await line('speaking:')
  await line('speaking:')
  await line('final:Do not use any tools.')
  await expect(input).toHaveValue('Do not use any tools.')
  await expect(countdown).toHaveCount(0)
  await line(`final:Reply with exactly: ${MARKER}`)
  await expect(countdown).toBeVisible()

  // Speaking again cancels; noise that gets dropped re-arms.
  await line('speaking:')
  await expect(countdown).toHaveCount(0)
  await line('dropped:')
  await expect(countdown).toBeVisible()

  // Typing takes over: cancelled, and it stays unsent well past the pause.
  await input.press('End')
  await input.pressSequentially(' ')
  await expect(countdown).toHaveCount(0)
  await line('speaking:')
  await line('dropped:')
  await expect(countdown).toHaveCount(0)
  expect(await stillUnsentAfter(3500, input)).toContain(MARKER)

  // Clicking the countdown cancels too.
  await line('speaking:')
  await line('final:please')
  await expect(countdown).toBeVisible()
  await countdown.click()
  await expect(countdown).toHaveCount(0)
  await expect(input).toHaveValue(/please$/)

  // A fresh sentence, then silence: it sends by itself.
  await line('speaking:')
  await line('final:thanks')
  await expect(countdown).toBeVisible()
  await expect(input).toHaveValue('', { timeout: 6000 })
  await expect(page.getByText(new RegExp(`Reply with exactly: ${MARKER}`))).toBeVisible()

  // Still listening for the next message; turning the switch off mid-countdown cancels.
  await expect(page.getByRole('button', { name: 'Stop listening' })).toBeVisible()
  await line('speaking:')
  await line('final:one more')
  await expect(countdown).toBeVisible()
  await page.getByRole('button', { name: 'Auto send' }).click()
  await expect(countdown).toHaveCount(0)
  expect(await stillUnsentAfter(3500, input)).toBe('one more')

  await page.getByRole('button', { name: 'Stop listening' }).click()
  await expect(page.getByRole('button', { name: 'Voice input' })).toBeVisible()
})
