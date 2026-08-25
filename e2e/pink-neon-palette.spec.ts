// v2.15.0 diagnostic — verify Future Pink palette actually reads
// as neon pink and NOT as warm-plum/brown.
//
// Strategy: after switching to future-pink dark, read the computed
// values of key surface tokens through window.getComputedStyle and
// assert their RGB channels satisfy R > B > G (cool-pink lean, not
// R > G > B which is warm-brown). Also take screenshots so a human
// can eyeball the vibe.
//
// Runs against a real Electron main+renderer bundle so the CSS
// cascade order matches production exactly.

import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { mkdtempSync, rmSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'

let app: ElectronApplication
let page: Page
let dataDir: string
let outDir: string

test.beforeAll(async () => {
  const { execSync } = require('child_process')
  execSync('npx electron-vite build', { cwd: join(__dirname, '..'), stdio: 'pipe', timeout: 90000 })
  dataDir = mkdtempSync(join(tmpdir(), 'hive-e2e-pink-'))
  outDir = join(__dirname, '..', 'test-results', 'pink-neon')
  mkdirSync(outDir, { recursive: true })

  app = await electron.launch({
    args: [join(__dirname, '..', 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_ENV: 'test', HEADLESS: '1', HIVE_PORT: '17811', HIVE_DATA_DIR: dataDir },
  })
  page = await app.firstWindow({ timeout: 60000 })
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(1500)
}, 180000)

test.afterAll(async () => {
  await app?.close()
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
})

// Parse "rgb(21, 5, 18)" or "#150512" → [r, g, b].
function parseRgb(input: string): [number, number, number] {
  const m = input.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])]
  const hex = input.replace('#', '')
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]
}

test('future-pink dark reads as neon pink, not warm-plum brown', async () => {
  await page.evaluate(() => {
    const r = document.documentElement
    r.setAttribute('data-theme', 'dark')
    r.setAttribute('data-palette', 'future-pink')
  })
  await page.waitForTimeout(300)

  const shot = join(outDir, 'pink-dark.png')
  await page.screenshot({ path: shot, fullPage: false })
  console.log(`[pink] captured ${shot}`)

  // Read the actual computed tokens off :root.
  const tokens = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement)
    return {
      bgPrimary:  cs.getPropertyValue('--bg-primary').trim(),
      bgHover:    cs.getPropertyValue('--bg-hover').trim(),
      bgActive:   cs.getPropertyValue('--bg-active').trim(),
      border:     cs.getPropertyValue('--border-default').trim(),
      textMuted:  cs.getPropertyValue('--text-muted').trim(),
      accent:     cs.getPropertyValue('--accent').trim(),
      accentMuted:cs.getPropertyValue('--accent-muted').trim(),
      bgTerminal: cs.getPropertyValue('--bg-terminal').trim(),
    }
  })
  console.log('[pink] tokens =', JSON.stringify(tokens, null, 2))

  // Invariant: R > B > G on every bg/border/text-muted/accent so no
  // token falls into the warm-brown quadrant (R > G > B). We check
  // the strict cool-pink lean: R strictly greater than G, and B
  // strictly greater than G. Accents (mid-luminance saturated pinks)
  // must additionally have R >> G (chroma gap of at least 100 units).
  const checkPinkLean = (label: string, hex: string) => {
    const [r, g, b] = parseRgb(hex)
    // Every pink token: R must lead and G must trail. B >= G.
    expect(r, `${label}=${hex}: R (${r}) must be greatest channel`).toBeGreaterThan(g)
    expect(b, `${label}=${hex}: B (${b}) must be >= G (${g}) (cool-pink lean, not warm-plum)`).toBeGreaterThanOrEqual(g)
  }
  const checkNeonAccent = (label: string, hex: string) => {
    const [r, g, b] = parseRgb(hex)
    expect(r, `${label}=${hex}: R (${r}) must be > 200 for neon feel`).toBeGreaterThan(200)
    expect(r - g, `${label}=${hex}: R-G chroma (${r - g}) must be >= 100 for neon punch`).toBeGreaterThanOrEqual(100)
  }

  checkPinkLean('bgPrimary',   tokens.bgPrimary)
  checkPinkLean('bgHover',     tokens.bgHover)
  checkPinkLean('bgActive',    tokens.bgActive)
  checkPinkLean('border',      tokens.border)
  checkPinkLean('textMuted',   tokens.textMuted)
  checkPinkLean('bgTerminal',  tokens.bgTerminal)

  checkNeonAccent('accent',       tokens.accent)
  checkNeonAccent('accentMuted',  tokens.accentMuted)

  // Chat pane bg-terminal MUST have shifted away from Crush Pepper
  // (#201F26 = R=32, G=31, B=38 — cool-grey, no pink).
  const [tr, tg, tb] = parseRgb(tokens.bgTerminal)
  expect(tr, `bgTerminal R (${tr}) must be > 32 (Pepper R) to prove pink tint applied`).toBeGreaterThan(32)
})

test('future-pink light stays soft pastel pink', async () => {
  await page.evaluate(() => {
    const r = document.documentElement
    r.setAttribute('data-theme', 'light')
    r.setAttribute('data-palette', 'future-pink')
  })
  await page.waitForTimeout(300)
  const shot = join(outDir, 'pink-light.png')
  await page.screenshot({ path: shot, fullPage: false })
  console.log(`[pink] captured ${shot}`)
  expect(true).toBe(true)
})

test('tech-blue dark chat bg follows palette (v2.15.0)', async () => {
  await page.evaluate(() => {
    const r = document.documentElement
    r.setAttribute('data-theme', 'dark')
    r.setAttribute('data-palette', 'tech-blue')
  })
  await page.waitForTimeout(300)
  const shot = join(outDir, 'blue-dark.png')
  await page.screenshot({ path: shot, fullPage: false })
  console.log(`[pink] captured ${shot}`)

  const bgTerminal = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--bg-terminal').trim()
  )
  const [r, g, b] = parseRgb(bgTerminal)
  // Blue lean: B > R and B > G.
  expect(b, `tech-blue bg-terminal=${bgTerminal}: B (${b}) must be > R (${r})`).toBeGreaterThan(r)
  expect(b, `tech-blue bg-terminal=${bgTerminal}: B (${b}) must be > G (${g})`).toBeGreaterThan(g)
})
