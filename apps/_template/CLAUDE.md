# Writing a table app

This folder is a starting point. Copy it, rename it, and edit `index.html` and
`main.js`. Whatever you name the folder shows up in the simulator's app picker
automatically.

In the desktop app, **New app...** in the Workspace panel does the copying for
you. Working in the repo, copy this folder to `apps/<your-name>`.

Read the `CLAUDE.md` next to this folder for the house rules. They matter more
than the API does.

## The shape of an app

Two files. No build step, no framework, plain JS modules. `index.html` holds the
markup and CSS, `main.js` imports `@table/sdk` and reacts to the table.

Everything you draw is laid out at the table's real resolution (3840x2160 by
default) and scaled down for preview, so one CSS pixel here is one real table
pixel. Size things in millimetres via `var(--mm)` in CSS or `table.mm()` in JS.

## Choosing how to render

- **DOM plus CSS transforms** is the default and the most productive choice for
  panels, cards, labels, and menus. It is GPU composited and easy to reason
  about. Both example apps do this.
- **Canvas 2D** for custom drawing that is not made of discrete elements.
- **Pixi.js** if you need hundreds of animated objects.
- **Three.js** only if you actually need 3D or shaders.

## The two ways to get data

Pull inside a render loop, which is what you want for anything that draws:

```js
const { pucks, touches } = table.state()
```

Push for discrete moments, which is what you want for DOM UI:

```js
table.on('puckadd', (p) => {})
table.on('puckmove', (p) => {})
table.on('puckremove', (p) => {})
table.on('touchstart', (t) => {})
table.on('touchmove', (t) => {})
table.on('touchend', (t) => {})
```

Both see the same table. `table.state()` is always at least as fresh as the
event currently being handled, so it is safe to call from inside a handler.

## Testing without the simulator

Open the app's URL directly (`/apps/<your-name>/index.html`) and the SDK falls
back to solo mode: one draggable puck, wheel to rotate, `P` adds another, `X`
removes one. The surface it reports is your browser window at the table's real
px/mm, so millimetre sizing stays honest and you are simply working on a smaller
table.
