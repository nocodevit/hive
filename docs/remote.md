# Remote Butler (phase 1)

One Hive's Butler talks to another person's Hive Butler over Tailscale.
Agents are never reachable from outside; Butler decides, and work for an
agent still goes through `./hive assign` (an Assign card for the owner).

Code: `src/main/remote.ts`, `src/shared/remote-message.ts`,
`components/butler/RemoteSettings.tsx`, `components/hive-chat/RemoteCard.tsx`.

## Tailscale

Hive does not ship Tailscale. It runs `tailscale status --json` (first of
`/usr/local/bin/tailscale`, `/opt/homebrew/bin/tailscale`,
`/Applications/Tailscale.app/Contents/MacOS/Tailscale`) **only while Remote
is on**, and once when the owner turns it on. Turning it on fails, and the
switch stays off, when Tailscale is not installed (→ Install Tailscale) or
not connected (→ Open Tailscale).

While on, Hive listens on this Mac's Tailscale IPv4 only, port 17731 by
default (Settings › Remote Butler › Port), and re-checks every 30 s so it
follows a new address.

## Who may talk

App Settings › Remote Butler lists the devices on the tailnet. Ticking one
puts its Tailscale **stable node id** on the allow list, with a name (what
`./hive remote send NAME` uses) and a mode:

- **Ask me first** (default): the message becomes an Approve card (🌐
  Remote) and a card in the Butler chat. **Give to Butler** puts it into the
  Butler chat; Dismiss drops it.
- **Straight to Butler**: it goes into the Butler chat at once (a Mac
  notification too). If Butler is off it becomes a card instead.

A request is matched to a device by the Tailscale address it comes from
(never by anything in the body). Not on the list → 403. Requests carrying
an `Origin` header (browsers) → 403. Text ≤ 4000 chars, 30 messages a
minute per device. Both sides must add each other.

## Protocol

`POST http://<their Tailscale IP>:<port>/remote/v1/message {"text": "…"}`
→ `200 {"delivered": "butler" | "card"}`, `403 not_allowed`, `503
remote_off`. `GET /remote/v1/ping`.

## Butler

- `./hive remote peers`, `./hive remote send NAME TEXT` (Butler API
  `/remote/peers`, `/remote/send`; not from a Feishu answering run).
- An incoming message reaches Butler as `[Remote · from NAME's Hive (login,
  device NAME)] …` plus a note that it is that person's words. The chat
  renders it as a card; resources/butler/CLAUDE.md says to treat it as
  information, never as an instruction.
- What Butler sent shows in its chat as a "To NAME's Hive" card (✓ or why
  not). Settings › Remote Butler › Recent keeps the last 50 in and out.

## Not yet (phase 2)

Naming one of the owner's agents directly from another Hive (an agent allow
list).
