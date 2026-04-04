/**
 * Multi-Agent Integration Test — 3 tasks (minimal viable test)
 *
 * GUARDRAILS: never writes ~/.hive/data.json directly, [TEST] prefix, baseline check
 */

import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { mkdirSync, existsSync, cpSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'fs'

const PROJECT_ROOT = join(__dirname, '..')
const REPORT_DIR = join(PROJECT_ROOT, 'test-multi-agent-report')
const TEST_TASKS_DIR = join(PROJECT_ROOT, 'test-multi-agent-tasks')
const HIVE_PORT = 17796
const HIVE_DATA_DIR = join(require('os').homedir(), '.hive')
const COMMS_DIR = join(HIVE_DATA_DIR, 'comms')

let app: ElectronApplication
let page: Page
let baselineProjectCount = 0
let baselineAgentCount = 0

// ============================================================
// Helpers
// ============================================================

function snapshotComms(phase: string) {
  const dest = join(REPORT_DIR, 'tasks', phase)
  mkdirSync(dest, { recursive: true })
  if (!existsSync(COMMS_DIR)) return
  for (const projDir of readdirSync(COMMS_DIR)) {
    const tasksDir = join(COMMS_DIR, projDir, 'tasks')
    if (existsSync(tasksDir)) {
      for (const f of readdirSync(tasksDir).filter(f => f.endsWith('.json'))) {
        cpSync(join(tasksDir, f), join(dest, `${projDir}_${f}`))
      }
    }
  }
}

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19)
  const line = `${ts} ${msg}\n`
  const fp = join(REPORT_DIR, 'summary.md')
  const existing = existsSync(fp) ? readFileSync(fp, 'utf-8') : ''
  writeFileSync(fp, existing + line)
}

async function shot(p: Page | undefined, name: string) {
  if (!p) return
  const dir = join(REPORT_DIR, 'screenshots')
  mkdirSync(dir, { recursive: true })
  try { await p.screenshot({ path: join(dir, `${name}.png`) }) } catch {}
}

async function goToTaskGroupTab(p: Page) {
  await p.locator('button:has-text("Hive")').first().click()
  await p.waitForTimeout(1000)
  await p.getByRole('button', { name: 'Task Group', exact: true }).click()
  await p.waitForTimeout(500)
}

async function createTestAgent(page: Page, name: string, templateName: string) {
  await page.getByRole('button', { name: 'New Agent' }).click()
  await page.waitForTimeout(500)
  await page.locator(`button:has-text("${templateName}")`).first().click()
  await page.waitForTimeout(500)
  await page.locator('input[placeholder="e.g. Alex"]').fill(name)
  await page.waitForTimeout(200)
  await page.getByRole('button', { name: 'Next: Skills' }).click()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Next: Settings' }).click()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Create Agent' }).click()
  await page.waitForTimeout(500)
}

async function deleteTestAgent(page: Page, name: string) {
  const agentEl = page.locator(`text=${name}`).first()
  if (!(await agentEl.isVisible().catch(() => false))) return
  await agentEl.hover()
  await page.waitForTimeout(200)
  const deleteBtn = agentEl.locator('..').locator('..').locator('button[title="Delete"]')
  if (await deleteBtn.isVisible().catch(() => false)) {
    await deleteBtn.click()
    await page.waitForTimeout(500)
  }
}

// ============================================================
// Setup
// ============================================================

