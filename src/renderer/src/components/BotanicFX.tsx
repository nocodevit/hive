import { useEffect } from 'react'
import peonyRed from '../assets/botanic/peony-red.webp'
import peonyPink from '../assets/botanic/peony-pink.webp'
import peonyFernleaf from '../assets/botanic/peony-fernleaf.webp'
import treePeony from '../assets/botanic/tree-peony.webp'
import fern from '../assets/botanic/fern.webp'
import orchid from '../assets/botanic/orchid-masdevallia.webp'
import daisy from '../assets/botanic/daisy.webp'
import pothos from '../assets/botanic/pothos.webp'
import camellia from '../assets/botanic/camellia-sasanqua.webp'
import dahlia from '../assets/botanic/dahlia.webp'
import hibiscusRed from '../assets/botanic/hibiscus-red.webp'
import hibiscusRose from '../assets/botanic/hibiscus-confederate-rose.webp'
import hibiscusSyriacus from '../assets/botanic/hibiscus-syriacus.webp'

/**
 * 🌿 The Botanic skin's garden, cut from public-domain botanical plates
 * (assets/botanic/CREDITS.md). The plants grow on the ground behind the app:
 * a flower bed under the sidebar and flowers peeking out around the cards'
 * edges, so they never sit on top of text or take a click. They stir in a
 * light breeze; every 30–90 s a gust bends them and blows petals and leaves
 * across the window. Reduced motion: the garden stands still.
 */

type Plant = { src: string; h: number; at: { left?: number; right?: number; top?: number; bottom?: number }; back?: boolean; hang?: boolean; flip?: boolean }

// Back to front. Left bed under the sidebar; the right-hand ones peek round the cards' edges.
const PLANTS: Plant[] = [
  { src: peonyFernleaf, h: 225, at: { left: -50, bottom: -14 }, back: true },
  { src: fern, h: 230, at: { left: 165, bottom: -16 }, back: true },
  { src: hibiscusSyriacus, h: 215, at: { left: 230, bottom: -18 }, back: true },
  { src: dahlia, h: 200, at: { left: 50, bottom: -12 } },
  { src: orchid, h: 150, at: { left: 160, bottom: -10 } },
  { src: peonyRed, h: 190, at: { left: -36, bottom: -16 } },
  { src: daisy, h: 172, at: { left: 100, bottom: -14 } },
  { src: hibiscusRed, h: 165, at: { left: 205, bottom: -18 }, flip: true },
  { src: pothos, h: 380, at: { right: -74, top: 24 }, hang: true },
  { src: camellia, h: 230, at: { right: -96, bottom: 120 }, flip: true, back: true },
  { src: treePeony, h: 250, at: { right: -70, bottom: -60 } },
  { src: hibiscusRose, h: 210, at: { right: 150, bottom: -150 } },
  { src: peonyPink, h: 200, at: { right: 380, bottom: -150 }, flip: true },
]

const CSS = `
.bfx { position: fixed; inset: 0; pointer-events: none; z-index: 9990; overflow: hidden }
.bfx-ground { position: fixed; inset: 0; pointer-events: none; z-index: -1; overflow: hidden }
[data-palette='botanic'] body { background: var(--sidebar-bg) }
/* Room for the garden: a bed under the sidebar, and wider margins around the cards. */
[data-palette='botanic'] .hive-sidebar-foot { margin-bottom: 176px }
[data-palette='botanic'] .hive-frame { padding-right: 34px; padding-bottom: 34px }
.bfx-plant { position: absolute; will-change: transform }
.bfx-plant img { display: block; height: 100%; width: auto; filter: drop-shadow(0 6px 10px rgba(30,40,25,.18)) }
.bfx-plant.flip img { transform: scaleX(-1) }
.bfx-plant.back img { filter: brightness(.88) saturate(.9) drop-shadow(0 6px 10px rgba(30,40,25,.15)) }
[data-theme='dark'] .bfx-plant img { filter: brightness(.72) saturate(.85) drop-shadow(0 6px 12px rgba(0,0,0,.45)) }
[data-theme='dark'] .bfx-plant.back img { filter: brightness(.58) saturate(.8) }
.bfx-sway { height: 100%; transform-origin: 50% 100%; animation: bfx-breeze 7s ease-in-out infinite }
.bfx-plant.hang .bfx-sway { transform-origin: 50% 0; animation-name: bfx-hang; animation-duration: 9s }
@keyframes bfx-breeze { 0%, 100% { transform: rotate(-1.1deg) } 50% { transform: rotate(1.3deg) } }
@keyframes bfx-hang { 0%, 100% { transform: rotate(1.2deg) } 50% { transform: rotate(-1.4deg) } }
.bfx-gust { height: 100% }
.bfx-bit { position: absolute; left: 0; top: 0; width: 20px; height: 20px; margin: -10px 0 0 -10px; will-change: transform, opacity }
[data-theme='dark'] .bfx-bit { filter: brightness(.8) }
@media (prefers-reduced-motion: reduce) { .bfx-ground * { animation: none !important } .bfx-bit { display: none } }
`

