import * as THREE from 'three'

/**
 * Cheap, real bloom.
 *
 * Additive glow alone tops out at the brightness of the framebuffer, so hot
 * cores never bleed into the surrounding dark the way light actually does. This
 * renders the scene into a half-float target, keeps only what is brighter than a
 * threshold, blurs that at quarter resolution, and adds it back.
 *
 * Half-float matters: with additive blending the bright cores land well above
 * 1.0, and an 8-bit target would clip them all to white before the threshold
 * ever saw a difference.
 *
 * Deliberately not using Three's postprocessing addons. They live under
 * `three/addons/...`, which would mean teaching the app shell to resolve a
 * second bare-specifier prefix, and this is about forty lines.
 */

const QUAD_VERT = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`

// Nine-tap gaussian, run once per axis.
const BLUR_FRAG = `
  uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
  void main() {
    vec3 s = vec3(0.0);
    s += texture2D(tSrc, vUv + uDir * -4.0).rgb * 0.0162;
    s += texture2D(tSrc, vUv + uDir * -3.0).rgb * 0.0540;
    s += texture2D(tSrc, vUv + uDir * -2.0).rgb * 0.1216;
    s += texture2D(tSrc, vUv + uDir * -1.0).rgb * 0.1945;
    s += texture2D(tSrc, vUv).rgb                * 0.2270;
    s += texture2D(tSrc, vUv + uDir *  1.0).rgb * 0.1945;
    s += texture2D(tSrc, vUv + uDir *  2.0).rgb * 0.1216;
    s += texture2D(tSrc, vUv + uDir *  3.0).rgb * 0.0540;
    s += texture2D(tSrc, vUv + uDir *  4.0).rgb * 0.0162;
    gl_FragColor = vec4(s, 1.0);
  }`

export class Bloom {
  constructor(renderer, { strength = 1.15, threshold = 0.5, softness = 0.45, downsample = 4, passes = 2 } = {}) {
    this.renderer = renderer
    this.downsample = downsample
    this.passes = passes
    this.enabled = true

    const rt = (w, h) =>
      new THREE.WebGLRenderTarget(w, h, {
        type: THREE.HalfFloatType,
        depthBuffer: false,
        stencilBuffer: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      })

    this.scene = rt(1, 1)
    this.a = rt(1, 1)
    this.b = rt(1, 1)

    this.quadScene = new THREE.Scene()
    this.quadCamera = new THREE.Camera()
    this.geometry = new THREE.PlaneGeometry(2, 2)

    this.thresholdMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uThreshold: { value: threshold }, uSoft: { value: softness } },
      vertexShader: QUAD_VERT,
      fragmentShader: `
        uniform sampler2D tSrc; uniform float uThreshold; uniform float uSoft; varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tSrc, vUv).rgb;
          float l = max(max(c.r, c.g), c.b);
          gl_FragColor = vec4(c * smoothstep(uThreshold, uThreshold + uSoft, l), 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    })

    this.blurMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
      vertexShader: QUAD_VERT,
      fragmentShader: BLUR_FRAG,
      depthTest: false,
      depthWrite: false,
    })

    this.compositeMat = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: null }, tBloom: { value: null }, uStrength: { value: strength } },
      vertexShader: QUAD_VERT,
      fragmentShader: `
        uniform sampler2D tScene; uniform sampler2D tBloom; uniform float uStrength; varying vec2 vUv;
        void main() {
          vec3 base = texture2D(tScene, vUv).rgb;
          vec3 glow = texture2D(tBloom, vUv).rgb;
          gl_FragColor = vec4(base + glow * uStrength, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    })

    this.quad = new THREE.Mesh(this.geometry, this.thresholdMat)
    this.quad.frustumCulled = false
    this.quadScene.add(this.quad)
  }

  get strength() {
    return this.compositeMat.uniforms.uStrength.value
  }
  set strength(v) {
    this.compositeMat.uniforms.uStrength.value = v
  }

  setSize(w, h) {
    const d = this.downsample
    this.scene.setSize(w, h)
    this.a.setSize(Math.max(1, Math.floor(w / d)), Math.max(1, Math.floor(h / d)))
    this.b.setSize(Math.max(1, Math.floor(w / d)), Math.max(1, Math.floor(h / d)))
    this.width = w
    this.height = h
  }

  /** Draw the quad with a given material into a target (null means the canvas). */
  blit(material, target) {
    this.quad.material = material
    this.renderer.setRenderTarget(target)
    this.renderer.render(this.quadScene, this.quadCamera)
  }

  render(scene, camera) {
    const r = this.renderer

    if (!this.enabled) {
      r.setRenderTarget(null)
      r.render(scene, camera)
      return
    }

    r.setRenderTarget(this.scene)
    r.clear()
    r.render(scene, camera)

    this.thresholdMat.uniforms.tSrc.value = this.scene.texture
    this.blit(this.thresholdMat, this.a)

    const w = this.a.width
    const h = this.a.height
    for (let i = 0; i < this.passes; i++) {
      // Widen the kernel each pass, which fakes a much larger gaussian cheaply.
      const spread = 1 + i * 1.8
      this.blurMat.uniforms.tSrc.value = this.a.texture
      this.blurMat.uniforms.uDir.value.set(spread / w, 0)
      this.blit(this.blurMat, this.b)

      this.blurMat.uniforms.tSrc.value = this.b.texture
      this.blurMat.uniforms.uDir.value.set(0, spread / h)
      this.blit(this.blurMat, this.a)
    }

    this.compositeMat.uniforms.tScene.value = this.scene.texture
    this.compositeMat.uniforms.tBloom.value = this.a.texture
    this.blit(this.compositeMat, null)
  }
}
