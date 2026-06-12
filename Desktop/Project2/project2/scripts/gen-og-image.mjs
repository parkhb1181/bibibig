// 임시 OG 이미지 생성 (SVG→PNG via sharp)
// npx node scripts/gen-og-image.mjs
import sharp from 'sharp'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="#0a0a0f"/>
      <stop offset="100%" stop-color="#0d0d20"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#b8942e"/>
      <stop offset="50%"  stop-color="#f5d980"/>
      <stop offset="100%" stop-color="#b8942e"/>
    </linearGradient>
    <linearGradient id="line" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#1a3a6a" stop-opacity="0"/>
      <stop offset="30%"  stop-color="#2a5aaa" stop-opacity="1"/>
      <stop offset="70%"  stop-color="#b8942e" stop-opacity="1"/>
      <stop offset="100%" stop-color="#b8942e" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bg)"/>

  <!-- Subtle grid -->
  <line x1="0"    y1="210" x2="1200" y2="210" stroke="#ffffff" stroke-opacity="0.025" stroke-width="1"/>
  <line x1="0"    y1="420" x2="1200" y2="420" stroke="#ffffff" stroke-opacity="0.025" stroke-width="1"/>
  <line x1="400"  y1="0"   x2="400"  y2="630" stroke="#ffffff" stroke-opacity="0.025" stroke-width="1"/>
  <line x1="800"  y1="0"   x2="800"  y2="630" stroke="#ffffff" stroke-opacity="0.025" stroke-width="1"/>

  <!-- Corner accent dots -->
  <circle cx="80"   cy="80"  r="2" fill="#2a5aaa" opacity="0.5"/>
  <circle cx="1120" cy="80"  r="2" fill="#b8942e" opacity="0.5"/>
  <circle cx="80"   cy="550" r="2" fill="#b8942e" opacity="0.5"/>
  <circle cx="1120" cy="550" r="2" fill="#2a5aaa" opacity="0.5"/>

  <!-- Top label -->
  <text x="600" y="192"
    font-family="Arial Black, Arial, sans-serif"
    font-size="13" font-weight="700" letter-spacing="8"
    fill="#ffffff" fill-opacity="0.22" text-anchor="middle">
    LOL ALL-TIME DRAFT SIMULATOR
  </text>

  <!-- Top divider -->
  <rect x="100" y="207" width="1000" height="1" fill="url(#line)"/>

  <!-- Main title -->
  <text x="600" y="378"
    font-family="Arial Black, Arial, sans-serif"
    font-size="148" font-weight="900" letter-spacing="-6"
    fill="url(#gold)" text-anchor="middle">
    GRANDSLAM
  </text>

  <!-- Subtitle -->
  <text x="600" y="444"
    font-family="Arial, sans-serif"
    font-size="20" font-weight="400" letter-spacing="4"
    fill="#ffffff" fill-opacity="0.32" text-anchor="middle">
    DRAFT · SIMULATE · COMPETE
  </text>

  <!-- Bottom divider -->
  <rect x="100" y="488" width="1000" height="1" fill="url(#line)"/>

  <!-- Role row -->
  <text x="600" y="528"
    font-family="Arial, sans-serif"
    font-size="11" font-weight="400" letter-spacing="5"
    fill="#ffffff" fill-opacity="0.16" text-anchor="middle">
    TOP  ·  JUNGLE  ·  MID  ·  ADC  ·  SUPPORT
  </text>
</svg>`

const outPath = path.join(__dirname, '..', 'public', 'og-image.png')

await sharp(Buffer.from(svg))
  .png()
  .toFile(outPath)
  .then(info => {
    console.log(`생성 완료: ${info.width}×${info.height}  ${(info.size / 1024).toFixed(1)} KB`)
    console.log(`→ ${outPath}`)
  })
