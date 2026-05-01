#!/usr/bin/env node
/* eslint-disable */
// One-shot: spawn `claude` in this cwd, send /context, dump rendered grid.
// Adapted from queryUsagePctViaPty pattern in src/main/chat.ts.
const pty = require('node-pty')
const { Terminal } = require('@xterm/headless')
const { randomUUID } = require('crypto')

const cwd = process.argv[2] || process.cwd()
const TIMEOUT_MS = 30000

const child = pty.spawn('claude', ['--session-id', randomUUID()], {
  name: 'xterm-256color',
  cols: 200, rows: 80,
  cwd,
  env: process.env
})

const term = new Terminal({ cols: 200, rows: 80, scrollback: 4000, allowProposedApi: true })
let sent = false
let promptSeenAt = 0
let scrapeTimer = null
let done = false

const dumpGrid = () => {
  const buf = term.buffer.active
  const lines = []
  for (let y = 0; y < buf.length; y++) {
    const line = buf.getLine(y)
    if (line) lines.push(line.translateToString(true))
  }
  return lines.join('\n')
}

const finish = (text) => {
  if (done) return
  done = true
  try { child.kill() } catch {}
  console.log('===== /context output (rendered grid) =====')
  console.log(text)
  console.log('===== end =====')
  process.exit(0)
}

child.onData((d) => {
  term.write(d, () => {
    if (!sent) {
      const head = dumpGrid().split('\n').slice(0, 20).join('\n')
      if (head.includes('❯') || /^\s*>\s/m.test(head)) {
        sent = true
        promptSeenAt = Date.now()
        setTimeout(() => { try { child.write('/context\r') } catch {} }, 500)
      }
      return
    }
    if (Date.now() - promptSeenAt < 1500) return
    if (scrapeTimer) clearTimeout(scrapeTimer)
    scrapeTimer = setTimeout(() => {
      const text = dumpGrid()
      // Heuristic: /context output usually contains "Context Usage" or
      // "tokens" / "Free space". Wait until we see one before dumping.
      if (/Context Usage|Free space|tokens \(\d/i.test(text)) {
        finish(text)
      }
    }, 800)
  })
})
child.onExit(() => finish(dumpGrid()))
setTimeout(() => finish(dumpGrid()), TIMEOUT_MS)
