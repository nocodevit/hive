import { useEffect } from 'react'

/**
 * 🎃 The Halloween skin's night life, drawn over the whole window and never in
 * the way (pointer-events: none): two ghosts drifting in empty space, one
 * peeking over the chat input, a bat now and then, and every 20–120 s a wave of
 * 1–3 spiders that dash in, stop on the chat to look around, then run into a
 * corner and spin a web there; a web fades away after a minute or two. Reduced motion: no movement, the webs only.
 */

const CSS = `
.hfx { position: fixed; inset: 0; pointer-events: none; z-index: 9990; overflow: hidden }
.hfx-ghost { position: absolute; left: 0; top: 0; width: 90px; will-change: transform, opacity }
.hfx-ghost svg { display: block; width: 100%; animation: hfx-sway 3.4s ease-in-out infinite; filter: drop-shadow(0 0 14px rgba(239,233,255,.35)) }
@keyframes hfx-sway { 0%, 100% { transform: rotate(-6deg) translateY(0) } 50% { transform: rotate(6deg) translateY(-8px) } }
.hfx-ghost .eye, .hfx-frank .eye { animation: hfx-glow 2.6s ease-in-out infinite }
.hfx-ghost .hand { animation: hfx-hand 2.6s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 100% }
@keyframes hfx-hand { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-4px) } }
.hfx-ghost .hem { animation: hfx-hem 1.6s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 0 }
@keyframes hfx-hem { 0%, 100% { transform: skewX(0) } 50% { transform: skewX(-7deg) } }
.hfx-mummy { position: absolute; left: 0; bottom: -4px; width: 120px; will-change: transform; filter: drop-shadow(0 6px 10px rgba(0,0,0,.6)) }
.hfx-mummy svg { display: block; width: 100% }
.hfx-mummy .lurch { animation: hfx-lurch 1.4s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 95% }
@keyframes hfx-lurch { 0%, 100% { transform: rotate(-3deg) translateY(0) } 50% { transform: rotate(3deg) translateY(-3px) } }
.hfx-mummy .arms { animation: hfx-arms 1.4s ease-in-out infinite; transform-box: fill-box; transform-origin: 0% 50% }
@keyframes hfx-arms { 0%, 100% { transform: rotate(-3deg) } 50% { transform: rotate(4deg) } }
.hfx-mummy .legl { animation: hfx-step 1.4s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 0 }
.hfx-mummy .legr { animation: hfx-step 1.4s ease-in-out infinite -.7s; transform-box: fill-box; transform-origin: 50% 0 }
@keyframes hfx-step { 0%, 100% { transform: rotate(-7deg) } 50% { transform: rotate(7deg) } }
.hfx-mummy .strip { animation: hfx-strip 1.1s ease-in-out infinite; transform-box: fill-box; transform-origin: 0 0 }
@keyframes hfx-strip { 0%, 100% { transform: rotate(0) } 50% { transform: rotate(14deg) } }
.hfx-mummy .drag { animation: hfx-drag 1.4s ease-in-out infinite; transform-box: fill-box; transform-origin: 100% 50% }
@keyframes hfx-drag { 0%, 100% { transform: scaleX(1) } 50% { transform: scaleX(.85) } }
.hfx-mummy .blink { animation: hfx-blink 4s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 50% }
@keyframes hfx-blink { 0%, 88%, 100% { transform: scaleY(1) } 92% { transform: scaleY(.1) } }
.hfx-frank { position: absolute; left: 0; bottom: 0; width: 130px; will-change: transform; transform: translateY(105%) }
.hfx-frank svg { display: block; width: 100% }
.hfx-frank .zap { opacity: 0; animation: hfx-zap 1.7s steps(1) infinite }
@keyframes hfx-zap { 0%, 55%, 100% { opacity: 0 } 60%, 68%, 80% { opacity: 1 } 64%, 74% { opacity: 0 } }
.hfx-frank .bolts { animation: hfx-boltglow 1.7s linear infinite }
@keyframes hfx-boltglow { 0%, 55%, 100% { filter: none } 60%, 80% { filter: drop-shadow(0 0 10px #9cf7ff) brightness(1.3) } }
.hfx-frank .brow { animation: hfx-brow 1.7s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 50% }
@keyframes hfx-brow { 0%, 55%, 100% { transform: translateY(0) } 60%, 80% { transform: translateY(-2px) } }
@keyframes hfx-glow { 0%, 100% { opacity: .55 } 50% { opacity: 1 } }
.hfx-ghost.scare svg { filter: drop-shadow(0 0 30px rgba(255,40,40,.8)) }
.hfx-ghost.scare .eye { animation: none; opacity: 1 }
.hfx-dim { position: absolute; inset: 0; background: #000; opacity: 0 }
.hfx-peek { position: fixed; width: 40px; opacity: 0; z-index: 9991; pointer-events: none }
.hfx-peek.up { animation: hfx-peek 2.2s ease-in-out forwards }
@keyframes hfx-peek { 0% { transform: translateY(36px); opacity: 0 } 25%, 75% { transform: translateY(0); opacity: .95 } 100% { transform: translateY(36px); opacity: 0 } }
.hfx-bat { position: absolute; font-size: 16px; opacity: .55 }
.hfx-spider { position: fixed; left: 0; top: 0; z-index: 9995; font-size: 64px; margin: -32px 0 0 -32px; pointer-events: none; will-change: transform;
  /* No glow: a contact shadow right under the body, and a soft cast shadow down-right, as if lit from above-left. */
  filter: drop-shadow(0 1px 1.5px rgba(0,0,0,.75)) drop-shadow(5px 12px 7px rgba(0,0,0,.5)) }
.hfx-spider span { display: inline-block; animation: hfx-scuttle .09s steps(2) infinite }
.hfx-spider.still span { animation: none }
@keyframes hfx-scuttle { 0% { transform: rotate(-9deg) } 100% { transform: rotate(9deg) } }
.hfx-web { position: fixed; width: 120px; height: 120px; z-index: 9989; pointer-events: none; opacity: .5 }
.hfx-web path { fill: none; stroke: #e9ddff; stroke-width: .9; stroke-dasharray: 160; stroke-dashoffset: 160; animation: hfx-spin 1.6s ease-out forwards }
.hfx-web path:nth-child(n+2) { animation-delay: .35s; animation-duration: 1.4s }
@keyframes hfx-spin { to { stroke-dashoffset: 0 } }
@media (prefers-reduced-motion: reduce) { .hfx-mummy, .hfx-frank { display: none } .hfx *, .hfx-ghost svg, .hfx-peek, .hfx-spider, .hfx-spider span { animation: none !important } .hfx-web path { stroke-dashoffset: 0 } }
`

