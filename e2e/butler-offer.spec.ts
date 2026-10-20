import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { execSync } from 'child_process'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, chmodSync } from 'fs'
import { tmpdir } from 'os'

/**
 * The one-time "Control Hive from your phone?" dialog: shown at launch to
 * someone with agents who never answered; "Not now" is final across a
 * restart; "Turn on" switches Butler on and opens App Settings, where
 * Remote Control is the first section. `claude` is a fake that never
 * connects (no real Remote Control session).
 */

const PROJECT_ROOT = join(__dirname, '..')
const ROOT = join(tmpdir(), 'hive-e2e-butler-offer')
const FAKE = join(ROOT, 'fake-claude')
const SWITCH = 'Allow remote control from my phone (Butler)'
const OFFER = 'Control Hive from your phone?'

let app: ElectronApplication | undefined
let page: Page

function seed(dataDir: string) {
  if (existsSync(dataDir)) rmSync(dataDir, { recursive: true })
  mkdirSync(dataDir, { recursive: true })
  const prefs = { autoRunClaude: false, startupCommand: '' }
  writeFileSync(join(dataDir, 'data.json'), JSON.stringify({
    projects: [{ id: 'p1', name: 'Offer Test', officePath: ROOT, zones: [{ id: 'z1', name: 'src', path: ROOT, type: 'rnd', hasGit: false }] }],
    agents: [{ id: 'a1', projectId: 'p1', zoneId: 'z1', name: 'Missy', role: 'Eng', type: 'coding', department: 'R&D', group: '', order: 0, status: 'done', soul: '', enabledSkills: [], preferences: prefs, model: 'inherit', effort: 'high' }],
    appPrefs: { autoRunClaude: false, maxLogs: 100, continueSession: false }
  }))
}

async function launch(dataDir: string) {
  app = await electron.launch({
    args: [join(PROJECT_ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_ENV: 'test', HEADLESS: '1', HIVE_PORT: '17829', HIVE_DATA_DIR: dataDir, HIVE_BUTLER_OFFER: '1', HIVE_CLAUDE_BIN: FAKE, CLAUDE_CONFIG_DIR: join(ROOT, 'claude-home') }
  })
  page = await app.firstWindow({ timeout: 60000 })
  await page.waitForLoadState('domcontentloaded')
}

test.beforeAll(() => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true })
  mkdirSync(join(ROOT, 'claude-home'), { recursive: true })
  writeFileSync(FAKE, '#!/bin/bash\nwhile true; do sleep 1; done\n')
  chmodSync(FAKE, 0o755)
  execSync('npx electron-vite build', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 60000 })
})

test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
})

test('"Not now" answers it for good', async () => {
  const dataDir = join(ROOT, 'data-not-now')
  seed(dataDir)
  await launch(dataDir)
  await expect(page.getByRole('dialog', { name: OFFER })).toBeVisible()
  await page.getByRole('button', { name: 'Not now' }).click()
  await expect(page.getByRole('dialog', { name: OFFER })).toBeHidden()
  expect(JSON.parse(readFileSync(join(dataDir, 'butler.json'), 'utf8'))).toMatchObject({ enabled: false, offered: true })

  await app!.close()
  await launch(dataDir)
  await expect(page.getByText('Offer Test').first()).toBeVisible()
  await expect(page.getByRole('dialog', { name: OFFER })).toHaveCount(0)
})

test('"Turn on" switches Butler on and shows it at the top of App Settings', async () => {
  const dataDir = join(ROOT, 'data-turn-on')
  seed(dataDir)
  await launch(dataDir)
  await page.getByRole('button', { name: 'Turn on' }).click()
  await expect(page.getByRole('heading', { name: 'App Settings' })).toBeVisible()
  await expect(page.getByRole('switch', { name: SWITCH })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByText('Connecting…')).toBeVisible()
  const remote = await page.getByText('Remote Control', { exact: true }).boundingBox()
  const style = await page.getByText('Visual style', { exact: true }).boundingBox()
  expect(remote!.y).toBeLessThan(style!.y)
})

test('no dialog for someone without agents yet', async () => {
  const dataDir = join(ROOT, 'data-empty')
  if (existsSync(dataDir)) rmSync(dataDir, { recursive: true })
  mkdirSync(dataDir, { recursive: true })
  await launch(dataDir)
  await expect(page.getByText('Add Project')).toBeVisible()
  await expect(page.getByRole('dialog', { name: OFFER })).toHaveCount(0)
})
