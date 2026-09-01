import { describe, it, expect, afterEach } from 'vitest'
import {
  CLAUDE_INSTALL_COMMAND,
  CLAUDE_BIN_ENV,
  claudeStatus,
  claudeBin,
  pickPathLine,
  pickClaudeBinPath,
  pathHydrationStrategies,
  claudeBinStrategies,
  claudeProbeStrategies,
  knownClaudeBinPaths,
  nvmClaudeCandidates,
  claudeBinCandidates,
  hostEnvVarsToStrip,
  sanitizedClaudeEnv,
  HOST_MANAGED_AUTH_ENV_VARS,
  EMPTY_ONLY_AUTH_ENV_VARS
} from '../claude-env'

describe('CLAUDE_INSTALL_COMMAND', () => {
  it('is the official native installer', () => {
    expect(CLAUDE_INSTALL_COMMAND).toBe('curl -fsSL https://claude.ai/install.sh | bash')
  })

  // Guard the core lesson: claude and node are separate concerns. The install
  // path must never reach for npm/node — that couples Hive to a toolchain it
  // has no business caring about.
  it('does not depend on node or npm', () => {
    expect(CLAUDE_INSTALL_COMMAND).not.toMatch(/npm/)
    expect(CLAUDE_INSTALL_COMMAND).not.toMatch(/\bnode\b/)
  })
})

describe('claudeStatus', () => {
  it('reports installed when claude can run', () => {
    const s = claudeStatus(true)
    expect(s.installed).toBe(true)
    expect(s.installCommand).toBe(CLAUDE_INSTALL_COMMAND)
  })

  it('reports not installed when claude cannot run, still surfacing the command', () => {
    const s = claudeStatus(false)
    expect(s.installed).toBe(false)
    expect(s.installCommand).toBe(CLAUDE_INSTALL_COMMAND)
  })
})

describe('pickPathLine', () => {
  it('returns an absolute colon-separated PATH', () => {
    expect(pickPathLine('/usr/local/bin:/usr/bin:/bin')).toBe('/usr/local/bin:/usr/bin:/bin')
  })

  it('takes the LAST PATH-shaped line, ignoring leading interactive-shell noise', () => {
    // An interactive shell may print banners/rc output before `printenv PATH`.
    const out = 'Welcome banner\nsome rc echo\n/Users/me/.nvm/versions/node/v22/bin:/usr/bin:/bin'
    expect(pickPathLine(out)).toBe('/Users/me/.nvm/versions/node/v22/bin:/usr/bin:/bin')
  })

  it('returns null for empty or non-PATH output', () => {
    expect(pickPathLine('')).toBeNull()
    expect(pickPathLine('   \n  ')).toBeNull()
    expect(pickPathLine('command not found')).toBeNull()
    // A single dir with no colon is not a usable multi-entry PATH.
    expect(pickPathLine('/usr/bin')).toBeNull()
  })
})

describe('pathHydrationStrategies', () => {
  it('tries an INTERACTIVE login shell first so nvm rc-guards still run', () => {
    const [first] = pathHydrationStrategies('/bin/zsh')
    expect(first.file).toBe('/bin/zsh')
    // -lic = login + interactive + command — interactive is what defeats the
    // `[[ -o interactive ]] || return` guard that hides nvm's node bin.
    expect(first.args[0]).toBe('-lic')
    expect(first.args).toContain('printenv PATH')
  })

  it('provides ordered fallbacks (login, then explicit rc sourcing)', () => {
    const strat = pathHydrationStrategies('/bin/zsh')
    expect(strat.map((s) => s.args[0])).toEqual(['-lic', '-lc', '-c'])
    // The last resort explicitly sources rc files.
    expect(strat[2].args[1]).toMatch(/\.zshrc/)
  })

  it('honors the caller-provided shell', () => {
    expect(pathHydrationStrategies('/bin/bash').every((s) => s.file === '/bin/bash')).toBe(true)
  })
})

describe('claudeProbeStrategies', () => {
  it('probes the bare PATH first (fast path once hydrated)', () => {
    const [first] = claudeProbeStrategies('/bin/zsh')
    expect(first.file).toBe('claude')
    expect(first.args).toEqual(['--version'])
  })

  it('falls back to an interactive login shell to avoid a false not-found', () => {
    const [, second] = claudeProbeStrategies('/bin/zsh')
    expect(second.file).toBe('/bin/zsh')
    expect(second.args[0]).toBe('-lic')
    expect(second.args).toContain('claude --version')
  })
})

