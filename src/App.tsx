import { memo, useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Tldraw,
  useEditor,
  DefaultToolbar,
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
  createShapeId,
} from 'tldraw'
import type { TLComponents, TLShapeId } from 'tldraw'
import 'tldraw/tldraw.css'
import { IllustrationShapeUtil } from './IllustrationShapeUtil'

import illustrationData from './illustrationManifest.json'
import type { IllustrationGroup, IllustrationPiece } from './illustrationManifest.types'

const GROUPS: IllustrationGroup[] = illustrationData.groups
const COLORABLE_GROUPS = GROUPS.filter((group) =>
  String(group.coverUrl || group.guideUrl || '').includes('/illustrations/merged/'),
)

const LAYOUT_GAP = 12

function publicAssetUrl(href: string) {
  if (!String(href ?? '').trim()) return ''
  if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('data:')) {
    return href
  }
  const path = href.replace(/^\/+/, '')
  const base = import.meta.env.BASE_URL || '/'
  const prefix = base.endsWith('/') ? base : `${base}/`
  return new URL(path, `${window.location.origin}${prefix}`).href
}

function maskIdPart(value: string) {
  return (value || 'empty').replace(/[^a-zA-Z0-9_-]+/g, '_')
}

function buildMaskSvgMarkup(
  fillUrl: string,
  strokeUrl: string,
  fillColor: string,
  width: number,
  height: number,
) {
  const fillMaskId = `fill-mask-${maskIdPart(fillUrl)}-${maskIdPart(strokeUrl)}`
  const strokeMaskId = `stroke-mask-${maskIdPart(fillUrl)}-${maskIdPart(strokeUrl)}`
  const fillMask = fillUrl
    ? `
      <mask id="${fillMaskId}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}">
        <image href="${fillUrl}" xlink:href="${fillUrl}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" />
      </mask>
      <rect x="0" y="0" width="${width}" height="${height}" fill="${fillColor}" mask="url(#${fillMaskId})" />
    `
    : ''

  const strokeMask = strokeUrl
    ? `
      <mask id="${strokeMaskId}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}">
        <image href="${strokeUrl}" xlink:href="${strokeUrl}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" />
      </mask>
      <rect x="0" y="0" width="${width}" height="${height}" fill="#000000" mask="url(#${strokeMaskId})" />
    `
    : ''

  return `
    <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;display:block;">
      ${fillMask}
      ${strokeMask}
    </svg>
  `
}

function MaskPreview({
  fillPngUrl,
  strokePngUrl,
  width,
  height,
  maxHeight,
  surfaceColor,
}: {
  fillPngUrl?: string
  strokePngUrl?: string
  width?: number
  height?: number
  maxHeight: number
  surfaceColor: string
}) {
  const fillUrl = publicAssetUrl(fillPngUrl || '')
  const strokeUrl = publicAssetUrl(strokePngUrl || '')
  const safeWidth = Math.max(1, width ?? 1024)
  const safeHeight = Math.max(1, height ?? 1024)
  const markup = buildMaskSvgMarkup(fillUrl, strokeUrl, '#ffffff', safeWidth, safeHeight)

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        maxHeight,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: surfaceColor,
        overflow: 'hidden',
      }}
    >
      <div
        style={{ width: '100%', height: '100%', pointerEvents: 'none', userSelect: 'none' }}
        dangerouslySetInnerHTML={{ __html: markup }}
      />
    </div>
  )
}

const PiecePreview = memo(function PiecePreview({
  piece,
  maxHeight,
  surfaceColor,
  alignTop,
}: {
  piece: IllustrationPiece
  maxHeight: number
  surfaceColor: string
  alignTop?: boolean
}) {
  if (piece.fillPngUrl || piece.strokePngUrl) {
    return (
      <MaskPreview
        fillPngUrl={piece.fillPngUrl}
        strokePngUrl={piece.strokePngUrl}
        width={piece.w}
        height={piece.h}
        maxHeight={maxHeight}
        surfaceColor={surfaceColor}
      />
    )
  }

  const previewUrl = publicAssetUrl(piece.previewUrl || piece.svgUrl || piece.pngUrl || '')

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        maxHeight,
        display: 'flex',
        alignItems: alignTop ? 'flex-start' : 'center',
        justifyContent: 'center',
        background: surfaceColor,
        overflow: 'hidden',
      }}
    >
      {previewUrl ? (
        <img
          src={previewUrl}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          style={{
            width: '100%',
            height: '100%',
            maxHeight,
            objectFit: 'contain',
            display: 'block',
          }}
        />
      ) : null}
    </div>
  )
})

