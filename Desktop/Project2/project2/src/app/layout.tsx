import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/next'
import './globals.css'

const BASE_URL = 'https://grandslamlol.vercel.app'

export const metadata: Metadata = {
  title: 'GRANDSLAM',
  description: 'Draft the greatest League of Legends players of all time and compete for the World Championship.',
  metadataBase: new URL(BASE_URL),
  openGraph: {
    title: 'GRANDSLAM — LoL All-Time Draft Simulator',
    description: 'Draft the greatest League of Legends players of all time and compete for the World Championship.',
    url: BASE_URL,
    siteName: 'GRANDSLAM',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'GRANDSLAM' }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'GRANDSLAM — LoL All-Time Draft Simulator',
    description: 'Draft the greatest League of Legends players of all time and compete for the World Championship.',
    images: ['/og-image.png'],
  },
  verification: {
    google: 'jg_M-Yy2R7r62UJFFUvHj6jrkmjG9qdLFTd9-ZEzm28',
  },
}

export const viewport: Viewport = {
  themeColor: '#0a0a0f',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#0d0d1a]">
        {children}
        {/* §10 Disclaimer — all pages */}
        <footer className="border-t border-[#2a2a4a] mt-12 px-4 py-5 text-center text-[10px] text-[#6868a0] leading-relaxed">
          Unofficial fan project · Images:{' '}
          <a href="https://lol.fandom.com" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-white/40 transition-colors">
            Leaguepedia
          </a>{' '}
          (CC BY-SA 4.0) · Not affiliated with Riot Games
          <span className="mx-2 opacity-40">·</span>
          <a href="/about" className="underline underline-offset-2 hover:text-white/40 transition-colors">
            Legal
          </a>
        </footer>
        <Analytics />
        <SpeedInsights />
        <Script id="ms-clarity" strategy="afterInteractive">
          {`(function(c,l,a,r,i,t,y){
  c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
  t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
  y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
})(window, document, "clarity", "script", "x5vfsj5unv");`}
        </Script>
      </body>
    </html>
  )
}
