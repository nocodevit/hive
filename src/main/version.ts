/**
 * Compare two semver-style strings. Returns >0 if a > b, <0 if a < b, 0 if equal.
 * Accepts "vX.Y.Z" or "X.Y.Z". Pre-release suffixes are stripped.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (s: string) => s.replace(/^v/, '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0)
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d
  }
  return 0
}

export const GITHUB_RELEASES_API = 'https://api.github.com/repos/nocodevit/hive/releases/latest'

/**
 * Where to ask for the latest release. Always GitHub, except that a
 * loopback URL in HIVE_RELEASES_API is honoured so the whole update flow
 * can be rehearsed against a local server. Nothing off this machine can
 * be substituted, and whatever is downloaded still has to pass the
 * signature / same-developer checks before it is installed.
 */
export function releasesApiUrl(override: string | undefined): string {
  return override && /^http:\/\/127\.0\.0\.1:\d+\//.test(override) ? override : GITHUB_RELEASES_API
}


/** The release list next to /releases/latest (GitHub or a loopback rehearsal server). */
export function releasesListUrl(latestUrl: string): string {
  return latestUrl.replace(/\/latest\/?$/, '') + '?per_page=100'
}

export interface ReleaseNote { tag_name: string; body?: string; published_at?: string; draft?: boolean; prerelease?: boolean }

/**
 * Everything the owner skipped: the notes of every release newer than the
 * version they run, up to and including `latest`, newest first, each under
 * its own heading. Someone jumping from 2.27 to 2.38 reads all of it, not
 * only what 2.38 itself added.
 */
export function cumulativeNotes(releases: ReleaseNote[], current: string, latest: string): string {
  const skipped = releases
    .filter(r => !r.draft && !r.prerelease && typeof r.tag_name === 'string')
    .filter(r => compareVersions(r.tag_name, current) > 0 && compareVersions(r.tag_name, latest) <= 0)
    .sort((a, b) => compareVersions(b.tag_name, a.tag_name))
  return skipped.map(r => {
    const v = r.tag_name.replace(/^v/, '')
    const date = r.published_at ? ` · ${r.published_at.slice(0, 10)}` : ''
    return `## ${v}${date}\n\n${(r.body || '').trim() || '_No notes._'}`
  }).join('\n\n')
}
