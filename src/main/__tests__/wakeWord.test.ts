import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { isCancelText, matchWake, parseCommand, parseWakeLine, planForward, stripWake, wakeTokens, namesOf } from '../wakeWord'
import type { AgentRow } from '../butlerApi'

const POSITIVE: Array<[string, string]> = [
  ['Hola Butler', ''],
  ['hola butler tell Missy to go', 'tell missy to go'],
  ['Hola, Butler. Tell Missy', 'tell missy'],
  ['Olá Butler', ''],
  ['ola butler', ''],
  ['HOLA BUTLER', ''],
  ['Holla butler', ''],
  ['Oh la butler', ''],
  ['Hello Butler, ask Quinn', 'ask quinn'],
  ['hola butter', ''],
  ['Ola butter 告诉 Missy', '告诉 missy'],
  ['ｈｏｌａ ｂｕｔｌｅｒ', ''],
  ['so, hola butler', '']
]
const NEGATIVE = [
  'hola', 'butler', 'hello', 'cola butler', 'hola butlers', 'holabutler', 'the butler did it',
  'hello there butler', 'Ola, how are you', 'a bottle of butter', ''
]

describe('wake phrase', () => {
  it.each(POSITIVE)('matches %j', (text, rest) => {
    expect(matchWake(text)).not.toBeNull()
    const t = wakeTokens(text)
    expect(t.length).toBeGreaterThan(0)
    if (rest) expect(wakeTokens(stripWake(text)).join(' ')).toBe(rest)
  })
  it.each(NEGATIVE)('ignores %j', text => {
    expect(matchWake(text)).toBeNull()
  })
  it('strips the phrase and anything before it, keeping original case', () => {
    expect(stripWake('Hola Butler, tell Missy to go')).toBe('tell Missy to go')
    expect(stripWake('Olá Butler：告诉 Missy')).toBe('告诉 Missy')
    expect(stripWake('告诉 Missy 继续')).toBe('告诉 Missy 继续')
  })
  it('knows cancel words in both languages', () => {
    for (const t of ['cancel', 'Cancel.', '取消', '取消。', '算了', 'cancel it']) expect(isCancelText(t)).toBe(true)
    for (const t of ['', 'tell Missy to cancel the build', '取消订单的测试继续做']) expect(isCancelText(t)).toBe(false)
  })
})

// The Swift helper has its own copy of the lists; both must agree.
const HELPER = join(__dirname, '..', '..', '..', 'scripts', 'hive-speech')
describe.skipIf(process.platform !== 'darwin' || !existsSync(HELPER))('wake phrase — Swift helper agrees', () => {
  it('gives the same answers as wakeWord.ts', () => {
    const lines = [...POSITIVE.map(p => p[0]), ...NEGATIVE.filter(Boolean), 'cancel', '取消', '算了', 'tell Missy to cancel the build']
    const out = execFileSync(HELPER, ['--wake', '--match'], { input: lines.join('\n') + '\n', encoding: 'utf-8' }).trim().split('\n')
    expect(out).toHaveLength(lines.length)
    lines.forEach((line, i) => {
      const [w, c, rest] = out[i].split('\t')
      expect([line, w === '1']).toEqual([line, matchWake(line) !== null])
      expect([line, c === '1']).toEqual([line, isCancelText(line)])
      if (w === '1') expect([line, rest]).toEqual([line, wakeTokens(stripWake(line)).join(' ')])
    })
  })
})

describe('parseWakeLine', () => {
  it('reads every helper line', () => {
    expect(parseWakeLine('listening:')).toEqual({ kind: 'listening' })
    expect(parseWakeLine('wake:')).toEqual({ kind: 'wake' })
    expect(parseWakeLine('timeout:')).toEqual({ kind: 'timeout' })
    expect(parseWakeLine('cancel:')).toEqual({ kind: 'cancel' })
    expect(parseWakeLine('command:/tmp/a.wav\t告诉 Missy 继续')).toEqual({ kind: 'command', path: '/tmp/a.wav', fallback: '告诉 Missy 继续' })
    expect(parseWakeLine('command:/tmp/a.wav')).toEqual({ kind: 'command', path: '/tmp/a.wav', fallback: '' })
    expect(parseWakeLine('command:')).toBeNull()
    expect(parseWakeLine('partial:hi')).toBeNull()
    expect(parseWakeLine('audio:/tmp/a.wav\thi')).toBeNull()
  })
})

const row = (agentId: string, agent: string, project: string, chatLive = true): AgentRow =>
  ({ agentId, agent, projectId: `p-${project}`, project, role: '', note: '', chatLive, activity: chatLive ? 'waiting' : 'off' })
