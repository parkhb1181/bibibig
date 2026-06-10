import type { Metadata } from 'next'
import './globals.css'
import { LangProvider } from '@/i18n'

export const metadata: Metadata = {
  title: 'GRANDSLAM — LoL All-Time Draft',
  description: 'Build your all-time LoL roster and simulate a season.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <LangProvider>
          {children}
        </LangProvider>
      </body>
    </html>
  )
}
