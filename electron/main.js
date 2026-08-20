/**
 * Electron main process.
 *
 * Two jobs. First, serve the host UI and the designer apps over a custom
 * `table://` scheme. Second, own the workspace: a folder on the user's disk that
 * holds their apps, which they can edit with any editor while the app is running.
 *
 * Why a custom scheme rather than file:// or a localhost server:
 *  - file:// blocks ES module scripts, and every designer app is a module.
 *  - A localhost server can trip the macOS firewall prompt on first launch,
 *    which is a bad first impression for something handed round a team.
 *
 * Host UI and apps deliberately share one origin (`table://host`), so an app's
 * URL is `/apps/<id>/index.html` in both the packaged app and the Vite dev
 * server. Nothing in the renderer has to know which one it is running under.
 */

import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, shell } from 'electron'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(HERE, '..', 'dist')
const SCHEME = 'table'
const ORIGIN = `${SCHEME}://host`

/**
 * Loading the Vite dev server instead of the bundle. Accepted as a flag as well
 * as an env var, because `FOO=bar cmd` is not portable to Windows shells.
 */
const DEV_URL =
  process.env.TABLE_SIM_DEV_URL ||
  process.argv.find((a) => a.startsWith('--dev-url='))?.slice('--dev-url='.length) ||
  null

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
])

/* ------------------------------------------------------------------ *
 * Settings and workspace
 * ------------------------------------------------------------------ */

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json')

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'))
  } catch {
    return {}
  }
}

function writeSettings(next) {
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true })
    fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2))
  } catch (err) {
    console.error('[table-sim] could not save settings', err)
  }
}

let workspace = ''

/**
 * Files copied into a fresh workspace: the two example apps, the house rules,
 * and SDK type declarations so an editor or a coding agent opened on that folder
 * has everything it needs. Built by scripts/build-seed.mjs.
 */
function seedDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'workspace-seed')
    : path.join(HERE, '..', 'workspace-seed')
}

async function listApps() {
  try {
    const entries = await fsp.readdir(workspace, { withFileTypes: true })
    const found = []
    for (const e of entries) {
      if (!e.isDirectory()) continue
      if (fs.existsSync(path.join(workspace, e.name, 'index.html'))) found.push(e.name)
    }
    return found.sort()
  } catch {
    return []
  }
}

async function ensureWorkspace() {
  await fsp.mkdir(workspace, { recursive: true })
  if ((await listApps()).length > 0) return

  const seed = seedDir()
  if (!fs.existsSync(seed)) {
    console.error(`[table-sim] no workspace seed at ${seed}; run npm run build:seed`)
    return
  }
  // Never clobber: a folder with no apps may still hold a designer's notes.
  await fsp.cp(seed, workspace, { recursive: true, force: false, errorOnExist: false })
}

/* ------------------------------------------------------------------ *
 * Serving
 * ------------------------------------------------------------------ */

/**
 * An app folder is just a folder: its index.html may reference any local script,
 * stylesheet, image, font, model, or shader it likes, at any depth. Types that
 * the browser is strict about (scripts, styles, wasm) must be exact; the rest
 * fall through to a generic type, which is fine for anything fetched as a blob
 * or an ArrayBuffer.
 */
const MIME = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json',
  // shaders, read as text
  '.glsl': 'text/plain',
  '.vert': 'text/plain',
  '.frag': 'text/plain',
  // images
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  // fonts
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  // 3D, for Three.js apps
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.hdr': 'image/vnd.radiance',
  '.exr': 'image/aces',
  '.ktx2': 'image/ktx2',
  '.bin': 'application/octet-stream',
  '.obj': 'text/plain',
  '.mtl': 'text/plain',
  // media
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
}

/** Join under a root, refusing anything that escapes it. */
function safeJoin(root, ...parts) {
  const target = path.resolve(root, ...parts)
  const base = path.resolve(root)
  return target === base || target.startsWith(base + path.sep) ? target : null
}

function notFound() {
  return new Response('not found', { status: 404, headers: { 'Content-Type': 'text/plain' } })
}

async function serveFile(file) {
  if (!file) return notFound()
  let body
  try {
    body = await fsp.readFile(file)
  } catch {
    // Missing, or a directory, which is the same thing to a caller.
    return notFound()
  }
  // Set the type explicitly: Chromium refuses a module script served with the
  // wrong MIME outright, and module scripts are most of what we serve.
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
  return new Response(body, { headers: { 'Content-Type': type } })
}

/**
 * Bare specifiers the app provides to designer code. Vite resolves these during
 * development; the packaged app has no bundler, so it injects an import map.
 */
const PROVIDED = {
  '@table/sdk': '/sdk.js',
  three: '/three.js',
}
const IMPORT_MAP = `<script type="importmap">${JSON.stringify({ imports: PROVIDED })}</script>`

/**
 * Designer apps import bare specifiers such as `@table/sdk` and `three`. Vite
 * resolves those during development; browsers cannot, so we inject an import map.
 *
 * A document may only have one import map, so if the designer wrote their own we
 * merge into it and let their mapping win.
 */
