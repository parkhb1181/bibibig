/**
 * Phase 0 보완 — TournamentResults WHERE 범위 테스트 (0-a ~ 0-d)
 * 호빈 판단(2026-06-10): intl-results.csv 기각, WHERE 점증 테스트 우선
 * THROTTLE_MS=3000 (쿼리 간 3초 간격)
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

  process.stdout.write(`  URL: ${u.toString()}\n`)

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

  const existing = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf-8') : ''
  const lines: string[] = existing ? existing.trimEnd().split('\n') : []

  const md = (...args: unknown[]) => {
    const s = args.join(' ')
    process.stdout.write(s + '\n')
    lines.push(s)
  }

  md('')
  md('---')
  md(`## WHERE 테스트 추가 (${new Date().toISOString()})`)
  md('(호빈 판단: intl-results.csv 기각 → TournamentResults WHERE 점증 테스트)')
  md('')

  // ─────────────────────────────────────────────
  // 0-a: Date 범위 WHERE
  // ─────────────────────────────────────────────
  md('---')
  md('## 0-a. TournamentResults WHERE Date 범위')
  md('`fields=Team,Place,OverviewPage, where=Date >= "2016-01-01" AND Date <= "2016-12-31", limit=3`')
  md('')

  process.stdout.write('[0-a] TournamentResults WHERE Date 범위...\n')
  const qa = await cargo({
    tables: 'TournamentResults',
    fields: 'Team,Place,OverviewPage',
    where: 'Date >= "2016-01-01" AND Date <= "2016-12-31"',
    limit: '3',
  })

  if (qa.error) {
    md(`**상태**: 실패 — \`${JSON.stringify(qa.error)}\``)
  } else {
    md(`**상태**: 성공 (${qa.data.length}행)`)
    md('```json')
    md(JSON.stringify(qa.data, null, 2))
    md('```')
  }
  md('')

  // ─────────────────────────────────────────────
  // 0-b: OverviewPage 정확 일치 WHERE
  // ─────────────────────────────────────────────
  md('---')
  md('## 0-b. TournamentResults WHERE OverviewPage 정확 일치')
  md('`where=OverviewPage="2016 Season World Championship"` — Place 형식 확인 (범위 표기 여부)')
  md('')

  process.stdout.write('[0-b] TournamentResults WHERE OverviewPage="2016 Season World Championship"...\n')
  const qb = await cargo({
    tables: 'TournamentResults',
    fields: 'Team,Place,OverviewPage',
    where: 'OverviewPage="2016 Season World Championship"',
    limit: '10',
  })

  if (qb.error) {
    md(`**상태**: 실패 — \`${JSON.stringify(qb.error)}\``)
    md('→ 0-b 실패. 0-a 결과에 따라 Date 범위 청크 전략 사용.')
  } else {
    md(`**상태**: 성공 (${qb.data.length}행)`)
    md('```json')
    md(JSON.stringify(qb.data, null, 2))
    md('```')

    // Place 형식 분석
    const places = [...new Set(qb.data.map(r => r.Place))].sort()
    md('')
    md(`**Place 값 고유 목록**: ${places.map(p => `\`"${p}"\``).join(', ')}`)
    md('(범위 표기: "3-4"·"5-8" 형식이 있으면 파서가 필요)')
  }
  md('')

  // ─────────────────────────────────────────────
  // 0-c: OverviewPage LIKE WHERE
  // ─────────────────────────────────────────────
  md('---')
  md('## 0-c. TournamentResults WHERE OverviewPage LIKE "LCK/2016%"')
  md('LCK/2016 Season/Summer Playoffs의 Place=1 팀명 기록 (기대: SKT T1)')
  md('')

  process.stdout.write('[0-c] TournamentResults WHERE OverviewPage LIKE "LCK/2016%"...\n')
  const qc = await cargo({
    tables: 'TournamentResults',
    fields: 'Team,Place,OverviewPage',
    where: 'OverviewPage LIKE "LCK/2016%"',
    orderby: 'OverviewPage ASC, Place ASC',
    limit: '20',
  })

  if (qc.error) {
    md(`**상태**: 실패 — \`${JSON.stringify(qc.error)}\``)
  } else {
    md(`**상태**: 성공 (${qc.data.length}행)`)
    md('```json')
    md(JSON.stringify(qc.data, null, 2))
    md('```')

    // 의미 검증
    const summerPlayoff1 = qc.data.find(
      r => r.OverviewPage === 'LCK/2016 Season/Summer Playoffs' && r.Place === '1'
    )
    if (summerPlayoff1) {
      md('')
      md(`**LCK 2016 Summer Playoffs Place=1**: \`${summerPlayoff1.Team}\``)
      md(summerPlayoff1.Team === 'SKT T1'
        ? '✅ 기대값 일치 (SKT T1)'
        : `⚠️ 기대값 불일치 — 예상: "SKT T1", 실제: "${summerPlayoff1.Team}"`)
    } else {
      md('')
      md('⚠️ LCK/2016 Season/Summer Playoffs Place=1 행 없음')
    }
  }
  md('')

  // ─────────────────────────────────────────────
  // 0-d: 정규시즌 순위 소스 확정
  // TournamentResults vs Standings — LCK 2016 Summer Season
  // ─────────────────────────────────────────────
  md('---')
  md('## 0-d. 정규시즌 순위 소스 확정')
  md('`OverviewPage="LCK/2016 Season/Summer Season"` — TournamentResults vs Standings 비교')
  md('')

  // 0-d-TR
  process.stdout.write('[0-d-TR] TournamentResults WHERE OverviewPage="LCK/2016 Season/Summer Season"...\n')
  const qdTR = await cargo({
    tables: 'TournamentResults',
    fields: 'Team,Place,OverviewPage',
    where: 'OverviewPage="LCK/2016 Season/Summer Season"',
    orderby: 'Place ASC',
    limit: '20',
  })

  md('### 0-d-1. TournamentResults')
  if (qdTR.error) {
    md(`**상태**: 실패 — \`${JSON.stringify(qdTR.error)}\``)
  } else {
    md(`**상태**: 성공 (${qdTR.data.length}행)`)
    if (qdTR.data.length > 0) {
      md('```json')
      md(JSON.stringify(qdTR.data, null, 2))
      md('```')
    } else {
      md('(0행 — 정규 순위 데이터 없음)')
    }
  }
  md('')

  // 0-d-ST
  process.stdout.write('[0-d-ST] Standings WHERE OverviewPage="LCK/2016 Season/Summer Season"...\n')
  const qdST = await cargo({
    tables: 'Standings',
    fields: 'Team,Place,OverviewPage',
    where: 'OverviewPage="LCK/2016 Season/Summer Season"',
    orderby: 'Place ASC',
    limit: '20',
  })

  md('### 0-d-2. Standings')
  if (qdST.error) {
    md(`**상태**: 실패 — \`${JSON.stringify(qdST.error)}\``)
  } else {
    md(`**상태**: 성공 (${qdST.data.length}행)`)
    if (qdST.data.length > 0) {
      md('```json')
      md(JSON.stringify(qdST.data, null, 2))
      md('```')
    } else {
      md('(0행 — 정규 순위 데이터 없음)')
    }
  }
  md('')

  // 0-d 결론
  md('### 0-d 결론 — 정규시즌 순위 소스')
  const trHasRegular = !qdTR.error && qdTR.data.length > 0
  const stHasRegular = !qdST.error && qdST.data.length > 0

  if (trHasRegular) {
    md('**채택: TournamentResults** — Place 1~10위 데이터 존재')
  } else if (stHasRegular) {
    md('**채택: Standings** — TournamentResults 미커버, Standings 데이터 존재')
  } else {
    md('**미결**: 양쪽 모두 0행 — 멈추고 호빈 보고')
  }
  md('')

  // ─────────────────────────────────────────────
  // 최종 판정
  // ─────────────────────────────────────────────
  md('---')
  md('## 0-a~0-d 종합 판정')
  md('')

  const bSuccess = !qb.error && qb.data.length > 0
  const aSuccess = !qa.error && qa.data.length > 0

  if (bSuccess) {
    md('**결과: 0-b 성공** → TournamentResults WHERE 정상 작동 확인')
    md('→ 순위 소스 확정 완료. **Phase 1 착수 조건 충족.**')
    md('')
    md('**복합 순위 소스 최종 확정:**')
    md('- 플옵·Worlds·MSI 순위 = TournamentResults (WHERE OverviewPage= 또는 LIKE)')
    md('- 정규시즌 순위 = ' + (trHasRegular ? 'TournamentResults' : stHasRegular ? 'Standings' : '미결'))
  } else if (aSuccess) {
    md('**결과: 0-b 실패, 0-a 성공** → Date 범위 청크 수집 + 로컬 필터 전략')
    md('→ Phase 1 착수 가능. 03-results.ts는 연도 단위 청크(Date >= / <=)로 전체 수집 후 로컬 필터.')
  } else {
    md('**결과: 0-a·0-b 모두 실패** → 멈추고 호빈 보고 필요')
  }
  md('')

  // 저장
  fs.writeFileSync(outPath, lines.join('\n'), 'utf-8')
  process.stdout.write(`\n✅ discovery.md 갱신 완료: ${outPath}\n`)

  // 판정 요약 출력
  process.stdout.write('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  process.stdout.write('0-a~0-d 결과 요약\n')
  process.stdout.write('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  process.stdout.write(`0-a (Date 범위): ${qa.error ? '실패' : `성공 ${qa.data.length}행`}\n`)
  process.stdout.write(`0-b (OverviewPage 정확): ${qb.error ? '실패' : `성공 ${qb.data.length}행`}\n`)
  process.stdout.write(`0-c (OverviewPage LIKE): ${qc.error ? '실패' : `성공 ${qc.data.length}행`}\n`)
  process.stdout.write(`0-d TournamentResults: ${qdTR.error ? '실패' : `성공 ${qdTR.data.length}행`}\n`)
  process.stdout.write(`0-d Standings: ${qdST.error ? '실패' : `성공 ${qdST.data.length}행`}\n`)
  process.stdout.write('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  if (bSuccess) {
    process.stdout.write('✅ 0-b 성공 → Phase 1 착수 조건 충족\n')
  } else if (aSuccess) {
    process.stdout.write('⚠️ 0-b 실패, 0-a 성공 → Date 청크 전략으로 Phase 1 착수\n')
  } else {
    process.stdout.write('❌ 0-a·0-b 실패 → 멈추고 호빈 보고\n')
  }
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err}\n`)
  process.exit(1)
})
