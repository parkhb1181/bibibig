'use client'
// §6.1 Draft state machine hook
// IDLE → SPIN(roundN) → PICK(roundN) → [round<5? SPIN(round+1) : SIM] → REVEAL → RESULT
// GAME_SPEC §2: single full-team reroll (fullReroll) instead of per-team/year buttons

import { useReducer, useCallback } from 'react'
import { mulberry32 } from './prng'
import { simulate } from './sim'
import type { PlayerSeason, TeamYear } from './data'
import type { SimResult } from './sim'
import type { Opponent } from './sim'

export const ROLES = ['TOP', 'JGL', 'MID', 'ADC', 'SUP'] as const
export type Role = typeof ROLES[number]

// ── State types ───────────────────────────────────────────────────────────────

export type DraftPhase =
  | 'IDLE'
  | 'SPIN'      // Spinning team for current round
  | 'PICK'      // Picking player from spun team roster
  | 'SIM'       // 5 picks done → running simulation (synchronous, nearly instant)
  | 'REVEAL'    // Displaying SimResult.steps sequentially
  | 'RESULT'    // Final result screen

export type PickedPlayer = {
  player: PlayerSeason
  teamYear: TeamYear
}

export type DraftState = {
  phase: DraftPhase
  seed: number
  round: number           // 0-based (0~4)
  picks: (PickedPlayer | null)[]   // length 5, order: TOP/JGL/MID/ADC/SUP

  // TeamYear drawn during SPIN phase
  spunTeam: TeamYear | null

  // Reroll remaining — GAME_SPEC §2: full-team 1x (fullReroll)
  rerollLeft: number

  // REVEAL progress
  revealStep: number       // index of last displayed step
  simResult: SimResult | null

  // Error message
  error: string | null
}

// ── Action types ──────────────────────────────────────────────────────────────

type Action =
  | { type: 'START'; seed: number; spunTeam: TeamYear }          // IDLE → PICK
  | { type: 'SPIN_DONE'; spunTeam: TeamYear }                    // Spin result confirmed → PICK
  | { type: 'FULL_REROLL'; spunTeam: TeamYear }                  // Full team re-draw (GAME_SPEC §2)
  | { type: 'PICK'; player: PlayerSeason; teamYear: TeamYear }   // Player selected → next SPIN or SIM
  | { type: 'SIM_DONE'; result: SimResult }                      // SIM → REVEAL
  | { type: 'REVEAL_NEXT' }                                      // Show 1 step
  | { type: 'REVEAL_SKIP' }                                      // Jump to RESULT immediately
  | { type: 'RESET' }                                            // RESULT → IDLE

// ── Initial state ─────────────────────────────────────────────────────────────

// 라운드당 풀팀 리롤 최대 횟수 (GAME_SPEC §2)
const REROLL_MAX = 2

const INITIAL_STATE: DraftState = {
  phase: 'IDLE',
  seed: 0,
  round: 0,
  picks: [null, null, null, null, null],
  spunTeam: null,
  rerollLeft: REROLL_MAX,
  revealStep: 0,
  simResult: null,
  error: null,
}

// ── Reducer ───────────────────────────────────────────────────────────────────

function reducer(state: DraftState, action: Action): DraftState {
  switch (action.type) {

    // START: store seed, receive first spin result → PICK
    case 'START':
      return {
        ...INITIAL_STATE,
        phase: 'PICK',
        seed: action.seed,
        round: 0,
        spunTeam: action.spunTeam,
        rerollLeft: REROLL_MAX,
      }

    // SPIN_DONE: round-start spin result → PICK screen
    case 'SPIN_DONE':
      return { ...state, phase: 'PICK', spunTeam: action.spunTeam, error: null }

    // FULL_REROLL: full team re-draw (GAME_SPEC §2) — new team + new year
    case 'FULL_REROLL':
      return {
        ...state,
        spunTeam: action.spunTeam,
        rerollLeft: state.rerollLeft - 1,
        error: null,
      }

    // PICK: player selected → update picks array, then next round or SIM
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
        error: null,
      }
    }

    // SIM_DONE: simulation complete → start REVEAL
    case 'SIM_DONE':
      return { ...state, phase: 'REVEAL', simResult: action.result, revealStep: 0 }

    // REVEAL_NEXT: show 1 step at a time (1000ms interval)
    case 'REVEAL_NEXT': {
      if (!state.simResult) return state
      const next = state.revealStep + 1
      if (next >= state.simResult.steps.length) {
        return { ...state, phase: 'RESULT', revealStep: next }
      }
      return { ...state, revealStep: next }
    }

    // REVEAL_SKIP: Skip button → jump to RESULT immediately
    case 'REVEAL_SKIP':
      return {
        ...state,
        phase: 'RESULT',
        revealStep: state.simResult?.steps.length ?? 0,
      }

    // RESET: play again
    case 'RESET':
      return { ...INITIAL_STATE }

    default:
      return state
  }
}

