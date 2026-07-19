import { describe, it, expect } from 'vitest'
import {
  rdevMajor,
  classifyWatermark,
  countOpenPtmxFds,
  buildHealthReport,
  formatHealthReport,
  PtmxDeps
} from '../ptyHealth'

// macOS: makedev(major, minor) === (major << 24) | minor
const mk = (major: number, minor: number) => (major << 24) | minor
const PTMX = mk(15, 511)

describe('rdevMajor', () => {
  it('extracts the major from a macOS rdev', () => {
    expect(rdevMajor(PTMX)).toBe(15)
    expect(rdevMajor(mk(15, 0))).toBe(15)
    // The observed leak included minor 413 — minors exceed 255, so a naive
    // 8-bit split would misclassify them.
    expect(rdevMajor(mk(15, 413))).toBe(15)
    expect(rdevMajor(mk(2, 2))).toBe(2)
  })

  it('handles the real /dev/ptmx rdev value', () => {
    expect(rdevMajor(251658751)).toBe(15)
  })
})

describe('classifyWatermark', () => {
  it('is ok below half', () => {
    expect(classifyWatermark(0, 511)).toBe('ok')
    expect(classifyWatermark(255, 511)).toBe('ok')
  })

  it('warns from half up', () => {
    expect(classifyWatermark(256, 511)).toBe('warn')
    expect(classifyWatermark(400, 511)).toBe('warn')
  })

  it('goes critical at 80%', () => {
    expect(classifyWatermark(409, 511)).toBe('critical')
    // The state that actually broke the app.
    expect(classifyWatermark(511, 511)).toBe('critical')
  })

  it('never divides by a zero ceiling', () => {
    expect(classifyWatermark(10, 0)).toBe('ok')
    expect(classifyWatermark(10, -1)).toBe('ok')
  })
})

describe('countOpenPtmxFds', () => {
  const deps = (over: Partial<PtmxDeps> = {}): PtmxDeps => ({
    ptmxRdev: () => PTMX,
    listFds: () => ['0', '1', '2', '7', '9'],
    fstatRdev: (fd) => (fd === 7 || fd === 9 ? mk(15, fd) : mk(2, fd)),
    ...over
  })

  it('counts only fds sharing the ptmx major', () => {
    expect(countOpenPtmxFds(deps())).toBe(2)
  })

  it('skips fds that raced closed', () => {
    expect(countOpenPtmxFds(deps({ fstatRdev: () => null }))).toBe(0)
  })

  it('ignores non-numeric /dev/fd entries', () => {
    expect(countOpenPtmxFds(deps({ listFds: () => ['.', '..', 'x', '7'] }))).toBe(1)
  })

  it('returns null — not 0 — when the platform cannot be probed', () => {
    expect(countOpenPtmxFds(deps({ ptmxRdev: () => { throw new Error('ENOENT') } }))).toBeNull()
    expect(countOpenPtmxFds(deps({ listFds: () => { throw new Error('ENOENT') } }))).toBeNull()
  })
})

describe('buildHealthReport', () => {
  const handles = [
    { label: 'usage-scrape', spawnedAt: 1_000 },
    { label: 'terminal', spawnedAt: 500 },
    { label: 'chat-rc', spawnedAt: 2_000 }
  ]

  it('surfaces oldest handles first for attribution', () => {
    const r = buildHealthReport(300, 511, handles, 5_000)
    expect(r.suspects.map(s => s.label)).toEqual(['terminal', 'usage-scrape', 'chat-rc'])
    expect(r.suspects[0].ageMs).toBe(4_500)
  })

  it('caps the suspect list at 10', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ label: `t${i}`, spawnedAt: i }))
    expect(buildHealthReport(50, 511, many, 100).suspects).toHaveLength(10)
  })

  it('reports registered count alongside open fds', () => {
    const r = buildHealthReport(511, 511, handles, 5_000)
    expect(r.open).toBe(511)
    expect(r.registered).toBe(3)
    expect(r.level).toBe('critical')
  })
})

describe('formatHealthReport', () => {
  it('stays terse when healthy', () => {
    const line = formatHealthReport(buildHealthReport(10, 511, [], 0))
    expect(line).toBe('[pty-health] 10/511 ptmx fds (2%) · 0 registered')
    expect(line).not.toContain('level=')
  })

  it('names the leak size and oldest suspects when unhealthy', () => {
    const r = buildHealthReport(511, 511, [{ label: 'usage-scrape', spawnedAt: 0 }], 60_000)
    const line = formatHealthReport(r)
    expect(line).toContain('level=critical')
    expect(line).toContain('~510 fd(s) with no live handle')
    expect(line).toContain('usage-scrape@60s')
  })

  it('does not crash with no suspects', () => {
    expect(formatHealthReport(buildHealthReport(300, 511, [], 0))).toContain('oldest: none')
  })
})
