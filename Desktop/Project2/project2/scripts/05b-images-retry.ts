// Phase 2 재조회: photo=null인 선수만 대상 — 기존 1478명 비파괴
// 실행: npx tsx scripts/05b-images-retry.ts
// 전제: .env.local에 R2 환경변수

import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { cargoPaginate, initCargo } from './lib/cargo'
import type { PlayerSeason } from '../src/lib/data'
import type { ImageSourceEntry } from './05-images'

// .env.local 수동 로드
const envPath = path.join(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim())
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

const MWAPI = 'https://lol.fandom.com/api.php'
const UA = 'AllTimeDraftBot/1.0 (personal fan project; parkhb1181@gmail.com)'
const CACHE_DIR = path.join(process.cwd(), 'pipeline-cache')
const RAW_DIR = path.join(CACHE_DIR, 'images-raw')
const WEBP_DIR = path.join(CACHE_DIR, 'images-webp')

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

function parseTournamentYear(t: string): number | null {
  const m = /\b(20\d\d)\b/.exec(t ?? '')
  return m ? parseInt(m[1]) : null
}

function pickBestImage(rows: PlayerImageRow[], targetYear: number, targetTeam: string): PlayerImageRow | null {
  if (!rows.length) return null
  type Ranked = PlayerImageRow & { parsedYear: number | null }
  const ranked: Ranked[] = rows.map(r => ({ ...r, parsedYear: parseTournamentYear(r.Tournament) }))
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
  const tier1 = ranked.filter(r => normTeam(r.Team) === tgt && r.parsedYear === targetYear)
  if (tier1.length) return [...tier1].sort(sortFn)[0]
  const tier2 = ranked.filter(r => normTeam(r.Team) === tgt)
  if (tier2.length) return [...tier2].sort(sortFn)[0]
  const tier3 = ranked.filter(r => r.IsProfileImage === '1')
  if (tier3.length) return [...tier3].sort(sortFn)[0]
  return [...ranked].sort(sortFn)[0]
}

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
  for (const page of Object.values(json?.query?.pages ?? {})) {
    const url = page.imageinfo?.[0]?.url ?? ''
    if (url) result.set((page.title ?? '').replace(/^File:/, ''), url)
  }
  return result
}

