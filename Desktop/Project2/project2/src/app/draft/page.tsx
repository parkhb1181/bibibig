'use client'
// §6.1 Draft game body — IDLE→SPIN→PICK→SIM→REVEAL→RESULT
// §13.4 Data flow comments required (first React project)
// §13.5 Hydration guard: initial render matches server, fetch after mount
// GAME_SPEC §1: auto-spin immediately when data loads (skip IDLE screen)
// GAME_SPEC §2: single reroll button (fullReroll)
// GAME_SPEC §7: RESULT 4-stage timeline

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import PlayerCard from '@/components/PlayerCard'
import { useDraftMachine, ROLES } from '@/lib/useDraftMachine'
import type { DraftData } from '@/lib/useDraftMachine'
import type { PlayerSeason } from '@/lib/data'
import type { SimStep } from '@/lib/sim'

// ── Data load hook ────────────────────────────────────────────────────────────
// §13.5: fetch only after mount (no window/fetch needed in SSR)
function useDraftData() {
  const [data, setData] = useState<DraftData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Parallel load of 4 JSON files after mount
    Promise.all([
      fetch('/data/players.json').then(r => r.json()),
      fetch('/data/teams.json').then(r => r.json()),
      fetch('/data/spin-index.json').then(r => r.json()),
      fetch('/data/opponents-2026.json').then(r => r.json()),
    ]).then(([players, teams, spinIndex, opponents]) => {
      setData({ players, teams, spinIndex, opponents })
      setLoading(false)
    }).catch(e => {
      setError(String(e))
      setLoading(false)
    })
  }, []) // run once on mount — data is build-time fixed

  return { data, loading, error }
}

// 모바일 슬롯 카드 — grid-cols-5 내부, useState 필요로 별도 컴포넌트
function mobileAvatarBg(teamSlug: string): string {
  const h = [...teamSlug].reduce((acc, c) => acc + c.charCodeAt(0), 0)
  const hues = [210, 150, 30, 280, 350, 190, 60, 320]
  return `hsl(${hues[h % hues.length]}, 40%, 35%)`
}

function MobileSlotItem({ role, player }: { role: string; player: PlayerSeason | null }) {
  const [imgErr, setImgErr] = useState(false)
  if (!player) {
    return (
      <div className="aspect-[5/7] rounded-lg border border-dashed border-[#2a2a4a] flex items-center justify-center">
        <span className="text-[10px] text-[#a0a0c0] font-semibold">{role}</span>
      </div>
    )
  }
  const showPhoto = process.env.NEXT_PUBLIC_PHOTOS_ENABLED !== 'false' && !!player.photo && !imgErr
  return (
    <div className="aspect-[5/7] rounded-lg overflow-hidden bg-[#1a1a2e] border border-[#2a2a4a] flex flex-col">
      <div className="flex-1 relative overflow-hidden">
        {showPhoto ? (
          <img
            src={player.photo!}
            alt={player.nameEn}
            className="absolute inset-0 w-full h-full object-cover object-top"
            onError={() => setImgErr(true)}
          />
        ) : (
          <div
            className="absolute inset-0 flex items-center justify-center text-white/80 font-black text-xl"
            style={{ background: mobileAvatarBg(player.teamSlug) }}
          >
            {player.nameEn.charAt(0)}
          </div>
        )}
      </div>
      <div className="bg-[#0d0d1a] px-0.5 py-1 shrink-0">
        <p className="text-[8px] text-white/90 font-semibold truncate text-center leading-none">{player.nameEn}</p>
        <p className="text-[6px] text-white/30 truncate text-center leading-none mt-0.5">{player.year}</p>
      </div>
    </div>
  )
}

