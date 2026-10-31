// Renders the app icon (a d20 with a quill on a dusk gradient) to build/icon.png and build/icon.ico.
// Run with `pnpm --filter @dnd/desktop icon`; the files are checked in, so builds do not need this.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import pngToIco from 'png-to-ico'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'build')

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7c3aed"/><stop offset="0.55" stop-color="#db2777"/><stop offset="1" stop-color="#f59e0b"/>
    </linearGradient>
    <linearGradient id="die" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e0e7ff"/>
    </linearGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="112" fill="url(#sky)"/>
  <polygon points="256,84 410,172 410,340 256,428 102,340 102,172" fill="url(#die)" stroke="#312e81" stroke-width="10" stroke-linejoin="round"/>
  <polygon points="256,150 352,318 160,318" fill="#c7d2fe" stroke="#312e81" stroke-width="8" stroke-linejoin="round"/>
  <path d="M256 84 L256 150 M102 172 L160 318 M410 172 L352 318 M256 428 L160 318 M256 428 L352 318 M102 172 L256 150 L410 172" stroke="#312e81" stroke-width="7" fill="none" stroke-linejoin="round"/>
  <text x="256" y="292" font-family="Georgia, serif" font-size="78" font-weight="700" text-anchor="middle" fill="#312e81">20</text>
  <path d="M394 96 C 340 150, 318 214, 312 268 L 324 272 C 346 222, 380 162, 430 118 Z" fill="#fef3c7" stroke="#92400e" stroke-width="6" stroke-linejoin="round"/>
  <path d="M312 268 L 300 300" stroke="#92400e" stroke-width="8" stroke-linecap="round"/>
</svg>`

mkdirSync(OUT, { recursive: true })
const render = (size) => new Resvg(SVG, { fitTo: { mode: 'width', value: size } }).render().asPng()
writeFileSync(join(OUT, 'icon.png'), render(512))
// macOS wants 1024px; electron-builder turns it into the .icns.
writeFileSync(join(OUT, 'icon-1024.png'), render(1024))
writeFileSync(join(OUT, 'icon.ico'), await pngToIco([16, 24, 32, 48, 64, 128, 256].map(render)))
console.log(`Icon written to ${OUT}`)
