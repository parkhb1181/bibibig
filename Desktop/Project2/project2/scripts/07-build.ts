// Phase 1: 최종 JSON 빌드 + zod 검증 → public/data/
// 입력: ratings.json, results.json

import fs from 'fs'
import path from 'path'
import { PlayerSeasonSchema, TeamYearSchema, OpponentsFileSchema } from '../src/lib/data'
import type { PlayerSeason, TeamYear } from '../src/lib/data'
import type { RatedEntry } from './04-ratings'
import type { ResultEntry } from './03-results'
import type { RostersFile, RosterEntry } from './02-rosters'

// 팀명 정규화 — ScoreboardPlayers(rated.team) vs TournamentResults(results.team) 불일치 해소
const TEAM_ALIASES: Record<string, string> = {
  'SK Telecom T1 2': 'SK Telecom T1',
}
function normalizeTeam(t: string): string { return TEAM_ALIASES[t] ?? t }

// 닉네임만 추출 — "Blank (Kang Sun-gu)" → "Blank", "knight (Zhuo Ding)" → "knight"
function cleanNickname(name: string): string {
  return name.replace(/\s*\([^)]*\).*$/, '').trim()
}

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
  msiAttended: boolean
}): number {
  if (params.worldsWin) return 8
  if (params.worldsAttended || params.nationalChampion) return 4
  if (params.playoffAttended || params.msiAttended) return 2
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

  // 기존 photo URL 보존 — 06-upload-r2.ts가 채운 photo를 07 재실행이 덮어쓰지 않도록
  const playersOutPath = path.join(dataDir, 'players.json')
  const existingPhotos = new Map<string, string | null>()
  if (fs.existsSync(playersOutPath)) {
    const prev: PlayerSeason[] = JSON.parse(fs.readFileSync(playersOutPath, 'utf-8'))
    for (const p of prev) existingPhotos.set(p.id, p.photo)
  }

  // Worlds 참가/우승 인덱스: normalizeTeam 적용 (TournamentResults Worlds="SK Telecom T1")
  const worldsIndex = new Map<string, number>()
  for (const r of results) {
    if (r.leagueCode !== 'WORLDS') continue
    // Regional Finals 제외 — 지역 예선 우승(place=1)이 Worlds 우승으로 오인되는 버그 차단
    if (!r.overviewPage.includes('World Championship')) continue
    const k = `${normalizeTeam(r.team)}|${r.year}`
    const ex = worldsIndex.get(k)
    if (ex === undefined || r.place < ex) worldsIndex.set(k, r.place)
  }

  // 2017 이하 Worlds 진출 팀 집합 — 카드 풀 컷 기준
  const worldsCutSet = new Set<string>()
  for (const r of results) {
    if (r.leagueCode !== 'WORLDS') continue
    if (!r.overviewPage.includes('World Championship')) continue
    if (r.year > 2017) continue
    worldsCutSet.add(`${normalizeTeam(r.team)}|${r.year}`)
  }

  // 국내 플옵 인덱스: normalizeTeam 적용 — 인덱스와 조회 모두 정규화해야 일관성 유지
  const playoffIndex = new Map<string, number>()
  for (const r of results) {
    if (!r.isPlayoffs || r.leagueCode === 'WORLDS' || r.leagueCode === 'MSI') continue
    const k = `${normalizeTeam(r.team)}|${r.year}`
    const ex = playoffIndex.get(k)
    if (ex === undefined || r.place < ex) playoffIndex.set(k, r.place)
  }

  // MSI 참가 인덱스: LEC/LCS 가중치 계산에 사용 (국내 플옵 기록 없는 경우 보완)
  const msiIndex = new Map<string, number>()
  for (const r of results) {
    if (r.leagueCode !== 'MSI') continue
    const k = `${normalizeTeam(r.team)}|${r.year}`
    const ex = msiIndex.get(k)
    if (ex === undefined || r.place < ex) msiIndex.set(k, r.place)
  }

  // PlayerSeason 빌드
  const playerSeasons: PlayerSeason[] = []
  const errors: string[] = []

  for (const entry of rated) {
    const cardTeamKey = `${normalizeTeam(entry.team)}|${entry.year}`
    const isLECorLCS = entry.leagueCode === 'LEC' || entry.leagueCode === 'LCS'

    // 2017 이하: 리그 무관, Worlds 진출 팀만 유지
    if (entry.year <= 2017) {
      if (!worldsCutSet.has(cardTeamKey)) continue
    } else if (isLECorLCS) {
      // 2018+ LEC/LCS: 국내 플옵 진출 OR Worlds·MSI 진출
      const teamPlayoffPlace = playoffIndex.get(cardTeamKey)
      const hasIntl = worldsIndex.has(cardTeamKey) || msiIndex.has(cardTeamKey)
      if (teamPlayoffPlace === undefined && !hasIntl) continue
    } else {
      // 2018+ LCK/LPL: 플옵 진출 이상
      const teamPlayoffPlace = playoffIndex.get(cardTeamKey)
      if (teamPlayoffPlace === undefined) continue
    }

    const teamSlug = slugify(entry.team)
    const id = `${slugify(entry.playerId)}_${entry.year}_${teamSlug}`

    const ps: PlayerSeason = {
      id,
      playerId: entry.playerId,
      nameEn: cleanNickname(entry.nameEn),
      nameKo: entry.nameKo,
      team: entry.team,
      teamSlug,
      year: entry.year,
      league: entry.leagueCode as PlayerSeason['league'],
      role: entry.role as PlayerSeason['role'],
      ovr: entry.ovr,
      frame: entry.frame,
      crown: entry.crown,
      worldsMvp: entry.worldsMvp,
      msiWinner: entry.msiWinner,
      photo: existingPhotos.get(id) ?? null,  // 기존 R2 URL 보존, 없으면 null
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
    const teamYearKey = `${normalizeTeam(team)}|${year}`
    const worldsPlace = worldsIndex.get(teamYearKey)
    const playoffPlace = playoffIndex.get(teamYearKey)
    const msiPlace = msiIndex.get(teamYearKey)

    const weight = calcWeight({
      worldsWin: worldsPlace === 1,
      worldsAttended: worldsPlace !== undefined,
      nationalChampion: playoffPlace === 1,
      playoffAttended: playoffPlace !== undefined,
      msiAttended: msiPlace !== undefined,
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
  console.log(`players.json: ${playerSeasons.length}건 (LCK/LPL 플옵 + LEC/LCS Worlds·MSI 진출)`)
  console.log(`teams.json: ${teamYears.length}건 (목표 ≥ 300, 컷 반영 하향)`)

  const roles5 = Object.keys(spinIndex).length === 5
  const rolesNonEmpty = Object.values(spinIndex).every(v => v.length > 0)
  console.log(`spin-index.json: 5개 role ${roles5 ? '✓' : '✗'}, 각 배열 비어있지 않음 ${rolesNonEmpty ? '✓' : '✗'}`)

  // 리그·연도별 결손 리포트
  const REPORT_LEAGUES = ['LCK', 'LPL', 'LEC', 'LCS'] as const
  const YEAR_FROM = 2013, YEAR_TO = 2025
  console.log('\n리그·연도별 PlayerSeason 수 (v1 LCK/LPL):')
  for (const league of REPORT_LEAGUES) {
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
  console.log('  LEC/LCS: 국내 플옵 진출 기준 (Worlds·MSI 진출 시즌 포함)')

  // 서브 선수 N경기 기준 후보 제시
  const rostersPath = path.join(process.cwd(), 'pipeline-cache', 'rosters.json')
  if (fs.existsSync(rostersPath)) {
    const rosters: RostersFile = JSON.parse(fs.readFileSync(rostersPath, 'utf-8'))
    // playerId+year+team → gameCount 맵
    const gcMap = new Map<string, number>()
    for (const e of rosters.entries) {
      gcMap.set(`${e.playerId}|${e.year}|${e.team}`, e.gameCount)
    }
    // players.json의 각 선수-시즌 게임 수 조회
    const playerGames = playerSeasons.map(ps => {
      const gc = gcMap.get(`${ps.playerId}|${ps.year}|${ps.team}`) ?? 0
      return { ...ps, gameCount: gc }
    })
    console.log('\n=== 서브 N경기 기준 후보 제시 (참고용) ===')
    for (const threshold of [5, 10, 15, 20]) {
      const excluded = playerGames.filter(p => p.gameCount < threshold)
      console.log(`  < ${threshold}경기: ${excluded.length}명 제외 대상 (전체 ${playerSeasons.length}명 중 ${(excluded.length/playerSeasons.length*100).toFixed(1)}%)`)
    }
    // 실제 후보 목록 (< 10경기)
    const candidates = playerGames.filter(p => p.gameCount < 10)
      .sort((a, b) => a.gameCount - b.gameCount)
    if (candidates.length > 0 && candidates.length <= 50) {
      console.log('  < 10경기 목록:')
      for (const p of candidates) {
        console.log(`    ${p.playerId} ${p.year} (${p.team}) — ${p.gameCount}경기`)
      }
    } else if (candidates.length > 50) {
      console.log(`  < 10경기 후보 ${candidates.length}명 (상위 20명만):`)
      for (const p of candidates.slice(0, 20)) {
        console.log(`    ${p.playerId} ${p.year} (${p.team}) — ${p.gameCount}경기`)
      }
    }
  }

  if (errors.length > 0) {
    console.error(`\n검증 오류 총 ${errors.length}건 — 위 목록 확인`)
    process.exit(1)
  }

  console.log('\n✅ 07-build.ts 완료 (zod 통과)')
}

main().catch(e => { process.stderr.write(`Fatal: ${e}\n`); process.exit(1) })
