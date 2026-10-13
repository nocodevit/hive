import type { TimelineEntry } from './types'
import { isCompactSummaryEvent, extractCompactSummaryHint } from './compact-summary'
import { stopHookFeedback, goalCheckLine } from '../../../../shared/goal-loop'

/**
 * Flatten a batch of Claude-Code-local-persistence events
 * (`{type:'user', message:{content:[...]}}` / `{type:'assistant', message:{id,content:[...]}}`)
 * into the renderer's TimelineEntry[]. Pure function — same mapping the
 * live handler uses for `_historical: true` events, extracted so we can
 * prepend "Load older" batches atomically AND unit-test the mapping.
 *
 * Skips `thinking` / `redacted_thinking` blocks (internal reasoning,
 * not user-visible). Deduplicates by the derived entry id within this
 * call — the caller is responsible for dedup against the live timeline.
 *
 * `nextId()` supplies fresh ids for entries that don't carry a natural
 * key (user text / tool_result without a tool_use_id). Assistant text,
 * tool_use, and tool_result with a tool_use_id get stable keys
 * (`msg:<id>:<idx>` / `tool:<id>` / `result:<tool_use_id>`) so later
 * live updates can replace them in place.
 */
export function flattenHistoricalEvents(events: any[], nextId: () => string): TimelineEntry[] {
  const out: TimelineEntry[] = []
  const seen = new Set<string>()
  const push = (e: TimelineEntry) => {
    if (seen.has(e.id)) return
    seen.add(e.id)
    out.push(e)
  }

  // Consecutive /goal hook rounds collapse into one system line.
  let hookRun: { entry: { kind: 'system'; id: string; text: string }; n: number } | null = null

  for (const ev of events) {
    if (stopHookFeedback(ev) !== null) {
      if (hookRun) {
        hookRun.n += 1
        hookRun.entry.text = goalCheckLine(hookRun.n)
      } else {
        const entry = { kind: 'system' as const, id: nextId(), text: goalCheckLine(1) }
        hookRun = { entry, n: 1 }
        push(entry as TimelineEntry)
      }
      continue
    }
    // Claude's one-line replies between rounds don't break the run; real
    // work or a new user turn does.
    if (ev?.type === 'result' || (ev?.type === 'user' && !ev?.message?.content?.some?.((b: any) => b?.type === 'tool_result'))
      || (ev?.type === 'assistant' && ev?.message?.content?.some?.((b: any) => b?.type === 'tool_use'))) hookRun = null
    if (ev?.type === 'assistant') {
      const msg = ev.message
      const content = msg?.content
      const msgId = msg?.id
      if (!Array.isArray(content) || !msgId) continue
      content.forEach((block: any, idx: number) => {
        if (block?.type === 'thinking' || block?.type === 'redacted_thinking') return
        const entryId = block?.type === 'tool_use' && block.id
          ? `tool:${block.id}`
          : `msg:${msgId}:${idx}`
        if (block?.type === 'text') {
          push({ kind: 'assistant', text: String(block.text ?? ''), id: entryId } as TimelineEntry)
        } else if (block?.type === 'tool_use') {
          push({
            kind: 'tool_call',
            name: String(block.name ?? ''),
            input: block.input || {},
            id: entryId,
            toolUseId: block.id
          } as TimelineEntry)
        }
      })
    } else if (ev?.type === 'user') {
      // Compact / Compact+Fork summary user event — collapse to a
      // small hint chip so the timeline isn't dominated by 5-15 KB of
      // "This session is being continued…" prose on every replay.
      // The chip carries the transcript jsonl path so the user can
      // still open the raw content if they need to. Same filter runs
      // in the live stream handler (index.tsx).
      if (isCompactSummaryEvent(ev)) {
        const hint = extractCompactSummaryHint(ev)
        push({ kind: 'compact_summary_hint', id: nextId(), transcriptPath: hint.transcriptPath, summaryChars: hint.summaryChars } as TimelineEntry)
        continue
      }
      const content = ev.message?.content
      if (typeof content === 'string') {
        push({ kind: 'user', text: content, id: nextId() } as TimelineEntry)
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === 'text') {
            push({ kind: 'user', text: String(block.text ?? ''), id: nextId() } as TimelineEntry)
          } else if (block?.type === 'tool_result' && block.tool_use_id) {
            const text = Array.isArray(block.content)
              ? block.content.map((c: any) => c?.text ?? '').join('\n')
              : String(block.content ?? '')
            push({
              kind: 'tool_result',
              toolUseId: block.tool_use_id,
              content: text,
              isError: !!block.is_error,
              id: `result:${block.tool_use_id}`
            } as TimelineEntry)
          }
        }
      }
    }
  }
  return out
}
