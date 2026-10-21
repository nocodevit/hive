import { describe, it, expect } from 'vitest'
import { createMcpClient, rpcResult } from '../mcpHttp'

describe('mcp over http', () => {
  it('reads JSON and event-stream responses', () => {
    expect(rpcResult('application/json', '{"jsonrpc":"2.0","id":2,"result":{"a":1}}', 2)).toEqual({ a: 1 })
    expect(rpcResult('text/event-stream', 'event: message\ndata: {"jsonrpc":"2.0","id":3,"result":{"b":2}}\n\n', 3)).toEqual({ b: 2 })
    expect(() => rpcResult('application/json', '{"jsonrpc":"2.0","id":4,"error":{"message":"nope"}}', 4)).toThrow('mcp: nope')
  })
  it('initializes once, keeps the session id, pages tools/list, sends the owner\'s headers', async () => {
    const calls: Array<{ method: string; headers: Record<string, string> }> = []
    const fake = (async (_url: string, init: any) => {
      const b = JSON.parse(init.body)
      calls.push({ method: b.method, headers: init.headers })
      const reply = (result: unknown) => new Response(JSON.stringify({ jsonrpc: '2.0', id: b.id, result }), { headers: { 'content-type': 'application/json', 'mcp-session-id': 's1' } })
      if (b.method === 'initialize') return reply({})
      if (b.method === 'notifications/initialized') return new Response('', { status: 202 })
      if (b.method === 'tools/list') return reply(b.params.cursor ? { tools: [{ name: 'b' }] } : { tools: [{ name: 'a', description: 'A' }], nextCursor: 'c2' })
      if (b.method === 'tools/call') return reply({ content: [{ type: 'text', text: 'done' }] })
      return new Response('', { status: 400 })
    }) as unknown as typeof fetch
    const c = createMcpClient({ url: 'https://x/mcp', headers: { Authorization: 'Bearer t' } }, { fetch: fake })
    expect((await c.listTools()).map(t => t.name)).toEqual(['a', 'b'])
    expect(await c.callTool('a', {})).toBe('done')
    expect(calls.map(c => c.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list', 'tools/list', 'tools/call'])
    expect(calls[2].headers).toMatchObject({ Authorization: 'Bearer t', 'Mcp-Session-Id': 's1' })
  })
})
