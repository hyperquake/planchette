#!/usr/bin/env python3
"""Regenerate every Planchette identity asset from geometry.

    python3 brand/tools/make-icons.py            # writes into the repo
    python3 brand/tools/make-icons.py --out /tmp # writes somewhere else

Requires: pip install cairosvg pillow

This script is the source of truth for the mark. Nothing in build/, public/ or
brand/*.svg should ever be redrawn by hand or resampled from a raster: change a
constant here and re-run, so every size and format stays in agreement.

Outputs, relative to the output root:
    build/icon.icns          macOS bundle icon, 10 slots, padded canvas
    build/icon.ico           Windows icon, 7 sizes
    build/icon.png           512 full bleed, also the dev window and dock icon
    public/favicon.ico       16, 32, 48
    public/favicon.svg       full bleed tile
    brand/mark-black.svg     bare mark, no tile
    brand/lockup-*.svg       wordmark lockups, live text

Why two masters
---------------
The Poppy ring closes into mush below about 48px, so sizes under 48 use a solid
lens instead. The .icns and .ico each carry both pieces of artwork. Rebuilding
either from a single PNG loses this and the small sizes turn to porridge.

Why two canvases
----------------
macOS expects an inset icon: the tile is 824 inside a 1024 canvas, per the Big
Sur grid, or the icon looks oversized in the dock next to everything else.
Windows and browsers add no margin, so those get the full bleed tile.
"""

import argparse
import math
import os
import struct

import cairosvg
from PIL import Image

# ---------------------------------------------------------------- palette
WHITE = "#ffffff"
BLACK = "#000000"
POPPY = "#f04e23"       # Hyperquake accent. The lens, and nothing else.

# ---------------------------------------------------------------- geometry
S = 1024                # design canvas
TILE_R = 224            # tile corner radius, squircle approximation

# The mark is the convex hull of three circles: a defined point at the top and a
# wide rounded heel. An equilateral triangle was tried first and reads as a
# hazard sign, which is why the radii differ per vertex.
APEX = (512.0, 216.0, 32.0)     # x, y, corner radius
BR = (676.0, 692.0, 156.0)
BL = (348.0, 692.0, 156.0)
VERTS = [APEX, BR, BL]          # clockwise, in screen coordinates

LENS = (512.0, 508.0)
LENS_R = 80.0
RING_W = 24.0
LENS_R_SMALL = LENS_R + 14      # solid lens, for the small master

MARK_VIEWBOX = "192 184 640 664"    # tight bounds of the mark
MARK_W, MARK_H = 640, 664

MAC_INSET = 100                     # (1024 - 824) / 2
MAC_SCALE = 824 / 1024


def _unit(vx, vy):
    L = math.hypot(vx, vy)
    return vx / L, vy / L, L


def _outward_normal(ci, cj):
    """Unit normal of the external tangent between two circles, on the outward
    side of a clockwise polygon. Satisfies d . n = ri - rj."""
    xi, yi, ri = ci
    xj, yj, rj = cj
    ux, uy, L = _unit(xj - xi, yj - yi)
    c = (ri - rj) / L
    s = math.sqrt(max(0.0, 1.0 - c * c))
    return c * ux + s * uy, c * uy + s * (-ux)


def hull_path():
    n = len(VERTS)
    normals = [_outward_normal(VERTS[i], VERTS[(i + 1) % n]) for i in range(n)]
    segs = []
    for i in range(n):
        ci, cj = VERTS[i], VERTS[(i + 1) % n]
        nx, ny = normals[i]
        segs.append((
            (ci[0] + ci[2] * nx, ci[1] + ci[2] * ny),
            (cj[0] + cj[2] * nx, cj[1] + cj[2] * ny),
        ))
    d = [f"M {segs[0][0][0]:.2f} {segs[0][0][1]:.2f}"]
    for i in range(n):
        _, end = segs[i]
        nxt = segs[(i + 1) % n][0]
        cj = VERTS[(i + 1) % n]
        d.append(f"L {end[0]:.2f} {end[1]:.2f}")
        d.append(f"A {cj[2]:.2f} {cj[2]:.2f} 0 0 1 {nxt[0]:.2f} {nxt[1]:.2f}")
    d.append("Z")
    return " ".join(d)


