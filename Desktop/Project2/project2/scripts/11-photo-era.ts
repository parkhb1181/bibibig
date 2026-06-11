// Phase 2: era-correct 사진 per-season → R2 업로드
// §5-1: 같은팀+같은연도 → 같은팀+근접연도 → Players.Image → 아바타 폴백
//
// Tier 1 (런칭 게이트): photo-whitelist.json 선수의 전 시즌
// Tier 2 (백그라운드): 전 선수-시즌 (Tier 1 완료 후 자동 계속 or --all 플래그)
//
// npx tsx scripts/11-photo-era.ts [--all]   ← --all 없으면 Tier 1만
//
// R2 미설정 시 dry-run (업로드 스킵, 로컬 public/players/ 저장)
// 아침 §0 보고: Tier1 커버리지 / 폴백 분포 / 실패 목록

import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import type { RostersFile, RosterEntry } from './02-rosters'
import type { WhitelistEntry } from './10-photo-whitelist'

// ─── 설정 ────────────────────────────────────────────────────────────────────

const WIKI_API = 'https://lol.fandom.com/api.php'
const UA = 'AllTimeDraftBot/1.0 (personal fan project; parkhb1181@gmail.com)'
const THROTTLE_MS = 1000
const PHOTO_SIZE = 256
// §3-4 ①번 기본안 페이드 — bg-base 토큰 확정 후 재실행해 동기화 필요
const BG_BASE = '#0d0d1a'

const CACHE_DIR = path.join(process.cwd(), 'pipeline-cache')
const ALLIMAGES_CACHE_DIR = path.join(CACHE_DIR, 'allimages')
const SOURCES_PATH = path.join(CACHE_DIR, 'image-sources.json')
const LOCAL_OUT = path.join(process.cwd(), 'public', 'players')

const R2_ACCOUNT = process.env.R2_ACCOUNT_ID
const R2_KEY = process.env.R2_ACCESS_KEY_ID
const R2_SECRET = process.env.R2_SECRET_ACCESS_KEY
const R2_BUCKET = process.env.R2_BUCKET
const R2_BASE_URL = process.env.R2_PUBLIC_BASE_URL
const DRY_RUN = !R2_ACCOUNT || !R2_KEY || !R2_SECRET || !R2_BUCKET

// ─── §3 slugify ──────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

function playerSeasonId(playerId: string, year: number, team: string): string {
  return `${slugify(playerId)}_${year}_${slugify(team)}`
}

// ─── 스로틀 ──────────────────────────────────────────────────────────────────

let lastCall = 0

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)) }

