import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { defaultRoutineSettings } from '../../shared/butler-routines'
import {
  createRoutineScheduler, lastSlotBefore, lateness, normalizeRoutineSettings, parseRoutineArg, readRoutineSettings,
  routinePlist, scheduleTimes, writeRoutineSettings
} from '../butlerRoutines'
import { forwardedRoutine, startRoutineMode, type AppLike } from '../butlerRoutineMode'
import { claudePrintArgs, createClaudeRunner } from '../butlerClaude'
import { EventEmitter } from 'events'

describe('--butler-routine arg', () => {
  it('parses a known routine id only', () => {
    expect(parseRoutineArg(['/Applications/Hive.app/Contents/MacOS/Hive', '--butler-routine=morning-plan'])).toBe('morning-plan')
    expect(parseRoutineArg(['electron', '/app', '--butler-routine=sort-inbox'])).toBe('sort-inbox')
    expect(parseRoutineArg(['Hive', '--butler-routine=rm-rf'])).toBeNull()
    expect(parseRoutineArg(['Hive', '--butler-routine'])).toBeNull()
    expect(parseRoutineArg(['Hive'])).toBeNull()
  })
  it('forwarded: argv first, then the lock data', () => {
    expect(forwardedRoutine(['Hive', '--butler-routine=jira-check'], { butlerRoutine: 'morning-plan' })).toBe('jira-check')
    expect(forwardedRoutine(['Hive'], { butlerRoutine: 'evening-report' })).toBe('evening-report')
    expect(forwardedRoutine(['Hive'], { butlerRoutine: 'nope' })).toBeNull()
    expect(forwardedRoutine(['Hive'], null)).toBeNull()
  })
})

describe('schedules', () => {
  it('expands an interval 09–19 every 30 min', () => {
    const t = scheduleTimes({ kind: 'interval', everyMin: 30, fromHour: 9, toHour: 19 })
    expect(t).toHaveLength(21)
    expect(t[0]).toEqual({ hour: 9, minute: 0 })
    expect(t[1]).toEqual({ hour: 9, minute: 30 })
    expect(t.at(-1)).toEqual({ hour: 19, minute: 0 })
  })
  it('normalizes bad input to defaults', () => {
    const s = normalizeRoutineSettings({ weekdays: [1, 1, 9, 3], routines: { 'morning-plan': { enabled: false, schedule: { times: ['25:00', '07:15'] } }, bogus: {} } })
    expect(s.weekdays).toEqual([1, 3])
    expect(s.routines['morning-plan']).toEqual({ enabled: false, schedule: { kind: 'times', times: ['07:15'] } })
    expect(s.routines['evening-report']).toEqual(defaultRoutineSettings().routines['evening-report'])
    expect(Object.keys(s.routines)).not.toContain('bogus')
  })
  it('reads defaults until saved', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hive-rt-'))
    expect(readRoutineSettings(dir).saved).toBe(false)
    writeRoutineSettings(dir, defaultRoutineSettings())
    expect(readRoutineSettings(dir)).toEqual({ ...defaultRoutineSettings(), saved: true })
  })
})

describe('late detection', () => {
  const morning = { kind: 'times' as const, times: ['08:30'] }
  const weekdays = [1, 2, 3, 4, 5]
  it('on time within 15 min of the slot', () => {
    // Tue 20 Oct 2026, 08:40
    expect(lateness(morning, weekdays, new Date(2026, 9, 20, 8, 40)).late).toBe(false)
    expect(lateness(morning, weekdays, new Date(2026, 9, 20, 8, 45)).late).toBe(false)
  })
  it('late after 15 min (Mac was asleep)', () => {
    const r = lateness(morning, weekdays, new Date(2026, 9, 20, 10, 42))
    expect(r.late).toBe(true)
    expect(r.due).toEqual(new Date(2026, 9, 20, 8, 30))
  })
  it('a Monday-morning wake finds Friday’s slot across the weekend', () => {
    expect(lastSlotBefore({ kind: 'times', times: ['19:00'] }, weekdays, new Date(2026, 9, 19, 7, 0))).toEqual(new Date(2026, 9, 16, 19, 0))
  })
  it('interval slots', () => {
    const s = { kind: 'interval' as const, everyMin: 30, fromHour: 9, toHour: 19 }
    expect(lastSlotBefore(s, weekdays, new Date(2026, 9, 20, 11, 10))).toEqual(new Date(2026, 9, 20, 11, 0))
    expect(lateness(s, weekdays, new Date(2026, 9, 20, 11, 20)).late).toBe(true)
  })
})

