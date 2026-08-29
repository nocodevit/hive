import React, { useContext, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Highlight, themes } from 'prism-react-renderer'
import { Check, Pencil } from 'lucide-react'
import { CRUSH, FONT_MONO, TOOL_COLORS, redact } from './crush-styles'
import { parseStructuredOutput } from './structured-format'
import type { TimelineEntry } from './types'

/**
 * Tells deep tickers (ThinkingSpinner, LongRunningTick, SubagentBanner)
 * whether the parent HiveChat is currently visible. When invisible
 * (user is on another agent's tab), tickers pause their setInterval
 * to avoid pegging the renderer at 100%+ CPU. With 7+ agents all
 * mounted but only 1 visible, leaving every ticker running summed to
 * dozens of setState/sec across hidden chats. Default true (paused)
 * so any consumer not wrapped in a provider stays cheap by default.
 */
export const HiveChatPausedContext = React.createContext<boolean>(true)

/**
 * Carries the live AskUserQuestion control_request callback into deeply
 * nested tool renderers (ToolHeader → AskUserQuestionInline). Without a
 * context the requestId + IPC reply would have to drill through ~5
 * stateless layers (TimelineList → TimelineRow → ToolBlock → ToolHeader).
 *
 * `requestId` matches the control_request that arrived from claude.
 * `submit(answers)` replies via chat.respondPermission with
 * `decision='allow'` + `updatedInput={questions, answers}` so claude's
 * SDK can resume the agent loop with the user's choices.
 */
export const AskUserQuestionContext = React.createContext<{
  requestId: string
  submit: (answers: Record<string, string | string[]>) => void
} | null>(null)

/**
 * Carries the "start interactive sign-in" callback (window.api.auth.login via
 * startAuthLogin) into the deeply-nested ResultSummaryCard so an auth-expiry
 * error can render an inline "Sign in →" button right under the failed turn.
 * null when no handler is wired (the button is then hidden).
 */
export const SignInContext = React.createContext<(() => void) | null>(null)

export type ResultErrorKind = 'auth_expired' | 'region_blocked' | 'generic'

/**
 * Classify a stream `result` event's error so the UI can react correctly.
 *
 * Background (the incident this fixes): when the Claude OAuth credential is
 * rejected, the CLI emits a result with `is_error:true`,
 * `api_error_status:401`, result text "Failed to authenticate. API Error:
 * 401 …" AND a junk `stop_reason:"stop_sequence"`. Hive used to read only
 * `stop_reason` and render a cryptic "stopped: stop_sequence", never telling
 * the user their session expired nor offering a way to re-auth.
 *
 *  - auth_expired   → credentials rejected (401 / "Not logged in" / "Failed
 *                     to authenticate"). Re-login FIXES it → offer Sign-in.
 *  - region_blocked → Claude unavailable in the caller's country/region.
 *                     Re-login does NOT help → show reason, NO sign-in button.
 *  - generic        → any other API error. Surface the REAL message instead
 *                     of the misleading stop_reason.
 *
 * Returns null when the result is not an error.
 *
 * NOTE: the region check runs FIRST on purpose — a geo block can also carry a
 * 401/403, and telling the user to "sign in again" there would be wrong.
 */
export function classifyResultError(e: {
  is_error?: boolean
  api_error_status?: number
  error?: string
  result?: string
}): { kind: ResultErrorKind; message: string } | null {
  if (!e || !e.is_error) return null
  const result = typeof e.result === 'string' ? e.result : ''
  const text = `${e.error ?? ''} ${result}`.toLowerCase()
  const status = e.api_error_status
  // Region / country / territory restriction — re-login will NOT help.
  //
  // Anthropic geo-blocks requests from unsupported countries with a
  // 403 "Request not allowed" — and the CLI mislabels that result as
  // `error:"authentication_failed"` (observed in the wild: a Cutis run where
  // the caller's country changed produced `is_error:true`,
  // `api_error_status:403`, `error:"authentication_failed"`,
  // result "Failed to authenticate. API Error: 403 Request not allowed",
  // `inference_geo:"not_available"`). Without catching it here it falls through
  // to the auth-expired branch below and wrongly pops the sign-in modal.
  if (/unsupported[\s_-]*(country|region|territory)|not\s+available\s+in\s+your|in\s+your\s+(country|region|territory)|(country|region|territory)\s+is\s+not/.test(text) ||
      /request\s+not\s+allowed/.test(text) ||
      status === 403) {
    return { kind: 'region_blocked', message: result || 'Claude is not available in your current country/region.' }
  }
  // Expired / invalid credentials — re-login fixes it.
  if (e.error === 'authentication_failed' || status === 401 ||
      /not\s+logged\s+in|invalid\s+authentication|failed\s+to\s+authenticate|unauthorized/.test(text)) {
    return { kind: 'auth_expired', message: result || 'Authentication failed — please sign in again.' }
  }
  return { kind: 'generic', message: result || (status ? `API error ${status}` : 'Request failed') }
}

export type AuthModalState = 'idle' | 'needed' | 'in-progress' | 'success' | 'failed'

/**
 * Decide what "dismiss / escape" should do for a given sign-in modal state.
 *
 * Invariant this enforces (the bug this fixes): EVERY non-idle state must be
 * escapable. Previously the 'in-progress' state rendered only descriptive text
 * with NO button, so if `claude auth login` hung (user closed the browser, or
 * a region/country block that re-login can't fix), the modal trapped the user
 * forever. Now both the Escape key and a Cancel button route through here.
 *
 *  - returns null when there's nothing to dismiss ('idle').
 *  - `killProcess` is true ONLY for 'in-progress', where a live
 *    `claude auth login` child must be SIGTERM'd (via auth:cancel) before we
 *    drop back to idle. Other states have no running child to kill.
 */
export function dismissActionForAuthState(
  state: AuthModalState
): { killProcess: boolean } | null {
  if (state === 'idle') return null
  return { killProcess: state === 'in-progress' }
}

const DEFAULT_EXPANDED_LINES = 12
const LONG_ASSISTANT_THRESHOLD = 30

/** Map common file extensions to Prism language IDs. Falls back to "markup". */
export function langFromPath(path?: string): string {
  if (!path) return 'markup'
  const m = path.match(/\.([a-zA-Z0-9]+)$/)
  if (!m) return 'markup'
  const ext = m[1].toLowerCase()
  const map: Record<string, string> = {
    ts: 'tsx', tsx: 'tsx', js: 'jsx', jsx: 'jsx', mjs: 'jsx', cjs: 'jsx',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
    java: 'java', kt: 'kotlin', swift: 'swift', scala: 'scala',
    c: 'c', cpp: 'cpp', cc: 'cpp', h: 'c', hpp: 'cpp',
    cs: 'csharp', php: 'php',
    sql: 'sql', sh: 'bash', bash: 'bash', zsh: 'bash',
    yaml: 'yaml', yml: 'yaml', json: 'json', toml: 'toml',
    html: 'markup', xml: 'markup', svg: 'markup', vue: 'markup',
    css: 'css', scss: 'scss', less: 'less',
    // .md / .markdown intentionally fall through to 'markup' below.
    // prism's markdown grammar emits multi-line tokens for tables
    // (e.g. `| a | b |\n| - | - |\n| 1 | 2 |` becomes one token whose
    // content has newlines), and prism-react-renderer's per-line
    // tokens[] split fragments those tokens — table rows get shredded
    // across the rendered <div>s. markup grammar is effectively
    // pass-through for text without HTML tags, so the source displays
    // line-for-line as written.
    dockerfile: 'docker'
  }
  return map[ext] || 'markup'
}

/** Crush-palette syntax theme for prism-react-renderer. */
const CRUSH_PRISM_THEME = {
  plain: { color: CRUSH.Ash, backgroundColor: 'transparent' },
  styles: [
    { types: ['comment', 'prolog', 'doctype', 'cdata'], style: { color: CRUSH.Oyster, fontStyle: 'italic' } },
    { types: ['punctuation'], style: { color: CRUSH.Zest } },
    { types: ['property', 'tag', 'boolean', 'number', 'constant', 'symbol', 'deleted'], style: { color: CRUSH.Blush } },
    { types: ['selector', 'attr-name', 'string', 'char', 'inserted'], style: { color: CRUSH.Cumin } },
    { types: ['operator', 'entity', 'url'], style: { color: CRUSH.Salmon } },
    { types: ['atrule', 'attr-value', 'keyword'], style: { color: CRUSH.Malibu } },
    { types: ['function', 'class-name'], style: { color: CRUSH.Guac } },
    { types: ['regex', 'important', 'variable'], style: { color: CRUSH.Zest } },
    { types: ['important', 'bold'], style: { fontWeight: 'bold' as const } },
    { types: ['italic'], style: { fontStyle: 'italic' as const } }
  ]
}

