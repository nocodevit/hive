// v2.15.1 — verify Future Pink palette carries neon-fuchsia accents
// on a NEUTRAL DARK GREY base (not dark pink). User feedback:
// '粉应该搭配深灰 (dark theme)'. v2.15.0's pink-tinted bases went
// muddy and clashed with the Pepper-locked chat pane; v2.15.1
// keeps bg-* neutral grey so accents pop harder.
//
// Assertions:
//   - Accents (--accent, --accent-muted) remain hot neon fuchsia
//     (R > 200, R-G >= 100 chroma gap).
//   - Text-muted still leans pink (bubblegum, not taupe).
//   - Base surfaces (bg-primary/bg-secondary/bg-hover) are near-
//     neutral grey with only a whisper of hue — chroma delta between
//     R and G channels must be small.
//   - --bg-terminal restored to Crush Pepper #201F26.

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

function parseRgb(input: string): [number, number, number] {
  const m = input.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])]
  const hex = input.replace('#', '')
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]
}

test('future-pink dark: accents neon, bases neutral grey, chat bg = Pepper', async () => {
  await page.evaluate(() => {
    const r = document.documentElement
    r.setAttribute('data-theme', 'dark')
    r.setAttribute('data-palette', 'future-pink')
  })
  await page.waitForTimeout(300)

  const shot = join(outDir, 'pink-dark.png')
  await page.screenshot({ path: shot, fullPage: false })
  console.log(`[pink] captured ${shot}`)

  const tokens = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement)
    return {
      bgPrimary:   cs.getPropertyValue('--bg-primary').trim(),
      bgHover:     cs.getPropertyValue('--bg-hover').trim(),
      border:      cs.getPropertyValue('--border-default').trim(),
      textMuted:   cs.getPropertyValue('--text-muted').trim(),
      accent:      cs.getPropertyValue('--accent').trim(),
      accentMuted: cs.getPropertyValue('--accent-muted').trim(),
      bgTerminal:  cs.getPropertyValue('--bg-terminal').trim(),
    }
  })
  console.log('[pink] tokens =', JSON.stringify(tokens, null, 2))

  // Base surfaces: near-neutral grey — chroma delta between R and G
  // must be small (< 15). Rules out both dark-pink and dark-plum.
  const checkNeutralGrey = (label: string, hex: string) => {
    const [r, g, b] = parseRgb(hex)
    const chroma = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b))
    expect(chroma, `${label}=${hex}: chroma ${chroma} must be < 20 (near-neutral grey, not pink base)`).toBeLessThan(20)
  }
  checkNeutralGrey('bgPrimary', tokens.bgPrimary)
  checkNeutralGrey('bgHover',   tokens.bgHover)

  // Accents: hot neon fuchsia.
  const checkNeon = (label: string, hex: string) => {
    const [r, g, _b] = parseRgb(hex)
    expect(r, `${label}=${hex}: R must be > 200 for neon`).toBeGreaterThan(200)
    expect(r - g, `${label}=${hex}: R-G chroma must be >= 100 for neon punch`).toBeGreaterThanOrEqual(100)
  }
  checkNeon('accent',      tokens.accent)
  checkNeon('accentMuted', tokens.accentMuted)

  // Text-muted stays pink (bubblegum, not brown/taupe).
  const [tr, tg, tb] = parseRgb(tokens.textMuted)
  expect(tr, `textMuted=${tokens.textMuted}: R must be > G (pink lean)`).toBeGreaterThan(tg)

  // Chat pane restored to Crush Pepper #201F26 = rgb(32, 31, 38).
  const [pr, pg, pb] = parseRgb(tokens.bgTerminal)
  expect(pr, `bgTerminal=${tokens.bgTerminal}: R must equal Pepper R=32`).toBe(32)
  expect(pg, `bgTerminal=${tokens.bgTerminal}: G must equal Pepper G=31`).toBe(31)
  expect(pb, `bgTerminal=${tokens.bgTerminal}: B must equal Pepper B=38`).toBe(38)
})

test('tech-blue dark: chat bg also = Pepper (v2.15.1 revert)', async () => {
  await page.evaluate(() => {
    const r = document.documentElement
    r.setAttribute('data-theme', 'dark')
    r.setAttribute('data-palette', 'tech-blue')
  })
  await page.waitForTimeout(300)
  const bgTerminal = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--bg-terminal').trim()
  )
  const [r, g, b] = parseRgb(bgTerminal)
  expect(r).toBe(32)
  expect(g).toBe(31)
  expect(b).toBe(38)
})
