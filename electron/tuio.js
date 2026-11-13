/**
 * TUIO 1.1 input for a real table.
 *
 * A tracker (MultiTaction's MTServer, reacTIVision, a TUIO simulator) sends OSC
 * over UDP. Browsers cannot receive UDP, so this runs in the main process and
 * hands the renderer finished frames, already in the vocabulary of the table
 * model: pucks with logical marker ids, normalized positions with y down, angles
 * in radians, 0 up, clockwise positive.
 *
 * Two layers:
 *  - `TuioTracker` is pure: TUIO messages in, frame diffs out. Mapping a printed
 *    tag to the markerId interfaces know, calibration, and the control puck all
 *    happen here, so the renderer never sees a raw tag it would have to ignore.
 *  - `createTuioListener` owns the socket, the stale-tracker watchdog, and status.
 *
 * Only the 2Dobj (pucks) and 2Dcur (fingers) profiles are read. 2Dblb, which
 * would give finger size, and TUIO 2.0 are not yet.
 */

import dgram from 'node:dgram'
import { decodePacket } from './osc.js'

const TAU = Math.PI * 2
const wrap = (a) => ((a % TAU) + TAU) % TAU
const clamp01 = (v) => Math.min(1, Math.max(0, v))

/** How long an unmapped tag stays in the status list after it was last seen. */
const UNKNOWN_TTL_MS = 10_000

/* ------------------------------------------------------------------ *
 * Tracker: messages to frames
 * ------------------------------------------------------------------ */

const PROFILES = { '/tuio/2Dobj': 'obj', '/tuio/2Dcur': 'cur' }

function emptyFrame() {
  return {
    pucks: { added: [], moved: [], removed: [] },
    touches: { added: [], moved: [], removed: [] },
  }
}

const frameIsEmpty = (f) =>
  !f.pucks.added.length &&
  !f.pucks.moved.length &&
  !f.pucks.removed.length &&
  !f.touches.added.length &&
  !f.touches.moved.length &&
  !f.touches.removed.length

/** TUIO's late-frame rule: newer, explicitly unordered (-1), or far enough back that the tracker restarted. */
function acceptFseq(last, f) {
  return last === null || f === -1 || f > last || last - f > 100
}

export class TuioTracker {
  /**
   * @param {object} config a normalised table config
   * @param {{ frame(f: object): void, control(e: object): void }} out
   */
  constructor(config, out) {
    this.out = out
    /** `${source}|${profile}` -> { lastFseq, pending, live: Map<sid, rec> } */
    this.streams = new Map()
    /** tag -> last seen, for tags with no mapping */
    this.unknown = new Map()
    this.setConfig(config)
  }

  /**
   * New mapping or calibration. Everything on the surface is withdrawn and
   * re-announced under the new meaning, from the raw data already held: trackers
   * usually send `set` only for objects that moved, so waiting for fresh data
   * would leave a puck that is sitting still invisible until someone touched it.
   */
  setConfig(config) {
    const frame = emptyFrame()
    for (const stream of this.streams?.values() ?? []) {
      for (const rec of stream.live.values()) this.retire(rec, frame)
    }

    this.cal = config.calibration
    this.controlTag = config.control.tag
    this.byTag = new Map(config.pucks.map((p) => [p.tag, p.markerId]))
    // Nothing enrolled yet: show raw tags, so a table that has never been set up
    // still does something. Once anything is enrolled, the setting decides.
    this.passthrough = config.pucks.length === 0 || config.unmapped === 'passthrough'
    this.unknown?.clear()

    for (const stream of this.streams?.values() ?? []) {
      for (const [sid, rec] of stream.live) {
        const next = this.place(stream, rec.raw, undefined)
        stream.live.set(sid, next)
        this.announce(next, undefined, frame)
      }
    }
    if (this.out && !frameIsEmpty(frame)) this.out.frame(frame)
  }

  /**
   * Everything on the surface as if it had just arrived. For a renderer that
   * reloaded and lost its model while the pucks stayed put.
   */
  snapshot() {
    const frame = emptyFrame()
    const controls = []
    for (const stream of this.streams.values()) {
      for (const rec of stream.live.values()) {
        if (rec.role === 'control') controls.push({ type: 'add', key: rec.key, x: rec.x, y: rec.y, angle: rec.angle })
        else this.announce(rec, undefined, frame)
      }
    }
    return { frame, controls }
  }

  /** Everything currently on the surface leaves, and the tracker is forgotten. Used on silence and shutdown. */
  reset() {
    const frame = emptyFrame()
    for (const stream of this.streams.values()) {
      for (const rec of stream.live.values()) this.retire(rec, frame)
    }
    this.streams.clear()
    if (!frameIsEmpty(frame)) this.out.frame(frame)
  }

  hasContacts() {
    for (const s of this.streams.values()) if (s.live.size) return true
    return false
  }

