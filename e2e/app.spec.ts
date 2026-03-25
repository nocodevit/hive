import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  // Build first
  const { execSync } = require('child_process')
  execSync('npx electron-vite build', { cwd: join(__dirname, '..'), stdio: 'pipe', timeout: 60000 })

  app = await electron.launch({
    args: [join(__dirname, '..', 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_ENV: 'test', HIVE_PORT: '17799' }
  })
  page = await app.firstWindow({ timeout: 60000 })
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(2000)
}, 120000)

test.afterAll(async () => {
  await app?.close()
})

test.describe('App Launch', () => {
  test('window opens with correct title', async () => {
    const title = await page.title()
    expect(title).toContain('Hive')
  })

  test('three-column layout is visible', async () => {
    // Projects sidebar
    const projects = page.locator('text=PROJECTS')
    await expect(projects).toBeVisible()

    // Add Project button
    const addProject = page.locator('text=Add Project')
    await expect(addProject).toBeVisible()
  })

  test('app settings modal opens', async () => {
    const settingsBtn = page.locator('button[title="App Settings"]')
    await expect(settingsBtn).toBeVisible()
    await settingsBtn.click()
    await expect(page.locator('text=Auto-run Claude')).toBeVisible()
    await expect(page.locator('text=Resume session')).toBeVisible()
  })
})

test.describe('Theme Toggle', () => {
  test('can toggle theme', async () => {
    // Find theme toggle button (sun/moon icon in top left area)
    const themeBtn = page.locator('button[title*="Switch to"]')
    await expect(themeBtn).toBeVisible()

    // Get initial theme
    const initialTheme = await page.getAttribute('html', 'data-theme')

    // Click toggle
    await themeBtn.click()
    await page.waitForTimeout(200)

    // Theme should change
    const newTheme = await page.getAttribute('html', 'data-theme')
    expect(newTheme).not.toBe(initialTheme)

    // Toggle back
    await themeBtn.click()
  })
})

test.describe('Project Creation', () => {
  test('Add Project opens modal', async () => {
    await page.locator('text=Add Project').click()
    await page.waitForTimeout(300)

    // Modal should appear with Project Name input
    await expect(page.locator('text=New Project')).toBeVisible()
    await expect(page.locator('text=Project Name')).toBeVisible()
  })

  test('can type project name', async () => {
    const nameInput = page.locator('input[placeholder="My Project"]')
    await nameInput.fill('Test Project')
    expect(await nameInput.inputValue()).toBe('Test Project')
  })

  test('create button disabled without folder', async () => {
    const createBtn = page.locator('button:has-text("Create Project")')
    await expect(createBtn).toBeDisabled()
  })

  test('can close modal', async () => {
    // Close via X button
    const closeBtn = page.locator('.fixed button').first()
    await closeBtn.click()
    await page.waitForTimeout(300)

    // Modal should be gone
    await expect(page.locator('text=New Project')).not.toBeVisible()
  })
})

test.describe('Empty State', () => {
  test('shows select project message when no project', async () => {
    await expect(page.getByText('Select a project first')).toBeVisible()
  })
})