// ── Roster slot row — 1 horizontal line, scrollbar hidden ────────────────────
function RosterSlots({ picks }: { picks: (ReturnType<typeof useDraftMachine>['state']['picks'][0])[] }) {
  return (
    <div className="flex gap-1.5 justify-center flex-nowrap overflow-x-auto no-scrollbar">
      {ROLES.map((role, i) => {
        const pick = picks[i]
        return (
          <div key={role} className="flex flex-col items-center gap-1 flex-shrink-0">
            {pick ? (
              <PlayerCard player={pick.player} size="slot" />
            ) : (
              <div className="w-20 h-28 rounded-lg border border-dashed border-[var(--card-border,#2a2a4a)] flex items-center justify-center text-[var(--card-role,#a0a0c0)] text-xs">
                {role}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── PICK screen — GAME_SPEC §2: single reroll button ─────────────────────────
function PickScreen({
  roster,
  pickedPlayerIds,
  emptyRoles,
  onPick,
  onFullReroll,
  rerollLeft,
  spunTeam,
}: {
  roster: PlayerSeason[]
  pickedPlayerIds: Set<string>
  emptyRoles: string[]
  onPick: (p: PlayerSeason) => void
  onFullReroll: () => void
  rerollLeft: number
  spunTeam: { team: string; year: number } | null
}) {
  // Reroll 버튼 내용 — PC(팀명 옆)·모바일(카드 아래) 두 곳 공유
  const rerollIcon = (
    <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 4v6h-6"/>
      <path d="M1 20v-6h6"/>
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
    </svg>
  )
  const rerollCls = 'items-center gap-2 text-sm px-5 py-2.5 rounded-lg bg-[var(--accent,#4a6aff)] text-white font-semibold hover:opacity-90 disabled:opacity-30 transition-opacity'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">
          {spunTeam ? `${spunTeam.team} (${spunTeam.year})` : 'Choose your player'}
        </h2>
        {/* GAME_SPEC §2: PC — 팀명 옆 Reroll */}
        <button
          onClick={onFullReroll}
          disabled={rerollLeft <= 0}
          className={`hidden md:flex ${rerollCls}`}
          title="Reroll team"
        >
          {rerollIcon}
          Reroll ({rerollLeft})
        </button>
      </div>

      {/* Roster grid — sorted TOP→JGL→MID→ADC→SUP */}
      <div className="flex flex-wrap gap-2 justify-center no-scrollbar">
        {[...roster]
          .sort((a, b) => ROLES.indexOf(a.role as (typeof ROLES)[number]) - ROLES.indexOf(b.role as (typeof ROLES)[number]))
          .map(p => {
            const isFilled = !emptyRoles.includes(p.role)
            const isPicked = pickedPlayerIds.has(p.playerId)
            return (
              <PlayerCard
                key={p.id}
                player={p}
                size="pick"
                disabled={isFilled || isPicked}
                onClick={() => !isFilled && !isPicked && onPick(p)}
              />
            )
          })
        }
      </div>

      {/* 모바일: 카드 아래 Reroll */}
      <div className="md:hidden flex justify-center">
        <button
          onClick={onFullReroll}
          disabled={rerollLeft <= 0}
          className={`flex ${rerollCls}`}
          title="Reroll team"
        >
          {rerollIcon}
          Reroll ({rerollLeft})
        </button>
      </div>
    </div>
  )
}

// ── REVEAL screen — 1000ms interval, game circle visualization ───────────────
function RevealScreen({
  steps,
  revealStep,
  onSkip,
}: {
  steps: SimStep[]
  revealStep: number
  onSkip: () => void
}) {
  const visible = steps.slice(0, revealStep)
  const current = visible[visible.length - 1]
  const past = visible.slice(0, -1)

  // Current step outcome (W/L/neutral)
  function stepResult(step: SimStep): 'win' | 'lose' | 'neutral' {
    if (step.stage.endsWith('_missed') || step.stage === 'worlds_swiss_out') return 'lose'
    if (step.stage.endsWith('win') || step.stage.endsWith('_out')) return 'neutral'
    const s0 = step.series?.[0]
    if (s0) return s0.win ? 'win' : 'lose'
    return 'neutral'
  }

  const cur = current ? stepResult(current) : 'neutral'
  const isRegular = current?.stage.includes('_regular') ?? false
  const isMissed  = current?.stage.includes('_missed') || current?.stage === 'worlds_swiss_out'

  // stage key → section label (tiny header)
  function sectionLabel(stage: string): string {
    if (stage.startsWith('Spring')) return 'Spring Split'
    if (stage.startsWith('Summer')) return 'Summer Split'
    if (stage.startsWith('msi'))    return 'MSI'
    if (stage.startsWith('worlds')) return 'Worlds'
    return stage.replace(/_/g, ' ')
  }

  return (
    <div className="flex flex-col" style={{ minHeight: '70vh' }}>
      {/* Skip */}
      <div className="flex justify-end mb-4">
        <button
          onClick={onSkip}
          className="text-xs px-3 py-1.5 rounded border border-white/10 text-white/30 hover:text-white/60 transition-colors"
        >
          Skip
        </button>
      </div>

      {/* Previous steps — compact summary */}
      {past.length > 0 && (
        <div className="flex flex-col gap-1 mb-6 opacity-40">
          {past.map((step, i) => {
            const r = stepResult(step)
            return (
              <div key={i} className={`text-xs flex items-center gap-2 ${r === 'win' ? 'text-green-400' : r === 'lose' ? 'text-red-400' : 'text-white/50'}`}>
                <span className="w-3 text-center">{r === 'win' ? '✓' : r === 'lose' ? '✗' : '·'}</span>
                <span className="truncate">{step.label}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Current step — hero */}
      {current && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center py-8">
          <p className="text-[10px] tracking-[0.35em] text-white/20 uppercase">
            {sectionLabel(current.stage)}
          </p>
          <h2 className={`text-2xl font-bold leading-snug ${
            cur === 'win'  ? 'text-green-300' :
            cur === 'lose' ? 'text-red-300' :
            isMissed       ? 'text-white/40' : 'text-white'
          }`}>
            {current.label}
          </h2>

          {/* DNQ indicator */}
          {isMissed && (
            <div className="flex items-center gap-2 mt-1">
              <div className="w-4 h-4 rounded-full bg-white/15" />
              <span className="text-white/30 text-base font-bold tracking-[0.2em]">DNQ</span>
            </div>
          )}

          {/* Series result: large score + per-game W/L circles */}
          {!isRegular && !isMissed && current.series?.[0] && (
            <div className="flex flex-col items-center gap-3 mt-2">
              <div className={`text-5xl font-black tabular-nums ${
                current.series[0].win ? 'text-green-400' : 'text-red-400'
              }`}>
                {current.series[0].score}
              </div>
              {current.series[0].games && current.series[0].games.length > 0 && (
                <div className="flex gap-2.5">
                  {current.series[0].games.map((gWin, idx) => (
                    <div
                      key={idx}
                      className={`w-4 h-4 rounded-full ${gWin ? 'bg-green-400' : 'bg-red-400/80'}`}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Regular season: W/L dot grid */}
          {isRegular && current.series && current.series.length > 0 && (
            <div className="flex flex-wrap gap-1 justify-center max-w-[200px] mt-2">
              {current.series.map((s, j) => (
                <div key={j} className={`w-2 h-2 rounded-full ${s.win ? 'bg-green-400' : 'bg-red-400/60'}`} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Progress indicator */}
      <div className="flex justify-center gap-1.5 mt-4 pb-2">
        {steps.map((_, i) => (
          <div
            key={i}
            className={`rounded-full transition-all duration-300 ${
              i < revealStep ? 'w-3 h-1.5 bg-white/50' : 'w-1.5 h-1.5 bg-white/15'
            }`}
          />
        ))}
      </div>
    </div>
  )
}

// ── GAME_SPEC §7 — extract 4-stage result timeline ───────────────────────────

type TLEntry = {
  stage: string
  status: 'win' | 'lose' | 'out'
  detail: string
}

function buildTimeline(steps: SimStep[]): TLEntry[] {
  const byStage = new Map(steps.map(s => [s.stage, s]))
  const entries: TLEntry[] = []

  // Spring Split
  {
    const fin    = byStage.get('Spring_final')
    const sf     = byStage.get('Spring_sf')
    const missed = byStage.get('Spring_missed')
    if (fin) {
      const win = fin.series?.[0]?.win ?? false
      const opp = fin.series?.[0]?.opp ?? '?'
      entries.push({
        stage: 'Spring',
        status: win ? 'win' : 'lose',
        detail: win ? `Champions — def. ${opp}` : `Runner-up — lost to ${opp}`,
      })
    } else if (sf && !(sf.series?.[0]?.win)) {
      entries.push({
        stage: 'Spring',
        status: 'lose',
        detail: `SF Eliminated — lost to ${sf.series?.[0]?.opp ?? '?'}`,
      })
    } else if (missed) {
      entries.push({ stage: 'Spring', status: 'out', detail: 'Playoffs DNQ' })
    }
  }

  // MSI
  {
    const win = byStage.get('msi_win')
    const out = byStage.get('msi_out')
    if (win) {
      entries.push({ stage: 'MSI', status: 'win', detail: 'Champions' })
    } else if (out) {
      const roundLabel = byStage.has('msi_r3') ? 'Finals' : byStage.has('msi_r2') ? 'SF' : 'QF'
      const lastRound  = byStage.get('msi_r3') ?? byStage.get('msi_r2') ?? byStage.get('msi_r1')
      const opp        = lastRound?.series?.[0]?.opp ?? '?'
      entries.push({ stage: 'MSI', status: 'lose', detail: `${roundLabel} Eliminated — lost to ${opp}` })
    } else {
      entries.push({ stage: 'MSI', status: 'out', detail: 'DNQ' })
    }
  }

  // Summer Split
  {
    const fin    = byStage.get('Summer_final')
    const sf     = byStage.get('Summer_sf')
    const missed = byStage.get('Summer_missed')
    if (fin) {
      const win = fin.series?.[0]?.win ?? false
      const opp = fin.series?.[0]?.opp ?? '?'
      entries.push({
        stage: 'Summer',
        status: win ? 'win' : 'lose',
        detail: win ? `Champions — def. ${opp}` : `Runner-up — lost to ${opp}`,
      })
    } else if (sf && !(sf.series?.[0]?.win)) {
      entries.push({
        stage: 'Summer',
        status: 'lose',
        detail: `SF Eliminated — lost to ${sf.series?.[0]?.opp ?? '?'}`,
      })
    } else if (missed) {
      entries.push({ stage: 'Summer', status: 'out', detail: 'Playoffs DNQ' })
    }
  }

  // Worlds
  {
    const win      = byStage.get('worlds_win')
    const fin      = byStage.get('worlds_final')
    const sf       = byStage.get('worlds_sf')
    const qf       = byStage.get('worlds_qf')
    const swissOut = byStage.get('worlds_swiss_out')
    if (win) {
      const finOpp = fin?.series?.[0]?.opp ?? '?'
      entries.push({ stage: 'Worlds', status: 'win', detail: `Champions — def. ${finOpp}` })
    } else if (fin && !(fin.series?.[0]?.win)) {
      entries.push({ stage: 'Worlds', status: 'lose', detail: `Finals — lost to ${fin.series?.[0]?.opp ?? '?'}` })
    } else if (sf && !(sf.series?.[0]?.win)) {
      entries.push({ stage: 'Worlds', status: 'lose', detail: `SF Eliminated — lost to ${sf.series?.[0]?.opp ?? '?'}` })
    } else if (qf && !(qf.series?.[0]?.win)) {
      entries.push({ stage: 'Worlds', status: 'lose', detail: `QF Eliminated — lost to ${qf.series?.[0]?.opp ?? '?'}` })
    } else if (swissOut) {
      const lastSwissLoss = [5, 4, 3, 2, 1]
        .map(n => byStage.get(`worlds_swiss_r${n}`))
        .find(s => s && s.series?.[0]?.win === false)
      const swissOpp = lastSwissLoss?.series?.[0]?.opp
      entries.push({ stage: 'Worlds', status: 'lose', detail: swissOpp ? `Swiss Eliminated — lost to ${swissOpp}` : swissOut.label })
    } else {
      entries.push({ stage: 'Worlds', status: 'out', detail: 'DNQ' })
    }
  }

  return entries
}

// Grade accent colors (display-only)
const GRADE_COLOR: Record<string, string> = {
  'GRAND SLAM':  'text-[#ffd700]',
  'LEGENDARY':   'text-[#c080ff]',
  'ELITE':       'text-[#60c0ff]',
  'CONTENDER':   'text-[#40d4a0]',
  'PLAYOFF TEAM':'text-[#e8e8f0]',
  'REBUILD':     'text-[#6868a0]',
}

const TL_ICON: Record<TLEntry['status'], string> = { win: '●', lose: '●', out: '○' }
const TL_COLOR: Record<TLEntry['status'], string> = {
  win: 'text-green-400',
  lose: 'text-red-400',
  out: 'text-white/25',
}

// Match detail: stage prefix → section label
const DETAIL_SECTIONS = [
  { prefix: 'Spring', label: 'Spring Split' },
  { prefix: 'msi',    label: 'MSI' },
  { prefix: 'Summer', label: 'Summer Split' },
  { prefix: 'worlds', label: 'Worlds' },
]

// ── RESULT screen — GAME_SPEC §7: 5-player cards + 4-stage timeline + grade ──
function ResultScreen({
  simResult,
  picks,
  seed,
  onReset,
}: {
  simResult: NonNullable<ReturnType<typeof useDraftMachine>['state']['simResult']>
  picks: ReturnType<typeof useDraftMachine>['state']['picks']
  seed: number
  onReset: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [showDetail, setShowDetail] = useState(false)

  const pIds = ROLES.map((_, i) => picks[i]?.player.id ?? '').join('.')
  const shareUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/r?p=${encodeURIComponent(pIds)}&s=${seed}`
    : ''

  const handleCopy = async () => {
    if (!shareUrl) return
    await navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const timeline = buildTimeline(simResult.steps)
  const gradeColor = GRADE_COLOR[simResult.grade] ?? 'text-white'

  // Match detail: grouped by section
  const detailSections = DETAIL_SECTIONS
    .map(s => ({ label: s.label, steps: simResult.steps.filter(st => st.stage.startsWith(s.prefix)) }))
    .filter(s => s.steps.length > 0)

  return (
    <div className="flex flex-col gap-8 items-center">
      {/* Trophy badges */}
      {simResult.trophies.length > 0 && (
        <div className="flex gap-2 flex-wrap justify-center">
          {simResult.trophies.map(tr => (
            <span key={tr} className="text-[10px] tracking-widest uppercase px-2.5 py-1 rounded-full border border-white/20 text-white/50">
              {tr === 'SPLIT1' ? 'Spring' : tr === 'MSI' ? 'MSI' : tr === 'SPLIT2' ? 'Summer' : 'Worlds'}
            </span>
          ))}
        </div>
      )}

      {/* Grade — colored accent + large */}
      <div className="text-center">
        <p className="text-[10px] tracking-[0.5em] text-white/20 uppercase mb-2">Season Result</p>
        <h2 className={`text-5xl font-black leading-none ${gradeColor}`}>
          {simResult.grade}
        </h2>
        <p className="text-white/30 text-sm mt-3">
          Team OVR {simResult.teamOvr}
        </p>
      </div>

      {/* GAME_SPEC §7: 4-stage result timeline */}
      {timeline.length > 0 && (
        <div className="w-full max-w-xs flex flex-col gap-2.5">
          {timeline.map((entry, i) => (
            <div key={i} className="flex items-baseline gap-3">
              <span className={`text-[10px] ${TL_COLOR[entry.status]} flex-shrink-0`}>{TL_ICON[entry.status]}</span>
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="text-xs font-bold text-white/70 flex-shrink-0 w-14">{entry.stage}</span>
                <span className={`text-xs truncate ${
                  entry.status === 'win'  ? 'text-green-300/80' :
                  entry.status === 'lose' ? 'text-red-300/80' :
                  'text-white/25'
                }`}>
                  {entry.detail}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 5-player cards — PC (md+): grid-cols-5 single row, mobile: grid-cols-3 */}
      {/* overflow-hidden: blocks hover:scale-105 transform from creating scrollbars */}
      <div className="grid grid-cols-3 md:grid-cols-5 gap-2 justify-items-center w-full overflow-hidden">
        {ROLES.map((_, i) => picks[i] && (
          <PlayerCard key={i} player={picks[i]!.player} size="result" />
        ))}
      </div>

      {/* Match detail toggle — grouped by section */}
      {detailSections.length > 0 && (
        <div className="w-full max-w-sm">
          <button
            onClick={() => setShowDetail(v => !v)}
            className="w-full text-xs text-white/50 hover:text-white/90 transition-colors py-2.5 text-center tracking-widest border border-white/10 hover:border-white/30 rounded-lg"
          >
            {showDetail ? '▲ Hide Details' : '▼ Match Details'}
          </button>
          {showDetail && (
            <div className="bg-[var(--card-bg,#1a1a2e)] rounded-xl border border-[var(--card-border,#2a2a4a)] p-4 flex flex-col gap-5 mt-1">
              {detailSections.map((section, si) => (
                <div key={si}>
                  <p className="text-[9px] tracking-[0.4em] uppercase text-white/20 mb-2">{section.label}</p>
                  {section.steps.map((step, i) => {
                    const ser = step.series
                    const isReg = step.stage.includes('_regular')
                    const noSeries = !ser || ser.length === 0

                    if (isReg && ser && ser.length > 0) {
                      const wins = ser.filter(s => s.win).length
                      return (
                        <div key={i} className="mb-3">
                          <div className="text-xs text-white/40 mb-1.5">
                            Regular Season <span className="text-green-400/70">{wins}W</span> <span className="text-red-400/50">{ser.length - wins}L</span>
                          </div>
                          <div className="flex flex-wrap gap-0.5">
                            {ser.map((s, j) => (
                              <div key={j} className={`w-2.5 h-2.5 rounded-sm ${s.win ? 'bg-green-500/60' : 'bg-red-500/30'}`} title={`vs ${s.opp} ${s.score}`} />
                            ))}
                          </div>
                        </div>
                      )
                    }

                    if (noSeries) {
                      return (
                        <div key={i} className={`text-xs mb-1 ${step.stage.endsWith('win') ? 'text-yellow-400/60' : 'text-white/20'}`}>
                          {step.label}
                        </div>
                      )
                    }

                    // Series match — score + per-game circles
                    return ser!.map((s, j) => (
                      <div key={`${i}-${j}`} className="mb-3">
                        <div className={`flex items-center gap-2 text-xs mb-1 ${s.win ? 'text-green-400/90' : 'text-red-400/90'}`}>
                          <span className="font-mono font-bold tabular-nums min-w-[28px]">{s.score}</span>
                          <span className="text-white/25">vs</span>
                          <span className="flex-1 text-white/70 truncate">{s.opp}</span>
                        </div>
                        {s.games && s.games.length > 0 && (
                          <div className="flex gap-1.5 ml-8">
                            {s.games.map((gWin, gi) => (
                              <div key={gi} className={`w-3 h-3 rounded-full ${gWin ? 'bg-green-500/70' : 'bg-red-500/50'}`} />
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Buttons */}
      <div className="flex gap-3 flex-wrap justify-center">
        <button
          onClick={handleCopy}
          className="px-5 py-2.5 rounded-lg bg-[var(--card-bg,#1a1a2e)] border border-[var(--card-border,#2a2a4a)] text-[var(--card-name,#e8e8f0)] hover:border-white/40 transition-colors text-sm"
        >
          {copied ? 'Copied!' : 'Copy Link'}
        </button>
        <button
          onClick={onReset}
          className="px-5 py-2.5 rounded-lg bg-[var(--accent,#4a6aff)] text-white font-bold hover:opacity-90 transition-opacity text-sm"
        >
          Play Again
        </button>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function DraftPage() {
  const { data, loading } = useDraftData()
  const machine = useDraftMachine(data)
  const { state } = machine

  // GAME_SPEC §1: auto-spin immediately when data loads — skip IDLE screen
  // Triggers when both data (loaded) and phase (IDLE) are satisfied
  useEffect(() => {
    if (data && state.phase === 'IDLE') {
      machine.start()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, state.phase])

  // SPIN phase: automatically call spinNext
  // Triggers when phase transitions to SPIN
  useEffect(() => {
    if (state.phase !== 'SPIN' || !data) return
    const emptyRoles = ROLES.filter((_, i) => state.picks[i] === null)
    const pickedIds = new Set(
      state.picks.filter(Boolean).map(p => p!.player.playerId)
    )
    machine.spinNext(state.round, pickedIds, emptyRoles)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.round])

  // SIM phase: run synchronous simulation (near-instant)
  // Triggers when phase transitions to SIM
  useEffect(() => {
    if (state.phase !== 'SIM') return
    machine.runSim()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase])

  // REVEAL phase: sequential step display at 1000ms interval
  // Creates interval when phase is REVEAL, cleaned up by effect return
  const revealIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (state.phase !== 'REVEAL') {
      if (revealIntervalRef.current) {
        clearInterval(revealIntervalRef.current)
        revealIntervalRef.current = null
      }
      return
    }
    revealIntervalRef.current = setInterval(() => {
      machine.revealNext()
    }, 1000)
    return () => {
      if (revealIntervalRef.current) clearInterval(revealIntervalRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase])

  return (
    <div className="min-h-[100dvh] bg-[var(--page-bg,#0d0d1a)] text-white" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {/* Header — PC: 로고+슬롯, 모바일: 최소 링크만 (슬롯은 main 상단으로) */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-[var(--card-border,#2a2a4a)]">
        <Link href="/" className="font-black text-lg tracking-tight hidden md:inline">GRANDSLAM</Link>
        <Link href="/" className="text-white/25 hover:text-white/60 text-xs transition-colors md:hidden">← GRANDSLAM</Link>
        {state.phase !== 'IDLE' && (
          <div className="hidden md:block">
            <RosterSlots picks={state.picks} />
          </div>
        )}
      </header>

      {/* Main content */}
      {/* Expand to max-w-3xl at RESULT — fits 5 cards (5×128px+gap) in one row */}
      <main className={`mx-auto px-4 py-8 ${state.phase === 'RESULT' ? 'max-w-3xl' : 'max-w-2xl'}`}>

        {/* IDLE: loading or waiting for auto-spin — rarely visible in practice */}
        {state.phase === 'IDLE' && (
          <div className="flex flex-col items-center justify-center gap-4 py-16">
            <p className="text-[var(--card-role,#a0a0c0)] animate-pulse">
              {loading ? 'Loading...' : 'Preparing spin...'}
            </p>
          </div>
        )}

        {(state.phase === 'SPIN' || state.phase === 'PICK') && (
          <div className="flex flex-col gap-4 md:gap-6">
            {/* 모바일 전용: 드래프트 슬롯 — grid-cols-5, 얼굴+이름 표시 */}
            <div className="md:hidden grid grid-cols-5 gap-1.5">
              {ROLES.map((role, i) => (
                <MobileSlotItem
                  key={role}
                  role={role}
                  player={state.picks[i]?.player ?? null}
                />
              ))}
            </div>
            <p className="text-center text-sm text-[var(--card-role,#a0a0c0)]">
              Round {state.round + 1} / 5
            </p>
            {state.phase === 'SPIN' && (
              <p className="text-center text-white animate-pulse">Spinning...</p>
            )}
            {state.phase === 'PICK' && state.spunTeam && (
              <PickScreen
                roster={machine.currentRoster}
                pickedPlayerIds={machine.pickedPlayerIds}
                emptyRoles={machine.emptyRoles}
                onPick={(p) => machine.pick(p, state.spunTeam!)}
                onFullReroll={machine.fullReroll}
                rerollLeft={state.rerollLeft}
                spunTeam={state.spunTeam}
              />
            )}
          </div>
        )}

        {state.phase === 'SIM' && (
          <p className="text-center text-white animate-pulse py-12">Simulating season...</p>
        )}

        {state.phase === 'REVEAL' && state.simResult && (
          <RevealScreen
            steps={state.simResult.steps}
            revealStep={state.revealStep}
            onSkip={machine.revealSkip}
          />
        )}

        {state.phase === 'RESULT' && state.simResult && (
          <ResultScreen
            simResult={state.simResult}
            picks={state.picks}
            seed={state.seed}
            onReset={machine.reset}
          />
        )}
        {/* 모바일 전용: 하단 GRANDSLAM 로고 */}
        <div className="md:hidden text-center pt-8 pb-2">
          <Link href="/" className="text-white/15 hover:text-white/30 text-[10px] font-black tracking-[0.4em] uppercase transition-colors">
            GRANDSLAM
          </Link>
        </div>
      </main>

      {/* Footer is global in layout.tsx §10 */}
    </div>
  )
}