  /** Raw tags on the surface right now, with what each one means. For status and enrollment. */
  tagsPresent() {
    const out = []
    for (const s of this.streams.values()) {
      for (const rec of s.live.values()) {
        if (rec.kind !== 'obj') continue
        out.push({ tag: rec.tag, markerId: rec.markerId ?? null, control: rec.role === 'control' })
      }
    }
    return out.sort((a, b) => a.tag - b.tag)
  }

  unknownTags(now = Date.now()) {
    for (const [tag, at] of this.unknown) if (now - at > UNKNOWN_TTL_MS) this.unknown.delete(tag)
    return [...this.unknown.keys()].sort((a, b) => a - b)
  }

  /** Feed one decoded packet. `origin` distinguishes trackers sending from different addresses. */
  handlePacket(messages, origin = '') {
    // A TUIO 1.1 `source` message names the tracker for the rest of its bundle.
    let source = origin
    for (const m of messages) {
      const profile = PROFILES[m.address]
      if (!profile) continue
      const [cmd, ...args] = m.args
      if (cmd === 'source') {
        source = `${origin}|${args[0]}`
        continue
      }
      const key = `${source}|${profile}`
      let stream = this.streams.get(key)
      if (!stream) {
        stream = { key, profile, lastFseq: null, pending: { alive: null, sets: new Map() }, live: new Map() }
        this.streams.set(key, stream)
      }
      if (cmd === 'alive') {
        stream.pending.alive = new Set(args.filter(Number.isInteger))
      } else if (cmd === 'set') {
        const rec = profile === 'obj' ? parseObj(args) : parseCur(args)
        if (rec) stream.pending.sets.set(rec.sid, rec)
      } else if (cmd === 'fseq') {
        const f = args[0]
        if (Number.isInteger(f) && acceptFseq(stream.lastFseq, f)) {
          if (f !== -1) stream.lastFseq = f
          this.commit(stream)
        }
        stream.pending = { alive: null, sets: new Map() }
      }
    }
  }

  commit(stream) {
    const { alive, sets } = stream.pending
    // A frame with set messages but no alive list cannot say what left. TUIO
    // always sends alive, so this is a malformed or partial bundle: skip it.
    if (!alive) return
    const frame = emptyFrame()

    for (const [sid, rec] of stream.live) {
      if (!alive.has(sid)) {
        stream.live.delete(sid)
        this.retire(rec, frame)
      }
    }

    for (const sid of alive) {
      const raw = sets.get(sid)
      const prev = stream.live.get(sid)
      if (!raw && !prev) continue // alive before its first set: wait for the data
      if (!raw) continue // alive and unchanged
      const rec = this.place(stream, raw, prev)
      stream.live.set(sid, rec)
      this.announce(rec, prev, frame)
    }

    if (!frameIsEmpty(frame)) this.out.frame(frame)
  }

  /** Apply calibration and mapping to raw tracker values. */
  place(stream, raw, prev) {
    const c = this.cal
    const x = clamp01(c.flipX ? 1 - raw.x : raw.x)
    const y = clamp01(c.flipY ? 1 - raw.y : raw.y)
    const rec = { kind: stream.profile, key: `${stream.key}|${raw.sid}`, x, y, raw }
    if (stream.profile === 'cur') return rec

    const a = (c.angleReversed ? -raw.a : raw.a) + (c.angleOffsetDeg * Math.PI) / 180
    rec.angle = wrap(a)
    rec.tag = raw.tag
    // A session keeps its role for life: TUIO never changes a session's tag.
    const role = prev ?? this.classify(raw.tag)
    rec.role = role.role
    rec.markerId = role.markerId
    if (raw.tag !== this.controlTag && !this.byTag.has(raw.tag)) this.unknown.set(raw.tag, Date.now())
    return rec
  }

  classify(tag) {
    if (tag === this.controlTag) return { role: 'control', markerId: undefined }
    if (this.byTag.has(tag)) return { role: 'puck', markerId: this.byTag.get(tag) }
    if (this.passthrough) return { role: 'puck', markerId: tag }
    return { role: 'ignored', markerId: undefined }
  }

  announce(rec, prev, frame) {
    if (rec.kind === 'cur') {
      const t = { key: rec.key, x: rec.x, y: rec.y }
      ;(prev ? frame.touches.moved : frame.touches.added).push(t)
      return
    }
    if (rec.role === 'ignored') return
    if (rec.role === 'control') {
      this.out.control({ type: prev ? 'move' : 'add', key: rec.key, x: rec.x, y: rec.y, angle: rec.angle })
      return
    }
    const p = { key: rec.key, markerId: rec.markerId, tag: rec.tag, x: rec.x, y: rec.y, angle: rec.angle }
    ;(prev ? frame.pucks.moved : frame.pucks.added).push(p)
  }

