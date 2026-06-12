// §7 DoD: 몬테카를로 검증 — 그리디 + 균등 랜덤 픽 정책 × 각 10,000회
// npx tsx scripts/09-montecarlo.ts
// 목표 (그리디 픽 기준): GRAND SLAM 3~8%, LEGENDARY+ELITE 15~20%, REBUILD ≤25%

import fs from 'fs'
import path from 'path'
import { mulberry32 } from '../src/lib/prng'
import { simulate, setEloScale, getEloScale } from '../src/lib/sim'
import { GRADE_CUT } from '../src/lib/grade'
import type { SimPlayer, Opponent } from '../src/lib/sim'
import type { Grade } from '../src/lib/grade'
import type { TeamYear } from '../src/lib/data'

const ROLES = ['TOP', 'JGL', 'MID', 'ADC', 'SUP'] as const
type Role = typeof ROLES[number]

type PlayerEntry = {
  id: string
  playerId: string
  role: Role
  ovr: number
  teamKey: string
  year: number
}

type SpinIndex = Record<Role, string[]>

function loadData() {
  const root = path.join(process.cwd(), 'public', 'data')
  const players: { id: string; playerId: string; role: Role; ovr: number; team: string; teamSlug: string; year: number }[] =
    JSON.parse(fs.readFileSync(path.join(root, 'players.json'), 'utf-8'))
  const teams: TeamYear[] = JSON.parse(fs.readFileSync(path.join(root, 'teams.json'), 'utf-8'))
  const spinIndex: SpinIndex = JSON.parse(fs.readFileSync(path.join(root, 'spin-index.json'), 'utf-8'))
  const opponents: { regular: Opponent[]; msi: Opponent[]; worlds: Opponent[] } =
    JSON.parse(fs.readFileSync(path.join(root, 'opponents-2026.json'), 'utf-8'))
  return { players, teams, spinIndex, opponents }
}

// §6.1 가중 추첨 — TeamYear.weight 비례 샘플링
function weightedDraw(
  pool: string[],       // TeamYear.key 목록
  teamMap: Map<string, TeamYear>,
  rng: () => number
): string {
  let total = 0
  for (const k of pool) total += teamMap.get(k)?.weight ?? 1
  let r = rng() * total
  for (const k of pool) {
    r -= teamMap.get(k)?.weight ?? 1
    if (r <= 0) return k
  }
  return pool[pool.length - 1]
}

// 스핀: §6.1 2단 필터 적용 후 가중 추첨
function spin(
  emptyRoles: Role[],
  pickedPlayerIds: Set<string>,
  spinIndex: SpinIndex,
  teamMap: Map<string, TeamYear>,
  playerMap: Map<string, PlayerEntry[]>,  // teamKey → players
  rng: () => number
): string {
  // 1단계: 빈 역할 보유 TeamYear 합집합
  const base = new Set<string>()
  for (const role of emptyRoles) {
    for (const k of (spinIndex[role] ?? [])) base.add(k)
  }

  // 2단계: 빈 슬롯을 채울 수 있는 미픽 선수 보유 팀만
  const valid = [...base].filter(key => {
    const roster = playerMap.get(key) ?? []
    return roster.some(
      p => emptyRoles.includes(p.role) && !pickedPlayerIds.has(p.playerId)
    )
  })

  const pool = valid.length > 0 ? valid : [...base]
  return weightedDraw(pool, teamMap, rng)
}

// 그리디 픽: 노출 로스터에서 빈 슬롯 채울 수 있는 최고 OVR 선수
function greedyPick(
  teamKey: string,
  emptyRoles: Role[],
  pickedPlayerIds: Set<string>,
  playerMap: Map<string, PlayerEntry[]>
): PlayerEntry | null {
  const roster = playerMap.get(teamKey) ?? []
  const candidates = roster.filter(
    p => emptyRoles.includes(p.role) && !pickedPlayerIds.has(p.playerId)
  )
  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.ovr - a.ovr)
  return candidates[0]
}

// 랜덤 픽: 유효 후보 중 균등 랜덤
function randomPick(
  teamKey: string,
  emptyRoles: Role[],
  pickedPlayerIds: Set<string>,
  playerMap: Map<string, PlayerEntry[]>,
  rng: () => number
): PlayerEntry | null {
  const roster = playerMap.get(teamKey) ?? []
  const candidates = roster.filter(
    p => emptyRoles.includes(p.role) && !pickedPlayerIds.has(p.playerId)
  )
  if (candidates.length === 0) return null
  return candidates[Math.floor(rng() * candidates.length)]
}