// The three musketeers (approved sheet, 10-28).
// 1 · Ghost: a sheet tented by the head and two raised hands — from the hands it falls straight down, never
// clinging to arms; fingertips poke little peaks and tension folds fan down from them.
const GHOST = '<svg viewBox="0 0 150 180"><defs>'
  + '<radialGradient id="hfxGe"><stop offset="0" stop-color="#ff4a3b"/><stop offset=".55" stop-color="#b00010"/><stop offset="1" stop-color="#120a1f" stop-opacity="0"/></radialGradient>'
  + '<linearGradient id="hfxGc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbf9ff"/><stop offset=".7" stop-color="#e6def8"/><stop offset="1" stop-color="#cbbfe7" stop-opacity=".55"/></linearGradient>'
  + '<linearGradient id="hfxGf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a7ab6" stop-opacity=".6"/><stop offset="1" stop-color="#8a7ab6" stop-opacity="0"/></linearGradient>'
  + '<filter id="hfxGs"><feGaussianBlur stdDeviation="1.6"/></filter></defs>'
  + '<path fill="url(#hfxGc)" d="M24 22c2-5 7-5 9 0 3 9 10 16 19 19 4-13 12-20 23-20s19 7 23 20c9-3 16-10 19-19 2-5 7-5 9 0 3 11 6 28 7 50 1 26 1 50 1 70H16c0-20 0-44 1-70 1-22 4-39 7-50z"/>'
  + '<g class="hand"><path fill="url(#hfxGc)" d="M22 23l2-7 2 6 2-8 3 7 2-6 1 8z"/></g>'
  + '<g class="hand" style="animation-delay:-1.2s"><path fill="url(#hfxGc)" d="M117 23l2-7 2 6 2-8 3 7 2-6 1 8z"/></g>'
  + '<g filter="url(#hfxGs)" fill="none" stroke="url(#hfxGf)" stroke-width="2.4" stroke-linecap="round"><path d="M27 24c-2 34-3 76-2 118"/><path d="M30 25c5 32 9 56 11 90"/><path d="M33 26c10 13 18 23 25 31"/><path d="M123 24c2 34 3 76 2 118"/><path d="M120 25c-5 32-9 56-11 90"/><path d="M117 26c-10 13-18 23-25 31"/></g>'
  + '<g class="hem"><path fill="url(#hfxGc)" d="M16 141h118l-1 6-7 9-7-10-7 12-7-11-7 12-7-12-6 11-7-12-6 11-7-11-7 12-6-12-7 10-7-9z"/></g>'
  + '<ellipse cx="65" cy="44" rx="6" ry="9" fill="#120a1f"/><ellipse cx="85" cy="44" rx="6" ry="9" fill="#120a1f"/>'
  + '<circle class="eye" cx="65" cy="46" r="3.6" fill="url(#hfxGe)"/><circle class="eye" cx="85" cy="46" r="3.6" fill="url(#hfxGe)"/>'
  + '<path fill="#120a1f" d="M68 61c2-4 11-4 14 0 1 6-2 12-7 12s-8-6-7-12z"/></svg>'
