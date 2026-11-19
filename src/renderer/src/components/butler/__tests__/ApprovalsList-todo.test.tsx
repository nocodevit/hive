// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
afterEach(cleanup)
import { ApprovalsList, type ApprovalCard } from '../ApprovalsList'

const card: ApprovalCard = {
  id: 'a1', kind: 'feishu.followup', title: 'Lin · ask', subtitle: 'Feishu', draft: 'ok', action: 'Send',
  payload: { senderName: 'Lin', chatName: 'Lin', question: 'q?' }, createdAt: Date.now()
}
const api = (list: unknown[]) => {
  const subs: Array<() => void> = []
  const fromApproval = vi.fn().mockImplementation(async () => { list.push({ status: 'open', refs: { approvalId: 'a1' } }); subs.forEach(f => f()); return { id: 't1' } })
  ;(window as any).api = { ...(window as any).api, todos: { list: vi.fn(async () => [...list]), onChange: (f: () => void) => { subs.push(f); return () => {} }, fromApproval } }
  return fromApproval
}

describe('+ Todo on an Approve card', () => {
  it('stays "✓ In Todo" after the list remounts, because it reads the todo store', async () => {
    const fromApproval = api([])
    const first = render(<ApprovalsList items={[card]} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add Lin · ask to Todo' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Lin · ask to Todo' })).toHaveTextContent('✓ In Todo'))
    first.unmount()
    render(<ApprovalsList items={[card]} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Lin · ask to Todo' })).toBeDisabled())
    expect(fromApproval).toHaveBeenCalledTimes(1)
  })
  it('shows ＋ Todo again once that todo is done', async () => {
    api([{ status: 'done', refs: { approvalId: 'a1' } }])
    render(<ApprovalsList items={[card]} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Lin · ask to Todo' })).toHaveTextContent('＋ Todo'))
    expect(screen.getByRole('button', { name: 'Add Lin · ask to Todo' })).toBeEnabled()
  })
})