/** Crush-styled markdown renderer shared by user + assistant messages. */
const MD_COMPONENTS: Record<string, any> = {
  strong: ({ children }: any) => <strong style={{ color: CRUSH.Butter, fontWeight: 700 }}>{children}</strong>,
  em: ({ children }: any) => <em style={{ color: CRUSH.Ash, fontStyle: 'italic' }}>{children}</em>,
  code: ({ className, children }: any) => {
    const text = React.Children.toArray(children).map(String).join('')
    const isBlock = !!className || text.includes('\n')
    if (isBlock) {
      const lang = className?.match(/language-(\S+)/)?.[1] || 'markup'
      const code = text.replace(/\n$/, '')
      return <CodeBlockWithCopy code={code} language={lang} />
    }
    return <code style={{ color: CRUSH.Bok, background: CRUSH.BBQ, padding: '0 4px', borderRadius: 3, fontFamily: FONT_MONO, fontSize: 12 }}>{children}</code>
  },
  pre: ({ children }: any) => (
    <pre style={{
      background: CRUSH.BBQ,
      borderLeft: `3px solid ${CRUSH.Charple}`,
      borderRadius: 4,
      padding: '8px 12px',
      fontSize: 12,
      overflow: 'auto',
      color: CRUSH.Ash,
      margin: '4px 0',
      fontFamily: FONT_MONO
    }}>{children}</pre>
  ),
  ul: ({ children }: any) => <ul style={{ paddingLeft: 18, margin: '4px 0' }}>{children}</ul>,
  ol: ({ children }: any) => <ol style={{ paddingLeft: 18, margin: '4px 0' }}>{children}</ol>,
  li: ({ children }: any) => <li style={{ color: CRUSH.Ash, marginBottom: 2 }}>{children}</li>,
  p: ({ children }: any) => <p style={{ margin: '4px 0', color: CRUSH.Ash }}>{children}</p>,
  a: ({ href, children }: any) => <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: CRUSH.Malibu, textDecoration: 'underline' }}>{children}</a>,
  h1: ({ children }: any) => <h3 style={{ color: CRUSH.Butter, fontSize: 15, margin: '6px 0 4px' }}>{children}</h3>,
  h2: ({ children }: any) => <h4 style={{ color: CRUSH.Butter, fontSize: 14, margin: '6px 0 4px' }}>{children}</h4>,
  h3: ({ children }: any) => <h5 style={{ color: CRUSH.Butter, fontSize: 'var(--chat-fs, 13px)', margin: '6px 0 4px' }}>{children}</h5>,
  blockquote: ({ children }: any) => <blockquote style={{ borderLeft: `2px solid ${CRUSH.Charple}`, paddingLeft: 10, margin: '4px 0', color: CRUSH.Squid }}>{children}</blockquote>,
  hr: () => <hr style={{ border: 'none', borderTop: `1px solid ${CRUSH.Charcoal}`, margin: '6px 0' }} />,
  table: ({ children }: any) => (
    <div style={{ margin: '8px 0', overflowX: 'auto' }}>
      <table style={{
        borderCollapse: 'collapse',
        fontFamily: FONT_MONO, fontSize: 12,
        border: `1px solid ${CRUSH.Charcoal}`,
        borderRadius: 4,
        overflow: 'hidden'
      }}>{children}</table>
    </div>
  ),
  thead: ({ children }: any) => <thead style={{ background: CRUSH.BBQ }}>{children}</thead>,
  tbody: ({ children }: any) => <tbody>{children}</tbody>,
  tr: ({ children }: any) => <tr style={{ borderBottom: `1px solid ${CRUSH.Charcoal}` }}>{children}</tr>,
  th: ({ children }: any) => (
    <th style={{
      padding: '6px 12px',
      textAlign: 'left',
      color: CRUSH.Butter,
      fontWeight: 700,
      borderRight: `1px solid ${CRUSH.Charcoal}`,
      whiteSpace: 'nowrap'
    }}>{children}</th>
  ),
  td: ({ children }: any) => (
    <td style={{
      padding: '6px 12px',
      color: CRUSH.Ash,
      borderRight: `1px solid ${CRUSH.Charcoal}`,
      verticalAlign: 'top'
    }}>{children}</td>
  )
}

/**
 * Markdown code block with a hover-revealed Copy button. Uses prism-
 * react-renderer for syntax highlighting (same theme + tokens as the
 * inline code variant). Click → navigator.clipboard.writeText, brief
 * "copied!" badge swap, auto-revert after 1.5s.
 */
function CodeBlockWithCopy({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false)
  const onCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }
  return (
    <span style={{ position: 'relative' as const, display: 'block' }}>
      <button
        onClick={onCopy}
        title={copied ? 'Copied' : 'Copy code'}
        style={{
          position: 'absolute' as const,
          top: 4, right: 6, zIndex: 1,
          background: copied ? CRUSH.Julep : 'rgba(45,44,53,0.85)',
          border: `1px solid ${copied ? CRUSH.Julep : CRUSH.Charcoal}`,
          color: copied ? CRUSH.Pepper : CRUSH.Squid,
          padding: '1px 8px',
          borderRadius: 3,
          fontFamily: FONT_MONO, fontSize: 10,
          cursor: 'pointer',
          opacity: copied ? 1 : 0,
          transition: 'opacity 120ms ease, background 120ms ease, color 120ms ease',
          fontWeight: copied ? 700 : 400
        }}
        className="hive-code-copy"
      >{copied ? '✓ copied' : '📋 copy'}</button>
      <Highlight code={code} language={language as any} theme={CRUSH_PRISM_THEME as any}>
        {({ tokens, getLineProps, getTokenProps }) => (
          <code style={{ fontFamily: FONT_MONO, display: 'block' }}>
            {tokens.map((line, i) => {
              const { key: lineKey, ...lineRest } = getLineProps({ line })
              return (
                <div key={i} {...lineRest}>
                  {line.map((token, j) => {
                    const { key: tokenKey, ...tokenRest } = getTokenProps({ token })
                    return <span key={j} {...tokenRest} />
                  })}
                </div>
              )
            })}
          </code>
        )}
      </Highlight>
    </span>
  )
}

