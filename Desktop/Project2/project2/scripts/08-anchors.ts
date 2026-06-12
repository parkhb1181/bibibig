// §9 앵커 검증 리포트 — PRD §6.2 목표값 대비 실산출 OVR 비교
// npx tsx scripts/08-anchors.ts

import fs from 'fs'
import path from 'path'
import type { PlayerSeason } from '../src/lib/data'

type Anchor = {
  label: string       // 표시용 레이블
  playerId: string    // Leaguepedia ID
  year: number
  minOvr: number
  maxOvr: number
  note?: string
}

// PRD §6.2 앵커 목표값 (D0 수기 계산 세션 전 초안 — 확정 후 갱신)
const ANCHORS: Anchor[] = [
  { label: 'Faker 2015', playerId: 'Faker', year: 2015, minOvr: 97, maxOvr: 99,
    note: '전성기 피크 — Worlds+MSI 동시 제패 (MaRin WORLDS_MVP, Faker FINALS_MVP Summer)' },
  { label: 'Faker 2013', playerId: 'Faker', year: 2013, minOvr: 90, maxOvr: 95,
    note: 'MSI·공식 Worlds MVP 제도 부재 — awards 큐레이션에 따라 93~95 목표' },
  { label: 'Canyon 2020', playerId: 'Canyon', year: 2020, minOvr: 92, maxOvr: 96,
    note: 'PRD §6.2' },
  { label: 'Chovy 2024', playerId: 'Chovy', year: 2024, minOvr: 92, maxOvr: 96,
    note: 'PRD §6.2' },
  { label: 'Ruler 2017', playerId: 'Ruler', year: 2017, minOvr: 88, maxOvr: 92,
    note: 'PRD §6.2' },
]

function main() {
  const playersPath = path.join(process.cwd(), 'public', 'data', 'players.json')
  if (!fs.existsSync(playersPath)) {
    console.error('players.json 없음 — 07-build.ts 먼저 실행')
    process.exit(1)
  }

  const players: PlayerSeason[] = JSON.parse(fs.readFileSync(playersPath, 'utf-8'))

  console.log('=== 앵커 검증 (PRD §6.2) ===\n')

  // 앵커 대조
  let passCount = 0
  for (const anchor of ANCHORS) {
    const matches = players.filter(
      p => p.playerId === anchor.playerId && p.year === anchor.year
    )

    if (matches.length === 0) {
      console.log(`[ ? ] ${anchor.label}: 데이터 없음 (playerid=${anchor.playerId} year=${anchor.year})`)
      if (anchor.note) console.log(`      ↑ ${anchor.note}`)
      continue
    }

    for (const p of matches) {
      const pass = p.ovr >= anchor.minOvr && p.ovr <= anchor.maxOvr
      const mark = pass ? '[ ✓ ]' : '[ ✗ ]'
      const range = `목표 ${anchor.minOvr}~${anchor.maxOvr}`
      console.log(`${mark} ${anchor.label} (${p.team}): OVR ${p.ovr}  ${range}`)
      if (!pass) {
        const diff = p.ovr < anchor.minOvr ? `${anchor.minOvr - p.ovr} 부족` : `${p.ovr - anchor.maxOvr} 초과`
        console.log(`      ↑ ${diff} — awards.csv EDITORIAL 또는 §9 파라미터 조정 필요`)
      }
      if (anchor.note) console.log(`      ↑ ${anchor.note}`)
      if (pass) passCount++
    }
  }

  console.log(`\n앵커 통과: ${passCount}/${ANCHORS.length}`)

  // OVR 분포 히스토그램
  console.log('\n=== OVR 분포 ===')
  const bins = [
    [75, 77], [78, 80], [81, 83], [84, 86],
    [87, 89], [90, 92], [93, 95], [96, 98], [99, 99],
  ] as [number, number][]

  for (const [lo, hi] of bins) {
    const count = players.filter(p => p.ovr >= lo && p.ovr <= hi).length
    const bar = '█'.repeat(Math.round(count / 20))
    console.log(`${lo}-${hi}: ${String(count).padStart(5)}  ${bar}`)
  }

  // 리그·연도별 평균 OVR 상위 5개
  console.log('\n=== 평균 OVR 상위 TeamYear 5개 ===')
  const teamYearOvr = new Map<string, number[]>()
  for (const p of players) {
    const k = `${p.team} ${p.year}`
    if (!teamYearOvr.has(k)) teamYearOvr.set(k, [])
    teamYearOvr.get(k)!.push(p.ovr)
  }
  const avgOvr = [...teamYearOvr.entries()]
    .map(([k, ovrs]) => ({ key: k, avg: ovrs.reduce((s, n) => s + n, 0) / ovrs.length }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 5)
  for (const { key, avg } of avgOvr) {
    console.log(`  ${key}: ${avg.toFixed(1)}`)
  }

  // WORLDS frame 선수 목록 (상위 20)
  const worldsPlayers = players
    .filter(p => p.frame === 'WORLDS')
    .sort((a, b) => b.ovr - a.ovr)
    .slice(0, 20)
  if (worldsPlayers.length > 0) {
    console.log(`\n=== WORLDS frame 선수 (OVR 상위 20) ===`)
    for (const p of worldsPlayers) {
      console.log(`  ${p.nameEn} ${p.year} (${p.team}) — OVR ${p.ovr}`)
    }
  }
}

main()
