import { PROFILE_FRONT, PROFILE_MORE, acceptPlaceholderOnTab, openSkill } from '../../lib/butler-skills'
import { useEffect, useRef, useState } from 'react'
import { ButlerSettings } from '../ButlerSettings'
import { FeishuConnection } from '../FeishuConnection'
import { FeishuAgentQuick } from './FeishuAgent'
import { CalendarConnect } from './CalendarSettings'
import { PALETTES, PALETTE_META, STYLES, STYLE_META, type Palette, type Style } from '../../palette'
import { SETUP_STEPS, groupStarts, type SetupMark } from '../../lib/butler-setup'
import { WizardEmail } from './WizardEmail'
import { DailyRoutine } from './DailyRoutine'

interface Props {
  startAt: number
  marks: Record<string, SetupMark>
  palette: Palette
  style: Style
  projectCount: number
  openaiKey: string
  onPalette: (p: Palette) => void
  onStyle: (s: Style) => void
  onOpenaiKey: (k: string) => void
  onAddProject: () => void
  onMark: (step: string, mark: SetupMark) => void
  onAskButler: () => void
  onClose: () => void
}

const SAY: Record<string, string> = {
  welcome: 'Hi, I’m Butler', claude: 'The engine', project: 'Pick a folder', theme: 'Try one',
  voice: 'Talk instead of typing', about: 'So I sound like you', phone: 'Check in from anywhere',
  feishu: 'Answer for you', calendar: 'Plan around meetings', done: 'Top-right, any time'
}
const TITLE: Record<string, string> = {
  welcome: 'Welcome to Hive', claude: 'Claude Code', project: 'First project', theme: 'Theme', voice: 'Voice',
  about: 'About you', phone: 'Phone', feishu: 'Feishu', calendar: 'Calendar', done: 'Ready'
}
// [butler:mail-routines]
Object.assign(SAY, { email: 'Sort & draft', routine: 'Every day, even with Hive closed' })
Object.assign(TITLE, { email: 'Email', routine: 'Daily routine' })
const STYLE_OPTS = [['direct', 'Direct'], ['warm', 'Warm'], ['formal', 'Formal']] as const

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-bg-primary text-[13px] text-text-primary">{children}</div>
}
function Field({ label, value, onChange, placeholder, multiline }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean }) {
  if (multiline) return (
    <label className="col-span-2 flex flex-col gap-1 text-[11px] font-semibold text-text-muted">
      {label}
      <textarea value={value} placeholder={placeholder} rows={3} onChange={e => onChange(e.target.value)}
        onKeyDown={e => acceptPlaceholderOnTab(e, value, placeholder, onChange)}
        className="px-2.5 py-1.5 rounded-lg bg-bg-secondary border border-border text-[13px] font-medium text-text-primary focus:outline-none focus:border-accent resize-y" />
    </label>
  )
  return (
    <label className="flex flex-col gap-1 text-[11px] font-semibold text-text-muted">
      {label}
      <input value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)}
        onKeyDown={e => acceptPlaceholderOnTab(e, value, placeholder, onChange)}
        className="px-2.5 py-1.5 rounded-lg bg-bg-secondary border border-border text-[13px] font-medium text-text-primary focus:outline-none focus:border-accent" />
    </label>
  )
}

