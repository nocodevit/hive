import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// The voice helper cuts the microphone stream into utterances by loudness.
// Its `--file` mode feeds a recording through that same code, so the
// cutting can be checked without a microphone. macOS only (compiled Swift).
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

describe.skipIf(process.platform !== 'darwin' || !existsSync(HELPER))('hive-speech utterance segmentation', () => {
  const made: string[] = []
  afterEach(() => { for (const p of made.splice(0)) rmSync(p, { recursive: true, force: true }) })

  function run(spans: Array<[number, number]>): string[] {
    const dir = mkdtempSync(join(tmpdir(), 'hive-speech-test-'))
    made.push(dir)
    const input = join(dir, 'in.wav')
    writeFileSync(input, synth(spans))
    const out = execFileSync(HELPER, ['--file', input], { encoding: 'utf-8' })
    const paths = out.split('\n').filter(l => l.startsWith('audio:')).map(l => l.slice(6).split('\t')[0])
    made.push(...paths)
    return paths
  }

  it('cuts two phrases separated by a pause into two recordings', () => {
    const paths = run([[1, -43], [2, -25], [2, -43], [1.5, -25], [1.5, -43]])
    expect(paths).toHaveLength(2)
    // phrase + ~0.3s pre-roll + ~0.9s closing silence
    expect(secondsOf(paths[0])).toBeGreaterThan(2.5)
    expect(secondsOf(paths[0])).toBeLessThan(3.8)
    expect(secondsOf(paths[1])).toBeGreaterThan(2.0)
    expect(secondsOf(paths[1])).toBeLessThan(3.3)
  })

  it('still finds the pause in a noisy room (regression: floor stuck, everything read as speech)', () => {
    // Room noise at -43 dB — the level of the recording that first exposed this.
    expect(run([[1.5, -43], [3, -27], [2.5, -43], [1, -28], [1, -43]])).toHaveLength(2)
  })

  it('keeps a phrase together across a short breath', () => {
    expect(run([[1, -45], [1.5, -25], [0.4, -45], [1.5, -25], [1.5, -45]])).toHaveLength(1)
  })

  it('hands over a phrase that is still going when the input ends', () => {
    expect(run([[1, -45], [2, -25]])).toHaveLength(1)
  })

  it('drops clicks and produces nothing for a quiet room', () => {
    expect(run([[1, -45], [0.1, -25], [2, -45]])).toHaveLength(0)
    expect(run([[4, -45]])).toHaveLength(0)
  })
})
