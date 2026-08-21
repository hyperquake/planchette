/**
 * Smoke test for the packaged shell.
 *
 * Launches the real Electron app against a throwaway workspace and drives the
 * renderer over the Chrome DevTools Protocol, so it exercises the actual
 * protocol handler, preload bridge, and workspace seeding rather than a stand-in.
 *
 *   node scripts/smoke-desktop.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

const PORT = 9333
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'planchette-smoke-'))
/**
 * Its own userData directory. Without this the test shares the real app's
 * settings.json and localStorage, and a run leaves its throwaway workspace in the
 * user's recent list and clobbers their chosen interface.
 */
const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'planchette-udata-'))

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `  ${detail}` : ''}`)
}

// Resolve the Electron binary directly rather than going through npx. Node 20.12
// and later refuse to spawn a .cmd file without shell: true, so `npx.cmd` throws
// EINVAL on Windows, and enabling a shell just to work around that would mean
// quoting the workspace path by hand. The electron package exports its
// executable path, which sidesteps both problems.
const electronBinary = createRequire(import.meta.url)('electron')

const electron = spawn(
  electronBinary,
  ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`],
  { env: { ...process.env, PLANCHETTE_WORKSPACE: workspace }, stdio: ['ignore', 'pipe', 'pipe'] },
)

let stderr = ''
electron.stderr.on('data', (d) => (stderr += d))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Wait for the renderer to register itself as a debuggable target. */
async function findTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())
      const page = list.find((t) => t.type === 'page' && String(t.url).startsWith('planchette://host/'))
      if (page?.webSocketDebuggerUrl) return page
    } catch {
      /* not listening yet */
    }
    await sleep(500)
  }
  throw new Error(`renderer never appeared.\n${stderr}`)
}

let ws
let nextId = 1
const pending = new Map()

function connect(url) {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(url)
    ws.addEventListener('open', () => resolve())
    ws.addEventListener('error', reject)
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      const slot = pending.get(msg.id)
      if (slot) {
        pending.delete(msg.id)
        slot(msg)
      }
    })
  })
}

