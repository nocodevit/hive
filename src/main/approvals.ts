// Butler's approval queue: anything that leaves Hive on the owner's behalf
// (an email, a Feishu message, a Jira change) waits here until the owner
// presses the button. Features add items and register an executor for
// their kind; the UI lists items and resolves them.
//
// Stored in <butler dir>/approvals.json so a restart keeps the queue.
// Item ids are exact (no matching by content).

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'failed'

export interface Approval {
  id: string
  /** Feature namespace, e.g. 'email.reply', 'feishu.reply', 'jira.transition'. */
  kind: string
  /** One line, who/what: "Lin · UAT down?" */
  title: string
  /** Short label under the title: "email reply · from mei@x.com". */
  subtitle: string
  /** The draft the owner reviews and may edit before approving. */
  draft: string
  /** Feature-specific data the executor needs (ids, recipients). */
  payload: Record<string, unknown>
  /** Main button label: Send / Apply / Reply. */
  action: string
  status: ApprovalStatus
  createdAt: number
  resolvedAt?: number
  error?: string
}

export type Executor = (item: Approval) => Promise<{ ok: boolean; error?: string }>

export interface ApprovalsDeps {
  dir: string
  now?: () => number
  onChange?: (pending: Approval[]) => void
}

/** Keep resolved items this long (for the "Today" log), then drop them. */
export const RESOLVED_KEEP_MS = 7 * 24 * 3600_000

export function createApprovals(deps: ApprovalsDeps) {
  const now = deps.now ?? Date.now
  const file = join(deps.dir, 'approvals.json')
  const executors = new Map<string, Executor>()
  let items: Approval[] = load()
  const running = new Set<string>()

  function load(): Approval[] {
    try {
      const j = JSON.parse(readFileSync(file, 'utf8'))
      return Array.isArray(j) ? j.filter(x => x && typeof x.id === 'string' && typeof x.kind === 'string') : []
    } catch { return [] }
  }

  function save() {
    const cutoff = now() - RESOLVED_KEEP_MS
    items = items.filter(i => i.status === 'pending' || (i.resolvedAt ?? i.createdAt) > cutoff)
    if (!existsSync(deps.dir)) mkdirSync(deps.dir, { recursive: true })
    const tmp = file + '.tmp'
    writeFileSync(tmp, JSON.stringify(items, null, 2))
    renameSync(tmp, file)
    deps.onChange?.(pending())
  }

  const pending = () => items.filter(i => i.status === 'pending').sort((a, b) => a.createdAt - b.createdAt)

  return {
    /** A feature declares how its kind is carried out once approved. */
    register(kind: string, exec: Executor) { executors.set(kind, exec) },

    add(input: Pick<Approval, 'kind' | 'title' | 'subtitle' | 'draft' | 'payload' | 'action'>): Approval {
      const item: Approval = { ...input, id: randomUUID(), status: 'pending', createdAt: now() }
      items.push(item)
      save()
      return item
    },

    pending,
    /** Resolved in the last week (approved, rejected, failed), newest first. */
    history: () => items.filter(i => i.status !== 'pending').sort((a, b) => (b.resolvedAt ?? b.createdAt) - (a.resolvedAt ?? a.createdAt)),
    all: () => [...items],
    get: (id: string) => items.find(i => i.id === id),

    /** Approve (optionally with an edited draft) → run the executor. */
    async approve(id: string, editedDraft?: string): Promise<{ ok: boolean; error?: string }> {
      const item = items.find(i => i.id === id)
      if (!item || item.status !== 'pending') return { ok: false, error: 'not_pending' }
      if (running.has(id)) return { ok: false, error: 'in_progress' }
      const exec = executors.get(item.kind)
      if (!exec) return { ok: false, error: 'no_executor' }
      if (typeof editedDraft === 'string') item.draft = editedDraft
      running.add(id)
      try {
        const r = await exec(item).catch(e => ({ ok: false, error: e instanceof Error ? e.message : String(e) }))
        item.status = r.ok ? 'approved' : 'failed'
        item.resolvedAt = now()
        if (!r.ok) item.error = r.error || 'failed'
        save()
        return r
      } finally {
        running.delete(id)
      }
    },

    reject(id: string): boolean {
      const item = items.find(i => i.id === id)
      if (!item || item.status !== 'pending') return false
      item.status = 'rejected'
      item.resolvedAt = now()
      save()
      return true
    },

    /** Rewrite a pending item in place (migrations, a re-draft). */
    update(id: string, patch: Partial<Pick<Approval, 'kind' | 'title' | 'subtitle' | 'draft' | 'payload' | 'action'>>): boolean {
      const item = items.find(i => i.id === id)
      if (!item || item.status !== 'pending') return false
      Object.assign(item, patch)
      save()
      return true
    },

    /** A pending item answered another way (its follow-up was queued): done, nothing executed. */
    supersede(id: string): boolean {
      const item = items.find(i => i.id === id)
      if (!item || item.status !== 'pending') return false
      item.status = 'approved'
      item.resolvedAt = now()
      save()
      return true
    },

    /** A failed item can go back to pending for another try. */
    retry(id: string): boolean {
      const item = items.find(i => i.id === id)
      if (!item || item.status !== 'failed') return false
      item.status = 'pending'
      delete item.error
      delete item.resolvedAt
      save()
      return true
    }
  }
}

export type Approvals = ReturnType<typeof createApprovals>
