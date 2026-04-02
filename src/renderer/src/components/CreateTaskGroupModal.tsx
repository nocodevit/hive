import { useState } from 'react'
import Modal from './Modal'
import type { Agent, TaskGroup, TaskGroupRole } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  projectId: string
  agents: Agent[]
  onSubmit: (taskGroup: TaskGroup) => void
}

const ROLE_CONFIG: { role: TaskGroupRole; label: string; icon: string; color: string; multi?: boolean }[] = [
  { role: 'manager', label: 'Manager', icon: '♛', color: '#F59E0B' },
  { role: 'qa', label: 'QA', icon: '🛡', color: '#10B981' },
  { role: 'critic', label: 'Critic', icon: '👁', color: '#8B5CF6' },
]

export default function CreateTaskGroupModal({ open, onClose, projectId, agents, onSubmit }: Props) {
  const [managerId, setManagerId] = useState('')
  const [qaId, setQaId] = useState('')
  const [criticId, setCriticId] = useState('')
  const [workerIds, setWorkerIds] = useState<Set<string>>(new Set())
  const [todoSource, setTodoSource] = useState('docs/todo.md')
  const [maxRetries, setMaxRetries] = useState(3)

  const assigned = new Set([managerId, qaId, criticId, ...workerIds].filter(Boolean))
  const available = (excludeId?: string) => agents.filter(a => !assigned.has(a.id) || a.id === excludeId)

  const valid = managerId && qaId && criticId && workerIds.size > 0
    && new Set([managerId, qaId, criticId, ...workerIds]).size === 3 + workerIds.size

  const handleSubmit = () => {
    if (!valid) return
    const tg: TaskGroup = {
      id: `tg-${Date.now()}`,
      projectId,
      status: 'idle',
      managerId,
      workerIds: [...workerIds],
      qaId,
      criticId,
      currentBatch: 0,
      todoSource,
      maxGateRetries: maxRetries,
    }
    onSubmit(tg)
    onClose()
  }

  const renderDropdown = (role: TaskGroupRole, value: string, onChange: (v: string) => void) => {
    const cfg = ROLE_CONFIG.find(r => r.role === role)!
    return (
      <div key={role} className="flex items-center gap-3">
        <span className="w-5 text-center" style={{ color: cfg.color }}>{cfg.icon}</span>
        <label className="text-xs text-text-muted w-16">{cfg.label}</label>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 bg-bg-primary border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary cursor-pointer"
        >
          <option value="">Select agent...</option>
          {available(value).map(a => (
            <option key={a.id} value={a.id}>{a.name} ({a.role})</option>
          ))}
        </select>
      </div>
    )
  }

  return (
    <Modal open={open} onClose={onClose} title="Create Task Group">
      <div className="space-y-4">
        {/* Role pickers */}
        <div className="space-y-3">
          {renderDropdown('manager', managerId, setManagerId)}
          {renderDropdown('qa', qaId, setQaId)}
          {renderDropdown('critic', criticId, setCriticId)}
        </div>

        {/* Workers multi-select */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="w-5 text-center" style={{ color: '#3B82F6' }}>⚒</span>
            <label className="text-xs text-text-muted">Workers (1+)</label>
          </div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {agents.filter(a => a.id !== managerId && a.id !== qaId && a.id !== criticId).map(a => (
              <label key={a.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-bg-hover cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={workerIds.has(a.id)}
                  onChange={(e) => {
                    setWorkerIds(prev => {
                      const next = new Set(prev)
                      e.target.checked ? next.add(a.id) : next.delete(a.id)
                      return next
                    })
                  }}
                  className="accent-[#3B82F6]"
                />
                <span className="text-text-primary">{a.name}</span>
                <span className="text-text-muted/50 text-xs ml-auto">{a.role}</span>
              </label>
            ))}
            {agents.filter(a => a.id !== managerId && a.id !== qaId && a.id !== criticId).length === 0 && (
              <p className="text-xs text-text-muted py-2 text-center">No agents available</p>
            )}
          </div>
        </div>

        {/* Config */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-text-muted block mb-1">Todo source</label>
            <input
              value={todoSource}
              onChange={(e) => setTodoSource(e.target.value)}
              className="w-full bg-bg-primary border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-text-muted block mb-1">Max gate retries</label>
            <input
              type="number" min={1} max={10}
              value={maxRetries}
              onChange={(e) => setMaxRetries(parseInt(e.target.value) || 3)}
              className="w-full bg-bg-primary border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary"
            />
          </div>
        </div>

        {/* Summary */}
        {valid && (
          <div className="bg-bg-primary border border-border rounded-lg p-3 text-xs text-text-muted">
            {agents.find(a => a.id === managerId)?.name} manages {workerIds.size} worker{workerIds.size > 1 ? 's' : ''}, QA by {agents.find(a => a.id === qaId)?.name}, Critic by {agents.find(a => a.id === criticId)?.name}
          </div>
        )}

        {/* Submit */}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-text-muted hover:bg-bg-hover transition-colors cursor-pointer">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!valid}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
              valid ? 'bg-accent text-text-on-purple hover:bg-accent-hover' : 'bg-bg-hover text-text-muted/50 cursor-not-allowed'
            }`}
          >
            Create & Start
          </button>
        </div>
      </div>
    </Modal>
  )
}
