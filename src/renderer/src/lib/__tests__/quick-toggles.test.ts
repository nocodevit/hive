import { describe, it, expect } from 'vitest'
import { feishuToggle, mobileToggle, wakeToggle } from '../quick-toggles'

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
    expect(feishuToggle({ settings: { enabled: false }, connected: false })).toMatchObject({ checked: false, disabled: true, title: 'Sign in to Feishu first' })
  })
  it('signed out but on: can still be turned off', () => {
    expect(feishuToggle({ settings: { enabled: true }, connected: false })).toMatchObject({ checked: true, disabled: false, title: 'Feishu answer-for-me · On · Feishu not signed in', alert: 'error' })
  })
  it('signed in: flips', () => {
    expect(feishuToggle({ settings: { enabled: false }, connected: true })).toMatchObject({ checked: false, disabled: false, title: 'Feishu answer-for-me · Off' })
  })
  it('loading: disabled', () => {
    expect(feishuToggle(null).disabled).toBe(true)
  })
})

describe('wakeToggle', () => {
  it('shows listening state and errors in the hint', () => {
    expect(wakeToggle(null)).toMatchObject({ checked: false, disabled: true })
    expect(wakeToggle({ enabled: false, status: 'off' })).toMatchObject({ checked: false, disabled: false, title: 'Listen for “Hola Butler” · Off' })
    expect(wakeToggle({ enabled: true, status: 'listening' }).title).toBe('Listen for “Hola Butler” · Listening')
    expect(wakeToggle({ enabled: true, status: 'error', error: 'mic denied' }).title).toBe('Listen for “Hola Butler” · Not running (mic denied)')
  })
})

describe('switch alerts', () => {
  it('on but not working is an error, waiting for the owner is a warning; off is quiet', () => {
    expect(mobileToggle({ enabled: true, status: 'error', error: 'remote-control exited\nYou must be logged in' }, { welcome: 'done' })).toMatchObject({ alert: 'error', title: 'Mobile Butler · Not running (You must be logged in)' })
    expect(mobileToggle({ enabled: true, status: 'needs_trust' }, {}).alert).toBe('warn')
    expect(mobileToggle({ enabled: true, status: 'connected' }, {}).alert).toBeNull()
    expect(mobileToggle({ enabled: false, status: 'error' }, { welcome: 'done' }).alert).toBeNull()
    expect(feishuToggle({ settings: { enabled: true }, connected: false })).toMatchObject({ alert: 'error', title: 'Feishu answer-for-me · On · Feishu not signed in' })
    expect(wakeToggle({ enabled: true, status: 'error', error: 'mic' }).alert).toBe('error')
  })
})
