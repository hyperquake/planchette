# Changelog

Notable changes to Planchette. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[semantic versioning](https://semver.org/spec/v2.0.0.html).

`docs/release-notes.md` is a different thing: it is the install and first-run
guidance published as the body of every GitHub release, and it does not change
from one version to the next.

## [Unreleased]

### Added

- **Run interfaces on a real table.** The desktop app listens for TUIO 1.1 from
  a table's tracker (pucks and fingers) and feeds it to interfaces exactly as
  the simulator does, so they need no changes. Off unless switched on in
  **Settings > Table input**; a designer's machine never opens a socket. See
  `docs/TABLE.md`.
- **Present mode** for the table's own computer: fullscreen on the table's
  display at one table pixel per screen pixel whatever the display scaling, no
  authoring chrome, native touch ignored. **Table > Enter Present Mode**, or
  `"present": true` in `table.json` to boot into it.
- **A control puck** that opens an interface picker on the table: put it down,
  turn it, touch an interface to open it.
- **Table > Assign Pucks** maps the tags printed on a table's pucks to the
  marker numbers interfaces use, and **Table > Calibrate** lines the tracker up
  with the screen. Both apply live. Stored per computer in `table.json`.
- `scripts/tuio-send.mjs`, a stand-in tracker for working without a table.
- `npm test`: unit tests for OSC decoding, TUIO frames, `table.json` and
  workspace upgrades, gating CI on both runners.

### Changed

- **Workspaces are now kept up to date.** Opening a workspace refreshes its
  reference docs, SDK types and agent guidance when the app has newer ones. A
  file you edited is kept, with the new version written beside it
  (`API.new.md`); anything you deleted stays deleted; interfaces and examples
  are never overwritten. A notice says what changed. Works for workspaces
  created by 0.1.0 and 0.1.1.
- `table.version` and the SDK's `hello` now report the app's version. They said
  0.1.0 in every release so far.

### Fixed

- On Windows, editing an interface did not reload it when the workspace path
  contained a short (8.3) folder name, such as `C:\Users\RUNNER~1\...`. The
  watcher now follows the folder's full path.

## [0.1.1] - 2026-08-26

### Fixed

- Reopening the window from the macOS dock left it permanently blank. IPC
  handlers were registered per window, and `ipcMain.handle` refuses a second
  registration for the same channel, so the throw landed before the window was
  ever pointed at a URL. They are now registered once for the process.
- Two copies running at once raced on `settings.json`, each overwriting the
  other's idea of the current workspace. A second launch now focuses the
  existing window instead.
- The workspace file watcher was not closed on quit.
- macOS builds carried `Copyright © 2026 Planchette`, the product name standing
  in for a vendor, because `package.json` named no author.

### Security

- An interface could navigate the whole shell away from the app and leave no way
  back. Interfaces share the host's origin by design, so `window.top` was
  reachable from inside the frame; only the main process could refuse it, and
  it now does.
- The host UI is served with a Content Security Policy. It is deliberately not
  applied to interfaces, which are meant to run whatever inline script their
  author wrote in their own folder.
- Interface and workspace names were interpolated into the pickers as markup, so
  a folder named like an HTML tag ran script in the document that holds the
  preload bridge. Options are built as DOM nodes now.
- The SDK accepted table messages from any window rather than only from the
  host, which the host was already checking for in the other direction.

### Added

- MIT licence. The notice ships inside the app bundle and the web artifact, not
  only in the repository.
- `npm run lint` (oxlint) and `npm run format` (Prettier), both gating CI.
  oxlint is the only static checking `electron/` and `scripts/` get, being plain
  JavaScript that `tsc` never sees.
- `engines.node`, `repository`, and `author` in `package.json`.

### Changed

- Release pages now say what changed. The body was previously install
  instructions alone, identical for every version; it now leads with that
  version's changelog section, assembled by `scripts/release-body.mjs`. A
  release whose version has no changelog section fails the build rather than
  publishing a page that says nothing.
- Workspace files are served with `Cache-Control: no-store`. The watcher's
  reload worked before only because a response with no validators happens to be
  treated as stale.
- The model and the input layer use the SDK's existing `angleDelta` rather than
  each reimplementing it. No behavioural change.
- Removed a write-only counter from the `radial-atlas` example, which designers
  read as reference code.

## [0.1.0] - 2026-08-21

First release.

- A simulator for a 4K multitouch table that also tracks physical pucks, laid
  out at the table's real resolution and scaled down for preview, so one CSS
  pixel in an interface is one real table pixel.
- `@planchette/sdk`, whose wire format mirrors TUIO so that a hardware bridge
  becomes a transport swap rather than a rewrite.
- A desktop app for macOS and Windows with a workspace folder on disk, a file
  watcher, and **File > New interface…** scaffolding.
- An embeddable web build for putting a live demo in a page.
- Three example interfaces and a starter template, seeded into a designer's
  workspace along with the API reference, the design rules, type declarations,
  and an agent skill.
- `window.sim`, which drives the same model the toolbar does, in millimetres and
  degrees.
- Four surface presets, an inspector showing raw wire values, and puck
  arrangements that survive a reload.

[Unreleased]: https://github.com/Potion/planchette/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/Potion/planchette/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Potion/planchette/releases/tag/v0.1.0
