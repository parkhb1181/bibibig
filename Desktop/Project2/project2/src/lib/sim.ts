// §7 시뮬 엔진 — 순수 함수, UI 의존 없음, Phase 4 D3 선행 구현
// simRng = mulberry32((seed ^ 0x9E3779B9) >>> 0) — draftRng와 스트림 분리 필수 (§6.1)

import { mulberry32 } from './prng'
import { gradeWithWorldsAndPlayoff } from './grade'
import type { Grade, Trophy } from './grade'

export type { Grade, Trophy }

// §3 PlayerSeason 중 sim에서 필요한 필드만
export type SimPlayer = {
  playerId: string
  role: 'TOP' | 'JGL' | 'MID' | 'ADC' | 'SUP'
  ovr: number
}

// opponents-2026.json Opponent
export type Opponent = {
  name: string
  label: string
  league: string
  rating: number
}

export type SimStep = {
  stage: string
  label: string
  series?: { opp: string; score: string; win: boolean }[]
}

export type SimResult = {
  steps: SimStep[]
  trophies: Trophy[]
  grade: Grade
  teamOvr: number
}

// §7.1 역할 가중치 (합 5.0)
const ROLE_WEIGHT: Record<string, number> = {
  MID: 1.10, JGL: 1.10, ADC: 1.00, TOP: 0.95, SUP: 0.85,
}

// §9 Elo 스케일 (튜닝 파라미터)
const S = 40

function calcTeamOvr(picks: SimPlayer[]): number {
  // §7.1 — teamPower / 5 로 60~99 스케일 정규화
  const power = picks.reduce((sum, p) => sum + p.ovr * (ROLE_WEIGHT[p.role] ?? 1.0), 0)
  return power / 5
}

function winProb(myRating: number, oppRating: number): number {
  return 1 / (1 + Math.pow(10, (oppRating - myRating) / S))
}

function playSeries(
  format: 'bo1' | 'bo3' | 'bo5',
  myRating: number,
  oppRating: number,
  rng: () => number
): { wins: number; losses: number; win: boolean } {
  const needed = format === 'bo1' ? 1 : format === 'bo3' ? 2 : 3
  let wins = 0, losses = 0
  while (wins < needed && losses < needed) {
    if (rng() < winProb(myRating, oppRating)) wins++
    else losses++
  }
  return { wins, losses, win: wins >= needed }
}

// §7.2 비복원 추첨 — pool 복사본에서 제거하며 진행 (simRng 사용)
function drawOne(pool: Opponent[], rng: () => number): Opponent {
  const idx = Math.floor(rng() * pool.length)
  return pool.splice(idx, 1)[0]
}

// §7.2 봇 간 기대 승수 (72경기 시뮬 없이 레이팅 기대값으로 승수 부여)
function botExpectedWins(bots: Opponent[], userWinsPerBot: number[]): number[] {
  return bots.map((bot, i) => {
    const vsOthers = bots.reduce((sum, other, j) => {
      if (i === j) return sum
      return sum + 2 * winProb(bot.rating, other.rating)
    }, 0)
    const vsUser = 2 - (userWinsPerBot[i] ?? 0)
    return vsOthers + vsUser
  })
}

type Standing = { name: string; wins: number; rating: number; isUser: boolean }

function buildStandings(
  myOvr: number,
  userWinsTotal: number,
  regular: Opponent[],
  userWinsPerBot: number[]
): Standing[] {
  const botWins = botExpectedWins(regular, userWinsPerBot)
  const rows: Standing[] = [
    { name: '내 팀', wins: userWinsTotal, rating: myOvr, isUser: true },
    ...regular.map((opp, i) => ({ name: opp.name, wins: botWins[i], rating: opp.rating, isUser: false })),
  ]
  // 동률: 승수 내림차순 → rating 내림차순
  rows.sort((a, b) => b.wins - a.wins || b.rating - a.rating)
  return rows
}

