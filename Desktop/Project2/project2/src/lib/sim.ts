// §7 Simulation engine — pure function, no UI dependency
// simRng = mulberry32((seed ^ 0x9E3779B9) >>> 0) — must be separate stream from draftRng (§6.1)

import { mulberry32 } from './prng'
import { gradeWithWorldsAndPlayoff } from './grade'
import type { Grade, Trophy } from './grade'

export type { Grade, Trophy }

// Fields from §3 PlayerSeason needed by sim
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
  series?: { opp: string; score: string; win: boolean; games?: boolean[] }[]
}

export type SimResult = {
  steps: SimStep[]
  trophies: Trophy[]
  grade: Grade
  teamOvr: number
}

// §7.1 Role weights (sum 5.0)
const ROLE_WEIGHT: Record<string, number> = {
  MID: 1.10, JGL: 1.10, ADC: 1.00, TOP: 0.95, SUP: 0.85,
}

// §9 Elo scale — 기본 10 (2026-06 v2: 90 OVR 트로피 확률 ~2×, S=14 대비)
let _eloScale = 10
export function setEloScale(s: number): void { _eloScale = s }
export function getEloScale(): number { return _eloScale }

function ord(n: number): string {
  const v = n % 100
  if (v >= 11 && v <= 13) return 'th'
  const r = n % 10
  return r === 1 ? 'st' : r === 2 ? 'nd' : r === 3 ? 'rd' : 'th'
}

function calcTeamOvr(picks: SimPlayer[]): number {
  // §7.1 — normalize to 60~99 scale: teamPower / 5
  const power = picks.reduce((sum, p) => sum + p.ovr * (ROLE_WEIGHT[p.role] ?? 1.0), 0)
  return power / 5
}

function winProb(myRating: number, oppRating: number): number {
  return 1 / (1 + Math.pow(10, (oppRating - myRating) / _eloScale))
}

function playSeries(
  format: 'bo1' | 'bo3' | 'bo5',
  myRating: number,
  oppRating: number,
  rng: () => number
): { wins: number; losses: number; win: boolean; games: boolean[] } {
  const needed = format === 'bo1' ? 1 : format === 'bo3' ? 2 : 3
  let wins = 0, losses = 0
  const games: boolean[] = []
  while (wins < needed && losses < needed) {
    const gameWin = rng() < winProb(myRating, oppRating)
    games.push(gameWin)
    if (gameWin) wins++
    else losses++
  }
  return { wins, losses, win: wins >= needed, games }
}

// §7.2 Non-replacement draw — remove from pool copy as we draw (simRng)
function drawOne(pool: Opponent[], rng: () => number): Opponent {
  const idx = Math.floor(rng() * pool.length)
  return pool.splice(idx, 1)[0]
}

// §7.2 Bot expected wins (assign wins via rating expectation instead of simulating 72 bot games)
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
    { name: 'My Team', wins: userWinsTotal, rating: myOvr, isUser: true },
    ...regular.map((opp, i) => ({ name: opp.label, wins: botWins[i], rating: opp.rating, isUser: false })),
  ]
  // Tiebreak: wins desc → rating desc
  rows.sort((a, b) => b.wins - a.wins || b.rating - a.rating)
  return rows
}

function runDomesticSplit(
  splitLabel: string,  // 'Spring' or 'Summer'
  myOvr: number,
  regular: Opponent[],
  rng: () => number
): {
  trophyWon: boolean
  reachedFinal: boolean
  reachedPlayoff: boolean
  regularRank: number
  steps: SimStep[]
} {
  const steps: SimStep[] = []
  const userWinsPerBot: number[] = []
  let userWinsTotal = 0
  const regularSeries: SimStep['series'] = []

  // Regular season: 9 teams × 2 Bo3 games each
  for (const opp of regular) {
    let winsVsThis = 0
    for (let g = 0; g < 2; g++) {
      const ser = playSeries('bo3', myOvr, opp.rating, rng)
      if (ser.win) { userWinsTotal++; winsVsThis++ }
      regularSeries.push({ opp: opp.label, score: `${ser.wins}-${ser.losses}`, win: ser.win, games: ser.games })
    }
    userWinsPerBot.push(winsVsThis)
  }

  const standings = buildStandings(myOvr, userWinsTotal, regular, userWinsPerBot)
  const userRank = standings.findIndex(s => s.isUser) + 1

  steps.push({
    stage: `${splitLabel}_regular`,
    label: `${splitLabel} Regular — ${userWinsTotal}W ${18 - userWinsTotal}L (${userRank}${ord(userRank)} Place)`,
    series: regularSeries,
  })

  if (userRank > 4) {
    steps.push({
      stage: `${splitLabel}_missed`,
      label: `${splitLabel} Playoffs DNQ (${userRank}${ord(userRank)} Place)`,
    })
    return { trophyWon: false, reachedFinal: false, reachedPlayoff: false, regularRank: userRank, steps }
  }

  // Playoffs: 1v4 / 2v3 semifinal
  const top4 = standings.slice(0, 4)
  const userPos = top4.findIndex(s => s.isUser)
  const sfOppIdx = userPos === 0 ? 3 : userPos === 1 ? 2 : userPos === 2 ? 1 : 0
  const sfOpp = top4[sfOppIdx]

  const sf = playSeries('bo5', myOvr, sfOpp.rating, rng)
  steps.push({
    stage: `${splitLabel}_sf`,
    label: `${splitLabel} Playoffs SF vs ${sfOpp.name}`,
    series: [{ opp: sfOpp.name, score: `${sf.wins}-${sf.losses}`, win: sf.win, games: sf.games }],
  })

  if (!sf.win) {
    return { trophyWon: false, reachedFinal: false, reachedPlayoff: true, regularRank: userRank, steps }
  }

  // Finals: other-side SF winner — determined by expected value (deterministic)
  const other0 = top4[userPos < 2 ? 2 : 0]
  const other1 = top4[userPos < 2 ? 3 : 1]
  const finOpp = winProb(other0.rating, other1.rating) >= 0.5 ? other0 : other1

  const fin = playSeries('bo5', myOvr, finOpp.rating, rng)
  steps.push({
    stage: `${splitLabel}_final`,
    label: `${splitLabel} Finals vs ${finOpp.name}`,
    series: [{ opp: finOpp.name, score: `${fin.wins}-${fin.losses}`, win: fin.win, games: fin.games }],
  })

  return { trophyWon: fin.win, reachedFinal: true, reachedPlayoff: true, regularRank: userRank, steps }
}

