'use client'
// English-only — i18n removed, KO toggle removed
import { en } from './en'

export function useLang() {
  return { t: en }
}

// Passthrough — retained for layout.tsx import compatibility
export function LangProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
