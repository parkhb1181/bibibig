// §7.4 Grade table — fixed, do not modify

export type Grade =
  | 'GRAND SLAM'
  | 'LEGENDARY'
  | 'ELITE'
  | 'CONTENDER'
  | 'PLAYOFF TEAM'
  | 'REBUILD'

export type Trophy = 'SPLIT1' | 'MSI' | 'SPLIT2' | 'WORLDS'

export function determineGrade(trophies: Trophy[]): Grade {
  const has = (t: Trophy) => trophies.includes(t)

  if (has('SPLIT1') && has('MSI') && has('SPLIT2') && has('WORLDS')) return 'GRAND SLAM'
  if (has('WORLDS')) return 'LEGENDARY'

  const nationalWins = [has('SPLIT1'), has('SPLIT2')].filter(Boolean).length
  if (has('MSI') || nationalWins >= 2) return 'ELITE'

  // CONTENDER: 1 domestic title or Worlds top 4
  // Worlds top-4 inference is done via worldsBest in the caller
  if (nationalWins >= 1) return 'CONTENDER'

  return 'REBUILD'  // playoff/Worlds qualification evaluated in gradeWithWorldsAndPlayoff
}

// Helper for callers that need to check Worlds top-4 or playoff qualification directly
export function gradeWithWorldsAndPlayoff(params: {
  trophies: Trophy[]
  worldsBest: number | null    // 1=Champion, 2=Runner-up, 3/4=SF, ... null=DNQ
  reachedPlayoff: boolean
  reachedWorlds: boolean
}): Grade {
  const { trophies, worldsBest, reachedPlayoff, reachedWorlds } = params
  const has = (t: Trophy) => trophies.includes(t)

  if (has('SPLIT1') && has('MSI') && has('SPLIT2') && has('WORLDS')) return 'GRAND SLAM'
  if (has('WORLDS')) return 'LEGENDARY'

  const nationalWins = [has('SPLIT1'), has('SPLIT2')].filter(Boolean).length
  if (has('MSI') || nationalWins >= 2) return 'ELITE'

  // Worlds top 4 (worldsBest 1~4)
  if (worldsBest !== null && worldsBest <= 4) return 'CONTENDER'
  if (nationalWins >= 1) return 'CONTENDER'

  if (reachedPlayoff || reachedWorlds) return 'PLAYOFF TEAM'
  return 'REBUILD'
}
