// @vitest-environment jsdom
//
// HiveChat compact-in-progress input gating — v1.7.118.
//
// While `claude --print` is being recycled by a /compact run, the
// pre-compact child is dead and any IPC to it (chat.send, Allow/Deny
// reply) is dropped on the floor. Pre-fix: user could click Allow on
// a stale permission modal or hit Enter to send, and the message
// silently vanished. Post-fix:
//   - Send/Enter routes the text into `pendingDraft` instead of
//     firing it at the dead child
//   - pendingPermission queue is cleared on compact start so the
//     stale Allow/Deny buttons go away
//   - When compact settles (✅ or ❌ stderr line arrives) the queued
//     draft is auto-sent into the freshly-respawned child
//   - User Cancel mid-stuck-compact wipes pendingDraft too (explicit
//     bail → don't surprise-send when they restart)
//
// We pin the contract on pure helpers that mirror the inline JSX
// logic from src/renderer/src/components/hive-chat/index.tsx, same
// approach as compact-stuck-banner.test.tsx — HiveChat itself has
// ~4000 lines of context providers / IPC bindings, not feasible to
// mount in a unit test.

import { describe, it, expect, vi } from 'vitest'

/**
 * Mirror of the inline send() handler's compact branch. If a
 * compact is mid-flight, the function MUST NOT call api.chat.send;
 * instead it stashes the text into pendingDraft and clears input.
 */
function makeSendHandler(deps: {
  compactInProgress: boolean
  sending: boolean
  setPendingDraft: (s: string) => void
  setInput: (s: string) => void
  chatSend: (text: string) => Promise<void>
}) {
  return async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || deps.sending) return
    if (deps.compactInProgress) {
      deps.setPendingDraft(trimmed)
      deps.setInput('')
      return
    }
    await deps.chatSend(trimmed)
  }
}

describe('send() during /compact', () => {
  it('stashes draft into pendingDraft and clears input — does NOT call chat.send', async () => {
    const setPendingDraft = vi.fn()
    const setInput = vi.fn()
    const chatSend = vi.fn(async () => {})
    const send = makeSendHandler({
      compactInProgress: true,
      sending: false,
      setPendingDraft, setInput, chatSend
    })
    await send('hello during compact')

    expect(setPendingDraft).toHaveBeenCalledWith('hello during compact')
    expect(setInput).toHaveBeenCalledWith('')
    expect(chatSend).not.toHaveBeenCalled()
  })

  it('sends normally when no compact is in progress', async () => {
    const setPendingDraft = vi.fn()
    const setInput = vi.fn()
    const chatSend = vi.fn(async () => {})
    const send = makeSendHandler({
      compactInProgress: false,
      sending: false,
      setPendingDraft, setInput, chatSend
    })
    await send('normal message')

    expect(chatSend).toHaveBeenCalledWith('normal message')
    expect(setPendingDraft).not.toHaveBeenCalled()
  })

  it('no-ops on empty input even during compact', async () => {
    const setPendingDraft = vi.fn()
    const setInput = vi.fn()
    const chatSend = vi.fn(async () => {})
    const send = makeSendHandler({
      compactInProgress: true,
      sending: false,
      setPendingDraft, setInput, chatSend
    })
    await send('   ')
    expect(setPendingDraft).not.toHaveBeenCalled()
    expect(setInput).not.toHaveBeenCalled()
    expect(chatSend).not.toHaveBeenCalled()
  })
})

/**
 * Mirror of the send() handler's result-handling tail (v1.7.137). After
 * a Resume, replaySessionHistory shows the conversation from the local
 * JSONL even when the live `claude --print --resume` child died, so the
 * UI looks "loaded" but `chat.send` returns {ok:false}. Pre-fix that
 * failure was swallowed and the user saw NOTHING after typing. Post-fix
 * we surface a system entry AND re-open the StartChooser so they can
 * relaunch.
 */
function makeSendWithResult(deps: {
  chatSend: (text: string) => Promise<{ ok: boolean; error?: string }>
  addEntry: (e: { kind: string; text: string }) => void
  setChooserMode: (v: boolean) => void
}) {
  return async (text: string) => {
    const res = await deps.chatSend(text)
    if (!res?.ok) {
      deps.addEntry({
        kind: 'system',
        text: `⚠️ Message not sent (${res?.error ?? 'unknown error'}). The session is no longer running — pick Resume or Start new below to relaunch.`
      })
      deps.setChooserMode(true)
    }
  }
}

