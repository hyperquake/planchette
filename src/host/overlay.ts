import type { TableModel } from './model'

/**
 * Draws the pucks and touch contacts on top of the app iframe. These are the
 * grab handles, so the overlay also carries the data attributes that input.ts
 * hit tests against.
 *
 * The overlay lives inside the scaled surface, so a 60mm puck handle is drawn at
 * its true relative size. Only the ID label is counter-scaled, so it stays
 * readable when the preview is zoomed out.
 */
export class Overlay {
  private puckEls = new Map<number, HTMLElement>()
  private touchEls = new Map<number, HTMLElement>()

  constructor(private root: HTMLElement, private model: TableModel) {}

  render(): void {
    const s = this.model.getSurface()
    const puckPx = s.puckDiameterMm * s.pxPerMm

    for (const [id, p] of this.model.rawPucks()) {
      let el = this.puckEls.get(id)
      if (!el) {
        el = document.createElement('div')
        el.className = 'puck'
        el.dataset.puckId = String(id)
        el.innerHTML = '<i class="puck-north"></i><b class="puck-label"></b>'
        this.root.appendChild(el)
        this.puckEls.set(id, el)
      }
      el.style.width = el.style.height = `${puckPx}px`
      el.style.setProperty('--a', `${p.angle}rad`)
      el.style.transform = `translate(${p.x * s.widthPx}px, ${p.y * s.heightPx}px) translate(-50%, -50%) rotate(${p.angle}rad)`
      const label = el.querySelector('.puck-label')!
      const text = `${p.markerId}`
      if (label.textContent !== text) label.textContent = text
    }
    prune(this.puckEls, this.model.rawPucks())

    for (const [id, t] of this.model.rawTouches()) {
      let el = this.touchEls.get(id)
      if (!el) {
        el = document.createElement('div')
        el.dataset.touchId = String(id)
        this.root.appendChild(el)
        this.touchEls.set(id, el)
      }
      el.className = t.sticky ? 'touch sticky' : 'touch'
      const d = t.radiusMm * 2 * s.pxPerMm
      el.style.width = el.style.height = `${d}px`
      el.style.transform = `translate(${t.x * s.widthPx}px, ${t.y * s.heightPx}px) translate(-50%, -50%)`
    }
    prune(this.touchEls, this.model.rawTouches())
  }
}

function prune(els: Map<number, HTMLElement>, live: ReadonlyMap<number, unknown>): void {
  for (const [id, el] of els) {
    if (!live.has(id)) {
      el.remove()
      els.delete(id)
    }
  }
}
