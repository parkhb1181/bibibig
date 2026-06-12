// Phase 1: cargoquery 클라이언트 — 스로틀 + 페이지네이션 + 재시도 + 파일 캐시
// §4.1 분할 전략: 호출 측이 WHERE를 (리그×연도) 또는 OverviewPage 단위로 분할해서 전달

import fs from 'fs'
import path from 'path'

export type CargoRow = Record<string, string>

const BASE = 'https://lol.fandom.com/api.php'
const UA = 'AllTimeDraftBot/1.0 (personal fan project; parkhb1181@gmail.com)'
const THROTTLE_MS = 5000
const PAGE_LIMIT = 500

// 모듈 전역 — 프로세스 내 모든 호출이 공유
let lastCallAt = 0
let consecutiveSuccess = 0

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms))
}

async function apiFetch(url: string): Promise<Response> {
  const wait = THROTTLE_MS - (Date.now() - lastCallAt)
  if (wait > 0) await sleep(wait)
  lastCallAt = Date.now()
  return fetch(url, { headers: { 'User-Agent': UA } })
}

interface RawCargo {
  cargoquery?: { title: Record<string, string> }[]
  error?: { code?: string; info?: string }
}

// 모든 재시도 가능 오류 공통 백오프 — 한도 초과 후 60s 고정 무한 (밤새 배치용)
const BACKOFF_STEPS = [60_000, 90_000, 120_000, 180_000, 240_000, 300_000]
const FIXED_RETRY_MS = 60_000

function backoffWait(attempt: number): number {
  return attempt < BACKOFF_STEPS.length ? BACKOFF_STEPS[attempt] : FIXED_RETRY_MS
}

async function fetchOnce(params: Record<string, string>): Promise<CargoRow[]> {
  const u = new URL(BASE)
  u.searchParams.set('action', 'cargoquery')
  u.searchParams.set('format', 'json')
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)

  let attempt = 0  // 재시도 횟수 (rate-limit·429·5xx·네트워크 오류 공통)

  while (true) {
    let res: Response
    try {
      res = await apiFetch(u.toString())
    } catch (e) {
      // 네트워크 오류 — 한도 없이 무한 재시도
      consecutiveSuccess = 0
      const wait = backoffWait(attempt++)
      process.stderr.write(`network error (attempt ${attempt}) — ${wait / 1000}s 대기: ${e}\n`)
      await sleep(wait)
      continue
    }

    // HTTP 429 또는 5xx — rate-limit/서버 오류, 무한 재시도
    if (res.status === 429 || res.status >= 500) {
      consecutiveSuccess = 0
      const wait = backoffWait(attempt++)
      process.stderr.write(`HTTP ${res.status} (attempt ${attempt}) — ${wait / 1000}s 대기\n`)
      await sleep(wait)
      continue
    }
    // 4xx (404·400 등) — 쿼리 자체 오류, 재시도 불가
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const json: RawCargo = await res.json()
    if (json.error) {
      if (json.error.code === 'ratelimited') {
        // JSON ratelimited 응답 — 무한 재시도
        consecutiveSuccess = 0
        const wait = backoffWait(attempt++)
        process.stderr.write(`ratelimited (attempt ${attempt}) — ${wait / 1000}s 대기\n`)
        await sleep(wait)
        continue
      }
      throw new Error(`Cargo: ${JSON.stringify(json.error)}`)
    }
    consecutiveSuccess++
    return (json.cargoquery ?? []).map(r => r.title)
  }
}

const CACHE_DIR = path.join(process.cwd(), 'pipeline-cache', 'cargo')

export function initCargo() {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
}

const FAILURES_FILE = path.join(process.cwd(), 'pipeline-cache', 'cargo-failures.json')

function recordFailure(cacheKey: string) {
  const list: string[] = fs.existsSync(FAILURES_FILE)
    ? JSON.parse(fs.readFileSync(FAILURES_FILE, 'utf-8'))
    : []
  if (!list.includes(cacheKey)) {
    list.push(cacheKey)
    fs.writeFileSync(FAILURES_FILE, JSON.stringify(list, null, 2), 'utf-8')
  }
}

// 단일 WHERE 분할에 대한 전체 페이지네이션 + 파일 캐시
// rate-limit 최대 재시도 후에도 실패 시: 빈 배열 반환 + cargo-failures.json 기록 (중단 없이 계속)
export async function cargoPaginate(
  params: Record<string, string>,
  cacheKey: string
): Promise<CargoRow[]> {
  const cacheFile = path.join(CACHE_DIR, `${cacheKey}.json`)
  if (fs.existsSync(cacheFile)) {
    return JSON.parse(fs.readFileSync(cacheFile, 'utf-8')) as CargoRow[]
  }

  const all: CargoRow[] = []
  let offset = 0
  process.stderr.write(`[cargo] ${cacheKey}\n`)

  // fetchOnce는 rate-limit·429·5xx·네트워크 오류를 무한 재시도 — throw하지 않음
  // 4xx·Cargo 오류만 throw (쿼리 자체 문제 → 상위로 전파)
  while (true) {
    const page = await fetchOnce({
      ...params,
      limit: String(PAGE_LIMIT),
      offset: String(offset),
    })
    all.push(...page)
    if (page.length < PAGE_LIMIT) break
    offset += PAGE_LIMIT
  }

  fs.writeFileSync(cacheFile, JSON.stringify(all, null, 2), 'utf-8')
  return all
}
