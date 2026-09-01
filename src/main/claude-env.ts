// Claude Code CLI presence — the ONE environment fact Hive depends on.
//
// Hive manages claude agents, so it needs the `claude` binary on a PATH the
// (Finder/Dock-launched) GUI process can see. That PATH problem is already
// solved by hydratePathFromShell in index.ts. The only remaining gap is the
// honest one: claude simply isn't installed. This module owns that single
// check and the official install command — nothing else.
//
// Deliberately NOT in scope: node/nvm/npm (claude is an opaque executable —
// its runtime is none of Hive's business), git, or version policing.

// Official native installer. Requires no node/npm toolchain and drops the
// binary at ~/.local/bin/claude. Source: https://code.claude.com/docs/en/setup.md
export const CLAUDE_INSTALL_COMMAND = 'curl -fsSL https://claude.ai/install.sh | bash'

export interface ClaudeStatus {
  installed: boolean
  installCommand: string
}

/** Pure: wrap a "can we run claude?" boolean into the renderer's status shape. */
export function claudeStatus(canRun: boolean): ClaudeStatus {
  return { installed: canRun, installCommand: CLAUDE_INSTALL_COMMAND }
}

/** A shell invocation: an executable plus its argv. */
export interface ShellCmd {
  file: string
  args: string[]
}

/**
 * Pick a usable PATH out of shell stdout. Takes the LAST non-empty line that
 * looks like a PATH (absolute + colon-separated), so leading noise an
 * interactive shell may print (banners, `printf` from rc) is ignored.
 * Returns null when nothing PATH-shaped is present.
 */
export function pickPathLine(shellOutput: string): string | null {
  const line = shellOutput
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .pop()
  if (!line) return null
  return line.startsWith('/') && line.includes(':') ? line : null
}

/**
 * Ordered strategies to recover a GUI-launched app's real PATH. A Finder/Dock
 * launch inherits only a minimal PATH (/usr/bin:/bin); the user's real PATH
 * (nvm node bin, ~/.local/bin, homebrew) lives behind their shell rc.
 *
 * Crucially, many ~/.zshrc start with an interactive guard
 * (`[[ -o interactive ]] || return`), so sourcing rc from a plain `-c` shell
 * bails before nvm runs — PATH never gains the node bin that holds `claude`.
 * So we try an INTERACTIVE login shell (-lic) first; that runs the full rc and
 * exposes nvm. Fallbacks degrade to login (-lc) and explicit rc sourcing.
 */
export function pathHydrationStrategies(shell: string): ShellCmd[] {
  return [
    { file: shell, args: ['-lic', 'printenv PATH'] },
    { file: shell, args: ['-lc', 'printenv PATH'] },
    {
      file: shell,
      args: [
        '-c',
        '[ -f ~/.zshrc ] && . ~/.zshrc >/dev/null 2>&1; [ -f ~/.bash_profile ] && . ~/.bash_profile >/dev/null 2>&1; printenv PATH'
      ]
    }
  ]
}

/**
 * Ordered strategies to decide "is claude runnable?". Try the fast bare-PATH
 * spawn first (correct once PATH is hydrated); fall back to an interactive
 * login shell so a stale/failed hydration can't produce a FALSE "not found"
 * that wrongly blocks the app behind the install gate.
 */
export function claudeProbeStrategies(shell: string): ShellCmd[] {
  return [
    { file: 'claude', args: ['--version'] },
    { file: shell, args: ['-lic', 'claude --version'] }
  ]
}

// Env var Hive uses to carry the ABSOLUTE path to the claude binary, resolved
// once at boot (resolveClaudeBinPath in index.ts) and inherited by every
// child. This is the durable fix for the "gate says installed but every chat
// spawn ENOENTs" divergence: the install gate had an interactive-login-shell
// fallback, but chat.ts spawned the bare name `claude` against the boot PATH
// with no fallback — so when boot PATH hydration failed, the app looked
// healthy yet no session could spawn. Resolving an absolute path decouples
// spawning from the fragile PATH-scrape entirely.
export const CLAUDE_BIN_ENV = 'HIVE_CLAUDE_BIN'

