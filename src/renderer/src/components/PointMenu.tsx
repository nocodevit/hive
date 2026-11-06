import { useLayoutEffect, useRef, useState, type ReactNode, type MouseEvent } from 'react'

const EDGE = 8

/** A right-click menu at the pointer: flips up / left when it would run past the window, scrolls when taller than it. */
export function PointMenu({ x, y, className = '', onClick, children }: {
  x: number; y: number; className?: string; onClick?: (e: MouseEvent) => void; children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight?: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.scrollHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    const left = x + w + EDGE > vw ? Math.max(EDGE, x - w) : x
    const room = vh - 2 * EDGE
    const top = h > room ? EDGE : y + h + EDGE > vh ? Math.max(EDGE, y - h) : y
    setPos({ left, top, ...(h > room ? { maxHeight: room } : {}) })
  }, [x, y])
  return (
    <div ref={ref} role="menu" onClick={onClick}
      className={`fixed overflow-y-auto ${className}`}
      style={pos ? { left: pos.left, top: pos.top, maxHeight: pos.maxHeight } : { left: x, top: y, visibility: 'hidden' }}>
      {children}
    </div>
  )
}
