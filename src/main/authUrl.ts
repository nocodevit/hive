/**
 * Pure helper for the `auth:login` flow's "open the sign-in URL in the browser"
 * step. Kept electron-free so it can be unit-tested.
 *
 * The bug this fixes: `claude auth login` prints its claude.ai sign-in URL on
 * BOTH stdout and stderr (and sometimes across multiple data chunks). The
 * main-process handler runs the same broadcast for each stream, so calling
 * shell.openExternal on every URL match opened the browser TWICE for one login.
 *
 * Dedupe by exact URL: return a URL only if it hasn't been opened yet. The
 * caller records the returned URL in `alreadyOpened` so the next matching chunk
 * is a no-op.
 */
export function authUrlToOpen(
  text: string,
  alreadyOpened: ReadonlySet<string>
): string | null {
  if (!text) return null
  const m = text.match(/https:\/\/[^\s)>'"]+/)
  if (!m) return null
  const url = m[0]
  return alreadyOpened.has(url) ? null : url
}
