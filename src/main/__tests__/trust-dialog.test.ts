import { describe, it, expect } from 'vitest'
import { isTrustDialogVisible, isSettingsWarningVisible, dialogDismissKeys } from '../chat-usage-query'

// The real trust dialog the /usage scrape hits (captured from claude TUI).
const TRUST = `Quick safety check: Is this a project you created or one you trust?
Claude Code'll be able to read, edit, and execute files here.
❯ No, exit
  Yes, I trust this folder
Enter to confirm · Esc to cancel`

const CONFIG_TRUST = `This folder pre-approves 16 tool permissions in .claude/settings.json:
Only proceed if you trust this configuration.
❯ No, exit
  Yes, I trust this folder
Enter to confirm · Esc to cancel`

const SETTINGS_WARNING = `Some settings could not be loaded.
❯ Continue
  Exit and fix manually
Enter to confirm`

const USAGE_GRID = `Current session (Fable)
12% used
Current week (Fable)
0% used`

describe('isTrustDialogVisible', () => {
  it('detects both the workspace and config trust dialogs', () => {
    expect(isTrustDialogVisible(TRUST)).toBe(true)
    expect(isTrustDialogVisible(CONFIG_TRUST)).toBe(true)
  })
  it('does NOT fire on the settings warning or the usage grid', () => {
    expect(isTrustDialogVisible(SETTINGS_WARNING)).toBe(false)
    expect(isTrustDialogVisible(USAGE_GRID)).toBe(false)
  })
})

describe('dialogDismissKeys', () => {
  it('answers the trust dialog with ↓ then Enter (select "Yes, I trust this folder")', () => {
    // The bug: bare Enter selected the highlighted "No, exit" and claude quit.
    expect(dialogDismissKeys(TRUST)).toBe('\x1b[B\r')
    expect(dialogDismissKeys(CONFIG_TRUST)).toBe('\x1b[B\r')
  })
  it('answers a plain settings warning with Enter', () => {
    // Guard: the settings warning ALSO says "Enter to confirm", but it is not a
    // trust dialog, so it takes bare Enter (trust check must run first).
    expect(dialogDismissKeys(SETTINGS_WARNING)).toBe('\r')
  })
  it('sends nothing when no blocking dialog is up', () => {
    expect(dialogDismissKeys(USAGE_GRID)).toBe('')
  })
})
