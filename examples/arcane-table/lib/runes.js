/**
 * Procedural runes.
 *
 * Each rune is a handful of strokes in a -1..1 box: a vertical stave with
 * branches hung off it, which is roughly how Elder Futhark is put together. They
 * are generated rather than drawn so a marker always gets the same glyph without
 * anyone shipping a font or a sprite sheet.
 */

/** Small deterministic PRNG, so rune N is always rune N. */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const clamp = (v) => (v < -1 ? -1 : v > 1 ? 1 : v)

/**
 * @param {number} seed
 * @returns {number[][]} strokes as [x0, y0, x1, y1] in a -1..1 box
 */
export function makeRune(seed) {
  const rnd = mulberry32(seed * 2654435761)
  const strokes = []

  // The stave. A slight lean makes a set of runes look hand-cut.
  const lean = (rnd() - 0.5) * 0.24
  strokes.push([-lean, -1, lean, 1])

  const branches = 2 + Math.floor(rnd() * 3)
  for (let i = 0; i < branches; i++) {
    const h = clamp(-0.75 + rnd() * 1.5)
    const side = rnd() < 0.5 ? -1 : 1
    const reach = 0.4 + rnd() * 0.3
    const kind = Math.floor(rnd() * 4)

    if (kind === 0) {
      strokes.push([0, h, side * reach, clamp(h + 0.45)])
    } else if (kind === 1) {
      strokes.push([0, h, side * reach, clamp(h - 0.45)])
    } else if (kind === 2) {
      strokes.push([0, h, side * reach, h])
    } else {
      // Chevron: out and back, the most rune-like of the four.
      const mid = clamp(h + 0.32)
      strokes.push([0, h, side * reach, mid])
      strokes.push([side * reach, mid, 0, clamp(h + 0.64)])
    }
  }

  // Occasionally a full crossbar, which breaks up the silhouette.
  if (rnd() < 0.28) {
    const h = clamp(-0.5 + rnd() * 1)
    strokes.push([-0.5, h, 0.5, h])
  }

  return strokes
}
