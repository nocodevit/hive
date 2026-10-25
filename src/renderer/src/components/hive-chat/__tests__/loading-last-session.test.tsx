// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { StartChooser } from '../index'

afterEach(cleanup)

describe('StartChooser', () => {
  it('shows "Loading last session…" with a spinner while it reads the past session', () => {
    render(<StartChooser cwd="/x" loaded={false} info={null} onPick={() => {}} />)
    expect(screen.getByRole('status', { name: 'Loading last session' }).textContent).toContain('Loading last session…')
  })
  it('the loader is gone once the session is known', () => {
    render(<StartChooser cwd="/x" loaded info={null} onPick={() => {}} />)
    expect(screen.queryByRole('status', { name: 'Loading last session' })).toBeNull()
  })
})
