import { describe, it, expect } from 'vitest'

// Replicate the CURRENT agent definition generation (>- YAML format)
function generateAgentDefinition(config: {
  agentId: string; name: string; role: string; department: string;
  soul: string; skills: string[]; model: string; effort: string;
}, port: number): string {
  const agentName = `hive-${config.agentId}`
  const curlCmd = (endpoint: string, jsonBody: string) =>
    `curl -s -X POST http://127.0.0.1:${port}${endpoint} -H "Content-Type: application/json" -d '${jsonBody}' > /dev/null 2>&1`

  const yamlHookBlock = (event: string, cmd: string) =>
    `  ${event}:\n    - matcher: ""\n      hooks:\n        - type: command\n          command: >-\n            ${cmd}\n`

  let yaml = `---\n`
  yaml += `name: ${agentName}\n`
  yaml += `description: "${config.name} - ${config.role} specialist"\n`
  yaml += `model: ${config.model || 'inherit'}\n`
  yaml += `effort: ${config.effort || 'high'}\n`
  if (config.skills.length > 0) {
    yaml += `skills:\n${config.skills.map(s => `  - ${s}`).join('\n')}\n`
  }
  yaml += `hooks:\n`
  yaml += yamlHookBlock('PreToolUse', curlCmd('/status', `{"agentId":"${config.agentId}","status":"working"}`))
  yaml += yamlHookBlock('Stop', curlCmd('/status', `{"agentId":"${config.agentId}","status":"waiting"}`))
  yaml += `---\n\n`
  yaml += config.soul
  if (!config.soul.includes('Task Reporting')) {
    yaml += `\n\n## Task Reporting\nWhen you start a new task, run: \`.claude/hive-report.sh start "task title"\`\nWhen you finish a task, run: \`.claude/hive-report.sh done "summary"\`\n`
  }
  if (!config.soul.includes('Persistent Memory')) {
    yaml += `\n\n## Persistent Memory\n`
    yaml += `You have a persistent memory folder at \`.claude/memory/\` (symlinked to \`~/.hive/memory/${config.agentId}/\`). Files there survive across every session — resume, restart, compact, or a fresh terminal on a different day.\n\n`
    yaml += `**At the start of every session**, run \`ls .claude/memory/\` and read any files present, so you continue from where you left off instead of relearning.\n\n`
    yaml += `**During work**, keep these files current as you make progress and discoveries:\n`
    yaml += `- \`PROGRESS.md\` — what you're working on now, decisions made, next steps\n`
    yaml += `- \`FACTS.md\` — invariants you've discovered about the codebase (paths, conventions, gotchas)\n`
    yaml += `- \`HANDOFF.md\` — the single most critical piece of state a future session needs to pick up cleanly\n\n`
    yaml += `**Before a substantial pause** (end of task, before you stop, before /compact), update whichever of these matter so future-you has continuity. Prefer editing existing files over creating new ones; keep each file concise.\n`
  }
  return yaml
}

// Verify YAML is parseable
function parseYamlFrontmatter(content: string): Record<string, any> | null {
  try {
    const parts = content.split('---')
    if (parts.length < 3) return null
    const frontmatter = parts[1].trim()
    // Simple YAML parser for flat keys
    const result: Record<string, any> = {}
    let currentKey = ''
    for (const line of frontmatter.split('\n')) {
      const match = line.match(/^(\w+):(.*)/)
      if (match) {
        currentKey = match[1]
        const val = match[2].trim()
        if (val) result[currentKey] = val.replace(/^"(.*)"$/, '$1')
      }
    }
    return result
  } catch { return null }
}

