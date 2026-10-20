// IPC for Butler "About me" preview and Skills (butlerSkills.ts).
// Every save / reset rewrites .claude/skills so a running session sees it.

import { spawn } from 'child_process'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { claudeBin } from './claude-env'
import { normalizeProfile, renderProfileMd } from './butlerProfile'
import {
  ackDefault, compareSkill, composeSkills, listSkills, proposeEdit, resetSkill, saveOverlay, saveOverride,
  skillDetail, tryIt, type Runner, type SkillStore
} from './butlerSkills'

interface IpcMainLike {
  handle(channel: string, fn: (e: unknown, ...args: any[]) => unknown): void
}

export interface ButlerSkillsDeps {
  ipcMain: IpcMainLike
  /** The Butler folder path (reads must not create it; writes create what they need). */
  butlerDir: () => string
  /** resources/butler/skills */
  defaultsDir: string
  run?: Runner
  reveal?: (path: string) => void
}

export const RUN_TIMEOUT_MS = 180_000

/** `claude -p`, prompt on stdin, in a temp folder (no project rules, no Butler tools). */
export function claudePrint(prompt: string, bin = claudeBin(), timeoutMs = RUN_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['-p', '--output-format', 'text'], { cwd: tmpdir(), env: process.env, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('timeout')) }, timeoutMs)
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { err += d })
    child.on('error', e => { clearTimeout(timer); reject(e) })
    child.on('close', code => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error((err || out).trim().split('\n').slice(-3).join('\n').slice(0, 300) || `claude exited (${code})`))
    })
    child.stdin.end(prompt)
  })
}

const wrap = <T>(fn: () => T): T | { ok: false; error: string } => {
  try { return fn() } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) } }
}

export function registerButlerSkillsIpc(deps: ButlerSkillsDeps): void {
  const run = deps.run ?? (p => claudePrint(p))
  const store = (): SkillStore => ({ defaultsDir: deps.defaultsDir, butlerDir: deps.butlerDir() })
  const profileMd = (dir: string) => { try { return readFileSync(join(dir, 'profile.md'), 'utf8') } catch { return '' } }
  const changed = <T>(s: SkillStore, v: T): T => { try { composeSkills(s) } catch { /* next start retries */ } return v }
  const h = deps.ipcMain.handle.bind(deps.ipcMain)

  h('butler:profilePreview', (_e, p: unknown) => renderProfileMd(normalizeProfile(p)))
  h('butlerSkills:list', () => wrap(() => listSkills(store())))
  h('butlerSkills:get', (_e, id: unknown) => wrap(() => skillDetail(store(), id as string)))
  h('butlerSkills:saveOverlay', (_e, id: unknown, o: unknown) => wrap(() => { const s = store(); saveOverlay(s, id as string, o); return changed(s, skillDetail(s, id as string)) }))
  h('butlerSkills:saveOverride', (_e, id: unknown, md: unknown) => wrap(() => { const s = store(); return changed(s, saveOverride(s, id as string, md)) }))
  h('butlerSkills:reset', (_e, id: unknown) => wrap(() => { const s = store(); resetSkill(s, id as string); return changed(s, skillDetail(s, id as string)) }))
  h('butlerSkills:ackDefault', (_e, id: unknown) => wrap(() => { const s = store(); ackDefault(s, id as string); return skillDetail(s, id as string) }))
  h('butlerSkills:compare', (_e, id: unknown) => wrap(() => compareSkill(store(), id as string)))
  h('butlerSkills:try', async (_e, id: unknown, sample: unknown, md: unknown) => {
    try { const s = store(); return await tryIt(s, id as string, sample, run, { md, profileMd: profileMd(s.butlerDir) }) } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) } }
  })
  h('butlerSkills:propose', async (_e, id: unknown, request: unknown) => {
    try { return await proposeEdit(store(), id as string, request, run) } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) } }
  })
  h('butlerSkills:reveal', (_e, id: unknown) => wrap(() => {
    const p = skillDetail(store(), id as string).path
    if (!existsSync(p)) mkdirSync(dirname(p), { recursive: true })
    deps.reveal?.(existsSync(p) ? p : dirname(p))
    return { ok: true }
  }))
}
