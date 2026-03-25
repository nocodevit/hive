import { useState } from 'react'
import Modal from './Modal'
import type { Project, Zone } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  onCreate: (project: Project) => void
  gitTokens?: { github?: string; gitlab?: string }
}

export default function CreateProjectModal({ open, onClose, onCreate, gitTokens }: Props) {
  const [name, setName] = useState('')
  const [zones, setZones] = useState<Zone[]>([])
  const [cloneUrl, setCloneUrl] = useState('')
  const [cloneProvider, setCloneProvider] = useState<'github' | 'gitlab'>('github')
  const [cloning, setCloning] = useState(false)
  const [cloneError, setCloneError] = useState('')

  const addZone = async (type: 'rnd' | 'non-rnd') => {
    const title = type === 'rnd' ? 'Select R&D Folder' : 'Select Non-R&D Folder'
    const path = await window.api.dialog.selectFolder(title)
    if (!path) return
    const hasGit = type === 'rnd' ? await window.api.fs.hasGit(path) : false
    const folderName = path.split('/').pop() || 'Untitled'
    setZones((prev) => [
      ...prev,
      { id: `zone-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: folderName, path, type, hasGit }
    ])
  }

  const cloneRepo = async (type: 'rnd' | 'non-rnd') => {
    if (!cloneUrl.trim()) return
    setCloneError('')
    setCloning(true)

    // Pick destination folder
    const destParent = await window.api.dialog.selectFolder('Select destination folder for clone')
    if (!destParent) { setCloning(false); return }

    // Extract repo name from URL
    const repoName = cloneUrl.trim().replace(/\.git$/, '').split('/').pop() || 'repo'
    const destPath = `${destParent}/${repoName}`
    const token = cloneProvider === 'gitlab' ? gitTokens?.gitlab : gitTokens?.github

    const result = await window.api.git.clone(cloneUrl.trim(), destPath, token, cloneProvider)
    setCloning(false)

    if (!result.ok) {
      setCloneError(result.error || 'Clone failed')
      return
    }

    const folderName = result.name || repoName
    setZones((prev) => [
      ...prev,
      { id: `zone-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: folderName, path: result.path!, type, hasGit: true }
    ])
    setCloneUrl('')
    if (!name.trim()) setName(folderName)
  }

  const removeZone = (id: string) => setZones((prev) => prev.filter((z) => z.id !== id))

  const canCreate = name.trim() && zones.length > 0

  const handleCreate = () => {
    if (!canCreate) return
    onCreate({
      id: `proj-${Date.now()}`,
      name: name.trim(),
      officePath: zones[0].path,
      zones
    })
    setName('')
    setZones([])
    setCloneUrl('')
    setCloneError('')
    onClose()
  }

  const rndZones = zones.filter((z) => z.type === 'rnd')
  const nonRndZones = zones.filter((z) => z.type === 'non-rnd')

  const ZoneList = ({ items, type }: { items: Zone[]; type: 'rnd' | 'non-rnd' }) => (
    <div className="space-y-1.5">
      {items.map((zone) => (
        <div key={zone.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-primary border border-border text-sm">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${type === 'rnd' ? 'bg-accent' : 'bg-status-waiting'}`} />
          <span className="font-medium text-text-primary truncate">{zone.name}</span>
          {type === 'rnd' && <span className="text-[10px] text-text-muted">{zone.hasGit ? 'git' : 'no git'}</span>}
          <span className="text-[11px] text-text-muted truncate ml-auto max-w-[160px]">{zone.path}</span>
          <button onClick={() => removeZone(zone.id)} className="text-text-muted hover:text-red-400 cursor-pointer flex-shrink-0">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
      ))}

      <div className="flex gap-1.5">
        <button
          onClick={() => addZone(type)}
          className="flex-1 px-3 py-2 rounded-lg border border-border border-dashed text-sm
            text-accent hover:bg-accent-subtle transition-colors cursor-pointer
            flex items-center justify-center gap-1.5"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Browse
        </button>
        {type === 'rnd' && (
          <button
            onClick={() => cloneRepo(type)}
            disabled={cloning || !cloneUrl.trim()}
            className="flex-1 px-3 py-2 rounded-lg border border-border border-dashed text-sm
              text-accent hover:bg-accent-subtle transition-colors cursor-pointer
              flex items-center justify-center gap-1.5
              disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {cloning ? (
              <span className="text-text-muted">Cloning...</span>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65S8.93 17.38 9 18v4" /><path d="M9 18c-4.51 2-5-2-7-2" /></svg>
                Git Clone
              </>
            )}
          </button>
        )}
      </div>
    </div>
  )

  return (
    <Modal open={open} onClose={onClose} title="New Project">
      <div className="space-y-5">
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

        {/* Git Clone URL */}
        <div>
          <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-1.5">
            Git Clone <span className="normal-case tracking-normal font-normal">(optional)</span>
          </label>
          <div className="flex gap-2">
            <div className="flex rounded-lg border border-border overflow-hidden flex-shrink-0">
              {(['github', 'gitlab'] as const).map((p) => (
                <button key={p} onClick={() => setCloneProvider(p)}
                  className={`px-2.5 py-2 text-[11px] font-medium cursor-pointer transition-colors ${
                    cloneProvider === p ? 'bg-accent text-text-on-purple' : 'bg-bg-primary text-text-muted hover:bg-bg-hover'
                  }`}
                >{p === 'github' ? 'GitHub' : 'GitLab'}</button>
              ))}
            </div>
            <input
              type="text"
              value={cloneUrl}
              onChange={(e) => { setCloneUrl(e.target.value); setCloneError('') }}
              placeholder="https://github.com/user/repo.git"
              className="flex-1 px-3 py-2 rounded-lg bg-bg-primary border border-border
                text-text-primary text-sm placeholder:text-text-muted/50
                focus:outline-none focus:border-accent transition-colors font-mono"
            />
          </div>
          {cloneError && <p className="text-[11px] text-red-400 mt-1">{cloneError}</p>}
          {cloneProvider === 'gitlab' && !gitTokens?.gitlab && (
            <p className="text-[11px] text-status-waiting mt-1">No GitLab token set. Add one in App Settings for private repos.</p>
          )}
          {cloneProvider === 'github' && !gitTokens?.github && (
            <p className="text-[11px] text-status-waiting mt-1">No GitHub token set. Add one in App Settings for private repos.</p>
          )}
        </div>

        {/* R&D Folders */}
        <div>
          <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-1.5">
            R&D Folders <span className="normal-case tracking-normal font-normal">(coding agents)</span>
          </label>
          <ZoneList items={rndZones} type="rnd" />
        </div>

        {/* Non-R&D Folders */}
        <div>
          <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-1.5">
            Non-R&D Folders <span className="normal-case tracking-normal font-normal">(research agents)</span>
          </label>
          <ZoneList items={nonRndZones} type="non-rnd" />
        </div>

        {zones.length === 0 && (
          <p className="text-xs text-text-muted italic">Add at least one folder.</p>
        )}

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
