import { useEffect, useState } from 'react'
import { groupTodos, isOverdue, SOURCE_LABEL, sortTodos, todoDiscussText, whenShort, type GroupBy, type SortBy, type TodoView } from '../../lib/butler-todos'

const PREF = 'hive:todo-view'
const readPref = (): { group: GroupBy; sort: SortBy } => {
  try { const j = JSON.parse(localStorage.getItem(PREF) || '{}'); return { group: ['created', 'source', 'due'].includes(j.group) ? j.group : 'created', sort: ['newest', 'oldest', 'due'].includes(j.sort) ? j.sort : 'newest' } } catch { return { group: 'created', sort: 'newest' } }
}
const sel = 'px-1.5 py-0.5 rounded-md bg-bg-primary border border-border text-[11.5px] text-text-secondary'

/** One todo: a line; opened, its whole story (who did what, when) and what to do next. */
function Item({ t, onDiscuss, onCard }: { t: TodoView; onDiscuss?: (text: string) => void; onCard: () => void }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const closed = t.status !== 'open'
  const set = (s: 'open' | 'done' | 'dropped') => { void window.api.todos.setStatus(t.id, s) }
  return (
    <div className="rounded-xl bg-bg-primary" aria-label={`Todo: ${t.title}`}>
      <div className="flex items-center gap-2.5 px-2.5 py-2 text-[13px]">
        <input type="checkbox" checked={t.status === 'done'} onChange={e => set(e.target.checked ? 'done' : 'open')} aria-label={`Done: ${t.title}`} className="accent-accent cursor-pointer" />
        <button onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex-1 min-w-0 text-left cursor-pointer">
          <span className={`block truncate ${closed ? 'text-text-muted line-through' : 'text-text-primary'}`}>{t.title}</span>
          <span className="block text-[11px] text-text-muted truncate">{t.events[0]?.text !== t.title ? t.events[0]?.text : `${t.createdBy === 'owner' ? 'You' : 'Butler'} · ${whenShort(t.createdAt)}`}</span>
        </button>
        <span className="px-1.5 py-0.5 rounded-md bg-bg-secondary text-[10px] font-semibold text-text-secondary">{SOURCE_LABEL[t.source]}</span>
        {t.due && <span className={`font-mono text-[11px] ${isOverdue(t) ? 'text-status-waiting' : 'text-text-muted'}`}>{t.due.slice(5)}</span>}
      </div>
      {open && (
        <div className="px-2.5 pb-2.5">
          <ol className="ml-[7px] border-l border-border pl-3.5 flex flex-col gap-1.5" aria-label="History">
            {t.events.map((e, i) => (
              <li key={i} className="relative text-[12px] text-text-secondary leading-snug">
                <span className={`absolute -left-[19px] top-[5px] w-[7px] h-[7px] rounded-full ${e.who === 'owner' ? 'bg-accent' : e.kind === 'status' ? 'bg-status-working' : 'bg-text-muted/50'}`} aria-hidden />
                <span className="font-mono text-[11px] text-text-muted mr-1.5">{whenShort(e.at)}</span>
                {e.who === 'owner' ? 'You · ' : e.who === 'butler' ? 'Butler · ' : 'Agent · '}{e.text}
                {e.link?.startsWith('http') && <a href={e.link} target="_blank" rel="noreferrer" className="ml-1 font-semibold text-accent">open ↗</a>}
                {e.link?.startsWith('approval:') && <button onClick={onCard} className="ml-1 font-semibold text-accent cursor-pointer">card ↗</button>}
              </li>
            ))}
          </ol>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {!closed && <button onClick={() => set('done')} className="px-2.5 py-1 rounded-lg bg-accent text-text-on-purple text-[12px] font-semibold cursor-pointer">Done</button>}
            {onDiscuss && <button onClick={() => onDiscuss(todoDiscussText(t))} className="px-2.5 py-1 rounded-lg bg-bg-secondary text-[12px] font-semibold text-text-primary cursor-pointer">💬 Chat</button>}
            {!closed ? <button onClick={() => set('dropped')} className="px-2.5 py-1 rounded-lg bg-bg-secondary text-[12px] text-text-muted cursor-pointer">Drop</button>
              : <button onClick={() => set('open')} className="px-2.5 py-1 rounded-lg bg-bg-secondary text-[12px] text-text-muted cursor-pointer">Reopen</button>}
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Add a note…" aria-label={`Note for ${t.title}`}
              onKeyDown={e => { if (e.key === 'Enter' && note.trim()) { void window.api.todos.note(t.id, note.trim()); setNote('') } }}
              className="flex-1 min-w-[120px] px-2 py-1 rounded-lg bg-bg-secondary border border-border text-[12px] text-text-primary focus:outline-none focus:border-accent" />
          </div>
        </div>
      )}
    </div>
  )
}

