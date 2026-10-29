// Butler daily routines on macOS launchd: one LaunchAgent per routine
// (label com.hive.butler.<id>, StartCalendarInterval), so they run even
// with Hive closed. The job starts Hive with --butler-routine=<id>; see
// butlerRoutineMode.ts for what that launch does.
//
// Settings live in <butler dir>/routines.json. The LaunchAgents folder and
// the launchctl runner are injected (tests never touch the real ones).

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  ROUTINE_IDS, RETIRED_ROUTINE_IDS, defaultRoutineSettings, isRoutineId,
  type RoutineConfig, type RoutineId, type RoutineSchedule, type RoutineSettings
} from '../shared/butler-routines'

export const ROUTINE_ARG = '--butler-routine='
export const LABEL_PREFIX = 'com.hive.butler.'
/** A scheduled run that starts this long after its slot is marked late. */
export const LATE_AFTER_MS = 15 * 60_000

export const routineLabel = (id: RoutineId) => `${LABEL_PREFIX}${id}`

export function parseRoutineArg(argv: readonly string[]): RoutineId | null {
  for (const a of argv) {
    if (!a.startsWith(ROUTINE_ARG)) continue
    const id = a.slice(ROUTINE_ARG.length)
    return isRoutineId(id) ? id : null
  }
  return null
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/
export const INTERVAL_CHOICES = [15, 30, 60]

export function parseTime(t: string): { hour: number; minute: number } | null {
  const m = t.match(TIME_RE)
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : null
}

/** Every time of day the schedule fires, in order. */
export function scheduleTimes(s: RoutineSchedule): Array<{ hour: number; minute: number }> {
  if (s.kind === 'times') {
    return s.times.map(parseTime).filter((x): x is { hour: number; minute: number } => !!x)
      .sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute))
  }
  const out: Array<{ hour: number; minute: number }> = []
  for (let m = s.fromHour * 60; m <= s.toHour * 60; m += s.everyMin) out.push({ hour: Math.floor(m / 60), minute: m % 60 })
  return out
}

function normSchedule(v: unknown, fallback: RoutineSchedule): RoutineSchedule {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  if (fallback.kind === 'times') {
    const times = Array.isArray(o.times) ? [...new Set(o.times.filter((t): t is string => typeof t === 'string' && TIME_RE.test(t)))] : []
    return { kind: 'times', times: times.length ? times.slice(0, 6) : fallback.times }
  }
  const every = INTERVAL_CHOICES.includes(Number(o.everyMin)) ? Number(o.everyMin) : fallback.everyMin
  const from = Number.isInteger(o.fromHour) && (o.fromHour as number) >= 0 && (o.fromHour as number) <= 23 ? o.fromHour as number : fallback.fromHour
  const to = Number.isInteger(o.toHour) && (o.toHour as number) > from && (o.toHour as number) <= 23 ? o.toHour as number : Math.max(from, fallback.toHour)
  return { kind: 'interval', everyMin: every, fromHour: from, toHour: to }
}

