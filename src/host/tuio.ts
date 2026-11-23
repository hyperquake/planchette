import type { TableModel } from './model'

/**
 * Input from a real table, as the main process hands it over: already mapped to
 * logical marker ids and calibrated (electron/tuio.js). This is just another
 * input source for TableModel, alongside the mouse, so everything downstream
 * (the app frame's handshake and replay, the inspector, window.sim) works
 * unchanged.
 *
 * Keys are the tracker's sessions. Model ids are assigned by the model from its
 * one shared counter, as for any other puck or touch.
 */

export interface TuioPuck {
  key: string
  markerId: number
  tag: number
  x: number
  y: number
  angle: number
}

export interface TuioTouch {
  key: string
  x: number
  y: number
}

export interface TuioFrame {
  pucks: { added: TuioPuck[]; moved: TuioPuck[]; removed: string[] }
  touches: { added: TuioTouch[]; moved: TuioTouch[]; removed: string[] }
}

export interface TuioControlEvent {
  type: 'add' | 'move' | 'remove'
  key: string
  x?: number
  y?: number
  angle?: number
}

export interface TuioStatus {
  state: 'off' | 'starting' | 'listening' | 'error'
  host: string | null
  port: number | null
  error: string | null
  packetsPerSec: number
  badPackets: number
  lastPacketAgoMs: number | null
  tags: Array<{ tag: number; markerId: number | null; control: boolean }>
  unknownTags: number[]
}

export interface TableConfig {
  version: number
  present: boolean
  display: number | null
  surface: string
  tuio: { enabled: boolean; host: string; port: number; staleMs: number }
  calibration: { flipX: boolean; flipY: boolean; angleOffsetDeg: number; angleReversed: boolean }
  pucks: Array<{ markerId: number; tag: number; label: string }>
  control: { tag: number | null }
  unmapped: 'ignore' | 'passthrough'
}

/** Real fingers are a little larger than the simulator's 8mm default. 2Dcur carries no size. */
const TOUCH_RADIUS_MM = 9

export interface TuioInput {
  /** The raw tracker tag behind a model puck, for the inspector's tag column. */
  tagFor(modelId: number): number | undefined
  /**
   * True for a puck the tracker put there. Those are never persisted across a
   * reload: the tracker is the truth, and the main process replays them.
   */
  owns(modelId: number): boolean
}

export function installTuio(model: TableModel, bridge: { onTuioFrame(cb: (f: TuioFrame) => void): void }): TuioInput {
  const pucks = new Map<string, number>()
  const touches = new Map<string, number>()
  const tags = new Map<number, number>()

  bridge.onTuioFrame((f) => {
    // Removals first: a mapping change withdraws and re-adds the same session in
    // one frame, and the add must not be taken for a move of the old puck.
    for (const key of f.pucks.removed) {
      const id = pucks.get(key)
      if (id === undefined) continue
      pucks.delete(key)
      tags.delete(id)
      model.removePuck(id)
    }
    for (const key of f.touches.removed) {
      const id = touches.get(key)
      if (id === undefined) continue
      touches.delete(key)
      model.removeTouch(id)
    }

    // An add for a session we already have, or a move for one we do not, both
    // happen when the two sides disagree after a reload. Either way, the frame
    // carries everything needed, so converge rather than drop it.
    for (const p of [...f.pucks.added, ...f.pucks.moved]) {
      const id = pucks.get(p.key)
      if (id === undefined) {
        const nid = model.addPuck({ markerId: p.markerId, x: p.x, y: p.y, angle: p.angle })
        pucks.set(p.key, nid)
        tags.set(nid, p.tag)
      } else {
        model.movePuck(id, { x: p.x, y: p.y, angle: p.angle })
      }
    }
    for (const t of [...f.touches.added, ...f.touches.moved]) {
      const id = touches.get(t.key)
      if (id === undefined) touches.set(t.key, model.addTouch({ x: t.x, y: t.y, radiusMm: TOUCH_RADIUS_MM }))
      else model.moveTouch(id, { x: t.x, y: t.y })
    }
  })

  return { tagFor: (id) => tags.get(id), owns: (id) => tags.has(id) }
}
