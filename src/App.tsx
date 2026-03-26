import { useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Tldraw,
  useEditor,
  DefaultToolbar,
  StateNode,
  SelectToolbarItem,
  HandToolbarItem,
  DrawToolbarItem,
  EraserToolbarItem,
  ArrowToolbarItem,
  TextToolbarItem,
  NoteToolbarItem,
  AssetToolbarItem,
  FrameToolbarItem,
  LaserToolbarItem,
  HighlightToolbarItem,
  RectangleToolbarItem,
  EllipseToolbarItem,
  TriangleToolbarItem,
  DiamondToolbarItem,
  HexagonToolbarItem,
  OvalToolbarItem,
  RhombusToolbarItem,
  StarToolbarItem,
  CloudToolbarItem,
  HeartToolbarItem,
  XBoxToolbarItem,
  CheckBoxToolbarItem,
  ArrowLeftToolbarItem,
  ArrowUpToolbarItem,
  ArrowDownToolbarItem,
  ArrowRightToolbarItem,
  LineToolbarItem,
} from 'tldraw'
import type { TLComponents } from 'tldraw'
import 'tldraw/tldraw.css'

let globBucketColor = '#e53e3e'

function hexToRgb(hex: string): [number, number, number] {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return r ? [parseInt(r[1], 16), parseInt(r[2], 16), parseInt(r[3], 16)] : [0, 0, 0]
}
function getExteriorMask(data: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const isExt = new Uint8Array(w * h)
  const stack: number[] = []

  const isBg = (i: number) => {
    const a = data[i + 3]
    if (a < 128) return true 
    if (a >= 128 && data[i] > 240 && data[i+1] > 240 && data[i+2] > 240) return true 
    return false
  }

  for (let x = 0; x < w; x++) {
    if (isBg(x * 4)) { stack.push(x); isExt[x] = 1 }
    if (isBg(((h - 1) * w + x) * 4)) { stack.push((h - 1) * w + x); isExt[(h - 1) * w + x] = 1 }
  }
  for (let y = 0; y < h; y++) {
    if (isBg((y * w) * 4)) { stack.push(y * w); isExt[y * w] = 1 }
    if (isBg((y * w + w - 1) * 4)) { stack.push(y * w + w - 1); isExt[y * w + w - 1] = 1 }
  }

  while(stack.length) {
    const pos = stack.pop()!
    const x = pos % w, y = (pos / w) | 0
    const neighbors = []
    if (x + 1 < w) neighbors.push(pos + 1)
    if (x - 1 >= 0) neighbors.push(pos - 1)
    if (y + 1 < h) neighbors.push(pos + w)
    if (y - 1 >= 0) neighbors.push(pos - w)

    for (const n of neighbors) {
      if (!isExt[n] && isBg(n * 4)) {
        isExt[n] = 1
        stack.push(n)
      }
    }
  }
  return isExt
}

function floodFillOnlyColor(sourceData: Uint8ClampedArray, w: number, h: number, sx: number, sy: number, fillR: number, fillG: number, fillB: number, exteriorMask: Uint8Array) {
  const outData = new Uint8ClampedArray(w * h * 4)
  if (sx < 0 || sx >= w || sy < 0 || sy >= h) return outData
  
  const startPos = sy * w + sx
  if (exteriorMask[startPos] === 1) return outData

  const base = startPos * 4
  const tA = sourceData[base + 3]
  const tR = sourceData[base], tG = sourceData[base + 1], tB = sourceData[base + 2]

  if (tA > 128 && tR < 80 && tG < 80 && tB < 80) return outData

  const targetTransparent = tA < 128
  const TOL = 50

  const match = (i: number) => {
    const a = sourceData[i + 3]
    if (targetTransparent) return a < 128
    return a > 128 && Math.abs(sourceData[i] - tR) <= TOL && Math.abs(sourceData[i + 1] - tG) <= TOL && Math.abs(sourceData[i + 2] - tB) <= TOL
  }

  const isOutline = (i: number) => sourceData[i + 3] > 128 && sourceData[i] < 80 && sourceData[i + 1] < 80 && sourceData[i + 2] < 80

  const visited = new Uint8Array(w * h)
  const stack: number[] = [startPos]

  while (stack.length) {
    const pos = stack.pop()!
    if (visited[pos]) continue
    visited[pos] = 1
    
    if (exteriorMask[pos] === 1) continue

    const x = pos % w, y = (pos / w) | 0
    const i = pos * 4
    
    if (isOutline(i)) {
      outData[i] = fillR; outData[i + 1] = fillG; outData[i + 2] = fillB; outData[i + 3] = 255
      continue
    }

    if (!match(i)) continue
    
    outData[i] = fillR; outData[i + 1] = fillG; outData[i + 2] = fillB; outData[i + 3] = 255
    if (x + 1 < w) stack.push(pos + 1)
    if (x - 1 >= 0) stack.push(pos - 1)
    if (y + 1 < h) stack.push(pos + w)
    if (y - 1 >= 0) stack.push(pos - w)
  }
  return outData
}

