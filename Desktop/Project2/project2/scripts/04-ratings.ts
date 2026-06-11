// Phase 1: 레이팅 산출 — §4.3 공식 + awards.csv 병합
// 입력: rosters.json, results.json, awards.csv

import fs from 'fs'
import path from 'path'
import type { RosterEntry, RostersFile } from './02-rosters'
import type { ResultEntry } from './03-results'

// §3 스키마와 일치하는 중간 출력 (photo는 Phase 2에서 채움)
export type RatedEntry = {
  playerId: string
  nameEn: string
  nameKo: string | null
  team: string
  year: number
  leagueCode: string
  role: string
  ovr: number
  frame: 'WORLDS' | 'NORMAL'
  crown: boolean
  msiWinner: boolean
  badges: ('LEAGUE_CHAMP' | 'ALLPRO_1ST')[]
}

type AwardRow = {
  playerId: string
  year: number
  league: string
  award: string
  value: number
}

function parseAwardsCsv(csv: string): AwardRow[] {
  const lines = csv.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) return []
  // header: playerId,year,league,award,value
  return lines.slice(1).map(line => {
    const cols = line.split(',')
    return {
      playerId: cols[0] ?? '',
      year: parseInt(cols[1] ?? '0', 10),
      league: cols[2] ?? '',
      award: cols[3] ?? '',
      value: parseFloat(cols[4] ?? '0') || 0,
    }
  }).filter(r => r.playerId && r.year > 0 && r.award)
}

// §4.3 레이팅 공식
function calcOvr(params: {
  bestPlayoffPlace: number | null
  msiPlace: number | null
  worldsPlace: number | null
  awards: AwardRow[]
}): number {
  let score = 60

  // 국내 플옵
  if (params.bestPlayoffPlace !== null) {
    const p = params.bestPlayoffPlace
    if (p === 1) score += 10
    else if (p === 2) score += 6
    else if (p <= 4) score += 3
    else if (p <= 6) score += 3
    else score += 1
  }

  // MSI
  if (params.msiPlace !== null) {
    const p = params.msiPlace
    if (p === 1) score += 8
    else if (p === 2) score += 5
    else if (p <= 4) score += 3
  }

  // Worlds
  if (params.worldsPlace !== null) {
    const p = params.worldsPlace
    if (p === 1) score += 15
    else if (p === 2) score += 10
    else if (p <= 4) score += 7
    else if (p <= 8) score += 4
    else score += 2  // 진출만
  }

  // awards
  for (const a of params.awards) {
    if (a.award === 'SEASON_MVP') score += 6
    else if (a.award === 'FINALS_MVP') score += 4
    else if (a.award === 'WORLDS_MVP') score += 8
    else if (a.award === 'ALLPRO_1ST') score += 5
    else if (a.award === 'ALLPRO_2ND') score += 3
    else if (a.award === 'ALLPRO_3RD') score += 1
    else if (a.award === 'EDITORIAL') score += a.value
  }

  return Math.max(60, Math.min(99, Math.round(score)))
}

