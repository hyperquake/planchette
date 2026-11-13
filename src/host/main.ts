import lockupUrl from '../../brand/lockup-horizontal-white.svg?url'
import markUrl from '../../brand/mark-white.svg?url'
import { AppFrame } from './appframe'
import { appSource } from './appsource'
import { installInput } from './input'
import { setupEnrollment } from './enroll'
import { Inspector } from './inspector'
import { TableModel } from './model'
import { showUpgradeNotice } from './notice'
import { setupTableSettings } from './table-ui'
import { installPresent } from './present'
import { installTuio } from './tuio'
import { Overlay } from './overlay'
import { installSimApi } from './simapi'
import { infoFor, PRESETS } from './surface'

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel)
  if (!el) throw new Error(`missing element ${sel}`)
  return el
}

/**
 * Refill a select. Text rather than markup, because two of the three callers are
 * filling it with strings off the user's disk: interface folder names and
 * workspace paths. Interpolating those into innerHTML lets a folder called
 * `"><img onerror=...>` run script in the document that holds the bridge.
 */
function setOptions(
  select: HTMLSelectElement,
  items: Array<{ value: string; label: string }>,
  selected?: string,
): void {
  select.replaceChildren(...items.map((o) => new Option(o.label, o.value, false, o.value === selected)))
}

/* ---------------- embed mode ---------------- */

/**
 * Embed mode, for the live demo a public page can put in an iframe.
 *
 *   index.html?embed=1&app=radial-atlas
 *
 * Same entry and same bundle as the full tool on purpose. A separate embed page
 * would be a lookalike that can quietly drift from what people actually
 * download, and the whole point of embedding a real simulator is that it is real.
 *
 * What changes: no authoring chrome, no browser storage, and a puck already on
 * the surface so a visitor sees an interface responding rather than an empty
 * table. What does not change: the surface is still laid out at the table's true
 * resolution, and scaling already keys off the container rather than the window,
 * so an iframe of any size works without special handling.
 */
const params = new URLSearchParams(location.search)
const EMBED = params.has('embed')
/** Fallback when no app is named. Reads best in a small frame: the puck does something visibly spatial. */
const EMBED_DEFAULT_APP = 'radial-atlas'

/**
 * Framing, for embeds only.
 *
 * `zoom=fit` shows the whole surface and never breaks, which is why it is the
 * default, but a 1218mm table in a 760px frame is about 19 percent and nothing on
 * it is readable. A demo that wants legible type has to crop, so `zoom=<number>`
 * with `center=<x,y>` picks a window instead. There is no universally right
 * number: it depends on the frame the page gives us. See docs/EMBED.md.
 */
const embedZoomParam = params.get('zoom')
const embedFixedZoom =
  embedZoomParam && embedZoomParam !== 'fit' && Number.isFinite(Number(embedZoomParam))
    ? Math.min(Math.max(Number(embedZoomParam), 0.05), 2)
    : null

function embedCenter(): { x: number; y: number } {
  const raw = (params.get('center') ?? '').split(',').map(Number)
  if (raw.length === 2 && raw.every((n) => Number.isFinite(n))) {
    return { x: Math.min(Math.max(raw[0]!, 0), 1), y: Math.min(Math.max(raw[1]!, 0), 1) }
  }
  return { x: 0.5, y: 0.5 }
}

if (EMBED) document.body.classList.add('embed')

/**
 * Present mode, on the table itself. The main process decides it at launch and
 * says so in the URL (see PRESENT in electron/main.js).
 *
 * The opposite of an authoring session in every way that matters: no chrome,
 * no mouse-driven pucks, no overlay drawn on top of real ones, nothing restored
 * from a previous session (the tracker is the truth), and the surface at one
 * table pixel per screen pixel.
 */
const PRESENT = params.has('present') && !EMBED
if (PRESENT) document.body.classList.add('present')

const stage = $('#stage')
const sizer = $('#sizer')
const surfaceEl = $('#surface')
const iframe = $<HTMLIFrameElement>('#appframe')
const zoomReadout = $('#zoom-readout')
const markerInput = $<HTMLInputElement>('#marker-id')
const pinchBtn = $('#pinch-mode')
const passBtn = $('#pass-mouse')
const appSelect = $<HTMLSelectElement>('#app-select')

/* ---------------- preferences ---------------- */

interface Prefs {
  app: string
  surface: string
  zoomMode: 'fit' | 'fixed'
  zoom: number
  /** The inspector is a debug panel, so it starts closed. */
  inspector: boolean
}

const PREFS_KEY = 'planchette/prefs'

