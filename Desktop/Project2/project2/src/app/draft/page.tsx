'use client'
// §6.1 드래프트 게임 본체 — IDLE→SPIN→PICK→SIM→REVEAL→RESULT
// §13.4 데이터 플로우 주석 의무 (호빈: React 첫 경험)
// §13.5 Hydration 방어: 초기 렌더 서버와 동일 상태, mount 후 fetch

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import PlayerCard from '@/components/PlayerCard'
import { useDraftMachine, ROLES } from '@/lib/useDraftMachine'
import type { DraftData } from '@/lib/useDraftMachine'
import { useLang } from '@/i18n'
import type { PlayerSeason, Opponent, OpponentsFile } from '@/lib/data'

// ── 데이터 로드 훅 ────────────────────────────────────────────────────────────
// §13.5: fetch는 mount 후에만 (SSR에서 window/fetch 불요)
function useDraftData() {
  const [data, setData] = useState<DraftData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // mount 후 JSON 4종 병렬 로드
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
  }, []) // mount 1회만 — 데이터는 빌드 타임 고정

  return { data, loading, error }
}

// ── LangToggle ────────────────────────────────────────────────────────────────
function LangToggle() {
  const { lang, setLang } = useLang()
  return (
    <button
      onClick={() => setLang(lang === 'en' ? 'ko' : 'en')}
      className="text-xs px-2 py-1 rounded border border-[var(--card-border,#2a2a4a)] text-[var(--card-role,#a0a0c0)] hover:text-white transition-colors"
    >
      {lang === 'en' ? 'KR' : 'EN'}
    </button>
  )
}

