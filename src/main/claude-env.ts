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
