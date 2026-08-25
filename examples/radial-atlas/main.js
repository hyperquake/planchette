/**
 * Radial Atlas.
 *
 * Two things this example exists to show:
 *
 *  1. A multi-level radial menu. Each puck opens its own nested menu; levels are
 *     drawn at increasing radius so the parent stays visible while you work in
 *     the child. See lib/menu.js for the interaction model.
 *  2. Loading real content. The collections come from a local content.json and
 *     the plates are real image files in content/images/. An interface folder is
 *     an ordinary static site: it can reference any local file it likes at any
 *     depth, and remote URLs over https as well.
 *
 * One deliberate multi-user decision worth arguing about: the centre of the
 * table is a single shared stage, not one panel per puck. That is a real
 * tabletop pattern, a big shared display several people steer, and it needs a
 * stated conflict rule. Here it is last selection wins, and the stage always
 * says which marker changed it so the change is never anonymous.
 */

import { table } from '@planchette/sdk'
import { RadialMenu, RINGS } from './lib/menu.js'

/** A dropout shorter than this must not tear down someone's open menu. */
const GRACE_MS = 900
/** How far from a puck a contact can land and still belong to its menu. */
const CLAIM_MM = RINGS[RINGS.length - 1] + 30

const stageEmpty = document.getElementById('stage-empty')
const plate = document.getElementById('plate')
const plateImg = document.getElementById('plate-img')
const plateTitle = document.getElementById('plate-title')
const plateBody = document.getElementById('plate-body')
const plateMeta = document.getElementById('plate-meta')
const statusEl = document.getElementById('status')

let menu = null

/** Preload so a plate appears the instant it is chosen, not a beat later. */
function preload(content) {
  for (const collection of content.collections) {
    for (const item of collection.plates) {
      const img = new Image()
      img.src = item.image
    }
  }
}

function showPlate(item, markerId) {
  plateImg.src = item.image
  plateImg.alt = item.title
  plateTitle.textContent = item.title
  plateBody.textContent = item.body
  plateMeta.textContent = `PLATE ${item.id.toUpperCase()}  ·  OPENED BY MARKER ${markerId}`
  plate.classList.add('shown')
  stageEmpty.style.display = 'none'
  // Restart the entry animation on every change, so a second selection reads as
  // a new thing rather than a silent swap.
  plate.style.animation = 'none'
  void plate.offsetWidth
  plate.style.animation = ''
}

table.ready(async ({ surface }) => {
  // A plain fetch of a local file. Nothing about this is special to the table.
  const content = await fetch('./content/content.json').then((r) => r.json())
  preload(content)

  menu = new RadialMenu(document.getElementById('menus'), content, showPlate)

  const plates = content.collections.reduce((n, c) => n + c.plates.length, 0)
  statusEl.textContent =
    `${surface.label}  ·  ${content.collections.length} collections, ${plates} plates  ·  ${surface.pxPerMm.toFixed(2)} px/mm`

  requestAnimationFrame(function loop(now) {
    const { pucks } = table.state()
    const present = new Set()

    for (const p of pucks) {
      present.add(p.markerId)
      menu.update(p)
    }
    menu.sweep(present, now, GRACE_MS)

    if (!pucks.length && !plate.classList.contains('shown')) {
      stageEmpty.style.display = ''
    }
    requestAnimationFrame(loop)
  })
})

table.on('touchstart', (t) => {
  if (!menu) return
  // Whichever puck owns the nearest menu gets the contact. Derived from live
  // state so a handler never acts on a stale frame.
  const puck = table.nearestPuck(t.mmX, t.mmY, CLAIM_MM)
  if (puck) menu.handleTouch(t, puck)
})

table.on('puckremove', () => {
  // Leave the stage alone. Someone lifting their puck should not blank the
  // display everyone else is looking at.
})