async function applyBucketColor(editor: any, color: string) {
  const pointer = editor.inputs.currentPagePoint
  const shape = editor.getShapeAtPoint(pointer, { margin: 2, hitInside: true })
  if (!shape || shape.type !== 'image') return

  const assetId = (shape.props as any).assetId
  const asset = editor.getAsset(assetId)
  if (!asset) return

  const src = asset.props.src as string
  const isSvg = asset.props.mimeType === 'image/svg+xml'
  if (!isSvg) return

  let svgText: string
  try {
    const resp = await fetch(src)
    svgText = await resp.text()
  } catch { return }

  const parser = new DOMParser()
  const doc = parser.parseFromString(svgText, 'image/svg+xml')
  const svgEl = doc.querySelector('svg')
  if (!svgEl) return

  let orgW = 1000, orgH = 1000
  const vbAttr = svgEl.getAttribute('viewBox')
  if (vbAttr) {
    const parts = vbAttr.split(/[\s,]+/).map(Number)
    if (parts.length >= 4) {
      orgW = parts[2]; orgH = parts[3]
    }
  } else {
    orgW = parseFloat(svgEl.getAttribute('width') || '1000') || 1000
    orgH = parseFloat(svgEl.getAttribute('height') || '1000') || 1000
  }

  const scale = Math.min(1, 1500 / Math.max(orgW, orgH))
  const CANVAS_W = Math.round(orgW * scale)
  const CANVAS_H = Math.round(orgH * scale)

  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_W; canvas.height = CANVAS_H
  const ctx = canvas.getContext('2d')!

  await new Promise<void>((resolve, reject) => {
    const img = new Image()
    img.onload = () => { ctx.drawImage(img, 0, 0, CANVAS_W, CANVAS_H); resolve() }
    img.onerror = reject
    img.src = src 
  })

  const localPoint = editor.getPointInShapeSpace(shape.id, pointer)
  const shapeW = Math.max(0.1, (shape.props as any).w)
  const shapeH = Math.max(0.1, (shape.props as any).h)
  const relX = localPoint.x / shapeW
  const relY = localPoint.y / shapeH
  const cx = Math.max(0, Math.min(CANVAS_W - 1, Math.floor(relX * CANVAS_W)))
  const cy = Math.max(0, Math.min(CANVAS_H - 1, Math.floor(relY * CANVAS_H)))

  const imageData = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H)
  const exteriorMask = getExteriorMask(imageData.data, CANVAS_W, CANVAS_H)
  const [fillR, fillG, fillB] = hexToRgb(color)
  
  const fillPixels = floodFillOnlyColor(imageData.data, CANVAS_W, CANVAS_H, cx, cy, fillR, fillG, fillB, exteriorMask)
  
  let hasPaint = false
  for (let i = 3; i < fillPixels.length; i += 4) { if (fillPixels[i] > 0) { hasPaint = true; break } }
  if (!hasPaint) { console.log('[Bucket] Aborted: clicked background'); return }

  const fillImgData = new ImageData(fillPixels, CANVAS_W, CANVAS_H)
  ctx.putImageData(fillImgData, 0, 0)
  
  const fillPngUrl = canvas.toDataURL('image/png')

  const imgNode = doc.createElementNS('http://www.w3.org/2000/svg', 'image')
  imgNode.setAttribute('href', fillPngUrl)
  imgNode.setAttribute('x', vbAttr ? vbAttr.split(/[\s,]+/)[0] : '0')
  imgNode.setAttribute('y', vbAttr ? vbAttr.split(/[\s,]+/)[1] : '0')
  imgNode.setAttribute('width', orgW.toString())
  imgNode.setAttribute('height', orgH.toString())
  imgNode.setAttribute('preserveAspectRatio', 'none')

  svgEl.insertBefore(imgNode, svgEl.firstChild)

  const serialized = new XMLSerializer().serializeToString(svgEl)
  const newSrc = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`
  
  const newAssetId = `asset:svg-filled-${Date.now()}` as any
  editor.createAssets([{
    id: newAssetId, type: 'image', typeName: 'asset',
    props: { ...asset.props, src: newSrc, mimeType: 'image/svg+xml' }, meta: {}
  }])
  editor.updateShape({ id: shape.id, type: 'image', props: { assetId: newAssetId } })
  
  editor.markHistoryStoppingPoint('bucket color')
}

class BucketIdle extends StateNode {
  static override id = 'idle'
  override onPointerDown() {
    applyBucketColor(this.editor, globBucketColor)
  }
}

export class BucketTool extends StateNode {
  static override id = 'bucket'
  static override initial = 'idle'
  static override children = () => [BucketIdle]
  override onEnter() {
    this.editor.setCursor({ type: 'cross', rotation: 0 })
  }
}

const ILLUSTRATION_GROUPS = [
  {
    id: 'colonial',
    name: 'Colonial',
    illustration: '/illustrations/Colonial 1.jpg',
    pieces: [
      { name: 'Flores Col. 1', file: '/svgs/Flores coloniales 1_.svg' },
      { name: 'Flores Col. 2', file: '/svgs/Flores coloniales 2_.svg' },
      { name: 'Paloma Colonial', file: '/svgs/Paloma colonial.svg' },
      { name: 'Corazones', file: '/svgs/corazones y hojas coloniales.svg' },
    ],
  },
  {
    id: 'inca',
    name: 'Icono Inca',
    illustration: '/illustrations/Icono Inca 1.png',
    pieces: [
      { name: 'Inca 1', file: '/svgs/Icono Inca 1.svg' },
      { name: 'Inca 2', file: '/svgs/Iconografía Inca 2.svg' },
    ],
  },
  {
    id: 'majenia',
    name: 'Majeña',
    illustration: '/illustrations/Majeña.png',
    pieces: [{ name: 'Majeña', file: '/svgs/Majeña.svg' }],
  },
  {
    id: 'majenio',
    name: 'Majeño',
    illustration: '/illustrations/Majeño (1).png',
    pieces: [{ name: 'Majeño', file: '/svgs/Majeño.svg' }],
  },
  {
    id: 'mestiza-qollacha',
    name: 'Mestiza Qollacha',
    illustration: '/illustrations/Mestiza Qollacha en azul A5.png',
    pieces: [
      { name: 'Qollacha 1', file: '/svgs/mestiza-qollacha-1.svg' },
      { name: 'Qollacha 2', file: '/svgs/Mestiza-qollacha-2.svg' },
    ],
  },
  {
    id: 'mestiza-ollanta',
    name: 'Mestiza Ollanta',
    illustration: '/illustrations/Mestiza de Ollantaytambo.png',
    pieces: [{ name: 'Ollanta', file: '/svgs/Mestiza-Ollanta.svg' }],
  },
  {
    id: 'ukuko',
    name: 'Ukuko',
    illustration: '/illustrations/Ukuko (1).png',
    pieces: [
      { name: 'Ukuko 1', file: '/svgs/ukuko-1.svg' },
      { name: 'Ukuko 2', file: '/svgs/ukuko-2.svg' },
    ],
  },
  {
    id: 'kachampa',
    name: 'Kachampa',
    illustration: '/illustrations/kachampa (2).png',
    pieces: [{ name: 'Kachampa', file: '/svgs/kachampa.svg' }],
  },
  {
    id: 'kukasaru',
    name: 'Kukasaru',
    illustration: '/illustrations/kukasaru a6 (1).png',
    pieces: [{ name: 'Kukasaru', file: '/svgs/kukasaru.svg' }],
  },
  {
    id: 'qhapaq-qolla',
    name: 'Qhapaq Qolla',
    illustration: '/illustrations/qhapaq qolla (1).png',
    pieces: [{ name: 'Qhapaq Qolla', file: '/svgs/Qhapaq-qolla.svg' }],
  },
]

type Group = (typeof ILLUSTRATION_GROUPS)[number]
type Piece = { name: string; file: string }

interface SubPiece {
  name: string
  svgText: string
  w: number
  h: number
  ox: number
  oy: number
}

async function extractSubPieces(file: string): Promise<SubPiece[]> {
  const res = await fetch(file)
  const text = await res.text()

  const host = document.createElement('div')
  host.style.cssText =
    'position:absolute;top:-9999px;left:-9999px;width:2000px;height:2000px;opacity:0;pointer-events:none;overflow:hidden'
  document.body.appendChild(host)
  host.innerHTML = text

  try {
    const svg = host.querySelector('svg')
    if (!svg) return fallbackWhole(text)

    svg.style.width = '2000px'
    svg.style.height = '2000px'
    svg.setAttribute('preserveAspectRatio', 'none')

    const SKIP = new Set(['defs', 'title', 'desc', 'metadata', 'style'])
    
    const isBackgroundRect = (el: Element) => {
      if (el.tagName.toLowerCase() !== 'rect') return false
      const rw = el.getAttribute('width'); const rh = el.getAttribute('height')
      if (rw === '100%' && rh === '100%') return true
      const fill = el.getAttribute('fill') || el.getAttribute('style') || ''
      if (fill.includes('white') || fill.includes('#fff') || fill.includes('#FFF') || fill === 'none') return true
      
      const r = el.getBoundingClientRect()
      const s = svg.getBoundingClientRect()
      if (r.width > s.width * 0.9 && r.height > s.height * 0.9) return true
      return false
    }

    let container = svg as Element
    while (true) {
      const validChildren = Array.from(container.children).filter(
        (el) => !SKIP.has(el.tagName.toLowerCase()) && !isBackgroundRect(el)
      )
      if (validChildren.length === 1 && validChildren[0].tagName.toLowerCase() === 'g') {
        container = validChildren[0]
      } else {
        break
      }
    }

    const pieces = Array.from(container.children).filter(el => !SKIP.has(el.tagName.toLowerCase()) && !isBackgroundRect(el))
    if (pieces.length === 0) return fallbackWhole(text)

    const svgRect = svg.getBoundingClientRect()
    const vbAttr = svg.getAttribute('viewBox')
    let orgVbX = 0, orgVbY = 0, orgVbW = 2000, orgVbH = 2000
    if (vbAttr) {
      const parts = vbAttr.split(/[\s,]+/).map(Number)
      if (parts.length >= 4) {
        orgVbX = parts[0]; orgVbY = parts[1]; orgVbW = parts[2]; orgVbH = parts[3]
      }
    }

    const scaleX = orgVbW / svgRect.width
    const scaleY = orgVbH / svgRect.height

    const sub: SubPiece[] = []
    
    for (let i = 0; i < pieces.length; i++) {
      const el = pieces[i]
      const rawName =
        el.getAttribute('inkscape:label') ||
        el.getAttribute('data-name') ||
        (el.getAttribute('id') || '').replace(/^(layer|group|g)\s*\d*/i, '').trim()

      const rect = el.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) continue

      const px = (rect.left - svgRect.left) * scaleX + orgVbX
      const py = (rect.top - svgRect.top) * scaleY + orgVbY
      const pw = rect.width * scaleX
      const ph = rect.height * scaleY

      const padX = Math.max(20, pw * 0.15)
      const padY = Math.max(20, ph * 0.15)

      const vbPiece = `${px - padX} ${py - padY} ${pw + padX * 2} ${ph + padY * 2}`

      const origId = el.getAttribute('id')
      const tempId = `temp-piece-${Date.now()}-${i}`
      el.setAttribute('id', tempId)

      const clone = svg.cloneNode(true) as SVGSVGElement
      clone.setAttribute('viewBox', vbPiece)
      clone.removeAttribute('width')
      clone.removeAttribute('height')
      clone.style.width = ''
      clone.style.height = ''
      
      const clonePiece = clone.querySelector(`#${tempId}`)
      if (clonePiece && clonePiece.parentElement) {
        let defs = clone.querySelector('defs')
        if (!defs) {
          defs = clone.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'defs')
          clone.insertBefore(defs, clone.firstChild)
        }
        
        const siblings = Array.from(clonePiece.parentElement.children)
        siblings.forEach(sib => {
          if (sib !== clonePiece && !SKIP.has(sib.tagName.toLowerCase())) {
            defs!.appendChild(sib)
          }
        })
        
        if (origId) {
          clonePiece.setAttribute('id', origId)
        } else {
          clonePiece.removeAttribute('id')
        }
      }
      
      if (origId) {
        el.setAttribute('id', origId)
      } else {
        el.removeAttribute('id')
      }

      sub.push({
        name: rawName || `Parte ${i + 1}`,
        svgText: clone.outerHTML,
        w: pw + padX * 2,
        h: ph + padY * 2,
        ox: px - padX,
        oy: py - padY,
      })
    }

    return sub.length > 0 ? sub : fallbackWhole(text)
  } catch (err) {
    return fallbackWhole(text)
  } finally {
    document.body.removeChild(host)
  }
}

