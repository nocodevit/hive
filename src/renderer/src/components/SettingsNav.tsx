import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { OPEN_SECTION_EVENT, SETTINGS_SECTIONS, activeSection, sectionAria, takePendingSection } from '../lib/settings-nav'

/** One App Settings section; empty (its feature renders nothing) = hidden and left out of the nav. */
export function SettingsSection({ label, children }: { label: string; children: ReactNode }) {
  return <section aria-label={sectionAria(label)} data-settings-section={label} className="empty:hidden scroll-mt-2">{children}</section>
}

/** Left nav for App Settings: click scrolls to a section; the current one is highlighted while scrolling. */
export function SettingsNav({ scrollRef }: { scrollRef: RefObject<HTMLDivElement | null> }) {
  const [present, setPresent] = useState<string[]>([])
  const [active, setActive] = useState<string | null>(null)
  const clicked = useRef<string | null>(null)

  const sectionEl = (label: string) =>
    scrollRef.current?.querySelector<HTMLElement>(`[data-settings-section="${CSS.escape(label)}"]`) ?? null

  const go = (label: string) => {
    const el = sectionEl(label)
    if (!el) return
    clicked.current = label
    setActive(label)
    el.scrollIntoView({ block: 'start', behavior: 'smooth' })
    // Sections above may still be loading and push it down: land again once settled.
    setTimeout(() => { if (clicked.current === label) sectionEl(label)?.scrollIntoView({ block: 'start' }) }, 600)
  }

  // Which sections render something (Butler-only ones may be empty).
  useEffect(() => {
    const root = scrollRef.current
    if (!root) return
    let raf = 0
    const scan = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const labels = SETTINGS_SECTIONS.filter(l => { const el = sectionEl(l); return !!el && el.childElementCount > 0 })
        setPresent(prev => (prev.join('|') === labels.join('|') ? prev : labels))
      })
    }
    scan()
    const mo = new MutationObserver(scan)
    mo.observe(root, { childList: true, subtree: true })
    return () => { mo.disconnect(); cancelAnimationFrame(raf) }
  }, [scrollRef])

  // Highlight while scrolling: band = top 35% of the scroll area.
  useEffect(() => {
    const root = scrollRef.current
    if (!root || !present.length) return
    const inBand = new Set<string>(), onScreen = new Set<string>()
    const update = () => setActive(activeSection(present, inBand, onScreen, clicked.current))
    const track = (set: Set<string>) => (entries: IntersectionObserverEntry[]) => {
      for (const e of entries) {
        const l = (e.target as HTMLElement).dataset.settingsSection
        if (!l) continue
        if (e.isIntersecting) set.add(l); else set.delete(l)
        // A clicked section that left the screen no longer holds the highlight.
        if (set === onScreen && !e.isIntersecting && l === clicked.current) clicked.current = null
      }
      update()
    }
    const band = new IntersectionObserver(track(inBand), { root, rootMargin: '0px 0px -65% 0px' })
    const screen = new IntersectionObserver(track(onScreen), { root })
    for (const l of present) { const el = sectionEl(l); if (el) { band.observe(el); screen.observe(el) } }
    // The owner scrolling by hand ends a click's highlight.
    const release = () => { if (clicked.current) { clicked.current = null; update() } }
    root.addEventListener('wheel', release, { passive: true })
    root.addEventListener('keydown', release)
    return () => { band.disconnect(); screen.disconnect(); root.removeEventListener('wheel', release); root.removeEventListener('keydown', release) }
  }, [present, scrollRef])

  // "Open Settings at <section>" from elsewhere (a notification, a link);
  // waits until that section has rendered.
  const want = useRef<string | null>(null)
  useEffect(() => {
    const on = (e: Event) => { takePendingSection(); want.current = (e as CustomEvent<string>).detail; setPresent(p => [...p]) }
    window.addEventListener(OPEN_SECTION_EVENT, on)
    return () => window.removeEventListener(OPEN_SECTION_EVENT, on)
  }, [])
  useEffect(() => {
    const p = takePendingSection()
    if (p) want.current = p
    const w = want.current
    if (w && present.includes(w)) { want.current = null; setTimeout(() => go(w), 50) }
  }, [present])

  return (
    <nav aria-label="Settings sections" className="w-[148px] shrink-0 overflow-y-auto py-3 px-2 flex flex-col gap-px bg-bg-primary/40">
      {present.map(l => (
        <button key={l} onClick={() => go(l)} aria-current={active === l ? 'true' : undefined}
          className={`text-left px-2.5 py-1.5 rounded-lg text-[13px] truncate cursor-pointer transition-colors ${active === l ? 'bg-accent-subtle text-accent font-semibold' : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'}`}>
          {l}
        </button>
      ))}
    </nav>
  )
}