function CrushMarkdown({ text }: { text: string }) {
  return (
    <div className="hive-chat-md" style={{ fontFamily: FONT_MONO, fontSize: 'var(--chat-fs, 13px)', lineHeight: 1.55 }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>{redact(text)}</ReactMarkdown>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────
 *  USER MESSAGE — rgba(107,80,255,0.08) bg + Charple left border
 *  (per ui-preview-crush-elements.html .input-area, approved alpha)
 * ──────────────────────────────────────────────────────────── */
/** Strip Claude Code's XML-tagged slash-command markup out of user
 *  messages. A `/clear` invocation comes in as:
 *    <command-name>/clear</command-name>
 *    <command-message>clear</command-message>
 *    <command-args></command-args>
 *  Returns either a plain string (normal user text) OR a structured
 *  `{ command, args }` when the whole message is a slash-command.
 */
export function parseUserCommand(raw: string): { kind: 'command'; command: string; args: string } | { kind: 'text'; text: string } {
  const nameMatch = raw.match(/<command-name>([^<]*)<\/command-name>/)
  const argsMatch = raw.match(/<command-args>([^<]*)<\/command-args>/)
  if (nameMatch) {
    const command = nameMatch[1].trim().replace(/^\/+/, '')
    const args = (argsMatch?.[1] ?? '').trim()
    // If the only content is the tags, it's a pure slash-command invocation.
    const stripped = raw
      .replace(/<command-(?:name|message|args)>[^<]*<\/command-(?:name|message|args)>/g, '')
      .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, '')
      .trim()
    if (!stripped) return { kind: 'command', command, args }
  }
  return { kind: 'text', text: raw }
}

export function UserMessage({ text, onRecall, isSubagent }: { text: string; onRecall?: (text: string) => void; isSubagent?: boolean }) {
  const parsed = parseUserCommand(text)
  // Subagent prompts (parent agent → Task tool input) reuse the
  // user-bubble SHAPE but recolor everything to Charple — same shape
  // tells the eye "this is a directive", different color tells it
  // "this isn't from the human". Per user feedback v1.7.71:
  //   - Dolly  bg/border  → Charple bg/border
  //   - Julep  ❯ glyph    → Charple ❯ glyph
  //   - Butter text       → Ash text (slightly dimmer)
  if (isSubagent) {
    return (
      <div style={{
        background: 'rgba(107, 80, 255, 0.12)',
        border: `1px solid ${CRUSH.Charple}`,
        borderRadius: 8,
        padding: '7px 11px',
        margin: '6px 0',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontFamily: FONT_MONO
      }}>
        <span style={{ color: CRUSH.Charple, fontWeight: 700, fontSize: 16 }}>❯</span>
        <span style={{ color: CRUSH.Ash, fontWeight: 500, whiteSpace: 'pre-wrap', flex: 1 }}>
          {redact(parsed.kind === 'command' ? `/${parsed.command}${parsed.args ? ' ' + parsed.args : ''}` : parsed.text)}
        </span>
      </div>
    )
  }
  if (parsed.kind === 'command') {
    return (
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        background: CRUSH.Dolly,
        borderRadius: 999,
        padding: '3px 12px',
        margin: '6px 0',
        fontFamily: FONT_MONO,
        fontSize: 12,
        color: CRUSH.Butter
      }}>
        <span style={{ color: CRUSH.Butter, fontWeight: 700 }}>⚡</span>
        <span style={{ color: CRUSH.Butter, fontWeight: 700 }}>/{redact(parsed.command)}</span>
        {parsed.args && <span style={{ color: CRUSH.Butter, opacity: 0.85 }}>{redact(parsed.args)}</span>}
      </div>
    )
  }
  return (
    <div className="hive-user-msg" style={{
      background: 'rgba(255, 96, 255, 0.14)',
      border: `1px solid ${CRUSH.Dolly}`,
      borderRadius: 8,
      padding: '7px 11px',
      margin: '6px 0',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      fontFamily: FONT_MONO,
      position: 'relative' as const
    }}>
      {/* Julep ❯ per ui-preview-decorations.html — the design spec
          (line 131-139) specifies the prompt glyph is mint green
          regardless of the bubble's bg. Dolly was a regression. */}
      <span style={{ color: CRUSH.Julep, fontWeight: 700, fontSize: 16 }}>❯</span>
      <span style={{ color: CRUSH.Butter, fontWeight: 500, whiteSpace: 'pre-wrap', flex: 1 }}>{redact(parsed.text)}</span>
      {onRecall && (
        <button
          onClick={() => onRecall(parsed.text)}
          title="Recall to input box (edit & resend)"
          className="hive-recall-btn"
          style={{
            flexShrink: 0,
            background: 'transparent',
            border: 'none',
            color: CRUSH.Dolly,
            cursor: 'pointer',
            padding: '2px 6px',
            borderRadius: 4,
            fontSize: 12,
            opacity: 0,
            transition: 'opacity 120ms ease',
            fontFamily: FONT_MONO
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,96,255,0.2)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
        >↺</button>
      )}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────
 *  ASSISTANT MESSAGE — Ash text. If the message ends with a
 *  numbered list (`1. … 2. … 3. …`), the list is split out and
 *  rendered as clickable options below the body. Clicks pipe the
 *  chosen text back as the next user message.
 * ──────────────────────────────────────────────────────────── */
export function AssistantMessage({ text, onChoose, onRespond }: {
  text: string
  onChoose?: (pick: string) => void
  onRespond?: (item: string) => void
}) {
  const parsed = extractTrailingChoices(text)
  if (!parsed) return <PlainAssistantText text={text} />
  // The trailing numbered/lettered list might be a real "pick one"
  // question, OR more often a next-steps / TODO list the user wants
  // to read or respond to. Render each line as a plain item with
  // hover-revealed action icons on the right:
  //   ✓  treat as choice — re-send `c.raw` to claude
  //   ✏  copy to input as `-- <text>` so user can append a reply
  return (
    <>
      <PlainAssistantText text={parsed.body} />
      <div style={{ margin: '4px 0 10px 0', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {parsed.choices.map(c => (
          <div
            key={c.num}
            className="hive-choice-row"
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              padding: '6px 12px',
              border: `1px solid ${CRUSH.Charcoal}`,
              borderRadius: 6,
              background: 'transparent',
              fontFamily: FONT_MONO, fontSize: 'var(--chat-fs, 13px)',
              color: CRUSH.Ash,
              transition: 'background 120ms ease, border-color 120ms ease'
            }}
          >
            <span style={{ color: CRUSH.Charple, fontWeight: 700, minWidth: 16, lineHeight: 1.55 }}>{c.num}.</span>
            <span style={{ flex: 1, minWidth: 0 }}><CrushMarkdown text={c.label} /></span>
            <span className="hive-choice-actions" style={{ display: 'inline-flex', gap: 4, opacity: 0, transition: 'opacity 120ms ease' }}>
              {onChoose && (
                <button
                  onClick={() => onChoose(c.raw)}
                  title="Send this as my reply (= I pick this)"
                  style={{
                    background: 'transparent',
                    border: `1px solid ${CRUSH.Julep}`,
                    color: CRUSH.Julep,
                    width: 22, height: 22,
                    borderRadius: 3,
                    fontFamily: FONT_MONO, fontSize: 11, fontWeight: 700,
                    cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center'
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = CRUSH.Julep; e.currentTarget.style.color = CRUSH.Pepper }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = CRUSH.Julep }}
                ><Check size={12} strokeWidth={2.4} style={{ pointerEvents: 'none' }} /></button>
              )}
              {onRespond && (
                <button
                  onClick={() => onRespond(c.label)}
                  title="Quote into input box (edit & respond)"
                  style={{
                    background: 'transparent',
                    border: `1px solid ${CRUSH.Charple}`,
                    color: CRUSH.Charple,
                    width: 22, height: 22,
                    borderRadius: 3,
                    fontFamily: FONT_MONO, fontSize: 11,
                    cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center'
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = CRUSH.Charple; e.currentTarget.style.color = CRUSH.Butter }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = CRUSH.Charple }}
                ><Pencil size={12} strokeWidth={2.2} style={{ pointerEvents: 'none' }} /></button>
              )}
            </span>
          </div>
        ))}
      </div>
    </>
  )
}

/**
 * Detect a "summary" preamble at the very start of an assistant text
 * block. Matches `Summary:` / `## Summary` / `**Summary**` / `总结：`
 * / `Final Report` etc., case-insensitive, with or without a trailing
 * colon and inline title. Returns the body with the heading line
 * stripped + the optional inline title (text after the colon).
 *
 * Returns null when no summary marker is present — caller renders the
 * text plain.
 */
const SUMMARY_HEAD = /^\s*(?:#{1,3}\s*)?(?:\*\*)?\s*(?:Summary|Recap|Final\s*Report|总结|结论|小结)(?:\*\*)?\s*[:：]?\s*([^\n]*?)\s*(?:\*\*)?\s*$/i

export function detectSummary(text: string): { title: string; body: string } | null {
  const lines = text.split('\n')
  const m = lines[0]?.match(SUMMARY_HEAD)
  if (!m) return null
  // m[1] is whatever followed the keyword on the first line.
  const title = (m[1] || '').replace(/[*]+$/, '').trim()
  // Drop the heading line + one optional blank line.
  let i = 1
  while (i < lines.length && lines[i].trim() === '') i++
  return { title, body: lines.slice(i).join('\n') }
}

function PlainAssistantText({ text }: { text: string }) {
  const summary = detectSummary(text)
  // ● Julep dot prefixes every assistant text — same family as the
  // Julep ❯ on user input, signaling "claude is speaking" symmetric
  // to "user is speaking". Tool calls get their own colored ● in
  // ToolBlock; this is for plain-text reply.
  return (
    <div style={{ color: CRUSH.Ash, margin: '6px 0', padding: '2px 0' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <span style={{ color: CRUSH.Julep, fontWeight: 700, fontSize: 14, lineHeight: 1.55, flexShrink: 0 }}>●</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          {summary ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                <span style={{
                  border: `1px solid ${CRUSH.Julep}`,
                  background: 'rgba(0,255,178,0.08)',
                  color: CRUSH.Julep,
                  padding: '1px 8px',
                  borderRadius: 3,
                  fontFamily: FONT_MONO, fontSize: 10, fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase' as const
                }}>summary</span>
                {summary.title && (
                  <span style={{ color: CRUSH.Butter, fontWeight: 600, fontSize: 'var(--chat-fs, 13px)' }}>
                    {redact(summary.title)}
                  </span>
                )}
              </div>
              <CrushMarkdown text={summary.body} />
            </>
          ) : (
            <CrushMarkdown text={text} />
          )}
        </div>
      </div>
    </div>
  )
}

export interface Choice { num: string; label: string; raw: string }

/** Matches a "choice line":
 *    `1. Foo` / `1) Foo` / `1） Foo`          numbered, ascii or fullwidth paren
 *    `A. Foo` / `A) Foo` / `A） Foo`          uppercase letter
 *    `a. Foo` / etc                            lowercase letter
 *  Captures the marker (digits or single letter) and the label body.
 *  Also strips common leading markdown markers like `- ` / `**`. */
const CHOICE_LINE = /^\s*(?:[-*]\s+)?\*{0,2}(\d+|[A-Za-z])\s*[.)）]\*{0,2}\s*(.+?)\s*$/

/** If the tail of a message is a run of choice lines, peel them off.
 *  Returns null unless at least 2 consecutive tail lines match. */
export function extractTrailingChoices(text: string): { body: string; choices: Choice[] } | null {
  const lines = text.split('\n')
  const tail: Choice[] = []
  let i = lines.length - 1
  while (i >= 0) {
    const m = lines[i].match(CHOICE_LINE)
    if (!m) break
    tail.unshift({ num: m[1], label: m[2], raw: lines[i].trim() })
    i--
  }
  if (tail.length < 2) return null
  while (i >= 0 && lines[i].trim() === '') i--
  return { body: lines.slice(0, i + 1).join('\n'), choices: tail }
}

/* ────────────────────────────────────────────────────────────
 *  TOOL RESULT — ⎿ corner + Squid body
 * ──────────────────────────────────────────────────────────── */
export function ToolResult({ content, isError }: { content: string; isError?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const allLines = content.split('\n')
  const truncated = allLines.length > DEFAULT_EXPANDED_LINES
  const visible = expanded || !truncated
    ? allLines
    : allLines.slice(0, DEFAULT_EXPANDED_LINES)
  const hiddenCount = allLines.length - DEFAULT_EXPANDED_LINES

  return (
    <div style={{
      padding: '2px 0 4px 14px',
      color: isError ? CRUSH.Sriracha : CRUSH.Squid,
      fontFamily: FONT_MONO,
      fontSize: 12,
      lineHeight: 1.5
    }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <span style={{ color: CRUSH.Squid }}>⎿</span>
        <div style={{ whiteSpace: 'pre-wrap', flex: 1 }}>
          {visible.join('\n')}
          {truncated && !expanded && (
            <button
              onClick={() => setExpanded(true)}
              style={{
                display: 'block', marginTop: 4,
                background: 'transparent', border: 'none',
                color: CRUSH.Charple, cursor: 'pointer',
                padding: 0, fontFamily: FONT_MONO, fontSize: 11,
                textDecoration: 'underline'
              }}
            >▾ Show {hiddenCount} more lines</button>
          )}
          {truncated && expanded && (
            <button
              onClick={() => setExpanded(false)}
              style={{
                display: 'block', marginTop: 4,
                background: 'transparent', border: 'none',
                color: CRUSH.Squid, cursor: 'pointer',
                padding: 0, fontFamily: FONT_MONO, fontSize: 11,
                textDecoration: 'underline'
              }}
            >▴ Collapse</button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────
 *  TOOL BLOCK — tool_call header + (optional) matched tool_result
 *  wrapped in a single Dolly-bordered container so the bar spans both.
 * ──────────────────────────────────────────────────────────── */
export function ToolBlock({ name, input, result }: {
  name: string
  input: Record<string, unknown>
  result?: { content: string; isError?: boolean }
}) {
  const isError = result?.isError
  return (
    <div style={{
      borderLeft: `3px solid ${isError ? CRUSH.Sriracha : CRUSH.Charple}`,
      paddingLeft: 12,
      paddingTop: 4,
      paddingBottom: 4,
      margin: '6px 0',
      fontFamily: FONT_MONO,
      background: isError ? 'rgba(235,66,104,0.06)' : 'transparent',
      borderRadius: isError ? 4 : 0
    }}>
      <ToolHeader name={name} input={input} />
      {result
        ? <InlineResult content={result.content} isError={result.isError} tool={name} input={input} />
        : <LongRunningTick toolName={name} />}
    </div>
  )
}

/**
 * Sub-row that appears under a ToolBlock header while the tool is still
 * running (no tool_result yet). Silent for the first 5s — most tools
 * finish in 1-3s and a spinner that flashes is just visual noise. Past
 * 5s it lights up with the same Charple→Dolly scrolling gradient as
 * ThinkingSpinner so long-running Bash / Task / WebFetch don't look
 * like the UI froze.
 */
function LongRunningTick({ toolName }: { toolName: string }) {
  const startedAtRef = useRef<number>(Date.now())
  const [, force] = useState(0)
  const paused = useContext(HiveChatPausedContext)
  // 10 min hard stop (v1.7.98): if no tool_result arrived within 10 min
  // the tool likely crashed silently — tick stops so this row doesn't
  // setState every second forever. Visual freezes at the last shown
  // elapsed value.
  useEffect(() => {
    if (paused) return
    const iv = setInterval(() => {
      if (Date.now() - startedAtRef.current > 10 * 60 * 1000) {
        clearInterval(iv)
        return
      }
      force(n => n + 1)
    }, 1000)
    return () => clearInterval(iv)
  }, [paused])
  const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000)
  if (elapsed < 5) return null
  const gradStyle: React.CSSProperties = {
    background: `linear-gradient(90deg, ${CRUSH.Charple}, ${CRUSH.Dolly}, ${CRUSH.Charple}, ${CRUSH.Dolly})`,
    backgroundSize: '400% 100%',
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    color: 'transparent',
    WebkitTextFillColor: 'transparent',
    animation: 'thinking-grad 2s linear infinite',
    fontWeight: 700
  }
  // toolName tells us why we're waiting — Bash 30s feels different
  // from Task 30s. Showed for context, not for the gradient.
  const verb = toolName === 'Bash' || toolName === 'BashOutput'
    ? 'shell'
    : toolName === 'Task' || toolName === 'Agent'
      ? 'subagent'
      : 'tool'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '4px 0 0 14px',
      fontFamily: FONT_MONO, fontSize: 11
    }}>
      <style>{`@keyframes hg-flip { 0%,40% { transform: rotate(0deg); } 60%,100% { transform: rotate(180deg); } }`}</style>
      {/* hourglass alternates between ⌛ (sand-up) and ⏳ (sand-flowing)
          via CSS keyframe — gives a real "sand falling" feel instead
          of a static glyph. The Charple→Dolly gradient still applies
          to the verb text so motion + color both signal liveness. */}
      <span style={{ ...gradStyle, fontSize: 14, display: 'inline-block', animation: 'hg-flip 2s ease-in-out infinite' }}>⏳</span>
      <span style={gradStyle}>{verb} still running…</span>
      <span style={{ color: CRUSH.Oyster }}>{elapsed}s</span>
    </div>
  )
}

function ToolHeader({ name, input }: { name: string; input: Record<string, unknown> }) {
  // MCP tools arrive as `mcp__<server>__<function>`. Split for display
  // so "mcp__stargate__eagle_cost_by_service" → `Stargate · eagle_cost_by_service`.
  if (name.startsWith('mcp__')) {
    const parts = name.slice(5).split('__')
    const server = parts[0] || 'mcp'
    const fn = parts.slice(1).join('__') || '?'
    return <McpHeader server={server} fn={fn} input={input} />
  }
  if (name === 'TodoWrite') return <TodoInline input={input} />
  if (name === 'AskUserQuestion') return <AskUserQuestionInline input={input} />
  if (name === 'Bash') return <HeaderLine tool={name} color={CRUSH.Malibu} tail={String(input.command ?? '').replace(/\n/g, ' ').slice(0, 200)} tailStyle="ash" />
  if (name === 'Read' || name === 'View') return <HeaderLine tool="Read" color={CRUSH.Julep} tail={String(input.file_path ?? input.path ?? '')} tailStyle="link" />
  if (name === 'Edit') return <EditHeader input={input} />
  if (name === 'MultiEdit') return <MultiEditHeader input={input} />
  if (name === 'Write') return <HeaderLine tool="Write" color={CRUSH.Julep} tail={String(input.file_path ?? input.path ?? '')} tailStyle="link" />
  if (name === 'Grep' || name === 'Glob') {
    const pattern = String(input.pattern ?? input.query ?? '')
    const glob = String(input.glob ?? input.include ?? '')
    return <HeaderLine tool={name} color={CRUSH.Julep} tail={`"${pattern}"${glob ? ` ${glob}` : ''}`} tailStyle="ash" />
  }
  if (name === 'Task' || name === 'Agent') return <TaskHeader input={input} />

  if (name === 'WebFetch' || name === 'WebSearch') return <HeaderLine tool={name} color={CRUSH.Violet} tail={String(input.url ?? input.query ?? '')} tailStyle="link" />
  return <HeaderLine tool={name} color={toolColor(name)} tail={argSummary(input)} tailStyle="ash" />
}

/* Edit tool — header + side-by-side old/new diff from input.old_string / input.new_string */
function EditHeader({ input }: { input: Record<string, unknown> }) {
  const file = String(input.file_path ?? input.path ?? '')
  const oldStr = String(input.old_string ?? '')
  const newStr = String(input.new_string ?? '')
  return (
    <div>
      <HeaderLine tool="Edit" color={CRUSH.Julep} tail={file} tailStyle="link" />
      {(oldStr || newStr) && <DiffPanel oldStr={oldStr} newStr={newStr} />}
    </div>
  )
}

function MultiEditHeader({ input }: { input: Record<string, unknown> }) {
  const file = String(input.file_path ?? input.path ?? '')
  const edits = Array.isArray(input.edits) ? (input.edits as Array<{ old_string?: string; new_string?: string }>) : []
  return (
    <div>
      <HeaderLine tool="MultiEdit" color={CRUSH.Julep} tail={`${file} · ${edits.length} edit${edits.length === 1 ? '' : 's'}`} tailStyle="link" />
      {edits.map((e, i) => (
        <DiffPanel key={i} oldStr={String(e.old_string ?? '')} newStr={String(e.new_string ?? '')} />
      ))}
    </div>
  )
}

/** Simple side-by-side-ish diff: each line of old_string prefixed with -,
 * each of new_string with +. Lines that are identical in both stay neutral.
 * Left gutter shows 1-based row indices within the diff chunk (we don't
 * know the file-global line numbers — Claude's Edit input doesn't carry
 * them; would need to read the file to locate old_string). */
function DiffPanel({ oldStr, newStr }: { oldStr: string; newStr: string }) {
  const [expanded, setExpanded] = useState(false)
  if (!oldStr && !newStr) return null
  const oldLines = oldStr.split('\n')
  const newLines = newStr.split('\n')
  const oldSet = new Set(oldLines)
  const newSet = new Set(newLines)
  // Gutter width scales to the larger line count
  const maxLineNo = Math.max(oldLines.length, newLines.length)
  const gutterChars = String(maxLineNo).length
  const gutterStyle: React.CSSProperties = {
    display: 'inline-block',
    width: `${gutterChars + 1}ch`,
    flexShrink: 0,
    color: CRUSH.Oyster,
    textAlign: 'right',
    paddingRight: 8,
    userSelect: 'none'
  }

  // Build the list of visible rows (old lines first, then added-only new
  // lines) so we can cap large diffs to DEFAULT_EXPANDED_LINES like
  // ToolResult / ReadResultPanel do. Edits on large files otherwise dump
  // hundreds of lines into the DOM on one render.
  type Row =
    | { kind: 'old'; line: string; idx: number; unchanged: boolean }
    | { kind: 'new'; line: string; idx: number }
  const rows: Row[] = []
  oldLines.forEach((ln, i) => rows.push({ kind: 'old', line: ln, idx: i, unchanged: newSet.has(ln) }))
  newLines.forEach((ln, i) => { if (!oldSet.has(ln)) rows.push({ kind: 'new', line: ln, idx: i }) })

  const truncated = rows.length > DEFAULT_EXPANDED_LINES
  const visibleRows = expanded || !truncated ? rows : rows.slice(0, DEFAULT_EXPANDED_LINES)
  const hidden = rows.length - DEFAULT_EXPANDED_LINES

  return (
    <div style={{
      margin: '6px 0 2px',
      fontFamily: FONT_MONO, fontSize: 12,
      background: CRUSH.BBQ,
      borderRadius: 4,
      padding: '4px 0',
      overflow: 'auto'
    }}>
      {visibleRows.map((r, k) => {
        if (r.kind === 'old') {
          return (
            <div key={`o${r.idx}-${k}`} style={{
              display: 'flex', padding: '0 10px',
              background: r.unchanged ? 'transparent' : 'rgba(235,66,104,0.08)',
              color: r.unchanged ? CRUSH.Squid : CRUSH.Sriracha,
              whiteSpace: 'pre', lineHeight: 1.5
            }}>
              <span style={gutterStyle}>{r.idx + 1}</span>
              <span style={{ width: 16, flexShrink: 0, color: r.unchanged ? CRUSH.Oyster : CRUSH.Sriracha }}>{r.unchanged ? ' ' : '-'}</span>
              <span>{redact(r.line)}</span>
            </div>
          )
        }
        return (
          <div key={`n${r.idx}-${k}`} style={{
            display: 'flex', padding: '0 10px',
            background: 'rgba(0,255,178,0.08)',
            color: CRUSH.Julep,
            whiteSpace: 'pre', lineHeight: 1.5
          }}>
            <span style={gutterStyle}>{r.idx + 1}</span>
            <span style={{ width: 16, flexShrink: 0 }}>+</span>
            <span>{redact(r.line)}</span>
          </div>
        )
      })}
      {truncated && (
        <button
          onClick={() => setExpanded(v => !v)}
          style={{
            display: 'block', margin: '4px 10px 0',
            background: 'transparent', border: 'none',
            color: expanded ? CRUSH.Squid : CRUSH.Charple,
            cursor: 'pointer',
            padding: 0, fontFamily: FONT_MONO, fontSize: 11,
            textDecoration: 'underline'
          }}
        >{expanded ? '▴ Collapse' : `▾ Show ${hidden} more lines`}</button>
      )}
    </div>
  )
}

/**
 * Task tool — Claude delegating to a subagent. Show:
 *   ● Task   [subagent_type]   short description (or truncated prompt)
 *
 * Don't dump the full input.prompt. It's frequently 1k+ chars and
 * looks like duplicated content (the same text usually appears one
 * UserMessage above as the user's own request that triggered it).
 */
function TaskHeader({ input }: { input: Record<string, unknown> }) {
  const subagentType = String(input.subagent_type ?? input.type ?? '')
  const description = String(input.description ?? '')
  const prompt = String(input.prompt ?? '')
  // Prefer description (purpose-built short label), fall back to truncated prompt.
  const tail = description || (prompt.length > 120 ? prompt.slice(0, 120).replace(/\s+/g, ' ') + '…' : prompt.replace(/\s+/g, ' '))
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: FONT_MONO }}>
      <span style={{ color: CRUSH.Dolly, fontWeight: 700 }}>●</span>
      <span style={{ color: CRUSH.Dolly, fontWeight: 700 }}>Task</span>
      {subagentType && (
        <span style={{
          color: CRUSH.Pepper, background: CRUSH.Dolly,
          padding: '1px 6px', borderRadius: 3,
          fontWeight: 700, fontSize: 10, letterSpacing: '0.04em',
          textTransform: 'uppercase' as const
        }}>{subagentType}</span>
      )}
      <span style={{ color: CRUSH.Ash, opacity: 0.85 }}>{redact(tail)}</span>
    </div>
  )
}

function McpHeader({ server, fn, input }: { server: string; fn: string; input: Record<string, unknown> }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: FONT_MONO }}>
      <span style={{ color: CRUSH.Mochi, fontWeight: 700 }}>●</span>
      <span style={{
        color: CRUSH.Pepper, background: CRUSH.Mochi,
        padding: '1px 8px', borderRadius: 4, fontWeight: 700, fontSize: 11, letterSpacing: '0.04em'
      }}>{server.toUpperCase()}</span>
      <span style={{ color: CRUSH.Violet, fontWeight: 700 }}>{fn}</span>
      <span style={{
        color: CRUSH.Squid, fontSize: 12,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        flex: 1, minWidth: 0
      }}>{argSummary(input)}</span>
    </div>
  )
}

