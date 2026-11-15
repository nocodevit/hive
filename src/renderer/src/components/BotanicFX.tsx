import { useEffect, useState } from 'react'
import greenhouse from '../assets/botanic/greenhouse.webp'
import { backdropUrl, loadBackdrop, onBackdrop } from '../lib/botanic-backdrop'

/**
 * 🌿 The Botanic skin's ground: a sunlit greenhouse in light; in dark, one of
 * four dark garden photos (title bar 🖼 cycles them), behind frosted-glass
 * cards and sidebar. Nothing is drawn over the app. Photos: assets/botanic/CREDITS.md.
 */
const css = (dark: string) => `
[data-palette='botanic'] body { background: url(${greenhouse}) center/cover fixed }
[data-palette='botanic'][data-theme='dark'] body { background-image: url(${dark}) }
[data-palette='botanic'] .hive-frame { padding: 40px 44px 44px 30px; gap: 26px }
[data-palette='botanic'] .hive-card, [data-palette='botanic'] .hive-sidebar {
  background: rgba(248,246,238,.50); backdrop-filter: blur(14px) saturate(1.15);
  border: 1px solid rgba(255,255,255,.28); box-shadow: 0 16px 50px rgba(0,0,0,.22)
}
[data-palette='botanic'] .hive-sidebar { background: rgba(244,242,234,.60); border-radius: 18px; padding-right: 10px }
[data-palette='botanic'][data-theme='dark'] .hive-card { background: rgba(20,25,21,.46) }
[data-palette='botanic'][data-theme='dark'] .hive-sidebar { background: rgba(16,20,17,.40) }
`

export function BotanicFX() {
  const [id, setId] = useState(loadBackdrop)
  useEffect(() => onBackdrop(setId), [])
  return <style data-testid="botanic-fx" data-backdrop={id}>{css(backdropUrl(id))}</style>
}
