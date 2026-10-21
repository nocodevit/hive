import { useCallback, useEffect, useRef, useState } from 'react'
import {
  OPEN_SKILL_EVENT, TONE_OPTS, chipLabel, cleanOverlay, foldDiff, isIpcError, sameOverlay, skillMeta, takePendingSkill,
  type DiffLine, type EditProposal, type LintProblem, type SkillDetail, type SkillInfo, type SkillOverlay
} from '../../lib/butler-skills'
import { Field, sectionLabel, summaryCls } from './AboutMeSettings'

export { AboutMeSettings } from './AboutMeSettings'

const btnP = 'px-3 py-1 rounded-lg bg-accent text-text-on-purple text-[12px] font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-default'
const btnS = 'px-3 py-1 rounded-lg bg-bg-primary text-text-primary text-[12px] font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-default'
const link = 'text-[12px] font-semibold text-accent cursor-pointer hover:underline'
const area = 'w-full rounded-lg bg-bg-primary border border-border px-2.5 py-2 text-[12px] text-text-primary focus:outline-none focus:border-accent resize-y'

function Diff({ lines }: { lines: DiffLine[] }) {
  return (
    <pre className="mt-2 rounded-lg bg-bg-primary px-2.5 py-2 text-[11px] leading-relaxed font-mono whitespace-pre-wrap max-h-64 overflow-y-auto">
      {foldDiff(lines).map((l, i) => (
        <div key={i} className={l.op === '+' ? 'text-green-500' : l.op === '-' ? 'text-red-400' : 'text-text-muted'}>
          {l.op === '…' ? '…' : `${l.op} ${l.text}`}
        </div>
      ))}
    </pre>
  )
}

function Problems({ items }: { items: LintProblem[] }) {
  if (!items.length) return null
  return <ul className="text-[11px] text-red-400 font-mono">{items.map((p, i) => <li key={i}>✕ {p.message}</li>)}</ul>
}