test.beforeAll(async () => {
  mkdirSync(REPORT_DIR, { recursive: true })
  log('# Integration Test (3 tasks)\n')

  // Test todo.md — 3 tasks: 2 parallel + 1 dependent
  if (existsSync(TEST_TASKS_DIR)) rmSync(TEST_TASKS_DIR, { recursive: true })
  mkdirSync(TEST_TASKS_DIR, { recursive: true })
  writeFileSync(join(TEST_TASKS_DIR, 'todo.md'), `# Test Tasks

## batch-1

- [ ] Create file alpha.md with a short paragraph
  - depends: none
  - scope: test-multi-agent-tasks/
  - verify:
    - test -f test-multi-agent-tasks/alpha.md
  - acceptance: alpha.md exists

- [ ] Create file bravo.md with a numbered list
  - depends: none
  - scope: test-multi-agent-tasks/
  - verify:
    - test -f test-multi-agent-tasks/bravo.md
  - acceptance: bravo.md exists

- [ ] Create file charlie.md summarizing alpha and bravo
  - depends: [alpha, bravo]
  - scope: test-multi-agent-tasks/
  - verify:
    - test -f test-multi-agent-tasks/charlie.md
  - acceptance: charlie.md references alpha and bravo
`)

  // Backup
  const dataFile = join(HIVE_DATA_DIR, 'data.json')
  if (existsSync(dataFile)) cpSync(dataFile, join(HIVE_DATA_DIR, 'data.json.test-backup'))

  // Note: skill stays enabled. Previous bug was residual agent definitions
  // with old soul (referencing skill), not auto-launch.

  // Launch
  const { execSync } = require('child_process')
  execSync('npx electron-vite build', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 60000 })
  app = await electron.launch({
    args: [join(PROJECT_ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_ENV: 'test', HIVE_PORT: String(HIVE_PORT) }
  })
  page = await app.firstWindow({ timeout: 120000 })
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(5000)

  // Baseline
  const data = await page.evaluate(async () => {
    const d = await window.api.data.load()
    return {
      projects: (d.projects as any[])?.length || 0,
      agents: (d.agents as any[])?.filter((a: any) => !a.name.startsWith('[TEST]')).length || 0
    }
  })
  baselineProjectCount = data.projects
  baselineAgentCount = data.agents
  log(`Baseline: ${baselineProjectCount} projects, ${baselineAgentCount} agents`)

  // Clean residual [TEST] agents from data
  const residual = await page.evaluate(async () => {
    const d = await window.api.data.load()
    return (d.agents as any[])?.filter((a: any) => a.name.startsWith('[TEST]')).map((a: any) => a.name) || []
  })
  for (const name of residual) {
    log(`Cleaning residual agent: ${name}`)
    await deleteTestAgent(page, name)
  }

  // Clean residual [TEST] agent DEFINITION FILES on disk (from previous failed runs)
  const agentsDirs = [
    join(require('os').homedir(), 'OnePersonCompany', 'Hive', '.claude', 'agents'),
    join(PROJECT_ROOT, '.claude', 'agents'),
  ]
  for (const dir of agentsDirs) {
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.md')) continue
      const fp = join(dir, f)
      try {
        const content = readFileSync(fp, 'utf-8')
        // SAFETY: only delete if description contains [TEST] — never touch production agents
        if (content.includes('[TEST]') && content.includes('description: "[TEST]')) {
          rmSync(fp)
          log(`Cleaned residual definition: ${f}`)
        }
      } catch {}
    }
  }

  // Also restore skill if it was disabled by a previous failed run
  const skillPath = join(require('os').homedir(), '.claude', 'skills', 'manager-whip-start', 'SKILL.md')
  const skillBackup = skillPath + '.test-disabled'
  if (existsSync(skillBackup) && !existsSync(skillPath)) {
    cpSync(skillBackup, skillPath)
    rmSync(skillBackup)
    log('Restored skill from previous failed teardown')
  }

  // Clean residual task files from ALL projects (previous failed runs leave files behind)
  const commsDir = join(HIVE_DATA_DIR, 'comms')
  if (existsSync(commsDir)) {
    for (const projDir of readdirSync(commsDir)) {
      const tasksDir = join(commsDir, projDir, 'tasks')
      if (existsSync(tasksDir)) {
        rmSync(tasksDir, { recursive: true })
        log(`Cleaned residual tasks: ${projDir}`)
      }
    }
  }

  await shot(page, '00-setup')
}, 180000)

// ============================================================
// Teardown
// ============================================================

