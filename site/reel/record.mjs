#!/usr/bin/env node
/**
 * Records the site's reel from the real simulator, frame by frame.
 *
 *   npm run build                      # the reel records whatever is in dist/
 *   node site/reel/record.mjs          # writes site/media/reel.mp4 and a poster
 *   node site/reel/record.mjs --stills # one still per scene per second, for framing
 *   node site/reel/record.mjs --scene radial-atlas
 *   node site/reel/record.mjs --shots  # screenshots of the whole app, from SHOTS
 *
 * Why not a screen recording: the interfaces run a requestAnimationFrame loop at
 * the table's full 3840x2160, and a laptop drops frames doing that while also
 * encoding video. Here the page's clock is replaced, and each video frame is one
 * exact step of it, so the result is smooth whatever the machine. Chrome's own
 * virtual time was tried first and hangs once screenshots are taken.
 *
 * The one thing the shim cannot slow down is CSS transitions, which run on the
 * real clock. The examples only use short fades, so they read slightly quicker.
 *
 * Designers' own interfaces can join the reel from site/reel/guests/<id>/, which
 * is not in git: their authors decide what is published as code. Riftfall and
 * air hockey came from a designers' testing day (Slack, 2026-11-19); without
 * them, those two scenes cannot be re-recorded and should be removed from scenes.mjs.
 *
 * Needs Google Chrome and ffmpeg. Scenes, and their choreography in millimetres
 * and degrees through window.sim, are in scenes.mjs.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCENES, SHOTS, FPS, WIDTH, HEIGHT } from './scenes.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const dist = path.join(root, 'dist')
const media = path.join(root, 'site', 'media')
const guests = path.join(here, 'guests')

const args = process.argv.slice(2)
const stills = args.includes('--stills')
const shots = args.includes('--shots')
const only = args.includes('--scene') ? args[args.indexOf('--scene') + 1] : null
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

/** A method's source ("frame(t, s) {...}") is not an expression; make it one. */
const source = (fn) => {
  const src = fn.toString()
  return /^(async\s+)?(function\b|\()/.test(src) ? src : `function ${src}`
}

/* ---------------- static server for dist/ and the title cards ---------------- */

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  // /cards/ serves this folder, /brand/ the repo's marks, everything else dist/.
  // Interfaces in guests/ (designers' work, not in git) are served as examples.
  let base = dist
  let rel = decodeURIComponent(url.pathname)
  const guest = rel.match(/^\/examples\/([^/]+)\//)
  if (guest && (await fs.stat(path.join(guests, guest[1])).catch(() => null))) {
    ;[base, rel] = [guests, rel.slice('/examples'.length)]
    // A raw interface imports bare specifiers; give it the same import map the
    // desktop app injects, pointing at dist's self-contained builds.
    if (rel.endsWith('/index.html')) {
      const file = path.join(base, path.normalize(rel))
      if (!file.startsWith(base)) return res.writeHead(403).end()
      const html = await fs.readFile(file, 'utf8').catch(() => null)
      if (html === null) return res.writeHead(404).end()
      const map = '<script type="importmap">{"imports":{"@planchette/sdk":"/sdk.js","three":"/three.js"}}</script>'
      return res.writeHead(200, { 'content-type': 'text/html' }).end(html.replace(/<head>/i, `<head>${map}`))
    }
  } else if (rel.startsWith('/cards/')) [base, rel] = [here, rel.slice('/cards'.length)]
  else if (rel.startsWith('/media/')) [base, rel] = [media, rel.slice('/media'.length)]
  else if (rel.startsWith('/brand/')) [base, rel] = [path.join(root, 'brand'), rel.slice('/brand'.length)]
  const file = path.join(base, path.normalize(rel))
  if (!file.startsWith(base)) return res.writeHead(403).end()
  try {
    const body = await fs.readFile(file)
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' }).end(body)
  } catch {
    res.writeHead(404).end()
  }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const ORIGIN = `http://127.0.0.1:${server.address().port}`

/* ---------------- the clock every frame of the page runs on ---------------- */

// Installed in every frame, the app iframe included. The top window drives its
// children, so host and interface always agree on the time.
const CLOCK = `(() => {
  const realRaf = window.requestAnimationFrame.bind(window)
  let now = 0
  let queue = new Map()
  let next = 1
  const base = Date.now()
  performance.now = () => now
  Date.now = () => base + now
  window.requestAnimationFrame = (cb) => { const id = next++; queue.set(id, cb); return id }
  window.cancelAnimationFrame = (id) => { queue.delete(id) }
  window.__step = (dt) => {
    now += dt
    const due = [...queue.values()]
    queue = new Map()
    for (const cb of due) { try { cb(now) } catch (e) { console.error(e) } }
    for (const f of document.querySelectorAll('iframe')) { try { f.contentWindow.__step?.(dt) } catch {} }
  }
  // Until the recorder takes over, run in real time so the page can load.
  if (window.top === window) {
    window.__frozen = false
    let last = 0
    const tick = (t) => { if (window.__frozen) return; window.__step(last ? t - last : 16); last = t; realRaf(tick) }
    realRaf(tick)
  }
})()`

/* ---------------- Chrome over CDP ---------------- */

const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'planchette-reel-'))
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    `--window-size=${WIDTH},${HEIGHT}`,
    '--hide-scrollbars',
    '--mute-audio',
    '--force-device-scale-factor=1',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
)
const wsUrl = await new Promise((resolve, reject) => {
  let buf = ''
  chrome.stderr.on('data', (d) => {
    buf += d
    const m = buf.match(/DevTools listening on (ws:\/\/\S+)/)
    if (m) resolve(m[1])
  })
  chrome.on('exit', () => reject(new Error('Chrome exited before DevTools came up')))
})
const port = new URL(wsUrl).port
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let seq = 0
const pending = new Map()
const listeners = new Set()
ws.onmessage = (m) => {
  const d = JSON.parse(m.data)
  if (d.id) pending.get(d.id)?.(d)
  else for (const l of listeners) l(d)
}
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, (d) => (d.error ? reject(new Error(`${method}: ${d.error.message}`)) : resolve(d.result)))
    ws.send(JSON.stringify({ id, method, params }))
  })
