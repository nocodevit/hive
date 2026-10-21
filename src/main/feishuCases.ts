// answer-for-me's memory, layer 1: one case per message handled — what came
// in, what Butler decided, what went out, and what the owner did with it
// (approved / edited / rejected / recalled / answered it themselves). The
// owner's edits and own replies are the gold answers later layers learn from
// and the skill is re-tested against.
//
// <butler>/feishu-memory/cases.jsonl, append-only: an update is a new line for
// the same id; the last line per id wins. Kept 90 days, local only.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Claim, Relation } from './feishuAnswer'

export type Outcome = 'auto' | 'approved' | 'edited' | 'rejected' | 'recalled' | 'owner_replied' | 'pending'

export interface FeishuCase {
  id: string
  at: number
  chatId: string
  chatName: string
  p2p: boolean
  senderId: string
  relation: Relation
  question: string
  category: string
  confidence: string
  claims: Claim[]
  sources: string[]
  /** The model's reply. */
  draft: string
  level: 'auto' | 'approve' | 'hold'
  reasons: string[]
  /** What went to the chat first (the answer, or the holding line). */
  sent: string
  approvalId?: string
  outcome: Outcome
  /** What the owner finally said, when it differs from the draft or they replied themselves. */
  final?: string
  resolvedAt?: number
}

export const CASE_KEEP_MS = 90 * 24 * 3600_000

export function createCaseLog(dir: string, now: () => number = Date.now) {
  const folder = join(dir, 'feishu-memory')
  const file = join(folder, 'cases.jsonl')

  function all(): FeishuCase[] {
    let text = ''
    try { text = readFileSync(file, 'utf8') } catch { return [] }
    const byId = new Map<string, FeishuCase>()
    for (const line of text.split('\n')) {
      if (!line) continue
      try { const c = JSON.parse(line) as FeishuCase; if (c && typeof c.id === 'string') byId.set(c.id, c) } catch { /* torn line */ }
    }
    return [...byId.values()].sort((a, b) => a.at - b.at)
  }

  const write = (c: FeishuCase) => {
    if (!existsSync(folder)) mkdirSync(folder, { recursive: true })
    appendFileSync(file, JSON.stringify(c) + '\n')
  }

  return {
    all,
    get: (id: string) => all().find(c => c.id === id),
    add(c: FeishuCase) { write(c) },
    /** Record what the owner did; only a case still open (pending / auto) changes. */
    resolve(id: string, outcome: Exclude<Outcome, 'pending'>, final?: string): boolean {
      const c = all().find(x => x.id === id)
      if (!c) return false
      write({ ...c, outcome, ...(final !== undefined ? { final } : {}), resolvedAt: now() })
      return true
    },
    byApproval: (approvalId: string) => all().find(c => c.approvalId === approvalId),
    /** Rewrite the file with the last line per id, dropping cases older than 90 days. */
    compact() {
      if (!existsSync(file)) return
      const keep = all().filter(c => now() - c.at < CASE_KEEP_MS)
      writeFileSync(file, keep.map(c => JSON.stringify(c)).join('\n') + (keep.length ? '\n' : ''))
    }
  }
}

export type CaseLog = ReturnType<typeof createCaseLog>
