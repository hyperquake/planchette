import { table } from '@planchette/sdk'

/**
 * A multi-level radial menu driven by a puck.
 *
 * The interaction model, which is what makes nested radial menus workable on a
 * table rather than merely possible:
 *
 *  - Rotating the puck sweeps a pointer. Whatever the pointer is on is
 *    highlighted. Nothing is committed by rotation alone, so a user can browse
 *    without consequence, and a puck knocked by a sleeve does not select.
 *  - Touching a ring commits the highlighted item on THAT ring. Committing on
 *    the outer ring drills in and grows a new ring outside it; committing on the
 *    inner ring loads the plate.
 *  - Touching inside the footprint radius goes back a level. It is the one
 *    gesture that does not need a target, so it gets the biggest, easiest area.
 *
 * Levels are drawn at increasing radius so the parent stays visible while you
 * work in the child. That is the whole reason to nest rather than replace: the
 * user can always see where they came from.
 */

const TAU = Math.PI * 2

/** Ring radii, in millimetres from the puck centre. */
export const RINGS = [64, 118]
/** How close to a ring a touch must land to count as hitting it. */
const RING_TOLERANCE_MM = 26
/** A touch nearer than this to the centre means "back". */
const BACK_RADIUS_MM = 40

export class RadialMenu {
  /**
   * @param {HTMLElement} layer  container the menu draws into
   * @param {object} content     parsed content.json
   * @param {(plate: object, markerId: number) => void} onPlate
   */
  constructor(layer, content, onPlate) {
    this.layer = layer
    this.content = content
    this.onPlate = onPlate
    /** markerId -> menu state */
    this.menus = new Map()
  }

  /** Items shown on a given level for a given menu. */
  itemsFor(menu, level) {
    if (level === 0) return this.content.collections
    const collection = this.content.collections[menu.path[0]]
    return collection ? collection.plates : []
  }

  ensure(markerId) {
    let menu = this.menus.get(markerId)
    if (menu) return menu

    const root = document.createElement('div')
    root.className = 'menu'
    root.innerHTML = '<div class="hub"></div><div class="pointer"></div><div class="crumb"></div>'
    this.layer.appendChild(root)

    menu = {
      markerId,
      root,
      hub: root.querySelector('.hub'),
      pointer: root.querySelector('.pointer'),
      crumb: root.querySelector('.crumb'),
      /** Indices chosen so far. Length is the current depth. */
      path: [],
      rings: [],
      highlight: [0, 0],
      removedAt: 0,
    }
    this.menus.set(markerId, menu)
    this.rebuild(menu)
    return menu
  }

  /** Rebuild the DOM for every visible level. Cheap: a few dozen elements. */
  rebuild(menu) {
    for (const ring of menu.rings) ring.el.remove()
    menu.rings = []

    const depth = menu.path.length
    for (let level = 0; level <= depth && level < RINGS.length; level++) {
      const items = this.itemsFor(menu, level)
      if (!items.length) continue

      const el = document.createElement('div')
      el.className = 'ring'
      const radius = RINGS[level]

      const cells = items.map((item, i) => {
        const cell = document.createElement('div')
        cell.className = 'cell'
        cell.innerHTML = `<span>${item.label ?? item.title}</span>`
        const a = (i / items.length) * TAU
        // Positioned radially but deliberately NOT rotated. Rotating an abstract
        // glyph with its ring angle looks intentional; rotating a text label
        // leaves the ones near the bottom upside down. A menu belongs to the one
        // person holding that puck, so upright text is what they can read.
        cell.style.transform =
          `translate(${table.mm(Math.sin(a) * radius)}px, ${table.mm(-Math.cos(a) * radius)}px)` +
          ` translate(-50%, -50%)`
        el.appendChild(cell)
        return cell
      })

      // The ring line the cells sit on, so a level reads as one control.
      const line = document.createElement('div')
      line.className = 'ring-line'
      const d = table.mm(radius * 2)
      line.style.width = line.style.height = `${d}px`
      line.style.margin = `${-d / 2}px 0 0 ${-d / 2}px`
      el.appendChild(line)

      menu.root.appendChild(el)
      menu.rings.push({ el, cells, items, radius, level })
    }
  }

  /** Which item the pointer is on, for each visible level. */
  update(puck) {
    const menu = this.ensure(puck.markerId)
    menu.removedAt = 0
    menu.root.style.transform = `translate(${table.mm(puck.mmX)}px, ${table.mm(puck.mmY)}px)`

    const depth = menu.path.length
    for (const ring of menu.rings) {
      const count = ring.items.length
      // Only the deepest visible ring follows the pointer. Parent rings hold
      // the choice already made, which is what keeps the trail readable.
      const isActive = ring.level === depth
      const index = isActive
        ? Math.round((puck.angle / TAU) * count) % count
        : (menu.path[ring.level] ?? 0)
      menu.highlight[ring.level] = index

      for (let i = 0; i < ring.cells.length; i++) {
        const on = i === index
        ring.cells[i].className = `cell${on ? (isActive ? ' on' : ' chosen') : ''}${isActive ? '' : ' dim'}`
      }
    }

    menu.pointer.style.transform = `rotate(${puck.angle}rad)`
    menu.pointer.style.height = `${table.mm(RINGS[Math.min(depth, RINGS.length - 1)] - 8)}px`

    const parts = ['Atlas']
    if (depth > 0) parts.push(this.content.collections[menu.path[0]].label)
    menu.crumb.textContent = parts.join('  ›  ')
    return menu
  }

  /**
   * A contact landed. Returns true if it was ours, so the caller knows whether
   * to treat it as a background tap.
   */
  handleTouch(touch, puck) {
    // ensure(), not get(): a contact can arrive before the render loop has ever
    // seen this puck, and dropping that first touch is a real bug that only
    // shows up occasionally. Never make an event handler depend on the render
    // loop having run.
    const menu = this.ensure(puck.markerId)

    const dist = Math.hypot(touch.mmX - puck.mmX, touch.mmY - puck.mmY)

    if (dist < BACK_RADIUS_MM) {
      if (menu.path.length) {
        menu.path.pop()
        this.rebuild(menu)
      }
      return true
    }

    for (const ring of menu.rings) {
      if (Math.abs(dist - ring.radius) > RING_TOLERANCE_MM) continue

      // Commit whatever the pointer is on for this ring, derived from the puck's
      // angle right now rather than from anything the render loop cached.
      const count = ring.items.length
      const index =
        ring.level === menu.path.length
          ? Math.round((puck.angle / TAU) * count) % count
          : menu.path[ring.level]

      if (ring.level === 0 && RINGS.length > 1) {
        menu.path = [index]
        this.rebuild(menu)
      } else {
        const item = ring.items[index]
        if (item?.image) this.onPlate(item, puck.markerId)
        menu.committed = index
      }
      return true
    }
    return false
  }

  /** Fade and retire menus whose puck has been gone longer than the grace period. */
  sweep(present, now, graceMs) {
    for (const [markerId, menu] of this.menus) {
      if (present.has(markerId)) {
        menu.root.style.opacity = '1'
        continue
      }
      if (!menu.removedAt) menu.removedAt = now
      const age = (now - menu.removedAt) / graceMs
      menu.root.style.opacity = String(Math.max(0, 1 - age))
      if (age >= 1) {
        menu.root.remove()
        this.menus.delete(markerId)
      }
    }
  }
}
