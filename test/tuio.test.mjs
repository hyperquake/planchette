import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodePacket, encodeBundle, encodeMessage } from '../electron/osc.js'
import { defaults, normalise } from '../electron/table-config.js'
import { TuioTracker } from '../electron/tuio.js'

/* ---------------- OSC ---------------- */

test('OSC round trip: a bundle of mixed messages', () => {
  const buf = encodeBundle([
    encodeMessage('/tuio/2Dobj', ['source', 'tracker@host']),
    encodeMessage('/tuio/2Dobj', ['set', 7, 117, { f: 0.25 }, { f: 0.5 }, { f: 1.5 }]),
    encodeMessage('/tuio/2Dobj', ['fseq', 42]),
  ])
  const msgs = decodePacket(buf)
  assert.equal(msgs.length, 3)
  assert.deepEqual(msgs[0], { address: '/tuio/2Dobj', args: ['source', 'tracker@host'] })
  assert.equal(msgs[1].args[1], 7)
  assert.equal(msgs[1].args[2], 117)
  assert.ok(Math.abs(msgs[1].args[5] - 1.5) < 1e-6)
  assert.deepEqual(msgs[2].args, ['fseq', 42])
})

test('OSC: nested bundles flatten in order', () => {
  const inner = encodeBundle([encodeMessage('/b', [2])])
  const outer = encodeBundle([encodeMessage('/a', [1]), inner, encodeMessage('/c', [3])])
  assert.deepEqual(
    decodePacket(outer).map((m) => m.address),
    ['/a', '/b', '/c'],
  )
})

test('OSC: a truncated packet throws instead of reading garbage', () => {
  const buf = encodeMessage('/tuio/2Dobj', ['set', 1, 2, { f: 0.1 }])
  assert.throws(() => decodePacket(buf.subarray(0, buf.length - 2)))
})

/* ---------------- TUIO tracker ---------------- */

/** Build a 2Dobj frame the way a tracker sends it. */
function objFrame(fseq, alive, sets = []) {
  return [
    { address: '/tuio/2Dobj', args: ['alive', ...alive] },
    ...sets.map(([sid, tag, x, y, a]) => ({ address: '/tuio/2Dobj', args: ['set', sid, tag, x, y, a, 0, 0, 0, 0, 0] })),
    { address: '/tuio/2Dobj', args: ['fseq', fseq] },
  ]
}

function curFrame(fseq, alive, sets = []) {
  return [
    { address: '/tuio/2Dcur', args: ['alive', ...alive] },
    ...sets.map(([sid, x, y]) => ({ address: '/tuio/2Dcur', args: ['set', sid, x, y, 0, 0, 0] })),
    { address: '/tuio/2Dcur', args: ['fseq', fseq] },
  ]
}

function harness(config = {}) {
  const frames = []
  const controls = []
  const t = new TuioTracker(normalise({ ...defaults(), ...config }), {
    frame: (fr) => frames.push(fr),
    control: (e) => controls.push(e),
  })
  return { t, frames, controls }
}

const MAPPED = {
  pucks: [
    { markerId: 1, tag: 117 },
    { markerId: 2, tag: 42 },
  ],
  control: { tag: 900 },
}

test('a mapped tag arrives as its logical markerId', () => {
  const { t, frames } = harness(MAPPED)
  t.handlePacket(objFrame(1, [5], [[5, 117, 0.25, 0.5, 1]]))
  assert.equal(frames.length, 1)
  const [p] = frames[0].pucks.added
  assert.equal(p.markerId, 1)
  assert.equal(p.tag, 117)
  assert.equal(p.x, 0.25)
  assert.equal(p.y, 0.5)
})

test('move, then removal when the session leaves the alive list', () => {
  const { t, frames } = harness(MAPPED)
  t.handlePacket(objFrame(1, [5], [[5, 117, 0.25, 0.5, 1]]))
  t.handlePacket(objFrame(2, [5], [[5, 117, 0.3, 0.5, 1]]))
  t.handlePacket(objFrame(3, []))
  assert.equal(frames[1].pucks.moved[0].x, 0.3)
  assert.deepEqual(frames[2].pucks.removed, [frames[0].pucks.added[0].key])
})

test('an alive puck with no new set is unchanged, not removed', () => {
  const { t, frames } = harness(MAPPED)
  t.handlePacket(objFrame(1, [5], [[5, 117, 0.25, 0.5, 1]]))
  t.handlePacket(objFrame(2, [5]))
  assert.equal(frames.length, 1)
})

test('an unmapped tag is ignored once anything is enrolled, and reported', () => {
  const { t, frames } = harness(MAPPED)
  t.handlePacket(objFrame(1, [9], [[9, 333, 0.5, 0.5, 0]]))
  assert.equal(frames.length, 0)
  assert.deepEqual(t.unknownTags(), [333])
  assert.deepEqual(t.tagsPresent(), [{ tag: 333, markerId: null, control: false }])
})

test('with nothing enrolled, raw tags pass through so a fresh table still works', () => {
  const { t, frames } = harness()
  t.handlePacket(objFrame(1, [9], [[9, 333, 0.5, 0.5, 0]]))
  assert.equal(frames[0].pucks.added[0].markerId, 333)
})

test('the control puck goes to the host, never into a frame', () => {
  const { t, frames, controls } = harness(MAPPED)
  t.handlePacket(objFrame(1, [3], [[3, 900, 0.5, 0.5, 0]]))
  t.handlePacket(objFrame(2, [3], [[3, 900, 0.5, 0.5, 1]]))
  t.handlePacket(objFrame(3, []))
  assert.equal(frames.length, 0)
  assert.deepEqual(
    controls.map((c) => c.type),
    ['add', 'move', 'remove'],
  )
})

