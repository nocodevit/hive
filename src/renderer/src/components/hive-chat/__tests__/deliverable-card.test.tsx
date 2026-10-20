// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { AssistantMessage } from '../renderers'
import { parseDeliverable, DELIVERABLE_RULE } from '../../../../../shared/deliverable'

afterEach(() => cleanup())

describe('parseDeliverable', () => {
  it('splits an optional title line from the text', () => {
    expect(parseDeliverable('title: Email · to Lin\nHi Lin,\n\nThanks.\n')).toEqual({ title: 'Email · to Lin', body: 'Hi Lin,\n\nThanks.' })
  })
  it('no title → all of it is the text', () => {
    expect(parseDeliverable('Hi Lin')).toEqual({ title: '', body: 'Hi Lin' })
  })
  it('a "title:" later in the text is just text', () => {
    expect(parseDeliverable('Hi\ntitle: nope')).toEqual({ title: '', body: 'Hi\ntitle: nope' })
  })
})

describe('DeliverableCard in a reply', () => {
  const reply = 'Here is the email:\n\n```deliverable\ntitle: Email · to Lin\nHi Lin, UAT is back.\n\nThanks for flagging it.\n```\n\nWant a shorter one?'

  it('renders the text as a card, not a code block, with prose around it', () => {
    render(<AssistantMessage text={reply} />)
    const card = screen.getByRole('group', { name: 'Email · to Lin' })
    expect(card.textContent).toContain('Hi Lin, UAT is back.')
    expect(card.closest('pre')).toBeNull()
    expect(screen.getByText('Want a shorter one?')).toBeTruthy()
  })

  it('Copy puts exactly the text on the clipboard, without the title', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<AssistantMessage text={reply} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy Email · to Lin' }))
    expect(writeText).toHaveBeenCalledWith('Hi Lin, UAT is back.\n\nThanks for flagging it.')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy())
  })

  it('other code blocks are untouched', () => {
    render(<AssistantMessage text={'```ts\nconst a = 1\n```'} />)
    expect(screen.queryByRole('group')).toBeNull()
  })
})

describe('DELIVERABLE_RULE', () => {
  it('teaches the fence and the title line', () => {
    expect(DELIVERABLE_RULE).toContain('```deliverable')
    expect(DELIVERABLE_RULE).toContain('title:')
  })
})
