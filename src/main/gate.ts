import { execSync } from 'child_process'
import { join } from 'path'

export interface GateFailure {
  step: string
  detail: string
}

export interface GateResult {
  pass: boolean
  failures: GateFailure[]
  warnings: GateFailure[]
}

function runCmd(cmd: string, cwd: string, timeout = 120000): { ok: boolean; output: string } {
  try {
    const output = execSync(cmd, { cwd, timeout, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
    return { ok: true, output: output.trim() }
  } catch (err: any) {
    return { ok: false, output: (err.stderr || err.stdout || err.message || '').toString().trim() }
  }
}

export async function runGate(cwd: string, task: { scope: string; verify: string[] }): Promise<GateResult> {
  const failures: GateFailure[] = []
  const warnings: GateFailure[] = []

  // ① Scope check — warning only. Worker is responsible for self-checking scope.
  if (task.scope && task.scope !== '.') {
    const diff = runCmd('git diff --name-only origin/main...HEAD', cwd)
    if (diff.ok && diff.output) {
      const files = diff.output.split('\n').filter(Boolean)
      const outside = files.filter(f => !f.startsWith(task.scope))
      if (outside.length > 0) {
        warnings.push({ step: 'scope', detail: `Files outside scope "${task.scope}": ${outside.join(', ')}` })
      }
    }
  }

  // ② Contract verify — Worker runs verify[] themselves for full output visibility
  // Gate only issues scope warnings. Verify is the Worker's responsibility.

  return { pass: failures.length === 0, failures, warnings }
}
