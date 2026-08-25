import type { TableModel } from './model'
import { angleDelta, clamp, wrapAngle } from '../sdk/units'

export interface InputHooks {
  /** Marker ID to stamp on newly created pucks. */
  markerId(): number
  pinchMode(): boolean
}

type Drag =
  | { kind: 'puck'; id: number; offX: number; offY: number }
  | { kind: 'rotate'; id: number; last: number }
  | { kind: 'touch'; id: number }
  | { kind: 'pinch'; a: number; b: number }

const PINCH_MIN_MM = 30
const PINCH_MAX_MM = 600
/** How far off the surface a puck must be dragged before it counts as lifted. */
const LIFT_MARGIN = 0.02

/**
 * Maps one mouse, a keyboard, and any real touchscreen contacts onto the table.
 *
 * Pucks are the easy half: physical pucks stay where you leave them, so
 * simulated ones do too, which means a single mouse can place several over time.
 * Touches need genuine simultaneity, so there are three ways to get it: native
 * multi-touch passthrough, sticky contacts pinned with the number keys, and a
 * pinch-pair mode for two-finger gestures.
 */
export function installInput(surfaceEl: HTMLElement, model: TableModel, hooks: InputHooks): void {
  const drags = new Map<number, Drag>()
  const sticky = new Map<string, number>()
  let cursor = { x: 0.5, y: 0.5 }
  let lastPuck: number | null = null
  let pinchSpreadMm = 120
  let pinchAngle = 0

  /** Unclamped, so that dragging a puck off the edge can be detected. */
  function norm(clientX: number, clientY: number) {
    const r = surfaceEl.getBoundingClientRect()
    return { x: (clientX - r.left) / r.width, y: (clientY - r.top) / r.height }
  }

  function puckCenterClient(id: number) {
    const el = surfaceEl.querySelector<HTMLElement>(`[data-puck-id="${id}"]`)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }

  function pinchPositions(centre: { x: number; y: number }) {
    const s = model.getSurface()
    const halfX = (pinchSpreadMm / 2 / s.widthMm) * Math.cos(pinchAngle)
    const halfY = (pinchSpreadMm / 2 / s.heightMm) * Math.sin(pinchAngle)
    return [
      { x: centre.x - halfX, y: centre.y - halfY },
      { x: centre.x + halfX, y: centre.y + halfY },
    ] as const
  }

  surfaceEl.addEventListener('contextmenu', (ev) => ev.preventDefault())

  surfaceEl.addEventListener('pointerdown', (ev: PointerEvent) => {
    const n = norm(ev.clientX, ev.clientY)
    cursor = n
    const target = ev.target as HTMLElement | null
    const puckEl = target?.closest<HTMLElement>('[data-puck-id]')
    const touchEl = target?.closest<HTMLElement>('[data-touch-id]')

    surfaceEl.setPointerCapture(ev.pointerId)

    if (puckEl) {
      const id = Number(puckEl.dataset.puckId)
      lastPuck = id
      // Right button rotates, left button moves. A real finger always moves.
      if (ev.pointerType !== 'touch' && ev.button === 2) {
        const c = puckCenterClient(id)
        drags.set(ev.pointerId, {
          kind: 'rotate',
          id,
          last: c ? Math.atan2(ev.clientY - c.y, ev.clientX - c.x) : 0,
        })
      } else {
        const p = model.rawPucks().get(id)
        drags.set(ev.pointerId, { kind: 'puck', id, offX: (p?.x ?? n.x) - n.x, offY: (p?.y ?? n.y) - n.y })
      }
      ev.preventDefault()
      return
    }

    if (touchEl && ev.pointerType !== 'touch') {
      const id = Number(touchEl.dataset.touchId)
      if (model.isSticky(id)) {
        drags.set(ev.pointerId, { kind: 'touch', id })
        ev.preventDefault()
        return
      }
    }

    if (ev.pointerType !== 'touch' && hooks.pinchMode()) {
      const [pa, pb] = pinchPositions(n)
      const a = model.addTouch({ x: pa.x, y: pa.y })
      const b = model.addTouch({ x: pb.x, y: pb.y })
      drags.set(ev.pointerId, { kind: 'pinch', a, b })
      ev.preventDefault()
      return
    }

    // Bare contact. A real finger gives a slightly larger footprint than a
    // mouse-simulated fingertip, matching what the tracker would report.
    const id = model.addTouch({ x: n.x, y: n.y, radiusMm: ev.pointerType === 'touch' ? 9 : 8 })
    drags.set(ev.pointerId, { kind: 'touch', id })
    ev.preventDefault()
  })

  surfaceEl.addEventListener('pointermove', (ev: PointerEvent) => {
    const n = norm(ev.clientX, ev.clientY)
    cursor = n
    const d = drags.get(ev.pointerId)
    if (!d) return

    if (d.kind === 'puck') {
      model.movePuck(d.id, { x: n.x + d.offX, y: n.y + d.offY })
    } else if (d.kind === 'rotate') {
      const c = puckCenterClient(d.id)
      if (!c) return
      const a = Math.atan2(ev.clientY - c.y, ev.clientX - c.x)
      const delta = angleDelta(d.last, a)
      d.last = a
      const p = model.rawPucks().get(d.id)
      if (p) model.movePuck(d.id, { angle: wrapAngle(p.angle + delta) })
    } else if (d.kind === 'touch') {
      model.moveTouch(d.id, { x: n.x, y: n.y })
    } else {
      const [pa, pb] = pinchPositions(n)
      model.moveTouch(d.a, pa)
      model.moveTouch(d.b, pb)
    }
  })

  function endDrag(ev: PointerEvent): void {
    const d = drags.get(ev.pointerId)
    if (!d) return
    drags.delete(ev.pointerId)
    const n = norm(ev.clientX, ev.clientY)

    if (d.kind === 'puck') {
      // Dragged clear of the surface counts as lifting the puck off the table.
      const off = n.x < -LIFT_MARGIN || n.x > 1 + LIFT_MARGIN || n.y < -LIFT_MARGIN || n.y > 1 + LIFT_MARGIN
      if (off) {
        model.removePuck(d.id)
        if (lastPuck === d.id) lastPuck = null
      }
    } else if (d.kind === 'touch') {
      if (!model.isSticky(d.id)) model.removeTouch(d.id)
    } else if (d.kind === 'pinch') {
      model.removeTouch(d.a)
      model.removeTouch(d.b)
    }
  }

  surfaceEl.addEventListener('pointerup', endDrag)
  surfaceEl.addEventListener('pointercancel', endDrag)

  surfaceEl.addEventListener(
    'wheel',
    (ev: WheelEvent) => {
      const puckEl = (ev.target as HTMLElement | null)?.closest<HTMLElement>('[data-puck-id]')
      if (puckEl) {
        ev.preventDefault()
        const id = Number(puckEl.dataset.puckId)
        const p = model.rawPucks().get(id)
        if (p) {
          lastPuck = id
          model.movePuck(id, { angle: wrapAngle(p.angle + ev.deltaY * 0.004) })
        }
        return
      }
      // Adjust the pinch pair while it is down: spread, or rotation with shift.
      const active = [...drags.values()].find((d) => d.kind === 'pinch')
      if (active && active.kind === 'pinch') {
        ev.preventDefault()
        if (ev.shiftKey) pinchAngle = wrapAngle(pinchAngle + ev.deltaY * 0.004)
        else pinchSpreadMm = clamp(pinchSpreadMm + ev.deltaY * 0.4, PINCH_MIN_MM, PINCH_MAX_MM)
        const [pa, pb] = pinchPositions(cursor)
        model.moveTouch(active.a, pa)
        model.moveTouch(active.b, pb)
      }
    },
    { passive: false },
  )

  window.addEventListener('keydown', (ev: KeyboardEvent) => {
    const el = document.activeElement
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return

    // Number keys pin a contact at the cursor, so several can be placed and then
    // moved individually. Pressing the same key again lifts it.
    if (ev.key >= '1' && ev.key <= '9') {
      ev.preventDefault()
      const existing = sticky.get(ev.key)
      // The slot may point at a contact that Clear or Escape already removed.
      if (existing !== undefined && model.rawTouches().has(existing)) {
        model.removeTouch(existing)
        sticky.delete(ev.key)
      } else {
        sticky.set(ev.key, model.addTouch({ x: cursor.x, y: cursor.y, sticky: true }))
      }
      return
    }

    switch (ev.key) {
      case 'p':
      case 'P':
        ev.preventDefault()
        lastPuck = model.addPuck({ markerId: hooks.markerId(), x: cursor.x, y: cursor.y })
        break
      case 'Escape':
        ev.preventDefault()
        for (const [key, id] of sticky) {
          model.removeTouch(id)
          sticky.delete(key)
        }
        for (const id of model.touchIds()) model.removeTouch(id)
        break
      case 'Backspace':
      case 'Delete': {
        ev.preventDefault()
        const near = nearestPuckId(model, cursor)
        if (near !== null) model.removePuck(near)
        break
      }
      case '[':
      case ']': {
        ev.preventDefault()
        const id = lastPuck ?? nearestPuckId(model, cursor)
        const p = id === null ? undefined : model.rawPucks().get(id)
        if (id !== null && p) {
          const step = (ev.key === ']' ? 5 : -5) * (Math.PI / 180)
          model.movePuck(id, { angle: wrapAngle(p.angle + step) })
        }
        break
      }
    }
  })

  // Keep the cursor fresh even when the pointer is outside the surface, so that
  // the number keys drop contacts where the designer expects.
  surfaceEl.addEventListener('pointerenter', (ev) => {
    cursor = norm(ev.clientX, ev.clientY)
  })
}

function nearestPuckId(model: TableModel, at: { x: number; y: number }): number | null {
  const s = model.getSurface()
  let best: number | null = null
  let bestMm = s.puckDiameterMm
  for (const [id, p] of model.rawPucks()) {
    const d = Math.hypot((p.x - at.x) * s.widthMm, (p.y - at.y) * s.heightMm)
    if (d < bestMm) [best, bestMm] = [id, d]
  }
  return best
}
