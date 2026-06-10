// Phase 2: 사진 다운로드 + 처리
// ⚠️  실행 전 필수: pipeline-cache/photo-whitelist.json 호빈 검수 승인
//     승인 후 pipeline-cache/photo-whitelist-approved.txt 파일 생성(내용 무관) → 게이트 해제
// npx tsx scripts/11-photo-download.ts

import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import type { WhitelistEntry } from './10-photo-whitelist'

const WIKI_API = 'https://lol.fandom.com/api.php'
const UA = 'AllTimeDraftBot/1.0 (personal fan project; parkhb1181@gmail.com)'
const THROTTLE_MS = 1000    // Fandom 이미지 API: 1초 1건 (§0 규칙)
const PHOTO_SIZE = 256

// §3-4 ①번 기본안 페이드 색상 — bg-base 토큰 확정 후 재실행해 동기화 필요
const BG_BASE_HEX = '#0d0d1a'

const CACHE_DIR = path.join(process.cwd(), 'pipeline-cache')
const OUTPUT_DIR = path.join(process.cwd(), 'public', 'players')
const SOURCES_PATH = path.join(CACHE_DIR, 'image-sources.json')
const APPROVED_FLAG = path.join(CACHE_DIR, 'photo-whitelist-approved.txt')
const WHITELIST_PATH = path.join(CACHE_DIR, 'photo-whitelist.json')

// ─── 스로틀 ─────────────────────────────────────────────────────────────────

let lastCall = 0

async function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms))
}

async function throttledFetch(url: string): Promise<Response> {
  const wait = THROTTLE_MS - (Date.now() - lastCall)
  if (wait > 0) await sleep(wait)
  lastCall = Date.now()
  return fetch(url, { headers: { 'User-Agent': UA } })
}

// ─── allimages: 선수 사진 후보 목록 조회 ───────────────────────────────────

type ImageCandidate = {
  name: string      // 파일명 (확장자 포함, File: 접두어 없음)
  url: string       // CDN URL
  timestamp: string // ISO 8601 — 업로드 일자 (최신순 정렬용)
}

async function fetchAllimages(playerId: string): Promise<ImageCandidate[]> {
  // aiprop=url|timestamp: URL과 업로드 시각 반환
  const params = new URLSearchParams({
    action: 'query',
    list: 'allimages',
    aiprefix: playerId,
    aiprop: 'url|timestamp',
    ailimit: '50',
    format: 'json',
  })
  const url = `${WIKI_API}?${params}`
  const res = await throttledFetch(url)
  if (!res.ok) return []

  let json: unknown
  try { json = await res.json() } catch { return [] }

  const pages = (json as Record<string, unknown>)?.query as Record<string, unknown> | undefined
  const list = pages?.allimages as unknown[] | undefined
  if (!Array.isArray(list)) return []

  return list
    .filter((img): img is Record<string, string> => typeof img === 'object' && img !== null)
    .map(img => ({
      name: String(img.name ?? ''),
      url: String(img.url ?? ''),
      timestamp: String(img.timestamp ?? ''),
    }))
    .filter(c => c.name && c.url)
}

// ─── 후보 선택 로직 ──────────────────────────────────────────────────────────

function scoreCandidateForYear(name: string, targetYear: number): number {
  // 파일명에 targetYear 포함 → 높은 점수
  if (name.includes(String(targetYear))) return 20
  // 최근 4년 이내 연도 포함
  for (let dy = 1; dy <= 4; dy++) {
    if (name.includes(String(targetYear - dy))) return 20 - dy * 2
  }
  return 0
}

function pickBestCandidate(
  candidates: ImageCandidate[],
  appearances: WhitelistEntry['worldsAppearances'],
): ImageCandidate | null {
  if (candidates.length === 0) return null

  const targetYear = appearances[0]?.year ?? 2023  // 최근 Worlds 연도 기준
  const teamSlug = (appearances[0]?.team ?? '').toLowerCase().replace(/\s+/g, '')

  let best: ImageCandidate | null = null
  let bestScore = -1

  for (const c of candidates) {
    const lname = c.name.toLowerCase()
    let score = scoreCandidateForYear(c.name, targetYear)

    // 팀명 패턴 포함 보너스
    if (teamSlug.length > 3 && lname.includes(teamSlug.slice(0, 4))) score += 3

    // 최신 업로드 보너스 (timestamp 기준 — 동점 시 최신 우선)
    // timestamp를 직접 비교하지 않고 score에 미세 보정
    if (c.timestamp > (best?.timestamp ?? '')) score += 0.1

    if (score > bestScore) {
      bestScore = score
      best = c
    }
  }

  return best
}

// ─── 이미지 다운로드 ─────────────────────────────────────────────────────────

async function downloadImage(url: string): Promise<Buffer | null> {
  let attempt = 0
  const delays = [2000, 4000, 8000]

  while (attempt <= delays.length) {
    try {
      const res = await throttledFetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = await res.arrayBuffer()
      return Buffer.from(buf)
    } catch (err) {
      if (attempt >= delays.length) return null
      await sleep(delays[attempt])
      attempt++
    }
  }
  return null
}

// ─── sharp 처리: 256px cover-crop + §3-4 ①번 페이드 적용 ───────────────────

