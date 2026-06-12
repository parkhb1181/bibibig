// Phase 1 보조: 개인 성능 지표 수집 — GROUP BY 집계 방식
// 이전: 토너먼트별 283쿼리(throttle 지옥) → 신규: (리그×연도) GROUP BY 52쿼리
// 출력: pipeline-cache/stats.json → 04-ratings.ts 개인 보정에 사용
// 캐시 키: stats_agg_{leagueCode}_{year}
// 첫 실행: 52개 × 5s throttle ≈ 4-5분

import fs from 'fs'
import path from 'path'
import { cargoPaginate, initCargo } from './lib/cargo'
import type { TournamentEntry } from './01-tournaments'

export type PlayerStats = {
  gameCount: number        // 집계된 게임 수
  avgKda: number           // (AvgK+AvgA)/max(AvgD,0.5)
  avgKp: number            // (AvgK+AvgA)/max(AvgTK,1)
  avgGoldShare: number     // AvgG/AvgTG
  avgDmg: number           // raw AVG(DamageToChampions) — 04-ratings에서 포지션 정규화
  hasStats: boolean
}

export type StatsFile = Record<string, PlayerStats>  // `${playerId.lower()}|${year}|${team}`

async function main() {
  initCargo()

  const outPath = path.join(process.cwd(), 'pipeline-cache', 'stats.json')
  if (fs.existsSync(outPath)) {
    console.log('stats.json 캐시 존재 — 재실행 불요 (삭제 후 재실행)')
    return
  }

  const toursPath = path.join(process.cwd(), 'pipeline-cache', 'tournaments.json')
  if (!fs.existsSync(toursPath)) throw new Error('tournaments.json 없음 — 01-tournaments.ts 먼저 실행')

  const tournaments = JSON.parse(fs.readFileSync(toursPath, 'utf-8')) as TournamentEntry[]
  const domesticTours = tournaments.filter(t => t.leagueCode !== 'WORLDS' && t.leagueCode !== 'MSI')

  // (leagueCode, year) 단위 그룹핑 — 각 조합당 1개 Cargo 집계 쿼리
  const lyMap = new Map<string, { leagueCode: string; year: number; overviewPages: string[] }>()
  for (const t of domesticTours) {
    const k = `${t.leagueCode}|${t.year}`
    if (!lyMap.has(k)) lyMap.set(k, { leagueCode: t.leagueCode, year: t.year, overviewPages: [] })
    lyMap.get(k)!.overviewPages.push(t.overviewPage)
  }

  const lyList = [...lyMap.values()].sort((a, b) =>
    a.year !== b.year ? a.year - b.year : a.leagueCode.localeCompare(b.leagueCode)
  )
  console.log(`리그×연도 조합: ${lyList.length}개 — 쿼리 ${lyList.length}회 (throttle 5s × ${lyList.length} ≈ ${Math.ceil(lyList.length * 5 / 60)}분)`)

  const result: StatsFile = {}
  let idx = 0

  for (const ly of lyList) {
    idx++
    process.stderr.write(`  [${String(idx).padStart(2)}/${lyList.length}] ${ly.leagueCode} ${ly.year} (${ly.overviewPages.length}개 토너먼트)\n`)

    // OverviewPage IN ("p1","p2",...) WHERE 절 구성 — 해당 리그×연도의 전체 도메스틱 토너먼트
    const quoted = ly.overviewPages.map(p => `"${p.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    const whereClause = `OverviewPage IN (${quoted.join(',')})`
    const cacheKey = `stats_agg_${ly.leagueCode}_${ly.year}`

    const rows = await cargoPaginate(
      {
        tables: 'ScoreboardPlayers',
        fields: [
          'Link',
          'Team',
          'AVG(Kills)=AvgK',
          'AVG(Deaths)=AvgD',
          'AVG(Assists)=AvgA',
          'AVG(TeamKills)=AvgTK',
          'AVG(Gold)=AvgG',
          'AVG(TeamGold)=AvgTG',
          'AVG(DamageToChampions)=AvgDmg',
          'COUNT(GameId)=N',
        ].join(','),
        where: whereClause,
        group_by: 'Link,Team',
      },
      cacheKey
    )

    for (const row of rows) {
      const pid = row.Link?.trim()
      const team = row.Team?.trim()
      if (!pid || !team || pid === 'ADD') continue

      const k = parseFloat(row.AvgK || '0')
      const d = parseFloat(row.AvgD || '0')
      const a = parseFloat(row.AvgA || '0')
      const tk = parseFloat(row.AvgTK || '0')
      const g = parseFloat(row.AvgG || '0')
      const tg = parseFloat(row.AvgTG || '0')
      const dmg = parseFloat(row.AvgDmg || '0')
      const n = parseInt(row.N || '0', 10)

      const hasStats = n > 0 && (k > 0 || a > 0 || g > 100)
      const statKey = `${pid.toLowerCase()}|${ly.year}|${team}`

      result[statKey] = {
        gameCount: n,
        avgKda: hasStats ? (k + a) / Math.max(d, 0.5) : 0,
        avgKp: hasStats ? (k + a) / Math.max(tk, 1) : 0,
        avgGoldShare: hasStats && tg > 0 ? g / tg : 0,
        avgDmg: hasStats ? dmg : 0,
        hasStats,
      }
    }
  }

  fs.writeFileSync(outPath, JSON.stringify(result, null, 2))

  const withStats = Object.values(result).filter(v => v.hasStats).length
  const total = Object.keys(result).length
  console.log(`\nstats.json 저장: ${total}건, 실지표 ${withStats}건 (${(withStats / total * 100).toFixed(1)}%)`)

  // 샘플 검증
  const samples = [
    'faker|2015|SK Telecom T1',
    'caps|2019|G2 Esports',
    'canyon|2020|DAMWON Gaming',
    'chovy|2024|Gen.G',
  ]
  console.log('\n샘플 지표:')
  for (const k of samples) {
    const s = result[k]
    if (s?.hasStats) {
      console.log(`  ${k}: kda=${s.avgKda.toFixed(2)} kp=${(s.avgKp * 100).toFixed(1)}% gold=${(s.avgGoldShare * 100).toFixed(1)}% dmg=${Math.round(s.avgDmg).toLocaleString()} (n=${s.gameCount})`)
    } else {
      console.log(`  ${k}: 데이터 없음`)
    }
  }

  // G2 2019 팀원 전체 출력 (차등화 검증용)
  console.log('\nG2 2019 전체 (차등화 검증):')
  const g2 = Object.entries(result)
    .filter(([k]) => k.endsWith('|2019|G2 Esports'))
    .sort(([a], [b]) => a.localeCompare(b))
  for (const [k, s] of g2) {
    if (s.hasStats) {
      console.log(`  ${k.split('|')[0]}: kda=${s.avgKda.toFixed(2)} kp=${(s.avgKp * 100).toFixed(1)}% gold=${(s.avgGoldShare * 100).toFixed(1)}% dmg=${Math.round(s.avgDmg).toLocaleString()} (n=${s.gameCount})`)
    }
  }
}

main().catch(e => { process.stderr.write(`Fatal: ${e}\n`); process.exit(1) })