describe('send() surfaces a failed send (no silent swallow)', () => {
  it('on {ok:false} adds a system entry with the error AND reopens the chooser', async () => {
    const addEntry = vi.fn()
    const setChooserMode = vi.fn()
    const chatSend = vi.fn(async () => ({ ok: false, error: 'not_in_print_mode' }))
    const send = makeSendWithResult({ chatSend, addEntry, setChooserMode })
    await send('hello after dead resume')

    expect(addEntry).toHaveBeenCalledTimes(1)
    const entry = addEntry.mock.calls[0][0]
    expect(entry.kind).toBe('system')
    expect(entry.text).toContain('not_in_print_mode')
    expect(entry.text).toContain('Message not sent')
    expect(setChooserMode).toHaveBeenCalledWith(true)
  })

  it('on no_session (no live child after resume) still surfaces + reopens chooser', async () => {
    const addEntry = vi.fn()
    const setChooserMode = vi.fn()
    const chatSend = vi.fn(async () => ({ ok: false, error: 'no_session' }))
    const send = makeSendWithResult({ chatSend, addEntry, setChooserMode })
    await send('still nothing happens')

    expect(addEntry.mock.calls[0][0].text).toContain('no_session')
    expect(setChooserMode).toHaveBeenCalledWith(true)
  })

  it('on {ok:true} does NOT add a system entry or reopen the chooser', async () => {
    const addEntry = vi.fn()
    const setChooserMode = vi.fn()
    const chatSend = vi.fn(async () => ({ ok: true }))
    const send = makeSendWithResult({ chatSend, addEntry, setChooserMode })
    await send('normal working send')

    expect(addEntry).not.toHaveBeenCalled()
    expect(setChooserMode).not.toHaveBeenCalled()
  })

  it('falls back to "unknown error" when the result has no error field', async () => {
    const addEntry = vi.fn()
    const setChooserMode = vi.fn()
    const chatSend = vi.fn(async () => ({ ok: false }))
    const send = makeSendWithResult({ chatSend, addEntry, setChooserMode })
    await send('failure without an error string')

    expect(addEntry.mock.calls[0][0].text).toContain('unknown error')
  })
})

/**
 * Mirror of the stderr→compact-state side effect. The renderer
 * watches stderr lines for known begin/end phrases and flips
 * `compactStartedAt` / clears pending queues. The contract MUST
 * stay aligned with main/chat.ts which emits these literal strings.
 */
function applyStderrLine(line: string, hooks: {
  setCompactStartedAt: (v: number | null) => void
  setCompactStuck: (v: null) => void
  setPendingPermissions: (v: any[]) => void
  setPendingQuestion: (v: null) => void
}) {
  const text = line.replace(/\s+$/, '')
  if (
    text.includes('Compacting context — pausing chat') ||
    text.includes('Compacting prior session before resume')
  ) {
    hooks.setCompactStartedAt(Date.now())
    hooks.setPendingPermissions([])
    hooks.setPendingQuestion(null)
  } else if (
    text.includes('/compact done') ||
    (text.includes('/compact ') && text.includes('context UNCHANGED'))
  ) {
    hooks.setCompactStartedAt(null)
    hooks.setCompactStuck(null)
  }
}

describe('stderr → compact lifecycle detection', () => {
  it('flips into "in progress" on compactSession start line + clears pending queues', () => {
    const setCompactStartedAt = vi.fn()
    const setCompactStuck = vi.fn()
    const setPendingPermissions = vi.fn()
    const setPendingQuestion = vi.fn()
    applyStderrLine('⏳ Compacting context — pausing chat', {
      setCompactStartedAt, setCompactStuck, setPendingPermissions, setPendingQuestion
    })
    expect(setCompactStartedAt).toHaveBeenCalledWith(expect.any(Number))
    expect(setPendingPermissions).toHaveBeenCalledWith([])
    expect(setPendingQuestion).toHaveBeenCalledWith(null)
  })

  it('flips into "in progress" on forceCompact-mode start line', () => {
    const setCompactStartedAt = vi.fn()
    const setCompactStuck = vi.fn()
    const setPendingPermissions = vi.fn()
    const setPendingQuestion = vi.fn()
    applyStderrLine('⏳ Compacting prior session before resume…', {
      setCompactStartedAt, setCompactStuck, setPendingPermissions, setPendingQuestion
    })
    expect(setCompactStartedAt).toHaveBeenCalledWith(expect.any(Number))
  })

  it('clears compact state on success settle line + drops stuck banner', () => {
    const setCompactStartedAt = vi.fn()
    const setCompactStuck = vi.fn()
    const setPendingPermissions = vi.fn()
    const setPendingQuestion = vi.fn()
    applyStderrLine('✅ /compact done in 47.3s · session resumed', {
      setCompactStartedAt, setCompactStuck, setPendingPermissions, setPendingQuestion
    })
    expect(setCompactStartedAt).toHaveBeenCalledWith(null)
    expect(setCompactStuck).toHaveBeenCalledWith(null)
  })

  it('clears compact state on failure settle line (context UNCHANGED)', () => {
    const setCompactStartedAt = vi.fn()
    const setCompactStuck = vi.fn()
    const setPendingPermissions = vi.fn()
    const setPendingQuestion = vi.fn()
    applyStderrLine('❌ /compact timeout (310.5s) — context UNCHANGED, session resumed', {
      setCompactStartedAt, setCompactStuck, setPendingPermissions, setPendingQuestion
    })
    expect(setCompactStartedAt).toHaveBeenCalledWith(null)
    expect(setCompactStuck).toHaveBeenCalledWith(null)
  })

  it('does NOT change state on progress heartbeat lines', () => {
    const setCompactStartedAt = vi.fn()
    const setCompactStuck = vi.fn()
    const setPendingPermissions = vi.fn()
    const setPendingQuestion = vi.fn()
    applyStderrLine('⏳ /compact still running · 180s elapsed', {
      setCompactStartedAt, setCompactStuck, setPendingPermissions, setPendingQuestion
    })
    expect(setCompactStartedAt).not.toHaveBeenCalled()
    expect(setCompactStuck).not.toHaveBeenCalled()
    expect(setPendingPermissions).not.toHaveBeenCalled()
  })
})

