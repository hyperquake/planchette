/**
 * @planchette/sdk
 *
 * The one module a designer app imports. It gives you the state of the table
 * two ways:
 *
 *   Pull, for render loops (canvas, Pixi, Three, or a DOM diff):
 *     table.ready(() => {
 *       requestAnimationFrame(function loop() {
 *         const { pucks, touches } = table.state()
 *         render(pucks, touches)
 *         requestAnimationFrame(loop)
 *       })
 *     })
 *
 *   Push, for DOM UI that reacts to discrete moments:
 *     table.on('puckadd', p => openPanelFor(p.markerId))
 *
 * The same code runs against the simulator, against a standalone browser window
 * (solo mode), and later against real hardware, because only the transport
 * changes.
 */

import { connect, REFERENCE_PX_PER_MM, SDK_VERSION } from './transport'
import type { Puck, SurfaceInfo, TableEventMap, TableEventName, TableState, Touch } from './types'
import { angleDelta, applyCssVars, DEG, nearestEdge, wrapAngle } from './units'

export type { Puck, SurfaceInfo, TableState, Touch, TableEventName } from './types'

const FALLBACK_SURFACE: SurfaceInfo = {
  id: 'pending',
  label: 'Not connected',
  widthPx: 3840,
  heightPx: 2160,
  widthMm: 3840 / REFERENCE_PX_PER_MM,
  heightMm: 2160 / REFERENCE_PX_PER_MM,
  pxPerMm: REFERENCE_PX_PER_MM,
  puckDiameterMm: 60,
}

const EMPTY: TableState = Object.freeze({
  pucks: Object.freeze([]) as unknown as Puck[],
  touches: Object.freeze([]) as unknown as Touch[],
  surface: FALLBACK_SURFACE,
  t: 0,
})

let state: TableState = EMPTY
let connected = false
let readyFired = false
const readyCbs: Array<(ctx: { surface: SurfaceInfo }) => void> = []
const handlers = new Map<TableEventName, Set<(data: never) => void>>()

/**
 * Freeze what we hand out so that a designer mutating a puck by accident fails
 * loudly instead of silently desynchronising from the host.
 */
function freeze(s: TableState): TableState {
  s.pucks.forEach(Object.freeze)
  s.touches.forEach(Object.freeze)
  Object.freeze(s.pucks)
  Object.freeze(s.touches)
  Object.freeze(s.surface)
  return Object.freeze(s)
}

const isSolo = connect({
  config(surface, initial) {
    connected = true
    state = freeze({ ...initial, surface })
    applyCssVars(surface)
    if (!readyFired) {
      readyFired = true
      for (const cb of readyCbs) safely(() => cb({ surface }))
      readyCbs.length = 0
    }
  },
  state(next) {
    state = freeze(next)
  },
  event(name, data) {
    // Fold the event into the cached state BEFORE dispatching it. A handler that
    // calls table.state(), nearestPuck(), or puckById() must see a table that
    // already includes the thing it is being told about. Without this, discrete
    // events can outrun the once-per-frame state snapshot and a handler runs
    // against the previous frame, which fails intermittently and is miserable to
    // debug.
    fold(name, data)
    const set = handlers.get(name)
    if (!set) return
    for (const fn of [...set]) safely(() => (fn as (d: unknown) => void)(data))
  },
})

function fold(name: TableEventName, data: Puck | Touch): void {
  const isPuck = name.startsWith('puck')
  const list: readonly (Puck | Touch)[] = isPuck ? state.pucks : state.touches
  let next: (Puck | Touch)[]

  if (name === 'puckremove' || name === 'touchend') {
    next = list.filter((o) => o.id !== data.id)
  } else {
    next = [...list]
    const i = next.findIndex((o) => o.id === data.id)
    if (i >= 0) next[i] = data
    else next.push(data)
  }

  state = freeze(isPuck ? { ...state, pucks: next as Puck[] } : { ...state, touches: next as Touch[] })
}

function safely(fn: () => void): void {
  try {
    fn()
  } catch (err) {
    console.error('[table] handler threw', err)
  }
}

export const table = {
  version: SDK_VERSION,

  /** True when running standalone rather than inside the simulator. */
  get isSolo(): boolean {
    return isSolo
  },

  get connected(): boolean {
    return connected
  },

  /** Physical and pixel description of the surface you are drawing on. */
  get surface(): SurfaceInfo {
    return state.surface
  },

  /** A frozen snapshot of everything on the table right now. Cheap to call every frame. */
  state(): TableState {
    return state
  },

  get pucks(): readonly Puck[] {
    return state.pucks
  },

  get touches(): readonly Touch[] {
    return state.touches
  },

  /** Runs once the surface geometry is known. Call your setup from here. */
  ready(cb: (ctx: { surface: SurfaceInfo }) => void): void {
    if (readyFired) safely(() => cb({ surface: state.surface }))
    else readyCbs.push(cb)
  },

  /** Subscribe to a discrete event. Returns an unsubscribe function. */
  on<K extends TableEventName>(name: K, fn: (data: TableEventMap[K]) => void): () => void {
    let set = handlers.get(name)
    if (!set) handlers.set(name, (set = new Set()))
    set.add(fn as (data: never) => void)
    return () => void set!.delete(fn as (data: never) => void)
  },

  off<K extends TableEventName>(name: K, fn: (data: TableEventMap[K]) => void): void {
    handlers.get(name)?.delete(fn as (data: never) => void)
  },

  /** Millimetres to pixels. The unit you should be designing in. */
  mm(v: number): number {
    return v * state.surface.pxPerMm
  },

  /** Pixels to millimetres. */
  px(v: number): number {
    return v / state.surface.pxPerMm
  },

  deg(radians: number): number {
    return radians * DEG
  },

  rad(degrees: number): number {
    return degrees / DEG
  },

  puckById(id: number): Puck | undefined {
    return state.pucks.find((p) => p.id === id)
  },

  /** All pucks carrying a given physical marker. */
  pucksByMarker(markerId: number): Puck[] {
    return state.pucks.filter((p) => p.markerId === markerId)
  },

  /** Closest puck to a point given in millimetres, optionally within a radius. */
  nearestPuck(mmX: number, mmY: number, withinMm = Infinity): Puck | undefined {
    let best: Puck | undefined
    let bestD = withinMm
    for (const p of state.pucks) {
      const d = Math.hypot(p.mmX - mmX, p.mmY - mmY)
      if (d <= bestD) [best, bestD] = [p, d]
    }
    return best
  },

  /** Closest touch to a point given in millimetres, optionally within a radius. */
  nearestTouch(mmX: number, mmY: number, withinMm = Infinity): Touch | undefined {
    let best: Touch | undefined
    let bestD = withinMm
    for (const t of state.touches) {
      const d = Math.hypot(t.mmX - mmX, t.mmY - mmY)
      if (d <= bestD) [best, bestD] = [t, d]
    }
    return best
  },
}

export { angleDelta, wrapAngle, nearestEdge, applyCssVars }
