// §8.1 Shared result page — restore picks from URL params → simulate() recompute
// §8.2 generateMetadata: compute in Node runtime → pass display values to /api/og
// Invalid id/seed → redirect to home
import fs from 'fs'
import path from 'path'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { simulate } from '@/lib/sim'
import type { SimPlayer } from '@/lib/sim'

const ROLES = ['TOP', 'JGL', 'MID', 'ADC', 'SUP'] as const
type Role = typeof ROLES[number]

// Grade colors (same as draft/page.tsx)
const GRADE_COLOR: Record<string, string> = {
  'GRAND SLAM':   '#ffd700',
  'LEGENDARY':    '#c080ff',
  'ELITE':        '#60c0ff',
  'CONTENDER':    '#40d4a0',
  'PLAYOFF TEAM': '#e8e8f0',
  'REBUILD':      '#6868a0',
}

// Role colors
const ROLE_COLOR: Record<Role, string> = {
  TOP: '#ef9090',
  JGL: '#80e880',
  MID: '#80b8f0',
  ADC: '#f0d880',
  SUP: '#c888f0',
}

type PlayerRow = {
  id: string; playerId: string; nameEn: string
  team: string; year: number; ovr: number; role: string
}

// Shared data loader — used by both generateMetadata and page
function loadAndCompute(p: string, s: string) {
  const ids = p.split('.')
  const seed = parseInt(s, 10)
  if (ids.length !== 5 || ids.some(id => !id) || isNaN(seed)) return null

  try {
    const root = process.cwd()
    const players: PlayerRow[] = JSON.parse(
      fs.readFileSync(path.join(root, 'public', 'data', 'players.json'), 'utf-8')
    )
    const opponents = JSON.parse(
      fs.readFileSync(path.join(root, 'public', 'data', 'opponents-2026.json'), 'utf-8')
    )

    const playerMap = new Map(players.map(p => [p.id, p]))
    const picks: (SimPlayer | null)[] = ROLES.map((role, i) => {
      const pl = playerMap.get(ids[i])
      return pl ? { playerId: pl.playerId, role, ovr: pl.ovr } : null
    })
    if (picks.some(pk => pk === null)) return null

    const result = simulate(picks as SimPlayer[], opponents, seed)

    const playerInfos = ROLES.map((role, i) => {
      const pl = playerMap.get(ids[i])
      return {
        id: ids[i],
        name: pl?.nameEn ?? '?',
        team: pl?.team ?? '?',
        year: pl?.year ?? 0,
        ovr: pl?.ovr ?? 0,
        role,
      }
    })

    return { result, playerInfos, seed }
  } catch {
    return null
  }
}

// ── generateMetadata — §8.2 OG image generation ──────────────────────────────
export async function generateMetadata(
  { searchParams }: { searchParams: Promise<{ p?: string; s?: string }> }
): Promise<Metadata> {
  const { p = '', s = '' } = await searchParams
  const computed = loadAndCompute(p, s)
  if (!computed) return {}

  const { result, playerInfos } = computed
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'

  // §8.2: serialize via URLSearchParams — prevents missing encoding for spaces/special chars
  const params = new URLSearchParams({
    g:   result.grade,
    t:   result.trophies.join('|'),
    ovr: String(result.teamOvr),
    l1:  `${playerInfos[0].name}|${playerInfos[0].role}|${playerInfos[0].ovr}`,
    l2:  `${playerInfos[1].name}|${playerInfos[1].role}|${playerInfos[1].ovr}`,
    l3:  `${playerInfos[2].name}|${playerInfos[2].role}|${playerInfos[2].ovr}`,
    l4:  `${playerInfos[3].name}|${playerInfos[3].role}|${playerInfos[3].ovr}`,
    l5:  `${playerInfos[4].name}|${playerInfos[4].role}|${playerInfos[4].ovr}`,
  })

  const ogUrl   = `${base}/api/og?${params.toString()}`
  const title   = `GRANDSLAM — ${result.grade}`
  const desc    = `Team OVR ${result.teamOvr}${result.trophies.length > 0 ? ' · ' + result.trophies.join(' ') : ''}`

  return {
    title,
    description: desc,
    openGraph: {
      title,
      description: desc,
      images: [{ url: ogUrl, width: 1200, height: 630 }],
    },
    twitter: { card: 'summary_large_image', title, images: [ogUrl] },
  }
}