function runPolicy(
  policy: 'greedy' | 'random',
  iterations: number,
  spinIndex: SpinIndex,
  teamMap: Map<string, TeamYear>,
  playerMap: Map<string, PlayerEntry[]>,
  opponents: { regular: Opponent[]; msi: Opponent[]; worlds: Opponent[] }
): Map<Grade, number> {
  const gradeCount = new Map<Grade, number>()

  for (let i = 0; i < iterations; i++) {
    const seed = (i * 1_000_003 + 0xDEADBEEF) >>> 0
    const draftRng = mulberry32(seed)

    const picks: SimPlayer[] = []
    const pickedPlayerIds = new Set<string>()
    const filledRoles = new Set<Role>()

    for (let round = 0; round < 5; round++) {
      const emptyRoles = ROLES.filter(r => !filledRoles.has(r))
      const teamKey = spin(emptyRoles, pickedPlayerIds, spinIndex, teamMap, playerMap, draftRng)

      const picked =
        policy === 'greedy'
          ? greedyPick(teamKey, emptyRoles, pickedPlayerIds, playerMap)
          : randomPick(teamKey, emptyRoles, pickedPlayerIds, playerMap, draftRng)

      if (!picked) {
        // 소프트락 방지 — 픽 실패 시 임의 채움 (예외 케이스)
        const fallback: SimPlayer = { playerId: `fallback_${round}`, role: emptyRoles[0], ovr: 60 }
        picks.push(fallback)
        filledRoles.add(emptyRoles[0])
        continue
      }

      picks.push({ playerId: picked.playerId, role: picked.role, ovr: picked.ovr })
      pickedPlayerIds.add(picked.playerId)
      filledRoles.add(picked.role)
    }

    const result = simulate(picks as SimPlayer[], opponents, seed)
    gradeCount.set(result.grade, (gradeCount.get(result.grade) ?? 0) + 1)
  }

  return gradeCount
}

const GRADE_ORDER: Grade[] = [
  'GRAND SLAM', 'LEGENDARY', 'ELITE', 'CONTENDER', 'PLAYOFF TEAM', 'REBUILD',
]

function printTable(label: string, counts: Map<Grade, number>, total: number) {
  console.log(`\n=== ${label} (n=${total.toLocaleString()}) ===`)
  for (const g of GRADE_ORDER) {
    const n = counts.get(g) ?? 0
    const pct = ((n / total) * 100).toFixed(1)
    const bar = '█'.repeat(Math.round(n / total * 50))
    console.log(`  ${g.padEnd(14)} ${String(n).padStart(6)}  ${pct.padStart(5)}%  ${bar}`)
  }
}

// 통제 시나리오: 고정 OVR 5인 팀을 N회 시뮬(시드만 변동) → 팀 강함→등급 순수 분포
function runFixedTeam(
  ovrPerRole: number,
  iterations: number,
  opponents: { regular: Opponent[]; msi: Opponent[]; worlds: Opponent[] }
): Map<Grade, number> {
  const team: SimPlayer[] = ROLES.map(r => ({ playerId: `fixed_${r}`, role: r, ovr: ovrPerRole }))
  const counts = new Map<Grade, number>()
  for (let i = 0; i < iterations; i++) {
    const seed = (i * 2_654_435_761 + 0x1234567) >>> 0
    const res = simulate(team, opponents, seed)
    counts.set(res.grade, (counts.get(res.grade) ?? 0) + 1)
  }
  return counts
}

// 비교용 한 줄 행: S/라벨별 등급 분포 % 매트릭스
function rowOf(counts: Map<Grade, number>, total: number): string {
  return GRADE_ORDER
    .map(g => `${(((counts.get(g) ?? 0) / total) * 100).toFixed(1).padStart(5)}%`)
    .join(' ')
}
function printMatrixHeader(title: string) {
  console.log(`\n### ${title}`)
  const head = GRADE_ORDER.map(g => g.slice(0, 5).padStart(6)).join(' ')
  console.log(`  ${'cfg'.padEnd(16)} ${head}`)
}

// intl(MSI/Worlds) 풀 상위 레이팅 하향: cap 초과분을 cap으로 클램프 (regular는 손대지 않음)
function lowerIntlTop(
  opponents: { regular: Opponent[]; msi: Opponent[]; worlds: Opponent[] },
  cap: number
): { regular: Opponent[]; msi: Opponent[]; worlds: Opponent[] } {
  const clamp = (arr: Opponent[]) => arr.map(o => ({ ...o, rating: Math.min(o.rating, cap) }))
  return { regular: opponents.regular, msi: clamp(opponents.msi), worlds: clamp(opponents.worlds) }
}

