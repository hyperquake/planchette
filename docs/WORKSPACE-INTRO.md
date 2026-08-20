# Your table interfaces

This folder is your workspace for **Planchette**, a simulator for a
multitouch table with tangible pucks. Each subfolder here is one interface.

The table you are designing for is real hardware you probably do not have on your
desk: a large touch surface that also tracks physical pucks placed on it, sensing
each one's identity, position, and rotation. This app stands in for it.

## How to work

1. Open the simulator. Your interfaces appear in the **App** menu at the top.
2. Pick one, then drag pucks onto the surface and touch it with the mouse.
3. Edit the files in this folder with any editor. **Save and the simulator
   reloads by itself**, keeping your pucks exactly where you left them.
4. To start something new, use **New app...** in the simulator's Workspace panel.
   It copies `_template` for you.

Interfaces are ordinary HTML, CSS, and JavaScript. No build step, no install, no
framework. If you can write a web page, you can write one of these.

## Folders

| Path          | What it is                                                       |
| ------------- | ---------------------------------------------------------------- |
| `_template/`  | A near-empty starting point. Copy it, or use **New app...**       |
| `dial-demo/`  | A worked example: each puck becomes a rotary dial.                |
| `types/`      | Type declarations for the SDK. Gives you editor autocomplete.     |

Read `dial-demo/main.js` first. It is short and comments the reasoning behind
every decision that matters on a real table.

## Driving the simulator from the console

Open the developer tools (**View > Toggle Developer Tools**) and `window.sim` is
there, taking millimetres and degrees. Handy for setting up a scene without
juggling the mouse, and for scripting a repeatable interaction.
