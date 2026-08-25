import type { Puck, SurfaceInfo, TableEventName, TableState, Touch } from '../sdk/types'
import { angleDelta, clamp01, nearestEdge, wrapAngle } from '../sdk/units'

/** Internal record. Public Puck/Touch shapes add the derived millimetre fields. */
interface PuckRec {
  id: number
  markerId: number
  x: number
  y: number
  angle: number
  vx: number
  vy: number
  vAngle: number
  firstSeen: number
  lastSeen: number
}

interface TouchRec {
  id: number
  x: number
  y: number
  radiusMm: number
  /** Sticky contacts persist until explicitly removed; transient ones follow a pointer. */
  sticky: boolean
  firstSeen: number
  lastSeen: number
}

type Listener = (name: TableEventName, data: Puck | Touch) => void

const VELOCITY_SMOOTHING = 0.4

/**
 * Owns all puck and touch state. Everything that mutates the table goes through
 * here, which is what lets the inspector, the app frame, and window.sim all see
 * a single consistent truth.
 */
export class TableModel {
  private pucks = new Map<number, PuckRec>()
  private touches = new Map<number, TouchRec>()
  /** TUIO uses one session id space for objects and cursors alike. */
  private nextId = 1
  private listeners = new Set<Listener>()
  private surface: SurfaceInfo
  private dirty = true

  constructor(surface: SurfaceInfo) {
    this.surface = surface
  }

  setSurface(surface: SurfaceInfo): void {
    this.surface = surface
    this.dirty = true
  }

  getSurface(): SurfaceInfo {
    return this.surface
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  private emit(name: TableEventName, data: Puck | Touch): void {
    for (const fn of [...this.listeners]) {
      try {
        fn(name, data)
      } catch (err) {
        console.error('[model] listener threw', err)
      }
    }
  }

  /** True if anything changed since the last call. Resets the flag. */
  consumeDirty(): boolean {
    const d = this.dirty
    this.dirty = false
    return d
  }

  hasContacts(): boolean {
    return this.pucks.size > 0 || this.touches.size > 0
  }

  /* ---------------- pucks ---------------- */

  addPuck(opts: { markerId: number; x: number; y: number; angle?: number }): number {
    const id = this.nextId++
    const now = performance.now()
    this.pucks.set(id, {
      id,
      markerId: opts.markerId,
      x: clamp01(opts.x),
      y: clamp01(opts.y),
      angle: wrapAngle(opts.angle ?? 0),
      vx: 0,
      vy: 0,
      vAngle: 0,
      firstSeen: now,
      lastSeen: now,
    })
    this.dirty = true
    this.emit('puckadd', this.publicPuck(id)!)
    return id
  }

  movePuck(id: number, opts: { x?: number; y?: number; angle?: number }): void {
    const p = this.pucks.get(id)
    if (!p) return
    const now = performance.now()
    const dt = Math.max(now - p.lastSeen, 1) / 1000

    if (opts.x !== undefined || opts.y !== undefined) {
      const nx = opts.x !== undefined ? clamp01(opts.x) : p.x
      const ny = opts.y !== undefined ? clamp01(opts.y) : p.y
      p.vx = lerp(p.vx, (nx - p.x) / dt, VELOCITY_SMOOTHING)
      p.vy = lerp(p.vy, (ny - p.y) / dt, VELOCITY_SMOOTHING)
      p.x = nx
      p.y = ny
    }
    if (opts.angle !== undefined) {
      const na = wrapAngle(opts.angle)
      p.vAngle = lerp(p.vAngle, angleDelta(p.angle, na) / dt, VELOCITY_SMOOTHING)
      p.angle = na
    }
    p.lastSeen = now
    this.dirty = true
    this.emit('puckmove', this.publicPuck(id)!)
  }

  removePuck(id: number): void {
    const pub = this.publicPuck(id)
    if (!pub) return
    this.pucks.delete(id)
    this.dirty = true
    this.emit('puckremove', pub)
  }

  puckIds(): number[] {
    return [...this.pucks.keys()]
  }

  rawPucks(): ReadonlyMap<number, PuckRec> {
    return this.pucks
  }

  /* ---------------- touches ---------------- */

  addTouch(opts: { x: number; y: number; radiusMm?: number; sticky?: boolean }): number {
    const id = this.nextId++
    const now = performance.now()
    this.touches.set(id, {
      id,
      x: clamp01(opts.x),
      y: clamp01(opts.y),
      radiusMm: opts.radiusMm ?? 8,
      sticky: opts.sticky ?? false,
      firstSeen: now,
      lastSeen: now,
    })
    this.dirty = true
    this.emit('touchstart', this.publicTouch(id)!)
    return id
  }

  moveTouch(id: number, opts: { x?: number; y?: number; radiusMm?: number }): void {
    const t = this.touches.get(id)
    if (!t) return
    if (opts.x !== undefined) t.x = clamp01(opts.x)
    if (opts.y !== undefined) t.y = clamp01(opts.y)
    if (opts.radiusMm !== undefined) t.radiusMm = opts.radiusMm
    t.lastSeen = performance.now()
    this.dirty = true
    this.emit('touchmove', this.publicTouch(id)!)
  }

  removeTouch(id: number): void {
    const pub = this.publicTouch(id)
    if (!pub) return
    this.touches.delete(id)
    this.dirty = true
    this.emit('touchend', pub)
  }

  isSticky(id: number): boolean {
    return this.touches.get(id)?.sticky ?? false
  }

  touchIds(): number[] {
    return [...this.touches.keys()]
  }

  rawTouches(): ReadonlyMap<number, TouchRec> {
    return this.touches
  }

  clear(): void {
    for (const id of this.touchIds()) this.removeTouch(id)
    for (const id of this.puckIds()) this.removePuck(id)
  }

  /* ---------------- serialization ---------------- */

  publicPuck(id: number): Puck | undefined {
    const p = this.pucks.get(id)
    if (!p) return undefined
    const s = this.surface
    return { ...p, mmX: p.x * s.widthMm, mmY: p.y * s.heightMm }
  }

  publicTouch(id: number): Touch | undefined {
    const t = this.touches.get(id)
    if (!t) return undefined
    const s = this.surface
    const mmX = t.x * s.widthMm
    const mmY = t.y * s.heightMm
    return {
      id: t.id,
      x: t.x,
      y: t.y,
      mmX,
      mmY,
      radiusMm: t.radiusMm,
      edge: nearestEdge(mmX, mmY, s.widthMm, s.heightMm),
      firstSeen: t.firstSeen,
      lastSeen: t.lastSeen,
    }
  }

  snapshot(): TableState {
    return {
      surface: this.surface,
      t: performance.now(),
      pucks: this.puckIds().map((id) => this.publicPuck(id)!),
      touches: this.touchIds().map((id) => this.publicTouch(id)!),
    }
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
