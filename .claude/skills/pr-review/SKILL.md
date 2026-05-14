---
name: pr-review
description: |
  Hive project PR review — gates before creating or merging any PR.
  Checks: build passes, vitest green, version bumped in package.json +
  .release-please-manifest.json, UI color contract respected (Crush palette,
  no rgba alpha on accent backgrounds), LF line endings, no debug residue,
  no window.prompt() (broken in Electron renderer), no hardcoded versions,
  TypeScript clean (no unexplained any/@ts-ignore), docs/design.md consulted
  for UI changes. Use before every commit + PR, after any UI change, or when
  asked to review a PR. Trigger phrases: "pr review", "before PR", "review
  my changes", "ready to merge", "submit PR", "code review".
---

# Skill: Hive PR Review

Hive 项目 PR 审查 checklist. 每次提交/PR前必跑.

## Pre-PR

```bash
git status --short                          # must be clean or staged-only
git fetch origin main && git rebase origin/main  # keep branch fresh
gh pr list --head $(git branch --show-current) --state open  # no dupe PR
```

## Phase 1: Project Gates

| Gate | Check |
|------|-------|
| 1 Version bump | `package.json:version` + `.release-please-manifest.json` both updated, never hardcoded elsewhere |
| 2 Build | `./node_modules/.bin/electron-vite build` green (no TS errors, no vite errors) |
| 3 Tests | `vitest run` — all pass, new behaviour covered |
| 4 Debug residue | no `console.log` / `debugger` / `TODO: remove` / `_backup` / `_old` in changed files |
| 5 Type safety | no `: any` / `as any` / `@ts-ignore` without explanatory comment |
| 6 LF line endings | no CRLF (`file <changed>` must not say "CRLF") |
| 7 UI color contract | no `rgba()` with alpha < 1 on accent backgrounds; no HSL desaturation; colors match Crush palette hex; `ui-preview-*.html` consulted |
| 8 UI design | `docs/design.md` re-read before any component change |
| 9 Electron safety | no `window.prompt()` / `window.alert()` / `window.confirm()` in renderer — use state-driven modals |
| 10 IPC safety | new IPC channels registered in both `preload/index.ts` AND `main/index.ts` or `chat.ts` |

## Phase 2: Run Tests

```bash
# Vitest (main process + renderer unit)
vitest run

# E2E (if changed startup/IPC/chat flow)
npx playwright test --reporter=list
```

## Phase 3: Create PR

```bash
gh pr create --title "<type>: <description>" --body "$(cat <<'EOF'
## Summary
- <bullet 1>
- <bullet 2>

## Test plan
- [ ] vitest green
- [ ] build green
- [ ] manually verified in Hive app

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

## Checklist (block-merge)

- [ ] `package.json` + `.release-please-manifest.json` version bumped
- [ ] build passes (`electron-vite build`)
- [ ] vitest all green
- [ ] no `console.log` / `debugger` in diff
- [ ] no unexplained `any` / `@ts-ignore`
- [ ] LF only, no CRLF
- [ ] UI: color matches Crush palette, no alpha dilution
- [ ] UI: `docs/design.md` consulted
- [ ] Electron: no native dialog APIs in renderer
- [ ] IPC: both preload + main handlers exist for new channels

## Refuse-to-PR conditions

- Build fails
- Tests fail with no documented reason
- Version not bumped
- Hardcoded version string found (use `package.json` as SoT)
- CRLF line endings in any changed file
- `window.prompt()` / `window.alert()` in renderer code

## Related files

`CLAUDE.md` · `package.json` · `.release-please-manifest.json` · `docs/design.md` · `src/preload/index.ts` · `src/main/chat.ts` · `src/main/index.ts` · `ui-preview-*.html`
