/**
 * The folder name Claude Code files a project's sessions under, inside
 * ~/.claude/projects: the working directory with every character that is
 * not a letter or digit turned into "-". Not just "/": an underscore, a
 * dot or a space in the path is replaced too, so deriving it with
 * `cwd.replace(/\//g, '-')` pointed at a folder that does not exist for
 * any such path (its sessions looked missing, so Resume started fresh).
 */
export function claudeProjectSlug(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}
