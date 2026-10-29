'use client'

import t,{ Lang,TKeys } from '@/shared/i18n/translations'
import { createContext,useContext,useEffect,useState } from 'react'

interface LangCtxValue {
  lang: Lang
  setLang: (l: Lang) => void
  tr: (key: TKeys) => string
}

const LangCtx = createContext<LangCtxValue>({
  lang: 'kz',
  setLang: () => {},
  tr: k => t[k].kz,
})

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('kz')
  useEffect(() => {
    try { setLangState(localStorage.getItem('nstore-lang') === 'ru' ? 'ru' : 'kz') } catch {}
  }, [])

  function setLang(l: Lang) {
    setLangState(l)
    try { localStorage.setItem('nstore-lang', l) } catch {}
  }

  function tr(key: TKeys): string {
    return t[key][lang]
  }

  return <LangCtx.Provider value={{ lang, setLang, tr }}>{children}</LangCtx.Provider>
}

export const useLanguage = () => useContext(LangCtx)
