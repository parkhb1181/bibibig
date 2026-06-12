'use client'
// §6.2 PlayerCard — size variant: 'pick' | 'slot' | 'result'
// Colors/materials via CSS variables only (no hardcoding until DESIGN_GUIDE tokens finalized)
// §5 kill-switch: NEXT_PUBLIC_PHOTOS_ENABLED=false → all avatar fallback

import { useState } from 'react'
import type { PlayerSeason } from '@/lib/data'

function photoSrc(player: PlayerSeason): string | null {
  if (process.env.NEXT_PUBLIC_PHOTOS_ENABLED === 'false') return null
  return player.photo ?? null
}

export type CardSize = 'pick' | 'slot' | 'result'

type Props = {
  player: PlayerSeason
  size?: CardSize
  disabled?: boolean
  onClick?: () => void
}

// pick: 모바일 w-28 5:8. 데스크톱 9:16 세로형 + .draft-pick-w
const SIZE_CLS: Record<CardSize, string> = {
  pick:   'w-28 aspect-[5/8] md:flex-none md:aspect-[9/16] draft-pick-w',
  slot:   'w-20 h-28',
  result: 'w-32 h-44',
}

const OVR_SIZE: Record<CardSize, string> = {
  pick:   'text-2xl',
  slot:   'text-lg',
  result: 'text-3xl',
}

// Desktop (md+): one step up from mobile; slot stays compact (header use)
const NAME_SIZE_CLS: Record<CardSize, string> = {
  pick:   'text-[11px] md:text-[12px]',
  slot:   'text-[9px]',
  result: 'text-[11px] md:text-[13px]',
}
const META_SIZE_CLS: Record<CardSize, string> = {
  pick:   'text-[8px] md:text-[9px]',
  slot:   'text-[8px]',
  result: 'text-[8px] md:text-[10px]',
}

const ROLE_ABBR: Record<string, string> = {
  TOP: 'TOP', JGL: 'JGL', MID: 'MID', ADC: 'ADC', SUP: 'SUP',
}

// League badge colors — prioritize quick recognition
const LEAGUE_BADGE: Record<string, string> = {
  LCK: 'bg-red-900/70 text-red-300',
  LPL: 'bg-blue-900/70 text-blue-300',
  LEC: 'bg-purple-900/70 text-purple-300',
  LCS: 'bg-orange-900/70 text-orange-300',
}

function avatarBg(teamSlug: string): string {
  const h = [...teamSlug].reduce((acc, c) => acc + c.charCodeAt(0), 0)
  const hues = [210, 150, 30, 280, 350, 190, 60, 320]
  return `hsl(${hues[h % hues.length]}, 40%, 35%)`
}

