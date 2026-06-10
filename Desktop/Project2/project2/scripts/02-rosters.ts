// Phase 1: 로스터 도출 — ScoreboardPlayers (§3 규칙) + Players 메타
// §4.1: ScoreboardPlayers는 OverviewPage 단위 분할

import fs from 'fs'
import path from 'path'
import { cargoPaginate, initCargo } from './lib/cargo'
import type { TournamentEntry } from './01-tournaments'

// ScoreboardPlayers Role 값 → 표준 Role
function normalizeRole(raw: string): 'TOP' | 'JGL' | 'MID' | 'ADC' | 'SUP' | null {
  const r = raw.toLowerCase().trim()
  if (r === 'top') return 'TOP'
  if (r === 'jungle' || r === 'jungler' || r === 'jgl') return 'JGL'
  if (r === 'mid' || r === 'middle') return 'MID'
  if (r === 'bot' || r === 'bottom' || r === 'adc' || r === 'ad carry') return 'ADC'
  if (r === 'support' || r === 'sup') return 'SUP'
  return null
}

// OverviewPage 파일명 안전 변환
function opKey(overviewPage: string): string {
  return overviewPage.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 100)
}

export type PlayerMeta = {
  nameEn: string
  nameKo: string | null
  country: string
  primaryRole: string
}

// (player, team, year, leagueCode) 단위 집계 결과
export type RosterEntry = {
  playerId: string
  team: string
  year: number
  leagueCode: string
  role: string
  gameCount: number
}

export type RostersFile = {
  players: Record<string, PlayerMeta>
  entries: RosterEntry[]
}

