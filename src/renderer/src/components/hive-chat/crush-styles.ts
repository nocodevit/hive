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
  Read: CRUSH.Bok,
  View: CRUSH.Bok,
  Edit: CRUSH.Julep,
  Write: CRUSH.Julep,
  MultiEdit: CRUSH.Julep,
  Bash: CRUSH.Malibu,
  BashOutput: CRUSH.Malibu,
  Grep: CRUSH.Zest,
  Glob: CRUSH.Zest,
  Task: CRUSH.Dolly,
  Agent: CRUSH.Dolly,
  TodoWrite: CRUSH.Charple,
  WebFetch: CRUSH.Violet,
  WebSearch: CRUSH.Violet,
  Skill: CRUSH.Mochi
}

export const FONT_MONO = '"JetBrains Mono", "Noto Mono for Powerline", Menlo, Monaco, monospace'
export const FONT_UI = '"Space Grotesk", sans-serif'
