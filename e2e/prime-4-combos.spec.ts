// v2.12.0 diagnostic — real-Electron visual capture of every
// (theme × palette) combo that Prime supports. 4 screenshots into
// test-results/prime-4-combos/ for eyeball verification.

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
  dataDir = mkdtempSync(join(tmpdir(), 'hive-e2e-prime-4-'))
  outDir = join(__dirname, '..', 'test-results', 'prime-4-combos')
  mkdirSync(outDir, { recursive: true })

  app = await electron.launch({
    args: [join(__dirname, '..', 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_ENV: 'test', HEADLESS: '1', HIVE_PORT: '17805', HIVE_DATA_DIR: dataDir },
  })
  page = await app.firstWindow({ timeout: 60000 })
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(1500)

  const projectDir = mkdtempSync(join(tmpdir(), 'hive-e2e-prime-proj-'))
  await page.evaluate(async (path) => {
    const mkAgent = (id: string, name: string, status: 'working' | 'waiting' | 'done',
                    role: string, tone: string) => ({
      id, projectId: 'p-prime', zoneId: 'z1', name, role, type: 'coding',
      department: 'ENG', group: '', order: 0, status, soul: '',
      avatar: { skinTone: tone, hairStyle: 'short', hairColor: '#2c1810',
                topStyle: 'tee', topColor: '#7c3aed', bottomStyle: 'pants',
                bottomColor: '#1e293b', hat: 'none', accessories: [] },
      enabledSkills: [], preferences: { autoRunClaude: false, startupCommand: '' },
      model: 'inherit', effort: 'high',
    })
    const proj = { id: 'p-prime', name: 'PrimeDemo', officePath: path,
      zones: [{ id: 'z1', name: 'root', path, type: 'rnd', hasGit: false }] }
    await window.api.data.save({
      projects: [proj],
      agents: [
        mkAgent('a1', 'Missy',  'working', 'coder', '#f5d0a9'),
        mkAgent('a2', 'Drake',  'waiting', 'qa',    '#dba97a'),
        mkAgent('a3', 'Nancy',  'working', 'coder', '#c68642'),
        mkAgent('a4', 'Alex',   'done',    'design','#8d5524'),
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

test('capture all 4 Prime combos', async () => {
  await page.getByText('PrimeDemo').first().click()
  await page.waitForTimeout(400)

  const combos: Array<{ theme: 'light' | 'dark'; palette: 'neon-purple' | 'tech-blue' }> = [
    { theme: 'dark',  palette: 'neon-purple' },
    { theme: 'dark',  palette: 'tech-blue' },
    { theme: 'light', palette: 'neon-purple' },
    { theme: 'light', palette: 'tech-blue' },
  ]
  for (const { theme, palette } of combos) {
    await page.evaluate(([t, p]) => {
      const r = document.documentElement
      r.setAttribute('data-theme', t)
      r.setAttribute('data-style', 'prime')
      if (p === 'neon-purple') r.removeAttribute('data-palette')
      else r.setAttribute('data-palette', p)
    }, [theme, palette])
    await page.waitForTimeout(400)
    const shot = join(outDir, `prime-${theme}-${palette}.png`)
    await page.screenshot({ path: shot, fullPage: false })
    // eslint-disable-next-line no-console
    console.log(`[prime-4] captured ${shot}`)
  }
  // Also capture the accent baseline for reference.
  await page.evaluate(() => {
    const r = document.documentElement
    r.setAttribute('data-theme', 'dark')
    r.removeAttribute('data-style')
    r.removeAttribute('data-palette')
  })
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(outDir, 'accent-dark-neon-purple.png') })
  expect(true).toBe(true)
})
