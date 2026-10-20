import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { execSync } from 'child_process'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, chmodSync } from 'fs'
import { tmpdir } from 'os'

/**
 * The one-time "Set up Hive with Butler?" card: shown at launch to
 * someone with agents who never answered; "Not now" is final across a
 * restart; "Start" opens the setup wizard. `claude` is a fake that never
 * connects (no real Remote Control session).
 */

const PROJECT_ROOT = join(__dirname, '..')
const ROOT = join(tmpdir(), 'hive-e2e-butler-offer')
const FAKE = join(ROOT, 'fake-claude')
const OFFER = 'Set up Hive with Butler?'

let app: ElectronApplication | undefined
let page: Page

function seed(dataDir: string) {
  if (existsSync(dataDir)) rmSync(dataDir, { recursive: true })
  mkdirSync(dataDir, { recursive: true })
  const prefs = { autoRunClaude: false, startupCommand: '' }
  const avatar = { skinTone: '#f5d0a9', hairStyle: 'short', hairColor: '#2c1810', topStyle: 'tee', topColor: '#7c3aed', bottomStyle: 'pants', bottomColor: '#1e293b', hat: 'none', accessories: [] }
  writeFileSync(join(dataDir, 'data.json'), JSON.stringify({
    projects: [{ id: 'p1', name: 'Offer Test', officePath: ROOT, zones: [{ id: 'z1', name: 'src', path: ROOT, type: 'rnd', hasGit: false }] }],
    agents: [{ avatar, id: 'a1', projectId: 'p1', zoneId: 'z1', name: 'Missy', role: 'Eng', type: 'coding', department: 'R&D', group: '', order: 0, status: 'done', soul: '', enabledSkills: [], preferences: prefs, model: 'inherit', effort: 'high' }],
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

test('"Start" opens the setup wizard and answers the offer', async () => {
  const dataDir = join(ROOT, 'data-turn-on')
  seed(dataDir)
  await launch(dataDir)
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByRole('dialog', { name: 'Butler setup' })).toBeVisible()
  await expect(page.getByRole('dialog', { name: OFFER })).toHaveCount(0)
  await expect.poll(() => JSON.parse(readFileSync(join(dataDir, 'butler.json'), 'utf8')).offered).toBe(true)
})

test('no dialog for someone without agents yet', async () => {
  const dataDir = join(ROOT, 'data-empty')
  if (existsSync(dataDir)) rmSync(dataDir, { recursive: true })
  mkdirSync(dataDir, { recursive: true })
  await launch(dataDir)
  await expect(page.getByText('Add Project')).toBeVisible()
  await expect(page.getByRole('dialog', { name: OFFER })).toHaveCount(0)
})