async function main() {
  const outPath = path.join(process.cwd(), 'pipeline-cache', 'ratings.json')
  if (fs.existsSync(outPath)) {
    console.log('ratings.json 캐시 존재 — 재실행 불요')
    return
  }

  const rostersPath = path.join(process.cwd(), 'pipeline-cache', 'rosters.json')
  const resultsPath = path.join(process.cwd(), 'pipeline-cache', 'results.json')
  const awardsPath = path.join(process.cwd(), 'pipeline-input', 'awards.csv')

  if (!fs.existsSync(rostersPath)) throw new Error('rosters.json 없음')
  if (!fs.existsSync(resultsPath)) throw new Error('results.json 없음')

  const { players, entries }: RostersFile = JSON.parse(fs.readFileSync(rostersPath, 'utf-8'))
  const results: ResultEntry[] = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'))
  const awardsCsv = fs.existsSync(awardsPath) ? fs.readFileSync(awardsPath, 'utf-8') : ''
  const allAwards = parseAwardsCsv(awardsCsv)

  // 빠른 조회를 위한 인덱스
  // resultsByTeamYear: `${team}|${year}|${leagueCode}` → 플옵/Worlds/MSI 결과 배열
  const resultsByTeamYear = new Map<string, ResultEntry[]>()
  for (const r of results) {
    const k = `${r.team}|${r.year}|${r.leagueCode}`
    if (!resultsByTeamYear.has(k)) resultsByTeamYear.set(k, [])
    resultsByTeamYear.get(k)!.push(r)
  }

  // Worlds/MSI 결과 인덱스: `${team}|${year}` → place (Worlds), `${team}|${year}` → place (MSI)
  const worldsByTeamYear = new Map<string, number>()
  const msiByTeamYear = new Map<string, number>()
  for (const r of results) {
    const k = `${r.team}|${r.year}`
    if (r.leagueCode === 'WORLDS') {
      const existing = worldsByTeamYear.get(k)
      if (existing === undefined || r.place < existing) worldsByTeamYear.set(k, r.place)
    } else if (r.leagueCode === 'MSI') {
      const existing = msiByTeamYear.get(k)
      if (existing === undefined || r.place < existing) msiByTeamYear.set(k, r.place)
    }
  }

  // awards 인덱스: `${playerId}|${year}` → AwardRow[]
  const awardsByPY = new Map<string, AwardRow[]>()
  for (const a of allAwards) {
    const k = `${a.playerId}|${a.year}`
    if (!awardsByPY.has(k)) awardsByPY.set(k, [])
    awardsByPY.get(k)!.push(a)
  }

  const rated: RatedEntry[] = []

  for (const entry of entries) {
    const { playerId, team, year, leagueCode, role } = entry
    const playerMeta = players[playerId]
    const nameEn = playerMeta?.nameEn ?? playerId
    const nameKo = playerMeta?.nameKo ?? null

    // 국내 플옵 — 연내 최고 성적 (place가 낮을수록 좋음)
    const domesticKey = `${team}|${year}|${leagueCode}`
    const domesticResults = resultsByTeamYear.get(domesticKey) ?? []
    const playoffs = domesticResults.filter(r => r.isPlayoffs)
    const bestPlayoffPlace = playoffs.length > 0
      ? Math.min(...playoffs.map(r => r.place))
      : null

    // Worlds/MSI (팀 이름 기준 매칭)
    const teamYearKey = `${team}|${year}`
    const worldsPlace = worldsByTeamYear.get(teamYearKey) ?? null
    const msiPlace = msiByTeamYear.get(teamYearKey) ?? null

    const awards = awardsByPY.get(`${playerId}|${year}`) ?? []
    const ovr = calcOvr({ bestPlayoffPlace, msiPlace, worldsPlace, awards })

    // frame: Worlds Place=1 시즌
    const frame: 'WORLDS' | 'NORMAL' = worldsPlace === 1 ? 'WORLDS' : 'NORMAL'

    // crown: 해당 시즌 FINALS_MVP 또는 WORLDS_MVP 수상 시만 (SEASON_MVP 제외 — 호빈 확정)
    const crown = awards.some(a => a.award === 'FINALS_MVP' || a.award === 'WORLDS_MVP')

    // msiWinner: MSI Place=1
    const msiWinner = msiPlace === 1

    // badges
    const badges: ('LEAGUE_CHAMP' | 'ALLPRO_1ST')[] = []
    if (bestPlayoffPlace === 1) badges.push('LEAGUE_CHAMP')
    if (awards.some(a => a.award === 'ALLPRO_1ST')) badges.push('ALLPRO_1ST')

    rated.push({
      playerId,
      nameEn,
      nameKo,
      team,
      year,
      leagueCode,
      role,
      ovr,
      frame,
      crown,
      msiWinner,
      badges,
    })
  }

  fs.writeFileSync(outPath, JSON.stringify(rated, null, 2), 'utf-8')

  console.log(`\nratings.json 저장: ${rated.length}건`)
  const ovrDist = [60, 70, 80, 90].map(min => {
    const max = min + 9
    return `${min}-${max}: ${rated.filter(r => r.ovr >= min && r.ovr <= max).length}`
  })
  console.log(`  OVR 분포: ${ovrDist.join(', ')}`)
  console.log(`  WORLDS frame: ${rated.filter(r => r.frame === 'WORLDS').length}`)
  console.log(`  crown: ${rated.filter(r => r.crown).length}`)
  console.log(`  msiWinner: ${rated.filter(r => r.msiWinner).length}`)
}

main().catch(e => { process.stderr.write(`Fatal: ${e}\n`); process.exit(1) })
