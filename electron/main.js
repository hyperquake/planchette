/**
 * Electron main process.
 *
 * Two jobs. First, serve the host UI and the designer apps over a custom
 * `planchette://` scheme. Second, own the workspace: a folder on the user's disk that
 * holds their apps, which they can edit with any editor while the app is running.
 *
 * Why a custom scheme rather than file:// or a localhost server:
 *  - file:// blocks ES module scripts, and every designer app is a module.
 *  - A localhost server can trip the macOS firewall prompt on first launch,
 *    which is a bad first impression for something handed round a team.
 *
 * The host UI and the interfaces deliberately share one origin
 * (`planchette://host`): the UI is served from the bundle, interfaces from
 * `/workspace/`. One origin means no CORS and no cross-origin restrictions
 * between the two.
 */

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, protocol, shell } from 'electron'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(HERE, '..', 'dist')
const SCHEME = 'planchette'
const ORIGIN = `${SCHEME}://host`

/**
 * Loading the Vite dev server instead of the bundle. Accepted as a flag as well
 * as an env var, because `FOO=bar cmd` is not portable to Windows shells.
 */
const DEV_URL =
  process.env.PLANCHETTE_DEV_URL ||
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
    console.error('[planchette] could not save settings', err)
  }
}

let workspace = ''

/** Most recent first. Enough to cover a few concurrent client projects. */
const MAX_RECENT = 8

function recentWorkspaces() {
  const saved = readSettings().recentWorkspaces
  return Array.isArray(saved) ? saved.filter((p) => typeof p === 'string') : []
}

/** Record a workspace as current and move it to the front of the recent list. */
function rememberWorkspace(dir) {
  const recent = [dir, ...recentWorkspaces().filter((p) => p !== dir)].slice(0, MAX_RECENT)
  writeSettings({ ...readSettings(), workspace: dir, recentWorkspaces: recent })
}

/**
 * Switch to a workspace: seed it if it is empty, remember it, and re-point the
 * watcher. Returns the list the renderer needs to redraw its picker.
 */
async function useWorkspace(dir, win) {
  workspace = dir
  await ensureWorkspace()
  rememberWorkspace(dir)
  if (win) watchWorkspace(win)
  return { current: workspace, recent: recentWorkspaces() }
}

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
    console.error(`[planchette] no workspace seed at ${seed}; run npm run build:seed`)
    return
  }
  // Never clobber: a folder with no apps may still hold a designer's notes.
  await fsp.cp(seed, workspace, { recursive: true, force: false, errorOnExist: false })
}

/* ------------------------------------------------------------------ *
 * Serving
 * ------------------------------------------------------------------ */

/**
 * An interface folder is just a folder: its index.html may reference any local script,
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
  '@planchette/sdk': '/sdk.js',
  three: '/three.js',
}
const IMPORT_MAP = `<script type="importmap">${JSON.stringify({ imports: PROVIDED })}</script>`

/**
 * Designer apps import bare specifiers such as `@planchette/sdk` and `three`. Vite
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

    // /workspace/<id>/... comes from the workspace folder on disk.
    const match = /^\/workspace\/([^/]+)(?:\/(.*))?$/.exec(pathname)
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
    console.error('[planchette] could not watch the workspace', err)
  }
}

/* ------------------------------------------------------------------ *
 * IPC
 * ------------------------------------------------------------------ */

