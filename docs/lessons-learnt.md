# Lessons Learnt

Accumulated from incident postmortems and shipped fixes. New lessons go at the
top of their section. Each entry: **the rule**, then *why* (the concrete bug it
came from), then *how to apply* (mechanical check or test pattern).

---

## Version Bump

MUST ALWAYS bump `package.json` version before commit. NEVER hardcode. x+1 big
upgrade, y+1 feature, z+1 bugfix. Also update `.release-please-manifest.json`.

Two-file rule because release-please reads the manifest, electron-builder + the
running app read package.json. Forgetting one publishes a version mismatch.

---

## Testing

### Test the WIRING, not just the pure helper

**Rule:** when you extract a helper (`mergeUsage`, `cacheGet`, anything pure)
to make it testable, **the helper test does NOT count as coverage of the
wiring**. You also need a test that mounts the actual component / IPC handler
with a mocked seam (`window.api`, `spawn`) and exercises the bug path.

**Why:** v1.7.121's `5h/7d → —` regression had `mergeUsage` tested in
isolation, but the call site `setUsage(prev => mergeUsage(prev, u))` was
the actual surface that shipped. A test of the helper would have passed even
with the broken call site `setUsage(u as any)`. The bug was in the wiring,
not the helper.

**How:** for any pure-helper test under `__tests__/*.ts`, ensure there's
also a `*-wiring.test.tsx` (or `*-integration.test.tsx`) that mounts the
real consumer with a mocked dependency. See
`src/renderer/src/components/hive-chat/__tests__/usage-merge-wiring.test.tsx`
as the canonical pattern.

### Negative testing — revert the fix and watch tests fail

**Rule:** after writing a fix + its test, **revert just the fix line** and
re-run the test. The test MUST fail. Then restore the fix and re-run — it
MUST pass. If the test stays green with the bug back, your test is wrong.

**Why:** plenty of "tests" assert tautologies (`expect(x).toBe(x)`) or pass
trivially via mocks. The negative test is the only proof your test actually
exercises the regression path.

**How:** include this in the PR description: "Negative test verified —
reverted `<line ref>`, N tests failed; restored, all green." Caught the
v1.7.121 wiring fix and the v1.7.124 cache-null regression.

### E2E coverage for any chat lifecycle change

**Rule:** UI / IPC / chat-flow changes REQUIRE a Playwright e2e spec.
"vitest passes" does not mean "the chat works". Three regressions
(v1.7.103, v1.7.108, v1.7.115) shipped silently through this gap.

**Why:** chat surfaces span renderer state machines + IPC + main-process
subprocess management + claude CLI stdout parsing. Unit tests cover ~1 of
those 4 layers. Only an Electron-launched e2e exercises all of them.

**How:** e2e config MUST set `HEADLESS=1`, `workers: 1`, isolated
`HIVE_DATA_DIR` per spec, off-default `HIVE_PORT`. See
`e2e/chat-compact-resume.spec.ts` for the regression-catching shape:
real claude subprocess, assert the bar value survives the compact/close
state transition. Cost: ~3 cents per full chat lifecycle run.

### Untestable surfaces must be marked, not silently shipped

**Rule:** if a code path genuinely cannot be unit-tested (interactive PTY,
60s-wallclock subprocess, OAuth flow, keychain), the source MUST have
`// UNTESTABLE: <reason>` above it AND a `docs/manual-test-plan.md` entry
AND a Playwright e2e reaching the UI surface if any.

**Why:** "I'll add tests next PR" never happens. "Manually verified" alone
is grounds for revert.

**How:** see `src/main/__tests__/chat-usage-query.test.ts` for the
shim-based PATH-override pattern that DID make ENOENT / parse / JSON paths
testable. Only the 60s timeout-kill path was marked UNTESTABLE.

---

## Subprocess management

### Cache EVERY result, even null — that's the whole point of TTL

**Rule:** TTL caches over expensive subprocesses MUST store the result
whatever it is (including `null`). Skipping null storage creates a
thundering-herd: every caller after expiry re-spawns the slow subprocess.

**Why:** v1.7.121 had `if (pct) usageCache = result`. When the PTY scrape
failed (returned null), the cache was skipped, so the NEXT refresh
re-spawned the 12s ccusage call too. On a busy box this pegged CPU
continuously. Issue #7.

**How:** see `src/main/usage-cache.ts` — always assign, never gate on
truthiness. If you want different TTLs for success vs failure, encode that
explicitly with two TTLs, not via "don't cache failures".

### Subprocess timeouts must EXCEED slowest observed runtime

