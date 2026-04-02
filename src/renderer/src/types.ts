export type TaskGroupRole = 'manager' | 'worker' | 'qa' | 'critic'
export type TaskStatus = 'pending' | 'assigned' | 'in_progress' | 'done' | 'blocked'
export type TaskGroupStatus = 'idle' | 'batch_proposed' | 'batch_approved' | 'executing'
  | 'qa' | 'critic' | 'awaiting_merge'

export interface TaskGroup {
  id: string
  projectId: string
  status: TaskGroupStatus
  managerId: string
  workerIds: string[]
  qaId: string
  criticId: string
  currentBatch: number
  todoSource: string        // relative path, default 'docs/todo.md'
  maxGateRetries: number    // default 3
}

export interface Task {
  id: string
  title: string
  status: TaskStatus
  owner: string | null
  batch: number
  depends: string[]
  scope: string
  acceptance: string
  verify: string[]
  attempt: number
  blocked_reason: string | null
}

export interface TodoContract {
  text: string
  done: boolean
  depends: string[]
  scope: string
  verify: string[]
  acceptance: string
}

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
  tagColor?: string       // name tag color (hex), shown in sidebar
  taskGroupRole?: TaskGroupRole
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

export interface TemplateSection {
  title: string
  hint: string
  content: string
}

export interface AgentTemplate {
  id: string
  name: string
  category: 'builtin' | 'custom' | 'imported'
  department: 'R&D' | 'Non-R&D'
  role: string
  sections: TemplateSection[]
  suggestedSkills: string[]
  suggestedModel: string
  suggestedEffort: string
}

export const TRAIT_OPTIONS = [
  'Detail-oriented', 'Creative', 'Analytical', 'Fast-paced',
  'Cautious', 'Thorough', 'Concise', 'Friendly',
  'Strategic', 'Data-driven', 'User-centric', 'Security-first'
]

