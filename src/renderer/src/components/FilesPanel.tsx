import { useState, useEffect } from 'react'
import type { Project, Zone } from '../types'

interface Props {
  project: Project
  agentCwd: string
  width: number
}

interface FileEntry {
  path: string
  mtime: number
  size: number
}

function formatTime(ms: number): string {
  const d = new Date(ms)
  const now = Date.now()
  const diff = now - ms
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)}K`
  return `${(bytes / 1048576).toFixed(1)}M`
}

function fileIcon(path: string): { letter: string; color: string } {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  const icons: Record<string, { letter: string; color: string }> = {
    ts: { letter: 'T', color: '#3178c6' }, tsx: { letter: 'T', color: '#3178c6' },
    js: { letter: 'J', color: '#f7df1e' }, jsx: { letter: 'J', color: '#f7df1e' },
    css: { letter: '🎨', color: '' }, scss: { letter: '🎨', color: '' }, less: { letter: '🎨', color: '' },
    md: { letter: '📝', color: '' }, txt: { letter: '📄', color: '' },
    json: { letter: '🔧', color: '' }, yaml: { letter: '🔧', color: '' }, yml: { letter: '🔧', color: '' }, toml: { letter: '🔧', color: '' }, ini: { letter: '🔧', color: '' }, conf: { letter: '🔧', color: '' },
    png: { letter: '🖼', color: '' }, jpg: { letter: '🖼', color: '' }, gif: { letter: '🖼', color: '' }, webp: { letter: '🖼', color: '' }, ico: { letter: '🖼', color: '' },
    svg: { letter: 'S', color: '#ffb13b' },
    html: { letter: '🌐', color: '' }, vue: { letter: 'V', color: '#42b883' }, svelte: { letter: 'S', color: '#ff3e00' },
    py: { letter: '🐍', color: '' }, rs: { letter: '🦀', color: '' }, go: { letter: '🐹', color: '' }, rb: { letter: '💎', color: '' },
    sh: { letter: '⚙️', color: '' }, bash: { letter: '⚙️', color: '' }, zsh: { letter: '⚙️', color: '' },
    lock: { letter: '🔒', color: '' }, env: { letter: '🔑', color: '' },
    mp3: { letter: '🎵', color: '' }, wav: { letter: '🎵', color: '' }, mp4: { letter: '🎬', color: '' },
    pdf: { letter: '📕', color: '' }, doc: { letter: '📘', color: '' }, docx: { letter: '📘', color: '' },
    zip: { letter: '🗜', color: '' }, tar: { letter: '🗜', color: '' }, gz: { letter: '🗜', color: '' }, rar: { letter: '🗜', color: '' }, '7z': { letter: '🗜', color: '' },
  }
  return icons[ext] || { letter: '📄', color: '' }
}

export default function FilesPanel({ project, agentCwd, width }: Props) {
  const [files, setFiles] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!agentCwd) return
    console.log('[FilesPanel] scanning:', agentCwd)
    setLoading(true)
    window.api.fs.scanFiles(agentCwd, 200).then((f) => {
      setFiles(f)
      setLoading(false)
    })
  }, [agentCwd])

  const refresh = () => {
    if (!agentCwd) return
    setLoading(true)
    window.api.fs.scanFiles(agentCwd, 200).then((f) => {
      setFiles(f)
      setLoading(false)
    })
  }

  return (
    <div className="h-full flex flex-col bg-sidebar-bg border-l border-border" style={{ width }}>
      {/* Header */}
      <div className="drag-region h-16 flex items-end px-3 pb-2 justify-between">
        <h2 className="no-drag text-[11px] font-heading font-semibold text-text-muted uppercase tracking-widest">
          Files
        </h2>
        <button
          onClick={refresh}
          className="no-drag text-[11px] text-accent hover:text-accent-hover cursor-pointer"
        >
          Refresh
        </button>
      </div>

      {/* Search */}
      <div className="px-2 pb-2 relative">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search files..."
          className="w-full px-2 py-1.5 pr-6 rounded-lg bg-bg-primary border border-border
            text-text-primary text-[11px] placeholder:text-text-muted/50
            focus:outline-none focus:border-accent transition-colors"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary cursor-pointer"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        )}
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto px-1">
        {loading && <p className="text-[11px] text-text-muted text-center py-4">Scanning...</p>}
        {!loading && files.length === 0 && (
          <p className="text-[11px] text-text-muted text-center py-4">No files</p>
        )}
        {files.filter((f) => !search || f.path.toLowerCase().includes(search.toLowerCase())).map((file) => (
          <button
            key={file.path}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', `${agentCwd}/${file.path}`)
              e.dataTransfer.effectAllowed = 'copy'
            }}
            onClick={() => {
              window.api.fs.revealInFinder(`${agentCwd}/${file.path}`)
            }}
            className="w-full text-left px-2 py-1.5 rounded-md text-[11px]
              hover:bg-bg-hover transition-colors cursor-pointer
              flex items-center gap-1.5 group"
          >
            <span className="w-4 h-4 rounded text-[10px] font-bold flex items-center justify-center flex-shrink-0" style={{ color: fileIcon(file.path).color }}>{fileIcon(file.path).letter}</span>
            <span className="text-text-primary truncate flex-1 font-mono">{file.path}</span>
            <span className="text-text-muted/50 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              {formatTime(file.mtime)}
            </span>
          </button>
        ))}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-border">
        <p className="text-[10px] text-text-muted">{files.length} files · {agentCwd}</p>
      </div>
    </div>
  )
}
