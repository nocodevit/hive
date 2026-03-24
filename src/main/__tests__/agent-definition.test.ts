import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { existsSync, readFileSync, rmSync, mkdirSync } from 'fs'

// Replicate agent definition generation for testing
function generateAgentDefinition(config: {
  agentId: string; name: string; role: string; department: string;
  soul: string; skills: string[]; model: string; effort: string;
}, port: number): string {
  const agentName = `hive-${config.agentId}`
  const curlPost = (endpoint: string, jsonBody: string) =>
    `curl -s -X POST http://127.0.0.1:${port}${endpoint} -H "Content-Type: application/json" -d '${jsonBody}' > /dev/null 2>&1`

  let yaml = `---\n`
  yaml += `name: ${agentName}\n`
  yaml += `description: "${config.name} - ${config.role} specialist"\n`
  yaml += `model: ${config.model || 'inherit'}\n`
  yaml += `effort: ${config.effort || 'high'}\n`
  if (config.skills.length > 0) {
    yaml += `skills:\n${config.skills.map(s => `  - ${s}`).join('\n')}\n`
  }
  yaml += `hooks:\n`
  yaml += `  PreToolUse:\n    - matcher: ""\n      hooks:\n        - type: command\n          command: "${curlPost('/status', `{"agentId":"${config.agentId}","status":"working"}`)}"\n`
  yaml += `  Stop:\n    - matcher: ""\n      hooks:\n        - type: command\n          command: "${curlPost('/status', `{"agentId":"${config.agentId}","status":"waiting"}`)}"\n`
  yaml += `---\n\n`
  yaml += config.soul
  yaml += `\n\n## Task Reporting\nWhen you start a new task, run: \`.claude/hive-report.sh start "task title"\`\nWhen you finish a task, run: \`.claude/hive-report.sh done "summary"\`\n`
  return yaml
}

describe('Agent Definition Generation', () => {
  it('includes agent name in frontmatter', () => {
    const def = generateAgentDefinition({
      agentId: 'agent-123', name: 'David', role: 'Engineering', department: 'R&D',
      soul: '# Soul\nYou are David', skills: [], model: 'inherit', effort: 'high'
    }, 17710)
    expect(def).toContain('name: hive-agent-123')
    expect(def).toContain('David - Engineering specialist')
  })

  it('includes model and effort', () => {
    const def = generateAgentDefinition({
      agentId: 'a1', name: 'Test', role: 'QA', department: 'R&D',
      soul: '', skills: [], model: 'sonnet', effort: 'low'
    }, 17710)
    expect(def).toContain('model: sonnet')
    expect(def).toContain('effort: low')
  })

  it('includes skills when provided', () => {
    const def = generateAgentDefinition({
      agentId: 'a1', name: 'Test', role: 'QA', department: 'R&D',
      soul: '', skills: ['review', 'qa'], model: 'inherit', effort: 'high'
    }, 17710)
    expect(def).toContain('skills:')
    expect(def).toContain('  - review')
    expect(def).toContain('  - qa')
  })

  it('omits skills section when empty', () => {
    const def = generateAgentDefinition({
      agentId: 'a1', name: 'Test', role: 'QA', department: 'R&D',
      soul: '', skills: [], model: 'inherit', effort: 'high'
    }, 17710)
    expect(def).not.toContain('skills:')
  })

  it('includes hooks with correct agentId and port', () => {
    const def = generateAgentDefinition({
      agentId: 'agent-456', name: 'Test', role: 'QA', department: 'R&D',
      soul: '', skills: [], model: 'inherit', effort: 'high'
    }, 9999)
    expect(def).toContain('PreToolUse:')
    expect(def).toContain('Stop:')
    expect(def).toContain('agent-456')
    expect(def).toContain('9999')
    expect(def).toContain('"status":"working"')
    expect(def).toContain('"status":"waiting"')
  })

  it('includes soul content as markdown body', () => {
    const soul = '# Identity\nYou are David, a frontend engineer.\n\n# Personality\n- Creative'
    const def = generateAgentDefinition({
      agentId: 'a1', name: 'David', role: 'Engineering', department: 'R&D',
      soul, skills: [], model: 'inherit', effort: 'high'
    }, 17710)
    expect(def).toContain('# Identity')
    expect(def).toContain('You are David, a frontend engineer.')
    expect(def).toContain('- Creative')
  })

  it('includes task reporting instructions', () => {
    const def = generateAgentDefinition({
      agentId: 'a1', name: 'Test', role: 'QA', department: 'R&D',
      soul: '', skills: [], model: 'inherit', effort: 'high'
    }, 17710)
    expect(def).toContain('hive-report.sh start')
    expect(def).toContain('hive-report.sh done')
  })

  it('uses correct YAML frontmatter delimiters', () => {
    const def = generateAgentDefinition({
      agentId: 'a1', name: 'Test', role: 'QA', department: 'R&D',
      soul: 'content', skills: [], model: 'inherit', effort: 'high'
    }, 17710)
    expect(def.startsWith('---\n')).toBe(true)
    expect(def).toContain('\n---\n\ncontent')
  })
})
