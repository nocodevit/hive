import { useState } from 'react'
import Modal from './Modal'
import type { Project, Zone } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  onCreate: (project: Project) => void
}

export default function CreateProjectModal({ open, onClose, onCreate }: Props) {
  const [name, setName] = useState('')
  const [rndPath, setRndPath] = useState('')
  const [nonRndPath, setNonRndPath] = useState('')

  const selectFolder = async (type: 'rnd' | 'non-rnd') => {
    const title = type === 'rnd' ? 'Select R&D Folder' : 'Select Non-R&D Folder'
    const path = await window.api.dialog.selectFolder(title)
    if (!path) return
    if (type === 'rnd') setRndPath(path)
    else setNonRndPath(path)
  }

  const canCreate = name.trim() && (rndPath || nonRndPath)

  const handleCreate = async () => {
    if (!canCreate) return
    const zones: Zone[] = []
    if (rndPath) {
      const hasGit = await window.api.fs.hasGit(rndPath)
      zones.push({
        id: `zone-rnd-${Date.now()}`,
        name: rndPath.split('/').pop() || 'R&D',
        path: rndPath,
        type: 'rnd',
        hasGit
      })
    }
    if (nonRndPath) {
      zones.push({
        id: `zone-doc-${Date.now()}`,
        name: nonRndPath.split('/').pop() || 'Docs',
        path: nonRndPath,
        type: 'non-rnd',
        hasGit: false
      })
    }
    onCreate({
      id: `proj-${Date.now()}`,
      name: name.trim(),
      officePath: rndPath || nonRndPath,
      zones
    })
    setName('')
    setRndPath('')
    setNonRndPath('')
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="New Project">
      <div className="space-y-5">
        {/* Project Name */}
        <div>
          <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-1.5">
            Project Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Project"
            className="w-full px-3 py-2 rounded-lg bg-bg-primary border border-border
              text-text-primary text-sm placeholder:text-text-muted/50
              focus:outline-none focus:border-accent transition-colors"
          />
        </div>

        {/* R&D Folder */}
        <div>
          <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-1.5">
            R&D Folder
            <span className="ml-1 normal-case tracking-normal font-normal">(coding agents)</span>
          </label>
          <button
            onClick={() => selectFolder('rnd')}
            className="w-full px-3 py-2.5 rounded-lg bg-bg-primary border border-border border-dashed
              text-sm text-left cursor-pointer hover:border-accent transition-colors
              flex items-center gap-2"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
            </svg>
            <span className={rndPath ? 'text-text-primary truncate' : 'text-text-muted'}>
              {rndPath || 'Select folder...'}
            </span>
            {rndPath && (
              <button
                onClick={(e) => { e.stopPropagation(); setRndPath('') }}
                className="ml-auto text-text-muted hover:text-red-400 cursor-pointer"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </button>
        </div>

        {/* Non-R&D Folder */}
        <div>
          <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-1.5">
            Non-R&D Folder
            <span className="ml-1 normal-case tracking-normal font-normal">(research agents)</span>
          </label>
          <button
            onClick={() => selectFolder('non-rnd')}
            className="w-full px-3 py-2.5 rounded-lg bg-bg-primary border border-border border-dashed
              text-sm text-left cursor-pointer hover:border-accent transition-colors
              flex items-center gap-2"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--status-waiting)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
            </svg>
            <span className={nonRndPath ? 'text-text-primary truncate' : 'text-text-muted'}>
              {nonRndPath || 'Select folder...'}
            </span>
            {nonRndPath && (
              <button
                onClick={(e) => { e.stopPropagation(); setNonRndPath('') }}
                className="ml-auto text-text-muted hover:text-red-400 cursor-pointer"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </button>
        </div>

        {!rndPath && !nonRndPath && (
          <p className="text-xs text-text-muted italic">At least one folder is required.</p>
        )}

        {/* Create button */}
        <button
          onClick={handleCreate}
          disabled={!canCreate}
          className="w-full py-2.5 rounded-lg bg-accent text-text-on-purple font-semibold text-sm
            hover:bg-accent-hover transition-colors cursor-pointer
            disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Create Project
        </button>
      </div>
    </Modal>
  )
}
