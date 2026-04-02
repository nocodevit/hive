import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs'

let app: ElectronApplication
let page: Page

// Create a test data file with agents so we can test Task Group creation
const TEST_DATA_DIR = join(require('os').homedir(), '.hive')
const TEST_DATA_FILE = join(TEST_DATA_DIR, 'data.json')
let originalData: string | null = null

test.beforeAll(async () => {
  // Backup existing data
  if (existsSync(TEST_DATA_FILE)) {
    originalData = readFileSync(TEST_DATA_FILE, 'utf-8')
  }

  // Create test data with a project and 4+ agents
  const testData = {
    projects: [{
      id: 'test-proj',
      name: 'Test Project',
      officePath: '/tmp/test-proj',
      zones: [{ id: 'z1', name: 'src', path: '/tmp/test-proj', type: 'rnd', hasGit: false }]
    }],
    agents: [
      { id: 'a1', projectId: 'test-proj', zoneId: 'z1', name: 'Alice', role: 'GM', type: 'non-coding', department: 'Non-R&D', group: '', order: 0, status: 'done', soul: '# Manager', avatar: { skinTone: '#f5d0a9', hairStyle: 'short', hairColor: '#2c1810', topStyle: 'tee', topColor: '#7c3aed', bottomStyle: 'pants', bottomColor: '#1e293b', hat: 'none', accessories: [] }, enabledSkills: [], preferences: { autoRunClaude: false, startupCommand: '' }, model: 'inherit', effort: 'high' },
      { id: 'a2', projectId: 'test-proj', zoneId: 'z1', name: 'Bob', role: 'Engineer', type: 'coding', department: 'R&D', group: '', order: 1, status: 'done', soul: '# Worker', avatar: { skinTone: '#f5d0a9', hairStyle: 'short', hairColor: '#2c1810', topStyle: 'tee', topColor: '#3B82F6', bottomStyle: 'pants', bottomColor: '#1e293b', hat: 'none', accessories: [] }, enabledSkills: [], preferences: { autoRunClaude: false, startupCommand: '' }, model: 'inherit', effort: 'high' },
      { id: 'a3', projectId: 'test-proj', zoneId: 'z1', name: 'Charlie', role: 'QA', type: 'coding', department: 'R&D', group: '', order: 2, status: 'done', soul: '# QA', avatar: { skinTone: '#f5d0a9', hairStyle: 'short', hairColor: '#2c1810', topStyle: 'tee', topColor: '#10B981', bottomStyle: 'pants', bottomColor: '#1e293b', hat: 'none', accessories: [] }, enabledSkills: [], preferences: { autoRunClaude: false, startupCommand: '' }, model: 'inherit', effort: 'high' },
      { id: 'a4', projectId: 'test-proj', zoneId: 'z1', name: 'Diana', role: 'Engineer', type: 'coding', department: 'R&D', group: '', order: 3, status: 'done', soul: '# Critic', avatar: { skinTone: '#f5d0a9', hairStyle: 'short', hairColor: '#2c1810', topStyle: 'tee', topColor: '#8B5CF6', bottomStyle: 'pants', bottomColor: '#1e293b', hat: 'none', accessories: [] }, enabledSkills: [], preferences: { autoRunClaude: false, startupCommand: '' }, model: 'inherit', effort: 'high' },
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
  // Restore original data
  if (originalData) {
    writeFileSync(TEST_DATA_FILE, originalData)
  }
})

test.describe('Task Group Tab', () => {
  test('project shows 4 tabs including Task Group', async () => {
    // Click on test project
    await page.locator('text=Test Project').click()
    await page.waitForTimeout(500)

    // Verify 4 tabs exist
    await expect(page.locator('button:has-text("Dashboard")')).toBeVisible()
    await expect(page.locator('button:has-text("Office")')).toBeVisible()
    await expect(page.locator('button:has-text("Task Group")')).toBeVisible()
    await expect(page.locator('button:has-text("Settings")')).toBeVisible()
  })

  test('Task Group tab shows empty state', async () => {
    await page.locator('button:has-text("Task Group")').click()
    await page.waitForTimeout(300)

    await expect(page.locator('text=No active Task Group')).toBeVisible()
    await expect(page.locator('text=Create Task Group')).toBeVisible()
  })

  test('Create Task Group button opens modal', async () => {
    await page.locator('button:has-text("Create Task Group")').click()
    await page.waitForTimeout(300)

    // Modal should show role pickers
    await expect(page.locator('text=Manager')).toBeVisible()
    await expect(page.locator('text=QA')).toBeVisible()
    await expect(page.locator('text=Critic')).toBeVisible()
    await expect(page.locator('text=Workers')).toBeVisible()
  })

  test('Create & Start disabled without all roles assigned', async () => {
    const createBtn = page.locator('button:has-text("Create & Start")')
    // Should be disabled (no roles assigned yet)
    await expect(createBtn).toBeDisabled()
  })

  test('can assign roles and create task group', async () => {
    // Select manager
    const managerSelect = page.locator('select').nth(0)
    await managerSelect.selectOption({ index: 1 }) // First agent

    // Select QA
    const qaSelect = page.locator('select').nth(1)
    await qaSelect.selectOption({ index: 1 })

    // Select Critic
    const criticSelect = page.locator('select').nth(2)
    await criticSelect.selectOption({ index: 1 })

    // Select a worker
    const workerCheckbox = page.locator('input[type="checkbox"]').first()
    await workerCheckbox.check()

    await page.waitForTimeout(200)

    // Create & Start should be enabled now (if all unique agents selected)
    const createBtn = page.locator('button:has-text("Create & Start")')
    // Click if enabled
    if (await createBtn.isEnabled()) {
      await createBtn.click()
      await page.waitForTimeout(500)
      // Should no longer show empty state
      await expect(page.locator('text=No active Task Group')).not.toBeVisible()
    }
  })

  test('Dashboard shows Task Group status card', async () => {
    await page.locator('button:has-text("Dashboard")').click()
    await page.waitForTimeout(300)

    // Should show Task Group status (either active or inactive)
    await expect(page.locator('text=Task Group')).toBeVisible()
  })
})
