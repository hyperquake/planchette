/**
 * The wire contract between the simulator host and a designer app.
 *
 * Field semantics deliberately mirror TUIO (tuio.org), the open protocol for
 * tangible surfaces, so that a future hardware bridge is a translation layer
 * rather than a rewrite. In particular: coordinates are normalized 0..1 with
 * the y axis pointing down, and angles are radians.
 */

export const PROTOCOL_VERSION = 1

/** Physical and pixel description of the table surface. */
export interface SurfaceInfo {
  id: string
  label: string
  /** Layout width in CSS pixels. An app is laid out at exactly this size. */
  widthPx: number
  heightPx: number
  widthMm: number
  heightMm: number
  /** Multiply millimetres by this to get pixels. */
  pxPerMm: number
  /** Physical diameter of a puck. Never draw anything meaningful under it. */
  puckDiameterMm: number
}

/**
 * A tangible object on the surface.
 *
 * `id` is a session id, stable only while the puck is continuously tracked.
 * `markerId` is the physical marker class (a Codice tag on real hardware) and
 * is what you should switch on to decide what a puck means.
 */
export interface Puck {
  id: number
  markerId: number
  /** Normalized 0..1, y axis down. */
  x: number
  y: number
  mmX: number
  mmY: number
  /** Radians. 0 = marker north toward the top of the screen, clockwise positive, range [0, 2*PI). */
  angle: number
  /** Normalized units per second. */
  vx: number
  vy: number
  /** Radians per second. */
  vAngle: number
  firstSeen: number
  lastSeen: number
}

/** A finger, palm, or stylus contact. */
export interface Touch {
  id: number
  x: number
  y: number
  mmX: number
  mmY: number
  /** Contact radius. A fingertip is roughly 8mm, a palm much larger. */
  radiusMm: number
  /** Nearest table edge. A cheap hint for which side of the table a user is on. */
  edge: 'n' | 's' | 'e' | 'w'
  firstSeen: number
  lastSeen: number
}

export interface TableState {
  pucks: Puck[]
  touches: Touch[]
  surface: SurfaceInfo
  /** Milliseconds, from performance.now() on the host. */
  t: number
}

export type TableEventName =
  | 'puckadd'
  | 'puckmove'
  | 'puckremove'
  | 'touchstart'
  | 'touchmove'
  | 'touchend'

export interface TableEventMap {
  puckadd: Puck
  puckmove: Puck
  puckremove: Puck
  touchstart: Touch
  touchmove: Touch
  touchend: Touch
}

/** Host to app. */
export type HostMessage =
  | { __table: typeof PROTOCOL_VERSION; type: 'config'; surface: SurfaceInfo; state: TableState }
  | { __table: typeof PROTOCOL_VERSION; type: 'state'; state: TableState }
  | { __table: typeof PROTOCOL_VERSION; type: 'event'; name: TableEventName; data: Puck | Touch }

/** App to host. */
export type AppMessage = {
  __table: typeof PROTOCOL_VERSION
  type: 'hello'
  sdkVersion: string
}
