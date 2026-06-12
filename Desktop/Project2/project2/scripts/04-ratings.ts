// Phase 1: 레이팅 산출 — §4.3 공식 + awards.csv 병합
// 입력: rosters.json, results.json, awards.csv

import fs from 'fs'
import path from 'path'
import type { RosterEntry, RostersFile } from './02-rosters'
import type { ResultEntry } from './03-results'

// 팀명 정규화 — ScoreboardPlayers vs TournamentResults 불일치 해소
// 2013 SKT T1 분리 시대: ScoreboardPlayers="SK Telecom T1 2", TournamentResults="SK Telecom T1"
const TEAM_ALIASES: Record<string, string> = {
  'SK Telecom T1 2': 'SK Telecom T1',
}
function normalizeTeam(t: string): string { return TEAM_ALIASES[t] ?? t }

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
  worldsMvp: boolean
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

// calc/compress/clamp/individualBonus 전부 끝난 최종 OVR을 덮어씀
// key: `${playerId}|${year}|${leagueCode}`
const OVR_OVERRIDES: Record<string, number> = {
  // LCK
  'Faker|2015|LCK': 99,
  'MaRin|2015|LCK': 99,
  'Canyon|2020|LCK': 98,
  'ShowMaker|2020|LCK': 98,
  'Zeus|2023|LCK': 97,
  'Oner|2023|LCK': 94,
  'Keria|2023|LCK': 94,
  'Chovy|2024|LCK': 98,
  // LPL
  'Scout|2021|LPL': 97,
  'Viper (Park Do-hyeon)|2021|LPL': 97,  // Viper 실제 league=LPL (EDG), 호빈 목록 LCK는 오타
  'Ruler|2023|LPL': 96,                  // Ruler 2023 실제 league=LPL (JDG), 호빈 목록 LCK는 오타
  'knight (Zhuo Ding)|2024|LPL': 96,
  '369|2023|LPL': 95,
  'ON|2024|LPL': 93,
  'Elk|2024|LPL': 96,
  // LEC
  'Jankos|2019|LEC': 97,
  'Perkz|2019|LEC': 96,
  'Caps|2019|LEC': 97,
  'Caps|2024|LEC': 95,
  'BrokenBlade|2024|LEC': 90,  // G2 2024 월즈 광탈 반영 (95→90)
}

// §9 리그 계수 — 국내 플옵 가점에만 적용 (Worlds/MSI/수상 이중 페널티 방지)
// LCK/LPL: 1.0 / LEC: 0.95 / LCS: 0.85
const LEAGUE_COEFF: Record<string, number> = {
  LCK: 1.0,
  LPL: 1.0,
  LEC: 0.95,
  LCS: 0.85,
}

// §4.3 레이팅 공식 (§6.1 룰 패치 반영)
// Rule 1: 연내 복수 스플릿 가점 합산 — 최고 1회 아님
// Rule 4: AllPro 2020+ 시즌만 (제도 부재 이전 미적용)
function calcOvr(params: {
  playoffPlaces: number[]   // 연내 플옵 결과 전부 (합산 적용)
  msiPlace: number | null
  worldsPlace: number | null
  awards: AwardRow[]
  leagueCode: string        // 리그 계수 적용용
}): number {
  let score = 60
  const coeff = LEAGUE_COEFF[params.leagueCode] ?? 1.0

  // 국내 플옵 — 스플릿별 합산 + 리그 계수 (Rule 1)
  for (const p of params.playoffPlaces) {
    let pts = 0
    if (p === 1) pts = 8
    else if (p === 2) pts = 5
    else if (p <= 4) pts = 2
    else if (p <= 6) pts = 1
    else pts = 1
    score += pts * coeff
  }

  // MSI
  if (params.msiPlace !== null) {
    const p = params.msiPlace
    if (p === 1) score += 5
    else if (p === 2) score += 3
    else if (p <= 4) score += 2
  }

  // Worlds
  if (params.worldsPlace !== null) {
    const p = params.worldsPlace
    if (p === 1) score += 13
    else if (p === 2) score += 8
    else if (p <= 4) score += 5
    else if (p <= 8) score += 3
    else score += 1  // 진출만
  }

  // awards (Rule 4: AllPro는 2020+ 시즌만)
  for (const a of params.awards) {
    if (a.award === 'SEASON_MVP') score += 6
    else if (a.award === 'FINALS_MVP') score += 4
    else if (a.award === 'WORLDS_MVP') score += 8
    else if (a.award === 'ALLPRO_1ST' && a.year >= 2020) score += 5
    else if (a.award === 'ALLPRO_2ND' && a.year >= 2020) score += 3
    else if (a.award === 'ALLPRO_3RD' && a.year >= 2020) score += 1
    else if (a.award === 'EDITORIAL') score += a.value
  }

  return Math.max(60, Math.min(99, Math.round(score)))
}

