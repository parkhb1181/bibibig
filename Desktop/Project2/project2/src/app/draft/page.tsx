'use client'
// §6.1 Draft game body — IDLE→SPIN→PICK→SIM→REVEAL→RESULT
// §13.4 Data flow comments required (first React project)
// §13.5 Hydration guard: initial render matches server, fetch after mount
// GAME_SPEC §1: auto-spin immediately when data loads (skip IDLE screen)
// GAME_SPEC §2: single reroll button (fullReroll)
// GAME_SPEC §7: RESULT — 섹션별 마지막 경기 4줄

import { useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import PlayerCard from '@/components/PlayerCard'
import { useDraftMachine, ROLES } from '@/lib/useDraftMachine'
import type { DraftData } from '@/lib/useDraftMachine'
import type { PlayerSeason } from '@/lib/data'
import type { SimStep } from '@/lib/sim'
import { highlightRoundLabel, highlightSummary, pickHighlightSteps, type HighlightStep } from '@/lib/simHighlight'

function sectionShort(h: HighlightStep): string {
  if (h.section === 'Spring Split') return 'Spring'
  if (h.section === 'Summer Split') return 'Summer'
  return h.section
}

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

// ── 드래프트 슬롯: 모바일 MobileSlotItem / 데스크톱 DesktopDraftSlotItem ────────
function mobileAvatarBg(teamSlug: string): string {
  const h = [...teamSlug].reduce((acc, c) => acc + c.charCodeAt(0), 0)
  const hues = [210, 150, 30, 280, 350, 190, 60, 320]
  return `hsl(${hues[h % hues.length]}, 40%, 35%)`
}

// 모바일 슬롯 — grid-cols-5 내부, useState 필요로 별도 컴포넌트 (md 미적용)
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

// 데스크톱 슬롯 — 픽 카드와 동일 열 너비(draft-pick-w), 높이만 낮게
function DesktopDraftSlotItem({ role, player }: { role: string; player: PlayerSeason | null }) {
  const [imgErr, setImgErr] = useState(false)
  if (!player) {
    return (
      <div className="draft-pick-w aspect-[3/4] rounded-lg border border-dashed border-[#2a2a4a] flex items-center justify-center flex-shrink-0">
        <span className="text-xs text-[#a0a0c0] font-semibold">{role}</span>
      </div>
    )
  }
  const showPhoto = process.env.NEXT_PUBLIC_PHOTOS_ENABLED !== 'false' && !!player.photo && !imgErr
  return (
    <div className="draft-pick-w aspect-[3/4] rounded-lg overflow-hidden bg-[#1a1a2e] border border-[#2a2a4a] flex flex-col flex-shrink-0">
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
        <p className="text-[9px] text-white/90 font-semibold truncate text-center leading-none">{player.nameEn}</p>
        <p className="text-[7px] text-white/30 truncate text-center leading-none mt-0.5">{player.year}</p>
      </div>
    </div>
  )
}

// 데스크톱: 상단 5칸 슬롯 한 줄 (md+)
function DraftSlotRow({ picks }: { picks: (ReturnType<typeof useDraftMachine>['state']['picks'][0])[] }) {
  return (
    <div className="flex gap-3 justify-center w-full flex-nowrap">
      {ROLES.map((role, i) => (
        <DesktopDraftSlotItem
          key={role}
          role={role}
          player={picks[i]?.player ?? null}
        />
      ))}
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

// ── PICK screen — 모바일(예전) / 데스크톱(참고 디자인) 분리 ─────────────────
function PickScreenButtons({
  onPlayAgain,
  onFullReroll,
  rerollLeft,
  playAgainCls,
  rerollCls,
  rerollIcon,
}: {
  onPlayAgain: () => void
  onFullReroll: () => void
  rerollLeft: number
  playAgainCls: string
  rerollCls: string
  rerollIcon: ReactNode
}) {
  return (
    <div className="flex flex-col items-center w-full">
      <button
        onClick={onFullReroll}
        disabled={rerollLeft <= 0}
        className={`flex ${rerollCls}`}
        title="Reroll team"
      >
        {rerollIcon}
        Reroll ({rerollLeft})
      </button>
      <button
        onClick={onPlayAgain}
        className={`flex mt-12 md:mt-14 ${playAgainCls}`}
        title="Start a new draft"
      >
        Play Again
      </button>
    </div>
  )
}

const REROLL_ICON = (
  <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 4v6h-6"/>
    <path d="M1 20v-6h6"/>
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
  </svg>
)
const REROLL_CLS = 'items-center gap-2 text-sm px-5 py-2.5 rounded-lg bg-[var(--accent,#4a6aff)] text-white font-semibold hover:opacity-90 disabled:opacity-30 transition-opacity'
const PLAY_AGAIN_CLS = 'items-center text-xs px-3 py-1.5 rounded-md border border-transparent text-[var(--card-role,#a0a0c0)] hover:text-white/80 hover:border-[var(--card-border,#2a2a4a)] transition-colors'

function PickRosterGrid({
  roster,
  pickedPlayerIds,
  emptyRoles,
  onPick,
  layout,
}: {
  roster: PlayerSeason[]
  pickedPlayerIds: Set<string>
  emptyRoles: string[]
  onPick: (p: PlayerSeason) => void
  layout: 'mobile' | 'desktop'
}) {
  const rowCls = layout === 'mobile'
    ? 'flex flex-wrap gap-2 justify-center no-scrollbar'
    : 'flex flex-nowrap gap-3 justify-center w-full no-scrollbar'
  return (
    <div className={rowCls}>
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
        })}
    </div>
  )
}

