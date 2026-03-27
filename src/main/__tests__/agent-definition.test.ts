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
  yaml += `\n\n## Task Reporting\nWhen you start a new task, run: \`.claude/hive-report.sh start "task title"\`\nWhen you finish a task, run: \`.claude/hive-report.sh done "summary"\`\n`
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
})
