// Read only part of a big JSONL log: its first or last bytes, as whole lines.
// Chat logs and Claude session files run to 100MB+; reading them whole on
// every chat open is what froze Hive at start.

import { closeSync, fstatSync, openSync, readSync } from 'fs'

function slice(path: string, from: 'head' | 'tail', bytes: number): string[] {
  let fd = -1
  try {
    fd = openSync(path, 'r')
    const size = fstatSync(fd).size
    const n = Math.min(size, bytes)
    const buf = Buffer.alloc(n)
    readSync(fd, buf, 0, n, from === 'head' ? 0 : size - n)
    const lines = buf.toString('utf8').split('\n')
    // A cut line at the edge is dropped (the tail's first, the head's last) unless the whole file fit.
    if (n < size) { if (from === 'tail') lines.shift(); else lines.pop() }
    return lines.filter(Boolean)
  } catch {
    return []
  } finally {
    if (fd >= 0) try { closeSync(fd) } catch { /* closed */ }
  }
}

export const headLines = (path: string, bytes: number) => slice(path, 'head', bytes)
export const tailLines = (path: string, bytes: number) => slice(path, 'tail', bytes)

/**
 * The last `count` whole lines that end before byte `end` (the file end for the
 * newest), read backward in growing chunks; `start` is the byte the first of them
 * begins at — 0 when nothing older is left. "Load older" pages back from it.
 */
export function linesBefore(path: string, end: number, count: number): { lines: string[]; start: number } {
  let fd = -1
  try {
    fd = openSync(path, 'r')
    let chunk = 256 * 1024
    for (;;) {
      const from = Math.max(0, end - chunk)
      const buf = Buffer.alloc(end - from)
      readSync(fd, buf, 0, end - from, from)
      let text = buf.toString('utf8')
      let start = from
      if (from > 0) { const nl = text.indexOf('\n'); if (nl < 0) { chunk *= 2; continue } start = from + Buffer.byteLength(text.slice(0, nl + 1)); text = text.slice(nl + 1) }
      const lines = text.split('\n')
      const kept: Array<{ line: string; at: number }> = []
      let at = start
      for (const l of lines) { if (l) kept.push({ line: l, at }); at += Buffer.byteLength(l) + 1 }
      if (kept.length >= count || from === 0) {
        const last = kept.slice(-count)
        return { lines: last.map(k => k.line), start: last.length ? last[0].at : start }
      }
      chunk *= 2
    }
  } catch {
    return { lines: [], start: 0 }
  } finally {
    if (fd >= 0) try { closeSync(fd) } catch { /* closed */ }
  }
}