function fallbackWhole(text: string): SubPiece[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(text, 'image/svg+xml')
  const svg = doc.querySelector('svg')
  const vb = svg?.getAttribute('viewBox') || '0 0 500 500'
  const parts = vb.split(/[\s,]+/).map(Number)
  return [{ name: 'Completo', svgText: text, w: parts[2] || 500, h: parts[3] || 500, ox: parts[0] || 0, oy: parts[1] || 0 }]
}

function svgToDataUrl(svgText: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`
}

function placeSubPieces(
  editor: ReturnType<typeof useEditor>,
  subPieces: SubPiece[],
  centreScreen: { x: number; y: number },
  maxPx = 400,
) {
  if (subPieces.length === 0) return

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  subPieces.forEach(p => {
    minX = Math.min(minX, p.ox)
    minY = Math.min(minY, p.oy)
    maxX = Math.max(maxX, p.ox + p.w)
    maxY = Math.max(maxY, p.oy + p.h)
  })

  const totalW = maxX - minX
  const totalH = maxY - minY
  const scale = Math.min(1, maxPx / Math.max(totalW, totalH, 1))
  const centre = editor.screenToPage(centreScreen)

  const startX = centre.x - (totalW * scale) / 2
  const startY = centre.y - (totalH * scale) / 2

  const shapeIds: any[] = []

  subPieces.forEach((piece, i) => {
    const dw = Math.max(1, piece.w * scale)
    const dh = Math.max(1, piece.h * scale)
    const relX = (piece.ox - minX) * scale
    const relY = (piece.oy - minY) * scale
    const src = (piece as any).isImage ? (piece as any).file : svgToDataUrl(piece.svgText)
    const assetId = `asset:svg-${Date.now()}-${i}` as any
    const shapeId = `shape:svg-${Date.now()}-${i}` as any

    editor.createAssets([{
      id: assetId,
      type: 'image',
      typeName: 'asset',
      props: { name: piece.name, src, w: dw, h: dh, mimeType: 'image/svg+xml', isAnimated: false },
      meta: {},
    }])
    editor.createShape({
      id: shapeId,
      type: 'image',
      x: startX + relX,
      y: startY + relY,
      props: { assetId, w: dw, h: dh },
    })
    shapeIds.push(shapeId)
  })

  if (shapeIds.length > 0) {
    editor.select(...shapeIds)
  }
}

function IllustrationPicker() {
  const editor = useEditor()
  const [open, setOpen] = useState(false)
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null)
  const [adding, setAdding] = useState<string | null>(null) 
  const [popupPos, setPopupPos] = useState({ x: 0, y: 0 })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const PANEL_W = Math.min(680, window.innerWidth - 16)
  const PANEL_H = Math.min(480, window.innerHeight - 100)

  const openPanel = useCallback(() => {
    if (!buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    const x = Math.max(8, Math.min(rect.left + rect.width / 2 - PANEL_W / 2, window.innerWidth - PANEL_W - 8))
    const y = Math.max(8, rect.top - PANEL_H - 10)
    setPopupPos({ x, y })
    setOpen(true)
  }, [PANEL_W, PANEL_H])

  const closePanel = useCallback(() => {
    setOpen(false)
    setSelectedGroup(null)
  }, [])

  useEffect(() => {
    if (!open) return
    const handler = (e: PointerEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) closePanel()
    }
    document.addEventListener('pointerdown', handler, { capture: true })
    return () => document.removeEventListener('pointerdown', handler, { capture: true })
  }, [open, closePanel])

  const handlePieceClick = useCallback(async (piece: Piece) => {
    if (adding) return
    setAdding(piece.file)
    try {
      const isImg = piece.file.toLowerCase().endsWith('.png') || piece.file.toLowerCase().endsWith('.jpg')
      const sub = isImg
        ? [{ name: piece.name, svgText: '', w: 800, h: 800, ox: 0, oy: 0, isImage: true, file: piece.file } as any]
        : await extractSubPieces(piece.file)
      const centre = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
      placeSubPieces(editor, sub, centre)
    } finally {
      setAdding(null)
    }
  }, [editor, adding])

  const handleAddAll = useCallback(async (group: Group) => {
    if (adding) return
    setAdding('all')
    try {
      const allSubs: SubPiece[] = []
      allSubs.push({
        name: 'Guía Completa (PNG)', svgText: '', w: 800, h: 800, ox: 0, oy: 0, 
        isImage: true, file: group.illustration
      } as any)
      for (const piece of group.pieces) {
        const sub = await extractSubPieces(piece.file)
        allSubs.push(...sub)
      }
      const centre = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
      placeSubPieces(editor, allSubs, centre)
    } finally {
      setAdding(null)
    }
  }, [editor, adding])

  const tl = {
    bg: '#ffffff',
    surface: '#f9fafb',
    border: 'rgba(0,0,0,0.08)',
    text: '#1d1d1d',
    textMuted: 'rgba(0,0,0,0.4)',
    shadow: '0 4px 24px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.06)',
    radius: 10,
    accent: '#2d7ef7',
    accentBg: 'rgba(45,126,247,0.08)',
    font: "'Inter', system-ui, sans-serif",
  }

  return (
    <>
      <button
        ref={buttonRef}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          open ? closePanel() : openPanel()
        }}
        title="Personajes y Piezas"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 40, height: 40, borderRadius: 8, border: 'none',
          background: open ? 'rgba(0,0,0,0.07)' : 'transparent',
          cursor: 'pointer', padding: 0, flexShrink: 0,
          color: open ? tl.accent : '#1d1d1d',
          transition: 'background 0.1s, color 0.1s',
          pointerEvents: 'all',
        }}
        onMouseEnter={(e) => { if (!open) e.currentTarget.style.background = 'rgba(0,0,0,0.05)' }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = 'transparent' }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2a9 9 0 0 1 9 9v2a9 9 0 0 1-9 9 9 9 0 0 1-9-9v-2a9 9 0 0 1 9-9z"/>
          <path d="M9 10h.01M15 10h.01"/>
          <path d="M9.5 15a4.5 4.5 0 0 0 5 0"/>
        </svg>
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          style={{
            position: 'fixed',
            top: popupPos.y, left: popupPos.x,
            width: PANEL_W, height: PANEL_H,
            background: tl.bg, borderRadius: tl.radius,
            boxShadow: tl.shadow,
            display: 'flex', flexDirection: 'column',
            zIndex: 99999, overflow: 'hidden',
            animation: 'tlPickerIn 0.15s ease-out',
            fontFamily: tl.font,
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 10px', borderBottom: `1px solid ${tl.border}`,
            minHeight: 40, flexShrink: 0,
          }}>
            {selectedGroup && (
              <button
                onClick={() => setSelectedGroup(null)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 6, border: `1px solid ${tl.border}`, background: 'transparent', cursor: 'pointer', color: tl.text, flexShrink: 0 }}
                onMouseEnter={(e) => e.currentTarget.style.background = tl.surface}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10 4L6 8l4 4"/></svg>
              </button>
            )}
            <span style={{ fontWeight: 600, fontSize: 13, color: tl.text, flex: 1 }}>
              {selectedGroup ? selectedGroup.name : 'Personajes'}
            </span>
            {selectedGroup && (
              <button
                onClick={() => handleAddAll(selectedGroup)}
                disabled={!!adding}
                style={{ fontSize: 10, fontWeight: 600, color: tl.accent, background: tl.accentBg, border: `1px solid ${tl.accent}30`, borderRadius: 6, padding: '3px 10px', cursor: adding ? 'wait' : 'pointer', opacity: adding ? 0.6 : 1, transition: 'background 0.1s' }}
                onMouseEnter={(e) => { if (!adding) e.currentTarget.style.background = `${tl.accent}1a` }}
                onMouseLeave={(e) => e.currentTarget.style.background = tl.accentBg}
              >
                {adding === 'all' ? 'Agregando…' : '+ Agregar todas'}
              </button>
            )}
            <button
              onClick={closePanel}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer', color: tl.textMuted }}
              onMouseEnter={(e) => { e.currentTarget.style.background = tl.surface; (e.currentTarget as HTMLButtonElement).style.color = tl.text }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = tl.textMuted }}
            >X</button>
          </div>

          <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>

            {!selectedGroup ? (
              <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8, alignContent: 'start' }}>
                {ILLUSTRATION_GROUPS.map((group) => (
                  <button
                    key={group.id}
                    onClick={() => setSelectedGroup(group)}
                    style={{ background: tl.bg, border: `1px solid ${tl.border}`, borderRadius: 8, cursor: 'pointer', padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', transition: 'border-color 0.12s, box-shadow 0.12s' }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = tl.accent; e.currentTarget.style.boxShadow = `0 0 0 2px ${tl.accentBg}` }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = tl.border; e.currentTarget.style.boxShadow = 'none' }}
                  >
                    <img src={group.illustration} alt={group.name} style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover', objectPosition: 'top', display: 'block' }} />
                    <div style={{ padding: '5px 6px', fontSize: 10, fontWeight: 600, color: tl.text, textAlign: 'left', lineHeight: 1.2, borderTop: `1px solid ${tl.border}` }}>
                      {group.name}
                    </div>
                  </button>
                ))}
              </div>

            ) : (
              <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

                <div style={{ width: 200, flexShrink: 0, borderRight: `1px solid ${tl.border}`, display: 'flex', flexDirection: 'column', background: tl.surface }}>
                  <div style={{ padding: '5px 10px', fontSize: 9, fontWeight: 700, color: tl.textMuted, letterSpacing: '0.06em', textTransform: 'uppercase', borderBottom: `1px solid ${tl.border}` }}>
                    Guía visual
                  </div>
                  <div style={{ flex: 1, overflow: 'hidden', padding: 8 }}>
                    <img src={selectedGroup.illustration} alt={selectedGroup.name} style={{ width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'top', borderRadius: 6 }} />
                  </div>
                </div>

                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <div style={{ padding: '5px 10px', fontSize: 9, fontWeight: 700, color: tl.textMuted, letterSpacing: '0.06em', textTransform: 'uppercase', borderBottom: `1px solid ${tl.border}` }}>
                    Clic para agregar cada sub-pieza separada
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'grid', gridTemplateColumns: selectedGroup.pieces.length === 1 ? '1fr' : 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8, alignContent: 'start' }}>
                    {[{ name: 'Guía Completa (PNG)', file: selectedGroup.illustration }, ...selectedGroup.pieces].map((piece) => {
                      const isAdding = adding === piece.file
                      return (
                        <button
                          key={piece.file}
                          onClick={() => handlePieceClick(piece)}
                          disabled={!!adding}
                          title={`Agregar sub-piezas de "${piece.name}" al canvas`}
                          style={{
                            background: isAdding ? tl.accentBg : tl.bg,
                            border: `1px solid ${isAdding ? tl.accent : tl.border}`,
                            borderRadius: 8, cursor: adding ? 'wait' : 'pointer',
                            padding: 8, display: 'flex', flexDirection: 'column',
                            alignItems: 'center', gap: 6,
                            transition: 'border-color 0.12s, box-shadow 0.12s, transform 0.1s',
                            minHeight: 120, opacity: adding && !isAdding ? 0.5 : 1,
                          }}
                          onMouseEnter={(e) => { if (!adding) { e.currentTarget.style.borderColor = tl.accent; e.currentTarget.style.boxShadow = `0 0 0 2px ${tl.accentBg}`; e.currentTarget.style.transform = 'scale(1.02)' } }}
                          onMouseLeave={(e) => { e.currentTarget.style.borderColor = isAdding ? tl.accent : tl.border; e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'scale(1)' }}
                        >
                          <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: tl.surface, borderRadius: 6, overflow: 'hidden', minHeight: 80 }}>
                            {isAdding
                              ? <span style={{ fontSize: 11, color: tl.textMuted }}>Agregando…</span>
                              : <img src={piece.file} alt={piece.name} style={{ maxWidth: '100%', maxHeight: 90, objectFit: 'contain' }} />
                            }
                          </div>
                          <span style={{ fontSize: 10, fontWeight: 600, color: tl.text, textAlign: 'center', lineHeight: 1.3 }}>
                            {piece.name}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div style={{ padding: '5px 12px', borderTop: `1px solid ${tl.border}`, fontSize: 9, color: tl.textMuted, textAlign: 'center', flexShrink: 0 }}>
            TotemsDelInca · Biblioteca de Personajes
          </div>
        </div>,
        document.body,
      )}

      <style>{`
        @keyframes tlPickerIn {
          from { opacity: 0; transform: translateY(6px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </>
  )
}

function ShapesDropdown() {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [popupPos, setPopupPos] = useState({ x: 0, y: 0 })

  const openPanel = useCallback(() => {
    if (!buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    const px = Math.max(8, Math.min(rect.left - 100, window.innerWidth - 220))
    const py = Math.max(8, rect.top - 260)
    setPopupPos({ x: px, y: py })
    setOpen(true)
  }, [])

  const closePanel = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const handler = (e: PointerEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) closePanel()
    }
    document.addEventListener('pointerdown', handler, { capture: true })
    return () => document.removeEventListener('pointerdown', handler, { capture: true })
  }, [open, closePanel])

  return (
    <>
      <button
        ref={buttonRef}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          open ? closePanel() : openPanel()
        }}
        title="Geometrías"
        className="tlui-button tlui-button__icon"
        data-state={open ? 'selected' : 'inactive'}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7"></rect>
          <rect x="14" y="3" width="7" height="7" rx="3.5"></rect>
          <path d="M14 21l3.5-7 3.5 7z"></path>
          <path d="M3 14h7v7H3z"></path>
        </svg>
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          className="tlui-buttons__grid"
          style={{
            position: 'fixed',
            top: popupPos.y, left: popupPos.x,
            width: 210,
            background: 'var(--color-panel)', 
            borderRadius: 'var(--radius-3)',
            boxShadow: 'var(--shadow-2)',
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4,
            padding: 8, zIndex: 99999,
          }}
          onClick={closePanel}
        >
          <RectangleToolbarItem />
          <EllipseToolbarItem />
          <TriangleToolbarItem />
          <DiamondToolbarItem />
          <HexagonToolbarItem />
          <OvalToolbarItem />
          <RhombusToolbarItem />
          <StarToolbarItem />
          <CloudToolbarItem />
          <HeartToolbarItem />
          <XBoxToolbarItem />
          <CheckBoxToolbarItem />
          <ArrowLeftToolbarItem />
          <ArrowUpToolbarItem />
          <ArrowDownToolbarItem />
          <ArrowRightToolbarItem />
          <LineToolbarItem />
        </div>,
        document.body
      )}
    </>
  )
}

