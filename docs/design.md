# Hive Design System

## Identity

**Style**: Glassmorphism — frosted glass surfaces over deep purple backgrounds, bright violet accents, Apple emoji icons.

**Mood**: Mission control for AI agents. Professional but futuristic. Dense information, zero decoration.

---

## Color Palette

### Dark Theme (Primary)

| Token | Hex | Usage |
|-------|-----|-------|
| `--bg-primary` | `#0f0a1a` | Main background |
| `--bg-secondary` | `#1a1128` | Cards, modals, panels |
| `--bg-tertiary` | `#231838` | Nested surfaces |
| `--bg-hover` | `#2d1f48` | Hover states |
| `--bg-active` | `#3b2a5e` | Active/selected |
| `--bg-terminal` | `#0a0a0a` | Terminal background |

| Token | Hex | Usage |
|-------|-----|-------|
| `--text-primary` | `#f0ecf9` | Primary text |
| `--text-secondary` | `#d4bcfa` | Secondary text (brighter) |
| `--text-muted` | `#8d7fb0` | Labels, captions (brighter) |
| `--text-on-purple` | `#ffffff` | Text on accent bg |

| Token | Hex | Usage |
|-------|-----|-------|
| `--accent` | `#b794f6` | Primary interactive (bright violet) |
| `--accent-hover` | `#d4bcfa` | Hover accent |
| `--accent-subtle` | `#2d1f48` | Tinted backgrounds |
| `--accent-muted` | `#8b5cf6` | Deeper accent |

| Token | Hex | Usage |
|-------|-----|-------|
| `--status-working` | `#4ade80` | Active / online |
| `--status-waiting` | `#fbbf24` | Waiting / blocked |
| `--status-done` | `#64748b` | Completed / idle |

| Token | Hex | Usage |
|-------|-----|-------|
| `--border-default` | `#2d1f48` | Standard borders |
| `--border-subtle` | `#231838` | Subtle dividers |

### Light Theme

| Token | Hex |
|-------|-----|
| `--bg-primary` | `#faf5ff` |
| `--bg-secondary` | `#ffffff` |
| `--bg-hover` | `#ede9fe` |
| `--text-primary` | `#1e1b4b` |
| `--text-secondary` | `#4c1d95` |
| `--accent` | `#7c3aed` |
| `--status-working` | `#22c55e` |
| `--status-waiting` | `#f59e0b` |
| `--status-done` | `#94a3b8` |

### Role Colors (Task Group)

| Role | Color | Background |
|------|-------|------------|
| Manager | `#F59E0B` | `rgba(245,158,11,0.15)` |
| Worker | `#3B82F6` | `rgba(59,130,246,0.15)` |
| QA | `#10B981` | `rgba(16,185,129,0.15)` |
| Critic | `#8B5CF6` | `rgba(139,92,246,0.15)` |

---

## Typography

| Role | Font | Weight | Sizes |
|------|------|--------|-------|
| Headings | Space Grotesk | 600-700 | 14-28px |
| Body | DM Sans | 400-500 | 12-14px |
| Data/Stats | JetBrains Mono | 400-500 | 10-13px |
| Labels | DM Sans | 600-700 | 9-10px, uppercase, tracking 0.08em |
| Terminal | Noto Mono / MesloLGS NF / Menlo | 400 | 13px |

### Scale (all sizes bumped +1px from original)

- `28px` — Page titles
- `16px` — Modal titles
- `15px` — Section headings
- `14px` — Body
- `13px` — Card body text, terminal
- `12px` — Small UI text, badges
- `11px` — Tags, micro labels

---

## Spacing

Base grid: **4px**. All spacing is a multiple of 4.

| Token | Value | Usage |
|-------|-------|-------|
| `xs` | 4px | Tight gaps, dot spacing |
| `sm` | 8px | Compact element gaps |
| `md` | 12px | Standard component spacing |
| `lg` | 16px | Card gaps, section spacing |
| `xl` | 20px | Card padding |
| `2xl` | 24px | Page padding, section margins |

---

## Surfaces

### Glass Card (Primary)
```css
background: rgba(124, 58, 237, 0.08);
backdrop-filter: blur(20px);
border: 1px solid rgba(124, 58, 237, 0.15);
border-radius: 16px;
box-shadow: 0 4px 24px rgba(124, 58, 237, 0.06),
            inset 0 1px 0 rgba(255, 255, 255, 0.08);
```

### Glass Card Warm (Secondary)
```css
background: rgba(16, 185, 129, 0.08);
backdrop-filter: blur(20px);
border: 1px solid rgba(16, 185, 129, 0.15);
border-radius: 16px;
box-shadow: 0 4px 24px rgba(16, 185, 129, 0.06),
            inset 0 1px 0 rgba(255, 255, 255, 0.08);
```