async function main() {
  initCargo()

  const outPath = path.join(process.cwd(), 'pipeline-cache', 'rosters.json')
  if (fs.existsSync(outPath)) {
    console.log('rosters.json 캐시 존재 — 재실행 불요')
    return
  }

  const toursPath = path.join(process.cwd(), 'pipeline-cache', 'tournaments.json')
  if (!fs.existsSync(toursPath)) throw new Error('tournaments.json 없음 — 01-tournaments.ts 먼저 실행')
  const tournaments = JSON.parse(fs.readFileSync(toursPath, 'utf-8')) as TournamentEntry[]

  // 국내 리그 토너먼트만 (WORLDS/MSI 제외 — 국내 로스터 도출용)
  const domesticTours = tournaments.filter(
    t => t.leagueCode !== 'WORLDS' && t.leagueCode !== 'MSI'
  )

  // (team, overviewPage, role) → player → gameCount 집계
  // GameId 중복 제거를 위해 Set<GameId> 사용
  type GameKey = string
  const gameCounts = new Map<string, Map<string, Set<GameKey>>>()
  // key: `${team}|${overviewPage}|${role}|${playerId}` → gameIds Set

  const playerIds = new Set<string>()

  let tourIdx = 0
  for (const tour of domesticTours) {
    tourIdx++
    if (tourIdx % 50 === 0) {
      process.stderr.write(`  ScoreboardPlayers: ${tourIdx}/${domesticTours.length} 처리 중\n`)
    }

    const key = `sb_${opKey(tour.overviewPage)}`
    const rows = await cargoPaginate(
      {
        tables: 'ScoreboardPlayers',
        fields: 'Link,Team,Role,OverviewPage,GameId',
        where: `OverviewPage="${tour.overviewPage}"`,
      },
      key
    )

    for (const r of rows) {
      const pid = r.Link?.trim()
      const team = r.Team?.trim()
      const roleRaw = r.Role?.trim()
      const gameId = r.GameId?.trim()
      if (!pid || !team || !roleRaw || !gameId || pid === 'ADD') continue

      const role = normalizeRole(roleRaw)
      if (!role) continue

      playerIds.add(pid)

      const mapKey = `${team}|${tour.overviewPage}|${role}|${pid}`
      if (!gameCounts.has(mapKey)) gameCounts.set(mapKey, new Map())
      const gMap = gameCounts.get(mapKey)!
      if (!gMap.has(gameId)) gMap.set(gameId, new Set())
      gMap.get(gameId)!.add(gameId)
    }
  }

  // §3 로스터 도출 규칙 적용
  // (team, overviewPage, role) → [ (playerId, gameCount) ] 집계
  type CandidateKey = string  // `${team}|${overviewPage}|${role}`
  const candidates = new Map<CandidateKey, { playerId: string; gameCount: number }[]>()

  for (const [mapKey, gameIdMap] of gameCounts) {
    const parts = mapKey.split('|')
    const team = parts[0]
    const overviewPage = parts[1]
    const role = parts[2]
    const playerId = parts[3]
    const gameCount = gameIdMap.size

    const cKey: CandidateKey = `${team}|${overviewPage}|${role}`
    if (!candidates.has(cKey)) candidates.set(cKey, [])
    candidates.get(cKey)!.push({ playerId, gameCount })
  }

  // 각 (team, overviewPage, role) → 포함 선수 결정
  // 5경기 이상 전원 포함, 미만이면 최다 출전자만 (동률: playerId 알파벳 오름차순)
  type PlayerKey = string  // `${playerId}|${team}|${overviewPage}`
  const includedPlayers = new Set<PlayerKey>()

  for (const [cKey, list] of candidates) {
    list.sort((a, b) => b.gameCount - a.gameCount || a.playerId.localeCompare(b.playerId))
    const above5 = list.filter(x => x.gameCount >= 5)
    const toInclude = above5.length > 0 ? above5 : [list[0]]
    const parts = cKey.split('|')
    const team = parts[0]
    const overviewPage = parts[1]
    for (const { playerId } of toInclude) {
      includedPlayers.add(`${playerId}|${team}|${overviewPage}`)
    }
  }

  // 연도 단위 통합: (playerId, team, year) → 누적 게임 수 + 역할별 카운트
  // overviewPage → (year, leagueCode) 매핑
  const opMeta = new Map<string, { year: number; leagueCode: string }>()
  for (const t of domesticTours) opMeta.set(t.overviewPage, { year: t.year, leagueCode: t.leagueCode })

  // (playerId|team|year) → { leagueCode, roles: Map<role, count> }
  type YearKey = string
  const yearEntries = new Map<YearKey, { leagueCode: string; roles: Map<string, number> }>()

  for (const pk of includedPlayers) {
    const [playerId, team, overviewPage] = pk.split('|')
    const meta = opMeta.get(overviewPage)
    if (!meta) continue

    const yKey: YearKey = `${playerId}|${team}|${meta.year}`
    if (!yearEntries.has(yKey)) {
      yearEntries.set(yKey, { leagueCode: meta.leagueCode, roles: new Map() })
    }

    // 이 선수의 (team, overviewPage) 내 각 role 게임 수 집계
    for (const role of ['TOP', 'JGL', 'MID', 'ADC', 'SUP'] as const) {
      const mapKey = `${team}|${overviewPage}|${role}|${playerId}`
      const cnt = gameCounts.get(mapKey)?.size ?? 0
      if (cnt === 0) continue
      const entry = yearEntries.get(yKey)!
      entry.roles.set(role, (entry.roles.get(role) ?? 0) + cnt)
    }
  }

  // RosterEntry 생성 (최다 역할을 primary role로)
  const entries: RosterEntry[] = []
  for (const [yKey, { leagueCode, roles }] of yearEntries) {
    const [playerId, team, yearStr] = yKey.split('|')
    if (roles.size === 0) continue

    // 동률: TOP < JGL < MID < ADC < SUP 알파벳 오름차순으로 결정론
    const sorted = [...roles.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    const role = sorted[0][0]
    const gameCount = [...roles.values()].reduce((s, n) => s + n, 0)

    entries.push({
      playerId,
      team,
      year: parseInt(yearStr),
      leagueCode,
      role,
      gameCount,
    })
  }

  // Players 테이블 메타 수집 (nameEn, nameKo)
  // playerIds를 50개 단위 청크로 IN 쿼리 — 또는 개별 쿼리 (안전하게 배치)
  // Cargo WHERE에 IN 구문이 지원되는지 불명확 → 개별 쿼리 (캐시 덕에 재실행 비용 없음)
  const players: Record<string, PlayerMeta> = {}
  let pidIdx = 0
  const pidList = [...playerIds]

  for (const pid of pidList) {
    pidIdx++
    if (pidIdx % 200 === 0) process.stderr.write(`  Players: ${pidIdx}/${pidList.length}\n`)

    const key = `player_${pid.replace(/[^a-zA-Z0-9_-]/g, '_')}`
    const rows = await cargoPaginate(
      {
        tables: 'Players',
        fields: 'ID,Name,NativeName,Role',
        where: `ID="${pid}"`,
      },
      key
    )
    if (rows.length > 0) {
      const r = rows[0]
      players[pid] = {
        nameEn: r.Name || pid,
        nameKo: r.NativeName || null,
        country: '',  // Country는 현재 불요 — Phase 2 사진 매핑 시 사용
        primaryRole: r.Role || '',
      }
    }
  }

  const out: RostersFile = { players, entries }
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf-8')

  console.log(`\nrosters.json 저장`)
  console.log(`  Players 메타: ${Object.keys(players).length}명`)
  console.log(`  RosterEntry: ${entries.length}건`)
}

main().catch(e => { process.stderr.write(`Fatal: ${e}\n`); process.exit(1) })
