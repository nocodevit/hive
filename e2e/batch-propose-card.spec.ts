/**
 * Isolated test: POST /batch-propose → UI shows proposal card
 * Uses its own Electron instance on port 17795, isolated data dir
 */
import { test, expect } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'fs'

const PROJECT_ROOT = join(__dirname, '..')
const HIVE_PORT = 17795
const TEST_DATA_DIR = join(require('os').tmpdir(), 'hive-e2e-propose')

test('batch-propose HTTP triggers UI proposal card', async () => {
  // Setup isolated data with a project + task group
  if (existsSync(TEST_DATA_DIR)) rmSync(TEST_DATA_DIR, { recursive: true })
  mkdirSync(TEST_DATA_DIR, { recursive: true })

  const avatar = { skinTone: '#f5d0a9', hairStyle: 'short', hairColor: '#2c1810', topStyle: 'tee', topColor: '#7c3aed', bottomStyle: 'pants', bottomColor: '#1e293b', hat: 'none', accessories: [] }
  const prefs = { autoRunClaude: false, startupCommand: '' }

  writeFileSync(join(TEST_DATA_DIR, 'data.json'), JSON.stringify({
    projects: [{ id: 'p1', name: 'Test', officePath: '/tmp/test',
      zones: [{ id: 'z1', name: 'src', path: '/tmp/test', type: 'rnd', hasGit: false }] }],
    agents: [
      { id: 'mgr', projectId: 'p1', zoneId: 'z1', name: 'Mgr', role: 'GM', type: 'non-coding', department: 'Non-R&D', group: '', order: 0, status: 'done', soul: '', avatar, enabledSkills: [], preferences: prefs, model: 'inherit', effort: 'high', taskGroupRole: 'manager' },
      { id: 'w1', projectId: 'p1', zoneId: 'z1', name: 'W1', role: 'Eng', type: 'coding', department: 'R&D', group: '', order: 1, status: 'done', soul: '', avatar, enabledSkills: [], preferences: prefs, model: 'inherit', effort: 'high', taskGroupRole: 'worker' },
    ],
    appPrefs: { autoRunClaude: false, maxLogs: 100, continueSession: false },
    taskGroups: [{
      id: 'tg1', projectId: 'p1', status: 'executing',
      managerId: 'mgr', workerIds: ['w1'], qaId: 'mgr', criticId: 'mgr',
      currentBatch: 0, todoSource: 'todo.md', maxGateRetries: 3
    }]
  }, null, 2))

  // Build + launch
  const { execSync } = require('child_process')
  execSync('npx electron-vite build', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 60000 })

  const app = await electron.launch({
    args: [join(PROJECT_ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_ENV: 'test', HEADLESS: '1', HIVE_PORT: String(HIVE_PORT), HIVE_DATA_DIR: TEST_DATA_DIR }
  })
  const page = await app.firstWindow({ timeout: 120000 })
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(3000)

  // Select project + go to Task Group tab
  await page.locator('button:has-text("Test")').click()
  await page.waitForTimeout(1000)
  await page.getByRole('button', { name: 'Task Group', exact: true }).click()
  await page.waitForTimeout(500)

  // Verify task group is showing (not empty state)
  await expect(page.getByText('Mgr').first()).toBeVisible()

  // Screenshot BEFORE
  await page.screenshot({ path: join(PROJECT_ROOT, 'test-multi-agent-report', 'propose-before.png') })

  // POST batch-propose with agentId so server can find task group
  const result = await page.evaluate(async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/batch-propose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'mgr',
        batch: 1,
        tasks: [
          { title: 'Create alpha.md', scope: 'src/' },
          { title: 'Create bravo.md', scope: 'src/' }
        ]
      })
    })
    return res.status
  }, HIVE_PORT)

  expect(result).toBe(200)

  // Wait for IPC + React re-render
  await page.waitForTimeout(2000)

  // Screenshot AFTER
  await page.screenshot({ path: join(PROJECT_ROOT, 'test-multi-agent-report', 'propose-after.png') })

  // HARD ASSERTION: proposal card should be visible
  // exact:true to disambiguate from the sibling "Always Approve" button.
  const approveBtn = page.getByRole('button', { name: 'Approve', exact: true })
  const isVisible = await approveBtn.isVisible().catch(() => false)

  // Also check for proposal text
  const hasAlpha = await page.getByText('Create alpha.md').isVisible().catch(() => false)

  console.log(`Approve button visible: ${isVisible}`)
  console.log(`Alpha task visible: ${hasAlpha}`)

  expect(isVisible, 'Approve button should be visible after batch-propose').toBeTruthy()
  expect(hasAlpha, 'Task "Create alpha.md" should be visible in proposal card').toBeTruthy()

  // Cleanup
  await app.close()
  if (existsSync(TEST_DATA_DIR)) rmSync(TEST_DATA_DIR, { recursive: true })
})
