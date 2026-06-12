// Home page — Start button + description (PRD §3)
import Link from 'next/link'

export default function Home() {
  return (
    <main className="min-h-screen bg-[#0d0d1a] text-white flex flex-col items-center justify-center px-6">
      <div className="text-center max-w-sm w-full">
        {/* Tagline */}
        <p className="text-[10px] tracking-[0.5em] text-white/20 uppercase mb-8">
          LoL All-Time Draft Simulator
        </p>

        {/* Title */}
        <h1 className="text-[88px] sm:text-[108px] font-black leading-none tracking-tighter mb-8 text-white">
          GRAND<br />SLAM
        </h1>

        {/* Description */}
        <p className="text-white/30 text-sm leading-relaxed mb-10">
          Draft the greatest players of all time<br />
          and compete for the World Championship
        </p>

        {/* Start button */}
        <Link
          href="/draft"
          className="block w-full py-4 bg-white text-[#0d0d1a] font-black text-sm tracking-[0.2em] uppercase rounded-xl hover:bg-white/90 active:scale-95 transition-all"
        >
          Draft Start
        </Link>

        {/* Secondary link */}
        <div className="mt-6 text-xs text-white/20">
          <Link href="/about" className="hover:text-white/50 transition-colors">
            Rating System →
          </Link>
        </div>
      </div>
    </main>
  )
}
