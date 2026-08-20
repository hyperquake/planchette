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
`Documents\Planchette`) holding example interfaces, the API reference, and the
design rules. Edit anything in there and the app reloads it, keeping your pucks
where they were. **New interface…** in the Workspace panel scaffolds a folder
ready to edit.
