import { describe, expect, it } from 'vitest'
import { summarizeFiles, type FileMeta } from '../storage'

const NOW = 1745000000000  // arbitrary "now"
const day = 24 * 3600 * 1000
const cutoff15d = NOW - 15 * day

const f = (mtimeOffsetDays: number, bytes: number, isSubagent = false, name = `file${Math.random()}.jsonl`): FileMeta => ({
  path: `/tmp/${name}`,
  bytes,
  mtimeMs: NOW - mtimeOffsetDays * day,
  isSubagent
})

describe('summarizeFiles', () => {
  it('returns zeroed stats for empty input', () => {
    const s = summarizeFiles([], cutoff15d)
    expect(s.totalFiles).toBe(0)
    expect(s.totalBytes).toBe(0)
    expect(s.staleFiles).toBe(0)
    expect(s.topStale).toEqual([])
  })

  it('counts all files into totals', () => {
    const s = summarizeFiles([
      f(1, 1000),
      f(20, 2000),
      f(40, 3000)
    ], cutoff15d)
    expect(s.totalFiles).toBe(3)
    expect(s.totalBytes).toBe(6000)
  })

  it('separates main vs subagent in totals', () => {
    const s = summarizeFiles([
      f(1, 1000, false),
      f(2, 2000, true),
      f(3, 4000, true)
    ], cutoff15d)
    expect(s.mainFiles).toBe(1)
    expect(s.mainBytes).toBe(1000)
    expect(s.subagentFiles).toBe(2)
    expect(s.subagentBytes).toBe(6000)
  })

  it('classifies stale by mtime < cutoff', () => {
    const s = summarizeFiles([
      f(5, 100),    // fresh
      f(15, 200),   // borderline (== cutoff, not stale per <)
      f(16, 300),   // stale
      f(30, 400)    // stale
    ], cutoff15d)
    // mtime exactly at cutoff is not stale (strict <)
    expect(s.staleFiles).toBe(2)
    expect(s.staleBytes).toBe(700)
  })

  it('boundary: mtimeMs === cutoffMs is NOT stale', () => {
    const s = summarizeFiles([{ path: '/x', bytes: 1, mtimeMs: cutoff15d, isSubagent: false }], cutoff15d)
    expect(s.staleFiles).toBe(0)
  })

  it('boundary: mtimeMs one ms below cutoff IS stale', () => {
    const s = summarizeFiles([{ path: '/x', bytes: 1, mtimeMs: cutoff15d - 1, isSubagent: false }], cutoff15d)
    expect(s.staleFiles).toBe(1)
  })

  it('separates stale main vs stale subagent', () => {
    const s = summarizeFiles([
      f(20, 1000, false),
      f(30, 2000, false),
      f(40, 4000, true),
      f(5,  9999, true)   // fresh subagent — should not count
    ], cutoff15d)
    expect(s.staleMainFiles).toBe(2)
    expect(s.staleMainBytes).toBe(3000)
    expect(s.staleSubagentFiles).toBe(1)
    expect(s.staleSubagentBytes).toBe(4000)
  })

  it('topStale lists at most 20 entries, sorted by bytes desc', () => {
    const files = Array.from({ length: 25 }, (_, i) => f(20 + i, 1000 + i))
    const s = summarizeFiles(files, cutoff15d)
    expect(s.staleFiles).toBe(25)
    expect(s.topStale.length).toBe(20)
    // First entry is the largest (1024)
    expect(s.topStale[0].bytes).toBe(1024)
    // Strictly descending
    for (let i = 1; i < s.topStale.length; i++) {
      expect(s.topStale[i].bytes).toBeLessThanOrEqual(s.topStale[i - 1].bytes)
    }
  })

  it('topStale only contains stale files', () => {
    const s = summarizeFiles([
      f(5, 99999),   // fresh — must NOT appear in topStale even though largest
      f(20, 100),
      f(30, 200)
    ], cutoff15d)
    expect(s.topStale.map(t => t.bytes)).toEqual([200, 100])
  })

  it('handles a realistic mixed batch', () => {
    const files: FileMeta[] = [
      f(1, 5_000_000, false),   // active main session, fresh
      f(2, 200_000, true),      // recent subagent
      f(2, 150_000, true),
      f(20, 80_000_000, false), // big stale main
      f(45, 1_500_000, false),
      f(45, 50_000, true),
      f(60, 100_000, true)
    ]
    const s = summarizeFiles(files, cutoff15d)
    expect(s.totalFiles).toBe(7)
    expect(s.mainFiles).toBe(3)
    expect(s.subagentFiles).toBe(4)
    expect(s.staleFiles).toBe(4)
    expect(s.staleMainFiles).toBe(2)
    expect(s.staleMainBytes).toBe(81_500_000)
    expect(s.staleSubagentFiles).toBe(2)
    expect(s.staleSubagentBytes).toBe(150_000)
    // largest stale should be first
    expect(s.topStale[0].bytes).toBe(80_000_000)
  })
})
