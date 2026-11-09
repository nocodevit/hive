import { describe, it, expect } from 'vitest'
import { apiArgs, toResponse, createLarkUserHttp, createLarkPeople } from '../larkUser'

describe('lark-cli as the owner', () => {
  it('builds an api call as user, query as --params, body on stdin', () => {
    expect(apiArgs('POST', 'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id', {})).toEqual(
      ['api', 'POST', '/open-apis/im/v1/messages', '--as', 'user', '--params', '{"receive_id_type":"chat_id"}', '--data', '-'])
    expect(apiArgs('DELETE', 'https://open.feishu.cn/open-apis/im/v1/messages/om_1')).toEqual(['api', 'DELETE', '/open-apis/im/v1/messages/om_1', '--as', 'user'])
  })

  it('maps ok / error / junk to the Feishu body shape', () => {
    expect(toResponse('{"ok":true,"data":{"message_id":"om_9"}}')).toEqual({ status: 200, body: { code: 0, data: { message_id: 'om_9' } } })
    expect(toResponse('{"ok":false,"error":{"code":230002,"message":"bot not in chat"}}')).toEqual({ status: 400, body: { code: 230002, msg: 'bot not in chat' } })
    expect(toResponse('{"ok":false,"error":{"subtype":"missing_scope","missing_scopes":["im:message"]}}').body.msg).toMatch(/missing a scope: im:message/)
    expect(toResponse('').status).toBe(502)
  })

  it('sends the body as JSON on stdin; a crashed lark-cli is an error, not a throw', async () => {
    const calls: Array<[string[], string]> = []
    const http = createLarkUserHttp(async (a, i) => { calls.push([a, i]); return '{"ok":true,"data":{"message_id":"om_1"}}' })
    expect(await http('POST', 'https://open.feishu.cn/open-apis/im/v1/messages/om_0/reply', 'ignored', { msg_type: 'text' })).toMatchObject({ status: 200 })
    expect(calls[0][1]).toBe('{"msg_type":"text"}')
    const broken = createLarkUserHttp(async () => { throw new Error('ENOENT lark-cli') })
    expect(await broken('DELETE', 'https://open.feishu.cn/open-apis/im/v1/messages/om_1', '')).toMatchObject({ status: 502 })
  })

  it('people: users with an open_id; a missing scope says so', async () => {
    const ok = createLarkPeople(async () => '{"ok":true,"data":{"users":[{"open_id":"ou_a","localized_name":"王五"},{"name":"no id"}]}}')
    expect(await ok('王五')).toEqual({ ok: true, people: [{ openId: 'ou_a', name: '王五' }] })
    const no = createLarkPeople(async () => '{"ok":false,"error":{"subtype":"missing_scope","missing_scopes":["contact:user:search"]}}')
    expect((await no('x')).error).toMatch(/contact:user:search/)
  })
})
