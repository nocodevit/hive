import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { execSync } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'

/**
 * 🌿 Botanic: a calm green palette, easy on the eyes in light and dark.
 * Easy on the eyes = no pure white or pure black ground, and body text that
 * reads well (≥ 7:1) without glaring (≤ 15:1, pure black on white is 21:1).
 */

const PROJECT_ROOT = join(__dirname, '..')
let app: ElectronApplication
let page: Page
let dataDir: string

const launch = async () => {
  app = await electron.launch({
    args: [join(PROJECT_ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_ENV: 'test', HEADLESS: '1', HIVE_PORT: '17897', HIVE_DATA_DIR: dataDir }
  })
  page = await app.firstWindow({ timeout: 60000 })
  await page.waitForLoadState('domcontentloaded')
}

test.beforeAll(async () => {
  execSync('npx electron-vite build', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 90000 })
  dataDir = mkdtempSync(join(tmpdir(), 'hive-e2e-botanic-'))
  await launch()
})

test.afterAll(async () => {
  await app?.close().catch(() => {})
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
})

const look = () => page.evaluate(() => {
  const cs = getComputedStyle(document.documentElement)
  const hex = (v: string) => { const h = cs.getPropertyValue(v).trim().replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) }
  const lum = (rgb: number[]) => { const [r, g, b] = rgb.map(c => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
  const ratio = (a: string, b: string) => { const [x, y] = [lum(hex(a)), lum(hex(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  return {
    theme: document.documentElement.dataset.theme,
    palette: document.documentElement.dataset.palette,
    grounds: ['--bg-primary', '--bg-secondary'].map(v => cs.getPropertyValue(v).trim().toLowerCase()),
    text: ratio('--text-primary', '--bg-secondary'),
    muted: ratio('--text-muted', '--bg-secondary'),
  }
})

const checkComfort = async () => {
  const l = await look()
  expect(l.palette).toBe('botanic')
  for (const g of l.grounds) expect(['#ffffff', '#000000']).not.toContain(g)
  expect(l.text).toBeGreaterThanOrEqual(7)
  expect(l.text).toBeLessThanOrEqual(15)
  expect(l.muted).toBeGreaterThanOrEqual(3.5)
  return l.theme
}

test('Settings › Theme palette › Botanic: comfortable in both light and dark, and it sticks', async () => {
  await page.getByRole('button', { name: 'App Settings' }).click()
  const section = page.getByLabel('Palette section')
  await section.scrollIntoViewIfNeeded()
  await section.getByRole('button', { name: /Botanic/ }).click()
  await expect(section.getByRole('button', { name: /Botanic/ })).toHaveAttribute('aria-pressed', 'true')

  const first = await checkComfort()
  await page.screenshot({ path: test.info().outputPath(`botanic-${first}.png`) })
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: /Switch to (light|dark) mode/ }).click()
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).not.toBe(first)
  const second = await checkComfort()
  await page.screenshot({ path: test.info().outputPath(`botanic-${second}.png`) })

  await app.close()
  await launch()
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.palette)).toBe('botanic')
})

test('the garden: real flowers on the ground behind the app, never over a button; a gust blows petals across', async () => {
  await expect(page.getByTestId('botanic-fx')).toBeAttached()
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll<HTMLImageElement>('.bfx-plant img')].filter(i => i.complete && i.naturalWidth > 0).length), { timeout: 5000 }).toBe(13)
  expect(await page.evaluate(() => ['.bfx', '.bfx-ground'].map(q => getComputedStyle(document.querySelector(q)!).pointerEvents))).toEqual(['none', 'none'])
  // The plants grow behind the app: what's under the pointer on the sidebar is the app's own button, not a flower.
  const box = (await page.getByText('Add Project').boundingBox())!
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.bfx-ground') ? 'plant' : 'app', [box.x + 10, box.y + box.height / 2])
  expect(hit).toBe('app')
  // The bed has its own room under the sidebar buttons.
  const below = await page.evaluate(([y]) => window.innerHeight - y, [box.y + box.height])
  expect(below).toBeGreaterThan(150)

  await page.evaluate(() => (window as any).__hiveGust())
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('.bfx-bit').length), { timeout: 3000 }).toBeGreaterThan(3)
  await expect.poll(() => page.evaluate(() => document.querySelector('.bfx-gust')!.getAnimations().length), { timeout: 3000 }).toBeGreaterThan(0)
  await page.waitForTimeout(1500)
  await page.screenshot({ path: test.info().outputPath('botanic-gust.png') })
})

test('switching away from Botanic takes the garden with it', async () => {
  await page.getByRole('button', { name: 'App Settings' }).click()
  const section = page.getByLabel('Palette section')
  await section.scrollIntoViewIfNeeded()
  await section.getByRole('button', { name: /Neon Purple/ }).click()
  await expect(page.getByTestId('botanic-fx')).toHaveCount(0)
})