**Rule:** if you've seen the subprocess take 12s in real conditions, do
NOT set the timeout to 10s. 5x the slowest observed run is the minimum.
Killing JUST before completion is worse than waiting longer: you lose the
result, fail to cache, and re-spawn next call.

**Why:** ccusage took 12s on a 790MB jsonl history. Our 10s timeout
guaranteed we never got the result, retried forever, burned a CPU core.

**How:** bench the worst case on real data before picking a timeout
constant. See `CCUSAGE_TIMEOUT_MS = 60_000` in
`src/main/chat-usage-query.ts` and the explanatory comment.

### `detached: true` + process-group kill — `child.kill()` is not enough

**Rule:** when spawning shimmed binaries (`ccusage` = npm shim → node
worker), use `spawn(..., { detached: true })` and kill via
`process.kill(-child.pid, 'SIGTERM')` on timeout. `child.kill()` only
signals the shim and leaks the heavy worker.

**Why:** ccusage's npm shim spawned a child node process to do the actual
scanning. Killing the shim left the worker scanning, draining CPU after
we'd moved on.

**How:** template in `src/main/chat-usage-query.ts` `queryUsageViaCcusage`.
Try `process.kill(-pid, 'SIGTERM')` first, fall back to `child.kill()` if
the group send fails (group leader may already be gone).

### Single-flight dedup for shared resources

**Rule:** when N callers can simultaneously request the same expensive
result (subscription %% scrape, ccusage call, anything > 1s), the cache
must hold the in-flight Promise so concurrent callers await ONE
subprocess, not N.

**Why:** N agents triggering chat-startup refresh at the same time would
otherwise spawn N copies of ccusage. Multiplies the CPU burn problem.

**How:** see `UsageCache.inFlight` field in `src/main/usage-cache.ts`.
Set the field synchronously BEFORE awaiting, clear after resolution.

---

## Git / branching workflow

### Force-push rebased PRs with `--force-with-lease`, never `--force`

**Rule:** when updating a PR branch after rebase on upstream master, use
`git push --force-with-lease`. Bare `--force` will silently overwrite
collaborator pushes; the lease variant fails loud if someone else has
pushed.

**Why:** standard practice; matters more once collaborators exist. Costs
nothing to default to it.

### Verify "is X in master" by file content after squash merges

**Rule:** `git cherry master other-branch` uses patch-id matching, which
breaks across squash merges — it will list commits as "missing from
master" even when their content shipped via a squash. To verify, check the
actual files (`ls src/path/from-the-feature.ts`) or grep for an added
symbol.

**Why:** during cleanup we had 8 `hive/test-worker-*` branches whose
commits showed as "not in master" via `git cherry`, but the content was
ALL present in master because PR #4 squash-merged them. We deleted the
branches after verifying the new files (`.nvmrc`, `subagent-activity.ts`,
`compact-stuck-banner.test.tsx`) existed in master.

**How:**
```bash
git ls-tree -r master --name-only | grep -F "<key-file-from-branch>"
```

### `--amend` is dangerous — only on commits not yet a public dependency

**Rule:** never `git commit --amend` an already-pushed commit unless YOU
own the branch AND it's a PR branch you're about to force-push. Never amend
on master or shared feature branches. Pre-commit hook failures = NEW commit
after fix, NOT amend (amend would modify the previous commit, possibly
destroying earlier work).

**Why:** amend rewrites SHA, breaks fetch caches, can lose work if the
amend goes wrong and there's no reflog.

**How:** the safe pattern: edit → `git commit -m "fix prior"` (new commit),
let the squash-merge consolidate.

### Worktrees pin branch checkout — remove worktrees BEFORE `git branch -D`

**Rule:** can't delete a branch that's checked out in a worktree. Always
`git worktree remove <path> --force` first, then `git branch -D <name>`.

**Why:** during cleanup of `hive-test-worker-1/-2` we had to remove the
worktrees before the underlying `hive/test-worker-*-721676` /
`-*-724177` branch deletes could succeed.

### Squash merges hide intermediate version commits

**Rule:** if a PR has commits at v1.7.121 / v1.7.122 / v1.7.123 and the
maintainer squash-merges, master jumps directly to v1.7.123 — the two
intermediate versions never appear as standalone tags. Document this in
the CHANGELOG so future readers don't go looking for them.

**Why:** PR #10 collapsed v1.7.121–123 into one master commit. PR #4
collapsed v1.7.114–120 into one. Both look like "missing versions" to
someone scanning `git tag`.