function MobilePickScreen({
  roster,
  pickedPlayerIds,
  emptyRoles,
  onPick,
  onFullReroll,
  onPlayAgain,
  rerollLeft,
  spunTeam,
}: {
  roster: PlayerSeason[]
  pickedPlayerIds: Set<string>
  emptyRoles: string[]
  onPick: (p: PlayerSeason) => void
  onFullReroll: () => void
  onPlayAgain: () => void
  rerollLeft: number
  spunTeam: { team: string; year: number } | null
}) {
  const teamTitle = spunTeam ? `${spunTeam.team} (${spunTeam.year})` : 'Choose your player'
  return (
    <div className="flex flex-col gap-4 w-full">
      <h2 className="text-lg font-bold text-white">{teamTitle}</h2>
      <PickRosterGrid
        roster={roster}
        pickedPlayerIds={pickedPlayerIds}
        emptyRoles={emptyRoles}
        onPick={onPick}
        layout="mobile"
      />
      <div className="flex justify-center pt-1">
        <PickScreenButtons
          onPlayAgain={onPlayAgain}
          onFullReroll={onFullReroll}
          rerollLeft={rerollLeft}
          playAgainCls={PLAY_AGAIN_CLS}
          rerollCls={REROLL_CLS}
          rerollIcon={REROLL_ICON}
        />
      </div>
    </div>
  )
}

// 참고 디자인: 팀명 가운데 → 긴 카드 5장 → 하단 버튼 (md+ 전용)
function DesktopPickScreen({
  roster,
  pickedPlayerIds,
  emptyRoles,
  onPick,
  onFullReroll,
  onPlayAgain,
  rerollLeft,
  spunTeam,
}: {
  roster: PlayerSeason[]
  pickedPlayerIds: Set<string>
  emptyRoles: string[]
  onPick: (p: PlayerSeason) => void
  onFullReroll: () => void
  onPlayAgain: () => void
  rerollLeft: number
  spunTeam: { team: string; year: number } | null
}) {
  const teamTitle = spunTeam ? `${spunTeam.team} (${spunTeam.year})` : 'Choose your player'
  return (
    <div className="flex flex-col items-center gap-4 w-full">
      <h2 className="text-3xl font-bold text-white text-center">{teamTitle}</h2>
      <PickRosterGrid
        roster={roster}
        pickedPlayerIds={pickedPlayerIds}
        emptyRoles={emptyRoles}
        onPick={onPick}
        layout="desktop"
      />
      <div className="flex justify-center pt-2">
        <PickScreenButtons
          onPlayAgain={onPlayAgain}
          onFullReroll={onFullReroll}
          rerollLeft={rerollLeft}
          playAgainCls={PLAY_AGAIN_CLS}
          rerollCls={REROLL_CLS}
          rerollIcon={REROLL_ICON}
        />
      </div>
    </div>
  )
}

