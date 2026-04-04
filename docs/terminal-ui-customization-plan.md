# Terminal UI Customization Plan

## Current State
- xterm.js pure text terminal emulator
- Renders ANSI text stream from Claude Code
- No visual enhancements beyond standard terminal output

## Two Approaches

### Route A: Terminal-Internal Enhancement
- xterm.js custom renderers, link detection, decorators
- Recognize ANSI patterns (e.g. `[HIVE:progress:50%]`) → render as progress bar
- Limited — still constrained by text terminal framework

### Route B: Terminal + Overlay Hybrid (Recommended)
- Keep xterm for command interaction
- Overlay React components above/beside terminal
- Parse agent output (hooks / hive-report.sh) → real-time visual rendering
- This is how OpenCode achieves its visual presentation

## What Can Be Built (Route B)

| Trigger | Visual Component | Data Source |
|---|---|---|
| Agent starts task | Task card above terminal | hive-report.sh start |
| File changes | Side-panel real-time diff preview | git diff watch / hooks |
| Build/test results | Pass/fail badges, coverage bar | PostToolUse hook |
| Token usage | Real-time progress bar | Claude Code API / scraping |
| Agent messages | Bubble notifications | comms/messages/ fs.watch |
| Task list status | Mini kanban overlay | comms/tasks/ fs.watch |
| Errors/warnings | Highlighted alert banner | stderr parsing |

## Implementation Notes
- All overlays parse existing hooks/report data
- No changes to Claude Code itself required
- React components rendered in the same Electron window
- xterm stays as the interactive core, overlays are read-only displays
- Overlays can be toggled on/off per user preference

## Inspiration
- OpenCode: card-based task display, inline diff, progress indicators
- Warp: block-based terminal output, command grouping
- Cursor: inline diff preview, AI output cards
