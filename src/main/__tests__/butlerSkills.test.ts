import { describe, it, expect, beforeEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, copyFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  SECTIONS, ackDefault, applyOverlay, changeChips, composeSkills, compareSkill, editPrompt, effectiveSkill, isSkillId,
  lineDiff, lintSkill, listSkills, lockedLines, normalizeOverlay, parseEditReply, parseSkill, proposeEdit, readOverlay,
  renderSkill, resetSkill, saveOverlay, saveOverride, skillDetail, tryIt, DRY_RUN_NOTE, readableOutput, type SkillStore, readChangelog, newSkillUpdates, saveNewAsCopy, mergeUpdate, useNewDefault, readOverride, hashText } from '../butlerSkills'
import { installButlerFiles } from '../butler'
import { registerButlerSkillsIpc } from '../butlerSkillsIpc'

const RESOURCES = join(__dirname, '..', '..', '..', 'resources', 'butler')
const SHIPPED = join(RESOURCES, 'skills')
const IDS = ['answer-feishu', 'evening-report', 'handle-jira', 'morning-plan', 'reply-email', 'sort-inbox']
/** Every shipped skill: the task skills above + references. */
const ALL_IDS = [...IDS, 'jira-knowledge'].sort()

let store: SkillStore
beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'hive-skills-'))
  const defaultsDir = join(root, 'defaults')
  mkdirSync(defaultsDir)
  for (const f of readdirSync(SHIPPED)) copyFileSync(join(SHIPPED, f), join(defaultsDir, f))
  store = { defaultsDir, butlerDir: join(root, 'butler') }
})

const def = (id: string) => readFileSync(join(store.defaultsDir, `${id}.md`), 'utf8')
const userFile = (f: string) => join(store.butlerDir, 'skills', f)

describe('shipped defaults', () => {
  it.each(IDS)('%s follows the writing guide', id => {
    const md = readFileSync(join(SHIPPED, `${id}.md`), 'utf8')
    expect(lintSkill(id, md, md)).toEqual([])
    const p = parseSkill(md)
    expect(p.sections.map(s => s.title)).toEqual([...SECTIONS])
    expect(p.description.length).toBeGreaterThan(20)
    expect(lockedLines(md).length).toBeGreaterThan(0)
  })
  it('jira-knowledge is a reference: own sections, no company data shipped', () => {
    const md = def('jira-knowledge')
    expect(parseSkill(md).kind).toBe('reference')
    expect(lintSkill('jira-knowledge', md, md)).toEqual([])
    expect(md).not.toMatch(/linksfield|@[a-z]+\.[a-z]+|P4-\d|FAE-\d/i)
  })
  it('a reference override keeps its kind and starts with Purpose; its other sections are free', () => {
    const md = def('jira-knowledge')
    const mine = md.replace('## Labels', '## Labels we use').replace('## Owners', '## Owners\n\n| x | y |')
    expect(lintSkill('jira-knowledge', mine, md)).toEqual([])
    expect(lintSkill('jira-knowledge', mine.replace('kind: reference\n', ''), md).map(p => p.rule)).toContain('frontmatter')
    expect(lintSkill('jira-knowledge', mine.replace('## Purpose', '## Intro'), md).map(p => p.rule)).toContain('sections')
  })
  it('reply-email encodes the 3-sentence rule and never sends', () => {
    const md = def('reply-email')
    expect(md).toMatch(/exactly 3 sentences/)
    expect(md).toMatch(/No root cause/)
    expect(md).toMatch(/no second apology/)
    expect(lockedLines(md).join('\n')).toMatch(/never send without/)
  })
  it('answer-feishu escalates with the check-with line and uses the profile prefix', () => {
    const md = def('answer-feishu')
    expect(md).toMatch(/我需要和 <name> 确认，稍后回复你/)
    expect(md).toMatch(/prefix from `profile\.md`/)
    expect(lockedLines(md).map(l => l.split(' — ')[0])).toEqual(['- 🔒 prices', '- 🔒 approvals', '- 🔒 private chats', '- 🔒 personal info', '- 🔒 sensitive info', '- 🔒 confidential'])
  })
})

