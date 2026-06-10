/**
 * Phase 0 — Cargo 스키마 검증 (§2 A~G)
 * 이 스크립트 한정 자체 최소 fetch 사용 (1초 스로틀 + UA).
 * 결과 → pipeline-cache/discovery.md
 */
import fs from 'fs'
import path from 'path'

const BASE = 'https://lol.fandom.com/api.php'
// HTTP headers are ASCII-only; Korean characters cause ByteString errors in Node fetch
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

    const json: { cargoquery?: { title: Record<string, string> }[]; error?: { code?: string; info?: string } } =
      await res.json()

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

  // ── A ─────────────────────────────────────────
  md('---')
  md('## A. 테이블 목록')
  md('URL: https://lol.fandom.com/wiki/Special:CargoTables')
  md('(브라우저로 직접 확인. 스크립트는 B~G 쿼리로 사용 테이블을 검증)')
  md('')

  // ── B ─────────────────────────────────────────
  md('---')
  md('## B. Tournaments 테이블')
  process.stdout.write('[B] Tournaments...\n')
  const b = await cargo({
    tables: 'Tournaments',
    fields: 'Name,OverviewPage,Year,League,Region,DateStart,SplitNumber,IsQualifier,IsPlayoffs',
    where: 'Year="2016" AND League="LCK"',
    limit: '10',
  })

  if (b.error) {
    md(`**상태**: 실패`)
    md(`**에러**: \`${JSON.stringify(b.error)}\``)
    md('⛔ B 실패 — 파이프라인 진행 불가. 보고 후 대기.')
  } else {
    md(`**상태**: 성공 (${b.data.length}행)`)
    md('**채택 필드**: Name, OverviewPage, Year, League, Region, DateStart, SplitNumber, IsQualifier, IsPlayoffs')
    md('')
    md('```json')
    md(JSON.stringify(b.data[0] ?? null, null, 2))
    md('```')
  }
  md('')

  // ── C ─────────────────────────────────────────
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
    md(`**상태**: 실패`)
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

  // ── D ─────────────────────────────────────────
  md('---')
  md('## D. 순위 테이블 탐색')
  let rankTable = ''
  let rankFields: string[] = []

  // D.1 — TournamentResults
  process.stdout.write('[D.1] TournamentResults...\n')
  md('### D.1 TournamentResults (1순위)')
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
    md(`**상태**: 실패 또는 결과 없음 — \`${JSON.stringify(d1.error ?? '0행')}\``)

    // D.2 — Standings
    process.stdout.write('[D.2] Standings...\n')
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
      md(`**상태**: 실패 또는 결과 없음 — \`${JSON.stringify(d2.error ?? '0행')}\``)

      // D.3 — TournamentResults 필드명 변형 (N = place)
      process.stdout.write('[D.3] TournamentResults with N field...\n')
      md('')
      md('### D.3 TournamentResults — N 필드 변형 시도')
      const d3 = await cargo({
        tables: 'TournamentResults',
        fields: 'Team,N,OverviewPage',
        where: 'OverviewPage LIKE "LCK/2016%"',
        limit: '10',
      })

      if (!d3.error && d3.data.length > 0) {
        rankTable = 'TournamentResults'
        rankFields = Object.keys(d3.data[0])
        md(`**상태**: 성공 (${d3.data.length}행) — Place 필드명은 N`)
        md('```json')
        md(JSON.stringify(d3.data[0], null, 2))
        md('```')
        md('**→ 채택: TournamentResults (Place 필드 = N)**')
      } else {
        md(`**상태**: 실패 — \`${JSON.stringify(d3.error ?? '0행')}\``)
        md('')
        md('⛔ **D 실패**: 순위 테이블을 찾지 못했습니다. 작업 중단 후 호빈 보고 필요.')
        md('(대안: 위키 페이지 HTML 파싱 — 승인 후에만 진행)')
      }
    }
  }
  md('')

  // ── E ─────────────────────────────────────────
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
    md(`**상태**: 실패`)
    md(`**에러**: \`${JSON.stringify(e.error ?? '0행')}\``)
    md('⛔ **E 실패**: Players 테이블 조회 실패. 작업 중단 후 보고 필요.')
  } else {
    fakerImage = e.data[0]?.Image ?? ''
    md(`**상태**: 성공`)
    md('**채택 필드**: ID, Name, NativeName, NameFull, Image, Country, Role')
    md('')
    md('```json')
    md(JSON.stringify(e.data[0], null, 2))
    md('```')
  }
  md('')

  // ── F ─────────────────────────────────────────
  md('---')
  md('## F. 사진 URL 리다이렉트 확인')

  if (!fakerImage) {
    md('E 단계 실패로 인해 건너뜀.')
  } else {
    const fpUrl = `https://lol.fandom.com/wiki/Special:Filepath/${encodeURIComponent(fakerImage)}`
    md(`**테스트 URL**: \`${fpUrl}\``)
    process.stdout.write(`[F] Filepath ${fakerImage}...\n`)

    let fRes: Response
    try {
      fRes = await apiFetch(fpUrl, 'manual')
      md(`**응답 코드**: ${fRes.status}`)
      const loc = fRes.headers.get('location')
      md(`**Location**: ${loc ?? '(없음)'}`)

      if (fRes.status === 301 || fRes.status === 302) {
        md('**상태**: ✅ 302/301 리다이렉트 확인 — Special:Filepath 방식 사용 가능')
      } else if (fRes.status === 200) {
        md('**상태**: ✅ 200 직접 응답')
      } else {
        md(`**상태**: ⚠️ 예상 외 코드 ${fRes.status}`)
      }
    } catch (e2) {
      md(`**상태**: 오류 — ${e2}`)
    }
  }
  md('')

  // ── G ─────────────────────────────────────────
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

  if (!g1.error && g1.data.length > 0) {
    md(`**상태**: ✅ 존재 (${g1.data.length}행 for Faker)`)
    md('**채택 필드**: FileName, Link, Team, Tournament, SortDate')
    md('')
    md('```json')
    md(JSON.stringify(g1.data, null, 2))
    md('```')
    md('**→ G 결론: PlayerImages 테이블 채택 — 시즌별 사진 매칭 가능**')
  } else {
    md(`**상태**: 없음/실패 — \`${JSON.stringify(g1.error ?? '0행')}\``)
    md('')

    // Plan B — allimages
    process.stdout.write('[G.2] Plan B: allimages API...\n')
    md('### G.2 Plan B — MediaWiki allimages API')
    const planBUrl = `${BASE}?action=query&list=allimages&aiprefix=Faker&ailimit=10&format=json`
    md(`**URL**: \`${planBUrl}\``)

    let g2data: { name: string; url: string; timestamp?: string }[] = []
    try {
      const g2res = await apiFetch(planBUrl)
      if (g2res.ok) {
        const g2json: { query?: { allimages?: { name: string; url: string; timestamp?: string }[] } } =
          await g2res.json()
        g2data = g2json?.query?.allimages ?? []
        md(`**상태**: ✅ allimages 응답 성공 (${g2data.length}건)`)

        if (g2data.length > 0) {
          md('**파일명 패턴 예시**:')
          md('```')
          g2data.slice(0, 5).forEach(i => md(`  ${i.name}`))
          md('```')
          md('')
          md('**첫 번째 항목**:')
          md('```json')
          md(JSON.stringify(g2data[0], null, 2))
          md('```')
          md('**→ G 결론: Plan B(allimages) 채택 — 파일명 컨벤션 분석 후 Phase 2에서 사용**')
        } else {
          md('결과 없음 → Players.Image 단일 사진 체제 폴백')
          md('**→ G 결론: Players.Image 폴백**')
        }
      } else {
        md(`**상태**: HTTP ${g2res.status}`)
        md('**→ G 결론: Players.Image 폴백**')
      }
    } catch (e3) {
      md(`**상태**: 오류 — ${e3 instanceof Error ? e3.message : String(e3)}`)
      md('**→ G 결론: Players.Image 폴백**')
    }
  }
  md('')

  // ── 최종 요약 ─────────────────────────────────
  md('---')
  md('## 채택 테이블·필드 목록 (최종)')
  md('')
  md('| 테이블 | 채택 필드 | 용도 |')
  md('|---|---|---|')
  md('| Tournaments | Name, OverviewPage, Year, League, Region, DateStart, SplitNumber, IsQualifier, IsPlayoffs | 대회 목록 |')
  md('| ScoreboardPlayers | Link, Team, Role, OverviewPage, GameId, Champion | 로스터 도출 |')
  md(`| ${rankTable || '⚠️ 미결정'} | ${rankFields.join(', ') || '—'} | 순위 수집 |`)
  md('| Players | ID, Name, NativeName, NameFull, Image, Country, Role | 선수 메타 |')
  md('')
  md('## 순위 테이블 결정')
  md(`채택: **${rankTable || '⚠️ D 실패 — 결정 불가'}**`)
  md(`채택 필드: ${rankFields.join(', ') || '—'}`)
  md('')
  md('## 샘플 응답 JSON 5건')
  md('')
  md('### 샘플 1 — Tournaments (LCK 2016 첫 2행)')
  md('```json')
  md(JSON.stringify(b.data.slice(0, 2), null, 2))
  md('```')
  md('')
  md('### 샘플 2 — ScoreboardPlayers (LCK/2016% 첫 2행)')
  md('```json')
  md(JSON.stringify(c.data.slice(0, 2), null, 2))
  md('```')
  md('')
  md(`### 샘플 3 — ${rankTable || '순위 테이블 미결정'} (첫 2행)`)
  md('```json')
  md(JSON.stringify(d1.data.slice(0, 2), null, 2))
  md('```')
  md('')
  md('### 샘플 4 — Players (Faker)')
  md('```json')
  md(JSON.stringify(e.data.slice(0, 1), null, 2))
  md('```')
  md('')
  md('### 샘플 5 — G 결과 (PlayerImages 또는 allimages)')
  md('```json')
  md(JSON.stringify(g1.data.slice(0, 2), null, 2))
  md('```')

  // 파일 저장
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
