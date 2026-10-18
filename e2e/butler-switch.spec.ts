import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { execSync } from 'child_process'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, chmodSync, statSync } from 'fs'
import { tmpdir } from 'os'

/**
 * Settings → "Allow remote control from my phone (Butler)": switching it on
 * writes the bundled butler files and runs `claude remote-control` in
 * ~/.hive/butler; the folder-trust prompt waits for the owner's OK; a
 * restart brings the session back; switching off stops it and keeps the
 * folder. `claude` is a fake script (HIVE_CLAUDE_BIN), so no real Remote
 * Control session is created.
 */

const PROJECT_ROOT = join(__dirname, '..')
const ROOT = join(tmpdir(), 'hive-e2e-butler-switch')
const HIVE_DATA_DIR = join(ROOT, 'data')
const FAKE = join(ROOT, 'fake-claude')
const FAKE_LOG = join(ROOT, 'fake-claude.log')
const BUTLER_DIR = join(HIVE_DATA_DIR, 'butler')
const SWITCH = 'Allow remote control from my phone (Butler)'

const CLAUDE_HOME = join(ROOT, 'claude-home')

// Mirrors the real `claude remote-control` (2.1.x) dialogue: trust [y/N],
// then "Enable Remote Control? (y/n)", then Connected + link; records the
// session in bridge-pointer.json like the real one does.
const FAKE_SCRIPT = `#!/bin/bash
echo "$PWD|$*" >> "$FAKE_LOG"
echo "Quick safety check: is this a project you created or one you trust?"
printf "Trust $PWD? [y/N] "
read -r a; [ "$a" = "y" ] || exit 1
printf "Enable Remote Control? (y/n) "
read -r a; [ "$a" = "y" ] || exit 1
SLUG=$(pwd -P | sed 's/[^a-zA-Z0-9]/-/g')
mkdir -p "$CLAUDE_CONFIG_DIR/projects/$SLUG"
echo '{"sessionId":"session_fake123","environmentId":"env_fake","source":"standalone"}' > "$CLAUDE_CONFIG_DIR/projects/$SLUG/bridge-pointer.json"
echo "Connected · butler"
echo "Continue coding in the Claude mobile app or https://claude.ai/code?environment=env_fake"
while true; do sleep 1; done
`

let app: ElectronApplication
let page: Page

async function launch() {
  app = await electron.launch({
    args: [join(PROJECT_ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_ENV: 'test', HEADLESS: '1', HIVE_PORT: '17823', HIVE_DATA_DIR, HIVE_CLAUDE_BIN: FAKE, FAKE_LOG, CLAUDE_CONFIG_DIR: CLAUDE_HOME }
  })
  page = await app.firstWindow({ timeout: 60000 })
  await page.waitForLoadState('domcontentloaded')
}

async function openSettings() {
  await page.getByRole('button', { name: 'App Settings' }).click()
  await expect(page.getByRole('switch', { name: SWITCH })).toBeVisible()
}

const spawns = () => (existsSync(FAKE_LOG) ? readFileSync(FAKE_LOG, 'utf8').trim().split('\n').filter(Boolean) : [])
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
const butlerPid = () => Number(readFileSync(join(BUTLER_DIR, '.pid'), 'utf8'))

test.beforeAll(async () => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true })
  mkdirSync(HIVE_DATA_DIR, { recursive: true })
  writeFileSync(FAKE, FAKE_SCRIPT)
  chmodSync(FAKE, 0o755)
  execSync('npx electron-vite build', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 60000 })
  await launch()
})

test.afterAll(async () => {
  await app?.close().catch(() => {})
})

test('switch is off by default and nothing runs', async () => {
  await openSettings()
  await expect(page.getByRole('switch', { name: SWITCH })).toHaveAttribute('aria-checked', 'false')
  expect(spawns()).toEqual([])
  expect(existsSync(BUTLER_DIR)).toBe(false)
})

test('switching on installs the files, asks before trusting, then connects', async () => {
  await page.getByRole('switch', { name: SWITCH }).click()
  await expect(page.getByRole('switch', { name: SWITCH })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByText('Waiting for your OK')).toBeVisible()

  expect(readFileSync(join(BUTLER_DIR, 'CLAUDE.md'), 'utf8')).toContain('Exact names only')
  expect(statSync(join(BUTLER_DIR, 'hive')).mode & 0o111).toBeTruthy()
  expect(JSON.parse(readFileSync(join(BUTLER_DIR, '.claude', 'settings.json'), 'utf8')).permissions.allow).toContain('Bash(./hive send:*)')

  const [first] = spawns()
  const [cwd, args] = first.split('|')
  expect(cwd).toBe(BUTLER_DIR)
  expect(args).toBe('remote-control --name Hive Butler --permission-mode dontAsk --continue')

  await page.getByRole('button', { name: 'Trust and continue' }).click()
  await expect(page.getByText('Connected', { exact: true })).toBeVisible()
  await expect(page.getByText('open the Claude app → Code and tap “Hive Butler”')).toBeVisible()
  expect(readFileSync(join(BUTLER_DIR, '.session-id'), 'utf8')).toBe('session_fake123')
})

test('a restart brings the session back; quitting stops the old one', async () => {
  const pid = butlerPid()
  expect(alive(pid)).toBe(true)
  await app.close()
  await expect.poll(() => alive(pid), { timeout: 10000 }).toBe(false)

  await launch()
  await expect.poll(() => spawns().length, { timeout: 20000 }).toBe(2)
  expect(spawns()[1].split('|')[1]).toBe('remote-control --session-id session_fake123')
  await openSettings()
  await expect(page.getByRole('switch', { name: SWITCH })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByText('Waiting for your OK')).toBeVisible()
})

test('switching off stops the session and keeps the folder', async () => {
  const pid = butlerPid()
  expect(alive(pid)).toBe(true)
  await page.getByRole('switch', { name: SWITCH }).click()
  await expect(page.getByRole('switch', { name: SWITCH })).toHaveAttribute('aria-checked', 'false')
  await expect.poll(() => alive(pid), { timeout: 10000 }).toBe(false)
  expect(existsSync(join(BUTLER_DIR, 'CLAUDE.md'))).toBe(true)
  expect(JSON.parse(readFileSync(join(HIVE_DATA_DIR, 'butler.json'), 'utf8'))).toEqual({ enabled: false })
})