BODY = hull_path()
# Counter-clockwise circle subpath, knocked out with fill-rule="evenodd".
# SVG masks are deliberately avoided: cairosvg does not honour them.
HOLE = (
    f"M {LENS[0] - LENS_R:.2f} {LENS[1]:.2f} "
    f"A {LENS_R:.2f} {LENS_R:.2f} 0 0 0 {LENS[0] + LENS_R:.2f} {LENS[1]:.2f} "
    f"A {LENS_R:.2f} {LENS_R:.2f} 0 0 0 {LENS[0] - LENS_R:.2f} {LENS[1]:.2f} Z"
)


# ------------------------------------------------------------------ pieces
def _svg_open(viewbox=f"0 0 {S} {S}", w=S, h=S, label="Planchette"):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{viewbox}" '
        f'width="{w}" height="{h}" role="img" aria-label="{label}">'
    )


def _tile(fill):
    return (f'<rect x="0" y="0" width="{S}" height="{S}" '
            f'rx="{TILE_R}" ry="{TILE_R}" fill="{fill}"/>')


def _ring():
    return (f'<circle cx="{LENS[0]}" cy="{LENS[1]}" r="{LENS_R + RING_W / 2:.2f}" '
            f'fill="none" stroke="{POPPY}" stroke-width="{RING_W}"/>')


def _body_knockout(fill):
    return f'<path d="{BODY} {HOLE}" fill="{fill}" fill-rule="evenodd"/>'


def inner_ring(tile_fill=WHITE, body_fill=BLACK):
    return _tile(tile_fill) + _body_knockout(body_fill) + _ring()


def inner_small(tile_fill=WHITE, body_fill=BLACK):
    return (_tile(tile_fill) + f'<path d="{BODY}" fill="{body_fill}"/>'
            + f'<circle cx="{LENS[0]}" cy="{LENS[1]}" r="{LENS_R_SMALL}" fill="{POPPY}"/>')


def tile_svg(master="ring", padded=False, inverted=False):
    inner = (inner_ring(BLACK, WHITE) if inverted else inner_ring()) if master == "ring" \
        else (inner_small(BLACK, WHITE) if inverted else inner_small())
    if padded:
        inner = (f'<g transform="translate({MAC_INSET},{MAC_INSET}) '
                 f'scale({MAC_SCALE})">{inner}</g>')
    return _svg_open() + inner + "</svg>"


def mark_svg(fill=BLACK):
    """The bare mark, no tile. The window is a true knockout, so whatever sits
    behind it shows through."""
    return (_svg_open(MARK_VIEWBOX, MARK_W, MARK_H)
            + _body_knockout(fill) + _ring() + "</svg>")


def lockup_svg(horizontal=True, fill=BLACK):
    """Type is live, not outlined: Untitled Sans is licensed. These are for
    development use. The shipped lockup should be outlined artwork made once
    from the licensed font. Ratios: mark height 1.52 cap heights, gap 0.62."""
    cap = 72.0                      # cap height at 100px type, both faces
    mh = cap * 1.52
    mw = mh * MARK_W / MARK_H
    gap = cap * 0.62
    word_w = 469.0                  # "Planchette" at 100px, Helvetica metrics
    font = 'font-family="Untitled Sans, Helvetica, Arial, sans-serif" font-size="100"'
    inner_mark = _body_knockout(fill) + _ring()
    if horizontal:
        w, h = mw + gap + word_w, mh
        inner = (
            f'<svg x="0" y="0" width="{mw:.2f}" height="{mh:.2f}" '
            f'viewBox="{MARK_VIEWBOX}">{inner_mark}</svg>'
            f'<text x="{mw + gap:.2f}" y="{mh / 2 + cap / 2:.2f}" {font} '
            f'fill="{fill}">Planchette</text>'
        )
    else:
        gap_v = mh * 0.42
        w = max(mw, word_w)
        h = mh + gap_v + cap
        inner = (
            f'<svg x="{(w - mw) / 2:.2f}" y="0" width="{mw:.2f}" height="{mh:.2f}" '
            f'viewBox="{MARK_VIEWBOX}">{inner_mark}</svg>'
            f'<text x="{w / 2:.2f}" y="{h:.2f}" text-anchor="middle" {font} '
            f'fill="{fill}">Planchette</text>'
        )
    return _svg_open(f"0 0 {w:.2f} {h:.2f}", f"{w:.0f}", f"{h:.0f}") + inner + "</svg>"