function runDomesticSplit(
  splitLabel: string,
  myOvr: number,
  regular: Opponent[],
  rng: () => number
): {
  trophyWon: boolean
  reachedFinal: boolean
  reachedPlayoff: boolean
  steps: SimStep[]
} {
  const steps: SimStep[] = []
  const userWinsPerBot: number[] = []
  let userWinsTotal = 0
  const regularSeries: SimStep['series'] = []

  // 정규시즌: 9팀 × 2회 Bo1
  for (const opp of regular) {
    let winsVsThis = 0
    for (let g = 0; g < 2; g++) {
      const ser = playSeries('bo1', myOvr, opp.rating, rng)
      if (ser.win) { userWinsTotal++; winsVsThis++ }
      regularSeries.push({ opp: opp.name, score: ser.win ? '1-0' : '0-1', win: ser.win })
    }
    userWinsPerBot.push(winsVsThis)
  }

  const standings = buildStandings(myOvr, userWinsTotal, regular, userWinsPerBot)
  const userRank = standings.findIndex(s => s.isUser) + 1

  steps.push({
    stage: `${splitLabel}_regular`,
    label: `${splitLabel} 정규시즌 — ${userWinsTotal}승 ${18 - userWinsTotal}패 (${userRank}위)`,
    series: regularSeries,
  })

  if (userRank > 4) {
    steps.push({ stage: `${splitLabel}_missed`, label: `${splitLabel} 플옵 탈락 (${userRank}위)` })
    return { trophyWon: false, reachedFinal: false, reachedPlayoff: false, steps }
  }

  // 플옵 4강 — 1vs4 / 2vs3
  const top4 = standings.slice(0, 4)
  const userPos = top4.findIndex(s => s.isUser)
  const sfOppIdx = userPos === 0 ? 3 : userPos === 1 ? 2 : userPos === 2 ? 1 : 0
  const sfOpp = top4[sfOppIdx]

  const sf = playSeries('bo5', myOvr, sfOpp.rating, rng)
  steps.push({
    stage: `${splitLabel}_sf`,
    label: `${splitLabel} 플옵 4강 vs ${sfOpp.name}`,
    series: [{ opp: sfOpp.name, score: `${sf.wins}-${sf.losses}`, win: sf.win }],
  })

  if (!sf.win) {
    return { trophyWon: false, reachedFinal: false, reachedPlayoff: true, steps }
  }

  // 결승: 반대쪽 4강 승자 — 기대값으로 선택 (시뮬 없이 결정론)
  const other0 = top4[userPos < 2 ? 2 : 0]
  const other1 = top4[userPos < 2 ? 3 : 1]
  const finOpp = winProb(other0.rating, other1.rating) >= 0.5 ? other0 : other1

  const fin = playSeries('bo5', myOvr, finOpp.rating, rng)
  steps.push({
    stage: `${splitLabel}_final`,
    label: `${splitLabel} 결승 vs ${finOpp.name}`,
    series: [{ opp: finOpp.name, score: `${fin.wins}-${fin.losses}`, win: fin.win }],
  })

  return { trophyWon: fin.win, reachedFinal: true, reachedPlayoff: true, steps }
}

