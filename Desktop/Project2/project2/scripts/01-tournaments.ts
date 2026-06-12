// Phase 1: 대회 목록 수집 — 4리그 × 2013~2025 + Worlds/MSI
// §4.1: (리그 × 연도) 단위 WHERE 분할

import fs from 'fs'
import path from 'path'
import { cargoPaginate, initCargo } from './lib/cargo'

export type LeagueCode = 'LCK' | 'LPL' | 'LEC' | 'LCS'
export type TournamentLeague = LeagueCode | 'WORLDS' | 'MSI'

export type TournamentEntry = {
  name: string
  overviewPage: string
  year: number
  leagueCode: TournamentLeague
  leagueValue: string
  isPlayoffs: boolean
  isQualifier: boolean
}

const LEAGUES: LeagueCode[] = ['LCK', 'LPL', 'LEC', 'LCS']
const YEAR_FROM = 2013
const YEAR_TO = 2025

// §4.2 + discovery.md 확정값 기준 시대별 League 필드 값
function getDomesticLeagueValues(code: LeagueCode, year: number): string[] {
  switch (code) {
    case 'LCK':
      // 2013~2015: OGN Champions 시대 — League="LoL The Champions"
      // 2016~:     LCK 리브랜딩    — League="LoL Champions Korea"
      return year <= 2015 ? ['LoL The Champions'] : ['LoL Champions Korea']
    case 'LPL': return ['Tencent LoL Pro League']
    case 'LEC':
      return year <= 2018
        ? ['Europe League Championship Series']
        : ['LoL EMEA Championship']
    case 'LCS':
      if (year <= 2018) return ['North America League Championship Series']
      if (year <= 2024) return ['League of Legends Championship Series']
      return ['League of Legends Championship of The Americas North']
  }
}

// 파일명에 쓸 수 없는 문자 치환
function sanitizeKey(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_')
}

// Rule 2: 연도 걸침 스플릿은 종료 연도 귀속
// "2013-2014 LCK Winter" 또는 "Winter 2013-14" → 2014
function adjustYearForCrossing(name: string, overviewPage: string, fallback: number): number {
  const text = `${name} ${overviewPage}`
  const m4 = text.match(/20(\d{2})-20(\d{2})/)
  if (m4) return parseInt('20' + m4[2], 10)
  const m2 = text.match(/20(\d{2})-(\d{2})/)
  if (m2) return parseInt('20' + m2[2], 10)
  return fallback
}