# -------------------------------------------------------------------- raster
def _png(master, size, padded, tmp):
    path = os.path.join(tmp, f"_{master}{'-pad' if padded else ''}-{size}.png")
    cairosvg.svg2png(bytestring=tile_svg(master, padded).encode(),
                     write_to=path, output_width=size, output_height=size)
    return path


# What iconutil emits, and what macOS reads. Small slots take the small master.
ICNS_SLOTS = [
    ("icp4", 16, "small"), ("icp5", 32, "small"),
    ("ic11", 32, "small"), ("ic12", 64, "small"),      # 16@2x, 32@2x
    ("ic07", 128, "ring"), ("ic13", 256, "ring"),      # 128@2x
    ("ic08", 256, "ring"), ("ic14", 512, "ring"),      # 256@2x
    ("ic09", 512, "ring"), ("ic10", 1024, "ring"),     # 512@2x
]


def build_icns(dest, tmp):
    chunks = b""
    for code, size, master in ICNS_SLOTS:
        with open(_png(master, size, True, tmp), "rb") as f:
            data = f.read()
        chunks += code.encode("ascii") + struct.pack(">I", len(data) + 8) + data
    blob = b"icns" + struct.pack(">I", len(chunks) + 8) + chunks
    with open(dest, "wb") as f:
        f.write(blob)


def build_ico(dest, tmp, sizes=(16, 24, 32, 48, 64, 128, 256)):
    frames = [Image.open(_png("small" if s < 48 else "ring", s, False, tmp)).convert("RGBA")
              for s in sizes]
    frames[-1].save(dest, format="ICO",
                    sizes=[(f.width, f.height) for f in frames],
                    append_images=frames[:-1])


# ---------------------------------------------------------------------- main
def main():
    here = os.path.dirname(os.path.abspath(__file__))
    default_root = os.path.abspath(os.path.join(here, "..", ".."))
    ap = argparse.ArgumentParser(description="Regenerate Planchette identity assets.")
    ap.add_argument("--out", default=default_root,
                    help="output root, defaults to the repo root")
    args = ap.parse_args()
    root = args.out

    tmp = os.path.join(root, ".icon-tmp")
    for d in ("build", "public", "brand", tmp):
        os.makedirs(os.path.join(root, d), exist_ok=True)

    build_icns(os.path.join(root, "build", "icon.icns"), tmp)
    build_ico(os.path.join(root, "build", "icon.ico"), tmp)
    build_ico(os.path.join(root, "public", "favicon.ico"), tmp, sizes=(16, 32, 48))

    cairosvg.svg2png(bytestring=tile_svg("ring").encode(),
                     write_to=os.path.join(root, "build", "icon.png"),
                     output_width=512, output_height=512)

    writes = {
        os.path.join("public", "favicon.svg"): tile_svg("ring"),
        os.path.join("brand", "mark-black.svg"): mark_svg(BLACK),
        os.path.join("brand", "mark-white.svg"): mark_svg(WHITE),
        os.path.join("brand", "lockup-horizontal-black.svg"): lockup_svg(True, BLACK),
        os.path.join("brand", "lockup-horizontal-white.svg"): lockup_svg(True, WHITE),
        os.path.join("brand", "lockup-stacked-black.svg"): lockup_svg(False, BLACK),
        os.path.join("brand", "lockup-stacked-white.svg"): lockup_svg(False, WHITE),
    }
    for rel, data in writes.items():
        with open(os.path.join(root, rel), "w") as f:
            f.write(data)

    for name in os.listdir(tmp):
        os.remove(os.path.join(tmp, name))
    os.rmdir(tmp)

    print(f"wrote 4 packaging assets, 2 favicons and 6 brand svgs under {root}")


if __name__ == "__main__":
    main()
