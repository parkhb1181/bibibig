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
  const targets = tournaments.filter(t => {
    if (t.isQualifier) return false
    if (t.leagueCode === 'WORLDS' || t.leagueCode === 'MSI') return true
    return t.isPlayoffs
  })

  console.log(`결과 수집 대상: ${targets.length}건 (플옵 + 국제전)`)

  const results: ResultEntry[] = []

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]
    if ((i + 1) % 50 === 0) process.stderr.write(`  results: ${i + 1}/${targets.length}\n`)

    const key = `result_${opKey(t.overviewPage)}`
    const rows = await cargoPaginate(
      {
        tables: 'TournamentResults',
        fields: 'Team,Place,OverviewPage',
        where: `OverviewPage="${t.overviewPage}"`,
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