const GHOST_W = 90

// 2 · Mummy: old bandages wound on the slant, one amber eye in a gap, arms out front, loose strips flapping.
const MUMMY = '<svg viewBox="0 0 170 190"><defs>'
  + '<linearGradient id="hfxMb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#efe3c4"/><stop offset="1" stop-color="#c9b78e"/></linearGradient>'
  + '<radialGradient id="hfxMe"><stop offset="0" stop-color="#ffd25a"/><stop offset=".5" stop-color="#ff8a1f"/><stop offset="1" stop-color="#3a1a00" stop-opacity="0"/></radialGradient>'
  + '<pattern id="hfxWrap" width="40" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(-12)"><rect width="40" height="9" fill="url(#hfxMb)"/><path d="M0 8.5h40" stroke="#9c8a62" stroke-width="1.2" opacity=".7"/><path d="M14 0v9" stroke="#b3a176" stroke-width=".8" opacity=".5"/></pattern></defs>'
  + '<g class="lurch"><path class="legl" fill="url(#hfxWrap)" d="M60 140h18l-2 40H58z"/><path class="legr" fill="url(#hfxWrap)" d="M88 140h18l2 40H90z"/>'
  + '<path fill="url(#hfxWrap)" d="M54 78c0-8 8-14 29-14s29 6 29 14l-2 66H56z"/>'
  + '<g class="arms"><path fill="url(#hfxWrap)" d="M104 84h46c5 0 8 3 8 7s-3 7-8 7h-46z"/><path fill="url(#hfxWrap)" d="M104 102h42c5 0 8 3 8 7s-3 7-8 7h-42z"/>'
  + '<path class="strip" fill="#e6d8b4" d="M150 98l10 14 3-2-9-14z"/><path class="strip" style="animation-delay:-.6s" fill="#e6d8b4" d="M146 116l7 13 3-1-7-14z"/></g>'
  + '<path fill="url(#hfxWrap)" d="M83 12c-18 0-29 13-29 30 0 14 7 24 13 28h32c6-4 13-14 13-28 0-17-11-30-29-30z"/>'
  + '<path fill="#1a0e05" d="M62 37c8-3 34-3 42 0l-1 9c-9-2-31-2-40 0z"/>'
  + '<g class="blink"><ellipse cx="74" cy="41" rx="5" ry="3.6" fill="url(#hfxMe)"/></g><ellipse cx="93" cy="42" rx="3.6" ry="2" fill="url(#hfxMe)" opacity=".55"/>'
  + '<path fill="url(#hfxWrap)" d="M86 36h20l-1 5H85z" opacity=".95"/>'
  + '<path class="strip" fill="#e6d8b4" d="M58 30c-10 4-18 12-22 24l4 1c4-10 10-17 19-21z"/>'
  + '<path class="drag" fill="#e6d8b4" d="M60 176c-14 2-30 3-46 2l0 3c16 1 32 0 46-2z"/></g></svg>'
