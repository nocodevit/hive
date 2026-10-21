// What Butler did for the owner today (evening report) and what is waiting for
// them (morning plan) — counted by code from the case log and the approval
// queue, so the numbers are exact.

interface CaseLike { at: number; outcome: string; category: string; reasons: string[] }
interface ApprovalLike { kind: string; title: string; status: string; createdAt: number; resolvedAt?: number }

/** "Butler today" lines; '' when Butler did nothing. */
export function butlerDayText(cases: CaseLike[], approvals: ApprovalLike[], since: number): string {
  const today = cases.filter(c => c.at >= since)
  const answered = today.filter(c => c.outcome === 'auto' && c.category !== 'meeting').length
  const meetings = today.filter(c => c.category === 'meeting' && c.outcome === 'auto' && c.reasons.some(r => r.startsWith('created'))).length
  const acks = today.filter(c => c.outcome === 'acknowledged').length
  const handed = today.filter(c => ['pending', 'approved', 'edited', 'rejected'].includes(c.outcome)).length
  const open = today.filter(c => c.outcome === 'pending').length
  const made = approvals.filter(a => a.createdAt >= since)
  const drafts = made.filter(a => a.kind.startsWith('email.')).length
  const jira = made.filter(a => a.kind.startsWith('jira.')).length
  const done = approvals.filter(a => (a.resolvedAt ?? 0) >= since && a.status === 'approved').length
  const lines: string[] = []
  if (answered || acks || meetings || handed) {
    lines.push(`- Feishu: answered ${answered}${meetings ? ` · meetings created ${meetings}` : ''}${acks ? ` · 👍 ${acks}` : ''} · passed to you ${handed}${open ? ` (${open} still waiting)` : ''}`)
  }
  if (drafts) lines.push(`- Email: ${drafts} replies drafted`)
  if (jira) lines.push(`- Jira: ${jira} cards for you`)
  if (done) lines.push(`- You approved ${done} today`)
  return lines.join('\n')
}

/** What waits for the owner right now, one line each (morning plan input). */
export function waitingLines(approvals: ApprovalLike[]): string[] {
  return approvals.filter(a => a.status === 'pending').sort((a, b) => a.createdAt - b.createdAt).map(a => `${a.title} (${a.kind})`)
}
