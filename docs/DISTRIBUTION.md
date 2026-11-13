# Building and handing this to coworkers

## The idea

The desktop build exists so a coworker can double-click an app instead of
installing Node, and **still author interfaces**. That second half is why the
app does not simply bake the examples into the bundle.

Instead there is a **workspace**: a normal folder on disk, by default
`~/Documents/Planchette` (Windows: `Documents\Planchette`). On first
run the app seeds it with two example apps, SDK type declarations, a
`jsconfig.json`, and a `CLAUDE.md` carrying the design rules. A coworker can open
that folder in any editor or coding agent and start working.

**Existing workspaces are upgraded, carefully.** Seeding happens once, so
without help a workspace's reference docs, SDK types and agent guidance would
stay at whatever version created it. `build-seed.mjs` records the hash of every
file the app owns in `.planchette/seed.json`, and each time a workspace is
opened `electron/workspace-upgrade.js` brings it up to date: a file still as the
app wrote it is replaced; a file the designer edited is kept, with the new one
written beside it (`API.new.md`); anything they deleted stays deleted; examples
and interfaces are never overwritten. Workspaces from 0.1.x, which have no
manifest, are matched against `scripts/seed-history.json`, the hashes of what
those releases shipped. A folder the app never seeded is left alone.

The app watches the workspace. Saving a file reloads just the app iframe, and the
puck arrangement survives, so the loop is: arrange pucks once, then edit freely.

## How the pieces fit

| Piece                    | Role                                                            |
| ------------------------ | --------------------------------------------------------------- |
| `electron/main.js`       | Serves everything over `planchette://`, owns the workspace and watcher. |
| `electron/preload.cjs`   | The whole renderer-to-disk surface. Nothing else crosses.       |
| `src/host/appsource.ts`  | Hides whether interfaces come from Vite or the workspace.         |
| `scripts/build-seed.mjs` | Assembles `workspace-seed/`, what a fresh workspace gets, and its manifest. |
| `electron/workspace-upgrade.js` | Brings an older workspace up to the current seed without touching edits. |
| `electron/tuio.js`       | TUIO from a real table; see `TABLE.md`.                          |
| `scripts/adhoc-sign.cjs` | Ad-hoc signs the macOS app so it will launch.                    |

The host UI and the interfaces share one origin, `planchette://host`: the UI from
the bundle, interfaces from `/workspace/`. The web build serves examples from
`/examples/` instead, and `appSource.urlFor()` is the only place that knows the
difference.

Designer apps import `@planchette/sdk`, a bare specifier no browser can resolve. Vite
handles it in development; the packaged app injects an import map into each
served `index.html` pointing at `/sdk.js`. If a designer wrote their own import
map, theirs is merged and their mapping wins, since a document may only have one.

## Building

    npm run dist:mac     # release/*.dmg and *.zip, arm64 and x64
    npm run dist:win     # release/*.exe, installer and portable

Both run `npm run prepackage` first, which builds the host bundle, the standalone
SDK, the type declarations, and the workspace seed.

`.github/workflows/release.yml` builds and publishes both platforms on the
org-level self-hosted runners. See `RUNNERS.md` for which machines those are and
the one permission that has to be granted.

### One gotcha with npm 11 install scripts

npm 11 refuses to run package install scripts unless they are approved, and
Electron needs its own: the npm package is a stub, and the postinstall script is
what downloads the ~100MB prebuilt binary. Without approval you get an `electron`
folder with no `dist/`, and builds fail in a confusing way.

The approval is committed in `package.json`:

```json
"allowScripts": { "electron@43.4.1": true }
```

Because it is pinned to an exact version, **bumping Electron means re-approving**:

    npm approve-scripts electron

Nothing else in the tree runs install scripts, which is why the packaged app has
no runtime dependencies at all.

## Testing

    npm run smoke

Launches the real shell against a throwaway workspace and drives the renderer
over the Chrome DevTools Protocol, checking the things that only break once
packaged: workspace seeding, the preload bridge, `/sdk.js` being served with a
JavaScript MIME type, the injected import map actually resolving `@planchette/sdk`,
path traversal out of the workspace being refused, the file watcher reloading the
app, and pucks surviving that reload.

It opens a window, so it needs an interactive desktop session. In CI it gates the
macOS job and is advisory on Windows, since self-hosted Windows runners often run
as a service with no desktop.

## Icons

`build/icon.icns` and `build/icon.ico` are discovered by filename because
`buildResources: build` is set. **Do not** add a `mac.icon`, `win.icon`, or
top-level `icon:` key; adding one is how this breaks. Do not rebuild them from a
single PNG either: each carries two pieces of artwork, a solid lens below 48px
and a lens knocked out with a ring above, which closes into mush at small sizes.

`public/favicon.svg` and `public/favicon.ico` are served from the root under both
Vite and `planchette://host`, so their paths must stay root-absolute. The smoke
test asserts both come back with the right MIME type, which is the part that can
break silently once packaged.

Unpackaged runs have no bundle to take an icon from, so `electron/main.js` points
the dock and the window at `build/icon.png` when `app.isPackaged` is false. That
guard is load-bearing: `build/` is deliberately not in the packaged `files` list,
so a packaged build must never try to read it.

## Developing the shell

    npm run dev            # terminal 1: Vite
    npm run electron:dev   # terminal 2: Electron pointed at Vite

In dev mode the workspace is the repo's own `examples/` folder, so the app list and
the URLs agree about which apps exist. Switching workspace is a packaged-build
feature.

## What coworkers will see on first launch

The builds are **unsigned**. Ad-hoc signing makes them run, but it does not
satisfy Gatekeeper, so a downloaded copy is quarantined. Tell people this up
front, because the macOS wording implies the file is corrupt.

**macOS.** Right-click the app and choose **Open**, then confirm. Once per
machine. If it still refuses, or was delivered as a zip through Slack:

    xattr -cr "/Applications/Planchette.app"

**Windows.** SmartScreen shows "Windows protected your PC". Click **More info**,
then **Run anyway**. Also once per machine.

## Turning on real signing later

Nothing here needs rework.

- **macOS**: get an Apple Developer ID, remove `mac.identity: null` from
  `electron-builder.yml`, and set `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and
  `APPLE_TEAM_ID` on the runner so electron-builder notarizes. The ad-hoc hook
  becomes a no-op you can delete.
- **Windows**: add a `win.certificateFile` or use a signing service, and drop the
  SmartScreen instructions.

## Still to do

- **Auto-update.** Not wired. Coworkers get new builds by downloading them. If
  that becomes annoying, `electron-updater` plus a release feed is the usual next
  step, and it needs real signing on macOS to be worth it.

