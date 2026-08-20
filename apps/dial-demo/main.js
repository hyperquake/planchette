/**
 * Puck dial.
 *
 * Each puck on the table becomes an independent radial menu. Rotating a puck
 * moves through the options; touching the ring confirms the highlighted one.
 *
 * Worth noticing, because these are the habits that survive contact with real
 * hardware:
 *
 *  - Dials are keyed by markerId, not by puck id. A puck id is a tracking
 *    session and changes whenever the tracker loses and re-acquires the marker
 *    (a sleeve passing over it will do that). markerId is the physical identity.
 *    The tradeoff: two pucks carrying the same marker share one dial. That is the
 *    right call when each marker means a distinct thing, which is the usual case.
 *    If your interface hands out duplicate markers, key by id instead and use
 *    markerId plus last-known position to re-associate after a dropout.
 *  - Nothing is drawn inside the puck footprint. A hand is sitting there.
 *  - puckremove starts a fade rather than deleting immediately, so a momentary
 *    tracking dropout does not throw away the user's state.
 *  - There is no single "selected option" for the app. Every puck carries its
 *    own, because several people are using this at once.
 */

import { table } from '@table/sdk'

const OPTIONS = ['Terrain', 'Traffic', 'Weather', 'Transit', 'Parks', 'Zoning', 'Labels', 'Satellite']
const STEP = (Math.PI * 2) / OPTIONS.length

/** Ring radius, measured from the centre of the puck. */
const RING_MM = 62
/** How far from the ring a touch still counts as "on the ring". */
const RING_TOLERANCE_MM = 22
/** A dropout shorter than this should not destroy the dial. */
const GRACE_MS = 700

const hint = document.getElementById('hint')
const status = document.getElementById('status')

/**
 * Which option a given puck angle points at. Derived on demand rather than
 * cached, because event handlers run between frames: anything that reads a
 * value the render loop computes will sometimes read a stale one.
 */
const selectionFor = (angle) => Math.round(angle / STEP) % OPTIONS.length

/** markerId -> dial */
const dials = new Map()

table.ready(({ surface }) => {
  status.textContent = `${surface.label} | ${Math.round(surface.widthMm)}x${Math.round(surface.heightMm)}mm | ${surface.pxPerMm.toFixed(2)} px/mm | ring ${RING_MM}mm`
  requestAnimationFrame(loop)
})

/* ---------------- dial construction ---------------- */

function makeDial(markerId) {
  const el = document.createElement('div')
  el.className = 'dial'
  el.innerHTML = '<div class="footprint"></div><div class="needle"></div>'

  const opts = OPTIONS.map((name, i) => {
    const o = document.createElement('div')
    o.className = 'opt'
    o.textContent = name
    // Angle 0 points up, so it maps to (sin, -cos) in screen space.
    const a = i * STEP
    o.style.transform = `translate(${table.mm(Math.sin(a) * RING_MM)}px, ${table.mm(-Math.cos(a) * RING_MM)}px)`
    el.appendChild(o)
    return o
  })

  const readout = document.createElement('div')
  readout.className = 'readout'
  el.appendChild(readout)

  const needle = el.querySelector('.needle')
  needle.style.height = `${table.mm(RING_MM)}px`
  needle.style.marginTop = `${-table.mm(RING_MM)}px`

  document.body.appendChild(el)
  const dial = { markerId, el, opts, readout, needle, selected: 0, confirmed: null, removedAt: 0 }
  dials.set(markerId, dial)
  return dial
}

function dialFor(markerId) {
  const d = dials.get(markerId) ?? makeDial(markerId)
  d.removedAt = 0
  d.el.style.opacity = '1'
  return d
}

/* ---------------- events ---------------- */

table.on('puckadd', (p) => dialFor(p.markerId))

table.on('puckremove', (p) => {
  // Do not tear the dial down yet. Real marker tracking flickers, and a puck
  // that vanishes for 200ms has usually not actually left the table.
  const d = dials.get(p.markerId)
  if (!d) return
  d.removedAt = performance.now()
  d.el.style.opacity = '0'
})

table.on('touchstart', (t) => {
  // Which dial did this touch land on? Nearest puck wins, but only if the
  // contact is actually near that puck's ring.
  const puck = table.nearestPuck(t.mmX, t.mmY, RING_MM + RING_TOLERANCE_MM)
  if (!puck) return
  const distMm = Math.hypot(t.mmX - puck.mmX, t.mmY - puck.mmY)
  if (Math.abs(distMm - RING_MM) > RING_TOLERANCE_MM) return

  const d = dials.get(puck.markerId)
  if (!d) return
  d.confirmed = selectionFor(puck.angle)
})

/* ---------------- render ---------------- */

function loop(now) {
  const { pucks } = table.state()
  hint.style.opacity = pucks.length ? '0' : '1'

  for (const p of pucks) {
    const d = dialFor(p.markerId)

    d.el.style.transform = `translate(${table.mm(p.mmX)}px, ${table.mm(p.mmY)}px)`

    // The option nearest the puck's north is the highlighted one. Rotating away
    // from a confirmed option clears the confirmation.
    d.selected = selectionFor(p.angle)
    if (d.confirmed !== null && d.confirmed !== d.selected) d.confirmed = null

    d.needle.style.transform = `rotate(${p.angle}rad)`

    for (let i = 0; i < d.opts.length; i++) {
      const on = i === d.selected
      d.opts[i].className = `opt${on ? (d.confirmed === i ? ' done' : ' sel') : ''}`
    }

    // Put the readout on the puck's south side and rotate it to match the puck,
    // so it faces whoever is holding it. Users sit on all four sides.
    const rr = RING_MM + 34
    d.readout.style.transform =
      `translate(${table.mm(-Math.sin(p.angle) * rr)}px, ${table.mm(Math.cos(p.angle) * rr)}px) rotate(${p.angle}rad)`
    d.readout.innerHTML =
      d.confirmed === null
        ? `marker ${p.markerId} &middot; ${Math.round(table.deg(p.angle))}&deg; &middot; touch ring to set`
        : `marker ${p.markerId} &middot; <b>${OPTIONS[d.confirmed]}</b>`
  }

  // Retire dials whose puck has stayed away longer than the grace period.
  for (const [markerId, d] of dials) {
    if (d.removedAt && now - d.removedAt > GRACE_MS) {
      d.el.remove()
      dials.delete(markerId)
    }
  }

  requestAnimationFrame(loop)
}
