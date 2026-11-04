import greenhouse from '../assets/botanic/greenhouse.webp'
import monstera from '../assets/botanic/monstera.webp'

/**
 * 🌿 The Botanic skin's ground (owner's pick, 11-02): a sunlit greenhouse in
 * light, monstera leaves at night in dark, behind frosted-glass cards and
 * sidebar. Nothing is drawn over the app. Photos: assets/botanic/CREDITS.md.
 */
const CSS = `
[data-palette='botanic'] body { background: url(${greenhouse}) center/cover fixed }
[data-palette='botanic'][data-theme='dark'] body { background-image: url(${monstera}) }
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
  return <style data-testid="botanic-fx">{CSS}</style>
}
