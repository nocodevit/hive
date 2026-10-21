import { describe, it, expect } from 'vitest'
import { feishuToggle, mobileToggle } from '../quick-toggles'

describe('mobileToggle', () => {
  it('opens the wizard when off and setup never started', () => {
    expect(mobileToggle({ enabled: false, status: 'off' }, {})).toMatchObject({ checked: false, action: 'wizard', title: 'Mobile Butler · Set up' })
  })
  it('turns on / off once setup was touched', () => {
    expect(mobileToggle({ enabled: false, status: 'off' }, { welcome: 'done' })).toMatchObject({ checked: false, action: 'on', title: 'Mobile Butler · Off' })
    expect(mobileToggle({ enabled: true, status: 'connected' }, {})).toMatchObject({ checked: true, action: 'off', title: 'Mobile Butler · Connected' })
    expect(mobileToggle({ enabled: true, status: 'starting' }, { phone: 'skipped' }).title).toBe('Mobile Butler · Connecting…')
  })
  it('is disabled until the state is known', () => {
    expect(mobileToggle(null, {})).toMatchObject({ checked: false, disabled: true })
  })
})

describe('feishuToggle', () => {
  it('signed out and off: disabled with the sign-in hint', () => {
    expect(feishuToggle({ settings: { enabled: false }, connected: false })).toEqual({ checked: false, disabled: true, title: 'Sign in to Feishu first' })
  })
  it('signed out but on: can still be turned off', () => {
    expect(feishuToggle({ settings: { enabled: true }, connected: false })).toEqual({ checked: true, disabled: false, title: 'Feishu answer-for-me · On' })
  })
  it('signed in: flips', () => {
    expect(feishuToggle({ settings: { enabled: false }, connected: true })).toEqual({ checked: false, disabled: false, title: 'Feishu answer-for-me · Off' })
  })
  it('loading: disabled', () => {
    expect(feishuToggle(null).disabled).toBe(true)
  })
})
