'use client'
// §6.1 드래프트 상태머신 훅
// IDLE → SPIN(roundN) → PICK(roundN) → [round<5? SPIN(round+1) : SIM] → REVEAL → RESULT

import { useReducer, useCallback } from 'react'
import { mulberry32 } from './prng'
import { simulate } from './sim'
import type { PlayerSeason, TeamYear } from './data'
import type { SimResult } from './sim'
import type { Opponent } from './sim'

export const ROLES = ['TOP', 'JGL', 'MID', 'ADC', 'SUP'] as const
export type Role = typeof ROLES[number]

// ── 상태 타입 ────────────────────────────────────────────────────────────────

export type DraftPhase =
  | 'IDLE'
  | 'SPIN'      // 현재 라운드 팀 추첨 중
  | 'PICK'      // 추첨된 팀 로스터에서 선수 선택
  | 'SIM'       // 5픽 완료 → 시뮬 실행 중 (사실상 동기라 거의 즉시)
  | 'REVEAL'    // SimResult.steps 순차 표시 중
  | 'RESULT'    // 최종 결과 화면

export type PickedPlayer = {
  player: PlayerSeason
  teamYear: TeamYear
}

export type DraftState = {
  phase: DraftPhase
  seed: number
  round: number           // 0-based (0~4)
  picks: (PickedPlayer | null)[]   // 길이 5, 순서: TOP/JGL/MID/ADC/SUP

  // SPIN 단계에서 추첨된 TeamYear
  spunTeam: TeamYear | null

  // 리롤 잔여
  teamRerollLeft: number   // 팀 리롤 1회
  yearRerollLeft: number   // 연도 리롤 1회

  // PRNG 소비 위치 추적 — 리롤 시 동일 풀 재추첨을 위해 별도 카운터 불필요
  // draftRng는 외부 참조(클로저)로 유지; 상태엔 저장하지 않음 (순수성 유지)
  // → 실제 rng 함수는 액션 핸들러에서 직접 주입

  // REVEAL 진행
  revealStep: number       // 현재까지 표시된 step 인덱스
  simResult: SimResult | null

  // 에러 메시지 (소프트락 등)
  error: string | null
}

// ── 액션 타입 ────────────────────────────────────────────────────────────────

type Action =
  | { type: 'START'; seed: number; spunTeam: TeamYear }          // IDLE → SPIN
  | { type: 'SPIN_DONE'; spunTeam: TeamYear }                    // 스핀 결과 확정 → PICK
  | { type: 'REROLL_TEAM'; spunTeam: TeamYear }                  // 팀 재추첨 결과
  | { type: 'REROLL_YEAR'; spunTeam: TeamYear }                  // 연도 재추첨 결과
  | { type: 'PICK'; player: PlayerSeason; teamYear: TeamYear }   // 선수 선택 → 다음 SPIN or SIM
  | { type: 'SIM_DONE'; result: SimResult }                      // SIM → REVEAL
  | { type: 'REVEAL_NEXT' }                                      // step 1개 표시
  | { type: 'REVEAL_SKIP' }                                      // 즉시 RESULT
  | { type: 'RESET' }                                            // RESULT → IDLE

// ── 초기 상태 ────────────────────────────────────────────────────────────────

const INITIAL_STATE: DraftState = {
  phase: 'IDLE',
  seed: 0,
  round: 0,
  picks: [null, null, null, null, null],
  spunTeam: null,
  teamRerollLeft: 1,
  yearRerollLeft: 1,
  revealStep: 0,
  simResult: null,
  error: null,
}

// ── 리듀서 ──────────────────────────────────────────────────────────────────

