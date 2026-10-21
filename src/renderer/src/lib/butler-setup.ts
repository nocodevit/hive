// Butler's setup wizard: which steps exist and how far the owner got.
// Steps for features not built yet are simply absent, so the wizard never
// offers something Hive cannot do.

export type SetupMark = 'done' | 'skipped'
export type SetupGroup = 'Basics' | 'Connect' | 'Automate'

export interface SetupStep {
  id: string
  group: SetupGroup
  name: string
  /** Not counted in progress (welcome / done). */
  framing?: boolean
}

export const SETUP_STEPS: SetupStep[] = [
  { id: 'welcome', group: 'Basics', name: 'Welcome', framing: true },
  { id: 'claude', group: 'Basics', name: 'Claude Code' },
  { id: 'project', group: 'Basics', name: 'First project' },
  { id: 'theme', group: 'Basics', name: 'Theme' },
  { id: 'voice', group: 'Basics', name: 'Voice' },
  { id: 'about', group: 'Connect', name: 'About you' },
  { id: 'phone', group: 'Connect', name: 'Your phone' },
  { id: 'feishu', group: 'Connect', name: 'Feishu' },
  // [butler:mail-routines] email (Connect), routine (Automate)
  { id: 'email', group: 'Connect', name: 'Email' },

  // [butler:feishu-agent-calendar] calendar (Connect)
  { id: 'calendar', group: 'Connect', name: 'Calendar' },

  { id: 'routine', group: 'Automate', name: 'Daily routine' }, // [butler:mail-routines]
  { id: 'notify', group: 'Automate', name: 'Notifications' },
  { id: 'done', group: 'Automate', name: 'Done', framing: true }
]

export function setupProgress(marks: Record<string, SetupMark>, steps: SetupStep[] = SETUP_STEPS) {
  const counted = steps.filter(s => !s.framing)
  const done = counted.filter(s => marks[s.id] === 'done').length
  const open = counted.filter(s => marks[s.id] !== 'done')
  return { done, total: counted.length, open }
}

/** Where the wizard opens: the first step not answered yet (welcome when untouched). */
export function firstOpenStep(marks: Record<string, SetupMark>, steps: SetupStep[] = SETUP_STEPS): number {
  if (!Object.keys(marks).length) return 0
  const i = steps.findIndex(s => !s.framing && !marks[s.id])
  return i === -1 ? steps.length - 1 : i
}

/** Group headings go before the first step of each group. */
export function groupStarts(steps: SetupStep[] = SETUP_STEPS): Set<number> {
  const out = new Set<number>()
  steps.forEach((s, i) => { if (i === 0 || steps[i - 1].group !== s.group) out.add(i) })
  return out
}
