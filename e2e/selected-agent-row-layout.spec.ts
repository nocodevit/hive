// v2.9.0 diagnostic — user keeps flagging the selected-agent row as
// visually mis-aligned ("label 靠右"). Instead of guessing, boot the
// real Electron renderer, create an agent with a note, select it, and
// measure the row: the pink selected background must be symmetric, its
// content must NOT drift to one side, and the note tag position must
// mirror the row's other right-aligned chips.
//
// Also screenshots the row on every run so we can eyeball what
// the assertions are seeing.

import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'

let app: ElectronApplication
let page: Page
let dataDir: string

test.beforeAll(async () => {
  const { execSync } = require('child_process')
  execSync('npx electron-vite build', { cwd: join(__dirname, '..'), stdio: 'pipe', timeout: 90000 })
  dataDir = mkdtempSync(join(tmpdir(), 'hive-e2e-agentrow-'))
  app = await electron.launch({
    args: [join(__dirname, '..', 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_ENV: 'test', HEADLESS: '1', HIVE_PORT: '17801', HIVE_DATA_DIR: dataDir },
  })
  page = await app.firstWindow({ timeout: 60000 })
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(1500)
}, 120000)

test.afterAll(async () => {
  await app?.close()
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
})

test('selected agent row: content symmetric, no right-drift', async () => {
  // --- Seed: one project + one agent with a note --------------------
  const projectDir = mkdtempSync(join(tmpdir(), 'hive-e2e-proj-'))
  await page.evaluate(async (path) => {
    const proj = {
      id: 'p-test',
      name: 'TestProj',
      officePath: path,
      zones: [{ id: 'z1', name: 'root', path, type: 'rnd', hasGit: false }],
    }
    const agent = {
      id: 'a-test',
      projectId: 'p-test',
      zoneId: 'z1',
      name: 'Alexandra',   // long enough to trigger a truncate consideration
      role: 'coder',
      type: 'coding',
      department: 'DATA',
      group: '',
      order: 0,
      status: 'done',
      soul: '',
      avatar: { skinTone: '#f5d0a9', hairStyle: 'short', hairColor: '#2c1810',
                topStyle: 'tee', topColor: '#7c3aed', bottomStyle: 'pants',
                bottomColor: '#1e293b', hat: 'none', accessories: [] },
      enabledSkills: [],
      preferences: { autoRunClaude: false, startupCommand: '' },
      model: 'inherit', effort: 'high',
      note: 'test note — a moderately long chip label',
    }
    await window.api.data.save({ projects: [proj], agents: [agent], appPrefs: {}, taskGroups: [] })
    location.reload()
  }, projectDir)

  await page.waitForTimeout(2000)

  // --- Select project + agent so the row renders in pink state ------
  await page.getByText('TestProj').first().click()
  await page.waitForTimeout(400)
  const agentRow = page.locator('div[draggable="true"]').filter({ hasText: 'Alexandra' }).first()
  await agentRow.click()
  await page.waitForTimeout(400)

  // --- Screenshot for eyeball verification --------------------------
  const shotPath = join(dataDir, 'selected-row.png')
  await agentRow.screenshot({ path: shotPath })
  // eslint-disable-next-line no-console
  console.log('[diagnostic] row screenshot at', shotPath)

  // --- Layout assertions --------------------------------------------
  const rowBox = await agentRow.boundingBox()
  expect(rowBox).not.toBeNull()

  // Symmetric padding: measure the position of the avatar (leftmost
  // real content) and the visible chip zone on the right. Distances
  // should be within ~4px of each other.
  const avatar = agentRow.locator('canvas').first()
  const avatarBox = await avatar.boundingBox()
  expect(avatarBox).not.toBeNull()

  const leftGap = (avatarBox!.x - rowBox!.x)
  // Right gap: distance from the right edge of the row to the right
  // edge of the note tag (or role text if no note).
  const rightEdgeEls = await agentRow.locator('span').all()
  let rightmostRight = rowBox!.x   // fall back — no content = 0 gap
  for (const el of rightEdgeEls) {
    const b = await el.boundingBox()
    if (b && b.x + b.width > rightmostRight) rightmostRight = b.x + b.width
  }
  const rightGap = (rowBox!.x + rowBox!.width) - rightmostRight

  // eslint-disable-next-line no-console
  console.log(`[diagnostic] rowBox=${JSON.stringify(rowBox)} leftGap=${leftGap.toFixed(1)}px rightGap=${rightGap.toFixed(1)}px`)

  // Padding tolerance — 8px allows for the border-l-2 status stripe
  // and small platform paint variance. Anything worse means the row
  // is visibly lopsided.
  expect(Math.abs(leftGap - rightGap)).toBeLessThan(8)
})
