// Phase 2: 이미지 다운로드 + webp 변환
// 범위: Worlds/MSI 진출 선수 (~390명, ~880 PlayerSeason)
// 방식: PlayerImages 카고 쿼리 → imageinfo CDN URL → 다운로드 → sharp 256×256 crop
// 결과: pipeline-cache/images-webp/{id}.webp, pipeline-cache/image-sources.json

import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { cargoPaginate, initCargo } from './lib/cargo'
import type { PlayerSeason } from '../src/lib/data'
import type { ResultEntry } from './03-results'

const MWAPI = 'https://lol.fandom.com/api.php'
const UA = 'AllTimeDraftBot/1.0 (personal fan project; parkhb1181@gmail.com)'
const CACHE_DIR = path.join(process.cwd(), 'pipeline-cache')
const RAW_DIR = path.join(CACHE_DIR, 'images-raw')
const WEBP_DIR = path.join(CACHE_DIR, 'images-webp')

// 파일시스템 안전 슬러그 (raw 캐시 파일명용)
function slugifyRaw(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

interface PlayerImageRow {
  FileName: string
  Link: string
  Team: string
  Tournament: string
  IsProfileImage: string
}

// Tournament 필드에서 연도 추출 ("LCK/2016 Season/Summer" → 2016)
function parseTournamentYear(t: string): number | null {
  const m = /\b(20\d\d)\b/.exec(t ?? '')
  return m ? parseInt(m[1]) : null
}

// §5 매칭 우선순위: ①같은팀+같은연도 →②같은팀+최근접 →③IsProfileImage=1 →④최신연도
function pickBestImage(
  rows: PlayerImageRow[],
  targetYear: number,
  targetTeam: string
): PlayerImageRow | null {
  if (!rows.length) return null

  type Ranked = PlayerImageRow & { parsedYear: number | null }
  const ranked: Ranked[] = rows.map(r => ({ ...r, parsedYear: parseTournamentYear(r.Tournament) }))

  // 팀명 정규화 — 대소문자·특수문자 무시하고 음절만 비교
  const normTeam = (t: string) => (t ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const tgt = normTeam(targetTeam)

  const sortFn = (a: Ranked, b: Ranked): number => {
    const ap = a.IsProfileImage === '1' ? 1 : 0
    const bp = b.IsProfileImage === '1' ? 1 : 0
    if (ap !== bp) return bp - ap
    const ay = a.parsedYear ?? 0, by2 = b.parsedYear ?? 0
    if (ay !== by2) return by2 - ay
    return (a.FileName ?? '').localeCompare(b.FileName ?? '')
  }

  // ① 같은 팀 + 같은 연도
  const tier1 = ranked.filter(r => normTeam(r.Team) === tgt && r.parsedYear === targetYear)
  if (tier1.length) return [...tier1].sort(sortFn)[0]

  // ② 같은 팀 + 최근접 연도
  const tier2 = ranked.filter(r => normTeam(r.Team) === tgt)
  if (tier2.length) return [...tier2].sort(sortFn)[0]

  // ③ IsProfileImage=1
  const tier3 = ranked.filter(r => r.IsProfileImage === '1')
  if (tier3.length) return [...tier3].sort(sortFn)[0]

  // ④ 최신연도 → FileName asc
  return [...ranked].sort(sortFn)[0]
}

// MediaWiki imageinfo 배치 (50파일 / 콜, throttle 없음 — 사용자 지시)
async function fetchImageinfoBatch(filenames: string[]): Promise<Map<string, string>> {
  const titles = filenames.map(f => `File:${f}`).join('|')
  const u = new URL(MWAPI)
  u.searchParams.set('action', 'query')
  u.searchParams.set('prop', 'imageinfo')
  u.searchParams.set('iiprop', 'url')
  u.searchParams.set('titles', titles)
  u.searchParams.set('format', 'json')

  const res = await fetch(u.toString(), { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`imageinfo HTTP ${res.status}`)

  const json = await res.json() as {
    query?: { pages?: Record<string, { title?: string; imageinfo?: { url: string }[]; missing?: string }> }
  }

  const result = new Map<string, string>()
  const pages = json?.query?.pages ?? {}
  for (const page of Object.values(pages)) {
    const title = page.title ?? ''
    const url = page.imageinfo?.[0]?.url ?? ''
    if (url) result.set(title.replace(/^File:/, ''), url)
  }
  return result
}

// CDN URL 다운로드
async function downloadImage(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

// 256×256 cover crop → webp q80 (누끼 제외 경로 — §5)
async function toWebp(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .resize(256, 256, { fit: 'cover', position: 'top' })
    .webp({ quality: 80 })
    .toBuffer()
}

export type ImageSourceEntry = {
  id: string
  playerId: string
  originalFilename: string
  sourceUrl: string
  attribution: string
}

async function main() {
  initCargo()
  fs.mkdirSync(RAW_DIR, { recursive: true })
  fs.mkdirSync(WEBP_DIR, { recursive: true })

  // ── 1. 데이터 로드 ──
  const players: PlayerSeason[] = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'players.json'), 'utf-8')
  )
  const results: ResultEntry[] = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'pipeline-cache', 'results.json'), 'utf-8')
  )

  // 전체 players.json 대상 (카드 풀 컷 이후 모든 선수에 사진 필요)
  // photo 이미 있는 PlayerSeason은 webp 캐시 존재 여부로 스킵됨
  const whitelistPS = players
  const uniquePlayerIds = [...new Set(whitelistPS.map(p => p.playerId))]
  console.log(`대상: ${whitelistPS.length} PlayerSeason / ${uniquePlayerIds.length} 선수`)

  // ── 3. PlayerImages 쿼리 (배치 30, cargo 5s throttle) ──
  const CARGO_BATCH = 30
  const playerImagesMap = new Map<string, PlayerImageRow[]>()

  for (let i = 0; i < uniquePlayerIds.length; i += CARGO_BATCH) {
    const batch = uniquePlayerIds.slice(i, i + CARGO_BATCH)
    const where = batch.map(id => `Link="${id}"`).join(' OR ')
    const key = `playerimages_b${Math.floor(i / CARGO_BATCH)}`
    const rows = await cargoPaginate(
      { tables: 'PlayerImages', fields: 'FileName,Link,Team,Tournament,IsProfileImage', where },
      key
    )
    for (const row of rows) {
      if (!playerImagesMap.has(row.Link)) playerImagesMap.set(row.Link, [])
      playerImagesMap.get(row.Link)!.push(row as unknown as PlayerImageRow)
    }
    process.stderr.write(`  PlayerImages: ${Math.min(i + CARGO_BATCH, uniquePlayerIds.length)}/${uniquePlayerIds.length}\n`)
  }
  console.log(`PlayerImages 보유 선수: ${playerImagesMap.size}명`)

  // ── 4. Players.Image 폴백 쿼리 ──
  const needsFallback = uniquePlayerIds.filter(id => !playerImagesMap.get(id)?.length)
  const playersImageFallback = new Map<string, string>()

  for (let i = 0; i < needsFallback.length; i += CARGO_BATCH) {
    const batch = needsFallback.slice(i, i + CARGO_BATCH)
    const where = batch.map(id => `ID="${id}"`).join(' OR ')
    const key = `players_img_b${Math.floor(i / CARGO_BATCH)}`
    const rows = await cargoPaginate(
      { tables: 'Players', fields: 'ID,Image', where },
      key
    )
    for (const row of rows) {
      if (row.Image?.trim()) playersImageFallback.set(row.ID, row.Image.trim())
    }
  }
  console.log(`Players.Image 폴백: ${playersImageFallback.size}명 유효`)

  // ── 5. PlayerSeason별 파일명 할당 ──
  type Assignment = { ps: PlayerSeason; filename: string; source: string }
  const assignments: Assignment[] = []
  const skipped: string[] = []

  for (const ps of whitelistPS) {
    const rows = playerImagesMap.get(ps.playerId) ?? []
    const best = pickBestImage(rows, ps.year, ps.team)
    if (best?.FileName) {
      assignments.push({ ps, filename: best.FileName, source: 'PlayerImages' })
    } else {
      const fallback = playersImageFallback.get(ps.playerId)
      if (fallback) {
        assignments.push({ ps, filename: fallback, source: 'Players.Image' })
      } else {
        skipped.push(ps.id)
      }
    }
  }
  console.log(`파일명 할당: ${assignments.length}건, 이미지 없음(아바타): ${skipped.length}건`)

  // ── 6. 고유 파일명 → imageinfo CDN URL 해석 ──
  const MWBATCH = 50
  const uniqueFilenames = [...new Set(assignments.map(a => a.filename))]
  const cdnUrlMap = new Map<string, string>()

  for (let i = 0; i < uniqueFilenames.length; i += MWBATCH) {
    const batch = uniqueFilenames.slice(i, i + MWBATCH)
    try {
      const urlMap = await fetchImageinfoBatch(batch)
      for (const [fn, url] of urlMap) cdnUrlMap.set(fn, url)
    } catch (e) {
      process.stderr.write(`imageinfo 실패 batch ${Math.floor(i / MWBATCH)}: ${e}\n`)
    }
    process.stderr.write(`  imageinfo: ${Math.min(i + MWBATCH, uniqueFilenames.length)}/${uniqueFilenames.length}\n`)
  }
  console.log(`CDN URL 해석: ${cdnUrlMap.size}/${uniqueFilenames.length}`)

  // ── 7. CDN 다운로드 (캐시 우선) ──
  const rawCache = new Map<string, Buffer>()
  let dlOk = 0, dlFail = 0

  for (const [filename, cdnUrl] of cdnUrlMap) {
    const rawPath = path.join(RAW_DIR, slugifyRaw(filename))
    if (fs.existsSync(rawPath)) {
      rawCache.set(filename, fs.readFileSync(rawPath))
      continue
    }
    try {
      const buf = await downloadImage(cdnUrl)
      fs.writeFileSync(rawPath, buf)
      rawCache.set(filename, buf)
      dlOk++
    } catch (e) {
      process.stderr.write(`  다운로드 실패 ${filename}: ${e}\n`)
      dlFail++
    }
  }
  console.log(`다운로드: 신규 ${dlOk}건, 캐시 ${rawCache.size - dlOk}건, 실패 ${dlFail}건`)

  // ── 8. webp 변환 + image-sources.json 기록 ──
  const imageSources: ImageSourceEntry[] = []
  let convOk = 0, convFail = 0

  for (const { ps, filename, source } of assignments) {
    const raw = rawCache.get(filename)
    if (!raw) continue

    const webpPath = path.join(WEBP_DIR, `${ps.id}.webp`)
    if (!fs.existsSync(webpPath)) {
      try {
        const webp = await toWebp(raw)
        fs.writeFileSync(webpPath, webp)
        convOk++
      } catch (e) {
        process.stderr.write(`  변환 실패 ${ps.id}: ${e}\n`)
        convFail++
        continue
      }
    } else {
      convOk++
    }

    imageSources.push({
      id: ps.id,
      playerId: ps.playerId,
      originalFilename: filename,
      sourceUrl: cdnUrlMap.get(filename) ?? '',
      attribution: `Leaguepedia/${source} (lol.fandom.com)`,
    })
  }

  fs.writeFileSync(
    path.join(CACHE_DIR, 'image-sources.json'),
    JSON.stringify(imageSources, null, 2),
    'utf-8'
  )

  console.log(`\n=== Phase 2 이미지 준비 완료 ===`)
  console.log(`webp 변환: ${convOk}건, 실패: ${convFail}건`)
  console.log(`image-sources.json: ${imageSources.length}건`)
  console.log(`\n다음: npx tsx scripts/06-upload-r2.ts`)
}

main().catch(e => { process.stderr.write(`Fatal: ${e}\n`); process.exit(1) })
