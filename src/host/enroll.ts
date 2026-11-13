import type { DesktopBridge } from './appsource'
import type { TableModel } from './model'
import type { TableConfig, TuioStatus } from './tuio'

/**
 * Setting up a table: which printed tag is which puck, and how the tracker's
 * axes line up with the screen. Done once per table, by someone with a keyboard
 * and a bag of pucks, so these are ordinary dialogs, not table UI.
 *
 * Both are non-modal and sit in a corner, so the table stays visible. Every
 * change is saved at once and applied live by the main process, which re-reads
 * everything already on the surface (electron/tuio.js), so the effect of a flip
 * or an assignment shows immediately.
 *
 * Everything here is built from DOM nodes: tags come off the network and labels
 * are typed by hand.
 */

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (text !== undefined) node.textContent = text
  if (cls) node.className = cls
  return node
}

function button(text: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', text)
  b.addEventListener('click', onClick)
  return b
}

export function setupEnrollment(bridge: DesktopBridge, model: TableModel): void {
  let config: TableConfig | null = null
  let status: TuioStatus | null = null

  const save = async (next: TableConfig) => {
    config = await bridge.saveTableConfig(next)
    render()
  }

  /* ---------------- assign ---------------- */

  const assign = document.getElementById('enroll') as HTMLDialogElement
  const assignBody = assign.querySelector<HTMLElement>('.enroll-body')!
  assign.querySelector('.enroll-close')!.addEventListener('click', () => assign.close())

  function renderAssign() {
    if (!assign.open || !config) return
    const c = config
    const parts: HTMLElement[] = []

    if (status?.state !== 'listening') {
      const p = el('p', 'Table input is off, so no pucks can be seen. ', 'hint')
      p.append(button('Turn it on', () => void save({ ...c, tuio: { ...c.tuio, enabled: true } })))
      parts.push(p)
    }

    // What is on the table right now and has no meaning yet.
    const known = new Set(c.pucks.map((p) => p.tag))
    const loose = (status?.tags ?? []).filter((t) => !t.control && !known.has(t.tag)).map((t) => t.tag)
    const nextMarker = Math.max(0, ...c.pucks.map((p) => p.markerId)) + 1

    const waiting = el('div', undefined, 'enroll-waiting')
    if (loose.length === 0) {
      waiting.append(el('p', `Place a new puck on the table to assign it as puck ${nextMarker}.`))
    } else {
      for (const tag of loose) {
        const row = el('div', undefined, 'enroll-row')
        row.append(
          el('span', `Tag ${tag}`),
          button(
            `Make it puck ${nextMarker}`,
            () => void save({ ...c, pucks: [...c.pucks, { markerId: nextMarker, tag, label: '' }] }),
          ),
          button('Make it the control puck', () => void save({ ...c, control: { tag } })),
        )
        waiting.append(row)
      }
    }
    parts.push(waiting)

    // The current assignments.
    const table = el('table', undefined, 'enroll-table')
    const head = el('tr')
    for (const h of ['puck', 'tag', 'label', '']) head.append(el('th', h))
    table.append(head)
    const onTable = new Set((status?.tags ?? []).map((t) => t.tag))
    for (const p of c.pucks) {
      const tr = el('tr')
      tr.classList.toggle('present', onTable.has(p.tag))
      const label = el('input')
      label.value = p.label
      label.placeholder = 'red, brass, …'
      label.addEventListener(
        'change',
        () => void save({ ...c, pucks: c.pucks.map((q) => (q.tag === p.tag ? { ...q, label: label.value } : q)) }),
      )
      const labelCell = el('td')
      labelCell.append(label)
      const remove = el('td')
      remove.append(button('Remove', () => void save({ ...c, pucks: c.pucks.filter((q) => q.tag !== p.tag) })))
      tr.append(el('td', String(p.markerId)), el('td', String(p.tag)), labelCell, remove)
      table.append(tr)
    }
    if (c.control.tag !== null) {
      const tr = el('tr')
      const remove = el('td')
      remove.append(button('Remove', () => void save({ ...c, control: { tag: null } })))
      tr.append(el('td', 'control'), el('td', String(c.control.tag)), el('td', 'opens the interface picker'), remove)
      table.append(tr)
    }
    if (!c.pucks.length && c.control.tag === null) {
      const tr = el('tr', undefined, 'empty')
      const td = el('td', 'Nothing assigned. Until something is, tags pass through as their own number.')
      td.colSpan = 4
      tr.append(td)
      table.append(tr)
    }
    parts.push(table)

    const pass = el('label', undefined, 'check')
    const box = el('input')
    box.type = 'checkbox'
    box.checked = c.unmapped === 'passthrough'
    box.addEventListener('change', () => void save({ ...c, unmapped: box.checked ? 'passthrough' : 'ignore' }))
    pass.append(box, ' Pass unassigned tags through as their own number')
    parts.push(pass)

    assignBody.replaceChildren(...parts)
  }

  /* ---------------- calibrate ---------------- */

  const cal = document.getElementById('calibrate') as HTMLDialogElement
  const calBody = cal.querySelector<HTMLElement>('.enroll-body')!
  cal.querySelector('.enroll-close')!.addEventListener('click', () => cal.close())
  // The puck overlay is what calibration is judged against, so it shows while this is open.
  cal.addEventListener('close', () => document.body.classList.remove('calibrating'))

  function renderCalibrate() {
    if (!cal.open || !config) return
    const c = config
    const k = c.calibration

    const toggle = (label: string, on: boolean, set: (v: boolean) => TableConfig['calibration']) => {
      const wrap = el('label', undefined, 'check')
      const box = el('input')
      box.type = 'checkbox'
      box.checked = on
      box.addEventListener('change', () => void save({ ...c, calibration: set(box.checked) }))
      wrap.append(box, ` ${label}`)
      return wrap
    }

    const offset = el('div', undefined, 'enroll-row')
    const offsetInput = el('input')
    offsetInput.type = 'number'
    offsetInput.step = '1'
    offsetInput.value = String(Math.round(k.angleOffsetDeg))
    offsetInput.addEventListener(
      'change',
      () => void save({ ...c, calibration: { ...k, angleOffsetDeg: Number(offsetInput.value) || 0 } }),
    )
    offset.append(el('span', 'Angle offset (degrees)'), offsetInput)

    // Zero the angle against a puck the operator has turned to face the top edge.
    const pucks = model.puckIds().map((id) => model.publicPuck(id)!)
    const zero = button(
      pucks.length === 1 ? 'The puck now points at the top edge' : 'Place exactly one puck to set this',
      () => {
        const p = model.puckIds().map((id) => model.publicPuck(id)!)[0]
        if (!p) return
        const deg = (p.angle * 180) / Math.PI
        void save({ ...c, calibration: { ...k, angleOffsetDeg: (((k.angleOffsetDeg - deg) % 360) + 360) % 360 } })
      },
    )
    zero.disabled = pucks.length !== 1

    calBody.replaceChildren(
      el(
        'p',
        'Each puck is drawn where the app thinks it is, with a line for its north. Move a puck along an edge and turn it to check.',
        'hint',
      ),
      toggle('Flip left and right', k.flipX, (v) => ({ ...k, flipX: v })),
      toggle('Flip top and bottom', k.flipY, (v) => ({ ...k, flipY: v })),
      toggle('Reverse rotation', k.angleReversed, (v) => ({ ...k, angleReversed: v })),
      offset,
      zero,
    )
  }

  /* ---------------- wiring ---------------- */

  function render() {
    renderAssign()
    renderCalibrate()
  }

  bridge.onTableChanged((c) => {
    config = c
    render()
  })
  bridge.onTuioStatus((s) => {
    status = s
    render()
  })
  // Calibrate's "exactly one puck" depends on the table, not on status.
  model.subscribe((name) => {
    if (cal.open && (name === 'puckadd' || name === 'puckremove')) renderCalibrate()
  })

  const openDialog = async (d: HTMLDialogElement) => {
    config = await bridge.tableConfig()
    status = await bridge.tuioStatus()
    if (!d.open) d.show()
    render()
  }
  bridge.onEnroll(() => void openDialog(assign))
  bridge.onCalibrate(() => {
    document.body.classList.add('calibrating')
    void openDialog(cal)
  })
}
