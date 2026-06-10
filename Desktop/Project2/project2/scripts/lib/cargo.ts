// Phase 1: cargoquery 클라이언트 — 스로틀 + 페이지네이션 + 재시도 + 파일 캐시
// §4.1 분할 전략: 호출 측이 WHERE를 (리그×연도) 또는 OverviewPage 단위로 분할해서 전달

import fs from 'fs'
import path from 'path'

export type CargoRow = Record<string, string>

const BASE = 'https://lol.fandom.com/api.php'
const UA = 'AllTimeDraftBot/1.0 (personal fan project; parkhb1181@gmail.com)'
const THROTTLE_MS = 1000
const PAGE_LIMIT = 500

// 모듈 전역 — 프로세스 내 모든 호출이 공유
let lastCallAt = 0

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

async function fetchOnce(params: Record<string, string>): Promise<CargoRow[]> {
  const u = new URL(BASE)
  u.searchParams.set('action', 'cargoquery')
  u.searchParams.set('format', 'json')
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)

  for (let attempt = 0; attempt < 4; attempt++) {
    let res: Response
    try {
      res = await apiFetch(u.toString())
    } catch (e) {
      throw new Error(`network: ${e instanceof Error ? e.message : String(e)}`)
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const json: RawCargo = await res.json()
    if (json.error) {
      if (json.error.code === 'ratelimited') {
        const wait = [10_000, 20_000, 40_000][attempt] ?? 40_000
        process.stderr.write(`ratelimited — ${wait / 1000}s 대기\n`)
        await sleep(wait)
        continue
      }
      throw new Error(`Cargo: ${JSON.stringify(json.error)}`)
    }
    return (json.cargoquery ?? []).map(r => r.title)
  }
  throw new Error('ratelimited after retries')
}

const CACHE_DIR = path.join(process.cwd(), 'pipeline-cache', 'cargo')

export function initCargo() {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
}

// 단일 WHERE 분할에 대한 전체 페이지네이션 + 파일 캐시
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