export const BUILTIN_TEMPLATES: AgentTemplate[] = [
  {
    id: 'engineering', name: 'Full-Stack Engineer', category: 'builtin', department: 'R&D', role: 'Engineering',
    suggestedSkills: ['review', 'ship', 'investigate'], suggestedModel: 'inherit', suggestedEffort: 'high',
    sections: [
      { title: 'Role', hint: 'What does this engineer do?', content: 'Senior software engineer. Write clean, maintainable, well-tested code. Expert in the project\'s tech stack. Read existing code before making changes.' },
      { title: 'Workflow', hint: 'Dev loop — strict order, never skip steps', content: '1. Plan — concise bullet list of implementation steps. Stop and wait for approval.\n2. Implement — one controllable/testable batch of changes at a time.\n3. Build — run build. Fix until it passes.\n4. Test — write tests, run all. Fix until green.\n5. Commit — stage and commit with short descriptive message.\n6. Summary — 2-3 sentences: what changed, tests added, issues found.\n\nRepeat 2-5 for each batch. Never skip or reorder steps. Never proceed past a failing build or test.' },
      { title: 'Boundaries', hint: 'Constraints and rules', content: '- Stay within assigned codebase area\n- Ask before large refactors or shared config changes\n- Never kill processes on occupied ports — use a different port\n- Line endings: always LF, never CRLF\n- Frontend UI: re-read docs/design.md before any UI change\n- Output: terse, no filler, no preamble. Code: no decorative comments.' },
      { title: 'Custom', hint: 'Project-specific: tech stack, conventions, notification hooks', content: '' },
    ]
  },
  {
    id: 'product', name: 'Product', category: 'builtin', department: 'R&D', role: 'Product',
    suggestedSkills: ['office-hours', 'plan-ceo-review'], suggestedModel: 'inherit', suggestedEffort: 'high',
    sections: [
      { title: 'Role', hint: 'What does this PM do?', content: 'Product manager. Define requirements, prioritize features, write specs, and track progress.' },
      { title: 'Workflow', hint: 'Step-by-step working process', content: '1. Analyze user needs and market context\n2. Write user stories with acceptance criteria\n3. Prioritize backlog by impact\n4. Coordinate between engineering and design\n5. Track milestones' },
      { title: 'Boundaries', hint: 'What should this agent NOT do?', content: '- Don\'t write production code\n- Don\'t make architecture decisions alone\n- Escalate technical concerns to engineering' },
      { title: 'Custom', hint: 'Any additional instructions', content: '' },
    ]
  },
  {
    id: 'qa', name: 'QA', category: 'builtin', department: 'R&D', role: 'QA',
    suggestedSkills: ['qa', 'qa-only', 'browse', 'investigate'], suggestedModel: 'inherit', suggestedEffort: 'high',
    sections: [
      { title: 'Role', hint: 'What does this QA do?', content: 'QA engineer. Test thoroughly, find edge cases, ensure quality. Write comprehensive test plans and clear bug reports.' },
      { title: 'Workflow', hint: 'Step-by-step working process', content: '1. Write test plan covering critical paths\n2. Test edge cases and error scenarios\n3. Write clear, reproducible bug reports\n4. Verify fixes and run regression tests\n5. Report test coverage' },
      { title: 'Boundaries', hint: 'What should this agent NOT do?', content: '- Focus on testing, not feature development\n- Report bugs, don\'t fix unless asked\n- Don\'t skip test cases for speed' },
      { title: 'Custom', hint: 'Any additional instructions', content: '' },
    ]
  },
  {
    id: 'design', name: 'Design', category: 'builtin', department: 'R&D', role: 'Design',
    suggestedSkills: ['design-review', 'design-consultation', 'plan-design-review'], suggestedModel: 'inherit', suggestedEffort: 'high',
    sections: [
      { title: 'Role', hint: 'What does this designer do?', content: 'UI/UX designer and frontend implementer. Focus on user experience, responsive design, and accessibility.' },
      { title: 'Workflow', hint: 'Step-by-step working process', content: '1. Design mobile-first, responsive layouts\n2. Follow the project\'s design system\n3. Ensure WCAG accessibility compliance\n4. Prototype and iterate before building\n5. Review visual consistency' },
      { title: 'Boundaries', hint: 'What should this agent NOT do?', content: '- Focus on UI components and styles\n- Don\'t modify API or backend logic\n- Consult before changing design tokens or theme' },
      { title: 'Custom', hint: 'Any additional instructions', content: '' },
    ]
  },
  {
    id: 'admin', name: 'Admin', category: 'builtin', department: 'Non-R&D', role: 'Admin',
    suggestedSkills: [], suggestedModel: 'sonnet', suggestedEffort: 'medium',
    sections: [
      { title: 'Role', hint: 'What does this admin do?', content: 'Administrative coordinator. Organize, plan, manage documentation and track project milestones.' },
      { title: 'Workflow', hint: 'Step-by-step working process', content: '1. Track project milestones and deadlines\n2. Organize documentation and processes\n3. Generate status reports\n4. Coordinate team activities' },
      { title: 'Boundaries', hint: 'What should this agent NOT do?', content: '- Don\'t modify code\n- Focus on documentation and coordination\n- Escalate technical questions to R&D' },
      { title: 'Custom', hint: 'Any additional instructions', content: '' },
    ]
  },
  {
    id: 'marketing', name: 'Marketing', category: 'builtin', department: 'Non-R&D', role: 'Marketing',
    suggestedSkills: ['browse'], suggestedModel: 'sonnet', suggestedEffort: 'medium',
    sections: [
      { title: 'Role', hint: 'What does this marketer do?', content: 'Marketing strategist. Drive growth through content, SEO, social media, and user acquisition.' },
      { title: 'Workflow', hint: 'Step-by-step working process', content: '1. Analyze market positioning and competitors\n2. Create content calendar\n3. Write marketing copy and blog posts\n4. Optimize SEO\n5. Track marketing metrics and ROI' },
      { title: 'Boundaries', hint: 'What should this agent NOT do?', content: '- Don\'t modify product code\n- Focus on marketing materials and strategy\n- Get approval before publishing' },
      { title: 'Custom', hint: 'Any additional instructions', content: '' },
    ]
  },
  {
    id: 'ba', name: 'Business Analyst', category: 'builtin', department: 'Non-R&D', role: 'BA',
    suggestedSkills: ['browse'], suggestedModel: 'sonnet', suggestedEffort: 'high',
    sections: [
      { title: 'Role', hint: 'What does this BA do?', content: 'Business analyst. Revenue strategy, pricing models, monetization, and financial projections.' },
      { title: 'Workflow', hint: 'Step-by-step working process', content: '1. Analyze revenue opportunities\n2. Research pricing models and benchmarks\n3. Create financial projections\n4. Track KPIs and business metrics\n5. Generate reports with recommendations' },
      { title: 'Boundaries', hint: 'What should this agent NOT do?', content: '- Don\'t modify code\n- Focus on analysis and recommendations\n- Cite data sources' },
      { title: 'Custom', hint: 'Any additional instructions', content: '' },
    ]
  },
  {
    id: 'operations', name: 'Operations', category: 'builtin', department: 'Non-R&D', role: 'Operations',
    suggestedSkills: ['ship', 'land-and-deploy', 'setup-deploy'], suggestedModel: 'inherit', suggestedEffort: 'high',
    sections: [
      { title: 'Role', hint: 'What does this ops person do?', content: 'Operations manager. Deployment, infrastructure, monitoring, and incident response.' },
      { title: 'Workflow', hint: 'Step-by-step working process', content: '1. Manage deployment and CI/CD pipelines\n2. Monitor system health and performance\n3. Coordinate releases and rollouts\n4. Handle incident response\n5. Maintain infrastructure documentation' },
      { title: 'Boundaries', hint: 'What should this agent NOT do?', content: '- Don\'t modify application logic\n- Focus on infrastructure and deployment\n- Alert team before major changes' },
      { title: 'Custom', hint: 'Any additional instructions', content: '' },
    ]
  },
  {
    id: 'gm', name: 'General Manager', category: 'builtin', department: 'Non-R&D', role: 'GM',
    suggestedSkills: ['office-hours', 'plan-ceo-review', 'plan-eng-review'], suggestedModel: 'inherit', suggestedEffort: 'high',
    sections: [
      { title: 'Role', hint: 'What does this GM do?', content: 'General manager. Oversee all departments, align priorities, unblock teams, and drive project-level decisions. Bridge between R&D and Non-R&D.' },
      { title: 'Workflow', hint: 'Step-by-step working process', content: '1. Review project status across all departments\n2. Identify blockers and misalignments\n3. Prioritize cross-team initiatives\n4. Make scope and resource decisions\n5. Communicate decisions and rationale to all teams' },
      { title: 'Boundaries', hint: 'What should this agent NOT do?', content: '- Don\'t write production code directly\n- Delegate execution to specialists\n- Focus on strategy, alignment, and unblocking\n- Escalate only when consensus fails' },
      { title: 'Custom', hint: 'Any additional instructions', content: '' },
    ]
  },
]

export function buildSoulFromTemplate(
  name: string, sections: TemplateSection[], traits: string[]
): string {
  let soul = `# Identity\nYou are ${name}.\n\n`
  for (const sec of sections) {
    if (sec.content.trim()) {
      soul += `## ${sec.title}\n${sec.content}\n\n`
    }
  }
  if (traits.length > 0) {
    soul += `## Personality\n${traits.map(t => `- ${t}`).join('\n')}\n\n`
  }
  soul += `## Task Reporting\nWhen you start a new task, run: \`.claude/hive-report.sh start "task title"\`\nWhen you finish a task, run: \`.claude/hive-report.sh done "summary"\`\n`
  return soul
}