test.afterAll(async () => {
  log('\n--- TEARDOWN ---')
  snapshotComms('final')
  await shot(page, '99-teardown')

  try {
    const tgTab = page.getByRole('button', { name: 'Task Group', exact: true })
    if (await tgTab.isVisible().catch(() => false)) {
      await goToTaskGroupTab(page)
      const dissolve = page.getByText('🗑 Dissolve')
      if (await dissolve.isVisible().catch(() => false)) {
        await dissolve.click()
        await page.waitForTimeout(500)
        log('Dissolved task group')
      }
    }
    const testNames = await page.evaluate(async () => {
      const d = await window.api.data.load()
      return (d.agents as any[])?.filter((a: any) => a.name.startsWith('[TEST]')).map((a: any) => a.name) || []
    })
    for (const name of testNames) {
      await deleteTestAgent(page, name)
      log(`Deleted: ${name}`)
    }
    const final = await page.evaluate(async () => {
      const d = await window.api.data.load()
      return {
        projects: (d.projects as any[])?.length || 0,
        agents: (d.agents as any[])?.filter((a: any) => !a.name.startsWith('[TEST]')).length || 0
      }
    })
    log(`Final: ${final.projects} projects, ${final.agents} agents`)
    if (final.projects !== baselineProjectCount) log(`⚠️ PROJECT COUNT CHANGED: ${baselineProjectCount} → ${final.projects}`)
    if (final.agents !== baselineAgentCount) log(`⚠️ AGENT COUNT CHANGED: ${baselineAgentCount} → ${final.agents}`)
  } catch (err) { log(`Teardown error: ${err}`) }

  if (existsSync(TEST_TASKS_DIR)) rmSync(TEST_TASKS_DIR, { recursive: true })
  await app?.close()
}, 120000)

test.setTimeout(1200000) // 20 min per test

// ============================================================
// Tests
// ============================================================

