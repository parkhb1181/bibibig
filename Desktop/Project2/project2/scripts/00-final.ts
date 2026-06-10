/**
 * Phase 0 최종 마무리 — discovery.md에 T1·S1잔여·SemVal 섹션 추가
 * THROTTLE_MS=3000 (이 세션 전용)
 */
import fs from 'fs'
import path from 'path'

const BASE = 'https://lol.fandom.com/api.php'
const UA = 'AllTimeDraftBot/1.0 (personal fan project; parkhb1181@gmail.com)'
const THROTTLE_MS = 3000

let lastCallAt = 0

async function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms))
}

async function apiFetch(url: string): Promise<Response> {
  const wait = THROTTLE_MS - (Date.now() - lastCallAt)
  if (wait > 0) await sleep(wait)
  lastCallAt = Date.now()
  return fetch(url, { headers: { 'User-Agent': UA } })
}

interface CargoResult {
  data: Record<string, string>[]
  error?: unknown
}

async function cargo(params: Record<string, string>): Promise<CargoResult> {
  const u = new URL(BASE)
  u.searchParams.set('action', 'cargoquery')
  u.searchParams.set('format', 'json')
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)

  for (let attempt = 0; attempt < 4; attempt++) {
    let res: Response
    try {
      res = await apiFetch(u.toString())
    } catch (e) {
      return { data: [], error: e instanceof Error ? e.message : String(e) }
    }
    if (!res.ok) return { data: [], error: `HTTP ${res.status}` }

    const json: {
      cargoquery?: { title: Record<string, string> }[]
      error?: { code?: string; info?: string }
    } = await res.json()

    if (json.error) {
      if (json.error.code === 'ratelimited') {
        const wait = [10000, 20000, 40000][attempt] ?? 40000
        process.stdout.write(`  ratelimited — waiting ${wait / 1000}s...\n`)
        await sleep(wait)
        continue
      }
      return { data: [], error: json.error }
    }
    return { data: (json.cargoquery ?? []).map(r => r.title) }
  }
  return { data: [], error: 'ratelimited after retries' }
}

