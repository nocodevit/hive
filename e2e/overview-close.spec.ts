import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'

let app: ElectronApplication
let page: Page
let dataDir: string

test.beforeAll(async () => {
  const { execSync } = require('child_process')
  execSync('npx electron-vite build', { cwd: join(__dirname, '..'), stdio: 'pipe', timeout: 90000 })
  dataDir = mkdtempSync(join(tmpdir(), 'hive-e2e-ov-close-'))
  app = await electron.launch({
    args: [join(__dirname, '..', 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_ENV: 'test', HEADLESS: '1', HIVE_PORT: '17803', HIVE_DATA_DIR: dataDir },
  })
  page = await app.firstWindow({ timeout: 60000 })
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(1500)
}, 120000)

test.afterAll(async () => {
  await app?.close()
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
})

test('Overview close X dismisses on first click', async () => {
  // Open Overview via the sidebar toggle
  const openBtn = page.getByRole('button', { name: /^Overview$/i })
  await openBtn.click()
  await page.waitForTimeout(400)

  // Verify Overview is visible
  const overviewH1 = page.getByRole('heading', { name: 'Overview' })
  await expect(overviewH1).toBeVisible()

  // Screenshot the close X area for eyeball
  const closeBtn = page.getByRole('button', { name: /Close Overview/i })
  await expect(closeBtn).toBeVisible()
  await closeBtn.screenshot({ path: join(dataDir, 'close-btn.png') })

  // Single click — should dismiss
  await closeBtn.click()
  await page.waitForTimeout(400)
  await expect(overviewH1).not.toBeVisible()
})
