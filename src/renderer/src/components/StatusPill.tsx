// StatusPill.tsx — v2.10.0 unified status affordance.
//
// Replaces the ad-hoc `<span>` pills that were scattered across
// Overview, kanban headers, and elsewhere with per-file hardcoded
// classes. One component, one color-token pathway, one motion story.
//
// Semantic states:
//   working  — actively generating; green with pulse dot
//   waiting  — session live, waiting for input; sky blue with steady dot
//   idle     — done / dormant; muted grey, no dot
//   handoff  — auto /goal loop running; accent with rotating dash-glow
//   danger   — destructive intent (kill / close); Sriracha pink
//
// Sizes: xs (10px) / sm (11px) / md (12px). Default `sm`.

import React from 'react'

export type StatusKind = 'working' | 'waiting' | 'idle' | 'handoff' | 'danger'
export type StatusSize = 'xs' | 'sm' | 'md'

interface Props {
  status: StatusKind
  size?: StatusSize
  label?: string   // override the default label text
  className?: string
}

const KIND_STYLE: Record<StatusKind, { chip: string; dot: string; dotAnim: boolean }> = {
  working: {
    chip: 'bg-status-working/15 text-status-working',
    dot:  'bg-status-working',
    dotAnim: true,
  },
  waiting: {
    chip: 'bg-status-waiting/15 text-status-waiting',
    dot:  'bg-status-waiting',
    dotAnim: false,
  },
  idle: {
    chip: 'bg-bg-hover text-text-muted',
    dot:  '',
    dotAnim: false,
  },
  handoff: {
    chip: 'bg-accent/15 text-accent',
    dot:  'bg-accent',
    dotAnim: true,
  },
  danger: {
    chip: 'bg-status-danger/15 text-status-danger',
    dot:  'bg-status-danger',
    dotAnim: false,
  },
}

const SIZE_STYLE: Record<StatusSize, { chip: string; dot: string }> = {
  xs: { chip: 'text-[10px] px-1.5 py-0.5 gap-1',   dot: 'w-1 h-1' },
  sm: { chip: 'text-[11px] px-2 py-0.5 gap-1.5',  dot: 'w-1.5 h-1.5' },
  md: { chip: 'text-[12px] px-2.5 py-1 gap-1.5',  dot: 'w-2 h-2' },
}

const DEFAULT_LABEL: Record<StatusKind, string> = {
  working: 'Working',
  waiting: 'Waiting',
  idle:    'Idle',
  handoff: 'Handoff',
  danger:  'Danger',
}

export function StatusPill({ status, size = 'sm', label, className }: Props) {
  const k = KIND_STYLE[status]
  const s = SIZE_STYLE[size]
  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold whitespace-nowrap ${k.chip} ${s.chip} ${className || ''}`}
    >
      {k.dot && (
        <span
          className={`rounded-full flex-shrink-0 ${k.dot} ${s.dot} ${k.dotAnim ? 'animate-pulse' : ''}`}
        />
      )}
      {label ?? DEFAULT_LABEL[status]}
    </span>
  )
}
