import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { parseSkillMd, scanSkills } from '../utils'

const TEST_DIR = join(__dirname, '__test_skills__')

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
  mkdirSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
})

describe('parseSkillMd', () => {
  it('parses name and description', () => {
    const file = join(TEST_DIR, 'SKILL.md')
    writeFileSync(file, '---\nname: review\ndescription: Code review skill\n---\nContent here')
    const result = parseSkillMd(file)
    expect(result).toEqual({ name: 'review', description: 'Code review skill' })
  })

  it('handles multiline description with pipe', () => {
    const file = join(TEST_DIR, 'SKILL.md')
    writeFileSync(file, '---\nname: qa\ndescription: |\n  Run QA tests and fix bugs\n---\n')
    const result = parseSkillMd(file)
    expect(result?.name).toBe('qa')
    expect(result?.description).toContain('Run QA')
  })

  it('returns null if no name', () => {
    const file = join(TEST_DIR, 'SKILL.md')
    writeFileSync(file, '---\ndescription: No name here\n---\n')
    expect(parseSkillMd(file)).toBeNull()
  })

  it('returns null for nonexistent file', () => {
    expect(parseSkillMd(join(TEST_DIR, 'nope.md'))).toBeNull()
  })

  it('truncates long descriptions to 120 chars', () => {
    const file = join(TEST_DIR, 'SKILL.md')
    const longDesc = 'A'.repeat(200)
    writeFileSync(file, `---\nname: test\ndescription: ${longDesc}\n---\n`)
    const result = parseSkillMd(file)
    expect(result?.description.length).toBeLessThanOrEqual(120)
  })
})

describe('scanSkills', () => {
  it('returns empty for nonexistent directory', () => {
    expect(scanSkills(join(TEST_DIR, 'nonexistent'))).toEqual([])
  })

  it('finds top-level skill', () => {
    mkdirSync(join(TEST_DIR, 'my-skill'))
    writeFileSync(join(TEST_DIR, 'my-skill', 'SKILL.md'), '---\nname: my-skill\ndescription: Does stuff\n---\n')
    const skills = scanSkills(TEST_DIR)
    expect(skills).toHaveLength(1)
    expect(skills[0]).toMatchObject({ name: 'my-skill', pack: 'my-skill', description: 'Does stuff' })
  })

  it('finds sub-skills (like gstack)', () => {
    mkdirSync(join(TEST_DIR, 'gstack', 'review'), { recursive: true })
    mkdirSync(join(TEST_DIR, 'gstack', 'qa'))
    writeFileSync(join(TEST_DIR, 'gstack', 'review', 'SKILL.md'), '---\nname: review\ndescription: Code review\n---\n')
    writeFileSync(join(TEST_DIR, 'gstack', 'qa', 'SKILL.md'), '---\nname: qa\ndescription: QA testing\n---\n')
    // Also has a top-level SKILL.md but should prefer sub-skills
    writeFileSync(join(TEST_DIR, 'gstack', 'SKILL.md'), '---\nname: gstack\ndescription: Top level\n---\n')

    const skills = scanSkills(TEST_DIR)
    expect(skills).toHaveLength(2)
    expect(skills.map((s) => s.name).sort()).toEqual(['qa', 'review'])
    expect(skills[0].pack).toBe('gstack')
  })

  it('skips non-directory entries', () => {
    writeFileSync(join(TEST_DIR, 'random.txt'), 'not a skill')
    expect(scanSkills(TEST_DIR)).toEqual([])
  })
})
