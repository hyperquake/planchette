# `@planchette/sdk`

The complete API available to an interface. One import, one object.

```js
import { table } from '@planchette/sdk'
```

Design rules live in `DESIGN-RULES.md`; they matter more than this file does. The
wire format underneath is in `PROTOCOL.md`.

## The two ways to read the table

Pull inside a render loop, for anything that draws. You never maintain your own
copy of what is on the surface:

```js
table.ready(({ surface }) => {
  requestAnimationFrame(function loop() {
    const { pucks, touches } = table.state()
    draw(pucks, touches)
    requestAnimationFrame(loop)
  })
})
```

Push, for the discrete moments that matter:

```js
table.on('puckadd', (p) => openPanelFor(p.markerId))
```

Both see the same table. `table.state()` is always at least as fresh as the event
currently being handled, so calling it from inside a handler is safe.

## Lifecycle

| Call | What it does |
| ---- | ------------ |
| `table.ready(cb)` | Runs `cb({ surface })` once the surface geometry is known. Do your setup here. Fires immediately if already connected. |
| `table.connected` | `true` once the host has answered. |
| `table.isSolo` | `true` when running standalone rather than inside the simulator. |
| `table.version` | SDK version string. |

## State

| Call | Returns |
| ---- | ------- |
| `table.state()` | A frozen `TableState` snapshot. Cheap to call every frame. |
| `table.pucks` | `readonly Puck[]`, the same array as `state().pucks`. |
| `table.touches` | `readonly Touch[]`. |
| `table.surface` | `SurfaceInfo` for the panel you are drawing on. |

Snapshots are frozen, so mutating a puck by accident throws instead of silently
desynchronising you from the host.

## Events

`table.on(name, fn)` returns an unsubscribe function. `table.off(name, fn)` also
works.

| Event | Payload | Fires when |
| ----- | ------- | ---------- |
| `puckadd` | `Puck` | A marker started being tracked. |
| `puckmove` | `Puck` | Position or angle changed. |
| `puckremove` | `Puck` | Tracking stopped. **Not** necessarily removal by a user; see the flicker rule. |
| `touchstart` | `Touch` | A contact appeared. |
| `touchmove` | `Touch` | A contact moved. |
| `touchend` | `Touch` | A contact lifted. |

## Lookups

| Call | Returns |
| ---- | ------- |
| `table.puckById(id)` | The puck with that session id, or `undefined`. |
| `table.pucksByMarker(markerId)` | Every puck carrying that physical marker. |
| `table.nearestPuck(mmX, mmY, withinMm?)` | Closest puck to a point in millimetres. |
| `table.nearestTouch(mmX, mmY, withinMm?)` | Closest contact to a point in millimetres. |

## Units

| Call | Converts |
| ---- | -------- |
| `table.mm(v)` | Millimetres to pixels. The one you will use constantly. |
| `table.px(v)` | Pixels to millimetres. |
| `table.deg(radians)` | Radians to degrees. |
| `table.rad(degrees)` | Degrees to radians. |

Also exported: `wrapAngle(a)` normalises into `[0, 2*PI)`, `angleDelta(from, to)`
gives the shortest signed difference, `nearestEdge(mmX, mmY, widthMm, heightMm)`
returns `'n' | 's' | 'e' | 'w'`.

In CSS, the SDK publishes these custom properties on `:root`:

| Property | Value |
| -------- | ----- |
| `--mm` | One millimetre in pixels. `calc(20 * var(--mm))` is a 20mm target. |
| `--px-per-mm` | The same number, unitless. |
| `--puck-d` | Puck footprint diameter in pixels. |
| `--table-w`, `--table-h` | Surface size in pixels. |

## Shapes

```ts
interface SurfaceInfo {
  id: string; label: string
  widthPx: number; heightPx: number      // an interface is laid out at exactly this size
  widthMm: number; heightMm: number
  pxPerMm: number
  puckDiameterMm: number                 // never draw anything meaningful inside this
}

interface Puck {
  id: number          // session id, stable only while continuously tracked
  markerId: number    // which puck this is (1, 2, 3...). Key your own state by THIS.
  x: number; y: number            // normalized 0..1, y axis down
  mmX: number; mmY: number
  angle: number       // radians, 0 = up, clockwise positive, range [0, 2*PI)
  vx: number; vy: number          // normalized units per second
  vAngle: number                  // radians per second
  firstSeen: number; lastSeen: number
}

interface Touch {
  id: number
  x: number; y: number; mmX: number; mmY: number
  radiusMm: number                // fingertip is roughly 8mm; a palm is much larger
  edge: 'n' | 's' | 'e' | 'w'     // nearest edge: a cheap "which user" hint
  firstSeen: number; lastSeen: number
}

interface TableState {
  pucks: Puck[]; touches: Touch[]
  surface: SurfaceInfo
  t: number                       // milliseconds
}
```

## Libraries you can import

Provided as bare specifiers, no install required:

| Specifier | What |
| --------- | ---- |
| `@planchette/sdk` | This API. |
| `three` | Three.js. See the `arcane-table` example. |

Beyond that, an interface folder is an ordinary static site: reference any local
script, stylesheet, image, font, model, or shader at any depth, and remote
`https` URLs too, including ES module imports from a CDN.

Local files are streamed and support byte ranges, so `<video>` and `<audio>`
play and seek from the interface folder. A large file costs no memory beyond what
is being read. Codec support is whatever Electron's bundled ffmpeg provides,
which includes H.264 and AAC; an mp4 is the safe choice.

## Driving the simulator

`window.sim` exists on the simulator page, not inside your interface. Open the
developer tools and use it to set up a scene without juggling the mouse, or to
script a repeatable interaction. It takes millimetres and degrees.

```js
sim.addPuck({ markerId: 3, mmX: 600, mmY: 340, angleDeg: 45 })   // -> id
sim.movePuck(id, { mmX: 700, angleDeg: 90 })
sim.removePuck(id)
sim.touch({ mmX: 600, mmY: 400 })                                 // -> id
sim.moveTouch(id, { mmX: 620 }); sim.endTouch(id)
sim.loadApp('dial-demo'); sim.reload(); sim.clear()
sim.state(); sim.apps
```