/**
 * The claude executable Hive should spawn. Prefer the absolute path resolved
 * at boot; fall back to the bare name so behavior is unchanged when resolution
 * hasn't run (tests, or a future caller before boot wiring). Pure w.r.t.
 * process.env so it stays trivially testable.
 */
export function claudeBin(): string {
  const p = process.env[CLAUDE_BIN_ENV]
  return p && p.trim() ? p : 'claude'
}

/**
 * Ordered strategies to resolve claude's ABSOLUTE path. An interactive login
 * shell (-lic) sources the user's rc (nvm/pyenv/~/.local/bin), so
 * `command -v claude` prints the real path even when the GUI process's own
 * PATH is the launchd-minimal set. `-lc` is a weaker fallback.
 */
export function claudeBinStrategies(shell: string): ShellCmd[] {
  return [
    { file: shell, args: ['-lic', 'command -v claude'] },
    { file: shell, args: ['-lc', 'command -v claude'] }
  ]
}

/**
 * Extract an absolute claude path from shell stdout. Scans from the LAST line
 * backward for an absolute path to a file named `claude` (or `claude.exe` —
 * the official npm package ships the compiled binary under that name on all
 * platforms). Scanning last-first defends against rc noise printed BEFORE the
 * answer (oh-my-zsh banners, a mis-sourced `nvm` dumping its help text, etc.),
 * the same hazard pickPathLine guards against. Returns null when no such line
 * is present (claude genuinely not installed).
 */
export function pickClaudeBinPath(shellOutput: string): string | null {
  const lines = shellOutput
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]
    if (l.startsWith('/') && /(?:^|\/)claude(?:\.exe)?$/.test(l)) return l
  }
  return null
}

/**
 * Well-known ABSOLUTE locations a `claude` binary installs to, in priority
 * order. Probing these on disk directly is the robust fix for the GUI-launch
 * PATH problem: a Finder/Dock-launched app inherits only launchd's minimal PATH
 * and can't see nvm/homebrew/~/.local/bin, so the shell scrape (command -v in a
 * login shell) used to be the ONLY resolver — and it silently returned null
 * whenever the interactive shell timed out or its rc didn't load nvm. The
 * native installer (claude.ai/install.sh) always drops the binary at the fixed,
 * node-independent ~/.local/bin/claude, so a plain existsSync beats scraping a
 * shell. `home` is injected so the function stays pure/testable.
 */
export function knownClaudeBinPaths(home: string): string[] {
  return [
    `${home}/.local/bin/claude`,
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    '/usr/bin/claude'
  ]
}

/**
 * Candidate claude paths inside nvm's per-version node bins, NEWEST version
 * first. nvm installs to ~/.nvm/versions/node/<vX.Y.Z>/bin/claude, so the exact
 * path depends on which node versions exist — the caller passes the directory
 * listing (readdirSync of ~/.nvm/versions/node) and we turn it into ordered
 * candidates. Newest-first so a stale old-node claude never shadows a current
 * one; unparseable names sort last. Pure w.r.t. the filesystem.
 */
export function nvmClaudeCandidates(home: string, versionDirs: readonly string[]): string[] {
  const parse = (v: string): [number, number, number] => {
    const m = v.match(/^v?(\d+)\.(\d+)\.(\d+)/)
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [-1, -1, -1]
  }
  return [...versionDirs]
    .sort((a, b) => {
      const pa = parse(a)
      const pb = parse(b)
      for (let i = 0; i < 3; i++) if (pb[i] !== pa[i]) return pb[i] - pa[i]
      return 0
    })
    .map((v) => `${home}/.nvm/versions/node/${v}/bin/claude`)
}

