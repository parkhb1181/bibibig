// Phase 1: 대회 순위 수집 — TournamentResults (§4.1)
// 대상: 국내 플옵 + Worlds + MSI (WHERE OverviewPage 정확 일치)

import fs from 'fs'
import path from 'path'
import { cargoPaginate, initCargo } from './lib/cargo'
import type { TournamentEntry } from './01-tournaments'

export type ResultEntry = {
  overviewPage: string
  year: number
  leagueCode: string
  isPlayoffs: boolean
  team: string
  place: number      // 범위 표기("3-4", "5-8") → 최소값(더 좋은 순위)
  placeRaw: string
}

// 순위 문자열 파싱 ("1" → 1, "3-4" → 3, "5-8" → 5)
function parsePlace(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed || trimmed === "'" || trimmed === '') return null
  const parts = trimmed.split('-')
  const n = parseInt(parts[0], 10)
  return isNaN(n) ? null : n
}

function opKey(overviewPage: string): string {
  return overviewPage.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 100)
}

async function main() {
  initCargo()

  const outPath = path.join(process.cwd(), 'pipeline-cache', 'results.json')
  if (fs.existsSync(outPath)) {
    console.log('results.json 캐시 존재 — 재실행 불요')
    return
  }

  const toursPath = path.join(process.cwd(), 'pipeline-cache', 'tournaments.json')
  if (!fs.existsSync(toursPath)) throw new Error('tournaments.json 없음 — 01-tournaments.ts 먼저 실행')
  const tournaments = JSON.parse(fs.readFileSync(toursPath, 'utf-8')) as TournamentEntry[]

  // 수집 대상:
  // 1. 국내 플옵 (IsPlayoffs=1, IsQualifier=0)
  // 2. Worlds/MSI 전체 (IsQualifier=0)
  // 우선순위: WORLDS → MSI → 국내 (10-photo-whitelist는 Worlds 데이터 선행 필요)
  const PRIORITY: Record<string, number> = { WORLDS: 0, MSI: 1, LCK: 2, LPL: 3, LEC: 4, LCS: 5 }
  const targets = tournaments.filter(t => {
    if (t.isQualifier) return false
    if (t.leagueCode === 'WORLDS' || t.leagueCode === 'MSI') return true
    return t.isPlayoffs
  }).sort((a, b) => (PRIORITY[a.leagueCode] ?? 9) - (PRIORITY[b.leagueCode] ?? 9))

  console.log(`결과 수집 대상: ${targets.length}건 (플옵 + 국제전)`)

  const results: ResultEntry[] = []
  let worldsFlushed = false

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]
    if ((i + 1) % 50 === 0) process.stderr.write(`  results: ${i + 1}/${targets.length}\n`)

    // WORLDS 섹션 완료 직후 worlds-results.json 저장 → 10-photo-whitelist 즉시 실행 가능
    if (!worldsFlushed && t.leagueCode !== 'WORLDS') {
      const worldsOnly = results.filter(r => r.leagueCode === 'WORLDS')
      const worldsPath = path.join(process.cwd(), 'pipeline-cache', 'worlds-results.json')
      fs.writeFileSync(worldsPath, JSON.stringify(worldsOnly, null, 2), 'utf-8')
      process.stderr.write(`\n[03] WORLDS 완료 — worlds-results.json 저장 (${worldsOnly.length}건). 10-photo-whitelist 실행 가능\n`)
      worldsFlushed = true
    }

    // WORLDS 2017+: TournamentResults는 부모 OverviewPage(슬래시 없음)로 저장됨
    // 예: "2017 Season World Championship/Main Event" → "2017 Season World Championship"
    // discovery.md 0-b 확인: WHERE OverviewPage="2016 Season World Championship" 성공 (부모 페이지 형식)
    const trOverviewPage = (t.leagueCode === 'WORLDS' && t.overviewPage.endsWith('/Main Event'))
      ? t.overviewPage.slice(0, -'/Main Event'.length)
      : t.overviewPage
    const key = `result_${opKey(trOverviewPage)}`
    const rows = await cargoPaginate(
      {
        tables: 'TournamentResults',
        fields: 'Team,Place,OverviewPage',
        where: `OverviewPage="${trOverviewPage}"`,
        orderby: 'Place ASC',
      },
      key
    )

    for (const r of rows) {
      const team = r.Team?.trim()
      if (!team) continue
      const place = parsePlace(r.Place ?? '')
      if (place === null) continue

      results.push({
        overviewPage: t.overviewPage,
        year: t.year,
        leagueCode: t.leagueCode,
        isPlayoffs: t.isPlayoffs,
        team,
        place,
        placeRaw: r.Place ?? '',
      })
    }
  }

  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf-8')

  // 요약
  const byCode: Record<string, { pages: Set<string>; rows: number }> = {}
  for (const r of results) {
    if (!byCode[r.leagueCode]) byCode[r.leagueCode] = { pages: new Set(), rows: 0 }
    byCode[r.leagueCode].pages.add(r.overviewPage)
    byCode[r.leagueCode].rows++
  }
  console.log(`\nresults.json 저장: ${results.length}건`)
  for (const [code, { pages, rows }] of Object.entries(byCode)) {
    console.log(`  ${code}: ${pages.size}개 대회, ${rows}행`)
  }
}

main().catch(e => { process.stderr.write(`Fatal: ${e}\n`); process.exit(1) })
