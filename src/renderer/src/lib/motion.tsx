// Hive motion — the micro-interactions skill's tokens, plus the few pieces
// shared across panels (count badge, undo toast). Only transform / opacity
// animate; height changes go through `layout`. MotionConfig reducedMotion="user"
// (set around each panel) turns movement into fades when the OS asks.

import { AnimatePresence, motion, type Transition } from 'motion/react'
import { useEffect, useState } from 'react'

/** spring.smooth — layout moves, expand / collapse, sliding indicators. */
export const SMOOTH: Transition = { type: 'spring', visualDuration: 0.35, bounce: 0 }
/** spring.snappy — state changes, press feedback. */
export const SNAPPY: Transition = { type: 'spring', visualDuration: 0.25, bounce: 0.15 }
/** fade.in / fade.out — exits are always quicker than entries. */
export const FADE_IN: Transition = { duration: 0.15, ease: 'easeOut' }
export const FADE_OUT: Transition = { duration: 0.12, ease: 'easeIn' }

/** A menu / popover: grows from its trigger (pass the origin), fades out faster. */
export const popover = (origin: string) => ({
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1, transition: FADE_IN },
  exit: { opacity: 0, scale: 0.98, transition: FADE_OUT },
  style: { transformOrigin: origin }
})

/**
 * A list row that arrives / leaves: fades + grows in, fades out; with the list's
 * <AnimatePresence mode="popLayout"> the leaving row is taken out of the flow at
 * once and the rows below slide up by transform (`layout`), never by height.
 */
export const row = {
  layout: true as const,
  initial: { opacity: 0, scale: 0.98 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.96, transition: FADE_OUT },
  transition: SMOOTH
}

/**
 * Count badge: the number rolls to its new value (up when it grows, down when it
 * shrinks), the badge bumps once, and it shrinks away at 0. Tabular figures.
 */
export function CountBadge({ count, className }: { count: number; className: string }) {
  const [prev, setPrev] = useState(count)
  const dir = count >= prev ? 1 : -1
  useEffect(() => { setPrev(count) }, [count])
  return (
    <AnimatePresence initial={false}>
      {count > 0 && (
        <motion.span key="badge" initial={{ scale: 0 }} animate={{ scale: [1, 1.15, 1] }} exit={{ scale: 0, opacity: 0, transition: FADE_OUT }}
          transition={{ duration: 0.3 }} className={`${className} relative overflow-hidden`} style={{ fontVariantNumeric: 'tabular-nums' }}
          aria-label={`${count}`}>
          <AnimatePresence initial={false} mode="popLayout" custom={dir}>
            <motion.span key={count} custom={dir} variants={{ enter: (d: number) => ({ y: d * 10, opacity: 0 }), center: { y: 0, opacity: 1 }, leave: (d: number) => ({ y: d * -10, opacity: 0 }) }}
              initial="enter" animate="center" exit="leave" transition={SNAPPY} className="inline-block">{count}</motion.span>
          </AnimatePresence>
        </motion.span>
      )}
    </AnimatePresence>
  )
}

// ── Undo toast ───────────────────────────────────────────────────────
// Something was removed right away (Dismiss, Drop); a toast offers it back for
// 5 s, with a line that runs down so you can see it is about to go.
type UndoItem = { id: number; text: string; undo: () => void }
let nextId = 1
export function offerUndo(text: string, undo: () => void): void {
  window.dispatchEvent(new CustomEvent('hive:undo', { detail: { id: nextId++, text, undo } }))
}

export function UndoToasts({ ms = 5000 }: { ms?: number }) {
  const [items, setItems] = useState<UndoItem[]>([])
  useEffect(() => {
    const on = (e: Event) => {
      const it = (e as CustomEvent<UndoItem>).detail
      setItems(l => [...l.slice(-2), it])
      window.setTimeout(() => setItems(l => l.filter(x => x.id !== it.id)), ms)
    }
    window.addEventListener('hive:undo', on)
    return () => window.removeEventListener('hive:undo', on)
  }, [ms])
  return (
    <div className="pointer-events-none absolute left-3 right-3 bottom-3 z-40 flex flex-col items-center gap-1.5">
      <AnimatePresence initial={false}>
        {items.map(it => (
          <motion.div key={it.id} layout role="status" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0, transition: SMOOTH }} exit={{ opacity: 0, y: 8, transition: FADE_OUT }}
            drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={0.6}
            onDragEnd={(_, info) => { if (Math.abs(info.offset.x) > 80) setItems(l => l.filter(x => x.id !== it.id)) }}
            className="pointer-events-auto relative overflow-hidden flex items-center gap-3 pl-3.5 pr-1.5 py-1.5 rounded-xl bg-bg-tertiary border border-border shadow-lg text-[12.5px] text-text-primary">
            <span>{it.text}</span>
            <button onClick={() => { it.undo(); setItems(l => l.filter(x => x.id !== it.id)) }} className="h-7 px-2.5 rounded-lg text-[12px] font-semibold text-accent hover:bg-bg-hover cursor-pointer">Undo</button>
            <motion.i aria-hidden className="absolute left-0 bottom-0 h-[2px] w-full bg-accent origin-left" initial={{ scaleX: 1 }} animate={{ scaleX: 0 }} transition={{ duration: ms / 1000, ease: 'linear' }} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
