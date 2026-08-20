# Writing interfaces for the table

Everything in this file applies whether you are working in the simulator repo or
in a workspace folder opened from the packaged app. It is the shared contract.

## Writing an app

Pull state for anything that draws, push events for discrete moments.

```js
import { table } from '@planchette/sdk'

table.ready(({ surface }) => {
  requestAnimationFrame(function loop() {
    const { pucks, touches } = table.state()   // frozen snapshot
    for (const p of pucks) {
      // p.mmX / p.mmY are millimetres; p.angle is radians, 0 = up, clockwise.
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

Helpers: `table.mm(v)`, `table.px(v)`, `table.deg(rad)`, `table.rad(deg)`,
`table.puckById(id)`, `table.pucksByMarker(id)`, `table.nearestPuck(mmX, mmY, withinMm)`,
`table.nearestTouch(...)`, `table.surface`, `table.isSolo`.

In CSS, work in millimetres through the variables the SDK publishes:

```css
.button { min-width: calc(20 * var(--mm)); }   /* --mm, --px-per-mm */
.ring   { width: calc(var(--puck-d) + 40 * var(--mm)); }
```

## House rules

These are the habits that laptop-trained instincts get wrong, and the ones that
decide whether an interface survives contact with the real table.

- **Work in millimetres.** The viewport is 3840x2160, not a laptop. A design that
  looks right in a browser window is usually mis-sized on a 55 inch table. Touch
  targets: 15mm minimum, 20mm preferred.
- **No hover states.** There is no cursor on a table. Anything discoverable only
  on hover is invisible.
- **No modal dialogs, no global focus, no single "selected" thing.** Several
  people use this at once. Every interaction must be re-entrant and scoped to a
  specific touch or puck ID. If your app has one `selectedItem` variable, it is
  probably wrong.
- **Content must be orientable.** Users sit on all four sides. Use puck angle, or
  `touch.edge`, to decide which way up something should be.
- **Never draw anything meaningful inside a puck's footprint.** It is a 60mm
  physical object with a hand on it. Put affordances in a ring around it.
  `var(--puck-d)` is the footprint diameter in pixels.
- **Pucks flicker.** Real marker tracking loses a puck when a sleeve passes over
  it. Treat `puckremove` as possibly temporary: start a fade and a grace period
  rather than destroying state immediately.
- **Key by `markerId`, not by `id`.** `id` is a tracking session and changes
  whenever the tracker re-acquires a marker. `markerId` is the physical identity
  of the object. The tradeoff is that two pucks carrying the same marker collapse
  onto one thing; if you hand out duplicate markers, key by `id` and use
  `markerId` plus last-known position to re-associate after a dropout.
- **Never let an event handler depend on your render loop.** This bites in two
  ways, and both fail intermittently, which is the worst way to fail. Do not read
  a value the loop computed (derive it from `table.state()` on demand instead),
  and do not assume the loop has already created whatever object the handler
  wants to touch. Create it on demand in the handler too.

## Driving the simulator

`window.sim` is available on the host page, in millimetres and degrees:

```js
sim.addPuck({ markerId: 3, mmX: 600, mmY: 340, angleDeg: 45 })   // -> id
sim.movePuck(id, { mmX: 700, angleDeg: 90 })
sim.removePuck(id)
sim.touch({ mmX: 600, mmY: 400 })                                 // -> id
sim.moveTouch(id, { mmX: 620 }); sim.endTouch(id)
sim.loadApp('dial-demo'); sim.reload(); sim.clear()
sim.state()
```

## Known constraints

- Events delivered to an app are synthesized, not native browser input. Handlers
  work, but native pinch-zoom, scrolling, and `touch-action` behaviour do not
  fire. Use the SDK, not native gesture behaviour.
- The overlay intercepts the mouse so apps get no direct pointer input, which is
  faithful to a real table. The **Pass mouse** toggle disables that for
  debugging.
- Apps render in a `requestAnimationFrame` loop. In a browser tab that pauses
  when the tab is in the background, which is normal browser behaviour rather
  than a bug. The desktop app turns that throttling off, so it keeps drawing
  while you work in another window.
