import { useState, useEffect } from 'react'
import Modal from './Modal'
import type { Project, Zone } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  project: Project
  onUpdate: (project: Project) => void
  onDelete: () => void
}

export default function ProjectSettingsModal({ open, onClose, project, onUpdate, onDelete }: Props) {
  const [name, setName] = useState(project.name)
  const [zones, setZones] = useState<Zone[]>(project.zones)

  useEffect(() => {
    setName(project.name)
    setZones(project.zones)
  }, [project])

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

  const removeZone = (id: string) => setZones((prev) => prev.filter((z) => z.id !== id))

  const handleSave = () => {
    onUpdate({ ...project, name: name.trim(), zones, officePath: zones[0]?.path || project.officePath })
    onClose()
  }

  const rndZones = zones.filter((z) => z.type === 'rnd')
  const nonRndZones = zones.filter((z) => z.type === 'non-rnd')

  return (
    <Modal open={open} onClose={onClose} title="Project Settings">
      <div className="space-y-5">
        <div>
          <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-1.5">
            Project Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-bg-primary border border-border
              text-text-primary text-sm focus:outline-none focus:border-accent transition-colors"
          />
        </div>

        {/* R&D Folders */}
        <div>
          <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-1.5">
            R&D Folders
          </label>
          <div className="space-y-1.5">
            {rndZones.map((zone) => (
              <div key={zone.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-primary border border-border text-sm">
                <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0" />
                <span className="font-medium text-text-primary truncate">{zone.name}</span>
                <span className="text-[12px] text-text-muted truncate ml-auto max-w-[160px]">{zone.path}</span>
                <button onClick={() => removeZone(zone.id)} className="text-text-muted hover:text-red-400 cursor-pointer flex-shrink-0">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
            ))}
            <button
              onClick={() => addZone('rnd')}
              className="w-full px-3 py-2 rounded-lg border border-border border-dashed text-sm
                text-accent hover:bg-accent-subtle transition-colors cursor-pointer
                flex items-center justify-center gap-1.5"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              Add R&D Folder
            </button>
          </div>
        </div>

        {/* Non-R&D Folders */}
        <div>
          <label className="block text-xs font-heading font-semibold text-text-muted uppercase tracking-wider mb-1.5">
            Non-R&D Folders
          </label>
          <div className="space-y-1.5">
            {nonRndZones.map((zone) => (
              <div key={zone.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-primary border border-border text-sm">
                <span className="w-2 h-2 rounded-full bg-status-waiting flex-shrink-0" />
                <span className="font-medium text-text-primary truncate">{zone.name}</span>
                <span className="text-[12px] text-text-muted truncate ml-auto max-w-[160px]">{zone.path}</span>
                <button onClick={() => removeZone(zone.id)} className="text-text-muted hover:text-red-400 cursor-pointer flex-shrink-0">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
            ))}
            <button
              onClick={() => addZone('non-rnd')}
              className="w-full px-3 py-2 rounded-lg border border-border border-dashed text-sm
                text-status-waiting hover:bg-bg-hover transition-colors cursor-pointer
                flex items-center justify-center gap-1.5"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              Add Non-R&D Folder
            </button>
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={!name.trim() || zones.length === 0}
          className="w-full py-2.5 rounded-lg bg-accent text-text-on-purple font-semibold text-sm
            hover:bg-accent-hover transition-colors cursor-pointer
            disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Save Changes
        </button>

        <div className="pt-2 border-t border-border">
          <button
            onClick={() => {
              if (confirm('Delete this project? Agents will also be removed.')) {
                onDelete()
                onClose()
              }
            }}
            className="w-full py-2 rounded-lg text-sm text-red-400 hover:bg-red-400/10
              transition-colors cursor-pointer"
          >
            Delete Project
          </button>
        </div>
      </div>
    </Modal>
  )
}
