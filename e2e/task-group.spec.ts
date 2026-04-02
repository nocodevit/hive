import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs'

let app: ElectronApplication
let page: Page

const TEST_DATA_DIR = join(require('os').homedir(), '.hive')
const TEST_DATA_FILE = join(TEST_DATA_DIR, 'data.json')
let originalData: string | null = null

test.beforeAll(async () => {
  if (existsSync(TEST_DATA_FILE)) {
    originalData = readFileSync(TEST_DATA_FILE, 'utf-8')
  }

  const avatar = { skinTone: '#f5d0a9', hairStyle: 'short', hairColor: '#2c1810', topStyle: 'tee', topColor: '#7c3aed', bottomStyle: 'pants', bottomColor: '#1e293b', hat: 'none', accessories: [] }
  const prefs = { autoRunClaude: false, startupCommand: '' }
  const mkAgent = (id: string, name: string, role: string, dept: string) => ({
    id, projectId: 'test-proj', zoneId: 'z1', name, role, type: 'coding', department: dept,
    group: '', order: 0, status: 'done', soul: `# ${role}`, avatar, enabledSkills: [],
    preferences: prefs, model: 'inherit', effort: 'high'
  })

  const testData = {
    projects: [{ id: 'test-proj', name: 'Test Project', officePath: '/tmp/test-proj',
      zones: [{ id: 'z1', name: 'src', path: '/tmp/test-proj', type: 'rnd', hasGit: false }] }],
    agents: [
      mkAgent('a1', 'Alice', 'GM', 'Non-R&D'),
      mkAgent('a2', 'Bob', 'Engineer', 'R&D'),
      mkAgent('a3', 'Charlie', 'QA', 'R&D'),
      mkAgent('a4', 'Diana', 'Engineer', 'R&D'),
    ],
    appPrefs: { autoRunClaude: false, maxLogs: 100, continueSession: false },
    taskGroups: []
  }

  if (!existsSync(TEST_DATA_DIR)) mkdirSync(TEST_DATA_DIR, { recursive: true })
  writeFileSync(TEST_DATA_FILE, JSON.stringify(testData, null, 2))

  const { execSync } = require('child_process')
  execSync('npx electron-vite build', { cwd: join(__dirname, '..'), stdio: 'pipe', timeout: 60000 })

  app = await electron.launch({
    args: [join(__dirname, '..', 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_ENV: 'test', HIVE_PORT: '17798' }
  })
  page = await app.firstWindow({ timeout: 60000 })
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(2000)
}, 120000)

test.afterAll(async () => {
  await app?.close()
  if (originalData) writeFileSync(TEST_DATA_FILE, originalData)
})

test.describe('Task Group Tab', () => {
  test('project shows 4 tab buttons', async () => {
    // Click project in sidebar first
    await page.locator('button:has-text("Test Project")').click()
    await page.waitForTimeout(1000)
    // Verify tabs are visible
    await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Office', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Task Group', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible()
  })

  test('Task Group tab shows empty state', async () => {
    await page.getByRole('button', { name: 'Task Group', exact: true }).click()
    await page.waitForTimeout(500)
    await expect(page.getByText('No active Task Group')).toBeVisible()
  })

  test('Create Task Group opens modal', async () => {
    await page.getByRole('button', { name: 'Create Task Group' }).click()
    await page.waitForTimeout(500)
    await expect(page.getByText('Manager').first()).toBeVisible()
    await expect(page.getByText('Workers').first()).toBeVisible()
  })

  test('Create & Start disabled without roles', async () => {
    const btn = page.getByRole('button', { name: 'Create & Start' })
    const cls = await btn.getAttribute('class')
    expect(cls).toContain('not-allowed')
  })

  test('can close modal', async () => {
    await page.getByRole('button', { name: 'Cancel' }).click()
    await page.waitForTimeout(300)
    await expect(page.getByText('No active Task Group')).toBeVisible()
  })

  test('Dashboard has Task Group status card', async () => {
    await page.getByRole('button', { name: 'Dashboard', exact: true }).click()
    await page.waitForTimeout(500)
    await expect(page.locator('h3:has-text("Task Group")')).toBeVisible()
    await expect(page.getByText('inactive')).toBeVisible()
  })
})
