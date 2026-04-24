/**
 * Shared path formatting for display across the UI. Used by HiveChat's
 * session welcome line and FilesPanel's footer so both agree on how
 * long paths get truncated.
 *
 * `shortenPath` replaces the home prefix with `~` and, when the path
 * still has more than ~5 segments, keeps the first dir + the last two
 * with an ellipsis in the middle.
 */
export function shortenPath(p?: string, homeGuess?: string): string {
  if (!p) return ''
  const home = homeGuess || (p.match(/^\/Users\/[^/]+/)?.[0]) || ''
  let s = home && p.startsWith(home) ? '~' + p.slice(home.length) : p
  const parts = s.split('/').filter(Boolean)
  if (parts.length > 5) {
    const head = s.startsWith('~') ? '~' : ''
    return [head, parts[1], '…', parts[parts.length - 2], parts[parts.length - 1]]
      .filter(Boolean).join('/')
  }
  return s
}
