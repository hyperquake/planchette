# Your table interfaces

This folder is a **Planchette** workspace. Planchette simulates a large
multitouch table that also tracks **pucks**: physical objects placed on the
surface, each reporting its own identity, position, and rotation. The real
hardware is a 55 inch 4K panel, 1218mm across, that four people can use at once.

Every subfolder here is one interface. They are ordinary HTML, CSS, and
JavaScript: no build step, no install, no framework.

## How to work

1. Open the Planchette app. Your interfaces appear in the **App** menu.
2. Drag pucks onto the surface and touch it with the mouse. **View > Toggle
   Inspector** shows every value your interface is being sent.
3. Edit files here with any editor. **Save and it reloads by itself**, keeping
   your pucks where you left them.
4. **File > New interface…** creates a folder with starter files ready to edit.
   **Planchette > Settings**, or `⌘,`, is where you change which folder this is.

## The shape of an interface

```js
import { table } from '@planchette/sdk'

table.ready(({ surface }) => {
  requestAnimationFrame(function loop() {
    const { pucks, touches } = table.state()
    for (const p of pucks) {
      // Millimetres in, pixels out. p.angle is radians, 0 = up, clockwise.
      place(el, table.mm(p.mmX), table.mm(p.mmY), p.angle)
    }
    requestAnimationFrame(loop)
  })
})

table.on('puckadd', (p) => openPanelFor(p.markerId))
table.on('touchstart', (t) => {
  const puck = table.nearestPuck(t.mmX, t.mmY, 80)   // millimetres
})
```

In CSS, work in millimetres:

```css
.button { min-width: calc(20 * var(--mm)); }
.ring   { width: calc(var(--puck-d) + 40 * var(--mm)); }
```

Pull state inside a render loop for anything that draws; use events for discrete
moments. Both see the same table.

## Files here

| Path               | What it is                                                      |
| ------------------ | --------------------------------------------------------------- |
| `API.md`           | The complete SDK reference.                                     |
| `PROTOCOL.md`      | The data model and wire format underneath.                      |
| `types/`           | Type declarations, so your editor autocompletes the SDK.         |
| `_template/`       | The smallest thing that works. Copy it, or use **File > New interface…** |
| `dial-demo/`       | A puck as a rotary dial. Start here; it is short.                |
| `radial-atlas/`    | Nested radial menus, and loading images and text from disk.       |
| `arcane-table/`    | A Three.js showcase: bloom, particles, arcs between pucks.        |

Bare specifiers `@planchette/sdk` and `three` resolve with no install. Beyond
that an interface folder is a normal static site: reference any local file at any
depth, and remote `https` URLs too.

## Driving it from the console

**View › Toggle Developer Tools**, then `window.sim` takes millimetres and
degrees. Useful for setting up a scene without juggling the mouse.

```js
sim.addPuck({ markerId: 3, mmX: 600, mmY: 340, angleDeg: 45 })
sim.touch({ mmX: 660, mmY: 340 })
```

The rules below are not style advice. They are the difference between something
that works on a laptop and something that works on a table.
