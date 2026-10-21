// App Settings left nav: the section labels (each section's aria-label is
// "<label> section") and "open Settings at this section" from anywhere.
// Settings may not be mounted yet, so the request waits until it is.

export const SETTINGS_SECTIONS = [
  'Remote Control', 'Feishu', 'About me', 'Skills', 'Email', 'Daily routine', 'Jira', 'Answer for me', 'Calendar',
  'Wake word', 'Notifications', 'Style', 'Palette', 'General', 'Storage', 'Git tokens', 'Voice', 'Agent defaults', 'Templates'
] as const

export type SettingsSectionLabel = (typeof SETTINGS_SECTIONS)[number]

export const sectionAria = (label: string) => `${label} section`

export const OPEN_SECTION_EVENT = 'hive:settings-section'
let pending: string | undefined
export function openSettingsSection(label: SettingsSectionLabel): void {
  pending = label
  window.dispatchEvent(new CustomEvent(OPEN_SECTION_EVENT, { detail: label }))
}
export function takePendingSection(): string | undefined {
  const l = pending
  pending = undefined
  return l
}

/**
 * The highlighted section: the one the owner just clicked while it is still
 * on screen, else the first section (in page order) inside the top band.
 */
export function activeSection(order: string[], inBand: Set<string>, onScreen: Set<string>, clicked: string | null): string | null {
  if (clicked && onScreen.has(clicked)) return clicked
  for (const l of order) if (inBand.has(l)) return l
  for (const l of order) if (onScreen.has(l)) return l
  return null
}