export default function PlayerCard({ player, size = 'pick', disabled = false, onClick }: Props) {
  const [imgError, setImgError] = useState(false)

  // pick 카드만 데스크톱에서 컨테이너 쿼리(cqw)로 텍스트 비례 확대 (globals.css .pc-pick)
  const pick = size === 'pick'

  const name = player.nameEn
  const isWorlds = player.frame === 'WORLDS'
  const hasMsi = player.msiWinner
  const isWorldsMvp = player.worldsMvp  // awards.csv WORLDS_MVP 기준
  const badges = player.badges

  // Card background gradient: Worlds → blue, MSI → gold, default → dark
  const cardBg = isWorlds
    ? 'bg-gradient-to-b from-[#0a1a3a] to-[#1a1a2e]'
    : hasMsi
    ? 'bg-gradient-to-b from-[#251800] to-[#1a1a2e]'
    : 'bg-[var(--card-bg,#1a1a2e)]'

  // Border: Worlds → gold, MSI → amber, default
  const cardBorder = isWorlds
    ? 'border-[var(--card-worlds-border,#c0a060)] shadow-[0_0_12px_var(--card-worlds-glow,#c0a06055)]'
    : hasMsi
    ? 'border-[#a07820] shadow-[0_0_8px_#a0782030]'
    : 'border-[var(--card-border,#2a2a4a)]'

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        SIZE_CLS[size],
        pick ? 'pc-pick' : '',
        'group relative flex flex-col rounded-lg overflow-hidden select-none',
        cardBg,
        'border',
        cardBorder,
        disabled
          ? 'opacity-40 cursor-not-allowed'
          : 'cursor-pointer active:scale-95 transition-transform',
      ].join(' ')}
      aria-label={`${player.nameEn} ${player.year} ${player.team}`}
    >
      {/* WORLDS shimmer sweep */}
      {isWorlds && (
        <span className="absolute inset-0 z-10 pointer-events-none overflow-hidden rounded-lg" aria-hidden>
          <span className="absolute inset-y-0 w-full animate-[shimmer_2.5s_linear_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        </span>
      )}

      {/* MSI gold shimmer */}
      {hasMsi && !isWorlds && (
        <span className="absolute inset-0 z-10 pointer-events-none overflow-hidden rounded-lg" aria-hidden>
          <span className="absolute inset-y-0 w-full animate-[shimmer_3.5s_linear_infinite] bg-gradient-to-r from-transparent via-[#ffd70020] to-transparent" />
        </span>
      )}

      {/* Top-left: OVR + role */}
      <div className="absolute top-1 left-1.5 z-20 flex flex-col leading-none">
        <span
          className={`${OVR_SIZE[size]} font-black text-[var(--card-ovr,#f0f0f0)] ${pick ? 'pc-ovr' : ''}`}
          style={{ textShadow: '0 1px 6px rgba(0,0,0,0.95), 0 0 12px rgba(0,0,0,0.8)' }}
        >
          {player.ovr}
        </span>
        <span className={`text-[10px] font-semibold text-[var(--card-role,#a0a0c0)] uppercase tracking-wider ${pick ? 'pc-role' : ''}`}>
          {ROLE_ABBR[player.role] ?? player.role}
        </span>
      </div>

      {/* Top-right: league badge (always) + All-Pro badge (if applicable) */}
      <div className="absolute top-1 right-1 z-20 flex flex-col gap-0.5">
        <span className={`text-[7px] font-bold px-1 py-0.5 rounded-sm uppercase leading-none ${pick ? 'pc-badge ' : ''}${LEAGUE_BADGE[player.league] ?? 'bg-[var(--card-badge-bg,#2a4a8a)] text-[var(--card-badge-text,#80aaff)]'}`}>
          {player.league}
        </span>
        {badges.includes('ALLPRO_1ST') && (
          <span className={`text-[7px] font-bold bg-yellow-900/70 text-yellow-300 px-1 py-0.5 rounded-sm leading-none text-center ${pick ? 'pc-badge' : ''}`}>
            1st
          </span>
        )}
      </div>

      {/* Center: photo / avatar */}
      {/* Plain <img> — avoids Next.js Image Optimizer R2 onError fallback bug */}
      {/* overflow-hidden: clips group-hover:scale-110 within photo area (button has it too, but intermediate div breaks compositing clip) */}
      <div className="flex-1 relative w-full overflow-hidden" data-photo={player.photo ?? 'null'}>
        {photoSrc(player) && !imgError ? (
          <img
            src={photoSrc(player)!}
            alt={player.nameEn}
            className="absolute inset-0 w-full h-full object-cover object-top transition-transform duration-300 group-hover:scale-110 origin-top"
            onError={() => setImgError(true)}
          />
        ) : (
          <div
            className="absolute inset-0 flex items-center justify-center text-white/80 font-black text-2xl transition-transform duration-300 group-hover:scale-110"
            style={{ background: avatarBg(player.teamSlug) }}
          >
            {player.nameEn.charAt(0).toUpperCase()}
          </div>
        )}
        {/* 하단 스크림 — 사진 색상과 무관하게 하단 텍스트 가독성 보장 */}
        <div
          className="absolute inset-0 z-10 pointer-events-none"
          style={{ background: 'linear-gradient(180deg, transparent 40%, rgba(10,14,26,.85) 95%)' }}
          aria-hidden
        />
        {/* MVP overlay — WORLDS MVP만 표시 (FINALS MVP 배지 없음) */}
        {isWorldsMvp && (
          <div className="absolute bottom-0 inset-x-0 z-20 flex justify-center pb-0.5">
            <span className={`text-[7px] font-black text-sky-200 tracking-[0.12em] uppercase bg-sky-900/80 px-1.5 py-0.5 rounded-sm leading-none ${pick ? 'pc-badge' : ''}`}>
              WORLDS MVP
            </span>
          </div>
        )}
      </div>

      {/* Bottom: name + team · year */}
      <div className="px-1.5 pb-1.5 pt-1 bg-[var(--card-footer-bg,#0d0d1a)]">
        <p className={`text-center text-[var(--card-name,#e8e8f0)] font-semibold truncate leading-tight ${NAME_SIZE_CLS[size]} ${pick ? 'pc-name' : ''}`}>
          {name}
        </p>
        <p className={`text-center text-[var(--card-meta,#9090b8)] truncate ${META_SIZE_CLS[size]} ${pick ? 'pc-meta' : ''}`}>
          {player.team} · {player.year}
        </p>
      </div>
    </button>
  )
}
