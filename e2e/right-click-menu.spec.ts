import { test, expect, ElectronApplication, Page, Locator } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { execSync } from 'child_process'
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'

/** Right-click menus opened near the window's bottom or right edge stay inside the window. */

const PROJECT_ROOT = join(__dirname, '..')
const ROOT = join(tmpdir(), 'hive-e2e-right-click')
const HIVE_DATA_DIR = join(ROOT, 'data')

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true })
  const proj = join(ROOT, 'proj')
  mkdirSync(proj, { recursive: true })
  mkdirSync(HIVE_DATA_DIR, { recursive: true })
  writeFileSync(join(HIVE_DATA_DIR, 'data.json'), JSON.stringify({
    projects: [{ id: 'p1', name: 'Edgeproj', officePath: proj, zones: [{ id: 'z1', name: 'root', path: proj, type: 'rnd', hasGit: false }] }],
    agents: [{
      id: 'a1', projectId: 'p1', zoneId: 'z1', name: 'Planner', role: 'coder', type: 'coding', department: 'DATA', group: '', order: 0, status: 'done', soul: '',
      avatar: { skinTone: '#f5d0a9', hairStyle: 'short', hairColor: '#2c1810', topStyle: 'tee', topColor: '#7c3aed', bottomStyle: 'pants', bottomColor: '#1e293b', hat: 'none', accessories: [] },
      enabledSkills: [], preferences: { autoRunClaude: false, startupCommand: '' }, model: 'inherit', effort: 'high'
    }],
    appPrefs: {}, taskGroups: []
  }))
  execSync('npx electron-vite build', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 60000 })
  app = await electron.launch({
    args: [join(PROJECT_ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_ENV: 'test', HEADLESS: '1', HIVE_PORT: '17897', HIVE_DATA_DIR, CLAUDE_CONFIG_DIR: join(ROOT, 'claude-home') }
  })
  page = await app.firstWindow({ timeout: 60000 })
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close().catch(() => {})
})

const viewport = () => page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))

async function rightClickAt(target: Locator, x: number, y: number) {
  await target.dispatchEvent('contextmenu', { clientX: x, clientY: y, bubbles: true, cancelable: true })
}

async function expectInside(menu: Locator) {
  await expect(menu).toBeVisible()
  const { w, h } = await viewport()
  await expect.poll(async () => {
    const b = await menu.boundingBox()
    return !!b && b.x >= 0 && b.y >= 0 && b.x + b.width <= w && b.y + b.height <= h
  }).toBe(true)
}

test('agent menu opened at the bottom-right corner flips up and left', async () => {
  await page.getByText('Edgeproj').first().click()
  const { w, h } = await viewport()
  await rightClickAt(page.getByText('Planner').first(), w - 4, h - 4)
  const menu = page.getByRole('menu').filter({ has: page.getByRole('button', { name: /Set note/ }) })
  await expectInside(menu)
  await page.keyboard.press('Escape')
  await page.mouse.click(5, 5)
  await expect(menu).toHaveCount(0)
})

test('project menu opened at the bottom edge flips up', async () => {
  const { w, h } = await viewport()
  await rightClickAt(page.getByRole('button', { name: /Edgeproj/ }).first(), Math.min(200, w - 4), h - 4)
  const menu = page.getByRole('menu').first()
  await expectInside(menu)
})