function BucketColorDropdown({ isBucket }: { isBucket: boolean }) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [popupPos, setPopupPos] = useState({ x: 0, y: 0 })
  const [, setForce] = useState(0)
  const editor = useEditor()

  const PALETTE = ['#e53e3e', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#1d1d1d', '#ffffff']

  const openPanel = useCallback(() => {
    if (!buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    const panelWidth = 280
    const px = Math.max(8, Math.min(rect.left - 60, window.innerWidth - panelWidth - 8))
    const py = Math.max(8, rect.top - 100)
    setPopupPos({ x: px, y: py })
    setOpen(true)
  }, [])

  const closePanel = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const handler = (e: PointerEvent) => {
      if ((e.target as HTMLElement).tagName?.toLowerCase() === 'input') return
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) closePanel()
    }
    document.addEventListener('pointerdown', handler, { capture: true })
    return () => document.removeEventListener('pointerdown', handler, { capture: true })
  }, [open, closePanel])

  return (
    <>
      <button
        ref={buttonRef}
        title="Color del Bote"
        className="tlui-button tlui-button__icon"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (!isBucket) { editor.setCurrentTool('bucket') }
          open ? closePanel() : openPanel()
        }}
        style={{ color: globBucketColor }}
      >
        <div style={{ width: 14, height: 14, borderRadius: '50%', background: globBucketColor, border: '1px solid rgba(0,0,0,0.1)' }} />
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          style={{
            position: 'fixed',
            top: popupPos.y, left: popupPos.x,
            background: 'var(--color-panel)',
            padding: 8, borderRadius: 'var(--radius-3)',
            boxShadow: 'var(--shadow-2)',
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6,
            width: Math.min(280, window.innerWidth - 16),
            zIndex: 99999,
          }}
        >
          {PALETTE.map(c => (
            <button
              key={c}
              title={c}
              onClick={() => { globBucketColor = c; setForce(prev => prev + 1); closePanel() }}
              style={{
                width: 24, height: 24, borderRadius: '50%', background: c, padding: 0,
                border: `2px solid ${globBucketColor === c ? '#2d7ef7' : 'rgba(0,0,0,0.1)'}`,
                boxShadow: globBucketColor === c ? '0 0 0 2px rgba(45,126,247,0.2)' : 'none',
                cursor: 'pointer', transition: 'transform 0.1s'
              }}
            />
          ))}
          <div style={{ width: 1, height: 16, background: 'rgba(0,0,0,0.1)' }} />
          <input 
            title="Color personalizado" type="color" value={globBucketColor}
            onChange={(e) => { globBucketColor = e.target.value; setForce(prev => prev + 1) }}
            style={{ width: 28, height: 28, padding: 0, border: 'none', borderRadius: 4, cursor: 'pointer', background: 'transparent' }}
          />
        </div>,
        document.body
      )}
    </>
  )
}

