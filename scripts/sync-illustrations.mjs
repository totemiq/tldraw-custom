#!/usr/bin/env node
/**
 * Copies PNG groups from a source folder, writes wrapper SVGs (lossless PNG embed via href),
 * and generates src/illustrationManifest.json for the app.
 *
 * Usage:
 *   node scripts/sync-illustrations.mjs [sourceDir]
 *   ILLUSTRATIONS_SOURCE=/path/to/PNG\ POR\ GRUPOS npm run illustrations:sync
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { imageSize } from 'image-size'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const OUT_PNG = path.join(ROOT, 'public', 'illustrations', 'png')
const OUT_SVG = path.join(ROOT, 'public', 'illustrations', 'svg')
const MANIFEST_OUT = path.join(ROOT, 'src', 'illustrationManifest.json')

function slugify(str) {
  return str
    .trim()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function titleCaseFolderName(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase())
}

function findDefaultSource(home) {
  const base = path.join(home, 'Downloads')
  const candidates = [
    path.join(base, 'PNG POR GRUPOS '),
    path.join(base, 'PNG POR GRUPOS'),
  ]
  for (const p of candidates) {
    try {
      if (fs.statSync(p).isDirectory()) return p
    } catch {
      /* skip */
    }
  }
  return null
}

function encodePathSegments(relPath) {
  return relPath
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
}

function main() {
  const home = process.env.HOME || process.env.USERPROFILE || ''
  const argSource = process.argv[2]
  const envSource = process.env.ILLUSTRATIONS_SOURCE
  const source =
    argSource || envSource || findDefaultSource(home)

  if (!source || !fs.existsSync(source)) {
    console.error(
      'Missing source folder. Pass path as argv, set ILLUSTRATIONS_SOURCE, or place "PNG POR GRUPOS" in Downloads.',
    )
    process.exit(1)
  }

  fs.rmSync(OUT_PNG, { recursive: true, force: true })
  fs.rmSync(OUT_SVG, { recursive: true, force: true })
  fs.mkdirSync(OUT_PNG, { recursive: true })
  fs.mkdirSync(OUT_SVG, { recursive: true })

  const entries = fs.readdirSync(source, { withFileTypes: true })
  const groupDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)

  if (groupDirs.length === 0) {
    console.error('No subfolders found in', source)
    process.exit(1)
  }

  groupDirs.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))

  const manifest = { groups: [] }

  for (const dirName of groupDirs) {
    const slug = slugify(dirName)
    if (!slug) continue

    const srcDir = path.join(source, dirName)
    const pngDir = path.join(OUT_PNG, slug)
    const svgDir = path.join(OUT_SVG, slug)
    fs.mkdirSync(pngDir, { recursive: true })
    fs.mkdirSync(svgDir, { recursive: true })

    const files = fs
      .readdirSync(srcDir)
      .filter((f) => /\.png$/i.test(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))

    if (files.length === 0) continue

    const pieces = []

    for (const file of files) {
      const srcPng = path.join(srcDir, file)
      const destPng = path.join(pngDir, file)
      fs.copyFileSync(srcPng, destPng)

      const buf = fs.readFileSync(destPng)
      const dim = imageSize(buf)
      const w = dim.width ?? 1
      const h = dim.height ?? 1

      const base = path.basename(file, path.extname(file))
      const pieceSlug = `${slug}-${slugify(base)}`
      const svgName = `${base}.svg`
      const destSvg = path.join(svgDir, svgName)

      const relPngFromSvg = path.posix.join('..', 'png', slug, file)
      const href = encodePathSegments(relPngFromSvg)

      const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <image width="${w}" height="${h}" href="${href}" preserveAspectRatio="xMidYMid meet"/>
</svg>
`
      fs.writeFileSync(destSvg, svg, 'utf8')

      const pngUrl = `/illustrations/png/${slug}/${encodeURIComponent(file)}`
      const svgUrl = `/illustrations/svg/${slug}/${encodeURIComponent(svgName)}`

      pieces.push({
        id: pieceSlug,
        name: base.replace(/_/g, ' ').trim() || base,
        pngUrl,
        svgUrl,
        w,
        h,
      })
    }

    const coverUrl = pieces[0].pngUrl
    manifest.groups.push({
      id: slug,
      name: titleCaseFolderName(dirName),
      coverUrl,
      guideUrl: coverUrl,
      pieces,
    })
  }

  fs.writeFileSync(MANIFEST_OUT, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  console.log(`Wrote ${manifest.groups.length} groups, manifest → ${path.relative(ROOT, MANIFEST_OUT)}`)
}

main()
