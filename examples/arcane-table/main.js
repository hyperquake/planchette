/**
 * Arcane table.
 *
 * A Three.js showcase: a drifting particle field, a rune ring around every puck,
 * and electrical arcs between pucks that are near each other. Touching the
 * surface throws a shockwave; touching a puck's ring binds the rune the pointer
 * is on.
 *
 * Three things here are specific to designing for a table rather than a page,
 * and all three are easy to get wrong:
 *
 *  1. setPixelRatio(1). The app is already laid out at the table's native
 *     resolution, 3840x2160, and the simulator scales the whole surface down for
 *     preview. Passing devicePixelRatio on a retina laptop would ask the GPU for
 *     7680x4320, four times the pixels the table actually has.
 *  2. Nothing uses THREE.Line. WebGL clamps line width to one pixel, which is
 *     0.3mm on this panel and therefore invisible. See lib/ribbon.js.
 *  3. Every size below is in millimetres. On a 4K table, "12 pixels" is a
 *     meaningless quantity; 12mm is a thing you can see and touch.
 */

import * as THREE from 'three'
import { table } from '@planchette/sdk'
import { Bloom } from './lib/bloom.js'
import { Ribbon } from './lib/ribbon.js'
import { makeRune } from './lib/runes.js'

/* ------------------------------ tuning ------------------------------ */

const RUNE_COUNT = 12
const STEP = (Math.PI * 2) / RUNE_COUNT

const RING_MM = 58 // rune ring radius, clear of the 30mm puck footprint
const RING_BAND_MM = 22 // how close to the ring a touch must land to bind
const RUNE_MM = 19
const STROKE_MM = 1.7
const POINTER_START_MM = 34
const HALO_MM = 104
const TICK_RING_MM = 40

const ARC_NEAR_MM = 95
const ARC_FAR_MM = 430
const TOUCH_LINK_MM = 240
const RIPPLE_MM = 210

const GRACE_MS = 800 // a tracking dropout must not erase a ring
const BOLT_LEVELS = 5 // 2^5 = 32 segments
const BOLT_REFRESH_MS = 70
const JAG = 0.085 // lateral jitter as a fraction of arc length
const PARTICLES = 14000
const SWIRL_MM = 210
const FLOW_SCALE_MM = 260   // spatial wavelength of the drift field
const FLOW_SPEED_MM = 34    // mm per second at full stream
const SPARK_SHARE = 0.16    // fraction of dust that is bigger, brighter, faster
const PULSES_PER_ARC = 3

const AMBER = [1.0, 0.66, 0.26]
const PALE = [1.0, 0.94, 0.82]
const CYAN = [0.55, 0.9, 1.0]
const DUST = [0.62, 0.8, 1.0]

const TAU = Math.PI * 2
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/* ------------------------------ state ------------------------------ */

const canvas = document.getElementById('gl')
const hint = document.getElementById('hint')
const statusEl = document.getElementById('status')

let renderer, scene, camera, bg
let mm = (v) => v // millimetres to pixels; replaced once the surface is known
let runes = [] // shared glyph set, one per ring position

let particles, pPos, pSize, pAlpha, pSpeed
let bloom
let dust, arcs, ring, ringHot, ripplesRibbon

/** markerId -> focus. Keyed by the physical marker, never the session id. */
const foci = new Map()
const ripples = []
/** Cached bolt shapes, so arcs crackle on their own clock rather than strobing. */
const bolts = new Map()

let last = 0
let frames = 0
let fps = 0
let fpsAt = 0
let arcCount = 0

/* ------------------------------ setup ------------------------------ */