function send(method, params) {
  const id = nextId++
  return new Promise((resolve) => {
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

/** Evaluate in the renderer and return the plain value. */
async function evaluate(expression) {
  const res = await send('Runtime.evaluate', {
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true,
    returnByValue: true,
  })
  if (res.result?.exceptionDetails) {
    throw new Error(res.result.exceptionDetails.exception?.description ?? 'evaluate threw')
  }
  return res.result?.result?.value
}

try {
  const target = await findTarget()
  await connect(target.webSocketDebuggerUrl)
  await send('Runtime.enable', {})

  // userData is a fresh directory per run, so there is nothing persisted to
  // inherit. Wait for the first interface to settle before asserting anything.
  for (let i = 0; i < 80; i++) {
    const ready = await evaluate(
      "return Boolean(window.sim && document.getElementById('appframe') && document.readyState === 'complete')",
    ).catch(() => false)
    if (ready) break
    await sleep(250)
  }
  // And wait for the default interface to be loaded in the frame, not merely
  // pointed at: the src attribute changes before the document is ready.
  await evaluate(`
    const f = document.getElementById('appframe');
    for (let i = 0; i < 80; i++) {
      if (String(f.getAttribute('src')).includes('dial-demo') && f.contentDocument?.readyState === 'complete') break;
      await new Promise(r => setTimeout(r, 100));
    }
    return 1;
  `)

  // The workspace was seeded from the bundle.
  const seeded = await fs.readdir(workspace)
  check('workspace seeded on first run', seeded.includes('dial-demo') && seeded.includes('CLAUDE.md'), seeded.sort().join(', '))

  // The preload bridge is reachable and reports what it found on disk.
  const bridge = await evaluate('return { version: window.planchette?.version, apps: await window.planchette?.listApps(), ws: await window.planchette?.workspacePath() }')
  check('preload bridge exposed', Boolean(bridge?.version), `electron ${bridge?.version}`)
  check('apps listed from workspace', Array.isArray(bridge?.apps) && bridge.apps.includes('dial-demo'), JSON.stringify(bridge?.apps))
  check('workspace path is the temp dir', bridge?.ws === workspace)

  // The host bundle and the standalone SDK are served.
  const sdk = await evaluate("const r = await fetch('/sdk.js'); return { status: r.status, type: r.headers.get('content-type'), hasExport: (await r.text()).includes('export') }")
  check('/sdk.js served as JavaScript', sdk?.status === 200 && sdk.type === 'text/javascript' && sdk.hasExport, `${sdk?.status} ${sdk?.type}`)

  // Favicons come from public/, which Vite copies to the root of dist. Served
  // over the custom protocol they need the right MIME type, and that is the part
  // that can silently break once packaged.
  const favicon = await evaluate("const r = await fetch('/favicon.svg'); return { status: r.status, type: r.headers.get('content-type') }")
  check('favicon.svg served as image/svg+xml', favicon?.status === 200 && favicon.type === 'image/svg+xml', `${favicon?.status} ${favicon?.type}`)

  const faviconIco = await evaluate("const r = await fetch('/favicon.ico'); return { status: r.status, type: r.headers.get('content-type') }")
  check('favicon.ico served as image/x-icon', faviconIco?.status === 200 && faviconIco.type === 'image/x-icon', `${faviconIco?.status} ${faviconIco?.type}`)

  // Byte ranges. Chromium seeks media by asking for ranges, so without these a
  // video cannot be scrubbed, and a large file served whole fails as a decode
  // error rather than an honest one.
  const ranged = await evaluate(`
    const r = await fetch('/sdk.js', { headers: { Range: 'bytes=0-99' } });
    const body = await r.text();
    return {
      status: r.status,
      acceptRanges: r.headers.get('accept-ranges'),
      contentRange: r.headers.get('content-range'),
      length: body.length,
    };
  `)
  check(
    'byte ranges served as 206 partial content',
    ranged?.status === 206 && ranged.acceptRanges === 'bytes' && /^bytes 0-99\/\d+$/.test(ranged.contentRange ?? '') && ranged.length === 100,
    `${ranged?.status} ${ranged?.contentRange} ${ranged?.length}b`,
  )

  const whole = await evaluate("const r = await fetch('/sdk.js'); return { status: r.status, acceptRanges: r.headers.get('accept-ranges') }")
  check('range support advertised on a full response', whole?.status === 200 && whole.acceptRanges === 'bytes', `${whole?.status} ${whole?.acceptRanges}`)

  // App HTML gets an import map so the bare specifier resolves.
  const html = await evaluate("const r = await fetch('/workspace/dial-demo/index.html'); const t = await r.text(); return { status: r.status, importmap: t.includes('importmap'), mapped: t.includes('@planchette/sdk') }")
  check('import map injected into app HTML', html?.status === 200 && html.importmap && html.mapped)

  // Path traversal out of the workspace is refused.
  const escape = await evaluate("const r = await fetch('/workspace/dial-demo/../../../../etc/passwd'); return r.status")
  check('path traversal blocked', escape === 404, `status ${escape}`)

  // Workspace configuration lives in the settings dialog, which only appears in
  // the desktop build. The inspector is a debug panel and starts closed.
  const panel = await evaluate(`
    return {
      settingsDialogWired: Boolean(document.getElementById('settings')),
      workspacePath: document.getElementById('workspace-path').textContent,
      inspectorClosedByDefault: document.body.classList.contains('no-inspector'),
      // Both live in the menus now, so no toolbar button should remain.
      strayButtons: ['settings-open', 'inspector-toggle'].filter((id) => document.getElementById(id)),
    };
  `)
  check(
    'settings dialog knows its workspace',
    panel?.settingsDialogWired === true && Boolean(panel?.workspacePath),
    panel?.workspacePath,
  )
  check('inspector closed by default', panel?.inspectorClosedByDefault === true)
  check('no leftover toolbar buttons', Array.isArray(panel?.strayButtons) && panel.strayButtons.length === 0, JSON.stringify(panel?.strayButtons))

  // The simulator itself works end to end inside the shell.
  const sim = await evaluate(`
    sim.clear();
    const id = sim.addPuck({ markerId: 4, mmX: 500, mmY: 300, angleDeg: 90 });
    await new Promise(r => setTimeout(r, 250));
    const s = sim.state();
    return { pucks: s.pucks.length, mmX: s.pucks[0]?.mmX, angle: s.pucks[0]?.angle, apps: sim.apps };
  `)
  check('sim API drives the model', sim?.pucks === 1 && Math.round(sim.mmX) === 500, `mmX=${sim?.mmX?.toFixed(1)} angle=${sim?.angle?.toFixed(4)}`)
  check('sim.apps reflects the workspace', Array.isArray(sim?.apps) && sim.apps.includes('dial-demo'))

  const connected = await evaluate("return document.getElementById('appframe').getAttribute('src')")
  // endsWith, not equality: a relative-base build serves ./workspace/... and both
  // resolve to the same place.
  check(
    'interface iframe pointed at the workspace',
    String(connected).endsWith('workspace/dial-demo/index.html'),
    String(connected),
  )

  // The load-bearing check: the app imports the bare specifier '@planchette/sdk',
  // which only resolves if the injected import map worked. If it did, the app
  // handshook with the host and drew a dial for the puck placed above.
  const rendered = await evaluate(`
    const doc = document.getElementById('appframe').contentDocument;
    for (let i = 0; i < 40 && doc.querySelectorAll('.dial').length === 0; i++) {
      await new Promise(r => setTimeout(r, 100));
    }
    return { dials: doc.querySelectorAll('.dial').length, status: doc.getElementById('status')?.textContent ?? '' };
  `)
  check('app resolved @planchette/sdk and rendered', rendered?.dials === 1, `dials=${rendered?.dials}`)
  check('app received surface config', String(rendered?.status).includes('px/mm'), rendered?.status)

  // Editing a file in the workspace must reload the app iframe.
  await evaluate("document.getElementById('appframe').contentWindow.__smokeStamp = 1; return 1")
  const stampBefore = await evaluate("return document.getElementById('appframe').contentWindow.__smokeStamp ?? null")
  await fs.appendFile(path.join(workspace, 'dial-demo', 'main.js'), '\n// smoke edit\n')
  const reloaded = await evaluate(`
    for (let i = 0; i < 60; i++) {
      if (document.getElementById('appframe').contentWindow.__smokeStamp === undefined) return true;
      await new Promise(r => setTimeout(r, 100));
    }
    return false;
  `)
  check('file watcher reloads the app', stampBefore === 1 && reloaded === true)

  // The seeded workspace carries agent guidance, including a dotfile directory
  // that electron-builder's extraResources globbing could plausibly drop.
  const guidance = await fs.readdir(workspace)
  const skill = path.join(workspace, '.claude', 'skills', 'planchette-interface', 'SKILL.md')
  let skillExists = true
  try {
    await fs.stat(skill)
  } catch {
    skillExists = false
  }
  check('reference docs seeded', ['API.md', 'DESIGN-RULES.md', 'PROTOCOL.md', 'AGENTS.md'].every((f) => guidance.includes(f)))
  check('agent skill survives packaging', skillExists, '.claude/skills/planchette-interface/SKILL.md')

  // New interface scaffolding: the folder must describe itself, not the template.
  const created = await evaluate("return await window.planchette.createInterface('My Test Rig')")
  check('New interface slugs the name', created === 'my-test-rig', String(created))
  const scaffoldDoc = await fs.readFile(path.join(workspace, 'my-test-rig', 'CLAUDE.md'), 'utf8')
  const scaffoldHtml = await fs.readFile(path.join(workspace, 'my-test-rig', 'index.html'), 'utf8')
  check('scaffolded CLAUDE.md names the interface', scaffoldDoc.startsWith('# My test rig') && scaffoldDoc.includes('DESIGN-RULES.md'))
  check('scaffolded index.html is retitled', scaffoldHtml.includes('<title>My test rig</title>'))

  const wsList = await evaluate('return await window.planchette.listWorkspaces()')
  check('workspace list reports the current folder', wsList?.current === workspace && Array.isArray(wsList?.recent))

  // The menus are the only way to reach settings and the inspector, and the
  // template is platform branched, so a menu that is wrong on Windows makes the
  // app unusable there. Windows is tested by CI rather than by eye, so assert it.
  const menu = await evaluate('return await window.planchette.describeMenu()')
  const flat = []
  const walk = (items, trail) => {
    for (const item of items ?? []) {
      if (item.label) flat.push({ path: [...trail, item.label].join(' > '), label: item.label, accelerator: item.accelerator })
      if (item.submenu) walk(item.submenu, item.label ? [...trail, item.label] : trail)
    }
  }
  walk(menu, [])
  const find = (label) => flat.find((i) => i.label === label)

  check('menu built at all', Array.isArray(menu) && flat.length > 0, `${flat.length} labelled items`)
  for (const [label, accel] of [
    ['Settings…', 'CmdOrCtrl+,'],
    ['Toggle Inspector', 'CmdOrCtrl+I'],
    ['New Interface…', 'CmdOrCtrl+N'],
    ['Open Workspace Folder', 'CmdOrCtrl+Shift+O'],
  ]) {
    const item = find(label)
    check(`menu has ${label}`, Boolean(item) && item.accelerator === accel, item ? `${item.path}  ${item.accelerator}` : 'missing')
  }
  // Placement differs by platform, and getting it wrong is the likely mistake.
  const settings = find('Settings…')
  const expectedParent = process.platform === 'darwin' ? 'Planchette' : 'File'
  check(
    `Settings sits under ${expectedParent} on ${process.platform}`,
    String(settings?.path ?? '').startsWith(expectedParent),
    settings?.path,
  )

  // And the puck arrangement survives that reload, which is the whole point.
  const survived = await evaluate(`
    const doc = document.getElementById('appframe').contentDocument;
    for (let i = 0; i < 40 && doc.querySelectorAll('.dial').length === 0; i++) {
      await new Promise(r => setTimeout(r, 100));
    }
    return { pucks: sim.state().pucks.length, dials: doc.querySelectorAll('.dial').length };
  `)
  check('pucks survive the reload and the app rebuilds', survived?.pucks === 1 && survived?.dials === 1, JSON.stringify(survived))
} catch (err) {
  check('smoke run completed', false, String(err))
} finally {
  try {
    ws?.close()
  } catch {}
  electron.kill('SIGTERM')
  await sleep(400)
  electron.kill('SIGKILL')
  await fs.rm(workspace, { recursive: true, force: true })
  await fs.rm(userData, { recursive: true, force: true })
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  if (stderr.trim()) console.error(`\nelectron stderr:\n${stderr}`)
  process.exit(1)
}
