// Feishu messages Hive sends for the owner go out as the owner through
// lark-cli (`--as user`), never through Prime's send-as-user (owner, 11-09).
// Prime stays for reading (chats, messages, docs, calendar).

import { spawn } from 'child_process'

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'
export type Run = (args: string[], stdin: string) => Promise<string>

const API_BASE = 'https://open.feishu.cn'

export const larkBin = () => process.env.HIVE_LARK_BIN || 'lark-cli'

export const runLark: Run = (args, stdin) => new Promise((resolve, reject) => {
  const child = spawn(larkBin(), args, { stdio: ['pipe', 'pipe', 'pipe'] })
  let out = ''
  const timer = setTimeout(() => child.kill('SIGTERM'), 30_000)
  child.stdout.on('data', d => { out += d })
  child.on('error', e => { clearTimeout(timer); reject(e) })
  child.on('close', () => { clearTimeout(timer); resolve(out) })
  child.stdin.end(stdin)
})

/** `lark-cli api` arguments for one request, as the owner. */
export function apiArgs(method: Method, url: string, body?: unknown): string[] {
  const u = new URL(url, API_BASE)
  const params = Object.fromEntries(u.searchParams)
  return ['api', method, u.pathname, '--as', 'user',
    ...(Object.keys(params).length ? ['--params', JSON.stringify(params)] : []),
    ...(body !== undefined ? ['--data', '-'] : [])]
}

/** lark-cli's `{ok, data | error}` as the Feishu `{code, data}` body the callers read. */
export function toResponse(out: string): { status: number; body: any } {
  let j: any
  try { j = JSON.parse(out) } catch { return { status: 502, body: { code: -1, msg: out.trim().slice(0, 200) || 'lark-cli gave no answer' } } }
  if (j?.ok) return { status: 200, body: { code: 0, data: j.data } }
  const e = j?.error ?? {}
  return { status: 400, body: { code: e.code ?? -1, msg: e.subtype === 'missing_scope' ? `lark-cli is missing a scope: ${(e.missing_scopes ?? []).join(', ') || e.message}` : e.message || 'lark-cli failed' } }
}

/** Same shape as the Prime http (the token is not used: lark-cli signs in as the owner itself). */
export function createLarkUserHttp(run: Run = runLark) {
  return async (method: Method, url: string, _token: string, body?: unknown) =>
    toResponse(await run(apiArgs(method, url, body), body !== undefined ? JSON.stringify(body) : '').catch(e => String(e?.message ?? e)))
}

/** `./hive feishu people`: the directory through lark-cli, so the ids work for sending as the owner. */
export function createLarkPeople(run: Run = runLark) {
  return async (q: string): Promise<{ ok: boolean; error?: string; people?: Array<{ openId: string; name: string }> }> => {
    const r = toResponse(await run(['contact', '+search-user', '--query', q, '--as', 'user', '--format', 'json'], '').catch(e => String(e?.message ?? e)))
    if (r.body.code !== 0) return { ok: false, error: r.body.msg }
    const users: any[] = Array.isArray(r.body.data?.users) ? r.body.data.users : []
    return { ok: true, people: users.filter(u => typeof u?.open_id === 'string').map(u => ({ openId: u.open_id, name: String(u.localized_name ?? u.name ?? '') })) }
  }
}
