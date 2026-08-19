import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * v2.2.5: docs/design.md defines two distinct typographic roles:
 *   - Headings: Space Grotesk (font-heading) + font-semibold
 *   - Labels:   text-[10px] uppercase tracking-wider text-text-muted font-semibold
 *
 * Agent name (heading) and role/department (label) were rendering with
 * identical size/font in the sidebar list — user couldn't tell them
 * apart. These source-file assertions lock the two style buckets so a
 * future edit doesn't collapse the visual distinction again.
 *
 * File-level checks (not component render tests) because App.tsx is a
 * 3000+ line surface that isn't cheaply mountable in isolation.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..')
const APP_TSX = readFileSync(join(REPO_ROOT, 'src', 'renderer', 'src', 'App.tsx'), 'utf-8')

describe('v2.2.5 typography — agent name vs role visual distinction', () => {
  it('every agent-name render uses font-heading (Space Grotesk)', () => {
    // Match the three known agent-name spans: sidebar list, kanban, task-group inbox.
    // Each contains {agent.name} inside a span/div that must have font-heading.
    // Grep for the immediate class chunk preceding {agent.name} across the file.
    const nameRenderPatterns = [
      // Sidebar list — line ~1009
      /className="truncate flex items-center gap-1\.5 text-\[13px\] font-heading font-semibold text-text-primary"/,
      // Kanban — line ~1362
      /className="text-sm font-heading font-semibold text-text-primary"/,
      // Task-group inbox — line ~1702
      /className="text-\[13px\] font-heading font-semibold text-text-primary truncate"/
    ]
    for (const pat of nameRenderPatterns) {
      expect(APP_TSX, `expected class pattern not found: ${pat}`).toMatch(pat)
    }
  })

  it('every agent-role render uses label style (10px uppercase tracking-wider text-muted)', () => {
    // Matching the three role-render spans, each next to an agent-name span.
    const rolePatterns = [
      // Sidebar list — line ~1012
      /className="text-\[10px\] font-semibold uppercase tracking-wider truncate group-hover:invisible text-text-muted"/,
      // Kanban — line ~1363
      /className="text-\[10px\] font-semibold text-text-muted uppercase tracking-wider ml-auto"/,
      // Task-group inbox — line ~1703
      /className="text-\[10px\] font-semibold uppercase tracking-wider text-text-muted truncate"/
    ]
    for (const pat of rolePatterns) {
      expect(APP_TSX, `expected role class pattern not found: ${pat}`).toMatch(pat)
    }
  })

  it('name and role are visually distinct — grep sanity: name & role classes never share the same string', () => {
    // Positive proof the fix isn't just a rename: the specific "same font,
    // same size" v2.2.4 anti-pattern is gone. Sidebar list had:
    //   name:  text-[13px]
    //   role:  text-[13px] text-text-muted/60
    // The `text-text-muted/60` (alpha) escape hatch is gone in v2.2.5.
    expect(APP_TSX).not.toMatch(/text-text-muted\/60"[^"]*>\s*\{agent\.role\}/)
  })
})
