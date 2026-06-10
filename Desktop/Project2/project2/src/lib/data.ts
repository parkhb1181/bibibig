import { z } from 'zod'

// §3 스키마 — 변경 금지

const RoleSchema = z.enum(['TOP', 'JGL', 'MID', 'ADC', 'SUP'])
const LeagueCodeSchema = z.enum(['LCK', 'LPL', 'LEC', 'LCS'])
export type Role = z.infer<typeof RoleSchema>

export const PlayerSeasonSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+_\d{4}_[a-z0-9-]+$/),
  playerId: z.string(),
  nameEn: z.string(),
  nameKo: z.string().nullable(),
  team: z.string(),
  teamSlug: z.string(),
  year: z.number().int().min(2013).max(2025),
  league: LeagueCodeSchema,
  role: RoleSchema,
  ovr: z.number().int().min(60).max(99),
  frame: z.enum(['WORLDS', 'NORMAL']),
  crown: z.boolean(),
  msiWinner: z.boolean(),
  photo: z.string().nullable(),
  badges: z.array(z.enum(['LEAGUE_CHAMP', 'ALLPRO_1ST'])).max(2),
})
export type PlayerSeason = z.infer<typeof PlayerSeasonSchema>

export const TeamYearSchema = z.object({
  key: z.string(),
  team: z.string(),
  teamSlug: z.string(),
  year: z.number().int().min(2013).max(2025),
  league: z.string(),
  roster: z.array(z.string()),
  rolesAvailable: z.array(RoleSchema),
  weight: z.number().int().min(1).max(8),
})
export type TeamYear = z.infer<typeof TeamYearSchema>

export const OpponentSchema = z.object({
  name: z.string(),
  league: z.string(),
  rating: z.number(),
})

export const OpponentsFileSchema = z.object({
  regular: z.array(OpponentSchema).length(9),
  intl: z.array(OpponentSchema).min(12),
})
export type OpponentsFile = z.infer<typeof OpponentsFileSchema>