// ── spin-index + data load types ──────────────────────────────────────────────

export type SpinIndex = Record<Role, string[]>

export type DraftData = {
  players: PlayerSeason[]
  teams: TeamYear[]
  spinIndex: SpinIndex
  opponents: { regular: Opponent[]; msi: Opponent[]; worlds: Opponent[] }
}

// ── Weighted draw helper ───────────────────────────────────────────────────────

// Teams already picked in this game → weight reduced by this factor (not zero — keeps dream team possible)
const REPEAT_PENALTY = 0.05

function weightedDraw(
  pool: string[],
  teamMap: Map<string, TeamYear>,
  rng: () => number,
  penalizedKeys?: Set<string>  // already-picked teams → weight * REPEAT_PENALTY
): string {
  let total = 0
  for (const k of pool) {
    const w = teamMap.get(k)?.weight ?? 1
    total += penalizedKeys?.has(k) ? w * REPEAT_PENALTY : w
  }
  let r = rng() * total
  for (const k of pool) {
    const w = teamMap.get(k)?.weight ?? 1
    r -= penalizedKeys?.has(k) ? w * REPEAT_PENALTY : w
    if (r <= 0) return k
  }
  return pool[pool.length - 1]
}

// ── §6.1 Two-stage spin pool filter ───────────────────────────────────────────

function buildSpinPool(
  emptyRoles: Role[],
  pickedPlayerIds: Set<string>,
  spinIndex: SpinIndex,
  teamMap: Map<string, TeamYear>,
  playersByTeam: Map<string, PlayerSeason[]>
): string[] {
  // Stage 1: union of TeamYear that have any empty role
  const base = new Set<string>()
  for (const role of emptyRoles) {
    for (const k of (spinIndex[role] ?? [])) base.add(k)
  }

  // Stage 2: only teams with at least one un-picked player in an empty slot position (soft-lock prevention)
  const valid = [...base].filter(key => {
    const roster = playersByTeam.get(key) ?? []
    return roster.some(
      p => emptyRoles.includes(p.role as Role) && !pickedPlayerIds.has(p.playerId)
    )
  })

  return valid.length > 0 ? valid : [...base]
}

// ── Hook public interface ─────────────────────────────────────────────────────

/**
 * useDraftMachine
 * Manages §6.1 state machine via useReducer.
 * data: 4 JSON files fetched after mount by DraftPage (players/teams/spin-index/opponents)
 */
