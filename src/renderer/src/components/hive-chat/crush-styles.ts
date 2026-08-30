/**
 * Visual contract for HiveChat. All values ported from the approved
 * ui-preview-crush-elements.html. Full saturation; alpha only where the
 * original preview used alpha. Do not alter without user approval.
 */

export const CRUSH = {
  Pepper: '#201F26',
  BBQ: '#2D2C35',
  Charcoal: '#3A3943',
  Oyster: '#605F6B',
  Squid: '#858392',
  Ash: '#DFDBDD',
  Butter: '#FFFAF1',
  Sriracha: '#EB4268',
  Julep: '#00FFB2',
  Zest: '#E8FE96',
  Malibu: '#00A4FF',
  Dolly: '#FF60FF',
  Bok: '#68FFD6',
  Charple: '#6B50FF',
  Violet: '#C259FF',
  Mochi: '#EB5DFF',
  Blush: '#FF84FF',
  Guac: '#12C78F',
  Salmon: '#FF7F90',
  Cumin: '#BF976F'
} as const

export const TOOL_COLORS: Record<string, string> = {
  // File-touching tools → Julep green
  Read: CRUSH.Julep,
  View: CRUSH.Julep,
  Edit: CRUSH.Julep,
  Write: CRUSH.Julep,
  MultiEdit: CRUSH.Julep,
  Grep: CRUSH.Julep,
  Glob: CRUSH.Julep,
  // Shell → Malibu blue
  Bash: CRUSH.Malibu,
  BashOutput: CRUSH.Malibu,
  // Agents / orchestration → Dolly
  Task: CRUSH.Dolly,
  Agent: CRUSH.Dolly,
  // Local planning / bookkeeping → Charple
  TodoWrite: CRUSH.Charple,
  // Network → Violet
  WebFetch: CRUSH.Violet,
  WebSearch: CRUSH.Violet,
  // Skills → Mochi
  Skill: CRUSH.Mochi
}

export const FONT_MONO = '"JetBrains Mono", "Noto Mono for Powerline", Menlo, Monaco, monospace'
export const FONT_UI = '"Space Grotesk", sans-serif'

/** Screen-only PII redaction. Masks strings (configured at runtime from
 *  the OS username plus any other patterns) so they don't surface in
 *  rendered tool output, paths, or assistant text. Applied at display
 *  time only — underlying paths, stored logs, and clickable
 *  reveal-in-Finder calls still use the true values.
 *
 *  Toggle via Hive's streamingMode setting.
 */
interface RedactConfig {
  enabled: boolean
  patterns: { re: RegExp; mask: (match: string) => string }[]
}
const CONFIG: RedactConfig = { enabled: false, patterns: [] }

/** First char + '**' + last char. 'myname' → 'm**e', 'ada' → 'a**a'. */
function maskToken(s: string): string {
  if (s.length <= 1) return s
  if (s.length === 2) return s[0] + '*'
  return s[0] + '**' + s[s.length - 1]
}

const listeners = new Set<() => void>()
/** Subscribe to redact-config changes. Returns an unsubscribe fn. */
export function onRedactChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

export function configureRedact(opts: { enabled: boolean; tokens: string[] }) {
  CONFIG.enabled = opts.enabled
  CONFIG.patterns = opts.tokens
    .filter(t => t && t.length >= 2)
    .map(t => ({
      // Word-boundary-ish: don't mask "myname" inside "somemynamefoo" randomly,
      // but DO mask it anywhere in path segments. We match the literal string
      // case-insensitively — path segments surround it with / or other non-
      // alphanumeric chars so that's fine.
      re: new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
      mask: (_m: string) => maskToken(t)
    }))
  listeners.forEach(l => { try { l() } catch {} })
}

/** Common secret-looking env/assignment patterns. We keep the key
 *  visible but replace the value with "***<N chars hidden>***". Covers:
 *    API_KEY=foo               → API_KEY=***
 *    "apiKey": "foo"           → "apiKey": "***"
 *    Authorization: Bearer foo → Authorization: Bearer ***
 *    password: 'foo'           → password: ***
 */
const SECRET_KEY_PATTERN = /\b(?:api[_-]?key|secret(?:_key)?|access[_-]?key|private[_-]?key|token|auth(?:orization)?|password|passwd|pwd|bearer|session[_-]?key|client[_-]?secret|anthropic[_-]?api[_-]?key|openai[_-]?api[_-]?key|supabase[_-]?(?:service[_-]?role|anon)[_-]?key|aws[_-]?secret[_-]?access[_-]?key|stripe[_-]?(?:live|secret|test)[_-]?key|github[_-]?(?:token|pat))\b/i

function redactSecrets(s: string): string {
  return s
    // Bearer <token> / Basic <token>  —  handle first so the subsequent
    // key:value regex doesn't mangle "Authorization: Bearer xxx".
    .replace(/\b(Bearer|Basic)\s+([A-Za-z0-9._\-+/=]{6,})/g, (_full, scheme) => `${scheme} ***`)
    // KEY=value  or  KEY="value"  or  KEY='value'  (env / dotenv / shell)
    .replace(/(\b\w+\b)\s*=\s*(["']?)([^"'\s\n]+)\2/g, (full, k, quote, v) => {
      if (!SECRET_KEY_PATTERN.test(k)) return full
      return `${k}=${quote}${'*'.repeat(Math.min(v.length, 6))}${quote}`
    })
    // "KEY": "value"  (JSON)
    .replace(/(["']\s*\w+\s*["'])\s*:\s*(["'])([^"'\n]+)\2/g, (full, kStr, quote, v) => {
      const keyOnly = kStr.slice(1, -1).trim()
      if (!SECRET_KEY_PATTERN.test(keyOnly)) return full
      return `${kStr}: ${quote}${'*'.repeat(Math.min(v.length, 6))}${quote}`
    })
    // KEY: value  (YAML / Authorization: …)  — skip if value was already
    // masked by the Bearer pass above.
    .replace(/(\b\w+\b)\s*:\s*([^"'\s,}{[\]]+)/g, (full, k, v) => {
      if (!SECRET_KEY_PATTERN.test(k)) return full
      if (v === '***' || /^\*+$/.test(v)) return full
      // If the value is "Bearer" or "Basic", the real secret comes next
      // and has already been masked by the Bearer/Basic pass above. Leave
      // this line alone so "Authorization: Bearer ***" stays as-is.
      if (v === 'Bearer' || v === 'Basic') return full
      if (v.length < 6) return full
      return `${k}: ${'*'.repeat(Math.min(v.length, 6))}`
    })
}

export function redact(s: string): string {
  if (!s || !CONFIG.enabled) return s
  let result = s
  // 1. Secret-value masking — keyed by the variable name heuristic
  result = redactSecrets(result)
  // 2. Token replacement — OS username etc.
  for (const p of CONFIG.patterns) result = result.replace(p.re, p.mask)
  return result
}

export function isRedactEnabled(): boolean { return CONFIG.enabled }