async function serveAppHtml(file) {
  let html
  try {
    html = await fsp.readFile(file, 'utf8')
  } catch {
    return notFound()
  }

  if (/<script[^>]*type=["']importmap["']/i.test(html)) {
    html = html.replace(
      /(<script[^>]*type=["']importmap["'][^>]*>)([\s\S]*?)(<\/script>)/i,
      (whole, open, body, close) => {
        try {
          const parsed = JSON.parse(body)
          parsed.imports = { ...PROVIDED, ...(parsed.imports ?? {}) }
          return `${open}${JSON.stringify(parsed)}${close}`
        } catch {
          return whole
        }
      },
    )
  } else if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, (m) => m + IMPORT_MAP)
  } else {
    html = IMPORT_MAP + html
  }

  return new Response(html, { headers: { 'Content-Type': 'text/html' } })
}

function registerProtocol() {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url)
    if (url.host !== 'host') return notFound()
    const pathname = decodeURIComponent(url.pathname)

    // /apps/<id>/... comes from the workspace on disk.
    const match = /^\/apps\/([^/]+)(?:\/(.*))?$/.exec(pathname)
    if (match) {
      const [, appId, rest] = match
      const file = safeJoin(workspace, appId, rest || 'index.html')
      if (!file) return notFound()
      return file.toLowerCase().endsWith('.html') ? serveAppHtml(file) : serveFile(file)
    }

    // Everything else is the host UI bundle.
    return serveFile(safeJoin(DIST, pathname === '/' ? 'index.html' : pathname.replace(/^\//, '')))
  })
}

/* ------------------------------------------------------------------ *
 * Watching
 * ------------------------------------------------------------------ */

let watcher = null

/**
 * Tell the renderer when workspace files change, so it can reload just the app
 * iframe. Built-in fs.watch is enough here: recursive mode is supported on both
 * macOS and Windows, which keeps the packaged app free of runtime dependencies.
 */
function watchWorkspace(win) {
  watcher?.close()
  watcher = null
  let timer = null
  let lastApp = null

  try {
    watcher = fs.watch(workspace, { recursive: true }, (_event, filename) => {
      if (filename) {
        const first = String(filename).split(path.sep)[0]
        lastApp = first || null
      }
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (!win.isDestroyed()) win.webContents.send('apps:changed', lastApp)
        lastApp = null
      }, 150)
    })
  } catch (err) {
    console.error('[table-sim] could not watch the workspace', err)
  }
}

/* ------------------------------------------------------------------ *
 * IPC
 * ------------------------------------------------------------------ */

/** Folder-safe, lowercase, no surprises on either platform. */
function slugify(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function registerIpc(win) {
  ipcMain.handle('apps:list', () => listApps())
  ipcMain.handle('workspace:path', () => workspace)

  ipcMain.handle('workspace:reveal', async (_e, appId) => {
    const target = appId ? safeJoin(workspace, appId) : workspace
    if (target) await shell.openPath(target)
  })

  ipcMain.handle('workspace:choose', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Choose a workspace folder',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: workspace,
    })
    if (canceled || !filePaths[0]) return null
    workspace = filePaths[0]
    writeSettings({ ...readSettings(), workspace })
    await ensureWorkspace()
    watchWorkspace(win)
    return workspace
  })

  ipcMain.handle('apps:create', async (_e, rawName) => {
    const id = slugify(rawName)
    if (!id) throw new Error('Use letters and numbers for the name.')
    const dest = safeJoin(workspace, id)
    if (!dest) throw new Error('That name is not allowed.')
    if (fs.existsSync(dest)) throw new Error(`"${id}" already exists.`)

    const template = path.join(seedDir(), '_template')
    if (!fs.existsSync(template)) throw new Error('The app template is missing from this build.')
    await fsp.cp(template, dest, { recursive: true })
    return id
  })
}

/* ------------------------------------------------------------------ *
 * Window and menu
 * ------------------------------------------------------------------ */

function buildMenu(win) {
  const isMac = process.platform === 'darwin'
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Workspace Folder',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => shell.openPath(workspace),
        },
        {
          label: 'Change Workspace…',
          click: () => win.webContents.send('app:choose-workspace'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload App',
          accelerator: 'CmdOrCtrl+R',
          click: () => win.webContents.send('app:reload'),
        },
        {
          label: 'Reload Simulator',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => win.webContents.reload(),
        },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#14161a',
    title: 'Touch Table Sim',
    show: false,
    webPreferences: {
      preload: path.join(HERE, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Designers watch this window while typing in another app, and apps render
      // in a requestAnimationFrame loop. Chromium throttles rAF hard once it
      // decides a window is occluded, which would freeze the table mid-edit.
      backgroundThrottling: false,
    },
  })

  win.once('ready-to-show', () => win.show())
  registerIpc(win)
  buildMenu(win)
  watchWorkspace(win)

  // Designer apps are local files, but never let one navigate the shell or spawn
  // windows of its own.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  await win.loadURL(DEV_URL ?? `${ORIGIN}/`)
  return win
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.whenReady().then(async () => {
  // In dev the host UI is served by Vite from the repo, so point the workspace at
  // the repo's own apps folder; otherwise the app list and the URLs would
  // disagree about which apps exist.
  workspace = DEV_URL
    ? path.join(HERE, '..', 'apps')
    : process.env.TABLE_SIM_WORKSPACE ||
      readSettings().workspace ||
      path.join(app.getPath('documents'), 'Touch Table Sim')

  await ensureWorkspace()
  registerProtocol()
  await createWindow()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow()
  })
})
