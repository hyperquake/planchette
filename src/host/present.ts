import type { Touch } from '../sdk/types'
import { nearestEdge } from '../sdk/units'
import type { AppFrame } from './appframe'
import type { TableModel } from './model'
import type { TuioControlEvent } from './tuio'

/**
 * Switching interfaces on the table itself, where there is no keyboard.
 *
 * Put the control puck down and the interfaces appear in a ring around it.
 * Turning the puck highlights one; a finger on any of them opens it. Lifting the
 * puck closes the ring, after a grace period, because tracking flickers and a
 * sleeve passing over the puck must not dismiss it.
 *
 * The same ring opens from Table > Choose Interface for setup with a keyboard:
 * arrows to move, Enter to open, Escape to close.
 *
 * Drawn in table pixels inside the surface, so it is sized in millimetres like
 * everything else that appears on the table.
 */

const TAU = Math.PI * 2
const GRACE_MS = 1500
const ITEM_W_MM = 80
const ITEM_H_MM = 24
const MIN_RADIUS_MM = 120
/** Generous: a fingertip on a table is not a mouse pointer. */
const HIT_SLOP_MM = 6

/** Text faces the person at the nearest edge. Clockwise degrees. */
const EDGE_ROTATION = { s: 0, n: 180, e: -90, w: 90 } as const

interface Item {
  id: string
  el: HTMLElement
  /** Centre, in table pixels. */
  x: number
  y: number
  /** Clockwise degrees the label is turned to face its reader. */
  rotate: number
}

export interface Present {
  open(): void
  close(): void
  readonly isOpen: boolean
}

export function installPresent(opts: {
  surfaceEl: HTMLElement
  model: TableModel
  frame: AppFrame
  /** Interfaces to offer. Folders starting with an underscore are templates and are left out. */
  list(): string[]
  select(id: string): void
  onControl(cb: (e: TuioControlEvent) => void): void
}): Present {
  const { surfaceEl, model, frame } = opts

  const layer = document.createElement('div')
  layer.id = 'picker'
  layer.hidden = true
  surfaceEl.append(layer)

  let open = false
  let items: Item[] = []
  let highlight = 0
  /** The control puck session that opened the ring, if one did. */
  let controlKey: string | null = null
  /** A session that has already chosen; its ring stays shut until it is lifted. */
  let spentKey: string | null = null
  let closeTimer: ReturnType<typeof setTimeout> | null = null

  const surface = () => model.getSurface()

  function draw(cx01: number, cy01: number) {
    const s = surface()
    const mm = s.pxPerMm
    const ids = opts.list().filter((id) => !id.startsWith('_'))
    const radiusMm = Math.max(MIN_RADIUS_MM, (ids.length * (ITEM_W_MM + 10)) / TAU)

    // Keep the whole ring on the table, however near the edge the puck is.
    const margin = radiusMm + ITEM_W_MM / 2 + 10
    const cxMm = Math.min(Math.max(cx01 * s.widthMm, margin), Math.max(s.widthMm - margin, margin))
    const cyMm = Math.min(Math.max(cy01 * s.heightMm, margin), Math.max(s.heightMm - margin, margin))
    const rotate = EDGE_ROTATION[nearestEdge(cx01 * s.widthMm, cy01 * s.heightMm, s.widthMm, s.heightMm)]

    layer.style.width = `${s.widthPx}px`
    layer.style.height = `${s.heightPx}px`
    layer.style.setProperty('--mm', `${mm}px`)

    const empty = ids.length === 0
    items = (empty ? ['no interfaces in this workspace'] : ids).map((id, i) => {
      const a = (i / Math.max(ids.length, 1)) * TAU
      const x = (cxMm + radiusMm * Math.sin(a)) * mm
      const y = (cyMm - radiusMm * Math.cos(a)) * mm
      const el = document.createElement('div')
      el.className = 'picker-item'
      // Text, not markup: these are folder names from disk.
      el.textContent = id
      el.style.width = `${ITEM_W_MM * mm}px`
      el.style.height = `${ITEM_H_MM * mm}px`
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${rotate}deg)`
      // Normalized centre, for tests and for checking alignment on a real table.
      el.dataset.x = (x / s.widthPx).toFixed(4)
      el.dataset.y = (y / s.heightPx).toFixed(4)
      return { id: empty ? '' : id, el, x, y, rotate }
    })
    layer.replaceChildren(...items.map((i) => i.el))
    paint()
  }

  function paint() {
    items.forEach((it, i) => it.el.classList.toggle('on', i === highlight))
  }

  function show(cx01: number, cy01: number) {
    if (closeTimer) clearTimeout(closeTimer)
    closeTimer = null
    if (!open) {
      const current = opts.list().filter((id) => !id.startsWith('_'))
      highlight = Math.max(0, current.indexOf(frame.currentApp ?? ''))
    }
    open = true
    layer.hidden = false
    frame.holdNewTouches(true)
    draw(cx01, cy01)
  }

  function hide() {
    if (closeTimer) clearTimeout(closeTimer)
    closeTimer = null
    open = false
    controlKey = null
    layer.hidden = true
    layer.replaceChildren()
    items = []
    frame.holdNewTouches(false)
  }

  function choose(i: number) {
    const it = items[i]
    if (!it?.id) return
    spentKey = controlKey
    hide()
    opts.select(it.id)
  }

  /* ---------------- the control puck ---------------- */

  opts.onControl((e) => {
    if (e.type === 'remove') {
      if (e.key === spentKey) spentKey = null
      if (e.key === controlKey && open) {
        if (closeTimer) clearTimeout(closeTimer)
        closeTimer = setTimeout(hide, GRACE_MS)
      }
      return
    }
    if (e.key === spentKey) return
    if (e.x === undefined || e.y === undefined) return

    // A re-acquired control puck carries a new session key; within the grace
    // period it simply takes the ring over.
    const fresh = e.key !== controlKey
    controlKey = e.key
    if (fresh || !open) show(e.x, e.y)

    if (e.angle !== undefined && items.length > 0) {
      const n = items.length
      const next = Math.round(e.angle / (TAU / n)) % n
      if (next !== highlight) {
        highlight = next
        paint()
      }
    }
  })

  /* ---------------- fingers ---------------- */

  model.subscribe((name, data) => {
    if (!open || name !== 'touchstart') return
    const t = data as Touch
    const s = surface()
    const px = t.x * s.widthPx
    const py = t.y * s.heightPx
    const halfW = (ITEM_W_MM / 2 + HIT_SLOP_MM) * s.pxPerMm
    const halfH = (ITEM_H_MM / 2 + HIT_SLOP_MM) * s.pxPerMm
    // Into each label's own frame, since a label may be turned to face any edge.
    const i = items.findIndex((it) => {
      const a = (-it.rotate * Math.PI) / 180
      const dx = px - it.x
      const dy = py - it.y
      const lx = dx * Math.cos(a) - dy * Math.sin(a)
      const ly = dx * Math.sin(a) + dy * Math.cos(a)
      return Math.abs(lx) <= halfW && Math.abs(ly) <= halfH
    })
    if (i >= 0) choose(i)
  })

  /* ---------------- keyboard, for setup ---------------- */

  window.addEventListener('keydown', (ev) => {
    if (!open) return
    const n = items.length
    if (ev.key === 'Escape') hide()
    else if (ev.key === 'Enter') choose(highlight)
    else if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') highlight = (highlight + 1) % n
    else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') highlight = (highlight - 1 + n) % n
    else return
    ev.preventDefault()
    paint()
  })

  return {
    open: () => show(0.5, 0.5),
    close: hide,
    get isOpen() {
      return open
    },
  }
}
