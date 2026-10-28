import { forwardRef, useEffect, useRef, useState } from 'react'
import { DiscussButton, type OnDiscuss } from './DiscussButton'
import { AnimatePresence, motion } from 'motion/react'
import { offerUndo, popover, row, SMOOTH, SNAPPY } from '../../lib/motion'
import { groupTodos, isOverdue, PRIORITIES, priMeta, priOf, SOURCE_LABEL, sortTodos, todoDiscussText, tomorrow, whenShort, type GroupBy, type Priority, type SortBy, type TodoView } from '../../lib/butler-todos'

const PREF = 'hive:todo-view'
const readPref = (): { group: GroupBy; sort: SortBy } => {
  try { const j = JSON.parse(localStorage.getItem(PREF) || '{}'); return { group: ['created', 'source', 'due', 'priority'].includes(j.group) ? j.group : 'created', sort: ['newest', 'oldest', 'due'].includes(j.sort) ? j.sort : 'newest' } } catch { return { group: 'created', sort: 'newest' } }
}
const sel = 'px-1.5 py-0.5 rounded-md bg-bg-primary border border-border text-[11.5px] text-text-secondary'

/** ⚡ 要命: a storm on the row — lightning flashes across it, the bolt flickers, the edge glows. Off with reduced motion. */
const STORM_CSS = `
@keyframes hive-storm-flash { 0%, 86%, 100% { opacity: 0 } 87% { opacity: .7 } 88% { opacity: 0 } 90% { opacity: .45 } 91.5% { opacity: 0 } }
@keyframes hive-storm-glow { 0%, 100% { box-shadow: 0 0 0 1px rgba(255,90,60,.6), 0 0 8px rgba(255,90,60,.15) } 50% { box-shadow: 0 0 0 1px rgba(255,176,32,.9), 0 0 18px rgba(255,176,32,.35) } }
@keyframes hive-storm-bolt { 0%, 84%, 100% { transform: none; filter: none } 86% { transform: translate(-1px, 1px) rotate(-8deg) scale(1.25); filter: drop-shadow(0 0 6px #fde047) brightness(1.6) } 88% { transform: translate(1px, -1px) rotate(6deg) } 90% { transform: scale(1.15); filter: drop-shadow(0 0 4px #fde047) } 92% { transform: none; filter: none } }
.hive-storm { position: relative; overflow: hidden; background-image: linear-gradient(100deg, rgba(255,90,60,.18), rgba(255,176,32,.09) 60%, transparent); animation: hive-storm-glow 2.4s ease-in-out infinite }
.hive-storm::after { content: ''; position: absolute; inset: 0; pointer-events: none; border-radius: inherit; opacity: 0;
  background: linear-gradient(115deg, transparent 30%, rgba(255,255,255,.9) 44%, rgba(253,224,71,.55) 48%, transparent 62%); animation: hive-storm-flash 5s linear infinite }
.hive-storm-bolt { display: inline-block; animation: hive-storm-bolt 5s linear infinite }
@media (prefers-reduced-motion: reduce) { .hive-storm, .hive-storm::after, .hive-storm-bolt { animation: none !important } .hive-storm { box-shadow: 0 0 0 1px rgba(239,68,68,.6) } }
`