describe('ids', () => {
  it.each([['reply-email', true], ['a', true], ['../x', false], ['Reply', false], ['1abc', false], ['a/b', false], ['a'.repeat(33), false], ['', false]])('%s → %s', (id, ok) => {
    expect(isSkillId(id)).toBe(ok)
  })
  it('refuses unsafe or unknown ids before touching files', () => {
    expect(() => saveOverlay(store, '../evil', { tone: 'direct' })).toThrow('bad_id')
    expect(() => saveOverride(store, '../../x', '')).toThrow('bad_id')
    expect(() => resetSkill(store, 'nope')).toThrow('unknown_skill')
    expect(existsSync(join(store.butlerDir, 'skills'))).toBe(false)
  })
})

describe('overlay', () => {
  it('normalizes: known tones only, trimmed, de-duplicated, no 🔒 smuggling', () => {
    expect(normalizeOverlay({ tone: 'shouty', maxLength: '  3  sentences ', extraAskFirst: ['hiring', 'hiring', '🔒 fake', ''], extra: '  ', x: 1 }))
      .toEqual({ maxLength: '3 sentences', extraAskFirst: ['hiring', 'fake'] })
    expect(normalizeOverlay(null)).toEqual({})
  })
  it('adds each choice to its section and keeps the rest', () => {
    const md = applyOverlay(def('answer-feishu'), { tone: 'friendly', maxLength: '2 sentences', language: 'Chinese', extraAskFirst: ['hiring'], extra: 'Mention the agent by name' })
    const p = parseSkill(md)
    const body = (t: string) => p.sections.find(s => s.title === t)!.body
    expect(body('Tone and format')).toMatch(/Tone \(owner's choice.*Friendly/)
    expect(body('Tone and format')).toMatch(/Max length: 2 sentences\./)
    expect(body('Tone and format')).toMatch(/Language: Chinese\./)
    expect(body('Ask me first').split('\n').pop()).toBe('- hiring')
    expect(body('Rules').split('\n').pop()).toBe('- Mention the agent by name')
    expect(body('Input')).toBe(parseSkill(def('answer-feishu')).sections.find(s => s.title === 'Input')!.body)
    expect(lintSkill('answer-feishu', md, def('answer-feishu'))).toEqual([])
  })
  it('empty overlay = the default unchanged', () => {
    expect(applyOverlay(def('handle-jira'), {})).toBe(def('handle-jira'))
  })
})

describe('lint', () => {
  const id = 'reply-email'
  const base = () => def(id)
  const rules = (md: string) => lintSkill(id, md, base()).map(p => p.rule)

  it('passes the default and a round-tripped render', () => {
    expect(rules(base())).toEqual([])
    expect(rules(renderSkill(parseSkill(base())))).toEqual([])
  })
  it('frontmatter missing', () => {
    expect(rules(base().replace(/^---[\s\S]*?---\n/, ''))).toContain('frontmatter')
  })
  it('name must equal the id', () => {
    const p = lintSkill(id, base().replace('name: reply-email', 'name: other'), base())
    expect(p).toEqual([{ rule: 'name', message: 'Frontmatter name must be "reply-email" (is "other")' }])
  })
  it('missing section', () => {
    const p = lintSkill(id, base().replace('## Examples', '## Samples'), base())
    expect(p.map(x => x.message)).toEqual(['Missing section: ## Examples', 'Unknown section: ## Samples'])
  })
  it('sections out of order', () => {
    const p = parseSkill(base())
    ;[p.sections[0], p.sections[2]] = [p.sections[2], p.sections[0]]
    expect(lintSkill(id, renderSkill(p), base()).map(x => x.message)).toEqual([`Sections out of order: ${SECTIONS.join(' → ')}`])
  })
  it('Input and Output are locked', () => {
    const p = parseSkill(base())
    p.sections.find(s => s.title === 'Input')!.body += '\n- Also the CRM'
    p.sections.find(s => s.title === 'Output')!.body = 'Send it.'
    expect(lintSkill(id, renderSkill(p), base()).map(x => x.message)).toEqual([
      '## Input is locked: keep it as shipped', '## Output is locked: keep it as shipped'
    ])
  })
  it('locked ask-first lines cannot be removed or reworded', () => {
    const md = base().replace(/^- 🔒 prices.*\n/m, '').replace('🔒 dates —', '🔒 dates:')
    const p = lintSkill(id, md, base())
    expect(p.map(x => x.rule)).toEqual(['locked-line', 'locked-line'])
    expect(p[0].message).toMatch(/^Locked line removed: 🔒 dates/)
    expect(p[1].message).toMatch(/^Locked line removed: 🔒 prices/)
  })
  it('extra ask-first lines and edited rules are fine', () => {
    expect(rules(base().replace('## Tone and format', '- hiring — anything about hiring\n\n## Tone and format').replace('Plain and calm.', 'Casual.'))).toEqual([])
  })
})

describe('store', () => {
  it('a renamed skill keeps the owner\'s choices (jira-check → handle-jira)', () => {
    mkdirSync(join(store.butlerDir, 'skills'), { recursive: true })
    writeFileSync(join(store.butlerDir, 'skills', 'jira-check.json'), '{"tone":"formal"}')
    composeSkills(store)
    expect(readFileSync(join(store.butlerDir, 'skills', 'handle-jira.json'), 'utf8')).toBe('{"tone":"formal"}')
    expect(existsSync(join(store.butlerDir, 'skills', 'jira-check.json'))).toBe(false)
  })
  it('composes every effective skill into .claude/skills/<id>/SKILL.md', () => {
    saveOverlay(store, 'answer-feishu', { tone: 'friendly' })
    expect(composeSkills(store)).toEqual(ALL_IDS)
    for (const id of ALL_IDS) expect(existsSync(join(store.butlerDir, '.claude', 'skills', id, 'SKILL.md'))).toBe(true)
    expect(readFileSync(join(store.butlerDir, '.claude', 'skills', 'answer-feishu', 'SKILL.md'), 'utf8')).toMatch(/Friendly/)
    expect(readFileSync(join(store.butlerDir, '.claude', 'skills', 'handle-jira', 'SKILL.md'), 'utf8')).toBe(def('handle-jira'))
  })
  it('installButlerFiles composes the skills and never touches the owner\'s files', () => {
    const dest = join(mkdtempSync(join(tmpdir(), 'hive-butler-')), 'butler')
    mkdirSync(join(dest, 'skills'), { recursive: true })
    const mine = readFileSync(join(SHIPPED, 'reply-email.md'), 'utf8').replace('Plain and calm.', 'Very casual.')
    writeFileSync(join(dest, 'skills', 'reply-email.md'), mine)
    writeFileSync(join(dest, 'skills', 'handle-jira.json'), '{"tone":"formal"}')
    installButlerFiles(RESOURCES, dest)
    expect(readFileSync(join(dest, 'skills', 'reply-email.md'), 'utf8')).toBe(mine)
    expect(readFileSync(join(dest, 'skills', 'handle-jira.json'), 'utf8')).toBe('{"tone":"formal"}')
    expect(readFileSync(join(dest, '.claude', 'skills', 'reply-email', 'SKILL.md'), 'utf8')).toBe(mine)
    expect(readFileSync(join(dest, '.claude', 'skills', 'handle-jira', 'SKILL.md'), 'utf8')).toMatch(/Formal —/)
  })
  it('override wins over default + overlay', () => {
    saveOverlay(store, 'reply-email', { tone: 'formal' })
    const mine = def('reply-email').replace('Plain and calm.', 'Warm.')
    expect(saveOverride(store, 'reply-email', mine)).toEqual({ ok: true, problems: [] })
    expect(effectiveSkill(store, 'reply-email').md).toBe(mine)
    expect(skillDetail(store, 'reply-email').customized).toBe('override')
  })
  it('refuses to save an override that fails lint', () => {
    const r = saveOverride(store, 'reply-email', def('reply-email').replace(/^- 🔒 sending.*\n/m, ''))
    expect(r.ok).toBe(false)
    expect(r.problems[0].rule).toBe('locked-line')
    expect(existsSync(userFile('reply-email.md'))).toBe(false)
  })
  it('a hand-edited override that drops a locked line is not used', () => {
    mkdirSync(join(store.butlerDir, 'skills'), { recursive: true })
    writeFileSync(userFile('answer-feishu.md'), def('answer-feishu').replace(/^- 🔒 prices.*\n/m, ''))
    saveOverlay(store, 'answer-feishu', { tone: 'direct' })
    const e = effectiveSkill(store, 'answer-feishu')
    expect(e.problems.map(p => p.rule)).toEqual(['locked-line'])
    expect(e.md).toMatch(/🔒 prices/)
    expect(e.md).toMatch(/Direct —/)
    expect(listSkills(store).find(s => s.id === 'answer-feishu')!.overrideProblems).toHaveLength(1)
  })
  it('lists customized state', () => {
    saveOverlay(store, 'handle-jira', { maxLength: '5 lines' })
    const l = listSkills(store)
    expect(l.map(s => s.id)).toEqual(ALL_IDS)
    expect(l.find(s => s.id === 'handle-jira')!.customized).toBe('form')
    expect(l.find(s => s.id === 'sort-inbox')!.customized).toBe('none')
  })
  it('saving an empty form removes the overlay file', () => {
    saveOverlay(store, 'handle-jira', { maxLength: '5 lines' })
    expect(existsSync(userFile('handle-jira.json'))).toBe(true)
    saveOverlay(store, 'handle-jira', {})
    expect(existsSync(userFile('handle-jira.json'))).toBe(false)
    expect(readOverlay(store, 'handle-jira')).toEqual({})
  })
  it('reset deletes only that skill\'s files', () => {
    saveOverlay(store, 'reply-email', { tone: 'formal' })
    saveOverride(store, 'reply-email', def('reply-email').replace('Plain and calm.', 'Warm.'))
    saveOverlay(store, 'handle-jira', { tone: 'formal' })
    resetSkill(store, 'reply-email')
    expect(existsSync(userFile('reply-email.md'))).toBe(false)
    expect(existsSync(userFile('reply-email.json'))).toBe(false)
    expect(existsSync(userFile('handle-jira.json'))).toBe(true)
    expect(effectiveSkill(store, 'reply-email').md).toBe(def('reply-email'))
    const meta = JSON.parse(readFileSync(userFile('.meta.json'), 'utf8'))
    expect(Object.keys(meta)).toEqual(['handle-jira'])
  })
})

describe('default updated', () => {
  it('flags an override whose default changed since, until "Keep mine"', () => {
    const mine = def('reply-email').replace('Plain and calm.', 'Warm.')
    saveOverride(store, 'reply-email', mine)
    expect(skillDetail(store, 'reply-email').defaultUpdated).toBe(false)
    writeFileSync(join(store.defaultsDir, 'reply-email.md'), def('reply-email').replace('Short sentences.', 'Very short sentences.'))
    expect(listSkills(store).find(s => s.id === 'reply-email')!.defaultUpdated).toBe(true)
    const c = compareSkill(store, 'reply-email')
    expect(c.mine).toBe(mine)
    expect(c.diff.filter(l => l.op !== ' ')).toEqual([
      { op: '-', text: '- Warm. Short sentences.' }, { op: '+', text: '- Plain and calm. Very short sentences.' }
    ])
    ackDefault(store, 'reply-email')
    expect(skillDetail(store, 'reply-email').defaultUpdated).toBe(false)
  })
  it('an update shows its version and changes; Overwrite / Save mine as a copy / Keep mine', () => {
    const log = readChangelog(store)
    log['reply-email'] = [...(log['reply-email'] ?? []), { version: 2, date: '2026-10-22', changes: ['Shorter replies'] }]
    writeFileSync(join(store.defaultsDir, 'changelog.json'), JSON.stringify(log))
    const mine = def('reply-email').replace('Plain and calm.', 'Warm.')
    writeFileSync(join(store.defaultsDir, 'reply-email.md'), def('reply-email'))
    saveOverride(store, 'reply-email', mine)
    saveOverlay(store, 'reply-email', { tone: 'formal' })
    // remembered as based on v2 now; pretend it was written against v1 and the text changed since
    const metaFile = join(store.butlerDir, 'skills', '.meta.json')
    const meta = JSON.parse(readFileSync(metaFile, 'utf8'))
    meta['reply-email'] = { defaultHash: 'old', version: 1 }
    writeFileSync(metaFile, JSON.stringify(meta))
    const info = skillDetail(store, 'reply-email')
    expect(info).toMatchObject({ defaultUpdated: true, version: 2, baseVersion: 1, updates: [{ version: 2, changes: ['Shorter replies'] }] })
    expect(newSkillUpdates(store)).toEqual([{ id: 'reply-email', name: 'reply-email', version: 2, changes: ['Shorter replies'] }])
    expect(newSkillUpdates(store)).toEqual([])
    const copy = saveNewAsCopy(store, 'reply-email')
    expect(copy).toMatch(/reply-email\.new-v2\.md$/)
    expect(readFileSync(copy, 'utf8')).toBe(def('reply-email'))
    expect(readOverride(store, 'reply-email')).toBe(mine.trimEnd() + '\n')
    expect(skillDetail(store, 'reply-email')).toMatchObject({ defaultUpdated: false, customized: 'override' })
    saveOverride(store, 'reply-email', mine)
    useNewDefault(store, 'reply-email')
    expect(readOverride(store, 'reply-email')).toBeNull()
  })
  it('Merge asks the model to keep the owner\'s version and bring in the listed changes', async () => {
    const log = readChangelog(store)
    log['reply-email'] = [...(log['reply-email'] ?? []), { version: 2, date: '2026-10-22', changes: ['Shorter replies'] }]
    writeFileSync(join(store.defaultsDir, 'changelog.json'), JSON.stringify(log))
    const mine = def('reply-email').replace('Plain and calm.', 'Warm.')
    saveOverride(store, 'reply-email', mine)
    const metaFile = join(store.butlerDir, 'skills', '.meta.json')
    const meta = JSON.parse(readFileSync(metaFile, 'utf8'))
    meta['reply-email'] = { defaultHash: 'old', version: 1 }
    writeFileSync(metaFile, JSON.stringify(meta))
    let prompt = ''
    const merged = mine.replace('Short sentences.', 'Short sentences. Shorter replies.')
    const r = await mergeUpdate(store, 'reply-email', async p => { prompt = p; return `<<<SKILL\n${merged}\nSKILL>>>\n<<<EXAMPLE\nhi\nEXAMPLE>>>` })
    expect(prompt).toContain('- v2: Shorter replies')
    expect(prompt).toContain('Keep everything the owner wrote')
    expect(r).toMatchObject({ ok: true, problems: [] })
    expect(r.md).toContain('Warm.')
  })
  it('every shipped skill has a changelog whose latest entry matches the shipped text (edit a skill → bump its version)', () => {
    const log = readChangelog({ defaultsDir: SHIPPED, butlerDir: '' })
    for (const f of readdirSync(SHIPPED).filter(f => f.endsWith('.md'))) {
      const id = f.slice(0, -3)
      const entries = log[id] ?? []
      expect(entries.length, `${id} has no changelog entry`).toBeGreaterThan(0)
      const latest = entries[entries.length - 1]
      expect(latest.hash, `${id}.md changed: add a version to changelog.json with its hash`).toBe(hashText(readFileSync(join(SHIPPED, f), 'utf8')))
    }
  })
  it('a form-only customization never reports it (the overlay follows the new default)', () => {
    saveOverlay(store, 'reply-email', { tone: 'formal' })
    writeFileSync(join(store.defaultsDir, 'reply-email.md'), def('reply-email').replace('Short sentences.', 'Very short.'))
    expect(skillDetail(store, 'reply-email').defaultUpdated).toBe(false)
    expect(effectiveSkill(store, 'reply-email').md).toMatch(/Very short\./)
  })
})

describe('diff + chips', () => {
  it('line diff', () => {
    expect(lineDiff('a\nb\nc', 'a\nx\nc')).toEqual([{ op: ' ', text: 'a' }, { op: '-', text: 'b' }, { op: '+', text: 'x' }, { op: ' ', text: 'c' }])
    expect(lineDiff('', 'a').filter(l => l.op === '+')).toEqual([{ op: '+', text: 'a' }])
  })
  it('chips name the section and the change', () => {
    const before = def('answer-feishu')
    const after = before.replace('- Plain text; no headings, no tables.', '- Casual, no 您好.').replace('## Tone and format', '- hiring — anything about hiring\n\n## Tone and format')
    expect(changeChips(before, after)).toEqual(['Ask first ＋ hiring — anything about hiring', 'Tone ＋ Casual, no 您好.'])
  })
  it('caps the number of chips', () => {
    const p = parseSkill(def('handle-jira'))
    for (const s of p.sections) s.body += '\n- new line'
    expect(changeChips(def('handle-jira'), renderSkill(p), 3)).toEqual(['Purpose ＋ new line', 'Input ＋ new line', '+5 more'])
  })
})

describe('talk-to-edit', () => {
  const reply = (md: string, example = 'ex') => `<<<SKILL\n${md}\nSKILL>>>\n<<<EXAMPLE\n${example}\nEXAMPLE>>>`

  it('parses the two blocks, tolerating a code fence', () => {
    expect(parseEditReply(reply('---\nname: x\n---', 'hi'))).toEqual({ md: '---\nname: x\n---\n', example: 'hi' })
    expect(parseEditReply('```markdown\n---\nname: x\n---\n```')).toEqual({ md: '---\nname: x\n---\n', example: '' })
  })
  it('returns the proposal with chips, diff and example, without saving', async () => {
    const before = def('answer-feishu')
    const after = before.replace('- Plain text; no headings, no tables.', '- Casual, no 您好.')
    const prompts: string[] = []
    const r = await proposeEdit(store, 'answer-feishu', '别太正式', async p => { prompts.push(p); return reply(after, '【Mei 的 AI 代理】PR 提了。') })
    expect(r.ok).toBe(true)
    expect(r.problems).toEqual([])
    expect(r.md).toBe(after)
    expect(r.example).toBe('【Mei 的 AI 代理】PR 提了。')
    expect(r.chips).toEqual(['Tone ＋ Casual, no 您好.'])
    expect(r.diff!.some(l => l.op === '+' && l.text === '- Casual, no 您好.')).toBe(true)
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toMatch(/Owner's request: 别太正式/)
    expect(prompts[0]).toMatch(/## Input and ## Output are locked/)
    expect(existsSync(userFile('answer-feishu.md'))).toBe(false)
    expect(saveOverride(store, 'answer-feishu', r.md!).ok).toBe(true)
    expect(effectiveSkill(store, 'answer-feishu').md).toBe(after)
  })
  it('retries once with the lint problems, then reports them', async () => {
    const bad = def('answer-feishu').replace(/^- 🔒 prices.*\n/m, '')
    const prompts: string[] = []
    const r = await proposeEdit(store, 'answer-feishu', 'drop prices', async p => { prompts.push(p); return reply(bad) })
    expect(prompts).toHaveLength(2)
    expect(prompts[1]).toMatch(/failed these checks[\s\S]*Locked line removed: 🔒 prices/)
    expect(r.ok).toBe(true)
    expect(r.problems!.map(p => p.rule)).toEqual(['locked-line'])
  })
  it('a fixed second attempt is clean', async () => {
    const good = def('answer-feishu').replace('Short: 1–3 sentences.', 'Short: 1–2 sentences.')
    let n = 0
    const r = await proposeEdit(store, 'answer-feishu', 'shorter', async () => reply(n++ ? good : 'garbage'))
    expect(r.problems).toEqual([])
    expect(r.md).toBe(good)
  })
  it('runner failure and empty request', async () => {
    expect(await proposeEdit(store, 'answer-feishu', 'x', async () => { throw new Error('not logged in') })).toEqual({ ok: false, error: 'not logged in' })
    expect(await proposeEdit(store, 'answer-feishu', '  ', async () => '')).toEqual({ ok: false, error: 'empty_request' })
  })
  it('edits the effective skill (form choices included)', async () => {
    saveOverlay(store, 'answer-feishu', { extraAskFirst: ['hiring'] })
    const prompts: string[] = []
    await proposeEdit(store, 'answer-feishu', 'x', async p => { prompts.push(p); return '' })
    expect(prompts[0]).toMatch(/- hiring/)
    expect(editPrompt('S', 'R')).toMatch(/<<<SKILL/)
  })
})

describe('try it', () => {
  it('runs the effective skill on the sample with the profile, nothing saved', async () => {
    mkdirSync(store.butlerDir, { recursive: true })
    saveOverlay(store, 'reply-email', { tone: 'friendly' })
    const prompts: string[] = []
    const r = await tryIt(store, 'reply-email', 'Lin: export broken', async p => { prompts.push(p); return '  Hi Lin…  ' }, { profileMd: '# About the owner\nMei' })
    expect(r).toEqual({ ok: true, output: `${DRY_RUN_NOTE}\n\nHi Lin…` })
    expect(prompts[0]).toMatch(/dry run/)
    expect(prompts[0]).toMatch(/<profile>\n# About the owner\nMei\n<\/profile>/)
    expect(prompts[0]).toMatch(/Friendly —/)
    expect(prompts[0]).toMatch(/<input>\nLin: export broken\n<\/input>/)
  })
  it('JSON skills read as what they mean, not as JSON', () => {
    expect(readableOutput('answer-feishu', '{"category":"product-status","level":"auto","confidence":"medium","reply":"哪一项？","sources":["P4-1"],"claims":[{"claim":"c","verdict":"unverified","source":""}]}'))
      .toBe('Reply: 哪一项？\nAUTO · product-status · confidence medium\nSources: P4-1\nClaims:\n- c → unverified')
    expect(readableOutput('reply-email', '{"about":"Lin asks","decision":"draft","reply":"Hi Lin"}')).toBe('About: Lin asks\n\nHi Lin')
    expect(readableOutput('reply-email', '{"about":"Gary asks","decision":"ask","question":"Take it on?"}')).toBe('About: Gary asks\nNeeds you: Take it on?')
    expect(readableOutput('morning-plan', 'plain text')).toBe('plain text')
  })
  it('can try a pending (unsaved) version', async () => {
    const prompts: string[] = []
    await tryIt(store, 'reply-email', 'x', async p => { prompts.push(p); return 'ok' }, { md: 'PENDING SKILL' })
    expect(prompts[0]).toMatch(/<skill>\nPENDING SKILL\n<\/skill>/)
  })
  it('errors', async () => {
    expect(await tryIt(store, 'reply-email', '', async () => 'x')).toEqual({ ok: false, error: 'empty_input' })
    expect(await tryIt(store, 'reply-email', 'x', async () => '   ')).toEqual({ ok: false, error: 'empty_output' })
    expect(await tryIt(store, 'reply-email', 'x', async () => { throw new Error('timeout') })).toEqual({ ok: false, error: 'timeout' })
    await expect(tryIt(store, '../x', 'x', async () => 'x')).rejects.toThrow('bad_id')
  })
})

describe('ipc', () => {
  it('reading never creates the Butler folder', async () => {
    const handlers = new Map<string, (e: unknown, ...a: any[]) => any>()
    registerButlerSkillsIpc({ ipcMain: { handle: (c, fn) => { handlers.set(c, fn) } }, butlerDir: () => store.butlerDir, defaultsDir: store.defaultsDir })
    expect((await handlers.get('butlerSkills:list')!(null)).map((s: any) => s.id)).toEqual(ALL_IDS)
    expect((await handlers.get('butlerSkills:get')!(null, 'reply-email')).effective).toBe(def('reply-email'))
    expect(existsSync(store.butlerDir)).toBe(false)
  })
  function setup() {
    const handlers = new Map<string, (e: unknown, ...a: any[]) => any>()
    const revealed: string[] = []
    registerButlerSkillsIpc({
      ipcMain: { handle: (c, fn) => { handlers.set(c, fn) } },
      butlerDir: () => { mkdirSync(store.butlerDir, { recursive: true }); return store.butlerDir },
      defaultsDir: store.defaultsDir,
      run: async () => 'out',
      reveal: p => revealed.push(p),
      previewFeishu: async (text: string) => (text === 'offline' ? { ok: false, error: 'signed_out' } : {
        ok: true, wouldSend: '你说的是 FAE-1 还是 FAE-2？', draft: '你说的是 FAE-1 还是 FAE-2？', relation: 'unknown', calendarKnown: false, ms: 4200,
        gate: { level: 'auto', reasons: [] }, answer: { category: 'product-status', confidence: 'high', sources: ['FAE-1', 'FAE-2'], claims: [] }
      })
    })
    const call = (c: string, ...a: unknown[]) => handlers.get(c)!(null, ...a)
    return { call, revealed }
  }
  it('saves recompose .claude/skills; bad ids come back as errors', async () => {
    const { call, revealed } = setup()
    await call('butlerSkills:saveOverlay', 'answer-feishu', { tone: 'friendly' })
    expect(readFileSync(join(store.butlerDir, '.claude', 'skills', 'answer-feishu', 'SKILL.md'), 'utf8')).toMatch(/Friendly/)
    await call('butlerSkills:reset', 'answer-feishu')
    expect(readFileSync(join(store.butlerDir, '.claude', 'skills', 'answer-feishu', 'SKILL.md'), 'utf8')).toBe(def('answer-feishu'))
    expect(await call('butlerSkills:get', '../../etc')).toEqual({ ok: false, error: 'bad_id' })
    expect(await call('butlerSkills:try', '../x', 'y')).toEqual({ ok: false, error: 'bad_id' })
    expect(await call('butlerSkills:try', 'reply-email', 'y')).toEqual({ ok: true, output: `${DRY_RUN_NOTE}\n\nout` })
    // answer-feishu: the real check, read as the owner reads it.
    expect((await call('butlerSkills:try', 'answer-feishu', 'checkout 好了吗？')).output).toBe(
      'Real check · tools ran, nothing was sent\n\nWould send: 你说的是 FAE-1 还是 FAE-2？\nAUTO · product-status · confidence high · 4.2s\nSources: FAE-1, FAE-2\nSender: unknown · calendar no')
    // An unsaved version, or no check available: the labelled dry run.
    expect((await call('butlerSkills:try', 'answer-feishu', 'x', '---\nname: answer-feishu\n---')).output.startsWith(DRY_RUN_NOTE)).toBe(true)
    expect((await call('butlerSkills:try', 'answer-feishu', 'offline')).output.startsWith(DRY_RUN_NOTE)).toBe(true)
    await call('butlerSkills:reveal', 'reply-email')
    expect(revealed).toEqual([join(store.butlerDir, 'skills')])
    expect(await call('butler:profilePreview', { name: 'Mei', prefix: '【Mei 的 AI 代理】' })).toMatch(/Start every message you send for them with: 【Mei 的 AI 代理】/)
  })
})
