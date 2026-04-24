# Hive

Electron desktop app for managing multiple Claude Code agents.

## Version

MUST ALWAYS bump version before commit. Single source of truth: `package.json`. x+1 for big upgrade, y+1 for feature, z+1 for bugfix. NEVER hardcode version. Also update `.release-please-manifest.json`.

## Stack

Electron 35, React 18, TypeScript, Tailwind CSS, xterm.js, node-pty, Vite

## Structure

- `src/main/` — Electron main process (index.ts, tasks.ts, gate.ts, souls.ts, helpers.ts, utils.ts)
- `src/renderer/` — React UI (App.tsx, components/)
- `src/preload/` — IPC bridge
- `e2e/` — Playwright E2E tests
- `docs/` — design.md, architecture docs

## UI

Read `docs/design.md` before any UI change.

## UI color contract (NON-NEGOTIABLE)

Every Crush palette color MUST be rendered at its defined hex value, losslessly:

- Pepper `#201F26`, BBQ `#2D2C35`, Charcoal `#3A3943`
- Sriracha `#EB4268`, Julep `#00FFB2`, Zest `#E8FE96`, Malibu `#00A4FF`
- Dolly `#FF60FF`, Bok `#68FFD6`, Charple `#6B50FF`, Violet `#C259FF`, Mochi `#EB5DFF`, Blush `#FF84FF`
- Butter `#FFFAF1`, Ash `#DFDBDD`, Squid `#858392`, Oyster `#605F6B`

Rules:

1. **NEVER lower saturation without explicit user approval.** No `rgba()` with <1.0 alpha on accent backgrounds. No silent HSL desaturation. No "saturation-threshold" filtering. Colors render at their published hex.
2. **Transparency/alpha is a design decision, not a technical one.** If an element needs translucency, confirm the exact alpha with the user first.
3. **Color remapping** (e.g. mapping 24-bit SGR → Crush palette in the terminal): map to the nearest Crush hue target, emit the target's FULL hex. Never emit a blended/reduced-saturation version.
4. **Preview is the contract.** `ui-preview-crush-elements.html` and other `ui-preview-*.html` files are the source of truth for element ↔ color mapping. Implementation must match them pixel-for-pixel. If a preview value seems wrong, change the preview FIRST with user approval, then code.
5. **When in doubt, ship at full saturation.** Lowering is easy to review and approve later; silently reducing is what causes weeks of frustration.
