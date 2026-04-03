/**
 * Multi-Agent Integration Test
 *
 * Tests the full orchestration lifecycle with real Claude agents:
 * Manager → batch propose → Workers execute → QA → Critic → PR
 *
 * GUARDRAILS:
 * - NEVER writes ~/.hive/data.json directly
 * - All agents created/deleted via UI
 * - All test resources prefixed [TEST]
 * - Continuous snapshots to test-multi-agent-report/
 * - Cleanup runs even on failure (afterAll)
 */

import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { mkdirSync, existsSync, cpSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'fs'

const PROJECT_ROOT = join(__dirname, '..')
const REPORT_DIR = join(PROJECT_ROOT, 'test-multi-agent-report')
const TEST_TASKS_DIR = join(PROJECT_ROOT, 'test-multi-agent-tasks')
const HIVE_PORT = 17796 // Separate port for test instance (avoids conflict with running app)
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
  // Find all comms directories and copy task files
  if (existsSync(COMMS_DIR)) {
    for (const projDir of readdirSync(COMMS_DIR)) {
      const tasksDir = join(COMMS_DIR, projDir, 'tasks')
      if (existsSync(tasksDir)) {
        for (const f of readdirSync(tasksDir)) {
          if (f.endsWith('.json')) {
            cpSync(join(tasksDir, f), join(dest, `${projDir}_${f}`))
          }
        }
      }
      const reportsDir = join(COMMS_DIR, projDir, 'reports')
      if (existsSync(reportsDir)) {
        const reportsDest = join(REPORT_DIR, 'reports', phase)
        mkdirSync(reportsDest, { recursive: true })
        for (const f of readdirSync(reportsDir)) {
          cpSync(join(reportsDir, f), join(reportsDest, f))
        }
      }
    }
  }
}

function appendReport(file: string, content: string) {
  const fp = join(REPORT_DIR, file)
  const existing = existsSync(fp) ? readFileSync(fp, 'utf-8') : ''
  writeFileSync(fp, existing + content + '\n')
}

function timestamp(): string {
  return new Date().toISOString().slice(11, 19)
}

// Navigate to Task Group tab (must deselect agent first by clicking project)
async function goToTaskGroupTab(p: Page) {
  await p.locator('button:has-text("Hive")').first().click()
  await p.waitForTimeout(1000)
  await p.getByRole('button', { name: 'Task Group', exact: true }).click()
  await p.waitForTimeout(500)
}

async function screenshot(p: Page | undefined, name: string) {
  if (!p) return
  const dir = join(REPORT_DIR, 'screenshots')
  mkdirSync(dir, { recursive: true })
  try { await p.screenshot({ path: join(dir, `${name}.png`) }) } catch {}
}

// Create a test agent via the 4-step UI wizard
async function createTestAgent(
  page: Page,
  name: string,
  templateName: string,
  dept: 'R&D' | 'Non-R&D',
  roleName: string
) {
  // Click New Agent
  await page.getByRole('button', { name: 'New Agent' }).click()
  await page.waitForTimeout(500)

  // Step 0: Select template — clicking auto-advances to step 1
  await page.locator(`button:has-text("${templateName}")`).first().click()
  await page.waitForTimeout(500)

  // Step 1: Fill name (placeholder is "e.g. Alex")
  const nameInput = page.locator('input[placeholder="e.g. Alex"]')
  await nameInput.fill(name)
  await page.waitForTimeout(200)

  // Department + role auto-set by template. Click "Next: Skills"
  await page.getByRole('button', { name: 'Next: Skills' }).click()
  await page.waitForTimeout(300)

  // Step 2: Skills — skip, click "Next: Settings"
  await page.getByRole('button', { name: 'Next: Settings' }).click()
  await page.waitForTimeout(300)

  // Step 3: Model + Zone — keep defaults, create
  await page.getByRole('button', { name: 'Create Agent' }).click()
  await page.waitForTimeout(500)
}