// 그리디 목표 구간 (PRD 재정의 — 전원95 통제군 대신 그리디 픽 기준)
const TARGET = {
  gs: { lo: 3, hi: 8 },
  legElite: { lo: 15, hi: 20 },
  cont: { lo: 20, hi: 25 },
  rebuildMax: 25,
}

type VerifyMetrics = {
  gs: number
  legElite: number
  cont: number
  rebuild: number
  gsOk: boolean
  legEliteOk: boolean
  contOk: boolean
  rebuildOk: boolean
  miss: number
  allOk: boolean
}

function verifyMetrics(counts: Map<Grade, number>, total: number): VerifyMetrics {
  const gs = ((counts.get('GRAND SLAM') ?? 0) / total) * 100
  const legElite =
    (((counts.get('LEGENDARY') ?? 0) + (counts.get('ELITE') ?? 0)) / total) * 100
  const cont = ((counts.get('CONTENDER') ?? 0) / total) * 100
  const rebuild = ((counts.get('REBUILD') ?? 0) / total) * 100

  const gsOk = gs >= TARGET.gs.lo && gs <= TARGET.gs.hi
  const legEliteOk = legElite >= TARGET.legElite.lo && legElite <= TARGET.legElite.hi
  const contOk = cont >= TARGET.cont.lo && cont <= TARGET.cont.hi
  const rebuildOk = rebuild <= TARGET.rebuildMax

  const gsMiss = gsOk ? 0 : gs < TARGET.gs.lo ? TARGET.gs.lo - gs : gs - TARGET.gs.hi
  const legEliteMiss = legEliteOk
    ? 0
    : legElite < TARGET.legElite.lo
      ? TARGET.legElite.lo - legElite
      : legElite - TARGET.legElite.hi
  const contMiss = contOk ? 0 : cont < TARGET.cont.lo ? TARGET.cont.lo - cont : cont - TARGET.cont.hi
  const rebuildMiss = rebuildOk ? 0 : rebuild - TARGET.rebuildMax

  const miss = gsMiss * gsMiss + legEliteMiss * legEliteMiss + contMiss * contMiss + rebuildMiss * rebuildMiss
  return { gs, legElite, cont, rebuild, gsOk, legEliteOk, contOk, rebuildOk, miss, allOk: gsOk && legEliteOk && contOk && rebuildOk }
}

function printVerify(label: string, counts: Map<Grade, number>, total: number) {
  printTable(label, counts, total)
  const v = verifyMetrics(counts, total)
  console.log(
    `[판정] GS ${v.gs.toFixed(1)}%${v.gsOk ? ' OK' : ''} | ` +
    `LEG+EL ${v.legElite.toFixed(1)}%${v.legEliteOk ? ' OK' : ''} | ` +
    `CONT ${v.cont.toFixed(1)}%${v.contOk ? ' OK' : ''} | ` +
    `REB ${v.rebuild.toFixed(1)}%${v.rebuildOk ? ' OK' : ''} | ` +
    `miss=${v.miss.toFixed(1)}${v.allOk ? ' ★ 목표 충족' : ''}`
  )
  return v
}

type ComboMetrics = {
  gs: number
  legElite: number
  rebuild: number
  gsOk: boolean
  legEliteOk: boolean
  rebuildOk: boolean
  miss: number
}

function comboMetrics(counts: Map<Grade, number>, total: number): ComboMetrics {
  const gs = ((counts.get('GRAND SLAM') ?? 0) / total) * 100
  const legElite =
    (((counts.get('LEGENDARY') ?? 0) + (counts.get('ELITE') ?? 0)) / total) * 100
  const rebuild = ((counts.get('REBUILD') ?? 0) / total) * 100

  const gsOk = gs >= TARGET.gs.lo && gs <= TARGET.gs.hi
  const legEliteOk = legElite >= TARGET.legElite.lo && legElite <= TARGET.legElite.hi
  const rebuildOk = rebuild <= TARGET.rebuildMax

  const gsMiss = gsOk ? 0 : gs < TARGET.gs.lo ? TARGET.gs.lo - gs : gs - TARGET.gs.hi
  const legEliteMiss = legEliteOk
    ? 0
    : legElite < TARGET.legElite.lo
      ? TARGET.legElite.lo - legElite
      : legElite - TARGET.legElite.hi
  const rebuildMiss = rebuildOk ? 0 : rebuild - TARGET.rebuildMax

  const miss = gsMiss * gsMiss + legEliteMiss * legEliteMiss + rebuildMiss * rebuildMiss
  return { gs, legElite, rebuild, gsOk, legEliteOk, rebuildOk, miss }
}

