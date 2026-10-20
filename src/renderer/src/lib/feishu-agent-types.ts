// Shapes of the feishuAgent / calendar IPC (mirror of src/preload/feishuAgentTypes.ts).

export type FeishuAgentSettings = {
  enabled: boolean
  scope: 'everyone' | 'picked'
  picked: string[]
  waitBeforeReplyMs: number
  remindAfterMs: number
  prefix: string
  extraAskFirst: string[]
  pollMs: number
  maxRepliesPerChatPerHour: number
  quietHours: { start: string; end: string } | null
}

export type FeishuAgentView = {
  settings: FeishuAgentSettings
  prefix: string
  defaultPrefix: string
  holding: string
  connected: boolean
  locked: string[]
  senders: Record<string, string>
  lastError: string
  capabilities: { realtime: boolean }
}

export type FeishuLogEntry = {
  id: string; time: number; chatId: string; chatName: string; inReplyTo: string
  text: string; kind: 'answer' | 'holding' | 'followup'; recalled?: boolean
}

export type CalendarSettings = { feishu: boolean; mac: boolean }

export type AgendaEvent = { title: string; start: number; end: number; allDay: boolean; source: 'feishu' | 'mac'; location?: string }

export type DayAgenda = { date: string; events: AgendaEvent[]; errors: { feishu?: string; mac?: string } }
