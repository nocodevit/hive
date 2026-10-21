// Shapes of the feishuAgent / calendar IPC (mirror of src/preload/feishuAgentTypes.ts).

/** Owner-added topic: keywords gate in code, the description guides the model. */
export type AskTopic = { name: string; words: string[]; hint: string }
/** Built-in topic, with a one-line example of a question it holds back. */
export type LockedTopic = { id: string; label: string; hint: string; example: string }

export type FeishuAgentSettings = {
  enabled: boolean
  scope: 'everyone' | 'picked'
  picked: string[]
  waitBeforeReplyMs: number
  remindAfterMs: number
  prefix: string
  askFirstTopics: AskTopic[]
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
  locked: LockedTopic[]
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
