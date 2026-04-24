# pretty-term/ — SUSPENDED

This directory holds an experimental attempt to replace xterm.js's canvas
rendering with a custom React grid renderer. The state machine and buffer
came from `@xterm/headless`; we read cells out and rendered spans.

## Why suspended

1. **Performance.** Rendering a full 24×80 grid as React spans on every PTY
   flush means ~1920 reconciliations per frame. xterm.js renders to canvas
   (or WebGL) for a reason — DOM-based terminal rendering is an order of
   magnitude slower. Users reported "渲染太慢，没有 xterm 快".

2. **Input reliability.** The `<textarea>`-behind-canvas trick used by
   xterm.js is deceptively subtle: pointer-events, opacity, user-select,
   focus-on-mount, IME candidate window anchoring, and layer ordering all
   conspire to break typing. Getting this right is a few weeks of polish
   work xterm.js has already done.

3. **Scope mismatch.** The user's actual goal was "render some Claude
   Code blocks as React components" — not "replace the entire terminal
   renderer". xterm.js's `registerDecoration` / `registerMarker` APIs let
   us overlay React on top of specific buffer lines without touching the
   fast path. That's the right abstraction.

## Current production path

See `Terminal.tsx` — it keeps xterm.js as the renderer and layers React
overlays on top via `registerDecoration`:

- User-input row → Dolly-tinted background decoration
- `❯` prompt → green overlay decoration
- (Step 2) tool calls / diffs / code blocks → React card decorations

## What to salvage if we revive this

- `lib/crush-theme.ts` — the palette is reused everywhere
- `lib/keyboard.ts` — keyToBytes is generic, worth keeping
- `lib/cell-render.ts` — buildSegments is a solid algorithm for grouping
  styled cells; could be reused if we ever do a DOM-cell renderer again
- `geometry.ts` — cursorViewPos / userInputRange helpers transfer to a
  pure xterm.js-buffer world with minor rewrites

Files here are kept for reference and because deleting code without a
reason tends to lose context. Do not route new work through this module.
