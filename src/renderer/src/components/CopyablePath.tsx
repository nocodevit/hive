import { useState } from 'react'
import { CrushTooltip } from './hive-chat'

/**
 * CopyablePath — truncated path display that copies the full path on
 * click and shows it on hover via CrushTooltip.
 *
 * Pattern: many places in the UI render a long file path inside a
 * narrow row and rely on `truncate` + `title=`. The native title shows
 * but can't be styled, and there's no way to grab the full path.
 *
 * Click → writes `path` to clipboard, swaps tooltip text to "Copied ✓"
 * for 800ms, then reverts to showing the path.
 */
export default function CopyablePath({
  path,
  display,
  className,
  side = 'top',
  block = false
}: {
  path: string
  display?: string
  className?: string
  side?: 'top' | 'bottom'
  block?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const onClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(path)
      setCopied(true)
      setTimeout(() => setCopied(false), 800)
    } catch {}
  }
  return (
    <CrushTooltip text={copied ? 'Copied ✓' : path} side={side} block={block}>
      <span
        onClick={onClick}
        className={className}
        style={{ cursor: 'pointer', display: block ? 'block' : undefined }}
      >
        {display ?? path}
      </span>
    </CrushTooltip>
  )
}
