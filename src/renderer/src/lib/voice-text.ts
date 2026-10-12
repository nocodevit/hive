/**
 * Append a dictated chunk to what is already in the input. A space only
 * where two Latin words would otherwise run together — never between
 * Chinese characters, and not after punctuation.
 */
export function joinVoiceText(prev: string, next: string): string {
  if (!prev) return next
  const needsSpace = /[A-Za-z0-9]$/.test(prev) && /^[A-Za-z0-9]/.test(next)
  return prev + (needsSpace ? ' ' : '') + next
}
