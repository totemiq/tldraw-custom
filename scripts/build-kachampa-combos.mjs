/**
 * Fusiona public/illustrations/kachampa/fondos/NN.svg + lineas/NN.svg
 * en combos/kachampa-fondo-linea-NN-combo.svg (misma convención que el combo 10).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const kachampa = join(root, 'public/illustrations/kachampa')
const outDir = join(kachampa, 'combos')
mkdirSync(outDir, { recursive: true })

function parseSvgDims(svg) {
  const w = svg.match(/\bwidth="([\d.]+)"/)?.[1]
  const h = svg.match(/\bheight="([\d.]+)"/)?.[1]
  const vb = svg.match(/viewBox="([^"]+)"/)?.[1]
  return { w: w ? parseFloat(w) : null, h: h ? parseFloat(h) : null, viewBox: vb }
}

/** Rutas de fondo visibles (imagetracer: excluir opacity 0). */
function extractFondoPaths(svg) {
  const paths = []
  const re = /<path\b([^>]*?)(?:\/>|>)/gi
  let m
  while ((m = re.exec(svg)) !== null) {
    const attrs = m[1]
    if (/\bopacity\s*=\s*["']0["']/.test(attrs)) continue
    const d = attrs.match(/\bd\s*=\s*"([^"]*)"/)?.[1]
    if (!d) continue
    const tr = attrs.match(/\btransform\s*=\s*"([^"]*)"/)?.[1]
    let el = `<path d="${d}"`
    if (tr) el += ` transform="${tr}"`
    el += `/>`
    paths.push(el)
  }
  return paths
}

/** Contenido interno del <svg> de líneas, sin fills negros (heredan de shape-stroke). */
function extractLineasInner(svg) {
  let s = svg.replace(/^\uFEFF?/, '')
  const i = s.search(/<svg\b/i)
  if (i < 0) throw new Error('No <svg>')
  const gt = s.indexOf('>', i)
  const end = s.lastIndexOf('</svg>')
  if (gt < 0 || end < 0) throw new Error('Malformed svg')
  let inner = s.slice(gt + 1, end).trim()
  inner = inner
    .replace(/\sfill="#000000"/gi, '')
    .replace(/\sfill='#000000'/gi, '')
    .replace(/\sfill="#000"/gi, '')
    .replace(/\sfill='#000'/gi, '')
    .replace(/\sfill="black"/gi, '')
    .replace(/\sfill='black'/gi, '')
    .replace(/\sfill="rgb\s*\(\s*0\s*,\s*0\s*,\s*0\s*\)"/gi, '')
  return inner
}

function buildCombo(n) {
  const pad = String(n).padStart(2, '0')
  const fondoPath = join(kachampa, 'fondos', `${pad}.svg`)
  const lineaPath = join(kachampa, 'lineas', `${pad}.svg`)
  const fondo = readFileSync(fondoPath, 'utf8')
  const linea = readFileSync(lineaPath, 'utf8')

  const dims = parseSvgDims(fondo)
  if (!dims.w || !dims.h) throw new Error(`fondo ${pad}: missing width/height`)

  const fondoPaths = extractFondoPaths(fondo)
  if (fondoPaths.length === 0) throw new Error(`fondo ${pad}: no visible paths`)

  const lineInner = extractLineasInner(linea)

  const viewBox = dims.viewBox || `0 0 ${dims.w} ${dims.h}`
  const out = `<svg xmlns="http://www.w3.org/2000/svg" width="${dims.w}" height="${dims.h}" viewBox="${viewBox}">
  <g class="shape-fill" fill="#ffffff" stroke="none">
    ${fondoPaths.join('\n    ')}
  </g>
  <g class="shape-stroke" fill="#000000" stroke="none">
    ${lineInner}
  </g>
</svg>
`

  const outFile = join(outDir, `kachampa-fondo-linea-${pad}-combo.svg`)
  writeFileSync(outFile, out, 'utf8')
  console.log('wrote', outFile)
  return { w: dims.w, h: dims.h, pad }
}

for (let n = 1; n <= 12; n++) {
  buildCombo(n)
}
