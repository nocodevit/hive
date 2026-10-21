import { describe, it, expect } from 'vitest'
import { createHistorySearch, queryWords } from '../feishuHistory'

const msg = (id: string, chat: string, text: string, t: number, sender = 'ou_x') =>
  ({ message_id: id, chat_id: chat, create_time: String(t), sender: { id: sender }, msg_type: 'text', body: { content: JSON.stringify({ text }) } })

/** A fake Feishu: chats with messages and members, a message search that sees every chat. */
function fakeFeishu(opts: { searchAllowed?: boolean } = {}) {
  const chats: Record<string, { members: string[]; messages: any[] }> = {
    here: { members: ['ou_ben', 'ou_me'], messages: [msg('h1', 'here', '上次说的 roaming 方案', 300), msg('h2', 'here', '吃饭了吗', 200)] },
    shared: { members: ['ou_ben', 'ou_me', 'ou_lin'], messages: [msg('s1', 'shared', 'roaming 定在周五', 250)] },
    secret: { members: ['ou_me', 'ou_lin'], messages: [msg('x1', 'secret', 'roaming 价格内部讨论', 260)] }
  }
  const http = async (method: string, url: string, _t: string, body?: any) => {
    const u = new URL(url)
    if (method === 'POST' && u.pathname.endsWith('/search/v2/message')) {
      if (opts.searchAllowed === false) return { status: 400, body: { code: 99991679, msg: 'no scope' } }
      const ids = Object.values(chats).flatMap(c => c.messages).filter(m => JSON.parse(m.body.content).text.includes(body.query)).map(m => m.message_id)
      return { status: 200, body: { code: 0, data: { items: ids } } }
    }
    const one = u.pathname.match(/\/im\/v1\/messages\/(.+)$/)
    if (one) { const m = Object.values(chats).flatMap(c => c.messages).find(x => x.message_id === one[1]); return { status: 200, body: { code: 0, data: { items: [m] } } } }
    const mem = u.pathname.match(/\/im\/v1\/chats\/(.+)\/members$/)
    if (mem) return { status: 200, body: { code: 0, data: { items: chats[mem[1]].members.map(member_id => ({ member_id })), has_more: false } } }
    if (u.pathname.endsWith('/im/v1/messages')) return { status: 200, body: { code: 0, data: { items: chats[u.searchParams.get('container_id')!].messages, has_more: false } } }
    return { status: 404, body: {} }
  }
  return http as any
}

const ben = { senderId: 'ou_ben', chatId: 'here', chatName: 'Ben' }

describe('chat history search', () => {
  it('query words: 2+ chars, at most 5', () => {
    expect(queryWords('roaming, 方案 a roaming')).toEqual(['roaming', '方案'])
  })
  it('answering Ben: this chat + chats Ben is in; never a chat Ben is not in', async () => {
    const search = createHistorySearch({ http: fakeFeishu(), token: async () => 'u' })
    const r = await search('roaming', ben)
    expect(r.hits.map(h => h.chatId).sort()).toEqual(['here', 'shared'])
    expect(r.hits.some(h => h.text.includes('内部'))).toBe(false)
    expect(r.note).toBe('some results hidden: the sender is not in those chats')
  })
  it('the owner\'s own search (no run) sees every chat', async () => {
    const search = createHistorySearch({ http: fakeFeishu(), token: async () => 'u' })
    expect((await search('roaming', null)).hits.map(h => h.chatId).sort()).toEqual(['here', 'secret', 'shared'])
  })
  it('without the message-search scope: this chat only, and it says so', async () => {
    const search = createHistorySearch({ http: fakeFeishu({ searchAllowed: false }), token: async () => 'u' })
    const r = await search('roaming', ben)
    expect(r.hits.map(h => h.chatId)).toEqual(['here'])
    expect(r.note).toBe('searched this chat only (no message-search permission)')
  })
  it('not signed in / empty query', async () => {
    expect((await createHistorySearch({ http: fakeFeishu(), token: async () => null })('x y', ben)).note).toBe('Feishu not signed in')
    expect((await createHistorySearch({ http: fakeFeishu(), token: async () => 'u' })('a', ben)).note).toBe('empty query')
  })
})
