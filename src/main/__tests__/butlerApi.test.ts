import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  isButlerRoute, checkButlerAuth, listAgents, resolveAgent, parseChatTail, latestChatLogPath, parseStartMode
} from '../butlerApi'

const DATA = {
  projects: [{ id: 'p1', name: 'Cube v2' }, { id: 'p2', name: 'Cube Support' }],
  agents: [
    { id: 'agent-1', name: 'Missy', projectId: 'p1', role: 'Engineering', note: '250+heatmap' },
    { id: 'agent-2', name: 'Wendy', projectId: 'p1', role: 'Engineering' },
    { id: 'agent-3', name: 'Missy', projectId: 'p2', department: 'QA' }
  ]
}
const rows = () => listAgents(DATA, ['agent-1', 'agent-2'], id => (id === 'agent-1' ? 'working' : undefined))

describe('isButlerRoute', () => {
  it('matches the four routes, with or without a query', () => {
    expect(isButlerRoute('/agents')).toBe(true)
    expect(isButlerRoute('/chat/tail?agentId=a&n=5')).toBe(true)
    expect(isButlerRoute('/chat/send')).toBe(true)
    expect(isButlerRoute('/chat/start')).toBe(true)
  })
  it('leaves the existing task routes alone', () => {
    expect(isButlerRoute('/task-status?projectId=p1')).toBe(false)
    expect(isButlerRoute('/status')).toBe(false)
    expect(isButlerRoute('/chat/sendx')).toBe(false)
  })
})

describe('checkButlerAuth', () => {
  it('accepts the exact token', () => {
    expect(checkButlerAuth({ 'x-hive-token': 'abc' }, 'abc')).toEqual({ ok: true })
  })
  it('rejects a missing, wrong, empty or array token', () => {
    expect(checkButlerAuth({}, 'abc')).toMatchObject({ ok: false, status: 401 })
    expect(checkButlerAuth({ 'x-hive-token': 'abd' }, 'abc')).toMatchObject({ ok: false, status: 401 })
    expect(checkButlerAuth({ 'x-hive-token': '' }, '')).toMatchObject({ ok: false, status: 401 })
    expect(checkButlerAuth({ 'x-hive-token': ['abc'] }, 'abc')).toMatchObject({ ok: false, status: 401 })
  })
  it('rejects anything a browser sent (Origin present), even with the token', () => {
    expect(checkButlerAuth({ origin: 'https://evil.example', 'x-hive-token': 'abc' }, 'abc'))
      .toMatchObject({ ok: false, status: 403 })
  })
})

describe('listAgents', () => {
  it('joins project names and derives activity from liveness', () => {
    expect(rows()).toEqual([
      { agentId: 'agent-1', agent: 'Missy', projectId: 'p1', project: 'Cube v2', role: 'Engineering', note: '250+heatmap', chatLive: true, activity: 'working' },
      { agentId: 'agent-2', agent: 'Wendy', projectId: 'p1', project: 'Cube v2', role: 'Engineering', note: '', chatLive: true, activity: 'waiting' },
      { agentId: 'agent-3', agent: 'Missy', projectId: 'p2', project: 'Cube Support', role: 'QA', note: '', chatLive: false, activity: 'off' }
    ])
  })
  it('never reports a non-live chat as working, whatever the stale status says', () => {
    const r = listAgents(DATA, [], () => 'working')
    expect(r.every(x => x.activity === 'off')).toBe(true)
  })
  it('tolerates empty / malformed data', () => {
    expect(listAgents({}, [], () => undefined)).toEqual([])
    expect(listAgents({ projects: null, agents: 'x' }, [], () => undefined)).toEqual([])
  })
})

