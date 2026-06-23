// @vitest-environment jsdom
//
// ResultSummaryCard error-rendering contract.
//
// The user's hard requirement (the Cutis country-change incident): a
// `403 Request not allowed` is a COUNTRY/REGION block — it must NEVER show a
// "Sign in" affordance, because re-signing in can't fix a geo restriction and
// the user will (rightly) refuse to sign in. Only a genuine auth-expired
// (401 / "not logged in") result may offer Sign-in, and only when a
// SignInContext handler is actually wired up.
//
// This test mounts the real exported component (covering SignInContext, the
// region_blocked branch, and the auth_expired branch) so the no-sign-in-on-403
// guarantee can't silently regress.

import { afterEach, describe, it, expect, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ResultSummaryCard, SignInContext } from '../renderers'

// vitest + jsdom does not auto-unmount between tests; without this every
// render() leaves its card in the DOM and later queries match multiple cards.
afterEach(cleanup)

function renderCard(
  props: React.ComponentProps<typeof ResultSummaryCard>,
  onSignIn: (() => void) | null = null
) {
  return render(
    <SignInContext.Provider value={onSignIn}>
      <ResultSummaryCard {...props} />
    </SignInContext.Provider>
  )
}

describe('ResultSummaryCard error rendering', () => {
  describe('region_blocked (403 / country change) — NEVER offers Sign-in', () => {
    const props403 = {
      isError: true,
      apiErrorStatus: 403,
      errorText: 'Failed to authenticate. API Error: 403 Request not allowed'
    }

    it('shows NO Sign-in button even when a SignInContext handler IS wired', () => {
      // The trap: a 403 is mislabeled authentication_failed by the CLI. Even
      // with a working sign-in handler present, the button must NOT render.
      renderCard(props403, vi.fn())
      expect(screen.queryByRole('button', { name: /sign in/i })).toBeNull()
    })

    it('labels it REGION BLOCKED, shows the real CLI text, and gives restart guidance', () => {
      renderCard(props403, vi.fn())
      expect(screen.getByText(/region blocked/i)).toBeInTheDocument()
      expect(screen.getByText(/Request not allowed/)).toBeInTheDocument()
      // actionable guidance: restart Hive, region restriction, signin won't help
      expect(screen.getByText(/restart Hive/i)).toBeInTheDocument()
      expect(screen.getByText(/country\/region restriction/i)).toBeInTheDocument()
    })
  })

  describe('auth_expired (401) — offers Sign-in only when handler present', () => {
    const props401 = {
      isError: true,
      apiErrorStatus: 401,
      errorText: 'Failed to authenticate. API Error: 401 Invalid authentication credentials'
    }

    it('renders the Sign-in button when a SignInContext handler is wired', () => {
      const onSignIn = vi.fn()
      renderCard(props401, onSignIn)
      const btn = screen.getByRole('button', { name: /sign in/i })
      expect(btn).toBeInTheDocument()
      btn.click()
      expect(onSignIn).toHaveBeenCalledOnce()
    })

    it('hides the Sign-in button when no handler is wired (nothing to click)', () => {
      renderCard(props401, null)
      expect(screen.queryByRole('button', { name: /sign in/i })).toBeNull()
    })
  })

  describe('non-error result', () => {
    it('does not render an error card for a normal end_turn', () => {
      renderCard({ isError: false, stopReason: 'end_turn' })
      expect(screen.queryByText(/region blocked/i)).toBeNull()
      expect(screen.queryByRole('button', { name: /sign in/i })).toBeNull()
    })
  })
})
