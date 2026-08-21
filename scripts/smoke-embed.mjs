/**
 * Smoke test for the embeddable web build.
 *
 * The embed is a shipped artifact whose only verification was previously someone
 * driving it by hand, which is exactly the kind of thing that rots quietly. This
 * builds it the way a release does, serves it from a subpath so the relative base
 * is exercised rather than assumed, frames it in an iframe the way a real page
 * would, and drives it over the Chrome DevTools Protocol.
 *
 *   node scripts/smoke-embed.mjs
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { build } from 'vite'

const PORT = 9555
/** Mounted under a subpath on purpose: a root-only build would pass at "/". */
const MOUNT = '/planchette/embed'
const ZOOM = 0.62
const PX_PER_MM = 3.1527

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `  ${detail}` : ''}`)
}

/* ---------------- build the artifact the way a release does ---------------- */

process.env.PLANCHETTE_BASE = './'
for (const configFile of ['vite.config.ts', 'vite.sdk.config.ts', 'vite.vendor.config.ts']) {
  await build({ configFile, logLevel: 'error' })
}

const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'planchette-embed-'))
await fs.cp('dist', path.join(stage, 'planchette', 'embed'), { recursive: true })

// A page that frames the embed, which is the arrangement production uses: the
// page frames the host, and the host frames the interface.
const frameUrl = (query) => `${MOUNT}/index.html?${query}`
await fs.writeFile(
  path.join(stage, 'page.html'),
  `<!doctype html><meta charset="utf-8"><title>harness</title>
<style>html,body{margin:0}#sim{width:1080px;height:560px;border:0;display:block}</style>
<iframe id="sim" src="${frameUrl('embed=1&app=radial-atlas&zoom=' + ZOOM + '&center=0.42,0.5')}"></iframe>`,
)

/* ---------------- serve it ---------------- */

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
}

const server = createServer(async (req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  const file = path.join(stage, rel === '/' ? 'page.html' : rel)
  if (!path.resolve(file).startsWith(path.resolve(stage))) {
    res.writeHead(403).end('no')
    return
  }
  try {
    const body = await fs.readFile(file)
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`

/* ---------------- the static build serves from a subpath ---------------- */

for (const [label, urlPath] of [
  ['host page', `${MOUNT}/index.html`],
  ['example page', `${MOUNT}/examples/radial-atlas/index.html`],
  // The regression guard for the asset-copy plugin: this file is fetched at
  // runtime, so a bundler-only build ships the page without it.
  ['example content', `${MOUNT}/examples/radial-atlas/content/content.json`],
  ['a plate image', `${MOUNT}/examples/radial-atlas/content/images/structure-1.svg`],
  ['favicon', `${MOUNT}/favicon.svg`],
]) {
  const res = await fetch(origin + urlPath)
  check(`${label} served from a subpath`, res.status === 200, `${res.status}`)
}

/* ---------------- drive it ---------------- */

const electron = spawn(
  createRequire(import.meta.url)('electron'),
  ['scripts/embed-browser.cjs', `${origin}/page.html`, `--remote-debugging-port=${PORT}`],
  { stdio: ['ignore', 'pipe', 'pipe'] },
)
let stderr = ''
electron.stderr.on('data', (d) => (stderr += d))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let ws
let nextId = 1
const pending = new Map()

