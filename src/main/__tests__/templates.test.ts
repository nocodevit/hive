import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from 'fs'

const TEST_DIR = join(__dirname, '__test_templates__')

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
  mkdirSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
})

// Replicate template CRUD logic
function saveTemplate(dir: string, template: any) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${template.id}.json`), JSON.stringify(template, null, 2))
}

function listTemplates(dir: string): any[] {
  mkdirSync(dir, { recursive: true })
  try {
    return readdirSync(dir).filter(f => f.endsWith('.json')).map(f => {
      try { return JSON.parse(readFileSync(join(dir, f), 'utf-8')) } catch { return null }
    }).filter(Boolean)
  } catch { return [] }
}

function deleteTemplate(dir: string, id: string) {
  const f = join(dir, `${id}.json`)
  try { if (existsSync(f)) require('fs').unlinkSync(f) } catch {}
}

describe('Template CRUD', () => {
  it('saves and lists templates', () => {
    saveTemplate(TEST_DIR, { id: 't1', name: 'Test Template', role: 'Engineering' })
    const list = listTemplates(TEST_DIR)
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('Test Template')
  })

  it('lists multiple templates', () => {
    saveTemplate(TEST_DIR, { id: 't1', name: 'Template A' })
    saveTemplate(TEST_DIR, { id: 't2', name: 'Template B' })
    expect(listTemplates(TEST_DIR)).toHaveLength(2)
  })

  it('deletes template', () => {
    saveTemplate(TEST_DIR, { id: 't1', name: 'To Delete' })
    deleteTemplate(TEST_DIR, 't1')
    expect(listTemplates(TEST_DIR)).toHaveLength(0)
  })

  it('returns empty for nonexistent dir', () => {
    expect(listTemplates(join(TEST_DIR, 'nope'))).toEqual([])
  })

  it('overwrites existing template', () => {
    saveTemplate(TEST_DIR, { id: 't1', name: 'V1' })
    saveTemplate(TEST_DIR, { id: 't1', name: 'V2' })
    const list = listTemplates(TEST_DIR)
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('V2')
  })
})

describe('buildSoulFromTemplate', () => {
  // Import inline since it's a pure function
  function buildSoulFromTemplate(name: string, sections: { title: string; hint: string; content: string }[], traits: string[]): string {
    let soul = `# Identity\nYou are ${name}.\n\n`
    for (const sec of sections) {
      if (sec.content.trim()) soul += `## ${sec.title}\n${sec.content}\n\n`
    }
    if (traits.length > 0) soul += `## Personality\n${traits.map(t => `- ${t}`).join('\n')}\n\n`
    soul += `## Task Reporting\nWhen you start a new task, run: \`.claude/hive-report.sh start "task title"\`\nWhen you finish a task, run: \`.claude/hive-report.sh done "summary"\`\n`
    return soul
  }

  it('includes agent name', () => {
    const soul = buildSoulFromTemplate('David', [], [])
    expect(soul).toContain('You are David')
  })

  it('includes sections with content', () => {
    const sections = [
      { title: 'Role', hint: '', content: 'Senior engineer' },
      { title: 'Empty', hint: '', content: '' },
    ]
    const soul = buildSoulFromTemplate('Test', sections, [])
    expect(soul).toContain('## Role\nSenior engineer')
    expect(soul).not.toContain('## Empty')
  })

  it('includes traits', () => {
    const soul = buildSoulFromTemplate('Test', [], ['Creative', 'Thorough'])
    expect(soul).toContain('- Creative')
    expect(soul).toContain('- Thorough')
  })

  it('includes task reporting', () => {
    const soul = buildSoulFromTemplate('Test', [], [])
    expect(soul).toContain('hive-report.sh start')
    expect(soul).toContain('hive-report.sh done')
  })

  it('handles full template', () => {
    const sections = [
      { title: 'Role', hint: '', content: 'Frontend dev' },
      { title: 'Workflow', hint: '', content: '1. Read code\n2. Write tests' },
    ]
    const soul = buildSoulFromTemplate('Alex', sections, ['Detail-oriented'])
    expect(soul).toContain('You are Alex')
    expect(soul).toContain('## Role\nFrontend dev')
    expect(soul).toContain('## Workflow\n1. Read code')
    expect(soul).toContain('- Detail-oriented')
  })
})