### Flat Card (Inner surfaces — no glass-on-glass)
```css
background: var(--bg-secondary);
border: 1px solid var(--border-default);
border-radius: 12px;
```

### Rule: Glass is for top-level containers only. Inner elements use flat cards.

---

## Border Radius

| Size | Value | Usage |
|------|-------|-------|
| `sm` | 6px | Buttons, inputs, small elements |
| `md` | 8px | Standard components, nav items |
| `lg` | 12px | Cards, panels |
| `xl` | 16px | Glass cards, modals |
| `full` | 9999px | Dots, badges, progress bars |

---

## Buttons

### Primary
- Background: `var(--accent)`
- Text: `var(--text-on-purple)`
- Padding: `8px 12px`
- Radius: `8px`
- Hover: `var(--accent-hover)`

### Secondary
- Background: `var(--bg-hover)`
- Text: `var(--text-muted)`
- Border: `1px solid var(--border-default)`
- Hover: text becomes `var(--text-primary)`

### Ghost
- Background: transparent
- Text: `var(--text-muted)`
- Hover: background `var(--bg-hover)`

### Icon Button
- Size: `28px x 28px`
- Radius: `8px`
- Hover: background `var(--bg-hover)`

---

## Badges & Tags

### Status Badge
- Dot: `6-8px` circle, `rounded-full`
- With border: `2px solid var(--bg-primary)` (for overlay on avatars)
- Colors: status tokens

### Label Tag
- Font: `9-10px`, `uppercase`, `font-weight: 700`, `letter-spacing: 0.05-0.08em`
- Padding: `2px 8px`
- Radius: `6px`
- Background: role/status color at 15% opacity
- Text: role/status color at full

---

## Status Indicators

| Status | Color | Dot | Label |
|--------|-------|-----|-------|
| Working | `--status-working` | Solid green | `WORKING` |
| Waiting | `--status-waiting` | Solid amber | `WAITING` |
| Idle/Done | `--status-done` | Solid slate | `IDLE` |

Dot placement: bottom-right corner of avatar/icon, with 2px border matching parent background.

---

## Icons

- **Inline SVG** — 12-16px for text-level, 20-24px for buttons
- **Stroke-based** — `stroke-width: 2`, `stroke-linecap: round`, `stroke-linejoin: round`
- **Color**: `currentColor` inheritance
- **Apple Emoji** — Role icons: 👑 Manager, 🔧 Worker, 🛡️ QA, 🔍 Critic
- **No icon library** — all SVG inline + Apple emoji for roles

---

## Animations

| Effect | Duration | Easing |
|--------|----------|--------|
| Color transitions | 200ms | ease |
| Slide-in panels | 200ms | ease-out |
| Hover scale (avatar) | 200ms | ease |
| Progress bar fill | 300ms | ease |

### Keyframes
```css
@keyframes slide-in {
  from { transform: translateX(100%); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
```

---

## Layout Patterns

### Main Shell
3-column resizable: Projects | Agents | Content (terminal/editor/dashboard)

### Dashboard
- Top row: Progress + Task Group status (2-col glass cards)
- Middle: Todo list (unified, single glass card)
- Bottom: Work Zones list

### Task Group
- Agent Roster: Vertical list table (icon | name+subtitle | dept | role | stats)
- Batch Status: Glass card with progress bar + task list
- Proposal/Merge: Accent-bordered glass cards with action buttons

### Agent Kanban
3-column grid: Working | Waiting | Idle

---

## Scrollbar

```css
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: var(--border-default);
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: var(--accent-muted);
}
```

---

## Modal

- Backdrop: `bg-black/50` + `backdrop-blur-sm`
- Container: `bg-bg-secondary`, `border border-border`, `rounded-2xl`, `shadow-2xl`
- Width: `520px`, max-height `80vh`, overflow-y auto
- Header: `px-6 py-4`, border-bottom
- Content: `p-6`

---

## Rules

1. **Glass only on top-level containers.** No glass-on-glass nesting.
2. **Monospace for data.** Stats, counters, timestamps use JetBrains Mono.
3. **Color means something.** Purple = interactive, green = success/active, amber = warning/waiting, slate = done/muted.
4. **Labels are uppercase.** Section headers, tags, role badges — always uppercase + tracking.
5. **4px grid.** All spacing is a multiple of 4.
6. **Dark first.** Design in dark theme, adapt to light.
7. **Dense but readable.** Maximize information density without sacrificing scan-ability.
