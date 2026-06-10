// Phase 1: 최종 JSON 빌드 + zod 검증 → public/data/
// 입력: ratings.json, results.json

import fs from 'fs'
import path from 'path'
import { PlayerSeasonSchema, TeamYearSchema, OpponentsFileSchema } from '../src/lib/data'
import type { PlayerSeason, TeamYear } from '../src/lib/data'
import type { RatedEntry } from './04-ratings'
import type { ResultEntry } from './03-results'

// §3 slugify: 소문자화 → 영숫자 외 하이픈 → 연속 하이픈 축약 → 양끝 제거
function slugify(s: string): string {
  return s.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

// §9 TeamYear.weight 산출
function calcWeight(params: {
  worldsWin: boolean
  worldsAttended: boolean
  nationalChampion: boolean
  playoffAttended: boolean
}): number {
  if (params.worldsWin) return 8
  if (params.worldsAttended || params.nationalChampion) return 4
  if (params.playoffAttended) return 2
  return 1
}

async function main() {
  const ratingsPath = path.join(process.cwd(), 'pipeline-cache', 'ratings.json')
  const resultsPath = path.join(process.cwd(), 'pipeline-cache', 'results.json')
  const dataDir = path.join(process.cwd(), 'public', 'data')

  if (!fs.existsSync(ratingsPath)) throw new Error('ratings.json 없음 — 04-ratings.ts 먼저 실행')
  if (!fs.existsSync(resultsPath)) throw new Error('results.json 없음 — 03-results.ts 먼저 실행')

  const rated: RatedEntry[] = JSON.parse(fs.readFileSync(ratingsPath, 'utf-8'))
  const results: ResultEntry[] = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'))

  // Worlds 참가/우승 인덱스: `${team}|${year}` → place
  const worldsIndex = new Map<string, number>()
  for (const r of results) {
    if (r.leagueCode !== 'WORLDS') continue
    const k = `${r.team}|${r.year}`
    const ex = worldsIndex.get(k)
    if (ex === undefined || r.place < ex) worldsIndex.set(k, r.place)
  }

  // 국내 플옵 인덱스: `${team}|${year}` → best place
  const playoffIndex = new Map<string, number>()
  for (const r of results) {
    if (!r.isPlayoffs || r.leagueCode === 'WORLDS' || r.leagueCode === 'MSI') continue
    const k = `${r.team}|${r.year}`
    const ex = playoffIndex.get(k)
    if (ex === undefined || r.place < ex) playoffIndex.set(k, r.place)
  }

  // PlayerSeason 빌드
  const playerSeasons: PlayerSeason[] = []
  const errors: string[] = []

  for (const entry of rated) {
    const teamSlug = slugify(entry.team)
    const id = `${slugify(entry.playerId)}_${entry.year}_${teamSlug}`

    const ps: PlayerSeason = {
      id,
      playerId: entry.playerId,
      nameEn: entry.nameEn,
      nameKo: entry.nameKo,
      team: entry.team,
      teamSlug,
      year: entry.year,
      league: entry.leagueCode as PlayerSeason['league'],
      role: entry.role as PlayerSeason['role'],
      ovr: entry.ovr,
      frame: entry.frame,
      crown: entry.crown,
      msiWinner: entry.msiWinner,
      photo: null,  // Phase 2에서 채움
      badges: entry.badges,
    }

    const result = PlayerSeasonSchema.safeParse(ps)
    if (!result.success) {
      errors.push(`${id}: ${result.error.message}`)
      continue
    }
    playerSeasons.push(result.data)
  }

  if (errors.length > 0) {
    console.error(`\nzod 검증 오류 ${errors.length}건:`)
    errors.slice(0, 20).forEach(e => console.error(`  ${e}`))
    if (errors.length > 20) console.error(`  ... (${errors.length - 20}건 생략)`)
  }

  // TeamYear 빌드 — (team, year, leagueCode) 단위로 그룹화
  type TeamYearKey = string
  const teamMap = new Map<TeamYearKey, {
    team: string; teamSlug: string; year: number; leagueCode: string
    playerIds: Set<string>; roles: Set<string>
  }>()

  for (const ps of playerSeasons) {
    const k: TeamYearKey = `${ps.teamSlug}_${ps.year}`
    if (!teamMap.has(k)) {
      teamMap.set(k, {
        team: ps.team, teamSlug: ps.teamSlug, year: ps.year,
        leagueCode: ps.league, playerIds: new Set(), roles: new Set(),
      })
    }
    const tm = teamMap.get(k)!
    tm.playerIds.add(ps.id)
    tm.roles.add(ps.role)
  }

  const teamYears: TeamYear[] = []
  for (const [key, { team, teamSlug, year, leagueCode, playerIds, roles }] of teamMap) {
    const teamYearKey = `${team}|${year}`
    const worldsPlace = worldsIndex.get(teamYearKey)
    const playoffPlace = playoffIndex.get(teamYearKey)

    const weight = calcWeight({
      worldsWin: worldsPlace === 1,
      worldsAttended: worldsPlace !== undefined,
      nationalChampion: playoffPlace === 1,
      playoffAttended: playoffPlace !== undefined,
    })

    const sortedRoles = [...roles].sort() as TeamYear['rolesAvailable']
    const ty: TeamYear = {
      key,
      team,
      teamSlug,
      year,
      league: leagueCode,
      roster: [...playerIds].sort(),
      rolesAvailable: sortedRoles,
      weight,
    }

    const result = TeamYearSchema.safeParse(ty)
    if (!result.success) {
      errors.push(`TeamYear ${key}: ${result.error.message}`)
      continue
    }
    teamYears.push(result.data)
  }

  // spin-index.json
  const spinIndex: Record<string, string[]> = {}
  for (const role of ['TOP', 'JGL', 'MID', 'ADC', 'SUP']) {
    spinIndex[role] = teamYears
      .filter(ty => ty.rolesAvailable.includes(role as TeamYear['rolesAvailable'][number]))
      .map(ty => ty.key)
  }

  // opponents-2026.json 검증
  const opPath = path.join(process.cwd(), 'public', 'data', 'opponents-2026.json')
  if (fs.existsSync(opPath)) {
    const opResult = OpponentsFileSchema.safeParse(JSON.parse(fs.readFileSync(opPath, 'utf-8')))
    if (!opResult.success) {
      console.error(`opponents-2026.json zod 오류: ${opResult.error.message}`)
    } else {
      console.log('opponents-2026.json zod 통과')
    }
  }

  // 저장
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(path.join(dataDir, 'players.json'), JSON.stringify(playerSeasons, null, 2))
  fs.writeFileSync(path.join(dataDir, 'teams.json'), JSON.stringify(teamYears, null, 2))
  fs.writeFileSync(path.join(dataDir, 'spin-index.json'), JSON.stringify(spinIndex, null, 2))

  // §4.5 DoD 보고
  console.log('\n=== Phase 1 DoD 검증 ===')
  console.log(`players.json: ${playerSeasons.length}건 (목표 ≥ 3,000)`)
  console.log(`teams.json: ${teamYears.length}건 (목표 ≥ 550)`)

  const roles5 = Object.keys(spinIndex).length === 5
  const rolesNonEmpty = Object.values(spinIndex).every(v => v.length > 0)
  console.log(`spin-index.json: 5개 role ${roles5 ? '✓' : '✗'}, 각 배열 비어있지 않음 ${rolesNonEmpty ? '✓' : '✗'}`)

  // 리그·연도별 결손 리포트
  const LEAGUES = ['LCK', 'LPL', 'LEC', 'LCS'] as const
  const YEAR_FROM = 2013, YEAR_TO = 2025
  console.log('\n리그·연도별 PlayerSeason 수:')
  for (const league of LEAGUES) {
    const missing: number[] = []
    for (let y = YEAR_FROM; y <= YEAR_TO; y++) {
      const count = playerSeasons.filter(p => p.league === league && p.year === y).length
      if (count === 0) missing.push(y)
    }
    if (missing.length > 0) {
      console.log(`  ${league}: 결손 연도 ${missing.join(', ')}`)
    } else {
      console.log(`  ${league}: 전 연도 커버`)
    }
  }

  if (errors.length > 0) {
    console.error(`\n검증 오류 총 ${errors.length}건 — 위 목록 확인`)
    process.exit(1)
  }

  console.log('\n✅ 07-build.ts 완료 (zod 통과)')
}

main().catch(e => { process.stderr.write(`Fatal: ${e}\n`); process.exit(1) })