/**
 * The full ordered list of absolute claude paths to probe on disk BEFORE
 * falling back to the shell scrape. Fixed install locations first (fast,
 * deterministic), then nvm's per-version bins newest-first. Caller checks each
 * for existence + executability and takes the first hit.
 */
export function claudeBinCandidates(home: string, nvmVersionDirs: readonly string[]): string[] {
  return [...knownClaudeBinPaths(home), ...nvmClaudeCandidates(home, nvmVersionDirs)]
}

// ---------------------------------------------------------------------------
// Host-session env poisoning — THE infinite-login-loop bug.
//
// When Hive.app is launched FROM another Claude surface (Claude Desktop, a
// Claude Code terminal session, `open -a Hive` typed at an agent prompt) it
// inherits that host's environment. Hive then hands `process.env` verbatim to
// every `claude` child it spawns (chat.ts, the PTY, the gate probe, auth
// login). One inherited variable is fatal:
//
//     CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST=1
//
// It tells the CLI "your credentials are supplied by the host process — do NOT
// use your own Keychain OAuth credential." Hive is not that host and supplies
// nothing, so the child finds no credential and emits
// `Not logged in · Please run /login` with `error:"authentication_failed"` and
// `duration_api_ms: 0` — it never even calls the API.
//
// That produces an UNBREAKABLE loop: Hive classifies the failure as
// auth_expired → pops the sign-in modal → the user signs in → the Keychain
// credential really is renewed → the next spawn still ignores it → "auth
// failed" again, forever. Reproduced by single-variable isolation against one
// binary and one Keychain: baseline `claude auth status` → loggedIn:true; with
// only CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST=1 added → loggedIn:false.
//
// The other names below are the rest of the host session's identity leaking
// downward: staging/local OAuth endpoint switches, the host's OAuth-refresh
// contract, and per-session handles (messaging socket + token, session ids,
// the host's own claude execpath/pid) that make a fresh child believe it is a
// nested continuation of someone else's session. None of them are ever correct
// for a child Hive spawns on its own behalf, so all are dropped.
export const HOST_MANAGED_AUTH_ENV_VARS = [
  // Auth / provider control — the loop's actual cause.
  'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST',
  'CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH',
  'USE_LOCAL_OAUTH',
  'USE_STAGING_OAUTH',
  // Host session identity / IPC handles.
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_BRIDGE_SESSION_ID',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_PID',
  'CLAUDECODE'
] as const

// Credential env vars we only drop when they are EMPTY. An empty
// `ANTHROPIC_API_KEY=` is what a host injects when it manages the provider
// itself; it is never a deliberate user choice and can only confuse the CLI's
// "which credential do I use" decision. A NON-empty value is left completely
// alone — a user pointing Hive at their own API key is legitimate and must
// keep working.
export const EMPTY_ONLY_AUTH_ENV_VARS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] as const

/**
 * The env var names that must be removed from `env` before spawning a `claude`
 * child. Pure: returns names only, in a stable order, and reports a name ONLY
 * when it is actually present (so callers can log a meaningful "we stripped
 * these" line instead of a constant). Unset vars and non-empty credential vars
 * are never reported.
 */
export function hostEnvVarsToStrip(env: Record<string, string | undefined>): string[] {
  const out: string[] = []
  for (const k of HOST_MANAGED_AUTH_ENV_VARS) if (k in env) out.push(k)
  for (const k of EMPTY_ONLY_AUTH_ENV_VARS) {
    const v = env[k]
    if (k in env && (v === undefined || v.trim() === '')) out.push(k)
  }
  return out
}

/**
 * A COPY of `env` with every poisoning host variable removed. Pure — the input
 * object is never mutated — so it is safe to use both at boot (to clean
 * process.env once, covering every existing spawn site) and per-spawn.
 */
export function sanitizedClaudeEnv(
  env: Record<string, string | undefined>
): Record<string, string | undefined> {
  const copy = { ...env }
  for (const k of hostEnvVarsToStrip(env)) delete copy[k]
  return copy
}
