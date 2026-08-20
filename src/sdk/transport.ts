import { PROTOCOL_VERSION, type HostMessage, type Puck, type SurfaceInfo, type TableEventName, type TableState, type Touch } from './types'
import { nearestEdge, wrapAngle } from './units'

export const SDK_VERSION = '0.1.0'

/** px/mm of the default table (55 inch 16:9 panel at 3840x2160). */
export const REFERENCE_PX_PER_MM = 3.1529

export interface Sink {
  config(surface: SurfaceInfo, state: TableState): void
  state(state: TableState): void
  event(name: TableEventName, data: Puck | Touch): void
}

/**
 * Connect to whatever is providing input. Inside the simulator that is the host
 * window over postMessage. Opened standalone, we fall back to solo mode.
 */
export function connect(sink: Sink): boolean {
  if (window.parent !== window) {
    connectToHost(sink)
    return false
  }
  startSolo(sink)
  return true
}

function connectToHost(sink: Sink): void {
  let configured = false

  window.addEventListener('message', (ev: MessageEvent) => {
    const m = ev.data as HostMessage | undefined
    if (!m || m.__table !== PROTOCOL_VERSION) return
    if (m.type === 'config') {
      configured = true
      sink.config(m.surface, m.state)
    } else if (m.type === 'state') {
      sink.state(m.state)
    } else if (m.type === 'event') {
      sink.event(m.name, m.data)
    }
  })

  // The host attaches its listener before creating the iframe, but retry anyway
  // so that a host reload or a slow frame cannot leave an app permanently mute.
  let tries = 0
  const hello = () => {
    if (configured || tries++ > 40) return
    window.parent.postMessage({ __table: PROTOCOL_VERSION, type: 'hello', sdkVersion: SDK_VERSION }, '*')
    setTimeout(hello, 250)
  }
  hello()
}

/* ------------------------------------------------------------------ *
 * Solo mode
 *
 * A deliberately minimal fallback so that an app URL opened outside the
 * simulator still does something. It reports the browser window as the surface
 * while keeping the real table's px/mm, so millimetre sizing stays honest and
 * you are simply working on a smaller table.
 * ------------------------------------------------------------------ */

