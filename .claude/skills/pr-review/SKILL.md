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
git status --short                          # MUST be clean — no uncommitted working tree
git fetch origin main && git rebase origin/main  # keep branch fresh
gh pr list --head $(git branch --show-current) --state open  # no dupe PR
```

**REFUSE-TO-PR if `git status --short` shows uncommitted changes.** Working-tree-only fixes are how we lost ~10 fixes when `hive-david/` got deleted. Everything must be committed.

## Phase 1: Project Gates

| Gate | Check |
|------|-------|
| 1 Version bump | `package.json:version` + `.release-please-manifest.json` both updated, never hardcoded elsewhere |
| 2 Build | `./node_modules/.bin/electron-vite build` green (no TS errors, no vite errors) |
| 3 Tests pass | `vitest run` — all pass |
| 3b Test coverage of new code | **For every file in `git diff --name-only HEAD~1`, check `src/.../__tests__/` has a matching test file referencing the new symbol(s).** `grep -rn "<newFunctionName>\|<NewComponent>\|<new-ipc-channel>" src/**/__tests__/` must return ≥1 hit per new export. **REFUSE-TO-PR if a new exported function / React component / IPC handler / regex / state transition has 0 test references.** "Manually verified" alone is not a substitute — past incidents prove it. |
| 4 Debug residue | no `console.log` / `debugger` / `TODO: remove` / `_backup` / `_old` in changed files |
| 5 Type safety | no `: any` / `as any` / `@ts-ignore` without explanatory comment |
| 6 LF line endings | no CRLF (`file <changed>` must not say "CRLF") |
| 7 UI color contract | no `rgba()` with alpha < 1 on accent backgrounds; no HSL desaturation; colors match Crush palette hex; `ui-preview-*.html` consulted |
| 8 UI design | `docs/design.md` re-read before any component change |
| 9 Electron safety | no `window.prompt()` / `window.alert()` / `window.confirm()` in renderer — use state-driven modals |
| 10 IPC safety | new IPC channels registered in both `preload/index.ts` AND `main/index.ts` or `chat.ts` |
| 11 State machine completeness | `useState` setter must have a matching reader (JSX render or callback usage). `grep "setX\b"` count > 0 but `grep "\bX\b" \| grep -v "setX"` count = 0 = half-implemented feature (see pendingQuestion incident). REFUSE-TO-PR. |
| 12 IPC error surface | every `window.api.chat.X(...)` call MUST either await + handle `{ok:false, error}` or the call site MUST have a comment explaining why fire-and-forget is acceptable. Silent IPC failures (onFork, refresh→compact-on-dead-session) silently broke UX for days. |

## Phase 2: Run Tests

```bash
# Vitest (main process + renderer unit) — must be green
vitest run

# E2E (REQUIRED for any change touching startup / IPC / chat flow / renderer
# state machine / spawn paths). MUST run in isolated mode so it never touches
# the user's running Hive.app or real projects:
#
#   HIVE_DATA_DIR=/tmp/hive-e2e-$$ \
#   ELECTRON_RENDERER_URL=http://localhost:5174 \
#   npx playwright test --reporter=list
#
# - HIVE_DATA_DIR points elsewhere → e2e Hive uses isolated data.json,
#   crash-log.jsonl, chat-logs/ — does NOT collide with running app
# - Custom dev-server port (5174 etc) so the e2e renderer doesn't grab the
#   user's port 5173 if `npm run dev` is open
# - No PROJECTS path overrides — e2e fixtures use temp git repos under
#   /tmp/hive-e2e-projects, not ~/Development/psle-alex-web
```

If `e2e/` has no test for the change surface, **add one**. Untestable cases (OAuth flow, keychain, macOS GUI dialog) require `// UNTESTABLE: <reason>` comment + entry in `docs/manual-test-plan.md`.

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
- **Working tree has uncommitted changes** (the hive-david vanish incident — fixes only in WT disappear)
- **Any new exported symbol / IPC handler / React component / regex / state has 0 test references** (Gate 3b coverage)
- **State machine half-implemented** — useState setter without renderer (Gate 11, pendingQuestion regression)
- **Silent IPC error** — `window.api.chat.X(...)` called without await + error handling and without justifying comment (Gate 12, onFork regression)
- Version not bumped
- Hardcoded version string found (use `package.json` as SoT)
- CRLF line endings in any changed file
- `window.prompt()` / `window.alert()` in renderer code
- "manually verified" used as substitute for automated test

## Related files

`CLAUDE.md` · `package.json` · `.release-please-manifest.json` · `docs/design.md` · `src/preload/index.ts` · `src/main/chat.ts` · `src/main/index.ts` · `ui-preview-*.html`
