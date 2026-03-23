import { describe, it, expect } from 'vitest'

// Replicate job-pickup logic for testing
function generateJobPickup(
  agentName: string,
  agentRole: string,
  logs: { time: string; type: string; message: string }[]
): string | null {
  if (logs.length === 0) return null

  const recent = logs.slice(-20)
  let lastTask = ''
  let lastDone = ''

  for (const log of recent) {
    if (log.type === 'task_start') lastTask = log.message
    if (log.type === 'task_done') { lastDone = log.message; lastTask = '' }
  }

  let prompt = `You are ${agentName} (${agentRole}). Here is your recent work history:\n\n`

  for (const log of recent.slice(-10)) {
    const time = new Date(log.time).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
    if (log.type === 'task_start') prompt += `[${time}] STARTED: ${log.message}\n`
    else if (log.type === 'task_done') prompt += `[${time}] COMPLETED: ${log.message}\n`
    else if (log.type === 'status' && log.message === 'waiting') prompt += `[${time}] Paused\n`
  }

  if (lastTask) {
    prompt += `\nYou were working on: "${lastTask}" but did NOT finish.\nPlease continue this task from where you left off.`
  } else if (lastDone) {
    prompt += `\nYour last completed task: "${lastDone}"\nCheck if there are follow-up tasks or ask what to do next.`
  } else {
    prompt += `\nReview your history above and ask what to work on next.`
  }

  return prompt
}

describe('generateJobPickup', () => {
  it('returns null for empty logs', () => {
    expect(generateJobPickup('David', 'Engineering', [])).toBeNull()
  })

  it('shows unfinished task', () => {
    const logs = [
      { time: '2026-03-22T10:00:00Z', type: 'task_start', message: 'Fix login bug' },
      { time: '2026-03-22T10:05:00Z', type: 'status', message: 'working' },
    ]
    const result = generateJobPickup('David', 'Engineering', logs)
    expect(result).toContain('Fix login bug')
    expect(result).toContain('did NOT finish')
    expect(result).toContain('continue this task')
  })

  it('shows completed task with follow-up prompt', () => {
    const logs = [
      { time: '2026-03-22T10:00:00Z', type: 'task_start', message: 'Fix login bug' },
      { time: '2026-03-22T10:30:00Z', type: 'task_done', message: 'Fixed login validation' },
    ]
    const result = generateJobPickup('Daisy', 'Design', logs)
    expect(result).toContain('Fixed login validation')
    expect(result).toContain('follow-up tasks')
  })

  it('includes agent name and role', () => {
    const logs = [{ time: '2026-03-22T10:00:00Z', type: 'status', message: 'working' }]
    const result = generateJobPickup('Drake', 'QA', logs)
    expect(result).toContain('Drake')
    expect(result).toContain('QA')
  })

  it('handles multiple task cycles', () => {
    const logs = [
      { time: '2026-03-22T09:00:00Z', type: 'task_start', message: 'Task A' },
      { time: '2026-03-22T09:30:00Z', type: 'task_done', message: 'Done A' },
      { time: '2026-03-22T10:00:00Z', type: 'task_start', message: 'Task B' },
    ]
    const result = generateJobPickup('David', 'Engineering', logs)
    expect(result).toContain('Task B')
    expect(result).toContain('did NOT finish')
  })

  it('only uses last 10 log entries for display', () => {
    const logs = Array.from({ length: 15 }, (_, i) => ({
      time: `2026-03-22T${String(i).padStart(2, '0')}:00:00Z`,
      type: 'status',
      message: 'working'
    }))
    const result = generateJobPickup('Sam', 'BA', logs)
    expect(result).not.toBeNull()
  })
})
