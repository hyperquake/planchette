import type { Puck, TableEventName, Touch } from '../sdk/types'
import type { TableModel } from './model'
import type { TuioStatus } from './tuio'
import { DEG } from '../sdk/units'

const MAX_LOG_ROWS = 400
/** Redraw the live tables at a human-readable rate, not once per frame. */
const TABLE_HZ = 15

/**
 * The right-hand panel: numeric truth about what is on the table, and a log of
 * every event the app is being sent. This is where trust in the simulator gets
 * built, so it shows the raw wire values rather than prettified ones.
 */
export class Inspector {
  private logEl: HTMLElement
  private puckBody: HTMLElement
  private touchBody: HTMLElement
  private surfaceEl: HTMLElement
  private filterEl: HTMLInputElement
  private pauseEl: HTMLInputElement
  private rows = 0
  private lastTables = 0
  private tuioSection: HTMLElement
  private tuioEl: HTMLElement
  /** Raw tracker tag for a model puck id, when it came from a real table. */
  tagFor: (id: number) => number | undefined = () => undefined

  constructor(
    root: HTMLElement,
    private model: TableModel,
  ) {
    this.logEl = root.querySelector('#log')!
    this.puckBody = root.querySelector('#puck-rows')!
    this.touchBody = root.querySelector('#touch-rows')!
    this.surfaceEl = root.querySelector('#surface-readout')!
    this.filterEl = root.querySelector('#log-filter')!
    this.pauseEl = root.querySelector('#log-pause')!
    this.tuioSection = root.querySelector('#tuio-section')!
    this.tuioEl = root.querySelector('#tuio-readout')!
    root.querySelector('#log-clear')!.addEventListener('click', () => {
      this.logEl.textContent = ''
      this.rows = 0
    })
    model.subscribe((name, data) => this.log(name, data))
    this.renderSurface()
  }

  renderSurface(): void {
    const s = this.model.getSurface()
    this.surfaceEl.innerHTML = [
      ['label', s.label],
      ['pixels', `${s.widthPx} x ${s.heightPx}`],
      ['physical', `${Math.round(s.widthMm)} x ${Math.round(s.heightMm)} mm`],
      ['density', `${s.pxPerMm.toFixed(3)} px/mm (${(s.pxPerMm * 25.4).toFixed(0)} dpi)`],
      ['puck', `${s.puckDiameterMm} mm = ${Math.round(s.puckDiameterMm * s.pxPerMm)} px`],
      ['20 mm target', `${Math.round(20 * s.pxPerMm)} px`],
    ]
      .map(([k, v]) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`)
      .join('')
  }

  /**
   * What the tracker is doing. Shown only once TUIO is on, and built from text
   * nodes: tag numbers and error strings come from the network.
   */
  setTuioStatus(s: TuioStatus | null): void {
    this.tuioSection.hidden = !s || s.state === 'off'
    if (!s || s.state === 'off') return
    const rows: Array<[string, string]> = [
      ['listening', s.state === 'listening' ? `${s.host}:${s.port}` : s.state],
      ['packets', `${s.packetsPerSec}/s${s.badPackets ? `, ${s.badPackets} malformed` : ''}`],
      [
        'tags present',
        s.tags
          .map((t) =>
            t.control
              ? `${t.tag} (control)`
              : t.markerId === null
                ? `${t.tag} (unmapped)`
                : `${t.tag} as ${t.markerId}`,
          )
          .join(', ') || 'none',
      ],
    ]
    if (s.unknownTags.length) rows.push(['unmapped seen', s.unknownTags.join(', ')])
    if (s.error) rows.push(['error', s.error])
    this.tuioEl.replaceChildren(
      ...rows.map(([k, v]) => {
        const row = document.createElement('div')
        row.className = 'kv'
        const key = document.createElement('span')
        key.textContent = k
        const val = document.createElement('b')
        val.textContent = v
        row.append(key, val)
        return row
      }),
    )
  }

  private log(name: TableEventName, data: Puck | Touch): void {
    if (this.pauseEl.checked) return
    const filter = this.filterEl.value.trim().toLowerCase()
    const isPuck = name.startsWith('puck')
    // Terse on purpose. The panel is about 300px wide, and a longer line either
    // needs a horizontal scrollbar or clips mid-value, which is worse than terse:
    // the labelled version of all of this is in the tables directly above.
    const mm = `${data.mmX.toFixed(0)},${data.mmY.toFixed(0)}`
    const detail = isPuck
      ? `mkr${(data as Puck).markerId}`.padEnd(7) + mm.padEnd(9) + `${((data as Puck).angle * DEG).toFixed(0)}°`
      : mm.padEnd(9) + `r${(data as Touch).radiusMm}`.padEnd(4) + (data as Touch).edge
    const line = `${name.padEnd(11)}#${String(data.id).padEnd(4)}${detail}`
    if (filter && !line.toLowerCase().includes(filter)) return

    const row = document.createElement('div')
    row.className = `log-row ${isPuck ? 'log-puck' : 'log-touch'}`
    row.textContent = line
    this.logEl.appendChild(row)
    if (++this.rows > MAX_LOG_ROWS) {
      this.logEl.firstElementChild?.remove()
      this.rows--
    }
    this.logEl.scrollTop = this.logEl.scrollHeight
  }

  /** Called every frame; throttles its own DOM work. */
  tick(now: number): void {
    if (now - this.lastTables < 1000 / TABLE_HZ) return
    this.lastTables = now

    this.puckBody.innerHTML =
      this.model
        .puckIds()
        .map((id) => this.model.publicPuck(id)!)
        .map(
          (p) =>
            `<tr><td>${p.id}</td><td class="hi">${p.markerId}${this.tagFor(p.id) !== undefined ? `<span class="tag"> t${this.tagFor(p.id)}</span>` : ''}</td><td>${p.mmX.toFixed(0)}</td><td>${p.mmY.toFixed(0)}</td><td>${(p.angle * DEG).toFixed(0)}&deg;</td><td>${Math.hypot(p.vx, p.vy).toFixed(2)}</td></tr>`,
        )
        .join('') || '<tr class="empty"><td colspan="6">no pucks on the surface</td></tr>'

    this.touchBody.innerHTML =
      this.model
        .touchIds()
        .map((id) => this.model.publicTouch(id)!)
        .map(
          (t) =>
            `<tr><td>${t.id}</td><td>${t.mmX.toFixed(0)}</td><td>${t.mmY.toFixed(0)}</td><td>${t.radiusMm}</td><td class="hi">${t.edge}</td></tr>`,
        )
        .join('') || '<tr class="empty"><td colspan="5">no contacts</td></tr>'
  }
}