async function cdp(method, params = {}) {
  const id = nextId++
  return new Promise((resolve) => {
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const res = await cdp('Runtime.evaluate', {
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true,
    returnByValue: true,
  })
  if (res.result?.exceptionDetails) {
    throw new Error(res.result.exceptionDetails.exception?.description ?? 'evaluate threw')
  }
  return res.result?.result?.value
}

/** Point the window at a different embed url and wait for the frame to settle. */
async function load(query) {
  await evaluate(`document.getElementById('sim').src = ${JSON.stringify(frameUrl(query))}; return 1`)
  for (let i = 0; i < 60; i++) {
    const ready = await evaluate(
      "const w = document.getElementById('sim').contentWindow; return Boolean(w && w.sim && w.document.readyState === 'complete')",
    )
    if (ready) break
    await sleep(200)
  }
  await sleep(600)
}

try {
  let page
  for (let i = 0; i < 60 && !page; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())
      page = list.find((t) => t.type === 'page' && String(t.url).includes('/page.html'))
    } catch {
      /* not listening yet */
    }
    if (!page) await sleep(500)
  }
  if (!page) throw new Error(`no renderer appeared\n${stderr}`)

  await new Promise((resolve, reject) => {
    ws = new WebSocket(page.webSocketDebuggerUrl)
    ws.addEventListener('open', resolve)
    ws.addEventListener('error', reject)
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data)
      pending.get(m.id)?.(m)
      pending.delete(m.id)
    })
  })
  await cdp('Runtime.enable')
  await cdp('Page.enable')
  await sleep(1500)

  /* ---- chrome, storage, and the seeded puck ---- */

  const state = await evaluate(`
    const w = document.getElementById('sim').contentWindow;
    const d = w.document;
    const surface = d.getElementById('surface');
    return {
      embedClass: d.body.classList.contains('embed'),
      topbar: getComputedStyle(d.getElementById('topbar')).display,
      inspector: getComputedStyle(d.getElementById('inspector')).display,
      // The inspector is never constructed in embed mode, so its table stays
      // empty even though a puck is on the surface.
      puckRows: d.getElementById('puck-rows').innerHTML.length,
      prefs: w.localStorage.getItem('planchette/prefs'),
      table: w.sessionStorage.getItem('planchette/table'),
      pucks: w.sim.state().pucks.length,
      transform: getComputedStyle(surface).transform,
      sizerPosition: getComputedStyle(d.getElementById('sizer')).position,
      stageOverflow: getComputedStyle(d.getElementById('stage')).overflow,
      appSrc: d.getElementById('appframe').getAttribute('src'),
    };
  `)

  check('embed class applied', state?.embedClass === true)
  check('authoring chrome hidden', state?.topbar === 'none' && state?.inspector === 'none')
  check('inspector never constructed', state?.puckRows === 0, `puck-rows length ${state?.puckRows}`)
  check('browser storage untouched', state?.prefs === null && state?.table === null)
  check('one puck seeded', state?.pucks === 1, `${state?.pucks}`)
  check('requested app loaded', String(state?.appSrc).includes('radial-atlas'), String(state?.appSrc))

  const scale = Number(String(state?.transform).match(/matrix\(([\d.]+)/)?.[1] ?? 0)
  check('crop zoom applied', Math.abs(scale - ZOOM) < 0.005, `scale ${scale}`)
  check('cropped embed is positioned, not scrolled', state?.sizerPosition === 'absolute' && state?.stageOverflow === 'hidden')

  /* ---- the interface actually rendered, content and all ---- */

  const rendered = await evaluate(`
    const d = document.getElementById('sim').contentWindow.document;
    const inner = d.getElementById('appframe').contentDocument;
    for (let i = 0; i < 50 && !inner.querySelector('.cell'); i++) await new Promise(r => setTimeout(r, 100));
    return {
      menus: inner.querySelectorAll('.menu').length,
      cells: inner.querySelectorAll('.cell').length,
      status: inner.getElementById('status')?.textContent ?? '',
    };
  `)
  check('interface rendered in the frame', rendered?.menus === 1 && rendered?.cells > 0, `${rendered?.cells} cells`)
  // Proves the runtime fetch of content.json succeeded, which is the whole point
  // of copying example folders into the build.
  check('runtime content loaded', String(rendered?.status).includes('18 plates'), String(rendered?.status).trim())

  /* ---- a real drag, through page, iframe and cropped surface ---- */

  const before = await evaluate(`
    const frame = document.getElementById('sim');
    const w = frame.contentWindow;
    const el = w.document.querySelector('[data-puck-id]');
    const r = el.getBoundingClientRect();
    const fr = frame.getBoundingClientRect();
    const p = w.sim.state().pucks[0];
    return { x: fr.x + r.x + r.width / 2, y: fr.y + r.y + r.height / 2, mmX: p.mmX, mmY: p.mmY };
  `)

  const dx = 150
  const dy = -90
  const STEPS = 5

  // Step it like a real drag. Two coarse jumps are not a faithful pointer stream
  // and gave a wrong answer here while the app itself was tracking exactly.
  const moves = [
    ['mousePressed', 0],
    ...Array.from({ length: STEPS }, (_, i) => ['mouseMoved', (i + 1) / STEPS]),
    ['mouseReleased', 1],
  ]
  for (const [type, t] of moves) {
    await cdp('Input.dispatchMouseEvent', {
      type,
      x: before.x + dx * t,
      y: before.y + dy * t,
      button: 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: 1,
    })
    await sleep(120)
  }

  const after = await evaluate(
    "const p = document.getElementById('sim').contentWindow.sim.state().pucks[0]; return { mmX: p.mmX, mmY: p.mmY }",
  )
  const expected = { dx: dx / ZOOM / PX_PER_MM, dy: dy / ZOOM / PX_PER_MM }
  const moved = { dx: after.mmX - before.mmX, dy: after.mmY - before.mmY }
  const accurate = Math.abs(moved.dx - expected.dx) < 1.5 && Math.abs(moved.dy - expected.dy) < 1.5
  check(
    'mouse drag moves the puck the right distance',
    accurate,
    `moved ${moved.dx.toFixed(1)},${moved.dy.toFixed(1)}mm expected ${expected.dx.toFixed(1)},${expected.dy.toFixed(1)}mm`,
  )

  /* ---- the other parameters ---- */

  await load('embed=1&app=dial-demo')
  const other = await evaluate(
    "const d = document.getElementById('sim').contentWindow.document; return d.getElementById('appframe').getAttribute('src')",
  )
  check('app parameter selects a different interface', String(other).includes('dial-demo'), String(other))

  await load('embed=1&app=radial-atlas&puck=none')
  const empty = await evaluate("return document.getElementById('sim').contentWindow.sim.state().pucks.length")
  check('puck=none starts with an empty surface', empty === 0, `${empty} pucks`)

  await load('embed=1&app=radial-atlas')
  const fit = await evaluate(`
    const d = document.getElementById('sim').contentWindow.document;
    return getComputedStyle(d.getElementById('surface')).transform;
  `)
  const fitScale = Number(String(fit).match(/matrix\(([\d.]+)/)?.[1] ?? 0)
  check('default zoom fits the surface to the frame', fitScale > 0 && fitScale < ZOOM, `scale ${fitScale.toFixed(3)}`)
} catch (err) {
  check('embed smoke run completed', false, String(err))
} finally {
  try {
    ws?.close()
  } catch {
    /* already gone */
  }
  electron.kill('SIGTERM')
  await sleep(400)
  electron.kill('SIGKILL')
  server.close()
  await fs.rm(stage, { recursive: true, force: true })
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  if (stderr.trim()) console.error(`\nelectron stderr:\n${stderr}`)
  process.exit(1)
}
