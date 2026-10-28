import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { execSync, spawnSync } from 'child_process'
import { mkdirSync, rmSync, existsSync, writeFileSync, chmodSync, readFileSync } from 'fs'
import { tmpdir } from 'os'

/**
 * Butler › Todo: note one, group / sort, Done moves it to Completed with its
 * history; "+" on an Approve card makes a todo about that card; the ? guide
 * follows the system language, switches 中 / EN, and Try sends to the Chat.
 */
const PROJECT_ROOT = join(__dirname, '..')
const ROOT = join(tmpdir(), 'hive-e2e-butler-todo')
const HIVE_DATA_DIR = join(ROOT, 'data')
const BUTLER = join(HIVE_DATA_DIR, 'butler')
const FAKE = join(ROOT, 'fake-claude')
let app: ElectronApplication
let page: Page
const panel = () => page.getByRole('complementary', { name: 'Butler panel' })

test.beforeAll(async () => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true })
  mkdirSync(BUTLER, { recursive: true })
  writeFileSync(FAKE, '#!/bin/bash\nwhile read -r _; do :; done\n')
  chmodSync(FAKE, 0o755)
  writeFileSync(join(BUTLER, 'approvals.json'), JSON.stringify([
    { id: 'fs-9', kind: 'feishu.followup', title: 'Pod · SOW 改动是否进 P4', subtitle: 'Feishu · facts sent, your call', draft: '', payload: { chatId: 'oc_9', messageId: 'om_9', question: 'SOW 6 条', topic: '是否进 P4', sent: '收到…' }, action: 'Reply', status: 'pending', createdAt: 1 }
  ]))
  execSync('npx electron-vite build', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 60000 })
  app = await electron.launch({
    args: [join(PROJECT_ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_ENV: 'test', HEADLESS: '1', HIVE_PORT: '17896', HIVE_DATA_DIR, HIVE_CLAUDE_BIN: FAKE, CLAUDE_CONFIG_DIR: join(ROOT, 'claude-home') }
  })
  page = await app.firstWindow({ timeout: 60000 })
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('button', { name: 'Butler', exact: true }).click()
})
test.afterAll(async () => { await app?.close().catch(() => {}) })

