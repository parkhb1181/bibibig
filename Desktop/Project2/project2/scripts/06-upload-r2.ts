// Phase 2: R2 업로드 + players.json photo 갱신
// 입력: pipeline-cache/images-webp/{id}.webp, pipeline-cache/image-sources.json
// 출력: R2 players/{id}.webp 업로드, public/data/players.json photo 필드 갱신

import fs from 'fs'
import path from 'path'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import type { ImageSourceEntry } from './05-images'
import type { PlayerSeason } from '../src/lib/data'

async function main() {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET
  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) {
    throw new Error('R2 환경변수 누락 (.env.local 확인): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL')
  }

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  })

  const WEBP_DIR = path.join(process.cwd(), 'pipeline-cache', 'images-webp')
  const sourcesPath = path.join(process.cwd(), 'pipeline-cache', 'image-sources.json')

  if (!fs.existsSync(sourcesPath)) {
    throw new Error('image-sources.json 없음 — npx tsx scripts/05-images.ts 먼저 실행')
  }

  const sources: ImageSourceEntry[] = JSON.parse(fs.readFileSync(sourcesPath, 'utf-8'))
  console.log(`업로드 대상: ${sources.length}건`)

  let ok = 0, fail = 0
  const uploadedIds = new Set<string>()

  for (const entry of sources) {
    const webpPath = path.join(WEBP_DIR, `${entry.id}.webp`)
    if (!fs.existsSync(webpPath)) {
      process.stderr.write(`  webp 없음 skip: ${entry.id}\n`)
      fail++
      continue
    }

    const key = `players/${entry.id}.webp`
    try {
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: fs.readFileSync(webpPath),
        ContentType: 'image/webp',
        CacheControl: 'public, max-age=31536000, immutable',
      }))
      uploadedIds.add(entry.id)
      ok++
      if (ok % 100 === 0) process.stderr.write(`  업로드 ${ok}/${sources.length}\n`)
    } catch (e) {
      process.stderr.write(`  업로드 실패 ${entry.id}: ${e}\n`)
      fail++
    }
  }

  const successRate = ok + fail > 0 ? ((ok / (ok + fail)) * 100).toFixed(1) : '0.0'
  console.log(`업로드: ${ok}건 성공, ${fail}건 실패 (성공률 ${successRate}%)`)

  // players.json photo 필드 갱신 (§5.4: {R2_PUBLIC_BASE_URL}/{파일명})
  const playersPath = path.join(process.cwd(), 'public', 'data', 'players.json')
  const players: PlayerSeason[] = JSON.parse(fs.readFileSync(playersPath, 'utf-8'))
  let updated = 0

  for (const ps of players) {
    if (uploadedIds.has(ps.id)) {
      // as 사용: photo는 string|null이며 업로드 성공 확인 후 string 할당
      ;(ps as { photo: string | null }).photo = `${publicBaseUrl}/players/${ps.id}.webp`
      updated++
    }
  }

  fs.writeFileSync(playersPath, JSON.stringify(players, null, 2), 'utf-8')
  console.log(`players.json photo 갱신: ${updated}건`)

  // §5 DoD: 임의 샘플 5건 R2 URL 출력
  const samples = sources.filter(s => uploadedIds.has(s.id)).slice(0, 5)
  if (samples.length) {
    console.log('\n샘플 5건 R2 URL (브라우저 로드 확인):')
    for (const s of samples) {
      console.log(`  ${publicBaseUrl}/players/${s.id}.webp`)
    }
  }

  const passFail = parseFloat(successRate) >= 70 ? '✅' : '⚠️'
  console.log(`\n${passFail} Phase 2 업로드 완료 (목표 ≥ 70%)`)
}

main().catch(e => { process.stderr.write(`Fatal: ${e}\n`); process.exit(1) })