// ── 픽슬롯 행 ─────────────────────────────────────────────────────────────────
function RosterSlots({ picks }: { picks: (ReturnType<typeof useDraftMachine>['state']['picks'][0])[] }) {
  return (
    <div className="flex gap-2 justify-center flex-wrap">
      {ROLES.map((role, i) => {
        const pick = picks[i]
        return (
          <div key={role} className="flex flex-col items-center gap-1">
            {pick ? (
              <PlayerCard player={pick.player} size="slot" />
            ) : (
              // 빈 슬롯
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

// ── IDLE 화면 ─────────────────────────────────────────────────────────────────
function IdleScreen({ onStart, loading }: { onStart: () => void; loading: boolean }) {
  const { t } = useLang()
  return (
    <div className="flex flex-col items-center justify-center gap-8 py-16">
      <h1 className="text-4xl font-black text-white tracking-tight">GRANDSLAM</h1>
      <p className="text-[var(--card-role,#a0a0c0)] text-center max-w-sm">
        LoL All-Time Draft Simulator
      </p>
      <button
        onClick={onStart}
        disabled={loading}
        className="px-10 py-4 text-xl font-bold rounded-xl bg-[var(--accent,#4a6aff)] text-white hover:opacity-90 active:scale-95 transition-all disabled:opacity-40"
      >
        {loading ? '로딩 중...' : t.startButton}
      </button>
    </div>
  )
}

// ── PICK 화면 ─────────────────────────────────────────────────────────────────
function PickScreen({
  roster,
  pickedPlayerIds,
  emptyRoles,
  onPick,
  onRerollTeam,
  onRerollYear,
  teamRerollLeft,
  yearRerollLeft,
  spunTeam,
}: {
  roster: PlayerSeason[]
  pickedPlayerIds: Set<string>
  emptyRoles: string[]
  onPick: (p: PlayerSeason) => void
  onRerollTeam: () => void
  onRerollYear: () => void
  teamRerollLeft: number
  yearRerollLeft: number
  spunTeam: { team: string; year: number } | null
}) {
  const { t } = useLang()

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">
          {spunTeam ? `${spunTeam.team} (${spunTeam.year})` : t.pickPrompt}
        </h2>
        <div className="flex gap-2">
          <button
            onClick={onRerollTeam}
            disabled={teamRerollLeft <= 0}
            className="text-xs px-3 py-1.5 rounded border border-[var(--card-border,#2a2a4a)] text-[var(--card-role,#a0a0c0)] hover:text-white disabled:opacity-30 transition-colors"
          >
            {t.rerollTeam} ({teamRerollLeft})
          </button>
          <button
            onClick={onRerollYear}
            disabled={yearRerollLeft <= 0}
            className="text-xs px-3 py-1.5 rounded border border-[var(--card-border,#2a2a4a)] text-[var(--card-role,#a0a0c0)] hover:text-white disabled:opacity-30 transition-colors"
          >
            {t.rerollYear} ({yearRerollLeft})
          </button>
        </div>
      </div>

      {/* 로스터 그리드 — 모바일 390px에서 가로 스크롤 없음 (flex-wrap) */}
      <div className="flex flex-wrap gap-2 justify-center">
        {roster.map(p => {
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
    </div>
  )
}

// ── REVEAL 화면 ───────────────────────────────────────────────────────────────
function RevealScreen({
  steps,
  revealStep,
  onSkip,
  opponents,
}: {
  steps: { stage: string; label: string; series?: { opp: string; score: string; win: boolean }[] }[]
  revealStep: number
  onSkip: () => void
  opponents: OpponentsFile | null
}) {
  const { t } = useLang()
  const visibleSteps = steps.slice(0, revealStep)

  // opp name → {label, rating} 조회 맵 — 패배 표시에 사용
  const oppMap = new Map<string, Pick<Opponent, 'label' | 'rating'>>()
  if (opponents) {
    for (const o of [...opponents.regular, ...opponents.intl]) {
      oppMap.set(o.name, { label: o.label, rating: o.rating })
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button
          onClick={onSkip}
          className="text-sm px-4 py-1.5 rounded border border-[var(--card-border,#2a2a4a)] text-[var(--card-role,#a0a0c0)] hover:text-white transition-colors"
        >
          {t.skipReveal}
        </button>
      </div>
      <div className="flex flex-col gap-2">
        {visibleSteps.map((step, i) => (
          <div key={i} className="bg-[var(--card-bg,#1a1a2e)] rounded-lg p-3 border border-[var(--card-border,#2a2a4a)]">
            <p className="text-sm text-[var(--card-name,#e8e8f0)] font-medium">{step.label}</p>
            {step.series && (
              <div className="flex flex-wrap gap-2 mt-1">
                {step.series.map((s, j) => {
                  const meta = oppMap.get(s.opp)
                  const display = s.win
                    ? `vs ${s.opp} ${s.score}`
                    : `vs ${meta?.label ?? s.opp} (${meta?.rating ?? '?'}) — 패`
                  return (
                    <span key={j} className={`text-xs px-2 py-0.5 rounded-full ${s.win ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'}`}>
                      {display}
                    </span>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── RESULT 화면 ───────────────────────────────────────────────────────────────
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
  const { t } = useLang()
  const [copied, setCopied] = useState(false)

  // 공유 URL 조립 — §8.1 형식: /r?p=id1.id2...&s=seed
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

  const handleShare = async () => {
    if (!navigator.share || !shareUrl) return
    await navigator.share({ url: shareUrl, title: `GRANDSLAM — ${simResult.grade}` })
  }

  return (
    <div className="flex flex-col gap-6 items-center">
      {/* 등급 */}
      <div className="text-center">
        <p className="text-sm text-[var(--card-role,#a0a0c0)] uppercase tracking-widest">Result</p>
        <h2 className="text-4xl font-black text-white mt-1">
          {t.grade[simResult.grade as keyof typeof t.grade] ?? simResult.grade}
        </h2>
        <p className="text-[var(--card-role,#a0a0c0)] text-sm mt-1">
          {t.teamOvr}: {simResult.teamOvr}
        </p>
      </div>

      {/* 트로피 */}
      {simResult.trophies.length > 0 && (
        <div className="flex gap-2 flex-wrap justify-center">
          {simResult.trophies.map(trophy => (
            <span key={trophy} className="text-xs font-bold px-3 py-1 rounded-full bg-[var(--card-badge-bg,#2a4a8a)] text-[var(--card-badge-text,#80aaff)]">
              {trophy}
            </span>
          ))}
        </div>
      )}

      {/* 픽 요약 */}
      <div className="flex flex-wrap gap-2 justify-center">
        {ROLES.map((_, i) => picks[i] && (
          <PlayerCard key={i} player={picks[i]!.player} size="result" />
        ))}
      </div>

      {/* 버튼 */}
      <div className="flex gap-3 flex-wrap justify-center">
        <button
          onClick={handleCopy}
          className="px-5 py-2.5 rounded-lg bg-[var(--card-bg,#1a1a2e)] border border-[var(--card-border,#2a2a4a)] text-[var(--card-name,#e8e8f0)] hover:border-white/40 transition-colors text-sm"
        >
          {copied ? '복사됨!' : t.copyLink}
        </button>
        {typeof navigator !== 'undefined' && 'share' in navigator && (
          <button
            onClick={handleShare}
            className="px-5 py-2.5 rounded-lg bg-[var(--card-bg,#1a1a2e)] border border-[var(--card-border,#2a2a4a)] text-[var(--card-name,#e8e8f0)] hover:border-white/40 transition-colors text-sm"
          >
            {t.share}
          </button>
        )}
        <button
          onClick={onReset}
          className="px-5 py-2.5 rounded-lg bg-[var(--accent,#4a6aff)] text-white font-bold hover:opacity-90 transition-opacity text-sm"
        >
          {t.playAgain}
        </button>
      </div>
    </div>
  )
}

// ── 메인 페이지 ───────────────────────────────────────────────────────────────
export default function DraftPage() {
  const { data, loading } = useDraftData()
  const machine = useDraftMachine(data)
  const { state } = machine
  const { t } = useLang()

  // SPIN 단계: 자동으로 spinNext 호출
  // 의존: phase가 SPIN으로 전이될 때 1회 실행
  useEffect(() => {
    if (state.phase !== 'SPIN' || !data) return
    const emptyRoles = ROLES.filter((_, i) => state.picks[i] === null)
    const pickedIds = new Set(
      state.picks.filter(Boolean).map(p => p!.player.playerId)
    )
    machine.spinNext(state.round, pickedIds, emptyRoles)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.round]) // phase/round 변경 시에만 트리거

  // SIM 단계: 동기 시뮬 실행 (사실상 즉시)
  // 의존: phase가 SIM으로 전이될 때 1회 실행
  useEffect(() => {
    if (state.phase !== 'SIM') return
    machine.runSim()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase])

  // REVEAL 단계: 600ms 인터벌로 step 순차 표시
  // 의존: phase가 REVEAL일 때 interval 생성, 해제는 클린업 함수
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
    }, 600)
    return () => {
      if (revealIntervalRef.current) clearInterval(revealIntervalRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]) // phase 변경 시 interval 재설정

  return (
    <div className="min-h-screen bg-[var(--page-bg,#0d0d1a)] text-white">
      {/* 헤더 */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-[var(--card-border,#2a2a4a)]">
        <Link href="/" className="font-black text-lg tracking-tight">GRANDSLAM</Link>
        <div className="flex items-center gap-3">
          {state.phase !== 'IDLE' && (
            <RosterSlots picks={state.picks} />
          )}
          <LangToggle />
        </div>
      </header>

      {/* 메인 콘텐츠 */}
      <main className="max-w-2xl mx-auto px-4 py-8">

        {state.phase === 'IDLE' && (
          <IdleScreen onStart={machine.start} loading={loading} />
        )}

        {(state.phase === 'SPIN' || state.phase === 'PICK') && (
          <div className="flex flex-col gap-6">
            <p className="text-center text-sm text-[var(--card-role,#a0a0c0)]">
              {t.round(state.round + 1)} / 5
            </p>
            {state.phase === 'SPIN' && (
              <p className="text-center text-white animate-pulse">{t.spinLabel}</p>
            )}
            {state.phase === 'PICK' && state.spunTeam && (
              <PickScreen
                roster={machine.currentRoster}
                pickedPlayerIds={machine.pickedPlayerIds}
                emptyRoles={machine.emptyRoles}
                onPick={(p) => machine.pick(p, state.spunTeam!)}
                onRerollTeam={machine.rerollTeam}
                onRerollYear={machine.rerollYear}
                teamRerollLeft={state.teamRerollLeft}
                yearRerollLeft={state.yearRerollLeft}
                spunTeam={state.spunTeam}
              />
            )}
          </div>
        )}

        {state.phase === 'SIM' && (
          <p className="text-center text-white animate-pulse py-12">{t.simulating}</p>
        )}

        {state.phase === 'REVEAL' && state.simResult && (
          <RevealScreen
            steps={state.simResult.steps}
            revealStep={state.revealStep}
            onSkip={machine.revealSkip}
            opponents={data?.opponents ?? null}
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

      {/* 푸터는 layout.tsx 전역 §10 */}
    </div>
  )
}
