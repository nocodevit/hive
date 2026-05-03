import { useState, useEffect, useMemo } from 'react'
import type { Project, Zone } from '../types'
import { shortenPath } from '../lib/path-display'
import { redact, isRedactEnabled, onRedactChange } from './hive-chat/crush-styles'
import CopyablePath from './CopyablePath'

interface Props {
  project: Project
  agentCwd: string
  width: number
  onOpenFile?: (filePath: string) => void
}

interface FileEntry {
  path: string
  mtime: number
  size: number
}

interface TreeNode {
  name: string
  path: string // relative path from root
  children: TreeNode[]
  file?: FileEntry // leaf nodes have a file
}

function formatTime(ms: number): string {
  const now = Date.now()
  const diff = now - ms
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fileIcon(path: string): { letter: string; color: string } {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  const icons: Record<string, { letter: string; color: string }> = {
    // Languages — colored letter (VSCode/Cursor style)
    ts: { letter: 'TS', color: '#3178c6' }, tsx: { letter: 'TS', color: '#3178c6' },
    js: { letter: 'JS', color: '#f7df1e' }, jsx: { letter: 'JS', color: '#f7df1e' },
    py: { letter: 'Py', color: '#3572A5' }, rb: { letter: 'Rb', color: '#CC342D' },
    go: { letter: 'Go', color: '#00ADD8' }, rs: { letter: 'Rs', color: '#dea584' },
    vue: { letter: 'V', color: '#42b883' }, svelte: { letter: 'S', color: '#ff3e00' },
    html: { letter: '🌐', color: '' }, css: { letter: '#', color: '#264de4' }, scss: { letter: '#', color: '#cd6799' }, less: { letter: '#', color: '#1d365d' },
    // Config — gear/bracket
    json: { letter: '{ }', color: '#f7df1e' }, yaml: { letter: 'Y', color: '#cb171e' }, yml: { letter: 'Y', color: '#cb171e' }, toml: { letter: 'T', color: '#888' },
    sh: { letter: '$_', color: '#89e051' }, bash: { letter: '$_', color: '#89e051' }, zsh: { letter: '$_', color: '#89e051' },
    // Media — emoji
    png: { letter: '🖼', color: '' }, jpg: { letter: '🖼', color: '' }, gif: { letter: '🖼', color: '' }, webp: { letter: '🖼', color: '' }, ico: { letter: '🖼', color: '' }, svg: { letter: '🖼', color: '' },
    // Docs — emoji
    md: { letter: '📝', color: '' }, txt: { letter: '📄', color: '' }, pdf: { letter: '📕', color: '' },
    // Special — emoji
    lock: { letter: '🔒', color: '' }, env: { letter: '🔑', color: '' },
  }
  return icons[ext] || { letter: 'F', color: '#888' }
}

function buildTree(files: FileEntry[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: [] }

  for (const file of files) {
    const parts = file.path.split('/')
    let node = root
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]
      const isFile = i === parts.length - 1
      if (isFile) {
        node.children.push({ name, path: file.path, children: [], file })
      } else {
        let child = node.children.find((c) => c.name === name && !c.file)
        if (!child) {
          child = { name, path: parts.slice(0, i + 1).join('/'), children: [] }
          node.children.push(child)
        }
        node = child
      }
    }
  }

  // Sort: folders first (alphabetical), then files (alphabetical)
  function sortTree(node: TreeNode) {
    node.children.sort((a, b) => {
      const aIsDir = !a.file
      const bIsDir = !b.file
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    node.children.forEach(sortTree)
  }
  sortTree(root)
  return root
}

function TreeItem({ node, depth, agentCwd, expanded, toggleExpand, search, onOpenFile }: {
  node: TreeNode
  depth: number
  agentCwd: string
  expanded: Set<string>
  toggleExpand: (path: string) => void
  search: string
  onOpenFile?: (filePath: string) => void
}) {
  const isDir = !node.file
  const isOpen = expanded.has(node.path)
  const indent = depth * 16

  if (isDir) {
    return (
      <>
        <button
          onClick={() => toggleExpand(node.path)}
          className="w-full text-left py-1 rounded-md text-[12px]
            hover:bg-bg-hover transition-colors cursor-pointer
            flex items-center gap-1 group"
          style={{ paddingLeft: indent + 8 }}
        >
          <svg
            width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            className={`flex-shrink-0 text-text-muted transition-transform ${isOpen ? 'rotate-90' : ''}`}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span className="text-accent/80 flex-shrink-0">
            {isOpen ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
            )}
          </span>
          <span className="text-text-primary truncate font-mono">{node.name}</span>
          <span className="text-text-muted/40 text-[11px] flex-shrink-0 opacity-0 group-hover:opacity-100">
            {node.children.length}
          </span>
        </button>
        {isOpen && node.children.map((child) => (
          <TreeItem
            key={child.path}
            node={child}
            depth={depth + 1}
            agentCwd={agentCwd}
            expanded={expanded}
            toggleExpand={toggleExpand}
            search={search}
            onOpenFile={onOpenFile}
          />
        ))}
      </>
    )
  }

  // File leaf
  const icon = fileIcon(node.name)
  return (
    <button
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', `${agentCwd}/${node.path}`)
        e.dataTransfer.effectAllowed = 'copy'
      }}
      onClick={() => {
        const fullPath = `${agentCwd}/${node.path}`
        if (onOpenFile && node.name.endsWith('.md')) {
          onOpenFile(fullPath)
        } else {
          window.api.fs.revealInFinder(fullPath)
        }
      }}
      className="w-full text-left py-1 rounded-md text-[12px]
        hover:bg-bg-hover transition-colors cursor-pointer
        flex items-center gap-1.5 group"
      style={{ paddingLeft: indent + 20 }}
    >
      <span className="w-3.5 h-3.5 rounded text-[10px] font-bold flex items-center justify-center flex-shrink-0" style={{ color: icon.color }}>
        {icon.letter}
      </span>
      <span className="text-text-primary truncate flex-1 font-mono">{node.name}</span>
      <span className="text-text-muted/40 flex-shrink-0 text-[11px] opacity-0 group-hover:opacity-100 transition-opacity pr-2">
        {node.file ? formatTime(node.file.mtime) : ''}
      </span>
    </button>
  )
}

