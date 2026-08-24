import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Typography — agent-name (heading) vs role/dept (label) visual distinction.
 *
 * Original v2.2.5 fix locked these two roles apart because the sidebar
 * had them at the same size/font and users couldn't tell them apart.
 *
 * v2.8.0 keeps the same intent but relaxes the exact-class assertions:
 *   - Kanban card removed its role suffix entirely (dedup — dept was
 *     already the column header above), so the second name/role pair
 *     no longer needs a matching-pair check.
 *   - Sidebar role picked up `flex items-center gap-1.5` to fit the
 *     new time-since chip; asserting the *shape* of the label
 *     (10-11px + uppercase + tracking + muted) instead of a frozen
 *     string is what actually protects the distinction.
 *
 * File-level checks (not component render tests) because App.tsx is a
 * 3000+ line surface that isn't cheaply mountable in isolation.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..')
const APP_TSX = readFileSync(join(REPO_ROOT, 'src', 'renderer', 'src', 'App.tsx'), 'utf-8')

describe('typography — agent name vs role visual distinction', () => {
  it('every agent-name render carries strong text style (medium+ weight, primary color, no uppercase)', () => {
    // Sidebar list — Inter Tight heading, semibold, primary color.
    // v2.9.0: outer span adds `overflow-hidden` + name-span gets
    // `flex-shrink` so name truncates first when tight and note tag
    // never spills the row (Playwright verified in
    // selected-agent-row-layout.spec.ts).
    expect(APP_TSX).toMatch(
      /className="flex items-center gap-1\.5 min-w-0 whitespace-nowrap overflow-hidden text-\[13px\] font-heading font-semibold text-text-primary"/
    )
    // Kanban card — v2.8.0 relaxed to font-medium (Inter Tight body weight)
    expect(APP_TSX).toMatch(
      /className="text-\[13px\] font-medium text-text-primary truncate"/
    )
    // Task-group inbox — Inter Tight heading, semibold
    expect(APP_TSX).toMatch(
      /className="text-\[13px\] font-heading font-semibold text-text-primary truncate"/
    )
  })

  it('every agent-role render carries label style (10-11px + uppercase + tracking + muted)', () => {
    // Sidebar list role span — now includes flex+gap so the time-since
    // chip can align to the right. Test asserts the label bucket
    // (font-semibold + uppercase + tracking-wider + text-muted) via
    // regex fragments rather than a frozen class string.
    const sidebarRole = /text-\[10px\] font-semibold uppercase tracking-wider[^"]*text-text-muted[^"]*flex items-center gap-1\.5/
    expect(APP_TSX, 'sidebar role span must carry label style + flex layout').toMatch(sidebarRole)

    // Task-group inbox role — unchanged
    expect(APP_TSX).toMatch(
      /className="text-\[10px\] font-semibold uppercase tracking-wider text-text-muted truncate"/
    )
  })

  it('kanban card no longer duplicates dept/role — the column header owns that read', () => {
    // Guard: the pre-v2.8.0 line `{agent.role || agent.department}` inside
    // the kanban card is intentionally gone (dedup with dept-list header).
    // If somebody re-adds it, this test flags the regression.
    expect(APP_TSX).not.toMatch(/\{agent\.role \|\| agent\.department\}/)
  })

  it('legacy alpha-only muting anti-pattern stays gone', () => {
    // v2.2.5 anti-pattern: expressing role as `text-text-muted/60` next to
    // a `text-[13px]` name to fake distinction. Fix moved to real label
    // typography; guard the return-to-shortcut.
    expect(APP_TSX).not.toMatch(/text-text-muted\/60"[^"]*>\s*\{agent\.role\}/)
  })
})
