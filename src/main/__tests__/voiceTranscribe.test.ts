import { describe, it, expect, vi } from 'vitest'
import { parseAudioLine, buildVocabPrompt, transcribeWav, resolveUtterance, createSpeechLineHandler, pickModel, languageHint, TRANSCRIBE_MODEL, TRANSCRIBE_URL } from '../voiceTranscribe'

describe('parseAudioLine', () => {
  it('splits path and the macOS fallback text', () => {
    expect(parseAudioLine('audio:/tmp/u1.wav\t我现在想说 project')).toEqual({ path: '/tmp/u1.wav', fallback: '我现在想说 project' })
  })
  it('accepts a line with no fallback', () => {
    expect(parseAudioLine('audio:/tmp/u1.wav')).toEqual({ path: '/tmp/u1.wav', fallback: '' })
    expect(parseAudioLine('audio:/tmp/u1.wav\t')).toEqual({ path: '/tmp/u1.wav', fallback: '' })
  })
  it('keeps tabs inside the fallback text', () => {
    expect(parseAudioLine('audio:/tmp/u1.wav\ta\tb')).toEqual({ path: '/tmp/u1.wav', fallback: 'a\tb' })
  })
  it('ignores other helper lines and empty paths', () => {
    expect(parseAudioLine('partial:hello')).toBeNull()
    expect(parseAudioLine('final:hello')).toBeNull()
    expect(parseAudioLine('audio:')).toBeNull()
    expect(parseAudioLine('audio:\tx')).toBeNull()
  })
})

describe('buildVocabPrompt', () => {
  it('lists unique project and agent names, names only', () => {
    expect(buildVocabPrompt({
      projects: [{ name: 'Cube v2' }, { name: 'Sphere 2' }],
      agents: [{ name: 'Missy' }, { name: ' Wendy ' }, { name: 'Missy' }, { name: '' }, {}]
    })).toBe('Cube v2, Sphere 2, Missy, Wendy')
  })
  it('caps the list and tolerates malformed data', () => {
    expect(buildVocabPrompt({ agents: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] }, 2)).toBe('a, b')
    expect(buildVocabPrompt({})).toBe('')
    expect(buildVocabPrompt({ projects: 'x', agents: null })).toBe('')
  })
  it('appends the previous utterance (tail only) as context', () => {
    expect(buildVocabPrompt({ agents: [{ name: 'Missy' }] }, 80, ' 我现在想说 project ')).toBe('Missy\n我现在想说 project')
    expect(buildVocabPrompt({}, 80, 'x'.repeat(300))).toBe('x'.repeat(200))
  })
})

describe('pickModel / languageHint', () => {
  it('accepts the two supported models and defaults anything else', () => {
    expect(pickModel('gpt-transcribe')).toBe('gpt-transcribe')
    expect(pickModel('gpt-4o-mini-transcribe')).toBe('gpt-4o-mini-transcribe')
    expect(pickModel('whisper-1')).toBe(TRANSCRIBE_MODEL)
    expect(pickModel(undefined)).toBe(TRANSCRIBE_MODEL)
  })
  it('maps the voice locale to a language hint, defaulting to Chinese', () => {
    expect(languageHint('en-US')).toBe('en')
    expect(languageHint('zh-CN')).toBe('zh')
    expect(languageHint(undefined)).toBe('zh')
  })
})

describe('transcribeWav', () => {
  const okFetch = (text: unknown) => vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ text }), text: async () => '' }))

  it('posts the wav to the transcription endpoint with the model, key and prompt', async () => {
    const f = okFetch('  我现在想说 project  ')
    const out = await transcribeWav(new Uint8Array([1, 2, 3]), { apiKey: 'k', prompt: 'Cube v2, Missy', fetchImpl: f as any })
    expect(out).toBe('我现在想说 project')
    const [url, init] = f.mock.calls[0] as any
    expect(url).toBe(TRANSCRIBE_URL)
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer k')
    expect(init.body.get('model')).toBe(TRANSCRIBE_MODEL)
    expect(init.body.get('prompt')).toBe('Cube v2, Missy')
    const file = init.body.get('file') as File
    expect(file.type).toBe('audio/wav')
    expect(file.size).toBe(3)
  })
  it('omits the prompt and language when there are none', async () => {
    const f = okFetch('hi')
    await transcribeWav(new Uint8Array([1]), { apiKey: 'k', fetchImpl: f as any })
    const body = (f.mock.calls[0] as any)[1].body
    expect(body.has('prompt')).toBe(false)
    expect(body.has('language')).toBe(false)
  })
  it('sends the chosen model and language hint', async () => {
    const f = okFetch('hi')
    await transcribeWav(new Uint8Array([1]), { apiKey: 'k', model: 'gpt-transcribe', language: 'zh', fetchImpl: f as any })
    const body = (f.mock.calls[0] as any)[1].body
    expect(body.get('model')).toBe('gpt-transcribe')
    expect(body.get('language')).toBe('zh')
  })
  it('throws on an HTTP error and returns empty for a missing text field', async () => {
    const bad = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => 'no' }))
    await expect(transcribeWav(new Uint8Array([1]), { apiKey: 'k', fetchImpl: bad as any })).rejects.toThrow('openai_http_401')
    expect(await transcribeWav(new Uint8Array([1]), { apiKey: 'k', fetchImpl: okFetch(undefined) as any })).toBe('')
  })
  it('aborts when the service does not answer in time', async () => {
    const hang = vi.fn((_url: string, init: any) => new Promise((_res, rej) => {
      init.signal.addEventListener('abort', () => rej(new Error('aborted')))
    }))
    await expect(transcribeWav(new Uint8Array([1]), { apiKey: 'k', fetchImpl: hang as any, timeoutMs: 20 })).rejects.toThrow('aborted')
  })
})

