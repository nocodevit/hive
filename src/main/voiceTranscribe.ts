// Cloud transcription for voice input. The hive-speech helper cuts the
// microphone stream into utterances and hands each one over as a WAV file
// plus macOS's own (single-language) guess; this module turns the file
// into text with OpenAI, which handles Chinese and English mixed in one
// sentence, and falls back to the macOS guess whenever the cloud path is
// unavailable.

import { readFileSync, unlinkSync } from 'fs'
import { spawn } from 'child_process'

// Default is the cheapest model, which is accurate on full sentences. In
// testing it misheard short, quiet phrases (a 2-second "说好了" came back
// as Korean) where gpt-transcribe with a language hint got them right, so
// the model is a user setting rather than a constant.
export const TRANSCRIBE_MODELS = ['gpt-4o-mini-transcribe', 'gpt-transcribe'] as const
export type TranscribeModel = (typeof TRANSCRIBE_MODELS)[number]
export const TRANSCRIBE_MODEL: TranscribeModel = 'gpt-4o-mini-transcribe'

export function pickModel(v: unknown): TranscribeModel {
  return (TRANSCRIBE_MODELS as readonly unknown[]).includes(v) ? (v as TranscribeModel) : TRANSCRIBE_MODEL
}

// Always hint Chinese. Measured: the hint does not disturb English or
// mixed speech (pure English sentences come back unchanged), while short
// Chinese phrases without it were returned in the wrong language. That
// made a manual 中/EN switch pointless, so there isn't one.
export const TRANSCRIBE_LANGUAGE = 'zh'
export const TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions'
const TRANSCRIBE_TIMEOUT_MS = 20_000

export interface AudioLine { path: string; fallback: string }

/** Helper stdout line `audio:<wav path>\t<macOS transcript>` → parts. */
export function parseAudioLine(line: string): AudioLine | null {
  if (!line.startsWith('audio:')) return null
  const rest = line.slice('audio:'.length)
  const tab = rest.indexOf('\t')
  const path = (tab === -1 ? rest : rest.slice(0, tab)).trim()
  if (!path) return null
  return { path, fallback: tab === -1 ? '' : rest.slice(tab + 1).trim() }
}

/**
 * Spelling hint for names the model can't know. Names only — a leading
 * instruction sentence made the model "correct" what was actually said
 * (it turned "by end of day" into "by end of the day" in testing).
 */
export function buildVocabPrompt(data: { projects?: unknown; agents?: unknown }, maxNames = 80, previous = ''): string {
  const names = new Set<string>()
  for (const list of [data.projects, data.agents]) {
    if (!Array.isArray(list)) continue
    for (const item of list) {
      const name = typeof item?.name === 'string' ? item.name.trim() : ''
      if (name) names.add(name)
    }
  }
  // The previous utterance of this listening session gives a short
  // follow-up the right language and topic.
  const list = Array.from(names).slice(0, maxNames).join(', ')
  const prev = previous.trim().slice(-200)
  return [list, prev].filter(Boolean).join('\n')
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: FormData; signal: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; json: () => Promise<any>; text: () => Promise<string> }>

