// §7.4 등급표 — 고정, 임의 수정 금지

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

  // CONTENDER: 국내 우승 1회 또는 Worlds 4강+
  // Worlds 4강+ 판단은 SimResult.steps에서 추론 — grade.ts는 trophies + worldsBest만 받음
  if (nationalWins >= 1) return 'CONTENDER'

  return 'REBUILD'  // 플옵/Worlds 진출 여부는 SimResult에서 판단 후 호출 측이 PLAYOFF TEAM 반환
}

// 호출 측에서 Worlds 4강+ 또는 플옵 진출 여부를 직접 판단해야 하는 경우를 위한 헬퍼
export function gradeWithWorldsAndPlayoff(params: {
  trophies: Trophy[]
  worldsBest: number | null    // 1=우승, 2=준우승, 3=4강, ... null=진출못함
  reachedPlayoff: boolean
  reachedWorlds: boolean
}): Grade {
  const { trophies, worldsBest, reachedPlayoff, reachedWorlds } = params
  const has = (t: Trophy) => trophies.includes(t)

  if (has('SPLIT1') && has('MSI') && has('SPLIT2') && has('WORLDS')) return 'GRAND SLAM'
  if (has('WORLDS')) return 'LEGENDARY'

  const nationalWins = [has('SPLIT1'), has('SPLIT2')].filter(Boolean).length
  if (has('MSI') || nationalWins >= 2) return 'ELITE'

  // Worlds 4강 이상 (worldsBest 1~4)
  if (worldsBest !== null && worldsBest <= 4) return 'CONTENDER'
  if (nationalWins >= 1) return 'CONTENDER'

  if (reachedPlayoff || reachedWorlds) return 'PLAYOFF TEAM'
  return 'REBUILD'
}
