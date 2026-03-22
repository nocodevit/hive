import { useState } from 'react'
import Modal from './Modal'
import type { Agent, Project, Zone } from '../types'
import { defaultAvatar, defaultSoul, defaultPreferences, agentPresets } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  project: Project
  onCreate: (agent: Agent) => void
}

const DEPARTMENTS = ['Engineering', 'Design', 'Research', 'QA', 'Operations']

export default function CreateAgentModal({ open, onClose, project, onCreate }: Props) {
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [type, setType] = useState<'coding' | 'non-coding'>('coding')
  const [department, setDepartment] = useState('Engineering')
  const [zoneId, setZoneId] = useState(project.zones[0]?.id || '')
  const [soul, setSoul] = useState(defaultSoul)
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null)

  const applyPreset = (presetRole: string) => {
    const preset = agentPresets.find((p) => p.role === presetRole)
    if (!preset) return
    setSelectedPreset(presetRole)
    setRole(preset.role)
    setType(preset.type)
    setDepartment(preset.department)
    setSoul(preset.soul)
    // Auto-select matching zone
    const matchZone = project.zones.find((z: Zone) =>
      preset.type === 'coding' ? z.type === 'rnd' : z.type === 'non-rnd'
    )
    if (matchZone) setZoneId(matchZone.id)
  }

  const handleCreate = () => {
    if (!name.trim() || !zoneId) return
    onCreate({
      id: `agent-${Date.now()}`,
      projectId: project.id,
      zoneId,
      name: name.trim(),
      role: role.trim() || name.trim(),
      type,
      department,
      status: 'done',
      soul,
      avatar: { ...defaultAvatar },
      enabledSkills: [],
      preferences: { ...defaultPreferences }
    })
    setName('')
    setRole('')
    setType('coding')
    setDepartment('Engineering')
    setSoul(defaultSoul)
    setSelectedPreset(null)
    onClose()
  }

  const filteredZones = project.zones.filter((z: Zone) =>
    type === 'coding' ? z.type === 'rnd' : true
  )

  return (
    <Modal open={open} onClose={onClose} title="New Agent">
      <div className="space-y-5">
        {/* Presets */}
        <div>
          <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-1.5">
            Quick Start — Choose a Role
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            {agentPresets.map((preset) => (
              <button
                key={preset.role}
                onClick={() => applyPreset(preset.role)}
                className={`text-left px-3 py-2 rounded-lg text-xs cursor-pointer transition-colors ${
                  selectedPreset === preset.role
                    ? 'bg-accent-subtle border border-accent/30 text-accent'
                    : 'bg-bg-primary border border-border text-text-secondary hover:bg-bg-hover'
                }`}
              >
                <span className="font-medium">{preset.role}</span>
                <span className="text-text-muted ml-1">
                  {preset.type === 'coding' ? 'dev' : 'res'}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-border" />

        {/* Name + Role */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-1.5">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Alex"
              className="w-full px-3 py-2 rounded-lg bg-bg-primary border border-border
                text-text-primary text-sm placeholder:text-text-muted/50
                focus:outline-none focus:border-accent transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-1.5">
              Role
            </label>
            <input
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. Frontend Dev"
              className="w-full px-3 py-2 rounded-lg bg-bg-primary border border-border
                text-text-primary text-sm placeholder:text-text-muted/50
                focus:outline-none focus:border-accent transition-colors"
            />
          </div>
        </div>

        {/* Type */}
        <div>
          <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-1.5">
            Agent Type
          </label>
          <div className="flex gap-2">
            <button
              onClick={() => setType('coding')}
              className={`flex-1 px-3 py-2.5 rounded-lg text-sm font-medium cursor-pointer
                transition-colors flex items-center justify-center gap-2 ${
                type === 'coding'
                  ? 'bg-accent text-text-on-purple'
                  : 'bg-bg-primary border border-border text-text-secondary hover:bg-bg-hover'
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
              </svg>
              Coding
            </button>
            <button
              onClick={() => setType('non-coding')}
              className={`flex-1 px-3 py-2.5 rounded-lg text-sm font-medium cursor-pointer
                transition-colors flex items-center justify-center gap-2 ${
                type === 'non-coding'
                  ? 'bg-accent text-text-on-purple'
                  : 'bg-bg-primary border border-border text-text-secondary hover:bg-bg-hover'
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
              Research
            </button>
          </div>
        </div>

        {/* Department */}
        <div>
          <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-1.5">
            Department
          </label>
          <div className="flex flex-wrap gap-1.5">
            {DEPARTMENTS.map((dept) => (
              <button
                key={dept}
                onClick={() => setDepartment(dept)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                  department === dept
                    ? 'bg-accent-subtle text-accent border border-accent/30'
                    : 'bg-bg-primary border border-border text-text-muted hover:text-text-secondary'
                }`}
              >
                {dept}
              </button>
            ))}
          </div>
        </div>

        {/* Zone */}
        <div>
          <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-1.5">
            Work Zone
          </label>
          {filteredZones.length === 0 ? (
            <p className="text-sm text-text-muted italic">
              No {type === 'coding' ? 'R&D' : ''} zones in this project. Add zones first.
            </p>
          ) : (
            <div className="space-y-1.5">
              {filteredZones.map((zone: Zone) => (
                <button
                  key={zone.id}
                  onClick={() => setZoneId(zone.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm cursor-pointer
                    transition-colors flex items-center gap-2 ${
                    zoneId === zone.id
                      ? 'bg-accent-subtle border border-accent/30 text-accent'
                      : 'bg-bg-primary border border-border text-text-secondary hover:bg-bg-hover'
                  }`}
                >
                  <span className={`inline-block w-2 h-2 rounded-full ${
                    zone.type === 'rnd' ? 'bg-accent' : 'bg-status-waiting'
                  }`} />
                  <span className="font-medium">{zone.name}</span>
                  <span className="text-[10px] text-text-muted uppercase">
                    {zone.type === 'rnd' ? 'R&D' : 'Docs'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Create button */}
        <button
          onClick={handleCreate}
          disabled={!name.trim() || !zoneId}
          className="w-full py-2.5 rounded-lg bg-accent text-text-on-purple font-semibold text-sm
            hover:bg-accent-hover transition-colors cursor-pointer
            disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Create Agent
        </button>
      </div>
    </Modal>
  )
}
