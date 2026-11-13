/**
 * A stand-in for a table's tracker: sends TUIO 1.1 over UDP, so the TUIO path can
 * be worked on and tested without the hardware.
 *
 *   node scripts/tuio-send.mjs                 # demo: two pucks and a finger, moving
 *   node scripts/tuio-send.mjs place 117       # one puck with tag 117, sitting still
 *   node scripts/tuio-send.mjs place 117 0.3 0.6 45
 *   node scripts/tuio-send.mjs flicker 117     # lost and refound every second, like a sleeve passing
 *   node scripts/tuio-send.mjs --port 3333 --host 127.0.0.1 demo
 *
 * Sends the way trackers do: a 2Dobj bundle and a 2Dcur bundle per frame, each
 * with source, alive, set for everything, and fseq. Ctrl+C stops it, and a
 * last empty frame is sent so nothing is left on the table.
 *
 * The app only listens once TUIO is switched on: Settings > Table input.
 *
 * Also imported by the smoke test, which drives it directly.
 */
import dgram from 'node:dgram'
import { pathToFileURL } from 'node:url'
import { encodeBundle, encodeMessage } from '../electron/osc.js'

const SOURCE = 'planchette-fake@localhost'

/**
 * @param {{ host?: string, port?: number }} opts
 * @returns {{ frame(objs: Array<{sid:number, tag:number, x:number, y:number, angle:number}>, curs?: Array<{sid:number, x:number, y:number}>, opts?: { sets?: boolean }): Promise<void>, close(): void }}
 */
export function createSender({ host = '127.0.0.1', port = 3333 } = {}) {
  const socket = dgram.createSocket('udp4')
  let fseq = 0

  const sendBuf = (buf) =>
    new Promise((resolve, reject) => socket.send(buf, port, host, (err) => (err ? reject(err) : resolve())))

  return {
    /** `sets: false` sends only alive and fseq: a tracker idling while nothing moves. */
    async frame(objs, curs = [], { sets = true } = {}) {
      fseq++
      const f = (n) => ({ f: n })
      await sendBuf(
        encodeBundle([
          encodeMessage('/tuio/2Dobj', ['source', SOURCE]),
          encodeMessage('/tuio/2Dobj', ['alive', ...objs.map((o) => o.sid)]),
          ...(sets ? objs : []).map((o) =>
            encodeMessage('/tuio/2Dobj', [
              'set',
              o.sid,
              o.tag,
              f(o.x),
              f(o.y),
              f(o.angle),
              f(0),
              f(0),
              f(0),
              f(0),
              f(0),
            ]),
          ),
          encodeMessage('/tuio/2Dobj', ['fseq', fseq]),
        ]),
      )
      await sendBuf(
        encodeBundle([
          encodeMessage('/tuio/2Dcur', ['source', SOURCE]),
          encodeMessage('/tuio/2Dcur', ['alive', ...curs.map((c) => c.sid)]),
          ...(sets ? curs : []).map((c) =>
            encodeMessage('/tuio/2Dcur', ['set', c.sid, f(c.x), f(c.y), f(0), f(0), f(0)]),
          ),
          encodeMessage('/tuio/2Dcur', ['fseq', fseq]),
        ]),
      )
    },
    close() {
      socket.close()
    },
  }
}

/* ------------------------------------------------------------------ *
 * Command line
 * ------------------------------------------------------------------ */

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const argv = process.argv.slice(2)
  const opt = (name, fallback) => {
    const i = argv.indexOf(`--${name}`)
    if (i === -1) return fallback
    const [, v] = argv.splice(i, 2)
    return v
  }
  const host = opt('host', '127.0.0.1')
  const port = Number(opt('port', 3333))
  const [scenario = 'demo', ...rest] = argv
  const nums = rest.map(Number)

  const sender = createSender({ host, port })
  const FPS = 30
  const t0 = Date.now()
  const rad = (deg) => (deg * Math.PI) / 180
  const TAU = Math.PI * 2

  const scenes = {
    demo: (t) => ({
      objs: [
        { sid: 1, tag: 117, x: 0.35 + 0.1 * Math.cos(t / 2), y: 0.5 + 0.15 * Math.sin(t / 2), angle: (t / 3) % TAU },
        { sid: 2, tag: 42, x: 0.7, y: 0.45, angle: rad(30) },
      ],
      curs: [{ sid: 3, x: 0.55 + 0.05 * Math.sin(t * 2), y: 0.7 }],
    }),
    place: () => ({
      objs: [{ sid: 1, tag: nums[0] ?? 117, x: nums[1] ?? 0.5, y: nums[2] ?? 0.5, angle: rad(nums[3] ?? 0) }],
      curs: [],
    }),
    flicker: (t) => ({
      // Half of every second gone, with a new session id each time it returns,
      // which is what a real re-acquisition looks like.
      objs: t % 1 < 0.5 ? [{ sid: 100 + Math.floor(t), tag: nums[0] ?? 117, x: 0.5, y: 0.5, angle: 0 }] : [],
      curs: [],
    }),
  }

  const scene = scenes[scenario]
  if (!scene) {
    console.error(`unknown scenario "${scenario}". Try: ${Object.keys(scenes).join(', ')}`)
    process.exit(1)
  }

  console.log(`sending "${scenario}" to ${host}:${port} at ${FPS} fps. Ctrl+C to stop.`)
  const timer = setInterval(() => {
    const { objs, curs } = scene((Date.now() - t0) / 1000)
    sender.frame(objs, curs).catch((err) => console.error(String(err)))
  }, 1000 / FPS)

  process.on('SIGINT', async () => {
    clearInterval(timer)
    await sender.frame([], []).catch(() => {})
    sender.close()
    process.exit(0)
  })
}