**How:** CHANGELOG entry should read `## [1.7.123] — date  (PR #N squash
of v1.7.121–123)` so the version range is explicit.

---

## Hive-specific gotchas

### Node version mismatch silently breaks vitest + electron-vite

**Rule:** if you see `TypeError: crypto$2.getRandomValues is not a
function`, your shell is on Node 16 (or older). The repo pins Node 22 via
`.nvmrc` for Vite 6 / vitest 4 compat (`crypto.hash` API,
std-env ESM/CJS resolution). Node 20 also works in practice.

**Why:** each fresh shell does NOT auto-source nvm or honor `.nvmrc`. The
default node on a machine without nvm-autoload may be much older than the
repo requires.

**How:** prefix any vitest / electron-vite invocation with:
```bash
source ~/.nvm/nvm.sh > /dev/null && nvm use 20 > /dev/null && <cmd>
```

### `.claude/` is local-only — back it up before any machine switch

**Rule:** `~/.claude/CLAUDE.md` + `~/.claude/projects/<slug>/memory/*.md`
are NOT in any git repo, NOT in iCloud by default. They vanish with the
machine. Back up explicitly before any laptop switch.

**Why:** they hold the project's institutional knowledge — user
preferences, feedback patterns, identity facts that took multiple sessions
to learn. Losing them resets Claude to a stranger.

**How:**
```bash
tar czf ~/Desktop/claude-config-backup-$(date +%Y%m%d).tar.gz \
  -C ~ .claude/CLAUDE.md .claude/projects/<your-slug>/memory
```
Transfer the tarball → on new machine `tar xzf ... -C ~`.

### `hive/test-worker-*` branches accumulate — prune periodically

**Rule:** Hive's own dispatcher creates `hive/test-worker-*-<id>`
branches per agent session. They accumulate as orphans even after the
relevant work merges. Prune monthly OR before any cleanup pass.

**Why:** found 8 of them during one cleanup, all duplicates of work
already in master via PR #4 squash. Just clutter.

**How:**
```bash
git branch | grep 'hive/test-worker-' | while read b; do
  # verify content already in master before deleting
  git ls-tree -r master --name-only | grep -q "<symbol-from-branch>" \
    && git branch -D "$b"
done
```

### E2E + npm install MUST run under Node 20+ in a clean shell

**Rule:** `npm install` and `playwright test` both inherit the shell's
Node. If the shell is on default (often v16), npm reports cryptic errors
or installs corrupted node_modules.

**Why:** every Bash tool call starts a fresh shell. Once-per-session
`nvm use` does not persist.

**How:** wrap every long-running install/test command with the nvm prefix
above. Document in CONTRIBUTING.md if you have one.

---

## Working with Claude Code itself

### Don't ask 4-option questions when a sensible default exists

**Rule:** if there's a clearly-correct default action, JUST DO IT. Do not
fire an `AskUserQuestion` 4-option prompt that has no "cancel" or
"none-of-the-above" escape. The question UI traps the user.

**Why:** the question component genuinely lacks a clean escape hatch —
"Other" is mediocre, Esc doesn't reliably dismiss. Forcing a choice
between bad options is worse than guessing.

**How:** for irreducible questions, use plain text in the chat ("Should I
A or B? Reply A/B"). Reserve `AskUserQuestion` for destructive actions
needing explicit target selection (e.g. "delete which of these N records"),
and even then every option must be genuinely executable.

### "Manually verified" is not a fix

**Rule:** every fix MUST include an automated test that fails before the
fix and passes after. "I tried it in the UI and it works" alone is grounds
for revert.

**Why:** UI verification is unreproducible, doesn't run in CI, and rots
the moment the surrounding code changes. v1.7.103, .108, .115 each had
"manually verified" fixes that re-regressed within 2 weeks.

**How:** see `.claude/skills/pr-review/SKILL.md` Gate 3b — refuses-to-PR
if `git diff` adds lines without corresponding `__tests__` lines.

### Don't conflate similar-named functions

**Rule:** when debugging, verify which function actually feeds the UI you
care about. Multiple functions can have similar names (`readContextPctFromJsonl`
vs `queryUsagePctViaPty`) but feed different bars.

**Why:** in the v1.7.121 investigation, the user (correctly) thought
"5h/7d %% is read from jsonl" — but that was the *ctx %* code path
(`readContextPctFromJsonl`), not the 5h/7d subscription path
(`queryUsagePctViaPty`). Conflating them led to chasing the wrong fix.

**How:** trace UI → state field → setter → IPC channel → broadcaster →
producer. Don't infer from function names — read the data flow end to end.