function loadPrefs(): Prefs {
  const fallback: Prefs = { app: '', surface: PRESETS[0]!.id, zoomMode: 'fit', zoom: 1, inspector: false }
  // A returning visitor must not be shown whatever the last one left behind.
  if (EMBED) return { ...fallback, app: params.get('app') || EMBED_DEFAULT_APP }
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>
    return {
      // Validated against the real app list later, since that arrives async.
      app: typeof saved.app === 'string' ? saved.app : fallback.app,
      surface: PRESETS.some((p) => p.id === saved.surface) ? saved.surface! : fallback.surface,
      zoomMode: saved.zoomMode === 'fixed' ? 'fixed' : 'fit',
      zoom: typeof saved.zoom === 'number' ? saved.zoom : 1,
      inspector: saved.inspector === true,
    }
  } catch {
    return fallback
  }
}

const prefs = loadPrefs()
// The table's own surface, from table.json. Not saved: it is not a preference.
if (PRESENT)
  prefs.surface = PRESETS.some((p) => p.id === params.get('surface')) ? params.get('surface')! : prefs.surface
const savePrefs = () => {
  if (EMBED) return
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
}

/* ---------------- table state across reloads ---------------- */

/**
 * Editing a file under examples/ makes Vite full-reload every connected client,
 * which includes this host page, not just the app iframe. Without persistence a
 * designer would lose their whole puck arrangement on every save, which is the
 * opposite of a fast iteration loop.
 *
 * Only pucks are kept. A contact is a finger, and fingers do not survive a page
 * reload. Restored pucks get fresh session ids, which is the honest outcome: a
 * reload really is a re-acquisition, exactly like the tracker losing and
 * refinding a marker.
 */
const TABLE_KEY = 'planchette/table'
const PERSIST_INTERVAL_MS = 500

interface SavedPuck {
  markerId: number
  x: number
  y: number
  angle: number
}

function persistTable(model: TableModel): void {
  if (EMBED || PRESENT) return
  const pucks: SavedPuck[] = model
    .puckIds()
    // A real table's pucks are not ours to restore: the tracker replays them,
    // and a restored copy would sit there after the real one was lifted.
    .filter((id) => !tuioInput?.owns(id))
    .map((id) => model.publicPuck(id)!)
    .map((p) => ({ markerId: p.markerId, x: p.x, y: p.y, angle: p.angle }))
  try {
    sessionStorage.setItem(TABLE_KEY, JSON.stringify(pucks))
  } catch {
    /* private browsing, or storage full */
  }
}

function restoreTable(model: TableModel): void {
  if (EMBED || PRESENT) return
  try {
    const saved = JSON.parse(sessionStorage.getItem(TABLE_KEY) ?? '[]') as SavedPuck[]
    for (const p of saved) {
      if (typeof p?.markerId !== 'number') continue
      model.addPuck({ markerId: p.markerId, x: p.x, y: p.y, angle: p.angle })
    }
  } catch {
    /* corrupt entry, start empty */
  }
}

/* ---------------- wiring ---------------- */

const model = new TableModel(infoFor(prefs.surface))
const frame = new AppFrame(iframe, model)
const overlay = new Overlay($('#overlay'), model)
// Not merely hidden: it does DOM work every frame, which an embed has no use for.
const inspector = EMBED || PRESENT ? null : new Inspector($('#inspector'), model)

// Every mutation of the model reaches the app as a discrete event. The full
// state snapshot is sent separately, once per frame.
model.subscribe((name, data) => frame.sendEvent(name, data))

// A real table, in the desktop build. Inert until table.json turns TUIO on: the
// main process sends nothing, so this is just a subscription.
const tuioInput = window.planchette && !EMBED ? installTuio(model, window.planchette) : null
if (inspector && tuioInput) inspector.tagFor = tuioInput.tagFor

// On the table, every puck and finger comes from the tracker. A mouse there is
// an operator's, for the settings and setup dialogs, not a simulated hand.
if (!PRESENT) {
  installInput(surfaceEl, model, {
    markerId: () => Math.max(1, Number(markerInput.value) || 1),
    pinchMode: () => pinchBtn.classList.contains('on'),
  })
}

let appList: string[] = []

/** The one way an interface gets chosen, so the picker always matches the frame. */
function selectApp(appId: string): void {
  prefs.app = appId
  savePrefs()
  if (appSelect.value !== appId) appSelect.value = appId
  frame.load(appId)
}

installSimApi(
  model,
  frame,
  () => appList,
  selectApp,
  (on) => {
    prefs.inspector = on
    savePrefs()
    applyInspector()
  },
)

/* ---------------- present mode ---------------- */