function startSolo(sink: Sink): void {
  const pucks = new Map<number, Puck>()
  const touches = new Map<number, Touch>()
  const els = new Map<number, HTMLElement>()
  let nextId = 1
  let cursor = { x: 0.5, y: 0.5 }
  let dirty = true

  const root = document.createElement('div')
  root.className = 'table-solo-root'
  root.innerHTML = `<style>
    .table-solo-root { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000; }
    .table-solo-badge { position: absolute; left: 8px; bottom: 8px; pointer-events: none;
      font: 11px/1.5 ui-monospace, monospace; color: #fff; background: #b4530a;
      padding: 4px 8px; border-radius: 4px; opacity: .9; }
    .table-solo-puck { position: absolute; pointer-events: auto; cursor: grab;
      border-radius: 50%; border: 2px dashed rgba(255,255,255,.55);
      background: rgba(180,83,10,.28); box-sizing: border-box; touch-action: none; }
    .table-solo-puck::after { content: ''; position: absolute; left: 50%; top: 6%;
      width: 3px; height: 26%; margin-left: -1.5px; background: #fff; border-radius: 2px; }
  </style><div class="table-solo-badge">SOLO MODE &middot; drag the puck, wheel to rotate, P adds a puck, X removes one</div>`
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(root))
  if (document.readyState !== 'loading') document.body.appendChild(root)

  function surface(): SurfaceInfo {
    const widthPx = window.innerWidth
    const heightPx = window.innerHeight
    return {
      id: 'solo',
      label: 'Solo mode (browser window)',
      widthPx,
      heightPx,
      widthMm: widthPx / REFERENCE_PX_PER_MM,
      heightMm: heightPx / REFERENCE_PX_PER_MM,
      pxPerMm: REFERENCE_PX_PER_MM,
      puckDiameterMm: 60,
    }
  }

  function decorate<T extends { x: number; y: number }>(o: T, s: SurfaceInfo) {
    return { ...o, mmX: o.x * s.widthMm, mmY: o.y * s.heightMm }
  }

  function snapshot(): TableState {
    const s = surface()
    return {
      surface: s,
      t: performance.now(),
      pucks: [...pucks.values()].map((p) => decorate(p, s)),
      touches: [...touches.values()].map((t) => ({
        ...decorate(t, s),
        edge: nearestEdge(t.x * s.widthMm, t.y * s.heightMm, s.widthMm, s.heightMm),
      })),
    }
  }

  function pub(name: TableEventName, id: number, from: Map<number, any>) {
    const s = surface()
    const o = from.get(id)
    if (!o) return
    const d = decorate(o, s)
    sink.event(name, name.startsWith('puck') ? (d as Puck) : ({ ...d, edge: nearestEdge(d.mmX, d.mmY, s.widthMm, s.heightMm) } as Touch))
  }

  function addPuck(x: number, y: number): void {
    const id = nextId++
    const now = performance.now()
    pucks.set(id, { id, markerId: pucks.size + 1, x, y, angle: 0, vx: 0, vy: 0, vAngle: 0, mmX: 0, mmY: 0, firstSeen: now, lastSeen: now })

    const el = document.createElement('div')
    el.className = 'table-solo-puck'
    const d = 60 * REFERENCE_PX_PER_MM
    el.style.width = el.style.height = `${d}px`
    el.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation()
      el.setPointerCapture(ev.pointerId)
      const move = (e: PointerEvent) => {
        const p = pucks.get(id)
        if (!p) return
        p.x = clamp01(e.clientX / window.innerWidth)
        p.y = clamp01(e.clientY / window.innerHeight)
        p.lastSeen = performance.now()
        dirty = true
        pub('puckmove', id, pucks)
      }
      const up = () => {
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', up)
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', up)
    })
    el.addEventListener(
      'wheel',
      (ev) => {
        ev.preventDefault()
        const p = pucks.get(id)
        if (!p) return
        p.angle = wrapAngle(p.angle + ev.deltaY * 0.004)
        dirty = true
        pub('puckmove', id, pucks)
      },
      { passive: false },
    )
    root.appendChild(el)
    els.set(id, el)
    dirty = true
    pub('puckadd', id, pucks)
  }

  window.addEventListener('pointerdown', (ev) => {
    if ((ev.target as HTMLElement | null)?.closest('.table-solo-puck')) return
    const id = nextId++
    const now = performance.now()
    touches.set(id, { id, x: clamp01(ev.clientX / window.innerWidth), y: clamp01(ev.clientY / window.innerHeight), radiusMm: 8, mmX: 0, mmY: 0, edge: 'n', firstSeen: now, lastSeen: now })
    dirty = true
    pub('touchstart', id, touches)

    const move = (e: PointerEvent) => {
      const t = touches.get(id)
      if (!t) return
      t.x = clamp01(e.clientX / window.innerWidth)
      t.y = clamp01(e.clientY / window.innerHeight)
      t.lastSeen = performance.now()
      dirty = true
      pub('touchmove', id, touches)
    }
    const up = () => {
      pub('touchend', id, touches)
      touches.delete(id)
      dirty = true
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  })

  window.addEventListener('pointermove', (ev) => {
    cursor = { x: clamp01(ev.clientX / window.innerWidth), y: clamp01(ev.clientY / window.innerHeight) }
  })

  window.addEventListener('keydown', (ev) => {
    const t = document.activeElement
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return
    if (ev.key === 'p' || ev.key === 'P') addPuck(cursor.x, cursor.y)
    if (ev.key === 'x' || ev.key === 'X') {
      let best: number | null = null
      let bestD = Infinity
      for (const p of pucks.values()) {
        const d = Math.hypot((p.x - cursor.x) * window.innerWidth, (p.y - cursor.y) * window.innerHeight)
        if (d < bestD) [best, bestD] = [p.id, d]
      }
      if (best !== null && bestD < 60 * REFERENCE_PX_PER_MM) {
        pub('puckremove', best, pucks)
        pucks.delete(best)
        els.get(best)?.remove()
        els.delete(best)
        dirty = true
      }
    }
  })

  window.addEventListener('resize', () => {
    dirty = true
  })

  addPuck(0.4, 0.5)
  sink.config(surface(), snapshot())

  const frame = () => {
    if (dirty || touches.size || pucks.size) {
      const s = surface()
      for (const [id, el] of els) {
        const p = pucks.get(id)
        if (!p) continue
        el.style.transform = `translate(${p.x * s.widthPx}px, ${p.y * s.heightPx}px) translate(-50%, -50%) rotate(${p.angle}rad)`
      }
      sink.state(snapshot())
      dirty = false
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