const MUMMY_W = 120

// 3 · Frankenstein's monster: flat-top head, stitched brow, neck bolts that throw blue sparks.
const FRANK = '<svg viewBox="0 0 170 200"><defs>'
  + '<linearGradient id="hfxFs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fd38a"/><stop offset="1" stop-color="#6f9f62"/></linearGradient>'
  + '<linearGradient id="hfxFc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2238"/><stop offset="1" stop-color="#17121f"/></linearGradient>'
  + '<radialGradient id="hfxFe"><stop offset="0" stop-color="#fff59a"/><stop offset=".55" stop-color="#e6c020"/><stop offset="1" stop-color="#3a3000" stop-opacity="0"/></radialGradient></defs>'
  + '<path fill="url(#hfxFc)" d="M28 200c0-38 18-58 57-58s57 20 57 58z"/><path fill="#3a2f4d" d="M70 142l15 26 15-26z"/>'
  + '<rect x="68" y="122" width="34" height="26" rx="4" fill="url(#hfxFs)"/>'
  + '<g class="bolts"><rect x="56" y="128" width="13" height="9" rx="2" fill="#8d8d98"/><rect x="101" y="128" width="13" height="9" rx="2" fill="#8d8d98"/><rect x="52" y="129" width="5" height="7" rx="1.5" fill="#b6b6c2"/><rect x="113" y="129" width="5" height="7" rx="1.5" fill="#b6b6c2"/></g>'
  + '<g class="zap" fill="none" stroke="#9cf7ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M52 132l-8-6 4 8-9-3"/><path d="M118 132l8-6-4 8 9-3"/><path d="M47 140l-6 5"/><path d="M123 140l6 5"/></g>'
  + '<path fill="url(#hfxFs)" d="M46 34h78v64c0 18-14 30-39 30S46 116 46 98z"/>'
  + '<path fill="#1a1422" d="M44 22h82v20l-6-6-6 8-7-7-6 7-7-8-6 8-7-8-6 8-7-7-6 7-6-8-6 6z"/>'
  + '<path d="M58 56h40" stroke="#3d5a35" stroke-width="2" stroke-linecap="round"/><g stroke="#3d5a35" stroke-width="1.6" stroke-linecap="round"><path d="M62 52v8"/><path d="M70 52v8"/><path d="M78 52v8"/><path d="M86 52v8"/><path d="M94 52v8"/></g>'
  + '<path class="brow" fill="#557a4a" d="M52 64h66v7H52z"/>'
  + '<ellipse cx="70" cy="80" rx="9" ry="6" fill="#2b3a26"/><ellipse cx="100" cy="80" rx="9" ry="6" fill="#2b3a26"/>'
  + '<circle class="eye" cx="70" cy="80" r="3.4" fill="url(#hfxFe)"/><circle class="eye" cx="100" cy="80" r="3.4" fill="url(#hfxFe)"/>'
  + '<path d="M85 84v10" stroke="#557a4a" stroke-width="3" stroke-linecap="round"/><path d="M70 108c10 3 20 3 30 0" stroke="#2b3a26" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M77 104v8M93 104v8" stroke="#2b3a26" stroke-width="1.5"/>'
  + '<path d="M110 92l8 10" stroke="#3d5a35" stroke-width="1.6"/><path d="M111 98l5-2M114 102l5-2" stroke="#3d5a35" stroke-width="1.2"/></svg>'