function reducer(state: DraftState, action: Action): DraftState {
  switch (action.type) {

    // START: 시작 버튼 클릭 → seed 저장, 첫 스핀 결과 수신
    case 'START':
      return {
        ...INITIAL_STATE,
        phase: 'PICK',    // 스핀 결과가 이미 계산됨
        seed: action.seed,
        round: 0,
        spunTeam: action.spunTeam,
        teamRerollLeft: 1,
        yearRerollLeft: 1,
      }

    // SPIN_DONE: 라운드 시작 시 스핀 결과 수신 → PICK 화면으로
    case 'SPIN_DONE':
      return { ...state, phase: 'PICK', spunTeam: action.spunTeam, error: null }

    // REROLL_TEAM: 팀 리롤 결과 수신 (연도 유지, 팀 재추첨)
    case 'REROLL_TEAM':
      return {
        ...state,
        spunTeam: action.spunTeam,
        teamRerollLeft: state.teamRerollLeft - 1,
        yearRerollLeft: state.yearRerollLeft,  // 연도 리롤 잔여 유지
        error: null,
      }

    // REROLL_YEAR: 연도 리롤 결과 수신 (팀 유지, 연도 재추첨)
    case 'REROLL_YEAR':
      return {
        ...state,
        spunTeam: action.spunTeam,
        yearRerollLeft: state.yearRerollLeft - 1,
        error: null,
      }

    // PICK: 선수 선택 → picks 배열 갱신 후 다음 라운드 or SIM
    case 'PICK': {
      const roleIdx = ROLES.indexOf(action.player.role as Role)
      const newPicks = [...state.picks]
      newPicks[roleIdx] = { player: action.player, teamYear: action.teamYear }

      const nextRound = state.round + 1
      const allFilled = newPicks.every(p => p !== null)

      return {
        ...state,
        phase: allFilled ? 'SIM' : 'SPIN',
        round: nextRound,
        picks: newPicks,
        spunTeam: null,
        // 리롤 카운터는 라운드 넘어가도 유지 (게임 전체 공유)
        error: null,
      }
    }

    // SIM_DONE: 시뮬 완료 → REVEAL 시작
    case 'SIM_DONE':
      return { ...state, phase: 'REVEAL', simResult: action.result, revealStep: 0 }

    // REVEAL_NEXT: step 1개씩 표시 (600ms 인터벌)
    case 'REVEAL_NEXT': {
      if (!state.simResult) return state
      const next = state.revealStep + 1
      if (next >= state.simResult.steps.length) {
        return { ...state, phase: 'RESULT', revealStep: next }
      }
      return { ...state, revealStep: next }
    }

    // REVEAL_SKIP: Skip 버튼 → 즉시 RESULT
    case 'REVEAL_SKIP':
      return {
        ...state,
        phase: 'RESULT',
        revealStep: state.simResult?.steps.length ?? 0,
      }

    // RESET: 다시 하기
    case 'RESET':
      return { ...INITIAL_STATE }

    default:
      return state
  }
}

// ── spin-index + 데이터 로드 타입 ────────────────────────────────────────────

export type SpinIndex = Record<Role, string[]>

export type DraftData = {
  players: PlayerSeason[]
  teams: TeamYear[]
  spinIndex: SpinIndex
  opponents: { regular: Opponent[]; intl: Opponent[] }
}

// ── 가중 추첨 헬퍼 ─────────────────────────────────────────────────────────

function weightedDraw(pool: string[], teamMap: Map<string, TeamYear>, rng: () => number): string {
  let total = 0
  for (const k of pool) total += teamMap.get(k)?.weight ?? 1
  let r = rng() * total
  for (const k of pool) {
    r -= teamMap.get(k)?.weight ?? 1
    if (r <= 0) return k
  }
  return pool[pool.length - 1]
}

// ── §6.1 2단 필터 스핀 풀 계산 ────────────────────────────────────────────

function buildSpinPool(
  emptyRoles: Role[],
  pickedPlayerIds: Set<string>,
  spinIndex: SpinIndex,
  teamMap: Map<string, TeamYear>,
  playersByTeam: Map<string, PlayerSeason[]>
): string[] {
  // 1단: 빈 역할 보유 TeamYear 합집합
  const base = new Set<string>()
  for (const role of emptyRoles) {
    for (const k of (spinIndex[role] ?? [])) base.add(k)
  }

  // 2단: 빈 슬롯 포지션에 미픽 선수가 있는 팀만 (소프트락 방지)
  const valid = [...base].filter(key => {
    const roster = playersByTeam.get(key) ?? []
    return roster.some(
      p => emptyRoles.includes(p.role as Role) && !pickedPlayerIds.has(p.playerId)
    )
  })

  return valid.length > 0 ? valid : [...base]
}

