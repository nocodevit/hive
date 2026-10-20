import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

const E2E_DIR = join(__dirname, '..', '..', '..', 'e2e')

function launchCalls(src: string): string[] {
  const calls: string[] = []
  const re = /electron\.launch\s*\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    let depth = 1
    let i = m.index + m[0].length
    while (i < src.length && depth > 0) {
      if (src[i] === '(') depth++
      else if (src[i] === ')') depth--
      i++
    }
    calls.push(src.slice(m.index, i))
  }
  return calls
}

describe('e2e specs isolate HIVE_DATA_DIR', () => {
  const files = readdirSync(E2E_DIR).filter(f => f.endsWith('.ts'))

  it('finds e2e specs', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files)('%s passes HIVE_DATA_DIR to every electron.launch', file => {
    const src = readFileSync(join(E2E_DIR, file), 'utf8')
    for (const call of launchCalls(src)) {
      expect(call, `${file}: electron.launch without HIVE_DATA_DIR would use the real ~/.hive`).toMatch(/\bHIVE_DATA_DIR\b/)
    }
  })
})