describe('routinePlist', () => {
  it('names Hive as the owner in Login Items when given a bundle id', () => {
    const x = routinePlist({ id: 'morning-plan', program: ['/H'], schedule: { kind: 'times', times: ['08:30'] }, weekdays: [1], logPath: '/l', bundleId: 'com.hive.app' })
    expect(x).toContain('<key>AssociatedBundleIdentifiers</key>\n  <array>\n    <string>com.hive.app</string>\n  </array>')
    expect(routinePlist({ id: 'morning-plan', program: ['/H'], schedule: { kind: 'times', times: ['08:30'] }, weekdays: [1], logPath: '/l' })).not.toContain('AssociatedBundleIdentifiers')
  })
  it('writes the exact LaunchAgent XML', () => {
    const xml = routinePlist({
      id: 'morning-plan',
      program: ['/Applications/Hive.app/Contents/MacOS/Hive'],
      schedule: { kind: 'times', times: ['08:30'] },
      weekdays: [1, 2],
      logPath: '/tmp/b/logs/routine-morning-plan.log'
    })
    expect(xml).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.hive.butler.morning-plan</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Applications/Hive.app/Contents/MacOS/Hive</string>
    <string>--butler-routine=morning-plan</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict>
      <key>Weekday</key>
      <integer>1</integer>
      <key>Hour</key>
      <integer>8</integer>
      <key>Minute</key>
      <integer>30</integer>
    </dict>
    <dict>
      <key>Weekday</key>
      <integer>2</integer>
      <key>Hour</key>
      <integer>8</integer>
      <key>Minute</key>
      <integer>30</integer>
    </dict>
  </array>
  <key>RunAtLoad</key>
  <false/>
  <key>StandardOutPath</key>
  <string>/tmp/b/logs/routine-morning-plan.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/b/logs/routine-morning-plan.log</string>
</dict>
</plist>
`)
  })
  it('escapes paths and adds env vars', () => {
    const xml = routinePlist({ id: 'sort-inbox', program: ['/a & b/Hive'], schedule: { kind: 'interval', everyMin: 60, fromHour: 9, toHour: 10 }, weekdays: [3], logPath: '/l', env: { HIVE_DATA_DIR: '/tmp/<x>' } })
    expect(xml).toContain('<string>/a &amp; b/Hive</string>')
    expect(xml).toContain('  <key>EnvironmentVariables</key>\n  <dict>\n    <key>HIVE_DATA_DIR</key>\n    <string>/tmp/&lt;x&gt;</string>\n  </dict>')
    expect(xml.match(/<key>Weekday<\/key>/g)).toHaveLength(2)
  })
})

describe('scheduler (fake launchctl)', () => {
  function setup(code = 0) {
    const root = mkdtempSync(join(tmpdir(), 'hive-la-'))
    const calls: string[][] = []
    const s = createRoutineScheduler({
      agentsDir: join(root, 'LaunchAgents'), logDir: join(root, 'logs'), uid: 501,
      program: () => ['/H'],
      launchctl: async args => { calls.push(args); return { code: args[0] === 'bootstrap' ? code : 3, stderr: args[0] === 'bootstrap' && code ? 'Bootstrap failed: 5' : '' } }
    })
    return { root, s, calls }
  }
  it('writes + bootstraps enabled routines only', async () => {
    const t = setup()
    const errors = await t.s.apply(defaultRoutineSettings())
    expect(errors).toEqual({})
    expect(t.s.installed()).toEqual({ 'morning-plan': true, 'sort-inbox': true, 'jira-check': false, dispatch: true, 'evening-report': true })
    expect(t.calls).toEqual([
      ['bootout', 'gui/501/com.hive.butler.morning-plan'],
      ['bootstrap', 'gui/501', join(t.root, 'LaunchAgents', 'com.hive.butler.morning-plan.plist')],
      ['bootout', 'gui/501/com.hive.butler.sort-inbox'],
      ['bootstrap', 'gui/501', join(t.root, 'LaunchAgents', 'com.hive.butler.sort-inbox.plist')],
      ['bootout', 'gui/501/com.hive.butler.dispatch'],
      ['bootstrap', 'gui/501', join(t.root, 'LaunchAgents', 'com.hive.butler.dispatch.plist')],
      ['bootout', 'gui/501/com.hive.butler.evening-report'],
      ['bootstrap', 'gui/501', join(t.root, 'LaunchAgents', 'com.hive.butler.evening-report.plist')]
    ])
    expect(readFileSync(t.s.plistPath('morning-plan'), 'utf8')).toContain('<string>--butler-routine=morning-plan</string>')
  })
  it('sync: rewrites and reloads only installed plists that are out of date', async () => {
    const t = setup()
    await t.s.apply(defaultRoutineSettings())
    t.calls.length = 0
    expect(await t.s.sync(defaultRoutineSettings())).toEqual([])
    expect(t.calls).toEqual([])
    writeFileSync(t.s.plistPath('morning-plan'), '<old/>')
    expect(await t.s.sync(defaultRoutineSettings())).toEqual(['morning-plan'])
    expect(t.calls.map(c => c[0])).toEqual(['bootout', 'bootstrap'])
    expect(readFileSync(t.s.plistPath('morning-plan'), 'utf8')).toContain('--butler-routine=morning-plan')
    expect(existsSync(t.s.plistPath('jira-check'))).toBe(false)
  })
  it('sync: a routine new in this version, on by default, is installed on the next start; one turned off is not', async () => {
    const t = setup()
    const s = defaultRoutineSettings()
    s.routines.dispatch.enabled = false
    await t.s.apply(s)
    expect(existsSync(t.s.plistPath('dispatch'))).toBe(false)
    // An older Hive saved settings without Dispatch: read back, it comes on (the default) and sync installs it.
    t.calls.length = 0
    expect(await t.s.sync(defaultRoutineSettings())).toEqual(['dispatch'])
    expect(existsSync(t.s.plistPath('dispatch'))).toBe(true)
    expect(existsSync(t.s.plistPath('jira-check'))).toBe(false)
  })
  it('sync: a retired routine (the old @mention digest) is booted out and its plist removed', async () => {
    const t = setup()
    await t.s.apply(defaultRoutineSettings())
    const old = join(t.root, 'LaunchAgents', 'com.hive.butler.feishu-digest.plist')
    writeFileSync(old, '<plist/>')
    t.calls.length = 0
    await t.s.sync(defaultRoutineSettings())
    expect(existsSync(old)).toBe(false)
    expect(t.calls).toEqual([['bootout', 'gui/501/com.hive.butler.feishu-digest']])
  })
  it('turning one off boots it out and removes its plist', async () => {
    const t = setup()
    const s = defaultRoutineSettings()
    await t.s.apply(s)
    t.calls.length = 0
    s.routines['sort-inbox'].enabled = false
    s.routines['morning-plan'].enabled = false
    s.routines['evening-report'].enabled = false
    s.routines.dispatch.enabled = false
    await t.s.apply(s)
    expect(t.calls).toEqual([
      ['bootout', 'gui/501/com.hive.butler.morning-plan'],
      ['bootout', 'gui/501/com.hive.butler.sort-inbox'],
      ['bootout', 'gui/501/com.hive.butler.dispatch'],
      ['bootout', 'gui/501/com.hive.butler.evening-report']
    ])
    expect(existsSync(t.s.plistPath('sort-inbox'))).toBe(false)
  })
  it('no weekdays = nothing scheduled', async () => {
    const t = setup()
    await t.s.apply({ ...defaultRoutineSettings(), weekdays: [] })
    expect(t.calls).toEqual([])
  })
  it('reports launchctl errors per routine', async () => {
    const t = setup(5)
    const errors = await t.s.apply(defaultRoutineSettings())
    expect(errors['morning-plan']).toBe('Bootstrap failed: 5')
  })
})

function fakeApp(lock: boolean) {
  const handlers: Array<(e: unknown, argv: string[], cwd: string, data: unknown) => void> = []
  const app = {
    lockData: undefined as unknown,
    quits: 0,
    hidden: false,
    requestSingleInstanceLock(data?: Record<string, unknown>) { app.lockData = data; return lock },
    on(_e: 'second-instance', cb: (e: unknown, argv: string[], cwd: string, data: unknown) => void) { handlers.push(cb) },
    whenReady: () => Promise.resolve(),
    quit() { app.quits++ },
    dock: { hide() { app.hidden = true } },
    emit: (argv: string[], data?: unknown) => handlers.forEach(h => h({}, argv, '/', data))
  }
  return app as AppLike & typeof app
}
const tick = () => new Promise(r => setTimeout(r, 0))

describe('routine launch mode', () => {
  it('normal launch: takes the lock and runs forwarded routines', async () => {
    const app = fakeApp(true)
    const runs: string[] = []
    expect(startRoutineMode(app, ['Hive'], async id => { runs.push(id) })).toEqual({ headless: false })
    app.emit(['Hive', '--butler-routine=sort-inbox'])
    app.emit(['Hive'])
    await tick()
    expect(runs).toEqual(['sort-inbox'])
    expect(app.quits).toBe(0)
  })
  it('normal launch while Hive runs: quits; the running Hive reopens its window', async () => {
    const second = fakeApp(false)
    expect(startRoutineMode(second, ['Hive'], async () => {})).toEqual({ headless: true, duplicate: true })
    expect(second.quits).toBe(1)
    const first = fakeApp(true)
    let reopened = 0
    startRoutineMode(first, ['Hive'], async () => {}, () => {}, () => { reopened++ })
    first.emit(['Hive'])
    first.emit(['Hive', '--butler-routine=sort-inbox'])
    await tick()
    expect(reopened).toBe(1)
  })
  it('Hive already running: forwards and quits without running', async () => {
    const app = fakeApp(false)
    const runs: string[] = []
    expect(startRoutineMode(app, ['Hive', '--butler-routine=evening-report'], async id => { runs.push(id) })).toEqual({ headless: true, routine: 'evening-report', forwarded: true })
    expect(app.lockData).toEqual({ butlerRoutine: 'evening-report' })
    await tick()
    expect(runs).toEqual([])
    expect(app.quits).toBe(1)
  })
  it('nothing running: runs headless, then quits', async () => {
    const app = fakeApp(true)
    const runs: Array<[string, boolean]> = []
    let release!: () => void
    const r = startRoutineMode(app, ['Hive', '--butler-routine=morning-plan'], (id, o) => { runs.push([id, o.scheduled]); return new Promise<void>(res => { release = res }) })
    expect(r).toEqual({ headless: true, routine: 'morning-plan', forwarded: false })
    expect(app.hidden).toBe(true)
    await tick()
    expect(runs).toEqual([['morning-plan', true]])
    expect(app.quits).toBe(0)
    release()
    await tick()
    expect(app.quits).toBe(1)
  })
})

describe('claude -p runner', () => {
  it('fresh session, prompt on stdin, allow-list only; no writes, web or ./hive send / start', async () => {
    const seen: { bin?: string; args?: string[]; cwd?: string; stdin?: string } = {}
    const spawn = ((bin: string, args: string[], o: { cwd: string }) => {
      const child = new EventEmitter() as any
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
      child.kill = () => {}
      child.stdin = { end: (s: string) => { seen.stdin = s; setTimeout(() => { child.stdout.emit('data', ' plan \n'); child.emit('close', 0) }, 0) } }
      Object.assign(seen, { bin, args, cwd: o.cwd })
      return child
    }) as any
    const run = createClaudeRunner({ bin: () => '/bin/claude', cwd: () => '/b', spawn })
    expect(await run('Use the morning-plan skill.')).toBe('plan')
    expect(seen).toEqual({ bin: '/bin/claude', cwd: '/b', stdin: 'Use the morning-plan skill.', args: claudePrintArgs() })
    expect(claudePrintArgs()).toEqual(['-p', '--output-format', 'text', '--permission-mode', 'dontAsk', '--disallowedTools', 'Edit,Write,NotebookEdit,WebFetch,WebSearch,Bash(./hive send:*),Bash(./hive start:*)'])
    expect(claudePrintArgs()).not.toContain('--continue')
    expect(claudePrintArgs(['mcp__jira'])).toContain('mcp__jira')
  })
})