async function main() {
  const cacheDir = path.join(process.cwd(), 'pipeline-cache')
  const outPath = path.join(cacheDir, 'discovery.md')

  // 기존 discovery.md에 섹션 추가 (없으면 신규 생성)
  const existing = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf-8') : ''
  const lines: string[] = existing ? existing.trimEnd().split('\n') : []

  const md = (...args: unknown[]) => {
    const s = args.join(' ')
    process.stdout.write(s + '\n')
    lines.push(s)
  }

  md('')
  md('---')
  md(`## 최종 마무리 추가 (${new Date().toISOString()})`)
  md('')

  // ═══════════════════════════════════════════
  // T1-A: Tournaments — Worlds·MSI·LCK 플옵 OverviewPage 확보
  // ═══════════════════════════════════════════
  md('---')
  md('## T1-A. Tournaments 표적 쿼리 — Worlds·MSI·LCK 2016 Playoffs OverviewPage')
  md('')

  // T1-A-1: Worlds 2016
  process.stdout.write('[T1-A-1] Tournaments Worlds 2016...\n')
  const t1a1 = await cargo({
    tables: 'Tournaments',
    fields: 'Name,OverviewPage,Year,League,IsPlayoffs',
    where: 'League="World Championship" AND Year=2016',
    limit: '10',
  })
  md('### Worlds 2016 (League="World Championship")')
  if (t1a1.error) {
    md(`**상태**: 실패 — \`${JSON.stringify(t1a1.error)}\``)
  } else {
    md(`**상태**: 성공 (${t1a1.data.length}행)`)
    md('```json')
    md(JSON.stringify(t1a1.data, null, 2))
    md('```')
  }
  md('')

  // T1-A-2: MSI 2016
  process.stdout.write('[T1-A-2] Tournaments MSI 2016...\n')
  const t1a2 = await cargo({
    tables: 'Tournaments',
    fields: 'Name,OverviewPage,Year,League,IsPlayoffs',
    where: 'League="Mid-Season Invitational" AND Year=2016',
    limit: '5',
  })
  md('### MSI 2016 (League="Mid-Season Invitational")')
  if (t1a2.error) {
    md(`**상태**: 실패 — \`${JSON.stringify(t1a2.error)}\``)
  } else {
    md(`**상태**: 성공 (${t1a2.data.length}행)`)
    md('```json')
    md(JSON.stringify(t1a2.data, null, 2))
    md('```')
  }
  md('')

  // T1-A-3: LCK 2016 Summer Playoffs
  process.stdout.write('[T1-A-3] Tournaments LCK 2016 Playoffs...\n')
  const t1a3 = await cargo({
    tables: 'Tournaments',
    fields: 'Name,OverviewPage,Year,League,IsPlayoffs',
    where: 'League="LoL Champions Korea" AND Year=2016 AND IsPlayoffs="1"',
    limit: '10',
  })
  md('### LCK 2016 플옵 (League="LoL Champions Korea", IsPlayoffs=1)')
  if (t1a3.error) {
    md(`**상태**: 실패 — \`${JSON.stringify(t1a3.error)}\``)
  } else {
    md(`**상태**: 성공 (${t1a3.data.length}행)`)
    md('```json')
    md(JSON.stringify(t1a3.data, null, 2))
    md('```')
  }
  md('')

  // ═══════════════════════════════════════════
  // T1-B: TournamentResults 필드 점증 테스트 (no WHERE)
  // ═══════════════════════════════════════════
  md('---')
  md('## T1-B. TournamentResults 필드 점증 (no WHERE, limit=5)')
  md('(MWException 재현 여부 + 사용 가능 필드 확정)')
  md('')

  const fieldSteps = [
    'Team',
    'Team,Place',
    'Team,Place,OverviewPage',
    'Team,Place,OverviewPage,Date',
  ]

  for (const fields of fieldSteps) {
    process.stdout.write(`[T1-B] TournamentResults fields="${fields}"...\n`)
    const r = await cargo({
      tables: 'TournamentResults',
      fields,
      limit: '5',
    })
    md(`### fields: \`${fields}\``)
    if (r.error) {
      md(`**상태**: 실패 — \`${JSON.stringify(r.error)}\``)
    } else {
      md(`**상태**: 성공 (${r.data.length}행)`)
      if (r.data.length > 0) {
        md('```json')
        md(JSON.stringify(r.data[0], null, 2))
        md('```')
      }
    }
    md('')
  }

  // T1-B 결론
  md('### T1-B 결론')
  md('(위 결과에 따라 TournamentResults 채택 또는 intl-results.csv 정적 입력 선택)')
  md('')

  // ═══════════════════════════════════════════
  // S1-잔여: LCS 2020 League 값
  // ═══════════════════════════════════════════
  md('---')
  md('## S1-잔여. LCS 2020 League 값 확정')
  md('')

  process.stdout.write('[S1-rem-1] Tournaments LCS/2020%...\n')
  const s1lcs = await cargo({
    tables: 'Tournaments',
    fields: 'Name,League,Year,OverviewPage',
    where: 'OverviewPage LIKE "LCS/2020%"',
    limit: '10',
  })
  md('### LCS 2020 (OverviewPage LIKE "LCS/2020%")')
  if (s1lcs.error) {
    md(`**상태**: 실패 — \`${JSON.stringify(s1lcs.error)}\``)
  } else {
    md(`**상태**: 성공 (${s1lcs.data.length}행)`)
    if (s1lcs.data.length > 0) {
      const leagues = [...new Set(s1lcs.data.map(r => r.League))].sort()
      md(`**LCS 2020 League 값**: ${leagues.map(l => `"${l}"`).join(', ')}`)
      md('```json')
      md(JSON.stringify(s1lcs.data.slice(0, 3), null, 2))
      md('```')
    } else {
      md('(0행 — OverviewPage 형식이 다를 가능성)')
      // fallback: Year=2020, Name LIKE "%LCS%"
    }
  }
  md('')

  // S1 LCS 2020 fallback: Year=2020 + Name LIKE
  if (!s1lcs.error && s1lcs.data.length === 0) {
    process.stdout.write('[S1-rem-1b] Tournaments Year=2020 LCS fallback...\n')
    const s1lcs2 = await cargo({
      tables: 'Tournaments',
      fields: 'Name,League,Year,OverviewPage',
      where: 'Year=2020 AND Name LIKE "%LCS%"',
      limit: '10',
    })
    md('### LCS 2020 fallback (Year=2020, Name LIKE "%LCS%")')
    if (s1lcs2.error) {
      md(`**상태**: 실패 — \`${JSON.stringify(s1lcs2.error)}\``)
    } else {
      md(`**상태**: 성공 (${s1lcs2.data.length}행)`)
      if (s1lcs2.data.length > 0) {
        const leagues2 = [...new Set(s1lcs2.data.map(r => r.League))].sort()
        md(`**LCS 2020 League 값**: ${leagues2.map(l => `"${l}"`).join(', ')}`)
        md('```json')
        md(JSON.stringify(s1lcs2.data.slice(0, 3), null, 2))
        md('```')
      }
    }
    md('')
  }

  // ═══════════════════════════════════════════
  // S1-잔여: LTA North 2025 League 값
  // ═══════════════════════════════════════════
  process.stdout.write('[S1-rem-2] Tournaments LTA North 2025...\n')
  const s1lta = await cargo({
    tables: 'Tournaments',
    fields: 'Name,League,Year,OverviewPage',
    where: 'Year=2025 AND (Name LIKE "%LTA%North%" OR Name LIKE "%LTA North%")',
    limit: '10',
  })
  md('### LTA North 2025 (Name LIKE "%LTA%North%" OR "%LTA North%")')
  if (s1lta.error) {
    md(`**상태**: 실패 — \`${JSON.stringify(s1lta.error)}\``)
  } else {
    md(`**상태**: 성공 (${s1lta.data.length}행)`)
    if (s1lta.data.length > 0) {
      const leagues = [...new Set(s1lta.data.map(r => r.League))].sort()
      md(`**LTA North 2025 League 값**: ${leagues.map(l => `"${l}"`).join(', ')}`)
      md('```json')
      md(JSON.stringify(s1lta.data.slice(0, 5), null, 2))
      md('```')
    } else {
      md('(0행 — League 값 확인 불가)')
    }
  }
  md('')

  // ═══════════════════════════════════════════
  // SemVal: 2016 LCK Summer Playoffs Place=1 의미 검증
  // ═══════════════════════════════════════════
  md('---')
  md('## SemVal. 의미 검증 — 2016 LCK Summer Playoffs Place=1')
  md('')

  // SemVal 전제: t1a3에서 LCK 2016 Summer Playoffs OverviewPage 확보
  const lckPlayoffsPage = t1a3.data.find(r =>
    r.Name?.toLowerCase().includes('summer') && r.OverviewPage
  )?.OverviewPage ?? ''

  if (!lckPlayoffsPage) {
    md(`**전제 실패**: T1-A-3에서 LCK 2016 Summer Playoffs OverviewPage를 찾지 못함.`)
    md(`T1-A-3 데이터: \`${JSON.stringify(t1a3.data)}\``)
    md('SemVal 수행 불가 — 호빈 보고 후 수동 확인 필요.')
    md('')
  } else {
    md(`**대상 OverviewPage**: \`${lckPlayoffsPage}\``)
    md('')

    process.stdout.write(`[SemVal] Standings for "${lckPlayoffsPage}"...\n`)
    const semval = await cargo({
      tables: 'Standings',
      fields: 'Team,Place,OverviewPage',
      where: `OverviewPage="${lckPlayoffsPage}"`,
      orderby: 'Place ASC',
      limit: '10',
    })

    if (semval.error) {
      md(`**상태**: 실패 — \`${JSON.stringify(semval.error)}\``)
    } else {
      md(`**상태**: 성공 (${semval.data.length}행)`)
      md('```json')
      md(JSON.stringify(semval.data, null, 2))
      md('```')

      const first = semval.data.find(r => r.Place === '1')
      if (first) {
        const expected = 'SKT T1'
        const match = first.Team === expected
        md('')
        md(`**Place=1 팀**: \`${first.Team}\``)
        md(`**검증 결과**: ${match ? '✅ 일치 (SKT T1)' : `⚠️ 불일치 — 예상: "${expected}", 실제: "${first.Team}"`}`)
      } else {
        md('**Place=1 행 없음** — Standings가 이 OverviewPage 데이터 미보유')
      }
    }
    md('')
  }

  // ═══════════════════════════════════════════
  // T1 결론 요약
  // ═══════════════════════════════════════════
  md('---')
  md('## T1·S1잔여·SemVal 결론 요약')
  md('')
  md('| 항목 | 결과 |')
  md('|---|---|')

  // Worlds 2016 OverviewPage
  const worldsPage = t1a1.data[0]?.OverviewPage ?? '미확인'
  md(`| Worlds 2016 OverviewPage | \`${worldsPage}\` |`)

  // MSI 2016 OverviewPage
  const msiPage = t1a2.data[0]?.OverviewPage ?? '미확인'
  md(`| MSI 2016 OverviewPage | \`${msiPage}\` |`)

  // LCK 2016 Summer Playoffs OverviewPage
  md(`| LCK 2016 Summer Playoffs OverviewPage | \`${lckPlayoffsPage || '미확인'}\` |`)

  // TournamentResults 가용 여부
  const trWorks = fieldSteps.some((f, i) => {
    // fieldSteps index 0 = 'Team'만
    return false // 실제 결과는 위 루프에서 확인
  })
  md(`| TournamentResults no-WHERE | 위 T1-B 결과 참조 |`)

  // LCS 2020 League
  const lcs2020League = s1lcs.data.length > 0
    ? [...new Set(s1lcs.data.map(r => r.League))].join(', ')
    : '미확인'
  md(`| LCS 2020 League 값 | \`${lcs2020League}\` |`)

  // LTA North 2025 League
  const ltaNorthLeague = s1lta.data.length > 0
    ? [...new Set(s1lta.data.map(r => r.League))].join(', ')
    : '미확인'
  md(`| LTA North 2025 League 값 | \`${ltaNorthLeague}\` |`)

  md('')
  md('**다음 단계**: 위 결과를 호빈이 검토 후 discovery.md 승인 → Phase 1 착수.')
  md('')

  // 저장
  fs.writeFileSync(outPath, lines.join('\n'), 'utf-8')
  process.stdout.write(`\n✅ discovery.md 갱신 완료: ${outPath}\n`)
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err}\n`)
  process.exit(1)
})
