/**
 * Format a single `permission_suggestions[].rules[]` entry into the
 * string shape claude expects in `~/.claude/settings.json permissions.allow`.
 *
 * The two families claude accepts:
 *
 *   Bash/Read/Edit/Write/etc.   →  `Tool(pattern)`   e.g. `Bash(npm *)`
 *   mcp__<server>__<tool>       →  bare tool name    e.g. `mcp__stargate__jira_update_issue`
 *                                  (no parens; MCP tools don't accept arg
 *                                   patterns — the entire tool is allow/deny,
 *                                   or you allow the whole server with
 *                                   `mcp__<server>__*`).
 *
 * ## The bug this replaces
 *
 * The historical writer was `${toolName}(${ruleContent})` for all tools.
 * For MCP tools claude sends `permission_suggestions` with `ruleContent`
 * undefined (there's no pattern to generalize), so the writer emitted
 * literally `mcp__stargate__jira_update_issue(undefined)`. Two consequences:
 *
 *   1. Pre-claude-2.1.220: silently accepted but never matched anything,
 *      so the "Allow & remember" click had no persistent effect and the
 *      user got re-prompted on every new session.
 *   2. claude 2.1.220+: startup validation REJECTS the shape, printing
 *      a Settings Warning page listing every bad rule. On a machine
 *      that had accumulated 44 of them (real observed count on the
 *      reporter's laptop 2026-08), the warning page also broke the 5h/7d
 *      usage scrape (see queryUsagePctViaPty) — one bug feeding another.
 *
 * Kept as a pure exported helper so both the ipcMain writer and the
 * regression test import the same code — no risk of drift between the
 * production writer and the test's replica of it.
 */
export function patternForAllowRule(toolName: string, ruleContent: unknown): string {
  if (toolName.startsWith('mcp__')) return toolName
  return `${toolName}(${ruleContent})`
}