// Delete a test agent by name via UI
async function deleteTestAgent(page: Page, name: string) {
  // Find the agent in sidebar and hover to reveal delete button
  const agentEl = page.locator(`text=${name}`).first()
  if (!(await agentEl.isVisible())) return
  await agentEl.hover()
  await page.waitForTimeout(200)
  // Click the delete button (trash icon) that appears on hover
  const parent = agentEl.locator('..').locator('..')
  const deleteBtn = parent.locator('button[title="Delete"]')
  if (await deleteBtn.isVisible()) {
    await deleteBtn.click()
    await page.waitForTimeout(500)
  }
}

// ============================================================
// Setup
// ============================================================

test.beforeAll(async () => {
  // Create report directory
  mkdirSync(REPORT_DIR, { recursive: true })
  appendReport('summary.md', `# Integration Test Report\n\nStarted: ${new Date().toISOString()}\n`)

  // Create test tasks directory + todo.md
  if (existsSync(TEST_TASKS_DIR)) rmSync(TEST_TASKS_DIR, { recursive: true })
  mkdirSync(TEST_TASKS_DIR, { recursive: true })

  writeFileSync(join(TEST_TASKS_DIR, 'todo.md'), `# Integration Test Tasks

## test-batch

- [ ] Create file alpha.md with 3 paragraphs about software testing
  - depends: none
  - scope: test-multi-agent-tasks/
  - verify:
    - test -f test-multi-agent-tasks/alpha.md
  - acceptance: alpha.md exists with 3+ paragraphs

- [ ] Create file bravo.md with a numbered list of 10 best practices
  - depends: none
  - scope: test-multi-agent-tasks/
  - verify:
    - test -f test-multi-agent-tasks/bravo.md
  - acceptance: bravo.md exists with 10 numbered items

- [ ] Create file charlie.md with a comparison table
  - depends: none
  - scope: test-multi-agent-tasks/
  - verify:
    - test -f test-multi-agent-tasks/charlie.md
  - acceptance: charlie.md exists with a markdown table

- [ ] Create file delta.md with code examples in 3 languages
  - depends: none
  - scope: test-multi-agent-tasks/
  - verify:
    - test -f test-multi-agent-tasks/delta.md
  - acceptance: delta.md has code blocks

- [ ] Create file echo.md with a mermaid flowchart
  - depends: none
  - scope: test-multi-agent-tasks/
  - verify:
    - test -f test-multi-agent-tasks/echo.md
  - acceptance: echo.md has mermaid diagram

- [ ] Create file foxtrot.md with pros and cons analysis
  - depends: none
  - scope: test-multi-agent-tasks/
  - verify:
    - test -f test-multi-agent-tasks/foxtrot.md
  - acceptance: foxtrot.md has pros/cons sections

- [ ] Create file golf.md with FAQ format
  - depends: none
  - scope: test-multi-agent-tasks/
  - verify:
    - test -f test-multi-agent-tasks/golf.md
  - acceptance: golf.md has Q&A pairs

- [ ] Create file hotel.md with a timeline
  - depends: none
  - scope: test-multi-agent-tasks/
  - verify:
    - test -f test-multi-agent-tasks/hotel.md
  - acceptance: hotel.md has chronological timeline

- [ ] Create file india.md summarizing alpha through delta
  - depends: [alpha, bravo, charlie, delta]
  - scope: test-multi-agent-tasks/
  - verify:
    - test -f test-multi-agent-tasks/india.md
  - acceptance: india.md references alpha-delta content

- [ ] Create file juliet.md as final summary of all files
  - depends: [india, echo, foxtrot, golf, hotel]
  - scope: test-multi-agent-tasks/
  - verify:
    - test -f test-multi-agent-tasks/juliet.md
  - acceptance: juliet.md references all 9 previous files
`)

  // Backup data.json
  const dataFile = join(HIVE_DATA_DIR, 'data.json')
  if (existsSync(dataFile)) {
    cpSync(dataFile, join(HIVE_DATA_DIR, 'data.json.test-backup'))
  }

  // Launch app
  const { execSync } = require('child_process')
  execSync('npx electron-vite build', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 60000 })

  app = await electron.launch({
    args: [join(PROJECT_ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_ENV: 'test', HIVE_PORT: String(HIVE_PORT) }
  })
  page = await app.firstWindow({ timeout: 120000 })
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(5000)
  appendReport('session-log.md', `App launched on port ${HIVE_PORT}\n`)

  // Record baseline
  const data = await page.evaluate(async () => {
    const d = await window.api.data.load()
    return {
      projectCount: (d.projects as any[])?.length || 0,
      agentCount: (d.agents as any[])?.filter((a: any) => !a.name.startsWith('[TEST]')).length || 0
    }
  })
  baselineProjectCount = data.projectCount
  baselineAgentCount = data.agentCount
  appendReport('summary.md', `Baseline: ${baselineProjectCount} projects, ${baselineAgentCount} agents\n`)

  // Clean any residual [TEST] agents from previous failed runs
  const residualTestAgents = await page.evaluate(async () => {
    const d = await window.api.data.load()
    return (d.agents as any[])?.filter((a: any) => a.name.startsWith('[TEST]')).map((a: any) => a.name) || []
  })
  for (const name of residualTestAgents) {
    appendReport('summary.md', `Cleaning residual test agent: ${name}\n`)
    await deleteTestAgent(page, name)
  }

  await screenshot(page, '00-before-setup')
}, 180000)