/** "my-map-table" -> "My map table". Good enough for a title. */
function titleCase(id) {
  const words = id.replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * Turn a fresh copy of the template into a named interface.
 *
 * The CLAUDE.md matters more than it looks: it is how an editor or a coding
 * agent opened on this folder alone learns which system it is in, where the API
 * is, and that the design rules exist. A folder that cannot explain itself gets
 * the generic web treatment, which is wrong in every way that counts on a table.
 */
async function personalise(dir, id) {
  const title = titleCase(id)

  const indexPath = path.join(dir, 'index.html')
  try {
    const html = await fsp.readFile(indexPath, 'utf8')
    await fsp.writeFile(indexPath, html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`))
  } catch {
    /* template without an index.html; nothing to retitle */
  }

  await fsp.writeFile(
    path.join(dir, 'CLAUDE.md'),
    `# ${title}

An interface for the **Planchette** table simulator: a large multitouch surface
that also tracks physical pucks, each reporting its own identity, position, and
rotation.

- \`index.html\` holds the markup and CSS. Size everything in millimetres via
  \`calc(20 * var(--mm))\`, never in raw pixels.
- \`main.js\` imports \`@planchette/sdk\` and reacts to pucks and contacts.
- This folder is an ordinary static site. Reference any local file at any depth,
  and remote https URLs too.

Read **\`../DESIGN-RULES.md\`** before changing behaviour. It is short, and it is
the difference between something that works on a laptop and something that works
on a table with four people around it. The API reference is **\`../API.md\`**.

The viewport is the table's real resolution, not a laptop window. There is no
cursor, no hover, and no single selected thing.
`,
  )
}

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
  ipcMain.handle('workspace:list', () => ({ current: workspace, recent: recentWorkspaces() }))

  ipcMain.handle('workspace:use', async (_e, dir) => {
    // Only switch to somewhere that still exists: a folder can be moved or a
    // volume unmounted between sessions, and the recent list would go stale.
    try {
      if (!(await fsp.stat(dir)).isDirectory()) throw new Error('not a directory')
    } catch {
      throw new Error(`That folder is no longer there:\n${dir}`)
    }
    return useWorkspace(dir, win)
  })

  ipcMain.handle('workspace:forget', (_e, dir) => {
    const recent = recentWorkspaces().filter((p) => p !== dir)
    writeSettings({ ...readSettings(), recentWorkspaces: recent })
    return { current: workspace, recent }
  })

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
    return useWorkspace(filePaths[0], win)
  })

  ipcMain.handle('interface:create', async (_e, rawName) => {
    const id = slugify(rawName)
    if (!id) throw new Error('Use letters and numbers for the name.')
    const dest = safeJoin(workspace, id)
    if (!dest) throw new Error('That name is not allowed.')
    if (fs.existsSync(dest)) throw new Error(`"${id}" already exists.`)

    const template = path.join(seedDir(), '_template')
    if (!fs.existsSync(template)) throw new Error('The interface template is missing from this build.')
    await fsp.cp(template, dest, { recursive: true })
    await personalise(dest, id)
    return id
  })
}

/* ------------------------------------------------------------------ *
 * Window and menu
 * ------------------------------------------------------------------ */

let cachedDevIcon

/**
 * An icon for unpackaged runs only.
 *
 * A packaged build takes its icon from the bundle, which is authoritative and
 * already correct. Running `npm run electron:dev` there is no bundle, so Electron
 * shows its own stock icon in the dock and the taskbar.
 *
 * Uses build/icon.png, the full-bleed 512 fallback, as-is. Nothing here resizes
 * or regenerates anything: the multi-size .icns and .ico each carry two distinct
 * pieces of artwork and must not be rebuilt from a single PNG.
 *
 * build/ is not in the packaged `files` list, which is exactly why this is
 * guarded on isPackaged rather than just letting the read fail.
 */
function devIcon() {
  if (cachedDevIcon !== undefined) return cachedDevIcon
  if (app.isPackaged) {
    cachedDevIcon = null
    return cachedDevIcon
  }
  const image = nativeImage.createFromPath(path.join(HERE, '..', 'build', 'icon.png'))
  cachedDevIcon = image.isEmpty() ? null : image
  if (!cachedDevIcon) console.warn('[planchette] build/icon.png missing or unreadable; using the stock icon')
  return cachedDevIcon
}

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
  const icon = devIcon()
  const win = new BrowserWindow({
    // Ignored on macOS, which uses the bundle or the dock icon set below. This
    // is what gives Windows and Linux a real window and taskbar icon in dev.
    ...(icon ? { icon } : {}),
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#14161a',
    title: 'Planchette',
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
    : process.env.PLANCHETTE_WORKSPACE ||
      readSettings().workspace ||
      path.join(app.getPath('documents'), 'Planchette')

  await ensureWorkspace()
  if (!DEV_URL) rememberWorkspace(workspace)
  registerProtocol()

  // macOS reads the dock icon from the bundle, which an unpackaged run has not
  // got, so set it explicitly. Once, not per window.
  const icon = devIcon()
  if (icon && process.platform === 'darwin' && app.dock) app.dock.setIcon(icon)

  await createWindow()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow()
  })
})
