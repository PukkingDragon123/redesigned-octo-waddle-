// Bioluminescent plankton of the night sea. A field of motes lives in the water around the
// camera (wrapped in a moving box, so it never runs out) and in the plankton patches the world
// seeds; dark by day, faint at night, and flaring blue-green where anything moves through them:
// fish schools leave sparkling clouds, a lunging jack a streak, the calf and the whales glowing
// wakes. Entirely on the GPU (disturbances come in as small uniform arrays). Drawn in the opaque
// scene with additive blending so the sea surface refracts it like everything else below it.
import {
  Mesh, ShaderMaterial, InstancedBufferAttribute, StaticDrawUsage, Vector3, Vector4, AdditiveBlending,
} from 'three';
import { G } from '../../render/Globals.js';
import { UNIFORMS, LIGHTING } from '../../render/shaders/common.js';
import { quadGeometry } from './kit.js';
import { rng, smoothstep } from '../../core/math.js';

const N = 14000;
const NSRC = 24;

const VERT = /* glsl */ `
${UNIFORMS}
${LIGHTING}
attribute vec4 aM;      // unit-box position xyz, seed
uniform vec4 uBox;      // box size x, depth range, z, top depth below the surface
uniform vec4 uSrc[${NSRC}];   // disturbances: xyz, radius
uniform vec4 uSrcK[${NSRC}];  // strength, -, -, -
uniform vec4 uPatch[8];       // plankton patches: xyz, radius (denser glow inside)
uniform vec4 uTrail[24];      // the calf's recent path (xyz, time)
uniform float uGlowK;         // overall strength (night)
uniform vec3 uGlowCol[2];
varying vec2 vUv;
varying vec3 vCol;
void main() {
  float seed = aM.w;
  // wrap the box round the camera (xz), under the sea surface (y)
  vec3 box = vec3(uBox.x, uBox.y, uBox.z);
  vec3 base = uCamPos;
  vec3 P;
  P.x = base.x + (fract((aM.x * box.x - base.x) / box.x) - 0.5) * box.x;
  P.z = base.z + (fract((aM.z * box.z - base.z) / box.z) - 0.5) * box.z;
  P.y = uSeaLevel - uBox.w - aM.y * box.y;
  // a slow drift and wobble
  float t = uTime;
  P += vec3(sin(t * 0.21 + seed * 31.0), sin(t * 0.17 + seed * 17.0) * 0.4, cos(t * 0.19 + seed * 23.0)) * 0.35;
  float d = 0.0;
  for (int i = 0; i < ${NSRC}; i++) {
    vec4 s = uSrc[i];
    if (s.w <= 0.0) continue;
    vec3 q = P - s.xyz;
    float dd = dot(q, q);
    float r2 = s.w * s.w;
    if (dd < r2) d += (1.0 - dd / r2) * uSrcK[i].x;
  }
  float wake = 0.0;
  for (int i = 0; i < 24; i++) {
    vec4 tp = uTrail[i];
    float age = uTime - tp.w;
    if (age < 0.0 || age > 6.0) continue;
    vec3 q = P - tp.xyz;
    wake += exp(-dot(q, q) / 6.0) * (1.0 - age / 6.0);
  }
  float patchK = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 pp = uPatch[i];
    if (pp.w <= 0.0) continue;
    patchK = max(patchK, smoothstep(pp.w, pp.w * 0.6, length(P.xz - pp.xz)));
  }
  // dinoflagellates flash when the water around them is stirred, then fade
  float flick = 0.55 + 0.45 * sin(t * (2.0 + fract(seed * 7.3) * 5.0) + seed * 60.0);
  float glow = uGlowK * ((0.035 + 0.08 * patchK) * step(0.82, fract(seed * 13.1)) + min(d, 2.0) * (1.1 + patchK * 0.9) + min(wake, 1.0) * 1.2) * flick;
  vec4 mv = viewMatrix * vec4(P, 1.0);
  float vz = -mv.z;
  if (glow < 0.004 || vz < 0.2) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float size = 0.035 + 0.05 * fract(seed * 3.7);
  float px = size * projectionMatrix[1][1] * uResolution.y * 0.5 / vz;
  float k = max(1.0, 1.3 / max(px, 1e-4));
  // the water swallows the light with distance (seen from below) and the surface from above
  float fog = fogAmount(P);
  vec3 col = mix(uGlowCol[0], uGlowCol[1], fract(seed * 5.1)) * glow * (1.0 - fog) / (k * k);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 wp = P + (right * position.x + up * position.y) * size * k;
  vUv = position.xy;
  vCol = col;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vCol;
void main() {
  #ifdef DEPTH_PASS
    gl_FragColor = vec4(0.0);
    return;
  #endif
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  float a = exp(-r2 * 5.0) + exp(-r2 * 20.0) * 0.7;
  gl_FragColor = vec4(vCol * a, 1.0);
}
`;