describe('claudeBin', () => {
  afterEach(() => {
    delete process.env[CLAUDE_BIN_ENV]
  })

  it('falls back to the bare name when no absolute path was resolved', () => {
    delete process.env[CLAUDE_BIN_ENV]
    expect(claudeBin()).toBe('claude')
  })

  it('uses the absolute path resolved at boot when present', () => {
    process.env[CLAUDE_BIN_ENV] = '/Users/me/.nvm/versions/node/v22/bin/claude'
    expect(claudeBin()).toBe('/Users/me/.nvm/versions/node/v22/bin/claude')
  })

  it('ignores a blank env value (never spawns an empty string)', () => {
    process.env[CLAUDE_BIN_ENV] = '   '
    expect(claudeBin()).toBe('claude')
  })
})

describe('claudeBinStrategies', () => {
  it('asks an interactive login shell for the absolute path first', () => {
    const [first] = claudeBinStrategies('/bin/zsh')
    expect(first.file).toBe('/bin/zsh')
    expect(first.args[0]).toBe('-lic')
    expect(first.args).toContain('command -v claude')
  })

  it('falls back to a non-interactive login shell', () => {
    const [, second] = claudeBinStrategies('/bin/zsh')
    expect(second.args[0]).toBe('-lc')
  })
})

describe('pickClaudeBinPath', () => {
  it('extracts a plain absolute claude path', () => {
    expect(pickClaudeBinPath('/Users/me/.nvm/versions/node/v22/bin/claude')).toBe(
      '/Users/me/.nvm/versions/node/v22/bin/claude'
    )
  })

  it('accepts the npm-shipped claude.exe binary name', () => {
    expect(pickClaudeBinPath('/Users/me/.local/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe')).toBe(
      '/Users/me/.local/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe'
    )
  })

  it('takes the LAST claude path when rc noise precedes it (the real bug)', () => {
    // Reproduces the exact failure: a broken ~/.zshrc ran `nvm bash completion`,
    // dumping nvm's help text to stdout BEFORE `command -v claude`'s answer.
    // Scanning last-first must still recover the real binary path.
    const polluted = [
      'Node Version Manager (v0.39.0)',
      '  nvm which [current | <version>]   Display path to installed node version.',
      '  nvm cache dir                     Display path to the cache directory for nvm',
      '/Users/me/.nvm/versions/node/v16.20.2/bin/claude'
    ].join('\n')
    expect(pickClaudeBinPath(polluted)).toBe('/Users/me/.nvm/versions/node/v16.20.2/bin/claude')
  })

  it('returns null when claude is genuinely absent', () => {
    expect(pickClaudeBinPath('')).toBeNull()
    expect(pickClaudeBinPath('claude not found')).toBeNull()
    // A directory that merely CONTAINS "claude" mid-path is not an executable.
    expect(pickClaudeBinPath('/opt/claude-tools/bin/other')).toBeNull()
    // Relative paths are not trustworthy to spawn.
    expect(pickClaudeBinPath('./claude')).toBeNull()
  })
})

describe('knownClaudeBinPaths', () => {
  it('lists the native-installer target (~/.local/bin) FIRST', () => {
    // The install.sh binary is node-independent and always lands here, so it is
    // the most reliable hit and must be probed before homebrew/system paths.
    const [first] = knownClaudeBinPaths('/Users/me')
    expect(first).toBe('/Users/me/.local/bin/claude')
  })

  it('covers homebrew (arm + intel) and system bins, all absolute', () => {
    const paths = knownClaudeBinPaths('/Users/me')
    expect(paths).toEqual([
      '/Users/me/.local/bin/claude',
      '/opt/homebrew/bin/claude',
      '/usr/local/bin/claude',
      '/usr/bin/claude'
    ])
    expect(paths.every((p) => p.startsWith('/') && p.endsWith('/claude'))).toBe(true)
  })
})

describe('nvmClaudeCandidates', () => {
  it('orders nvm node bins NEWEST-first so a stale claude never shadows a current one', () => {
    const dirs = ['v16.20.2', 'v22.9.0', 'v20.11.1']
    expect(nvmClaudeCandidates('/Users/me', dirs)).toEqual([
      '/Users/me/.nvm/versions/node/v22.9.0/bin/claude',
      '/Users/me/.nvm/versions/node/v20.11.1/bin/claude',
      '/Users/me/.nvm/versions/node/v16.20.2/bin/claude'
    ])
  })

  it('sorts by minor and patch, not just major', () => {
    const dirs = ['v20.9.0', 'v20.11.1', 'v20.11.0']
    expect(nvmClaudeCandidates('/Users/me', dirs)).toEqual([
      '/Users/me/.nvm/versions/node/v20.11.1/bin/claude',
      '/Users/me/.nvm/versions/node/v20.11.0/bin/claude',
      '/Users/me/.nvm/versions/node/v20.9.0/bin/claude'
    ])
  })

  it('pushes unparseable version names last rather than crashing', () => {
    const dirs = ['garbage', 'v18.0.0']
    expect(nvmClaudeCandidates('/Users/me', dirs)).toEqual([
      '/Users/me/.nvm/versions/node/v18.0.0/bin/claude',
      '/Users/me/.nvm/versions/node/garbage/bin/claude'
    ])
  })

  it('returns an empty list when no node versions exist', () => {
    expect(nvmClaudeCandidates('/Users/me', [])).toEqual([])
  })
})