async function throttledFetch(url: string): Promise<Response> {
  const wait = THROTTLE_MS - (Date.now() - lastCall)
  if (wait > 0) await sleep(wait)
  lastCall = Date.now()

  const BACKOFF = [2000, 4000, 8000]
  for (let i = 0; i <= BACKOFF.length; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`)
      return res
    } catch {
      if (i >= BACKOFF.length) return new Response(null, { status: 503 })
      await sleep(BACKOFF[i])
    }
  }
  return new Response(null, { status: 503 }) // unreachable
}

// ─── allimages API ───────────────────────────────────────────────────────────

type ImageInfo = { name: string; timestamp: string }

async function fetchAllimages(playerId: string): Promise<ImageInfo[]> {
  fs.mkdirSync(ALLIMAGES_CACHE_DIR, { recursive: true })
  const cacheKey = playerId.replace(/[^a-zA-Z0-9_-]/g, '_')
  const cachePath = path.join(ALLIMAGES_CACHE_DIR, `${cacheKey}.json`)
  if (fs.existsSync(cachePath)) {
    return JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as ImageInfo[]
  }

  const params = new URLSearchParams({
    action: 'query', list: 'allimages',
    aiprefix: playerId, aiprop: 'timestamp', ailimit: '50', format: 'json',
  })
  const res = await throttledFetch(`${WIKI_API}?${params}`)
  if (!res.ok) return []

  let json: unknown
  try { json = await res.json() } catch { return [] }

  const list = ((json as Record<string, unknown>)?.query as Record<string, unknown>)
    ?.allimages as unknown[] | undefined
  if (!Array.isArray(list)) return []

  const result: ImageInfo[] = list
    .filter((x): x is Record<string, string> => typeof x === 'object' && x !== null)
    .map(x => ({ name: String(x.name ?? ''), timestamp: String(x.timestamp ?? '') }))
    .filter(x => x.name)

  fs.writeFileSync(cachePath, JSON.stringify(result, null, 2), 'utf-8')
  return result
}

// ─── imageinfo 배칭 (50건) ── CDN URL 해석 ───────────────────────────────────

async function fetchImageInfoBatch(filenames: string[]): Promise<Map<string, string>> {
  if (filenames.length === 0) return new Map()
  const titles = filenames.map(f => `File:${f}`).join('|')
  const params = new URLSearchParams({
    action: 'query', titles, prop: 'imageinfo', iiprop: 'url', format: 'json',
  })
  const res = await throttledFetch(`${WIKI_API}?${params}`)
  if (!res.ok) return new Map()

  let json: unknown
  try { json = await res.json() } catch { return new Map() }

  const pages = ((json as Record<string, unknown>)?.query as Record<string, unknown>)
    ?.pages as Record<string, unknown> | undefined
  if (!pages) return new Map()

  const result = new Map<string, string>()
  for (const page of Object.values(pages)) {
    const p = page as Record<string, unknown>
    const title = String(p.title ?? '')
    const filename = title.replace(/^File:/, '')
    const info = (p.imageinfo as unknown[]) ?? []
    const url = (info[0] as Record<string, string> | undefined)?.url
    if (filename && url) result.set(filename, url)
  }
  return result
}

// ─── era-correct 파일 선택 ────────────────────────────────────────────────────

type FallbackStage = 'same_year_team' | 'near_year_team' | 'any_file' | 'avatar'

function extractYear(filename: string): number | null {
  const m = filename.match(/20(1[3-9]|2[0-5])/)
  return m ? parseInt(m[0]) : null
}

// teamSlug 토큰 vs 파일명 매칭 점수
function teamScore(filename: string, teamSlug: string): number {
  const f = filename.toLowerCase()
  const tokens = teamSlug.split('-').filter(t => t.length >= 2)
  return tokens.filter(t => f.includes(t)).length
}

function selectEraFile(
  candidates: ImageInfo[],
  year: number,
  teamSlug: string,
): { info: ImageInfo; stage: FallbackStage } | null {
  if (candidates.length === 0) return null

  const scored = candidates.map(c => {
    const cy = extractYear(c.name)
    const yearDiff = cy !== null ? Math.abs(cy - year) : 999
    const ts = teamScore(c.name, teamSlug)
    // 점수: 팀매칭(높을수록 좋음) × 100 + 연도근접(낮을수록 좋음) 보정
    return { info: c, yearDiff, ts }
  })

  // ① 같은 팀 + 같은 연도
  const s1 = scored.filter(s => s.ts > 0 && s.yearDiff === 0)
  if (s1.length > 0) {
    s1.sort((a, b) => b.ts - a.ts || a.info.name.localeCompare(b.info.name))
    return { info: s1[0].info, stage: 'same_year_team' }
  }

  // ② 같은 팀 + 최근접 연도 (최대 4년)
  const s2 = scored.filter(s => s.ts > 0 && s.yearDiff <= 4)
  if (s2.length > 0) {
    s2.sort((a, b) => a.yearDiff - b.yearDiff || b.ts - a.ts || a.info.name.localeCompare(b.info.name))
    return { info: s2[0].info, stage: 'near_year_team' }
  }

  // ③ 팀 매칭 없이 아무 파일 (Players.Image 대안)
  const s3 = [...scored].sort((a, b) => a.yearDiff - b.yearDiff || a.info.name.localeCompare(b.info.name))
  return { info: s3[0].info, stage: 'any_file' }
}

// ─── 이미지 처리 (sharp + §3-4 ①번 페이드) ────────────────────────────────────

function buildFadeSvg(): Buffer {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PHOTO_SIZE}" height="${PHOTO_SIZE}">
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="40%" stop-color="${BG_BASE}" stop-opacity="0"/>
      <stop offset="95%" stop-color="${BG_BASE}" stop-opacity="0.65"/>
    </linearGradient>
  </defs>
  <rect width="${PHOTO_SIZE}" height="${PHOTO_SIZE}" fill="${BG_BASE}" fill-opacity="0.10"/>
  <rect width="${PHOTO_SIZE}" height="${PHOTO_SIZE}" fill="url(#fade)"/>
</svg>`
  return Buffer.from(svg)
}

async function processImage(srcBuf: Buffer): Promise<Buffer> {
  return sharp(srcBuf)
    .resize(PHOTO_SIZE, PHOTO_SIZE, { fit: 'cover', position: 'top' })
    .flatten({ background: BG_BASE })
    .linear(1.03, -3.84)          // CSS contrast(1.03) 근사
    .modulate({ brightness: 0.97 })
    .composite([{ input: buildFadeSvg(), blend: 'over' }])
    .webp({ quality: 80 })
    .toBuffer()
}

// ─── R2 업로드 ────────────────────────────────────────────────────────────────

let s3: S3Client | null = null

function getS3(): S3Client {
  if (!s3) {
    s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_KEY!, secretAccessKey: R2_SECRET! },
    })
  }
  return s3
}