/** First-run setup, one step per screen; every step can be skipped. */
export function ButlerWizard(p: Props) {
  const [cur, setCur] = useState(p.startAt)
  const [auth, setAuth] = useState<{ loggedIn: boolean; authMethod: string } | null>(null)
  const [profile, setProfile] = useState<Record<string, string>>({})
  const routineCommit = useRef<(() => Promise<void>) | null>(null)
  const step = SETUP_STEPS[cur]
  const starts = groupStarts()
  const last = cur === SETUP_STEPS.length - 1

  useEffect(() => { window.api.butler.profile().then(setProfile).catch(() => {}) }, [])
  useEffect(() => {
    if (step.id !== 'claude') return
    setAuth(null)
    window.api.claude.auth().then(a => setAuth({ loggedIn: a.loggedIn, authMethod: a.authMethod })).catch(() => setAuth({ loggedIn: false, authMethod: '' }))
  }, [step.id])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') p.onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [p])

  const setP = (k: string, v: string) => setProfile(prev => ({ ...prev, [k]: v }))
  const go = (i: number) => setCur(Math.max(0, Math.min(SETUP_STEPS.length - 1, i)))
  const next = async () => {
    if (step.id === 'about') await window.api.butler.saveProfile(profile)
    if (step.id === 'routine') await routineCommit.current?.()
    if (!step.framing) p.onMark(step.id, 'done')
    if (last) p.onClose(); else go(cur + 1)
  }
  const skip = () => { if (!step.framing) p.onMark(step.id, 'skipped'); go(cur + 1) }

  let body: React.ReactNode = null
  if (step.id === 'welcome') body = (
    <>
      <Row>🐝 <span className="font-semibold">Many Claude Code agents, one per role</span></Row>
      <Row>🎩 <span className="font-semibold">I’m top-right, always</span></Row>
      <Row>⏱ <span className="font-semibold">~2 min · skip anything</span></Row>
    </>
  )
  else if (step.id === 'claude') body = (
    <>
      <Row><span className="w-[7px] h-[7px] rounded-full bg-status-working" /><span className="flex-1 font-semibold">Installed</span></Row>
      <Row>
        <span className={`w-[7px] h-[7px] rounded-full ${!auth ? 'bg-status-done' : auth.loggedIn ? 'bg-status-working' : 'bg-status-waiting'}`} />
        <span className="flex-1 font-semibold">{!auth ? 'Checking…' : auth.loggedIn ? `Signed in · ${auth.authMethod || 'account'}` : 'Not signed in'}</span>
        {auth && !auth.loggedIn && <code className="px-2 py-0.5 rounded-md bg-bg-secondary text-[11px]">claude auth login</code>}
      </Row>
      {auth?.loggedIn && auth.authMethod && auth.authMethod !== 'claude.ai' && (
        <Row><span className="flex-1 text-text-muted">Phone control needs a claude.ai account</span></Row>
      )}
    </>
  )
  else if (step.id === 'project') body = (
    <>
      <Row><span className="flex-1 font-semibold">{p.projectCount ? `${p.projectCount} project${p.projectCount === 1 ? '' : 's'}` : 'No projects yet'}</span>
        <button onClick={p.onAddProject} className="px-3 py-1 rounded-lg bg-accent text-text-on-purple text-[12px] font-semibold cursor-pointer">Add project</button></Row>
    </>
  )
  else if (step.id === 'theme') body = (
    <>
      <div className="grid grid-cols-3 gap-2">
        {PALETTES.map(id => (
          <button key={id} onClick={() => p.onPalette(id)} aria-pressed={p.palette === id}
            className={`p-2.5 rounded-xl border-2 text-left cursor-pointer bg-bg-primary ${p.palette === id ? 'border-accent' : 'border-transparent'}`}>
            <span className="block h-9 rounded-lg mb-1.5" style={{ background: PALETTE_META[id].swatch }} />
            <span className="text-[12px] font-semibold text-text-primary">{PALETTE_META[id].name}</span>
          </button>
        ))}
      </div>
      <div className="inline-flex self-start gap-0.5 p-[3px] rounded-[10px] bg-bg-primary">
        {STYLES.map(id => (
          <button key={id} onClick={() => p.onStyle(id)} aria-pressed={p.style === id}
            className={`px-3 py-1 rounded-lg text-[12px] font-semibold cursor-pointer ${p.style === id ? 'bg-bg-secondary text-text-primary shadow-sm' : 'text-text-muted'}`}>{STYLE_META[id].name}</button>
        ))}
      </div>
    </>
  )
  else if (step.id === 'voice') body = (
    <>
      <Row>🎙 <span className="flex-1 font-semibold">Mic button in every chat</span></Row>
      <Field label="OpenAI key · optional · 中英混说" value={p.openaiKey} onChange={p.onOpenaiKey} placeholder="sk-…" />
    </>
  )
  else if (step.id === 'about') body = (
    <>
      <div className="grid grid-cols-2 gap-2.5">
        {PROFILE_FRONT.slice(0, 2).map(([k, label, ph]) => <Field key={k} label={label} value={profile[k] || ''} placeholder={ph} onChange={v => setP(k, v)} />)}
      </div>
      <div className="inline-flex self-start gap-0.5 p-[3px] rounded-[10px] bg-bg-primary" role="radiogroup" aria-label="Style">
        {STYLE_OPTS.map(([id, label]) => (
          <button key={id} role="radio" aria-checked={(profile.style || 'direct') === id} onClick={() => setP('style', id)}
            className={`px-3 py-1 rounded-lg text-[12px] font-semibold cursor-pointer ${(profile.style || 'direct') === id ? 'bg-bg-secondary text-text-primary shadow-sm' : 'text-text-muted'}`}>{label}</button>
        ))}
      </div>
      {PROFILE_FRONT.slice(2, 3).map(([k, label, ph]) => <Field key={k} label={label} value={profile[k] || ''} placeholder={ph} onChange={v => setP(k, v)} />)}
      <details>
        <summary className="cursor-pointer text-[12px] font-semibold text-text-muted">More</summary>
        <div className="grid grid-cols-2 gap-2.5 mt-2">
          {[...PROFILE_FRONT.slice(3), ...PROFILE_MORE].map(([k, label, ph]) => <Field key={k} label={label} value={profile[k] || ''} placeholder={ph} multiline={k === 'extra'} onChange={v => setP(k, v)} />)}
        </div>
      </details>
    </>
  )
  else if (step.id === 'phone') body = <ButlerSettings />
  else if (step.id === 'feishu') body = <><FeishuConnection /><FeishuAgentQuick /></>
  else if (step.id === 'calendar') body = <CalendarConnect />
  else if (step.id === 'email') body = <WizardEmail />
  else if (step.id === 'routine') body = <DailyRoutine framed={false} commitRef={routineCommit} />
  else if (step.id === 'done') body = (
    <>
      {SETUP_STEPS.filter(s => !s.framing).map(s => (
        <Row key={s.id}>
          <span className={`w-[7px] h-[7px] rounded-full ${p.marks[s.id] === 'done' ? 'bg-status-working' : 'bg-status-done'}`} />
          <span className="flex-1 font-semibold">{s.name}</span>
          <span className="text-[11px] text-text-muted">{p.marks[s.id] === 'done' ? 'done' : 'later'}</span>
        </Row>
      ))}
      <Row><span className="flex-1 font-semibold">🧩 Skills · how each job is done</span>
        <button onClick={() => openSkill(null)} className="px-2.5 py-1 rounded-lg bg-bg-secondary border border-border text-[12px] font-semibold cursor-pointer">Open</button></Row>
      <Row><span className="flex-1 font-semibold">⚙️ Change later</span><span className="text-[11px] text-text-muted">App Settings · or ask me</span></Row>
    </>
  )

  return (
    <div className="no-drag fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={p.onClose} />
      <div role="dialog" aria-modal="true" aria-label="Butler setup"
        className="hive-card relative w-[780px] max-w-[94vw] h-[580px] max-h-[90vh] grid grid-cols-[200px_1fr] grid-rows-[minmax(0,1fr)] overflow-hidden">
        <nav className="bg-bg-primary p-3 flex flex-col gap-px overflow-y-auto" aria-label="Setup steps">
          <div className="flex items-center gap-2 px-1.5 pb-2.5 text-[14px] font-bold text-text-primary">🎩 Butler</div>
          {SETUP_STEPS.map((s, i) => (
            <div key={s.id}>
              {starts.has(i) && <div className="px-2.5 pt-2 pb-0.5 text-[10px] font-bold uppercase tracking-wider text-text-muted/60">{s.group}</div>}
              <button onClick={() => go(i)} aria-current={i === cur ? 'step' : undefined}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] text-left cursor-pointer ${i === cur ? 'bg-bg-secondary text-text-primary font-semibold shadow-sm' : p.marks[s.id] === 'done' ? 'text-text-secondary' : 'text-text-muted'}`}>
                <span className={`w-[18px] h-[18px] rounded-full border-[1.5px] text-[10px] font-bold flex items-center justify-center flex-shrink-0 ${p.marks[s.id] === 'done' && i !== cur ? 'bg-accent border-accent text-white' : i === cur ? 'border-accent text-accent' : 'border-text-muted/50'}`}>
                  {p.marks[s.id] === 'done' && i !== cur ? '✓' : i + 1}
                </span>
                {s.name}
              </button>
            </div>
          ))}
        </nav>
        <div className="p-7 pb-5 flex flex-col min-w-0 min-h-0">
          <div className="flex items-center gap-2 text-[13px] text-text-secondary">
            <span className="w-[22px] h-[22px] rounded-full bg-accent-subtle inline-flex items-center justify-center text-[13px]">🎩</span>
            <span className="px-3 py-1 rounded-[4px_12px_12px_12px] bg-bg-primary">{SAY[step.id]}</span>
          </div>
          <h2 className="text-[22px] font-bold tracking-tight text-text-primary mt-4 mb-3.5">{TITLE[step.id]}</h2>
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2.5">{body}</div>
          <div className="flex items-center justify-between pt-3">
            <div className="flex gap-1" aria-hidden>
              {SETUP_STEPS.map((s, i) => <i key={s.id} className={`block h-1.5 rounded-full ${i === cur ? 'w-4 bg-accent' : 'w-1.5 bg-border'}`} />)}
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={p.onAskButler} className="px-2 text-[12px] font-semibold text-accent cursor-pointer">Ask Butler</button>
              {!last && <button onClick={skip} className="px-3.5 py-2 rounded-lg text-[13px] font-semibold text-text-muted cursor-pointer">Skip</button>}
              {cur > 0 && <button onClick={() => go(cur - 1)} className="px-3.5 py-2 rounded-lg bg-bg-primary text-[13px] font-semibold text-text-primary cursor-pointer">Back</button>}
              <button onClick={next} className="px-4 py-2 rounded-lg bg-accent text-text-on-purple text-[13px] font-semibold cursor-pointer">{last ? 'Finish' : 'Next'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
