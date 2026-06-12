// §8.2 Dynamic OG image — edge runtime, typography+shapes only (no images, no Korean fonts)
// /r generateMetadata computes and passes display values only via query:
// ?g={grade}&t={SPLIT1|MSI|...}&ovr={teamOvr}&l1..l5={name|ROLE|OVR}
export const runtime = 'edge'

import { ImageResponse } from 'next/og'
import type { NextRequest } from 'next/server'

// Grade accent colors (same as draft/page.tsx)
const GRADE_COLOR: Record<string, string> = {
  'GRAND SLAM':   '#ffd700',
  'LEGENDARY':    '#c090ff',
  'ELITE':        '#60c0ff',
  'CONTENDER':    '#40d4a0',
  'PLAYOFF TEAM': '#d0d8e8',
  'REBUILD':      '#5a6070',
}

// Font size — adjusted by character count
const GRADE_FONT_SIZE: Record<string, number> = {
  'GRAND SLAM':   100,
  'LEGENDARY':    118,
  'ELITE':        148,
  'CONTENDER':    112,
  'PLAYOFF TEAM':  80,
  'REBUILD':      132,
}

// Role label colors
const ROLE_COLOR: Record<string, string> = {
  TOP: '#ef9090',
  JGL: '#80e880',
  MID: '#80b8f0',
  ADC: '#f0d880',
  SUP: '#c888f0',
}

// Trophy labels (English only — §8.2)
const TROPHY_LABEL: Record<string, string> = {
  SPLIT1: 'SPRING',
  MSI:    'MSI',
  SPLIT2: 'SUMMER',
  WORLDS: 'WORLDS',
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams

  const grade    = sp.get('g') ?? 'REBUILD'
  const trophyRaw= sp.get('t') ?? ''
  const ovr      = sp.get('ovr') ?? '—'

  // l1..l5: "PlayerName|ROLE|OVR"
  const players = [1, 2, 3, 4, 5].map(n => {
    const raw = sp.get(`l${n}`) ?? ''
    const [name = '?', role = '?', ovrStr = '0'] = raw.split('|')
    return { name, role, ovr: parseInt(ovrStr, 10) || 0 }
  })

  const trophies  = trophyRaw ? trophyRaw.split('|').filter(Boolean) : []
  const trophyLine = trophies.map(t => TROPHY_LABEL[t] ?? t).join('  ·  ')

  const gradeColor    = GRADE_COLOR[grade]    ?? '#d0d8e8'
  const gradeFontSize = GRADE_FONT_SIZE[grade] ?? 100

  // Inter Black 900 — edge CDN cache (Latin subset, ~60KB)
  let fontData: ArrayBuffer | null = null
  try {
    fontData = await fetch(
      'https://cdn.jsdelivr.net/npm/@fontsource/inter/files/inter-latin-900-normal.woff2',
      { cache: 'force-cache' }
    ).then(r => r.arrayBuffer())
  } catch {
    // On load failure, fall back to default sans-serif (text still visible)
  }

  const fonts = fontData
    ? [{ name: 'Inter', data: fontData, weight: 900 as const, style: 'normal' as const }]
    : []

  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          background: 'linear-gradient(160deg, #0a1220 0%, #06090f 60%)',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: '"Inter", system-ui, sans-serif',
        }}
      >
        {/* ── Header bar ── */}
        <div
          style={{
            height: 52,
            borderBottom: '1px solid #1a2840',
            display: 'flex',
            alignItems: 'center',
            paddingLeft: 52,
            paddingRight: 52,
            justifyContent: 'space-between',
          }}
        >
          <span style={{ color: '#ffffff', fontSize: 18, fontWeight: 900, letterSpacing: '0.07em' }}>
            GRANDSLAM
          </span>
          <span style={{ color: '#243550', fontSize: 11, letterSpacing: '0.3em' }}>
            LOL ALL-TIME DRAFT
          </span>
        </div>

        {/* ── Center section: grade + trophies + OVR ── */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            paddingBottom: 8,
          }}
        >
          {/* Grade */}
          <div
            style={{
              fontSize: gradeFontSize,
              fontWeight: 900,
              color: gradeColor,
              letterSpacing: '-0.03em',
              lineHeight: 1,
            }}
          >
            {grade}
          </div>

          {/* Trophy line */}
          {trophyLine ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                marginTop: 22,
              }}
            >
              <div style={{ width: 48, height: 1, background: '#1a3050' }} />
              <span
                style={{
                  color: '#3a5578',
                  fontSize: 13,
                  fontWeight: 900,
                  letterSpacing: '0.28em',
                }}
              >
                {trophyLine}
              </span>
              <div style={{ width: 48, height: 1, background: '#1a3050' }} />
            </div>
          ) : (
            <div style={{ marginTop: 22, display: 'flex' }}>
              <span style={{ color: '#1e2d40', fontSize: 13, letterSpacing: '0.2em' }}>—</span>
            </div>
          )}

          {/* Team OVR */}
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 14,
              marginTop: 30,
            }}
          >
            <span style={{ color: '#243550', fontSize: 12, fontWeight: 900, letterSpacing: '0.25em' }}>
              TEAM OVR
            </span>
            <span
              style={{
                color: '#b8cce0',
                fontSize: 34,
                fontWeight: 900,
                letterSpacing: '-0.02em',
              }}
            >
              {ovr}
            </span>
          </div>
        </div>

        {/* ── Player strip ── */}
        <div
          style={{
            height: 186,
            borderTop: '1px solid #1a2840',
            background: '#070d18',
            display: 'flex',
          }}
        >
          {players.map((p, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                borderRight: i < 4 ? '1px solid #111c2c' : 'none',
              }}
            >
              {/* Role */}
              <span
                style={{
                  color: ROLE_COLOR[p.role] ?? '#3a5060',
                  fontSize: 10,
                  fontWeight: 900,
                  letterSpacing: '0.35em',
                  marginBottom: 4,
                }}
              >
                {p.role}
              </span>

              {/* OVR */}
              <span
                style={{
                  color: '#dce8f8',
                  fontSize: 52,
                  fontWeight: 900,
                  lineHeight: 1,
                  letterSpacing: '-0.03em',
                }}
              >
                {p.ovr}
              </span>

              {/* Player name */}
              <span
                style={{
                  color: '#4a6080',
                  fontSize: 12,
                  fontWeight: 900,
                  marginTop: 7,
                  maxWidth: 190,
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                }}
              >
                {p.name}
              </span>
            </div>
          ))}
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts,
    }
  )
}
