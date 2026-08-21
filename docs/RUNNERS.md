# CI runners

Both workflows run on the **org-level** self-hosted runners, the same machines
conflower-player builds on. Nothing needs registering.

| Job | Label set | Machine |
| --- | --------- | ------- |
| macOS build and release | `[self-hosted, macOS]` | `hqmbp26-crouse`, or `Brooklyn-Studio` and `jeffbook-mac` when they are up |
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
- Both platforms now pass in full. `hqmbp26-crouse` was registered as an org
  runner on 2026-08-21 and picks up macOS jobs immediately: checkout, `npm ci`,
  typecheck, all three builds, the workspace seed, the 23-check desktop smoke test
  and the 19-check embed test.
- Before that, the macOS job sat unassigned across four runs. Labels and group
  access were fine the whole time, proven by Windows working from the same group.
  `Brooklyn-Studio` was simply offline; its last job in any repo was 2026-08-12.

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

## Adding a Mac runner

`hqmbp26-crouse` was added this way on 2026-08-21, org level, so it is available
to other Potion projects as well as this one. Repo level is the tighter choice for
a personal machine, since an org runner can be used by any repository its group
allows; org level is the right call if you do want to share it.

**Registering and running are two separate steps**, and it is easy to do the first
and think you are finished. `config.sh` writes the settings and exits, at which
point GitHub lists the runner but it is offline and jobs queue with no error. The
`svc.sh` lines below are what actually make it pick up work. A quick way to tell
them apart: if `~/actions-runner/_diag/Runner_*.log` has no `Listening for Jobs`
line, the runner has never run.

Everything else is already in place on a machine set up for this repo: Node,
git, `zip`, and the Xcode command line tools for `codesign`. The `allowScripts`
approval for Electron's binary download is committed in `package.json`, so
`npm ci` needs no intervention.

```sh
mkdir -p ~/actions-runner && cd ~/actions-runner
curl -O -L https://github.com/actions/runner/releases/download/v2.336.0/actions-runner-osx-arm64-2.336.0.tar.gz
tar xzf actions-runner-osx-arm64-2.336.0.tar.gz

# Fetched inline so the registration token never lands in a shell history or a
# transcript. It expires in an hour and only permits adding a runner.
TOKEN=$(gh api -X POST repos/Potion/planchette/actions/runners/registration-token --jq .token)
./config.sh --url https://github.com/Potion/planchette --token "$TOKEN" --unattended --replace

# Registration is done at this point, and the runner is still offline. This is
# the part that matters:
./svc.sh install
./svc.sh start
```

Confirm it is actually listening, not merely registered:

    launchctl list | grep actions.runner

No custom labels are needed. GitHub applies `self-hosted`, `macOS` and `ARM64`
automatically, and the workflows ask for `[self-hosted, macOS]`.

Check it took:

    gh api repos/Potion/planchette/actions/runners --jq '.runners[] | "\(.name) \(.status) \(.labels|map(.name)|join(","))"'

### Three things about a laptop that a desktop would not have

**`svc.sh` installs a LaunchAgent, not a LaunchDaemon.** That is what makes the
smoke tests work, because a LaunchAgent runs inside your logged-in session and so
has a desktop to open a window on. It also means the runner is offline whenever
you are logged out.

**Sleep takes the runner offline mid-job.** For a long release build, hold it
awake:

    caffeinate -dimsu -w $(pgrep -f Runner.Listener | head -1)

**Three Macs will answer `[self-hosted, macOS]`** once this one is registered:
this machine, `jeffbook-mac`, and `Brooklyn-Studio` when it returns. Jobs land on
whichever is free, so a release can build on any of them. All are Apple Silicon,
so the artifacts are identical; the only cost is unpredictability about which
machine did the work. If that matters, add a `planchette` label to the one you
want and change `runs-on` to `[self-hosted, macOS, planchette]`.

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
whichever finishes first creates it. The release is a **draft**: download both
artifacts and run them before publishing by hand. Drop `--draft` from the two
`gh release create` calls if you would rather it went out directly. `scripts/check-version.mjs` refuses to build
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
