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

// Parse todo.md in contract format: items with sub-line metadata (depends/scope/verify/acceptance)
export interface TodoContract {
  text: string
  done: boolean
  depends: string[]
  scope: string
  verify: string[]
  acceptance: string
}

export function parseTodoContracts(content: string): TodoContract[] {
  const lines = content.split('\n')
  const contracts: TodoContract[] = []
  let current: TodoContract | null = null
  let lastKey = ''

  for (const line of lines) {
    const todo = parseTodoLine(line)
    if (todo) {
      if (current) contracts.push(current)
      current = { text: todo.text, done: todo.done, depends: [], scope: '.', verify: [], acceptance: '' }
      lastKey = ''
      continue
    }
    if (!current) continue
    // Metadata line: "  - key: value"
    const meta = line.match(/^\s{2,}-\s+(depends|scope|verify|acceptance):\s*(.*)/)
    if (meta) {
      const [, key, value] = meta
      lastKey = key
      const v = value.trim()
      if (key === 'depends') {
        if (v === 'none' || v === '[]' || !v) {
          current.depends = []
        } else {
          current.depends = v.replace(/^\[/, '').replace(/\]$/, '').split(',').map(s => s.trim()).filter(Boolean)
        }
      } else if (key === 'scope') {
        current.scope = v || '.'
      } else if (key === 'verify' && v) {
        current.verify.push(v)
      } else if (key === 'acceptance') {
        current.acceptance = v
      }
      continue
    }
    // Verify sub-item: "    - command"
    if (lastKey === 'verify') {
      const item = line.match(/^\s{4,}-\s+(.+)/)
      if (item) {
        current.verify.push(item[1].trim())
        continue
      }
    }
    // Non-matching line after metadata — stop collecting for current key
    if (!/^\s*$/.test(line) && !line.match(/^\s*#/)) lastKey = ''
  }
  if (current) contracts.push(current)
  return contracts
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
  const curlPost = (endpoint: string, jsonBody: string) =>
    `curl -s -X POST http://127.0.0.1:${port}${endpoint} -H "Content-Type: application/json" -d '${jsonBody}' > /dev/null 2>&1`

  return {
    hooks: {
      Stop: [{ matcher: '', hooks: [{ type: 'command', command: curlPost('/status', `{"agentId":"${agentId}","status":"waiting","event":"stop"}`) }] }],
      PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: curlPost('/status', `{"agentId":"${agentId}","status":"working","event":"tool_use"}`) }] }],
      Notification: [{ matcher: '', hooks: [{ type: 'command', command: curlPost('/report', `{"agentId":"${agentId}","type":"notification","message":"Agent needs attention"}`) }] }]
    }
  }
}

// Generate report script content
export function generateReportScript(agentId: string, port: number): string {
  return `#!/bin/bash
# Report task progress to Hive
# Usage:
#   .claude/hive-report.sh start "Fixing login bug"
#   .claude/hive-report.sh done "Fixed login bug, added validation"
#   .claude/hive-report.sh todo '{"items":[...]}'
#   .claude/hive-report.sh task-create '{"projectId":"...","title":"...","scope":"..."}'
#   .claude/hive-report.sh task-assign TASK_ID AGENT_ID
#   .claude/hive-report.sh task-done TASK_ID "summary"
#   .claude/hive-report.sh task-blocked TASK_ID "reason"
#   .claude/hive-report.sh task-status
#   .claude/hive-report.sh ready
#   .claude/hive-report.sh report-human "message"
#   .claude/hive-report.sh batch-propose '{"batch":1,"tasks":[...]}'

ACTION="$1"
MSG="$2"
AGENT="${agentId}"
PORT=${port}

case "$ACTION" in
  start)
    curl -s -X POST http://127.0.0.1:$PORT/report -H "Content-Type: application/json" \\
      -d "{\\"agentId\\":\\"$AGENT\\",\\"type\\":\\"task_start\\",\\"title\\":\\"$MSG\\"}" > /dev/null 2>&1
    ;;
  done)
    curl -s -X POST http://127.0.0.1:$PORT/report -H "Content-Type: application/json" \\
      -d "{\\"agentId\\":\\"$AGENT\\",\\"type\\":\\"task_done\\",\\"summary\\":\\"$MSG\\"}" > /dev/null 2>&1
    ;;
  todo)
    curl -s -X POST http://127.0.0.1:$PORT/report -H "Content-Type: application/json" \\
      -d "{\\"agentId\\":\\"$AGENT\\",\\"type\\":\\"todo\\",$(echo $MSG | sed 's/^{//')}" > /dev/null 2>&1
    ;;
  task-create)
    curl -s -X POST http://127.0.0.1:$PORT/task-create -H "Content-Type: application/json" \\
      -d "$MSG"
    ;;
  task-assign)
    TASK_ID="$2"
    TARGET="$3"
    curl -s -X POST http://127.0.0.1:$PORT/task-assign -H "Content-Type: application/json" \\
      -d "{\\"projectId\\":\\"\\",\\"taskId\\":\\"$TASK_ID\\",\\"agentId\\":\\"$TARGET\\"}" > /dev/null 2>&1
    ;;
  task-done)
    TASK_ID="$2"
    SUMMARY="$3"
    curl -s -X POST http://127.0.0.1:$PORT/task-done -H "Content-Type: application/json" \\
      -d "{\\"agentId\\":\\"$AGENT\\",\\"taskId\\":\\"$TASK_ID\\",\\"summary\\":\\"$SUMMARY\\"}" > /dev/null 2>&1
    ;;
  task-blocked)
    TASK_ID="$2"
    REASON="$3"
    curl -s -X POST http://127.0.0.1:$PORT/task-blocked -H "Content-Type: application/json" \\
      -d "{\\"agentId\\":\\"$AGENT\\",\\"taskId\\":\\"$TASK_ID\\",\\"reason\\":\\"$REASON\\"}" > /dev/null 2>&1
    ;;
  task-status)
    curl -s -X POST http://127.0.0.1:$PORT/task-status -H "Content-Type: application/json" \\
      -d "{\\"agentId\\":\\"$AGENT\\"}"
    ;;
  ready)
    curl -s -X POST http://127.0.0.1:$PORT/ready -H "Content-Type: application/json" \\
      -d "{\\"agentId\\":\\"$AGENT\\"}" > /dev/null 2>&1
    ;;
  report-human)
    curl -s -X POST http://127.0.0.1:$PORT/report-human -H "Content-Type: application/json" \\
      -d "{\\"agentId\\":\\"$AGENT\\",\\"message\\":\\"$MSG\\"}" > /dev/null 2>&1
    ;;
  batch-propose)
    # Inject agentId into the JSON payload
    PAYLOAD=$(echo "$MSG" | sed "s/^{/{\\"agentId\\":\\"$AGENT\\",/")
    curl -s -X POST http://127.0.0.1:$PORT/batch-propose -H "Content-Type: application/json" \\
      -d "$PAYLOAD" > /dev/null 2>&1
    ;;
esac
`
}

// Soul file management
export function writeSoulFile(soulsDir: string, agentId: string, content: string) {
  if (!existsSync(soulsDir)) mkdirSync(soulsDir, { recursive: true })
  writeFileSync(join(soulsDir, `${agentId}.md`), content)
}

export function deleteSoulFile(soulsDir: string, agentId: string) {
  const file = join(soulsDir, `${agentId}.md`)
  try { if (existsSync(file)) require('fs').unlinkSync(file) } catch {}
}
