'use client'
// §6.3 i18n Context — 첫 렌더는 en 고정(서버 hydration 일치), mount 후 localStorage·navigator 반영

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { en } from './en'
import { ko } from './ko'

export type Lang = 'en' | 'ko'
// Dict는 en과 ko의 공통 구조로 — 각 값이 string | function이면 충분
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Dict = Record<string, any>

const dicts: Record<Lang, Dict> = { en, ko }

type LangContextValue = {
  lang: Lang
  t: Dict
  setLang: (l: Lang) => void
}

const LangContext = createContext<LangContextValue>({
  lang: 'en',
  t: en,
  setLang: () => {},
})

export function LangProvider({ children }: { children: ReactNode }) {
  // §13.5: 첫 렌더 서버와 동일 → en 고정
  const [lang, setLangState] = useState<Lang>('en')

  useEffect(() => {
    // mount 후 localStorage → navigator 순으로 반영
    const stored = localStorage.getItem('lang') as Lang | null
    if (stored === 'en' || stored === 'ko') {
      setLangState(stored)
    } else if (navigator.language.startsWith('ko')) {
      setLangState('ko')
    }
  }, [])

  const setLang = (l: Lang) => {
    localStorage.setItem('lang', l)
    setLangState(l)
  }

  return (
    <LangContext.Provider value={{ lang, t: dicts[lang], setLang }}>
      {children}
    </LangContext.Provider>
  )
}

export function useLang() {
  return useContext(LangContext)
}