async function main() {
  initCargo()

  const outPath = path.join(process.cwd(), 'pipeline-cache', 'tournaments.json')
  if (fs.existsSync(outPath)) {
    const cached = JSON.parse(fs.readFileSync(outPath, 'utf-8')) as TournamentEntry[]
    console.log(`tournaments.json 캐시 존재 (${cached.length}건) — 재실행 불요`)
    return
  }

  const result: TournamentEntry[] = []

  // 1. 국내 4리그
  for (const code of LEAGUES) {
    for (let year = YEAR_FROM; year <= YEAR_TO; year++) {
      for (const leagueValue of getDomesticLeagueValues(code, year)) {
        const key = `t_${code}_${year}_${sanitizeKey(leagueValue)}`
        const rows = await cargoPaginate(
          {
            tables: 'Tournaments',
            fields: 'Name,OverviewPage,Year,League,IsPlayoffs,IsQualifier,SplitNumber',
            where: `League="${leagueValue}" AND Year="${year}"`,
          },
          key
        )
        for (const r of rows) {
          if (!r.OverviewPage) continue
          const name = r.Name ?? ''

          // LCK 2013~2015 (LoL The Champions): Leaguepedia IsQualifier·IsPlayoffs 값 보정
          // - Qualifiers/Promotion/Preseason 항목: IsQualifier=0이지만 이름으로 판별 → qualifier 처리
          // - 2013~2014 Season 항목: 별도 Playoffs 항목 없음, Season 토너먼트가 챔피언십(결승 포함)
          //   → 레이팅 플옵 가점 적용을 위해 isPlayoffs=true 처리
          // - 2015: 별도 "Playoffs" 항목 존재(IsPlayoffs=1) — Leaguepedia 값 그대로 사용
          let isThisQualifier = r.IsQualifier === '1'
          let isThisPlayoffs = r.IsPlayoffs === '1'
          if (leagueValue === 'LoL The Champions') {
            isThisQualifier = r.IsQualifier === '1' ||
              name.includes('Qualifier') ||
              name.includes('Promotion') ||
              name.includes('Preseason')
            if (!isThisQualifier && year <= 2014) {
              isThisPlayoffs = true
            }
          }

          result.push({
            name,
            overviewPage: r.OverviewPage,
            year: adjustYearForCrossing(name, r.OverviewPage, year),
            leagueCode: code,
            leagueValue,
            isPlayoffs: isThisPlayoffs,
            isQualifier: isThisQualifier,
          })
        }
      }
    }
  }

  // 2. Worlds (2013~2025) — League="World Championship"
  //    2013~2016: OverviewPage에 "/" 없음 (예: "2016 Season World Championship")
  //    2017+: "/Main Event" 서픽스 (예: "2017 Season World Championship/Main Event")
  //    "/Play-In" · "/<league>/Regional Finals" 등 나머지 슬래시 항목 제외
  for (let year = YEAR_FROM; year <= YEAR_TO; year++) {
    const rows = await cargoPaginate(
      {
        tables: 'Tournaments',
        fields: 'Name,OverviewPage,Year,League,IsPlayoffs,IsQualifier',
        where: `League="World Championship" AND Year="${year}"`,
      },
      `t_WORLDS_${year}`
    )
    for (const r of rows) {
      if (!r.OverviewPage) continue
      // 슬래시 있는 항목은 /Main Event 만 허용 (Play-In·지역 예선 제외)
      if (r.OverviewPage.includes('/') && !r.OverviewPage.endsWith('/Main Event')) continue
      result.push({
        name: r.Name ?? '',
        overviewPage: r.OverviewPage,
        year,
        leagueCode: 'WORLDS',
        leagueValue: 'World Championship',
        isPlayoffs: r.IsPlayoffs === '1',
        isQualifier: r.IsQualifier === '1',
      })
    }
  }

  // 3. MSI (2015~2025)
  for (let year = 2015; year <= YEAR_TO; year++) {
    const rows = await cargoPaginate(
      {
        tables: 'Tournaments',
        fields: 'Name,OverviewPage,Year,League,IsPlayoffs,IsQualifier',
        where: `League="Mid-Season Invitational" AND Year="${year}"`,
      },
      `t_MSI_${year}`
    )
    for (const r of rows) {
      if (!r.OverviewPage) continue
      result.push({
        name: r.Name ?? '',
        overviewPage: r.OverviewPage,
        year,
        leagueCode: 'MSI',
        leagueValue: 'Mid-Season Invitational',
        isPlayoffs: r.IsPlayoffs === '1',
        isQualifier: r.IsQualifier === '1',
      })
    }
  }

  // OverviewPage 기준 중복 제거 (같은 리그 연도에 여러 League 값으로 조회 시 중복 가능)
  const seen = new Set<string>()
  const deduped = result.filter(t => {
    if (seen.has(t.overviewPage)) return false
    seen.add(t.overviewPage)
    return true
  })

  fs.writeFileSync(outPath, JSON.stringify(deduped, null, 2), 'utf-8')

  // 리그별 요약
  console.log(`\ntournaments.json 저장: ${deduped.length}건`)
  for (const code of [...LEAGUES, 'WORLDS', 'MSI'] as const) {
    const items = deduped.filter(t => t.leagueCode === code)
    const po = items.filter(t => t.isPlayoffs).length
    console.log(`  ${code}: ${items.length}건 (playoffs: ${po})`)
  }
}

main().catch(e => { process.stderr.write(`Fatal: ${e}\n`); process.exit(1) })