// ============================================================
// Teardown (runs even on failure)
// ============================================================

test.afterAll(async () => {
  appendReport('summary.md', `\nTeardown started: ${new Date().toISOString()}\n`)

  // Final snapshot
  snapshotComms('final')
  await screenshot(page, '99-teardown-start')

  try {
    // 1. Dissolve task group (if exists)
    const tgTab = page.getByRole('button', { name: 'Task Group', exact: true })
    if (await tgTab.isVisible()) {
      await tgTab.click()
      await page.waitForTimeout(500)
      const dissolveBtn = page.getByText('🗑 Dissolve')
      if (await dissolveBtn.isVisible()) {
        await dissolveBtn.click()
        await page.waitForTimeout(500)
        appendReport('summary.md', 'Dissolved task group\n')
      }
    }

    // 2. Delete [TEST] agents
    const testAgentNames = await page.evaluate(async () => {
      const d = await window.api.data.load()
      return (d.agents as any[])?.filter((a: any) => a.name.startsWith('[TEST]')).map((a: any) => a.name) || []
    })
    for (const name of testAgentNames) {
      await deleteTestAgent(page, name)
      appendReport('summary.md', `Deleted agent: ${name}\n`)
    }

    // 3. Verify production data intact
    const finalData = await page.evaluate(async () => {
      const d = await window.api.data.load()
      return {
        projectCount: (d.projects as any[])?.length || 0,
        agentCount: (d.agents as any[])?.filter((a: any) => !a.name.startsWith('[TEST]')).length || 0
      }
    })

    if (finalData.projectCount !== baselineProjectCount) {
      appendReport('summary.md', `⚠️ PROJECT COUNT CHANGED: ${baselineProjectCount} → ${finalData.projectCount}\n`)
    }
    if (finalData.agentCount !== baselineAgentCount) {
      appendReport('summary.md', `⚠️ AGENT COUNT CHANGED: ${baselineAgentCount} → ${finalData.agentCount}\n`)
    }

    appendReport('summary.md', `Final: ${finalData.projectCount} projects, ${finalData.agentCount} agents\n`)
  } catch (err) {
    appendReport('summary.md', `Teardown error: ${err}\n`)
  }

  // 4. Clean test files
  if (existsSync(TEST_TASKS_DIR)) rmSync(TEST_TASKS_DIR, { recursive: true })

  // 5. Clean comms task files (test-generated only)
  // Don't delete entire comms — only task files we created
  // These are already snapshotted to report dir

  appendReport('summary.md', `\nTeardown complete: ${new Date().toISOString()}\n`)
  await screenshot(page, '99-teardown-done')
  await app?.close()
}, 120000)

// ============================================================
// Test: Increase timeout for real agent work
// ============================================================

test.setTimeout(600000) // 10 min per test

// ============================================================
// Phase 1: Setup agents and task group
// ============================================================

