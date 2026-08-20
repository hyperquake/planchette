# Building and handing this to coworkers

## The idea

The desktop build exists so a coworker can double-click an app instead of
installing Node, and **still author interfaces**. That second half is why the
app does not simply bake `apps/` into the bundle.

Instead there is a **workspace**: a normal folder on disk, by default
`~/Documents/Planchette` (Windows: `Documents\Planchette`). On first
run the app seeds it with two example apps, SDK type declarations, a
`jsconfig.json`, and a `CLAUDE.md` carrying the design rules. A coworker can open
that folder in any editor or coding agent and start working.

The app watches the workspace. Saving a file reloads just the app iframe, and the
puck arrangement survives, so the loop is: arrange pucks once, then edit freely.

## How the pieces fit

| Piece                    | Role                                                            |
| ------------------------ | --------------------------------------------------------------- |
| `electron/main.js`       | Serves everything over `planchette://`, owns the workspace and watcher. |
| `electron/preload.cjs`   | The whole renderer-to-disk surface. Nothing else crosses.       |
| `src/host/appsource.ts`  | Hides whether apps come from Vite or from the workspace.         |
| `scripts/build-seed.mjs` | Assembles `workspace-seed/`, what a fresh workspace gets.        |
| `scripts/adhoc-sign.cjs` | Ad-hoc signs the macOS app so it will launch.                    |

Host UI and designer apps share one origin, `planchette://host`, so an app's URL is
`/apps/<id>/index.html` in both the packaged app and the dev server. That is what
keeps the renderer free of environment checks.

Designer apps import `@planchette/sdk`, a bare specifier no browser can resolve. Vite
handles it in development; the packaged app injects an import map into each
served `index.html` pointing at `/sdk.js`. If a designer wrote their own import
map, theirs is merged and their mapping wins, since a document may only have one.

## Building

    npm run dist:mac     # release/*.dmg and *.zip, arm64 and x64
    npm run dist:win     # release/*.exe, installer and portable

Both run `npm run prepackage` first, which builds the host bundle, the standalone
SDK, the type declarations, and the workspace seed.

`.github/workflows/build.yml` builds each platform on your self-hosted runners.
Check the `runs-on` labels match how yours are registered; it assumes
`[self-hosted, macOS]` and `[self-hosted, Windows]`.

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

## Developing the shell

    npm run dev            # terminal 1: Vite
    npm run electron:dev   # terminal 2: Electron pointed at Vite

In dev mode the workspace is the repo's own `apps/` folder, so the app list and
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

- **App icon.** There is none, so builds carry the default Electron icon. Drop a
  1024x1024 PNG at `build/icon.png` and electron-builder generates `.icns` and
  `.ico` from it. Nothing else changes.
- **Auto-update.** Not wired. Coworkers get new builds by downloading them. If
  that becomes annoying, `electron-updater` plus a release feed is the usual next
  step, and it needs real signing on macOS to be worth it.
- **Large media in apps.** Files are read fully into memory rather than streamed,
  so range requests are not supported. Fine for images and short clips; a long
  video will not seek.
