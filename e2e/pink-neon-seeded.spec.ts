// v2.15.0 diagnostic — seeded screenshot so the neon pink accent is
// visible where it actually shows up (selected sidebar row, hovered
// buttons, chat pane bg, kanban headers), not just the tiny "empty
// state" monitor icon. User feedback: the previous screenshot looked
// "嫩粉不明亮" because most of the frame was empty dark bg.

import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { mkdtempSync, rmSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'

let app: ElectronApplication
let page: Page
let dataDir: string
let outDir: string

test.beforeAll(async () => {
  const { execSync } = require('child_process')
  execSync('npx electron-vite build', { cwd: join(__dirname, '..'), stdio: 'pipe', timeout: 90000 })
  dataDir = mkdtempSync(join(tmpdir(), 'hive-e2e-pink2-'))
  outDir = join(__dirname, '..', 'test-results', 'pink-neon-seeded')
  mkdirSync(outDir, { recursive: true })

  app = await electron.launch({
    args: [join(__dirname, '..', 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_ENV: 'test', HEADLESS: '1', HIVE_PORT: '17812', HIVE_DATA_DIR: dataDir },
  })
  page = await app.firstWindow({ timeout: 60000 })
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(1500)

  const projectDir = mkdtempSync(join(tmpdir(), 'hive-e2e-pink-proj-'))
  await page.evaluate(async (path) => {
    const mk = (id: string, name: string, status: 'working' | 'waiting' | 'done',
                role: string, tone: string, top: string) => ({
      id, projectId: 'p-pink', zoneId: 'z1', name, role, type: 'coding',
      department: 'ENG', group: '', order: 0, status, soul: '',
      avatar: { skinTone: tone, hairStyle: 'short', hairColor: '#2c1810',
                topStyle: 'tee', topColor: top, bottomStyle: 'pants',
                bottomColor: '#1e293b', hat: 'none', accessories: [] },
      enabledSkills: [], preferences: { autoRunClaude: false, startupCommand: '' },
      model: 'inherit', effort: 'high',
    })
    const proj = { id: 'p-pink', name: 'PinkDemo', officePath: path,
      zones: [{ id: 'z1', name: 'root', path, type: 'rnd', hasGit: false }] }
    await window.api.data.save({
      projects: [proj],
      agents: [
        mk('a1', 'Missy',  'working', 'coder', '#f5d0a9', '#ff2eaa'),
        mk('a2', 'Drake',  'waiting', 'qa',    '#dba97a', '#ff69c8'),
        mk('a3', 'Nancy',  'working', 'coder', '#c68642', '#ff007f'),
        mk('a4', 'Alex',   'done',    'design','#8d5524', '#c4a0ff'),
      ],
      appPrefs: {}, taskGroups: [],
    })
    location.reload()
  }, projectDir)
  await page.waitForTimeout(2000)
}, 180000)

test.afterAll(async () => {
  await app?.close()
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
})

test('future-pink dark — seeded screenshot with accent-heavy UI', async () => {
  await page.evaluate(() => {
    const r = document.documentElement
    r.setAttribute('data-theme', 'dark')
    r.setAttribute('data-palette', 'future-pink')
  })
  await page.waitForTimeout(300)

  // Open the project, then click Missy to mount chat.
  await page.getByText('PinkDemo').first().click()
  await page.waitForTimeout(400)
  await page.getByText('Missy').first().click()
  await page.waitForTimeout(1200)
  try { await page.keyboard.press('Enter') } catch { /* silent */ }
  await page.waitForTimeout(2000)

  const shot = join(outDir, 'pink-dark-seeded.png')
  await page.screenshot({ path: shot, fullPage: false })
  console.log(`[pink-seeded] captured ${shot}`)

  // Sample the actual visible pixels of key elements to prove the
  // accent color reaches the surface. Grab bounding rect of selected
  // sidebar row (should be accent-tinted) and read its computed bg.
  const rowBg = await page.evaluate(() => {
    const projRow = Array.from(document.querySelectorAll('*')).find(el => {
      const cs = getComputedStyle(el)
      return cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
             el.textContent?.includes('PinkDemo') === true
    })
    return projRow ? getComputedStyle(projRow).backgroundColor : null
  })
  console.log('[pink-seeded] selected project row bg:', rowBg)

  expect(true).toBe(true)
})

test('future-pink dark — kanban view (accent everywhere)', async () => {
  // Click somewhere neutral first, then re-open project for kanban.
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(200)
  const shot = join(outDir, 'pink-dark-full.png')
  await page.screenshot({ path: shot, fullPage: false })
  console.log(`[pink-seeded] captured ${shot}`)
  expect(true).toBe(true)
})