function buildFadeSvg(): Buffer {
  // §3-4 ①번 기본안:
  //   • rgba(bg-base,.10) 전체 오버레이
  //   • linear-gradient(180deg, transparent 40%, rgba(bg-base,.65) 95%)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PHOTO_SIZE}" height="${PHOTO_SIZE}">
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="40%" stop-color="${BG_BASE_HEX}" stop-opacity="0"/>
      <stop offset="95%" stop-color="${BG_BASE_HEX}" stop-opacity="0.65"/>
    </linearGradient>
  </defs>
  <rect width="${PHOTO_SIZE}" height="${PHOTO_SIZE}" fill="${BG_BASE_HEX}" fill-opacity="0.10"/>
  <rect width="${PHOTO_SIZE}" height="${PHOTO_SIZE}" fill="url(#fade)"/>
</svg>`
  return Buffer.from(svg)
}

async function processImage(srcBuf: Buffer): Promise<Buffer> {
  const fadeSvg = buildFadeSvg()

  return sharp(srcBuf)
    .resize(PHOTO_SIZE, PHOTO_SIZE, { fit: 'cover', position: 'top' })
    .flatten({ background: BG_BASE_HEX })     // 소스 알파 제거 후 bg-base 배경
    .linear(1.03, -3.84)                      // CSS contrast(1.03) 근사
    .modulate({ brightness: 0.97 })           // CSS brightness(0.97) 근사
    .composite([{ input: fadeSvg, blend: 'over' }])
    .webp({ quality: 80 })
    .toBuffer()
}

// ─── 메인 ────────────────────────────────────────────────────────────────────

async function main() {
  // 승인 게이트 체크
  if (!fs.existsSync(APPROVED_FLAG)) {
    console.error(
      '중단: pipeline-cache/photo-whitelist-approved.txt 없음\n' +
      '  → photo-whitelist.json 검수 후 해당 파일 생성(내용 무관)으로 게이트 해제'
    )
    process.exit(1)
  }

  if (!fs.existsSync(WHITELIST_PATH)) {
    throw new Error('whitelist 없음 — 10-photo-whitelist.ts 먼저 실행')
  }

  const whitelist: WhitelistEntry[] = JSON.parse(fs.readFileSync(WHITELIST_PATH, 'utf-8'))
  console.log(`화이트리스트: ${whitelist.length}명`)

  // 기존 소스 기록 로드 (재실행 시 이미 처리된 항목 스킵)
  const sources: Record<string, { srcUrl: string; srcFilename: string; processed: string }> =
    fs.existsSync(SOURCES_PATH)
      ? JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf-8'))
      : {}

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  let done = 0, skipped = 0, failed = 0

  for (let i = 0; i < whitelist.length; i++) {
    const entry = whitelist[i]
    const outPath = path.join(OUTPUT_DIR, `${entry.playerId}.webp`)

    // 이미 처리된 항목은 스킵 (재실행 안전)
    if (fs.existsSync(outPath) && sources[entry.playerId]) {
      skipped++
      continue
    }

    process.stderr.write(`[${i + 1}/${whitelist.length}] ${entry.playerId} ...`)

    try {
      // 1. allimages 쿼리
      const candidates = await fetchAllimages(entry.playerId)
      const picked = pickBestCandidate(candidates, entry.worldsAppearances)

      if (!picked) {
        process.stderr.write(' 후보 없음 (스킵)\n')
        failed++
        continue
      }

      // 2. 이미지 다운로드
      const srcBuf = await downloadImage(picked.url)
      if (!srcBuf) {
        process.stderr.write(` 다운로드 실패: ${picked.name} (스킵)\n`)
        failed++
        continue
      }

      // 3. sharp 처리
      const webpBuf = await processImage(srcBuf)
      fs.writeFileSync(outPath, webpBuf)

      // 4. 소스 기록
      sources[entry.playerId] = {
        srcUrl: picked.url,
        srcFilename: picked.name,
        processed: new Date().toISOString(),
      }
      fs.writeFileSync(SOURCES_PATH, JSON.stringify(sources, null, 2), 'utf-8')

      process.stderr.write(` 완료 (${(webpBuf.length / 1024).toFixed(0)}KB ← ${picked.name})\n`)
      done++
    } catch (err) {
      process.stderr.write(` 오류: ${err}\n`)
      failed++
    }
  }

  console.log('\n=== 사진 다운로드 완료 ===')
  console.log(`성공: ${done} / 스킵(기존): ${skipped} / 실패: ${failed} / 합계: ${whitelist.length}`)
  console.log(`성공률: ${((done + skipped) / whitelist.length * 100).toFixed(1)}%`)
  console.log(`출력: public/players/{playerId}.webp`)
  console.log(`소스: pipeline-cache/image-sources.json`)

  if (failed > 0) {
    const failedIds = whitelist
      .filter(e => !fs.existsSync(path.join(OUTPUT_DIR, `${e.playerId}.webp`)))
      .map(e => e.playerId)
    console.log(`\n실패 목록 (${failed}명):`)
    failedIds.forEach(id => console.log(`  - ${id}`))
  }
}

main().catch(e => { process.stderr.write(`Fatal: ${e}\n`); process.exit(1) })