const FRANK_W = 130

const PEEK = '<svg viewBox="0 0 60 70"><path fill="#efe9ff" d="M30 2C14 2 4 14 4 30v36l8-6 8 6 10-6 10 6 8-6 8 6V30C56 14 46 2 30 2z"/><circle cx="22" cy="28" r="4" fill="#120a1f"/><circle cx="38" cy="28" r="4" fill="#120a1f"/><ellipse cx="30" cy="42" rx="5" ry="6" fill="#120a1f"/></svg>'
const WEB = '<svg viewBox="0 0 120 120"><path d="M0 0 L120 0 M0 0 L0 120 M0 0 L110 45 M0 0 L80 80 M0 0 L45 110"/><path d="M28 0 Q24 10 26 11 Q12 18 11 26 Q8 26 0 28"/><path d="M58 0 Q50 20 52 23 Q36 34 23 52 Q20 50 0 58"/><path d="M90 0 Q78 30 81 34 Q58 52 34 81 Q30 78 0 90"/></svg>'

type Corner = 'tl' | 'tr' | 'bl' | 'br'
const CORNERS: Corner[] = ['tl', 'tr', 'bl', 'br']
const rand = (a: number, b: number) => a + Math.random() * (b - a)

export function HalloweenFX() {
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const layer = document.createElement('div')
    layer.className = 'hfx'
    layer.setAttribute('aria-hidden', 'true')
    layer.dataset.testid = 'halloween-fx'
    layer.innerHTML = `<style>${CSS}</style>`
    document.body.appendChild(layer)
    const timers = new Set<number>()
    const later = (fn: () => void, ms: number) => { const t = window.setTimeout(() => { timers.delete(t); fn() }, ms); timers.add(t) }
    const extra: HTMLElement[] = []

    // Two ghosts that wander the whole window, fading in and out; now and then one lunges at you.
    const dim = document.createElement('div')
    dim.className = 'hfx-dim'
    layer.appendChild(dim)
    // Ghosts keep out of the Butler panel's way: they still pass behind it, but barely visible there.
    const overPanel = (x: number, y: number) => {
      const r = document.querySelector('[aria-label="Butler panel"]')?.getBoundingClientRect()
      return !!r && x + 70 > r.left && x < r.right && y + 80 > r.top && y < r.bottom
    }
    type Ghost = { el: HTMLDivElement; x: number; y: number; busy: boolean }
    const ghosts: Ghost[] = [0, 1].map(i => {
      const el = document.createElement('div')
      el.className = 'hfx-ghost'
      el.innerHTML = GHOST
      el.querySelector('svg')!.style.animationDelay = `${-i * 1.7}s`
      layer.appendChild(el)
      const g = { el, x: window.innerWidth * (i ? 0.75 : 0.2), y: window.innerHeight * (i ? 0.3 : 0.6), busy: false }
      el.style.transform = `translate(${g.x}px, ${g.y}px)`
      el.style.opacity = overPanel(g.x, g.y) ? '.04' : '.14'
      return g
    })
    const wander = (g: Ghost) => {
      if (!g.busy) {
        const W = window.innerWidth, H = window.innerHeight
        const nx = rand(20, W - 100), ny = rand(50, H - 120)
        const land = overPanel(nx, ny) ? rand(0.03, 0.05) : rand(0.12, 0.24)
        const mx = (g.x + nx) / 2 + rand(-160, 160), my = (g.y + ny) / 2 + rand(-120, 120)
        const dur = rand(4000, 8000)
        g.el.animate([
          { transform: `translate(${g.x}px, ${g.y}px)`, opacity: g.el.style.opacity },
          { transform: `translate(${mx}px, ${my}px)`, opacity: rand(0.04, 0.1) },
          { transform: `translate(${nx}px, ${ny}px)`, opacity: land }
        ], { duration: dur, easing: 'ease-in-out', fill: 'forwards' })
        g.x = nx; g.y = ny
        later(() => { g.el.style.transform = `translate(${nx}px, ${ny}px)`; wander(g) }, dur)
      } else later(() => wander(g), 1000)
    }
    const scare = () => {
      const g = ghosts[Math.floor(Math.random() * ghosts.length)]
      if (!g.busy) {
        g.busy = true
        g.el.getAnimations().forEach(a => a.cancel())
        const W = window.innerWidth, H = window.innerHeight
        const cx = W / 2 - GHOST_W / 2, cy = H / 2 - 70
        g.el.classList.add('scare')
        g.el.animate([
          { transform: `translate(${g.x}px, ${g.y}px) scale(1)`, opacity: 0.2 },
          { transform: `translate(${cx}px, ${cy}px) scale(1.4)`, opacity: 0.35, offset: 0.55 },
          { transform: `translate(${cx}px, ${cy - 30}px) scale(5.5)`, opacity: 0.7, offset: 0.85 },
          { transform: `translate(${cx}px, ${cy - 40}px) scale(7)`, opacity: 0 }
        ], { duration: 1500, easing: 'cubic-bezier(.6,0,.9,.4)', fill: 'forwards' })
        dim.animate([{ opacity: 0 }, { opacity: 0, offset: 0.6 }, { opacity: 0.45, offset: 0.8 }, { opacity: 0.1, offset: 0.86 }, { opacity: 0.35, offset: 0.9 }, { opacity: 0 }], { duration: 1500 })
        later(() => {
          g.el.classList.remove('scare')
          g.el.getAnimations().forEach(a => a.cancel())
          g.x = Math.random() < 0.5 ? -90 : window.innerWidth + 10
          g.y = rand(60, window.innerHeight - 140)
          g.el.style.transform = `translate(${g.x}px, ${g.y}px)`
          g.el.style.opacity = '0'
          g.busy = false
        }, 1550)
      }
      later(scare, rand(120000, 300000))
    }
    if (!reduce) {
      ghosts.forEach((g, i) => later(() => wander(g), 600 + i * 1500))
      later(scare, rand(60000, 180000))
    }
    ;(window as unknown as { __hiveGhostScare?: () => void }).__hiveGhostScare = () => { scare() }

    // The mummy shambles along the bottom of the window, now one way, now the other.
    const mummy = () => {
      const m = document.createElement('div')
      m.className = 'hfx-mummy'
      m.innerHTML = MUMMY
      const W = window.innerWidth
      const rightward = Math.random() < 0.5
      const from = rightward ? -MUMMY_W - 20 : W + 20, to = rightward ? W + 20 : -MUMMY_W - 20
      const face = rightward ? 1 : -1
      layer.appendChild(m)
      const dur = (W + MUMMY_W + 40) / 70 * 1000 // ~70 px/s: slow
      m.animate([{ transform: `translateX(${from}px) scaleX(${face})` }, { transform: `translateX(${to}px) scaleX(${face})` }], { duration: dur, easing: 'linear', fill: 'forwards' })
      later(() => m.remove(), dur + 200)
    }
    // Frankenstein's monster: half a head rises from the bottom edge, the bolts spark, it sinks back.
    const frank = () => {
      const f = document.createElement('div')
      f.className = 'hfx-frank'
      f.innerHTML = FRANK
      const x = rand(window.innerWidth * 0.15, window.innerWidth * 0.85 - FRANK_W)
      f.style.left = `${x}px`
      layer.appendChild(f)
      f.animate([
        { transform: 'translateY(105%)' },
        { transform: 'translateY(52%)', offset: 0.18 },
        { transform: 'translateY(50%) rotate(-2deg)', offset: 0.45 },
        { transform: 'translateY(50%) rotate(2deg)', offset: 0.72 },
        { transform: 'translateY(52%)', offset: 0.82 },
        { transform: 'translateY(105%)' }
      ], { duration: 4600, easing: 'ease-in-out', fill: 'forwards' })
      later(() => f.remove(), 4800)
    }
    const mummyLoop = () => { mummy(); later(mummyLoop, rand(90000, 240000)) }
    const frankLoop = () => { frank(); later(frankLoop, rand(120000, 300000)) }
    if (!reduce) {
      later(mummyLoop, rand(30000, 90000))
      later(frankLoop, rand(45000, 120000))
    }
    ;(window as unknown as { __hiveMummy?: () => void }).__hiveMummy = mummy
    ;(window as unknown as { __hiveFrank?: () => void }).__hiveFrank = frank

    // The chat input, when a chat is open: where the ghost peeks and the spiders stop.
    const input = () => document.querySelector<HTMLElement>('[data-testid="hive-chat-input"]')

    const peek = document.createElement('div')
    peek.className = 'hfx-peek'
    peek.innerHTML = PEEK
    document.body.appendChild(peek)
    extra.push(peek)
    const peekLoop = () => {
      const r = input()?.getBoundingClientRect()
      if (r && r.width > 0 && !reduce) {
        Object.assign(peek.style, { left: `${r.right - 70}px`, top: `${r.top - 44}px` })
        peek.classList.remove('up'); void peek.offsetWidth; peek.classList.add('up')
      }
      later(peekLoop, 7000)
    }
    later(peekLoop, 4000)

    const batLoop = () => {
      if (!reduce) {
        const b = document.createElement('span')
        b.className = 'hfx-bat'
        b.textContent = '🦇'
        const y = rand(40, window.innerHeight * 0.4)
        b.style.top = `${y}px`
        layer.appendChild(b)
        const a = b.animate([{ transform: `translateX(${window.innerWidth + 20}px)` }, { transform: `translate(-40px, ${rand(-20, 40)}px)` }], { duration: rand(6000, 9000), easing: 'linear' })
        a.onfinish = () => b.remove()
        later(() => b.remove(), 10000)
      }
      later(batLoop, rand(30000, 90000))
    }
    later(batLoop, rand(8000, 20000))

    const webbed = new Map<Corner, HTMLElement>()
    const spinWeb = (c: Corner) => {
      const had = webbed.get(c)
      if (had) { had.animate([{ transform: had.style.transform }, { transform: `${had.style.transform} rotate(2deg)` }, { transform: had.style.transform }], { duration: 300, iterations: 3 }); return }
      const w = document.createElement('div')
      w.className = 'hfx-web'
      w.dataset.corner = c
      const fx = c.endsWith('r'), fy = c.startsWith('b')
      Object.assign(w.style, { [fx ? 'right' : 'left']: '0', [fy ? 'bottom' : 'top']: '0', transform: `scale(${fx ? -1 : 1}, ${fy ? -1 : 1})` })
      w.innerHTML = WEB
      document.body.appendChild(w)
      extra.push(w)
      webbed.set(c, w)
      // A web hangs on for a minute or two, then fades away and the corner is free again.
      later(() => fadeWeb(c, w), (window as unknown as { __hiveWebLifeMs?: number }).__hiveWebLifeMs ?? rand(60000, 120000))
    }
    function fadeWeb(c: Corner, w: HTMLElement, ms = 4000) {
      if (webbed.get(c) !== w) return
      webbed.delete(c)
      const fade = w.animate([{ opacity: 0.5 }, { opacity: 0 }], { duration: ms, easing: 'ease-in', fill: 'forwards' })
      fade.onfinish = () => w.remove()
      later(() => w.remove(), ms + 200)
    }
    ;(window as unknown as { __hiveClearWebs?: () => void }).__hiveClearWebs = () => { for (const [c, w] of [...webbed]) fadeWeb(c, w, 50) }

    const dash = () => {
      const bare = CORNERS.filter(c => !webbed.has(c))
      const pool = bare.length ? bare : CORNERS
      const to = pool[Math.floor(Math.random() * pool.length)]
      if (reduce) { spinWeb(to); return }
      const W = window.innerWidth, H = window.innerHeight
      const end = { x: to.endsWith('r') ? W - 30 : 30, y: to.startsWith('b') ? H - 30 : 30 }
      const start = { x: to.endsWith('r') ? -50 : W + 50, y: rand(H * 0.1, H * 0.9) }
      const r = input()?.getBoundingClientRect()
      const stop = r && r.width > 0
        ? { x: r.left + r.width * rand(0.3, 0.7), y: Math.max(80, r.top - rand(120, 260)) }
        : { x: W * rand(0.4, 0.6), y: H * rand(0.35, 0.55) }
      const ang = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI + 90
      const a1 = ang(start, stop), a2 = ang(stop, end)
      const at = (p: { x: number; y: number }, deg: number) => `translate(${p.x}px, ${p.y}px) rotate(${deg}deg)`
      const sp = document.createElement('div')
      sp.className = 'hfx-spider'
      sp.innerHTML = '<span>🕷️</span>'
      document.body.appendChild(sp)
      const RUN1 = 650, STOP = 1100, RUN2 = 600, T = RUN1 + STOP + RUN2
      sp.animate([
        { transform: at(start, a1) },
        { transform: at(stop, a1), offset: RUN1 / T },
        { transform: at({ x: stop.x + 2, y: stop.y - 1 }, a1 - 14), offset: (RUN1 + STOP * 0.35) / T },
        { transform: at({ x: stop.x - 1, y: stop.y + 1 }, a1 + 12), offset: (RUN1 + STOP * 0.65) / T },
        { transform: at(stop, a2), offset: (RUN1 + STOP) / T },
        { transform: at(end, a2) }
      ], { duration: T, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' })
      later(() => sp.classList.add('still'), RUN1)
      later(() => sp.classList.remove('still'), RUN1 + STOP * 0.3)
      later(() => sp.classList.add('still'), RUN1 + STOP * 0.4)
      later(() => sp.classList.remove('still'), RUN1 + STOP)
      // A timer, not onfinish: a hidden window never finishes its animations.
      later(() => { sp.remove(); spinWeb(to) }, T + 100)
    }
    const wave = () => {
      const n = 1 + Math.floor(Math.random() * 3)
      for (let i = 0; i < n; i++) later(dash, i === 0 ? 0 : i * rand(250, 700))
    }
    const waveLoop = () => { wave(); later(waveLoop, rand(20000, 120000)) }
    later(waveLoop, 3000)
    ;(window as unknown as { __hiveSpiders?: () => void }).__hiveSpiders = wave

    return () => {
      for (const t of timers) clearTimeout(t)
      layer.remove()
      for (const e of extra) e.remove()
      document.querySelectorAll('.hfx-spider').forEach(e => e.remove())
      delete (window as unknown as { __hiveSpiders?: () => void }).__hiveSpiders
      delete (window as unknown as { __hiveGhostScare?: () => void }).__hiveGhostScare
      delete (window as unknown as { __hiveMummy?: () => void }).__hiveMummy
      delete (window as unknown as { __hiveFrank?: () => void }).__hiveFrank
    }
  }, [])
  return null
}
