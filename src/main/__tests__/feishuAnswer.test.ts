import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readPeople, setPerson } from '../feishuAnswer'
import { createRelationLookup, declineReply, DECLINE_TOPICS, freeBusyText, gateAnswer, isAck, meetingCreatedReply, meetingSlot, parseAnswer, relationOf, workingDays, type Answer } from '../feishuAnswer'

const ans = (o: Partial<Answer> = {}): Answer => ({ category: 'product-status', level: 'auto', confidence: 'high', reply: 'ok', sources: [], claims: [], jiraFixes: [], ...o })

describe('parseAnswer', () => {
  it('reads the JSON, defaults the unknown to the safe side', () => {
    expect(parseAnswer('x {"category":"meeting","level":"auto","confidence":"high","reply":" hi ","sources":["FAE-1"],"claims":[{"claim":"c","verdict":"confirmed","source":"FAE-1"}]} y'))
      .toEqual({ category: 'meeting', level: 'auto', confidence: 'high', reply: 'hi', sources: ['FAE-1'], claims: [{ claim: 'c', verdict: 'confirmed', source: 'FAE-1' }], jiraFixes: [] })
    expect(parseAnswer('{"category":"x","level":"y","confidence":"z","reply":"r","claims":[{"claim":"c","verdict":"maybe"}]}'))
      .toMatchObject({ category: 'cannot-answer', level: 'hold', confidence: 'low', claims: [{ verdict: 'unverified' }] })
    expect(parseAnswer('not json')).toBeNull()
    expect(parseAnswer('{bad')).toBeNull()
  })
})