// ── Page component ────────────────────────────────────────────────────────────
export default async function ResultPage(
  { searchParams }: { searchParams: Promise<{ p?: string; s?: string }> }
) {
  const { p = '', s = '' } = await searchParams
  const computed = loadAndCompute(p, s)

  // §8.1: invalid id/seed → redirect to home
  if (!computed) redirect('/')

  const { result, playerInfos } = computed
  const gradeColor = GRADE_COLOR[result.grade] ?? '#e8e8f0'

  const TROPHY_EN: Record<string, string> = {
    SPLIT1: 'Spring', MSI: 'MSI', SPLIT2: 'Summer', WORLDS: 'Worlds',
  }

  return (
    <main className="min-h-screen bg-[#0d0d1a] text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-white/10">
        <Link href="/" className="font-black text-base tracking-tight text-white/80 hover:text-white transition-colors">
          GRANDSLAM
        </Link>
        <span className="text-xs text-white/20 tracking-widest">SHARED RESULT</span>
      </header>

      <div className="max-w-2xl mx-auto px-6 py-14 flex flex-col items-center gap-8">
        {/* Trophy badges */}
        {result.trophies.length > 0 && (
          <div className="flex gap-2 flex-wrap justify-center">
            {result.trophies.map(tr => (
              <span key={tr} className="text-[10px] tracking-widest px-2.5 py-1 rounded-full border border-white/15 text-white/40">
                {TROPHY_EN[tr] ?? tr}
              </span>
            ))}
          </div>
        )}

        {/* Grade */}
        <div className="text-center">
          <p className="text-[10px] tracking-[0.5em] text-white/20 uppercase mb-3">Season Result</p>
          <h1 style={{ color: gradeColor }} className="text-5xl font-black leading-none">
            {result.grade}
          </h1>
          <p className="text-white/25 text-sm mt-3">Team OVR {result.teamOvr}</p>
        </div>

        {/* 5-player cards — server render (no PlayerCard client component) */}
        <div className="flex flex-wrap gap-2 justify-center">
          {playerInfos.map((pi) => (
            <div
              key={pi.id}
              className="w-28 h-40 flex flex-col rounded-lg overflow-hidden border border-[#2a2a4a] bg-[#1a1a2e]"
            >
              {/* OVR + role */}
              <div className="px-1.5 pt-1.5 flex flex-col leading-none">
                <span className="text-2xl font-black text-[#f0f0f0]">{pi.ovr}</span>
                <span
                  className="text-[10px] font-semibold uppercase tracking-wider mt-0.5"
                  style={{ color: ROLE_COLOR[pi.role as Role] ?? '#a0a0c0' }}
                >
                  {pi.role}
                </span>
              </div>

              {/* Avatar area */}
              <div
                className="flex-1 flex items-center justify-center font-black text-2xl text-white/60"
                style={{ background: `hsl(${[...pi.name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360}, 35%, 28%)` }}
              >
                {pi.name.charAt(0).toUpperCase()}
              </div>

              {/* Name + team · year */}
              <div className="px-1.5 pb-1.5 pt-1 bg-[#0d0d1a]">
                <p className="text-center text-[11px] font-semibold text-[#e8e8f0] truncate">{pi.name}</p>
                <p className="text-center text-[8px] text-[#6868a0] truncate">{pi.team} · {pi.year}</p>
              </div>
            </div>
          ))}
        </div>

        {/* CTA: Start draft */}
        <Link
          href="/draft"
          className="mt-2 inline-block w-full max-w-xs py-3.5 bg-white text-[#0d0d1a] font-black text-sm tracking-[0.15em] uppercase rounded-xl text-center hover:bg-white/90 active:scale-95 transition-all"
        >
          Start My Draft
        </Link>
      </div>
    </main>
  )
}