const ROWS = [
  row('a1', 'Missy', 'Cube v2'),
  row('a2', 'Quinn', 'Cube v2'),
  row('a3', 'Missy', 'Mobile'),
  row('a4', 'Ada', 'Mobile', false),
  row('a5', '小明', 'Mobile'),
  row('a6', 'Missy 2', 'Mobile')
]
const NAMES = namesOf(ROWS)

describe('parseCommand', () => {
  it.each([
    ['告诉 Missy 继续做 mobile e2e', { agent: 'Missy', text: '继续做 mobile e2e' }],
    ['告诉Missy继续做mobile e2e', { agent: 'Missy', text: '继续做mobile e2e' }],
    ['跟 Cube v2 的 Missy 说 继续做 mobile e2e', { agent: 'Missy', project: 'Cube v2', text: '继续做 mobile e2e' }],
    ['跟Cube v2的Missy说，跑一下测试', { agent: 'Missy', project: 'Cube v2', text: '跑一下测试' }],
    ['让 Quinn 用 UAT 新建一张卡', { agent: 'Quinn', text: '用 UAT 新建一张卡' }],
    ['告诉小明说先停一下', { agent: '小明', text: '先停一下' }],
    ['请告诉 missy 继续', { agent: 'Missy', text: '继续' }],
    ['告诉 Missy 2 继续', { agent: 'Missy 2', text: '继续' }],
    ['tell Missy to keep going on mobile e2e', { agent: 'Missy', text: 'keep going on mobile e2e' }],
    ['Tell missy that the build is green.', { agent: 'Missy', text: 'the build is green.' }],
    ['ask Quinn whether UAT is up', { agent: 'Quinn', text: 'whether UAT is up' }],
    ['tell Missy in Cube v2 to rerun', { agent: 'Missy', project: 'Cube v2', text: 'rerun' }],
    ["tell Mobile's Missy to rerun", { agent: 'Missy', project: 'Mobile', text: 'rerun' }],
    ['Hola Butler, tell Missy to stop', { agent: 'Missy', text: 'stop' }],
    ['tell Zed to go', { agent: 'Zed', text: 'go' }],
    ['告诉 老王 说 开会', { agent: '老王', text: '开会' }],
    ['谁在跑', { text: '谁在跑' }],
    ['Hola Butler what is running', { text: 'what is running' }],
    ['what did Missy do today', { text: 'what did Missy do today' }]
  ])('%j', (input, want) => {
    expect(parseCommand(input, NAMES)).toEqual(want)
  })
  it('does not take a name that only starts a longer word', () => {
    expect(parseCommand('tell Missyx to go', NAMES).agent).toBe('Missyx')
  })
})

describe('planForward', () => {
  const plan = (text: string, butlerLive = true) => planForward(parseCommand(text, NAMES), ROWS, butlerLive)
  it('sends to a single running agent', () => {
    expect(plan('告诉 Quinn 继续')).toMatchObject({ kind: 'agent', row: { agentId: 'a2' }, text: '继续' })
    expect(plan('跟 Mobile 的 Missy 说 继续')).toMatchObject({ kind: 'agent', row: { agentId: 'a3' } })
  })
  it('asks when the name is in two projects', () => {
    const p = plan('tell Missy to go')
    expect(p.kind).toBe('ambiguous')
    if (p.kind === 'ambiguous') expect(p.candidates.map(c => c.agentId)).toEqual(['a1', 'a3'])
  })
  it('does not guess a name it does not know', () => {
    expect(plan('tell Zed to go')).toMatchObject({ kind: 'not_found', name: 'Zed', candidates: [] })
    const p = plan('tell Quinn in Mobile to go')
    expect(p).toMatchObject({ kind: 'not_found', name: 'Quinn', project: 'Mobile' })
    if (p.kind === 'not_found') expect(p.candidates.map(c => c.agentId)).toEqual(['a2'])
  })
  it('holds a message for a chat that is not running', () => {
    expect(plan('tell Ada to go')).toMatchObject({ kind: 'no_session', row: { agentId: 'a4' } })
  })
  it('sends commands without a target to the Butler chat', () => {
    expect(plan('谁在跑')).toEqual({ kind: 'butler', live: true, text: '谁在跑' })
    expect(plan('谁在跑', false)).toEqual({ kind: 'butler', live: false, text: '谁在跑' })
  })
  it('has nothing to send for an empty message', () => {
    expect(plan('Hola Butler')).toEqual({ kind: 'empty' })
    expect(plan('tell Missy')).toEqual({ kind: 'empty' })
  })
})
