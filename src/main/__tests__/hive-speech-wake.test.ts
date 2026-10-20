import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// `hive-speech --wake --file <wav> --hear "<sec>=<text>|…"` drives the wake
// state machine with a recording (for the loudness segmentation) and a
// scripted transcript standing in for the recognizer. macOS only.
const HELPER = join(__dirname, '..', '..', '..', 'scripts', 'hive-speech')
const RATE = 16000

/** `[seconds, dBFS]` spans → 16-bit mono WAV. Tone spans stand in for speech. */
function synth(spans: Array<[number, number]>): Buffer {
  const samples: number[] = []
  let seed = 7
  const noise = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1 }
  for (const [secs, db] of spans) {
    const amp = Math.pow(10, db / 20)
    const speechLike = db > -35
    for (let i = 0; i < secs * RATE; i++) {
      const v = speechLike ? Math.SQRT2 * amp * Math.sin((2 * Math.PI * 220 * i) / RATE) : amp * 1.7 * noise()
      samples.push(Math.round(Math.max(-1, Math.min(1, v)) * 32767))
    }
  }
  const data = Buffer.alloc(samples.length * 2)
  samples.forEach((s, i) => data.writeInt16LE(s, i * 2))
  const head = Buffer.alloc(44)
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVEfmt ', 8)
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22)
  head.writeUInt32LE(RATE, 24); head.writeUInt32LE(RATE * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34)
  head.write('data', 36); head.writeUInt32LE(data.length, 40)
  return Buffer.concat([head, data])
}

const secondsOf = (wav: string) => (statSync(wav).size - 44) / 2 / readFileSync(wav).readUInt32LE(24)
const wavsIn = (d: string) => readdirSync(d).filter(f => f.startsWith('hive-speech-') && f.endsWith('.wav'))

describe.skipIf(process.platform !== 'darwin' || !existsSync(HELPER))('hive-speech --wake (file mode)', () => {
  const made: string[] = []
  afterEach(() => { for (const p of made.splice(0)) rmSync(p, { recursive: true, force: true }) })

  function run(spans: Array<[number, number]>, hear: string): { lines: string[]; commands: Array<{ path: string; text: string }>; tmp: string } {
    const dir = mkdtempSync(join(tmpdir(), 'hive-wake-test-'))
    made.push(dir)
    const input = join(dir, 'in.wav')
    writeFileSync(input, synth(spans))
    // TMPDIR → the helper writes its recordings into this test's folder.
    const tmp = join(dir, 'out')
    execFileSync('mkdir', [tmp])
    const out = execFileSync(HELPER, ['--wake', '--file', input, '--hear', hear], { encoding: 'utf-8', env: { ...process.env, TMPDIR: tmp + '/' } })
    const lines = out.split('\n').filter(Boolean)
    const commands = lines.filter(l => l.startsWith('command:')).map(l => {
      const [path, text] = l.slice(8).split('\t')
      return { path, text }
    })
    return { lines, commands, tmp }
  }
  const kinds = (lines: string[]) => lines.map(l => l.slice(0, l.indexOf(':')))

  it('wake phrase + command in one breath → wake, then one command recording', () => {
    const r = run([[1, -45], [3, -25], [1.5, -45]], '1.5=Hola Butler tell Missy|3.5=Hola Butler tell Missy to go')
    expect(kinds(r.lines)).toEqual(['listening', 'wake', 'command'])
    expect(r.commands[0].text).toBe('tell missy to go')
    expect(secondsOf(r.commands[0].path)).toBeGreaterThan(3)
  })

  it('speech without the wake phrase prints nothing and writes no file', () => {
    const r = run([[1, -45], [2, -25], [1.5, -45], [2, -25], [1.5, -45]], '1.5=tell Missy to go|5=hello there')
    expect(kinds(r.lines)).toEqual(['listening'])
    expect(wavsIn(r.tmp)).toEqual([])
  })

  it('a lone "Hola Butler", a pause, then the command as the next utterance', () => {
    const r = run([[1, -45], [1, -25], [2, -45], [2.5, -25], [1.5, -45]], '1.5=Hola Butler|4.5=继续做 e2e')
    expect(kinds(r.lines)).toEqual(['listening', 'wake', 'command'])
    expect(r.commands[0].text).toBe('继续做 e2e')
    // Only the second utterance is recorded.
    expect(secondsOf(r.commands[0].path)).toBeLessThan(4.5)
    expect(secondsOf(r.commands[0].path)).toBeGreaterThan(2.5)
  })

  it('wake phrase after other words, with no timings: that recording is not used', () => {
    const r = run([[1, -45], [3, -25], [1.5, -45], [2, -25], [1.5, -45]], '3.5=and then hola butler tell Missy|6=tell Missy to go')
    expect(kinds(r.lines)).toEqual(['listening', 'wake', 'command'])
    expect(r.commands[0].text).toBe('tell Missy to go')
    expect(secondsOf(r.commands[0].path)).toBeLessThan(4)
  })

  it('wake heard but nothing follows → timeout', () => {
    const r = run([[1, -45], [1, -25], [10, -45]], '1.5=Hola Butler')
    expect(kinds(r.lines)).toEqual(['listening', 'wake', 'timeout'])
    expect(wavsIn(r.tmp)).toEqual([])
  })

  it('"cancel" right after a command → cancel; later speech is ignored again', () => {
    const r = run(
      [[1, -45], [2.5, -25], [1.5, -45], [0.8, -25], [10, -45], [1, -25], [1.5, -45]],
      '1.5=Hola Butler tell Quinn to go|4.5=cancel|16=cancel'
    )
    expect(kinds(r.lines)).toEqual(['listening', 'wake', 'command', 'cancel'])
  })

  it('"Hola Butler cancel" cancels without a recording', () => {
    const r = run([[1, -45], [1.5, -25], [1.5, -45]], '1.5=Hola Butler cancel')
    expect(kinds(r.lines)).toEqual(['listening', 'wake', 'cancel'])
    expect(wavsIn(r.tmp)).toEqual([])
  })
})
