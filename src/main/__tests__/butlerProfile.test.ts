import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { normalizeProfile, renderProfileMd, writeProfile, readProfile, isProfileEmpty, EMPTY_PROFILE } from '../butlerProfile'

describe('normalizeProfile', () => {
  it('keeps known string fields, trims, drops the rest', () => {
    const p = normalizeProfile({ role: '  产品负责人 ', style: 'warm', evil: 'x', name: 42 })
    expect(p.role).toBe('产品负责人')
    expect(p.style).toBe('warm')
    expect(p.name).toBe('')
    expect('evil' in p).toBe(false)
  })
  it('an unknown style falls back to direct', () => {
    expect(normalizeProfile({ style: 'rude' }).style).toBe('direct')
  })
  it('caps long values', () => {
    expect(normalizeProfile({ intro: 'a'.repeat(900) }).intro).toHaveLength(500)
  })
})

describe('renderProfileMd', () => {
  it('writes only the filled-in parts', () => {
    const md = renderProfileMd({ ...EMPTY_PROFILE, name: 'Mei', role: '产品负责人', answerLike: '资深 IoT 产品经理', prefix: '【Mei 的 AI 代理】' })
    expect(md).toContain("You are Mei's personal AI agent")
    expect(md).toContain('- Role: 产品负责人')
    expect(md).toContain('Answer like a 资深 IoT 产品经理')
    expect(md).toContain('Start every message you send for them with: 【Mei 的 AI 代理】')
    expect(md).not.toContain('Team:')
    expect(md).not.toContain('When unsure')
  })
  it('an empty profile still names the style', () => {
    const md = renderProfileMd(EMPTY_PROFILE)
    expect(md).toContain('Direct: lead with the conclusion')
    expect(isProfileEmpty(EMPTY_PROFILE)).toBe(true)
  })
})

describe('writeProfile / readProfile', () => {
  it('round-trips the form and writes profile.md beside it', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'hive-profile-')), 'butler')
    writeProfile(dir, { role: 'PM', style: 'formal' })
    expect(readProfile(dir)).toMatchObject({ role: 'PM', style: 'formal' })
    expect(readFileSync(join(dir, 'profile.md'), 'utf8')).toContain('Formal: polite')
  })
  it('missing file → empty profile', () => {
    expect(readProfile(join(tmpdir(), 'no-such-butler'))).toEqual(EMPTY_PROFILE)
  })
})

describe('assistant name', () => {
  it('is kept and named in profile.md', () => {
    const p = normalizeProfile({ assistantName: '  Mimi ', name: 'Mei' })
    expect(p.assistantName).toBe('Mimi')
    expect(renderProfileMd(p)).toContain("You are Mei's personal AI agent, called Mimi.")
  })
  it('without a custom intro, introductions use the name', () => {
    expect(renderProfileMd(normalizeProfile({ assistantName: 'Mimi', name: 'Mei' }))).toContain("say you are Mimi, Mei's AI agent")
  })
  it('left out when empty', () => {
    expect(renderProfileMd({ ...EMPTY_PROFILE, name: 'Mei' })).toContain("You are Mei's personal AI agent.")
  })
})