const DEFAULT_PIECE_SIZE = 300

const ASSEMBLY_GUIDE_PNG = '/illustrations/guides/mestiza-qollacha-2.png'
const ASSEMBLY_GUIDE_W_NAT = 721
const ASSEMBLY_GUIDE_H_NAT = 1024
const ASSEMBLY_GUIDE_DISPLAY_W = 380
const ASSEMBLY_GUIDE_DISPLAY_H = Math.round(
  (ASSEMBLY_GUIDE_DISPLAY_W * ASSEMBLY_GUIDE_H_NAT) / ASSEMBLY_GUIDE_W_NAT,
)

function createAssemblyGuideShape(
  editor: ReturnType<typeof useEditor>,
  pageX: number,
  pageY: number,
): TLShapeId {
  const shapeId = createShapeId()
  const pngUrl = publicAssetUrl(ASSEMBLY_GUIDE_PNG)
  editor.run(() => {
    editor.setCurrentTool('select')
    editor.createShape({
      id: shapeId,
      type: 'illustration',
      x: pageX,
      y: pageY,
      props: {
        w: ASSEMBLY_GUIDE_DISPLAY_W,
        h: ASSEMBLY_GUIDE_DISPLAY_H,
        svgUrl: '',
        pngUrl,
        name: 'Guía armado',
        color: 'black',
        size: 'm',
        fill: 'none',
      },
    })
  })
  return shapeId
}

function placeAssemblyGuide(
  editor: ReturnType<typeof useEditor>,
  centreScreen: { x: number; y: number },
) {
  const centre = editor.screenToPage(centreScreen)
  const sid = createAssemblyGuideShape(
    editor,
    centre.x - ASSEMBLY_GUIDE_DISPLAY_W / 2,
    centre.y - ASSEMBLY_GUIDE_DISPLAY_H / 2,
  )
  editor.select(sid)
}

function createIllustrationShapeData(
  piece: IllustrationPiece,
  pageX: number,
  pageY: number,
  dw: number,
  dh: number,
){
  const shapeId = createShapeId()

  return {
    id: shapeId,
    type: 'illustration' as const,
    x: pageX,
    y: pageY,
    props: {
      w: dw,
      h: dh,
      svgUrl: publicAssetUrl(piece.svgUrl),
      pngUrl: publicAssetUrl(piece.pngUrl),
      fillPngUrl: piece.fillPngUrl || '',
      strokePngUrl: piece.strokePngUrl || '',
      name: piece.name,
      color: 'black' as const,
      size: 'm' as const,
      fill: piece.svgUrl.includes('/illustrations/merged/') ? ('solid' as const) : ('none' as const),
    },
  }
}

function placeIllustrationPieces(
  editor: ReturnType<typeof useEditor>,
  pieces: IllustrationPiece[],
  centreScreen: { x: number; y: number },
) {
  if (pieces.length === 0) return

  const scaled = pieces.map((p) => {
    return { piece: p, dw: DEFAULT_PIECE_SIZE, dh: DEFAULT_PIECE_SIZE }
  })

  const cols = Math.min(5, Math.max(1, Math.ceil(Math.sqrt(scaled.length))))
  const rows: (typeof scaled)[] = []
  for (let i = 0; i < scaled.length; i += cols) {
    rows.push(scaled.slice(i, i + cols))
  }

  const rowHeights = rows.map((row) => Math.max(...row.map((x) => x.dh)))
  const rowWidths = rows.map((row) =>
    row.reduce((w, cell, j) => w + cell.dw + (j > 0 ? LAYOUT_GAP : 0), 0),
  )
  const gridH = rowHeights.reduce((h, rh, i) => h + rh + (i > 0 ? LAYOUT_GAP : 0), 0)

  const centre = editor.screenToPage(centreScreen)
  let y = centre.y - gridH / 2
  const shapeIds: TLShapeId[] = []
  const shapes = rows.flatMap((row, ri) => {
    const rowW = rowWidths[ri]
    let x = centre.x - rowW / 2
    const rowH = rowHeights[ri]
    const rowShapes = row.map(({ piece, dw, dh }) => {
      const yOff = y + (rowH - dh) / 2
      const shape = createIllustrationShapeData(piece, x, yOff, dw, dh)
      shapeIds.push(shape.id)
      x += dw + LAYOUT_GAP
      return shape
    })
    y += rowHeights[ri] + LAYOUT_GAP
    return rowShapes
  })

  editor.run(() => {
    editor.setCurrentTool('select')
    editor.createShapes(shapes)
    if (shapeIds.length > 0) {
      editor.select(...shapeIds)
    }
  })
}