// ── 훅 공개 인터페이스 ────────────────────────────────────────────────────────

/**
 * useDraftMachine
 * §6.1 상태머신을 useReducer로 관리.
 * data: DraftPage가 마운트 후 fetch한 JSON 4종 (players/teams/spin-index/opponents)
 */
export function useDraftMachine(data: DraftData | null) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE)

  // 인덱스 — data 변경 시에만 재구성 (useMemo 대신 inline 계산, data가 한 번만 세팅됨)
  const teamMap = data
    ? new Map<string, TeamYear>(data.teams.map(t => [t.key, t]))
    : new Map<string, TeamYear>()

  const playersByTeam = data
    ? (() => {
        const m = new Map<string, PlayerSeason[]>()
        for (const p of data.players) {
          const k = `${p.teamSlug}_${p.year}`
          if (!m.has(k)) m.set(k, [])
          m.get(k)!.push(p)
        }
        return m
      })()
    : new Map<string, PlayerSeason[]>()

  // draftRng — seed로부터 매번 재생성해서 사용 횟수를 추적
  // 리롤 등으로 소비 횟수가 달라지므로 컴포넌트 외부(클로저)에 보관하지 않고
  // 이벤트 핸들러 호출 시점에 현재 소비 횟수를 replay해서 동일 위치에서 추첨
  // → 단순화: 각 라운드 시작마다 (seed XOR roundSalt)로 새 rng 인스턴스 생성
  //   (리롤은 같은 라운드 rng에서 연속 draw → 결정론 유지)
  // round 0: rng(seed ^ 0), round 1: rng(seed ^ 1), ...
  const getRng = (round: number) =>
    mulberry32(((state.seed ^ (round * 0x9E3779B9)) >>> 0))

  // ── 핸들러 ─────────────────────────────────────────────────────────────

  // 시작: seed 생성 → 첫 스핀 → PICK
  const start = useCallback(() => {
    if (!data) return
    // §6.1, §13.5: 클릭 핸들러에서만 crypto 접근
    const seed = crypto.getRandomValues(new Uint32Array(1))[0]
    const rng = mulberry32(seed)
    const emptyRoles = [...ROLES]
    const pool = buildSpinPool(emptyRoles, new Set(), data.spinIndex as SpinIndex, teamMap, playersByTeam)
    const teamKey = weightedDraw(pool, teamMap, rng)
    const spunTeam = teamMap.get(teamKey)!
    dispatch({ type: 'START', seed, spunTeam })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  // 다음 라운드 스핀 (PICK → SPIN 전이 후 즉시 호출 — useEffect에서 구동)
  const spinNext = useCallback((round: number, pickedPlayerIds: Set<string>, emptyRoles: Role[]) => {
    if (!data) return
    const rng = getRng(round)
    const pool = buildSpinPool(emptyRoles, pickedPlayerIds, data.spinIndex as SpinIndex, teamMap, playersByTeam)
    const teamKey = weightedDraw(pool, teamMap, rng)
    const spunTeam = teamMap.get(teamKey)!
    dispatch({ type: 'SPIN_DONE', spunTeam })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, state.seed])

  // 팀 리롤 (연도 유지, 팀 재추첨)
  const rerollTeam = useCallback(() => {
    if (!data || !state.spunTeam || state.teamRerollLeft <= 0) return
    const emptyRoles = ROLES.filter((_, i) => state.picks[i] === null)
    const pickedIds = new Set(state.picks.filter(Boolean).map(p => p!.player.playerId))

    // 현재 연도와 같은 연도의 다른 팀만 필터
    const rng = getRng(state.round)
    // 소비 횟수 맞추기: 첫 draw(1회) 이미 소비됨 → 추가 draw
    rng() // 첫 spin draw 스킵
    if (state.teamRerollLeft < 1) return // 이미 소비됨

    const currentYear = state.spunTeam.year
    const pool = buildSpinPool(emptyRoles, pickedIds, data.spinIndex as SpinIndex, teamMap, playersByTeam)
    // 같은 연도 다른 팀 필터
    let sameYearPool = pool.filter(k => {
      const t = teamMap.get(k)
      return t && t.year === currentYear && k !== state.spunTeam!.key
    })
    // 공집합이면 제약 해제 (락 방지)
    if (sameYearPool.length === 0) sameYearPool = pool.filter(k => k !== state.spunTeam!.key)
    if (sameYearPool.length === 0) sameYearPool = pool

    const teamKey = weightedDraw(sameYearPool, teamMap, rng)
    const spunTeam = teamMap.get(teamKey)!
    dispatch({ type: 'REROLL_TEAM', spunTeam })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, state.spunTeam, state.teamRerollLeft, state.round, state.picks, state.seed])

  // 연도 리롤 (팀 유지, 연도 재추첨)
  const rerollYear = useCallback(() => {
    if (!data || !state.spunTeam || state.yearRerollLeft <= 0) return
    const emptyRoles = ROLES.filter((_, i) => state.picks[i] === null)
    const pickedIds = new Set(state.picks.filter(Boolean).map(p => p!.player.playerId))

    const rng = getRng(state.round)
    rng() // 첫 spin draw 스킵
    if (state.teamRerollLeft < 1) rng() // 팀 리롤 draw 스킵(이미 사용됐으면)

    const currentTeamSlug = state.spunTeam.teamSlug
    // 같은 팀 다른 연도 TeamYear 목록
    const sameTeamYears = data.teams.filter(t => {
      if (t.teamSlug !== currentTeamSlug || t.year === state.spunTeam!.year) return false
      const pool = buildSpinPool(emptyRoles, pickedIds, data.spinIndex as SpinIndex, teamMap, playersByTeam)
      return pool.includes(t.key)
    })
    // 공집합이면 전체 유효 풀에서 추첨 (락 방지)
    const pool = sameTeamYears.length > 0
      ? sameTeamYears.map(t => t.key)
      : buildSpinPool(emptyRoles, pickedIds, data.spinIndex as SpinIndex, teamMap, playersByTeam)
        .filter(k => k !== state.spunTeam!.key)

    const teamKey = weightedDraw(pool.length > 0 ? pool : [state.spunTeam.key], teamMap, rng)
    const spunTeam = teamMap.get(teamKey)!
    dispatch({ type: 'REROLL_YEAR', spunTeam })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, state.spunTeam, state.yearRerollLeft, state.round, state.picks, state.seed])

  // 선수 픽
  const pick = useCallback((player: PlayerSeason, teamYear: TeamYear) => {
    dispatch({ type: 'PICK', player, teamYear })
  }, [])

  // 시뮬 실행 (SIM 단계 진입 시 useEffect에서 호출)
  const runSim = useCallback(() => {
    if (!data || !state.simResult) {
      if (!data) return
      const filledPicks = state.picks.filter(Boolean) as PickedPlayer[]
      if (filledPicks.length < 5) return
      const simPlayers = ROLES.map(role => {
        const p = state.picks[ROLES.indexOf(role)]!
        return { playerId: p.player.playerId, role: p.player.role as Role, ovr: p.player.ovr }
      })
      const result = simulate(simPlayers, data.opponents, state.seed)
      dispatch({ type: 'SIM_DONE', result })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, state.picks, state.seed, state.simResult])

  // REVEAL step 진행 (600ms 인터벌 useEffect에서 호출)
  const revealNext = useCallback(() => dispatch({ type: 'REVEAL_NEXT' }), [])
  const revealSkip = useCallback(() => dispatch({ type: 'REVEAL_SKIP' }), [])
  const reset = useCallback(() => dispatch({ type: 'RESET' }), [])

  // 현재 빈 역할 목록
  const emptyRoles = ROLES.filter((_, i) => state.picks[i] === null)

  // 현재 픽된 playerId 집합
  const pickedPlayerIds = new Set(
    state.picks.filter(Boolean).map(p => p!.player.playerId)
  )

  // 현재 spunTeam의 로스터 (픽 화면 표시용)
  const currentRoster: PlayerSeason[] = state.spunTeam
    ? (playersByTeam.get(state.spunTeam.key) ?? [])
    : []

  return {
    state,
    emptyRoles,
    pickedPlayerIds,
    currentRoster,
    // 핸들러
    start,
    spinNext,
    rerollTeam,
    rerollYear,
    pick,
    runSim,
    revealNext,
    revealSkip,
    reset,
  }
}
