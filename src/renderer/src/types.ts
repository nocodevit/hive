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
  type: 'coding' | 'non-coding'
  department: string
  status: 'working' | 'waiting' | 'done'
  soul: string       // soul.md content
  avatar: AvatarConfig
  enabledSkills: string[]
  preferences: AgentPreferences
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
