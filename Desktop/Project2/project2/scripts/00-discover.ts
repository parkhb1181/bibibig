/**
 * Phase 0 — Cargo 스키마 검증 (§2 A~G + 보완 S1~S4)
 * 이 스크립트 한정 자체 최소 fetch 사용 (1초 스로틀 + UA).
 * 결과 → pipeline-cache/discovery.md
 */
import fs from 'fs'
import path from 'path'

const BASE = 'https://lol.fandom.com/api.php'
// HTTP headers must be ASCII-only (Node fetch ByteString constraint)
const UA = 'AllTimeDraftBot/1.0 (personal fan project; parkhb1181@gmail.com)'
const THROTTLE_MS = 1100

let lastCallAt = 0

async function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms))
}

async function apiFetch(url: string, redirectMode: RequestRedirect = 'follow'): Promise<Response> {
  const wait = THROTTLE_MS - (Date.now() - lastCallAt)
  if (wait > 0) await sleep(wait)
  lastCallAt = Date.now()
  return fetch(url, { headers: { 'User-Agent': UA }, redirect: redirectMode })
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
        process.stdout.write(`  ⏳ ratelimited — waiting ${wait / 1000}s...\n`)
        await sleep(wait)
        continue
      }
      return { data: [], error: json.error }
    }
    return { data: (json.cargoquery ?? []).map(r => r.title) }
  }
  return { data: [], error: 'ratelimited after retries' }
}

