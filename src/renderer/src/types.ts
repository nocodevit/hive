export interface Zone {
  id: string
  name: string
  path: string
  type: 'rnd' | 'non-rnd'  // R&D (has .git) or non-R&D (docs/files)
  hasGit: boolean
}

export interface Project {
  id: string
  name: string
  officePath: string  // root office folder
  zones: Zone[]
}

export interface AgentPreferences {
  autoRunClaude: boolean
  startupCommand: string
}

export interface Agent {
  id: string
  projectId: string
  zoneId: string
  name: string
  role: string       // e.g. "Frontend Dev", "Marketing Manager"
  type: 'coding' | 'non-coding'
  department: string
  group: string      // team group within department, e.g. "Frontend Team"
  order: number      // sort order within group
  status: 'working' | 'waiting' | 'done'
  soul: string       // agent personality/instructions (markdown body of agent definition)
  avatar: AvatarConfig
  enabledSkills: string[]
  preferences: AgentPreferences
  model: string      // claude model: 'inherit', 'sonnet', 'opus', 'haiku'
  effort: string     // 'low', 'medium', 'high', 'max'
  worktreePath?: string   // git worktree path (coding agents only)
  worktreeBranch?: string // git branch name
}

export const defaultPreferences: AgentPreferences = {
  autoRunClaude: false,
  startupCommand: ''
}

export interface SkillInfo {
  name: string
  pack: string
  path: string
  description: string
}

export interface AvatarConfig {
  skinTone: string
  hairStyle: string
  hairColor: string
  topStyle: string
  topColor: string
  bottomStyle: string
  bottomColor: string
  hat: string
  accessories: string[]
}

export const defaultAvatar: AvatarConfig = {
  skinTone: '#f5d0a9',
  hairStyle: 'short',
  hairColor: '#2c1810',
  topStyle: 'tee',
  topColor: '#7c3aed',
  bottomStyle: 'pants',
  bottomColor: '#1e293b',
  hat: 'none',
  accessories: []
}

export const defaultSoul = `# Soul

## Role
You are a helpful coding assistant.

## Personality
- Professional and concise
- Focus on clean, maintainable code
- Explain decisions briefly

## Boundaries
- Stay within the project scope
- Ask before making large changes
`

export interface AgentPreset {
  role: string
  type: 'coding' | 'non-coding'
  department: string
  soul: string
}

export const agentPresets: AgentPreset[] = [
  {
    role: 'Frontend Dev',
    type: 'coding',
    department: 'Engineering',
    soul: `# Soul\n\n## Role\nSenior frontend developer. React, TypeScript, CSS expert.\n\n## Personality\n- Opinionated about UX and code quality\n- Prefers functional components and hooks\n- Always suggests tests and accessibility\n\n## Boundaries\n- Focus on frontend code only\n- Ask before modifying shared utilities`
  },
  {
    role: 'Backend Dev',
    type: 'coding',
    department: 'Engineering',
    soul: `# Soul\n\n## Role\nBackend engineer. API design, database, infrastructure.\n\n## Personality\n- Security-first mindset\n- Prefers simple, scalable solutions\n- Documents API contracts\n\n## Boundaries\n- Don't touch frontend code\n- Validate all inputs`
  },
  {
    role: 'QA Engineer',
    type: 'coding',
    department: 'QA',
    soul: `# Soul\n\n## Role\nQA engineer. Testing, bug hunting, quality assurance.\n\n## Personality\n- Thorough and detail-oriented\n- Thinks about edge cases\n- Writes clear bug reports\n\n## Boundaries\n- Focus on testing, not feature development\n- Report bugs, don't fix them unless asked`
  },
  {
    role: 'Marketing Manager',
    type: 'non-coding',
    department: 'Operations',
    soul: `# Soul\n\n## Role\nMarketing strategist. Content, SEO, social media, growth.\n\n## Personality\n- Data-driven and creative\n- Focuses on user acquisition and retention\n- Writes compelling copy\n\n## Tasks\n- Analyze market positioning\n- Create content calendar\n- Write marketing copy\n- SEO optimization suggestions`
  },
  {
    role: 'Business Analyst',
    type: 'non-coding',
    department: 'Operations',
    soul: `# Soul\n\n## Role\nBusiness analyst. Revenue, pricing, monetization strategy.\n\n## Personality\n- Analytical and strategic\n- Focuses on unit economics\n- Creates actionable recommendations\n\n## Tasks\n- Analyze revenue opportunities\n- Research pricing models\n- Create business reports\n- Track KPIs and metrics`
  },
  {
    role: 'Researcher',
    type: 'non-coding',
    department: 'Research',
    soul: `# Soul\n\n## Role\nResearch analyst. Market research, competitive analysis, trends.\n\n## Personality\n- Curious and thorough\n- Presents findings clearly\n- Cites sources\n\n## Tasks\n- Competitive analysis\n- Market research\n- Technology evaluation\n- Trend reports`
  },
  {
    role: 'Design Lead',
    type: 'coding',
    department: 'Design',
    soul: `# Soul\n\n## Role\nUI/UX designer and frontend implementer.\n\n## Personality\n- Aesthetic and user-centric\n- Follows design systems\n- Accessibility advocate\n\n## Boundaries\n- Focus on UI components and styles\n- Consult before changing design tokens`
  }
]
