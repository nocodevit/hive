import { describe, it, expect } from 'vitest'
import { SETUP_STEPS, setupProgress, firstOpenStep, groupStarts } from '../butler-setup'

describe('setupProgress', () => {
  it('counts only real steps, not welcome / done', () => {
    const p = setupProgress({})
    expect(p.total).toBe(SETUP_STEPS.filter(s => !s.framing).length)
    expect(p.done).toBe(0)
    expect(p.open.map(s => s.id)).not.toContain('welcome')
  })
  it('a skipped step stays open; a done one does not', () => {
    const p = setupProgress({ claude: 'done', theme: 'skipped' })
    expect(p.done).toBe(1)
    expect(p.open.map(s => s.id)).toContain('theme')
    expect(p.open.map(s => s.id)).not.toContain('claude')
  })
})

describe('firstOpenStep', () => {
  it('starts at welcome when nothing was answered', () => {
    expect(firstOpenStep({})).toBe(0)
  })
  it('resumes at the first unanswered step', () => {
    expect(SETUP_STEPS[firstOpenStep({ claude: 'done', project: 'skipped' })].id).toBe('theme')
  })
  it('lands on done when everything was answered', () => {
    const all = Object.fromEntries(SETUP_STEPS.filter(s => !s.framing).map(s => [s.id, 'done' as const]))
    expect(SETUP_STEPS[firstOpenStep(all)].id).toBe('done')
  })
})

describe('groupStarts', () => {
  it('marks the first step of each group', () => {
    const starts = [...groupStarts()].map(i => SETUP_STEPS[i].id)
    expect(starts).toEqual(['welcome', 'about', 'done'])
  })
})