export async function transcribeWav(
  wav: Uint8Array,
  opts: { apiKey: string; prompt?: string; model?: TranscribeModel; fetchImpl?: FetchLike; timeoutMs?: number }
): Promise<string> {
  const form = new FormData()
  form.append('model', opts.model ?? TRANSCRIBE_MODEL)
  form.append('response_format', 'json')
  form.append('language', TRANSCRIBE_LANGUAGE)
  if (opts.prompt) form.append('prompt', opts.prompt)
  form.append('file', new Blob([wav as BlobPart], { type: 'audio/wav' }), 'utterance.wav')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? TRANSCRIBE_TIMEOUT_MS)
  try {
    const res = await (opts.fetchImpl ?? (fetch as unknown as FetchLike))(TRANSCRIBE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.apiKey}` },
      body: form,
      signal: ctrl.signal
    })
    if (!res.ok) throw new Error(`openai_http_${res.status}`)
    const body = await res.json()
    return typeof body?.text === 'string' ? body.text.trim() : ''
  } finally {
    clearTimeout(timer)
  }
}

export interface UtteranceDeps {
  apiKey: string
  prompt: string
  model?: TranscribeModel
  readFile?: (path: string) => Uint8Array
  removeFile?: (path: string) => void
  transcribe?: typeof transcribeWav
  onError?: (message: string) => void
}

/**
 * One utterance → the text to type. Cloud result when a key is set and
 * the call succeeds; otherwise the macOS guess, so voice input degrades
 * instead of going silent. The recording is deleted in every case.
 */
export async function resolveUtterance(line: AudioLine, deps: UtteranceDeps): Promise<{ text: string; source: 'cloud' | 'local' }> {
  const read = deps.readFile ?? (p => readFileSync(p))
  const remove = deps.removeFile ?? (p => unlinkSync(p))
  try {
    if (!deps.apiKey) return { text: line.fallback, source: 'local' }
    const text = await (deps.transcribe ?? transcribeWav)(read(line.path), {
      apiKey: deps.apiKey, prompt: deps.prompt || undefined, model: deps.model
    })
    // An empty cloud result on audio macOS heard words in is more likely a
    // dropped segment than silence — keep what we have.
    return text ? { text, source: 'cloud' } : { text: line.fallback, source: 'local' }
  } catch (e) {
    deps.onError?.(e instanceof Error ? e.message : String(e))
    return { text: line.fallback, source: 'local' }
  } finally {
    try { remove(line.path) } catch { /* already gone */ }
  }
}

/**
 * Routes the helper's stdout lines: previews pass straight through,
 * utterances are resolved ONE AT A TIME so text reaches the input box in
 * the order it was spoken, however long each cloud call takes.
 */
export function createSpeechLineHandler(deps: {
  send: (line: string) => void
  resolve: (audio: AudioLine, previousText: string) => Promise<string>
}) {
  let queue: Promise<void> = Promise.resolve()
  let previousText = ''
  return {
    handle(line: string) {
      const audio = parseAudioLine(line)
      if (!audio) { deps.send(line); return }
      queue = queue.then(async () => {
        const text = await deps.resolve(audio, previousText).catch(() => audio.fallback)
        if (text) previousText = text
        // Always answer the utterance, even with nothing: the renderer
        // counts finals to know when all spoken text has arrived.
        deps.send(`final:${text}`)
      })
    },
    /** Resolves once every utterance handed over so far has been sent. */
    idle: () => queue
  }
}

/**
 * Run the hive-speech helper and feed its stdout to `onLine`, one complete
 * line at a time. `stop()` asks it to finish (it hands over the sentence
 * in progress first) and resolves once its output is fully read;
 * `onExit(expected)` tells an exit the user asked for from a crash.
 */
export function startSpeechHelper(bin: string, args: string[], hooks: {
  onLine: (line: string) => void
  onExit: (expected: boolean, lastError: string) => void
}) {
  const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  let pending = ''
  let lastError = ''
  let stopping = false
  let closed = false
  const waiters: Array<() => void> = []
  // Decode as streams: a chunk boundary can fall inside a Chinese character.
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (data: string) => {
    pending += data
    const parts = pending.split('\n')
    pending = parts.pop() || ''
    for (const line of parts) if (line) hooks.onLine(line)
  })
  child.stderr.on('data', (data: string) => {
    for (const line of data.split('\n')) if (line.startsWith('error:')) lastError = line.slice(6).trim()
  })
  const finish = () => {
    if (closed) return
    closed = true
    if (pending) { hooks.onLine(pending); pending = '' }
    hooks.onExit(stopping, lastError)
    for (const w of waiters.splice(0)) w()
  }
  child.on('close', finish)
  child.on('error', err => { lastError = err.message; finish() })
  const closedPromise = () => new Promise<void>(resolve => (closed ? resolve() : waiters.push(resolve)))
  return {
    /** Graceful: SIGTERM, wait for the hand-over; SIGKILL if it hangs. */
    async stop(graceMs = 3000) {
      stopping = true
      if (!closed) child.kill('SIGTERM')
      const timer = setTimeout(() => { if (!closed) child.kill('SIGKILL') }, graceMs)
      await closedPromise()
      clearTimeout(timer)
    },
    /** Immediate, for app quit — never leave a process holding the mic. */
    kill() {
      stopping = true
      if (!closed) child.kill('SIGKILL')
    }
  }
}