const once = (method) =>
  new Promise((r) => {
    const l = (d) => d.method === method && (listeners.delete(l), r(d))
    listeners.add(l)
  })
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await send('Page.enable')
await send('Runtime.enable')
listeners.add(
  (d) =>
    d.method === 'Runtime.exceptionThrown' &&
    console.error('  page error:', d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text),
)
await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false })
await send('Page.addScriptToEvaluateOnNewDocument', { source: CLOCK })
// Recording-only hooks a scene needs inside an interface, such as reading state
// the interface keeps private. Each one checks its own page before acting.
for (const s of SCENES)
  if (s.inject) await send('Page.addScriptToEvaluateOnNewDocument', { source: `(${source(s.inject)})()` })

/* ---------------- record ---------------- */

async function record(scene, dir) {
  const loaded = once('Page.loadEventFired')
  await send('Page.navigate', { url: ORIGIN + scene.url })
  await loaded
  // Real time until the interface has loaded its content and said hello.
  await sleep(scene.settleMs ?? 2500)
  // A guest interface is not in the build's list, so the host would fall back to
  // dial-demo. Point its frame at the guest directly; the handshake does not care.
  if (scene.guest) {
    await evaluate(`document.getElementById('appframe').src = './examples/${scene.guest}/index.html'`)
    await sleep(scene.guestSettleMs ?? 3000)
  }
  // The full app opens whatever it last showed; ?app= only applies to embeds.
  if (scene.app) {
    await evaluate(`sim.loadApp(${JSON.stringify(scene.app)})`)
    await sleep(2500)
  }
  await evaluate('window.__frozen = true')
  if (scene.setup) await evaluate(`(${source(scene.setup)})()`)
  // The inspector's state persists in the profile, so set it every time.
  if (scene.shot) await evaluate(`sim.showInspector(${Boolean(scene.inspector)})`)

  const frames = Math.round(scene.seconds * FPS)
  const every = stills ? FPS : 1
  let written = 0
  for (let i = 0; i < frames; i++) {
    const t = i / FPS
    if (scene.frame) await evaluate(`(${source(scene.frame)})(${t}, window.__reel ??= {})`)
    await evaluate(`window.__step(${1000 / FPS})`)
    // A shot is a scene played through and captured once, on its last frame.
    if (scene.shot) {
      if (i < frames - 1) continue
      await sleep(300) // let DOM-only panels like the inspector paint
      const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 88 })
      await fs.writeFile(path.join(dir, `${scene.id}.jpg`), Buffer.from(shot.data, 'base64'))
      return 1
    }
    if (i % every) continue
    const shot = await send('Page.captureScreenshot', { format: stills ? 'jpeg' : 'png', quality: 85 })
    const name = stills
      ? `${scene.id}-${String(t.toFixed(0)).padStart(2, '0')}s.jpg`
      : `${String(written).padStart(5, '0')}.png`
    await fs.writeFile(path.join(dir, name), Buffer.from(shot.data, 'base64'))
    written++
  }
  return written
}

