/**
 * The reel, scene by scene. Each scene is a page and a choreography.
 *
 * `setup` and `frame` are serialized and run inside the page, so they must be
 * self-contained: no closures over this module. `frame(t, s)` runs once per video
 * frame with the scene time in seconds and a scratch object that persists across
 * frames. Positions are millimetres on the 55" table (1218 x 685), angles are
 * degrees with 0 up and clockwise positive, all through window.sim.
 *
 * `card: true` marks a title card: in reel.mp4, which is for sharing, and left out
 * of loop.mp4, which plays on the page under a headline that already says it.
 *
 * `posterAt` (first scene that has one) picks the page's poster frame, and `still`
 * writes media/<id>.jpg for the examples gallery. Both are seconds into the scene.
 *
 * `inject`, if present, runs in every frame of every page before it loads, for
 * recording-only hooks; it must check which page it is on.
 *
 * `setup` installs window.__k, a small keyframe helper:
 *   __k(t, [[t0, v0], [t1, v1], ...])  eased value at time t
 */
export const FPS = 30
export const WIDTH = 1920
export const HEIGHT = 1080

const embed = (app, extra = '') => `/index.html?embed=1&puck=none&app=${app}${extra}`

function prelude() {
  sim.clear()
  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
  window.__k = (t, keys) => {
    if (t <= keys[0][0]) return keys[0][1]
    for (let i = 1; i < keys.length; i++) {
      const [t1, v1] = keys[i]
      const [t0, v0] = keys[i - 1]
      if (t <= t1) return v0 + (v1 - v0) * ease((t - t0) / (t1 - t0))
    }
    return keys[keys.length - 1][1]
  }
  /** A touch that exists between t0 and t1, following a path of [t, x, y] keys. */
  window.__touch = (s, key, t, t0, t1, keys) => {
    const live = t >= t0 && t < t1
    if (live && !s[key]) s[key] = sim.touch({ mmX: keys[0][1], mmY: keys[0][2] })
    if (live && keys.length > 1) {
      sim.moveTouch(s[key], {
        mmX: __k(
          t,
          keys.map(([kt, x]) => [kt, x]),
        ),
        mmY: __k(
          t,
          keys.map(([kt, , y]) => [kt, y]),
        ),
      })
    }
    if (!live && s[key]) {
      sim.endTouch(s[key])
      s[key] = 0
    }
  }
}

