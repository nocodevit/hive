// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ApprovalsList, cardDiscussText, type ApprovalCard } from '../ApprovalsList'

const answered: ApprovalCard = {
  id: 'c1', kind: 'feishu.answered', title: 'Lin · 已回复', subtitle: 'Feishu · answered for you', draft: '', action: 'OK',
  payload: { senderName: 'Lin', chatName: 'Lin', question: 'build 状态?', sent: 'Missy 在修 iOS 失焦', sentId: 'om_9' }, createdAt: Date.now()
}

describe('已回复 card (Butler answered on its own)', () => {
  it('shows what they asked and what went out, says 已回复, asks no call; OK files it', async () => {
    const approve = vi.fn().mockResolvedValue({ ok: true })
    ;(window as any).api = { ...(window as any).api, approvals: { ...(window as any).api?.approvals, approve } }
    render(<ApprovalsList items={[answered]} />)
    expect(screen.getByText('build 状态?')).toBeInTheDocument()
    const sent = screen.getByLabelText('Already sent')
    expect(sent).toHaveTextContent('已回复 ✓')
    expect(sent).toHaveTextContent('Missy 在修 iOS 失焦')
    expect(screen.queryByLabelText('Your call')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'OK Lin · 已回复' }))
    await waitFor(() => expect(approve).toHaveBeenCalledWith('c1', undefined))
  })
  it('Discuss tells Butler it was already answered: check it, add on the card, or edit / recall what went out', () => {
    const t = cardDiscussText(answered)
    expect(t).toMatch(/^Butler already answered this for me/)
    expect(t).toContain('./hive feishu edit om_9')
    expect(t).toContain('./hive feishu recall om_9')
    expect(t).toContain('--- already sent to them ---\nMissy 在修 iOS 失焦')
    expect(cardDiscussText({ ...answered, kind: 'feishu.followup' })).toMatch(/^Help me think this through/)
  })

  it('with a follow-up on it, the button says Reply and sends it', async () => {
    const approve = vi.fn().mockResolvedValue({ ok: true })
    ;(window as any).api = { ...(window as any).api, approvals: { ...(window as any).api?.approvals, approve } }
    render(<ApprovalsList items={[{ ...answered, id: 'c2', draft: '补充：周五前给 TestFlight' }]} onDiscuss={() => {}} />)
    expect(screen.getAllByRole('button', { name: /Discuss/ }).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Reply Lin · 已回复' }))
    await waitFor(() => expect(approve).toHaveBeenCalledWith('c2', undefined))
  })
})