function CustomToolbar() {
  const [, setForce] = useState(0) 
  const editor = useEditor()
  const currentTool = editor.getCurrentToolId()
  const isBucket = currentTool === 'bucket'

  useEffect(() => {
    const unsub = editor.store.listen(() => setForce(prev => prev + 1))
    return unsub
  }, [editor])
  
  const bucketCursorSvg = encodeURIComponent(`<svg width="28" height="28" viewBox="0 0 24 24" fill="white" stroke="#1d1d1d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z"/><path d="m5 2 5 5"/><path d="M2 13h15"/><path d="M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z"/></svg>`)

  return (
    <DefaultToolbar>
      {isBucket && (
        <style>{`
          .tl-container, .tl-canvas, .tl-canvas * {
            cursor: url('data:image/svg+xml;charset=utf-8,${bucketCursorSvg}') 4 20, crosshair !important;
          }
        `}</style>
      )}

      <div style={{ 
        display: 'flex', alignItems: 'center', flexWrap: window.innerWidth < 600 ? 'nowrap' : 'wrap', 
        justifyContent: 'flex-start', gap: 4, padding: '4px',
        overflowX: 'auto', maxWidth: 'calc(100vw - 16px)',
        WebkitOverflowScrolling: 'touch',
        scrollbarWidth: 'none', // Firefox
      }}>
        <style>{`
          .tlui-toolbar__content::-webkit-scrollbar { display: none; }
        `}</style>
        <SelectToolbarItem />
        <HandToolbarItem />
        <DrawToolbarItem />
        <EraserToolbarItem />
        <ArrowToolbarItem />
        <TextToolbarItem />
        <NoteToolbarItem />
        <AssetToolbarItem />
        
        <ShapesDropdown />

        <FrameToolbarItem />
        <LaserToolbarItem />
        <HighlightToolbarItem />

        <div style={{ width: 1, height: 24, background: 'rgba(0,0,0,0.1)', margin: '0 4px' }} />

        <button
          title="Bote de Pintura (Colorear)"
          className="tlui-button tlui-button__icon"
          data-state={isBucket ? 'selected' : 'inactive'}
          onClick={() => editor.setCurrentTool('bucket')}
          style={{ color: isBucket ? globBucketColor : 'inherit' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z"/>
            <path d="m5 2 5 5"/>
            <path d="M2 13h15"/>
            <path d="M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z"/>
          </svg>
        </button>

        {isBucket && <BucketColorDropdown isBucket={isBucket} />}

        <div style={{ width: 1, height: 24, background: 'rgba(0,0,0,0.1)', margin: '0 4px' }} />

        <IllustrationPicker />
      </div>
    </DefaultToolbar>
  )
}

const components: TLComponents = { Toolbar: CustomToolbar }

export default function App() {
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tldraw
        persistenceKey="tldraw-custom"
        components={components}
        tools={[BucketTool]}
        licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY}
      />
    </div>
  )
}