export class SeaGlow {
  constructor(eco) {
    this.eco = eco;
    this.game = eco.game;
    const r = rng(4242);
    const M = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      M[i * 4] = r(); M[i * 4 + 1] = Math.pow(r(), 1.6); M[i * 4 + 2] = r(); M[i * 4 + 3] = r();
    }
    const geo = quadGeometry();
    geo.setAttribute('aM', new InstancedBufferAttribute(M, 4).setUsage(StaticDrawUsage));
    geo.instanceCount = N;
    this.src = Array.from({ length: NSRC }, () => new Vector4());
    this.srcK = Array.from({ length: NSRC }, () => new Vector4());
    this.patchU = Array.from({ length: 8 }, () => new Vector4());
    this.patches = [];
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: Object.assign({}, G, {
        uBox: { value: new Vector4(52, 18, 52, 0.25) },
        uSrc: { value: this.src },
        uSrcK: { value: this.srcK },
        uPatch: { value: this.patchU },
        uGlowK: { value: 0 },
        uGlowCol: { value: [new Vector3(0.12, 0.85, 1.0), new Vector3(0.25, 1.0, 0.7)] },
      }),
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: AdditiveBlending,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.name = 'sea-plankton';
    this.mesh.visible = false;
    this.game.engine.scene.add(this.mesh);
    /** Day/night response: 0 by day, ~1 at night (override with a number to force). */
    this.force = null;
  }

  /** A plankton bloom (the night chapter's patches): denser glow inside the radius. */
  addPatch(pos, radius = 200) {
    this.patches.push({ pos: pos.clone(), radius });
    return this.patches[this.patches.length - 1];
  }

  clear() { this.patches.length = 0; }

  prune(center, r2) {
    this.patches = this.patches.filter((p) => p.pos.distanceToSquared(center) <= r2);
  }

  update(dt, ctx) {
    const night = this.force ?? smoothstep(0.25, 0.75, G.uNight.value);
    const k = night * (this.eco.ocean?.enabled === false ? 0 : 1);
    this.material.uniforms.uGlowK.value = k * 1.4;
    this.mesh.visible = k > 0.01;
    if (!this.mesh.visible) return;
    // disturbances: the nearest fish schools (stronger when agitated), the whales, jacks and
    // diving birds (the predators this frame)
    let n = 0;
    const cam = ctx.cam;
    const schools = this.eco.fish.schools;
    const near = this._near || (this._near = []);
    near.length = 0;
    for (const sc of schools) {
      if (sc.dormant) continue;
      const d = sc.center.distanceToSquared(cam);
      if (d < 140 * 140) near.push(sc);
    }
    near.sort((a, b) => a.center.distanceToSquared(cam) - b.center.distanceToSquared(cam));
    for (const sc of near) {
      if (n >= 10) break;
      this.src[n].set(sc.center.x, sc.center.y, sc.center.z, sc.extent * 1.1 + 1.5);
      this.srcK[n].set(0.35 + sc.threat * 0.9 + sc.net * 0.8 + sc.song * 0.6, 0, 0, 0);
      n++;
    }
    for (const q of ctx.predators) {
      if (n >= NSRC) break;
      const d = (q.x - cam.x) ** 2 + (q.z - cam.z) ** 2;
      if (d > 120 * 120) continue;
      this.src[n].set(q.x, q.y, q.z, Math.min(q.r * 1.2, 14));
      this.srcK[n].set(0.8 * Math.min(q.s, 1.5), 0, 0, 0);
      n++;
    }
    for (; n < NSRC; n++) this.src[n].w = 0;
    for (let i = 0; i < 8; i++) {
      const p = this.patches[i];
      if (p) this.patchU[i].set(p.pos.x, p.pos.y, p.pos.z, p.radius);
      else this.patchU[i].w = 0;
    }
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