async function r2Exists(key: string): Promise<boolean> {
  try {
    await getS3().send(new HeadObjectCommand({ Bucket: R2_BUCKET!, Key: key }))
    return true
  } catch { return false }
}

async function uploadR2(key: string, body: Buffer): Promise<void> {
  await getS3().send(new PutObjectCommand({
    Bucket: R2_BUCKET!, Key: key, Body: body, ContentType: 'image/webp',
  }))
}

// ─── 메인 ─────────────────────────────────────────────────────────────────────

type SourceRecord = {
  srcFilename: string; srcUrl: string
  r2Key: string; stage: FallbackStage; processed: string
}

async function main() {
  const runAll = process.argv.includes('--all')

  if (DRY_RUN) {
    process.stderr.write('[11-photo-era] R2 환경변수 미설정 — 로컬 dry-run 모드 (public/players/ 저장)\n')
    fs.mkdirSync(LOCAL_OUT, { recursive: true })
  }

  // 입력 파일 검증
  const rostersPath = path.join(CACHE_DIR, 'rosters.json')
  const whitelistPath = path.join(CACHE_DIR, 'photo-whitelist.json')
  if (!fs.existsSync(rostersPath)) throw new Error('rosters.json 없음 — 02 먼저 실행')
  if (!fs.existsSync(whitelistPath)) throw new Error('photo-whitelist.json 없음 — 10 먼저 실행')

  const rosters: RostersFile = JSON.parse(fs.readFileSync(rostersPath, 'utf-8'))
  const whitelist: WhitelistEntry[] = JSON.parse(fs.readFileSync(whitelistPath, 'utf-8'))
  const whitelistIds = new Set(whitelist.map(e => e.playerId))

  // 처리 대상 엔트리 결정
  const tier1Entries = rosters.entries.filter(e => whitelistIds.has(e.playerId))
  const tier2Entries = rosters.entries.filter(e => !whitelistIds.has(e.playerId))
  const targetEntries = runAll ? [...tier1Entries, ...tier2Entries] : tier1Entries

  console.log(`처리 대상: ${targetEntries.length}건 (Tier1 ${tier1Entries.length} / Tier2 ${tier2Entries.length})`)
  console.log(`모드: ${runAll ? 'Tier1+2 전체' : 'Tier1만'}`)

  // 소스 기록 로드
  const sources: Record<string, SourceRecord> = fs.existsSync(SOURCES_PATH)
    ? JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf-8'))
    : {}

  // playerId → allimages 캐시 (한 선수 여러 시즌이면 한 번만 조회)
  const allimagesCache = new Map<string, ImageInfo[]>()

  // 통계 집계용
  const stageCounts: Record<FallbackStage | 'avatar', number> = {
    same_year_team: 0, near_year_team: 0, any_file: 0, avatar: 0,
  }
  const failures: string[] = []
  let done = 0, skipped = 0

  // ── Step 1: allimages 조회 (playerId 단위, 캐시) ───────────────────────────
  const uniquePlayerIds = [...new Set(targetEntries.map(e => e.playerId))]
  console.log(`allimages 조회: ${uniquePlayerIds.length}명...`)
  for (let i = 0; i < uniquePlayerIds.length; i++) {
    const pid = uniquePlayerIds[i]
    if (i % 20 === 0) process.stderr.write(`  allimages ${i}/${uniquePlayerIds.length}\n`)
    const imgs = await fetchAllimages(pid)
    allimagesCache.set(pid, imgs)
  }

  // ── Step 2: 파일 선택 (era-correct, 메모리 내) ─────────────────────────────
  type Selection = { entry: RosterEntry; selected: ImageInfo; stage: FallbackStage } | { entry: RosterEntry; selected: null; stage: 'avatar' }
  const selections: Selection[] = []

  for (const entry of targetEntries) {
    const psId = playerSeasonId(entry.playerId, entry.year, entry.team)
    const r2Key = `players/${psId}.webp`

    // 이미 처리됨 (R2 또는 소스 기록)
    if (sources[psId]) { skipped++; continue }

    const candidates = allimagesCache.get(entry.playerId) ?? []
    const picked = selectEraFile(candidates, entry.year, slugify(entry.team))

    if (!picked) {
      selections.push({ entry, selected: null, stage: 'avatar' })
    } else {
      selections.push({ entry, selected: picked.info, stage: picked.stage })
    }
  }

  // ── Step 3: imageinfo 배칭 (50건) → CDN URL ───────────────────────────────
  const uniqueFilenames = [...new Set(
    selections.flatMap(s => s.selected ? [s.selected.name] : [])
  )]
  const cdnUrlMap = new Map<string, string>()

  console.log(`imageinfo 배칭 URL 해석: ${uniqueFilenames.length}개 파일 (50건씩)...`)
  for (let i = 0; i < uniqueFilenames.length; i += 50) {
    const batch = uniqueFilenames.slice(i, i + 50)
    const batchMap = await fetchImageInfoBatch(batch)
    for (const [k, v] of batchMap) cdnUrlMap.set(k, v)
    if (i % 200 === 0 && i > 0) process.stderr.write(`  imageinfo ${i}/${uniqueFilenames.length}\n`)
  }

  // ── Step 4: 다운로드 + 처리 + 업로드 ──────────────────────────────────────
  console.log(`다운로드 + 처리 + 업로드: ${selections.length}건...`)
  for (let i = 0; i < selections.length; i++) {
    const sel = selections[i]
    const { entry } = sel
    const psId = playerSeasonId(entry.playerId, entry.year, entry.team)
    const r2Key = `players/${psId}.webp`

    if (i % 50 === 0) process.stderr.write(`  처리 ${i}/${selections.length} (done=${done} fail=${failures.length})\n`)

    if (!sel.selected) {
      // 아바타 폴백 — null 기록
      sources[psId] = { srcFilename: '', srcUrl: '', r2Key, stage: 'avatar', processed: new Date().toISOString() }
      stageCounts.avatar++
      continue
    }

    const cdnUrl = cdnUrlMap.get(sel.selected.name)
    if (!cdnUrl) {
      process.stderr.write(`  URL 없음: ${sel.selected.name} (스킵)\n`)
      failures.push(`${psId} (URL 없음: ${sel.selected.name})`)
      continue
    }

    // 다운로드
    let srcBuf: Buffer | null = null
    try {
      const imgRes = await throttledFetch(cdnUrl)
      if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status}`)
      srcBuf = Buffer.from(await imgRes.arrayBuffer())
    } catch (err) {
      process.stderr.write(`  다운로드 실패: ${cdnUrl.slice(-40)} — ${err}\n`)
      failures.push(`${psId} (다운 실패: ${sel.selected.name})`)
      continue
    }

    // sharp 처리
    let webpBuf: Buffer
    try {
      webpBuf = await processImage(srcBuf)
    } catch (err) {
      process.stderr.write(`  sharp 실패: ${psId} — ${err}\n`)
      failures.push(`${psId} (sharp 실패)`)
      continue
    }

    // 업로드 or 로컬 저장
    try {
      if (DRY_RUN) {
        fs.writeFileSync(path.join(LOCAL_OUT, `${psId}.webp`), webpBuf)
      } else {
        await uploadR2(r2Key, webpBuf)
      }
    } catch (err) {
      process.stderr.write(`  업로드 실패: ${psId} — ${err}\n`)
      failures.push(`${psId} (업로드 실패)`)
      continue
    }

    sources[psId] = {
      srcFilename: sel.selected.name, srcUrl: cdnUrl,
      r2Key, stage: sel.stage, processed: new Date().toISOString(),
    }
    stageCounts[sel.stage]++
    done++

    // 소스 기록 주기적 저장
    if ((done + failures.length) % 20 === 0) {
      fs.writeFileSync(SOURCES_PATH, JSON.stringify(sources, null, 2), 'utf-8')
    }
  }

  // 최종 소스 기록 저장
  fs.writeFileSync(SOURCES_PATH, JSON.stringify(sources, null, 2), 'utf-8')

  // ── §0 보고 ────────────────────────────────────────────────────────────────
  const tier1Total = tier1Entries.length
  const tier1Done = tier1Entries.filter(e => {
    const psId = playerSeasonId(e.playerId, e.year, e.team)
    return sources[psId] && sources[psId].stage !== 'avatar'
  }).length
  const tier1Coverage = tier1Total > 0 ? (tier1Done / tier1Total * 100).toFixed(1) : '0'

  console.log('\n=== §0 보고 — Phase 2 사진 트랙 ===')
  console.log(`Tier1 커버리지: ${tier1Done}/${tier1Total} (${tier1Coverage}%)`)
  if (parseFloat(tier1Coverage) < 70) {
    console.log('⚠️  Tier1 커버리지 70% 미만 — 원인 분석 및 정지')
  }
  console.log('\n폴백 분포:')
  console.log(`  ① 같은연도+팀: ${stageCounts.same_year_team}건`)
  console.log(`  ② 근접연도+팀: ${stageCounts.near_year_team}건`)
  console.log(`  ③ 임의파일  : ${stageCounts.any_file}건`)
  console.log(`  ④ 아바타    : ${stageCounts.avatar}건`)
  console.log(`\n완료: ${done} / 스킵(기존): ${skipped} / 실패: ${failures.length}`)
  if (failures.length > 0) {
    console.log(`\n실패 목록 (${failures.length}건):`)
    failures.slice(0, 50).forEach(f => console.log(`  - ${f}`))
    if (failures.length > 50) console.log(`  ... 외 ${failures.length - 50}건`)
  }

  const r2BaseUrl = DRY_RUN ? '(dry-run: public/players/)' : (R2_BASE_URL ?? '(R2_PUBLIC_BASE_URL 미설정)')
  console.log(`\n이미지 URL: ${r2BaseUrl}/players/{playerSeasonId}.webp`)
}

main().catch(e => { process.stderr.write(`Fatal: ${e}\n`); process.exit(1) })