export default function FilesPanel({ project, agentCwd, width, onOpenFile }: Props) {
  const [files, setFiles] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [branch, setBranch] = useState('')
  // Re-render when HiveChat toggles streaming mode (crush-styles is the
  // source of truth; it emits to onRedactChange listeners).
  const [, forceTick] = useState(0)
  useEffect(() => onRedactChange(() => forceTick(t => t + 1)), [])
  const displayCwd = isRedactEnabled() ? redact(shortenPath(agentCwd)) : agentCwd

  useEffect(() => {
    if (!agentCwd) { setBranch(''); return }
    window.api.git.currentBranch(agentCwd).then(setBranch).catch(() => setBranch(''))
  }, [agentCwd])

  useEffect(() => {
    if (!agentCwd) return
    setLoading(true)
    window.api.fs.scanFiles(agentCwd, 5000).then((f) => {
      setFiles(f)
      setLoading(false)
      // Auto-expand top-level directories
      const topDirs = new Set<string>()
      f.forEach((file) => {
        const first = file.path.split('/')[0]
        if (file.path.includes('/')) topDirs.add(first)
      })
      setExpanded(topDirs)
    })
  }, [agentCwd])

  const refresh = () => {
    if (!agentCwd) return
    setLoading(true)
    window.api.fs.scanFiles(agentCwd, 5000).then((f) => {
      setFiles(f)
      setLoading(false)
    })
  }

  const toggleExpand = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const collapseAll = () => setExpanded(new Set())
  const expandAll = () => {
    const dirs = new Set<string>()
    files.forEach((f) => {
      const parts = f.path.split('/')
      for (let i = 1; i < parts.length; i++) {
        dirs.add(parts.slice(0, i).join('/'))
      }
    })
    setExpanded(dirs)
  }

  const filtered = search
    ? files.filter((f) => f.path.toLowerCase().includes(search.toLowerCase()))
    : files

  const tree = useMemo(() => buildTree(filtered), [filtered])

  // When searching, auto-expand all dirs so matches are visible
  const displayExpanded = search
    ? (() => {
        const dirs = new Set<string>()
        filtered.forEach((f) => {
          const parts = f.path.split('/')
          for (let i = 1; i < parts.length; i++) {
            dirs.add(parts.slice(0, i).join('/'))
          }
        })
        return dirs
      })()
    : expanded

  return (
    <div className="h-full flex flex-col bg-sidebar-bg border-l border-border" style={{ width }}>
      {/* Header */}
      <div className="drag-region h-16 flex items-end px-3 pb-2 justify-between">
        <h2 className="no-drag text-[12px] font-heading font-semibold text-text-muted uppercase tracking-widest">
          File Explorer
        </h2>
        <div className="no-drag flex items-center gap-2">
          <button onClick={collapseAll} title="Collapse all"
            className="text-text-muted hover:text-text-primary cursor-pointer">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
          </button>
          <button onClick={expandAll} title="Expand all"
            className="text-text-muted hover:text-text-primary cursor-pointer">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
          </button>
          <button onClick={refresh}
            className="text-[12px] text-accent hover:text-accent-hover cursor-pointer">
            Refresh
          </button>
        </div>
      </div>

      {/* Branch tag */}
      {branch && (
        <div className="px-3 pb-2">
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-accent/15 text-accent border border-accent/20">
            🌿 {branch}
          </span>
        </div>
      )}

      {/* Search */}
      <div className="px-2 pb-2 relative">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search files..."
          className="w-full px-2 py-1.5 pr-6 rounded-lg bg-bg-primary border border-border
            text-text-primary text-[12px] placeholder:text-text-muted/50
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

      {/* Tree */}
      <div className="flex-1 overflow-y-auto px-1">
        {loading && <p className="text-[12px] text-text-muted text-center py-4">Scanning...</p>}
        {!loading && files.length === 0 && (
          <p className="text-[12px] text-text-muted text-center py-4">No files</p>
        )}
        {!loading && tree.children.map((node) => (
          <TreeItem
            key={node.path}
            node={node}
            depth={0}
            agentCwd={agentCwd}
            expanded={displayExpanded}
            toggleExpand={toggleExpand}
            search={search}
            onOpenFile={onOpenFile}
          />
        ))}
      </div>

      {/* Footer — cwd is redacted (username masked, deep paths elided) when
         streamingMode is on so the real /Users/<name>/… doesn't leak in
         screenshots or live streams. Hover to see the full path. */}
      <div className="px-3 py-2 border-t border-border">
        <CopyablePath
          path={agentCwd}
          display={`${files.length} files · ${displayCwd}`}
          className="text-[11px] text-text-muted truncate"
          block
        />
      </div>
    </div>
  )
}
