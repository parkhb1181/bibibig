// 02b-rosters-fast.ts — ScoreboardPlayers 캐시 전용 즉시 생성
//
// 용도: 02-rosters.ts의 Players 메타 수집(2100명 × 81s) 없이 rosters.json을
//      pipeline-cache/cargo/sb_*.json 캐시만으로 즉시 생성한다.
//
// 동작:
//   - 이미 수집된 pipeline-cache/cargo/player_*.json(29명)의 nameEn/nameKo 보존
//   - 미수집 선수: nameEn = playerId, nameKo = null (UI는 EN 폴백)
//   - API 호출 없음 — 실행 시간 수 초
//
// P1 백필: 02-rosters.ts 재실행 or 별도 배치로 nameKo 보강 (rosters.json 덮어쓰기)
//
// 사용: npx tsx scripts/02b-rosters-fast.ts

import fs from 'fs'
import path from 'path'
import type { TournamentEntry } from './01-tournaments'
import type { PlayerMeta, RosterEntry, RostersFile } from './02-rosters'

const CACHE_DIR = path.join(process.cwd(), 'pipeline-cache')
const CARGO_DIR = path.join(CACHE_DIR, 'cargo')

// 02-rosters.ts와 동일한 opKey 함수
function opKey(overviewPage: string): string {
  return overviewPage.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 100)
}

function normalizeRole(raw: string): 'TOP' | 'JGL' | 'MID' | 'ADC' | 'SUP' | null {
  const r = raw.toLowerCase().trim()
  if (r === 'top') return 'TOP'
  if (r === 'jungle' || r === 'jungler' || r === 'jgl') return 'JGL'
  if (r === 'mid' || r === 'middle') return 'MID'
  if (r === 'bot' || r === 'bottom' || r === 'adc' || r === 'ad carry') return 'ADC'
  if (r === 'support' || r === 'sup') return 'SUP'
  return null
}

