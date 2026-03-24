import { useState } from 'react'
import Modal from './Modal'
import type { Agent, Project, Zone } from '../types'
import { defaultAvatar, defaultPreferences } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  project: Project
  onCreate: (agent: Agent) => void
}

const RND_ROLES = ['Engineering', 'Product', 'QA', 'Design']
const NON_RND_ROLES = ['Admin', 'HR', 'Marketing', 'BA', 'Operations', 'GM']

const TRAIT_OPTIONS = [
  'Detail-oriented', 'Creative', 'Analytical', 'Fast-paced',
  'Cautious', 'Thorough', 'Concise', 'Friendly',
  'Strategic', 'Data-driven', 'User-centric', 'Security-first'
]

function generateSoul(name: string, role: string, department: string, traits: string[]): string {
  const traitStr = traits.length > 0
    ? traits.map((t) => `- ${t}`).join('\n')
    : '- Professional and helpful'

  const roleSouls: Record<string, string> = {
    Engineering: `Senior software engineer. Write clean, maintainable, well-tested code.\n\n## Workflow\n- Read existing code before making changes\n- Write tests for new functionality\n- Keep commits small and focused\n- Document non-obvious decisions`,
    Product: `Product manager. Define requirements, prioritize features, track progress.\n\n## Workflow\n- Analyze user needs and market trends\n- Write clear user stories and acceptance criteria\n- Prioritize backlog based on impact\n- Coordinate between engineering and design`,
    QA: `QA engineer. Test thoroughly, find edge cases, ensure quality.\n\n## Workflow\n- Write comprehensive test plans\n- Test edge cases and error scenarios\n- Write clear, reproducible bug reports\n- Verify fixes and run regression tests`,
    Design: `UI/UX designer and frontend implementer. Focus on user experience.\n\n## Workflow\n- Design mobile-first, responsive layouts\n- Follow the project's design system\n- Ensure accessibility (WCAG compliance)\n- Prototype before building`,
    Admin: `Administrative coordinator. Organize, plan, and manage operations.\n\n## Workflow\n- Track project milestones and deadlines\n- Coordinate team activities\n- Manage documentation and processes\n- Generate status reports`,
    HR: `HR specialist. Manage team dynamics and organizational health.\n\n## Workflow\n- Define roles and responsibilities\n- Create onboarding documentation\n- Track team capacity and workload`,
    Marketing: `Marketing strategist. Drive growth, content, and user acquisition.\n\n## Workflow\n- Analyze market positioning and competitors\n- Create content calendar and marketing copy\n- Optimize SEO and social media presence\n- Track marketing metrics and ROI`,
    BA: `Business analyst. Revenue strategy, pricing, and monetization.\n\n## Workflow\n- Analyze revenue opportunities\n- Research pricing models and benchmarks\n- Create financial projections\n- Track KPIs and business metrics`,
    Operations: `Operations manager. Ensure smooth day-to-day execution.\n\n## Workflow\n- Manage deployment and infrastructure\n- Monitor system health and performance\n- Coordinate releases and rollouts\n- Handle incident response`,
    GM: `General manager. High-level strategy and cross-functional coordination.\n\n## Workflow\n- Set priorities across all departments\n- Make resource allocation decisions\n- Review progress and adjust strategy\n- Communicate vision and goals`
  }

  const roleContent = roleSouls[role] || `${role} specialist. Deliver excellent work in your domain.`

  return `# Soul

## Identity
You are ${name}, a ${role} specialist.

## Role
${roleContent}

## Personality
${traitStr}

## Boundaries
- Stay within your role's scope
- Ask before making large or cross-domain changes

## Task Reporting (IMPORTANT)
When you start a new task, IMMEDIATELY run:
\`\`\`bash
.claude/hive-report.sh start "Brief task title"
\`\`\`

When you finish a task, IMMEDIATELY run:
\`\`\`bash
.claude/hive-report.sh done "Brief summary of what was done"
\`\`\`

This reports your progress to the Hive dashboard. Always do this for every task.
`
}

export default function CreateAgentModal({ open, onClose, project, onCreate }: Props) {
  const [name, setName] = useState('')
  const [department, setDepartment] = useState<'R&D' | 'Non-R&D'>('R&D')
  const [role, setRole] = useState('Engineering')
  const [group, setGroup] = useState('')
  const [traits, setTraits] = useState<string[]>([])
  const [zoneId, setZoneId] = useState(project.zones[0]?.id || '')

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

  const toggleTrait = (trait: string) => {
    setTraits((prev) =>
      prev.includes(trait) ? prev.filter((t) => t !== trait) : [...prev, trait]
    )
  }

  const handleCreate = () => {
    if (!name.trim() || !zoneId) return
    const soul = generateSoul(name.trim(), role, department, traits)
    onCreate({
      id: `agent-${Date.now()}`,
      projectId: project.id,
      zoneId,
      name: name.trim(),
      role,
      type,
      department,
      group: group.trim() || '',
      order: Date.now(),
      status: 'done',
      soul,
      avatar: { ...defaultAvatar },
      enabledSkills: [],
      preferences: { ...defaultPreferences }
    })
    setName('')
    setGroup('')
    setDepartment('R&D')
    setRole('Engineering')
    setTraits([])
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

        {/* Group */}
        <div>
          <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-1.5">
            Team Group <span className="normal-case tracking-normal font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            placeholder="e.g. Frontend Team, Growth Team"
            className="w-full px-3 py-2 rounded-lg bg-bg-primary border border-border
              text-text-primary text-sm placeholder:text-text-muted/50
              focus:outline-none focus:border-accent transition-colors"
          />
        </div>

        {/* Personality Traits */}
        <div>
          <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-1.5">
            Personality Traits
          </label>
          <div className="flex flex-wrap gap-1.5">
            {TRAIT_OPTIONS.map((trait) => (
              <button
                key={trait}
                onClick={() => toggleTrait(trait)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium cursor-pointer transition-colors ${
                  traits.includes(trait)
                    ? 'bg-accent text-text-on-purple'
                    : 'bg-bg-primary border border-border text-text-muted hover:text-text-secondary hover:bg-bg-hover'
                }`}
              >
                {trait}
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

        {/* Preview */}
        {name.trim() && (
          <div>
            <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-1.5">
              Soul Preview
            </label>
            <pre className="px-3 py-2 rounded-lg bg-bg-primary border border-border
              text-[11px] text-text-muted font-mono leading-relaxed max-h-32 overflow-y-auto whitespace-pre-wrap">
              {generateSoul(name.trim(), role, department, traits)}
            </pre>
          </div>
        )}

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
