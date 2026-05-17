# Hive

Electron desktop app for managing multiple Claude Code agents.

## Dev workflow (NON-NEGOTIABLE — every change must follow)

For ANY code change, the loop is:

1. **Pull**: `git pull --rebase origin <branch>` — branch must be up to date before editing
2. **Branch hygiene**: never leave uncommitted changes accumulating over multiple sessions. If a fix is started, it must end in a commit OR be reverted in the same session
3. **Implement** the fix
4. **Test gate (BOTH required, NO exceptions):**
   - `vitest run` — green (556+ passing). New code MUST be covered: add a unit test for any new function / branch / IPC handler / React component / regex / state transition. PR is rejected if `git diff` adds lines without corresponding `__tests__` lines.
   - For UI / IPC / chat flow changes: `npx playwright test` — green. The e2e config MUST point at an isolated `HIVE_DATA_DIR` and a dev server on a non-default port so it never touches the user's running Hive.app or real projects.
5. **Bump version** (see Version section)
6. **Commit** — one logical fix per commit, message starts with `fix:` / `feat:` / `refactor:` etc. Include test coverage in the same commit (not "tests next PR")
7. **PR review skill** (`/.claude/skills/pr-review/SKILL.md`) — run before opening any PR. Refuse-to-PR conditions are absolute

NEVER ship a fix that:
- Has no test exercising it
- Lives only in the working tree (uncommitted) across sessions — uncommitted state vanishes if the directory is deleted/moved
- Was "manually verified" instead of test-covered. "manually verified" alone is grounds for revert

If a fix genuinely cannot be unit-tested (macOS GUI behavior, OAuth flow, keychain), it MUST have:
- An explicit comment `// UNTESTABLE: <reason>` above the code
- A `docs/manual-test-plan.md` entry with reproducer steps
- A Playwright e2e if the surface is reachable through the UI

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