function main() {
  const outPath = path.join(CACHE_DIR, 'rosters.json')

  // ── 1. 기수집 player_*.json 로드 (nameEn/nameKo 보존) ──────────────────────
  const cachedPlayers: Record<string, PlayerMeta> = {}
  const playerFiles = fs.readdirSync(CARGO_DIR).filter(f => f.startsWith('player_') && f.endsWith('.json'))
  let metaCached = 0
  for (const file of playerFiles) {
    try {
      const rows = JSON.parse(fs.readFileSync(path.join(CARGO_DIR, file), 'utf-8'))
      if (Array.isArray(rows) && rows.length > 0) {
        const r = rows[0]
        const pid: string = r.ID || ''
        if (pid) {
          cachedPlayers[pid] = {
            nameEn: r.Name || pid,
            nameKo: r.NativeName || null,
            country: '',
            primaryRole: r.Role || '',
          }
          metaCached++
        }
      }
    } catch { /* 빈 파일·파싱 실패 스킵 */ }
  }
  console.log(`player 메타 캐시 로드: ${metaCached}명 (미수집분은 playerId로 폴백)`)

  // ── 2. 토너먼트 목록 로드 ────────────────────────────────────────────────────
  const toursPath = path.join(CACHE_DIR, 'tournaments.json')
  if (!fs.existsSync(toursPath)) throw new Error('tournaments.json 없음')
  const tournaments = JSON.parse(fs.readFileSync(toursPath, 'utf-8')) as TournamentEntry[]
  const domesticTours = tournaments.filter(
    t => t.leagueCode !== 'WORLDS' && t.leagueCode !== 'MSI'
  )

  // ── 3. ScoreboardPlayers 캐시에서 집계 (API 호출 없음) ──────────────────────
  type GameKey = string
  const gameCounts = new Map<string, Map<string, Set<GameKey>>>()
  const playerIds = new Set<string>()
  let cacheMiss = 0

  const opMeta = new Map<string, { year: number; leagueCode: string }>()
  for (const t of domesticTours) opMeta.set(t.overviewPage, { year: t.year, leagueCode: t.leagueCode })

  for (const tour of domesticTours) {
    const key = `sb_${opKey(tour.overviewPage)}`
    const filePath = path.join(CARGO_DIR, `${key}.json`)
    if (!fs.existsSync(filePath)) { cacheMiss++; continue }  // API 없이 스킵

    let rows: Record<string, string>[]
    try { rows = JSON.parse(fs.readFileSync(filePath, 'utf-8')) } catch { continue }
    if (!Array.isArray(rows)) continue

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
      gameCounts.get(mapKey)!.set(gameId, new Set())
    }
  }
  if (cacheMiss > 0) console.warn(`  캐시 없는 대회: ${cacheMiss}건 (스킵 — 해당 선수 미포함 가능)`)

  // ── 4. §3 로스터 도출 규칙 적용 (02-rosters.ts와 동일 로직) ─────────────────
  type CandidateKey = string
  const candidates = new Map<CandidateKey, { playerId: string; gameCount: number }[]>()

  for (const [mapKey, gameIdMap] of gameCounts) {
    const parts = mapKey.split('|')
    const team = parts[0], overviewPage = parts[1], role = parts[2], playerId = parts[3]
    const gameCount = gameIdMap.size
    const cKey: CandidateKey = `${team}|${overviewPage}|${role}`
    if (!candidates.has(cKey)) candidates.set(cKey, [])
    candidates.get(cKey)!.push({ playerId, gameCount })
  }

  type PlayerKey = string
  const includedPlayers = new Set<PlayerKey>()
  for (const [cKey, list] of candidates) {
    list.sort((a, b) => b.gameCount - a.gameCount || a.playerId.localeCompare(b.playerId))
    const above5 = list.filter(x => x.gameCount >= 5)
    const toInclude = above5.length > 0 ? above5 : [list[0]]
    const parts = cKey.split('|')
    const team = parts[0], overviewPage = parts[1]
    for (const { playerId } of toInclude) includedPlayers.add(`${playerId}|${team}|${overviewPage}`)
  }

  type YearKey = string
  const yearEntries = new Map<YearKey, { leagueCode: string; roles: Map<string, number> }>()
  for (const pk of includedPlayers) {
    const [playerId, team, overviewPage] = pk.split('|')
    const meta = opMeta.get(overviewPage)
    if (!meta) continue
    const yKey: YearKey = `${playerId}|${team}|${meta.year}`
    if (!yearEntries.has(yKey)) yearEntries.set(yKey, { leagueCode: meta.leagueCode, roles: new Map() })
    for (const role of ['TOP', 'JGL', 'MID', 'ADC', 'SUP'] as const) {
      const cnt = gameCounts.get(`${team}|${overviewPage}|${role}|${playerId}`)?.size ?? 0
      if (cnt === 0) continue
      const entry = yearEntries.get(yKey)!
      entry.roles.set(role, (entry.roles.get(role) ?? 0) + cnt)
    }
  }

  const entries: RosterEntry[] = []
  for (const [yKey, { leagueCode, roles }] of yearEntries) {
    const [playerId, team, yearStr] = yKey.split('|')
    if (roles.size === 0) continue
    const sorted = [...roles.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    const role = sorted[0][0]
    const gameCount = [...roles.values()].reduce((s, n) => s + n, 0)
    entries.push({ playerId, team, year: parseInt(yearStr), leagueCode, role, gameCount })
  }

  // ── 5. players 맵 구성 — 캐시 우선, 미수집분 폴백 ─────────────────────────
  const players: Record<string, PlayerMeta> = {}
  let fallbackCount = 0
  for (const pid of playerIds) {
    if (cachedPlayers[pid]) {
      players[pid] = cachedPlayers[pid]
    } else {
      // P1 백필 대상 — 출시 게이트 아님 (PRD 데이터 스펙)
      players[pid] = { nameEn: pid, nameKo: null, country: '', primaryRole: '' }
      fallbackCount++
    }
  }

  // ── 6. 저장 ──────────────────────────────────────────────────────────────────
  const out: RostersFile = { players, entries }
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf-8')

  console.log(`\nrosters.json 저장 완료`)
  console.log(`  총 선수 수: ${Object.keys(players).length}명`)
  console.log(`    캐시(nameKo 有): ${metaCached}명`)
  console.log(`    폴백(nameKo null): ${fallbackCount}명  ← P1 야간 배치 대상`)
  console.log(`  RosterEntry: ${entries.length}건`)
  console.log(`  리그별 분포:`)
  const byLeague: Record<string, number> = {}
  for (const e of entries) byLeague[e.leagueCode] = (byLeague[e.leagueCode] ?? 0) + 1
  for (const [lc, cnt] of Object.entries(byLeague).sort()) console.log(`    ${lc}: ${cnt}건`)

  if (entries.length < 3000) {
    console.warn(`\n⚠️  RosterEntry ${entries.length}건 — §4.5 DoD 목표 ≥3000. 캐시 누락 확인 요망`)
  }
}

main()
