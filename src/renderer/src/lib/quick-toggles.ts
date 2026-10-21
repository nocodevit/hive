// Header quick toggles next to the Butler button: 📱 Mobile Butler, 💬 Feishu answer-for-me.

export type MobileState = { enabled: boolean; status: 'off' | 'starting' | 'needs_trust' | 'connected' | 'error' }
export type FeishuToggleView = { settings: { enabled: boolean }; connected: boolean }

const MOBILE_STATUS: Record<MobileState['status'], string> = {
  off: 'Off', starting: 'Connecting…', needs_trust: 'Waiting for your OK', connected: 'Connected', error: 'Not running'
}

/** Off and the setup wizard never opened: the toggle opens the wizard instead. */
export function mobileToggle(state: MobileState | null, setupMarks: Record<string, unknown>) {
  const checked = !!state?.enabled
  const needsSetup = !checked && Object.keys(setupMarks).length === 0
  const action: 'wizard' | 'on' | 'off' = needsSetup ? 'wizard' : checked ? 'off' : 'on'
  const title = needsSetup ? 'Mobile Butler · Set up' : `Mobile Butler · ${checked && state ? MOBILE_STATUS[state.status] : 'Off'}`
  return { checked, action, title, disabled: !state }
}

/** Disabled until Feishu is signed in (turning off always works). */
export function feishuToggle(v: FeishuToggleView | null) {
  const checked = !!v?.settings.enabled
  const signedOut = !!v && !v.connected && !checked
  return {
    checked,
    disabled: !v || signedOut,
    title: signedOut ? 'Sign in to Feishu first' : `Feishu answer-for-me · ${checked ? 'On' : 'Off'}`
  }
}
