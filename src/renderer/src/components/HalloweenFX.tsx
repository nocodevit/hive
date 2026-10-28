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
.hfx-ghost { position: absolute; left: 0; top: 0; width: 78px; will-change: transform, opacity }
.hfx-ghost svg { display: block; width: 100%; animation: hfx-sway 3.4s ease-in-out infinite; filter: drop-shadow(0 0 14px rgba(239,233,255,.35)) }
@keyframes hfx-sway { 0%, 100% { transform: rotate(-6deg) translateY(0) } 50% { transform: rotate(6deg) translateY(-8px) } }
.hfx-ghost .eye { animation: hfx-glow 2.6s ease-in-out infinite }
@keyframes hfx-glow { 0%, 100% { opacity: .55 } 50% { opacity: 1 } }
.hfx-ghost.scare svg { filter: drop-shadow(0 0 30px rgba(255,40,40,.8)) }
.hfx-ghost.scare .eye { animation: none; opacity: 1 }
.hfx-dim { position: absolute; inset: 0; background: #000; opacity: 0 }
.hfx-peek { position: fixed; width: 40px; opacity: 0; z-index: 9991; pointer-events: none }
.hfx-peek.up { animation: hfx-peek 2.2s ease-in-out forwards }
@keyframes hfx-peek { 0% { transform: translateY(36px); opacity: 0 } 25%, 75% { transform: translateY(0); opacity: .95 } 100% { transform: translateY(36px); opacity: 0 } }
.hfx-bat { position: absolute; font-size: 16px; opacity: .55 }
.hfx-spider { position: fixed; left: 0; top: 0; z-index: 9995; font-size: 64px; margin: -32px 0 0 -32px; pointer-events: none; will-change: transform;
  filter: drop-shadow(0 0 1.5px rgba(239,233,255,.95)) drop-shadow(0 0 10px rgba(155,92,255,.85)) drop-shadow(0 6px 6px rgba(0,0,0,.7)) }
.hfx-spider span { display: inline-block; animation: hfx-scuttle .09s steps(2) infinite }
.hfx-spider.still span { animation: none }
@keyframes hfx-scuttle { 0% { transform: rotate(-9deg) } 100% { transform: rotate(9deg) } }
.hfx-web { position: fixed; width: 120px; height: 120px; z-index: 9989; pointer-events: none; opacity: .5 }
.hfx-web path { fill: none; stroke: #e9ddff; stroke-width: .9; stroke-dasharray: 160; stroke-dashoffset: 160; animation: hfx-spin 1.6s ease-out forwards }
.hfx-web path:nth-child(n+2) { animation-delay: .35s; animation-duration: 1.4s }
@keyframes hfx-spin { to { stroke-dashoffset: 0 } }
@media (prefers-reduced-motion: reduce) { .hfx *, .hfx-ghost svg, .hfx-peek, .hfx-spider, .hfx-spider span { animation: none !important } .hfx-web path { stroke-dashoffset: 0 } }
`

// Hollow eye sockets with red embers, a wailing mouth, a torn tail.
const GHOST = '<svg viewBox="0 0 60 78"><defs><radialGradient id="hfxEye"><stop offset="0" stop-color="#ff3b3b"/><stop offset=".55" stop-color="#b00010"/><stop offset="1" stop-color="#120a1f" stop-opacity="0"/></radialGradient></defs>'
  + '<path fill="#efe9ff" fill-opacity=".92" d="M30 2C13 2 3 15 3 32v38l5-7 4 10 6-8 5 11 7-10 6 11 5-11 6 8 4-10 5 7V32C57 15 47 2 30 2z"/>'
  + '<ellipse cx="20" cy="29" rx="6.5" ry="9" fill="#120a1f"/><ellipse cx="40" cy="29" rx="6.5" ry="9" fill="#120a1f"/>'
  + '<circle class="eye" cx="20" cy="31" r="4" fill="url(#hfxEye)"/><circle class="eye" cx="40" cy="31" r="4" fill="url(#hfxEye)"/>'
  + '<path fill="#120a1f" d="M22 46c2-6 14-6 16 0 1 6-3 13-8 13s-9-7-8-13z"/></svg>'
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
        const cx = W / 2 - 39, cy = H / 2 - 60
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
      later(() => {
        if (webbed.get(c) !== w) return
        webbed.delete(c)
        const fade = w.animate([{ opacity: 0.5 }, { opacity: 0 }], { duration: 4000, easing: 'ease-in', fill: 'forwards' })
        fade.onfinish = () => w.remove()
        later(() => w.remove(), 4200)
      }, (window as unknown as { __hiveWebLifeMs?: number }).__hiveWebLifeMs ?? rand(60000, 120000))
    }

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
    }
  }, [])
  return null
}
