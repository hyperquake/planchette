/**
 * Per-machine table configuration: `table.json` in the app's userData folder.
 *
 * Everything that is a fact about one physical table rather than about anyone's
 * interfaces lives here: whether to listen for TUIO, which printed tag is on
 * which puck, how the tracker's axes line up with the screen, and whether this
 * machine boots straight into present mode. It is deliberately not in the
 * workspace. A designer's laptop never has one, and the defaults below mean an
 * app without one behaves exactly as it always has.
 *
 * Versioned, so that a later shape can migrate an older file instead of
 * discarding a table's enrollment. `normalise` is the only way in: whatever is
 * on disk, or comes over IPC from the renderer, is passed through it.
 *
 * Free of Electron imports so it can be unit tested.
 */

import fs from 'node:fs'
import path from 'node:path'

export const TABLE_CONFIG_VERSION = 1

export function defaults() {
  return {
    version: TABLE_CONFIG_VERSION,
    /** Boot fullscreen with no authoring chrome, taking input from TUIO. */
    present: false,
    /** Index into the system's display list for present mode; null is the primary display. */
    display: null,
    /** A surface preset id from src/host/surface.ts; unknown ids fall back to the default there. */
    surface: 'table55-4k',
    tuio: {
      enabled: false,
      /** Loopback by default: no firewall prompt, and nothing on the network can inject input. */
      host: '127.0.0.1',
      port: 3333,
      /** Clear everything if the tracker goes silent this long. 0 disables. */
      staleMs: 2000,
    },
    calibration: { flipX: false, flipY: false, angleOffsetDeg: 0, angleReversed: false },
    /** Physical tag (TUIO class id) to the logical markerId interfaces see. Empty means pass tags through. */
    pucks: [],
    /** A tag reserved for the host: opens the interface picker, never reaches an interface. */
    control: { tag: null },
    /** What to do with a tag not in `pucks`, once any are mapped: 'ignore' or 'passthrough'. */
    unmapped: 'ignore',
  }
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

const isInt = (v) => Number.isInteger(v)
const bool = (v, d) => (typeof v === 'boolean' ? v : d)
const int = (v, d, min = -Infinity, max = Infinity) => (isInt(v) && v >= min && v <= max ? v : d)
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d)

/** Older shapes, upgraded in order. Each takes the previous version and returns the next. */
const MIGRATIONS = {
  // 0 -> 1: a file with no version is taken to be version 1 written by hand.
  0: (raw) => ({ ...raw, version: 1 }),
}

/**
 * Bring anything (a parsed file, an IPC payload, nothing at all) to a valid
 * current config. Bad fields fall back to defaults one by one, so a single typo
 * in a hand-edited file does not throw away the table's enrollment.
 */
export function normalise(input) {
  let raw = input && typeof input === 'object' ? { ...input } : {}
  let v = int(raw.version, 0, 0)
  if (v > TABLE_CONFIG_VERSION) {
    // Written by a newer app. Read what we understand, and say so.
    console.warn(`[planchette] table.json is version ${v}; this app understands ${TABLE_CONFIG_VERSION}`)
    v = TABLE_CONFIG_VERSION
  }
  while (v < TABLE_CONFIG_VERSION) {
    raw = MIGRATIONS[v](raw)
    v = raw.version
  }

  const d = defaults()
  const tuio = raw.tuio && typeof raw.tuio === 'object' ? raw.tuio : {}
  const cal = raw.calibration && typeof raw.calibration === 'object' ? raw.calibration : {}

  // Later entries lose to earlier ones on a clash, in both directions: one tag
  // cannot be two pucks, and two tags cannot both claim one markerId.
  const seenTags = new Set()
  const seenMarkers = new Set()
  const pucks = []
  for (const p of Array.isArray(raw.pucks) ? raw.pucks : []) {
    if (!p || !isInt(p.tag) || p.tag < 0 || !isInt(p.markerId) || p.markerId < 1) continue
    if (seenTags.has(p.tag) || seenMarkers.has(p.markerId)) continue
    seenTags.add(p.tag)
    seenMarkers.add(p.markerId)
    pucks.push({ markerId: p.markerId, tag: p.tag, label: typeof p.label === 'string' ? p.label.slice(0, 40) : '' })
  }
  pucks.sort((a, b) => a.markerId - b.markerId)

  let controlTag = raw.control && isInt(raw.control.tag) && raw.control.tag >= 0 ? raw.control.tag : null
  // The control puck must never also be an interface's puck.
  if (controlTag !== null && seenTags.has(controlTag)) controlTag = null

  return {
    version: TABLE_CONFIG_VERSION,
    present: bool(raw.present, d.present),
    display: raw.display === null ? null : int(raw.display, d.display, 0),
    surface: typeof raw.surface === 'string' && raw.surface ? raw.surface : d.surface,
    tuio: {
      enabled: bool(tuio.enabled, d.tuio.enabled),
      host: typeof tuio.host === 'string' && tuio.host ? tuio.host : d.tuio.host,
      port: int(tuio.port, d.tuio.port, 1, 65535),
      staleMs: int(tuio.staleMs, d.tuio.staleMs, 0, 600000),
    },
    calibration: {
      flipX: bool(cal.flipX, false),
      flipY: bool(cal.flipY, false),
      angleOffsetDeg: num(cal.angleOffsetDeg, 0) % 360,
      angleReversed: bool(cal.angleReversed, false),
    },
    pucks,
    control: { tag: controlTag },
    unmapped: raw.unmapped === 'passthrough' ? 'passthrough' : 'ignore',
  }
}

/* ------------------------------------------------------------------ *
 * Disk
 * ------------------------------------------------------------------ */

/** Synchronous on purpose: present mode has to be known before the app is ready. */
export function readTableConfig(file) {
  try {
    return normalise(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      // Most likely a typo in a hand edit. Keep the file: the next save from the
      // UI would otherwise overwrite a table's whole enrollment with defaults.
      const kept = `${file}.broken`
      try {
        fs.copyFileSync(file, kept)
      } catch {
        /* unreadable too; nothing to keep */
      }
      console.error(`[planchette] could not read ${file}; using defaults. A copy is at ${kept}`, err)
    }
    return defaults()
  }
}

export function writeTableConfig(file, config) {
  const clean = normalise(config)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(clean, null, 2) + '\n')
  fs.renameSync(tmp, file)
  return clean
}
