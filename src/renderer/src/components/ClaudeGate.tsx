import { useState } from 'react'

// The ONE environment gate Hive shows: if the `claude` CLI can't be run, Hive
// can't manage agents, so we block with a single honest screen. The user picks:
// install it themselves (copy the official command) or let Hive run it. No
// node/npm/version policing — claude is an opaque executable and that's all we
// check. Status is resolved by the parent; this component only renders the gap.
export default function ClaudeGate({
  installCommand,
  onReady
}: {
  installCommand: string
  onReady: () => void
}) {
  const [installing, setInstalling] = useState(false)
  const [output, setOutput] = useState('')
  const [failed, setFailed] = useState(false)
  const [copied, setCopied] = useState(false)

  const copy = () => {
    navigator.clipboard.writeText(installCommand)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const install = async () => {
    setInstalling(true)
    setFailed(false)
    setOutput('')
    const off = window.api.claude.onInstallOutput(({ text }) =>
      setOutput((prev) => (prev + text).slice(-4000))
    )
    const { ok } = await window.api.claude.install()
    off()
    setInstalling(false)
    if (ok) onReady()
    else setFailed(true)
  }

  return (
    <div className="flex h-screen items-center justify-center bg-bg-primary text-text-primary">
      <div className="w-[460px] bg-bg-secondary border border-border rounded-xl shadow-2xl p-6">
        <h1 className="text-lg font-heading font-semibold mb-1">Claude Code CLI not found</h1>
        <p className="text-sm text-text-muted mb-4">
          Hive runs Claude Code agents, so it needs the <code>claude</code> command available.
          Install it, then continue.
        </p>

        <div className="flex items-center gap-2 mb-4">
          <code className="flex-1 bg-bg-primary border border-border rounded-lg px-3 py-2 text-xs text-text-primary overflow-x-auto whitespace-nowrap">
            {installCommand}
          </code>
          <button
            onClick={copy}
            className="px-3 py-2 rounded-lg text-xs font-medium bg-bg-hover text-text-muted cursor-pointer hover:text-text-primary flex-shrink-0"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        {output && (
          <pre className="bg-bg-primary border border-border rounded-lg p-3 text-[11px] text-text-muted h-40 overflow-auto whitespace-pre-wrap mb-4">
            {output}
          </pre>
        )}

        {failed && (
          <p className="text-xs text-text-muted mb-3">
            Install finished but <code>claude</code> still isn&apos;t runnable. Try the command in a
            terminal, then click Continue.
          </p>
        )}

        <div className="flex gap-2">
          <button
            onClick={install}
            disabled={installing}
            className="flex-1 px-3 py-2 rounded-lg text-sm font-medium bg-accent text-text-on-purple cursor-pointer hover:opacity-90 disabled:opacity-60 disabled:cursor-default"
          >
            {installing ? 'Installing…' : 'Install for me'}
          </button>
          <button
            onClick={onReady}
            className="px-3 py-2 rounded-lg text-sm font-medium bg-bg-hover text-text-muted cursor-pointer hover:text-text-primary"
          >
            Continue anyway
          </button>
        </div>
      </div>
    </div>
  )
}
