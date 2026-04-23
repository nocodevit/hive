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
