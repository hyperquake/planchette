import lockupUrl from '../../brand/lockup-horizontal-white.svg?url'
import markUrl from '../../brand/mark-white.svg?url'
import { AppFrame } from './appframe'
import { appSource } from './appsource'
import { installInput } from './input'
import { Inspector } from './inspector'
import { TableModel } from './model'
import { Overlay } from './overlay'
import { installSimApi } from './simapi'
import { infoFor, PRESETS } from './surface'

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel)
  if (!el) throw new Error(`missing element ${sel}`)
  return el
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
  if (EMBED) return
  const pucks: SavedPuck[] = model
    .puckIds()
    .map((id) => model.publicPuck(id)!)
    .map((p) => ({ markerId: p.markerId, x: p.x, y: p.y, angle: p.angle }))
  try {
    sessionStorage.setItem(TABLE_KEY, JSON.stringify(pucks))
  } catch {
    /* private browsing, or storage full */
  }
}

function restoreTable(model: TableModel): void {
  if (EMBED) return
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
const inspector = EMBED ? null : new Inspector($('#inspector'), model)

// Every mutation of the model reaches the app as a discrete event. The full
// state snapshot is sent separately, once per frame.
model.subscribe((name, data) => frame.sendEvent(name, data))

installInput(surfaceEl, model, {
  markerId: () => Math.max(1, Number(markerInput.value) || 1),
  pinchMode: () => pinchBtn.classList.contains('on'),
})

let appList: string[] = []
installSimApi(model, frame, () => appList)

/* ---------------- zoom ---------------- */

function fitScale(): number {
  const s = model.getSurface()
  if (embedFixedZoom !== null) return embedFixedZoom
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
    appSelect.innerHTML = '<option value="">no apps found</option>'
    return
  }

  appSelect.innerHTML = appList.map((a) => `<option value="${a}">${a}</option>`).join('')
  if (!appList.includes(prefs.app)) {
    prefs.app = appList.includes('dial-demo') ? 'dial-demo' : appList[0]!
    savePrefs()
  }
  appSelect.value = prefs.app
  if (force || frame.currentApp !== prefs.app) frame.load(prefs.app)
}

appSelect.addEventListener('change', () => {
  prefs.app = appSelect.value
  savePrefs()
  frame.load(prefs.app)
})

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
    select.innerHTML = paths
      .map((p) => `<option value="${p}"${p === list.current ? ' selected' : ''}>${basename(p)}</option>`)
      .join('')
    pathEl.textContent = list.current
    pathEl.title = list.current
  }

  draw(await ws.list())

  /** A different folder means a different set of interfaces, so force a reload. */
  const switchTo = async (list: { current: string; recent: string[] } | null) => {
    if (!list) return
    status.textContent = ''
    draw(list)
    await refreshApps(true)
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
  open.innerHTML = `<img src="${markUrl}" alt="">`
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
surfaceSelect.innerHTML = PRESETS.map((p) => `<option value="${p.id}">${p.label}</option>`).join('')
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
    overlay.render()
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
