import { useState } from 'react'
import Modal from './Modal'
import type { Agent, Project, Zone } from '../types'
import { defaultAvatar, defaultSoul, defaultPreferences } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  project: Project
  onCreate: (agent: Agent) => void
}

const RND_ROLES = ['Engineering', 'Product', 'QA', 'Design']
const NON_RND_ROLES = ['Admin', 'HR', 'Marketing', 'BA', 'Operations', 'GM']

export default function CreateAgentModal({ open, onClose, project, onCreate }: Props) {
  const [name, setName] = useState('')
  const [department, setDepartment] = useState<'R&D' | 'Non-R&D'>('R&D')
  const [role, setRole] = useState('Engineering')
  const [zoneId, setZoneId] = useState(project.zones[0]?.id || '')
  const [soul, setSoul] = useState(defaultSoul)

  const type = department === 'R&D' ? 'coding' as const : 'non-coding' as const
  const roles = department === 'R&D' ? RND_ROLES : NON_RND_ROLES

  const filteredZones = project.zones.filter((z: Zone) =>
    department === 'R&D' ? z.type === 'rnd' : z.type === 'non-rnd'
  )

  const handleDeptChange = (dept: 'R&D' | 'Non-R&D') => {
    setDepartment(dept)
    const newRoles = dept === 'R&D' ? RND_ROLES : NON_RND_ROLES
    setRole(newRoles[0])
    const matchZone = project.zones.find((z: Zone) =>
      dept === 'R&D' ? z.type === 'rnd' : z.type === 'non-rnd'
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
      role,
      type,
      department,
      status: 'done',
      soul,
      avatar: { ...defaultAvatar },
      enabledSkills: [],
      preferences: { ...defaultPreferences }
    })
    setName('')
    setDepartment('R&D')
    setRole('Engineering')
    setSoul(defaultSoul)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="New Agent">
      <div className="space-y-5">
        {/* Name */}
        <div>
          <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-1.5">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Alex, Daisy, Sam"
            className="w-full px-3 py-2 rounded-lg bg-bg-primary border border-border
              text-text-primary text-sm placeholder:text-text-muted/50
              focus:outline-none focus:border-accent transition-colors"
          />
        </div>

        {/* Department + Role */}
        <div>
          <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-1.5">
            Department & Role
          </label>
          <div className="flex gap-2">
            <div className="flex gap-1">
              {(['R&D', 'Non-R&D'] as const).map((dept) => (
                <button
                  key={dept}
                  onClick={() => handleDeptChange(dept)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                    department === dept
                      ? 'bg-accent text-text-on-purple'
                      : 'bg-bg-primary border border-border text-text-muted hover:bg-bg-hover'
                  }`}
                >{dept}</button>
              ))}
            </div>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="flex-1 px-3 py-2 rounded-lg bg-bg-primary border border-border
                text-text-primary text-sm cursor-pointer
                focus:outline-none focus:border-accent transition-colors"
            >
              {roles.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>

        {/* Zone */}
        <div>
          <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-1.5">
            Work Zone
          </label>
          {filteredZones.length === 0 ? (
            <p className="text-sm text-text-muted italic">
              No {department === 'R&D' ? 'R&D' : 'Non-R&D'} folders in this project.
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
                    zone.type === 'rnd' ? 'bg-accent' : 'bg-status-working'
                  }`} />
                  <span className="font-medium">{zone.name}</span>
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
