// npx tsx scripts/09c-check-ovr.ts 90
// 주의: PowerShell에서 "90> main"처럼 쓰면 90이 OVR이 아니라 리다이렉트로 해석됨 → NaN·0% 발생
import fs from 'fs'
import path from 'path'
import { simulate, getEloScale } from '../src/lib/sim'
import type { SimPlayer, Opponent, Trophy } from '../src/lib/sim'

const ROLES = ['TOP', 'JGL', 'MID', 'ADC', 'SUP'] as const
const N = 20_000

function parseOvrs(): number[] {
  const nums = process.argv.slice(2).map(a => Number(a)).filter(n => Number.isFinite(n) && n > 0)
  if (nums.length > 0) return nums
  if (process.argv.length > 2) {
    console.error(`[오류] OVR 인자가 숫자가 아닙니다: ${JSON.stringify(process.argv.slice(2))}`)
    console.error('  올바른 예: npx tsx scripts/09c-check-ovr.ts 90')
    console.error('  잘못된 예: npx tsx scripts/09c-check-ovr.ts 90> main  (← git push 잔여 입력)')
    process.exit(1)
  }
  return [90, 95]
}

const ovrs = parseOvrs()

const opponents: { regular: Opponent[]; msi: Opponent[]; worlds: Opponent[] } = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'opponents-2026.json'), 'utf-8')
)

function run(ovr: number) {
  const team: SimPlayer[] = ROLES.map(r => ({ playerId: `t_${r}`, role: r, ovr }))
  let split1 = 0, msi = 0, split2 = 0, worlds = 0, full4 = 0
  const grades = new Map<string, number>()
  for (let i = 0; i < N; i++) {
    const res = simulate(team, opponents, (i * 2_654_435_761 + 0xABCDEF) >>> 0)
    const has = (t: Trophy) => res.trophies.includes(t)
    if (has('SPLIT1')) split1++
    if (has('MSI')) msi++
    if (has('SPLIT2')) split2++
    if (has('WORLDS')) worlds++
    if (has('SPLIT1') && has('MSI') && has('SPLIT2') && has('WORLDS')) full4++
    grades.set(res.grade, (grades.get(res.grade) ?? 0) + 1)
  }
  const pct = (n: number) => ((n / N) * 100).toFixed(1)
  console.log(`\n=== 전원 ${ovr} OVR (n=${N.toLocaleString()}, S=${getEloScale()}, intl 70+초과분×1.15) ===`)
  console.log(`  Spring Split   ${pct(split1)}%`)
  console.log(`  MSI            ${pct(msi)}%`)
  console.log(`  Summer Split   ${pct(split2)}%`)
  console.log(`  Worlds         ${pct(worlds)}%`)
  console.log(`  4대 트로피 전부 ${pct(full4)}%  ← 진짜 풀 그랜드슬램`)
  console.log(`  등급 GRAND SLAM ${pct(grades.get('GRAND SLAM') ?? 0)}%  ← UI 등급(완화 컷 적용)`)
}

for (const o of ovrs) run(o)