async function downloadImage(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

async function toWebp(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .resize(256, 256, { fit: 'cover', position: 'top' })
    .webp({ quality: 80 })
    .toBuffer()
}

async function main() {
  initCargo()
  fs.mkdirSync(RAW_DIR, { recursive: true })
  fs.mkdirSync(WEBP_DIR, { recursive: true })

  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET
  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) {
    throw new Error('R2 환경변수 누락 (.env.local 확인)')
  }

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  })

  const playersPath = path.join(process.cwd(), 'public', 'data', 'players.json')
  const allPlayers: PlayerSeason[] = JSON.parse(fs.readFileSync(playersPath, 'utf-8'))

  // ── 1. null 선수만 대상 ──
  const targets = allPlayers.filter(p => !p.photo)
  const uniquePlayerIds = [...new Set(targets.map(p => p.playerId))]
  console.log(`재조회 대상: ${targets.length}건 (${uniquePlayerIds.length} 선수 고유 ID)`)

  // ── 2. PlayerImages 조회 (retry 전용 캐시 키) ──
  const CARGO_BATCH = 30
  const playerImagesMap = new Map<string, PlayerImageRow[]>()

  for (let i = 0; i < uniquePlayerIds.length; i += CARGO_BATCH) {
    const batch = uniquePlayerIds.slice(i, i + CARGO_BATCH)
    const where = batch.map(id => `Link="${id}"`).join(' OR ')
    const key = `playerimages_retry_b${Math.floor(i / CARGO_BATCH)}`
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

  // ── 3. Players.Image 폴백 ──
  const needsFallback = uniquePlayerIds.filter(id => !playerImagesMap.get(id)?.length)
  const playersImageFallback = new Map<string, string>()

  for (let i = 0; i < needsFallback.length; i += CARGO_BATCH) {
    const batch = needsFallback.slice(i, i + CARGO_BATCH)
    const where = batch.map(id => `ID="${id}"`).join(' OR ')
    const key = `players_img_retry_b${Math.floor(i / CARGO_BATCH)}`
    const rows = await cargoPaginate({ tables: 'Players', fields: 'ID,Image', where }, key)
    for (const row of rows) {
      if (row.Image?.trim()) playersImageFallback.set(row.ID, row.Image.trim())
    }
  }
  console.log(`Players.Image 폴백: ${playersImageFallback.size}명 유효`)

  // ── 4. 파일명 할당 ──
  type Assignment = { ps: PlayerSeason; filename: string; source: string }
  const assignments: Assignment[] = []
  const stillMissing: string[] = []

  for (const ps of targets) {
    const rows = playerImagesMap.get(ps.playerId) ?? []
    const best = pickBestImage(rows, ps.year, ps.team)
    if (best?.FileName) {
      assignments.push({ ps, filename: best.FileName, source: 'PlayerImages' })
    } else {
      const fallback = playersImageFallback.get(ps.playerId)
      if (fallback) {
        assignments.push({ ps, filename: fallback, source: 'Players.Image' })
      } else {
        stillMissing.push(ps.id)
      }
    }
  }
  console.log(`파일명 할당: ${assignments.length}건, 여전히 없음: ${stillMissing.length}건`)

  // ── 5. imageinfo CDN URL ──
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

  // ── 6. 다운로드 (캐시 우선) ──
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
  console.log(`다운로드: 신규 ${dlOk}건, 캐시 재사용 ${rawCache.size - dlOk}건, 실패 ${dlFail}건`)

  // ── 7. webp 변환 ──
  const newSources: ImageSourceEntry[] = []
  let convOk = 0, convFail = 0

  for (const { ps, filename, source } of assignments) {
    const raw = rawCache.get(filename)
    if (!raw) continue
    const webpPath = path.join(WEBP_DIR, `${ps.id}.webp`)
    if (!fs.existsSync(webpPath)) {
      try {
        fs.writeFileSync(webpPath, await toWebp(raw))
        convOk++
      } catch (e) {
        process.stderr.write(`  변환 실패 ${ps.id}: ${e}\n`)
        convFail++
        continue
      }
    } else {
      convOk++
    }
    newSources.push({
      id: ps.id,
      playerId: ps.playerId,
      originalFilename: filename,
      sourceUrl: cdnUrlMap.get(filename) ?? '',
      attribution: `Leaguepedia/${source} (lol.fandom.com)`,
    })
  }
  console.log(`webp 변환: ${convOk}건, 실패: ${convFail}건`)

  // ── 8. R2 업로드 (새로 확보한 것만) ──
  let upOk = 0, upFail = 0
  const uploadedIds = new Set<string>()

  for (const entry of newSources) {
    const webpPath = path.join(WEBP_DIR, `${entry.id}.webp`)
    if (!fs.existsSync(webpPath)) { upFail++; continue }
    try {
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: `players/${entry.id}.webp`,
        Body: fs.readFileSync(webpPath),
        ContentType: 'image/webp',
        CacheControl: 'public, max-age=31536000, immutable',
      }))
      uploadedIds.add(entry.id)
      upOk++
    } catch (e) {
      process.stderr.write(`  업로드 실패 ${entry.id}: ${e}\n`)
      upFail++
    }
  }
  console.log(`R2 업로드: ${upOk}건 성공, ${upFail}건 실패`)

  // ── 9. image-sources.json append ──
  const sourcesPath = path.join(CACHE_DIR, 'image-sources.json')
  const existingSources: ImageSourceEntry[] = fs.existsSync(sourcesPath)
    ? JSON.parse(fs.readFileSync(sourcesPath, 'utf-8'))
    : []
  const existingIds = new Set(existingSources.map(s => s.id))
  const toAppend = newSources.filter(s => !existingIds.has(s.id) && uploadedIds.has(s.id))
  fs.writeFileSync(sourcesPath, JSON.stringify([...existingSources, ...toAppend], null, 2), 'utf-8')
  console.log(`image-sources.json: ${toAppend.length}건 추가 (기존 ${existingSources.length}건 유지)`)

  // ── 10. players.json photo 갱신 (null→URL, 기존 URL은 유지) ──
  let updated = 0
  for (const ps of allPlayers) {
    if (uploadedIds.has(ps.id)) {
      ;(ps as { photo: string | null }).photo = `${publicBaseUrl}/players/${ps.id}.webp`
      updated++
    }
  }
  fs.writeFileSync(playersPath, JSON.stringify(allPlayers, null, 2), 'utf-8')
  console.log(`players.json 갱신: ${updated}건 (null → URL)`)

  // ── 결과 요약 ──
  const finalMissing = allPlayers.filter(p => !p.photo)
  console.log(`\n=== 재조회 완료 ===`)
  console.log(`신규 확보: ${updated}건`)
  console.log(`여전히 null: ${finalMissing.length}건 (원본 없음 — 아바타 폴백 유지)`)

  // DRX 2023 특별 확인
  const drx23 = allPlayers.filter(p => p.team.includes('DRX') && p.year === 2023)
  console.log('\nDRX 2023:')
  for (const p of drx23) {
    console.log(`  ${p.role}:${p.nameEn} → ${p.photo ? '✅ ' + p.photo.split('/').pop() : '❌ NULL'}`)
  }
}

main().catch(e => { process.stderr.write(`Fatal: ${e}\n`); process.exit(1) })