export function useDraftMachine(data: DraftData | null) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE)

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

  // Per-round rng instance — unique seed via round × salt (determinism)
  const getRng = (round: number) =>
    mulberry32(((state.seed ^ (round * 0x9E3779B9)) >>> 0))

  // ── Handlers ──────────────────────────────────────────────────────────────

  // start: generate seed → first spin → PICK
  const start = useCallback(() => {
    if (!data) return
    // §6.1, §13.5: crypto access only inside click handler
    const seed = crypto.getRandomValues(new Uint32Array(1))[0]
    const rng = mulberry32(seed)
    const emptyRoles = [...ROLES]
    const pool = buildSpinPool(emptyRoles, new Set(), data.spinIndex as SpinIndex, teamMap, playersByTeam)
    // First spin: no picks yet → no penalty
    const teamKey = weightedDraw(pool, teamMap, rng, new Set())
    const spunTeam = teamMap.get(teamKey)!
    dispatch({ type: 'START', seed, spunTeam })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  // spinNext: next round spin (called immediately after PICK → SPIN via useEffect)
  const spinNext = useCallback((round: number, pickedPlayerIds: Set<string>, emptyRoles: Role[]) => {
    if (!data) return
    // Already-picked team keys → apply REPEAT_PENALTY
    const pickedTeamKeys = new Set(state.picks.filter(Boolean).map(p => p!.teamYear.key))
    const rng = getRng(round)
    const pool = buildSpinPool(emptyRoles, pickedPlayerIds, data.spinIndex as SpinIndex, teamMap, playersByTeam)
    const teamKey = weightedDraw(pool, teamMap, rng, pickedTeamKeys)
    const spunTeam = teamMap.get(teamKey)!
    dispatch({ type: 'SPIN_DONE', spunTeam })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, state.seed, state.picks])

  // fullReroll: full team re-draw (GAME_SPEC §2)
  const fullReroll = useCallback(() => {
    if (!data || state.rerollLeft <= 0) return
    const emptyRoles = ROLES.filter((_, i) => state.picks[i] === null)
    const pickedIds = new Set(state.picks.filter(Boolean).map(p => p!.player.playerId))
    // Already-picked team keys → REPEAT_PENALTY (same for reroll)
    const pickedTeamKeys = new Set(state.picks.filter(Boolean).map(p => p!.teamYear.key))
    const rng = getRng(state.round)
    // getRng(round)는 매 호출마다 동일 시드로 재생성된다. 같은 라운드에서 리롤을 여러 번 눌러도
    // 매번 같은 결과가 나오던 버그를 방지하기 위해, 이미 소비한 리롤 수만큼 스트림을 추가로 건너뛴다.
    // 원본 스핀이 index 0을 소비하므로 1번째 리롤은 index 1, 2번째 리롤은 index 2를 사용한다.
    const rerollsUsed = REROLL_MAX - state.rerollLeft
    for (let i = 0; i <= rerollsUsed; i++) rng()
    const pool = buildSpinPool(emptyRoles, pickedIds, data.spinIndex as SpinIndex, teamMap, playersByTeam)
    const teamKey = weightedDraw(pool, teamMap, rng, pickedTeamKeys)
    const spunTeam = teamMap.get(teamKey)!
    dispatch({ type: 'FULL_REROLL', spunTeam })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, state.rerollLeft, state.round, state.picks, state.seed])

  // pick: player selection
  const pick = useCallback((player: PlayerSeason, teamYear: TeamYear) => {
    dispatch({ type: 'PICK', player, teamYear })
  }, [])

  // runSim: run simulation (called from useEffect when SIM phase starts)
  const runSim = useCallback(() => {
    if (!data || state.simResult) return
    const filledPicks = state.picks.filter(Boolean) as PickedPlayer[]
    if (filledPicks.length < 5) return
    const simPlayers = ROLES.map(role => {
      const p = state.picks[ROLES.indexOf(role)]!
      return { playerId: p.player.playerId, role: p.player.role as Role, ovr: p.player.ovr }
    })
    const result = simulate(simPlayers, data.opponents, state.seed)
    dispatch({ type: 'SIM_DONE', result })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, state.picks, state.seed, state.simResult])

  // REVEAL step advance
  const revealNext = useCallback(() => dispatch({ type: 'REVEAL_NEXT' }), [])
  const revealSkip = useCallback(() => dispatch({ type: 'REVEAL_SKIP' }), [])
  const reset = useCallback(() => dispatch({ type: 'RESET' }), [])

  // Current empty roles
  const emptyRoles = ROLES.filter((_, i) => state.picks[i] === null)

  // Current picked playerId set
  const pickedPlayerIds = new Set(
    state.picks.filter(Boolean).map(p => p!.player.playerId)
  )

  // Current spunTeam roster (for pick screen display)
  const currentRoster: PlayerSeason[] = state.spunTeam
    ? (playersByTeam.get(state.spunTeam.key) ?? [])
    : []

  return {
    state,
    emptyRoles,
    pickedPlayerIds,
    currentRoster,
    start,
    spinNext,
    fullReroll,
    pick,
    runSim,
    revealNext,
    revealSkip,
    reset,
  }
}
