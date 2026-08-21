# Embedding a live simulator

Planchette runs in a browser, so a public page can embed a working simulator with
a puck on it rather than a video. This documents the contract a site can rely on.

Read `WEBSITE-STRATEGY.md` for why this matters. The short version: it solves the
trust problem above the fold, and nothing else in this category can do it.

## The artifact

Each release attaches `planchette-web-<version>.zip`. Unpack it anywhere and
serve it as static files. It is built with a relative base, so **no deployment
path is baked in**: the same zip works at `hyperquake.com/planchette/embed/`, at a
preview URL, or in a local folder.

Pin a version. Do not track `main`. Site copy that describes behaviour a release
does not have is worse than no copy, and pinning is what keeps the two honest.

To build one locally:

    npm run pack:web        # writes release/planchette-web-<version>.zip

It needs the `zip` command, so build it on macOS or Linux. The artifact itself is
platform independent.

## The url

    <base>/index.html?embed=1&app=radial-atlas&zoom=0.62&center=0.42,0.5

Same entry and same bundle as the full tool, deliberately. A separate embed page
would be a lookalike that can quietly drift from what people actually download,
and the point of embedding a real simulator is that it is real.

| Parameter | Default | What it does |
| --- | --- | --- |
| `embed` | off | Hides the authoring chrome, disables browser storage, seeds a puck. Presence is enough; no value needed. |
| `app` | `radial-atlas` | Which interface to load. Any folder name in the build. |
| `zoom` | `fit` | `fit` scales the whole surface into the frame. A number between 0.05 and 2 crops instead. |
| `center` | `0.5,0.5` | Normalized point that lands in the middle of the frame. Only used when `zoom` is a number. |
| `puck` | seeded | `puck=none` starts with an empty surface, for a page that would rather script the scene itself. |

## Choosing zoom, which is the one real decision

`zoom=fit` never breaks, which is why it is the default, but it is not usually
what you want. The table is 1218mm wide and laid out at 3840px. In a 760px frame
that is about 19 percent, and at 19 percent nothing on the surface is readable:
interface type is sized in millimetres for someone standing at a table, not for a
thumbnail.

So a legible demo has to crop. There is no universally correct number, because it
depends on the frame the page gives us. Work it out from the type size:

    rendered px = mm of type x 3.1527 x zoom

The examples use roughly 4.6mm type, so `zoom=0.62` renders it at about 9px and
`zoom=0.8` at about 12px. Then check what still fits:

    visible mm = frame px / zoom / 3.1527

A 1080px frame at `zoom=0.62` shows about 553mm of table, which comfortably holds
`radial-atlas`'s rune ring and part of its content stage. The same frame at
`zoom=0.8` shows 428mm and starts cutting the stage off.

`center` then decides what that window contains. The seeded puck sits at
`0.28,0.5` and most examples put shared content in the middle, so a center
somewhere between the two, around `0.42,0.5`, keeps both in frame.

A cropped embed is positioned rather than scrolled, so nothing scrolls under the
visitor's mouse while they are trying to drag a puck.

## Testing it

    npm run smoke:embed

Builds the artifact the way a release does, serves it from a subpath so the
relative base is exercised rather than assumed, frames it in an iframe the way a
real page does, and drives it over the Chrome DevTools Protocol. Nineteen checks,
gating in CI.

The two worth knowing about, because they guard mistakes that are invisible
otherwise:

- **Runtime content loads.** It asserts the interface reports 18 plates, which is
  only true if `content.json` was fetched successfully. A build that ships the
  page without its content passes every other check.
- **A real drag moves the puck the right distance.** It dispatches a stepped
  pointer stream and compares the result in millimetres, which exercises the whole
  chain of page, iframe, cropped surface and scaled transform. It agrees to 0.0mm.

If you write that drag yourself, step it. Two coarse jumps are not a faithful
pointer stream and will give you a wrong answer while the app is tracking
perfectly.

## What the page has to supply

**Tell them to drag the puck.** The simulator does not explain itself, and a
visitor who does not realise the brown circle is draggable sees a static image.
One line next to the frame is enough.

**Give it a real frame.** 1000px wide or more, and at least 500 tall, or use
`fit` and accept that it reads as a diagram rather than a demo.

**Mobile.** The strategy assumes a video fallback, and that is the safe choice.
Worth knowing before committing to it: the host already handles real touch
contacts, so a phone may work better than expected. Test before deciding.

**Content security policy.** The embed is an iframe containing an iframe: the page
frames the host, and the host frames the interface. Both come from the same
static build, so they are same origin, but the site's policy needs to allow
`frame-src 'self'` and inline module scripts for that origin.

## Scripting the demo

`window.sim` is available on the embed's own window, so a page can drive a
scripted scene instead of leaving it to the visitor. It takes millimetres and
degrees. Same origin, so this works from the parent page:

```js
const sim = document.getElementById('sim').contentWindow.sim
sim.addPuck({ markerId: 3, mmX: 600, mmY: 340, angleDeg: 45 })
sim.movePuck(1, { angleDeg: 120 })
```

Combine with `puck=none` to start empty and place everything yourself.

## What embed mode changes, and what it does not

Changed: no topbar, no inspector, no about panel, no `localStorage` or
`sessionStorage`, and one puck already on the surface. The inspector is not merely
hidden, it is never constructed, because it does DOM work every frame.

Unchanged, and this is the point: the surface is still laid out at the table's
true 3840x2160, millimetres are still real, the SDK is the same bundle, and the
interfaces are the same files that run in the desktop app. Scaling keys off the
container rather than the window, so an iframe of any size works with no special
handling.

There are no workspace or filesystem assumptions on this path. The interface list
comes from a build-time glob, and the desktop bridge is simply absent.
