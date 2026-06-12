import Link from 'next/link'

export const metadata = {
  title: 'Legal & Attribution — GRANDSLAM',
}

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-[#0d0d1a] text-white px-6 py-14">
      <div className="max-w-lg mx-auto flex flex-col gap-10">

        {/* Header */}
        <div>
          <Link href="/" className="text-xs text-white/30 hover:text-white/60 transition-colors">
            ← GRANDSLAM
          </Link>
          <h1 className="mt-4 text-2xl font-black tracking-tight">Legal &amp; Attribution</h1>
        </div>

        {/* Disclaimer */}
        <section className="flex flex-col gap-2">
          <h2 className="text-[10px] tracking-[0.4em] uppercase text-white/30">Disclaimer</h2>
          <p className="text-sm text-white/70 leading-relaxed">
            GRANDSLAM is an unofficial fan-made project. It is not affiliated with, endorsed by,
            or associated with Riot Games, Inc. League of Legends and all related properties
            are trademarks of Riot Games.
          </p>
        </section>

        {/* Data Source */}
        <section className="flex flex-col gap-2">
          <h2 className="text-[10px] tracking-[0.4em] uppercase text-white/30">Data Source</h2>
          <p className="text-sm text-white/70 leading-relaxed">
            Player and team data (tournament results, rosters, awards) are sourced from the{' '}
            <a
              href="https://lol.fandom.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/50 underline underline-offset-2 hover:text-white/80 transition-colors"
            >
              Leaguepedia
            </a>{' '}
            Cargo API.
          </p>
        </section>

        {/* Image License */}
        <section className="flex flex-col gap-2">
          <h2 className="text-[10px] tracking-[0.4em] uppercase text-white/30">Player Images</h2>
          <p className="text-sm text-white/70 leading-relaxed">
            Player images are sourced from{' '}
            <a
              href="https://lol.fandom.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/50 underline underline-offset-2 hover:text-white/80 transition-colors"
            >
              Leaguepedia
            </a>
            , licensed under{' '}
            <a
              href="https://creativecommons.org/licenses/by-sa/4.0/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/50 underline underline-offset-2 hover:text-white/80 transition-colors"
            >
              CC BY-SA 4.0
            </a>
            . Original images and contributors are listed on each player&apos;s Leaguepedia page.
          </p>
        </section>

        {/* Analytics */}
        <section className="flex flex-col gap-2">
          <h2 className="text-[10px] tracking-[0.4em] uppercase text-white/30">Analytics</h2>
          <p className="text-sm text-white/70 leading-relaxed">
            We use analytics to improve the experience. No personal data is collected or sold.
          </p>
        </section>

        {/* Rating Methodology */}
        <section className="flex flex-col gap-2">
          <h2 className="text-[10px] tracking-[0.4em] uppercase text-white/30">Rating System</h2>
          <p className="text-sm text-white/70 leading-relaxed">
            Player OVR ratings are computed from tournament placement (domestic, MSI, Worlds),
            individual awards (MVP, All-Pro), and editorial adjustments for era fairness.
            Ratings reflect historical peak performance and are not official Riot metrics.
          </p>
        </section>

        {/* Contact */}
        <section className="flex flex-col gap-2">
          <h2 className="text-[10px] tracking-[0.4em] uppercase text-white/30">Contact</h2>
          <p className="text-sm text-white/70">
            <a
              href="mailto:parkhb1181@gmail.com"
              className="text-white/50 underline underline-offset-2 hover:text-white/80 transition-colors"
            >
              parkhb1181@gmail.com
            </a>
          </p>
        </section>

      </div>
    </main>
  )
}
