// favicon 생성 (SVG→PNG via sharp)
// node scripts/gen-favicon.mjs
import sharp from 'sharp'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="#0f0f1a"/>
      <stop offset="100%" stop-color="#0a0a0f"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#f5d980"/>
      <stop offset="100%" stop-color="#b8942e"/>
    </linearGradient>
  </defs>

  <!-- Background: rounded square -->
  <rect width="512" height="512" rx="96" ry="96" fill="url(#bg)"/>

  <!-- Subtle inner border -->
  <rect x="12" y="12" width="488" height="488" rx="84" ry="84"
    fill="none" stroke="#ffffff" stroke-opacity="0.06" stroke-width="2"/>

  <!-- "GS" lettering -->
  <text x="256" y="326"
    font-family="Arial Black, Arial, sans-serif"
    font-size="252" font-weight="900" letter-spacing="-16"
    fill="url(#gold)" text-anchor="middle">GS</text>

  <!-- Bottom accent line -->
  <rect x="96" y="390" width="320" height="3" rx="2"
    fill="#b8942e" opacity="0.5"/>
</svg>`

const outPath = path.join(__dirname, '..', 'src', 'app', 'icon.png')

await sharp(Buffer.from(svg))
  .png()
  .toFile(outPath)
  .then(info => {
    console.log(`생성 완료: ${info.width}×${info.height}  ${(info.size / 1024).toFixed(1)} KB`)
    console.log(`→ ${outPath}`)
  })
