#!/usr/bin/env node
/**
 * Regenera la biblioteca de ilustraciones desde cero.
 *
 * Salidas:
 * - public/illustrations/svg/<grupo>/*.svg           -> piezas de líneas
 * - public/illustrations/merged/<grupo>/*.svg        -> piezas fondo + línea
 * - src/illustrationManifest.json
 *
 * Los SVG merged son autocontenidos y usan máscaras internas con grupos
 * `shape-fill` y `shape-stroke`, para que tldraw pueda recolorear el fondo.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { imageSize } from 'image-size'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const SVG_OUT = path.join(ROOT, 'public', 'illustrations', 'svg')
const MERGED_OUT = path.join(ROOT, 'public', 'illustrations', 'merged')
const PNG_OUT = path.join(ROOT, 'public', 'illustrations', 'png')
const MANIFEST_OUT = path.join(ROOT, 'src', 'illustrationManifest.json')

const FONDOS_ENV = 'ILLUSTRATIONS_SOURCE_FONDOS'
const LINEAS_ENV = 'ILLUSTRATIONS_SOURCE_LINEAS'

const GROUP_KEY_ALIASES = new Map([
  ['mestiza ollantaytambo', 'mestiza ollanta'],
  ['mestiza de ollantaytambo', 'mestiza ollanta'],
  ['ukuko1', 'ukuko 1'],
  ['ukuko2', 'ukuko 2'],
])

function slugify(str) {
  return str
    .trim()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function stripDiacritics(str) {
  return str.normalize('NFD').replace(/\p{M}/gu, '')
}

function titleCase(str) {
  return str
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase())
}

function canonicalGroupKey(name) {
  const cleaned = stripDiacritics(name)
    .toLowerCase()
    .replace(/\bfonod\b/g, '')
    .replace(/\bfondo\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return GROUP_KEY_ALIASES.get(cleaned) ?? cleaned
}

function findDefaultSources(home) {
  const base = path.join(home, 'Downloads')
  const fondos = path.join(base, 'PNG POR GRUPOS FONDOS')
  const lineasCandidates = [
    path.join(base, 'PNG POR GRUPOS LINEAS '),
    path.join(base, 'PNG POR GRUPOS LINEAS'),
  ]

  const lineas = lineasCandidates.find((candidate) => fs.existsSync(candidate)) ?? null
  return { fondos, lineas }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function listDirectories(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

function listPngFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter((file) => /\.png$/i.test(file))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
}

function extractPieceKey(fileName) {
  const base = path.basename(fileName, path.extname(fileName))
  const normalized = stripDiacritics(base)
    .toLowerCase()
    .replace(/^copia de\s+/i, '')
    .replace(/_/g, ' ')
    .trim()

  const numericMatch = normalized.match(/(\d+(?:\.\d+)?)\s*f?$/i)
  if (numericMatch) return numericMatch[1]
  return normalized
}

function readImageMeta(dir, file) {
  const fullPath = path.join(dir, file)
  const buffer = fs.readFileSync(fullPath)
  const dim = imageSize(buffer)
  return {
    file,
    fullPath,
    buffer,
    key: extractPieceKey(file),
    width: dim.width ?? 1,
    height: dim.height ?? 1,
  }
}

function shellTool(name) {
  return execFileSync('which', [name], { encoding: 'utf8' }).trim()
}

const MAGICK = shellTool('magick')

function bufferToDataUri(buffer) {
  return `data:image/png;base64,${buffer.toString('base64')}`
}

function buildWhiteMaskDataUri(sourcePath) {
  const whiteMask = execFileSync(
    MAGICK,
    [
      sourcePath,
      '-alpha',
      'on',
      '-channel',
      'RGB',
      '-fill',
      'white',
      '-colorize',
      '100',
      'png:-',
    ],
    { encoding: 'buffer' },
  )

  return bufferToDataUri(whiteMask)
}

function buildStrokeSvg(meta) {
  const href = buildWhiteMaskDataUri(meta.fullPath)
  const maskId = `stroke-mask-${slugify(meta.file)}`

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${meta.height}" viewBox="0 0 ${meta.width} ${meta.height}">
  <defs>
    <mask id="${maskId}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" mask-type="alpha" x="0" y="0" width="${meta.width}" height="${meta.height}">
      <image width="${meta.width}" height="${meta.height}" href="${href}" preserveAspectRatio="xMidYMid meet" />
    </mask>
  </defs>
  <g class="shape-stroke" fill="#000000" stroke="none">
    <rect x="0" y="0" width="${meta.width}" height="${meta.height}" mask="url(#${maskId})" />
  </g>
</svg>
`
}

function buildMergedSvg(fillMeta, strokeMeta) {
  const fillHref = buildWhiteMaskDataUri(fillMeta.fullPath)
  const strokeHref = buildWhiteMaskDataUri(strokeMeta.fullPath)
  const fillMaskId = `fill-mask-${slugify(fillMeta.file)}`
  const strokeMaskId = `stroke-mask-${slugify(strokeMeta.file)}`

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${fillMeta.width}" height="${fillMeta.height}" viewBox="0 0 ${fillMeta.width} ${fillMeta.height}">
  <defs>
    <mask id="${fillMaskId}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" mask-type="alpha" x="0" y="0" width="${fillMeta.width}" height="${fillMeta.height}">
      <image width="${fillMeta.width}" height="${fillMeta.height}" href="${fillHref}" preserveAspectRatio="xMidYMid meet" />
    </mask>
    <mask id="${strokeMaskId}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" mask-type="alpha" x="0" y="0" width="${fillMeta.width}" height="${fillMeta.height}">
      <image width="${fillMeta.width}" height="${fillMeta.height}" href="${strokeHref}" preserveAspectRatio="xMidYMid meet" />
    </mask>
  </defs>
  <g class="shape-fill" fill="#ffffff" stroke="none">
    <rect x="0" y="0" width="${fillMeta.width}" height="${fillMeta.height}" mask="url(#${fillMaskId})" />
  </g>
  <g class="shape-stroke" fill="#000000" stroke="none">
    <rect x="0" y="0" width="${fillMeta.width}" height="${fillMeta.height}" mask="url(#${strokeMaskId})" />
  </g>
</svg>
`
}

function pairPieces(fondos, lineas, groupLabel) {
  const lineasByKey = new Map(lineas.map((item) => [item.key, item]))
  const usedLineas = new Set()
  const pairs = []

  for (const fondo of fondos) {
    const exact = lineasByKey.get(fondo.key)
    if (exact && exact.width === fondo.width && exact.height === fondo.height) {
      pairs.push({ orderKey: fondo.key, fondo, linea: exact })
      usedLineas.add(exact.file)
      continue
    }

    const matches = lineas.filter(
      (linea) =>
        !usedLineas.has(linea.file) &&
        linea.width === fondo.width &&
        linea.height === fondo.height,
    )

    if (matches.length === 1) {
      pairs.push({ orderKey: fondo.key, fondo, linea: matches[0] })
      usedLineas.add(matches[0].file)
      continue
    }

    throw new Error(`No pude emparejar "${fondo.file}" en ${groupLabel}`)
  }

  pairs.sort((a, b) => a.orderKey.localeCompare(b.orderKey, undefined, { numeric: true, sensitivity: 'base' }))
  return pairs
}

function writeFile(dir, name, content) {
  ensureDir(dir)
  fs.writeFileSync(path.join(dir, name), content, 'utf8')
}

function buildSingleGroups(lineasRoot) {
  const groups = []

  for (const dirName of listDirectories(lineasRoot).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))) {
    const key = canonicalGroupKey(dirName)
    const slug = slugify(key)
    const srcDir = path.join(lineasRoot, dirName)
    const outDir = path.join(SVG_OUT, slug)
    const files = listPngFiles(srcDir)

    const pieces = files.map((file) => {
      const meta = readImageMeta(srcDir, file)
      const baseName = path.basename(file, path.extname(file)).replace(/\s+/g, '_')
      const svgName = `${baseName}.svg`
      writeFile(outDir, svgName, buildStrokeSvg(meta))

      return {
        id: `${slug}-${slugify(baseName)}`,
        name: baseName,
        svgUrl: `/illustrations/svg/${slug}/${encodeURIComponent(svgName)}`,
        pngUrl: '',
        previewUrl: `/illustrations/svg/${slug}/${encodeURIComponent(svgName)}`,
        fillPngUrl: '',
        strokePngUrl: '',
        w: meta.width,
        h: meta.height,
      }
    })

    groups.push({
      id: slug,
      name: titleCase(key),
      coverUrl: pieces[0]?.svgUrl || '',
      guideUrl: pieces[0]?.svgUrl || '',
      pieces,
    })
  }

  return groups
}

function buildMergedGroups(fondosRoot, lineasRoot) {
  const groups = []
  const lineaDirsByKey = new Map(listDirectories(lineasRoot).map((name) => [canonicalGroupKey(name), name]))

  for (const fondoDirName of listDirectories(fondosRoot).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))) {
    const key = canonicalGroupKey(fondoDirName)
    const lineaDirName = lineaDirsByKey.get(key)
    if (!lineaDirName) throw new Error(`No existe carpeta de líneas para ${fondoDirName}`)

    const slug = slugify(key)
    const fondosDir = path.join(fondosRoot, fondoDirName)
    const lineasDir = path.join(lineasRoot, lineaDirName)
    const outDir = path.join(MERGED_OUT, slug)

    const fondos = listPngFiles(fondosDir).map((file) => readImageMeta(fondosDir, file))
    const lineas = listPngFiles(lineasDir).map((file) => readImageMeta(lineasDir, file))
    const pairs = pairPieces(fondos, lineas, titleCase(key))

    const pieces = pairs.map(({ orderKey, fondo, linea }) => {
      const svgName = `${slug}-${slugify(orderKey)}-combo.svg`
      writeFile(outDir, svgName, buildMergedSvg(fondo, linea))

      return {
        id: `${slug}-pieza-${slugify(orderKey)}`,
        name: `Pieza ${orderKey}`,
        svgUrl: `/illustrations/merged/${slug}/${encodeURIComponent(svgName)}`,
        pngUrl: '',
        previewUrl: `/illustrations/merged/${slug}/${encodeURIComponent(svgName)}`,
        fillPngUrl: '/merged',
        strokePngUrl: '',
        w: fondo.width,
        h: fondo.height,
      }
    })

    groups.push({
      id: `${slug}-fusionado`,
      name: `${titleCase(key)} Fondo + Linea`,
      coverUrl: pieces[0]?.svgUrl || '',
      guideUrl: pieces[0]?.svgUrl || '',
      pieces,
    })
  }

  return groups
}

function main() {
  const home = process.env.HOME || process.env.USERPROFILE || ''
  const defaults = findDefaultSources(home)
  const fondosRoot = process.env[FONDOS_ENV] || defaults.fondos
  const lineasRoot = process.env[LINEAS_ENV] || defaults.lineas

  if (!fondosRoot || !fs.existsSync(fondosRoot)) {
    console.error(`No encontré la carpeta de fondos. Use ${FONDOS_ENV} o coloque "PNG POR GRUPOS FONDOS" en Downloads.`)
    process.exit(1)
  }

  if (!lineasRoot || !fs.existsSync(lineasRoot)) {
    console.error(`No encontré la carpeta de líneas. Use ${LINEAS_ENV} o coloque "PNG POR GRUPOS LINEAS" en Downloads.`)
    process.exit(1)
  }

  fs.rmSync(SVG_OUT, { recursive: true, force: true })
  fs.rmSync(MERGED_OUT, { recursive: true, force: true })
  fs.rmSync(PNG_OUT, { recursive: true, force: true })
  ensureDir(SVG_OUT)
  ensureDir(MERGED_OUT)

  const singleGroups = buildSingleGroups(lineasRoot)
  const mergedGroups = buildMergedGroups(fondosRoot, lineasRoot)
  const manifest = { groups: [...singleGroups, ...mergedGroups] }

  fs.writeFileSync(MANIFEST_OUT, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  console.log(`Wrote ${manifest.groups.length} groups and ${manifest.groups.reduce((sum, group) => sum + group.pieces.length, 0)} pieces`)
}

main()