export const SCENES = [
  {
    id: 'title',
    card: true,
    url: '/cards/title.html',
    seconds: 3,
    settleMs: 800,
  },
  {
    id: 'arcane-table',
    url: embed('arcane-table', '&zoom=0.72&center=0.41,0.6'),
    seconds: 9,
    posterAt: 6,
    still: 6.5,
    setup: prelude,
    frame(t, s) {
      if (!s.a) s.a = sim.addPuck({ markerId: 1, mmX: 330, mmY: 360, angleDeg: 0 })
      sim.movePuck(s.a, { mmX: 330 + 40 * Math.sin(t * 0.5), mmY: 360 + 20 * Math.sin(t * 0.7), angleDeg: t * 22 })

      if (t >= 1.2 && !s.b) s.b = sim.addPuck({ markerId: 2, mmX: 1000, mmY: 190, angleDeg: 40 })
      if (s.b)
        sim.movePuck(s.b, {
          mmX: __k(t, [
            [1.2, 1000],
            [4.2, 650],
          ]),
          mmY: __k(t, [
            [1.2, 190],
            [4.2, 290],
          ]),
          angleDeg: __k(t, [
            [1.2, 40],
            [9, -90],
          ]),
        })

      if (t >= 3.6 && !s.c) s.c = sim.addPuck({ markerId: 3, mmX: 620, mmY: 590, angleDeg: 0 })
      if (s.c)
        sim.movePuck(s.c, {
          mmX: __k(t, [
            [3.6, 620],
            [7, 520],
          ]),
          mmY: __k(t, [
            [3.6, 590],
            [7, 520],
          ]),
          angleDeg: __k(t, [
            [3.6, 0],
            [9, 140],
          ]),
        })

      __touch(
        s,
        'f',
        t,
        5.2,
        8.2,
        [
          [5.2, 900],
          [8.2, 760],
        ].map(([kt, x]) => [kt, x, 480 - (x - 760) * 0.4]),
      )
    },
  },
  {
    id: 'radial-atlas',
    url: embed('radial-atlas', '&zoom=1.05&center=0.43,0.47'),
    seconds: 11,
    still: 8,
    setup: prelude,
    frame(t, s) {
      const X = 380
      const Y = 340
      if (!s.p) s.p = sim.addPuck({ markerId: 1, mmX: X, mmY: Y, angleDeg: 0 })
      const angle = __k(t, [
        [0.5, 0],
        [2.6, 100],
        [3.9, 100],
        [5.6, 165],
        [11, 175],
      ])
      sim.movePuck(s.p, { angleDeg: angle })
      // Touch the inner ring to drill in, then the outer ring to open a plate.
      const at = (r, deg) => [X + r * Math.sin((deg * Math.PI) / 180), Y - r * Math.cos((deg * Math.PI) / 180)]
      const [ix, iy] = at(64, 230)
      __touch(s, 'in', t, 3.0, 3.35, [[3.0, ix, iy]])
      const [ox, oy] = at(118, 250)
      __touch(s, 'out', t, 6.2, 6.55, [[6.2, ox, oy]])
    },
  },
  {
    id: 'dial-demo',
    url: embed('dial-demo', '&zoom=0.95&center=0.505,0.56'),
    seconds: 7,
    still: 4.5,
    setup: prelude,
    frame(t, s) {
      if (!s.a) s.a = sim.addPuck({ markerId: 1, mmX: 430, mmY: 360, angleDeg: 0 })
      if (!s.b) s.b = sim.addPuck({ markerId: 2, mmX: 800, mmY: 330, angleDeg: 90 })
      sim.movePuck(s.a, {
        angleDeg: __k(t, [
          [0.3, 0],
          [2.2, 135],
          [4.6, 135],
          [6.2, 225],
        ]),
      })
      sim.movePuck(s.b, {
        angleDeg: __k(t, [
          [0.8, 90],
          [3.0, -45],
        ]),
      })
      const at = (x, y, deg) => [x + 62 * Math.sin((deg * Math.PI) / 180), y - 62 * Math.cos((deg * Math.PI) / 180)]
      const [ax, ay] = at(430, 360, 135)
      __touch(s, 'a', t, 2.7, 3.05, [[2.7, ax, ay]])
      const [bx, by] = at(800, 330, -45)
      __touch(s, 'b', t, 3.6, 3.95, [[3.6, bx, by]])
    },
  },
  // Two games designers made on a testing day, just for fun. Their code lives in
  // guests/ (not in git); see record.mjs. Both are played by a script that reads
  // the game's state, so the turrets and mallets respond to what actually happens.
  {
    id: 'riftfall',
    url: embed('dial-demo'),
    guest: 'riftfall',
    guestSettleMs: 4000, // waits for the pixel font
    seconds: 11.5,
    still: 9,
    setup: prelude,
    frame(t, s) {
      const g = document.getElementById('appframe').contentWindow.riftfall
      if (!g) return
      const turrets = [
        { m: 1, x: 420, y: 585 },
        { m: 2, x: 800, y: 585 },
        { m: 3, x: 610, y: 100 },
      ]
      if (!s.ids) {
        s.ids = turrets.map((p) => sim.addPuck({ markerId: p.m, mmX: p.x, mmY: p.y, angleDeg: p.y > 300 ? 0 : 180 }))
        s.aim = turrets.map((p) => (p.y > 300 ? 0 : 180))
      }
      // Aim each turret at the warhead nearest it, leading the shot, turning at
      // a believable hand speed rather than snapping.
      turrets.forEach((p, i) => {
        let best = null
        for (const w of g.warheads) {
          if (w.dead) continue
          const d = Math.hypot(w.x - p.x, w.y - p.y)
          if (!best || d < best.d) best = { w, d }
        }
        if (!best) return
        const lead = best.d / 750
        const tx = best.w.x + best.w.ux * best.w.speed * lead
        const ty = best.w.y + best.w.uy * best.w.speed * lead
        const want = (Math.atan2(tx - p.x, -(ty - p.y)) * 180) / Math.PI
        let delta = ((((want - s.aim[i]) % 360) + 540) % 360) - 180
        delta = Math.max(-12, Math.min(12, delta))
        s.aim[i] += delta
        sim.movePuck(s.ids[i], { angleDeg: s.aim[i] })
      })
      // Tap power buttons where the game says they are: the first one starts
      // the game, then everyone switches on as the first wave arrives.
      const tap = (key, i, t0) => {
        const b = g.buttonPos(turrets[i].x, turrets[i].y)
        __touch(s, key, t, t0, t0 + 0.2, [[t0, b.x, b.y]])
      }
      tap('a1', 0, 0.6)
      tap('a2', 0, 1.3)
      tap('a3', 0, 3.0)
      tap('b', 1, 3.1)
      tap('c', 2, 3.2)
    },
  },
  {
    id: 'air-hockey',
    url: embed('dial-demo'),
    guest: 'air-hockey',
    seconds: 9,
    still: 4,
    // Air hockey keeps its puck private. It draws it with a 27.5mm radius, which
    // nothing else on that canvas uses, so note where that circle is drawn.
    inject() {
      if (!location.pathname.includes('/air-hockey/')) return
      const arc = CanvasRenderingContext2D.prototype.arc
      CanvasRenderingContext2D.prototype.arc = function (x, y, r, ...rest) {
        if (r === 27.5) window.__hockeyPuck = { x, y, at: performance.now() }
        return arc.call(this, x, y, r, ...rest)
      }
    },
    setup: prelude,
    frame(t, s) {
      const W = 1218
      const H = 685
      const app = document.getElementById('appframe').contentWindow
      const seen = app.__hockeyPuck
      const P = seen && app.performance.now() - seen.at < 100 ? seen : null
      if (!s.m) {
        s.m = {
          w: { id: sim.addPuck({ markerId: 1, mmX: 130, mmY: H / 2 }), x: 130, y: H / 2, aimY: 0 },
          e: { id: sim.addPuck({ markerId: 2, mmX: W - 130, mmY: H / 2 }), x: W - 130, y: H / 2, aimY: 0 },
        }
      }
      const R = 30 + 27.5
      for (const side of ['w', 'e']) {
        const m = s.m[side]
        const home = side === 'w' ? 130 : W - 130
        const oppX = side === 'w' ? W : 0
        // The puck faces off exactly on the centre line; west takes it.
        const mine = P && (side === 'w' ? P.x <= W / 2 : P.x > W / 2)
        let tx = home
        let ty = P ? Math.max(H / 2 - 130, Math.min(H / 2 + 130, P.y)) : H / 2
        let speed = 900
        if (mine) {
          // Pick a spot in the far goal, aiming off the walls now and then.
          if (!m.aimY || m.shotAt !== s.shots) m.aimY = H / 2 + (Math.random() - 0.5) * 260
          let gx = oppX - P.x
          let gy = m.aimY - P.y
          const gl = Math.hypot(gx, gy)
          gx /= gl
          gy /= gl
          const front = (m.x - P.x) * gx + (m.y - P.y) * gy > -R * 0.5
          if (front) {
            // In front of the puck: go round it, not through it toward our own goal.
            const px = -gy
            const py = gx
            const sgn = (m.x - P.x) * px + (m.y - P.y) * py >= 0 ? 1 : -1
            tx = P.x - gx * R + px * sgn * (R + 45)
            ty = P.y - gy * R + py * sgn * (R + 45)
            speed = 1500
          } else if (Math.hypot(m.x - (P.x - gx * (R + 20)), m.y - (P.y - gy * (R + 20))) > 25) {
            tx = P.x - gx * (R + 20)
            ty = P.y - gy * (R + 20)
            speed = 1600
          } else {
            tx = P.x + gx * 140
            ty = P.y + gy * 140
            speed = 2600
            s.shots = (s.shots ?? 0) + 0.02
          }
        }
        const dx = tx - m.x
        const dy = ty - m.y
        const d = Math.hypot(dx, dy)
        const step = Math.min(d, speed / 30)
        if (d > 0.5) {
          m.x += (dx / d) * step
          m.y += (dy / d) * step
        }
        m.x = side === 'w' ? Math.max(35, Math.min(W / 2 - 35, m.x)) : Math.max(W / 2 + 35, Math.min(W - 35, m.x))
        m.y = Math.max(35, Math.min(H - 35, m.y))
        sim.movePuck(m.id, { mmX: m.x, mmY: m.y })
      }
    },
  },
  {
    id: 'end',
    card: true,
    url: '/cards/end.html',
    seconds: 3.5,
    settleMs: 800,
  },
]

/**
 * Screenshots of the whole app, written to media/<id>.jpg by `record.mjs --shots`.
 * Same shape as a scene, played for `seconds` and captured on the last frame, in
 * the full authoring UI rather than embed mode.
 */
export const SHOTS = [
  {
    id: 'app-inspector',
    url: '/index.html',
    app: 'arcane-table',
    width: 1440,
    height: 860,
    seconds: 3,
    setup: prelude,
    inspector: true,
    frame(t, s) {
      if (s.done) return
      s.done = true
      sim.addPuck({ markerId: 3, mmX: 430, mmY: 330, angleDeg: 25 })
      sim.addPuck({ markerId: 7, mmX: 655, mmY: 430, angleDeg: 200 })
      sim.addPuck({ markerId: 12, mmX: 830, mmY: 275, angleDeg: 310 })
      sim.addPuck({ markerId: 5, mmX: 560, mmY: 180, angleDeg: 95 })
      sim.touch({ mmX: 655, mmY: 358 })
    },
  },
]
