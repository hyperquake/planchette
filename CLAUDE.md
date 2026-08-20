# Working on the simulator

This file is for developing **the simulator itself**. If you are writing an
interface that runs on the table, read [`docs/HOUSE-RULES.md`](docs/HOUSE-RULES.md)
instead; almost nothing here applies to that.

    npm run dev      # http://localhost:5173
    npm run check    # TypeScript
    npm run smoke    # launches the real desktop shell and drives it over CDP

## Shape of the thing

Four parts, and the boundaries between them are load-bearing:

- **`src/host/`** owns all puck and touch state and the UI around the surface.
  Every mutation goes through `TableModel`, which is what lets the inspector, the
  input layer, and `window.sim` all see one consistent truth.
- **`src/sdk/`** is what an interface imports. It is the public contract, so the
  wire types live here in `types.ts` and the host imports them from the SDK, not
  the other way round.
- **`apps/<id>/`** are example interfaces, served as static files.
- **`electron/`** is a shell: a custom `planchette://` protocol, a workspace folder on
  disk, and a file watcher. It adds distribution, not behaviour.

Host and interface communicate **only** over `postMessage`. That is the seam that
lets the same interface code run against the simulator, standalone in a browser,
and eventually against real hardware over a socket.

## Invariants worth not breaking

Each of these exists because the obvious alternative was tried or considered and
is wrong.

1. **The app iframe is laid out at the table's real resolution** (3840x2160) and
   scaled down by a transform on an ancestor. One CSS pixel inside an interface
   is always one real table pixel; only the preview shrinks. This is the whole
   reason the simulator is trustworthy about size.
2. **`appSource.urlFor()` returns the same path in both environments**, so the
   packaged app serves the host UI and interfaces from one origin
   (`planchette://host`). Do not give interfaces their own origin without a reason:
   same-origin is what keeps the renderer free of environment checks.
3. **The SDK folds each event into its cached state before dispatching it.** A
   handler calling `table.state()` or `nearestPuck()` must see a table that
   already includes the thing it is being told about. Relying on the
   once-per-frame snapshot instead fails roughly one frame in sixty, which is the
   worst possible failure rate.
4. **`config` carries the initial state, and `hello` replays `puckadd` for
   everything already on the surface.** Otherwise an interface that reloads while
   three pucks sit on the table comes back blind.
5. **TUIO field semantics.** Normalized 0..1 coordinates with y down, angles in
   radians, 0 pointing up, clockwise positive. A session `id` that changes on
   re-acquisition, and a `markerId` that does not. Keep these exact; they are the
   hardware bridge's contract.
6. **The host persists pucks to `sessionStorage`.** Editing a file under `apps/`
   makes Vite full-reload every connected client, the host page included. Without
   persistence a designer loses their whole arrangement on every save.
7. **`backgroundThrottling: false`** in the Electron window. Interfaces render in
   a `requestAnimationFrame` loop, and Chromium throttles rAF hard once it decides
   a window is occluded. A designer watching the simulator while typing in another
   app would otherwise see it freeze.

## Bare specifiers

Interfaces import `@planchette/sdk` and `three`. Those resolve two different ways, and
**both have to be updated together**:

| Environment  | Mechanism                                                        |
| ------------ | ---------------------------------------------------------------- |
| Vite dev     | `resolve.alias` in `vite.config.ts`, plus node resolution          |
| Packaged app | the `PROVIDED` map in `electron/main.js`, injected as an import map |

To offer a new library, you need three things: a vendor entry under
`src/vendor/`, a Vite lib config that emits a self-contained file into `dist/`,
and an entry in `PROVIDED`. Copying a file out of `node_modules` usually does not
work, because packages like Three split their ESM build across several files.

## Testing

`npm run smoke` is the real test. It launches the actual Electron shell against a
throwaway workspace and drives the renderer over the Chrome DevTools Protocol,
covering the things that only break once packaged: workspace seeding, the preload
bridge, MIME types, the injected import map actually resolving, path traversal
being refused, the file watcher, and pucks surviving a reload.

For the web path, drive `window.sim` from the browser console. It takes
millimetres and degrees and is the same entry point the toolbar uses.

Note when testing in a browser: a backgrounded tab pauses `requestAnimationFrame`
everywhere, so a frozen mid-transition value is usually the tab being hidden
rather than a bug. Taking a screenshot forces frames to run.

## Gotchas already paid for

- **npm 11 blocks install scripts.** Electron's postinstall is what downloads the
  binary, so it is approved in `package.json` under `allowScripts`, pinned to an
  exact version. Bumping Electron means re-running `npm approve-scripts electron`.
- **WebGL clamps line width to 1 pixel**, which is 0.3mm on this panel and
  therefore invisible. `apps/arcane-table/lib/ribbon.js` builds strokes from
  triangles instead.
- **Never pass `devicePixelRatio` to a WebGL renderer here.** The surface is
  already at native resolution; on a retina laptop that would ask for four times
  the pixels the table has.
- **Overlay class names are global.** Log rows once carried `class="puck"` and
  inherited the absolutely-positioned overlay styles, which flung them into the
  page corner. Prefix UI classes.
- **Unsigned macOS builds must still be ad-hoc signed** or they will not launch on
  Apple Silicon at all, and the error says "damaged", which sends people chasing
  a corrupt download.

## Common tasks

- **Add a surface preset**: `PRESETS` in `src/host/surface.ts`. Give the physical
  width in millimetres; height is derived from the pixel aspect.
- **Add an example interface**: a folder under `apps/` with an `index.html`. It
  appears in the picker automatically. Add it to `EXAMPLES` in
  `scripts/build-seed.mjs` to ship it to designers.
- **Change the event API**: `src/sdk/types.ts` first, then the host, then
  `docs/EVENT-API.md`. Keep TUIO alignment in mind.