const ffmpeg = (argv) =>
  new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-y', '-loglevel', 'error', ...argv], { stdio: 'inherit' })
    p.on('exit', (code) => (code ? reject(new Error(`ffmpeg exited ${code}`)) : resolve()))
  })

/** Joins clips with short crossfades into one web-sized mp4. */
const FADE = 0.5
async function join(clips, out) {
  const inputs = clips.flatMap((c) => ['-i', c.clip])
  let filter = ''
  let prev = '[0:v]'
  let offset = 0
  for (let i = 1; i < clips.length; i++) {
    offset += clips[i - 1].seconds - FADE
    const label = i === clips.length - 1 ? '[v]' : `[x${i}]`
    filter += `${prev}[${i}:v]xfade=transition=fade:duration=${FADE}:offset=${offset.toFixed(3)}${label};`
    prev = label
  }
  const map = clips.length > 1 ? ['-filter_complex', filter.slice(0, -1), '-map', '[v]'] : []
  await ffmpeg([
    ...inputs,
    ...map,
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-an',
    out,
  ])
}

const work = await fs.mkdtemp(path.join(os.tmpdir(), 'planchette-reel-frames-'))
try {
  if (shots) {
    // Screenshots of the whole app, toolbar and inspector included, at 2x for retina.
    await fs.mkdir(media, { recursive: true })
    for (const shot of SHOTS.filter((s) => !only || s.id === only)) {
      await send('Emulation.setDeviceMetricsOverride', {
        width: shot.width,
        height: shot.height,
        deviceScaleFactor: 2,
        mobile: false,
      })
      await record({ ...shot, shot: true }, media)
      console.log(`wrote site/media/${shot.id}.jpg`)
    }
  }
  const chosen = shots ? [] : SCENES.filter((s) => !only || s.id === only)
  if (shots) {
    // done above
  } else if (stills) {
    const out = path.join(media, 'stills')
    await fs.mkdir(out, { recursive: true })
    for (const scene of chosen) console.log(`${scene.id}: ${await record(scene, out)} stills`)
    console.log(`stills in ${out}`)
  } else {
    const clips = []
    for (const scene of chosen) {
      const dir = path.join(work, scene.id)
      await fs.mkdir(dir)
      const n = await record(scene, dir)
      const clip = path.join(work, `${scene.id}.mp4`)
      await ffmpeg([
        '-framerate',
        String(FPS),
        '-i',
        path.join(dir, '%05d.png'),
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-crf',
        '16',
        clip,
      ])
      clips.push({ clip, seconds: n / FPS, scene })
      // One still per demo, for the examples gallery on the page.
      if (scene.still !== undefined) {
        const frame = path.join(dir, `${String(Math.round(scene.still * FPS)).padStart(5, '0')}.png`)
        await ffmpeg(['-i', frame, '-vf', 'scale=1280:-1', '-q:v', '3', path.join(media, `${scene.id}.jpg`)])
      }
      console.log(`${scene.id}: ${n} frames`)
    }

    // Two cuts from the same clips. The reel has the title cards and is for sharing;
    // the loop is demos only and plays on the page, under a headline that already
    // says what the title card would.
    await fs.mkdir(media, { recursive: true })
    if (only) {
      await join(clips, path.join(media, `reel-${only}.mp4`))
    } else {
      await join(clips, path.join(media, 'reel.mp4'))
      const demos = clips.filter((c) => !c.scene.card)
      const loop = path.join(media, 'loop.mp4')
      await join(demos, loop)
      await ffmpeg([
        '-i',
        loop,
        '-c:v',
        'libvpx-vp9',
        '-b:v',
        '0',
        '-crf',
        '36',
        '-row-mt',
        '1',
        '-an',
        path.join(media, 'loop.webm'),
      ])
      // The poster is the first demo that names a posterAt, at that moment of the loop.
      let at = 1
      let elapsed = 0
      for (const c of demos) {
        if (c.scene.posterAt !== undefined) {
          at = elapsed + c.scene.posterAt
          break
        }
        elapsed += c.seconds - FADE
      }
      await ffmpeg([
        '-ss',
        at.toFixed(2),
        '-i',
        loop,
        '-frames:v',
        '1',
        '-q:v',
        '3',
        path.join(media, 'loop-poster.jpg'),
      ])
    }
    console.log(`wrote ${path.relative(root, media)}`)
  }
} finally {
  chrome.kill()
  server.close()
  await fs.rm(work, { recursive: true, force: true })
  await fs.rm(profile, { recursive: true, force: true }).catch(() => {})
}