describe('resolveAgent — exact match only', () => {
  it('resolves by agentId', () => {
    expect(resolveAgent(rows(), { agentId: 'agent-3' })).toMatchObject({ ok: true, row: { project: 'Cube Support' } })
  })
  it('resolves by project + agent name', () => {
    expect(resolveAgent(rows(), { project: 'Cube v2', agent: 'Missy' })).toMatchObject({ ok: true, row: { agentId: 'agent-1' } })
  })
  it('resolves a name that is unique across projects without a project', () => {
    expect(resolveAgent(rows(), { agent: 'Wendy' })).toMatchObject({ ok: true, row: { agentId: 'agent-2' } })
  })
  it('is ambiguous when the same name exists in two projects', () => {
    const r = resolveAgent(rows(), { agent: 'Missy' })
    expect(r).toMatchObject({ ok: false, error: 'ambiguous' })
    expect(!r.ok && r.candidates.map(c => c.agentId)).toEqual(['agent-1', 'agent-3'])
  })
  it('does not fuzzy-match case, prefixes or near-misses', () => {
    expect(resolveAgent(rows(), { agent: 'missy' })).toMatchObject({ ok: false, error: 'not_found' })
    expect(resolveAgent(rows(), { agent: 'Miss' })).toMatchObject({ ok: false, error: 'not_found' })
    expect(resolveAgent(rows(), { project: 'Cube', agent: 'Wendy' })).toMatchObject({ ok: false, error: 'not_found' })
  })
  it('offers same-name agents when only the project was wrong', () => {
    const r = resolveAgent(rows(), { project: 'Cube', agent: 'Missy' })
    expect(!r.ok && r.candidates.map(c => c.agentId)).toEqual(['agent-1', 'agent-3'])
  })
  it('reports unknown ids and missing targets', () => {
    expect(resolveAgent(rows(), { agentId: 'nope' })).toMatchObject({ ok: false, error: 'not_found' })
    expect(resolveAgent(rows(), {})).toMatchObject({ ok: false, error: 'missing_target' })
  })
})

describe('parseChatTail', () => {
  const j = (o: unknown) => JSON.stringify(o)
  const LOG = [
    j({ _direction: 'stdin', type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'run the build' }] } }),
    j({ type: 'system', subtype: 'init', session_id: 's1' }),
    j({ type: 'stream_event', event: { type: 'content_block_delta', delta: { text: 'par' } } }),
    j({ type: 'assistant', message: { content: [{ type: 'text', text: 'Running it now.' }, { type: 'tool_use', name: 'Bash', input: { command: 'npm run\n  build' } }] } }),
    j({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } }),
    j({ type: 'assistant', parent_tool_use_id: 't9', message: { content: [{ type: 'text', text: 'subagent chatter' }] } }),
    'not json',
    '',
    j({ type: 'assistant', message: { content: [{ type: 'text', text: 'Build passed.' }] } }),
    j({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.4567, duration_ms: 12400 })
  ]
  it('keeps typed user text, assistant text, tool calls and the turn result', () => {
    expect(parseChatTail(LOG, 50)).toEqual([
      { role: 'user', text: 'run the build' },
      { role: 'assistant', text: 'Running it now.' },
      { role: 'tool', text: 'Bash · npm run build' },
      { role: 'assistant', text: 'Build passed.' },
      { role: 'result', text: 'turn complete · $0.46 · 12s' }
    ])
  })
  it('returns only the last n items', () => {
    expect(parseChatTail(LOG, 2).map(i => i.role)).toEqual(['assistant', 'result'])
    expect(parseChatTail(LOG, 0)).toHaveLength(1)
  })
  it('labels an abnormal stop and clips long text', () => {
    const out = parseChatTail([
      j({ type: 'assistant', message: { content: [{ type: 'text', text: 'x'.repeat(50) }] } }),
      j({ type: 'result', subtype: 'error_max_turns', is_error: true })
    ], 5, 10)
    expect(out).toEqual([{ role: 'assistant', text: 'xxxxxxxxxx…' }, { role: 'result', text: 'stopped: error_max_turns' }])
  })
  it('is empty for an empty log', () => {
    expect(parseChatTail([], 5)).toEqual([])
  })
})

describe('latestChatLogPath', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'hive-butler-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('picks the newest log of exactly this agent', () => {
    for (const n of ['chat-agent-1-100.jsonl', 'chat-agent-1-300.jsonl', 'chat-agent-1-200.jsonl', 'chat-agent-12-999.jsonl', 'chat-agent-1-abc.jsonl', 'chat-agent-1-400.txt']) {
      writeFileSync(join(dir, n), '')
    }
    expect(latestChatLogPath(dir, 'agent-1')).toBe(join(dir, 'chat-agent-1-300.jsonl'))
    expect(latestChatLogPath(dir, 'agent-12')).toBe(join(dir, 'chat-agent-12-999.jsonl'))
  })
  it('is null when the agent has no log or the dir is missing', () => {
    expect(latestChatLogPath(dir, 'agent-7')).toBeNull()
    expect(latestChatLogPath(join(dir, 'missing'), 'agent-1')).toBeNull()
  })
})

describe('parseStartMode', () => {
  it('defaults to resume and accepts new', () => {
    expect(parseStartMode(undefined)).toBe('resume')
    expect(parseStartMode('resume')).toBe('resume')
    expect(parseStartMode('new')).toBe('new')
  })
  it('rejects anything else', () => {
    expect(parseStartMode('fork')).toBeNull()
    expect(parseStartMode(1)).toBeNull()
  })
})
