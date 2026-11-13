# Event API and wire protocol

The contract between the simulator host and a designer app. Field semantics
deliberately mirror [TUIO](https://www.tuio.org/), the open protocol for tangible
interactive surfaces, so that a hardware bridge is later a translation layer
rather than a rewrite.

Types live in `src/sdk/types.ts` and are the single source of truth; the host
imports them too.

## Coordinates and units

| Concept | Convention |
| ------- | ---------- |
| Position | Normalized `x`, `y` in `0..1`, y axis pointing **down**. Millimetres are carried alongside as `mmX`, `mmY`. |
| Angle | Radians, `0` = marker north toward the top of the screen, **clockwise positive**, range `[0, 2*PI)`. |
| Velocity | `vx`, `vy` in normalized units per second. `vAngle` in radians per second. |
| Time | Milliseconds from the host's `performance.now()`. |
| Layout | An app is laid out at `surface.widthPx` x `surface.heightPx` and scaled down for preview. One CSS pixel is one real table pixel. |

Designers should work in millimetres. Pixels are a rendering detail that changes
with the panel; millimetres are what the person at the table experiences.

## Objects

### `SurfaceInfo`

`id`, `label`, `widthPx`, `heightPx`, `widthMm`, `heightMm`, `pxPerMm`,
`puckDiameterMm`.

The default surface is a 55 inch 16:9 panel at 4K: 1218 x 685 mm, 3840 x 2160 px,
**3.153 px/mm** (about 80 dpi). So 20mm is 63px and a 60mm puck is 189px.

### `Puck`

A tangible object on the surface.

- `id` is a **session id**, stable only while the puck is continuously tracked.
- `markerId` is the **physical marker class** (a Codice tag on MultiTaction
  hardware, a TUIO class id on the wire). This is what you switch on to decide
  what a puck means, and what you should key your own state by.
- `x`, `y`, `mmX`, `mmY`, `angle`, `vx`, `vy`, `vAngle`, `firstSeen`, `lastSeen`.

### `Touch`

A finger, palm, or stylus contact.

- `id`, `x`, `y`, `mmX`, `mmY`, `firstSeen`, `lastSeen`.
- `radiusMm` is the contact radius. A fingertip is roughly 8mm; a palm is much
  larger, which is how palm rejection gets built.
- `edge` is the nearest table edge (`n`, `s`, `e`, `w`), a cheap hint for which
  side of the table a user is standing on.

Puck ids and touch ids are drawn from **one shared counter**, as in TUIO.

### `TableState`

`{ pucks: Puck[], touches: Touch[], surface: SurfaceInfo, t: number }`

## Events

`puckadd`, `puckmove`, `puckremove`, `touchstart`, `touchmove`, `touchend`.

`puckremove` means the tracker stopped seeing the marker. That is **not** the
same as the user removing the object: a hand or a sleeve passing over a puck
produces a removal followed by an add with a **new session id**. Apply a grace
period before destroying state, and key by `markerId` so the re-acquired puck
maps back onto the same thing.

## Transport

Host and app talk only over `postMessage`, which is what makes the transport
swappable. Every message carries `__table: 1` as a version marker.

App to host:

```
{ __table: 1, type: 'hello', sdkVersion }
```

Host to app:

```
{ __table: 1, type: 'config', surface, state }   // handshake reply, carries initial state
{ __table: 1, type: 'state',  state }            // full snapshot, once per frame
{ __table: 1, type: 'event',  name, data }       // discrete event
```

Notes on the handshake, both of which exist because of real failure modes:

1. `config` carries the **initial state**, so `table.state()` is already correct
   the instant `table.ready()` fires.
2. On `hello`, the host **replays** a `puckadd` for every puck already on the
   surface and a `touchstart` for every contact. Without this, an app that
   reloads (HMR, or the Reload button) while pucks sit on the table comes back
   blind, because it missed their original events.

The SDK folds each discrete event into its cached state **before** dispatching
it, so a handler calling `table.state()` or `table.nearestPuck()` always sees a
table that includes the thing it is being told about. Relying on the once-per-frame
snapshot instead would fail intermittently, roughly one frame in every few.

Full state is sent every frame rather than deltas. The payload is tiny for a
realistic number of contacts, and it is far easier to debug.

## Solo mode

If the SDK finds itself at the top level rather than in an iframe, it starts a
minimal built-in input fallback instead of connecting to a host. It reports the
**browser window** as the surface while keeping the real table's `pxPerMm`, so
millimetre sizing stays honest and you are simply working on a smaller table.

## Mapping to real hardware

The desktop app takes TUIO 1.1 from a real table and feeds it into the same
model the mouse drives, so an interface cannot tell the difference and needs no
changes. Setting a table up is in [`TABLE.md`](TABLE.md); this is the mapping.

| TUIO | This API |
| ---- | -------- |
| `/tuio/2Dobj set s i x y a X Y A m r` | `Puck`: `x`/`y` and `a`=`angle`, after the table's calibration. `i`, the printed tag, becomes `markerId` through the table's assignments. |
| `/tuio/2Dcur set s x y X Y m` | `Touch`: `x`/`y`. 2Dcur carries no size, so `radiusMm` is a fixed 9mm. |
| `alive` / `fseq` | Presence and frame order, which become add and remove events. Late frames are dropped by TUIO's own rule. |

**`markerId` is logical.** Pucks carry whatever tag ids were printed on them.
Each table assigns its tags to the small numbers interfaces use (1, 2, 3...), so
an interface written against puck 1 in the simulator gets puck 1 on any table,
whatever is printed on it. Until a table has any assignments, raw tag ids pass
through unchanged.

`id` is assigned by the host, as it is for a simulated puck. It changes whenever
the tracker re-acquires a marker, exactly as TUIO's own session id does.

A table may reserve one tag as a **control puck**, which opens the host's
interface picker. It never reaches an interface.

Not read yet: `/tuio/2Dblb` (contact size, which palm rejection would want) and
TUIO 2.0. Existing JavaScript TUIO clients, if those are ever wanted in the
browser: [`InteractiveScapeGmbH/tuio_client_js`](https://github.com/InteractiveScapeGmbH/tuio_client_js)
(TUIO 1.1 and 2.0) and [`Tuio.js`](https://github.com/fe9lix/Tuio.js).
