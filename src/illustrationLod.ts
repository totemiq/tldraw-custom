import lodData from './illustrationLod.json'

// Niveles de detalle generados por scripts/generate-lod-illustrations.mjs.
// Clave: ruta del original ("/illustrations/..."); valor: [ancho, alto, niveles],
// donde cada nivel es el lado mayor en px de la copia en /illustrations/lod/<nivel>/.
type LodEntry = [number, number, number[]]

const LOD = lodData as unknown as Record<string, LodEntry>
const ILLUSTRATIONS_SEGMENT = '/illustrations/'

function findLodEntry(url: string) {
  if (!url || typeof window === 'undefined') return null

  let parsed: URL
  try {
    parsed = new URL(url, window.location.href)
  } catch {
    return null
  }
  if (parsed.origin !== window.location.origin) return null

  const index = parsed.pathname.indexOf(ILLUSTRATIONS_SEGMENT)
  if (index < 0) return null

  let key: string
  try {
    key = decodeURIComponent(parsed.pathname.slice(index))
  } catch {
    return null
  }

  const entry = LOD[key]
  return entry ? { parsed, index, entry } : null
}

/**
 * Nivel (lado mayor en px) de la copia más liviana que cubre `neededPx` píxeles
 * de pantalla, o `Infinity` si hace falta la original (o la URL no tiene copias).
 * Nunca elige una copia con menos detalle del que se ve.
 */
export function getIllustrationLodLevel(url: string, neededPx: number): number {
  const found = findLodEntry(url)
  if (!found) return Infinity
  return found.entry[2].find((level) => level >= neededPx) ?? Infinity
}

export function getIllustrationLodUrl(url: string, neededPx: number): string {
  const found = findLodEntry(url)
  if (!found) return url

  const level = found.entry[2].find((candidate) => candidate >= neededPx)
  if (!level) return url

  const { parsed, index } = found
  const prefix = parsed.pathname.slice(0, index)
  const rest = parsed.pathname.slice(index + ILLUSTRATIONS_SEGMENT.length)
  const lodPath = `${prefix}${ILLUSTRATIONS_SEGMENT}lod/${level}/${rest}${parsed.search}`

  return /^[a-z][a-z\d+.-]*:/i.test(url) ? `${parsed.origin}${lodPath}` : lodPath
}

export function isIllustrationLodUrl(url: string) {
  return url.includes(`${ILLUSTRATIONS_SEGMENT}lod/`)
}

export function getDevicePixelRatio() {
  if (typeof window === 'undefined') return 1
  return window.devicePixelRatio || 1
}