/** Any input → valid settings (unknown routines dropped, bad values → defaults). */
export function normalizeRoutineSettings(v: unknown): RoutineSettings {
  const d = defaultRoutineSettings()
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, any>
  const weekdays = Array.isArray(o.weekdays)
    ? [...new Set(o.weekdays.filter((n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 7) as number[])].sort()
    : d.weekdays
  const routines = {} as Record<RoutineId, RoutineConfig>
  for (const id of ROUTINE_IDS) {
    const r = o.routines?.[id]
    routines[id] = {
      enabled: typeof r?.enabled === 'boolean' ? r.enabled : d.routines[id].enabled,
      schedule: normSchedule(r?.schedule, d.routines[id].schedule)
    }
  }
  return { weekdays, routines }
}

export function routineSettingsFile(butlerFolder: string): string {
  return join(butlerFolder, 'routines.json')
}

export function readRoutineSettings(butlerFolder: string): RoutineSettings & { saved: boolean } {
  try {
    return { ...normalizeRoutineSettings(JSON.parse(readFileSync(routineSettingsFile(butlerFolder), 'utf8'))), saved: true }
  } catch {
    return { ...defaultRoutineSettings(), saved: false }
  }
}

export function writeRoutineSettings(butlerFolder: string, s: RoutineSettings): void {
  mkdirSync(butlerFolder, { recursive: true })
  const f = routineSettingsFile(butlerFolder)
  writeFileSync(f + '.tmp', JSON.stringify({ weekdays: s.weekdays, routines: s.routines }, null, 2) + '\n')
  renameSync(f + '.tmp', f)
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export interface PlistInput {
  id: RoutineId
  program: string[]
  schedule: RoutineSchedule
  weekdays: number[]
  logPath: string
  env?: Record<string, string>
  /** Shown as this app in System Settings → Login Items (else the signer's name). */
  bundleId?: string
}

/** The LaunchAgent for one routine. Weekday: 1 = Monday … 7 = Sunday (launchd). */
export function routinePlist(p: PlistInput): string {
  const L: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${xml(routineLabel(p.id))}</string>`,
    ...(p.bundleId ? ['  <key>AssociatedBundleIdentifiers</key>', '  <array>', `    <string>${xml(p.bundleId)}</string>`, '  </array>'] : []),
    '  <key>ProgramArguments</key>',
    '  <array>',
    ...[...p.program, `${ROUTINE_ARG}${p.id}`].map(a => `    <string>${xml(a)}</string>`),
    '  </array>'
  ]
  const env = Object.entries(p.env ?? {})
  if (env.length) {
    L.push('  <key>EnvironmentVariables</key>', '  <dict>')
    for (const [k, v] of env) L.push(`    <key>${xml(k)}</key>`, `    <string>${xml(v)}</string>`)
    L.push('  </dict>')
  }
  L.push('  <key>StartCalendarInterval</key>', '  <array>')
  for (const day of p.weekdays) {
    for (const t of scheduleTimes(p.schedule)) {
      L.push('    <dict>',
        '      <key>Weekday</key>', `      <integer>${day}</integer>`,
        '      <key>Hour</key>', `      <integer>${t.hour}</integer>`,
        '      <key>Minute</key>', `      <integer>${t.minute}</integer>`,
        '    </dict>')
    }
  }
  L.push('  </array>',
    '  <key>RunAtLoad</key>', '  <false/>',
    '  <key>StandardOutPath</key>', `  <string>${xml(p.logPath)}</string>`,
    '  <key>StandardErrorPath</key>', `  <string>${xml(p.logPath)}</string>`,
    '</dict>', '</plist>', '')
  return L.join('\n')
}

/** launchd weekday (1 = Mon … 7 = Sun) of a local date. */
export const launchdWeekday = (d: Date) => (d.getDay() === 0 ? 7 : d.getDay())

/** The most recent scheduled slot at or before `now` (looks back a week). */
export function lastSlotBefore(s: RoutineSchedule, weekdays: number[], now: Date): Date | null {
  const times = scheduleTimes(s)
  if (!times.length || !weekdays.length) return null
  for (let back = 0; back <= 7; back++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back)
    if (!weekdays.includes(launchdWeekday(day))) continue
    for (let i = times.length - 1; i >= 0; i--) {
      const slot = new Date(day.getFullYear(), day.getMonth(), day.getDate(), times[i].hour, times[i].minute)
      if (slot.getTime() <= now.getTime()) return slot
    }
  }
  return null
}

/** Late = the run started more than 15 min after the slot it is for (Mac was asleep). */
export function lateness(s: RoutineSchedule, weekdays: number[], now: Date): { late: boolean; due: Date | null } {
  const due = lastSlotBefore(s, weekdays, now)
  return { late: !!due && now.getTime() - due.getTime() > LATE_AFTER_MS, due }
}

export type Launchctl = (args: string[]) => Promise<{ code: number; stderr: string }>

export interface SchedulerDeps {
  agentsDir: string
  launchctl: Launchctl
  uid: number
  /** Hive's executable (+ app path in dev); the routine flag is appended. */
  program: () => string[]
  logDir: string
  env?: Record<string, string>
  /** Hive's bundle id, so Login Items shows "Hive" rather than the signer. */
  bundleId?: string
}

export function createRoutineScheduler(deps: SchedulerDeps) {
  const plistPath = (id: RoutineId) => join(deps.agentsDir, `${routineLabel(id)}.plist`)
  const domain = `gui/${deps.uid}`

  async function unload(id: RoutineId) {
    await deps.launchctl(['bootout', `${domain}/${routineLabel(id)}`]).catch(() => ({ code: 1, stderr: '' }))
  }

  const plistFor = (s: RoutineSettings, id: RoutineId) => routinePlist({
    id, program: deps.program(), schedule: s.routines[id].schedule, weekdays: s.weekdays,
    logPath: join(deps.logDir, `routine-${id}.log`), env: deps.env, bundleId: deps.bundleId
  })

  return {
    plistPath,
    /**
     * At start: rewrite + reload installed routines whose file is not what this
     * version writes (new keys, a moved app). Untouched when already current.
     */
    async sync(s: RoutineSettings): Promise<RoutineId[]> {
      const changed: RoutineId[] = []
      for (const id of ROUTINE_IDS) {
        const path = plistPath(id)
        // Not installed: a routine new in this version (or one whose install failed) is put in
        // when it is on; one the owner turned off stays off.
        if (!existsSync(path) && !s.routines[id]?.enabled) continue
        const text = plistFor(s, id)
        let cur = ''
        try { cur = readFileSync(path, 'utf8') } catch { /* unreadable: rewrite */ }
        if (cur === text) continue
        writeFileSync(path, text)
        await unload(id)
        await deps.launchctl(['bootstrap', domain, path]).catch(() => ({ code: 1, stderr: '' }))
        changed.push(id)
      }
      // A retired routine's job would launch Hive with an id it no longer knows: remove it.
      for (const old of RETIRED_ROUTINE_IDS) {
        const path = join(deps.agentsDir, `${LABEL_PREFIX}${old}.plist`)
        if (!existsSync(path)) continue
        await deps.launchctl(['bootout', `${domain}/${LABEL_PREFIX}${old}`]).catch(() => ({ code: 1, stderr: '' }))
        try { unlinkSync(path) } catch { /* gone */ }
      }
      return changed
    },
    installed(): Record<RoutineId, boolean> {
      return Object.fromEntries(ROUTINE_IDS.map(id => [id, existsSync(plistPath(id))])) as Record<RoutineId, boolean>
    },
    /** Write + (re)load enabled routines, unload + remove the others. Returns per-routine errors. */
    async apply(s: RoutineSettings): Promise<Partial<Record<RoutineId, string>>> {
      const errors: Partial<Record<RoutineId, string>> = {}
      for (const id of ROUTINE_IDS) {
        const r = s.routines[id]
        const on = r.enabled && s.weekdays.length > 0 && scheduleTimes(r.schedule).length > 0
        const path = plistPath(id)
        if (!on) {
          if (existsSync(path)) {
            await unload(id)
            try { unlinkSync(path) } catch { /* gone */ }
          }
          continue
        }
        const text = plistFor(s, id)
        mkdirSync(deps.agentsDir, { recursive: true })
        mkdirSync(deps.logDir, { recursive: true })
        writeFileSync(path, text)
        await unload(id)
        const res = await deps.launchctl(['bootstrap', domain, path]).catch(e => ({ code: 1, stderr: e instanceof Error ? e.message : String(e) }))
        if (res.code !== 0) errors[id] = res.stderr.trim() || `launchctl exited ${res.code}`
      }
      return errors
    }
  }
}

export type RoutineScheduler = ReturnType<typeof createRoutineScheduler>