function placeSingleIllustrationPiece(
  editor: ReturnType<typeof useEditor>,
  piece: IllustrationPiece,
  centreScreen: { x: number; y: number },
) {
  const dw = DEFAULT_PIECE_SIZE
  const dh = DEFAULT_PIECE_SIZE
  const centre = editor.screenToPage(centreScreen)
  const shape = createIllustrationShapeData(piece, centre.x - dw / 2, centre.y - dh / 2, dw, dh)
  editor.run(() => {
    editor.setCurrentTool('select')
    editor.createShape(shape)
    editor.select(shape.id)
  })
}

function IllustrationPicker() {
  const editor = useEditor()
  const [open, setOpen] = useState(false)
  const [selectedGroup, setSelectedGroup] = useState<IllustrationGroup | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const [popupPos, setPopupPos] = useState({ x: 0, y: 0 })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const PANEL_W = Math.min(840, window.innerWidth - 16)
  const PANEL_H = Math.min(560, window.innerHeight - 80)

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
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        closePanel()
      }
    }
    document.addEventListener('pointerdown', handler, { capture: true })
    return () => document.removeEventListener('pointerdown', handler, { capture: true })
  }, [open, closePanel])

  const handlePieceClick = useCallback(
    async (piece: IllustrationPiece) => {
      if (adding) return
      setAdding(piece.id ?? piece.svgUrl)
      try {
        const centre = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
        placeSingleIllustrationPiece(editor, piece, centre)
      } finally {
        setAdding(null)
      }
    },
    [editor, adding],
  )

  const handleAddAll = useCallback(
    async (group: IllustrationGroup) => {
      if (adding) return
      setAdding('all')
      try {
        const centre = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
        placeIllustrationPieces(editor, group.pieces, centre)
      } finally {
        setAdding(null)
      }
    },
    [editor, adding],
  )

  const handleGuideClick = useCallback(async () => {
    if (adding) return
    setAdding('guide')
    try {
      const centre = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
      placeAssemblyGuide(editor, centre)
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
        onPointerDown={() => {
          if (open) closePanel()
          else openPanel()
        }}
        title="Personajes y Piezas"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 40,
          height: 40,
          borderRadius: 8,
          border: 'none',
          background: open ? 'rgba(0,0,0,0.07)' : 'transparent',
          cursor: 'pointer',
          padding: 0,
          flexShrink: 0,
          color: open ? tl.accent : '#1d1d1d',
          transition: 'background 0.1s, color 0.1s',
          pointerEvents: 'all',
        }}
        onMouseEnter={(e) => {
          if (!open) e.currentTarget.style.background = 'rgba(0,0,0,0.05)'
        }}
        onMouseLeave={(e) => {
          if (!open) e.currentTarget.style.background = 'transparent'
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 2a9 9 0 0 1 9 9v2a9 9 0 0 1-9 9 9 9 0 0 1-9-9v-2a9 9 0 0 1 9-9z" />
          <path d="M9 10h.01M15 10h.01" />
          <path d="M9.5 15a4.5 4.5 0 0 0 5 0" />
        </svg>
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              position: 'fixed',
              top: popupPos.y,
              left: popupPos.x,
              width: PANEL_W,
              height: PANEL_H,
              background: tl.bg,
              borderRadius: tl.radius,
              boxShadow: tl.shadow,
              display: 'flex',
              flexDirection: 'column',
              zIndex: 99999,
              overflow: 'hidden',
              animation: 'tlPickerIn 0.15s ease-out',
              fontFamily: tl.font,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px',
                borderBottom: `1px solid ${tl.border}`,
                minHeight: 40,
                flexShrink: 0,
              }}
            >
              {selectedGroup && (
                <button
                  type="button"
                  onClick={() => setSelectedGroup(null)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    border: `1px solid ${tl.border}`,
                    background: 'transparent',
                    cursor: 'pointer',
                    color: tl.text,
                    flexShrink: 0,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = tl.surface
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M10 4L6 8l4 4" />
                  </svg>
                </button>
              )}
              <span style={{ fontWeight: 600, fontSize: 13, color: tl.text, flex: 1 }}>
                {selectedGroup ? 'Ilustraciones' : 'Personajes'}
              </span>
              {selectedGroup && (
                <button
                  type="button"
                  onClick={() => handleAddAll(selectedGroup)}
                  disabled={!!adding}
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: tl.accent,
                    background: tl.accentBg,
                    border: `1px solid ${tl.accent}30`,
                    borderRadius: 6,
                    padding: '3px 10px',
                    cursor: adding ? 'wait' : 'pointer',
                    opacity: adding ? 0.6 : 1,
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={(e) => {
                    if (!adding) e.currentTarget.style.background = `${tl.accent}1a`
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = tl.accentBg
                  }}
                >
                  {adding === 'all' ? 'Agregando…' : '+ Agregar todas'}
                </button>
              )}
              <button
                type="button"
                onClick={closePanel}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  color: tl.textMuted,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = tl.surface
                  ;(e.currentTarget as HTMLButtonElement).style.color = tl.text
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                  ;(e.currentTarget as HTMLButtonElement).style.color = tl.textMuted
                }}
              >
                X
              </button>
            </div>

            <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
              {!selectedGroup ? (
                <div
                  style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: 12,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(128px, 1fr))',
                    gap: 10,
                    alignContent: 'start',
                  }}
                >
                  {COLORABLE_GROUPS.map((group) => (
                    <button
                      type="button"
                      key={group.id ?? group.name}
                      onClick={() => setSelectedGroup(group)}
                      aria-label={group.name}
                      style={{
                        background: tl.bg,
                        border: `1px solid ${tl.border}`,
                        borderRadius: 8,
                        cursor: 'pointer',
                        padding: 0,
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                        transition: 'border-color 0.12s, box-shadow 0.12s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = tl.accent
                        e.currentTarget.style.boxShadow = `0 0 0 2px ${tl.accentBg}`
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = tl.border
                        e.currentTarget.style.boxShadow = 'none'
                      }}
                    >
                      <div
                        style={{
                          width: '100%',
                          minHeight: 168,
                          background: tl.surface,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: 6,
                          boxSizing: 'border-box',
                        }}
                      >
                        {group.pieces[0] ? (
                          <PiecePreview
                            piece={group.pieces[0]}
                            maxHeight={200}
                            surfaceColor={tl.surface}
                            alignTop
                          />
                        ) : null}
                      </div>
                      <div
                        style={{
                          padding: '8px 10px 10px',
                          fontSize: 11,
                          fontWeight: 600,
                          color: tl.text,
                          textAlign: 'center',
                          lineHeight: 1.25,
                        }}
                      >
                        {group.name}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div
                  style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'row',
                    overflow: 'hidden',
                    minHeight: 0,
                  }}
                >
                  <div
                    style={{
                      flexShrink: 0,
                      width: 152,
                      borderRight: `1px solid ${tl.border}`,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'stretch',
                      padding: 8,
                      gap: 8,
                      background: tl.bg,
                      boxSizing: 'border-box',
                    }}
                  >
                    <div
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        color: tl.textMuted,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        textAlign: 'center',
                      }}
                    >
                      Guía
                    </div>
                    <button
                      type="button"
                      onClick={() => handleGuideClick()}
                      disabled={!!adding}
                      aria-label="Agregar guía de armado al lienzo"
                      style={{
                        border: `1px solid ${adding === 'guide' ? tl.accent : tl.border}`,
                        borderRadius: 8,
                        background: adding === 'guide' ? tl.accentBg : tl.surface,
                        padding: 6,
                        cursor: adding ? 'wait' : 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <img
                        src={publicAssetUrl(ASSEMBLY_GUIDE_PNG)}
                        alt=""
                        draggable={false}
                        style={{
                          width: '100%',
                          height: 'auto',
                          display: 'block',
                          borderRadius: 4,
                          objectFit: 'contain',
                        }}
                      />
                      <span style={{ fontSize: 9, color: tl.textMuted, lineHeight: 1.25, textAlign: 'center' }}>
                        {adding === 'guide' ? 'Agregando…' : 'Clic → lienzo'}
                      </span>
                    </button>
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
                    <div
                      style={{
                        padding: '5px 10px',
                        fontSize: 9,
                        fontWeight: 700,
                        color: tl.textMuted,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        borderBottom: `1px solid ${tl.border}`,
                      }}
                    >
                      Piezas (clic para agregar)
                    </div>
                    <div
                      style={{
                        flex: 1,
                        overflowY: 'auto',
                        padding: 10,
                        display: 'grid',
                        gridTemplateColumns:
                          selectedGroup.pieces.length === 1 ? '1fr' : 'repeat(auto-fill, minmax(136px, 1fr))',
                        gap: 10,
                        alignContent: 'start',
                      }}
                    >
                      {selectedGroup.pieces.map((piece) => {
                        const pieceKey = piece.id ?? piece.svgUrl
                        const isAdding = adding === pieceKey
                        return (
                          <button
                            type="button"
                            key={pieceKey}
                            onClick={() => handlePieceClick(piece)}
                            disabled={!!adding}
                            aria-label="Agregar ilustración al lienzo"
                            style={{
                              background: isAdding ? tl.accentBg : tl.bg,
                              border: `1px solid ${isAdding ? tl.accent : tl.border}`,
                              borderRadius: 8,
                              cursor: adding ? 'wait' : 'pointer',
                              padding: 8,
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'border-color 0.12s, box-shadow 0.12s, transform 0.1s',
                              minHeight: 128,
                              opacity: adding && !isAdding ? 0.5 : 1,
                            }}
                            onMouseEnter={(e) => {
                              if (!adding) {
                                e.currentTarget.style.borderColor = tl.accent
                                e.currentTarget.style.boxShadow = `0 0 0 2px ${tl.accentBg}`
                                e.currentTarget.style.transform = 'scale(1.02)'
                              }
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.borderColor = isAdding ? tl.accent : tl.border
                              e.currentTarget.style.boxShadow = 'none'
                              e.currentTarget.style.transform = 'scale(1)'
                            }}
                          >
                            <div
                              style={{
                                flex: 1,
                                width: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: tl.surface,
                                borderRadius: 6,
                                overflow: 'hidden',
                                minHeight: 112,
                                padding: 4,
                                boxSizing: 'border-box',
                              }}
                            >
                              {isAdding ? (
                                <span style={{ fontSize: 11, color: tl.textMuted }}>Agregando…</span>
                              ) : (
                                <PiecePreview
                                  piece={piece}
                                  maxHeight={104}
                                  surfaceColor={tl.surface}
                                />
                              )}
                            </div>
                            <div
                              style={{
                                width: '100%',
                                marginTop: 6,
                                fontSize: 10,
                                fontWeight: 600,
                                color: tl.textMuted,
                                textAlign: 'center',
                                lineHeight: 1.25,
                              }}
                            >
                              {piece.name}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div
              style={{
                padding: '5px 12px',
                borderTop: `1px solid ${tl.border}`,
                fontSize: 9,
                color: tl.textMuted,
                textAlign: 'center',
                flexShrink: 0,
              }}
            >
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
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        closePanel()
      }
    }
    document.addEventListener('pointerdown', handler, { capture: true })
    return () => document.removeEventListener('pointerdown', handler, { capture: true })
  }, [open, closePanel])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onPointerDown={() => {
          if (open) closePanel()
          else openPanel()
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

      {open &&
        createPortal(
          <div
            ref={panelRef}
            className="tlui-buttons__grid"
            style={{
              position: 'fixed',
              top: popupPos.y,
              left: popupPos.x,
              width: 210,
              background: 'var(--color-panel)',
              borderRadius: 'var(--radius-3)',
              boxShadow: 'var(--shadow-2)',
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 4,
              padding: 8,
              zIndex: 99999,
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
          document.body,
        )}
    </>
  )
}

function CustomToolbar() {
  return (
    <DefaultToolbar>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: window.innerWidth < 600 ? 'nowrap' : 'wrap',
          justifyContent: 'flex-start',
          gap: 4,
          padding: '4px',
          overflowX: 'auto',
          maxWidth: 'calc(100vw - 16px)',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
        }}
      >
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

        <IllustrationPicker />
      </div>
    </DefaultToolbar>
  )
}

const components: TLComponents = { Toolbar: CustomToolbar }
const customShapeUtils = [IllustrationShapeUtil]

export default function App() {
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tldraw
        persistenceKey="tldraw-custom-v4"
        components={components}
        shapeUtils={customShapeUtils}
        licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY}
      />
    </div>
  )
}
