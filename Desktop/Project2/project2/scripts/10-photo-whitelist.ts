// Phase 1 부록: Worlds 상위 4팀 기준 사진 화이트리스트 자동 생성
// 실행 순서: 03-results.ts 완료 후
// npx tsx scripts/10-photo-whitelist.ts

import fs from 'fs'
import path from 'path'
import { cargoPaginate, initCargo } from './lib/cargo'
import type { ResultEntry } from './03-results'

export type WhitelistEntry = {
  playerId: string
  nameEn: string
  worldsAppearances: {        // 복수 연도 출전 가능 — 최근 연도가 사진 우선
    year: number
    team: string
    overviewPage: string
    place: number
  }[]
}

function opKey(overviewPage: string): string {
  return overviewPage.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 100)
}

async function main() {
  initCargo()

  const outPath = path.join(process.cwd(), 'pipeline-cache', 'photo-whitelist.json')
  if (fs.existsSync(outPath)) {
    const cached: WhitelistEntry[] = JSON.parse(fs.readFileSync(outPath, 'utf-8'))
    console.log(`photo-whitelist.json 캐시 존재 (${cached.length}명) — 재실행 불요`)
    printTable(cached)
    return
  }

  const resultsPath = path.join(process.cwd(), 'pipeline-cache', 'results.json')
  if (!fs.existsSync(resultsPath)) {
    throw new Error('results.json 없음 — 03-results.ts 먼저 실행')
  }

  const results: ResultEntry[] = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'))

  // 1. Worlds 2013~2024 Place <= 4 팀 추출 (2025는 미개최 → 제외)
  const worldsTop4 = results.filter(r => r.leagueCode === 'WORLDS' && r.place <= 4 && r.year <= 2024)

  console.log(`Worlds 상위 4팀 결과: ${worldsTop4.length}건 (2013~2024, ${new Set(worldsTop4.map(r => r.year)).size}개 연도)`)

  // 중복 제거된 (overviewPage, team) 목록
  type TourKey = string  // `${overviewPage}|${team}`
  const tourSet = new Map<TourKey, { year: number; team: string; overviewPage: string; place: number }>()
  for (const r of worldsTop4) {
    tourSet.set(`${r.overviewPage}|${r.team}`, {
      year: r.year, team: r.team, overviewPage: r.overviewPage, place: r.place,
    })
  }

  console.log(`고유 (팀, 대회) 조합: ${tourSet.size}건`)

  // 2. ScoreboardPlayers — 각 Worlds 대회 OverviewPage에서 해당 팀 선수 추출
  // playerId → { appearances }
  const playerMap = new Map<string, {
    nameEn: string
    appearances: { year: number; team: string; overviewPage: string; place: number }[]
  }>()

  // OverviewPage 단위로 묶어 ScoreboardPlayers 쿼리 (§4.1 분할)
  const opToTeams = new Map<string, { year: number; team: string; overviewPage: string; place: number }[]>()
  for (const entry of tourSet.values()) {
    if (!opToTeams.has(entry.overviewPage)) opToTeams.set(entry.overviewPage, [])
    opToTeams.get(entry.overviewPage)!.push(entry)
  }

  let processed = 0
  for (const [overviewPage, teamEntries] of opToTeams) {
    processed++
    process.stderr.write(`  ScoreboardPlayers [${processed}/${opToTeams.size}]: ${overviewPage}\n`)

    const teamNames = new Set(teamEntries.map(e => e.team))
    const key = `worlds_sb_${opKey(overviewPage)}`

    const rows = await cargoPaginate(
      {
        tables: 'ScoreboardPlayers',
        fields: 'Link,Team,Role,OverviewPage,GameId',
        where: `OverviewPage="${overviewPage}"`,
      },
      key
    )

    // 해당 팀 소속 선수만 (Role 정규화 생략 — playerId 목록이 목적)
    const teamPlayerGames = new Map<string, Set<string>>()  // `${playerId}|${team}` → Set<GameId>

    for (const r of rows) {
      const pid = r.Link?.trim()
      const team = r.Team?.trim()
      const gameId = r.GameId?.trim()
      if (!pid || !team || !gameId || pid === 'ADD') continue
      if (!teamNames.has(team)) continue

      const k = `${pid}|${team}`
      if (!teamPlayerGames.has(k)) teamPlayerGames.set(k, new Set())
      teamPlayerGames.get(k)!.add(gameId)
    }

    // 5경기 이상 출전 선수만 포함 (주전 기준 — §3 규칙과 동일)
    for (const [k, gameIds] of teamPlayerGames) {
      if (gameIds.size < 5) continue
      const [playerId, team] = k.split('|')
      const teamEntry = teamEntries.find(e => e.team === team)!

      if (!playerMap.has(playerId)) {
        playerMap.set(playerId, { nameEn: playerId, appearances: [] })
      }
      playerMap.get(playerId)!.appearances.push({
        year: teamEntry.year, team: teamEntry.team,
        overviewPage: teamEntry.overviewPage, place: teamEntry.place,
      })
    }
  }

  console.log(`\n선수 후보: ${playerMap.size}명 (5경기 이상 출전 기준)`)

  // 3. Players 테이블에서 nameEn 보완
  const playerIds = [...playerMap.keys()]
  let pidIdx = 0
  for (const pid of playerIds) {
    pidIdx++
    if (pidIdx % 20 === 0) process.stderr.write(`  Players 메타: ${pidIdx}/${playerIds.length}\n`)

    const key = `player_${pid.replace(/[^a-zA-Z0-9_-]/g, '_')}`
    // 이미 02-rosters에서 캐시된 경우 재사용 — 없으면 새로 쿼리
    const rows = await cargoPaginate(
      {
        tables: 'Players',
        fields: 'ID,Name',
        where: `ID="${pid}"`,
      },
      key
    )
    if (rows.length > 0) {
      playerMap.get(pid)!.nameEn = rows[0].Name || pid
    }
  }

  // 4. appearances를 최신 연도 내림차순 정렬
  const whitelist: WhitelistEntry[] = [...playerMap.entries()].map(([playerId, v]) => ({
    playerId,
    nameEn: v.nameEn,
    worldsAppearances: v.appearances.sort((a, b) => b.year - a.year),
  }))

  // playerId 알파벳 정렬 (결정론)
  whitelist.sort((a, b) => a.playerId.localeCompare(b.playerId))

  fs.writeFileSync(outPath, JSON.stringify(whitelist, null, 2), 'utf-8')

  console.log(`\nphoto-whitelist.json 저장: ${whitelist.length}명`)
  printTable(whitelist)
}

function printTable(whitelist: WhitelistEntry[]) {
  console.log('\n=== Worlds 상위 4팀 선수 화이트리스트 ===')
  console.log('(사진 다운로드 전 호빈 검수 필요)\n')
  console.log(`${'ID'.padEnd(20)} ${'이름'.padEnd(16)} ${'최근 Worlds 연도/팀/순위'.padEnd(30)}`)
  console.log('─'.repeat(72))
  for (const p of whitelist) {
    const latest = p.worldsAppearances[0]
    const meta = latest
      ? `${latest.year} ${latest.team} (${latest.place}위)`
      : '-'
    console.log(`${p.playerId.padEnd(20)} ${p.nameEn.padEnd(16)} ${meta}`)
  }
  console.log(`\n총 ${whitelist.length}명`)
}

main().catch(e => { process.stderr.write(`Fatal: ${e}\n`); process.exit(1) })
