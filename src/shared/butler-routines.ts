// Butler daily routines: ids, default schedules and the shapes main and
// renderer share. Weekdays use launchd numbering: 1 = Monday … 7 = Sunday.

export type RoutineId = 'morning-plan' | 'sort-inbox' | 'feishu-digest' | 'jira-check' | 'evening-report'

export const ROUTINE_IDS: RoutineId[] = ['morning-plan', 'sort-inbox', 'feishu-digest', 'jira-check', 'evening-report']

export type RoutineSchedule =
  | { kind: 'times'; times: string[] }
  | { kind: 'interval'; everyMin: number; fromHour: number; toHour: number }

export interface RoutineConfig {
  enabled: boolean
  schedule: RoutineSchedule
}

export interface RoutineSettings {
  weekdays: number[]
  routines: Record<RoutineId, RoutineConfig>
}

export const ROUTINE_NAME: Record<RoutineId, string> = {
  'morning-plan': 'Morning plan',
  'sort-inbox': 'Sort inbox',
  'feishu-digest': 'Feishu @mentions',
  'jira-check': 'Jira',
  'evening-report': 'Evening report'
}

/** One line each: what it does → where the result goes. */
export const ROUTINE_DESC: Record<RoutineId, string> = {
  'morning-plan': 'Plan for the day from mail, calendar, agents → Today',
  'sort-inbox': 'Sorts new mail, drafts replies → Approve',
  'feishu-digest': 'Messages that @mention you, summarized → Today',
  'jira-check': 'Closes, nudges and lists your tickets → Today, Approve',
  'evening-report': 'What every agent did today → Today'
}

/** The skill that decides how each routine works (Settings → Skills). */
export const ROUTINE_SKILL: Record<RoutineId, string | null> = {
  'morning-plan': 'morning-plan',
  'sort-inbox': 'sort-inbox',
  'feishu-digest': null,
  'jira-check': 'handle-jira',
  'evening-report': 'evening-report'
}

export function defaultRoutineSettings(): RoutineSettings {
  return {
    weekdays: [1, 2, 3, 4, 5],
    routines: {
      'morning-plan': { enabled: true, schedule: { kind: 'times', times: ['08:30'] } },
      'sort-inbox': { enabled: true, schedule: { kind: 'interval', everyMin: 30, fromHour: 9, toHour: 19 } },
      'feishu-digest': { enabled: false, schedule: { kind: 'times', times: ['11:00', '16:00'] } },
      'jira-check': { enabled: false, schedule: { kind: 'times', times: ['09:00'] } },
      'evening-report': { enabled: true, schedule: { kind: 'times', times: ['19:00'] } }
    }
  }
}

export function isRoutineId(v: unknown): v is RoutineId {
  return typeof v === 'string' && (ROUTINE_IDS as string[]).includes(v)
}

/** "08:30", "30 min · 9–19", "11:00 · 16:00". */
export function scheduleLabel(s: RoutineSchedule): string {
  if (s.kind === 'interval') return `${s.everyMin} min · ${s.fromHour}–${s.toHour}`
  return s.times.join(' · ')
}

export interface RoutineRunRecord {
  id: RoutineId
  at: number
  ok: boolean
  late: boolean
  error?: string
}

export interface RoutinesView {
  settings: RoutineSettings
  /** What launchd has loaded right now, per routine. */
  installed: Record<RoutineId, boolean>
  lastRuns: Partial<Record<RoutineId, RoutineRunRecord>>
}

export interface JournalItem {
  index: number
  text: string
  done: boolean
  source: 'draft' | 'jira' | null
}

export interface JournalDay {
  date: string
  plan: JournalItem[]
  planLate: string | null
  summary: string
  feishu: string
  jira: string
}