describe('resolveUtterance', () => {
  const line = { path: '/tmp/u1.wav', fallback: '本地识别的结果' }
  const base = () => ({ readFile: vi.fn(() => new Uint8Array([1])), removeFile: vi.fn(), prompt: 'Missy' })

  it('uses the cloud text when a key is set, then deletes the recording', async () => {
    const d = { ...base(), apiKey: 'k', transcribe: vi.fn(async () => '云端识别的结果') }
    expect(await resolveUtterance(line, d)).toEqual({ text: '云端识别的结果', source: 'cloud' })
    expect(d.transcribe).toHaveBeenCalledWith(expect.any(Uint8Array), { apiKey: 'k', prompt: 'Missy', model: undefined, language: undefined })
    expect(d.removeFile).toHaveBeenCalledWith('/tmp/u1.wav')
  })
  it('without a key: local text, nothing uploaded, recording still deleted', async () => {
    const d = { ...base(), apiKey: '', transcribe: vi.fn() }
    expect(await resolveUtterance(line, d)).toEqual({ text: '本地识别的结果', source: 'local' })
    expect(d.transcribe).not.toHaveBeenCalled()
    expect(d.readFile).not.toHaveBeenCalled()
    expect(d.removeFile).toHaveBeenCalledWith('/tmp/u1.wav')
  })
  it('falls back to the local text when the cloud call fails, and reports why', async () => {
    const onError = vi.fn()
    const d = { ...base(), apiKey: 'k', onError, transcribe: vi.fn(async () => { throw new Error('openai_http_500') }) }
    expect(await resolveUtterance(line, d)).toEqual({ text: '本地识别的结果', source: 'local' })
    expect(onError).toHaveBeenCalledWith('openai_http_500')
    expect(d.removeFile).toHaveBeenCalled()
  })
  it('falls back when the cloud returns nothing', async () => {
    const d = { ...base(), apiKey: 'k', transcribe: vi.fn(async () => '') }
    expect(await resolveUtterance(line, d)).toEqual({ text: '本地识别的结果', source: 'local' })
  })
  it('falls back when the recording cannot be read, and survives a failed delete', async () => {
    const d = {
      apiKey: 'k', prompt: '', onError: vi.fn(),
      readFile: vi.fn(() => { throw new Error('ENOENT') }),
      removeFile: vi.fn(() => { throw new Error('ENOENT') }),
      transcribe: vi.fn()
    }
    expect(await resolveUtterance(line, d)).toEqual({ text: '本地识别的结果', source: 'local' })
    expect(d.transcribe).not.toHaveBeenCalled()
    expect(d.onError).toHaveBeenCalledWith('ENOENT')
  })
  it('sends no prompt field when the vocabulary is empty', async () => {
    const d = { ...base(), prompt: '', apiKey: 'k', model: 'gpt-transcribe' as const, language: 'zh' as const, transcribe: vi.fn(async () => 'x') }
    await resolveUtterance(line, d)
    expect(d.transcribe).toHaveBeenCalledWith(expect.any(Uint8Array), { apiKey: 'k', prompt: undefined, model: 'gpt-transcribe', language: 'zh' })
  })
})

describe('createSpeechLineHandler', () => {
  const later = <T,>(ms: number, v: T) => new Promise<T>(r => setTimeout(() => r(v), ms))

  it('passes previews through untouched and immediately', () => {
    const send = vi.fn()
    const h = createSpeechLineHandler({ send, resolve: vi.fn() })
    h.handle('partial:我现在')
    expect(send).toHaveBeenCalledWith('partial:我现在')
  })
  it('emits finals in spoken order even when the first call is the slow one', async () => {
    const sent: string[] = []
    const h = createSpeechLineHandler({
      send: l => sent.push(l),
      resolve: a => (a.path === '/1.wav' ? later(40, '第一句') : later(1, '第二句'))
    })
    h.handle('audio:/1.wav\ta')
    h.handle('audio:/2.wav\tb')
    await h.idle()
    expect(sent).toEqual(['final:第一句', 'final:第二句'])
  })
  it('hands each utterance the previous final text as context', async () => {
    const resolve = vi.fn(async (a: { path: string }, _prev: string) => (a.path === '/1.wav' ? '第一句' : '第二句'))
    const h = createSpeechLineHandler({ send: vi.fn(), resolve })
    h.handle('audio:/1.wav')
    h.handle('audio:/2.wav')
    await h.idle()
    expect(resolve.mock.calls.map(c => c[1])).toEqual(['', '第一句'])
  })
  it('clears the preview when an utterance resolves to nothing', async () => {
    const sent: string[] = []
    const h = createSpeechLineHandler({ send: l => sent.push(l), resolve: async () => '' })
    h.handle('audio:/1.wav')
    await h.idle()
    expect(sent).toEqual(['partial:'])
  })
  it('a failing resolve falls back to the macOS text and does not block later utterances', async () => {
    const sent: string[] = []
    const h = createSpeechLineHandler({
      send: l => sent.push(l),
      resolve: async a => { if (a.path === '/1.wav') throw new Error('boom'); return '第二句' }
    })
    h.handle('audio:/1.wav\t本地一')
    h.handle('audio:/2.wav\t本地二')
    await h.idle()
    expect(sent).toEqual(['final:本地一', 'final:第二句'])
  })
  it('idle() covers utterances handed over after it was first awaited', async () => {
    const sent: string[] = []
    const h = createSpeechLineHandler({ send: l => sent.push(l), resolve: () => later(10, 'x') })
    h.handle('audio:/1.wav')
    await h.idle()
    h.handle('audio:/2.wav')
    await h.idle()
    expect(sent).toEqual(['final:x', 'final:x'])
  })
})
