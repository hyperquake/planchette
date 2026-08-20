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

- The Windows job was picked up by `PROTO1-P8` immediately and **every step
  passed**, including `npm ci` (so the pinned `allowScripts` approval for
  Electron's binary download works in CI), all three Vite builds, the workspace
  seed, and the full 23-check smoke test against a real Electron window.
- Repository access through the org runner group is therefore already granted.
  Nothing needed adding.
- The macOS job sat unassigned. Labels and group access are both fine, proven by
  Windows working from the same group; `Brooklyn-Studio` is simply **offline**.
  Its last job in any repo was 2026-08-12.

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
- It runs in a logged-in session, so `npm run smoke` works: the first CI run on
  this machine passed all 23 checks, Electron window and all. It is therefore
  gating in `ci.yml`. If the runner is ever re-registered as a Windows service it
  loses its interactive desktop and that step needs `continue-on-error`.

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