// What a gust carries: rose and peony petals, a few leaves.
const PETALS = ['#e8506a', '#f28aa0', '#c9283f', '#f6b3c0', '#ff7a45']
const LEAVES = [['#8fbf6a', '#4f7f3a'], ['#a9c77a', '#678f45'], ['#c9b45a', '#8f7a2c']]
const petalSvg = (c: string) => `<svg viewBox="-10 -10 20 20"><path d="M0-8C6-8 8-2 6 4C4 8-4 8-6 4C-8-2-6-8 0-8z" fill="${c}"/><path d="M0-6C2 0 1 4 0 6" stroke="rgba(255,255,255,.35)" stroke-width="1" fill="none"/></svg>`
const leafSvg = ([l, d]: string[]) => `<svg viewBox="-12 -12 24 24"><path d="M0-11C7-6 7 6 0 11C-7 6-7-6 0-11z" fill="${l}" stroke="${d}" stroke-width=".8"/><path d="M0-10V10" stroke="${d}" stroke-width=".8"/></svg>`
const rand = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]

export function BotanicFX() {
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const layer = document.createElement('div')
    layer.className = 'bfx'
    layer.setAttribute('aria-hidden', 'true')
    layer.dataset.testid = 'botanic-fx'
    layer.innerHTML = `<style>${CSS}</style>`
    const ground = document.createElement('div')
    ground.className = 'bfx-ground'
    ground.setAttribute('aria-hidden', 'true')
    const gusts: { el: HTMLElement; hang: boolean }[] = []
    PLANTS.forEach((p, i) => {
      const el = document.createElement('div')
      el.className = `bfx-plant${p.back ? ' back' : ''}${p.hang ? ' hang' : ''}${p.flip ? ' flip' : ''}`
      el.style.height = `${p.h}px`
      for (const [k, v] of Object.entries(p.at)) el.style.setProperty(k, `${v}px`)
      el.innerHTML = `<div class="bfx-gust"><div class="bfx-sway" style="animation-delay:${(-i * 1.7).toFixed(1)}s"><img src="${p.src}" alt="" draggable="false"></div></div>`
      ground.appendChild(el)
      gusts.push({ el: el.firstElementChild as HTMLElement, hang: !!p.hang })
    })
    document.body.appendChild(ground)
    document.body.appendChild(layer)
    const timers = new Set<number>()
    const later = (fn: () => void, ms: number) => { const t = window.setTimeout(() => { timers.delete(t); fn() }, ms); timers.add(t) }

    // A petal or leaf carried on the wind: tumbling, lifting and dipping, then gone.
    const drift = (from: { x: number; y: number }, to: { x: number; y: number }, ms: number) => {
      const el = document.createElement('div')
      el.className = 'bfx-bit'
      el.innerHTML = Math.random() < 0.7 ? petalSvg(pick(PETALS)) : leafSvg(pick(LEAVES))
      layer.appendChild(el)
      const spin = rand(360, 900) * (Math.random() < 0.5 ? -1 : 1), wave = rand(20, 60), s = rand(0.6, 1.1)
      const frames: Keyframe[] = []
      for (let i = 0; i <= 8; i++) {
        const k = i / 8
        const x = from.x + (to.x - from.x) * k, y = from.y + (to.y - from.y) * k + Math.sin(k * Math.PI * 2.5) * wave
        frames.push({ transform: `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px) rotate(${(spin * k).toFixed(0)}deg) rotateX(${(k * 540).toFixed(0)}deg) scale(${s.toFixed(2)})`, opacity: i === 0 || i === 8 ? 0 : 0.92 })
      }
      el.animate(frames, { duration: ms, easing: 'linear', fill: 'forwards' })
      later(() => el.remove(), ms + 100)
    }

    // Wind from the left: everything leans right, the hanging pothos swings out, then they all settle.
    const gust = () => {
      const T = 4200
      gusts.forEach(({ el, hang }, i) => {
        const lean = hang ? -6 : rand(3.5, 6)
        el.style.transformOrigin = hang ? '50% 0' : '50% 100%'
        el.animate([{ transform: 'rotate(0)' }, { transform: `rotate(${lean}deg)`, offset: 0.3 }, { transform: `rotate(${lean * 0.35}deg)`, offset: 0.55 }, { transform: `rotate(${lean * 0.7}deg)`, offset: 0.7 }, { transform: 'rotate(0)' }], { duration: T, delay: i * 40, easing: 'ease-in-out' })
      })
      const W = window.innerWidth, H = window.innerHeight
      // Petals lift off the bed and blow across; a few more come in on the wind from off-screen.
      for (let i = 0; i < 6; i++) later(() => drift({ x: rand(20, 260), y: H - rand(60, 200) }, { x: W + 40, y: rand(H * 0.1, H * 0.7) }, rand(7000, 11000)), i * rand(120, 400))
      for (let i = 0; i < 4; i++) later(() => { const y = rand(H * 0.1, H * 0.8); drift({ x: -30, y }, { x: W + 40, y: y + rand(-120, 120) }, rand(6000, 10000)) }, 300 + i * rand(200, 600))
    }

    if (!reduce) {
      const loop = () => { gust(); later(loop, rand(30000, 90000)) }
      later(loop, 5000)
    }
    const w = window as unknown as { __hiveGust?: () => void }
    w.__hiveGust = gust

    return () => {
      for (const t of timers) clearTimeout(t)
      layer.remove()
      ground.remove()
      delete w.__hiveGust
    }
  }, [])
  return null
}
