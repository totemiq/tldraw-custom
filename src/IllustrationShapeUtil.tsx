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
import { useState, useEffect } from 'react'

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
    fetch(url)
      .then((r) => r.text())
      .then((text) => {
        svgCache.set(url, text)
        setContent(text)
      })
      .catch(() => setContent(null))
  }, [url])

  return content
}

function IllustrationComponent({ shape }: { shape: IllustrationShape }) {
  const theme = useDefaultColorTheme()
  const { svgUrl, pngUrl, w, h, color, fill } = shape.props

  const rawSvg = useSvgContent(svgUrl)
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

  let coloredSvg: string | null = null
  if (rawSvg) {
    coloredSvg = rawSvg
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
      coloredSvg = coloredSvg.replace(
        /(class="[^"]*\bshape-stroke\b[^"]*")(\s[^>]*?)(fill=")([^"]*)(")/gi,
        `$1$2$3#000000$5`,
      )
    }
  }

  const pngTrimmed = typeof pngUrl === 'string' ? pngUrl.trim() : ''
  const hasPng = pngTrimmed !== ''
  const showPngFallback = hasPng && !svgHasEmbeddedImages
  const showSvg = !!coloredSvg

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
      {showSvg && coloredSvg ? (
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
