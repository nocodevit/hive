import { useEffect } from 'react'
import Modal from './Modal'

/**
 * Two-step delete confirmation for the trash icon on an agent card.
 *
 * Before this modal existed, clicking the bin icon on an AgentCard fired the
 * full destructive path in one shot: killed the PTY, `git worktree remove`d
 * the working tree (including any uncommitted local edits), deleted the
 * `.claude` agent definition, and dropped the record from data.json.
 * Zero confirmation, zero preview of the blast radius. A user reported
 * losing the "David" agent after an accidental mis-click ("屏幕卡住"),
 * which took ~5 chat-log GB's worth of context with it (definition-side).
 *
 * The modal enumerates every side effect BEFORE the click commits, defaults
 * focus to Cancel (so pressing Enter after a mis-click is safe), and
 * routes Escape to Cancel too. Chat logs (`~/.hive/chat-logs/…`) are
 * intentionally called out as PRESERVED — historically they've always
 * survived agent deletion, and users need to know their transcripts don't
 * vanish with the agent record.
 */

export interface AgentDeleteImpact {
  hasActiveTerminal: boolean
  worktreePath?: string
  worktreeBranch?: string
  definitionCwd?: string
}

export interface AgentDeleteConfirmProps {
  agentName: string
  impact: AgentDeleteImpact
  onCancel: () => void
  onConfirm: () => void
}

export default function AgentDeleteConfirmModal({
  agentName, impact, onCancel, onConfirm
}: AgentDeleteConfirmProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <Modal open onClose={onCancel} title={`Delete agent "${agentName}"?`}>
      <div className="space-y-4">
        <div className="text-sm text-text-primary">
          This is permanent. The following will happen:
        </div>
        <ul className="space-y-1.5 text-[13px] text-text-muted">
          {impact.hasActiveTerminal && (
            <li>
              <span className="text-red-400">✕</span>{' '}
              Kill the running terminal / chat session
            </li>
          )}
          {impact.worktreePath && (
            <li>
              <span className="text-red-400">✕</span>{' '}
              <code className="text-[12px]">git worktree remove {impact.worktreePath}</code>
              {' '}(any uncommitted local changes there are lost)
            </li>
          )}
          {impact.worktreeBranch && (
            <li>
              <span className="text-red-400">✕</span>{' '}
              Delete local branch <code className="text-[12px]">{impact.worktreeBranch}</code>
              {' '}(remote is unaffected)
            </li>
          )}
          {impact.definitionCwd && (
            <li>
              <span className="text-red-400">✕</span>{' '}
              Remove agent definition file under <code className="text-[12px]">{impact.definitionCwd}/.claude</code>
            </li>
          )}
          <li>
            <span className="text-red-400">✕</span>{' '}
            Drop the agent record from <code className="text-[12px]">~/.hive/data.json</code>
          </li>
          <li>
            <span className="text-green-400">✓</span>{' '}
            Chat logs at <code className="text-[12px]">~/.hive/chat-logs/</code> are kept
          </li>
        </ul>
        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <button
            autoFocus
            onClick={onCancel}
            className="px-4 py-1.5 rounded-lg bg-bg-primary border border-border text-text-primary text-sm hover:bg-bg-hover transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-1.5 rounded-lg bg-red-500/15 border border-red-500 text-red-400 text-sm hover:bg-red-500/25 transition-colors cursor-pointer"
          >
            Delete permanently
          </button>
        </div>
      </div>
    </Modal>
  )
}
