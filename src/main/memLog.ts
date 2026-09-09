// Memory self-observation. Hive kept NO record of its own memory, so every
// "why is memory high / is it leaking?" turned into ad-hoc `ps` sampling after
// the fact. This writes a periodic snapshot to ~/.hive/mem-log.jsonl —
// main-process heap + every Electron child (renderer, GPU, utility) working set
// and CPU — so a leak shows up as a monotonic climb on a real timeline instead
// of guesswork.
//
// Only buildMemSample is unit-tested (pure). The interval + file append in
// index.ts is trivial glue over it.

/** One Electron process metric, the shape app.getAppMetrics() yields (subset). */
export interface AppMetricLike {
  pid?: number
  type?: string
  memory?: { workingSetSize?: number } // kilobytes (Electron units)
  cpu?: { percentCPUUsage?: number }
}

export interface MemSample {
  t: number
  /** Main process V8/native figures (from process.memoryUsage), MB. */
  mainRssMB: number
  heapUsedMB: number
  heapTotalMB: number
  externalMB: number
  /** Per Electron child process, newest working-set + cpu. */
  processes: Array<{ type: string; pid: number; memMB: number; cpu: number }>
  /** Sum of all Electron process working sets, MB — the headline number. */
  totalMB: number
}

const bytesToMB = (b: number): number => Math.round((b || 0) / 1024 / 1024)
const kbToMB = (kb: number): number => Math.round((kb || 0) / 1024)
const round1 = (n: number): number => Math.round((n || 0) * 10) / 10

/**
 * Build one memory snapshot from process.memoryUsage() + app.getAppMetrics().
 * Pure so a leak-detection test can assert the shape/units without a live app.
 * `metrics` may be undefined/empty (e2e/headless) — handled as no child rows.
 */
export function buildMemSample(
  nowMs: number,
  mem: NodeJS.MemoryUsage,
  metrics: readonly AppMetricLike[] | undefined | null
): MemSample {
  const processes = (metrics || []).map((m) => ({
    type: m.type || 'unknown',
    pid: m.pid || 0,
    memMB: kbToMB(m.memory?.workingSetSize ?? 0),
    cpu: round1(m.cpu?.percentCPUUsage ?? 0)
  }))
  return {
    t: nowMs,
    mainRssMB: bytesToMB(mem.rss),
    heapUsedMB: bytesToMB(mem.heapUsed),
    heapTotalMB: bytesToMB(mem.heapTotal),
    externalMB: bytesToMB(mem.external),
    processes,
    totalMB: processes.reduce((s, p) => s + p.memMB, 0)
  }
}

/** Log file basename under DATA_DIR (~/.hive). */
export const MEM_LOG_FILENAME = 'mem-log.jsonl'

/** How often to sample. One line/min ≈ 1.4k lines/day — cheap and legible. */
export const MEM_LOG_INTERVAL_MS = 60_000
