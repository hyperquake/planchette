# Getting started

For a designer who wants to build a table interface, with an agent doing most of
the typing. No terminal, no build step, nothing to install beyond the app.

## 1. Get the app

Download the latest release from the repository's Releases page and pick the file
that matches your machine:

| You have | Download |
| --- | --- |
| Apple Silicon Mac (M1 and later) | the `arm64.dmg` |
| Intel Mac | the plain `.dmg` |
| Windows | `setup.exe` to install, or `Planchette.0.1.0.exe` to run without installing |

**Both systems will object the first time.** The builds are not code signed yet,
so:

- **macOS**: right-click the app and choose **Open**, then confirm. If it still
  refuses, or it reached you as a zip through chat, run
  `xattr -cr "/Applications/Planchette.app"`.
- **Windows**: SmartScreen says "Windows protected your PC". Click **More info**,
  then **Run anyway**.

Once per machine, then never again.

## 2. Launch it

On first run Planchette creates a folder at **`~/Documents/Planchette`**
(`Documents\Planchette` on Windows). That folder is your workspace: every
subfolder in it is one interface, and the app lists them in the **App** menu at
the top left.

It arrives with four interfaces to look at. Try `radial-atlas` first: drop a puck
on the surface by pressing **P**, then drag it, and right-drag or scroll to
rotate it.

## 3. Make your own

**File > New interface…**, give it a name, and the app scaffolds a folder with
starter files and opens it for you.

## 4. Point an agent at it

This is the part worth getting right. **Open the new interface's folder in Claude
Code**, or whatever coding agent you use, and just describe what you want:

    make a puck that scrubs through a video, with the timeline
    under the puck and a filmstrip along it

You do not need to explain the table, the units, or the puck API. The workspace
already carries everything an agent needs:

| File | What it gives the agent |
| --- | --- |
| `CLAUDE.md` | What the table is, and the rules that matter |
| `API.md` | The complete SDK reference |
| `DESIGN-RULES.md` | Why a laptop-shaped interface fails on a table |
| `types/` | Autocomplete and type checking for the SDK |
| `.claude/skills/` | A skill that fires when you mention pucks or a table |

Opening the **workspace root** rather than a single interface folder gives the
agent the most to work with, though either works: each interface folder has its
own `CLAUDE.md` too.

The examples are the best thing to point at when something is unclear. "Look at
how `dial-demo` handles a puck disappearing" is a good instruction.

## 5. The loop

Save a file and **the app reloads it by itself, with your pucks left where they
were**. That is the whole working rhythm: arrange the surface once, then edit and
save as often as you like without touching the app again.

Driving the surface with a mouse and keyboard:

| | |
| --- | --- |
| **P** | drop a puck at the cursor |
| drag | move a puck |
| right-drag or scroll | rotate a puck |
| **[** **]** | nudge rotation 5 degrees |
| backspace | remove the puck under the cursor |
| drag off the edge | lift a puck off the table |
| drag empty space | a contact that lasts while the button is down |
| **1**…**9** | pin a lasting contact at the cursor, press again to lift |
| **esc** | clear all contacts |

A real touchscreen, or an iPad pointed at the same machine, gives you genuinely
simultaneous fingers, which a mouse cannot.

## 6. When it does not work

**View > Toggle Inspector** (`⌘I` / `Ctrl+I`) opens a panel showing every value
your interface is being sent: pucks with their positions and angles, contacts,
and a live event log. Most problems are visible there in a few seconds.

For errors in your own code, open the developer tools from the **View** menu and
read the console.

## Things that catch people out

- **Sizes are in millimetres, not pixels.** The surface is 3840 by 2160 and
  1218mm wide. Write `calc(20 * var(--mm))`, never `20px`. A design that looks
  right on your laptop is usually wrong on the table.
- **There is no cursor**, so no hover states. Anything only discoverable by
  hovering is invisible.
- **Several people use the table at once.** No modal dialogs, and no single
  "selected thing" for the whole interface.
- **Do not draw anything meaningful under a puck.** It is a 60mm object with a
  hand on it. Put things in a ring around it.
- **A puck vanishing is usually not a user removing it.** Real marker tracking
  flickers, so fade things out rather than deleting them instantly.
- **Video works**, and seeks, but use an `.mp4` and keep test files small so
  every reload is not a wait.

`DESIGN-RULES.md` in your workspace has the full list with the reasoning.

## What it does not do

It is a simulator, so it does not reproduce the tracking latency of the real
table, marker flicker, or the exact feel of glass under a fingertip. It is
accurate about size, geometry, and behaviour, which is what makes it worth
designing against.
