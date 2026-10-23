// Header quick toggles next to the Butler button: 📱 Mobile Butler, 💬 Feishu answer-for-me, 🎙 wake word.

export type MobileState = { enabled: boolean; status: 'off' | 'starting' | 'needs_trust' | 'connected' | 'error'; error?: string }
/** Shown on the switch: on but not working (error) or waiting for the owner (warn). */
export type ToggleAlert = 'error' | 'warn' | null
export type FeishuToggleView = { settings: { enabled: boolean }; connected: boolean }

const MOBILE_STATUS: Record<MobileState['status'], string> = {
  off: 'Off', starting: 'Connecting…', needs_trust: 'Waiting for your OK', connected: 'Connected', error: 'Not running'
}

/** Off and the setup wizard never opened: the toggle opens the wizard instead. */
export function mobileToggle(state: MobileState | null, setupMarks: Record<string, unknown>) {
  const checked = !!state?.enabled
  const needsSetup = !checked && Object.keys(setupMarks).length === 0
  const action: 'wizard' | 'on' | 'off' = needsSetup ? 'wizard' : checked ? 'off' : 'on'
  const why = checked && state?.status === 'error' && state.error ? ` (${state.error.split('\n').pop()!.slice(0, 120)})` : ''
  const title = needsSetup ? 'Mobile Butler · Set up' : `Mobile Butler · ${checked && state ? MOBILE_STATUS[state.status] : 'Off'}${why}`
  const alert: ToggleAlert = !checked || !state ? null : state.status === 'error' ? 'error' : state.status === 'needs_trust' ? 'warn' : null
  return { checked, action, title, disabled: !state, alert }
}

/** Disabled until Feishu is signed in (turning off always works). */
export function feishuToggle(v: FeishuToggleView | null) {
  const checked = !!v?.settings.enabled
  const signedOut = !!v && !v.connected && !checked
  return {
    checked,
    disabled: !v || signedOut,
    alert: (checked && v && !v.connected ? 'error' : null) as ToggleAlert,
    title: signedOut ? 'Sign in to Feishu first' : `Feishu answer-for-me · ${checked ? (v && !v.connected ? 'On · Feishu not signed in' : 'On') : 'Off'}`
  }
}

export type WakeView = { enabled: boolean; status: 'off' | 'starting' | 'listening' | 'error'; error?: string }

const WAKE_STATUS: Record<WakeView['status'], string> = { off: 'Off', starting: 'Starting…', listening: 'Listening', error: 'Not running' }

export function wakeToggle(v: WakeView | null) {
  const checked = !!v?.enabled
  const status = checked && v ? WAKE_STATUS[v.status] + (v.status === 'error' && v.error ? ` (${v.error})` : '') : 'Off'
  return { checked, disabled: !v, title: `Listen for “Hola Butler” · ${status}`, alert: (checked && v?.status === 'error' ? 'error' : null) as ToggleAlert }
}
