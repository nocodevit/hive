# Feishu 代管 + calendar (Butler)

Code: `src/main/feishuAgent.ts`, `src/main/calendar.ts`, wiring
`src/main/butlerFeishuAgentIpc.ts`. UI: App Settings → Feishu 代管 /
Calendar (`components/butler/FeishuAgent.tsx`, `CalendarSettings.tsx`);
wizard steps Feishu (switch + Everyone / People I pick) and Calendar.

## Answer-for-me
- **Polling**, every `pollMs` (60 s) while on: `GET im/v1/chats`, then per
  chat `GET im/v1/messages … start_time=<cursor s> sort_type=ByCreateTimeAsc`.
  User-identity real-time push is not available (UI: "to verify").
- **Exactly once**: per-chat cursor (create_time + id) and a set of seen
  ids in `<butler>/feishu-agent-state.json`. Turning it on starts from now.
  A job leaves the queue before anything is sent.
- **Who**: messages from other users; p2p always, groups only when the
  owner is @mentioned; scope Everyone or picked open_ids.
- **Wait** `waitBeforeReplyMs` (2 min). If the owner wrote in that chat
  meanwhile (not counting Butler's own sent messages), skip.
- **Decide**: `claude -p` in the Butler folder, naming the `answer-feishu`
  skill, with profile.md, agents' status + last line, last 20 messages.
  Strict JSON `{decision, reply, reason}`; bad JSON / failure → escalate.
- **Locked** (code-level keywords on question and reply): prices,
  approvals, private chats (what the owner talks about with others),
  personal / sensitive / confidential info + "Always asks you". The prompt
  also forbids revealing anything from other chats. Escalate = holding
  reply "我需要和 <name> 确认，稍后回复你" + approval `feishu.followup`
  (draft = suggested answer); Approve sends the draft as a reply to the
  original message. Notification if still pending after `remindAfterMs`.
- **Prefix** always enforced in code (settings, else profile prefix, else
  `【<name> 的 AI 代理】`).
- **Limits**: `maxRepliesPerChatPerHour` (10); optional quiet hours hold
  replies until they end.
- **Log**: `<butler>/feishu-log.jsonl`; Recall (`DELETE im/v1/messages/<id>`)
  within 24 h.
- **Status "🤖 AI 代理中"**: no Feishu API sets a user's own status with a
  user token (personal_settings system statuses are tenant/admin). No-op.

## Calendar
`getDayAgenda(date)` (index.ts `butlerCalendar`) merges the Feishu primary
calendar (`calendar/v4`) and Mac Calendar, dropping identical title+start.
Mac: `scripts/hive-calendar` (EventKit; `--request`, `--date YYYY-MM-DD`,
JSON lines). Build: `swiftc -O scripts/hive-calendar.swift -o scripts/hive-calendar`.
Packaged as extraResources; Info.plist calendar usage strings and the
`personal-information.calendars` entitlement are in package.json /
entitlements.mac.plist.