export function simulate(
  picks: SimPlayer[],
  opponents: { regular: Opponent[]; msi: Opponent[]; worlds: Opponent[] },
  seed: number
): SimResult {
  // §6.1 simRng — separate stream from draftRng via (seed ^ 0x9E3779B9)
  const rng = mulberry32((seed ^ 0x9E3779B9) >>> 0)

  const myOvr = calcTeamOvr(picks)
  const steps: SimStep[] = []
  const trophies: Trophy[] = []
  let reachedPlayoff = false
  let reachedWorlds = false
  let worldsBest: number | null = null

  // ── Spring Split ──────────────────────────────────────
  const s1 = runDomesticSplit('Spring', myOvr, opponents.regular, rng)
  steps.push(...s1.steps)
  if (s1.reachedPlayoff) reachedPlayoff = true
  if (s1.trophyWon) trophies.push('SPLIT1')

  // ── MSI — only if reached Spring Finals ──────────────
  if (s1.reachedFinal) {
    const intlMsi = [...opponents.msi]
    let msiAlive = true
    let msiPlace = 1
    const msiRoundLabels = ['MSI QF', 'MSI SF', 'MSI Finals']

    for (let r = 0; r < 3; r++) {
      const opp = drawOne(intlMsi, rng)
      const ser = playSeries('bo5', myOvr, opp.rating, rng)
      steps.push({
        stage: `msi_r${r + 1}`,
        label: `${msiRoundLabels[r]} vs ${opp.label}`,
        series: [{ opp: opp.label, score: `${ser.wins}-${ser.losses}`, win: ser.win, games: ser.games }],
      })
      if (!ser.win) {
        msiAlive = false
        msiPlace = r === 0 ? 5 : r === 1 ? 3 : 2
        break
      }
    }

    if (msiAlive) {
      trophies.push('MSI')
      steps.push({ stage: 'msi_win', label: 'MSI Champions' })
    } else {
      steps.push({ stage: 'msi_out', label: `MSI Eliminated (${msiPlace}${ord(msiPlace)})` })
    }
  }

  // ── Summer Split ──────────────────────────────────────
  const s2 = runDomesticSplit('Summer', myOvr, opponents.regular, rng)
  steps.push(...s2.steps)
  if (s2.reachedPlayoff) reachedPlayoff = true
  if (s2.trophyWon) trophies.push('SPLIT2')

  // ── Worlds — only if reached Summer Playoffs ─────────
  if (s2.reachedPlayoff) {
    reachedWorlds = true
    const intlWorlds = [...opponents.worlds]

    // Swiss Bo3 — advance at 3W, eliminate at 3L (up to 5 rounds)
    let swissWins = 0, swissLosses = 0

    for (let r = 0; r < 5 && swissWins < 3 && swissLosses < 3; r++) {
      const opp = drawOne(intlWorlds, rng)
      const ser = playSeries('bo3', myOvr, opp.rating, rng)
      steps.push({
        stage: `worlds_swiss_r${r + 1}`,
        label: `Worlds Swiss R${r + 1} vs ${opp.label}`,
        series: [{ opp: opp.label, score: `${ser.wins}-${ser.losses}`, win: ser.win, games: ser.games }],
      })
      if (ser.win) swissWins++
      else swissLosses++
    }

    if (swissWins < 3) {
      steps.push({
        stage: 'worlds_swiss_out',
        label: `Worlds Swiss Eliminated (${swissWins}W-${swissLosses}L)`,
      })
    } else {
      // Knockout: QF/SF/Finals Bo5
      const koRounds = [
        { stage: 'worlds_qf',    label: 'Worlds QF',     best: 8 },
        { stage: 'worlds_sf',    label: 'Worlds SF',     best: 4 },
        { stage: 'worlds_final', label: 'Worlds Finals', best: 2 },
      ]

      let worldsAlive = true
      for (const kr of koRounds) {
        const opp = drawOne(intlWorlds, rng)
        const ser = playSeries('bo5', myOvr, opp.rating, rng)
        steps.push({
          stage: kr.stage,
          label: `${kr.label} vs ${opp.label}`,
          series: [{ opp: opp.label, score: `${ser.wins}-${ser.losses}`, win: ser.win, games: ser.games }],
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
        steps.push({ stage: 'worlds_win', label: 'Worlds Champions' })
      }
    }
  }

  const grade = gradeWithWorldsAndPlayoff({
    trophies,
    worldsBest,
    reachedPlayoff,
    reachedWorlds,
    bestRegularRank: Math.min(s1.regularRank, s2.regularRank),
    msiParticipated: s1.reachedFinal,
  })

  return {
    steps,
    trophies,
    grade,
    teamOvr: Math.round(myOvr),
  }
}
