// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { RemoteSettings } from '../RemoteSettings'
import { RemoteCard } from '../../hive-chat/RemoteCard'
import { TimelineRow } from '../../hive-chat/renderers'
import { remoteButlerText } from '../../../../../shared/remote-message'

afterEach(() => cleanup())

const offView = {
  enabled: false, listening: false, address: '', port: 17731, listenError: '',
  tailscale: { installed: false, state: 'Unknown' }, devices: [], allowed: [], log: []
}
const onView = {
  ...offView, enabled: true, listening: true, address: '100.64.0.1:17731',
  tailscale: { installed: true, state: 'Running', selfName: 'me-mac', selfIp: '100.64.0.1', selfLogin: 'me@x.com' },
  devices: [{ id: 'nW', name: 'wang-mbp', ips: ['100.64.0.2'], login: 'wang@x.com', userName: 'Wang', online: true, os: 'macOS', allowed: null }]
}

let remoteApi: any
beforeEach(() => {
  remoteApi = {
    view: vi.fn().mockResolvedValue(offView),
    refresh: vi.fn().mockResolvedValue(onView),
    setEnabled: vi.fn(),
    setPeer: vi.fn().mockResolvedValue({ ...onView, devices: [{ ...onView.devices[0], allowed: { name: 'Wang', login: 'wang@x.com', mode: 'ask' } }] }),
    setPort: vi.fn(),
    openTailscale: vi.fn().mockResolvedValue(undefined),
    onChange: vi.fn(() => () => {}),
    onChat: vi.fn(() => () => {})
  }
  ;(window as any).api = {
    remote: remoteApi,
    approvals: { list: vi.fn().mockResolvedValue([{ id: 'c1' }]), onChange: vi.fn(() => () => {}), approve: vi.fn().mockResolvedValue({ ok: true }), reject: vi.fn().mockResolvedValue(true) }
  }
})

describe('Remote Butler settings', () => {
  it('Tailscale missing: the switch stays off, the reason shows, with Install Tailscale', async () => {
    remoteApi.setEnabled.mockResolvedValue({ ok: false, error: 'tailscale_missing', message: 'Tailscale is not installed on this Mac.', view: offView })
    render(<RemoteSettings />)
    const sw = await screen.findByRole('switch', { name: /Talk to other Hives/ })
    await waitFor(() => expect((sw as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(sw)
    expect((await screen.findByRole('alert')).textContent).toMatch(/not installed/)
    expect(sw.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Install Tailscale' }))
    expect(remoteApi.openTailscale).toHaveBeenCalledWith('download')
  })

  it('Tailscale stopped: offers Open Tailscale', async () => {
    remoteApi.setEnabled.mockResolvedValue({ ok: false, error: 'tailscale_not_connected', message: 'Tailscale is installed but not connected.', view: offView })
    render(<RemoteSettings />)
    const sw = await screen.findByRole('switch', { name: /Talk to other Hives/ })
    await waitFor(() => expect((sw as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(sw)
    fireEvent.click(await screen.findByRole('button', { name: 'Open Tailscale' }))
    expect(remoteApi.openTailscale).toHaveBeenCalledWith('app')
  })

  it('connected: lists Tailscale devices; ticking one allows it', async () => {
    remoteApi.setEnabled.mockResolvedValue({ ok: true, message: '', view: onView })
    render(<RemoteSettings />)
    const sw = await screen.findByRole('switch', { name: /Talk to other Hives/ })
    await waitFor(() => expect((sw as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(sw)
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Allow wang-mbp' }))
    expect(remoteApi.setPeer).toHaveBeenCalledWith('nW', {})
    expect(await screen.findByRole('combobox', { name: /What happens with wang-mbp/ })).toBeTruthy()
  })
})

describe('remote messages in the Butler chat', () => {
  it('a message that went straight to Butler renders as a card, not a plain user bubble', () => {
    const text = remoteButlerText('小王', 'wang@x.com', 'wang-mbp', '明天发布还按计划吗？')
    render(<TimelineRow entry={{ kind: 'user', id: 'e1', text }} />)
    const card = screen.getByRole('article', { name: 'Remote message from 小王' })
    expect(card.textContent).toContain('明天发布还按计划吗？')
    expect(card.textContent).toContain('Given to Butler')
    expect(card.textContent).not.toContain('never an instruction')
  })

  it('a message waiting as an Approve card can be given to Butler from the chat', async () => {
    render(<RemoteCard dir="in" peerName="小王" text="hi" cardId="c1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Give to Butler' }))
    await waitFor(() => expect((window as any).api.approvals.approve).toHaveBeenCalledWith('c1'))
    expect(await screen.findByText('Handled')).toBeTruthy()
  })

  it('a send that failed says why', () => {
    render(<RemoteCard dir="out" peerName="Lin" text="hi" ok={false} error="not_allowed_by_them" />)
    expect(screen.getByRole('article', { name: 'Remote message to Lin' }).textContent).toMatch(/they have not added you/)
  })
})