/**
 * Mirror of the auto-send useEffect. Fires when compact-in-progress
 * transitions true→false AND a draft is queued AND the chat hasn't
 * exited (no point auto-sending into a dead chat).
 */
function maybeAutoSend(deps: {
  compactInProgress: boolean
  pendingDraft: string | null
  exited: number | null
  setPendingDraft: (v: null) => void
  chatSend: (text: string) => Promise<void>
}) {
  if (!deps.compactInProgress && deps.pendingDraft !== null && deps.exited === null) {
    const draft = deps.pendingDraft
    deps.setPendingDraft(null)
    return deps.chatSend(draft)
  }
  return null
}

describe('auto-send after compact completes', () => {
  it('flushes queued draft once compact ends', async () => {
    const setPendingDraft = vi.fn()
    const chatSend = vi.fn(async () => {})
    const result = maybeAutoSend({
      compactInProgress: false,
      pendingDraft: 'queued message',
      exited: null,
      setPendingDraft,
      chatSend
    })
    expect(result).not.toBeNull()
    await result
    expect(setPendingDraft).toHaveBeenCalledWith(null)
    expect(chatSend).toHaveBeenCalledWith('queued message')
  })

  it('does NOT auto-send while compact is still in progress', async () => {
    const chatSend = vi.fn(async () => {})
    const result = maybeAutoSend({
      compactInProgress: true,
      pendingDraft: 'queued message',
      exited: null,
      setPendingDraft: vi.fn(),
      chatSend
    })
    expect(result).toBeNull()
    expect(chatSend).not.toHaveBeenCalled()
  })

  it('does NOT auto-send if no draft was queued', async () => {
    const chatSend = vi.fn(async () => {})
    const result = maybeAutoSend({
      compactInProgress: false,
      pendingDraft: null,
      exited: null,
      setPendingDraft: vi.fn(),
      chatSend
    })
    expect(result).toBeNull()
    expect(chatSend).not.toHaveBeenCalled()
  })

  it('does NOT auto-send if chat has exited (no point firing at dead child)', async () => {
    const chatSend = vi.fn(async () => {})
    const result = maybeAutoSend({
      compactInProgress: false,
      pendingDraft: 'queued',
      exited: 1,
      setPendingDraft: vi.fn(),
      chatSend
    })
    expect(result).toBeNull()
    expect(chatSend).not.toHaveBeenCalled()
  })
})

/**
 * Mirror of the Cancel button handler (with the v1.7.118 extension
 * that also clears pendingDraft so the user's bail isn't followed
 * by a surprise auto-send when the next session spawns).
 */
function makeCancelHandler(opts: {
  id: string
  setCompactStuck: (v: null) => void
  setCompactStartedAt: (v: null) => void
  setPendingPermissions: (v: any[]) => void
  setPendingQuestion: (v: null) => void
  setPendingDraft: (v: null) => void
  stopChat: (id: string) => Promise<{ ok: boolean }>
}) {
  return async () => {
    opts.setCompactStuck(null)
    opts.setCompactStartedAt(null)
    opts.setPendingPermissions([])
    opts.setPendingQuestion(null)
    opts.setPendingDraft(null)
    await opts.stopChat(opts.id).catch(() => {})
  }
}

describe('Cancel button clears pendingDraft (no auto-send on user bail)', () => {
  it('drops the queued draft so the next session start does NOT auto-fire it', async () => {
    const setPendingDraft = vi.fn()
    const stopChat = vi.fn(async () => ({ ok: true }))
    const cancel = makeCancelHandler({
      id: 'chat-bail',
      setCompactStuck: vi.fn(),
      setCompactStartedAt: vi.fn(),
      setPendingPermissions: vi.fn(),
      setPendingQuestion: vi.fn(),
      setPendingDraft,
      stopChat
    })
    await cancel()
    expect(setPendingDraft).toHaveBeenCalledWith(null)
  })
})
