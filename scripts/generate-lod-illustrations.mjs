#!/usr/bin/env node

// Genera copias reducidas (niveles de detalle) de las ilustraciones para no
// decodificar imágenes de 7000 px cuando la pieza se muestra a 300 px.
// Los originales no se tocan: las copias van a public/illustrations/lod/<nivel>/
// con la misma ruta relativa, y src/illustrationLod.json dice qué niveles existen.
// En los SVG solo se reducen los PNG embebidos; la geometría (viewBox, width,
// height de cada <image>) queda idéntica.
// Volver a correrlo (npm run illustrations:lod) al agregar o cambiar
// ilustraciones; lo que no tenga copias se sigue mostrando con la original.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { imageSize } from 'image-size'

const run = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const MANIFEST_PATH = path.join(ROOT, 'src', 'illustrationManifest.json')
const LOD_MANIFEST_PATH = path.join(ROOT, 'src', 'illustrationLod.json')
const LOD_ROOT = path.join(ROOT, 'public', 'illustrations', 'lod')

// Deben coincidir con los que lee src/illustrationLod.ts
const CANVAS_LEVELS = [512, 1024, 2048]
const THUMB_LEVELS = [1024]

const MAGICK = execFileSync('which', ['magick'], { encoding: 'utf8' }).trim()
const CONCURRENCY = Math.max(2, Math.min(8, os.cpus().length))

function publicUrlToRel(url) {
  return decodeURIComponent(String(url).replace(/^\/+/, ''))
}

function lodFilePath(rel, level) {
  return path.join(LOD_ROOT, String(level), rel.replace(/^illustrations\//, ''))
}

async function resizeRaster(src, dest, level) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const args = [src, '-filter', 'Lanczos', '-resize', `${level}x${level}>`]
  if (/\.jpe?g$/i.test(dest)) args.push('-quality', '92')
  args.push(dest)
  await run(MAGICK, args)
}

async function resizePngBuffer(buffer, level) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lod-'))
  try {
    const src = path.join(tmpDir, 'in.png')
    const dest = path.join(tmpDir, 'out.png')
    fs.writeFileSync(src, buffer)
    await resizeRaster(src, dest, level)
    return fs.readFileSync(dest)
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

const EMBEDDED_PNG = /href="data:image\/png;base64,([A-Za-z0-9+/=]+)"/g

async function processRaster(rel, levels) {
  const src = path.join(ROOT, 'public', rel)
  const { width, height } = imageSize(fs.readFileSync(src))
  const longest = Math.max(width, height)
  const made = []
  for (const level of levels) {
    if (level >= longest) continue
    await resizeRaster(src, lodFilePath(rel, level), level)
    made.push(level)
  }
  return made.length ? { w: width, h: height, levels: made } : null
}

async function processSvg(rel, levels) {
  const src = path.join(ROOT, 'public', rel)
  const text = fs.readFileSync(src, 'utf8')
  const embedded = [...text.matchAll(EMBEDDED_PNG)].map((m) => Buffer.from(m[1], 'base64'))
  if (embedded.length === 0) return null

  const dims = embedded.map((buffer) => imageSize(buffer))
  const width = Math.max(...dims.map((d) => d.width))
  const height = Math.max(...dims.map((d) => d.height))
  const longest = Math.max(width, height)
  const made = []
  for (const level of levels) {
    if (level >= longest) continue
    const resized = []
    for (const buffer of embedded) resized.push(await resizePngBuffer(buffer, level))
    let i = 0
    const out = text.replace(EMBEDDED_PNG, () => `href="data:image/png;base64,${resized[i++].toString('base64')}"`)
    const dest = lodFilePath(rel, level)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, out, 'utf8')
    made.push(level)
  }
  return made.length ? { w: width, h: height, levels: made } : null
}

function collectJobs(manifest) {
  const jobs = new Map()
  const add = (url, levels) => {
    if (!url) return
    const rel = publicUrlToRel(url)
    if (!rel.startsWith('illustrations/') || rel.startsWith('illustrations/lod/')) return
    if (!fs.existsSync(path.join(ROOT, 'public', rel))) return
    const prev = jobs.get(rel)
    jobs.set(rel, [...new Set([...(prev ?? []), ...levels])].sort((a, b) => a - b))
  }

  for (const group of manifest.groups) {
    add(group.coverUrl, CANVAS_LEVELS)
    add(group.guideUrl, CANVAS_LEVELS)
    // Solo las piezas que ofrece el selector (las "merged", coloreables).
    const colorable = group.pieces.some((piece) => String(piece.svgUrl || '').includes('/illustrations/merged/'))
    if (!colorable) continue
    for (const piece of group.pieces) {
      add(piece.svgUrl, CANVAS_LEVELS)
      add(piece.fillPngUrl, CANVAS_LEVELS)
      add(piece.strokePngUrl, CANVAS_LEVELS)
      add(piece.pngUrl, THUMB_LEVELS)
    }
  }
  return jobs
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
  const jobs = [...collectJobs(manifest).entries()]
  fs.rmSync(LOD_ROOT, { recursive: true, force: true })

  const lod = {}
  let done = 0
  const queue = [...jobs]
  async function worker() {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const [rel, levels] = job
      const entry = /\.svg$/i.test(rel) ? await processSvg(rel, levels) : await processRaster(rel, levels)
      if (entry) lod[`/${rel}`] = [entry.w, entry.h, entry.levels]
      done += 1
      if (done % 50 === 0 || done === jobs.length) console.log(`${done}/${jobs.length}`)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  const sorted = Object.fromEntries(Object.entries(lod).sort(([a], [b]) => a.localeCompare(b)))
  fs.writeFileSync(LOD_MANIFEST_PATH, JSON.stringify(sorted) + '\n', 'utf8')
  console.log(`Updated ${LOD_MANIFEST_PATH} (${Object.keys(sorted).length} entries)`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
