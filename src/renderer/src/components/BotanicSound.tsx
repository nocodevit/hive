import { useEffect, useRef, useState } from 'react'
import { useBotanic } from './hive-chat/SucculentSend'
import { FADE, SOUNDS, fadeCurve, loadSoundPrefs, nextSound, nextStart, saveSoundPrefs, seam, soundLabel, type SoundId, type SoundPrefs } from '../lib/botanic-sound'

type Voice = { gain: GainNode; stop: () => void }

/** Plays one sound on a seamless loop: each copy fades in while the last fades out. */
function loopVoice(ctx: AudioContext, buf: AudioBuffer, out: AudioNode): Voice {
  const xf = seam(buf.duration)
  const gain = ctx.createGain()
  gain.gain.value = 0
  gain.connect(out)
  const up = fadeCurve(64, 'in'), down = fadeCurve(64, 'out')
  const live = new Set<AudioBufferSourceNode>()
  let next = ctx.currentTime + 0.05
  let timer = 0
  const schedule = () => {
    while (next < ctx.currentTime + 4) {
      const src = ctx.createBufferSource()
      src.buffer = buf
      const g = ctx.createGain()
      src.connect(g).connect(gain)
      const end = next + buf.duration
      g.gain.setValueCurveAtTime(up, next, xf)
      g.gain.setValueCurveAtTime(down, end - xf, xf)
      src.start(next)
      src.stop(end)
      live.add(src)
      src.onended = () => { live.delete(src); g.disconnect() }
      next = nextStart(next, buf.duration, xf)
    }
    timer = window.setTimeout(schedule, 1000)
  }
  schedule()
  return { gain, stop: () => { clearTimeout(timer); for (const s of live) { try { s.stop() } catch { /* not started */ } } gain.disconnect() } }
}

function fade(ctx: AudioContext, v: Voice, to: number) {
  const g = v.gain.gain, t = ctx.currentTime
  g.cancelScheduledValues(t)
  g.setValueAtTime(g.value, t)
  g.linearRampToValueAtTime(to, t + FADE)
}

/**
 * 🍃 Garden sounds, Botanic only, next to the Butler toggles: the leaf plays or
 * stops, the name switches sound, the slider sets the volume. Off at every
 * launch; the sound and volume are remembered. Leaving Botanic stops it.
 */
function GardenSound() {
  const [prefs, setPrefs] = useState<SoundPrefs>(loadSoundPrefs)
  const [on, setOn] = useState(false)
  const [state, setState] = useState<'off' | 'loading' | 'playing' | 'error'>('off')
  const audio = useRef<{ ctx: AudioContext; master: GainNode; bufs: Map<SoundId, AudioBuffer>; voice: Voice | null; all: Set<Voice> } | null>(null)
  const want = useRef<SoundId | null>(null)

  const engine = () => {
    if (!audio.current) {
      const ctx = new AudioContext()
      const master = ctx.createGain()
      master.gain.value = prefs.volume
      master.connect(ctx.destination)
      audio.current = { ctx, master, bufs: new Map(), voice: null, all: new Set() }
    }
    return audio.current
  }

  const play = async (id: SoundId) => {
    const a = engine()
    want.current = id
    setState('loading')
    try {
      await a.ctx.resume()
      let buf = a.bufs.get(id)
      if (!buf) {
        const data = await (await fetch(SOUNDS.find(s => s.id === id)!.url)).arrayBuffer()
        buf = await a.ctx.decodeAudioData(data)
        a.bufs.set(id, buf)
      }
      if (want.current !== id) return
      if (a.voice) retire(a, a.voice)
      const v = loopVoice(a.ctx, buf, a.master)
      a.all.add(v)
      fade(a.ctx, v, 1)
      a.voice = v
      setState('playing')
    } catch {
      if (want.current === id) { setState('error'); setOn(false); want.current = null }
    }
  }

  const stop = () => {
    want.current = null
    const a = audio.current
    if (a?.voice) { retire(a, a.voice); a.voice = null }
    setState('off')
  }

  /** Fade a sound out, then stop it. */
  const retire = (a: NonNullable<typeof audio.current>, v: Voice) => {
    fade(a.ctx, v, 0)
    setTimeout(() => { v.stop(); a.all.delete(v) }, FADE * 1000 + 50)
  }

  useEffect(() => () => {
    want.current = null
    const a = audio.current
    audio.current = null
    if (a) { for (const v of a.all) v.stop(); void a.ctx.close() }
  }, [])

  const update = (p: SoundPrefs) => { setPrefs(p); saveSoundPrefs(p) }
  const flip = () => { if (on) { setOn(false); stop() } else { setOn(true); void play(prefs.sound) } }
  const cycle = () => { const sound = nextSound(prefs.sound); update({ ...prefs, sound }); if (on) void play(sound) }
  const setVolume = (volume: number) => {
    update({ ...prefs, volume })
    const a = audio.current
    if (a) a.master.gain.setTargetAtTime(volume, a.ctx.currentTime, 0.05)
  }

  const label = soundLabel(prefs.sound)
  return (
    <div role="group" aria-label="Garden sounds" data-state={state}
      className={`no-drag h-[30px] pl-1 pr-2 rounded-full inline-flex items-center gap-1 bg-bg-secondary shadow-sm flex-shrink-0 ${state === 'error' ? 'ring-1 ring-red-400' : ''}`}>
      <button role="switch" aria-checked={on} aria-label="Garden sound" onClick={flip}
        title={state === 'error' ? 'Could not play the sound' : on ? 'Stop the garden sound' : `Play ${label}`}
        className={`w-6 h-6 rounded-full inline-flex items-center justify-center text-[13px] hover:bg-bg-hover cursor-pointer ${on ? '' : 'grayscale opacity-50'}`}>
        <span aria-hidden>🍃</span>
      </button>
      <button onClick={cycle} aria-label={`Sound: ${label}`} title="Next sound"
        className={`text-[12px] font-medium cursor-pointer hover:text-text-primary ${on ? 'text-text-primary' : 'text-text-muted'}`}>
        {label}
      </button>
      {on && (
        <input type="range" min={0} max={100} value={Math.round(prefs.volume * 100)} aria-label="Garden sound volume"
          onChange={e => setVolume(Number(e.target.value) / 100)} className="w-16 h-1 ml-1 cursor-pointer accent-[var(--accent)]" />
      )}
    </div>
  )
}

export function BotanicSound() {
  return useBotanic() ? <GardenSound /> : null
}
