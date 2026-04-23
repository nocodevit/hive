import { useEffect, useRef } from 'react'
import type { AvatarConfig } from '../types'

interface Props {
  config: AvatarConfig
  onChange: (config: AvatarConfig) => void
  size?: number
}

const SKIN_TONES = ['#fde0c4', '#f5d0a9', '#dba97a', '#c68642', '#8d5524', '#5c3317']
const HAIR_COLORS = ['#2c1810', '#4a3728', '#8b6914', '#c4a35a', '#d4a76a', '#e8c07a', '#7c3aed', '#06b6d4', '#f43f5e']
const HAIR_STYLES = ['none', 'short', 'parted', 'spiky', 'bun', 'long']
const TOP_STYLES = ['tee', 'hoodie', 'jacket', 'tank']
const TOP_COLORS = ['#7c3aed', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#1e293b', '#f8fafc']
const BOTTOM_STYLES = ['pants', 'shorts', 'skirt']
const BOTTOM_COLORS = ['#1e293b', '#3b82f6', '#6b7280', '#7c3aed', '#0f172a', '#ec4899']
const HAT_TYPES = ['none', 'cap', 'beanie']
const ACCESSORIES = ['glasses', 'headset', 'backpack']
const SHOE_COLORS = ['#1e293b', '#7c3aed', '#8b4513', '#f8fafc']

function drawAvatar(ctx: CanvasRenderingContext2D, config: AvatarConfig, size: number) {
  const s = size / 16 // pixel scale
  ctx.clearRect(0, 0, size, size)
  ctx.imageSmoothingEnabled = false

  const px = (x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color
    ctx.fillRect(x * s, y * s, w * s, h * s)
  }

  // Shadow
  px(5, 15, 6, 1, 'rgba(0,0,0,0.15)')

  // Shoes
  const shoeColor = '#1e293b'
  px(5, 14, 2, 1, shoeColor)
  px(9, 14, 2, 1, shoeColor)

  // Legs
  px(6, 12, 1, 2, config.skinTone)
  px(9, 12, 1, 2, config.skinTone)

  // Bottom
  const bottomColor = config.bottomColor || '#1e293b'
  if (config.bottomStyle === 'shorts') {
    px(5, 10, 6, 2, bottomColor)
  } else if (config.bottomStyle === 'skirt') {
    px(4, 10, 8, 2, bottomColor)
  } else {
    px(5, 10, 6, 3, bottomColor)
    px(6, 12, 1, 1, bottomColor)
    px(9, 12, 1, 1, bottomColor)
  }

  // Body/Top
  const topColor = config.topColor || '#7c3aed'
  if (config.topStyle === 'hoodie') {
    px(4, 6, 8, 4, topColor)
    px(5, 5, 6, 1, topColor)
    // Hood outline
    px(4, 5, 1, 1, darken(topColor, 20))
    px(11, 5, 1, 1, darken(topColor, 20))
  } else if (config.topStyle === 'jacket') {
    px(4, 6, 8, 4, topColor)
    // Jacket opening
    px(7, 7, 2, 3, darken(topColor, 30))
  } else if (config.topStyle === 'tank') {
    px(5, 6, 6, 4, topColor)
    // Show skin on shoulders
    px(4, 6, 1, 2, config.skinTone)
    px(11, 6, 1, 2, config.skinTone)
  } else {
    // Tee
    px(4, 6, 8, 4, topColor)
  }

  // Arms
  px(3, 7, 1, 3, config.skinTone)
  px(12, 7, 1, 3, config.skinTone)

  // Neck
  px(7, 5, 2, 1, config.skinTone)

  // Head
  px(5, 1, 6, 4, config.skinTone)
  px(4, 2, 1, 2, config.skinTone)
  px(11, 2, 1, 2, config.skinTone)

  // Eyes
  px(6, 3, 1, 1, '#1e1b4b')
  px(9, 3, 1, 1, '#1e1b4b')

  // Mouth
  px(7, 4, 2, 0.5, darken(config.skinTone, 40))

  // Hair
  const hairColor = config.hairColor || '#2c1810'
  if (config.hairStyle === 'short') {
    px(5, 0, 6, 2, hairColor)
    px(4, 1, 1, 1, hairColor)
    px(11, 1, 1, 1, hairColor)
  } else if (config.hairStyle === 'parted') {
    px(5, 0, 6, 1, hairColor)
    px(4, 1, 3, 1, hairColor)
    px(11, 1, 1, 1, hairColor)
  } else if (config.hairStyle === 'spiky') {
    px(5, 0, 6, 1, hairColor)
    px(4, -1, 2, 2, hairColor)
    px(7, -1, 1, 1, hairColor)
    px(10, -1, 2, 2, hairColor)
  } else if (config.hairStyle === 'bun') {
    px(5, 0, 6, 2, hairColor)
    px(7, -1, 2, 1, hairColor)
  } else if (config.hairStyle === 'long') {
    px(5, 0, 6, 2, hairColor)
    px(4, 1, 1, 4, hairColor)
    px(11, 1, 1, 4, hairColor)
  }

  // Hat
  if (config.hat === 'cap') {
    px(3, 0, 10, 1, '#1e293b')
    px(5, -1, 6, 1, '#1e293b')
  } else if (config.hat === 'beanie') {
    px(4, -1, 8, 2, '#ef4444')
    px(7, -2, 2, 1, '#ef4444')
  }

  // Accessories
  if (config.accessories?.includes('glasses')) {
    px(5, 3, 2, 1, '#374151')
    px(8, 3, 2, 1, '#374151')
    px(7, 3, 1, 0.5, '#374151')
  }
  if (config.accessories?.includes('headset')) {
    px(3, 2, 1, 2, '#374151')
    px(12, 2, 1, 2, '#374151')
    px(4, 1, 8, 1, '#374151')
  }
}

function darken(hex: string, amount: number): string {
  const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - amount)
  const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - amount)
  const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - amount)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

