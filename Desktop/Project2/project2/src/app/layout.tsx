import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'GRANDSLAM — LoL All-Time Draft',
  description: 'Build your all-time LoL roster and simulate a season.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
