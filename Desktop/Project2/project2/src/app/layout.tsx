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
          {/* §10 면책 — 전 페이지 공통 */}
          <footer style={{ textAlign: 'center', padding: '1.5rem 1rem', fontSize: '0.625rem', color: '#6868a0', borderTop: '1px solid #2a2a4a', marginTop: '3rem' }}>
            GRANDSLAM is a fan-made project. Not affiliated with or endorsed by Riot Games.
            League of Legends is a trademark of Riot Games, Inc.
            <br />
            GRANDSLAM은 팬메이드 프로젝트입니다. Riot Games와 무관합니다.
          </footer>
        </LangProvider>
      </body>
    </html>
  )
}
