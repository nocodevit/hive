// User bubble on a narrow chat panel: a long unbreakable word (URL, path)
// must wrap inside the bubble instead of running past its background.
// Real Electron, one short claude turn (needs `claude` on PATH).
import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir, homedir } from 'os'
import { execSync } from 'child_process'

const PROJECT_ROOT = join(__dirname, '..')
const LONG = 'https://example.com/' + 'verylongpathsegment'.repeat(12)

let app: ElectronApplication
let page: Page
let dataDir: string
let projectFolder: string

test.beforeAll(async () => {
  execSync('claude --version', { stdio: 'pipe', timeout: 5000 })
  dataDir = mkdtempSync(join(tmpdir(), 'hive-e2e-bubble-'))
  projectFolder = mkdtempSync(join(tmpdir(), 'hive-e2e-bubble-proj-'))
  execSync('npx electron-vite build', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 90000 })
  app = await electron.launch({
    args: [join(PROJECT_ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_ENV: 'test', HEADLESS: '1', HIVE_PORT: '17831', HIVE_DATA_DIR: dataDir }
  })
  page = await app.firstWindow({ timeout: 60000 })
  await page.waitForLoadState('domcontentloaded')
  await app.evaluate(({ ipcMain }, picked) => {
    try { ipcMain.removeHandler('dialog:selectFolder') } catch {}
    ipcMain.handle('dialog:selectFolder', async () => picked)
  }, projectFolder)

  await page.getByText('Add Project').click()
  await page.getByRole('button', { name: 'Browse' }).first().click()
  await page.getByPlaceholder('My Project').fill('Bubble E2E')
  await page.getByRole('button', { name: 'Create Project' }).click()
  await page.getByText('Bubble E2E').first().click()
  await page.getByRole('button', { name: 'New Agent' }).click()
  await page.getByRole('button', { name: /Full-Stack Engineer/ }).first().click()
  await page.getByPlaceholder('e.g. Alex').fill('[TEST] Bubble')
  await page.getByRole('button', { name: 'Next: Skills' }).click()
  await page.getByRole('button', { name: 'Next: Settings' }).click()
  await page.getByRole('button', { name: 'Create Agent' }).click()
}, 180000)

test.afterAll(async () => {
  await app?.close().catch(() => {})
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
  if (projectFolder) {
    rmSync(projectFolder, { recursive: true, force: true })
    const sessions = join(homedir(), '.claude', 'projects', projectFolder.replace(/[/.]/g, '-'))
    if (existsSync(sessions)) rmSync(sessions, { recursive: true, force: true })
  }
})

const overflow = () => page.getByText(LONG, { exact: true }).evaluate(span => {
  const bubble = span.parentElement!.getBoundingClientRect()
  const text = span.getBoundingClientRect()
  return { textRight: Math.round(text.right), bubbleRight: Math.round(bubble.right), scroll: span.scrollWidth, width: span.clientWidth }
})

test('long word wraps inside the user bubble when the chat panel is narrow', async () => {
  await page.getByText('[TEST] Bubble').first().click()
  const start = page.getByRole('button', { name: /✦\s*Start new/ })
  if (await start.isVisible({ timeout: 5000 }).catch(() => false)) await start.click()
  const input = page.locator('textarea').first()
  await expect(input).toBeVisible({ timeout: 15000 })
  await input.fill(LONG)
  await input.press('Enter')
  await expect(page.getByText(LONG, { exact: true })).toBeVisible({ timeout: 90000 })

  // Narrow the chat panel the way a user does: drag the Files divider left.
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1500, 900) })
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeGreaterThan(1400)
  // Side panels grow to their 400px cap; the chat gets what is left.
  for (let i = 0; i < 3; i++) {
    const handles = await page.evaluate(() => [...document.querySelectorAll('div')]
      .filter(d => getComputedStyle(d).cursor === 'col-resize')
      .map(d => { const r = d.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }))
    const h = handles[i]
    await page.mouse.move(h.x, h.y)
    await page.mouse.down()
    for (let dx = 50; dx <= 400; dx += 50) await page.mouse.move(h.x + dx, h.y)
    await page.mouse.up()
  }
  const bubbleWidth = await page.getByText(LONG, { exact: true }).evaluate(span => Math.round(span.parentElement!.parentElement!.getBoundingClientRect().width))
  console.log('chat column width after drag:', bubbleWidth, await overflow())
  await page.screenshot({ path: join(PROJECT_ROOT, 'test-results', 'user-bubble-after-drag.png') })
  expect(bubbleWidth).toBeLessThan(500)

  const m = await overflow()
  await page.screenshot({ path: join(PROJECT_ROOT, 'test-results', 'user-bubble-narrow.png') })
  expect(m.textRight).toBeLessThanOrEqual(m.bubbleRight)
  expect(m.scroll).toBeLessThanOrEqual(m.width + 1)

  // Control: without the fix the same text runs past the bubble.
  await page.getByText(LONG, { exact: true }).evaluate(span => { span.style.minWidth = ''; span.style.overflowWrap = '' })
  const before = await overflow()
  await page.screenshot({ path: join(PROJECT_ROOT, 'test-results', 'user-bubble-narrow-before.png') })
  expect(before.textRight).toBeGreaterThan(before.bubbleRight)
})
