import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('window title', () => {
  it('is just "Hive" — no hard-coded version (the Dock window list shows it)', () => {
    const html = readFileSync(join(__dirname, '..', '..', 'index.html'), 'utf-8')
    expect(html).toContain('<title>Hive</title>')
  })
})
