import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'fs'

let app: ElectronApplication
let page: Page

// Isolated test directory — NEVER touch ~/.hive/
const TEST_DATA_DIR = join(require('os').tmpdir(), 'hive-e2e-taskgroup')
const TEST_DATA_FILE = join(TEST_DATA_DIR, 'data.json')

test.beforeAll(async () => {
  // Clean isolated test dir
  if (existsSync(TEST_DATA_DIR)) rmSync(TEST_DATA_DIR, { recursive: true })
  mkdirSync(TEST_DATA_DIR, { recursive: true })

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
    env: { ...process.env, NODE_ENV: 'test', HEADLESS: '1', HIVE_PORT: '17798', HIVE_DATA_DIR: TEST_DATA_DIR }
  })
  page = await app.firstWindow({ timeout: 60000 })
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(2000)
}, 120000)

test.afterAll(async () => {
  await app?.close()
  if (existsSync(TEST_DATA_DIR)) rmSync(TEST_DATA_DIR, { recursive: true })
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
    // Inactive card is anchored by the unique "+ Create Task Group" button
    // (the Task Group label itself is a <span>, not an <h3>, and the text
    // "Task Group" also appears in the tab nav so isn't unique on its own).
    await expect(page.getByRole('button', { name: '+ Create Task Group' })).toBeVisible()
    await expect(page.getByText('inactive')).toBeVisible()
  })
})

test.describe('Task Group Creation Flow', () => {
  test('can assign all 4 roles and create task group', async () => {
    // Go to Task Group tab
    await page.getByRole('button', { name: 'Task Group', exact: true }).click()
    await page.waitForTimeout(500)

    // Open modal
    await page.getByRole('button', { name: 'Create Task Group' }).click()
    await page.waitForTimeout(500)

    // Assign Manager (first dropdown) → Alice
    const selects = page.locator('select')
    await selects.nth(0).selectOption('a1') // Alice as Manager

    // Assign QA (second dropdown) → Charlie
    await selects.nth(1).selectOption('a3') // Charlie as QA

    // Assign Critic (third dropdown) → Diana
    await selects.nth(2).selectOption('a4') // Diana as Critic

    // Check Bob as Worker
    await page.locator('label:has-text("Bob")').locator('input[type="checkbox"]').check()
    await page.waitForTimeout(300)

    // Summary should be visible
    await expect(page.getByText('Alice manages 1 worker')).toBeVisible()

    // Create & Start should be enabled
    const createBtn = page.getByRole('button', { name: 'Create & Start' })
    await expect(createBtn).toBeEnabled()

    // Submit
    await createBtn.click()
    await page.waitForTimeout(1000)
  })

  test('after creation, empty state is gone', async () => {
    await expect(page.getByText('No active Task Group')).not.toBeVisible()
  })

  test('roles bar shows all assigned agents', async () => {
    // Should see role badges with agent names
    await expect(page.getByText('Alice').first()).toBeVisible()
    await expect(page.getByText('Bob').first()).toBeVisible()
    await expect(page.getByText('Charlie').first()).toBeVisible()
    await expect(page.getByText('Diana').first()).toBeVisible()
  })

  test('batch panel shows empty state', async () => {
    // The "Current Batch" status pill (with 'idle' text) only renders
    // when batch tasks exist (App.tsx ~1735 guards on bTasks.length > 0).
    // Without a batch, the empty-state copy is the user-visible signal.
    await expect(page.getByText('No tasks yet. Use /manager-whip-start to begin.')).toBeVisible()
  })

  test('control buttons are visible', async () => {
    await expect(page.getByText('⏸ Pause')).toBeVisible()
    await expect(page.getByText('🗑 Dissolve')).toBeVisible()
  })

  test('sidebar agents show role badges', async () => {
    // Role badges are small colored circles on avatar
    // Check that agents have taskGroupRole-related styling
    // The badge is a span with specific background colors
    const badges = page.locator('span.absolute.-top-1.-right-1')
    const count = await badges.count()
    expect(count).toBeGreaterThanOrEqual(4) // 4 agents with badges
  })

  test('Dashboard status card updates to active', async () => {
    await page.getByRole('button', { name: 'Dashboard', exact: true }).click()
    await page.waitForTimeout(500)
    // Once a task group exists, the inactive card (with "+ Create Task
    // Group") disappears. The active progress card only renders when
    // totalTasks > 0, so at this point (TG created, no batches yet) we
    // verify by asserting the inactive markers are gone.
    await expect(page.getByRole('button', { name: '+ Create Task Group' })).not.toBeVisible()
    await expect(page.getByText('inactive')).not.toBeVisible()
  })

  test('dissolve removes task group', async () => {
    // Go back to Task Group tab
    await page.getByRole('button', { name: 'Task Group', exact: true }).click()
    await page.waitForTimeout(500)

    // Click dissolve
    await page.getByText('🗑 Dissolve').click()
    await page.waitForTimeout(500)

    // Should return to empty state
    await expect(page.getByText('No active Task Group')).toBeVisible()
  })

  test('after dissolve, sidebar badges are removed', async () => {
    const badges = page.locator('span.absolute.-top-1.-right-1')
    const count = await badges.count()
    expect(count).toBe(0)
  })

  test('after dissolve, Dashboard shows inactive again', async () => {
    await page.getByRole('button', { name: 'Dashboard', exact: true }).click()
    await page.waitForTimeout(500)
    await expect(page.getByText('inactive')).toBeVisible()
  })
})
