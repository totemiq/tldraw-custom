#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const MANIFEST_PATH = path.join(ROOT, 'src', 'illustrationManifest.json')
const RENDERED_ROOT = path.join(ROOT, 'public', 'illustrations', 'rendered')

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function shellTool(name) {
  return execFileSync('which', [name], { encoding: 'utf8' }).trim()
}

const MAGICK = shellTool('magick')

function publicUrlToFilePath(url) {
  return path.join(ROOT, 'public', url.replace(/^\/+/, ''))
}

function renderedFilePathFromPiece(piece) {
  const rel = (piece.svgUrl || piece.strokePngUrl || piece.fillPngUrl)
    .replace(/^\/illustrations\//, '')
    .replace(/\.(svg|png)$/i, '.png')
  return path.join(RENDERED_ROOT, rel)
}

function toPublicUrl(filePath) {
  const rel = path.relative(path.join(ROOT, 'public'), filePath).split(path.sep).join('/')
  return `/${rel}`
}

function colorizeToTemp(srcPath, color) {
  const tempPath = path.join(ROOT, '.tmp', `${path.basename(srcPath, path.extname(srcPath))}-${color}.png`)
  ensureDir(path.dirname(tempPath))
  execFileSync(MAGICK, [
    srcPath,
    '-alpha',
    'on',
    '-channel',
    'RGB',
    '-fill',
    color,
    '-colorize',
    '100',
    tempPath,
  ])
  return tempPath
}

function buildRenderedPng(piece) {
  const strokePath = piece.strokePngUrl ? publicUrlToFilePath(piece.strokePngUrl) : ''
  const fillPath = piece.fillPngUrl ? publicUrlToFilePath(piece.fillPngUrl) : ''

  if (!strokePath && !fillPath) return ''
  if (strokePath && !fs.existsSync(strokePath) && (!fillPath || !fs.existsSync(fillPath))) return ''

  const outPath = renderedFilePathFromPiece(piece)
  ensureDir(path.dirname(outPath))

  const tempFiles = []
  try {
    const layers = []

    if (fillPath && fs.existsSync(fillPath)) {
      const fillTemp = colorizeToTemp(fillPath, 'white')
      tempFiles.push(fillTemp)
      layers.push(fillTemp)
    }

    if (strokePath && fs.existsSync(strokePath)) {
      const strokeTemp = colorizeToTemp(strokePath, 'black')
      tempFiles.push(strokeTemp)
      layers.push(strokeTemp)
    }

    if (layers.length === 0) return ''

    execFileSync(MAGICK, [...layers, '-background', 'none', '-layers', 'flatten', outPath])
    return toPublicUrl(outPath)
  } finally {
    for (const tempPath of tempFiles) {
      fs.rmSync(tempPath, { force: true })
    }
  }
}

function main() {
  ensureDir(RENDERED_ROOT)
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))

  for (const group of manifest.groups) {
    for (const piece of group.pieces) {
      const renderedUrl = buildRenderedPng(piece)
      if (renderedUrl) {
        piece.pngUrl = renderedUrl
      }
    }
  }

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  console.log(`Updated ${MANIFEST_PATH}`)
}

main()
