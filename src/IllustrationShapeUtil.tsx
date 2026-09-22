/* eslint-disable react-refresh/only-export-components, react-hooks/set-state-in-effect */

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  DefaultColorStyle,
  DefaultSizeStyle,
  DefaultFillStyle,
  useDefaultColorTheme,
  useEditor,
  useValue,
  resizeBox,
} from 'tldraw'
import type {
  TLShape,
  TLShapeId,
  TLResizeInfo,
  TLDefaultColorStyle,
  TLDefaultSizeStyle,
  TLDefaultFillStyle,
} from 'tldraw'
import { useMemo, useState, useEffect, useRef } from 'react'
import {
  getDevicePixelRatio,
  getIllustrationLodLevel,
  getIllustrationLodUrl,
  isIllustrationLodUrl,
} from './illustrationLod'

const ILLUSTRATION_TYPE = 'illustration' as const

declare module 'tldraw' {
  interface TLGlobalShapePropsMap {
    [ILLUSTRATION_TYPE]: {
      w: number
      h: number
      svgUrl: string
      pngUrl: string
      fillPngUrl: string
      strokePngUrl: string
      name: string
      color: TLDefaultColorStyle
      size: TLDefaultSizeStyle
      fill: TLDefaultFillStyle
    }
  }
}

type IllustrationShape = TLShape<typeof ILLUSTRATION_TYPE>

const svgCache = new Map<string, string>()
const svgRequestCache = new Map<string, Promise<string>>()
const processedSvgCache = new Map<string, string>()

// Cachés acotadas: antes crecían sin límite y retenían SVG/imágenes enormes.
const SVG_CACHE_MAX = 48
const PROCESSED_SVG_CACHE_MAX = 48
const IMAGE_CACHE_MAX = 24

function rememberBounded<V>(cache: Map<string, V>, key: string, value: V, max: number) {
  cache.delete(key)
  cache.set(key, value)
  while (cache.size > max) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

function isMobileDevice() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  return (
    window.innerWidth <= 768 ||
    window.matchMedia?.('(pointer: coarse)').matches ||
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  )
}

const imageRequestCache = new Map<string, Promise<HTMLImageElement>>()
const SHAPE_MAX_RENDER_DIM = 4096
const SHAPE_MAX_RENDER_PIXELS = 4096 * 4096
const MOBILE_SHAPE_MAX_RENDER_DIM = 1536
const MOBILE_SHAPE_MAX_RENDER_PIXELS = 1536 * 1536
const MAX_MOBILE_IMAGE_LOADS = 2
let activeMobileImageLoads = 0
const queuedMobileImageLoads: Array<() => void> = []

function runQueuedMobileImageLoad<T>(load: () => Promise<T>) {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      activeMobileImageLoads += 1
      load()
        .then(resolve, reject)
        .finally(() => {
          activeMobileImageLoads -= 1
          const next = queuedMobileImageLoads.shift()
          if (next) next()
        })
    }

    if (activeMobileImageLoads < MAX_MOBILE_IMAGE_LOADS) {
      run()
    } else {
      queuedMobileImageLoads.push(run)
    }
  })
}

