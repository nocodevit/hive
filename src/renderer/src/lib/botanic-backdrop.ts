import jungle from '../assets/botanic/jungle.webp'
import understory from '../assets/botanic/understory.webp'
import canopy from '../assets/botanic/canopy.webp'
import leaves from '../assets/botanic/leaves.webp'

/** 🌿 Botanic dark-theme garden photos, in click order. Credits: assets/botanic/CREDITS.md. */
export const BACKDROPS = [
  { id: 'jungle', label: 'Jungle', url: jungle },
  { id: 'understory', label: 'Understory', url: understory },
  { id: 'canopy', label: 'Canopy', url: canopy },
  { id: 'leaves', label: 'Leaves', url: leaves }
] as const
export type BackdropId = (typeof BACKDROPS)[number]['id']

const KEY = 'hive:botanic-backdrop'
const EVENT = 'hive:botanic-backdrop'

export function loadBackdrop(): BackdropId {
  try {
    const id = localStorage.getItem(KEY)
    return BACKDROPS.some(b => b.id === id) ? (id as BackdropId) : BACKDROPS[0].id
  } catch { return BACKDROPS[0].id }
}

export function saveBackdrop(id: BackdropId) {
  try { localStorage.setItem(KEY, id) } catch { /* private storage: still switches for this run */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: id }))
}

export const onBackdrop = (fn: (id: BackdropId) => void) => {
  const h = (e: Event) => fn((e as CustomEvent<BackdropId>).detail)
  window.addEventListener(EVENT, h)
  return () => window.removeEventListener(EVENT, h)
}

export const nextBackdrop = (id: BackdropId): BackdropId =>
  BACKDROPS[(BACKDROPS.findIndex(b => b.id === id) + 1) % BACKDROPS.length].id
export const backdropLabel = (id: BackdropId) => BACKDROPS.find(b => b.id === id)!.label
export const backdropUrl = (id: BackdropId) => BACKDROPS.find(b => b.id === id)!.url