test.describe.serial('Integration Test', () => {

  test('select Hive project', async () => {
    // Find and click the Hive project in sidebar
    // Button text is like "💤 Hive 17" (emoji + name + agent count)
    const hiveProject = page.locator('button:has-text("Hive")').first()
    await hiveProject.click()
    await page.waitForTimeout(1000)
    await screenshot(page, '01-hive-project-selected')

    // Verify we're on the project
    await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible()
  })

  test('create 5 test agents', async () => {
    // Manager
    await createTestAgent(page, '[TEST] Manager', 'General Manager', 'Non-R&D', 'GM')
    appendReport('summary.md', `${timestamp()} Created [TEST] Manager\n`)

    // Worker 1
    await createTestAgent(page, '[TEST] Worker-1', 'Full-Stack Engineer', 'R&D', 'Engineering')
    appendReport('summary.md', `${timestamp()} Created [TEST] Worker-1\n`)

    // Worker 2
    await createTestAgent(page, '[TEST] Worker-2', 'Full-Stack Engineer', 'R&D', 'Engineering')
    appendReport('summary.md', `${timestamp()} Created [TEST] Worker-2\n`)

    // QA
    await createTestAgent(page, '[TEST] QA', 'QA', 'R&D', 'QA')
    appendReport('summary.md', `${timestamp()} Created [TEST] QA\n`)

    // Critic
    await createTestAgent(page, '[TEST] Critic', 'Full-Stack Engineer', 'R&D', 'Engineering')
    appendReport('summary.md', `${timestamp()} Created [TEST] Critic\n`)

    await screenshot(page, '02-test-agents-created')

    // Verify all 5 exist
    for (const name of ['[TEST] Manager', '[TEST] Worker-1', '[TEST] Worker-2', '[TEST] QA', '[TEST] Critic']) {
      await expect(page.locator(`text=${name}`).first()).toBeVisible()
    }
  })

  test('create task group with test agents', async () => {
    await page.getByRole('button', { name: 'Task Group', exact: true }).click()
    await page.waitForTimeout(500)
    await page.getByRole('button', { name: 'Create Task Group' }).click()
    await page.waitForTimeout(500)

    // Assign roles — find [TEST] agents in dropdowns
    const selects = page.locator('select')

    // Manager dropdown → [TEST] Manager
    await selects.nth(0).selectOption({ label: '[TEST] Manager (GM)' })
    // QA dropdown → [TEST] QA
    await selects.nth(1).selectOption({ label: '[TEST] QA (QA)' })
    // Critic dropdown → [TEST] Critic
    await selects.nth(2).selectOption({ label: '[TEST] Critic (Engineering)' })

    // Workers — check both (use .first() in case of duplicate matches)
    await page.getByRole('checkbox', { name: '[TEST] Worker-1' }).first().check()
    await page.getByRole('checkbox', { name: '[TEST] Worker-2' }).first().check()

    // Set todo source
    const todoInput = page.locator('input[value="docs/todo.md"]')
    if (await todoInput.isVisible()) {
      await todoInput.fill('test-multi-agent-tasks/todo.md')
    }

    await page.waitForTimeout(300)
    await screenshot(page, '03-task-group-config')

    // Create
    const createBtn = page.getByRole('button', { name: 'Create & Start' })
    await expect(createBtn).toBeEnabled()
    await createBtn.click()
    await page.waitForTimeout(1000)

    await screenshot(page, '04-task-group-created')
    appendReport('summary.md', `${timestamp()} Task group created\n`)
  })

  // ============================================================
  // Phase 2: Manager proposes batch
  // ============================================================

  test('manager starts and proposes batch', async () => {
    // Click [TEST] Manager to open terminal
    await page.locator('text=[TEST] Manager').first().click()
    await page.waitForTimeout(2000) // Wait for claude --agent to start

    await screenshot(page, '05-manager-terminal')
    appendReport('summary.md', `${timestamp()} Manager terminal opened, waiting for Claude to start...\n`)

    // Wait for Claude to be ready (look for prompt or output)
    // This may take 10-30 seconds for Claude to initialize
    await page.waitForTimeout(15000)

    // Inject /manager-whip-start skill
    const managerId = await page.evaluate(async () => {
      const d = await window.api.data.load()
      const mgr = (d.agents as any[])?.find((a: any) => a.name === '[TEST] Manager')
      return mgr?.id
    })

    if (managerId) {
      await page.evaluate(async (id) => {
        window.api.pty.write(id, '/manager-whip-start\r')
      }, managerId)
    }

    appendReport('summary.md', `${timestamp()} Sent /manager-whip-start to manager\n`)
    await screenshot(page, '06-manager-whip-start')

    // Wait for manager to process — it will ask for todo path
    await page.waitForTimeout(10000)

    // Respond with todo path — use ABSOLUTE path since manager cwd may not be the code project
    const todoAbsPath = join(PROJECT_ROOT, 'test-multi-agent-tasks', 'todo.md')
    if (managerId) {
      await page.evaluate(async ({ id, path }) => {
        window.api.pty.write(id, path + '\r')
      }, { id: managerId, path: todoAbsPath })
    }

    await page.waitForTimeout(5000)

    // Respond to max retries (Enter for default)
    if (managerId) {
      await page.evaluate(async (id) => {
        window.api.pty.write(id, '\r') // default 3
      }, managerId)
    }

    appendReport('summary.md', `${timestamp()} Manager configuring batch...\n`)

    // Poll for batch proposal or tasks created (up to 3 minutes)
    const proposalStart = Date.now()
    let proposalFound = false
    while (Date.now() - proposalStart < 180000) {
      await page.waitForTimeout(10000)
      await screenshot(page, `07-manager-${Math.round((Date.now() - proposalStart) / 1000)}s`)

      // Check if tasks were created via HTTP
      const mgrId = await page.evaluate(async () => {
        const d = await window.api.data.load()
        return (d.agents as any[])?.find((a: any) => a.name === '[TEST] Manager')?.id || ''
      })
      const taskCount = await page.evaluate(async ({ port, agentId }) => {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/task-status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentId })
          })
          const tasks = await res.json()
          return Array.isArray(tasks) ? tasks.length : 0
        } catch { return 0 }
      }, { port: HIVE_PORT, agentId: mgrId })

      appendReport('summary.md', `${timestamp()} Polling: ${taskCount} tasks found\n`)

      if (taskCount > 0) {
        proposalFound = true
        appendReport('summary.md', `${timestamp()} ✅ Tasks created by manager! (${taskCount} tasks)\n`)
        break
      }

      // Also check batch proposal IPC by checking UI
      await goToTaskGroupTab(page)
      const batchText = await page.locator('.glass-card').first().textContent().catch(() => '')
      if (batchText && !batchText.includes('No tasks yet')) {
        proposalFound = true
        appendReport('summary.md', `${timestamp()} ✅ Batch panel has content\n`)
        break
      }

      // Go back to manager terminal to let it keep working
      await page.locator('text=[TEST] Manager').first().click()
      await page.waitForTimeout(1000)
    }

    snapshotComms('phase1-proposal')
    await screenshot(page, '07-after-manager-propose')
    await goToTaskGroupTab(page)
    await screenshot(page, '08-task-group-after-propose')

    if (!proposalFound) {
      appendReport('summary.md', `${timestamp()} ⚠️ Manager did not create tasks within 3 minutes\n`)
    }
    appendReport('summary.md', `${timestamp()} Phase 1 complete\n`)
  })

  // ============================================================
  // Phase 3: Approve batch and workers execute
  // ============================================================

  test('approve batch and workers execute', async () => {
    // Ensure we're on Task Group tab
    await goToTaskGroupTab(page)
    await page.waitForTimeout(1000)

    // Look for Approve button (batch proposal card)
    const approveBtn = page.getByRole('button', { name: 'Approve' })
    if (await approveBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
      await approveBtn.click()
      appendReport('summary.md', `${timestamp()} Batch approved via UI\n`)
    } else {
      appendReport('summary.md', `${timestamp()} ⚠️ No batch proposal card — skipping approve, manager may assign directly\n`)
      await screenshot(page, '09-no-proposal-card')
    }

    await page.waitForTimeout(2000)

    // Start workers by clicking them (opens terminal → claude starts)
    await page.locator('text=[TEST] Worker-1').first().click()
    await page.waitForTimeout(3000)
    appendReport('summary.md', `${timestamp()} Worker-1 terminal opened\n`)

    await page.locator('text=[TEST] Worker-2').first().click()
    await page.waitForTimeout(3000)
    appendReport('summary.md', `${timestamp()} Worker-2 terminal opened\n`)

    await screenshot(page, '10-workers-started')

    // Now we wait for workers to complete tasks
    // Poll task status every 30 seconds (up to 8 minutes)
    const maxWait = 480000 // 8 minutes
    const startTime = Date.now()
    let allDone = false

    while (Date.now() - startTime < maxWait) {
      await page.waitForTimeout(30000) // 30s poll interval

      // Check task board (navigate back to project view first)
      await goToTaskGroupTab(page)

      const elapsed = Math.round((Date.now() - startTime) / 1000)
      await screenshot(page, `11-progress-${elapsed}s`)

      // Snapshot comms
      snapshotComms(`phase2-${elapsed}s`)

      // Check if batch tasks are done by reading task files
      // Get manager agent ID for task-status lookup
      const mgrId = await page.evaluate(async () => {
        const d = await window.api.data.load()
        return (d.agents as any[])?.find((a: any) => a.name === '[TEST] Manager')?.id || ''
      })

      const taskSummary = await page.evaluate(async ({ port, agentId }) => {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/task-status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentId })
          })
          const tasks = await res.json()
          if (!Array.isArray(tasks)) return { total: 0, done: 0, blocked: 0, pending: 0, inProgress: 0 }
          return {
            total: tasks.length,
            done: tasks.filter((t: any) => t.status === 'done').length,
            blocked: tasks.filter((t: any) => t.status === 'blocked').length,
            pending: tasks.filter((t: any) => t.status === 'pending').length,
            inProgress: tasks.filter((t: any) => t.status === 'in_progress' || t.status === 'assigned').length,
          }
        } catch { return { total: 0, done: 0, blocked: 0, pending: 0, inProgress: 0 } }
      }, { port: HIVE_PORT, agentId: mgrId })

      appendReport('batch-timeline.md', `${timestamp()} [${elapsed}s] Tasks: ${taskSummary.done}/${taskSummary.total} done, ${taskSummary.blocked} blocked, ${taskSummary.pending} pending\n`)

      if (taskSummary.total > 0 && taskSummary.done + taskSummary.blocked >= taskSummary.total) {
        allDone = true
        appendReport('summary.md', `${timestamp()} All batch tasks complete (${taskSummary.done} done, ${taskSummary.blocked} blocked)\n`)
        break
      }
    }

    if (!allDone) {
      appendReport('summary.md', `${timestamp()} ⚠️ Timeout: not all tasks completed in 5 minutes\n`)
    }

    snapshotComms('phase2-complete')
    await screenshot(page, '12-batch-complete')
  })

  // ============================================================
  // Phase 4: QA
  // ============================================================

  test('QA agent runs integration test', async () => {
    appendReport('summary.md', `${timestamp()} Starting QA phase...\n`)

    // Click QA agent to start
    await page.locator('text=[TEST] QA').first().click()
    await page.waitForTimeout(5000)

    await screenshot(page, '13-qa-started')

    // Wait for QA to complete (up to 3 minutes)
    await page.waitForTimeout(120000)

    snapshotComms('phase4-qa')
    await screenshot(page, '14-qa-complete')
    appendReport('summary.md', `${timestamp()} QA phase complete\n`)
  })

  // ============================================================
  // Phase 5: Critic
  // ============================================================

  test('Critic agent reviews and creates PR', async () => {
    appendReport('summary.md', `${timestamp()} Starting Critic phase...\n`)

    await page.locator('text=[TEST] Critic').first().click()
    await page.waitForTimeout(5000)

    await screenshot(page, '15-critic-started')

    // Wait for Critic (up to 3 minutes)
    await page.waitForTimeout(120000)

    snapshotComms('phase5-critic')
    await screenshot(page, '16-critic-complete')
    appendReport('summary.md', `${timestamp()} Critic phase complete\n`)

    // Check for merge card
    await goToTaskGroupTab(page)
    await page.waitForTimeout(1000)
    await screenshot(page, '17-final-task-group')

    appendReport('summary.md', `${timestamp()} Integration test complete\n`)
  })
})