// OVR 범위 압축 60~99 → 75~99 (선형 변환)
// 하한 75로 낮춰 78~80 밀집 완화 (격차 최대 24)
function compressOvr(raw: number): number {
  const clamped = Math.max(60, Math.min(99, raw))
  return Math.max(75, Math.min(99, Math.round(75 + (clamped - 60) * 24 / 39)))
}

function mean(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
}
function stdev(arr: number[], mu?: number): number {
  if (arr.length < 2) return 1
  const m = mu ?? mean(arr)
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length) || 1
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

  // ─── stats_agg 로드 (2013~2020 KDA, 재수집 불요) ──────────────────────────
  // key: `${playerId}|${team}|${year}` → kda
  const CARGO_DIR = path.join(process.cwd(), 'pipeline-cache', 'cargo')
  const aggByKey = new Map<string, number>()

  if (fs.existsSync(CARGO_DIR)) {
    const aggFiles = fs.readdirSync(CARGO_DIR).filter(f => f.startsWith('stats_agg_'))
    for (const f of aggFiles) {
      const m = f.match(/^stats_agg_\w+_(\d+)\.json$/)
      if (!m) continue
      const yr = parseInt(m[1])
      const rows = JSON.parse(fs.readFileSync(path.join(CARGO_DIR, f), 'utf-8')) as Record<string, string>[]
      for (const r of rows) {
        const pid = r.Link?.trim()
        const tm = r.Team?.trim()
        if (!pid || !tm) continue
        const n = parseInt(r.N || '0')
        if (n < 3) continue
        const avgK = parseFloat(r.AvgK || '0')
        const avgD = parseFloat(r.AvgD || '0')
        const avgA = parseFloat(r.AvgA || '0')
        const kda = (avgK + avgA) / Math.max(1, avgD)
        const key = `${pid}|${tm}|${yr}`
        if (!aggByKey.has(key)) aggByKey.set(key, kda)
      }
    }
    console.log(`stats_agg 로드: ${aggByKey.size}건`)
  }

  // ─── role × year 정규화 버킷 (2013~2020 KDA 정규화용) ─────────────────────
  const normBuckets = new Map<string, number[]>()  // key: `${role}|${year}`
  for (const e of entries) {
    if (e.year > 2020) continue
    const kda = aggByKey.get(`${e.playerId}|${e.team}|${e.year}`)
    if (kda === undefined) continue
    const bk = `${e.role}|${e.year}`
    if (!normBuckets.has(bk)) normBuckets.set(bk, [])
    normBuckets.get(bk)!.push(kda)
  }
  const normStats = new Map<string, { mu: number; sd: number }>()
  for (const [k, vals] of normBuckets) {
    const mu = mean(vals)
    const sd = stdev(vals, mu)
    normStats.set(k, { mu, sd })
  }

  // ─── 팀-연도별 최대 gameCount (주전/서브 기준선) ─────────────────────────
  const teamMaxGames = new Map<string, number>()  // key: `${team}|${year}`
  for (const e of entries) {
    const k = `${e.team}|${e.year}`
    teamMaxGames.set(k, Math.max(teamMaxGames.get(k) ?? 0, e.gameCount))
  }

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
      // Regional Finals 제외 — "Korea/Garena/SEA Regional Finals" 등 place=1이 지역 예선 우승(Worlds 우승 아님)
      if (!r.overviewPage.includes('World Championship')) continue
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

    // 국내 플옵 — 연내 전체 플옵 결과 수집 (Rule 1: 합산)
    const domesticKey = `${team}|${year}|${leagueCode}`
    const domesticResults = resultsByTeamYear.get(domesticKey) ?? []
    const playoffPlaces = domesticResults.filter(r => r.isPlayoffs).map(r => r.place)

    // Worlds/MSI (팀명 정규화 후 매칭 — ScoreboardPlayers vs TournamentResults 불일치 해소)
    const normalizedTeam = normalizeTeam(team)
    const teamYearKey = `${normalizedTeam}|${year}`
    const worldsPlace = worldsByTeamYear.get(teamYearKey) ?? null
    const msiPlace = msiByTeamYear.get(teamYearKey) ?? null

    const awards = awardsByPY.get(`${playerId}|${year}`) ?? []
    const rawOvr = calcOvr({ playoffPlaces, msiPlace, worldsPlace, awards, leagueCode })
    const baseOvr = compressOvr(rawOvr)

    // ─── 개인 차등 보정 ───────────────────────────────────────────────────────
    let individualBonus = 0

    // KDA 보정 — 2013~2020만 적용 (stats_agg 수집 구간)
    // 2021~2025: KDA 부재 → 보정 0 (패널티 없음, 시대 간 형평성 유지)
    if (year <= 2020) {
      const kda = aggByKey.get(`${playerId}|${team}|${year}`)
      if (kda !== undefined) {
        const norm = normStats.get(`${role}|${year}`)
        if (norm && norm.sd > 0) {
          const z = (kda - norm.mu) / norm.sd
          // z=±1.5 → ±3, scale=2.0 — 우승팀 주전 급락 방지
          individualBonus += Math.max(-3, Math.min(3, Math.round(z * 2.0)))
        }
      }
    }

    // 주전/서브 구분 — 전 시대 공통 (gameCount 커버리지 100%)
    const maxGames = teamMaxGames.get(`${team}|${year}`) ?? entry.gameCount
    if (entry.gameCount < maxGames * 0.8) {
      individualBonus -= 1  // 서브 소폭 감점
    }

    // 총 차등 폭 ±3 클램프 (우승팀 주전 추락 방지)
    individualBonus = Math.max(-3, Math.min(3, individualBonus))

    // 99 희소성 보호: baseOvr===99이면 보정 무시
    const calcOvr_ = baseOvr === 99
      ? 99
      : Math.max(75, Math.min(99, baseOvr + individualBonus))

    // 하드오버라이드 — OVR_OVERRIDES 매칭 시 calc/compress/clamp 결과 전부 무시
    const ovr = OVR_OVERRIDES[`${playerId}|${year}|${leagueCode}`] ?? calcOvr_

    // frame: Worlds Place=1 시즌
    const frame: 'WORLDS' | 'NORMAL' = worldsPlace === 1 ? 'WORLDS' : 'NORMAL'

    // crown: 해당 시즌 FINALS_MVP 또는 WORLDS_MVP 수상 시만 (SEASON_MVP 제외 — 호빈 확정)
    const crown = awards.some(a => a.award === 'FINALS_MVP' || a.award === 'WORLDS_MVP')

    // worldsMvp: awards.csv WORLDS_MVP 행 기준 — frame 추론 금지 (Faker 2015/Nuguri 2020 오분류 방지)
    const worldsMvp = awards.some(a => a.award === 'WORLDS_MVP')

    // msiWinner: MSI Place=1
    const msiWinner = msiPlace === 1

    // badges
    const badges: ('LEAGUE_CHAMP' | 'ALLPRO_1ST')[] = []
    if (playoffPlaces.includes(1)) badges.push('LEAGUE_CHAMP')
    if (awards.some(a => a.award === 'ALLPRO_1ST' && a.year >= 2020)) badges.push('ALLPRO_1ST')

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
      worldsMvp,
      msiWinner,
      badges,
    })
  }

  // ─── 동률 해시 분산 후처리 ────────────────────────────────────────────────
  // 조건: 같은 team|year 5명 전원 OVR 동률 AND OVR < 85 AND Worlds 진출X
  // playerId 문자코드 합 % 3 → +0/+1/+2 (결정론, 재현성 유지, EDITORIAL 행 불요)
  {
    const tieGroups = new Map<string, typeof rated>()
    for (const r of rated) {
      const k = `${r.team}|${r.year}`
      if (!tieGroups.has(k)) tieGroups.set(k, [])
      tieGroups.get(k)!.push(r)
    }
    for (const [key, group] of tieGroups) {
      if (group.length < 5) continue
      const baseOvr = group[0].ovr
      if (!group.every(r => r.ovr === baseOvr)) continue  // 동률 아님
      if (baseOvr >= 85) continue                          // 고티어 보존
      const [team, yearStr] = key.split('|')
      const wKey = `${normalizeTeam(team)}|${yearStr}`
      if (worldsByTeamYear.has(wKey)) continue             // Worlds 진출 팀 보존
      for (const r of group) {
        const hash = Array.from(r.playerId).reduce((s, c) => s + c.charCodeAt(0), 0) % 3
        r.ovr = Math.max(75, Math.min(99, r.ovr + hash))
      }
    }
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
