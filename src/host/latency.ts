import type { Puck, Touch } from '../sdk/types'
import type { TableModel } from './model'
import type { TuioFrame, TuioStatus } from './tuio'

/**
 * Table > Latency Check: what it takes to say where lag on a real table comes from.
 *
 * Lag between a hand and what the table shows is the sum of four delays, and
 * only one of them is Planchette's:
 *
 *   tracker  ->  Planchette  ->  the interface  ->  the display
 *
 * Two things are shown, over whatever interface is running:
 *
 *  - A ring exactly where each puck and finger is reported, with a ruler ahead
 *    of it along the direction of travel, ticked at 50, 100, 150 and 200 ms at
 *    the current speed. Slide a puck steadily and the physical puck sits at
 *    the tick that is the whole delay, end to end. Software alone cannot
 *    measure that, because it cannot see the puck; a person, or a slow-motion
 *    video, can.
 *  - Numbers that split it up: the host's frame rate (an interface shares the
 *    renderer's thread, so a heavy one shows up here), how often the tracker
 *    sends, how long Planchette holds a frame, how often a moving puck is
 *    updated, and how often a puck is lost and found again.
 *
 * Counts start when the check is opened. Close and reopen it to start over.
 */

/** Below this a contact is resting, and its update rate says nothing about motion. */
const MOVING_MM_S = 60
const TICKS_MS = [50, 100, 150, 200]
/** A puck back within this long of leaving, with the same marker, was lost rather than lifted. */
const DROPOUT_MS = 1000
/** Rolling window for rates and medians. */
const WINDOW_MS = 2000
/** A frame this long means at least one missed refresh at 60 Hz. */
const LONG_FRAME_MS = 25
const VELOCITY_SMOOTHING = 0.5

/** The main process stamps each tracker frame as it arrives (electron/main.js). */
type StampedFrame = TuioFrame & { t?: number }

export interface LatencyBridge {
  onTuioFrame(cb: (frame: StampedFrame) => void): void
  tuioStatus(): Promise<TuioStatus | null>
}

interface Motion {
  mmX: number
  mmY: number
  at: number
  /** mm per ms. */
  vx: number
  vy: number
}

interface Sample {
  at: number
  value: number
}

export interface LatencyCheck {
  readonly isOpen: boolean
  open(): void
  close(): void
  toggle(): void
  /** The readout as text, for the smoke test and for anyone copying it out. */
  readout(): string
}

