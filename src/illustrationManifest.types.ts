export interface IllustrationPiece {
  id?: string
  name: string
  svgUrl: string
  pngUrl: string
  w?: number
  h?: number
}

export interface IllustrationGroup {
  id?: string
  name: string
  coverUrl?: string
  guideUrl?: string
  pieces: IllustrationPiece[]
}

export interface IllustrationManifest {
  groups: IllustrationGroup[]
}
