// A small MCP client over Streamable HTTP, for the servers in the owner's own
// Claude config (e.g. stargate). Hive uses it with the owner's own credentials
// to learn which tools this owner can use (so the Butler allow-list fits them)
// and to run a write the owner approved. Nothing here picks a server or a
// credential on its own: both come from ~/.claude.json.

export interface HttpServer { url: string; headers: Record<string, string> }
export interface McpTool { name: string; description: string }

type Fetch = typeof fetch

/** JSON-RPC result from a JSON or an event-stream body. */
export function rpcResult(contentType: string, text: string, id: number): any {
  const messages: any[] = []
  if (contentType.includes('text/event-stream')) {
    for (const line of text.split('\n')) {
      if (!line.startsWith('data:')) continue
      try { messages.push(JSON.parse(line.slice(5).trim())) } catch { /* keep-alive */ }
    }
  } else if (text.trim()) {
    const j = JSON.parse(text)
    messages.push(...(Array.isArray(j) ? j : [j]))
  }
  const m = messages.find(x => x && x.id === id)
  if (!m) throw new Error('mcp: no response')
  if (m.error) throw new Error(`mcp: ${String(m.error.message ?? m.error.code ?? 'error').slice(0, 200)}`)
  return m.result
}

export function createMcpClient(server: HttpServer, opts: { fetch?: Fetch; timeoutMs?: number } = {}) {
  const f = opts.fetch ?? fetch
  const timeout = opts.timeoutMs ?? 30_000
  let session = ''
  let nextId = 1
  let ready: Promise<void> | null = null

  async function post(body: unknown, id: number | null): Promise<any> {
    const res = await f(server.url, {
      method: 'POST',
      headers: {
        ...server.headers,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(session ? { 'Mcp-Session-Id': session } : {})
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout)
    })
    const sid = res.headers.get('mcp-session-id')
    if (sid) session = sid
    if (!res.ok) throw new Error(`mcp: HTTP ${res.status}`)
    if (id === null) return null
    return rpcResult(res.headers.get('content-type') ?? '', await res.text(), id)
  }

  function init(): Promise<void> {
    if (!ready) {
      ready = (async () => {
        const id = nextId++
        await post({ jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'hive-butler', version: '1' } } }, id)
        await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, null)
      })().catch(e => { ready = null; throw e })
    }
    return ready
  }

  async function call(method: string, params: unknown): Promise<any> {
    await init()
    const id = nextId++
    return post({ jsonrpc: '2.0', id, method, params }, id)
  }

  return {
    async listTools(): Promise<McpTool[]> {
      const out: McpTool[] = []
      let cursor: string | undefined
      for (let page = 0; page < 20; page++) {
        const r = await call('tools/list', cursor ? { cursor } : {})
        for (const t of r?.tools ?? []) if (typeof t?.name === 'string') out.push({ name: t.name, description: typeof t.description === 'string' ? t.description : '' })
        cursor = typeof r?.nextCursor === 'string' && r.nextCursor ? r.nextCursor : undefined
        if (!cursor) break
      }
      return out
    },
    /** Run one tool; the text content, or an error when the tool says it failed. */
    async callTool(name: string, args: Record<string, unknown>): Promise<string> {
      const r = await call('tools/call', { name, arguments: args })
      const text = (r?.content ?? []).filter((c: any) => c?.type === 'text').map((c: any) => String(c.text)).join('\n')
      if (r?.isError) throw new Error(text.slice(0, 300) || 'tool error')
      return text
    }
  }
}
