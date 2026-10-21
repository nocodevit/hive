import { describe, it, expect } from 'vitest'
import { assistantHolding, createRelationLookup, freeBusyText, gateAnswer, parseAnswer, relationOf, workingDays, type Answer } from '../feishuAnswer'

const ans = (o: Partial<Answer> = {}): Answer => ({ category: 'product-status', level: 'auto', confidence: 'high', reply: 'ok', sources: [], claims: [], ...o })

describe('parseAnswer', () => {
  it('reads the JSON, defaults the unknown to the safe side', () => {
    expect(parseAnswer('x {"category":"meeting","level":"auto","confidence":"high","reply":" hi ","sources":["FAE-1"],"claims":[{"claim":"c","verdict":"confirmed","source":"FAE-1"}]} y'))
      .toEqual({ category: 'meeting', level: 'auto', confidence: 'high', reply: 'hi', sources: ['FAE-1'], claims: [{ claim: 'c', verdict: 'confirmed', source: 'FAE-1' }] })
    expect(parseAnswer('{"category":"x","level":"y","confidence":"z","reply":"r","claims":[{"claim":"c","verdict":"maybe"}]}'))
      .toMatchObject({ category: 'cannot-answer', level: 'hold', confidence: 'low', claims: [{ verdict: 'unverified' }] })
    expect(parseAnswer('not json')).toBeNull()
    expect(parseAnswer('{bad')).toBeNull()
  })
})

describe('gateAnswer', () => {
  it('a clear, sourced answer goes out', () => {
    expect(gateAnswer({ answer: ans({ reply: 'FAE-1076 已上线', sources: ['FAE-1076'] }), relation: 'requester' })).toEqual({ level: 'auto', reasons: [], notify: false })
  })
  it('never sends: PR content, an unchecked key, unreadable answers, cannot-answer, low confidence, the manager', () => {
    expect(gateAnswer({ answer: ans({ reply: 'PR-8885 在做' }), relation: 'peer' }).level).toBe('hold')
    expect(gateAnswer({ answer: ans({ reply: 'P4-7 下周上线', sources: ['FAE-1'] }), relation: 'peer' })).toMatchObject({ level: 'hold', reasons: ['names P4-7 without looking it up'] })
    expect(gateAnswer({ answer: null, relation: 'peer' }).level).toBe('hold')
    expect(gateAnswer({ answer: ans({ category: 'cannot-answer' }), relation: 'peer' }).level).toBe('hold')
    expect(gateAnswer({ answer: ans({ confidence: 'low' }), relation: 'peer' }).level).toBe('hold')
    expect(gateAnswer({ answer: ans(), relation: 'boss' })).toMatchObject({ level: 'hold', reasons: ['from your manager'] })
  })
  it('claims: a correction or an unsourced "confirmed" needs approval; unverified is sent but the owner hears', () => {
    expect(gateAnswer({ answer: ans({ claims: [{ claim: 'Sphere2 supports X', verdict: 'contradicted', source: 'P4-1' }] }), relation: 'peer' }).level).toBe('approve')
    expect(gateAnswer({ answer: ans({ claims: [{ claim: 'x', verdict: 'confirmed', source: '' }] }), relation: 'peer' }).level).toBe('approve')
    expect(gateAnswer({ answer: ans({ claims: [{ claim: 'x', verdict: 'unverified', source: '' }] }), relation: 'peer' })).toMatchObject({ level: 'auto', notify: true })
  })
  it('only ever lowers the model\'s level; medium confidence → approval', () => {
    expect(gateAnswer({ answer: ans({ level: 'hold' }), relation: 'peer' }).level).toBe('hold')
    expect(gateAnswer({ answer: ans({ confidence: 'medium' }), relation: 'peer' }).level).toBe('approve')
    expect(gateAnswer({ answer: ans({ category: 'new-request' }), relation: 'peer' })).toMatchObject({ level: 'auto', notify: true })
  })
  it('the assistant holding line', () => {
    expect(assistantHolding('Megan')).toBe('我是 Megan 的助理，可能不太了解上下文，判断和回答不一定准确，我会转给 Megan 处理。')
  })
})

describe('relation', () => {
  const owner = { openId: 'ou_me', leader: 'ou_boss', departments: ['d1'] }
  it('manager / report / same department / requester', () => {
    expect(relationOf(owner, { openId: 'ou_boss', leader: 'ou_ceo', departments: ['d0'] })).toBe('boss')
    expect(relationOf(owner, { openId: 'ou_r', leader: 'ou_me', departments: ['d1'] })).toBe('report')
    expect(relationOf(owner, { openId: 'ou_p', leader: 'ou_boss', departments: ['d1'] })).toBe('peer')
    expect(relationOf(owner, { openId: 'ou_x', leader: 'ou_y', departments: ['d9'] })).toBe('requester')
  })
  it('reads Feishu contacts once a day; any failure is unknown', async () => {
    const calls: string[] = []
    const users: Record<string, any> = { ou_me: { leader_user_id: 'ou_boss', department_ids: ['d1'] }, ou_boss: { leader_user_id: '', department_ids: ['d0'] } }
    const get = async (url: string) => {
      calls.push(url)
      const id = decodeURIComponent(url.split('/users/')[1].split('?')[0])
      return users[id] ? { status: 200, body: { code: 0, data: { user: users[id] } } } : { status: 403, body: { code: 99991672, msg: 'no scope' } }
    }
    const look = createRelationLookup({ get, token: async () => 'u-t', selfOpenId: () => 'ou_me', now: () => 0 })
    expect(await look('ou_boss')).toBe('boss')
    expect(await look('ou_boss')).toBe('boss')
    expect(calls).toHaveLength(2)
    expect(await look('ou_stranger')).toBe('unknown')
    expect(await createRelationLookup({ get, token: async () => null, selfOpenId: () => 'ou_me' })('ou_boss')).toBe('unknown')
  })
})

describe('free / busy', () => {
  const at = (d: string, h: number, m = 0) => new Date(`${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).getTime()
  it('next working days skip the weekend', () => {
    expect(workingDays(new Date(2026, 9, 23), 3).map(d => d.getDate())).toEqual([23, 26, 27])
  })
  it('busy blocks only, never titles; unknown without a calendar or when a source failed', () => {
    const days = [
      { date: '2026-10-22', events: [{ start: at('2026-10-22', 14), end: at('2026-10-22', 15, 30), allDay: false, title: 'Secret 1:1' }, { start: at('2026-10-22', 10), end: at('2026-10-22', 11), allDay: false, title: 'x' }], errors: {} },
      { date: '2026-10-23', events: [], errors: {} },
      { date: '2026-10-26', events: [{ start: 0, end: 0, allDay: true, title: 'Offsite' }], errors: {} }
    ]
    const r = freeBusyText(days, true)
    expect(r).toEqual({ known: true, text: '周四 10/22: busy 10:00–11:00, 14:00–15:30\n周五 10/23: free\n周一 10/26: busy all day' })
    expect(r.text).not.toContain('Secret')
    expect(freeBusyText(days, false).known).toBe(false)
    expect(freeBusyText([{ date: '2026-10-22', events: [], errors: { feishu: 'signed_out' } }], true).known).toBe(false)
  })
  it('a meeting answer without the calendar is held', () => {
    expect(gateAnswer({ answer: ans({ category: 'meeting' }), relation: 'peer' })).toMatchObject({ level: 'hold', reasons: ['calendar not available'] })
    expect(gateAnswer({ answer: ans({ category: 'meeting' }), relation: 'peer', calendarKnown: true }).level).toBe('auto')
  })
})
