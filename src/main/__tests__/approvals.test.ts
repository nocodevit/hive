import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createApprovals, RESOLVED_KEEP_MS, type Approval } from '../approvals'

const input = (over: Partial<Approval> = {}) => ({
  kind: 'email.reply', title: 'Lin · UAT down?', subtitle: 'email reply', draft: 'Hi Lin', payload: { to: 'lin@x.com' }, action: 'Send', ...over
})

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'hive-approvals-'))
  let clock = 1_000_000
  const changes: number[] = []
  const q = createApprovals({ dir, now: () => clock, onChange: p => changes.push(p.length) })
  return { dir, q, changes, advance: (ms: number) => { clock += ms } }
}

describe('approvals', () => {
  it('adds pending items, oldest first, and persists them', () => {
    const t = setup()
    const a = t.q.add(input({ title: 'A' }))
    t.advance(1)
    t.q.add(input({ title: 'B' }))
    expect(t.q.pending().map(i => i.title)).toEqual(['A', 'B'])
    expect(a.status).toBe('pending')
    expect(JSON.parse(readFileSync(join(t.dir, 'approvals.json'), 'utf8'))).toHaveLength(2)
    expect(t.changes).toEqual([1, 2])
    expect(createApprovals({ dir: t.dir }).pending()).toHaveLength(2)
  })

  it('approve runs the executor for that kind with the edited draft', async () => {
    const t = setup()
    const seen: string[] = []
    t.q.register('email.reply', async item => { seen.push(item.draft); return { ok: true } })
    const a = t.q.add(input())
    expect(await t.q.approve(a.id, 'Hi Lin, fixed.')).toEqual({ ok: true })
    expect(seen).toEqual(['Hi Lin, fixed.'])
    expect(t.q.get(a.id)?.status).toBe('approved')
    expect(t.q.pending()).toHaveLength(0)
  })

  it('a failing executor marks it failed with the error; retry puts it back', async () => {
    const t = setup()
    t.q.register('email.reply', async () => ({ ok: false, error: 'smtp 535' }))
    const a = t.q.add(input())
    expect(await t.q.approve(a.id)).toEqual({ ok: false, error: 'smtp 535' })
    expect(t.q.get(a.id)).toMatchObject({ status: 'failed', error: 'smtp 535' })
    expect(t.q.retry(a.id)).toBe(true)
    expect(t.q.get(a.id)?.status).toBe('pending')
  })

  it('a throwing executor is a failure, not a crash', async () => {
    const t = setup()
    t.q.register('email.reply', async () => { throw new Error('boom') })
    const a = t.q.add(input())
    expect(await t.q.approve(a.id)).toEqual({ ok: false, error: 'boom' })
  })

  it('no executor for the kind → refused, still pending', async () => {
    const t = setup()
    const a = t.q.add(input({ kind: 'jira.transition' }))
    expect(await t.q.approve(a.id)).toEqual({ ok: false, error: 'no_executor' })
    expect(t.q.get(a.id)?.status).toBe('pending')
  })

  it('cannot approve twice at once, or after rejecting', async () => {
    const t = setup()
    let release!: () => void
    t.q.register('email.reply', () => new Promise(r => { release = () => r({ ok: true }) }))
    const a = t.q.add(input())
    const first = t.q.approve(a.id)
    expect(await t.q.approve(a.id)).toEqual({ ok: false, error: 'in_progress' })
    release()
    await first
    const b = t.q.add(input())
    expect(t.q.reject(b.id)).toBe(true)
    expect(await t.q.approve(b.id)).toEqual({ ok: false, error: 'not_pending' })
  })

  it('drops resolved items after a week, keeps pending ones', () => {
    const t = setup()
    const a = t.q.add(input({ title: 'old' }))
    t.q.reject(a.id)
    t.q.add(input({ title: 'waiting' }))
    t.advance(RESOLVED_KEEP_MS + 1)
    t.q.add(input({ title: 'new' }))
    expect(t.q.all().map(i => i.title)).toEqual(['waiting', 'new'])
  })
})
