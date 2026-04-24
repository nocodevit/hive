import { beforeEach, describe, expect, it } from 'vitest'
import { configureRedact, redact, isRedactEnabled } from '../crush-styles'

describe('redact — disabled by default', () => {
  beforeEach(() => { configureRedact({ enabled: false, tokens: [] }) })

  it('returns input unchanged when disabled', () => {
    expect(redact('hello meiyang /Users/meiyang/foo')).toBe('hello meiyang /Users/meiyang/foo')
  })

  it('isRedactEnabled reflects current state', () => {
    expect(isRedactEnabled()).toBe(false)
    configureRedact({ enabled: true, tokens: ['meiyang'] })
    expect(isRedactEnabled()).toBe(true)
  })

  it('returns input unchanged for empty/nullish values', () => {
    expect(redact('')).toBe('')
  })
})

describe('redact — token masking (first + ** + last)', () => {
  beforeEach(() => { configureRedact({ enabled: true, tokens: ['meiyang'] }) })

  it('masks the username wherever it appears', () => {
    expect(redact('hi meiyang')).toBe('hi m**g')
  })

  it('masks inside paths', () => {
    expect(redact('/Users/meiyang/foo')).toBe('/Users/m**g/foo')
  })

  it('case-insensitive match, keeps original case... via mask of original token', () => {
    // The mask is generated from the configured token's first+last chars.
    // Case in the matched input doesn't affect the mask output.
    expect(redact('hi MEIYANG!')).toBe('hi m**g!')
  })

  it('does not mask substrings shorter than the token', () => {
    expect(redact('me ya')).toBe('me ya')
  })

  it('multiple occurrences all masked', () => {
    expect(redact('meiyang /home/meiyang/.cache/meiyang-lock')).toBe('m**g /home/m**g/.cache/m**g-lock')
  })

  it('masks multiple tokens', () => {
    configureRedact({ enabled: true, tokens: ['meiyang', 'acme-corp'] })
    // Mask format is always first + ** + last — length of token doesn't change stars.
    expect(redact('hello meiyang @ acme-corp')).toBe('hello m**g @ a**p')
  })

  it('tokens shorter than 2 chars are ignored (no-op pattern)', () => {
    configureRedact({ enabled: true, tokens: ['x'] })
    expect(redact('x marks the spot')).toBe('x marks the spot')
  })

  it('tokens with regex metacharacters are escaped', () => {
    configureRedact({ enabled: true, tokens: ['a.b*c'] })
    // Token length 5 → mask = first + ** + last = "a**c"
    expect(redact('matches a.b*c literally, not a+bXc')).toBe('matches a**c literally, not a+bXc')
  })
})

describe('redact — secret-value masking', () => {
  beforeEach(() => { configureRedact({ enabled: true, tokens: [] }) })

  it('masks API_KEY= values', () => {
    const out = redact('API_KEY=sk_live_abc123xyz something')
    expect(out).toMatch(/^API_KEY=\*+ something$/)
    expect(out).not.toContain('sk_live')
  })

  it('masks quoted .env values', () => {
    expect(redact('SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"')).toMatch(/^SUPABASE_ANON_KEY="\*+"$/)
  })

  it('masks JSON secret values', () => {
    const out = redact('{"apiKey": "supersecret123"}')
    expect(out).toMatch(/"apiKey": "\*+"/)
    expect(out).not.toContain('supersecret')
  })

  it('masks Bearer tokens in Authorization headers', () => {
    expect(redact('Authorization: Bearer abc123XyZ.foo.bar')).toBe('Authorization: Bearer ***')
  })

  it('masks Basic auth tokens too', () => {
    expect(redact('Basic dXNlcjpwYXNzd29yZA==')).toBe('Basic ***')
  })

  it('leaves non-secret assignments alone', () => {
    expect(redact('PORT=3000 HOST=localhost')).toBe('PORT=3000 HOST=localhost')
  })

  it('leaves short plain values alone in YAML style', () => {
    // Short non-secret values look like key:value too. We don't mask
    // values < 6 chars and don't mask unless the key matches a secret pattern.
    expect(redact('foo: bar')).toBe('foo: bar')
  })

  it('catches DATABASE_URL-ish variants via secret pattern', () => {
    // access_key and private_key pattern matches.
    expect(redact('AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLE')).toMatch(/AWS_SECRET_ACCESS_KEY=\*+/)
  })

  it('supports tokens + secrets in same string', () => {
    configureRedact({ enabled: true, tokens: ['meiyang'] })
    const out = redact('User meiyang hit key API_KEY=supersecret999')
    expect(out).toContain('m**g')
    expect(out).not.toContain('supersecret')
  })
})