// ──────────────────────────────────────────────
async function main() {
  const cacheDir = path.join(process.cwd(), 'pipeline-cache')
  fs.mkdirSync(cacheDir, { recursive: true })

  const lines: string[] = []
  const md = (...args: unknown[]) => {
    const s = args.join(' ')
    process.stdout.write(s + '\n')
    lines.push(s)
  }

  md('# pipeline-cache/discovery.md')
  md('')
  md(`**생성일시**: ${new Date().toISOString()}`)
  md(`**User-Agent**: \`${UA}\``)
  md('')

  // ═══════════════════════════════════════════
  // A — 테이블 목록
  // ═══════════════════════════════════════════
  md('---')
  md('## A. 테이블 목록')
  md('URL: https://lol.fandom.com/wiki/Special:CargoTables')
  md('(브라우저로 직접 확인. 스크립트는 B~G + S1~S4로 사용 테이블을 검증)')
  md('')

  // ═══════════════════════════════════════════
  // B — Tournaments 기본 쿼리
  // ═══════════════════════════════════════════
  md('---')
  md('## B. Tournaments 테이블')
  process.stdout.write('[B] Tournaments (LCK 2016)...\n')
  const b = await cargo({
    tables: 'Tournaments',
    fields: 'Name,OverviewPage,Year,League,Region,DateStart,SplitNumber,IsQualifier,IsPlayoffs',
    where: 'Year=2016 AND League="LCK"',
    limit: '10',
  })

  if (b.error) {
    md('**상태**: 실패')
    md(`**에러**: \`${JSON.stringify(b.error)}\``)
    md('⛔ B 실패 — 파이프라인 진행 불가. 보고 후 대기.')
  } else {
    md(`**상태**: 성공 (${b.data.length}행)`)
    md('**채택 필드**: Name, OverviewPage, Year, League, Region, DateStart, SplitNumber, IsQualifier, IsPlayoffs')
    if (b.data.length > 0) {
      md('```json')
      md(JSON.stringify(b.data[0], null, 2))
      md('```')
    } else {
      md('(0행 — League 실제 값이 "LCK"와 다를 가능성. S1에서 확정)')
    }
  }
  md('')

  // ═══════════════════════════════════════════
  // S1 — League 실제 값 확정 (보완 지시 1)
  // ═══════════════════════════════════════════
  md('---')
  md('## S1. League 실제 값 확정 — 4리그 × 시대별 매핑')
  md('(§4.2 Phase 0 산출물. Year=2016/2020/2025 각 limit=500)')
  md('')

  const leaguesByYear: Record<string, string[]> = {}

  for (const year of [2016, 2020, 2025]) {
    process.stdout.write(`[S1] Tournaments Year=${year}...\n`)
    const s1y = await cargo({
      tables: 'Tournaments',
      fields: 'Name,League,Year',
      where: `Year=${year}`,
      limit: '500',
    })

    md(`### Year ${year}`)
    if (s1y.error) {
      md(`**상태**: 실패 — \`${JSON.stringify(s1y.error)}\``)
    } else {
      const leagues = [...new Set(s1y.data.map(r => r.League).filter(Boolean))].sort()
      leaguesByYear[String(year)] = leagues
      md(`**상태**: 성공 (${s1y.data.length}개 대회, 고유 League 값 ${leagues.length}개)`)
      md('**고유 League 값 목록**:')
      md('```')
      leagues.forEach(l => md(`  "${l}"`))
      md('```')
      md('**샘플 행 (3건)**:')
      md('```json')
      md(JSON.stringify(s1y.data.slice(0, 3), null, 2))
      md('```')
    }
    md('')
  }

  // 4리그 × 시대별 매핑 표 빌드
  md('### S1 결론 — 4리그 시대별 표기 매핑')
  md('')
  md('아래 표는 수집된 League 값에서 패턴 매칭으로 도출한 후보. **호빈 확정 필요**.')
  md('')
  md('| 리그 | 시대 | 실제 League 값 (추정) | 비고 |')
  md('|---|---|---|---|')

  // Pattern matching helper
  const allLeagues = Object.values(leaguesByYear).flat()
  const unique = [...new Set(allLeagues)].sort()

  const lck   = unique.filter(l => /LCK|Champions Korea|LCK/i.test(l) && !/LPL|LCS|LEC/i.test(l))
  const lpl   = unique.filter(l => /LPL/i.test(l))
  const lec   = unique.filter(l => /LEC/i.test(l) && !/LCS/i.test(l))
  const euLcs = unique.filter(l => /EU LCS|EULCS/i.test(l))
  const lcs   = unique.filter(l => /\bLCS\b/i.test(l) && !/EU|LEC/i.test(l))
  const ltaN  = unique.filter(l => /LTA|Americas/i.test(l))

  md(`| LCK | 2013~현재 | ${lck.join(', ') || '(S1 수집 후 확인)'} | 한국 리그 |`)
  md(`| LPL | 2013~현재 | ${lpl.join(', ') || '(S1 수집 후 확인)'} | 중국 리그 |`)
  md(`| EU LCS | 2013~2018 | ${euLcs.join(', ') || '(S1 수집 후 확인)'} | 유럽 구 명칭 |`)
  md(`| LEC | 2019~현재 | ${lec.join(', ') || '(S1 수집 후 확인)'} | 유럽 신 명칭 |`)
  md(`| NA LCS / LCS | 2013~2024 | ${lcs.join(', ') || '(S1 수집 후 확인)'} | 북미 리그 |`)
  md(`| LTA North | 2025~ | ${ltaN.join(', ') || '(S1 수집 후 확인)'} | 북미 2025~ |`)
  md('')
  md('**전체 고유 League 값 (중복 제거, 시대 합산)**:')
  md('```')
  unique.forEach(l => md(`  "${l}"`))
  md('```')
  md('')

  // ═══════════════════════════════════════════
  // C — ScoreboardPlayers
  // ═══════════════════════════════════════════
  md('---')
  md('## C. ScoreboardPlayers 테이블')
  process.stdout.write('[C] ScoreboardPlayers...\n')
  const c = await cargo({
    tables: 'ScoreboardPlayers',
    fields: 'Link,Team,Role,OverviewPage,GameId,Champion',
    where: 'OverviewPage LIKE "LCK/2016%"',
    limit: '10',
  })

  if (c.error) {
    md('**상태**: 실패')
    md(`**에러**: \`${JSON.stringify(c.error)}\``)
    md('⛔ C 실패 — 로스터 도출 불가. 보고 후 대기.')
  } else {
    md(`**상태**: 성공 (${c.data.length}행)`)
    md('**채택 필드**: Link, Team, Role, OverviewPage, GameId, Champion')
    md('')
    md('```json')
    md(JSON.stringify(c.data[0] ?? null, null, 2))
    md('```')
  }
  md('')

  // ═══════════════════════════════════════════
  // D — 순위 테이블 탐색 (D1~D3 원본 + D4·D5 보완)
  // ═══════════════════════════════════════════
  md('---')
  md('## D. 순위 테이블 탐색')
  let rankTable = ''
  let rankFields: string[] = []

  // D.1 — TournamentResults with WHERE
  process.stdout.write('[D.1] TournamentResults (WHERE LCK/2016%)...\n')
  md('### D.1 TournamentResults (1순위, WHERE 포함)')
  const d1 = await cargo({
    tables: 'TournamentResults',
    fields: 'Team,Place,OverviewPage,Wins,Losses',
    where: 'OverviewPage LIKE "LCK/2016%"',
    limit: '10',
  })

  if (!d1.error && d1.data.length > 0) {
    rankTable = 'TournamentResults'
    rankFields = Object.keys(d1.data[0])
    md(`**상태**: 성공 (${d1.data.length}행)`)
    md('```json')
    md(JSON.stringify(d1.data[0], null, 2))
    md('```')
    md('**→ 채택: TournamentResults**')
  } else {
    md(`**상태**: 실패/0행 — \`${JSON.stringify(d1.error ?? '0행')}\``)

    // D.2 — Standings
    process.stdout.write('[D.2] Standings (WHERE LCK/2016%)...\n')
    md('')
    md('### D.2 Standings (2순위)')
    const d2 = await cargo({
      tables: 'Standings',
      fields: 'Team,Place,OverviewPage',
      where: 'OverviewPage LIKE "LCK/2016%"',
      limit: '10',
    })

    if (!d2.error && d2.data.length > 0) {
      rankTable = 'Standings'
      rankFields = Object.keys(d2.data[0])
      md(`**상태**: 성공 (${d2.data.length}행)`)
      md('```json')
      md(JSON.stringify(d2.data[0], null, 2))
      md('```')
      md('**→ 채택: Standings**')
    } else {
      md(`**상태**: 실패/0행 — \`${JSON.stringify(d2.error ?? '0행')}\``)

      // D.3 — TournamentResults with N field
      process.stdout.write('[D.3] TournamentResults (N field)...\n')
      md('')
      md('### D.3 TournamentResults — N 필드 변형')
      const d3 = await cargo({
        tables: 'TournamentResults',
        fields: 'Team,N,OverviewPage',
        where: 'OverviewPage LIKE "LCK/2016%"',
        limit: '10',
      })

      if (!d3.error && d3.data.length > 0) {
        rankTable = 'TournamentResults'
        rankFields = Object.keys(d3.data[0])
        md(`**상태**: 성공 (${d3.data.length}행) — Place = N`)
        md('```json')
        md(JSON.stringify(d3.data[0], null, 2))
        md('```')
        md('**→ 채택: TournamentResults (Place 필드 = N)**')
      } else {
        md(`**상태**: 실패 — \`${JSON.stringify(d3.error ?? '0행')}\``)
        md('⛔ D.1~D.3 전부 실패. D.4 보완 시도 후 판단.')
      }
    }
  }
  md('')

  // ── D.4 — TournamentResults WHERE 없이 재시도 (보완 지시 2) ──
  process.stdout.write('[D.4] TournamentResults (WHERE 없음, 보완)...\n')
  md('### D.4 TournamentResults — WHERE 없이 재시도 (보완 지시 S2)')
  const d4 = await cargo({
    tables: 'TournamentResults',
    fields: 'Team,Place,OverviewPage',
    limit: '5',
  })

  let d4Success = false
  if (!d4.error && d4.data.length > 0) {
    d4Success = true
    md(`**상태**: 성공 (${d4.data.length}행)`)
    md('```json')
    md(JSON.stringify(d4.data, null, 2))
    md('```')

    const hasPlace = d4.data.some(r => (r.Place ?? '') !== '')
    const hasOvP   = d4.data.some(r => (r.OverviewPage ?? '') !== '')
    md(`Place 필드 유효값 존재: ${hasPlace ? '✅' : '❌'}`)
    md(`OverviewPage 필드 존재: ${hasOvP ? '✅' : '❌'}`)
    md('')
    md('**재채택 검토**:')

    if (hasPlace && hasOvP) {
      if (rankTable === 'Standings') {
        md('- TournamentResults는 WHERE 없이 접근 가능. WHERE 포함 시 MWException 발생 패턴.')
        md('- Standings는 이미 LCK 2016 정규시즌 데이터 확인됨.')
        md('- 플옵·Worlds 커버리지 비교가 필요하므로 D.5에서 추가 검증 후 결정.')
        md('**→ D.4 결론: 보류. D.5 결과에 따라 TournamentResults 또는 Standings 최종 확정.**')
      } else if (rankTable === '') {
        rankTable = 'TournamentResults'
        rankFields = Object.keys(d4.data[0])
        md('- D.1~D.3 모두 실패했으나 WHERE 없이 TournamentResults 접근 가능.')
        md('**→ D.4 결론: TournamentResults 채택 (WHERE 없이 사용 — Phase 1에서 WHERE 조건 주의)**')
      } else {
        md('- 이미 채택된 테이블 있음. D.4는 추가 참고 정보.')
      }
    } else {
      md('- Place 또는 OverviewPage 필드 비어 있음. 사용 불가.')
    }
  } else {
    md(`**상태**: 실패/0행 — \`${JSON.stringify(d4.error ?? '0행')}\``)
    md('TournamentResults WHERE 없이도 실패. Standings 사용 확정.')
  }
  md('')

  // ── D.5 — Standings 플옵·Worlds 커버리지 검증 ──
  if (rankTable === 'Standings' || (d4Success && rankTable === 'Standings')) {
    process.stdout.write('[D.5] Standings playoffs coverage...\n')
    md('### D.5 Standings — 플옵·Worlds 커버리지 검증 (보완 지시 S2)')
    md('(레이팅 공식 §4.3 입력 가능성 검증 — 정규시즌 이외 데이터 실재 확인)')
    md('')

    const d5po = await cargo({
      tables: 'Standings',
      fields: 'Team,Place,OverviewPage',
      where: 'OverviewPage LIKE "%Playoffs%"',
      limit: '3',
    })
    md('**플옵 OverviewPage 검증** (`OverviewPage LIKE "%Playoffs%"`):')
    if (!d5po.error && d5po.data.length > 0) {
      md(`상태: ✅ 존재 (${d5po.data.length}행)`)
      md('```json')
      md(JSON.stringify(d5po.data, null, 2))
      md('```')
    } else {
      md(`상태: ❌ 없음 — \`${JSON.stringify(d5po.error ?? '0행')}\``)
      md('⚠️ Standings에 플옵 데이터 없음 — §4.3 레이팅 계산 시 플옵 성적 입력 불가. **멈추고 보고.**')
    }
    md('')

    process.stdout.write('[D.5] Standings Worlds coverage...\n')
    const d5wr = await cargo({
      tables: 'Standings',
      fields: 'Team,Place,OverviewPage',
      where: 'OverviewPage LIKE "Worlds%"',
      limit: '3',
    })
    md('**Worlds OverviewPage 검증** (`OverviewPage LIKE "Worlds%"`):')
    if (!d5wr.error && d5wr.data.length > 0) {
      md(`상태: ✅ 존재 (${d5wr.data.length}행)`)
      md('```json')
      md(JSON.stringify(d5wr.data, null, 2))
      md('```')
    } else {
      md(`상태: ❌ 없음 — \`${JSON.stringify(d5wr.error ?? '0행')}\``)
      md('⚠️ Standings에 Worlds 데이터 없음 — §4.3 Worlds 가점 입력 불가. **멈추고 보고.**')
    }
    md('')

    const d5poOk = !d5po.error && d5po.data.length > 0
    const d5wrOk = !d5wr.error && d5wr.data.length > 0

    if (d5poOk && d5wrOk) {
      md('**→ D.5 결론: Standings에 정규시즌 + 플옵 + Worlds 모두 존재. Standings 최종 확정.**')
    } else if (!d5poOk || !d5wrOk) {
      md('**→ D.5 결론: Standings 커버리지 불완전. 순위 테이블 전략 재검토 필요. 호빈 판단 요청.**')
    }
    md('')
  }

  // ═══════════════════════════════════════════
  // E — Players
  // ═══════════════════════════════════════════
  md('---')
  md('## E. Players 테이블 (Faker 샘플)')
  process.stdout.write('[E] Players(Faker)...\n')
  const e = await cargo({
    tables: 'Players',
    fields: 'ID,Name,NativeName,NameFull,Image,Country,Role',
    where: 'ID="Faker"',
    limit: '1',
  })

  let fakerImage = ''
  if (e.error || e.data.length === 0) {
    md('**상태**: 실패')
    md(`**에러**: \`${JSON.stringify(e.error ?? '0행')}\``)
    md('⛔ E 실패: Players 테이블 조회 실패. 작업 중단 후 보고 필요.')
  } else {
    fakerImage = e.data[0]?.Image ?? ''
    md('**상태**: 성공')
    md('**채택 필드**: ID, Name, NativeName, NameFull, Image, Country, Role')
    md('')
    md('**원시 JSON**:')
    md('```json')
    md(JSON.stringify(e.data[0], null, 2))
    md('```')
    md(`Image 필드 값: \`"${fakerImage}"\` (공란 여부: ${fakerImage === '' ? '✅ 실공란' : '❌ 값 있음'})`)
  }
  md('')

  // ═══════════════════════════════════════════
  // F — 사진 URL (Players.Image 경유 — 공란 시 건너뜀)
  // ═══════════════════════════════════════════
  md('---')
  md('## F. 사진 URL 리다이렉트 확인 (Players.Image 경유)')
  if (!fakerImage) {
    md('Players.Image 공란으로 건너뜀 → F-보완(S3)에서 PlayerImages.FileName으로 검증')
  } else {
    const fpUrl = `https://lol.fandom.com/wiki/Special:Filepath/${encodeURIComponent(fakerImage)}`
    md(`**테스트 URL**: \`${fpUrl}\``)
    process.stdout.write(`[F] Filepath via Players.Image...\n`)
    try {
      const fRes = await apiFetch(fpUrl, 'manual')
      md(`**응답 코드**: ${fRes.status}`)
      md(`**Location**: ${fRes.headers.get('location') ?? '(없음)'}`)
      if (fRes.status === 301 || fRes.status === 302) {
        md('**상태**: ✅ 302/301 확인')
      } else {
        md(`**상태**: ⚠️ 코드 ${fRes.status}`)
      }
    } catch (e2) {
      md(`**상태**: 오류 — ${e2 instanceof Error ? e2.message : String(e2)}`)
    }
  }
  md('')

  // ═══════════════════════════════════════════
  // G — PlayerImages / Plan B allimages
  // ═══════════════════════════════════════════
  md('---')
  md('## G. 시즌별 선수 사진 테이블')
  process.stdout.write('[G.1] PlayerImages...\n')
  md('### G.1 PlayerImages 테이블')
  const g1 = await cargo({
    tables: 'PlayerImages',
    fields: 'FileName,Link,Team,Tournament,SortDate',
    where: 'Link="Faker"',
    limit: '5',
  })

  let g1FileName = ''
  if (!g1.error && g1.data.length > 0) {
    g1FileName = g1.data[0].FileName ?? ''
    md(`**상태**: ✅ 존재 (${g1.data.length}행 for Faker)`)
    md('**채택 필드**: FileName, Link, Team, Tournament, SortDate')
    md('```json')
    md(JSON.stringify(g1.data, null, 2))
    md('```')
    md('**→ G 결론: PlayerImages 테이블 채택**')
  } else {
    md(`**상태**: 없음/실패 — \`${JSON.stringify(g1.error ?? '0행')}\``)
    md('')
    process.stdout.write('[G.2] Plan B allimages...\n')
    md('### G.2 Plan B — MediaWiki allimages API')
    const planBUrl = `${BASE}?action=query&list=allimages&aiprefix=Faker&ailimit=10&format=json`
    md(`**URL**: \`${planBUrl}\``)
    try {
      const g2res = await apiFetch(planBUrl)
      if (g2res.ok) {
        const g2j: { query?: { allimages?: { name: string; url: string; timestamp?: string }[] } } =
          await g2res.json()
        const g2data = g2j?.query?.allimages ?? []
        md(`**상태**: ✅ allimages 성공 (${g2data.length}건)`)
        if (g2data.length > 0) {
          g1FileName = g2data[0].name
          md('**파일명 패턴**:')
          md('```')
          g2data.slice(0, 5).forEach(i => md(`  ${i.name}`))
          md('```')
          md('```json')
          md(JSON.stringify(g2data[0], null, 2))
          md('```')
          md('**→ G 결론: Plan B allimages 채택**')
        } else {
          md('결과 없음 → Players.Image 폴백')
        }
      } else {
        md(`HTTP ${g2res.status} → Players.Image 폴백`)
      }
    } catch (e3) {
      md(`오류 — ${e3 instanceof Error ? e3.message : String(e3)} → Players.Image 폴백`)
    }
  }
  md('')

  // ═══════════════════════════════════════════
  // F-보완 (S3) — PlayerImages.FileName으로 Filepath 검증
  // ═══════════════════════════════════════════
  md('---')
  md('## F-보완 (S3). Special:Filepath 최종 검증 — PlayerImages.FileName 사용')
  md('(공백·특수문자 encodeURIComponent 적용 확인 포함)')
  md('')

  const testFile = g1FileName || 'Faker Summer 2016.png'
  const fpUrl2 = `https://lol.fandom.com/wiki/Special:Filepath/${encodeURIComponent(testFile)}`
  md(`**테스트 파일명**: \`${testFile}\``)
  md(`**원본 파일명 encodeURIComponent 결과**: \`${encodeURIComponent(testFile)}\``)
  md(`**요청 URL**: \`${fpUrl2}\``)
  process.stdout.write(`[F-S3] Filepath "${testFile}"...\n`)

  try {
    const fRes2 = await apiFetch(fpUrl2, 'manual')
    const loc2 = fRes2.headers.get('location') ?? fRes2.headers.get('Location') ?? ''
    md(`**응답 코드**: ${fRes2.status}`)
    md(`**Location 헤더**: \`${loc2 || '(없음)'}\``)

    if (fRes2.status === 301 || fRes2.status === 302) {
      md('**상태**: ✅ 302/301 리다이렉트 확인 — Special:Filepath 방식 사용 가능')
      md(`**최종 이미지 URL**: \`${loc2}\``)
      md('→ Phase 2 이미지 다운로드: `Special:Filepath/{encodeURIComponent(FileName)}` → Location follow로 다운로드')
    } else if (fRes2.status === 200) {
      md(`**상태**: ✅ 200 직접 응답 (Content-Type: ${fRes2.headers.get('content-type') ?? '?'})`)
    } else {
      md(`**상태**: ⚠️ 예상 외 코드 ${fRes2.status}`)
    }
  } catch (e4) {
    md(`**상태**: 오류 — ${e4 instanceof Error ? e4.message : String(e4)}`)
  }
  md('')

  // ═══════════════════════════════════════════
  // S4 — E 재확인 + PlayerImages 전수 필드 덤프
  // ═══════════════════════════════════════════
  md('---')
  md('## S4. E 재확인 + PlayerImages 전수 필드 덤프 (보완 지시 4)')
  md('')

  // S4.1 — Players.Image 공란 재확인 (다른 선수 교차검증)
  md('### S4.1 Players.Image 공란 재확인')
  md('(Faker Image 공란이 파싱 누락인지 실공란인지 교차검증)')
  process.stdout.write('[S4.1] Players Image != ""...\n')
  const s4e = await cargo({
    tables: 'Players',
    fields: 'ID,Image',
    where: 'Image IS NOT NULL AND Image != ""',
    limit: '3',
  })
  if (!s4e.error && s4e.data.length > 0) {
    md(`**상태**: ✅ Image 필드에 값이 있는 선수 ${s4e.data.length}건 존재`)
    md('```json')
    md(JSON.stringify(s4e.data, null, 2))
    md('```')
    md('**→ 결론: Players.Image는 일부 선수에게 값이 있음. Faker는 실제 공란 (파싱 오류 아님).**')
    md('Phase 2는 PlayerImages 우선, Players.Image는 폴백으로 사용.')
  } else {
    md(`**상태**: ${s4e.error ? `실패 — \`${JSON.stringify(s4e.error)}\`` : 'Players.Image 전체 공란'}`)
    md('**→ 결론: Players.Image 전부 공란 — PlayerImages 테이블만 사용.**')
  }
  md('')

  // S4.2 — PlayerImages 전수 필드 덤프 (cargofields API 시도)
  md('### S4.2 PlayerImages 전수 필드 덤프')
  process.stdout.write('[S4.2] cargofields PlayerImages...\n')
  const cfUrl = `${BASE}?action=cargofields&table=PlayerImages&format=json`
  md(`**cargofields URL**: \`${cfUrl}\``)

  let piAllFields: string[] = []
  try {
    const cfRes = await apiFetch(cfUrl)
    if (cfRes.ok) {
      const cfJson: { cargofields?: Record<string, { type: string }> } = await cfRes.json()
      if (cfJson.cargofields) {
        piAllFields = Object.keys(cfJson.cargofields)
        md(`**상태**: ✅ cargofields 성공 — PlayerImages 필드 ${piAllFields.length}개`)
        md('```json')
        md(JSON.stringify(cfJson.cargofields, null, 2))
        md('```')
      } else {
        md(`**상태**: 응답 있으나 cargofields 키 없음`)
        md('```json')
        md(JSON.stringify(cfJson, null, 2))
        md('```')
      }
    } else {
      md(`**상태**: HTTP ${cfRes.status} — cargofields 미지원 가능성`)
    }
  } catch (e5) {
    md(`**cargofields 오류**: ${e5 instanceof Error ? e5.message : String(e5)}`)
  }

  // 폴백: 확장 필드명으로 cargoquery
  md('')
  md('**확장 필드 쿼리 (폴백 — 잠재적 날짜성 필드 포함)**:')
  process.stdout.write('[S4.2] PlayerImages extended fields...\n')
  const s4g2 = await cargo({
    tables: 'PlayerImages',
    fields: 'FileName,Link,Team,Tournament,SortDate,Year,Date,Split,IsHistorical',
    where: 'Link="Faker"',
    limit: '3',
  })

  if (!s4g2.error && s4g2.data.length > 0) {
    const actualFields = Object.keys(s4g2.data[0])
    piAllFields = piAllFields.length > 0 ? piAllFields : actualFields
    md(`**상태**: 성공 — 실재 필드: ${actualFields.join(', ')}`)
    md('```json')
    md(JSON.stringify(s4g2.data, null, 2))
    md('```')

    const dateFields = actualFields.filter(f =>
      /date|year|time|sort/i.test(f) && f !== 'SortDate__precision'
    )
    md(`날짜성 필드: ${dateFields.length > 0 ? dateFields.join(', ') : '없음 (SortDate 공란 포함)'}`)
  } else {
    md(`**상태**: ${s4g2.error ? `실패 — \`${JSON.stringify(s4g2.error)}\`` : '0행'}`)
  }
  md('')

  // S4.3 — 정렬 규칙 확정 후보
  md('### S4.3 PlayerImages 정렬 규칙 확정 후보')
  md('(SortDate 공란인 경우 — 호빈 승인 후 CURSOR_GUIDE 반영)')
  md('')
  const hasSortDate = s4g2.data.some(r => (r.SortDate ?? '') !== '')
  if (hasSortDate) {
    md('SortDate 유효값 존재 → SortDate 내림차순 정렬 사용 가능.')
  } else {
    md('SortDate 전부 공란 → 아래 정렬 규칙 후보를 확정 후보로 기록:')
    md('')
    md('```')
    md('정렬 규칙 후보 (Tournament 연도 파싱 기반):')
    md('1. Tournament 필드에서 연도 정규식 추출')
    md('   예: "LCK/2016 Season/Summer Season" → 2016')
    md('       "Champions/2015 Season/Spring Season" → 2015')
    md('2. 연도 내림차순 (최신 우선)')
    md('3. 동일 연도 내: FileName 오름차순 (알파벳 — 결정론 보장)')
    md('4. Tournament 공란 행 = 연도 미상 → 최하순위')
    md('')
    md('§5 매칭 우선순위 구현:')
    md('① 같은 Team + 같은 파싱 연도')
    md('② 같은 Team + 최근접 파싱 연도')
    md('③ Players.Image (폴백)')
    md('④ 이니셜+팀컬러 아바타 (최종 폴백)')
    md('```')
  }
  md('')

  // ═══════════════════════════════════════════
  // 최종 요약
  // ═══════════════════════════════════════════
  md('---')
  md('## 채택 테이블·필드 목록 (최종)')
  md('')
  md('| 테이블 | 채택 필드 | 용도 |')
  md('|---|---|---|')
  md('| Tournaments | Name, OverviewPage, Year, League, Region, DateStart, SplitNumber, IsQualifier, IsPlayoffs | 대회 목록 |')
  md('| ScoreboardPlayers | Link, Team, Role, OverviewPage, GameId, Champion | 로스터 도출 |')
  md(`| ${rankTable || '⚠️ 미결정'} | ${rankFields.join(', ') || '—'} | 순위 수집 |`)
  md('| Players | ID, Name, NativeName, NameFull, Image, Country, Role | 선수 메타 |')
  md('| PlayerImages | FileName, Link, Team, Tournament, SortDate | 시즌별 사진 |')
  md('')
  md('## 순위 테이블 결정')
  md(`채택: **${rankTable || '⚠️ D 실패 — 결정 불가'}**`)
  md(`채택 필드: ${rankFields.join(', ') || '—'}`)
  md('')
  md('## 4리그 League 값 매핑 (최종 — Phase 1 하드코딩 기준)')
  md('(S1 수집값 기반. 호빈 확정 후 Phase 1 LEAGUES 상수에 반영)')
  md('')
  md('| 리그 코드 | 시대 | Leaguepedia League 값 |')
  md('|---|---|---|')
  const y16 = leaguesByYear['2016'] ?? []
  const y20 = leaguesByYear['2020'] ?? []
  const y25 = leaguesByYear['2025'] ?? []
  md(`| LCK | 2013~ | ${[...new Set([...y16, ...y20, ...y25])].filter(l => /lck|champions korea/i.test(l)).join(', ') || '(S1 실행 후 확인)'} |`)
  md(`| LPL | 2013~ | ${[...new Set([...y16, ...y20, ...y25])].filter(l => /lpl/i.test(l)).join(', ') || '(S1 실행 후 확인)'} |`)
  md(`| EU LCS / LEC | 2013~2018 / 2019~ | ${[...new Set([...y16, ...y20, ...y25])].filter(l => /eu lcs|eulcs|lec/i.test(l)).join(', ') || '(S1 실행 후 확인)'} |`)
  md(`| NA LCS / LCS / LTA | 2013~2024 / 2025 | ${[...new Set([...y16, ...y20, ...y25])].filter(l => /na lcs|nalcs|\blcs\b|lta/i.test(l)).join(', ') || '(S1 실행 후 확인)'} |`)
  md('')
  md('## 샘플 응답 JSON 5건')
  md('')
  md('### 샘플 1 — Tournaments (LCK 2016, limit=10)')
  md('```json')
  md(JSON.stringify(b.data.slice(0, 2), null, 2))
  md('```')
  md('')
  md('### 샘플 2 — ScoreboardPlayers (LCK/2016%)')
  md('```json')
  md(JSON.stringify(c.data.slice(0, 2), null, 2))
  md('```')
  md('')
  md(`### 샘플 3 — ${rankTable || '순위 테이블 미결정'} (D2 Standings)`)
  md('```json')
  md(JSON.stringify(d1.data.length > 0 ? d1.data.slice(0, 2) : [], null, 2))
  md('```')
  md('')
  md('### 샘플 4 — Players (Faker)')
  md('```json')
  md(JSON.stringify(e.data.slice(0, 1), null, 2))
  md('```')
  md('')
  md('### 샘플 5 — PlayerImages (Faker, 5건)')
  md('```json')
  md(JSON.stringify(g1.data.slice(0, 2), null, 2))
  md('```')

  // 저장
  const outPath = path.join(cacheDir, 'discovery.md')
  fs.writeFileSync(outPath, lines.join('\n'), 'utf-8')
  process.stdout.write(`\n✅ discovery.md 저장 완료: ${outPath}\n`)

  // D·E 실패 시 exit 1 (§2 DoD)
  if (!rankTable) {
    process.stderr.write('\n🛑 D 실패: 순위 테이블 미발견. 호빈 보고 후 대기.\n')
    process.exit(1)
  }
  if (e.error || e.data.length === 0) {
    process.stderr.write('\n🛑 E 실패: Players 테이블 조회 실패. 호빈 보고 후 대기.\n')
    process.exit(1)
  }

  process.stdout.write('\n✅ Phase 0 검증 완료 — discovery.md를 호빈이 승인 후 Phase 1 착수.\n')
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err}\n`)
  process.exit(1)
})
