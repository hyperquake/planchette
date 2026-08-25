import type { SurfaceInfo } from './types'

/**
 * Publish the surface geometry as CSS custom properties so that stylesheets can
 * work in millimetres:
 *
 *   .button { min-width: calc(20 * var(--mm)); }
 *   .ring   { width: calc(var(--puck-d) + 40 * var(--mm)); }
 */
export function applyCssVars(surface: SurfaceInfo, el: HTMLElement = document.documentElement): void {
  const s = el.style
  s.setProperty('--mm', `${surface.pxPerMm}px`)
  s.setProperty('--px-per-mm', String(surface.pxPerMm))
  s.setProperty('--table-w', `${surface.widthPx}px`)
  s.setProperty('--table-h', `${surface.heightPx}px`)
  s.setProperty('--puck-d', `${surface.puckDiameterMm * surface.pxPerMm}px`)
}

export const DEG = 180 / Math.PI

/** Shortest signed difference between two angles, in radians. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

/** Normalize an angle into [0, 2*PI). */
export function wrapAngle(a: number): number {
  const tau = Math.PI * 2
  return ((a % tau) + tau) % tau
}

/**
 * Nearest table edge for a contact, computed in millimetres so that it stays
 * correct on non-square-aspect surfaces. Used as a cheap "which user" hint.
 */
export function nearestEdge(mmX: number, mmY: number, widthMm: number, heightMm: number): 'n' | 's' | 'e' | 'w' {
  const d = { n: mmY, s: heightMm - mmY, w: mmX, e: widthMm - mmX }
  let best: 'n' | 's' | 'e' | 'w' = 'n'
  for (const k of ['s', 'w', 'e'] as const) if (d[k] < d[best]) best = k
  return best
}

/**
 * Shared by the model, the input layer, and solo mode, all of which had their
 * own copy. Not re-exported from index.ts: this is a shared implementation
 * detail, not part of what an interface gets.
 */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** Normalized coordinates never leave the surface. */
export function clamp01(v: number): number {
  return clamp(v, 0, 1)
}