export function installLatencyCheck(opts: {
  surfaceEl: HTMLElement
  model: TableModel
  bridge: LatencyBridge | null
}): LatencyCheck {
  const { surfaceEl, model, bridge } = opts

  const canvas = document.createElement('canvas')
  canvas.id = 'latency-ruler'
  canvas.hidden = true
  surfaceEl.appendChild(canvas)
  const ctx = canvas.getContext('2d')!

  const hud = document.createElement('div')
  hud.id = 'latency-hud'
  hud.hidden = true
  document.body.appendChild(hud)

  let open = false
  let raf = 0
  let poll = 0

  // Everything below is reset by open().
  const motion = new Map<string, Motion>()
  let frameTimes: Sample[] = []
  let delays: Sample[] = []
  let updateGaps: Sample[] = []
  let longFrames = 0
  let longestGap = 0
  let dropouts = 0
  let longestDropout = 0
  let packetsPerSec: number | null = null
  let lastFrameAt = 0
  /** markerId -> when its last puck left, for telling a dropout from a lift. */
  const leftAt = new Map<number, number>()

  const key = (kind: 'p' | 't', id: number) => `${kind}${id}`

  function track(k: string, mmX: number, mmY: number): void {
    const now = performance.now()
    const m = motion.get(k)
    if (!m) {
      motion.set(k, { mmX, mmY, at: now, vx: 0, vy: 0 })
      return
    }
    const dt = now - m.at
    if (dt <= 0) return
    const vx = (mmX - m.mmX) / dt
    const vy = (mmY - m.mmY) / dt
    m.vx += (vx - m.vx) * VELOCITY_SMOOTHING
    m.vy += (vy - m.vy) * VELOCITY_SMOOTHING
    // Only gaps while moving say anything about the tracker: a resting puck is
    // allowed to go quiet.
    if (Math.hypot(m.vx, m.vy) * 1000 > MOVING_MM_S) {
      updateGaps.push({ at: now, value: dt })
      if (dt > longestGap) longestGap = dt
    }
    m.mmX = mmX
    m.mmY = mmY
    m.at = now
  }

  model.subscribe((name, data) => {
    if (!open) return
    const now = performance.now()
    switch (name) {
      case 'puckadd': {
        const p = data as Puck
        const left = leftAt.get(p.markerId)
        if (left !== undefined && now - left < DROPOUT_MS) {
          dropouts++
          longestDropout = Math.max(longestDropout, now - left)
          leftAt.delete(p.markerId)
        }
        track(key('p', p.id), p.mmX, p.mmY)
        break
      }
      case 'puckmove': {
        const p = data as Puck
        track(key('p', p.id), p.mmX, p.mmY)
        break
      }
      case 'puckremove': {
        const p = data as Puck
        motion.delete(key('p', p.id))
        leftAt.set(p.markerId, now)
        break
      }
      case 'touchstart':
      case 'touchmove': {
        const t = data as Touch
        track(key('t', t.id), t.mmX, t.mmY)
        break
      }
      case 'touchend':
        motion.delete(key('t', (data as Touch).id))
        break
    }
  })

  bridge?.onTuioFrame((f) => {
    if (!open || typeof f.t !== 'number') return
    delays.push({ at: performance.now(), value: Math.max(0, Date.now() - f.t) })
  })

  /* ---------------- drawing ---------------- */

  function draw(now: number): void {
    const s = model.getSurface()
    if (canvas.width !== s.widthPx || canvas.height !== s.heightPx) {
      canvas.width = s.widthPx
      canvas.height = s.heightPx
    }
    const k = s.pxPerMm
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.lineCap = 'round'
    ctx.font = `600 ${Math.round(5 * k)}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    const contacts: Array<{ k: string; x: number; y: number; r: number }> = []
    for (const [id, p] of model.rawPucks()) {
      contacts.push({ k: key('p', id), x: p.x * s.widthMm, y: p.y * s.heightMm, r: s.puckDiameterMm / 2 })
    }
    for (const [id, t] of model.rawTouches()) {
      contacts.push({ k: key('t', id), x: t.x * s.widthMm, y: t.y * s.heightMm, r: t.radiusMm })
    }

    for (const c of contacts) {
      ctx.strokeStyle = '#ffd400'
      ctx.lineWidth = 1.2 * k
      ctx.beginPath()
      ctx.arc(c.x * k, c.y * k, c.r * k, 0, Math.PI * 2)
      ctx.stroke()
      // A dot at the reported centre, to line up with the middle of the puck.
      ctx.fillStyle = '#ffd400'
      ctx.beginPath()
      ctx.arc(c.x * k, c.y * k, 1.5 * k, 0, Math.PI * 2)
      ctx.fill()

      const m = motion.get(c.k)
      // A contact that has not been updated lately has stopped, whatever its last velocity said.
      if (!m || now - m.at > 150) continue
      const speed = Math.hypot(m.vx, m.vy)
      if (speed * 1000 < MOVING_MM_S) continue
      const ux = m.vx / speed
      const uy = m.vy / speed
      // Ticks are perpendicular to the direction of travel, ahead of the ring.
      const far = speed * TICKS_MS[TICKS_MS.length - 1]!
      ctx.strokeStyle = 'rgba(255, 212, 0, .55)'
      ctx.lineWidth = 0.8 * k
      ctx.beginPath()
      ctx.moveTo(c.x * k, c.y * k)
      ctx.lineTo((c.x + ux * far) * k, (c.y + uy * far) * k)
      ctx.stroke()
      for (const ms of TICKS_MS) {
        const d = speed * ms
        const tx = c.x + ux * d
        const ty = c.y + uy * d
        ctx.strokeStyle = '#ffd400'
        ctx.lineWidth = 1 * k
        ctx.beginPath()
        ctx.moveTo((tx - uy * 6) * k, (ty + ux * 6) * k)
        ctx.lineTo((tx + uy * 6) * k, (ty - ux * 6) * k)
        ctx.stroke()
        ctx.fillStyle = '#ffd400'
        ctx.fillText(String(ms), (tx - uy * 11) * k, (ty + ux * 11) * k)
      }
    }
  }

  /* ---------------- numbers ---------------- */

  function trim(list: Sample[], now: number): Sample[] {
    const from = now - WINDOW_MS
    let i = 0
    while (i < list.length && list[i]!.at < from) i++
    return i ? list.slice(i) : list
  }

  const median = (xs: number[]) => {
    if (!xs.length) return null
    const s = [...xs].sort((a, b) => a - b)
    return s[Math.floor(s.length / 2)]!
  }
  const ms = (v: number | null) => (v === null ? 'n/a' : `${Math.round(v)} ms`)

  function lines(): string[] {
    const now = performance.now()
    frameTimes = trim(frameTimes, now)
    delays = trim(delays, now)
    updateGaps = trim(updateGaps, now)

    const frames = frameTimes.map((f) => f.value)
    const fps = frames.length ? Math.round(1000 / (frames.reduce((a, b) => a + b, 0) / frames.length)) : null
    const worst = frames.length ? Math.max(...frames) : null
    const gap = median(updateGaps.map((g) => g.value))
    const delay = median(delays.map((d) => d.value))
    const maxDelay = delays.length ? Math.max(...delays.map((d) => d.value)) : null

    return [
      `Frame rate      ${fps ?? 'n/a'} fps, worst frame ${ms(worst)}, ${longFrames} long since opened`,
      `Tracker         ${packetsPerSec === null ? 'not connected' : `${packetsPerSec} packets/s`}`,
      `Planchette      ${delay === null ? 'n/a' : `${ms(delay)}, max ${ms(maxDelay)}`}`,
      `While moving    ${gap === null ? 'n/a' : `${Math.round(1000 / gap)} updates/s`}, longest gap ${ms(longestGap || null)}`,
      `Lost and found  ${dropouts}${dropouts ? `, longest ${ms(longestDropout)}` : ''}`,
    ]
  }

  function render(): void {
    const text = lines()
    hud.replaceChildren(
      ...[
        'Latency check. Slide a puck steadily: where the real puck sits on the ruler is the whole delay.',
        ...text,
      ].map((t, i) => {
        const row = document.createElement('div')
        row.textContent = t
        if (i === 0) row.className = 'latency-hint'
        return row
      }),
    )
  }

  function loop(now: number): void {
    if (!open) return
    if (lastFrameAt) {
      const dt = now - lastFrameAt
      frameTimes.push({ at: now, value: dt })
      if (dt > LONG_FRAME_MS) longFrames++
    }
    lastFrameAt = now
    draw(now)
    raf = requestAnimationFrame(loop)
  }

  async function refreshStatus(): Promise<void> {
    const s = bridge ? await bridge.tuioStatus().catch(() => null) : null
    packetsPerSec = s && s.state === 'listening' ? s.packetsPerSec : null
    if (open) render()
  }

  const api: LatencyCheck = {
    get isOpen() {
      return open
    },
    open() {
      if (open) return
      open = true
      motion.clear()
      leftAt.clear()
      frameTimes = []
      delays = []
      updateGaps = []
      longFrames = longestGap = dropouts = longestDropout = 0
      lastFrameAt = 0
      canvas.hidden = hud.hidden = false
      document.body.classList.add('latency')
      void refreshStatus()
      poll = window.setInterval(() => void refreshStatus(), 500)
      raf = requestAnimationFrame(loop)
    },
    close() {
      if (!open) return
      open = false
      cancelAnimationFrame(raf)
      clearInterval(poll)
      canvas.hidden = hud.hidden = true
      document.body.classList.remove('latency')
    },
    toggle() {
      if (open) api.close()
      else api.open()
    },
    readout: () => lines().join('\n'),
  }
  return api
}