function loadImage(url: string, queued = false) {
  const cached = imageRequestCache.get(url)
  if (cached) {
    rememberBounded(imageRequestCache, url, cached, IMAGE_CACHE_MAX)
    return cached
  }

  const requestImage = () => new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Failed to load ${url}`))
    image.src = url
  })
  const request = queued ? runQueuedMobileImageLoad(requestImage) : requestImage()
  request.catch(() => imageRequestCache.delete(url))

  rememberBounded(imageRequestCache, url, request, IMAGE_CACHE_MAX)
  return request
}

/** Carga la copia liviana; si faltara, cae a la original como antes. */
function loadLodImage(url: string, neededPx: number, queued: boolean) {
  const lodUrl = getIllustrationLodUrl(url, neededPx)
  const request = loadImage(lodUrl, queued)
  return lodUrl === url ? request : request.catch(() => loadImage(url, queued))
}

function getCappedRenderSize(
  sourceWidth: number,
  sourceHeight: number,
  maxDimension: number,
  maxPixels: number,
) {
  const width = Math.max(1, sourceWidth)
  const height = Math.max(1, sourceHeight)
  const byDimension = maxDimension / Math.max(width, height)
  const byPixels = Math.sqrt(maxPixels / (width * height))
  const scale = Math.min(1, byDimension, byPixels)

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

// Un solo lienzo auxiliar reutilizado: antes se creaban dos por pieza en cada
// dibujado y se acumulaban hasta que pasara el recolector. Asignar width/height
// lo limpia y reinicia su estado, igual que uno nuevo.
let scratchCanvas: HTMLCanvasElement | null = null

function drawMaskedLayer(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  color: string,
  width: number,
  height: number,
) {
  const scratch = (scratchCanvas ??= document.createElement('canvas'))
  scratch.width = Math.max(1, Math.round(width))
  scratch.height = Math.max(1, Math.round(height))

  const scratchCtx = scratch.getContext('2d')
  if (!scratchCtx) return

  scratchCtx.clearRect(0, 0, scratch.width, scratch.height)
  scratchCtx.drawImage(image, 0, 0, width, height)
  scratchCtx.globalCompositeOperation = 'source-in'
  scratchCtx.fillStyle = color
  scratchCtx.fillRect(0, 0, width, height)
  scratchCtx.globalCompositeOperation = 'source-over'

  ctx.drawImage(scratch, 0, 0, width, height)
}

function MaskCanvas({
  fillUrl,
  strokeUrl,
  width,
  height,
  fillColor,
  mobile,
}: {
  fillUrl: string
  strokeUrl: string
  width: number
  height: number
  fillColor: string
  mobile: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const renderSize = getCappedRenderSize(
    width,
    height,
    mobile ? MOBILE_SHAPE_MAX_RENDER_DIM : SHAPE_MAX_RENDER_DIM,
    mobile ? MOBILE_SHAPE_MAX_RENDER_PIXELS : SHAPE_MAX_RENDER_PIXELS,
  )

  // Las capas se dibujan a renderSize (1x) y luego se escalan, así que basta
  // una copia cuyo lado mayor cubra renderSize; no hace falta la de 7000 px.
  const lodPx = Math.max(renderSize.width, renderSize.height)

  useEffect(() => {
    let cancelled = false

    async function draw() {
      // Se cargan antes de tocar el canvas para no dejarlo en blanco mientras llegan.
      const [fillImage, strokeImage] = await Promise.all([
        fillUrl ? loadLodImage(fillUrl, lodPx, mobile).catch(() => null) : Promise.resolve(null),
        strokeUrl ? loadLodImage(strokeUrl, lodPx, mobile).catch(() => null) : Promise.resolve(null),
      ])

      if (cancelled) return

      const canvas = canvasRef.current
      if (!canvas) return

      const dpr = Math.min(window.devicePixelRatio || 1, 3)
      canvas.width = Math.max(1, Math.round(renderSize.width * dpr))
      canvas.height = Math.max(1, Math.round(renderSize.height * dpr))

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.scale(dpr, dpr)

      if (fillImage) {
        drawMaskedLayer(ctx, fillImage, fillColor, renderSize.width, renderSize.height)
      }

      if (strokeImage) {
        drawMaskedLayer(ctx, strokeImage, '#000000', renderSize.width, renderSize.height)
      }
    }

    void draw()

    return () => {
      cancelled = true
    }
  }, [fillUrl, strokeUrl, lodPx, renderSize.width, renderSize.height, fillColor, mobile])

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    />
  )
}

function requestSvg(url: string) {
  const cached = svgCache.get(url)
  if (cached !== undefined) {
    rememberBounded(svgCache, url, cached, SVG_CACHE_MAX)
    return Promise.resolve(cached)
  }

  const pending = svgRequestCache.get(url)
  if (pending) return pending

  const request = fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`Failed to load ${url}`)
      return r.text()
    })
    .then((text) => {
      // Una copia inexistente la responde el fallback SPA con index.html.
      if (isIllustrationLodUrl(url) && !/<svg[\s>]/i.test(text)) {
        throw new Error(`Not an SVG: ${url}`)
      }
      rememberBounded(svgCache, url, text, SVG_CACHE_MAX)
      return text
    })
    .finally(() => {
      svgRequestCache.delete(url)
    })

  svgRequestCache.set(url, request)
  return request
}

type SvgContent = { url: string; text: string }

/**
 * Devuelve el SVG junto con la URL de la que salió. Mientras llega uno nuevo se
 * mantiene el anterior (así no parpadea al cambiar de copia). Si la copia
 * liviana falla, usa la original.
 */
function useSvgContent(url: string, fallbackUrl: string): SvgContent | null {
  const [content, setContent] = useState<SvgContent | null>(() => {
    const text = url ? svgCache.get(url) : undefined
    return text !== undefined ? { url, text } : null
  })

  useEffect(() => {
    if (!url) {
      setContent(null)
      return
    }

    let cancelled = false
    const show = (loadedUrl: string) => (text: string) => {
      if (!cancelled) setContent({ url: loadedUrl, text })
    }

    requestSvg(url)
      .then(show(url))
      .catch(() => {
        if (!fallbackUrl || fallbackUrl === url) throw new Error(`Failed to load ${url}`)
        return requestSvg(fallbackUrl).then(show(fallbackUrl))
      })
      .catch(() => {
        if (!cancelled) setContent(null)
      })

    return () => {
      cancelled = true
    }
  }, [url, fallbackUrl])

  return content
}

// Más allá de este margen (en pantallas) una pieza no está por verse: se puede
// bajar a una copia liviana sin que se note y así liberar memoria.
const NEAR_VIEWPORT_MARGIN = 0.5
const FAR_FROM_VIEWPORT_PX = 1024
// Bajar de nivel espera a que el tamaño/zoom se estabilice, para no alternar
// copias mientras se arrastra un tirador o se hace zoom.
const LOD_DOWNGRADE_DELAY_MS = 1500

/**
 * URL de la copia con el detalle que pide la pieza en pantalla (tamaño × zoom ×
 * densidad). Sube de nivel al instante; baja solo tras estabilizarse o cuando
 * la pieza queda lejos del viewport (así libera memoria sin que se note).
 */
function useViewportLodUrl(shapeId: TLShapeId, url: string, w: number, h: number) {
  const editor = useEditor()

  const neededLevel = useValue(
    'illustration lod level',
    () => {
      const screenPx = Math.max(w, h) * editor.getEfficientZoomLevel() * getDevicePixelRatio()
      return getIllustrationLodLevel(url, screenPx)
    },
    [editor, url, w, h],
  )

  const nearViewport = useValue(
    'illustration near viewport',
    () => {
      const bounds = editor.getShapePageBounds(shapeId)
      if (!bounds) return true
      const viewport = editor.getViewportPageBounds()
      const marginX = viewport.w * NEAR_VIEWPORT_MARGIN
      const marginY = viewport.h * NEAR_VIEWPORT_MARGIN
      return (
        bounds.maxX >= viewport.minX - marginX &&
        bounds.minX <= viewport.maxX + marginX &&
        bounds.maxY >= viewport.minY - marginY &&
        bounds.minY <= viewport.maxY + marginY
      )
    },
    [editor, shapeId],
  )

  const [shownLevel, setShownLevel] = useState(neededLevel)
  const level = nearViewport ? Math.max(shownLevel, neededLevel) : shownLevel
  const targetLevel = nearViewport
    ? neededLevel
    : Math.min(neededLevel, getIllustrationLodLevel(url, FAR_FROM_VIEWPORT_PX))

  useEffect(() => {
    if (level > shownLevel) {
      setShownLevel(level)
      return
    }
    if (targetLevel >= shownLevel) return
    const timeout = setTimeout(() => setShownLevel(targetLevel), LOD_DOWNGRADE_DELAY_MS)
    return () => clearTimeout(timeout)
  }, [level, shownLevel, targetLevel])

  return getIllustrationLodUrl(url, level)
}

function IllustrationComponent({ shape }: { shape: IllustrationShape }) {
  const theme = useDefaultColorTheme()
  const { svgUrl, pngUrl, fillPngUrl, strokePngUrl, w, h, color, fill } = shape.props
  const mobile = isMobileDevice()

  const fillMaskUrl = typeof fillPngUrl === 'string' ? fillPngUrl.trim() : ''
  const strokeMaskUrl = typeof strokePngUrl === 'string' ? strokePngUrl.trim() : ''
  const hasMaskLayers = fillMaskUrl !== '' || strokeMaskUrl !== ''
  const pngTrimmed = typeof pngUrl === 'string' ? pngUrl.trim() : ''
  const hasPng = pngTrimmed !== ''
  const preferMobileRaster = mobile && (hasMaskLayers || hasPng)
  const shouldLoadSvg = !preferMobileRaster || (!hasPng && !hasMaskLayers)

  const lodSvgUrl = useViewportLodUrl(shape.id, svgUrl, w, h)
  const lodPngUrl = useViewportLodUrl(shape.id, pngTrimmed, w, h)

  const svgContent = useSvgContent(shouldLoadSvg ? lodSvgUrl : '', shouldLoadSvg ? svgUrl : '')
  const rawSvg = svgContent?.text ?? null
  const rawSvgUrl = svgContent?.url ?? ''
  const svgHasEmbeddedImages = !!rawSvg && /<image\b/i.test(rawSvg)

  const themeColor = theme[color] || { solid: '#000', semi: 'rgba(0,0,0,0.5)' }
  const strokeColor = typeof themeColor === 'object' && 'solid' in themeColor
      ? themeColor.solid
      : '#000000'
      
  let innerFillColor = 'transparent'
  if (fill === 'solid') {
    innerFillColor = themeColor.solid
  } else if (fill === 'semi') {
    innerFillColor = themeColor.semi
  }

  /**
   * Fondo (`shape-fill`): paleta + estilo de relleno. Sin relleno en tldraw → blanco.
   * Líneas (`shape-stroke` junto a `shape-fill`): siempre negro; la paleta no las tinta.
   */
  // Las piezas merged deben responder al color de tldraw aunque el fill style
  // interno quede en "none". Si no, solo aparenta cambiar el borde.
  const shapeFillPaint = fill === 'none' ? '#ffffff' : innerFillColor
  const isDualLayerIllustration =
    !!rawSvg &&
    /\bclass="[^"]*\bshape-fill\b/.test(rawSvg) &&
    /\bclass="[^"]*\bshape-stroke\b/.test(rawSvg)

  // El tamaño lo da style="width:100%;height:100%" (y todos traen viewBox), así
  // que el SVG procesado no depende de w/h: redimensionar ya no genera una copia
  // nueva por cada cuadro ni vuelve a inyectar el SVG.
  const coloredSvg = useMemo(() => {
    if (!rawSvg) return null

    const cacheKey = [rawSvgUrl, strokeColor, shapeFillPaint, isDualLayerIllustration].join('|')
    const cached = processedSvgCache.get(cacheKey)
    if (cached) {
      rememberBounded(processedSvgCache, cacheKey, cached, PROCESSED_SVG_CACHE_MAX)
      return cached
    }

    let processed = rawSvg
      .replace(/<svg([^>]*)>/, (_, attrs) => `<svg${attrs} style="width:100%;height:100%;">`)
      .replace(
        /(class="[^"]*\bshape-fill\b[^"]*")(\s[^>]*?)(fill=")([^"]*)(")/gi,
        `$1$2$3${shapeFillPaint}$5`,
      )
      .replace(/fill="#000000"/gi, `fill="${strokeColor}"`)
      .replace(/fill="#000"/gi, `fill="${strokeColor}"`)
      .replace(/fill="currentColor"/gi, `fill="${strokeColor}"`)
      .replace(/fill="black"/gi, `fill="${strokeColor}"`)
      .replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, '')

    if (isDualLayerIllustration) {
      processed = processed.replace(
        /(class="[^"]*\bshape-stroke\b[^"]*")(\s[^>]*?)(fill=")([^"]*)(")/gi,
        `$1$2$3#000000$5`,
      )
    }

    rememberBounded(processedSvgCache, cacheKey, processed, PROCESSED_SVG_CACHE_MAX)
    return processed
  }, [rawSvg, rawSvgUrl, strokeColor, shapeFillPaint, isDualLayerIllustration])

  const showSvg = !!coloredSvg
  const showSvgImageFallback = !showSvg && svgHasEmbeddedImages && svgUrl
  const showMaskCanvas = !showSvg && hasMaskLayers && mobile
  const showPngFallback = hasPng && !showSvg && !showSvgImageFallback && !showMaskCanvas

  return (
    <HTMLContainer
      style={{
        width: w,
        height: h,
        position: 'relative',
        overflow: 'hidden',
        pointerEvents: 'all',
        opacity: 1,
      }}
    >
      {showMaskCanvas ? (
        <MaskCanvas
          fillUrl={fillMaskUrl}
          strokeUrl={strokeMaskUrl}
          width={Math.max(1, w)}
          height={Math.max(1, h)}
          fillColor={shapeFillPaint}
          mobile={mobile}
        />
      ) : showSvg && coloredSvg ? (
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
          dangerouslySetInnerHTML={{ __html: coloredSvg }}
        />
      ) : showSvgImageFallback ? (
        <img
          src={svgUrl}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            pointerEvents: 'none',
            userSelect: 'none',
            display: 'block',
          }}
        />
      ) : null}
      {showPngFallback && (
        <img
          src={lodPngUrl}
          onError={(e) => {
            // Si la copia liviana faltara, se vuelve a la original (una sola vez).
            if (e.currentTarget.getAttribute('src') !== pngTrimmed) e.currentTarget.src = pngTrimmed
          }}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          style={{
            position: showSvg ? 'absolute' : 'relative',
            inset: showSvg ? 0 : undefined,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            pointerEvents: 'none',
            userSelect: 'none',
            display: 'block',
          }}
        />
      )}
      {!showSvg && !hasPng && (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 0.3,
          }}
        >
          ···
        </div>
      )}
    </HTMLContainer>
  )
}

export class IllustrationShapeUtil extends BaseBoxShapeUtil<IllustrationShape> {
  static type = 'illustration' as const

  static props = {
    w: T.number,
    h: T.number,
    svgUrl: T.string,
    pngUrl: T.string,
    fillPngUrl: T.string,
    strokePngUrl: T.string,
    name: T.string,
    color: DefaultColorStyle,
    size: DefaultSizeStyle,
    fill: DefaultFillStyle,
  }

  getDefaultProps(): IllustrationShape['props'] {
    return {
      w: 200,
      h: 200,
      svgUrl: '',
      pngUrl: '',
      fillPngUrl: '',
      strokePngUrl: '',
      name: '',
      color: 'black',
      size: 'm',
      fill: 'none',
    }
  }

  override canResize() {
    return true
  }

  override isAspectRatioLocked() {
    return true
  }

  component(shape: IllustrationShape) {
    return <IllustrationComponent shape={shape} />
  }

  indicator() {
    return null
  }

  override onResize(shape: IllustrationShape, info: TLResizeInfo<IllustrationShape>) {
    return resizeBox(shape, info)
  }
}