// ── REVEAL — 섹션별 마지막 경기 4개만, 1.8s 간격 ─────────────────────────────
function RevealScreen({
  highlights,
  revealStep,
  onSkip,
}: {
  highlights: HighlightStep[]
  revealStep: number
  onSkip: () => void
}) {
  const current = revealStep > 0 ? highlights[revealStep - 1] : null
  const step = current?.step

  function stepResult(s: SimStep): 'win' | 'lose' | 'neutral' {
    if (s.stage.endsWith('_missed') || s.stage === 'worlds_swiss_out' || s.stage === 'msi_out') return 'lose'
    if (s.stage.endsWith('win')) return 'win'
    const s0 = s.series?.[0]
    if (s0) return s0.win ? 'win' : 'lose'
    return 'neutral'
  }

  const cur = step ? stepResult(step) : 'neutral'
  const isMissed = step && (
    step.stage.includes('_missed') ||
    step.stage === 'worlds_swiss_out' ||
    step.stage === 'msi_out'
  )
  const ser = step?.series?.[0]

  return (
    <div className="flex flex-col items-center" style={{ minHeight: '55vh' }}>
      <div className="w-full max-w-sm flex justify-end mb-2">
        <button
          onClick={onSkip}
          className="text-xs px-3 py-1.5 rounded border border-white/10 text-white/30 hover:text-white/60 transition-colors"
        >
          Skip
        </button>
      </div>

      {current && step && (
        <div className="flex-1 flex flex-col items-center justify-center gap-5 text-center py-6 w-full max-w-sm">
          <p className="text-[10px] tracking-[0.35em] text-white/25 uppercase">
            {current.section}
          </p>
          <p className={`text-2xl font-black tracking-wide ${
            cur === 'win' ? 'text-white/90' :
            cur === 'lose' ? 'text-white/70' :
            'text-white/50'
          }`}>
            {highlightRoundLabel(current)}
          </p>
          <h2 className={`text-xl font-bold leading-snug px-2 ${
            cur === 'win' ? 'text-green-300' :
            cur === 'lose' ? 'text-red-300' :
            'text-white/70'
          }`}>
            {ser ? `${ser.win ? 'WIN' : 'LOSS'} vs ${ser.opp}` : step.label}
          </h2>

          {ser && (
            <div className="flex flex-col items-center gap-3">
              <div className={`text-5xl font-black tabular-nums ${ser.win ? 'text-green-400' : 'text-red-400'}`}>
                {ser.score}
              </div>
              {ser.games && ser.games.length > 0 && (
                <div className="flex gap-2.5">
                  {ser.games.map((gWin, idx) => (
                    <div
                      key={idx}
                      className={`w-4 h-4 rounded-full ${gWin ? 'bg-green-400' : 'bg-red-400/80'}`}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {isMissed && !ser && (
            <span className="text-white/30 text-sm tracking-widest">DNQ</span>
          )}
        </div>
      )}

      <div className="flex justify-center gap-2 mt-6 pb-2">
        {highlights.map((h, i) => (
          <div
            key={h.section}
            title={h.section}
            className={`rounded-full transition-all duration-300 ${
              i < revealStep ? 'w-8 h-2 bg-white/50' : 'w-2 h-2 bg-white/15'
            }`}
          />
        ))}
      </div>
      <p className="text-[10px] text-white/20 mt-2 tabular-nums">
        {Math.min(revealStep, highlights.length)} / {highlights.length}
      </p>
    </div>
  )
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

// ── RESULT screen — 등급 + 섹션별 마지막 경기 4줄 + 픽 카드 ─────────────────
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

  const highlights = pickHighlightSteps(simResult.steps)
  const gradeColor = GRADE_COLOR[simResult.grade] ?? 'text-white'

  function rowTone(h: HighlightStep): string {
    const s = h.step
    if (s.stage.endsWith('_missed') || s.stage === 'msi_out' || s.stage === 'worlds_swiss_out') {
      return 'text-white/25'
    }
    const win = s.series?.[0]?.win ?? s.stage.endsWith('win')
    return win ? 'text-green-300/90' : 'text-red-300/90'
  }

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

      {/* 섹션별 마지막 경기 — 2열 고정 (라운드+경기 한 줄) */}
      <div className="w-full max-w-md flex flex-col gap-2.5">
        {highlights.map((h, i) => (
          <div key={i} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-4 items-baseline">
            <span className="text-xs font-bold text-white/50">{sectionShort(h)}</span>
            <span className={`text-xs tabular-nums whitespace-nowrap overflow-hidden text-ellipsis ${rowTone(h)}`}>
              {highlightSummary(h)}
            </span>
          </div>
        ))}
      </div>

      {/* 5-player cards — PC (md+): grid-cols-5 single row, mobile: grid-cols-3 */}
      {/* overflow-hidden: blocks hover:scale-105 transform from creating scrollbars */}
      <div className="grid grid-cols-3 md:grid-cols-5 gap-2 justify-items-center w-full overflow-hidden">
        {ROLES.map((_, i) => picks[i] && (
          <PlayerCard key={i} player={picks[i]!.player} size="result" />
        ))}
      </div>

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

  // Play Again 공통 초기화: machine.reset → IDLE → auto-spin이 새 시드 생성(라운드·리롤 초기화).
  // 드래프트 화면에선 픽이 1개 이상이면 진행 손실 방지를 위해 확인 1회 후 실행.
  // 결과 화면(ResultScreen)은 확인 없이 machine.reset을 직접 호출한다.
  const handlePlayAgain = () => {
    const hasPicks = state.picks.some(Boolean)
    if (hasPicks && !window.confirm('Start over?')) return
    machine.reset()
  }

  // StrictMode fires effects twice (setup→cleanup→setup). These refs guard against
  // double invocation: once fired for the current phase/round, subsequent calls are ignored.
  const startFiredRef = useRef(false)
  const spinFiredRoundRef = useRef(-1)

  // GAME_SPEC §1: auto-spin immediately when data loads — skip IDLE screen
  // Triggers when both data (loaded) and phase (IDLE) are satisfied
  useEffect(() => {
    if (!data || state.phase !== 'IDLE') {
      // Reset guard when leaving IDLE so Play Again (RESET→IDLE) works correctly
      if (state.phase !== 'IDLE') startFiredRef.current = false
      return
    }
    if (startFiredRef.current) return   // Already fired; ignore StrictMode re-invocation
    startFiredRef.current = true
    machine.start()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, state.phase])

  // SPIN phase: automatically call spinNext
  // Triggers when phase transitions to SPIN
  useEffect(() => {
    if (state.phase !== 'SPIN' || !data) {
      // Reset guard when leaving SPIN phase
      if (state.phase !== 'SPIN') spinFiredRoundRef.current = -1
      return
    }
    if (spinFiredRoundRef.current === state.round) return  // Already fired for this round
    spinFiredRoundRef.current = state.round
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

  // REVEAL phase: 섹션별 마지막 경기 4개, 1.8s 간격
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
    }, 1800)
    return () => {
      if (revealIntervalRef.current) clearInterval(revealIntervalRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase])

  // 드래프트(SPIN·PICK) 화면만 데스크톱에서 1화면 고정 — 세로 스크롤 제거.
  // md:fixed inset-0 로 뷰포트를 덮어 전역 footer(layout.tsx)를 가려 body 스크롤 자체를 없앤다.
  // 모바일은 기존 min-h-[100dvh] 흐름 유지 (footer 정상 노출).
  const isDraftScreen = state.phase === 'SPIN' || state.phase === 'PICK'

  return (
    <div
      className={`min-h-[100dvh] bg-[var(--page-bg,#0d0d1a)] text-white md:flex md:flex-col ${isDraftScreen ? 'md:fixed md:inset-0 md:z-10 md:min-h-0 md:overflow-hidden' : ''}`}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* Header — GRANDSLAM → 홈 (드래프트 포함 전 phase) */}
      <header
        className={`flex items-center shrink-0 px-4 md:px-10 py-3 border-b border-[var(--card-border,#2a2a4a)] ${
          !isDraftScreen ? 'justify-between' : ''
        }`}
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
      >
        <Link href="/" className="font-black text-lg tracking-tight hover:text-white/80 transition-colors">
          GRANDSLAM
        </Link>
        {state.phase !== 'IDLE' && !isDraftScreen && (
          <div className="hidden md:block">
            <RosterSlots picks={state.picks} />
          </div>
        )}
      </header>

      {/* Main content */}
      {/* RESULT: max-w-3xl (5×128px 한 줄). 드래프트: 데스크톱에서 폭을 넓혀(카드 확대용)
          세로 패딩 축소 + min-h-0 으로 flex 자식이 줄어들 수 있게 하고 중앙 균형 배치. */}
      <main className={`mx-auto px-4 py-8 w-full md:flex-1 md:flex md:flex-col md:justify-center ${
        state.phase === 'RESULT'
          ? 'max-w-3xl'
          : isDraftScreen
          ? 'max-w-2xl md:max-w-[1800px] md:px-10 md:py-4 md:min-h-0'
          : 'max-w-2xl'
      }`}>

        {/* IDLE: loading or waiting for auto-spin — rarely visible in practice */}
        {state.phase === 'IDLE' && (
          <div className="flex flex-col items-center justify-center gap-4 py-16">
            <p className="text-[var(--card-role,#a0a0c0)] animate-pulse">
              {loading ? 'Loading...' : 'Preparing spin...'}
            </p>
          </div>
        )}

        {(state.phase === 'SPIN' || state.phase === 'PICK') && (
          <>
            {/* ── 모바일 (예전 UI) ── */}
            <div className="md:hidden flex flex-col gap-4 w-full">
              <div className="grid grid-cols-5 gap-1.5">
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
                <MobilePickScreen
                  roster={machine.currentRoster}
                  pickedPlayerIds={machine.pickedPlayerIds}
                  emptyRoles={machine.emptyRoles}
                  onPick={(p) => machine.pick(p, state.spunTeam!)}
                  onFullReroll={machine.fullReroll}
                  onPlayAgain={handlePlayAgain}
                  rerollLeft={state.rerollLeft}
                  spunTeam={state.spunTeam}
                />
              )}
            </div>

            {/* ── 데스크톱 (참고 디자인) ── */}
            <div className="hidden md:flex md:flex-col md:items-center md:gap-4 md:w-full md:flex-1 md:justify-center">
              <DraftSlotRow picks={state.picks} />
              <p className="text-center text-sm text-[var(--card-role,#a0a0c0)]">
                Round {state.round + 1} / 5
              </p>
              {state.phase === 'SPIN' && (
                <p className="text-center text-white animate-pulse">Spinning...</p>
              )}
              {state.phase === 'PICK' && state.spunTeam && (
                <DesktopPickScreen
                  roster={machine.currentRoster}
                  pickedPlayerIds={machine.pickedPlayerIds}
                  emptyRoles={machine.emptyRoles}
                  onPick={(p) => machine.pick(p, state.spunTeam!)}
                  onFullReroll={machine.fullReroll}
                  onPlayAgain={handlePlayAgain}
                  rerollLeft={state.rerollLeft}
                  spunTeam={state.spunTeam}
                />
              )}
            </div>
          </>
        )}

        {state.phase === 'SIM' && (
          <p className="text-center text-white animate-pulse py-12">Simulating season...</p>
        )}

        {state.phase === 'REVEAL' && state.simResult && (
          <RevealScreen
            highlights={pickHighlightSteps(state.simResult.steps)}
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
      </main>

      {/* Footer is global in layout.tsx §10 */}
    </div>
  )
}