  retire(rec, frame) {
    if (rec.kind === 'cur') frame.touches.removed.push(rec.key)
    else if (rec.role === 'control') this.out.control({ type: 'remove', key: rec.key })
    else if (rec.role === 'puck') frame.pucks.removed.push(rec.key)
  }
}

/** `/tuio/2Dobj set s i x y a X Y A m r` */
function parseObj(args) {
  const [sid, tag, x, y, a] = args
  if (!Number.isInteger(sid) || !Number.isInteger(tag)) return null
  if (![x, y, a].every((v) => typeof v === 'number' && Number.isFinite(v))) return null
  return { sid, tag, x, y, a }
}

/** `/tuio/2Dcur set s x y X Y m` */
function parseCur(args) {
  const [sid, x, y] = args
  if (!Number.isInteger(sid)) return null
  if (![x, y].every((v) => typeof v === 'number' && Number.isFinite(v))) return null
  return { sid, x, y }
}

/* ------------------------------------------------------------------ *
 * Listener: socket, watchdog, status
 * ------------------------------------------------------------------ */

/**
 * @param {{ frame(f): void, control(e): void, status(s): void }} out
 * @returns {{ configure(config): void, close(): void, status(): object }}
 */
export function createTuioListener(out) {
  let config = null
  let socket = null
  let bound = null // `${host}:${port}` while listening
  let state = { state: 'off', host: null, port: null, error: null }
  let lastPacket = 0
  let packets = 0
  let rate = 0
  let badPackets = 0
  let lastStatusJson = ''

  const tracker = new TuioTracker(
    // Placeholder until configure() runs; nothing arrives before then anyway.
    {
      calibration: { flipX: false, flipY: false, angleOffsetDeg: 0, angleReversed: false },
      control: { tag: null },
      pucks: [],
      unmapped: 'ignore',
    },
    { frame: (f) => out.frame(f), control: (e) => out.control(e) },
  )

  function status() {
    return {
      ...state,
      packetsPerSec: rate,
      badPackets,
      lastPacketAgoMs: lastPacket ? Date.now() - lastPacket : null,
      tags: tracker.tagsPresent(),
      unknownTags: tracker.unknownTags(),
    }
  }

  /** Only when something a person would notice changed; the packet age always changes. */
  function publish(force = false) {
    const s = status()
    const { lastPacketAgoMs: _age, ...stable } = s
    const json = JSON.stringify(stable)
    if (force || json !== lastStatusJson) {
      lastStatusJson = json
      out.status(s)
    }
  }

  function closeSocket() {
    if (!socket) return
    try {
      socket.close()
    } catch {
      /* already closed */
    }
    socket = null
    bound = null
  }

  function open(host, port) {
    closeSocket()
    state = { state: 'starting', host, port, error: null }
    const s = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    socket = s
    s.on('message', (buf, rinfo) => {
      lastPacket = Date.now()
      packets++
      try {
        tracker.handlePacket(decodePacket(buf), `${rinfo.address}:${rinfo.port}`)
      } catch {
        // One bad packet must not take the table down. Counted, so it shows.
        badPackets++
      }
    })
    s.on('error', (err) => {
      if (socket !== s) return
      state = {
        state: 'error',
        host,
        port,
        error: err.code === 'EADDRINUSE' ? `port ${port} is already in use` : String(err.message || err),
      }
      closeSocket()
      tracker.reset()
      publish(true)
    })
    s.bind(port, host, () => {
      if (socket !== s) return
      bound = `${host}:${port}`
      state = { state: 'listening', host, port, error: null }
      publish(true)
    })
  }

  // Once a second: packet rate, stale-tracker watchdog, and status if it changed.
  const timer = setInterval(() => {
    rate = packets
    packets = 0
    const stale = config?.tuio.staleMs
    if (stale && tracker.hasContacts() && Date.now() - lastPacket > stale) tracker.reset()
    publish()
  }, 1000)
  timer.unref?.()

  /** The parts of the config that change what a tag means. A change re-reads everything on the surface. */
  const meaning = (c) => JSON.stringify([c.pucks, c.control, c.unmapped, c.calibration])

  return {
    configure(next) {
      const prev = config
      config = next
      if (!prev || meaning(prev) !== meaning(next)) tracker.setConfig(next)

      if (!next.tuio.enabled) {
        if (socket || state.state !== 'off') {
          closeSocket()
          tracker.reset()
          state = { state: 'off', host: null, port: null, error: null }
          publish(true)
        }
        return
      }
      const want = `${next.tuio.host}:${next.tuio.port}`
      if (bound !== want || state.state === 'error' || !socket) open(next.tuio.host, next.tuio.port)
      else publish(true)
    },
    close() {
      clearInterval(timer)
      closeSocket()
      tracker.reset()
    },
    snapshot: () => tracker.snapshot(),
    status,
  }
}
