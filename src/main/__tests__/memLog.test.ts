import { describe, it, expect } from 'vitest'
import { buildMemSample, MEM_LOG_FILENAME, MEM_LOG_INTERVAL_MS } from '../memLog'

const mem = (over: Partial<NodeJS.MemoryUsage> = {}): NodeJS.MemoryUsage => ({
  rss: 700 * 1024 * 1024,
  heapUsed: 120 * 1024 * 1024,
  heapTotal: 180 * 1024 * 1024,
  external: 30 * 1024 * 1024,
  arrayBuffers: 0,
  ...over
})

describe('buildMemSample', () => {
  it('converts main-process bytes to MB', () => {
    const s = buildMemSample(1000, mem(), [])
    expect(s.t).toBe(1000)
    expect(s.mainRssMB).toBe(700)
    expect(s.heapUsedMB).toBe(120)
    expect(s.heapTotalMB).toBe(180)
    expect(s.externalMB).toBe(30)
  })

  it('maps Electron child metrics (workingSetSize is KB) and sums totalMB', () => {
    const s = buildMemSample(1, mem(), [
      { pid: 2, type: 'GPU', memory: { workingSetSize: 200 * 1024 }, cpu: { percentCPUUsage: 3.14 } },
      { pid: 3, type: 'Tab', memory: { workingSetSize: 728 * 1024 }, cpu: { percentCPUUsage: 25 } }
    ])
    expect(s.processes).toEqual([
      { type: 'GPU', pid: 2, memMB: 200, cpu: 3.1 },
      { type: 'Tab', pid: 3, memMB: 728, cpu: 25 }
    ])
    expect(s.totalMB).toBe(928)
  })

  it('is null/undefined-safe for metrics and missing fields (headless/e2e)', () => {
    expect(buildMemSample(1, mem(), undefined).processes).toEqual([])
    expect(buildMemSample(1, mem(), null).totalMB).toBe(0)
    const s = buildMemSample(1, mem(), [{}])
    expect(s.processes).toEqual([{ type: 'unknown', pid: 0, memMB: 0, cpu: 0 }])
  })

  it('rounds cpu to 1 decimal and memory to whole MB', () => {
    const s = buildMemSample(1, mem(), [{ pid: 9, type: 'Utility', memory: { workingSetSize: 1536 }, cpu: { percentCPUUsage: 0.049 } }])
    expect(s.processes[0].memMB).toBe(2) // 1536 KB → 1.5 → rounds to 2
    expect(s.processes[0].cpu).toBe(0) // 0.049 → 0.0
  })
})

describe('mem-log constants', () => {
  it('writes to ~/.hive/mem-log.jsonl at a sane interval', () => {
    expect(MEM_LOG_FILENAME).toBe('mem-log.jsonl')
    expect(MEM_LOG_INTERVAL_MS).toBeGreaterThanOrEqual(30_000)
    expect(MEM_LOG_INTERVAL_MS).toBeLessThanOrEqual(300_000)
  })
})