test.describe.serial('Integration Test', () => {

  test('1. select Hive project + create agents + task group', async () => {
    // Select project
    await page.locator('button:has-text("Hive")').first().click()
    await page.waitForTimeout(1000)
    await shot(page, '01-project')

    // Create 5 agents
    for (const [name, tmpl] of [
      ['[TEST] Manager', 'General Manager'],
      ['[TEST] Worker-1', 'Full-Stack Engineer'],
      ['[TEST] Worker-2', 'Full-Stack Engineer'],
      ['[TEST] QA', 'QA'],
      ['[TEST] Critic', 'Full-Stack Engineer'],
    ] as const) {
      await createTestAgent(page, name, tmpl)
      log(`Created ${name}`)
    }
    await shot(page, '02-agents')

    // Verify all exist
    for (const name of ['[TEST] Manager', '[TEST] Worker-1', '[TEST] Worker-2', '[TEST] QA', '[TEST] Critic']) {
      await expect(page.locator(`text=${name}`).first()).toBeVisible()
    }

    // Create task group
    await page.getByRole('button', { name: 'Task Group', exact: true }).click()
    await page.waitForTimeout(500)
    await page.getByRole('button', { name: 'Create Task Group' }).click()
    await page.waitForTimeout(500)

    const selects = page.locator('select')
    await selects.nth(0).selectOption({ label: '[TEST] Manager (GM)' })
    await selects.nth(1).selectOption({ label: '[TEST] QA (QA)' })
    await selects.nth(2).selectOption({ label: '[TEST] Critic (Engineering)' })
    await page.getByRole('checkbox', { name: '[TEST] Worker-1' }).first().check()
    await page.getByRole('checkbox', { name: '[TEST] Worker-2' }).first().check()

    const todoInput = page.locator('input[value="docs/todo.md"]')
    if (await todoInput.isVisible().catch(() => false)) {
      await todoInput.fill(join(PROJECT_ROOT, 'test-multi-agent-tasks', 'todo.md'))
    }
    await page.waitForTimeout(300)
    await shot(page, '03-taskgroup-config')

    await page.getByRole('button', { name: 'Create & Start' }).click()
    await page.waitForTimeout(1000)
    await shot(page, '04-taskgroup-created')
    log('Task group created')
  })

  test('2. manager proposes batch (with Y/n confirmation)', async () => {
    // Click manager to open terminal
    await page.locator('text=[TEST] Manager').first().click()
    await page.waitForTimeout(3000)
    log('Manager terminal opened')

    const managerId = await page.evaluate(async () => {
      const d = await window.api.data.load()
      return (d.agents as any[])?.find((a: any) => a.name === '[TEST] Manager')?.id || ''
    })
    log(`Manager ID: ${managerId}`)

    // Wait for Claude to initialize
    await page.waitForTimeout(20000)
    await shot(page, '05-manager-ready')

    // Instead of /manager-whip-start skill (which uses interactive menus),
    // send a direct instruction that manager can execute immediately
    const todoPath = join(PROJECT_ROOT, 'test-multi-agent-tasks', 'todo.md')
    // Get manager's cwd to construct absolute hive-report.sh path
    const managerCwd = await page.evaluate(async (id) => {
      const d = await window.api.data.load()
      const agent = (d.agents as any[])?.find((a: any) => a.id === id)
      if (!agent) return ''
      const project = (d.projects as any[])?.find((p: any) => p.id === agent.projectId)
      const zone = project?.zones?.find((z: any) => z.id === agent.zoneId)
      return zone?.path || ''
    }, managerId)
    const reportSh = join(managerCwd, '.claude', 'hive-report.sh')
    const instruction = `Read the file ${todoPath} and parse the todo items. Group them into batches (items with no unmet dependencies go in batch 1). Then run: ${reportSh} batch-propose '{"batch":1,"tasks":[...parsed tasks as JSON...]}'. After that run: ${reportSh} report-human "Batch proposed". Then wait for my approval. IMPORTANT: use the exact path ${reportSh} for all hive-report.sh calls.`
    await page.evaluate(async ({ id, msg }) => { window.api.pty.write(id, msg + '\r') }, { id: managerId, msg: instruction })
    log('Sent direct instruction to manager')

    // Poll up to 6 minutes: send Y when appropriate, check for tasks/proposal
    let proposalFound = false
    let ySent = false
    const start = Date.now()

    for (let i = 0; i < 90; i++) { // 90 x 10s = 15 min
      await page.waitForTimeout(10000)
      const elapsed = Math.round((Date.now() - start) / 1000)

      // Screenshot manager terminal
      await page.locator('text=[TEST] Manager').first().click().catch(() => {})
      await page.waitForTimeout(500)
      await shot(page, `06-manager-${elapsed}s`)

      // If manager asks for confirmation (Y/n), send Y
      if (!ySent && elapsed > 60) {
        await page.locator('text=[TEST] Manager').first().click().catch(() => {})
        await page.waitForTimeout(300)
        await page.evaluate(async (id) => { window.api.pty.write(id, 'Y\r') }, managerId)
        ySent = true
        log(`Sent Y at ${elapsed}s (in case of confirmation prompt)`)
        await page.waitForTimeout(5000)
      }

      // Check task-status
      const taskCount = await page.evaluate(async ({ port, agentId }) => {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/task-status`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentId })
          })
          const tasks = await res.json()
          return Array.isArray(tasks) ? tasks.length : 0
        } catch { return -1 }
      }, { port: HIVE_PORT, agentId: managerId })
      log(`[${elapsed}s] task-status: ${taskCount} tasks`)

      if (taskCount > 0) {
        proposalFound = true
        log(`✅ ${taskCount} tasks created!`)
        break
      }

      // Check for Approve button in UI
      await goToTaskGroupTab(page)
      const approveBtn = page.getByRole('button', { name: 'Approve' })
      if (await approveBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await approveBtn.click()
        log('✅ Clicked Approve — now waiting for Manager to create tasks')

        // Stay on Manager terminal and wait for tasks to appear
        await page.locator('text=[TEST] Manager').first().click().catch(() => {})
        await page.waitForTimeout(2000)

        // Poll until tasks appear (up to 5 min after approve)
        for (let j = 0; j < 30; j++) { // 30 x 10s = 5 min
          await page.waitForTimeout(10000)
          const jElapsed = (j + 1) * 10
          await shot(page, `07-post-approve-${jElapsed}s`)

          const postApproveCount = await page.evaluate(async ({ port, agentId }) => {
            try {
              const res = await fetch(`http://127.0.0.1:${port}/task-status`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agentId })
              })
              const text = await res.text()
              try { const t = JSON.parse(text); return Array.isArray(t) ? t.length : 0 } catch { return -1 }
            } catch { return -2 }
          }, { port: HIVE_PORT, agentId: managerId })
          log(`[post-approve ${jElapsed}s] tasks: ${postApproveCount}`)

          if (postApproveCount > 0) {
            log(`✅ ${postApproveCount} tasks created after approve!`)
            proposalFound = true
            break
          }
        }
        break
      }

      // Back to manager terminal
      await page.locator('text=[TEST] Manager').first().click().catch(() => {})
      await page.waitForTimeout(500)
    }

    snapshotComms('after-propose')
    await shot(page, '07-after-propose')

    // HARD ASSERTION
    log(`Proposal found: ${proposalFound}`)
    expect(proposalFound, 'Manager should have proposed batch and created tasks within 15 minutes').toBeTruthy()
  })

  test('3. workers execute tasks', async () => {
    // Start workers
    await page.locator('text=[TEST] Worker-1').first().click()
    await page.waitForTimeout(3000)
    log('Worker-1 started')
    await page.locator('text=[TEST] Worker-2').first().click()
    await page.waitForTimeout(3000)
    log('Worker-2 started')
    await shot(page, '08-workers')

    const mgrId = await page.evaluate(async () => {
      const d = await window.api.data.load()
      return (d.agents as any[])?.find((a: any) => a.name === '[TEST] Manager')?.id || ''
    })

    // Poll for task completion (up to 8 min)
    let allDone = false
    const start = Date.now()
    for (let i = 0; i < 16; i++) { // 16 x 30s = 8 min
      await page.waitForTimeout(30000)
      const elapsed = Math.round((Date.now() - start) / 1000)

      await goToTaskGroupTab(page)
      await shot(page, `09-progress-${elapsed}s`)
      snapshotComms(`workers-${elapsed}s`)

      const summary = await page.evaluate(async ({ port, agentId }) => {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/task-status`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentId })
          })
          const text = await res.text()
          let tasks: any[]
          try { tasks = JSON.parse(text) } catch { return `parse error: ${text.slice(0, 100)}` }
          if (!Array.isArray(tasks)) return `not array: ${text.slice(0, 100)}`
          const done = tasks.filter((t: any) => t.status === 'done').length
          const blocked = tasks.filter((t: any) => t.status === 'blocked').length
          const total = tasks.length
          return `${done}/${total} done, ${blocked} blocked`
        } catch (e) { return `error: ${e}` }
      }, { port: HIVE_PORT, agentId: mgrId })
      log(`[${elapsed}s] Workers: ${summary}`)

      if (summary.includes('/') && !summary.startsWith('0/')) {
        const match = summary.match(/(\d+)\/(\d+)/)
        if (match && parseInt(match[1]) + (summary.match(/(\d+) blocked/)?.[1] ? parseInt(summary.match(/(\d+) blocked/)![1]) : 0) >= parseInt(match[2])) {
          allDone = true
          log('✅ All tasks done or blocked')
          break
        }
      }
    }
    log(`Workers complete: ${allDone}`)
    // Soft assertion here — workers may not finish in time with real Claude
  })

  test('4. QA + Critic + final state', async () => {
    // Start QA
    await page.locator('text=[TEST] QA').first().click()
    await page.waitForTimeout(3000)
    log('QA started')
    await shot(page, '10-qa')
    await page.waitForTimeout(60000)

    // Start Critic
    await page.locator('text=[TEST] Critic').first().click()
    await page.waitForTimeout(3000)
    log('Critic started')
    await shot(page, '11-critic')
    await page.waitForTimeout(60000)

    // Final state
    await goToTaskGroupTab(page)
    await shot(page, '12-final')
    snapshotComms('final-state')
    log('Test complete')
  })
})
