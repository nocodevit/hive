// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { AssistantMessage, UserMessage } from '../renderers'

afterEach(() => cleanup())

const GOAL = 'work through the plan you presented via ExitPlanMode above, item by item. Only consider done when every item is both implemented AND verified. While doing so, follow these standing rules: 1. Start every MR by invoking Skill(dev-workflow). 2. Test via the remote gate. 3. Keep code quality high.'

describe('GoalCard (via AssistantMessage)', () => {
  it('lays out "Goal set" as a labelled card, folded when it carries rules', () => {
    render(<AssistantMessage text={`Goal set: ${GOAL}`} />)
    const card = screen.getByRole('region', { name: 'Goal' })
    expect(card.textContent).toContain('Goal set')
    expect(card.textContent).toContain('3 rules')
    expect(card.textContent).toContain('work through the plan')
    // Folded: the rules are not listed yet.
    expect(screen.queryByText('Test via the remote gate.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show full goal' }))
    expect(screen.getByRole('list').querySelectorAll('li')).toHaveLength(3)
    expect(screen.getByText('Test via the remote gate.')).toBeTruthy()
    // The prose is not repeated as a raw paragraph with "1." / "2." inline.
    expect(card.textContent).not.toContain('1. Start')
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }))
    expect(screen.queryByText('Test via the remote gate.')).toBeNull()
  })

  it('shows a short goal whole, without a toggle', () => {
    render(<AssistantMessage text="Goal set: finish the migration" />)
    expect(screen.getByRole('region', { name: 'Goal' }).textContent).toContain('finish the migration')
    expect(screen.queryByRole('button', { name: 'Show full goal' })).toBeNull()
  })

  it('renders cleared / no goal as a quiet status line, not a card', () => {
    render(<AssistantMessage text="Goal cleared: finish the migration" />)
    expect(screen.getByRole('status').textContent).toContain('Goal cleared')
    expect(screen.getByRole('status').textContent).toContain('finish the migration')
    expect(screen.queryByRole('region', { name: 'Goal' })).toBeNull()
    cleanup()
    render(<AssistantMessage text="No goal set" />)
    expect(screen.getByRole('status').textContent).toContain('No goal set')
  })

  it('leaves ordinary replies to the normal renderer', () => {
    render(<AssistantMessage text="Here is the plan for the goal." />)
    expect(screen.queryByRole('region', { name: 'Goal' })).toBeNull()
    expect(screen.getByText('Here is the plan for the goal.')).toBeTruthy()
  })
})

describe('/goal as the user turn', () => {
  it('a typed /goal is a one-line command pill with the full text on hover', () => {
    const { container } = render(<UserMessage text={`/goal ${GOAL}`} />)
    const pill = container.firstElementChild as HTMLElement
    expect(pill.textContent?.startsWith('/goal')).toBe(true)
    expect(pill.getAttribute('title')).toBe(`/goal ${GOAL}`)
    const args = pill.lastElementChild as HTMLElement
    expect(args.style.whiteSpace).toBe('nowrap')
    expect(args.style.textOverflow).toBe('ellipsis')
  })
  it('a replayed /goal (command tags) renders the same way', () => {
    const { container } = render(<UserMessage text={'<command-name>/goal</command-name><command-message>goal</command-message><command-args>ship it</command-args>'} />)
    expect(container.textContent).toBe('/goalship it')
  })
  it('ordinary text that mentions /goal stays a bubble', () => {
    const { container } = render(<UserMessage text="please run /goal clear" />)
    expect(container.textContent).toContain('please run /goal clear')
    expect((container.firstElementChild as HTMLElement).getAttribute('title')).toBeNull()
  })
})
