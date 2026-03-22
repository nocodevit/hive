import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs'

// Data persistence
export function loadDataFromDir(dataDir: string, dataFile: string): Record<string, unknown> {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
  if (!existsSync(dataFile)) return { projects: [], agents: [] }
  return JSON.parse(readFileSync(dataFile, 'utf-8'))
}

export function saveDataToDir(dataDir: string, dataFile: string, data: Record<string, unknown>) {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
  writeFileSync(dataFile, JSON.stringify(data, null, 2))
}

// Todo parsing
export function parseTodoLine(line: string): { done: boolean; text: string } | null {
  const match = line.match(/^[\s]*[-*]\s*\[([ xX])\]\s+(.+)/)
  if (!match) return null
  return { done: match[1].toLowerCase() === 'x', text: match[2].trim() }
}

// Todo categorization
export function categorizeTodo(text: string): string {
  const lower = text.toLowerCase()
  if (lower.includes('market') || lower.includes('seo') || lower.includes('social') || lower.includes('content') || lower.includes('campaign')) {
    return 'marketing'
  }
  if (lower.includes('monetiz') || lower.includes('pricing') || lower.includes('revenue') || lower.includes('payment') || lower.includes('subscri')) {
    return 'monetizing'
  }
  if (lower.includes('bug') || lower.includes('fix') || lower.includes('test') || lower.includes('refactor') || lower.includes('feature') || lower.includes('implement')) {
    return 'rd'
  }
  if (lower.includes('doc') || lower.includes('readme') || lower.includes('deploy') || lower.includes('ci') || lower.includes('setup')) {
    return 'ops'
  }
  return 'other'
}

// Dirs to skip when scanning
const SKIP_DIRS = new Set(['node_modules', 'vendor', 'dist', 'build', 'out', '.git', '.next', '__pycache__'])

// Scan a directory for todos in markdown files
export function scanDirForTodos(
  dir: string,
  zoneType: string,
  maxDepth = 3
): { zone: string; type: string; category: string; text: string; done: boolean }[] {
  const todos: { zone: string; type: string; category: string; text: string; done: boolean }[] = []
  const zoneName = dir.split('/').pop() || ''

  function walk(d: string, depth: number) {
    if (depth > maxDepth) return
    let entries
    try { entries = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
      const fullPath = join(d, entry.name)
      if (entry.isDirectory() && depth < maxDepth) {
        walk(fullPath, depth + 1)
      } else if (entry.isFile() && /\.(md|txt)$/i.test(entry.name)) {
        try {
          const content = readFileSync(fullPath, 'utf-8')
          for (const line of content.split('\n')) {
            const parsed = parseTodoLine(line)
            if (parsed) {
              todos.push({
                zone: zoneName,
                type: zoneType,
                category: categorizeTodo(parsed.text),
                text: parsed.text,
                done: parsed.done
              })
            }
          }
        } catch {}
      }
    }
  }

  walk(dir, 0)
  return todos
}

// SKILL.md parser
export function parseSkillMd(filePath: string): { name: string; description: string } | null {
  try {
    const content = readFileSync(filePath, 'utf-8')
    const nameMatch = content.match(/^name:\s*(.+)$/m)
    const descMatch = content.match(/description:\s*\|?\s*\n?\s*(.+)/m)
    if (!nameMatch) return null
    return {
      name: nameMatch[1].trim(),
      description: (descMatch?.[1] || '').trim().slice(0, 120)
    }
  } catch { return null }
}

// Scan skills directory
export function scanSkills(skillsDir: string): { name: string; pack: string; path: string; description: string }[] {
  if (!existsSync(skillsDir)) return []
  const skills: { name: string; pack: string; path: string; description: string }[] = []

  try {
    const topEntries = readdirSync(skillsDir, { withFileTypes: true })
    for (const top of topEntries) {
      if (!top.isDirectory()) continue
      const topPath = join(skillsDir, top.name)
      const topSkill = join(topPath, 'SKILL.md')

      let foundSub = false
      try {
        const subEntries = readdirSync(topPath, { withFileTypes: true })
        for (const sub of subEntries) {
          if (!sub.isDirectory()) continue
          const subSkill = join(topPath, sub.name, 'SKILL.md')
          if (existsSync(subSkill)) {
            const parsed = parseSkillMd(subSkill)
            if (parsed) {
              skills.push({ name: parsed.name, pack: top.name, path: join(topPath, sub.name), description: parsed.description })
              foundSub = true
            }
          }
        }
      } catch {}

      if (!foundSub && existsSync(topSkill)) {
        const parsed = parseSkillMd(topSkill)
        if (parsed) {
          skills.push({ name: parsed.name, pack: top.name, path: topPath, description: parsed.description })
        }
      }
    }
  } catch {}
  return skills
}

// Generate hook settings JSON
export function generateHookSettings(agentId: string, port: number): Record<string, unknown> {
  const statusCmd = (status: string) =>
    `curl -s -X POST http://127.0.0.1:${port}/status -H "Content-Type: application/json" -d '{"agentId":"${agentId}","status":"${status}"}' > /dev/null 2>&1`

  return {
    hooks: {
      Stop: [{ matcher: '', hooks: [{ type: 'command', command: statusCmd('waiting') }] }],
      PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: statusCmd('working') }] }]
    }
  }
}

// Generate report script content
export function generateReportScript(agentId: string, port: number): string {
  return `#!/bin/bash
# Usage: .claude/hive-report.sh '{"type":"todo","items":[{"text":"Fix bug","done":false}]}'
curl -s -X POST http://127.0.0.1:${port}/report \\
  -H "Content-Type: application/json" \\
  -d "{\\"agentId\\":\\"${agentId}\\",$(echo $1 | sed 's/^{//' )}" > /dev/null 2>&1
`
}