function ColorPicker({ colors, value, onChange, label }: {
  colors: string[]
  value: string
  onChange: (c: string) => void
  label: string
}) {
  return (
    <div>
      <p className="text-[12px] text-text-muted mb-1">{label}</p>
      <div className="flex gap-1 flex-wrap">
        {colors.map((c) => (
          <button
            key={c}
            onClick={() => onChange(c)}
            className={`w-6 h-6 rounded-md cursor-pointer transition-transform ${
              value === c ? 'ring-2 ring-accent ring-offset-1 ring-offset-bg-secondary scale-110' : 'hover:scale-105'
            }`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
    </div>
  )
}

function OptionPicker({ options, value, onChange, label }: {
  options: string[]
  value: string
  onChange: (v: string) => void
  label: string
}) {
  return (
    <div>
      <p className="text-[12px] text-text-muted mb-1">{label}</p>
      <div className="flex gap-1 flex-wrap">
        {options.map((o) => (
          <button
            key={o}
            onClick={() => onChange(o)}
            className={`px-2 py-1 rounded-md text-[12px] capitalize cursor-pointer transition-colors ${
              value === o
                ? 'bg-accent text-text-on-purple'
                : 'bg-bg-primary border border-border text-text-muted hover:text-text-primary'
            }`}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function AvatarEditor({ config, onChange, size = 128 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    drawAvatar(ctx, config, size)
  }, [config, size])

  const update = (partial: Partial<AvatarConfig>) => onChange({ ...config, ...partial })

  const toggleAccessory = (acc: string) => {
    const current = config.accessories || []
    const next = current.includes(acc) ? current.filter((a) => a !== acc) : [...current, acc]
    update({ accessories: next })
  }

  const randomize = () => {
    const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]
    onChange({
      skinTone: pick(SKIN_TONES),
      hairStyle: pick(HAIR_STYLES.filter((h) => h !== 'none')),
      hairColor: pick(HAIR_COLORS),
      topStyle: pick(TOP_STYLES),
      topColor: pick(TOP_COLORS),
      bottomStyle: pick(BOTTOM_STYLES),
      bottomColor: pick(BOTTOM_COLORS),
      hat: pick(HAT_TYPES),
      accessories: ACCESSORIES.filter(() => Math.random() > 0.7)
    })
  }

  return (
    <div className="space-y-4">
      {/* Preview */}
      <div className="flex items-center gap-4">
        <div className="bg-bg-primary rounded-xl p-3 border border-border">
          <canvas
            ref={canvasRef}
            width={size}
            height={size}
            className="block"
            style={{ imageRendering: 'pixelated' }}
          />
        </div>
        <button
          onClick={randomize}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-bg-hover text-text-muted
            hover:text-text-primary transition-colors cursor-pointer flex items-center gap-1.5"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 3 21 3 21 8" />
            <line x1="4" y1="20" x2="21" y2="3" />
            <polyline points="21 16 21 21 16 21" />
            <line x1="15" y1="15" x2="21" y2="21" />
            <line x1="4" y1="4" x2="9" y2="9" />
          </svg>
          Randomize
        </button>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-2 gap-3">
        <ColorPicker label="Skin" colors={SKIN_TONES} value={config.skinTone} onChange={(c) => update({ skinTone: c })} />
        <OptionPicker label="Hair" options={HAIR_STYLES} value={config.hairStyle} onChange={(v) => update({ hairStyle: v })} />
        <ColorPicker label="Hair Color" colors={HAIR_COLORS} value={config.hairColor} onChange={(c) => update({ hairColor: c })} />
        <OptionPicker label="Top" options={TOP_STYLES} value={config.topStyle} onChange={(v) => update({ topStyle: v })} />
        <ColorPicker label="Top Color" colors={TOP_COLORS} value={config.topColor} onChange={(c) => update({ topColor: c })} />
        <OptionPicker label="Bottom" options={BOTTOM_STYLES} value={config.bottomStyle} onChange={(v) => update({ bottomStyle: v })} />
        <ColorPicker label="Bottom Color" colors={BOTTOM_COLORS} value={config.bottomColor} onChange={(c) => update({ bottomColor: c })} />
        <OptionPicker label="Hat" options={HAT_TYPES} value={config.hat} onChange={(v) => update({ hat: v })} />
      </div>

      {/* Accessories */}
      <div>
        <p className="text-[12px] text-text-muted mb-1">Accessories</p>
        <div className="flex gap-1">
          {ACCESSORIES.map((acc) => (
            <button
              key={acc}
              onClick={() => toggleAccessory(acc)}
              className={`px-2 py-1 rounded-md text-[12px] capitalize cursor-pointer transition-colors ${
                config.accessories?.includes(acc)
                  ? 'bg-accent text-text-on-purple'
                  : 'bg-bg-primary border border-border text-text-muted hover:text-text-primary'
              }`}
            >
              {acc}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// Small avatar preview (for sidebar/kanban)
export function AvatarPreview({ config, size = 32 }: { config: AvatarConfig; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    drawAvatar(ctx, config, size)
  }, [config, size])

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className="block"
      style={{ imageRendering: 'pixelated' }}
    />
  )
}
