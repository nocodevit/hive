import { useEffect, useState } from 'react'

export type SpeechLang = 'zh-CN' | 'en-US'

const KEY = 'hive-speech-lang'
const EVENT = 'hive:speech-lang'

export function getSpeechLang(): SpeechLang {
  try {
    return localStorage.getItem(KEY) === 'en-US' ? 'en-US' : 'zh-CN'
  } catch {
    return 'zh-CN'
  }
}

export function setSpeechLang(lang: SpeechLang) {
  try { localStorage.setItem(KEY, lang) } catch {}
  window.dispatchEvent(new CustomEvent(EVENT, { detail: lang }))
}

export function speechLangLabel(lang: SpeechLang) {
  return lang === 'zh-CN' ? '中' : 'EN'
}

// Both mic buttons (header + floating) share one setting and stay in sync.
export function useSpeechLang(): [SpeechLang, () => void] {
  const [lang, setLang] = useState<SpeechLang>(getSpeechLang)
  useEffect(() => {
    const onChange = (e: Event) => setLang((e as CustomEvent<SpeechLang>).detail)
    window.addEventListener(EVENT, onChange)
    return () => window.removeEventListener(EVENT, onChange)
  }, [])
  const toggle = () => setSpeechLang(lang === 'zh-CN' ? 'en-US' : 'zh-CN')
  return [lang, toggle]
}
