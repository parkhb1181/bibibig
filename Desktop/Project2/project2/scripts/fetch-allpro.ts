// 임시 스크립트: IndividualAchievements 테이블에서 ALLPRO 2ND/3RD 수집
// 실행: npx tsx scripts/fetch-allpro.ts
// 용도: awards.csv ALLPRO 2ND/3RD 보완 (재빌드 전 수집 단계)

import { cargoPaginate, initCargo, type CargoRow } from './lib/cargo'
import fs from 'fs'
import path from 'path'

initCargo()

const LEAGUES = [
  { code: 'LCK', overviewPrefix: 'LCK/' },
  { code: 'LPL', overviewPrefix: 'LPL/' },
  { code: 'LEC', overviewPrefixes: ['LEC/', 'EU LCS/'] },
  { code: 'LCS', overviewPrefixes: ['LCS/', 'NA LCS/'] },
]
const YEARS = [2020, 2021, 2022, 2023, 2024]

// IndividualAchievements의 AchievementType 값 중 올프로 관련 탐색
// Place 또는 AchievementType 필드가 1st/2nd/3rd를 구분

async function main() {
  // 1단계: 샘플 쿼리로 AchievementType 실제 값 확인
  console.log('\n[1] AchievementType 샘플 쿼리 — LCK 2021 AllPro 유사 데이터')
  const sample = await cargoPaginate(
    {
      tables: 'IndividualAchievements',
      fields: 'Link,Team,OverviewPage,Place,Place_Number,AchievementType,Display',
      where: 'OverviewPage LIKE "LCK/2021%" AND (AchievementType LIKE "%Pro%" OR AchievementType LIKE "%All%")',
      limit: '50',
    },
    'ia_sample_lck2021_allpro'
  )
  console.log('결과 건수:', sample.length)
  if (sample.length > 0) {
    const types = [...new Set(sample.map(r => r.AchievementType))].sort()
    console.log('AchievementType 고유값:', types)
    console.log('샘플 3건:', JSON.stringify(sample.slice(0, 3), null, 2))
  } else {
    // 타입 제한 없이 LCK 2021 전체 조회
    console.log('AllPro 필터 결과 없음 — LCK 2021 전체 AchievementType 확인')
    const all = await cargoPaginate(
      {
        tables: 'IndividualAchievements',
        fields: 'Link,Team,OverviewPage,Place,Place_Number,AchievementType,Display',
        where: 'OverviewPage LIKE "LCK/2021%"',
        limit: '20',
      },
      'ia_sample_lck2021_all'
    )
    console.log('건수:', all.length)
    const types = [...new Set(all.map(r => r.AchievementType))].sort()
    console.log('AchievementType 고유값:', types)
    if (all.length > 0) console.log('샘플:', JSON.stringify(all.slice(0, 5), null, 2))
  }

  // 2단계: 올프로 OverviewPage 패턴 파악
  console.log('\n[2] OverviewPage "All-Pro" 포함 건 — 연도 무관 (패턴 파악)')
  const overviewSample = await cargoPaginate(
    {
      tables: 'IndividualAchievements',
      fields: 'Link,Team,OverviewPage,AchievementType,Place,Display',
      where: 'OverviewPage LIKE "%All-Pro%"',
      limit: '10',
    },
    'ia_overview_allpro'
  )
  console.log('건수:', overviewSample.length)
  if (overviewSample.length > 0) {
    const overviewTypes = [...new Set(overviewSample.map(r => r.OverviewPage))].sort()
    console.log('OverviewPage 패턴:', overviewTypes.slice(0, 10))
    console.log('샘플:', JSON.stringify(overviewSample.slice(0, 3), null, 2))
  }

  // 결과 저장
  const outPath = path.join(process.cwd(), 'pipeline-cache', 'ia-allpro-discovery.json')
  fs.writeFileSync(outPath, JSON.stringify({ sample, overviewSample }, null, 2), 'utf-8')
  console.log('\n결과 저장:', outPath)
}

main().catch(e => { process.stderr.write('Fatal: ' + e + '\n'); process.exit(1) })