table.ready(() => {
  runes = Array.from({ length: RUNE_COUNT }, (_, i) => makeRune(i + 1))

  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false, // 8.3M pixels of additive glow; MSAA is not worth it here
    alpha: false,
    powerPreference: 'high-performance',
  })
  // See note 1 at the top of this file. This line matters more than it looks.
  renderer.setPixelRatio(1)
  renderer.setClearColor(0x05060b, 1)
  renderer.autoClear = false

  bloom = new Bloom(renderer, { strength: 1.25, threshold: 0.42, softness: 0.5, downsample: 4, passes: 2 })

  scene = new THREE.Scene()
  camera = new THREE.OrthographicCamera(0, 1, 0, 1, -100, 100)

  buildBackground()
  buildDust()

  arcs = new Ribbon(7000, { color: CYAN, intensity: 1.15, renderOrder: 1 })
  ring = new Ribbon(3600, { color: AMBER, intensity: 0.95, renderOrder: 2 })
  ringHot = new Ribbon(400, { color: PALE, intensity: 1.4, renderOrder: 3 })
  ripplesRibbon = new Ribbon(900, { color: CYAN, intensity: 1.0, renderOrder: 4 })
  for (const r of [arcs, ring, ringHot, ripplesRibbon]) scene.add(r.mesh)

  resize()
  window.addEventListener('resize', resize)
  requestAnimationFrame(loop)
})

function resize() {
  const s = table.surface
  mm = (v) => v * s.pxPerMm

  // The viewport is the authority on size; the surface is the authority on scale.
  const w = window.innerWidth
  const h = window.innerHeight

  renderer.setSize(w, h, false)
  bloom.setSize(w, h)
  // Ortho in table pixels with y increasing downward, matching the table's own
  // coordinate convention, so a puck at mmX/mmY needs no axis flipping.
  camera.left = 0
  camera.right = w
  camera.top = 0
  camera.bottom = h
  camera.updateProjectionMatrix()

  bg.scale.set(w, h, 1)
  bg.position.set(w / 2, h / 2, -10)

  scatterDust(w, h)
  for (const f of foci.values()) sizeHalo(f)
}

