import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  DefaultColorStyle,
  DefaultSizeStyle,
  DefaultFillStyle,
  useDefaultColorTheme,
  resizeBox,
} from 'tldraw'
import type {
  TLShape,
  TLResizeInfo,
  TLDefaultColorStyle,
  TLDefaultSizeStyle,
  TLDefaultFillStyle,
} from 'tldraw'
import { useMemo, useState, useEffect } from 'react'

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

function maskIdPart(value: string) {
  return (value || 'empty').replace(/[^a-zA-Z0-9_-]+/g, '_')
}

function buildMaskSvgMarkup(fillUrl: string, strokeUrl: string, fillColor: string) {
  const fillMaskId = `fill-mask-${maskIdPart(fillUrl)}-${maskIdPart(strokeUrl)}`
  const strokeMaskId = `stroke-mask-${maskIdPart(fillUrl)}-${maskIdPart(strokeUrl)}`
  const fillMask = fillUrl
    ? `
      <mask id="${fillMaskId}" maskUnits="objectBoundingBox" maskContentUnits="objectBoundingBox">
        <image href="${fillUrl}" width="1" height="1" preserveAspectRatio="xMidYMid meet" />
      </mask>
      <rect width="100%" height="100%" fill="${fillColor}" mask="url(#${fillMaskId})" />
    `
    : ''

  const strokeMask = strokeUrl
    ? `
      <mask id="${strokeMaskId}" maskUnits="objectBoundingBox" maskContentUnits="objectBoundingBox">
        <image href="${strokeUrl}" width="1" height="1" preserveAspectRatio="xMidYMid meet" />
      </mask>
      <rect width="100%" height="100%" fill="#000000" mask="url(#${strokeMaskId})" />
    `
    : ''

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;display:block;">
      ${fillMask}
      ${strokeMask}
    </svg>
  `
}

function useSvgContent(url: string): string | null {
  const [content, setContent] = useState<string | null>(() =>
    url ? (svgCache.get(url) ?? null) : null,
  )

  useEffect(() => {
    if (!url) {
      setContent(null)
      return
    }
    if (svgCache.has(url)) {
      setContent(svgCache.get(url)!)
      return
    }
    const request =
      svgRequestCache.get(url) ??
      fetch(url).then((r) => {
        if (!r.ok) throw new Error(`Failed to load ${url}`)
        return r.text()
      })

    svgRequestCache.set(url, request)

    request
      .then((text) => {
        svgCache.set(url, text)
        setContent(text)
      })
      .catch(() => {
        svgRequestCache.delete(url)
        setContent(null)
      })
  }, [url])

  return content
}

function IllustrationComponent({ shape }: { shape: IllustrationShape }) {
  const theme = useDefaultColorTheme()
  const { svgUrl, pngUrl, fillPngUrl, strokePngUrl, w, h, color, fill } = shape.props

  const fillMaskUrl = typeof fillPngUrl === 'string' ? fillPngUrl.trim() : ''
  const strokeMaskUrl = typeof strokePngUrl === 'string' ? strokePngUrl.trim() : ''
  const hasMaskLayers = fillMaskUrl !== '' || strokeMaskUrl !== ''

  const rawSvg = useSvgContent(hasMaskLayers ? '' : svgUrl)
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

  const coloredSvg = useMemo(() => {
    if (!rawSvg) return null

    const cacheKey = [svgUrl, w, h, strokeColor, shapeFillPaint, isDualLayerIllustration].join('|')
    const cached = processedSvgCache.get(cacheKey)
    if (cached) return cached

    let processed = rawSvg
      .replace(/<svg([^>]*)>/, (_, attrs) => {
        let updated = attrs
        updated = updated.replace(/width="[^"]*"/, `width="${w}"`)
        updated = updated.replace(/height="[^"]*"/, `height="${h}"`)
        return `<svg${updated} style="width:100%;height:100%;">`
      })
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

    processedSvgCache.set(cacheKey, processed)
    return processed
  }, [rawSvg, svgUrl, w, h, strokeColor, shapeFillPaint, isDualLayerIllustration])

  const pngTrimmed = typeof pngUrl === 'string' ? pngUrl.trim() : ''
  const hasPng = pngTrimmed !== ''
  const showPngFallback = hasPng && !svgHasEmbeddedImages
  const showSvg = !!coloredSvg
  const maskSvgMarkup = hasMaskLayers
    ? buildMaskSvgMarkup(fillMaskUrl, strokeMaskUrl, shapeFillPaint)
    : null

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
      {hasMaskLayers ? (
        <div
          style={{ width: '100%', height: '100%', pointerEvents: 'none', userSelect: 'none' }}
          dangerouslySetInnerHTML={{ __html: maskSvgMarkup ?? '' }}
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
      ) : svgHasEmbeddedImages && svgUrl ? (
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
          src={pngTrimmed}
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
