# CI runners

Both workflows run on the **org-level** self-hosted runners, the same machines
conflower-player builds on. Nothing needs registering.

| Job | Label set | Machine |
| --- | --------- | ------- |
| macOS build and release | `[self-hosted, macOS]` | `Brooklyn-Studio` (Mac Studio, Apple Silicon) |
| Windows build and release | `[self-hosted, Windows]` | `PROTO1-P8` |

Both live in the org runner group `default`. There are no repo-scoped runners on
this repository, and none are wanted: repo-scoped runners cannot be shared, which
is how conflower-player ended up with a separate pair.

## Verified

The first CI run proved most of this rather than assuming it:

- The Windows job is picked up by `PROTO1-P8` immediately, and `npm ci`,
  `npm run check`, `npm run build` and `npm run build:seed` all pass. That
  confirms the pinned `allowScripts` approval for Electron's binary download
  works in CI, which was the main unknown.
- Repository access through the org runner group is therefore already granted.
  Nothing needed adding.
- The macOS job sits unassigned across three separate runs. Labels and group
  access are both fine, proven by Windows working from the same group, so
  `Brooklyn-Studio` is **offline**. Its last job in any repo was 2026-08-12.

**Correction.** An earlier version of this file claimed the Windows smoke test
passed on the first run. It did not. `continue-on-error: true` reports a failed
step's conclusion as `success`, and that was read as a pass. The smoke test had
been failing on Windows from the first run with `spawn EINVAL`, because Node 20.12
and later refuse to spawn a `.cmd` file without `shell: true` and the script
launched Electron through `npx.cmd`. It now resolves the Electron binary directly.

With that fixed, the Windows smoke test **does** pass on `PROTO1-P8`: all 23
checks, Electron window and all. This time the pass is real rather than masked,
because the step is gating and the run immediately before it reported `failure`,
which a `continue-on-error` step cannot do. So that machine has an interactive
desktop.

## The one thing that has to be true

The org runner group must **grant this repository access**. Org runner groups are
allow-lists; a new repo gets nothing by default, and jobs simply queue forever
with no error.

GitHub → organisation **Potion** → Settings → Actions → Runner groups →
`default` → Repository access → add `planchette`.

Symptom if this is missed: a run sits at "Waiting for a runner to pick up this
job" indefinitely. It is not a label problem, and re-running will not help.

Access **is** currently granted, so the same symptom now means the machine for
that platform is offline. To tell the two apart, look at whether the other
platform's job started: if one runs and the other queues, it is a machine, not a
permission.

## What each machine needs installed

Both already build other projects, so most of this is present.

**macOS** (`Brooklyn-Studio`)
- Node 24. `actions/setup-node` installs it into the runner tool cache on first
  use, so nothing needs doing by hand.
- **Xcode command line tools**, for `codesign`. `scripts/adhoc-sign.cjs` ad-hoc
  signs the bundle, and without a valid signature an arm64 build will not launch
  at all: macOS calls it "damaged", which reads like a corrupt download and sends
  people chasing the wrong problem.
- A **logged-in desktop session** if you want `npm run smoke` to pass, since it
  opens a real window. It is `continue-on-error` in the release workflow on
  purpose, so a headless session cannot block shipping.

**Windows** (`PROTO1-P8`)
- Node 24, same as above.
- `npm run smoke` opens a real Electron window and passes here, so this runner
  has a logged-in desktop session. It is gating in `ci.yml` so a failure is
  visible rather than masked. If the runner is ever re-registered as a Windows
  service it loses that desktop, and the step will need `continue-on-error`.

Neither machine needs Wine, a Developer ID, or any signing setup. Electron's
~100MB binary download is cached per machine (`~/Library/Caches/electron`,
`%LOCALAPPDATA%\electron\Cache`) so it is paid once, not per run.

## Why every job starts with `npm run clean`

Self-hosted runners keep their working directory between runs, and `dist/`,
`release/`, `dist-types/`, and `workspace-seed/` are all gitignored, so
`actions/checkout` leaves them alone. Without the clean step, artifacts from an
older version survive and get swept into the next release's upload glob. This is
not hypothetical: a local build left `Touch Table Sim-0.1.0.dmg` files behind
after the rename, and a `release/*.dmg` glob would have shipped them.

## Shipping a release

```
npm version 0.2.0 --no-git-tag-version
git commit -am "Release v0.2.0"
git tag v0.2.0
git push --follow-tags
```

The tag triggers `release.yml`. Both platforms build in parallel and each
publishes its own assets to one GitHub Release, using create-or-upload so
whichever finishes first creates it. `scripts/check-version.mjs` refuses to build
if the tag and `package.json` disagree, because electron-builder names artifacts
from `package.json` and a mismatch produces a `v0.2.0` release full of `0.1.0`
files.

Release notes come from `docs/release-notes.md`, which is mostly the Gatekeeper
and SmartScreen instructions recipients need. Swap `--notes-file` for
`--generate-notes` if you would rather have the commit list.

## Pinning to a specific machine

`jeffbook-mac` also answers `[self-hosted, macOS]`, so a mac job can land there
instead of on `Brooklyn-Studio`. Both are Apple Silicon, so the artifacts are
identical either way; the only cost is a build running on a laptop that might
sleep. If that becomes annoying, add a custom label such as `planchette` to
`Brooklyn-Studio` in the org runner settings and change the job to
`[self-hosted, macOS, planchette]`.

## Signed builds, if you ever want them

conflower-player already has Developer ID and notarization credentials as repo
secrets (`MACOS_CERT_P12`, `MACOS_CERT_PASSWORD`, `MACOS_KEYCHAIN_PASSWORD`,
`NOTARY_APPLE_ID`, `NOTARY_TEAM_ID`, `NOTARY_PASSWORD`). Copying those to this
repo, or promoting them to org secrets, would let electron-builder sign and
notarize properly, and the whole "right-click then Open" instruction disappears.

That is a deliberate non-goal today, not an oversight. It would mean removing
`mac.identity: null` from `electron-builder.yml` and teaching
`scripts/adhoc-sign.cjs` to stand down when a real identity is present, since
ad-hoc signing afterwards would overwrite the good signature.
