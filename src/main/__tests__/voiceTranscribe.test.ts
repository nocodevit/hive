import { describe, it, expect, vi, afterEach } from 'vitest'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { parseAudioLine, buildVocabPrompt, transcribeWav, resolveUtterance, createSpeechLineHandler, startSpeechHelper, pickModel, TRANSCRIBE_MODEL, TRANSCRIBE_URL } from '../voiceTranscribe'

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

describe('pickModel', () => {
  it('accepts the two supported models and defaults anything else', () => {
    expect(pickModel('gpt-transcribe')).toBe('gpt-transcribe')
    expect(pickModel('gpt-4o-mini-transcribe')).toBe('gpt-4o-mini-transcribe')
    expect(pickModel('whisper-1')).toBe(TRANSCRIBE_MODEL)
    expect(pickModel(undefined)).toBe(TRANSCRIBE_MODEL)
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
  it('omits the prompt when there is none, and always sends the Chinese hint', async () => {
    const f = okFetch('hi')
    await transcribeWav(new Uint8Array([1]), { apiKey: 'k', fetchImpl: f as any })
    const body = (f.mock.calls[0] as any)[1].body
    expect(body.has('prompt')).toBe(false)
    expect(body.get('language')).toBe('zh')
  })
  it('sends the chosen model', async () => {
    const f = okFetch('hi')
    await transcribeWav(new Uint8Array([1]), { apiKey: 'k', model: 'gpt-transcribe', fetchImpl: f as any })
    expect((f.mock.calls[0] as any)[1].body.get('model')).toBe('gpt-transcribe')
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
    expect(d.transcribe).toHaveBeenCalledWith(expect.any(Uint8Array), { apiKey: 'k', prompt: 'Missy', model: undefined })
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
    const d = { ...base(), prompt: '', apiKey: 'k', model: 'gpt-transcribe' as const, transcribe: vi.fn(async () => 'x') }
    await resolveUtterance(line, d)
    expect(d.transcribe).toHaveBeenCalledWith(expect.any(Uint8Array), { apiKey: 'k', prompt: undefined, model: 'gpt-transcribe' })
  })
})

describe('createSpeechLineHandler', () => {
  const later = <T,>(ms: number, v: T) => new Promise<T>(r => setTimeout(() => r(v), ms))

  it('passes previews and utterance markers through untouched and immediately', () => {
    const send = vi.fn()
    const h = createSpeechLineHandler({ send, resolve: vi.fn() })
    h.handle('speaking:')
    h.handle('partial:我现在')
    h.handle('dropped:')
    expect(send.mock.calls.map(c => c[0])).toEqual(['speaking:', 'partial:我现在', 'dropped:'])
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
  it('still answers an utterance that resolves to nothing', async () => {
    const sent: string[] = []
    const h = createSpeechLineHandler({ send: l => sent.push(l), resolve: async () => '' })
    h.handle('audio:/1.wav')
    await h.idle()
    expect(sent).toEqual(['final:'])
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

describe.skipIf(process.platform === 'win32')('startSpeechHelper', () => {
  const dirs: string[] = []
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

  /** A stand-in helper: a shell script instead of the Swift binary. */
  function fake(body: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'hive-fake-speech-'))
    dirs.push(dir)
    const bin = join(dir, 'helper.sh')
    writeFileSync(bin, `#!/bin/bash\n${body}\n`)
    chmodSync(bin, 0o755)
    return bin
  }
  const run = (body: string) => {
    const lines: string[] = []
    const state: { exit: { expected: boolean; lastError: string } | null } = { exit: null }
    let finished!: () => void
    const done = new Promise<void>(resolve => { finished = resolve })
    const helper = startSpeechHelper(fake(body), ['zh-CN'], {
      onLine: l => lines.push(l),
      onExit: (expected, lastError) => { state.exit = { expected, lastError }; finished() }
    })
    return { lines, done, helper, get exit() { return state.exit } }
  }

  it('delivers whole lines even when the output arrives in pieces', async () => {
    const r = run(`printf 'partial:我现'; sleep 0.05; printf '在\npartial:我现在想说\nau'; sleep 0.05; printf 'dio:/tmp/a.wav\t我现在想说\n'`)
    await r.done
    expect(r.lines).toEqual(['partial:我现在', 'partial:我现在想说', 'audio:/tmp/a.wav\t我现在想说'])
  })

  it('reports a helper that dies by itself as unexpected, with its last error', async () => {
    const r = run(`echo 'error: audio engine failed to start: no input device' >&2; exit 1`)
    await r.done
    expect(r.exit).toEqual({ expected: false, lastError: 'audio engine failed to start: no input device' })
  })

  it('flushes an unterminated last line on exit', async () => {
    const r = run(`printf 'audio:/tmp/last.wav\tx'`)
    await r.done
    expect(r.lines).toEqual(['audio:/tmp/last.wav\tx'])
  })

  it('stop() waits for the hand-over the helper prints on SIGTERM', async () => {
    const r = run(`trap 'sleep 0.1; printf "audio:/tmp/tail.wav\\tlast words\\n"; exit 0' TERM; echo 'partial:hi'; while true; do sleep 0.05; done`)
    await vi.waitFor(() => expect(r.lines).toEqual(['partial:hi']), { timeout: 3000 })
    await r.helper.stop()
    expect(r.lines).toEqual(['partial:hi', 'audio:/tmp/tail.wav\tlast words'])
    expect(r.exit).toEqual({ expected: true, lastError: '' })
  })

  it('stop() force-kills a helper that ignores SIGTERM', async () => {
    const r = run(`trap '' TERM; echo 'partial:hi'; while true; do sleep 0.05; done`)
    await vi.waitFor(() => expect(r.lines).toEqual(['partial:hi']), { timeout: 3000 })
    await r.helper.stop(150)
    expect(r.exit?.expected).toBe(true)
  })

  it('kill() ends it immediately and counts as expected', async () => {
    const r = run(`while true; do sleep 0.05; done`)
    r.helper.kill()
    await r.done
    expect(r.exit?.expected).toBe(true)
  })

  it('a missing binary surfaces as an unexpected exit, not a throw', async () => {
    const lines: string[] = []
    const exit = await new Promise<{ expected: boolean; lastError: string }>(resolve => {
      startSpeechHelper('/nonexistent/hive-speech', [], { onLine: l => lines.push(l), onExit: (expected, lastError) => resolve({ expected, lastError }) })
    })
    expect(exit.expected).toBe(false)
    expect(exit.lastError).toMatch(/ENOENT/)
  })
})
