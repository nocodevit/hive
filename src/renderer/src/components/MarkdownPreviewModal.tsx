import { useState, useEffect, useCallback, type ComponentPropsWithoutRef } from 'react'
import Markdown from 'react-markdown'

const mdComponents = {
  h1: (props: ComponentPropsWithoutRef<'h1'>) => <h1 style={{ fontSize: '1.8em', fontWeight: 700, borderBottom: '1px solid var(--border)', paddingBottom: 8, marginTop: 24, marginBottom: 12 }} {...props} />,
  h2: (props: ComponentPropsWithoutRef<'h2'>) => <h2 style={{ fontSize: '1.4em', fontWeight: 600, borderBottom: '1px solid var(--border)', paddingBottom: 6, marginTop: 20, marginBottom: 10 }} {...props} />,
  h3: (props: ComponentPropsWithoutRef<'h3'>) => <h3 style={{ fontSize: '1.15em', fontWeight: 600, marginTop: 16, marginBottom: 8 }} {...props} />,
  h4: (props: ComponentPropsWithoutRef<'h4'>) => <h4 style={{ fontSize: '1em', fontWeight: 600, marginTop: 12, marginBottom: 6 }} {...props} />,
  p: (props: ComponentPropsWithoutRef<'p'>) => <p style={{ marginBottom: 12, lineHeight: 1.7 }} {...props} />,
  ul: (props: ComponentPropsWithoutRef<'ul'>) => <ul style={{ paddingLeft: 24, marginBottom: 12, listStyleType: 'disc' }} {...props} />,
  ol: (props: ComponentPropsWithoutRef<'ol'>) => <ol style={{ paddingLeft: 24, marginBottom: 12, listStyleType: 'decimal' }} {...props} />,
  li: (props: ComponentPropsWithoutRef<'li'>) => <li style={{ marginBottom: 4, lineHeight: 1.6 }} {...props} />,
  a: (props: ComponentPropsWithoutRef<'a'>) => <a style={{ color: 'var(--accent)', textDecoration: 'underline' }} {...props} />,
  strong: (props: ComponentPropsWithoutRef<'strong'>) => <strong style={{ fontWeight: 600 }} {...props} />,
  blockquote: (props: ComponentPropsWithoutRef<'blockquote'>) => <blockquote style={{ borderLeft: '3px solid var(--accent)', paddingLeft: 16, margin: '12px 0', opacity: 0.8, fontStyle: 'italic' }} {...props} />,
  code: ({ children, className, ...props }: ComponentPropsWithoutRef<'code'> & { className?: string }) => {
    const isBlock = className?.startsWith('language-')
    if (isBlock) {
      return <code style={{ display: 'block', background: '#1a1a1a', padding: 16, borderRadius: 8, fontSize: '0.85em', overflowX: 'auto', border: '1px solid var(--border)' }} className={className} {...props}>{children}</code>
    }
    return <code style={{ background: 'var(--bg-hover)', padding: '2px 6px', borderRadius: 4, fontSize: '0.88em' }} {...props}>{children}</code>
  },
  pre: (props: ComponentPropsWithoutRef<'pre'>) => <pre style={{ marginBottom: 12, overflow: 'auto' }} {...props} />,
  hr: (props: ComponentPropsWithoutRef<'hr'>) => <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '20px 0' }} {...props} />,
  table: (props: ComponentPropsWithoutRef<'table'>) => <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12, fontSize: '0.9em' }} {...props} />,
  th: (props: ComponentPropsWithoutRef<'th'>) => <th style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '2px solid var(--border)', fontWeight: 600 }} {...props} />,
  td: (props: ComponentPropsWithoutRef<'td'>) => <td style={{ padding: '6px 12px', borderBottom: '1px solid var(--border)' }} {...props} />,
}

interface Props {
  filePath: string | null
  onClose: () => void
}

export default function MarkdownPreviewModal({ filePath, onClose }: Props) {
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!filePath) return
    window.api.fs.readFile(filePath).then((text) => {
      setContent(text || '')
      setDirty(false)
    })
  }, [filePath])

  const save = useCallback(async () => {
    if (!filePath || !dirty) return
    setSaving(true)
    await window.api.fs.writeFile(filePath, content)
    setSaving(false)
    setDirty(false)
  }, [filePath, content, dirty])

  // Cmd+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        save()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [save])

  if (!filePath) return null

  const fileName = filePath.split('/').pop() || ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-bg-secondary border border-border rounded-2xl shadow-2xl w-[90vw] max-w-[1200px] h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-sm font-heading font-semibold text-text-primary">{fileName}</span>
            {dirty && <span className="w-2 h-2 rounded-full bg-status-waiting" title="Unsaved changes" />}
            <span className="text-[10px] text-text-muted font-mono truncate max-w-[400px]">{filePath}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={save}
              disabled={!dirty || saving}
              className="px-3 py-1 rounded-md text-[11px] font-medium bg-accent text-text-on-purple
                hover:bg-accent-hover transition-colors cursor-pointer
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button onClick={onClose}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:bg-bg-hover transition-colors cursor-pointer">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        </div>

        {/* Split: Editor | Preview */}
        <div className="flex-1 flex overflow-hidden">
          {/* Editor */}
          <div className="w-1/2 border-r border-border flex flex-col">
            <div className="px-3 py-1.5 border-b border-border">
              <span className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">Editor</span>
            </div>
            <textarea
              value={content}
              onChange={(e) => { setContent(e.target.value); setDirty(true) }}
              spellCheck={false}
              className="flex-1 w-full resize-none bg-bg-primary text-text-primary text-[13px] font-mono
                p-4 leading-relaxed focus:outline-none border-none"
            />
          </div>

          {/* Preview */}
          <div className="w-1/2 flex flex-col">
            <div className="px-3 py-1.5 border-b border-border">
              <span className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">Preview</span>
            </div>
            <div className="flex-1 overflow-y-auto p-5 text-text-secondary text-[13px]">
              <Markdown components={mdComponents}>{content}</Markdown>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
