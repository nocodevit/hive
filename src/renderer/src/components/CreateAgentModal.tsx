import { useState, useEffect } from 'react'
import Modal from './Modal'
import type { Agent, Project, Zone, AgentTemplate, TemplateSection, SkillInfo } from '../types'
import { defaultAvatar, defaultPreferences, BUILTIN_TEMPLATES, TRAIT_OPTIONS, buildSoulFromTemplate } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  project: Project
  availableSkills: SkillInfo[]
  onCreate: (agent: Agent) => void
}

const RND_ROLES = ['Engineering', 'Product', 'QA', 'Design']
const NON_RND_ROLES = ['Admin', 'HR', 'Marketing', 'BA', 'Operations', 'GM']

export default function CreateAgentModal({ open, onClose, project, availableSkills, onCreate }: Props) {
  const [step, setStep] = useState(0)
  const [customTemplates, setCustomTemplates] = useState<AgentTemplate[]>([])

  // Step 1: Template
  const [selectedTemplate, setSelectedTemplate] = useState<AgentTemplate | null>(null)

  // Step 2: Identity + Sections
  const [name, setName] = useState('')
  const [department, setDepartment] = useState<'R&D' | 'Non-R&D'>('R&D')
  const [role, setRole] = useState('Engineering')
  const [group, setGroup] = useState('')
  const [traits, setTraits] = useState<string[]>([])
  const [sections, setSections] = useState<TemplateSection[]>([])
  const [importedMd, setImportedMd] = useState('')

  // Step 3: Skills
  const [enabledSkills, setEnabledSkills] = useState<string[]>([])

  // Step 4: Settings
  const [model, setModel] = useState('inherit')
  const [effort, setEffort] = useState('high')
  const [zoneId, setZoneId] = useState(project.zones[0]?.id || '')

  const type = department === 'R&D' ? 'coding' as const : 'non-coding' as const
  const roles = department === 'R&D' ? RND_ROLES : NON_RND_ROLES
  const filteredZones = project.zones.filter((z: Zone) => department === 'R&D' ? z.type === 'rnd' : z.type === 'non-rnd')

  useEffect(() => {
    if (open) {
      window.api.templates.list().then(setCustomTemplates)
      setStep(0)
    }
  }, [open])

  const applyTemplate = (t: AgentTemplate) => {
    setSelectedTemplate(t)
    setDepartment(t.department)
    setRole(t.role)
    setSections(t.sections.map(s => ({ ...s })))
    setEnabledSkills(t.suggestedSkills)
    setModel(t.suggestedModel)
    setEffort(t.suggestedEffort)
    const matchZone = project.zones.find((z: Zone) => t.department === 'R&D' ? z.type === 'rnd' : z.type === 'non-rnd')
    if (matchZone) setZoneId(matchZone.id)
    setStep(1)
  }

  const importMdFile = async () => {
    const path = await window.api.dialog.selectFolder('Select .md File')
    // dialog returns folder, we need file — use a workaround
    // Actually, let's read any .md in the selected folder or treat path as file
    if (!path) return
    const content = await (window.api as any).fs?.readFile?.(path)
    if (content) {
      setImportedMd(content)
      setSections([
        { title: 'Role', hint: 'Imported from file', content },
        { title: 'Workflow', hint: 'Add workflow steps', content: '' },
        { title: 'Boundaries', hint: 'Add constraints', content: '' },
        { title: 'Custom', hint: 'Additional instructions', content: '' },
      ])
      setSelectedTemplate({ id: 'imported', name: 'Imported', category: 'imported', department, role, sections: [], suggestedSkills: [], suggestedModel: 'inherit', suggestedEffort: 'high' })
      setStep(1)
    }
  }

  const updateSection = (index: number, content: string) => {
    setSections(prev => prev.map((s, i) => i === index ? { ...s, content } : s))
  }

  const buildPreview = () => {
    return buildSoulFromTemplate(name || 'Agent', sections, traits)
  }

  const handleCreate = () => {
    if (!name.trim() || !zoneId) return
    const soul = buildSoulFromTemplate(name.trim(), sections, traits)
    onCreate({
      id: `agent-${Date.now()}`,
      projectId: project.id,
      zoneId,
      name: name.trim(),
      role, type, department,
      group: group.trim(),
      order: Date.now(),
      status: 'done',
      soul,
      avatar: { ...defaultAvatar },
      enabledSkills,
      model, effort,
      preferences: { ...defaultPreferences }
    })
    // Reset
    setName(''); setGroup(''); setTraits([]); setStep(0); setSelectedTemplate(null)
    setImportedMd(''); setSections([]); setEnabledSkills([])
    onClose()
  }

  const saveAsTemplate = () => {
    if (!name.trim()) return
    const t: AgentTemplate = {
      id: `custom-${Date.now()}`,
      name: name.trim() + ' Template',
      category: 'custom',
      department, role,
      sections: sections.map(s => ({ ...s })),
      suggestedSkills: enabledSkills,
      suggestedModel: model,
      suggestedEffort: effort,
    }
    window.api.templates.save(t)
    setCustomTemplates(prev => [...prev, t])
  }

  return (
    <Modal open={open} onClose={onClose} title={`New Agent — Step ${step + 1}/4`}>
      <div className="space-y-4">

        {/* Step 0: Choose Template */}
        {step === 0 && (
          <>
            <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider">Built-in Templates</label>
            <div className="grid grid-cols-4 gap-1.5">
              {BUILTIN_TEMPLATES.map(t => (
                <button key={t.id} onClick={() => applyTemplate(t)}
                  className="px-2 py-2 rounded-lg text-xs font-medium cursor-pointer transition-colors bg-bg-primary border border-border text-text-secondary hover:bg-accent-subtle hover:text-accent hover:border-accent/30 text-center"
                >{t.name}</button>
              ))}
            </div>

            {customTemplates.length > 0 && (
              <>
                <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mt-3">Custom Templates</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {customTemplates.map(t => (
                    <button key={t.id} onClick={() => applyTemplate(t)}
                      className="px-2 py-2 rounded-lg text-xs font-medium cursor-pointer transition-colors bg-bg-primary border border-border text-accent hover:bg-accent-subtle"
                    >{t.name}</button>
                  ))}
                </div>
              </>
            )}

            <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mt-3">Or Start Blank</label>
            <div className="flex gap-2">
              <button onClick={() => {
                setSections([
                  { title: 'Role', hint: 'Describe what this agent does', content: '' },
                  { title: 'Workflow', hint: 'Step-by-step working process', content: '' },
                  { title: 'Boundaries', hint: 'What should this agent avoid?', content: '' },
                  { title: 'Custom', hint: 'Any additional instructions', content: '' },
                ])
                setStep(1)
              }}
                className="flex-1 px-3 py-2 rounded-lg text-xs border border-border border-dashed text-text-muted hover:bg-bg-hover cursor-pointer"
              >Blank Template</button>
              <button onClick={importMdFile}
                className="flex-1 px-3 py-2 rounded-lg text-xs border border-border border-dashed text-text-muted hover:bg-bg-hover cursor-pointer"
              >Import .md File</button>
            </div>
          </>
        )}

        {/* Step 1: Identity + Sections */}
        {step === 1 && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] text-text-muted uppercase mb-1">Name</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Alex"
                  className="w-full px-3 py-1.5 rounded-lg bg-bg-primary border border-border text-text-primary text-sm focus:outline-none focus:border-accent" />
              </div>
              <div>
                <label className="block text-[10px] text-text-muted uppercase mb-1">Group</label>
                <input type="text" value={group} onChange={e => setGroup(e.target.value)} placeholder="e.g. Frontend Team"
                  className="w-full px-3 py-1.5 rounded-lg bg-bg-primary border border-border text-text-muted text-sm focus:outline-none focus:border-accent" />
              </div>
            </div>

            <div className="flex gap-2">
              <div className="flex gap-1">
                {(['R&D', 'Non-R&D'] as const).map(d => (
                  <button key={d} onClick={() => { setDepartment(d); setRole((d === 'R&D' ? RND_ROLES : NON_RND_ROLES)[0]) }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${department === d ? 'bg-accent text-text-on-purple' : 'bg-bg-primary border border-border text-text-muted'}`}
                  >{d}</button>
                ))}
              </div>
              <select value={role} onChange={e => setRole(e.target.value)}
                className="flex-1 px-3 py-1.5 rounded-lg bg-bg-primary border border-border text-text-primary text-sm cursor-pointer focus:outline-none focus:border-accent">
                {roles.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-[10px] text-text-muted uppercase mb-1">Personality</label>
              <div className="flex flex-wrap gap-1">
                {TRAIT_OPTIONS.map(t => (
                  <button key={t} onClick={() => setTraits(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])}
                    className={`px-2 py-0.5 rounded-full text-[10px] cursor-pointer ${traits.includes(t) ? 'bg-accent text-text-on-purple' : 'bg-bg-primary border border-border text-text-muted hover:bg-bg-hover'}`}
                  >{t}</button>
                ))}
              </div>
            </div>

            {sections.map((sec, i) => (
              <div key={i}>
                <label className="block text-[10px] text-text-muted uppercase mb-1">{sec.title} <span className="normal-case text-text-muted/50">— {sec.hint}</span></label>
                <textarea value={sec.content} onChange={e => updateSection(i, e.target.value)}
                  className="w-full h-20 px-3 py-2 rounded-lg bg-bg-primary border border-border text-text-primary text-xs font-mono resize-y focus:outline-none focus:border-accent"
                  placeholder={sec.hint} />
              </div>
            ))}

            <div className="flex gap-2">
              <button onClick={() => setStep(0)} className="px-3 py-1.5 rounded-lg text-xs text-text-muted hover:bg-bg-hover cursor-pointer">Back</button>
              <button onClick={() => setStep(2)} disabled={!name.trim()}
                className="flex-1 py-1.5 rounded-lg bg-accent text-text-on-purple text-xs font-medium cursor-pointer disabled:opacity-40">Next: Skills</button>
            </div>
          </>
        )}

        {/* Step 2: Skills */}
        {step === 2 && (
          <>
            <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider">Skills</label>
            {availableSkills.length === 0 ? (
              <p className="text-xs text-text-muted">No skills installed.</p>
            ) : (
              (() => {
                const packs = [...new Set(availableSkills.map(s => s.pack))]
                return packs.map(pack => {
                  const packSkills = availableSkills.filter(s => s.pack === pack)
                  return (
                    <div key={pack} className="rounded-lg bg-bg-secondary border border-border overflow-hidden">
                      <div className="px-3 py-2 bg-bg-tertiary border-b border-border flex items-center gap-2">
                        <span className="text-xs font-semibold text-text-primary uppercase">{pack}</span>
                        <button onClick={() => {
                          const all = packSkills.every(s => enabledSkills.includes(s.name))
                          setEnabledSkills(prev => all ? prev.filter(s => !packSkills.some(ps => ps.name === s)) : [...new Set([...prev, ...packSkills.map(s => s.name)])])
                        }} className="text-[10px] text-accent cursor-pointer ml-auto">
                          {packSkills.every(s => enabledSkills.includes(s.name)) ? 'Disable all' : 'Enable all'}
                        </button>
                      </div>
                      {packSkills.map(skill => (
                        <div key={skill.name} className="flex items-center justify-between px-3 py-1.5 border-b border-border last:border-0 hover:bg-bg-hover">
                          <div className="flex-1 min-w-0">
                            <span className="text-xs text-text-primary">/{skill.name}</span>
                            {skill.description && <p className="text-[10px] text-text-muted truncate">{skill.description}</p>}
                          </div>
                          <button onClick={() => setEnabledSkills(prev => prev.includes(skill.name) ? prev.filter(s => s !== skill.name) : [...prev, skill.name])}
                            className={`ml-2 w-8 h-4 rounded-full cursor-pointer relative flex-shrink-0 ${enabledSkills.includes(skill.name) ? 'bg-accent' : 'bg-bg-hover'}`}>
                            <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${enabledSkills.includes(skill.name) ? 'left-[14px]' : 'left-0.5'}`} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )
                })
              })()
            )}
            <div className="flex gap-2">
              <button onClick={() => setStep(1)} className="px-3 py-1.5 rounded-lg text-xs text-text-muted hover:bg-bg-hover cursor-pointer">Back</button>
              <button onClick={() => setStep(3)} className="flex-1 py-1.5 rounded-lg bg-accent text-text-on-purple text-xs font-medium cursor-pointer">Next: Settings</button>
            </div>
          </>
        )}

        {/* Step 3: Settings + Preview + Create */}
        {step === 3 && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] text-text-muted uppercase mb-1">Model</label>
                <select value={model} onChange={e => setModel(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg bg-bg-primary border border-border text-text-primary text-sm cursor-pointer focus:outline-none focus:border-accent">
                  <option value="inherit">Inherit</option>
                  <option value="opus">Opus</option>
                  <option value="sonnet">Sonnet</option>
                  <option value="haiku">Haiku</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-text-muted uppercase mb-1">Effort</label>
                <select value={effort} onChange={e => setEffort(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg bg-bg-primary border border-border text-text-primary text-sm cursor-pointer focus:outline-none focus:border-accent">
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="max">Max</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[10px] text-text-muted uppercase mb-1">Work Zone</label>
              <div className="space-y-1">
                {filteredZones.map((zone: Zone) => (
                  <button key={zone.id} onClick={() => setZoneId(zone.id)}
                    className={`w-full text-left px-3 py-1.5 rounded-lg text-xs cursor-pointer flex items-center gap-2 ${zoneId === zone.id ? 'bg-accent-subtle border border-accent/30 text-accent' : 'bg-bg-primary border border-border text-text-secondary hover:bg-bg-hover'}`}>
                    <span className={`w-2 h-2 rounded-full ${zone.type === 'rnd' ? 'bg-accent' : 'bg-status-working'}`} />
                    <span>{zone.name}</span>
                  </button>
                ))}
                {filteredZones.length === 0 && <p className="text-[10px] text-text-muted">No {department} zones.</p>}
              </div>
            </div>

            <div>
              <label className="block text-[10px] text-text-muted uppercase mb-1">Agent Definition Preview</label>
              <pre className="px-3 py-2 rounded-lg bg-bg-primary border border-border text-[10px] text-text-muted font-mono max-h-32 overflow-y-auto whitespace-pre-wrap">
                {buildPreview()}
              </pre>
            </div>

            <div className="flex gap-2">
              <button onClick={() => setStep(2)} className="px-3 py-1.5 rounded-lg text-xs text-text-muted hover:bg-bg-hover cursor-pointer">Back</button>
              <button onClick={saveAsTemplate} className="px-3 py-1.5 rounded-lg text-xs text-accent hover:bg-accent-subtle cursor-pointer">Save as Template</button>
              <button onClick={handleCreate} disabled={!name.trim() || !zoneId}
                className="flex-1 py-2 rounded-lg bg-accent text-text-on-purple text-sm font-semibold cursor-pointer disabled:opacity-40 hover:bg-accent-hover">
                Create Agent
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