/** Butler › Todo: open ones grouped (created / source / due), Completed below with their history. */
export function TodoTab({ visible, onDiscuss, onCard }: { visible: boolean; onDiscuss?: (text: string) => void; onCard: () => void }) {
  const [list, setList] = useState<TodoView[]>([])
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [{ group, sort }, setView] = useState(readPref)
  const [q, setQ] = useState('')
  useEffect(() => {
    if (!visible) return
    let alive = true
    const load = () => window.api.todos.list().then(l => { if (alive) setList(l) }).catch(() => {})
    load()
    const off = window.api.todos.onChange(load)
    return () => { alive = false; off() }
  }, [visible])
  const pick = (v: { group?: GroupBy; sort?: SortBy }) => setView(p => { const n = { ...p, ...v }; try { localStorage.setItem(PREF, JSON.stringify(n)) } catch { /* private */ } return n })
  const add = async () => {
    if (!title.trim()) return
    await window.api.todos.add({ title: title.trim(), ...(due ? { due } : {}) })
    setTitle(''); setDue('')
  }
  const match = (t: TodoView) => !q.trim() || `${t.title} ${t.events.map(e => e.text).join(' ')}`.toLowerCase().includes(q.trim().toLowerCase())
  const open = list.filter(t => t.status === 'open' && match(t))
  const closed = sortTodos(list.filter(t => t.status !== 'open' && match(t)), 'newest').sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-3.5 pb-3.5 flex flex-col gap-2.5">
      <div className="flex gap-1.5 pt-1">
        <input value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void add() }} placeholder="Note a todo… (or say 记一下 in Chat)" aria-label="New todo"
          className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-bg-primary border border-border text-[13px] text-text-primary focus:outline-none focus:border-accent" />
        <input type="date" value={due} onChange={e => setDue(e.target.value)} aria-label="Due date" className="w-[118px] px-1.5 rounded-lg bg-bg-primary border border-border text-[12px] text-text-secondary" />
        <button onClick={add} disabled={!title.trim()} className="px-3 rounded-lg bg-accent text-text-on-purple text-[12px] font-semibold cursor-pointer disabled:opacity-50">Add</button>
      </div>
      <div className="flex items-center gap-1.5 text-[11.5px] text-text-muted">
        Group <select value={group} onChange={e => pick({ group: e.target.value as GroupBy })} aria-label="Group by" className={sel}><option value="created">Created</option><option value="source">Source</option><option value="due">Due</option></select>
        Sort <select value={sort} onChange={e => pick({ sort: e.target.value as SortBy })} aria-label="Sort by" className={sel}><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="due">Due date</option></select>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search" aria-label="Search todos" className={`${sel} flex-1 min-w-0`} />
      </div>
      {!open.length && <div className="text-[12px] text-text-muted px-1">{q ? 'Nothing matches' : 'Nothing to do · Butler adds what it promised to follow up'}</div>}
      {groupTodos(open, group, sort).map(g => (
        <div key={g.label} className="flex flex-col gap-1.5" role="group" aria-label={g.label}>
          <div className="px-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">{g.label} · {g.items.length}</div>
          {g.items.map(t => <Item key={t.id} t={t} onDiscuss={onDiscuss} onCard={onCard} />)}
        </div>
      ))}
      {closed.length > 0 && (
        <details className="border-t border-border pt-2" aria-label="Completed">
          <summary className="cursor-pointer px-1 text-[12px] font-semibold text-text-muted">Completed · {closed.length}</summary>
          <div className="mt-1.5 flex flex-col gap-1.5">{closed.map(t => <Item key={t.id} t={t} onDiscuss={onDiscuss} onCard={onCard} />)}</div>
        </details>
      )}
    </div>
  )
}