describe('Agent Definition Generation (v0.6.0+ >- format)', () => {
  const baseConfig = {
    agentId: 'agent-123', name: 'David', role: 'Engineering', department: 'R&D',
    soul: '# Identity\nYou are David.', skills: [] as string[], model: 'inherit', effort: 'high'
  }

  it('generates valid YAML frontmatter', () => {
    const def = generateAgentDefinition(baseConfig, 17710)
    const parsed = parseYamlFrontmatter(def)
    expect(parsed).not.toBeNull()
    expect(parsed!.name).toBe('hive-agent-123')
  })

  it('uses >- folded scalar for hook commands (no double-quote nesting)', () => {
    const def = generateAgentDefinition(baseConfig, 17710)
    expect(def).toContain('command: >-')
    // Should NOT have command: "curl ... which caused YAML parse failures
    expect(def).not.toMatch(/command: "curl/)
  })

  it('hook commands contain Content-Type header without breaking YAML', () => {
    const def = generateAgentDefinition(baseConfig, 17710)
    expect(def).toContain('Content-Type: application/json')
    // The entire definition should be parseable as YAML frontmatter
    const parsed = parseYamlFrontmatter(def)
    expect(parsed).not.toBeNull()
  })

  it('includes agent name and description', () => {
    const def = generateAgentDefinition(baseConfig, 17710)
    expect(def).toContain('name: hive-agent-123')
    expect(def).toContain('David - Engineering specialist')
  })

  it('includes model and effort', () => {
    const def = generateAgentDefinition({ ...baseConfig, model: 'sonnet', effort: 'low' }, 17710)
    expect(def).toContain('model: sonnet')
    expect(def).toContain('effort: low')
  })

  it('includes skills when provided', () => {
    const def = generateAgentDefinition({ ...baseConfig, skills: ['review', 'qa'] }, 17710)
    expect(def).toContain('skills:')
    expect(def).toContain('  - review')
    expect(def).toContain('  - qa')
  })

  it('omits skills section when empty', () => {
    const def = generateAgentDefinition(baseConfig, 17710)
    expect(def).not.toContain('skills:')
  })

  it('includes both PreToolUse and Stop hooks', () => {
    const def = generateAgentDefinition(baseConfig, 17710)
    expect(def).toContain('PreToolUse:')
    expect(def).toContain('Stop:')
    expect(def).toContain('"status":"working"')
    expect(def).toContain('"status":"waiting"')
  })

  it('hooks use correct agentId and port', () => {
    const def = generateAgentDefinition({ ...baseConfig, agentId: 'agent-xyz' }, 9999)
    expect(def).toContain('agent-xyz')
    expect(def).toContain('9999')
  })

  it('includes soul content after frontmatter', () => {
    const def = generateAgentDefinition(baseConfig, 17710)
    expect(def).toContain('# Identity')
    expect(def).toContain('You are David.')
  })

  it('includes task reporting instructions', () => {
    const def = generateAgentDefinition(baseConfig, 17710)
    expect(def).toContain('hive-report.sh start')
    expect(def).toContain('hive-report.sh done')
  })

  it('proper YAML delimiters', () => {
    const def = generateAgentDefinition(baseConfig, 17710)
    expect(def.startsWith('---\n')).toBe(true)
    const secondDelimiter = def.indexOf('---', 4)
    expect(secondDelimiter).toBeGreaterThan(0)
  })

  it('injects Persistent Memory section pointing at .claude/memory/', () => {
    const def = generateAgentDefinition(baseConfig, 17710)
    expect(def).toContain('## Persistent Memory')
    expect(def).toContain('.claude/memory/')
    expect(def).toContain('~/.hive/memory/agent-123/')
    expect(def).toContain('ls .claude/memory/')
    expect(def).toContain('PROGRESS.md')
    expect(def).toContain('FACTS.md')
    expect(def).toContain('HANDOFF.md')
  })

  it('memory section carries the correct agentId path per-agent', () => {
    const a = generateAgentDefinition({ ...baseConfig, agentId: 'agent-alpha' }, 17710)
    const b = generateAgentDefinition({ ...baseConfig, agentId: 'agent-beta' }, 17710)
    expect(a).toContain('~/.hive/memory/agent-alpha/')
    expect(a).not.toContain('~/.hive/memory/agent-beta/')
    expect(b).toContain('~/.hive/memory/agent-beta/')
    expect(b).not.toContain('~/.hive/memory/agent-alpha/')
  })

  it('does NOT duplicate Persistent Memory when soul already contains it (idempotent)', () => {
    const soulWithMemory = '# Identity\nYou are David.\n\n## Persistent Memory\n(user-authored block)'
    const def = generateAgentDefinition({ ...baseConfig, soul: soulWithMemory }, 17710)
    const occurrences = def.match(/## Persistent Memory/g)?.length ?? 0
    expect(occurrences).toBe(1)
    expect(def).toContain('(user-authored block)')
    expect(def).not.toContain('~/.hive/memory/agent-123/')
  })

  it('does NOT duplicate Task Reporting when soul already contains it (regression: mirror to real impl)', () => {
    const soulWithTaskReporting = '# Identity\n\n## Task Reporting\n(user override)'
    const def = generateAgentDefinition({ ...baseConfig, soul: soulWithTaskReporting }, 17710)
    const occurrences = def.match(/## Task Reporting/g)?.length ?? 0
    expect(occurrences).toBe(1)
    expect(def).toContain('(user override)')
  })

  it('memory section appears after Task Reporting (stable ordering)', () => {
    const def = generateAgentDefinition(baseConfig, 17710)
    const taskIdx = def.indexOf('## Task Reporting')
    const memIdx = def.indexOf('## Persistent Memory')
    expect(taskIdx).toBeGreaterThan(0)
    expect(memIdx).toBeGreaterThan(taskIdx)
  })
})