function HeaderLine({ tool, color, tail, tailStyle }: { tool: string; color: string; tail: string; tailStyle: 'ash' | 'link' }) {
  // Keep the real path for open / reveal; only the shown string is redacted.
  const isLink = tailStyle === 'link' && tail && (tail.startsWith('/') || tail.startsWith('http'))
  const isFile = tailStyle === 'link' && tail && tail.startsWith('/')
  // Click → open with default app (editor). Shift/Alt-click → reveal
  // in Finder. URL-style links (WebFetch / WebSearch) get openPath
  // too; macOS shell.openPath handles http(s) URLs by routing to
  // the default browser.
  const onClick = isLink
    ? (e: React.MouseEvent) => {
        if (isFile && (e.shiftKey || e.altKey)) {
          window.api.fs.revealInFinder(tail)
        } else {
          window.api.fs.openPath(tail)
        }
      }
    : undefined
  const displayTail = redact(tail)
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      fontFamily: FONT_MONO
    }}>
      <span style={{ color, fontWeight: 700 }}>●</span>
      <span style={{ color, fontWeight: 700 }}>{tool}</span>
      <span
        onClick={onClick}
        title={onClick
          ? (isFile
            ? 'Click to open · Shift-click to reveal in Finder'
            : 'Click to open in browser')
          : undefined}
        style={{
          color: tailStyle === 'link' ? CRUSH.Malibu : CRUSH.Ash,
          textDecoration: tailStyle === 'link' ? 'underline' : 'none',
          opacity: tailStyle === 'ash' ? 0.85 : 1,
          fontSize: 12,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          flex: 1, minWidth: 0,
          cursor: onClick ? 'pointer' : 'default'
        }}
      >{displayTail}</span>
    </div>
  )
}

