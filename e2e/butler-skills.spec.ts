import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { execSync } from 'child_process'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, chmodSync } from 'fs'
import { tmpdir } from 'os'

/**
 * App Settings → About me + Skills. `claude -p` is a fake script
 * (HIVE_CLAUDE_BIN): "Try" prints a canned output, "Describe a change"
 * returns the shipped answer-feishu skill with one tone line changed.
 */

const PROJECT_ROOT = join(__dirname, '..')
const ROOT = join(tmpdir(), 'hive-e2e-butler-skills')
const HIVE_DATA_DIR = join(ROOT, 'data')
const BUTLER_DIR = join(HIVE_DATA_DIR, 'butler')
const FAKE = join(ROOT, 'fake-claude')
const PROPOSAL = join(ROOT, 'proposal.md')
const SHIPPED = join(PROJECT_ROOT, 'resources', 'butler', 'skills', 'answer-feishu.md')

const FAKE_SCRIPT = `#!/bin/bash
IN=$(cat)
if echo "$IN" | grep -q "Rewrite this Butler skill"; then
  echo "<<<SKILL"; cat "${PROPOSAL}"; echo "SKILL>>>"
  echo "<<<EXAMPLE"; echo "【Mei 的 AI 代理】PR 提了，在等 review。"; echo "EXAMPLE>>>"
else
  echo "FAKE TRY OUTPUT"
fi
`

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true })
  mkdirSync(HIVE_DATA_DIR, { recursive: true })
  writeFileSync(FAKE, FAKE_SCRIPT)
  chmodSync(FAKE, 0o755)
  writeFileSync(PROPOSAL, readFileSync(SHIPPED, 'utf8').replace('- Plain text; no headings, no tables.', '- Casual, no 您好.'))
  execSync('npx electron-vite build', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 60000 })
  app = await electron.launch({
    args: [join(PROJECT_ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_ENV: 'test', HEADLESS: '1', HIVE_PORT: '17871', HIVE_DATA_DIR, HIVE_CLAUDE_BIN: FAKE }
  })
  page = await app.firstWindow({ timeout: 60000 })
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('button', { name: 'App Settings' }).click()
})

test.afterAll(async () => {
  await app?.close().catch(() => {})
})

test('About me saves the profile and shows what the agent reads', async () => {
  await page.getByLabel('Role').first().fill('产品负责人')
  await page.getByRole('radio', { name: 'Warm' }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).first().click()
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible()
  const saved = JSON.parse(readFileSync(join(BUTLER_DIR, 'profile.json'), 'utf8'))
  expect(saved.role).toBe('产品负责人')
  expect(saved.style).toBe('warm')
  await page.getByText('What your agent reads').click()
  await expect(page.getByLabel('What your agent reads')).toContainText('Role: 产品负责人')
})

test('Skills: tone + ask-first chip save as the form overlay', async () => {
  await page.getByRole('option', { name: /Answer Feishu/ }).click()
  await expect(page.getByRole('group', { name: 'Ask me first' }).getByText('🔒 dates')).toBeVisible()
  await page.getByRole('radiogroup', { name: 'Tone' }).getByRole('radio', { name: 'Friendly' }).click()
  await page.getByRole('button', { name: 'Add ask-first item' }).click()
  await page.getByLabel('New ask-first item').fill('hiring')
  await page.getByLabel('New ask-first item').press('Enter')
  await page.getByRole('button', { name: 'Save', exact: true }).last().click()
  await expect(page.getByText('customized', { exact: true })).toBeVisible()
  expect(JSON.parse(readFileSync(join(BUTLER_DIR, 'skills', 'answer-feishu.json'), 'utf8'))).toEqual({ tone: 'friendly', extraAskFirst: ['hiring'] })
  await expect.poll(() => readFileSync(join(BUTLER_DIR, '.claude', 'skills', 'answer-feishu', 'SKILL.md'), 'utf8')).toContain('- hiring')
})

test('Try runs the skill and shows the output', async () => {
  await page.getByRole('button', { name: 'Try' }).click()
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByLabel('Try result')).toHaveText('FAKE TRY OUTPUT')
})

test('Describe a change → chips + example → Accept saves an override; Reset removes it', async () => {
  await page.getByLabel('Describe a change').fill('别太正式')
  await page.getByRole('button', { name: 'Go' }).click()
  const card = page.getByLabel('Proposed change')
  await expect(card.getByText('✓ checks')).toBeVisible()
  await expect(card.getByText('PR 提了，在等 review。')).toBeVisible()
  expect(existsSync(join(BUTLER_DIR, 'skills', 'answer-feishu.md'))).toBe(false)
  await card.getByRole('button', { name: 'Accept' }).click()
  await expect(card).toBeHidden()
  await expect.poll(() => existsSync(join(BUTLER_DIR, 'skills', 'answer-feishu.md'))).toBe(true)
  expect(readFileSync(join(BUTLER_DIR, 'skills', 'answer-feishu.md'), 'utf8')).toContain('- Casual, no 您好.')
  await page.getByRole('button', { name: 'Reset' }).first().click()
  await expect.poll(() => existsSync(join(BUTLER_DIR, 'skills', 'answer-feishu.md'))).toBe(false)
  expect(existsSync(join(BUTLER_DIR, 'skills', 'answer-feishu.json'))).toBe(false)
})