if (PRESENT && window.planchette) {
  const bridge = window.planchette
  const picker = installPresent({
    surfaceEl,
    model,
    frame,
    list: () => appList,
    select: selectApp,
    onControl: (cb) => bridge.onTuioControl(cb),
  })
  bridge.onPicker(() => (picker.isOpen ? picker.close() : picker.open()))
}

/* ---------------- zoom ---------------- */

function fitScale(): number {
  const s = model.getSurface()
  if (embedFixedZoom !== null) return embedFixedZoom
  if (PRESENT) {
    // Exactly 1 on the real table. Anywhere else (testing on a laptop) fit, and
    // say so, because then sizes on screen are not sizes on the table.
    const fit = Math.min(stage.clientWidth / s.widthPx, stage.clientHeight / s.heightPx)
    return Math.abs(fit - 1) < 0.002 ? 1 : fit
  }
  if (prefs.zoomMode === 'fixed') return prefs.zoom
  // Twice the css padding on #stage, which embed mode halves.
  const pad = EMBED ? 16 : 32
  return Math.min((stage.clientWidth - pad) / s.widthPx, (stage.clientHeight - pad) / s.heightPx)
}

function applyZoom(): void {
  const s = model.getSurface()
  const f = fitScale()
  sizer.style.width = `${s.widthPx * f}px`
  sizer.style.height = `${s.heightPx * f}px`
  surfaceEl.style.width = `${s.widthPx}px`
  surfaceEl.style.height = `${s.heightPx}px`
  surfaceEl.style.transform = `scale(${f})`
  // Overlay labels counter-scale by this so they stay readable when zoomed out.
  surfaceEl.style.setProperty('--inv-fit', String(1 / f))
  zoomReadout.textContent = `${Math.round(f * 100)}%`
  if (PRESENT) {
    const warn = $('#present-scale')
    warn.hidden = f === 1
    warn.textContent = `Not 1:1. This display is ${stage.clientWidth} x ${stage.clientHeight}, the surface is ${s.widthPx} x ${s.heightPx}.`
  }
  $('#zoom-fit').classList.toggle('on', prefs.zoomMode === 'fit')
  $('#zoom-1').classList.toggle('on', prefs.zoomMode === 'fixed' && prefs.zoom === 1)

  // A cropped embed positions the surface so the requested point lands in the
  // middle of the frame, rather than scrolling. #stage hides its overflow in
  // embed mode, so the crop is even on all sides and nothing scrolls under the
  // visitor's mouse while they are trying to drag a puck.
  if (EMBED && embedFixedZoom !== null) {
    const c = embedCenter()
    sizer.style.position = 'absolute'
    sizer.style.left = `${stage.clientWidth / 2 - c.x * s.widthPx * f}px`
    sizer.style.top = `${stage.clientHeight / 2 - c.y * s.heightPx * f}px`
    sizer.style.margin = '0'
  }
}

new ResizeObserver(() => {
  // A cropped embed also has to recentre when the container resizes, so it is not
  // enough to check for fit mode here.
  if (prefs.zoomMode === 'fit' || (EMBED && embedFixedZoom !== null)) applyZoom()
}).observe(stage)

/* ---------------- app list ---------------- */

async function refreshApps(force = false): Promise<void> {
  appList = await appSource.list()

  if (!appList.length) {
    setOptions(appSelect, [{ value: '', label: 'no apps found' }])
    return
  }

  setOptions(
    appSelect,
    appList.map((a) => ({ value: a, label: a })),
  )
  if (!appList.includes(prefs.app)) {
    prefs.app = appList.includes('dial-demo') ? 'dial-demo' : appList[0]!
    savePrefs()
  }
  appSelect.value = prefs.app
  if (force || frame.currentApp !== prefs.app) frame.load(prefs.app)
}

appSelect.addEventListener('change', () => selectApp(appSelect.value))

// A file changed on disk. Reload the app being viewed, and pick up new folders.
appSource.onChange((appId) => {
  void refreshApps()
  if (!appId || appId === frame.currentApp) frame.reload()
})

window.planchette?.onReloadApp(() => frame.reload())

/* ---------------- workspace (desktop build only) ---------------- */

