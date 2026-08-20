# Arcane table

A Three.js showcase: a flowing particle field, procedural runes around every
puck, and electrical arcs between pucks that are near each other.

## The three WebGL-on-a-table traps

All three are in `main.js`, and all three are easy to get wrong:

1. **`setPixelRatio(1)`.** The interface is already laid out at the table's
   native 3840x2160 and the simulator scales the whole surface down for preview.
   Passing `devicePixelRatio` on a retina laptop asks the GPU for 7680x4320, four
   times the pixels the table actually has.
2. **Never `THREE.Line`.** WebGL clamps line width to one pixel, which is 0.3mm
   on this panel and therefore invisible. `lib/ribbon.js` builds every stroke from
   triangles instead, batched into one draw call.
3. **Millimetres.** On a 4K table "12 pixels" is a meaningless quantity.

## Layout

- `lib/ribbon.js` — thick glowing polylines. The reason nothing uses `THREE.Line`.
- `lib/bloom.js` — threshold, blur at quarter resolution, add back. Half-float,
  because additive cores land above 1.0 and an 8-bit target would clip them.
- `lib/runes.js` — deterministic procedural glyphs, so a marker always gets the
  same rune.

Tuning constants are at the top of `main.js`, all in millimetres.
`window.__arcane` carries fps and counts for tuning from the console.

Read `../DESIGN-RULES.md` before changing behaviour. The API is `../API.md`.
