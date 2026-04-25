/**
 * Event shapes as emitted by `claude --output-format stream-json`. Based on
 * Anthropic SDK message types; the real shapes will be validated once the
 * user supplies a captured /tmp/claude-json.log.
 */

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string | Array<{ type: string; text?: string }>
  is_error?: boolean
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock

export interface SystemEvent {
  type: 'system'
  subtype?: string
  session_id?: string
  [k: string]: unknown
}

export interface UserMessageEvent {
  type: 'user'
  message: {
    role: 'user'
    content: ContentBlock[] | string
  }
  session_id?: string
}

export interface AssistantMessageEvent {
  type: 'assistant'
  message: {
    role: 'assistant'
    content: ContentBlock[]
  }
  session_id?: string
}

export interface ResultEvent {
  type: 'result'
  subtype?: string
  is_error?: boolean
  duration_ms?: number
  num_turns?: number
  total_cost_usd?: number
  usage?: { input_tokens?: number; output_tokens?: number }
}

export type StreamEvent =
  | SystemEvent
  | UserMessageEvent
  | AssistantMessageEvent
  | ResultEvent
  | { type: string; [k: string]: unknown }

/** Internal model: flattened timeline entries that the UI renders. */
export type TimelineEntry =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'tool_call'; id: string; toolUseId: string; name: string; input: Record<string, unknown> }
  | { kind: 'tool_result'; id: string; toolUseId: string; content: string; isError?: boolean }
  | { kind: 'system'; id: string; text: string }
  | { kind: 'result'; id: string; costUSD?: number; durationMs?: number; numTurns?: number; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; stopReason?: string }
  | { kind: 'compact_boundary'; id: string; turnsSummarized: number; previousTokens: number; newTokens: number }