async function setupWorkspace(): Promise<void> {
  const ws = appSource.workspace
  if (!ws) return

  // Settings only has anything to configure when there is a workspace, which
  // means the desktop build.
  const dialog = $<HTMLDialogElement>('#settings')

  $('#settings-close').addEventListener('click', () => dialog.close())
  dialog.addEventListener('click', (ev) => {
    if (ev.target === dialog) dialog.close()
  })
  window.planchette?.onOpenSettings(() => {
    if (!dialog.open) dialog.showModal()
  })

  const pathEl = $('#workspace-path')
  const select = $<HTMLSelectElement>('#ws-select')
  const selectRow = $('#ws-select-row')
  const nameEl = $('#ws-name')
  const status = $('#ws-status')
  const newForm = $('#ws-new-form')
  const nameInput = $<HTMLInputElement>('#ws-new-name')

  const basename = (p: string) => p.split(/[/\\]/).filter(Boolean).pop() ?? p

  /** Redraw the picker from whatever the main process says is current. */
  const draw = (list: { current: string; recent: string[] }) => {
    const paths = list.recent.includes(list.current) ? list.recent : [list.current, ...list.recent]

    // Only offer a switcher once there is something to switch to. A select with a
    // single option reads as a control that does nothing.
    const many = paths.length > 1
    selectRow.hidden = !many
    nameEl.hidden = many

    nameEl.textContent = basename(list.current)
    setOptions(
      select,
      paths.map((p) => ({ value: p, label: basename(p) })),
      list.current,
    )
    pathEl.textContent = list.current
    pathEl.title = list.current
  }

  draw(await ws.list())

  /** Opening a workspace may have upgraded it. Say so once, if it did. */
  const reportUpgrade = async () => {
    const report = await ws.upgradeReport()
    if (report) showUpgradeNotice(report, () => void ws.reveal())
  }
  await reportUpgrade()

  /** A different folder means a different set of interfaces, so force a reload. */
  const switchTo = async (list: { current: string; recent: string[] } | null) => {
    if (!list) return
    status.textContent = ''
    draw(list)
    await refreshApps(true)
    await reportUpgrade()
  }

  select.addEventListener('change', async () => {
    try {
      await switchTo(await ws.use(select.value))
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : 'could not open that folder'
      draw(await ws.list())
    }
  })

  const changeWorkspace = async () => switchTo(await ws.choose())

  const forgetWorkspace = async () => {
    const list = await ws.list()
    // Forgetting the folder you are standing in would leave the picker lying.
    if (list.recent.length < 2) {
      status.textContent = 'nothing else to fall back to'
      return
    }
    draw(await ws.forget(list.current))
    await switchTo(await ws.use((await ws.list()).recent[0]!))
  }

  const closeForm = () => {
    newForm.hidden = true
    status.textContent = ''
  }

  const create = async () => {
    const name = nameInput.value.trim()
    if (!name) return
    try {
      const id = await ws.createInterface(name)
      prefs.app = id
      savePrefs()
      closeForm()
      await refreshApps(true)
      // Open the folder so the designer lands on the files they can edit.
      await ws.reveal(id)
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : 'could not create that interface'
    }
  }

  const openForm = () => {
    newForm.hidden = false
    nameInput.value = ''
    nameInput.focus()
  }

  // Every workspace verb is a File menu item now, so the panel is just the
  // picker, the path, and the field that naming a new folder needs.
  $('#ws-reveal').addEventListener('click', () => void ws.reveal())
  $('#ws-add').addEventListener('click', () => void changeWorkspace())
  $('#ws-forget').addEventListener('click', () => void forgetWorkspace())

  const bridge = window.planchette
  if (bridge) {
    setupTableSettings(bridge, (s) => inspector?.setTuioStatus(s))
    setupEnrollment(bridge, model)
  }
  bridge?.onChooseWorkspace(() => void changeWorkspace())
  bridge?.onForgetWorkspace(() => void forgetWorkspace())
  bridge?.onNewInterface(() => {
    if (!dialog.open) dialog.showModal()
    openForm()
  })
  bridge?.onToggleInspector(toggleInspector)
  bridge?.onAbout(() => $<HTMLDialogElement>('#about').showModal())

  $('#ws-new-create').addEventListener('click', () => void create())
  $('#ws-new-cancel').addEventListener('click', closeForm)
  nameInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') void create()
    if (ev.key === 'Escape') closeForm()
  })
}

/* ---------------- identity ---------------- */

/**
 * The only place the product names itself. Deliberately the app's own dark
 * chrome with the white lockup rather than Hyperquake's white ground: the brand
 * palette governs identity surfaces and public pages, not the working tool.
 *
 * The lockup SVGs carry live text and fall back to Helvetica without Untitled
 * Sans installed, so they are development assets until the wordmark is outlined
 * from the licensed font.
 */