describe('gateAnswer', () => {
  it('facts all checked, only a judgment left: facts go out, the judgment is the owner\'s (split)', () => {
    const ok = { claim: '10-12 的三个问题未回答', verdict: 'confirmed' as const, source: 'FAE-1422 comments' }
    const base = { category: 'product-status' as const, level: 'approve' as const, confidence: 'medium' as const, reply: '看了 FAE-1422：三项都没回答。', sources: ['FAE-1422'], claims: [ok], ownerQuestion: '要不要升级' }
    expect(gateAnswer({ answer: ans(base), relation: 'peer' })).toMatchObject({ level: 'auto', split: true })
    // any unchecked or contradicted fact, low confidence, the manager, or no owner question → held as before
    expect(gateAnswer({ answer: ans({ ...base, claims: [{ ...ok, verdict: 'unverified' }] }), relation: 'peer' })).toMatchObject({ level: 'approve' })
    expect(gateAnswer({ answer: ans({ ...base, claims: [{ ...ok, source: '' }] }), relation: 'peer' }).split).toBeFalsy()
    expect(gateAnswer({ answer: ans({ ...base, claims: [] }), relation: 'peer' }).split).toBeFalsy()
    expect(gateAnswer({ answer: ans({ ...base, confidence: 'low' }), relation: 'peer' }).level).toBe('hold')
    expect(gateAnswer({ answer: ans(base), relation: 'boss' }).level).toBe('hold')
    expect(gateAnswer({ answer: ans({ ...base, ownerQuestion: undefined }), relation: 'peer' }).level).toBe('approve')
  })
  it('a reply that hands it to the owner is held, so a card reaches the owner', () => {
    for (const reply of ['收到。报告已转给 Megan 查阅，执行通过率和计划完成时间由 Megan 看过后回复您。', 'Thanks — I will pass it on to Megan.', '我会反馈给 Megan，稍后回复'])
      expect(gateAnswer({ answer: ans({ reply }), relation: 'peer' })).toMatchObject({ level: 'hold', notify: true })
    expect(gateAnswer({ answer: ans({ reply: 'Build 正常，测试都过了。' }), relation: 'peer' }).level).toBe('auto')
  })
  it('a clear, sourced answer goes out', () => {
    expect(gateAnswer({ answer: ans({ reply: 'FAE-1076 已上线', sources: ['FAE-1076'] }), relation: 'requester' })).toEqual({ level: 'auto', reasons: [], notify: false })
  })
  it('never sends: PR content, an unchecked key, unreadable answers, cannot-answer, low confidence, the manager', () => {
    expect(gateAnswer({ answer: ans({ reply: 'PR-8885 在做', sources: ['PR-8885'] }), relation: 'peer', neverQuote: ['PR'] })).toMatchObject({ level: 'hold', reasons: ['mentions PR (never quoted)'] })
    expect(gateAnswer({ answer: ans({ reply: 'PR-8885 在做', sources: ['PR-8885'] }), relation: 'peer' }).level).toBe('auto')
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
    users.ou_boss.name = 'Boss Wang'
    expect(await createRelationLookup({ get, token: async () => 'u-t', selfOpenId: () => 'ou_me' }).nameOf('ou_boss')).toBe('Boss Wang')
    expect(await look.nameOf('ou_stranger')).toBe('')
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

describe('acknowledgements', () => {
  it('ok / 好的 / 收到 / 👍 / stickers are acknowledgements; questions and real lines are not', () => {
    for (const t of ['ok', 'OK!', '好的', '好的。', '收到', '嗯嗯', '明白了', '谢谢~', 'Thanks!', 'got it', '👍', '👍🏻', '🙏👌', '[sticker]', '好的谢谢']) expect(isAck(t)).toBe(true)
    for (const t of ['ok?', '好的，那周五可以吗', '收到，但是 FAE-1 还没好', 'ok 我明天看', '', '为什么']) expect(isAck(t)).toBe(false)
  })
  it('a proposal is read from the answer; unknown types are dropped', () => {
    expect(parseAnswer('{"category":"meeting","level":"auto","confidence":"high","reply":"r","proposal":{"type":"create_meeting","summary":"明天 16:00 会议"}}')!.proposal).toEqual({ type: 'create_meeting', summary: '明天 16:00 会议' })
    expect(parseAnswer('{"category":"meeting","level":"auto","confidence":"high","reply":"r","proposal":{"type":"delete_repo","summary":"x"}}')!.proposal).toBeUndefined()
  })
})

describe('small talk and polite declines', () => {
  it('plain small talk at medium confidence is answered; with a claim or a key it still waits', () => {
    expect(gateAnswer({ answer: ans({ category: 'chitchat-life', confidence: 'medium', reply: '周末愉快！' }), relation: 'peer' }).level).toBe('auto')
    expect(gateAnswer({ answer: ans({ category: 'chitchat-work', confidence: 'medium', reply: 'FAE-1 好了', sources: ['FAE-1'] }), relation: 'peer' }).level).toBe('approve')
  })
  it('private / personal / sensitive / confidential are declined, prices and approvals wait for the owner', () => {
    expect([...DECLINE_TOPICS].sort()).toEqual(['confidential', 'personal-info', 'private-chats', 'sensitive-info'])
    expect(declineReply('Megan')).toBe('这个我不方便透露。有具体的事可以告诉我，我转给 Megan。')
  })
})

describe('meetings Butler may create', () => {
  const at = new Date(2026, 9, 21, 10, 0).getTime() // Wed 10/21 10:00
  const p = (start: string, end: string) => ({ type: 'create_meeting' as const, summary: 's', title: 'Sync', start, end })
  it('well-formed, ahead, 15 min – 3 h, a working day 09:00–19:00, within two weeks', () => {
    expect(meetingSlot(p('2026-10-22T16:00', '2026-10-22T16:30'), at)).toEqual({ start: new Date(2026, 9, 22, 16).getTime(), end: new Date(2026, 9, 22, 16, 30).getTime(), title: 'Sync' })
    for (const [s, e] of [['2026-10-20T16:00', '2026-10-20T16:30'], ['2026-10-22T16:00', '2026-10-22T16:05'], ['2026-10-22T08:00', '2026-10-22T08:30'],
      ['2026-10-24T10:00', '2026-10-24T11:00'], ['2026-11-20T10:00', '2026-11-20T11:00'], ['2026-10-22T18:30', '2026-10-22T19:30'], ['tomorrow', 'later']]) {
      expect(meetingSlot(p(s, e), at)).toBeNull()
    }
    expect(meetingSlot({ type: 'notify', summary: 'x', start: '2026-10-22T16:00', end: '2026-10-22T16:30' }, at)).toBeNull()
  })
  it('the reply says what, when and the reminder', () => {
    expect(meetingCreatedReply({ start: new Date(2026, 9, 22, 16).getTime(), end: new Date(2026, 9, 22, 16, 30).getTime(), title: 'Sync' }, 'https://applink/x', 15))
      .toBe('好的，会议已创建：Sync，10/22 16:00–16:30，已设 15 分钟提醒。 https://applink/x')
  })
})

describe('jira fixes from an answer', () => {
  it('any Jira key with a status and a reason', () => {
    const a = parseAnswer('{"category":"product-status","level":"auto","confidence":"high","reply":"r","jira_fixes":[{"key":"FAE-1076","to":"完成","why":"P4-5317 released"},{"key":"PR-1","to":"Done","why":"x"},{"key":"P4-1","to":"","why":"x"}]}')!
    expect(a.jiraFixes).toEqual([{ key: 'FAE-1076', to: '完成', why: 'P4-5317 released' }, { key: 'PR-1', to: 'Done', why: 'x' }])
  })
})

describe("the owner's people list", () => {
  it('exact open_ids only; unknown removes; bad values dropped', () => {
    const d = mkdtempSync(join(tmpdir(), 'hive-people-'))
    expect(readPeople(d)).toEqual({})
    setPerson(d, 'ou_boss', 'boss')
    setPerson(d, 'ou_r', 'report')
    setPerson(d, 'Lin', 'peer')
    expect(readPeople(d)).toEqual({ ou_boss: 'boss', ou_r: 'report' })
    setPerson(d, 'ou_r', 'unknown')
    expect(readPeople(d)).toEqual({ ou_boss: 'boss' })
    writeFileSync(join(d, 'feishu-people.json'), JSON.stringify({ ou_x: 'king', ou_y: 'peer' }))
    expect(readPeople(d)).toEqual({ ou_y: 'peer' })
  })
})