function okMark(ok: boolean): string {
  return ok ? 'OK' : '--'
}

function main() {
  const root = path.join(process.cwd(), 'public', 'data')
  for (const f of ['players.json', 'teams.json', 'spin-index.json', 'opponents-2026.json']) {
    if (!fs.existsSync(path.join(root, f))) {
      console.error(`${f} 없음 — 07-build.ts 먼저 실행`)
      process.exit(1)
    }
  }

  const { players, teams, spinIndex, opponents } = loadData()

  // 인덱스 구축
  const teamMap = new Map<string, TeamYear>(teams.map(t => [t.key, t]))
  const playerMap = new Map<string, PlayerEntry[]>()

  for (const p of players) {
    const key = `${p.teamSlug}_${p.year}`
    if (!playerMap.has(key)) playerMap.set(key, [])
    playerMap.get(key)!.push({
      id: p.id,
      playerId: p.playerId,
      role: p.role,
      ovr: p.ovr,
      teamKey: key,
      year: p.year,
    })
  }

  const N = 10_000
  const meanOvr = Math.round(players.reduce((s, p) => s + p.ovr, 0) / players.length)
  const maxOvr = Math.max(...players.map(p => p.ovr))
  console.log(`몬테카를로 튜닝 하니스 — 각 ${N.toLocaleString()}회`)
  console.log(`[데이터] 선수 ${players.length}명, 평균 OVR ${meanOvr}, 최고 OVR ${maxOvr}`)

  // ── 1단계: 현재값(S=20) 진단 ───────────────────────────
  setEloScale(20)
  console.log('\n══════════ 1단계: 현재값 S=20 진단 ══════════')
  const greedy20 = runPolicy('greedy', N, spinIndex, teamMap, playerMap, opponents)
  const random20 = runPolicy('random', N, spinIndex, teamMap, playerMap, opponents)
  const fixed95_20 = runFixedTeam(95, N, opponents)
  const fixedMean_20 = runFixedTeam(meanOvr, N, opponents)
  printTable('그리디 픽 (최고 OVR, 유저 근사)', greedy20, N)
  printTable('균등 랜덤 픽 (베이스라인)', random20, N)
  printTable('통제: 전원 95 OVR 팀', fixed95_20, N)
  printTable(`통제: 전원 ${meanOvr} OVR(데이터 평균) 팀`, fixedMean_20, N)
  console.log('\n[목표 — 그리디 픽] GRAND SLAM 3~8% | LEG+ELITE 15~20% | REBUILD ≤25%')
  console.log(`[1단계 참고] 전원95 GRAND SLAM ${(((fixed95_20.get('GRAND SLAM') ?? 0) / N) * 100).toFixed(1)}% / 그리디 GRAND SLAM ${(((greedy20.get('GRAND SLAM') ?? 0) / N) * 100).toFixed(1)}% (S=20, cap=원본)`)

  // ── 2단계: S 스윕 ─────────────────────────────────────
  // 요청: 60, 80 (상향). + 검증: 14,10,8 (하향). Elo 공식상 S↓ 일수록 격차당 강팀 승률↑.
  const sValues = [20, 60, 80, 14, 10, 8]
  console.log('\n══════════ 2단계: S 스윕 ══════════')
  console.log('주의: winProb=1/(1+10^((opp-my)/S)) — S가 커지면 0.5로 수렴(격차 무력화), S가 작아지면 격차가 승률에 강하게 반영됨')

  printMatrixHeader('전원 95 OVR 팀 — S별 등급 분포')
  for (const s of sValues) {
    setEloScale(s)
    const c = runFixedTeam(95, N, opponents)
    console.log(`  S=${String(s).padEnd(14)} ${rowOf(c, N)}`)
  }
  printMatrixHeader('그리디 픽 — S별 등급 분포')
  for (const s of sValues) {
    setEloScale(s)
    const c = runPolicy('greedy', N, spinIndex, teamMap, playerMap, opponents)
    console.log(`  S=${String(s).padEnd(14)} ${rowOf(c, N)}`)
  }
  printMatrixHeader(`전원 ${meanOvr} OVR(평균) 팀 — S별 등급 분포`)
  for (const s of sValues) {
    setEloScale(s)
    const c = runFixedTeam(meanOvr, N, opponents)
    console.log(`  S=${String(s).padEnd(14)} ${rowOf(c, N)}`)
  }

  // ── 3단계: intl cap 콤보 (전원95 통제군 — 참고용) ──
  console.log('\n══════════ 3단계: S × intl cap (전원 95 OVR 통제군 — 참고) ══════════')
  const comboS = [12, 10, 8]
  const capsRef = [91, 89]
  printMatrixHeader('전원 95 OVR 팀 — (S, intl cap)별 등급 분포')
  for (const s of comboS) {
    for (const cap of capsRef) {
      setEloScale(s)
      const c = runFixedTeam(95, N, lowerIntlTop(opponents, cap))
      console.log(`  S=${s},cap=${String(cap).padEnd(8)} ${rowOf(c, N)}`)
    }
  }
  printMatrixHeader(`전원 ${meanOvr} OVR(평균) 팀 — (S, intl cap)별`)
  for (const s of comboS) {
    for (const cap of capsRef) {
      setEloScale(s)
      const c = runFixedTeam(meanOvr, N, lowerIntlTop(opponents, cap))
      console.log(`  S=${s},cap=${String(cap).padEnd(8)} ${rowOf(c, N)}`)
    }
  }

  // ── 4단계: 그리디 픽 × (S × intl cap) — 채택 판단 기준 ──
  console.log('\n══════════ 4단계: 그리디 픽 × (S × intl cap) 콤보 ══════════')
  console.log('[목표] GRAND SLAM 3~8% | LEGENDARY+ELITE 15~20% | REBUILD ≤25%')
  console.log('[범위] S=14,12,10 × cap=91,89,87 (grade.ts / 레이팅 공식 불변, S·intl cap만 조정)')

  const greedyComboS = [14, 12, 10]
  const greedyCaps = [91, 89, 87]
  type GreedyRow = { s: number; cap: number; counts: Map<Grade, number>; m: ComboMetrics }
  const greedyRows: GreedyRow[] = []

  printMatrixHeader('그리디 픽 — (S, intl cap)별 등급 분포')
  for (const s of greedyComboS) {
    for (const cap of greedyCaps) {
      setEloScale(s)
      const counts = runPolicy('greedy', N, spinIndex, teamMap, playerMap, lowerIntlTop(opponents, cap))
      const m = comboMetrics(counts, N)
      greedyRows.push({ s, cap, counts, m })
      console.log(`  S=${s},cap=${cap}     ${rowOf(counts, N)}`)
    }
  }

  console.log('\n### 그리디 픽 — 목표 근접도 (miss↓ = 목표에 가까움, miss=0 = 3구간 전부 충족)')
  console.log(
    '  cfg'.padEnd(16) +
    '  GS%'.padStart(6) +
    ' ok'.padStart(4) +
    '  LG+EL%'.padStart(8) +
    ' ok'.padStart(4) +
    '  REB%'.padStart(7) +
    ' ok'.padStart(4) +
    '  miss'.padStart(7) +
    '  all'
  )
  const sorted = [...greedyRows].sort((a, b) => a.m.miss - b.m.miss)
  for (const { s, cap, m } of sorted) {
    const allOk = m.gsOk && m.legEliteOk && m.rebuildOk
    console.log(
      `  S=${s},cap=${cap}`.padEnd(16) +
      `${m.gs.toFixed(1).padStart(6)}%` +
      okMark(m.gsOk).padStart(4) +
      `${m.legElite.toFixed(1).padStart(8)}%` +
      okMark(m.legEliteOk).padStart(4) +
      `${m.rebuild.toFixed(1).padStart(7)}%` +
      okMark(m.rebuildOk).padStart(4) +
      `${m.miss.toFixed(1).padStart(7)}` +
      `${(allOk ? ' ★' : '')}`
    )
  }

  const best = sorted[0]
  console.log('\n[열 순서] ' + GRADE_ORDER.join(' | '))
  console.log(
    `[참고] miss 최소 조합: S=${best.s}, cap=${best.cap} (miss=${best.m.miss.toFixed(1)}` +
    `${best.m.gsOk && best.m.legEliteOk && best.m.rebuildOk ? ', 3구간 전부 충족' : ''})`
  )
  console.log('[확정] 표 확인 후 호빈이 S·intl cap 채택 — 스크립트는 값을 자동 적용하지 않음')

  // ── 5단계: 확정 파라미터(S=10, opponents intl cap=86, grade.ts GRADE_CUT) 그리디 검증 ──
  console.log('\n══════════ 5단계: 확정 파라미터 그리디 검증 ══════════')
  console.log(`[sim] S=${getEloScale()} (기본값) | [opponents] MSI/Worlds 레이팅 20%↓ | [grade] GRADE_CUT:`)
  console.log(`  ${JSON.stringify(GRADE_CUT)}`)
  setEloScale(10)
  const greedyFinal = runPolicy('greedy', N, spinIndex, teamMap, playerMap, opponents)
  printVerify('그리디 픽 — 확정 파라미터', greedyFinal, N)
}

main()
