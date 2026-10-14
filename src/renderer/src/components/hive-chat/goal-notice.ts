// Claude Code answers /goal with plain sentences ("Goal set: …", "Goal
// cleared: …", "No goal set"). A goal condition is often a long paragraph
// with an inline numbered list of rules, which read as a wall of text in
// the chat. These helpers turn it into parts a card can lay out.

export type GoalNotice =
  | { kind: 'set'; condition: string }
  | { kind: 'cleared'; condition: string }
  | { kind: 'none' }

export function parseGoalNotice(text: string): GoalNotice | null {
  const t = text.trim()
  const set = t.match(/^Goal set:\s*([\s\S]+)$/)
  if (set) return { kind: 'set', condition: set[1].trim() }
  const cleared = t.match(/^Goal cleared(?::\s*([\s\S]*))?$/)
  if (cleared) return { kind: 'cleared', condition: (cleared[1] || '').trim() }
  if (/^No goal set\.?$/.test(t)) return { kind: 'none' }
  return null
}

export interface GoalParts {
  /** The goal itself — everything before the numbered list. */
  intro: string
  /** Numbered items, if the condition carries an inline "1. … 2. …" list. */
  rules: string[]
}

/**
 * Split an inline numbered list out of a goal condition. Only a run that
 * counts 1, 2, 3 … in order (at least two items) counts as a list, so a
 * stray "2." inside a sentence ("v2.5 shipped") is left alone.
 */
export function splitGoalCondition(condition: string): GoalParts {
  const text = condition.replace(/\s+/g, ' ').trim()
  const start = text.search(/(^|\s)1\.\s/)
  if (start < 0) return { intro: text, rules: [] }
  const listStart = text[start] === '1' ? start : start + 1
  const rules: string[] = []
  let rest = text.slice(listStart)
  for (let n = 1; ; n++) {
    const head = `${n}. `
    if (!rest.startsWith(head)) break
    rest = rest.slice(head.length)
    const next = rest.search(new RegExp(`\\s${n + 1}\\.\\s`))
    if (next < 0) { rules.push(rest.trim()); rest = ''; break }
    rules.push(rest.slice(0, next).trim())
    rest = rest.slice(next + 1)
  }
  if (rules.length < 2) return { intro: text, rules: [] }
  return { intro: text.slice(0, listStart).trim(), rules }
}

/** A user turn that is a /goal command typed into the input box. */
export function goalCommandArgs(text: string): string | null {
  const m = text.trim().match(/^\/goal(?:\s+([\s\S]*))?$/)
  return m ? (m[1] || '').trim() : null
}
