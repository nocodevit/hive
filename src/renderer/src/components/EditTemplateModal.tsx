import { useState, useEffect } from 'react'
import Modal from './Modal'
import Markdown from 'react-markdown'
import type { AgentTemplate, TemplateSection, Agent, SkillInfo } from '../types'
import { TRAIT_OPTIONS } from '../types'

interface Props {
  open: boolean
  template: AgentTemplate | null
  agents: Agent[]        // all agents to check inheritance
  availableSkills: SkillInfo[]
  onClose: () => void
  onSave: (template: AgentTemplate, syncAgents: boolean) => void
}

const RND_ROLES = ['Engineering', 'Product', 'QA', 'Design']
const NON_RND_ROLES = ['Admin', 'HR', 'Marketing', 'BA', 'Operations', 'GM']

export default function EditTemplateModal({ open, template, agents, availableSkills, onClose, onSave }: Props) {
  const [name, setName] = useState('')
  const [department, setDepartment] = useState<'R&D' | 'Non-R&D'>('R&D')
  const [role, setRole] = useState('Engineering')
  const [sections, setSections] = useState<TemplateSection[]>([])
  const [skills, setSkills] = useState<string[]>([])
  const [model, setModel] = useState('inherit')
  const [effort, setEffort] = useState('high')

  // Count agents using this template
  const inheritingAgents = template
    ? agents.filter(a => a.role === template.role && a.department === template.department)
    : []

  useEffect(() => {
    if (template) {
      setName(template.name)
      setDepartment(template.department)
      setRole(template.role)
      setSections(template.sections.map(s => ({ ...s })))
      setSkills([...template.suggestedSkills])
      setModel(template.suggestedModel)
      setEffort(template.suggestedEffort)
    }
  }, [template])

  const updateSection = (i: number, content: string) => {
    setSections(prev => prev.map((s, idx) => idx === i ? { ...s, content } : s))
  }

  const roles = department === 'R&D' ? RND_ROLES : NON_RND_ROLES

  const handleSave = (sync: boolean) => {
    if (!template) return
    const updated: AgentTemplate = {
      ...template,
      name: name.trim() || template.name,
      department, role,
      sections: sections.map(s => ({ ...s })),
      suggestedSkills: skills,
      suggestedModel: model,
      suggestedEffort: effort,
    }
    onSave(updated, sync)
    onClose()
  }

  if (!template) return null

  // Build preview
  let preview = `# Identity\nYou are [Agent Name].\n\n`
  for (const sec of sections) {
    if (sec.content.trim()) preview += `## ${sec.title}\n${sec.content}\n\n`
  }

  return (
    <Modal open={open} onClose={onClose} title={`Edit Template — ${template.name}`}>
      <div className="space-y-4 max-h-[70vh] overflow-y-auto">
        {/* Name */}
        <div>
          <label className="block text-[10px] text-text-muted uppercase mb-1">Template Name</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)}
            className="w-full px-3 py-1.5 rounded-lg bg-bg-primary border border-border text-text-primary text-sm focus:outline-none focus:border-accent" />
        </div>

        {/* Dept + Role */}
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

        {/* Sections */}
        {sections.map((sec, i) => (
          <div key={i}>
            <label className="block text-[10px] text-text-muted uppercase mb-1">
              {sec.title} <span className="normal-case text-text-muted/50">— {sec.hint}</span>
            </label>
            <textarea value={sec.content} onChange={e => updateSection(i, e.target.value)}
              className="w-full h-24 px-3 py-2 rounded-lg bg-bg-primary border border-border text-text-primary text-xs font-mono resize-y focus:outline-none focus:border-accent"
              placeholder={sec.hint} />
          </div>
        ))}

        {/* Skills */}
        <div>
          <label className="block text-[10px] text-text-muted uppercase mb-1">Default Skills</label>
          <div className="flex flex-wrap gap-1">
            {availableSkills.map(s => (
              <button key={s.name}
                onClick={() => setSkills(prev => prev.includes(s.name) ? prev.filter(x => x !== s.name) : [...prev, s.name])}
                className={`px-2 py-0.5 rounded-full text-[10px] cursor-pointer ${skills.includes(s.name) ? 'bg-accent text-text-on-purple' : 'bg-bg-primary border border-border text-text-muted'}`}
              >/{s.name}</button>
            ))}
          </div>
        </div>

        {/* Model + Effort */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] text-text-muted uppercase mb-1">Model</label>
            <select value={model} onChange={e => setModel(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg bg-bg-primary border border-border text-text-primary text-sm cursor-pointer focus:outline-none focus:border-accent">
              <option value="inherit">Inherit</option><option value="opus">Opus</option><option value="sonnet">Sonnet</option><option value="haiku">Haiku</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-text-muted uppercase mb-1">Effort</label>
            <select value={effort} onChange={e => setEffort(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg bg-bg-primary border border-border text-text-primary text-sm cursor-pointer focus:outline-none focus:border-accent">
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="max">Max</option>
            </select>
          </div>
        </div>

        {/* Preview */}
        <div>
          <label className="block text-[10px] text-text-muted uppercase mb-1">Preview</label>
          <div className="px-3 py-2 rounded-lg bg-bg-primary border border-border max-h-32 overflow-y-auto prose prose-sm prose-invert max-w-none
            [&_h2]:text-xs [&_h2]:text-accent [&_h2]:mt-2 [&_h2]:mb-1
            [&_p]:text-[11px] [&_p]:text-text-secondary [&_p]:my-1
            [&_li]:text-[11px] [&_li]:text-text-secondary">
            <Markdown>{preview}</Markdown>
          </div>
        </div>

        {/* Save buttons */}
        <div className="pt-2 border-t border-border space-y-2">
          {inheritingAgents.length > 0 && (
            <p className="text-[11px] text-text-muted">
              {inheritingAgents.length} agent{inheritingAgents.length > 1 ? 's' : ''} using this role: {inheritingAgents.map(a => a.name).join(', ')}
            </p>
          )}
          <div className="flex gap-2">
            <button onClick={() => handleSave(false)}
              className="flex-1 py-2 rounded-lg bg-bg-hover text-text-primary text-xs font-medium cursor-pointer hover:bg-bg-active">
              Save Template Only
            </button>
            {inheritingAgents.length > 0 && (
              <button onClick={() => handleSave(true)}
                className="flex-1 py-2 rounded-lg bg-accent text-text-on-purple text-xs font-medium cursor-pointer hover:bg-accent-hover">
                Save + Sync {inheritingAgents.length} Agent{inheritingAgents.length > 1 ? 's' : ''}
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}
