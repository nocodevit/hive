import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'

const TEST_DIR = join(__dirname, '__test_zones__')

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
  mkdirSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
})

function hasGit(path: string): boolean {
  return existsSync(join(path, '.git'))
}

// Replicate zone filtering logic
function filterZones(zones: { id: string; type: string; hasGit: boolean }[], department: string) {
  return zones.filter(z => department === 'R&D' ? z.type === 'rnd' : z.type === 'non-rnd')
}

// Replicate template visibility logic
function shouldShowRdTemplates(zones: { type: string }[]): boolean {
  return zones.some(z => z.type === 'rnd')
}

function shouldShowNonRdTemplates(zones: { type: string }[]): boolean {
  return zones.some(z => z.type === 'non-rnd')
}

describe('Zone Git Detection', () => {
  it('detects git in directory with .git', () => {
    const dir = join(TEST_DIR, 'with-git')
    mkdirSync(dir)
    execSync(`git init "${dir}"`, { stdio: 'pipe' })
    expect(hasGit(dir)).toBe(true)
  })

  it('returns false for directory without .git', () => {
    const dir = join(TEST_DIR, 'no-git')
    mkdirSync(dir)
    expect(hasGit(dir)).toBe(false)
  })

  it('returns false for non-existent directory', () => {
    expect(hasGit(join(TEST_DIR, 'nope'))).toBe(false)
  })
})

describe('Zone Filtering for Agent Creation', () => {
  const zones = [
    { id: 'z1', type: 'rnd', hasGit: true },
    { id: 'z2', type: 'rnd', hasGit: false },
    { id: 'z3', type: 'non-rnd', hasGit: false },
  ]

  it('R&D department only sees rnd zones', () => {
    const filtered = filterZones(zones, 'R&D')
    expect(filtered.length).toBe(2)
    expect(filtered.every(z => z.type === 'rnd')).toBe(true)
  })

  it('Non-R&D department only sees non-rnd zones', () => {
    const filtered = filterZones(zones, 'Non-R&D')
    expect(filtered.length).toBe(1)
    expect(filtered[0].id).toBe('z3')
  })

  it('project with only non-rnd zones: R&D templates hidden', () => {
    const nonRndOnly = [{ type: 'non-rnd' }]
    expect(shouldShowRdTemplates(nonRndOnly)).toBe(false)
    expect(shouldShowNonRdTemplates(nonRndOnly)).toBe(true)
  })

  it('project with only rnd zones: Non-R&D templates hidden', () => {
    const rndOnly = [{ type: 'rnd' }]
    expect(shouldShowRdTemplates(rndOnly)).toBe(true)
    expect(shouldShowNonRdTemplates(rndOnly)).toBe(false)
  })

  it('project with both zone types: both template sections shown', () => {
    const both = [{ type: 'rnd' }, { type: 'non-rnd' }]
    expect(shouldShowRdTemplates(both)).toBe(true)
    expect(shouldShowNonRdTemplates(both)).toBe(true)
  })

  it('project with no zones: no templates shown', () => {
    expect(shouldShowRdTemplates([])).toBe(false)
    expect(shouldShowNonRdTemplates([])).toBe(false)
  })
})

describe('Worktree Creation Guard', () => {
  // Replicate startAgent worktree decision logic
  function shouldCreateWorktree(agent: { type: string; worktreePath?: string }, hasGitLive: boolean): boolean {
    return agent.type === 'coding' && hasGitLive && !agent.worktreePath
  }

  function shouldUseExistingWorktree(agent: { worktreePath?: string }): boolean {
    return !!agent.worktreePath
  }

  it('new coding agent + git repo: creates worktree', () => {
    expect(shouldCreateWorktree({ type: 'coding' }, true)).toBe(true)
  })

  it('new coding agent + no git: no worktree', () => {
    expect(shouldCreateWorktree({ type: 'coding' }, false)).toBe(false)
  })

  it('non-coding agent + git: no worktree', () => {
    expect(shouldCreateWorktree({ type: 'non-coding' }, true)).toBe(false)
  })

  it('existing coding agent with worktree: uses existing', () => {
    expect(shouldCreateWorktree({ type: 'coding', worktreePath: '/some/path' }, true)).toBe(false)
    expect(shouldUseExistingWorktree({ worktreePath: '/some/path' })).toBe(true)
  })

  it('coding agent with stale hasGit=false but actual git: live check fixes it', () => {
    // Zone says hasGit=false but live check says true
    const zoneHasGit = false
    const liveHasGit = true
    // startAgent uses liveHasGit, not zone.hasGit
    expect(shouldCreateWorktree({ type: 'coding' }, liveHasGit)).toBe(true)
  })
})
