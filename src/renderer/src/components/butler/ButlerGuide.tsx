import { useState } from 'react'
import { GUIDE, guideLang, setGuideLang, type GuideLang } from '../../lib/butler-guide'

/** Butler › ? : one page of "what you want → what to say", each line one click from the Chat. */
export function ButlerGuide({ onClose, onTry }: { onClose: () => void; onTry: (text: string) => void }) {
  const [lang, setLang] = useState<GuideLang>(guideLang)
  const g = GUIDE[lang]
  const pick = (l: GuideLang) => { setLang(l); setGuideLang(l) }
  return (
    <div role="dialog" aria-label="How to use Butler" className="absolute inset-x-0 bottom-0 top-[52px] z-20 bg-bg-secondary overflow-y-auto px-4 pb-4 flex flex-col gap-3">
      <div className="flex items-center gap-2 pt-1">
        <h3 className="flex-1 text-[15px] font-semibold text-text-primary">{g.title}</h3>
        <span className="inline-flex p-0.5 rounded-lg bg-bg-primary" role="radiogroup" aria-label="Language">
          {(['zh', 'en'] as GuideLang[]).map(l => (
            <button key={l} role="radio" aria-checked={lang === l} onClick={() => pick(l)}
              className={`px-2 py-0.5 rounded-md text-[11px] cursor-pointer ${lang === l ? 'bg-bg-secondary text-text-primary font-semibold shadow-sm' : 'text-text-muted'}`}>{l === 'zh' ? '中' : 'EN'}</button>
          ))}
        </span>
        <button onClick={onClose} aria-label="Close guide" className="w-7 h-7 rounded-lg text-text-muted hover:bg-bg-hover cursor-pointer">✕</button>
      </div>
      <p className="-mt-2 text-[12px] text-text-muted">{g.hint}</p>
      <div className="rounded-xl bg-bg-primary px-3">
        {g.rows.map(r => (
          <div key={r.say} className="flex items-center gap-2.5 py-2 border-b border-border last:border-b-0 text-[12.5px]">
            <span className="w-[86px] flex-shrink-0 text-[12px] text-text-muted">{r.what}</span>
            <span className="flex-1 min-w-0 text-text-primary">{r.say}</span>
            <button onClick={() => onTry(r.say)} aria-label={`Try: ${r.say}`} className="px-2 py-0.5 rounded-md bg-bg-secondary text-[11px] font-semibold text-accent cursor-pointer">{lang === 'zh' ? '试试' : 'Try'}</button>
          </div>
        ))}
      </div>
      <div>
        <h3 className="text-[13px] font-semibold text-text-primary">{g.autoTitle}</h3>
        <ul className="mt-1 list-disc pl-4 text-[12px] text-text-secondary leading-relaxed">{g.auto.map(a => <li key={a}>{a}</li>)}</ul>
      </div>
    </div>
  )
}
