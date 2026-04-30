#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const MANIFEST_PATH = path.join(ROOT, 'src', 'illustrationManifest.json')
const MASKS_ROOT = path.join(ROOT, 'public', 'illustrations', 'masks')

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function writeMaskFromSvg(svgFilePath, outputBasePath) {
  const svg = fs.readFileSync(svgFilePath, 'utf8')
  const matches = [...svg.matchAll(/<image\b[^>]*href="data:image\/png;base64,([^"]+)"/gi)]

  if (matches.length === 0) {
    return { pngUrl: '', fillPngUrl: '', strokePngUrl: '' }
  }

  ensureDir(path.dirname(outputBasePath))

  if (matches.length === 1) {
    const strokePath = `${outputBasePath}-stroke.png`
    fs.writeFileSync(strokePath, Buffer.from(matches[0][1], 'base64'))
    return { pngUrl: '', fillPngUrl: '', strokePngUrl: toPublicUrl(strokePath) }
  }

  const fillPath = `${outputBasePath}-fill.png`
  const strokePath = `${outputBasePath}-stroke.png`
  fs.writeFileSync(fillPath, Buffer.from(matches[0][1], 'base64'))
  fs.writeFileSync(strokePath, Buffer.from(matches[1][1], 'base64'))
  return { pngUrl: '', fillPngUrl: toPublicUrl(fillPath), strokePngUrl: toPublicUrl(strokePath) }
}

function toPublicUrl(filePath) {
  const rel = path.relative(path.join(ROOT, 'public'), filePath).split(path.sep).join('/')
  return `/${rel}`
}

function toLocalSvgPath(svgUrl) {
  return path.join(ROOT, 'public', svgUrl.replace(/^\/+/, ''))
}

function maskOutputBase(svgUrl) {
  const rel = svgUrl
    .replace(/^\/illustrations\//, '')
    .replace(/\.svg$/i, '')
    .split('/')
    .join(path.sep)
  return path.join(MASKS_ROOT, rel)
}

function main() {
  ensureDir(MASKS_ROOT)
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))

  for (const group of manifest.groups) {
    for (const piece of group.pieces) {
      if (!piece.svgUrl) continue
      const svgPath = toLocalSvgPath(piece.svgUrl)
      if (!fs.existsSync(svgPath)) continue

      const urls = writeMaskFromSvg(svgPath, maskOutputBase(piece.svgUrl))
      piece.pngUrl = urls.pngUrl
      piece.fillPngUrl = urls.fillPngUrl
      piece.strokePngUrl = urls.strokePngUrl
    }
  }

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  console.log(`Updated ${MANIFEST_PATH}`)
}

main()