function buildBackground() {
  bg = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({
      uniforms: {
        uInner: { value: new THREE.Vector3(0.1, 0.075, 0.2) },
        uOuter: { value: new THREE.Vector3(0.02, 0.023, 0.043) },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform vec3 uInner; uniform vec3 uOuter; varying vec2 vUv;
        void main() {
          float d = clamp(length(vUv - 0.5) * 1.55, 0.0, 1.0);
          gl_FragColor = vec4(mix(uInner, uOuter, d), 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    }),
  )
  bg.renderOrder = -1
  scene.add(bg)
}

/* ------------------------------ dust ------------------------------ */

function buildDust() {
  pPos = new Float32Array(PARTICLES * 3)
  pSize = new Float32Array(PARTICLES)
  pAlpha = new Float32Array(PARTICLES)
  pSpeed = new Float32Array(PARTICLES)

  particles = new THREE.BufferGeometry()
  particles.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage))
  particles.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1))
  particles.setAttribute('aAlpha', new THREE.BufferAttribute(pAlpha, 1))

  dust = new THREE.Points(
    particles,
    new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Vector3(...DUST) } },
      vertexShader: `
        attribute float aSize; attribute float aAlpha;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize;
        }`,
      fragmentShader: `
        uniform vec3 uColor; varying float vAlpha;
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.0, r);
          // Squared falloff for a soft mote, plus a hot centre for the bloom
          // pass to catch.
          gl_FragColor = vec4(uColor, (a * a * 0.8 + pow(a, 8.0) * 0.6) * vAlpha);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    }),
  )
  dust.frustumCulled = false
  scene.add(dust)
}

function scatterDust(w, h) {
  for (let i = 0; i < PARTICLES; i++) {
    pPos[i * 3] = Math.random() * w
    pPos[i * 3 + 1] = Math.random() * h
    pPos[i * 3 + 2] = 0
    const spark = Math.random() < SPARK_SHARE
    pSize[i] = mm(spark ? 1.6 + Math.random() * 2.2 : 0.5 + Math.random() * 1.1)
    pAlpha[i] = spark ? 0.55 + Math.random() * 0.45 : 0.14 + Math.random() * 0.34
    pSpeed[i] = spark ? 1.5 + Math.random() * 1.2 : 0.5 + Math.random() * 0.8
  }
  particles.attributes.aSize.needsUpdate = true
  particles.attributes.aAlpha.needsUpdate = true
}

/**
 * Integrate every mote through a velocity field, wrapping at the edges, so the
 * dust genuinely streams across the table instead of jiggling around a fixed
 * home position. The field is layered sines rather than real curl noise: it is
 * divergence-free enough to look like flow and costs a handful of multiplies.
 */
function updateDust(now, dt) {
  const w = window.innerWidth
  const h = window.innerHeight
  const t = now * 0.00019
  const k = 1 / mm(FLOW_SCALE_MM)
  const speed = mm(FLOW_SPEED_MM)
  const swirl = mm(SWIRL_MM)
  const active = [...foci.values()]

  for (let i = 0; i < PARTICLES; i++) {
    let x = pPos[i * 3]
    let y = pPos[i * 3 + 1]

    const fx = x * k
    const fy = y * k
    let vx = Math.sin(fy * 1.7 + t) + 0.6 * Math.sin(fy * 3.1 - t * 1.7) + 0.3 * Math.cos(fx * 2.3 + t * 0.6)
    let vy = Math.cos(fx * 1.9 - t * 1.2) + 0.6 * Math.cos(fx * 2.7 + t * 0.9) + 0.3 * Math.sin(fy * 2.1 - t * 0.5)
    vx *= speed * pSpeed[i]
    vy *= speed * pSpeed[i]

    // Pucks stir the field: a vortex, plus a slight push outward so dust does
    // not pool under the puck, where a hand hides it anyway.
    for (let j = 0; j < active.length; j++) {
      const f = active[j]
      const dx = x - f.x
      const dy = y - f.y
      const d = Math.hypot(dx, dy)
      if (d > swirl || d < 1) continue
      const g = 1 - d / swirl
      const s2 = g * g * f.alpha
      vx += (-dy / d) * s2 * mm(150) + (dx / d) * s2 * mm(26)
      vy += (dx / d) * s2 * mm(150) + (dy / d) * s2 * mm(26)
    }

    // Shockwaves shove the field outward as they pass.
    for (let j = 0; j < ripples.length; j++) {
      const r = ripples[j]
      const dx = x - r.x
      const dy = y - r.y
      const d = Math.hypot(dx, dy)
      const band = mm(34)
      const off = Math.abs(r.radius - d)
      if (d < 1 || off > band) continue
      const s2 = (1 - off / band) * (1 - r.age) * r.strength
      vx += (dx / d) * s2 * mm(420)
      vy += (dy / d) * s2 * mm(420)
    }

    x += vx * dt
    y += vy * dt

    // Wrap, so the field never empties out at the downstream edge.
    if (x < 0) x += w
    else if (x > w) x -= w
    if (y < 0) y += h
    else if (y > h) y -= h

    pPos[i * 3] = x
    pPos[i * 3 + 1] = y
  }
  particles.attributes.position.needsUpdate = true
}

/* ------------------------------ foci ------------------------------ */

const haloGeometry = () => new THREE.PlaneGeometry(1, 1)

function createFocus(markerId) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Vector3(0.35, 0.28, 0.62) },
      uAlpha: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uAlpha; varying vec2 vUv;
      void main() {
        float d = clamp(length(vUv - 0.5) * 2.0, 0.0, 1.0);
        float a = pow(smoothstep(1.0, 0.0, d), 2.6);
        gl_FragColor = vec4(uColor, a * uAlpha);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(haloGeometry(), material)
  mesh.renderOrder = 0
  scene.add(mesh)

  const f = {
    markerId,
    x: 0,
    y: 0,
    mmX: 0,
    mmY: 0,
    angle: 0,
    active: 0,
    locked: null,
    alpha: 0,
    removedAt: 0,
    mesh,
    material,
  }
  sizeHalo(f)
  foci.set(markerId, f)
  return f
}

function sizeHalo(f) {
  const d = mm(HALO_MM) * 2
  f.mesh.scale.set(d, d, 1)
}

function syncFoci(pucks, now, dt) {
  const seen = new Set()

  for (const p of pucks) {
    seen.add(p.markerId)
    const f = foci.get(p.markerId) ?? createFocus(p.markerId)
    f.mmX = p.mmX
    f.mmY = p.mmY
    f.x = mm(p.mmX)
    f.y = mm(p.mmY)
    f.angle = p.angle
    f.active = Math.round(p.angle / STEP) % RUNE_COUNT
    // Rotating off a bound rune releases it.
    if (f.locked !== null && f.locked !== f.active) f.locked = null
    f.removedAt = 0
    f.alpha = Math.min(1, f.alpha + dt * 3.5)
    f.mesh.position.set(f.x, f.y, -1)
    f.material.uniforms.uAlpha.value = f.alpha * (f.locked !== null ? 0.72 : 0.5)
  }

  for (const [id, f] of foci) {
    if (seen.has(id)) continue
    // Real marker tracking flickers. Fade rather than delete, so a sleeve
    // passing over a puck does not wipe out what the user was doing.
    if (!f.removedAt) f.removedAt = now
    f.alpha = clamp01(1 - (now - f.removedAt) / GRACE_MS)
    f.material.uniforms.uAlpha.value = f.alpha * 0.5
    if (f.alpha <= 0) {
      scene.remove(f.mesh)
      f.mesh.geometry.dispose()
      f.material.dispose()
      foci.delete(id)
    }
  }
}

/* ------------------------------ rune rings ------------------------------ */

function buildRings() {
  ring.begin()
  ringHot.begin()

  for (const f of foci.values()) {
    const ringPx = mm(RING_MM)

    for (let i = 0; i < RUNE_COUNT; i++) {
      const a = i * STEP
      const cx = f.x + Math.sin(a) * ringPx
      const cy = f.y - Math.cos(a) * ringPx
      const on = i === f.active
      const locked = f.locked === i
      const target = locked || on ? ringHot : ring
      const scale = mm(RUNE_MM) * (on ? 1.0 : 0.78)
      const width = mm(STROKE_MM) * (on ? 1.35 : 1)
      const alpha = (locked ? 1 : on ? 0.95 : 0.5) * f.alpha

      // Rotate each glyph so its own "up" points away from the puck: a radial
      // menu on a table has no single correct orientation, and users stand on
      // all four sides.
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      for (const [x0, y0, x1, y1] of runes[i]) {
        target.segment(
          cx + (x0 * ca + y0 * sa) * scale,
          cy + (x0 * sa - y0 * ca) * scale,
          cx + (x1 * ca + y1 * sa) * scale,
          cy + (x1 * sa - y1 * ca) * scale,
          width,
          alpha,
        )
      }
    }

    // The ring itself. Faint, but it is what makes twelve floating glyphs read
    // as a single dial rather than scattered debris.
    {
      const pts = []
      for (let k = 0; k < 72; k++) {
        const a = (k / 72) * TAU
        pts.push([f.x + Math.cos(a) * ringPx, f.y + Math.sin(a) * ringPx])
      }
      ring.polyline(pts, mm(0.9), 0.22 * f.alpha, true)
    }

    // Pointer, from clear of the footprint out to the active rune.
    const pa = f.angle
    const from = mm(POINTER_START_MM)
    const to = ringPx - mm(RUNE_MM) * 0.55
    ringHot.segment(
      f.x + Math.sin(pa) * from,
      f.y - Math.cos(pa) * from,
      f.x + Math.sin(pa) * to,
      f.y - Math.cos(pa) * to,
      mm(1.5),
      0.15 * f.alpha,
      0.95 * f.alpha,
    )

    // Decorative tick ring. Carries no information on purpose: it sits partly
    // under the hand, where nothing readable belongs.
    const tickR = mm(TICK_RING_MM)
    const spin = performance.now() * 0.00012
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * TAU - spin
      const long = i % 3 === 0
      const r0 = tickR
      const r1 = tickR + mm(long ? 3.2 : 1.6)
      ring.segment(
        f.x + Math.sin(a) * r0,
        f.y - Math.cos(a) * r0,
        f.x + Math.sin(a) * r1,
        f.y - Math.cos(a) * r1,
        mm(1.0),
        (long ? 0.65 : 0.32) * f.alpha,
      )
    }
  }

  ring.end()
  ringHot.end()
}

/* ------------------------------ arcs ------------------------------ */

/** Fractal midpoint displacement in normalized (along, across) space. */
function boltShape(levels) {
  let pts = [
    { t: 0, off: 0 },
    { t: 1, off: 0 },
  ]
  for (let level = 0; level < levels; level++) {
    const next = []
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      next.push(a)
      const span = b.t - a.t
      next.push({ t: (a.t + b.t) / 2, off: (a.off + b.off) / 2 + (Math.random() - 0.5) * span })
    }
    next.push(pts[pts.length - 1])
    pts = next
  }
  return pts
}

function boltFor(key, now) {
  let b = bolts.get(key)
  if (!b || now - b.at > BOLT_REFRESH_MS) {
    b = {
      at: now,
      main: boltShape(BOLT_LEVELS),
      fork: Math.random() < 0.7 ? { t: 0.3 + Math.random() * 0.4, side: Math.random() < 0.5 ? -1 : 1, shape: boltShape(3) } : null,
    }
    bolts.set(key, b)
  }
  return b
}

/** Draw one bolt as three passes: wide haze, body, bright core. */
function drawBolt(x0, y0, x1, y1, bolt, strength, scale = 1) {
  const dx = x1 - x0
  const dy = y1 - y0
  const len = Math.hypot(dx, dy)
  if (len < 1) return
  const ux = dx / len
  const uy = dy / len
  const nx = -uy
  const ny = ux

  const pt = (o) => [
    x0 + ux * len * o.t + nx * len * o.off * JAG,
    y0 + uy * len * o.t + ny * len * o.off * JAG,
  ]
  const path = bolt.main.map(pt)

  arcs.polyline(path, mm(14) * scale, 0.12 * strength)
  arcs.polyline(path, mm(5) * scale, 0.2 * strength)
  arcs.polyline(path, mm(1.9) * scale, 0.55 * strength)
  arcs.polyline(path, mm(0.8) * scale, 1.0 * strength)

  // Pulses running the length of the bolt, so an arc reads as flowing rather
  // than as a static jagged line.
  const span = 5
  for (let p = 0; p < PULSES_PER_ARC; p++) {
    const phase = (performance.now() * 0.0007 + p / PULSES_PER_ARC) % 1
    const head = Math.floor(phase * (path.length - span))
    for (let i = head; i < head + span && i < path.length - 1; i++) {
      const fade = 1 - (i - head) / span
      arcs.segment(
        path[i][0], path[i][1], path[i + 1][0], path[i + 1][1],
        mm(3.4) * scale * fade, 1.1 * strength * fade,
      )
    }
  }

  if (bolt.fork) {
    const base = pt({ t: bolt.fork.t, off: 0 })
    const flen = len * 0.28
    const ex = base[0] + (ux * 0.4 + nx * bolt.fork.side) * flen
    const ey = base[1] + (uy * 0.4 + ny * bolt.fork.side) * flen
    const fdx = ex - base[0]
    const fdy = ey - base[1]
    const fl = Math.hypot(fdx, fdy) || 1
    const fux = fdx / fl
    const fuy = fdy / fl
    const fpath = bolt.fork.shape.map((o) => [
      base[0] + fux * fl * o.t - fuy * fl * o.off * JAG,
      base[1] + fuy * fl * o.t + fux * fl * o.off * JAG,
    ])
    arcs.polyline(fpath, mm(2.2) * scale, 0.4 * strength)
    arcs.polyline(fpath, mm(0.8) * scale, 0.9 * strength)
  }
}

function buildArcs(now, touches) {
  arcs.begin()
  arcCount = 0

  const list = [...foci.values()]
  const ringPx = mm(RING_MM)

  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]
      const b = list[j]
      const dmm = Math.hypot(a.mmX - b.mmX, a.mmY - b.mmY)
      if (dmm > ARC_FAR_MM) continue

      // Keep a floor: a linear falloff made every arc at realistic puck spacing
      // too faint to notice, which defeated the point of drawing them.
      const near = clamp01(1 - (dmm - ARC_NEAR_MM) / (ARC_FAR_MM - ARC_NEAR_MM))
      const strength = (0.45 + 0.55 * near) * a.alpha * b.alpha
      if (strength < 0.02) continue

      // Start and end on the ring, never crossing the puck footprint.
      const ux = (b.x - a.x) / (mm(dmm) || 1)
      const uy = (b.y - a.y) / (mm(dmm) || 1)
      drawBolt(
        a.x + ux * ringPx,
        a.y + uy * ringPx,
        b.x - ux * ringPx,
        b.y - uy * ringPx,
        boltFor(`${a.markerId}:${b.markerId}`, now),
        strength,
      )
      arcCount++
    }
  }

  // A held contact channels to the nearest focus.
  for (const t of touches) {
    const p = table.nearestPuck(t.mmX, t.mmY, TOUCH_LINK_MM)
    if (!p) continue
    const f = foci.get(p.markerId)
    if (!f) continue
    const dmm = Math.hypot(t.mmX - p.mmX, t.mmY - p.mmY)
    if (dmm < RING_MM * 0.5) continue
    const strength = clamp01(1 - dmm / TOUCH_LINK_MM) * f.alpha
    const ux = (f.x - mm(t.mmX)) / (mm(dmm) || 1)
    const uy = (f.y - mm(t.mmY)) / (mm(dmm) || 1)
    drawBolt(
      mm(t.mmX),
      mm(t.mmY),
      f.x - ux * mm(RING_MM),
      f.y - uy * mm(RING_MM),
      boltFor(`t${t.id}:${p.markerId}`, now),
      strength * 0.9,
      0.7,
    )
    arcCount++
  }

  arcs.end()
}

/* ------------------------------ ripples ------------------------------ */

function spawnRipple(mmX, mmY, maxMm, strength) {
  ripples.push({ x: mm(mmX), y: mm(mmY), t0: performance.now(), maxPx: mm(maxMm), radius: 0, age: 0, strength })
}

function updateRipples(now) {
  ripplesRibbon.begin()
  for (let i = ripples.length - 1; i >= 0; i--) {
    const r = ripples[i]
    const age = (now - r.t0) / 900
    if (age >= 1) {
      ripples.splice(i, 1)
      continue
    }
    r.age = age
    // Ease out, so the wave leaves fast and settles.
    r.radius = r.maxPx * (1 - Math.pow(1 - age, 2.4))
    const alpha = (1 - age) * (1 - age) * 0.85 * r.strength

    const pts = []
    const steps = 44
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * TAU
      pts.push([r.x + Math.cos(a) * r.radius, r.y + Math.sin(a) * r.radius])
    }
    ripplesRibbon.polyline(pts, mm(1.6) * (1 - age * 0.55), alpha, true)
  }
  ripplesRibbon.end()
}

/* ------------------------------ input ------------------------------ */

table.on('touchstart', (t) => {
  spawnRipple(t.mmX, t.mmY, RIPPLE_MM, 1)

  const p = table.nearestPuck(t.mmX, t.mmY, RING_MM + RING_BAND_MM)
  if (!p) return
  const d = Math.hypot(t.mmX - p.mmX, t.mmY - p.mmY)
  if (Math.abs(d - RING_MM) > RING_BAND_MM) return

  const f = foci.get(p.markerId)
  if (!f) return
  // Derive the rune from the puck's angle right now. Reading a value the render
  // loop computes would sometimes read the previous frame's.
  const index = Math.round(p.angle / STEP) % RUNE_COUNT
  f.locked = index
  const a = index * STEP
  spawnRipple(p.mmX + Math.sin(a) * RING_MM, p.mmY - Math.cos(a) * RING_MM, 52, 0.8)
})

table.on('puckadd', (p) => spawnRipple(p.mmX, p.mmY, 120, 0.6))

/* ------------------------------ loop ------------------------------ */

function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.05)
  last = now

  const state = table.state()
  syncFoci(state.pucks, now, dt)
  updateDust(now, dt)
  buildRings()
  buildArcs(now, state.touches)
  updateRipples(now)

  bloom.render(scene, camera)

  frames++
  if (now - fpsAt > 500) {
    fps = Math.round((frames * 1000) / (now - fpsAt))
    frames = 0
    fpsAt = now
  }

  hint.style.opacity = foci.size ? '0' : '1'
  const bound = [...foci.values()].filter((f) => f.locked !== null).length
  statusEl.textContent = `${table.surface.label}  |  ${foci.size} foci  |  ${arcCount} arcs  |  ${bound} bound  |  ${fps} fps`

  // Handy from the simulator's console when tuning.
  window.__arcane = {
    fps,
    foci: foci.size,
    arcs: arcCount,
    dust: PARTICLES,
    dustSample: [pPos[0], pPos[1], pSize[0], pAlpha[0]],
    bloom: bloom.enabled,
    pxPerMm: table.surface.pxPerMm,
  }

  requestAnimationFrame(loop)
}
