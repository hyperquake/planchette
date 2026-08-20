import * as THREE from 'three'

/**
 * Thick glowing polylines.
 *
 * WebGL clamps line width to 1 pixel on effectively every driver, and on a
 * 3840px-wide table one pixel is about 0.3mm. Physically invisible. So nothing
 * here uses THREE.Line: every stroke is built from triangles, two per segment,
 * carrying a cross-ribbon coordinate that the shader fades to soft edges.
 *
 * All strokes share one buffer, so an entire rune ring, or every arc on the
 * table, costs a single draw call.
 */
export class Ribbon {
  /**
   * @param {number} maxSegments  hard ceiling; excess segments are dropped
   * @param {{color: number[], intensity?: number, renderOrder?: number}} opts
   */
  constructor(maxSegments, { color, intensity = 1, renderOrder = 0 }) {
    this.max = maxSegments
    const verts = maxSegments * 6
    this.position = new Float32Array(verts * 3)
    this.cross = new Float32Array(verts)
    this.alpha = new Float32Array(verts)

    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(this.position, 3).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('aCross', new THREE.BufferAttribute(this.cross, 1).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage))

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Vector3(...color) },
        uIntensity: { value: intensity },
      },
      vertexShader: `
        attribute float aCross;
        attribute float aAlpha;
        varying float vCross;
        varying float vAlpha;
        void main() {
          vCross = aCross;
          vAlpha = aAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uIntensity;
        varying float vCross;
        varying float vAlpha;
        void main() {
          // Fade across the ribbon so a hard-edged quad reads as a lit filament.
          float edge = 1.0 - abs(vCross);
          float core = pow(edge, 3.0);
          float bloom = pow(edge, 0.6) * 0.35;
          gl_FragColor = vec4(uColor, (core + bloom) * vAlpha * uIntensity);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    })

    this.mesh = new THREE.Mesh(g, this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = renderOrder
    this.geometry = g
    this.n = 0
  }

  begin() {
    this.n = 0
  }

  /** One straight stroke, in table pixels. Alpha may taper end to end. */
  segment(x0, y0, x1, y1, width, a0, a1 = a0) {
    if (this.n >= this.max) return
    let dx = x1 - x0
    let dy = y1 - y0
    const len = Math.hypot(dx, dy)
    if (len < 1e-6) return
    dx /= len
    dy /= len
    const h = width / 2
    // Perpendicular, so the quad straddles the stroke's centre line.
    const nx = -dy * h
    const ny = dx * h

    const v = this.n * 6
    const p = this.position
    const c = this.cross
    const al = this.alpha

    // Two triangles: (A,B,C) and (C,B,D).
    const pts = [
      [x0 + nx, y0 + ny, 1, a0],
      [x0 - nx, y0 - ny, -1, a0],
      [x1 + nx, y1 + ny, 1, a1],
      [x1 + nx, y1 + ny, 1, a1],
      [x0 - nx, y0 - ny, -1, a0],
      [x1 - nx, y1 - ny, -1, a1],
    ]
    for (let i = 0; i < 6; i++) {
      const [x, y, cr, a] = pts[i]
      p[(v + i) * 3] = x
      p[(v + i) * 3 + 1] = y
      p[(v + i) * 3 + 2] = 0
      c[v + i] = cr
      al[v + i] = a
    }
    this.n++
  }

  /** A connected run of points. `close` joins the last point back to the first. */
  polyline(points, width, alpha, close = false) {
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]
      const b = points[i + 1]
      this.segment(a[0], a[1], b[0], b[1], width, alpha)
    }
    if (close && points.length > 2) {
      const a = points[points.length - 1]
      const b = points[0]
      this.segment(a[0], a[1], b[0], b[1], width, alpha)
    }
  }

  end() {
    // Zero the tail so stale triangles from a busier frame cannot show through.
    const used = this.n * 6
    this.alpha.fill(0, used)
    this.geometry.setDrawRange(0, used)
    this.geometry.attributes.position.needsUpdate = true
    this.geometry.attributes.aCross.needsUpdate = true
    this.geometry.attributes.aAlpha.needsUpdate = true
  }
}
