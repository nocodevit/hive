import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'fs'

let app: ElectronApplication
let page: Page
const HIVE_PORT = 17797

// Isolated test directory — NEVER touch ~/.hive/
const TEST_DATA_DIR = join(require('os').tmpdir(), 'hive-e2e-endpoints')
const TEST_DATA_FILE = join(TEST_DATA_DIR, 'data.json')
const COMMS_DIR = join(TEST_DATA_DIR, 'comms', 'test-proj', 'tasks')

test.beforeAll(async () => {
  // Clean isolated test dir
  if (existsSync(TEST_DATA_DIR)) rmSync(TEST_DATA_DIR, { recursive: true })
  mkdirSync(TEST_DATA_DIR, { recursive: true })

  const avatar = { skinTone: '#f5d0a9', hairStyle: 'short', hairColor: '#2c1810', topStyle: 'tee', topColor: '#7c3aed', bottomStyle: 'pants', bottomColor: '#1e293b', hat: 'none', accessories: [] }
  const prefs = { autoRunClaude: false, startupCommand: '' }
  const testData = {
    projects: [{ id: 'test-proj', name: 'EP Test', officePath: '/tmp/ep-test',
      zones: [{ id: 'z1', name: 'src', path: '/tmp/ep-test', type: 'rnd', hasGit: false }] }],
    agents: [
      { id: 'mgr', projectId: 'test-proj', zoneId: 'z1', name: 'Manager', role: 'GM', type: 'non-coding', department: 'Non-R&D', group: '', order: 0, status: 'done', soul: '', avatar, enabledSkills: [], preferences: prefs, model: 'inherit', effort: 'high', taskGroupRole: 'manager' },
      { id: 'w1', projectId: 'test-proj', zoneId: 'z1', name: 'Worker1', role: 'Eng', type: 'coding', department: 'R&D', group: '', order: 1, status: 'done', soul: '', avatar, enabledSkills: [], preferences: prefs, model: 'inherit', effort: 'high', taskGroupRole: 'worker' },
    ],
    appPrefs: { autoRunClaude: false, maxLogs: 100, continueSession: false },
    taskGroups: [{
      id: 'tg-1', projectId: 'test-proj', status: 'executing',
      managerId: 'mgr', workerIds: ['w1'], qaId: 'mgr', criticId: 'mgr',
      currentBatch: 1, todoSource: 'docs/todo.md', maxGateRetries: 3
    }]
  }

  if (!existsSync(TEST_DATA_DIR)) mkdirSync(TEST_DATA_DIR, { recursive: true })
  writeFileSync(TEST_DATA_FILE, JSON.stringify(testData, null, 2))

  const { execSync } = require('child_process')
  execSync('npx electron-vite build', { cwd: join(__dirname, '..'), stdio: 'pipe', timeout: 60000 })

  app = await electron.launch({
    args: [join(__dirname, '..', 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_ENV: 'test', HIVE_PORT: String(HIVE_PORT), HIVE_DATA_DIR: TEST_DATA_DIR }
  })
  page = await app.firstWindow({ timeout: 60000 })
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(2000)
}, 120000)

test.afterAll(async () => {
  await app?.close()
  // Clean up isolated test directory entirely
  if (existsSync(TEST_DATA_DIR)) rmSync(TEST_DATA_DIR, { recursive: true })
})

test.describe('HTTP Endpoints', () => {
  test('POST /task-create creates a task and returns id', async () => {
    const result = await page.evaluate(async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/task-create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'test-proj', title: 'E2E test task', scope: 'src/', verify: ['echo ok'], batch: 1 })
      })
      return res.json()
    }, HIVE_PORT)
    expect(result.id).toMatch(/^task-\d+$/)
  })

  test('POST /task-status returns tasks array', async () => {
    const tasks = await page.evaluate(async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/task-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'mgr' })
      })
      return res.json()
    }, HIVE_PORT)
    expect(Array.isArray(tasks)).toBe(true)
    expect(tasks.length).toBeGreaterThanOrEqual(1)
    // Find our task (might not be first if other tests created tasks)
    const ourTask = tasks.find((t: any) => t.title === 'E2E test task')
    expect(ourTask).toBeTruthy()
  })

  test('POST /task-assign updates task status to assigned', async () => {
    const tasks = await page.evaluate(async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/task-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'mgr' })
      })
      return res.json()
    }, HIVE_PORT)
    const task = tasks.find((t: any) => t.title === 'E2E test task')
    const taskId = task.id

    await page.evaluate(async ({ port, taskId }) => {
      await fetch(`http://127.0.0.1:${port}/task-assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'test-proj', taskId, agentId: 'w1' })
      })
    }, { port: HIVE_PORT, taskId })

    const updated = await page.evaluate(async ({ port, taskId }) => {
      const res = await fetch(`http://127.0.0.1:${port}/task-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'mgr' })
      })
      const all = await res.json()
      return all.find((t: any) => t.id === taskId)
    }, { port: HIVE_PORT, taskId })
    expect(updated.status).toBe('assigned')
    expect(updated.owner).toBe('w1')
  })

  test('POST /report-human triggers manager:report IPC', async () => {
    // Set up listener before sending
    const gotReport = page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        const cleanup = window.api.agent.onManagerReport(() => {
          cleanup()
          resolve(true)
        })
        setTimeout(() => { cleanup(); resolve(false) }, 3000)
      })
    })

    await page.evaluate(async (port) => {
      await fetch(`http://127.0.0.1:${port}/report-human`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'mgr', message: 'E2E report test' })
      })
    }, HIVE_PORT)

    expect(await gotReport).toBe(true)
  })

  test('POST /batch-propose triggers batch:proposal IPC', async () => {
    const gotProposal = page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        const cleanup = window.api.agent.onBatchProposal(() => {
          cleanup()
          resolve(true)
        })
        setTimeout(() => { cleanup(); resolve(false) }, 3000)
      })
    })

    await page.evaluate(async (port) => {
      await fetch(`http://127.0.0.1:${port}/batch-propose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch: 1, tasks: [{ title: 'test task', scope: 'src/' }] })
      })
    }, HIVE_PORT)

    expect(await gotProposal).toBe(true)
  })

  test('POST /task-blocked triggers notification', async () => {
    const tasks = await page.evaluate(async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/task-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'mgr' })
      })
      return res.json()
    }, HIVE_PORT)
    const task = tasks.find((t: any) => t.title === 'E2E test task')
    const taskId = task.id

    await page.evaluate(async ({ port, taskId }) => {
      await fetch(`http://127.0.0.1:${port}/task-blocked`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'w1', taskId, reason: 'build fails', attempt: 3 })
      })
    }, { port: HIVE_PORT, taskId })

    const updated = await page.evaluate(async ({ port, taskId }) => {
      const res = await fetch(`http://127.0.0.1:${port}/task-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'mgr' })
      })
      const all = await res.json()
      return all.find((t: any) => t.id === taskId)
    }, { port: HIVE_PORT, taskId })
    expect(updated.status).toBe('blocked')
    expect(updated.blocked_reason).toBe('build fails')
  })

  test('POST /ready returns 200', async () => {
    const status = await page.evaluate(async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/ready`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'w1' })
      })
      return res.status
    }, HIVE_PORT)
    expect(status).toBe(200)
  })

  test('GET /task-status returns tasks via query param', async () => {
    const tasks = await page.evaluate(async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/task-status?projectId=test-proj`)
      return res.json()
    }, HIVE_PORT)
    expect(Array.isArray(tasks)).toBe(true)
    expect(tasks.length).toBeGreaterThanOrEqual(1)
  })
})
