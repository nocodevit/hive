import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { execSync } from 'child_process'
import { mkdirSync, rmSync, existsSync, writeFileSync, chmodSync, readFileSync } from 'fs'
import { tmpdir } from 'os'

/**
 * Butler → Sessions shows, under each agent, the task you last gave it and
 * how it ended the turn. Clicking opens the whole reply and a reply box; what
 * you send goes into that agent's chat (resuming it when it is off) without
 * leaving the Butler panel. `claude` is a fake that writes what it receives.
 */

const PROJECT_ROOT = join(__dirname, '..')
const ROOT = join(tmpdir(), 'hive-e2e-butler-session-card')
const HIVE_DATA_DIR = join(ROOT, 'data')
const FAKE = join(ROOT, 'fake-claude')
const GOT = join(ROOT, 'got.txt')
const REPLY = 'Compared both plans.\nThree differences: price, data cap, roaming.\nShall I write the summary table?'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true })
  mkdirSync(join(HIVE_DATA_DIR, 'chat-logs'), { recursive: true })
  mkdirSync(join(ROOT, 'claude-home'), { recursive: true })
  writeFileSync(FAKE, `#!/bin/bash\nwhile read -r l; do echo "$l" >> '${GOT}'; done\n`)
  chmodSync(FAKE, 0o755)
  const prefs = { autoRunClaude: false, startupCommand: '' }
  const avatar = { skinTone: '#f5d0a9', hairStyle: 'short', hairColor: '#2c1810', topStyle: 'tee', topColor: '#7c3aed', bottomStyle: 'pants', bottomColor: '#1e293b', hat: 'none', accessories: [] }
  const agent = (id: string, name: string, order: number) => ({ avatar, id, projectId: 'p1', zoneId: 'z1', name, role: 'Eng', type: 'non-coding', department: 'Non-R&D', group: '', order, status: 'done', soul: '', enabledSkills: [], preferences: prefs, model: 'inherit', effort: 'high' })
  writeFileSync(join(HIVE_DATA_DIR, 'data.json'), JSON.stringify({
    projects: [{ id: 'p1', name: 'Card Test', officePath: ROOT, zones: [{ id: 'z1', name: 'src', path: ROOT, type: 'non-rnd', hasGit: false }] }],
    agents: [agent('a1', 'Missy', 0), agent('a2', 'Quinn', 1)],
    appPrefs: { autoRunClaude: false, maxLogs: 100, continueSession: false }
  }))
  const ev = (o: object) => JSON.stringify(o)
  writeFileSync(join(HIVE_DATA_DIR, 'chat-logs', 'chat-a1-1000.jsonl'), [
    ev({ _direction: 'stdin', type: 'user', message: { content: [{ type: 'text', text: 'compare the two plans' }] } }),
    ev({ type: 'assistant', message: { content: [{ type: 'text', text: 'Looking at both.' }] } }),
    ev({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'plans.md' } }] } }),
    ev({ type: 'assistant', message: { content: [{ type: 'text', text: REPLY }] } }),
    ev({ type: 'result', subtype: 'success' })
  ].join('\n') + '\n')
  execSync('npx electron-vite build', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 60000 })
  app = await electron.launch({
    args: [join(PROJECT_ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_ENV: 'test', HEADLESS: '1', HIVE_PORT: '17900', HIVE_DATA_DIR, HIVE_CLAUDE_BIN: FAKE, CLAUDE_CONFIG_DIR: join(ROOT, 'claude-home') }
  })
  page = await app.firstWindow({ timeout: 60000 })
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByText('Card Test').first()).toBeVisible()
})

test.afterAll(async () => {
  await app?.close().catch(() => {})
})

test('each agent shows its last task and last reply; no log, no summary', async () => {
  await page.getByRole('button', { name: 'Butler', exact: true }).click()
  const panel = page.getByRole('complementary', { name: 'Butler panel' })
  await panel.getByRole('tab', { name: /Sessions/ }).click()
  const show = panel.getByRole('button', { name: "Show Missy's last reply" })
  await expect(show).toContainText('compare the two plans')
  await expect(show).toContainText('Compared both plans.')
  await expect(show).not.toContainText('Looking at both.')
  await expect(panel.getByRole('button', { name: "Show Quinn's last reply" })).toHaveCount(0)
})

test('opening it shows the whole reply; a reply goes to that agent from the panel', async () => {
  const panel = page.getByRole('complementary', { name: 'Butler panel' })
  await panel.getByRole('button', { name: "Show Missy's last reply" }).click()
  await expect(panel.getByRole('region', { name: "Missy's last reply" })).toContainText('Shall I write the summary table?')
  const box = panel.getByRole('textbox', { name: 'Reply to Missy' })
  await box.fill('yes, write the table')
  await box.press('Enter')
  await expect(panel.getByRole('button', { name: 'Send to Missy' })).toContainText('✓ Sent', { timeout: 60000 })
  await expect(box).toHaveValue('')
  await expect.poll(() => (existsSync(GOT) ? readFileSync(GOT, 'utf-8') : ''), { timeout: 30000 }).toContain('yes, write the table')
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('button', { name: "Hide Missy's last reply" })).toContainText('yes, write the table', { timeout: 15000 })
})