/** The tier chip on a row: ⚡ 要命 / 🔥 冒烟 / 🧊 冻着, and the menu to change it. */
function PriorityChip({ t }: { t: TodoView }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const p = priOf(t), m = priMeta(p)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => { if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
  }, [open])
  // 冒烟 is the normal case: barely there until hovered, so only 要命 / 冻着 catch the eye.
  const tone = p === 1 ? 'bg-[rgba(255,90,60,.18)] text-[#ff8a6b] font-bold' : p === 3 ? 'bg-sky-400/10 text-sky-300/80' : 'text-text-muted opacity-25 hover:opacity-100 focus-visible:opacity-100'
  return (
    <span ref={ref} className="relative flex-shrink-0">
      <button onClick={() => t.status === 'open' && setOpen(o => !o)} aria-label={`Priority ${m.name}: ${t.title}`} aria-expanded={open} title={`${m.name} · ${m.hint}`}
        className={`h-6 px-1.5 rounded-md text-[11px] inline-flex items-center gap-1 whitespace-nowrap cursor-pointer ${tone}`}>
        <span className={p === 1 ? 'hive-storm-bolt' : ''} aria-hidden>{m.icon}</span>{p !== 2 && m.name}
      </button>
      <AnimatePresence>{open && (
        <motion.div {...popover('top right')} role="menu" aria-label="Priority" className="absolute z-30 right-0 top-full mt-1 w-[150px] rounded-xl bg-bg-secondary border border-border shadow-lg p-1">
          {PRIORITIES.map(x => (
            <button key={x.p} role="menuitemradio" aria-checked={x.p === p} onClick={() => { setOpen(false); void window.api.todos.setPriority([t.id], x.p) }}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-[12.5px] hover:bg-bg-hover cursor-pointer ${x.p === p ? 'text-text-primary font-semibold' : 'text-text-secondary'}`}>
              <span aria-hidden>{x.icon}</span>{x.name}<span className="ml-auto text-[10.5px] text-text-muted">{x.hint}</span>
            </button>
          ))}
        </motion.div>
      )}</AnimatePresence>
    </span>
  )
}

/** Done tick: the ✓ draws itself (200 ms). A real checkbox underneath for keyboard and screen readers. */
function DoneBox({ checked, label, onChange }: { checked: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <span className="relative inline-grid place-items-center w-4 h-4 flex-shrink-0">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} aria-label={label}
        className="peer appearance-none w-4 h-4 m-0 rounded-[5px] border-[1.5px] border-text-muted/60 checked:border-accent checked:bg-accent transition-colors duration-150 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" />
      <svg viewBox="0 0 16 16" aria-hidden className="pointer-events-none absolute inset-0 w-4 h-4">
        <motion.path d="M4 8.4l2.6 2.6L12 5.4" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
          initial={false} animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }} transition={{ duration: 0.2, ease: 'easeOut' }} />
      </svg>
    </span>
  )
}

const primary = 'h-7 px-3 rounded-lg bg-accent text-text-on-purple text-[12px] font-semibold inline-flex items-center shadow-sm cursor-pointer'
const ghost = 'h-7 px-2 rounded-lg text-[12px] text-text-secondary hover:bg-bg-hover inline-flex items-center gap-1 cursor-pointer'

/** One todo: a line with Discuss and View; View opens its whole story (who did what, when) as a card. */
// forwardRef: it is a direct child of <AnimatePresence mode="popLayout">, which positions leaving rows by ref.
const Item = forwardRef<HTMLDivElement, { t: TodoView; onDiscuss?: OnDiscuss; onCard: () => void; picked?: { on: boolean; toggle: () => void } }>(function Item({ t, onDiscuss, onCard, picked }, ref) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  // Ticked: ✓ draws, a line strikes through the title, then it leaves for Completed.
  const [finishing, setFinishing] = useState(false)
  const closed = t.status !== 'open'
  const set = (s: 'open' | 'done' | 'dropped') => { void window.api.todos.setStatus(t.id, s) }
  const finish = () => { setFinishing(true); window.setTimeout(() => set('done'), 450) }
  const drop = () => { set('dropped'); offerUndo(`Dropped · ${t.title}`, () => { void window.api.todos.setStatus(t.id, 'open') }) }
  // Source lives in the second line, so the first line is just the title and its tier (as in the mockup).
  const sub = [SOURCE_LABEL[t.source], t.events[0]?.text !== t.title ? t.events[0]?.text : `${t.createdBy === 'owner' ? 'You' : 'Butler'} · ${whenShort(t.createdAt)}`].join(' · ')
  return (
    <motion.div ref={ref} {...row} className={`rounded-xl bg-bg-primary ${priOf(t) === 1 && !closed ? 'hive-storm' : ''} ${open || picked?.on ? 'ring-1 ring-border' : ''} ${picked?.on ? 'ring-accent' : ''}`} aria-label={`Todo: ${t.title}`}>
      <div className="flex items-center gap-2.5 pl-2.5 pr-1.5 py-1.5 text-[13px]">
        {picked
          ? <input type="checkbox" checked={picked.on} onChange={picked.toggle} aria-label={`Select: ${t.title}`} className="accent-accent cursor-pointer" />
          : <DoneBox checked={t.status === 'done' || finishing} label={`Done: ${t.title}`} onChange={v => (v ? finish() : (setFinishing(false), set('open')))} />}
        <div className="flex-1 min-w-0">
          <span className={`relative block truncate transition-colors duration-200 ${closed ? 'text-text-muted line-through' : finishing ? 'text-text-muted' : priOf(t) === 1 ? 'text-text-primary font-semibold' : priOf(t) === 3 ? 'text-text-secondary' : 'text-text-primary'}`}>
            {t.title}
            {finishing && !closed && <motion.i aria-hidden className="absolute left-0 right-0 top-1/2 h-px bg-current origin-left" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.25, ease: 'easeOut' }} />}
          </span>
          <span className="block text-[11px] text-text-muted truncate">{sub}</span>
        </div>
        {/* Due date rolls to its new value (Move to tomorrow). */}
        {t.due && <span className={`relative flex-shrink-0 overflow-hidden font-mono text-[11px] ${isOverdue(t) ? 'text-status-waiting' : 'text-text-muted'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
          <AnimatePresence initial={false} mode="popLayout"><motion.span key={t.due} className="inline-block" initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} transition={SNAPPY}>{t.due.slice(5)}</motion.span></AnimatePresence>
        </span>}
        <PriorityChip t={t} />
        {onDiscuss && <DiscussButton compact label={`Discuss ${t.title}`} text={() => todoDiscussText(t)} onDiscuss={(text, to) => { onDiscuss(text, to); void window.api.todos.note(t.id, to ? `Discussed with ${to.agent} (${to.project})` : 'Discussed with Butler') }} />}
        <button onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label={`View ${t.title}`} title="View its story"
          className={`flex-shrink-0 w-7 h-7 rounded-lg inline-flex items-center justify-center text-[15px] text-text-muted hover:bg-bg-hover hover:text-text-primary cursor-pointer ${open ? 'bg-bg-hover text-text-primary' : ''}`}>
          <span className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden>›</span>
        </button>
      </div>
      <AnimatePresence initial={false}>{open && (
        <motion.div key="story" className="border-t border-border overflow-hidden" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={SMOOTH}>
          <ol className="mx-2.5 mt-2.5 ml-[17px] border-l border-border pl-3.5 flex flex-col gap-1.5" aria-label="History">
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
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Add a note… ↵" aria-label={`Note for ${t.title}`}
            onKeyDown={e => { if (e.key === 'Enter' && note.trim()) { void window.api.todos.note(t.id, note.trim()); setNote('') } }}
            className="mx-2.5 mt-2.5 w-[calc(100%-20px)] h-7 px-2.5 rounded-lg bg-bg-secondary border border-border text-[12px] text-text-primary focus:outline-none focus:border-accent" />
          <div className="mt-2.5 flex items-center gap-1 px-2.5 py-2 border-t border-border bg-bg-primary/40 rounded-b-xl">
            {!closed ? <button onClick={() => set('done')} aria-label={`Mark ${t.title} done`} className={primary}>Done</button>
              : <button onClick={() => set('open')} aria-label={`Reopen ${t.title}`} className={primary}>Reopen</button>}
            <span className="flex-1" />
            {!closed && <button onClick={drop} aria-label={`Drop ${t.title}`} className={`${ghost} text-text-muted`}>Drop</button>}
          </div>
        </motion.div>
      )}</AnimatePresence>
    </motion.div>
  )
})

/** Butler › Todo: open ones grouped (created / source / due), Completed below with their history. */
export function TodoTab({ visible, onDiscuss, onCard }: { visible: boolean; onDiscuss?: OnDiscuss; onCard: () => void }) {
  const [list, setList] = useState<TodoView[]>([])
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [pri, setPri] = useState<Priority>(2)
  const [{ group, sort }, setView] = useState(readPref)
  const [q, setQ] = useState('')
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const stopPicking = () => { setPicking(false); setPicked(new Set()) }
  const moveToTomorrow = async () => { await window.api.todos.setDue([...picked], tomorrow()); stopPicking() }
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
    await window.api.todos.add({ title: title.trim(), ...(due ? { due } : {}), priority: pri })
    setTitle(''); setDue(''); setPri(2)
  }
  const match = (t: TodoView) => !q.trim() || `${t.title} ${t.events.map(e => e.text).join(' ')}`.toLowerCase().includes(q.trim().toLowerCase())
  const open = list.filter(t => t.status === 'open' && match(t))
  const closed = sortTodos(list.filter(t => t.status !== 'open' && match(t)), 'newest').sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-3.5 pb-3.5 flex flex-col gap-2.5">
      <style>{STORM_CSS}</style>
      <div className="flex gap-1.5 pt-1">
        <input value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void add() }} placeholder="Note a todo… (or say 记一下 in Chat)" aria-label="New todo"
          className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-bg-primary border border-border text-[13px] text-text-primary focus:outline-none focus:border-accent" />
        <span role="radiogroup" aria-label="Pick priority" className="inline-flex rounded-lg bg-bg-primary border border-border p-0.5">
          {PRIORITIES.map(x => (
            <button key={x.p} role="radio" aria-checked={pri === x.p} aria-label={x.name} title={`${x.name} · ${x.hint}`} onClick={() => setPri(x.p)}
              className={`w-7 rounded-md text-[13px] cursor-pointer ${pri === x.p ? (x.p === 1 ? 'bg-red-500/20' : 'bg-bg-hover') : 'opacity-50 hover:opacity-100'}`}>
              <span className={pri === x.p && x.p === 1 ? 'hive-storm-bolt' : ''} aria-hidden>{x.icon}</span>
            </button>
          ))}
        </span>
        <input type="date" value={due} onChange={e => setDue(e.target.value)} aria-label="Due date" className="w-[118px] px-1.5 rounded-lg bg-bg-primary border border-border text-[12px] text-text-secondary" />
        <button onClick={add} disabled={!title.trim()} className="px-3 rounded-lg bg-accent text-text-on-purple text-[12px] font-semibold cursor-pointer disabled:opacity-50">Add</button>
      </div>
      <div className="flex items-center gap-1.5 text-[11.5px] text-text-muted">
        Group <select value={group} onChange={e => pick({ group: e.target.value as GroupBy })} aria-label="Group by" className={sel}><option value="created">Created</option><option value="source">Source</option><option value="due">Due</option><option value="priority">Priority</option></select>
        Sort <select value={sort} onChange={e => pick({ sort: e.target.value as SortBy })} aria-label="Sort by" className={sel}><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="due">Due date</option></select>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search" aria-label="Search todos" className={`${sel} flex-1 min-w-0`} />
        {open.length > 0 && !picking && <button onClick={() => setPicking(true)} className={`${sel} cursor-pointer hover:text-text-primary`}>Select</button>}
      </div>
      {picking && (
        <div role="toolbar" aria-label="Selected todos" className="sticky top-0 z-10 flex items-center gap-1 px-2 py-1.5 rounded-xl bg-bg-secondary border border-border shadow-sm text-[12px]">
          <span className="px-1 font-semibold text-text-primary">{picked.size} selected</span>
          <button onClick={() => setPicked(new Set(picked.size === open.length ? [] : open.map(t => t.id)))} className={ghost}>{picked.size === open.length ? 'None' : 'All'}</button>
          <span className="flex-1" />
          {PRIORITIES.map(x => (
            <button key={x.p} disabled={!picked.size} onClick={async () => { await window.api.todos.setPriority([...picked], x.p); stopPicking() }} aria-label={`Set ${x.name}`} title={`Set ${x.name}`} className={`${ghost} disabled:opacity-40`}>{x.icon}</button>
          ))}
          <button onClick={moveToTomorrow} disabled={!picked.size} className={`${primary} disabled:opacity-50`}>Move to tomorrow</button>
          <button onClick={stopPicking} className={`${ghost} text-text-muted`}>Cancel</button>
        </div>
      )}
      {!open.length && <div className="text-[12px] text-text-muted px-1">{q ? 'Nothing matches' : 'Nothing to do · Butler adds what it promised to follow up'}</div>}
      {groupTodos(open, group, sort).map(g => (
        <div key={g.label} className="flex flex-col gap-1.5" role="group" aria-label={g.label}>
          <div className="px-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">{g.label} · {g.items.length}</div>
          <AnimatePresence initial={false} mode="popLayout">{g.items.map(t => <Item key={t.id} t={t} onDiscuss={onDiscuss} onCard={onCard} picked={picking ? { on: picked.has(t.id), toggle: () => toggle(t.id) } : undefined} />)}</AnimatePresence>
        </div>
      ))}
      {closed.length > 0 && (
        <details className="border-t border-border pt-2" aria-label="Completed">
          <summary className="cursor-pointer px-1 text-[12px] font-semibold text-text-muted">Completed · <motion.span key={closed.length} className="inline-block" initial={{ scale: 1.3 }} animate={{ scale: 1 }} transition={SNAPPY} style={{ fontVariantNumeric: 'tabular-nums' }}>{closed.length}</motion.span></summary>
          <div className="mt-1.5 flex flex-col gap-1.5"><AnimatePresence initial={false} mode="popLayout">{closed.map(t => <Item key={t.id} t={t} onDiscuss={onDiscuss} onCard={onCard} />)}</AnimatePresence></div>
        </details>
      )}
    </div>
  )
}
