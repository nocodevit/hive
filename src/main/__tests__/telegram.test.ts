import { describe, it, expect, vi } from 'vitest'
import { checkToken, findStartChat, sendMessage, looksLikeToken, pushText, type FetchLike } from '../telegram'

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ'

function fake(answers: Record<string, unknown>) {
  const calls: { url: string; body?: string }[] = []
  const fn: FetchLike = vi.fn(async (url: string, init?: { body?: string }) => {
    calls.push({ url, body: init?.body })
    const method = url.split('/').pop()!
    const a = answers[method]
    if (a instanceof Error) throw a
    return { ok: true, status: 200, json: async () => a }
  })
  return { fn, calls }
}

describe('telegram setup helpers', () => {
  it('token shape', () => {
    expect(looksLikeToken(TOKEN)).toBe(true)
    expect(looksLikeToken(' ' + TOKEN + '\n')).toBe(true)
    expect(looksLikeToken('hello')).toBe(false)
    expect(looksLikeToken('123:short')).toBe(false)
  })

  it('checkToken: bad shape is rejected without a request', async () => {
    const f = fake({})
    expect(await checkToken(f.fn, 'nope')).toEqual({ ok: false, error: 'not_a_token' })
    expect(f.calls).toHaveLength(0)
  })

  it('checkToken: getMe → bot username', async () => {
    const f = fake({ getMe: { ok: true, result: { username: 'mei_hive_bot' } } })
    expect(await checkToken(f.fn, TOKEN)).toEqual({ ok: true, bot: 'mei_hive_bot' })
    expect(f.calls[0].url).toBe(`https://api.telegram.org/bot${TOKEN}/getMe`)
  })

  it('checkToken: Telegram says no / network error', async () => {
    expect(await checkToken(fake({ getMe: { ok: false, description: 'Unauthorized' } }).fn, TOKEN)).toEqual({ ok: false, error: 'rejected' })
    expect(await checkToken(fake({ getMe: new Error('offline') }).fn, TOKEN)).toEqual({ ok: false, error: 'network' })
  })

  it('findStartChat: latest private /start wins; groups and other text ignored', async () => {
    const f = fake({
      getUpdates: {
        ok: true,
        result: [
          { update_id: 1, message: { text: '/start', chat: { id: 111, type: 'private', first_name: 'Old' } } },
          { update_id: 2, message: { text: '/start', chat: { id: -5, type: 'group', title: 'Team' } } },
          { update_id: 3, message: { text: '/start', chat: { id: 222, type: 'private', first_name: 'Mei', last_name: 'Y' } } },
          { update_id: 4, message: { text: 'hi', chat: { id: 333, type: 'private', first_name: 'X' } } }
        ]
      }
    })
    expect(await findStartChat(f.fn, TOKEN)).toEqual({ ok: true, chatId: '222', name: 'Mei Y' })
  })

  it('findStartChat: nothing yet', async () => {
    expect(await findStartChat(fake({ getUpdates: { ok: true, result: [] } }).fn, TOKEN)).toEqual({ ok: false, error: 'no_start_yet' })
  })

  it('sendMessage posts chat_id + text', async () => {
    const f = fake({ sendMessage: { ok: true, result: {} } })
    expect(await sendMessage(f.fn, TOKEN, '222', pushText('Missy asks permission', 'Bash · git push'))).toEqual({ ok: true })
    expect(JSON.parse(f.calls[0].body!)).toMatchObject({ chat_id: '222', text: '🐝 Missy asks permission\nBash · git push' })
    expect(await sendMessage(fake({ sendMessage: { ok: false } }).fn, TOKEN, '222', 'x')).toEqual({ ok: false, error: 'rejected' })
  })
})