describe('claudeBinCandidates', () => {
  it('probes fixed install locations BEFORE nvm per-version bins', () => {
    const all = claudeBinCandidates('/Users/me', ['v20.0.0'])
    expect(all).toEqual([
      ...knownClaudeBinPaths('/Users/me'),
      '/Users/me/.nvm/versions/node/v20.0.0/bin/claude'
    ])
  })
})

describe('host-session env scrubbing (the infinite sign-in loop)', () => {
  // The exact environment observed on the failing machine: Hive.app launched
  // from Claude Desktop, so the host's own session vars were inherited and
  // handed to every spawned `claude` child.
  const poisonedEnv = (): Record<string, string | undefined> => ({
    HOME: '/Users/me',
    USER: 'me',
    PATH: '/usr/bin:/bin',
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
    CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
    CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH: '1',
    CLAUDE_CODE_ENTRYPOINT: 'claude-desktop',
    CLAUDE_CODE_SESSION_ID: 'ddc83e9f-64ea-4f21-9695-efcdd6dcb8ab',
    USE_LOCAL_OAUTH: '',
    USE_STAGING_OAUTH: '',
    CLAUDECODE: '1'
  })

  it('strips CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST — the single proven cause', () => {
    // Isolated experiment on the real CLI: baseline `claude auth status` reports
    // loggedIn:true; adding ONLY this var flips it to loggedIn:false, which is
    // what surfaced as "Not logged in · Please run /login" on every turn.
    expect(hostEnvVarsToStrip({ CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1' }))
      .toEqual(['CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST'])
    expect(sanitizedClaudeEnv({ CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1' }))
      .not.toHaveProperty('CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST')
  })

  it('strips it even when set to something other than "1" (presence is the trigger)', () => {
    expect(hostEnvVarsToStrip({ CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '' }))
      .toEqual(['CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST'])
    expect(hostEnvVarsToStrip({ CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '0' }))
      .toEqual(['CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST'])
  })

  it('removes every host var from the real poisoned environment', () => {
    const clean = sanitizedClaudeEnv(poisonedEnv())
    for (const k of HOST_MANAGED_AUTH_ENV_VARS) expect(clean).not.toHaveProperty(k)
    expect(clean.ANTHROPIC_API_KEY).toBeUndefined()
  })

  it('keeps the vars a claude child legitimately needs', () => {
    const clean = sanitizedClaudeEnv(poisonedEnv())
    // USER in particular: the Keychain credential is stored under the account
    // name, so dropping it would reintroduce a "not logged in" of our own.
    expect(clean.USER).toBe('me')
    expect(clean.HOME).toBe('/Users/me')
    expect(clean.PATH).toBe('/usr/bin:/bin')
    expect(clean.ANTHROPIC_BASE_URL).toBe('https://api.anthropic.com')
  })

  it('drops ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN only when empty', () => {
    for (const k of EMPTY_ONLY_AUTH_ENV_VARS) {
      expect(hostEnvVarsToStrip({ [k]: '' })).toEqual([k])
      expect(hostEnvVarsToStrip({ [k]: '   ' })).toEqual([k])
      // A user deliberately running Hive on their own API key must keep working.
      expect(hostEnvVarsToStrip({ [k]: 'sk-ant-real-key' })).toEqual([])
      expect(sanitizedClaudeEnv({ [k]: 'sk-ant-real-key' })[k]).toBe('sk-ant-real-key')
    }
  })

  it('reports nothing for a clean environment (normal Finder/Dock launch)', () => {
    expect(hostEnvVarsToStrip({ HOME: '/Users/me', USER: 'me', PATH: '/usr/bin' })).toEqual([])
  })

  it('reports only vars actually present, so the boot log is meaningful', () => {
    expect(hostEnvVarsToStrip({ CLAUDECODE: '1', USER: 'me' })).toEqual(['CLAUDECODE'])
  })

  it('never mutates the caller-supplied env', () => {
    const env = poisonedEnv()
    sanitizedClaudeEnv(env)
    expect(env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST).toBe('1')
  })
})