function setupAbout(): void {
  const dialog = $<HTMLDialogElement>('#about')
  const open = $('#about-open')

  // Both marks come from brand/, so there is one source of truth for the
  // artwork and no hand-drawn copy to drift.
  const mark = new Image()
  mark.src = markUrl
  mark.alt = ''
  open.replaceChildren(mark)
  $<HTMLImageElement>('#about-lockup').src = lockupUrl
  $('#about-version').textContent = __APP_VERSION__

  open.addEventListener('click', () => dialog.showModal())
  $('#about-close').addEventListener('click', () => dialog.close())
  // Clicking the backdrop closes it: the dialog element itself fills the
  // backdrop, so a click landing on it rather than on the panel is outside.
  dialog.addEventListener('click', (ev) => {
    if (ev.target === dialog) dialog.close()
  })
}

/* ---------------- controls ---------------- */

const surfaceSelect = $<HTMLSelectElement>('#surface-select')
setOptions(
  surfaceSelect,
  PRESETS.map((p) => ({ value: p.id, label: p.label })),
)
surfaceSelect.value = prefs.surface
surfaceSelect.addEventListener('change', () => {
  prefs.surface = surfaceSelect.value
  savePrefs()
  model.setSurface(infoFor(prefs.surface))
  frame.applySurface()
  inspector?.renderSurface()
  applyZoom()
})

$('#reload').addEventListener('click', () => frame.reload())

$('#zoom-fit').addEventListener('click', () => {
  prefs.zoomMode = 'fit'
  savePrefs()
  applyZoom()
})
$('#zoom-1').addEventListener('click', () => {
  prefs.zoomMode = 'fixed'
  prefs.zoom = 1
  savePrefs()
  applyZoom()
})

$('#add-puck').addEventListener('click', () => {
  model.addPuck({ markerId: Math.max(1, Number(markerInput.value) || 1), x: 0.5, y: 0.5 })
  markerInput.value = String(Math.max(1, Number(markerInput.value) || 1) + 1)
})

for (const btn of [pinchBtn, passBtn]) {
  btn.addEventListener('click', () => {
    btn.classList.toggle('on')
    surfaceEl.classList.toggle('pass-mouse', passBtn.classList.contains('on'))
  })
}

$('#clear').addEventListener('click', () => model.clear())

function toggleInspector(): void {
  prefs.inspector = !prefs.inspector
  savePrefs()
  applyInspector()
}

// The desktop build drives this from View > Toggle Inspector, and a menu
// accelerator never reaches the page. A browser has no menus, so bind the same
// shortcut here, and only here, so the two can never both fire.
if (!window.planchette) {
  window.addEventListener('keydown', (ev) => {
    if (ev.key.toLowerCase() !== 'i' || !(ev.metaKey || ev.ctrlKey)) return
    ev.preventDefault()
    toggleInspector()
  })
}

/* ---------------- frame loop ---------------- */

let pendingPersist = false
let lastPersist = 0

/** Collapse or restore the inspector column, and remember the choice. */
function applyInspector(): void {
  document.body.classList.toggle('no-inspector', !prefs.inspector)
  // The stage changed width, so refit. The ResizeObserver covers this too, but
  // doing it here means no visible one-frame lag.
  applyZoom()
}

function tick(now: number): void {
  const changed = model.consumeDirty()
  // Stream continuously while anything is on the surface, the way a real
  // tracker does, so apps that poll state() never see a stale frame.
  if (changed || model.hasContacts()) frame.sendState()
  if (changed) {
    if (!PRESENT || document.body.classList.contains('calibrating')) overlay.render()
    pendingPersist = true
  }
  if (pendingPersist && now - lastPersist > PERSIST_INTERVAL_MS) {
    pendingPersist = false
    lastPersist = now
    persistTable(model)
  }
  // Built once so toggling is instant, but idle while hidden: it does DOM work
  // every frame and a closed panel has no use for it.
  if (prefs.inspector) inspector?.tick(now)
  requestAnimationFrame(tick)
}

// Restore before the app loads, so the handshake replays the pucks to it.
restoreTable(model)
applyInspector()
applyZoom()
requestAnimationFrame(tick)

if (!EMBED) setupAbout()

void (async () => {
  await refreshApps()
  await setupWorkspace()

  // An empty table demonstrates nothing. Seed one puck clear of the centre, where
  // most examples put their shared content. `?puck=none` suppresses it for a page
  // that would rather script the scene itself through window.sim.
  if (EMBED && params.get('puck') !== 'none' && !model.hasContacts()) {
    model.addPuck({ markerId: 1, x: 0.28, y: 0.5 })
  }
})()

console.info('[planchette] window.sim is available. Try: sim.addPuck({ markerId: 3, mmX: 600, mmY: 340 })')
