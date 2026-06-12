// §7 DoD: 몬테카를로 검증 — 그리디 + 균등 랜덤 픽 정책 × 각 10,000회
// npx tsx scripts/09-montecarlo.ts
// 목표 (PRD §5.3): 그리디 기준 전원 95+ OVR 픽 GRAND SLAM 비율 15~25%

import fs from 'fs'
import path from 'path'
import { mulberry32 } from '../src/lib/prng'
import { simulate } from '../src/lib/sim'
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
  console.log(`몬테카를로 시작 — 각 ${N.toLocaleString()}회`)

  console.time('greedy')
  const greedyCounts = runPolicy('greedy', N, spinIndex, teamMap, playerMap, opponents)
  console.timeEnd('greedy')

  console.time('random')
  const randomCounts = runPolicy('random', N, spinIndex, teamMap, playerMap, opponents)
  console.timeEnd('random')

  printTable('그리디 픽 (유저 근사)', greedyCounts, N)
  printTable('균등 랜덤 픽 (베이스라인)', randomCounts, N)

  // 그리디 GRAND SLAM 비율 판정 (PRD §5.3: 15~25%)
  const gsCount = greedyCounts.get('GRAND SLAM') ?? 0
  const gsPct = (gsCount / N) * 100
  console.log(`\n[판정] 그리디 GRAND SLAM: ${gsPct.toFixed(1)}%`)
  if (gsPct >= 15 && gsPct <= 25) {
    console.log('  → 목표 달성 (15~25%) — 튜닝 불요')
  } else {
    console.log(`  → 목표 미달 — §9 파라미터 조정 필요 (S, weight, opponents rating)`)
  }

  // 유명 팀(weight >= 4) 스핀 비율 — 참고값
  const highWeight = teams.filter(t => t.weight >= 4)
  const hwKeys = new Set(highWeight.map(t => t.key))
  const hwRatio = highWeight.length / teams.length
  console.log(`\n[참고] weight≥4 팀: ${highWeight.length}/${teams.length} (${(hwRatio * 100).toFixed(1)}%)`)
  console.log('  → 스핀 풀 비율은 weight 가중치로 결정됨 (§9 조정 범위: 50~60% 체감 목표)')
}

main()