export function simulate(
  picks: SimPlayer[],
  opponents: { regular: Opponent[]; intl: Opponent[] },
  seed: number
): SimResult {
  // §6.1 simRng — (seed ^ 0x9E3779B9) 로 draftRng와 완전 분리
  const rng = mulberry32((seed ^ 0x9E3779B9) >>> 0)

  const myOvr = calcTeamOvr(picks)
  const steps: SimStep[] = []
  const trophies: Trophy[] = []
  let reachedPlayoff = false
  let reachedWorlds = false
  let worldsBest: number | null = null

  // ── Split 1 ───────────────────────────────────────────
  const s1 = runDomesticSplit('Split 1', myOvr, opponents.regular, rng)
  steps.push(...s1.steps)
  if (s1.reachedPlayoff) reachedPlayoff = true
  if (s1.trophyWon) trophies.push('SPLIT1')

  // ── MSI — Split 1 결승 진출 시에만 ────────────────────
  if (s1.reachedFinal) {
    const intlMsi = [...opponents.intl]
    let msiAlive = true
    let msiPlace = 1
    const msiRoundLabels = ['MSI 8강', 'MSI 4강', 'MSI 결승']

    for (let r = 0; r < 3; r++) {
      const opp = drawOne(intlMsi, rng)
      const ser = playSeries('bo5', myOvr, opp.rating, rng)
      steps.push({
        stage: `msi_r${r + 1}`,
        label: `${msiRoundLabels[r]} vs ${opp.name}`,
        series: [{ opp: opp.name, score: `${ser.wins}-${ser.losses}`, win: ser.win }],
      })
      if (!ser.win) {
        msiAlive = false
        msiPlace = r === 0 ? 5 : r === 1 ? 3 : 2
        break
      }
    }

    if (msiAlive) {
      trophies.push('MSI')
      steps.push({ stage: 'msi_win', label: 'MSI 우승' })
    } else {
      steps.push({ stage: 'msi_out', label: `MSI ${msiPlace}위 탈락` })
    }
  }

  // ── Split 2 ───────────────────────────────────────────
  const s2 = runDomesticSplit('Split 2', myOvr, opponents.regular, rng)
  steps.push(...s2.steps)
  if (s2.reachedPlayoff) reachedPlayoff = true
  if (s2.trophyWon) trophies.push('SPLIT2')

  // ── Worlds — Split 2 플옵 4강 이상(=플옵 진출) 시에만 ──
  if (s2.reachedPlayoff) {
    reachedWorlds = true
    const intlWorlds = [...opponents.intl]

    // 스위스 Bo3 — 3승 진출 / 3패 탈락 (최대 5라운드)
    let swissWins = 0, swissLosses = 0

    for (let r = 0; r < 5 && swissWins < 3 && swissLosses < 3; r++) {
      const opp = drawOne(intlWorlds, rng)
      const ser = playSeries('bo3', myOvr, opp.rating, rng)
      steps.push({
        stage: `worlds_swiss_r${r + 1}`,
        label: `Worlds 스위스 R${r + 1} vs ${opp.name}`,
        series: [{ opp: opp.name, score: `${ser.wins}-${ser.losses}`, win: ser.win }],
      })
      if (ser.win) swissWins++
      else swissLosses++
    }

    if (swissWins < 3) {
      steps.push({
        stage: 'worlds_swiss_out',
        label: `Worlds 스위스 탈락 (${swissWins}승 ${swissLosses}패)`,
      })
    } else {
      // 녹아웃: 8강/4강/결승 Bo5
      const koRounds = [
        { stage: 'worlds_qf', label: 'Worlds 8강', best: 8 },
        { stage: 'worlds_sf', label: 'Worlds 4강', best: 4 },
        { stage: 'worlds_final', label: 'Worlds 결승', best: 2 },
      ]

      let worldsAlive = true
      for (const kr of koRounds) {
        const opp = drawOne(intlWorlds, rng)
        const ser = playSeries('bo5', myOvr, opp.rating, rng)
        steps.push({
          stage: kr.stage,
          label: `${kr.label} vs ${opp.name}`,
          series: [{ opp: opp.name, score: `${ser.wins}-${ser.losses}`, win: ser.win }],
        })
        if (!ser.win) {
          worldsAlive = false
          worldsBest = kr.best
          break
        }
      }

      if (worldsAlive) {
        worldsBest = 1
        trophies.push('WORLDS')
        steps.push({ stage: 'worlds_win', label: 'Worlds 우승' })
      }
    }
  }

  const grade = gradeWithWorldsAndPlayoff({
    trophies, worldsBest, reachedPlayoff, reachedWorlds,
  })

  return {
    steps,
    trophies,
    grade,
    teamOvr: Math.round(myOvr),
  }
}