/** App Settings → Skills: list left, editor right. Tone + "Ask me first" up front, the rest folded. */
export function SkillsSettings() {
  const [list, setList] = useState<SkillInfo[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [d, setD] = useState<SkillDetail | null>(null)
  const [form, setForm] = useState<SkillOverlay>({})
  const [adding, setAdding] = useState<string | null>(null)
  const [md, setMd] = useState('')
  const [problems, setProblems] = useState<LintProblem[]>([])
  const [compare, setCompare] = useState<DiffLine[] | null>(null)
  const [trying, setTrying] = useState(false)
  const [sample, setSample] = useState('')
  const [tryOut, setTryOut] = useState<{ ok: boolean; text: string } | null>(null)
  const [ask, setAsk] = useState('')
  const [proposal, setProposal] = useState<EditProposal | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const refreshList = useCallback(async () => {
    const r = await window.api.butlerSkills.list()
    if (isIpcError(r)) { setErr(r.error); return }
    setList(r)
    setSel(s => s ?? r[0]?.id ?? null)
  }, [])
  const show = (r: SkillDetail) => {
    setD(r); setForm(r.overlay); setMd(r.override ?? r.effective); setProblems([]); setCompare(null)
  }
  useEffect(() => { refreshList().catch(() => {}) }, [refreshList])
  // "Skill ›" elsewhere: select it here and bring the section into view.
  const rootRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const go = (id: string | null) => {
      if (id) setSel(id)
      setTimeout(() => rootRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50)
    }
    const pending = takePendingSkill()
    if (pending !== undefined) go(pending)
    const on = (e: Event) => { takePendingSkill(); go((e as CustomEvent<string | null>).detail ?? null) }
    window.addEventListener(OPEN_SKILL_EVENT, on)
    return () => window.removeEventListener(OPEN_SKILL_EVENT, on)
  }, [])
  useEffect(() => {
    if (!sel) return
    setProposal(null); setTryOut(null); setTrying(false); setAsk(''); setSample(skillMeta(sel).sample); setErr('')
    window.api.butlerSkills.get(sel).then(r => { if (isIpcError(r)) setErr(r.error); else show(r) }).catch(() => {})
  }, [sel])

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setErr('')
    try { await fn() } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }
  const after = async (r: SkillDetail | { ok: false; error: string }) => {
    if (isIpcError(r)) { setErr(r.error); return }
    show(r); await refreshList()
  }

  if (!list.length && !err) return null
  const meta = d ? skillMeta(d.id) : null
  const advanced = d?.customized === 'override'
  const formDirty = d ? !sameOverlay(form, d.overlay) : false
  const userChips = form.extraAskFirst ?? []

  const saveForm = () => d && run('save', async () => after(await window.api.butlerSkills.saveOverlay(d.id, cleanOverlay(form, d.locked))))
  const saveMd = (text: string) => d && run('md', async () => {
    const r = await window.api.butlerSkills.saveOverride(d.id, text)
    if (!r.ok) { setProblems(r.problems ?? []); if (r.error) setErr(r.error); return }
    setProposal(null)
    await after(await window.api.butlerSkills.get(d.id))
  })
  const reset = () => d && run('reset', async () => after(await window.api.butlerSkills.reset(d.id)))
  const doCompare = () => d && run('cmp', async () => {
    const r = await window.api.butlerSkills.compare(d.id)
    if (isIpcError(r)) setErr(r.error); else setCompare(r.diff)
  })
  const doTry = () => d && run('try', async () => {
    const r = await window.api.butlerSkills.tryIt(d.id, sample, proposal?.md)
    setTryOut({ ok: r.ok, text: r.ok ? r.output ?? '' : r.error ?? 'failed' })
  })
  const doPropose = () => d && ask.trim() && run('ask', async () => setProposal(await window.api.butlerSkills.propose(d.id, ask)))
  const addChip = () => {
    const v = (adding ?? '').trim()
    if (v) setForm(f => ({ ...f, extraAskFirst: [...(f.extraAskFirst ?? []), v] }))
    setAdding(null)
  }

  return (
    <div ref={rootRef}>
      <label className={sectionLabel}>Skills</label>
      <div className="rounded-xl bg-bg-secondary border border-border flex min-h-[300px] overflow-hidden">
        <div className="w-40 shrink-0 border-r border-border p-1.5 flex flex-col gap-0.5" role="listbox" aria-label="Skills">
          {list.map(s => {
            const m = skillMeta(s.id)
            return (
              <button key={s.id} role="option" aria-selected={sel === s.id} onClick={() => setSel(s.id)}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-[12px] font-medium cursor-pointer ${sel === s.id ? 'bg-accent-subtle text-text-primary' : 'text-text-secondary hover:bg-bg-hover'}`}>
                <span aria-hidden>{m.icon}</span>
                <span className="flex-1 truncate">{m.label}</span>
                {s.customized !== 'none' && <span className={`w-1.5 h-1.5 rounded-full ${s.defaultUpdated ? 'bg-status-waiting' : 'bg-accent'}`} title="customized" aria-label="customized" />}
              </button>
            )
          })}
        </div>

        {d && meta && (
          <div className="flex-1 min-w-0 p-3 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <b className="flex-1 text-[14px] text-text-primary truncate">{meta.icon} {meta.label}</b>
              {d.customized === 'form' && <span className="px-2 py-0.5 rounded-full bg-accent-subtle text-accent text-[11px] font-semibold">customized</span>}
              {advanced && <span className="px-2 py-0.5 rounded-full bg-accent-subtle text-accent text-[11px] font-semibold">markdown</span>}
              {d.defaultUpdated && <span className="px-2 py-0.5 rounded-full bg-bg-primary text-status-waiting text-[11px] font-semibold">default updated</span>}
              <button className={btnS} onClick={() => setTrying(t => !t)} aria-expanded={trying}>Try</button>
              {!advanced && d.kind !== 'reference' && <button className={btnP} disabled={!formDirty || busy === 'save'} onClick={saveForm}>{busy === 'save' ? '…' : 'Save'}</button>}
            </div>

            {d.overrideProblems.length > 0 && <Problems items={d.overrideProblems} />}

            {trying && (
              <div className="rounded-lg bg-bg-primary p-2.5 flex flex-col gap-2">
                <textarea value={sample} onChange={e => setSample(e.target.value)} rows={3} aria-label="Sample input" placeholder="Sample input" className={area} />
                <div className="flex items-center gap-2">
                  <button className={btnP} disabled={!sample.trim() || busy === 'try'} onClick={doTry}>{busy === 'try' ? 'Running…' : proposal?.md ? 'Run new version' : 'Run'}</button>
                  <span className="text-[11px] text-text-muted">Nothing is sent</span>
                </div>
                {tryOut && <div className={`text-[12px] whitespace-pre-wrap ${tryOut.ok ? 'text-text-primary' : 'text-red-400 font-mono'}`} aria-label="Try result">{tryOut.text}</div>}
              </div>
            )}

            {d.kind === 'reference' ? (
              <div className="text-[12px] text-text-muted">Reference · facts the other skills read · edit below</div>
            ) : advanced ? (
              <div className="flex items-center gap-2 text-[12px] text-text-muted">
                <span className="flex-1">Edited as markdown</span>
                <button className={link} onClick={reset}>Reset</button>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Tone</span>
                  <div className="inline-flex self-start gap-0.5 p-[3px] rounded-[10px] bg-bg-primary" role="radiogroup" aria-label="Tone">
                    {TONE_OPTS.map(([id, label]) => (
                      <button key={id} role="radio" aria-checked={form.tone === id} onClick={() => setForm(f => ({ ...f, tone: f.tone === id ? undefined : id }))}
                        className={`px-3 py-1 rounded-lg text-[12px] font-semibold cursor-pointer ${form.tone === id ? 'bg-bg-secondary text-text-primary shadow-sm' : 'text-text-muted'}`}>{label}</button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Ask me first</span>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Ask me first">
                    {d.locked.map(l => (
                      <span key={l} title={l.replace(/^🔒\s*/u, '')} className="px-2.5 py-1 rounded-full bg-bg-hover text-text-muted text-[12px]">🔒 {chipLabel(l)}</span>
                    ))}
                    {userChips.map(c => (
                      <span key={c} className="pl-2.5 pr-1 py-1 rounded-full bg-bg-primary text-text-primary text-[12px] flex items-center gap-1">
                        {c}
                        <button aria-label={`Remove ${c}`} onClick={() => setForm(f => ({ ...f, extraAskFirst: userChips.filter(x => x !== c) }))}
                          className="w-4 h-4 rounded-full text-text-muted hover:bg-bg-hover cursor-pointer text-[10px]">✕</button>
                      </span>
                    ))}
                    {adding === null ? (
                      <button aria-label="Add ask-first item" onClick={() => setAdding('')}
                        className="px-2.5 py-1 rounded-full border border-dashed border-accent text-accent text-[12px] cursor-pointer">＋</button>
                    ) : (
                      <input autoFocus value={adding} aria-label="New ask-first item" placeholder="hiring"
                        onChange={e => setAdding(e.target.value)} onBlur={addChip}
                        onKeyDown={e => { if (e.key === 'Enter') addChip(); if (e.key === 'Escape') setAdding(null) }}
                        className="w-28 px-2.5 py-1 rounded-full bg-bg-primary border border-accent text-[12px] text-text-primary focus:outline-none" />
                    )}
                  </div>
                </div>
                <details>
                  <summary className={summaryCls}>More · length · language · instructions</summary>
                  <div className="flex flex-col gap-2.5 mt-2">
                    <div className="grid grid-cols-2 gap-2.5">
                      <Field label="Max length" value={form.maxLength ?? ''} placeholder="3 sentences" onChange={v => setForm(f => ({ ...f, maxLength: v }))} />
                      <Field label="Language" value={form.language ?? ''} placeholder="same as asker" onChange={v => setForm(f => ({ ...f, language: v }))} />
                    </div>
                    <label className="flex flex-col gap-1 text-[11px] font-semibold text-text-muted">
                      Extra
                      <textarea value={form.extra ?? ''} rows={2} onChange={e => setForm(f => ({ ...f, extra: e.target.value }))} className={area} />
                    </label>
                  </div>
                </details>
              </>
            )}

            <details open={d.defaultUpdated || d.kind === 'reference' || undefined}>
              <summary className={summaryCls}>Advanced · markdown{d.defaultUpdated ? ' · default updated ●' : ''}</summary>
              <div className="flex flex-col gap-2 mt-2">
                <textarea value={md} onChange={e => { setMd(e.target.value); setProblems([]) }} rows={12} aria-label="Skill markdown" className={`${area} font-mono text-[11px]`} />
                <Problems items={problems} />
                <div className="flex items-center gap-3">
                  <span className="flex-1 min-w-0 truncate font-mono text-[11px] text-text-muted" title={d.path}>{d.path}</span>
                  <button className={link} onClick={() => window.api.butlerSkills.reveal(d.id)}>Finder</button>
                  {d.customized !== 'none' && <button className={link} onClick={doCompare}>Compare</button>}
                  {d.customized !== 'none' && <button className={link} onClick={reset}>Reset</button>}
                  <button className={btnP} disabled={busy === 'md' || md === (d.override ?? d.effective)} onClick={() => saveMd(md)}>Save markdown</button>
                </div>
                {compare && (
                  <div>
                    <div className="flex items-center gap-2 text-[11px] text-text-muted"><span className="flex-1">− mine · ＋ new default</span>
                      {d.defaultUpdated && <button className={link} onClick={() => run('ack', async () => after(await window.api.butlerSkills.ackDefault(d.id)))}>Keep mine</button>}
                    </div>
                    <Diff lines={compare} />
                  </div>
                )}
              </div>
            </details>

            <div className="flex gap-2 mt-auto">
              <input value={ask} onChange={e => setAsk(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') doPropose() }}
                placeholder="Describe a change · 一句话改" aria-label="Describe a change"
                className="flex-1 px-2.5 py-1.5 rounded-lg bg-bg-primary border border-border text-[13px] text-text-primary focus:outline-none focus:border-accent" />
              <button className={btnS} disabled={!ask.trim() || busy === 'ask'} onClick={doPropose}>{busy === 'ask' ? '…' : 'Go'}</button>
            </div>

            {proposal && (
              <div className="rounded-lg border border-accent p-2.5 flex flex-col gap-2" aria-label="Proposed change">
                {!proposal.ok ? <div className="text-[12px] text-red-400 font-mono">{proposal.error}</div> : (
                  <>
                    <div className="flex flex-wrap gap-1.5 items-center">
                      {(proposal.chips ?? []).map(c => <span key={c} className="px-2.5 py-1 rounded-full bg-bg-primary text-text-primary text-[12px]">{c}</span>)}
                      {proposal.problems?.length ? null : <span className="px-2 py-0.5 rounded-full bg-green-500/15 text-green-500 text-[11px] font-semibold">✓ checks</span>}
                    </div>
                    <Problems items={proposal.problems ?? []} />
                    {proposal.example && <div className="rounded-lg bg-bg-primary px-2.5 py-2 text-[12px] text-text-primary whitespace-pre-wrap">{proposal.example}</div>}
                    <details>
                      <summary className={summaryCls}>Diff</summary>
                      <Diff lines={proposal.diff ?? []} />
                    </details>
                  </>
                )}
                <div className="flex justify-end gap-2">
                  <button className={btnS} onClick={() => setProposal(null)}>Discard</button>
                  {proposal.ok && <button className={btnP} disabled={!!proposal.problems?.length || busy === 'md'} onClick={() => proposal.md && saveMd(proposal.md)}>Accept</button>}
                </div>
              </div>
            )}

            {err && <div className="text-[11px] text-red-400 font-mono">{err}</div>}
          </div>
        )}
      </div>
    </div>
  )
}