/** Strip Claude Code's "N\t" line-number prefixes that appear in Read
 *  tool results, returning the raw file content + start line number. */
export function stripReadPrefix(s: string): { content: string; startLine: number } {
  const lines = s.split('\n')
  let startLine = 1
  const stripped: string[] = []
  let anyPrefixed = false
  for (const ln of lines) {
    const m = ln.match(/^(\d+)\t(.*)$/)
    if (m) {
      anyPrefixed = true
      if (stripped.length === 0) startLine = parseInt(m[1], 10)
      stripped.push(m[2])
    } else {
      stripped.push(ln)
    }
  }
  return anyPrefixed
    ? { content: stripped.join('\n'), startLine }
    : { content: s, startLine: 1 }
}

/**
 * Pretty-format common shell/Bash output patterns. Inline-color glyphs
 * (✓ Julep, ✗/❌ Sriracha, ⚠ Zest) and turn `=== Title ===` heading
 * lines into BBQ-backed cards with a Charple left border. Plain text
 * lines pass through unchanged. Pure helper — same input always
 * produces same JSX, no state.
 */
function formatStructuredOutput(text: string): React.ReactNode {
  return parseStructuredOutput(text).map((entry, i) => {
    if (entry.type === 'heading') {
      return (
        <div key={i} style={{
          margin: i === 0 ? '0 0 4px' : '8px 0 4px',
          padding: '3px 10px',
          background: CRUSH.BBQ,
          borderLeft: `3px solid ${CRUSH.Charple}`,
          borderRadius: '0 3px 3px 0',
          color: CRUSH.Butter,
          fontWeight: 700,
          letterSpacing: '0.02em'
        }}>{entry.title}</div>
      )
    }
    if (entry.type === 'blank') return <div key={i}>{' '}</div>
    return (
      <div key={i} style={{ whiteSpace: 'pre-wrap' as const }}>
        {entry.segments.map((seg, j) =>
          seg.type === 'glyph'
            ? <span key={j} style={{ color: seg.color, fontWeight: 700 }}>{seg.content}</span>
            : <React.Fragment key={j}>{seg.content}</React.Fragment>
        )}
      </div>
    )
  })
}

