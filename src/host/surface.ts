import type { SurfaceInfo } from '../sdk/types'

/** Physical diameter of a puck, including the marker and the hand holding it. */
export const PUCK_DIAMETER_MM = 60

interface Preset {
  id: string
  label: string
  widthPx: number
  heightPx: number
  /** Physical width. Derived from the panel diagonal at authoring time. */
  widthMm: number
}

export const PRESETS: Preset[] = [
  // 55" 16:9 diagonal = 1397mm, so width = 1397 * 3840 / hypot(3840, 2160).
  { id: 'table55-4k', label: '55" 4K table', widthPx: 3840, heightPx: 2160, widthMm: 1218 },
  { id: 'table65-4k', label: '65" 4K table', widthPx: 3840, heightPx: 2160, widthMm: 1439 },
  { id: 'table46-fhd', label: '46" 1080p table', widthPx: 1920, heightPx: 1080, widthMm: 1019 },
  { id: 'wall2x55-4k', label: '2 x 55" wall', widthPx: 7680, heightPx: 2160, widthMm: 2436 },
]

export function infoFor(id: string): SurfaceInfo {
  const p = PRESETS.find((x) => x.id === id) ?? PRESETS[0]!
  const heightMm = (p.widthMm * p.heightPx) / p.widthPx
  return {
    id: p.id,
    label: p.label,
    widthPx: p.widthPx,
    heightPx: p.heightPx,
    widthMm: p.widthMm,
    heightMm,
    pxPerMm: p.widthPx / p.widthMm,
    puckDiameterMm: PUCK_DIAMETER_MM,
  }
}
