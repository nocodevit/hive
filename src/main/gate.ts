import { execSync } from 'child_process'
import { join } from 'path'

export interface GateFailure {
  step: string
  detail: string
}

export interface GateResult {
  pass: boolean
  failures: GateFailure[]
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

  // ① Build (only if package.json exists)
  const hasPackageJson = runCmd('test -f package.json', cwd)
  if (hasPackageJson.ok) {
    const build = runCmd('npm run build', cwd)
    if (!build.ok) {
      failures.push({ step: 'build', detail: build.output.slice(0, 500) })
      return { pass: false, failures }
    }

    // ② Test
    const test = runCmd('npm test', cwd)
    if (!test.ok) {
      failures.push({ step: 'test', detail: test.output.slice(0, 500) })
      return { pass: false, failures }
    }
  }

  // ③ Scope check
  if (task.scope && task.scope !== '.') {
    const diff = runCmd('git diff --name-only origin/main...HEAD', cwd)
    if (diff.ok && diff.output) {
      const files = diff.output.split('\n').filter(Boolean)
      const outside = files.filter(f => !f.startsWith(task.scope))
      if (outside.length > 0) {
        failures.push({ step: 'scope', detail: `Files outside scope "${task.scope}": ${outside.join(', ')}` })
      }
    }
  }

  // ④ Contract verify
  for (const cmd of task.verify) {
    const result = runCmd(cmd, cwd, 30000)
    if (!result.ok) {
      failures.push({ step: 'verify', detail: `"${cmd}" failed: ${result.output.slice(0, 200)}` })
    }
  }

  return { pass: failures.length === 0, failures }
}