function InlineResult({ content, isError, tool, input }: {
  content: string
  isError?: boolean
  tool?: string
  input?: Record<string, unknown>
}) {
  const [expanded, setExpanded] = useState(false)

  // Read results come prefixed with "N\t" per line. Render as a code
  // panel with a proper gutter so it reads like a file, not log output.
  if (tool === 'Read' || tool === 'View') {
    const { content: code, startLine } = stripReadPrefix(content)
    return <ReadResultPanel code={code} startLine={startLine} isError={isError} filePath={input?.file_path as string | undefined} />
  }

  const allLines = content.split('\n')
  // Pick ONE truncation rule based on which cap fires first.
  // Priority: lines > chars. If lines > 12 → truncate by lines, label
  // 'N more lines'. Otherwise if chars > 800 → truncate by chars,
  // label 'N more chars'. Never mix.
  const MAX_CHARS = 800
  const MAX_LINES = DEFAULT_EXPANDED_LINES  // 12
  const byLines = allLines.length > MAX_LINES
  const byChars = !byLines && content.length > MAX_CHARS
  const truncated = byLines || byChars
  let visibleContent = content
  let hiddenLabel = ''
  if (!expanded && byLines) {
    visibleContent = allLines.slice(0, MAX_LINES).join('\n')
    hiddenLabel = `${allLines.length - MAX_LINES} more lines`
  } else if (!expanded && byChars) {
    visibleContent = content.slice(0, MAX_CHARS)
    hiddenLabel = `${content.length - MAX_CHARS} more chars`
  }
  return (
    <div style={{
      marginTop: 2,
      color: isError ? CRUSH.Sriracha : CRUSH.Squid,
      fontFamily: FONT_MONO,
      fontSize: 12,
      lineHeight: 1.5
    }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <span>{isError ? '⚠' : '⎿'}</span>
        <div style={{ flex: 1, wordBreak: 'break-word' }}>
          {formatStructuredOutput(redact(visibleContent))}
          {truncated && !expanded && (
            <button onClick={() => setExpanded(true)} style={expandBtnStyle(CRUSH.Charple)}>
              ▾ Show {hiddenLabel}
            </button>
          )}
          {truncated && expanded && (
            <button onClick={() => setExpanded(false)} style={expandBtnStyle(CRUSH.Squid)}>
              ▴ Collapse
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** BBQ-backed code panel for Read results: gutter with 1-based file line
 *  numbers (starts from startLine, supports Claude's offset= feature) +
 *  Prism syntax highlighting keyed off the file extension. */
function ReadResultPanel({ code, startLine, isError, filePath }: {
  code: string
  startLine: number
  isError?: boolean
  filePath?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const lines = code.split('\n')
  const truncated = lines.length > DEFAULT_EXPANDED_LINES
  const visible = expanded || !truncated ? lines : lines.slice(0, DEFAULT_EXPANDED_LINES)
  const hidden = lines.length - DEFAULT_EXPANDED_LINES
  const lastLineNo = startLine + visible.length - 1
  const gutterW = String(lastLineNo).length
  const language = langFromPath(filePath)
  const displayCode = redact(visible.join('\n'))

  return (
    <div style={{
      marginTop: 4,
      background: CRUSH.BBQ,
      border: `1px solid ${CRUSH.Charcoal}`,
      borderRadius: 4,
      padding: '6px 0',
      fontFamily: FONT_MONO, fontSize: 12,
      color: isError ? CRUSH.Sriracha : CRUSH.Ash,
      overflow: 'auto'
    }}>
      <Highlight code={displayCode} language={language as any} theme={CRUSH_PRISM_THEME as any}>
        {({ tokens, getLineProps, getTokenProps }) => (
          <div>
            {tokens.map((line, i) => {
              const { key: lineKey, ...lineRest } = getLineProps({ line })
              return (
                <div key={i} {...lineRest} style={{ display: 'flex', lineHeight: 1.55, whiteSpace: 'pre' }}>
                  <span style={{
                    display: 'inline-block',
                    width: `${gutterW + 2}ch`,
                    flexShrink: 0,
                    color: CRUSH.Oyster,
                    textAlign: 'right',
                    paddingRight: 8,
                    paddingLeft: 6,
                    userSelect: 'none'
                  }}>{startLine + i}</span>
                  <span style={{ flex: 1, paddingRight: 10 }}>
                    {line.map((token, j) => {
                      const { key: tokenKey, ...tokenRest } = getTokenProps({ token })
                      return <span key={j} {...tokenRest} />
                    })}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </Highlight>
      {truncated && (
        <div style={{ padding: '4px 12px' }}>
          <button onClick={() => setExpanded(v => !v)} style={expandBtnStyle(CRUSH.Charple)}>
            {expanded ? '▴ Collapse' : `▾ Show ${hidden} more lines`}
          </button>
          {filePath && (
            <span style={{ color: CRUSH.Oyster, fontSize: 11, marginLeft: 12 }}>
              {redact(filePath.split('/').slice(-2).join('/'))} · {language}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function expandBtnStyle(color: string): React.CSSProperties {
  return {
    display: 'block', marginTop: 4,
    background: 'transparent', border: 'none',
    color, cursor: 'pointer', padding: 0,
    fontFamily: FONT_MONO, fontSize: 11, textDecoration: 'underline'
  }
}

/* Back-compat export for places that still call <ToolCall> directly. */
export function ToolCall({ name, input }: { name: string; input: Record<string, unknown> }) {
  return <ToolBlock name={name} input={input} />
}

function toolColor(name: string) {
  return TOOL_COLORS[name] || CRUSH.Dolly
}

export function argSummary(input: Record<string, unknown>): string {
  // Prefer common field names — command / file_path / pattern / path / url.
  const preferred = ['command', 'file_path', 'path', 'pattern', 'url', 'prompt', 'description']
  for (const k of preferred) {
    const v = input[k]
    if (typeof v === 'string' && v.length > 0) return v
  }
  try { return JSON.stringify(input).slice(0, 120) } catch { return '' }
}

/* TodoWrite — rendered inside a ToolBlock so the Dolly bar frames the whole group */
interface Todo { content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm?: string }
function TodoInline({ input }: { input: Record<string, unknown> }) {
  // Defensive: during streaming, claude emits `input_json_delta` chunks
  // that get assembled into `input` over multiple events. Mid-stream,
  // `input.todos` can be a partial string ('[', '[{"id":'), a plain
  // object, or undefined — and a truthy non-array would slip past the
  // old `|| []` fallback and crash `.map()` with "is not a function",
  // which black-screened the whole timeline before HiveChatErrorBoundary.
  const todos: Todo[] = Array.isArray(input.todos) ? (input.todos as Todo[]) : []
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ color: CRUSH.Charple, fontWeight: 700 }}>●</span>
        <span style={{ color: CRUSH.Charple, fontWeight: 700 }}>TodoWrite</span>
        <span style={{ color: CRUSH.Squid, fontSize: 11 }}>[{todos.length} items]</span>
      </div>
      {todos.map((todo, i) => {
        const icon = todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '→' : '•'
        const color = todo.status === 'completed' ? CRUSH.Julep : todo.status === 'in_progress' ? CRUSH.Dolly : CRUSH.Squid
        return (
          <div key={i} style={{ display: 'flex', gap: 8, fontSize: 'var(--chat-fs, 13px)', padding: '1px 0' }}>
            <span style={{ color, fontWeight: 700, minWidth: 14, textAlign: 'center' }}>{icon}</span>
            <span style={{
              color: todo.status === 'completed' ? CRUSH.Squid : CRUSH.Ash,
              textDecoration: todo.status === 'completed' ? 'line-through' : 'none'
            }}>{todo.content}</span>
          </div>
        )
      })}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────
 *  AskUserQuestion — inline tool with clickable options
 *
 *  claude SDK emits AskUserQuestion as a normal tool_use, then a matching
 *  `control_request` with subtype=can_use_tool. Hive's chat component
 *  listens for the control_request and exposes the requestId + submit
 *  callback via AskUserQuestionContext. This component reads questions
 *  from `input` (so timeline renders correctly even during stream / replay)
 *  and reads the live submit callback from the context (so user clicks
 *  reply to the right requestId).
 *
 *  KEY shape: `answers[question.question]` — claude SDK keys by the full
 *  question text, not the header. Verified from claude-code binary:
 *    mapToolResultToToolResultBlockParam looks up answers[T] where
 *    T = question.question. Using `q.header` silently produced
 *    "(no option selected)" in claude's tool_result.
 * ──────────────────────────────────────────────────────────── */
export interface AskQuestion {
  question: string
  header: string
  options: Array<{ label: string; description?: string; preview?: string }>
  multiSelect: boolean
}
export function AskUserQuestionInline({ input }: { input: Record<string, unknown> }) {
  const ctx = useContext(AskUserQuestionContext)
  const questions: AskQuestion[] = Array.isArray(input.questions) ? (input.questions as AskQuestion[]) : []
  const [selected, setSelected] = useState<Record<number, string | string[] | undefined>>({})
  const [submitted, setSubmitted] = useState(false)
  // v2.15.8: user-triggered local dismissal. Fixes "选项不能选择的时候怎么办呢！！！" —
  // when ctx is null (control_request orphaned: claude died mid-question, or
  // history replay after the request already resolved) every option button
  // was disabled with no way out. Now a ✕ Dismiss button collapses the
  // card whether or not the request is still live.
  const [dismissed, setDismissed] = useState(false)
  // v2.15.8: free-text answer path. Some AskUserQuestion prompts don't
  // cover the answer the user wants to give ("None of these — I actually
  // want X"). Rather than force a canned pick, let them type. Applied to
  // question 0 only; multi-question AskUserQuestion is exotic and the
  // canned buttons still work for those.
  const [freeText, setFreeText] = useState('')
  const interactive = !!ctx && !submitted && !dismissed

  const submitAll = (final: Record<number, string | string[] | undefined>) => {
    if (!ctx || submitted) return
    const answers: Record<string, string | string[]> = {}
    questions.forEach((q, i) => {
      const v = final[i]
      if (v !== undefined && (typeof v === 'string' || (Array.isArray(v) && v.length > 0))) {
        answers[q.question] = v
      }
    })
    ctx.submit(answers)
    setSubmitted(true)
  }

  const submitFreeText = () => {
    if (!ctx || submitted || !freeText.trim()) return
    const answers: Record<string, string | string[]> = {}
    if (questions[0]) answers[questions[0].question] = freeText.trim()
    ctx.submit(answers)
    setSubmitted(true)
  }

  const dismiss = () => {
    // If claude is still waiting on the control_response, send an empty
    // payload so it moves on (claude interprets missing answers as
    // 'user declined to answer'). If ctx is already null (orphaned),
    // just visually collapse — nothing on the wire to satisfy.
    if (ctx && !submitted) {
      try { ctx.submit({}) } catch { /* channel dead — proceed to visual close */ }
      setSubmitted(true)
    }
    setDismissed(true)
  }

  if (dismissed) {
    return (
      <div style={{
        border: `1px dashed ${CRUSH.Charcoal}`,
        borderRadius: 8,
        padding: '6px 12px',
        background: 'transparent',
        marginTop: 4,
        color: CRUSH.Squid,
        fontSize: 11,
        fontStyle: 'italic',
        display: 'flex',
        alignItems: 'center',
        gap: 8
      }}>
        <span>? AskUserQuestion (dismissed)</span>
        <button
          onClick={() => setDismissed(false)}
          style={{
            background: 'transparent', border: 'none', color: CRUSH.Charple,
            fontFamily: 'inherit', fontSize: 11, cursor: 'pointer', padding: 0
          }}
        >↺ show</button>
      </div>
    )
  }

  const pickSingle = (qIdx: number, label: string) => {
    if (!interactive) return
    const next = { ...selected, [qIdx]: label }
    setSelected(next)
    if (questions.every((q, i) => {
      const v = next[i]
      if (q.multiSelect) return Array.isArray(v) && v.length > 0
      return typeof v === 'string'
    })) {
      submitAll(next)
    }
  }
  const toggleMulti = (qIdx: number, label: string) => {
    if (!interactive) return
    setSelected(prev => {
      const cur = (prev[qIdx] as string[] | undefined) || []
      const has = cur.includes(label)
      return { ...prev, [qIdx]: has ? cur.filter(l => l !== label) : [...cur, label] }
    })
  }

  return (
    <div style={{
      border: `1px solid ${CRUSH.Charple}`,
      borderRadius: 8,
      padding: '10px 12px',
      background: CRUSH.BBQ,
      marginTop: 4
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ color: CRUSH.Charple, fontWeight: 700 }}>?</span>
        <span style={{ color: CRUSH.Charple, fontWeight: 700 }}>AskUserQuestion</span>
        {!ctx && !submitted && <span style={{ color: CRUSH.Squid, fontSize: 11 }}>(awaiting request — read-only)</span>}
        {submitted && <span style={{ color: CRUSH.Bok, fontSize: 11 }}>✓ submitted</span>}
        {/* v2.15.8 escape hatch: always available. When interactive, sends
            an empty answer so claude moves on. When orphaned, just closes
            the card locally so the user isn't stuck staring at disabled
            option buttons with no way out. */}
        <button
          onClick={dismiss}
          title={interactive ? 'Send empty answer + close' : 'Close (no live request)'}
          style={{
            marginLeft: 'auto',
            background: 'transparent',
            border: `1px solid ${CRUSH.Charcoal}`,
            borderRadius: 4,
            color: CRUSH.Squid,
            padding: '2px 8px',
            fontFamily: 'inherit',
            fontSize: 11,
            cursor: 'pointer'
          }}
        >✕ Dismiss</button>
      </div>
      {questions.map((q, qIdx) => {
        const sel = selected[qIdx]
        return (
          <div key={qIdx} style={{ marginBottom: qIdx < questions.length - 1 ? 12 : 4 }}>
            <div style={{ marginBottom: 6 }}>
              <span style={{
                color: CRUSH.Dolly, fontWeight: 700, fontSize: 11,
                textTransform: 'uppercase' as const, letterSpacing: '0.05em',
                marginRight: 8
              }}>{q.header}</span>
              <span style={{ color: CRUSH.Ash, fontSize: 'var(--chat-fs, 13px)' }}>{q.question}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 4 }}>
              {q.options.map((opt, oIdx) => {
                const picked = q.multiSelect ? Array.isArray(sel) && sel.includes(opt.label) : sel === opt.label
                return (
                  <button
                    key={oIdx}
                    disabled={!interactive}
                    onClick={() => q.multiSelect ? toggleMulti(qIdx, opt.label) : pickSingle(qIdx, opt.label)}
                    style={{
                      textAlign: 'left' as const,
                      background: picked ? CRUSH.Charple : 'transparent',
                      border: `1px solid ${picked ? CRUSH.Charple : CRUSH.Charcoal}`,
                      borderRadius: 4,
                      padding: '6px 10px',
                      color: picked ? CRUSH.Butter : CRUSH.Ash,
                      fontFamily: 'inherit',
                      fontSize: 12,
                      cursor: interactive ? 'pointer' : 'default',
                      opacity: interactive ? 1 : 0.7
                    }}
                  >
                    <span style={{ marginRight: 8 }}>{picked ? '◉' : '○'}</span>
                    <span style={{ fontWeight: 600 }}>{opt.label}</span>
                    {opt.description && (
                      <span style={{ color: picked ? CRUSH.Ash : CRUSH.Squid, marginLeft: 8, fontWeight: 400 }}>— {opt.description}</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
      {questions.some(q => q.multiSelect) && interactive && (
        <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={() => submitAll(selected)}
            disabled={!questions.every((q, i) => {
              const v = selected[i]
              if (q.multiSelect) return Array.isArray(v) && v.length > 0
              return typeof v === 'string'
            })}
            style={{
              background: CRUSH.Charple, border: 'none',
              color: CRUSH.Butter, padding: '6px 14px', borderRadius: 4,
              fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer'
            }}
          >Submit →</button>
        </div>
      )}
      {/* v2.15.8 free-text escape hatch — for when none of the canned
          options fit the answer the user actually wants to give. Only
          shown for single-question AskUserQuestion; multi-question is
          rare and would need a per-question textarea grid. */}
      {interactive && questions.length === 1 && (
        <div style={{ marginTop: 10, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <textarea
            data-testid="ask-user-question-freetext"
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            onKeyDown={(e) => {
              // Enter (no shift) → submit. Matches the main chat input.
              if (e.key === 'Enter' && !e.shiftKey && freeText.trim()) {
                e.preventDefault()
                submitFreeText()
              }
            }}
            placeholder="Or type your own answer…"
            rows={1}
            style={{
              flex: 1,
              minHeight: 28,
              maxHeight: 120,
              background: CRUSH.Pepper,
              border: `1px solid ${CRUSH.Charcoal}`,
              borderRadius: 4,
              padding: '5px 8px',
              color: CRUSH.Butter,
              fontFamily: 'inherit',
              fontSize: 12,
              resize: 'vertical'
            }}
          />
          <button
            onClick={submitFreeText}
            disabled={!freeText.trim()}
            style={{
              background: freeText.trim() ? CRUSH.Charple : 'transparent',
              border: `1px solid ${freeText.trim() ? CRUSH.Charple : CRUSH.Charcoal}`,
              color: freeText.trim() ? CRUSH.Butter : CRUSH.Squid,
              padding: '5px 12px', borderRadius: 4,
              fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
              cursor: freeText.trim() ? 'pointer' : 'not-allowed',
              whiteSpace: 'nowrap'
            }}
          >Send text →</button>
        </div>
      )}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────
 *  SYSTEM — Squid dim line
 * ──────────────────────────────────────────────────────────── */
/* ────────────────────────────────────────────────────────────
 *  Thinking spinner — Crush-style "✳ Blanching… 3s" animation
 *  rendered while a message is in-flight but hasn't started
 *  surfacing visible text yet.
 * ──────────────────────────────────────────────────────────── */
export const THINKING_VERBS = [
  'Blanching', 'Brewing', 'Crafting', 'Simmering', 'Thinking',
  'Whisking', 'Marinating', 'Sautéing', 'Kneading', 'Seasoning'
]
export const THINKING_GLYPHS = ['·', '✢', '✶', '✳', '✻', '✽']

/** Pure helpers — exported for vitest coverage. */
export function pickVerb(seed: number): string {
  return THINKING_VERBS[((seed % THINKING_VERBS.length) + THINKING_VERBS.length) % THINKING_VERBS.length]
}
export function glyphAt(tick: number): string {
  return THINKING_GLYPHS[((tick % THINKING_GLYPHS.length) + THINKING_GLYPHS.length) % THINKING_GLYPHS.length]
}
export function elapsedSec(since: number, now: number): number {
  return Math.max(0, Math.floor((now - since) / 1000))
}

export function ThinkingSpinner({ since }: { since: number }) {
  const [tick, setTick] = useState(0)
  const [, forceSec] = useState(0)
  // Read paused-state from the nearest HiveChat (true when invisible).
  const paused = useContext(HiveChatPausedContext)
  React.useEffect(() => {
    if (paused) return
    const glyphIv = setInterval(() => setTick(t => t + 1), 150)
    const secIv = setInterval(() => forceSec(n => n + 1), 1000)
    return () => { clearInterval(glyphIv); clearInterval(secIv) }
  }, [paused])
  const verb = pickVerb(Math.floor(since / 1000))
  const glyph = glyphAt(tick)
  const secs = elapsedSec(since, Date.now())
  // Charple → Dolly → Charple → Dolly ramp scrolling horizontally —
  // matches Crush's anim GradColorA/GradColorB + CycleColors=true (see
  // /tmp/crush/internal/ui/anim/anim.go makeGradientRamp width*3 A→B→A→B).
  // Pure CSS via background-clip:text so the glyph + verb share the
  // same moving gradient without per-char JS work.
  const gradStyle: React.CSSProperties = {
    background: `linear-gradient(90deg, ${CRUSH.Charple}, ${CRUSH.Dolly}, ${CRUSH.Charple}, ${CRUSH.Dolly})`,
    backgroundSize: '400% 100%',
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    color: 'transparent',
    WebkitTextFillColor: 'transparent',
    animation: 'thinking-grad 2s linear infinite',
    fontWeight: 700
  }
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 4px',
      fontFamily: FONT_MONO, fontSize: 'var(--chat-fs, 13px)'
    }}>
      <style>{`@keyframes thinking-grad { 0% { background-position: 0% 50%; } 100% { background-position: 400% 50%; } }`}</style>
      <span style={{ ...gradStyle, width: 14, textAlign: 'center', display: 'inline-block' }}>{glyph}</span>
      <span style={gradStyle}>{verb}…</span>
      <span style={{ color: CRUSH.Oyster, fontSize: 11 }}>{secs}s</span>
    </div>
  )
}

/**
 * Auto-compact boundary divider — inserted into the timeline at the
 * point where Claude's session crossed its context-window threshold and
 * the prior turns got summarized. Above the divider you can still see
 * the old turns visually, but the *model* only "remembers" them as a
 * summary — it can't quote details verbatim. Useful to surface so the
 * user knows when to re-paste critical context.
 *
 * Detection heuristic in HiveChat: when a `result.usage.input_tokens`
 * drops to less than half of the previous high-water mark (i.e. we
 * previously had 180K, now we see 35K), assume compact happened.
 */
export function CompactBoundary({ previousTokens, newTokens, turnsSummarized }: {
  previousTokens: number
  newTokens: number
  turnsSummarized: number
}) {
  const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(0)}K` : `${n}`
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      margin: '12px 0',
      fontFamily: FONT_MONO, fontSize: 11,
      color: CRUSH.Squid
    }}>
      <span style={{
        flex: 1,
        height: 1,
        background: `linear-gradient(90deg, transparent, ${CRUSH.Charple}, transparent)`
      }} />
      <span style={{
        background: 'rgba(107,80,255,0.14)',
        border: `1px solid ${CRUSH.Charple}`,
        borderRadius: 999,
        padding: '3px 12px',
        color: CRUSH.Charple,
        fontWeight: 700,
        whiteSpace: 'nowrap' as const
      }}>
        ── auto-compacted{turnsSummarized > 0 ? ` · ${turnsSummarized} turns summarized` : ''}{previousTokens > 0 ? ` · ${fmt(previousTokens)} → ${fmt(newTokens)}` : ''} ──
      </span>
      <span style={{
        flex: 1,
        height: 1,
        background: `linear-gradient(90deg, transparent, ${CRUSH.Charple}, transparent)`
      }} />
    </div>
  )
}

/**
 * CompactSummaryHint — collapsed hint chip that replaces the wall of
 * "This session is being continued from a previous conversation…"
 * prose that claude writes to the jsonl after every /compact.
 *
 * Renders as a small pill next to CompactBoundary. A native
 * <details>/<summary> is used so the browser handles open/close
 * without React state — click to reveal the transcript jsonl path
 * (Reveal-in-Finder via window.api.fs.revealInFinder when available;
 * copyable path in any case).
 */
export function CompactSummaryHint({ transcriptPath, summaryChars }: {
  transcriptPath?: string
  summaryChars: number
}) {
  const kb = summaryChars >= 1024 ? `${(summaryChars / 1024).toFixed(1)}KB` : `${summaryChars}ch`
  const reveal = (e: React.MouseEvent) => {
    e.preventDefault()
    if (!transcriptPath) return
    // Best-effort — Hive's fs bridge; falls back to a no-op if absent
    // (e.g. running under vitest with no window.api).
    const api = (globalThis as any).window?.api?.fs
    if (api?.revealInFinder) api.revealInFinder(transcriptPath).catch(() => {})
  }
  return (
    <div style={{
      margin: '2px 0 8px',
      fontFamily: FONT_MONO, fontSize: 10,
      color: CRUSH.Oyster,
      display: 'flex', justifyContent: 'center'
    }}>
      <details style={{
        background: 'rgba(107,80,255,0.06)',
        border: `1px solid ${CRUSH.Charcoal}`,
        borderRadius: 6,
        padding: '4px 10px',
        maxWidth: 560, minWidth: 0
      }}>
        <summary style={{
          cursor: 'pointer',
          listStyle: 'none',
          color: CRUSH.Squid,
          userSelect: 'none' as const
        }}>
          ▸ compact summary hidden · {kb}{transcriptPath ? ' · click for transcript path' : ''}
        </summary>
        {transcriptPath && (
          <div style={{ marginTop: 6, wordBreak: 'break-all', color: CRUSH.Ash }}>
            <span style={{ color: CRUSH.Squid }}>transcript: </span>
            <a
              href="#"
              onClick={reveal}
              style={{ color: CRUSH.Malibu, textDecoration: 'none', cursor: 'pointer' }}
              title="Reveal in Finder"
            >{transcriptPath}</a>
          </div>
        )}
      </details>
    </div>
  )
}

export function SystemLine({ text }: { text: string }) {
  // Detect "in-progress" lines that start with the hourglass + end with
  // an ellipsis. These represent ongoing background ops (compact, scrape,
  // pausing chat). Animate the ⏳ (rotation) and the ellipsis (cycling
  // dots) so the user sees the operation is alive — static text reads
  // like a frozen UI even while a 90s /compact is running.
  const isInProgress = /^⏳\s/.test(text) && /[…\.]+\s*$/.test(text)
  if (isInProgress) {
    // Strip the trailing ellipsis (whatever form: "...", "…", " ...")
    // and re-add it as a separate animated span so the dots cycle.
    const stripped = text.replace(/\s*[…\.]+\s*$/, '')
    return (
      <div style={{ color: CRUSH.Oyster, fontSize: 11, fontFamily: FONT_MONO, padding: '2px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
        <style>{`@keyframes hg-flip { 0%,40% { transform: rotate(0deg); } 60%,100% { transform: rotate(180deg); } }`}</style>
        <span style={{
          display: 'inline-block',
          fontSize: 'var(--chat-fs, 13px)',
          animation: 'hg-flip 2s ease-in-out infinite',
          color: CRUSH.Charple
        }}>⏳</span>
        <span>{redact(stripped.replace(/^⏳\s*/, ''))}</span>
        <span className="hive-dots-loader" style={{ color: CRUSH.Charple }} />
      </div>
    )
  }
  return (
    <div style={{ color: CRUSH.Oyster, fontSize: 11, fontFamily: FONT_MONO, padding: '2px 0' }}>
      {redact(text)}
    </div>
  )
}

export function fmtMs(ms?: number): string {
  if (ms == null) return ''
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}
export function fmtK(n?: number): string {
  if (n == null) return '—'
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export function ResultSummaryCard({ costUSD, durationMs, numTurns, inputTokens, outputTokens, cacheReadTokens, stopReason, isError, apiErrorStatus, errorText }: {
  costUSD?: number; durationMs?: number; numTurns?: number
  inputTokens?: number; outputTokens?: number; cacheReadTokens?: number
  stopReason?: string
  isError?: boolean; apiErrorStatus?: number; errorText?: string
}) {
  const onSignIn = React.useContext(SignInContext)
  // First: did this turn fail with a real error? If so, classify it and
  // render the ACTUAL message (+ a Sign-in button when re-auth would fix
  // it) instead of the misleading "stopped: stop_sequence".
  const err = classifyResultError({ is_error: isError, api_error_status: apiErrorStatus, error: undefined, result: errorText })
  if (err) {
    // auth_expired → red + offer Sign-in. region_blocked → red, NO Sign-in
    // (re-login won't help). generic → red, real message only.
    const showSignIn = err.kind === 'auth_expired' && onSignIn != null
    const label = err.kind === 'auth_expired'
      ? 'authentication failed'
      : err.kind === 'region_blocked'
        ? 'region blocked'
        : `error${apiErrorStatus ? ` ${apiErrorStatus}` : ''}`
    return (
      <div style={{
        margin: '8px 0',
        borderLeft: `3px solid ${CRUSH.Sriracha}`,
        background: CRUSH.BBQ,
        borderRadius: 4,
        padding: '8px 12px',
        fontFamily: FONT_MONO, fontSize: 11,
        color: CRUSH.Ash,
        display: 'flex', flexDirection: 'column' as const, gap: 6
      }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', alignItems: 'center' }}>
          <span style={{
            color: CRUSH.Sriracha,
            fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: 10
          }}>{label}</span>
          {durationMs != null && (
            <span style={{ color: CRUSH.Squid }}>
              <span style={{ color: CRUSH.Oyster }}>dur </span>{fmtMs(durationMs)}
            </span>
          )}
        </div>
        <div style={{ color: CRUSH.Ash, lineHeight: 1.4, whiteSpace: 'pre-wrap' as const }}>{err.message}</div>
        {showSignIn && (
          <button
            onClick={() => onSignIn?.()}
            style={{
              alignSelf: 'flex-start',
              marginTop: 2,
              background: CRUSH.Sriracha,
              color: CRUSH.Butter,
              border: 'none',
              borderRadius: 4,
              padding: '4px 12px',
              fontFamily: FONT_MONO, fontSize: 11, fontWeight: 700,
              cursor: 'pointer'
            }}
          >Sign in →</button>
        )}
        {err.kind === 'region_blocked' && (
          <div style={{ color: CRUSH.Squid, fontSize: 10, lineHeight: 1.5 }}>
            Looks like a country/region restriction — Claude may not be
            available where this request came from. Switch back to a supported
            country/region, then restart Hive. Re-signing in is unlikely to
            help.
          </div>
        )}
      </div>
    )
  }
  // `end_turn` is the normal "claude finished naturally" stop. Anything
  // else is worth surfacing — refusal especially is otherwise easy to miss.
  const abnormal = stopReason && stopReason !== 'end_turn'
  // Color pick per stop reason. refusal / max_tokens are red; pause_turn
  // / tool_use mid-flow are yellow; unknown — just dim.
  const reasonColor = stopReason === 'refusal' || stopReason === 'model_context_window_exceeded'
    ? CRUSH.Sriracha
    : stopReason === 'max_tokens'
      ? CRUSH.Sriracha
      : stopReason === 'pause_turn' || stopReason === 'tool_use'
        ? CRUSH.Zest
        : CRUSH.Squid
  return (
    <div style={{
      margin: '8px 0',
      borderLeft: `3px solid ${abnormal ? reasonColor : CRUSH.Charple}`,
      background: CRUSH.BBQ,
      borderRadius: 4,
      padding: '6px 12px',
      fontFamily: FONT_MONO, fontSize: 11,
      color: CRUSH.Squid,
      display: 'flex', flexWrap: 'wrap', gap: '4px 14px', alignItems: 'center'
    }}>
      <span style={{
        color: abnormal ? reasonColor : CRUSH.Charple,
        fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: 10
      }}>{abnormal ? `stopped: ${stopReason}` : 'turn complete'}</span>
      {costUSD != null && (
        <span>
          <span style={{ color: CRUSH.Oyster }}>cost </span>
          <span style={{ color: CRUSH.Butter, fontWeight: 600 }}>${costUSD.toFixed(4)}</span>
        </span>
      )}
      {durationMs != null && (
        <span>
          <span style={{ color: CRUSH.Oyster }}>dur </span>
          <span style={{ color: CRUSH.Butter, fontWeight: 600 }}>{fmtMs(durationMs)}</span>
        </span>
      )}
      {numTurns != null && (
        <span>
          <span style={{ color: CRUSH.Oyster }}>turns </span>
          <span style={{ color: CRUSH.Butter, fontWeight: 600 }}>{numTurns}</span>
        </span>
      )}
      {(inputTokens != null || outputTokens != null) && (
        <span>
          <span style={{ color: CRUSH.Oyster }}>tokens </span>
          <span style={{ color: CRUSH.Butter, fontWeight: 600 }}>↓{fmtK(inputTokens)}</span>
          <span style={{ color: CRUSH.Oyster }}> / </span>
          <span style={{ color: CRUSH.Butter, fontWeight: 600 }}>↑{fmtK(outputTokens)}</span>
          {cacheReadTokens != null && cacheReadTokens > 0 && (
            <>
              <span style={{ color: CRUSH.Oyster }}> · cache </span>
              <span style={{ color: CRUSH.Bok, fontWeight: 600 }}>{fmtK(cacheReadTokens)}</span>
            </>
          )}
        </span>
      )}
    </div>
  )
}

/* Render a whole timeline entry. tool_call entries consume their matching
 * tool_result from the map (keyed by toolUseId) and render as one combined
 * block — the Dolly left-border spans header + result. */
/** React.memo-wrapped row: skips re-render when entry / result / onChoose
 *  references are stable. Without this, typing in the input box re-renders
 *  every row (including any large Read panels) on every keystroke. */
export const TimelineRow = React.memo(function TimelineRow({ entry, result, onChoose, onRecall, onRespond }: {
  entry: TimelineEntry
  result?: { content: string; isError?: boolean }
  onChoose?: (pick: string) => void
  onRecall?: (text: string) => void
  onRespond?: (item: string) => void
}) {
  // Subagent entries (parent_tool_use_id != null in stream) are
  // dimmed + indented + Mochi-bordered to visually demote them: they
  // belong to a sub-execution, not the main chat. Goal: you can still
  // SEE what the subagent did, but it's clearly secondary content.
  const isSub = (entry as any).isSubagent === true
  let row: React.ReactNode = null
  switch (entry.kind) {
    case 'user': row = <UserMessage text={entry.text} onRecall={isSub ? undefined : onRecall} isSubagent={isSub} />; break
    case 'assistant': row = <AssistantMessage text={entry.text} onChoose={isSub ? undefined : onChoose} onRespond={isSub ? undefined : onRespond} />; break
    case 'tool_call': row = <ToolBlock name={entry.name} input={entry.input} result={result} />; break
    case 'tool_result': row = null; break
    case 'system': row = <SystemLine text={entry.text} />; break
    case 'result': row = <ResultSummaryCard
      costUSD={entry.costUSD} durationMs={entry.durationMs} numTurns={entry.numTurns}
      inputTokens={entry.inputTokens} outputTokens={entry.outputTokens}
      cacheReadTokens={entry.cacheReadTokens} stopReason={entry.stopReason}
      isError={entry.isError} apiErrorStatus={entry.apiErrorStatus} errorText={entry.errorText}
    />; break
    case 'compact_boundary': row = <CompactBoundary previousTokens={entry.previousTokens} newTokens={entry.newTokens} turnsSummarized={entry.turnsSummarized} />; break
    case 'compact_summary_hint': row = <CompactSummaryHint transcriptPath={entry.transcriptPath} summaryChars={entry.summaryChars} />; break
  }
  if (!row) return null
  if (isSub) {
    return (
      <div style={{
        marginLeft: 24,
        paddingLeft: 10,
        borderLeft: `2px solid ${CRUSH.Mochi}`,
        opacity: 0.7,
        fontSize: 12,
        position: 'relative' as const
      }}>
        <div style={{
          position: 'absolute' as const, left: -8, top: 6,
          background: '#150e24',
          color: CRUSH.Mochi,
          fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
          padding: '0 4px', borderRadius: 2
        }}>SUB</div>
        {row}
      </div>
    )
  }
  return row
}, (prev, next) => {
  if (prev.onChoose !== next.onChoose) return false
  if (prev.onRecall !== next.onRecall) return false
  if (prev.onRespond !== next.onRespond) return false
  if (prev.entry !== next.entry) return false
  // Result content stability — reference OR deep equal for the 2 fields.
  const pr = prev.result, nr = next.result
  if (pr === nr) return true
  if (!pr || !nr) return false
  return pr.content === nr.content && pr.isError === nr.isError
})
