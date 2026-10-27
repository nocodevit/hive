import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createApprovals } from '../approvals'
import { cardRoute } from '../butlerCards'

const setup = () => {
  let t = 1_000
  const s = createApprovals({ dir: mkdtempSync(join(tmpdir(), 'hive-cards-')), now: () => (t += 1000) })
  const reply = s.add({ kind: 'feishu.followup', title: 'Daniel · CDR split', subtitle: 'Feishu', draft: 'Thanks Daniel', payload: { question: 'Split CDRs by country?' }, action: 'Reply' })
  const decide = s.add({ kind: 'email.decide', title: 'Ana · Price list', subtitle: 'needs you', draft: '', payload: { question: 'Which prices can I share?', about: 'Ana wants prices' }, action: 'Discuss' })
  return { s, reply, decide, get: (path: string, q = '') => cardRoute(s, 'GET', path, new URLSearchParams(q), null), post: (path: string, body: Record<string, unknown>) => cardRoute(s, 'POST', path, new URLSearchParams(), body) }
}

describe('./hive cards', () => {
  it('lists pending cards with what Butler needs to talk about them', () => {
    const { get, decide } = setup()
    const r = get('/cards')
    expect(r.status).toBe(200)
    const cards = r.body.cards as any[]
    expect(cards.map(c => c.title)).toEqual(['Daniel · CDR split', 'Ana · Price list'])
    expect(cards.find(c => c.id === decide.id)).toMatchObject({ question: 'Which prices can I share?', about: 'Ana wants prices', their: 'Which prices can I share?' })
  })

  it('edit rewrites the draft and marks it as Butler\'s; it never sends', () => {
    const { s, post, reply } = setup()
    expect(post('/cards/edit', { id: reply.id.slice(0, 8), draft: '收到，周一起按国家拆分。' }).status).toBe(200)
    const got = s.get(reply.id)!
    expect(got).toMatchObject({ draft: '收到，周一起按国家拆分。', status: 'pending', edited: { by: 'butler' } })
    expect(post('/cards/edit', { id: reply.id, draft: '   ' }).body.error).toBe('empty_draft')
  })

  it('a needs-you card has no draft to edit', () => {
    const { post, decide } = setup()
    expect(post('/cards/edit', { id: decide.id, draft: 'x' })).toMatchObject({ status: 409, body: { error: 'needs_owner_answer' } })
  })

  it('close needs a reason, keeps the card in History, and reopen brings it back', () => {
    const { s, post, get, reply } = setup()
    expect(post('/cards/close', { id: reply.id }).body.error).toBe('why_required')
    expect(post('/cards/close', { id: reply.id, why: '已在群里答复' }).status).toBe(200)
    expect(s.get(reply.id)).toMatchObject({ status: 'rejected', closed: { by: 'butler', why: '已在群里答复' } })
    expect((get('/cards').body.cards as any[]).map(c => c.id)).not.toContain(reply.id)
    expect((get('/cards', 'all=1').body.cards as any[]).find(c => c.id === reply.id)).toMatchObject({ status: 'rejected', closed: { why: '已在群里答复' } })
    expect(post('/cards/edit', { id: reply.id, draft: 'x' }).body.error).toBe('not_pending')
    expect(post('/cards/reopen', { id: reply.id }).status).toBe(200)
    expect(s.get(reply.id)!.status).toBe('pending')
    expect(s.get(reply.id)!.closed).toBeUndefined()
    expect(post('/cards/reopen', { id: reply.id }).body.error).toBe('not_closed')
  })

  it('ids are exact or a unique prefix of 4+ characters', () => {
    const { get, reply } = setup()
    expect(get('/cards/show', `id=${reply.id.slice(0, 3)}`).status).toBe(404)
    expect((get('/cards/show', `id=${reply.id.slice(0, 6)}`).body.card as any).id).toBe(reply.id)
  })
})