test('note a todo; Done moves it to Completed, where its history stays', async () => {
  await panel().getByRole('tab', { name: /Todo/ }).click()
  await panel().getByLabel('New todo').fill('周五前跟 Daniel 确认 Claro 漫游')
  await panel().getByRole('button', { name: 'Add', exact: true }).click()
  const todayGroup = panel().getByRole('group', { name: 'Today' })
  await expect(todayGroup).toContainText('周五前跟 Daniel 确认 Claro 漫游')
  await expect(panel().getByRole('tab', { name: /Todo/ })).toContainText('1')
  await panel().getByLabel('Done: 周五前跟 Daniel 确认 Claro 漫游').click()
  const done = panel().getByRole('group', { name: 'Completed' })
  await expect(done).toContainText('Completed · 1')
  await done.getByText('Completed · 1').click()
  await done.getByRole('button', { name: 'View 周五前跟 Daniel 确认 Claro 漫游' }).click()
  await expect(done.getByLabel('History')).toContainText('Done')
  const lines = readFileSync(join(BUTLER, 'todos.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l))
  expect(lines.map(l => l.op)).toEqual(['create', 'status'])
})

test('select several, Move to tomorrow: due changes, created stays', async () => {
  await panel().getByRole('tab', { name: /Todo/ }).click()
  for (const t of ['回 Lin UAT', '看 SOW 6 条']) {
    await panel().getByLabel('New todo').fill(t)
    await panel().getByRole('button', { name: 'Add', exact: true }).click()
  }
  await panel().getByRole('button', { name: 'Select', exact: true }).click()
  await panel().getByLabel('Select: 回 Lin UAT').click()
  await panel().getByLabel('Select: 看 SOW 6 条').click()
  const bar = panel().getByRole('toolbar', { name: 'Selected todos' })
  await expect(bar).toContainText('2 selected')
  await bar.getByRole('button', { name: 'Move to tomorrow' }).click()
  await expect(bar).toHaveCount(0)
  const d = new Date(); const tm = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
  const mmdd = `${String(tm.getMonth() + 1).padStart(2, '0')}-${String(tm.getDate()).padStart(2, '0')}`
  await expect(panel().getByLabel('Todo: 回 Lin UAT')).toContainText(mmdd)
  await expect(panel().getByRole('group', { name: 'Today' })).toContainText('回 Lin UAT')
  const lines = readFileSync(join(BUTLER, 'todos.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l))
  expect(lines.filter(l => l.op === 'due')).toHaveLength(2)
})

test('priority: ⚡ 要命 storms to the top, change it from the chip, Butler sets it too', async () => {
  await panel().getByRole('tab', { name: /Todo/ }).click()
  const pick = panel().getByRole('radiogroup', { name: 'Pick priority' })
  await expect(pick.getByRole('radio', { name: '冒烟' })).toHaveAttribute('aria-checked', 'true')
  await pick.getByRole('radio', { name: '要命' }).click()
  await panel().getByLabel('New todo').fill('Claro 合同今天必须回')
  await panel().getByRole('button', { name: 'Add', exact: true }).click()
  await expect(pick.getByRole('radio', { name: '冒烟' })).toHaveAttribute('aria-checked', 'true')
  const today = panel().getByRole('group', { name: 'Today' })
  await expect(today.getByLabel(/^Todo: /).first()).toHaveAccessibleName('Todo: Claro 合同今天必须回')
  await expect(today.getByRole('button', { name: 'Priority 要命: Claro 合同今天必须回' })).toContainText('要命')
  await panel().screenshot({ path: test.info().outputPath('todo-storm.png') })

  await today.getByRole('button', { name: 'Priority 冒烟: 回 Lin UAT' }).click()
  await panel().getByRole('menu', { name: 'Priority' }).getByRole('menuitemradio', { name: /冻着/ }).click()
  await expect(today.getByRole('button', { name: 'Priority 冻着: 回 Lin UAT' })).toBeVisible()
  await expect(today.getByLabel(/^Todo: /).last()).toHaveAccessibleName('Todo: 回 Lin UAT')

  const cli = spawnSync('python3', [join(__dirname, '..', 'resources', 'butler', 'hive'), 'todo', 'add', 'Butler 记的急事', '--pri', '1'], { env: { ...process.env, HIVE_DATA_DIR }, encoding: 'utf8' })
  expect(cli.status).toBe(0)
  await expect(today.getByRole('button', { name: 'Priority 要命: Butler 记的急事' })).toBeVisible()
  const lines = readFileSync(join(BUTLER, 'todos.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l))
  expect(lines.filter(l => l.op === 'priority')).toHaveLength(1)
})

test('Drop is instant with an Undo toast; Undo puts it back', async () => {
  await panel().getByRole('tab', { name: /Todo/ }).click()
  await panel().getByLabel('New todo').fill('临时要丢的事')
  await panel().getByRole('button', { name: 'Add', exact: true }).click()
  await panel().getByRole('button', { name: 'View 临时要丢的事' }).click()
  await panel().getByRole('button', { name: 'Drop 临时要丢的事' }).click()
  await expect(panel().getByRole('group', { name: 'Today' }).getByLabel('Todo: 临时要丢的事')).toHaveCount(0)
  const toast = panel().getByRole('status').filter({ hasText: 'Dropped · 临时要丢的事' })
  await toast.getByRole('button', { name: 'Undo' }).click()
  await expect(panel().getByRole('group', { name: 'Today' }).getByLabel('Todo: 临时要丢的事')).toBeVisible()
})

test('group by source; "+" on an Approve card makes a todo about it', async () => {
  await panel().getByRole('tab', { name: /Approve/ }).click()
  const card = panel().getByLabel('Reply: Pod · SOW 改动是否进 P4')
  await card.getByRole('button', { name: 'Add Pod · SOW 改动是否进 P4 to Todo' }).click()
  await expect(card.getByRole('button', { name: 'Add Pod · SOW 改动是否进 P4 to Todo' })).toBeDisabled()
  await panel().getByRole('tab', { name: /Todo/ }).click()
  await panel().getByLabel('Group by').selectOption('source')
  const feishu = panel().getByRole('group', { name: 'Feishu' })
  await expect(feishu).toContainText('Pod · 是否进 P4')
  await feishu.getByText('Pod · 是否进 P4').first().click()
  await expect(feishu.getByLabel('History')).toHaveCount(0)
  await feishu.getByRole('button', { name: /^View Pod · 是否进 P4/ }).click()
  await expect(feishu.getByLabel('History')).toContainText('SOW 6 条')
  await panel().screenshot({ path: test.info().outputPath('todo-tab.png') })
})

test('the ? guide: system language, 中 / EN switch, Try sends the line to the Chat', async () => {
  await panel().getByRole('button', { name: 'How to use Butler' }).click()
  const guide = panel().getByRole('dialog', { name: 'How to use Butler' })
  await guide.getByRole('radio', { name: 'EN' }).click()
  await expect(guide).toContainText('Just say it in Chat')
  await guide.getByRole('radio', { name: '中' }).click()
  await expect(guide).toContainText('在 Chat 里直接说')
  await guide.getByRole('button', { name: 'Try: 有什么在等我？' }).click()
  await expect(guide).toHaveCount(0)
  await expect(panel().getByRole('tab', { name: /Chat/ })).toHaveAttribute('aria-selected', 'true')
  await expect(panel().getByText('有什么在等我？').first()).toBeVisible({ timeout: 15000 })
})
