import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { headLines, linesBefore, tailLines } from '../fileSlices'

const file = (lines: string[]) => { const p = join(mkdtempSync(join(tmpdir(), 'hive-slices-')), 'x.jsonl'); writeFileSync(p, lines.join('\n') + '\n'); return p }

describe('file slices', () => {
  it('head / tail drop a cut line at the edge, keep everything when the file fits', () => {
    const p = file(['{"a":1}', '{"b":2222222}', '{"c":3}'])
    expect(headLines(p, 10)).toEqual(['{"a":1}'])
    expect(tailLines(p, 10)).toEqual(['{"c":3}'])
    expect(tailLines(p, 9999)).toEqual(['{"a":1}', '{"b":2222222}', '{"c":3}'])
    expect(tailLines('/no/such', 10)).toEqual([])
  })
  it('linesBefore pages back exactly: newest lines first, then the ones before, down to the start', () => {
    const all = Array.from({ length: 2000 }, (_, i) => JSON.stringify({ i, pad: 'x'.repeat(300 + (i % 7)) }))
    const p = file(all)
    const first = linesBefore(p, statSync(p).size, 100)
    expect(first.lines.map(l => JSON.parse(l).i)).toEqual(Array.from({ length: 100 }, (_, k) => 1900 + k))
    const older = linesBefore(p, first.start, 1000)
    expect(older.lines.map(l => JSON.parse(l).i)).toEqual(Array.from({ length: 1000 }, (_, k) => 900 + k))
    const rest = linesBefore(p, older.start, 5000)
    expect(rest.lines).toHaveLength(900)
    expect(rest.start).toBe(0)
  })
})
