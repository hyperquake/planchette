<!--
The durable half of a GitHub release body: install and first-run guidance, the
same for every version. scripts/release-body.mjs puts the shipped version's
CHANGELOG.md section above this and publishes the two together. Nothing
version-specific belongs in here.
-->

## Installing

These builds are **unsigned**, so both systems object the first time. Once per
machine:

**macOS** — right-click the app and choose **Open**, then confirm. If it still
refuses, or it arrived as a zip through Slack:

```
xattr -cr "/Applications/Planchette.app"
```

**Windows** — SmartScreen shows "Windows protected your PC". Click **More info**,
then **Run anyway**.

## Which file

| You have | Download |
| -------- | -------- |
| Apple Silicon Mac | the `arm64.dmg` |
| Intel Mac | the plain `.dmg` |
| Windows | `setup.exe` to install, or the portable `.exe` to just run it |

## First run

Planchette creates a workspace at `~/Documents/Planchette` (Windows:
`Documents\Planchette`) holding four example interfaces, the API reference, and
the design rules. Everything in the **App** menu comes from that folder.

## Making your own, with an agent

**File > New interface…** scaffolds a folder with starter files. Then open that
folder in Claude Code, or whatever coding agent you use, and describe what you
want:

    make a puck that scrubs through a video, with the timeline
    under the puck and a filmstrip along it

You do not need to explain the table, the units, or the puck API. The workspace
already carries the SDK reference, the design rules, type declarations, and a
skill that fires when you mention pucks or a table, so an agent opened on that
folder starts with everything it needs.

Save a file and the app reloads it, keeping your pucks where they were.

`GETTING-STARTED.md` in the repository has the full walkthrough, and
`DESIGN-RULES.md` in your workspace has the handful of rules that decide whether
an interface works on a real table.