test('late frames are dropped, -1 is always accepted, a big jump back means a restart', () => {
  const { t, frames } = harness(MAPPED)
  t.handlePacket(objFrame(10, [5], [[5, 117, 0.1, 0.1, 0]]))
  t.handlePacket(objFrame(9, [5], [[5, 117, 0.9, 0.9, 0]])) // late
  assert.equal(frames.length, 1)
  t.handlePacket(objFrame(-1, [5], [[5, 117, 0.2, 0.2, 0]]))
  assert.equal(frames[1].pucks.moved[0].x, 0.2)
  t.handlePacket(objFrame(500, [5], [[5, 117, 0.3, 0.3, 0]]))
  t.handlePacket(objFrame(1, [5], [[5, 117, 0.4, 0.4, 0]])) // tracker restarted
  assert.equal(frames.at(-1).pucks.moved[0].x, 0.4)
})

test('calibration: flips, offset, reversal, wrapped to [0, 2PI)', () => {
  const { t, frames } = harness({
    ...MAPPED,
    calibration: { flipX: true, flipY: true, angleOffsetDeg: 90, angleReversed: true },
  })
  t.handlePacket(objFrame(1, [5], [[5, 117, 0.25, 0.75, Math.PI / 4]]))
  const p = frames[0].pucks.added[0]
  assert.equal(p.x, 0.75)
  assert.equal(p.y, 0.25)
  // -45deg + 90deg = 45deg
  assert.ok(Math.abs(p.angle - Math.PI / 4) < 1e-9)
  assert.ok(p.angle >= 0 && p.angle < Math.PI * 2)
})

test('a mapping change re-announces a stationary puck without waiting for it to move', () => {
  const { t, frames } = harness(MAPPED)
  t.handlePacket(objFrame(1, [5], [[5, 117, 0.25, 0.5, 1]]))
  t.setConfig(normalise({ ...defaults(), pucks: [{ markerId: 7, tag: 117 }] }))
  const last = frames.at(-1)
  assert.equal(last.pucks.removed.length, 1)
  assert.equal(last.pucks.added[0].markerId, 7)
  assert.equal(last.pucks.added[0].x, 0.25)
})

test('snapshot replays everything on the surface for a reloaded renderer', () => {
  const { t } = harness(MAPPED)
  t.handlePacket(
    objFrame(
      1,
      [5, 3],
      [
        [5, 117, 0.25, 0.5, 1],
        [3, 900, 0.5, 0.5, 0],
      ],
    ),
  )
  t.handlePacket(curFrame(1, [8], [[8, 0.1, 0.2]]))
  const { frame, controls } = t.snapshot()
  assert.equal(frame.pucks.added.length, 1)
  assert.equal(frame.touches.added.length, 1)
  assert.equal(controls.length, 1)
})

test('reset withdraws everything', () => {
  const { t, frames, controls } = harness(MAPPED)
  t.handlePacket(
    objFrame(
      1,
      [5, 3],
      [
        [5, 117, 0.25, 0.5, 1],
        [3, 900, 0.5, 0.5, 0],
      ],
    ),
  )
  t.handlePacket(curFrame(1, [8], [[8, 0.1, 0.2]]))
  t.reset()
  assert.equal(frames.at(-1).pucks.removed.length, 1)
  assert.equal(frames.at(-1).touches.removed.length, 1)
  assert.equal(controls.at(-1).type, 'remove')
  assert.equal(t.hasContacts(), false)
})

test('two trackers with clashing session ids stay separate', () => {
  const { t, frames } = harness(MAPPED)
  t.handlePacket(objFrame(1, [5], [[5, 117, 0.1, 0.1, 0]]), 'a:1')
  t.handlePacket(objFrame(1, [5], [[5, 42, 0.9, 0.9, 0]]), 'b:1')
  const keys = frames.map((fr) => fr.pucks.added[0].key)
  assert.notEqual(keys[0], keys[1])
})

test('fingers arrive as touches', () => {
  const { t, frames } = harness(MAPPED)
  t.handlePacket(curFrame(1, [8], [[8, 0.1, 0.2]]))
  t.handlePacket(curFrame(2, []))
  assert.equal(frames[0].touches.added[0].x, 0.1)
  assert.equal(frames[1].touches.removed.length, 1)
})

/* ---------------- table.json ---------------- */

test('normalise: defaults for nothing, and a typo costs one field, not the enrollment', () => {
  assert.deepEqual(normalise(undefined), defaults())
  const c = normalise({ version: 1, tuio: { port: 'nope' }, pucks: [{ markerId: 1, tag: 117, label: 'red' }] })
  assert.equal(c.tuio.port, 3333)
  assert.deepEqual(c.pucks, [{ markerId: 1, tag: 117, label: 'red' }])
})

test('normalise: clashing tags or markerIds, and a control tag that is also a puck', () => {
  const c = normalise({
    pucks: [
      { markerId: 1, tag: 117 },
      { markerId: 2, tag: 117 },
      { markerId: 1, tag: 50 },
      { markerId: 3, tag: 60 },
    ],
    control: { tag: 60 },
  })
  assert.deepEqual(
    c.pucks.map((p) => [p.markerId, p.tag]),
    [
      [1, 117],
      [3, 60],
    ],
  )
  assert.equal(c.control.tag, null)
})

test('normalise: an unversioned file migrates to the current version', () => {
  assert.equal(normalise({ present: true }).version, 1)
  assert.equal(normalise({ present: true }).present, true)
})
