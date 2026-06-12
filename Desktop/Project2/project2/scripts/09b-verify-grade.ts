// 그리디 분포 빠른 검증 — npx tsx scripts/09b-verify-grade.ts
import fs from 'fs'
import path from 'path'
import { mulberry32 } from '../src/lib/prng'
import { simulate, setEloScale } from '../src/lib/sim'
import type { SimPlayer, Opponent } from '../src/lib/sim'
import type { Grade } from '../src/lib/grade'
import { GRADE_CUT } from '../src/lib/grade'
import type { TeamYear } from '../src/lib/data'

const ROLES = ['TOP', 'JGL', 'MID', 'ADC', 'SUP'] as const
type Role = typeof ROLES[number]

type PlayerEntry = { id: string; playerId: string; role: Role; ovr: number; teamKey: string; year: number }
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

function spin(
  emptyRoles: Role[], pickedPlayerIds: Set<string>, spinIndex: SpinIndex,
  teamMap: Map<string, TeamYear>, playerMap: Map<string, PlayerEntry[]>, rng: () => number
): string {
  const base = new Set<string>()
  for (const role of emptyRoles) for (const k of (spinIndex[role] ?? [])) base.add(k)
  const valid = [...base].filter(key =>
    (playerMap.get(key) ?? []).some(p => emptyRoles.includes(p.role) && !pickedPlayerIds.has(p.playerId))
  )
  return weightedDraw(valid.length > 0 ? valid : [...base], teamMap, rng)
}

function greedyPick(teamKey: string, emptyRoles: Role[], picked: Set<string>, playerMap: Map<string, PlayerEntry[]>) {
  const c = (playerMap.get(teamKey) ?? []).filter(p => emptyRoles.includes(p.role) && !picked.has(p.playerId))
  c.sort((a, b) => b.ovr - a.ovr)
  return c[0] ?? null
}

function runGreedy(N: number, spinIndex: SpinIndex, teamMap: Map<string, TeamYear>,
  playerMap: Map<string, PlayerEntry[]>, opponents: { regular: Opponent[]; msi: Opponent[]; worlds: Opponent[] }) {
  const counts = new Map<Grade, number>()
  for (let i = 0; i < N; i++) {
    const seed = (i * 1_000_003 + 0xDEADBEEF) >>> 0
    const rng = mulberry32(seed)
    const picks: SimPlayer[] = []
    const picked = new Set<string>()
    const filled = new Set<Role>()
    for (let round = 0; round < 5; round++) {
      const empty = ROLES.filter(r => !filled.has(r))
      const tk = spin(empty, picked, spinIndex, teamMap, playerMap, rng)
      const p = greedyPick(tk, empty, picked, playerMap)
      if (!p) { picks.push({ playerId: `f_${round}`, role: empty[0], ovr: 60 }); filled.add(empty[0]); continue }
      picks.push({ playerId: p.playerId, role: p.role, ovr: p.ovr })
      picked.add(p.playerId); filled.add(p.role)
    }
    const g = simulate(picks, opponents, seed).grade
    counts.set(g, (counts.get(g) ?? 0) + 1)
  }
  return counts
}

const GRADES: Grade[] = ['GRAND SLAM', 'LEGENDARY', 'ELITE', 'CONTENDER', 'PLAYOFF TEAM', 'REBUILD']
const N = 10_000

const { players, teams, spinIndex, opponents } = loadData()
const teamMap = new Map(teams.map(t => [t.key, t]))
const playerMap = new Map<string, PlayerEntry[]>()
for (const p of players) {
  const key = `${p.teamSlug}_${p.year}`
  if (!playerMap.has(key)) playerMap.set(key, [])
  playerMap.get(key)!.push({ id: p.id, playerId: p.playerId, role: p.role, ovr: p.ovr, teamKey: key, year: p.year })
}

setEloScale(14)
const c = runGreedy(N, spinIndex, teamMap, playerMap, opponents)
console.log('GRADE_CUT', GRADE_CUT)
for (const g of GRADES) {
  const n = c.get(g) ?? 0
  console.log(`${g.padEnd(14)} ${((n / N) * 100).toFixed(1)}%`)
}
const gs = ((c.get('GRAND SLAM') ?? 0) / N) * 100
const le = (((c.get('LEGENDARY') ?? 0) + (c.get('ELITE') ?? 0)) / N) * 100
const co = ((c.get('CONTENDER') ?? 0) / N) * 100
const re = ((c.get('REBUILD') ?? 0) / N) * 100
console.log(`\nGS ${gs.toFixed(1)}% (3-8) | LEG+EL ${le.toFixed(1)}% (15-20) | CONT ${co.toFixed(1)}% (20-25) | REB ${re.toFixed(1)}% (≤25)`)
