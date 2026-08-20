# Identity assets

This folder holds the Planchette mark and wordmark. If you are changing an icon,
a favicon, a lockup, or anything about how the product presents itself, read this
first. If you are working on the simulator, the root [`CLAUDE.md`](../CLAUDE.md)
is the file you want.

Planchette is a Hyperquake tool, not a brand of its own, so the identity stays
deliberately quiet: brand typeface, no custom letterforms, no second accent.

    python3 brand/tools/make-icons.py     # regenerate every asset from geometry

## The one rule

**Nothing here is drawn by hand and nothing is resampled from a raster.**
`brand/tools/make-icons.py` is the source of truth. Change a constant, re-run,
commit what it writes. If you need a size or format the script does not emit, add
it to the script rather than exporting it some other way, or the sizes drift
apart and nobody notices until a build looks wrong.

The script writes outside this folder as well, which is deliberate, because those
are generated artifacts of the same geometry:

| Path | What it is |
| --- | --- |
| `build/icon.icns` | macOS bundle icon, 10 slots, padded canvas |
| `build/icon.ico` | Windows icon, 7 sizes |
| `build/icon.png` | 512 full bleed, also read by `devIcon()` in `electron/main.js` |
| `public/favicon.ico` | 16, 32, 48 |
| `public/favicon.svg` | full bleed tile |
| `brand/mark-*.svg` | the bare mark, no tile |
| `brand/lockup-*.svg` | wordmark lockups, live text |

`build/` is discovered by electron-builder because `electron-builder.yml` sets
`buildResources: build`, and the filenames `icon.icns` and `icon.ico` are the
ones it looks for. **Do not add a `mac.icon`, `win.icon`, or top-level `icon:`
key.** Adding one is how this breaks.

`public/` is copied to the root of `dist/` by Vite, so the favicons resolve
identically under the dev server and under `planchette://host`. Keep the
references in `index.html` root-absolute (`/favicon.svg`), and do not move them
into `src/host/`.

## Two things that look like mistakes and are not

**Each icon carries two pieces of artwork, not one scaled seven ways.** The Poppy
ring around the lens closes into mush below about 48px, so sizes under 48 use a
solid lens instead. The `.icns` and `.ico` both contain the pair. Rebuilding
either from a single PNG loses this.

**The `.icns` art is inset and the others are not.** macOS expects the tile to be
824 inside a 1024 canvas, per the Big Sur icon grid; without that margin the icon
looks oversized in the dock next to every other app. Windows and browsers add no
margin, so they get the full bleed tile. Do not "fix" one to match the other.

One consequence worth knowing: the dev dock icon on macOS uses `build/icon.png`,
which is full bleed, so in `npm run electron:dev` it sits slightly larger than
its neighbours. A padded 512 is available if that ever matters enough to add a
second file.

## The mark

The body is the convex hull of three circles: a 32px radius point at the top and
two 156px radius corners forming a wide heel, with a flat tangent across the
base. That asymmetry is the whole design. An equilateral triangle was tried
first and reads as a hazard sign.

The lens is knocked clean through with `fill-rule="evenodd"`, never with an SVG
mask. Masks were tried and cairosvg does not honour them, which fails silently
by rendering a filled square.

## Colour and type

Hyperquake primary palette only: white `#ffffff`, black `#000000`, and Poppy
`#f04e23`. Poppy is the lens and nothing else. Never a Poppy mark, never Poppy
type, one accent per view. The squint test is white, black, one pop of Poppy.

Type is Untitled Sans Regular, falling back to Helvetica, in sentence case,
never tracked out, never all caps. The name is a proper noun: Planchette, not
PLANCHETTE.

There is no parallelogram anywhere in the mark, which is deliberate. Hyperquake's
shape language forbids rounded corners, and this mark is nothing but rounded
corners, so the two systems stay separate instead of fighting. Do not add one.

## Lockups

`lockup-horizontal-*.svg` is the default and the only one that belongs in the
product UI, a site header, or a docs page. The mark stands 1.52 cap heights tall
with a 0.62 cap height gap, and its optical centre sits on the cap band.

The stacked lockup is for square spaces: an avatar, a splash screen, a dmg
window. Do not substitute it into a horizontal space.

Clear space is one mark height on all sides of the whole lockup. Below about
120px wide, or 17px type, drop the type and use the mark alone.

**The lockup SVGs contain live text**, because Untitled Sans is licensed and
cannot be embedded here. They render correctly on a machine with the font and
fall back to Helvetica elsewhere, which is approved but is not the same drawing.
Treat them as development assets. The shipped lockup should be outlined once from
the licensed font and then used as artwork, so a missing font can never quietly
change it. That outlining has not been done yet.

## Reference

`reference/icon-review.html` and `reference/wordmark-review.html` are the review
sheets these decisions came from: the treatments considered, the legibility
ladder, clear space, and the explicit don'ts. They are documentation, not build
inputs, and they are self-contained so they open with no server.

Website positioning, audience, page map and launch risks live in
[`docs/WEBSITE-STRATEGY.md`](../docs/WEBSITE-STRATEGY.md). Read it before
building any public page for this tool. The short version: canonical URL is
`hyperquake.com/planchette`, the landing page should embed a working simulator
rather than a video, and the mac build must be signed and notarized before any
public launch, because Gatekeeper tells strangers an ad-hoc signed app is
damaged.

## Dependencies

The generator needs Python 3 with `cairosvg` and `pillow`. It is not wired into
`npm run build` on purpose: assets change rarely, and a packaging build should
not depend on a Python toolchain being present.

    brew install cairo          # cairosvg binds to the system library
    pip install cairosvg pillow

If `import cairosvg` fails with an OSError about `libcairo`, that is the Homebrew
library missing rather than a Python problem. The assets are committed, so a
machine without the toolchain can still build and package the app; it just cannot
regenerate them.
