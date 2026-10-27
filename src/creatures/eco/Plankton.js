// Cloud plankton: tiny drifting motes living inside moisture-rich clouds. Nearly invisible by
// day (a few specks catching the sun); a soft blue-green glow in the cloud's shade and at
// night; and they flash where they are disturbed - krill grazing through them, a whale's
// wake (like dinoflagellates). Static instanced sprites animated on the GPU: no CPU cost per
// mote. Motes are seeded inside the cluster's actual puffs and drift with the clouds.
import {
  Mesh, ShaderMaterial, InstancedBufferAttribute, StaticDrawUsage, Vector3, Vector4,
  CustomBlending, OneFactor, OneMinusSrcAlphaFactor,
} from 'three';
import { G } from '../../render/Globals.js';
import { UNIFORMS, LIGHTING, DEPTH } from '../../render/shaders/common.js';
import { ECO_VERT_GLSL, PLANKTON_GLOW } from './shaderlib.js';
import { buildQuadGeometry } from './geometry.js';
import { rng, clamp, lerp } from '../../core/math.js';

const MAX_MOTES = 24000;

const VERT = /* glsl */ `
${UNIFORMS}
${LIGHTING}
${ECO_VERT_GLSL}
attribute vec4 aMPos;   // xyz (undrifted), size (m)
attribute vec4 aMSeed;  // seed, wander amplitude (m), glow colour index, -
attribute vec4 aMCtr;   // cluster centre (undrifted), cluster radius
uniform vec3 uDrift;
uniform vec4 uTrail[24];
uniform vec4 uSwarms[8];
uniform vec4 uPlk;      // day specks, shade glow, night glow, feeding glow
uniform vec3 uPlkCol[3];
varying vec2 vUv;
varying vec3 vCol;
varying float vViewZ;
varying float vR;
void main() {
  float seed = aMSeed.x;
  float t = uTime;
  float amp = aMSeed.y;
  vec3 P = aMPos.xyz + uDrift + vec3(
    sin(t * 0.13 + seed * 6.28) + 0.4 * sin(t * 0.37 + seed * 17.0),
    0.5 * sin(t * 0.11 + seed * 4.1),
    cos(t * 0.09 + seed * 5.3) + 0.4 * cos(t * 0.31 + seed * 11.0)) * amp;
  // beyond a few hundred metres a mote is far below a pixel: skip all the work
  vec3 toP = P - uCamPos;
  if (dot(toP, toP) > 450.0 * 450.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 ctr = aMCtr.xyz + uDrift;
  vec3 rel = P - ctr;
  float rl = length(rel);
  float sunSide = dot(rel / max(rl, 1e-3), uSunDir);
  float shade = clamp(0.45 - sunSide * 0.6 + (1.0 - rl / max(aMCtr.w, 1.0)) * 0.45, 0.0, 1.0);
  // disturbance: grazing krill and passing whales make them flash
  float feed = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 s = uSwarms[i];
    if (s.w <= 0.0) continue;
    feed += smoothstep(s.w, s.w * 0.3, length(P - s.xyz));
  }
  float wake = 0.0;
  for (int i = 0; i < 24; i++) {
    vec4 tp = uTrail[i];
    float age = uTime - tp.w;
    if (age < 0.0 || age > 8.0) continue;
    vec3 d = P - tp.xyz;
    wake += exp(-dot(d, d) / 50.0) * (1.0 - age / 8.0);
  }
  float flick = 0.55 + 0.45 * sin(t * (0.7 + fract(seed * 13.0) * 1.7) + seed * 40.0);
  float day = 1.0 - uNight;
  // bioluminescence only really shows in shade and at night; by day disturbance is a faint shimmer
  float dark = max(uNight, shade * shade * 0.5);
  float stir = uPlk.w * min(feed, 1.5) * (0.25 + 0.75 * dark) + 0.7 * min(wake, 1.0) * (0.06 + 0.94 * dark);
  float glow = (uPlk.y * shade * day + uPlk.z * uNight + stir) * flick;
  float specks = uPlk.x * (1.0 - shade) * day * step(0.6, fract(seed * 7.7));
  vec3 col = uPlkCol[int(clamp(floor(aMSeed.z), 0.0, 2.0))] * glow + uSunColor * specks;
  vec4 mv = viewMatrix * vec4(P, 1.0);
  float vz = -mv.z;
  float size = aMPos.w * (1.0 + 0.6 * min(feed + wake, 1.0));
  float px = projPx(size, vz);
  float k = max(1.0, 1.15 / max(px, 1e-4));
  col *= (1.0 - fogAmount(P)) / (k * k) * smoothstep(1.5, 5.0, vz);
  if (vz < 0.2 || max(col.r, max(col.g, col.b)) < 0.0004) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float rW = size * k;
  vec3 wp = P + (right * position.x + up * position.y) * rW;
  vUv = position.xy;
  vCol = col;
  vViewZ = vz;
  vR = rW;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const FRAG = /* glsl */ `
${UNIFORMS}
${DEPTH}
varying vec2 vUv;
varying vec3 vCol;
varying float vViewZ;
varying float vR;
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  float a = exp(-r2 * 4.0) + exp(-r2 * 18.0) * 0.6;
  float sceneZ = sceneDepthAt(gl_FragCoord.xy / uResolution);
  a *= clamp((sceneZ - vViewZ) / max(vR * 3.0, 0.1), 0.0, 1.0);
  gl_FragColor = vec4(vCol * a, 0.0);
}
`;

export class PlanktonSystem {
  constructor(eco) {
    this.eco = eco;
    this.game = eco.game;
    this.patches = [];
    this.count = 0;
    this._done = new WeakSet();
    this.aPos = new InstancedBufferAttribute(new Float32Array(MAX_MOTES * 4), 4).setUsage(StaticDrawUsage);
    this.aSeed = new InstancedBufferAttribute(new Float32Array(MAX_MOTES * 4), 4).setUsage(StaticDrawUsage);
    this.aCtr = new InstancedBufferAttribute(new Float32Array(MAX_MOTES * 4), 4).setUsage(StaticDrawUsage);
    const geo = buildQuadGeometry();
    geo.setAttribute('aMPos', this.aPos);
    geo.setAttribute('aMSeed', this.aSeed);
    geo.setAttribute('aMCtr', this.aCtr);
    geo.instanceCount = 0;
    this.swarmU = Array.from({ length: 8 }, () => new Vector4(0, 0, 0, 0));
    /** x: daytime specks catching the sun, y: glow in the cloud's shade, z: night glow, w: feeding flash */
    this.params = new Vector4(0.012, 0.035, 0.36, 0.65);
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: Object.assign({}, G, {
        uDrift: this.game.clouds.uniforms.uDrift,
        uSwarms: { value: this.swarmU },
        uPlk: { value: this.params },
        uPlkCol: { value: PLANKTON_GLOW.map((c) => c.clone()) },
      }),
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      premultipliedAlpha: true,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 13;
    this.mesh.name = 'cloud-plankton';
    this.mesh.visible = false;
    this.game.engine.sceneT.add(this.mesh);
  }

  /** Populate every moisture-rich cluster that has no plankton yet; drop patches whose cloud is gone. */
  sync(clouds) {
    if (!clouds) return;
    const all = clouds.clusters || [];
    let removed = false;
    for (let i = this.patches.length - 1; i >= 0; i--) {
      if (this.patches[i].auto && !all.includes(this.patches[i].cluster)) { this.patches.splice(i, 1); removed = true; }
    }
    if (removed) this._rebuild();
    for (const cl of clouds.moistClusters()) {
      if (this._done.has(cl)) continue;
      this.add(cl, { auto: true });
    }
  }

  add(cluster, opts = {}) {
    if (!cluster || this._done.has(cluster)) return null;
    this._done.add(cluster);
    const moist = clamp(cluster.moisture ?? 1, 0, 1);
    const R = cluster.radius ?? 60;
    let n = Math.round(clamp(R * R * 0.06, 120, opts.max ?? 800) * (opts.density ?? 1) * (0.4 + 0.6 * moist));
    n = Math.min(n, MAX_MOTES - this.count);
    if (n <= 0) return null;
    const patch = { cluster, n, seed: (opts.seed ?? this.patches.length * 31 + 7), auto: !!opts.auto, start: 0 };
    this.patches.push(patch);
    this._fill(patch, this.count);
    this.count += n;
    this._upload();
    return patch;
  }

  _fill(patch, start) {
    const r = rng(patch.seed);
    const cl = patch.cluster;
    const clouds = this.game.clouds;
    const d = clouds.data;
    const P = this.aPos.array, S = this.aSeed.array, C = this.aCtr.array;
    // weighted puff list (motes live inside the actual puffs)
    const puffs = [];
    let wsum = 0;
    if (cl.count && d) {
      for (let i = cl.start; i < cl.start + cl.count; i++) {
        const w = d[i * 12 + 3] ** 2;
        wsum += w;
        puffs.push([i, wsum]);
      }
    }
    const v = new Vector3();
    patch.start = start;
    for (let k = 0; k < patch.n; k++) {
      const o = (start + k) * 4;
      if (puffs.length) {
        const x = r() * wsum;
        let lo = 0, hi = puffs.length - 1;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (puffs[mid][1] < x) lo = mid + 1; else hi = mid; }
        const pi = puffs[lo][0] * 12;
        r.inSphere(v).multiplyScalar(d[pi + 3] * 0.85);
        P[o] = d[pi] + v.x; P[o + 1] = d[pi + 1] + v.y * 0.8; P[o + 2] = d[pi + 2] + v.z;
      } else {
        r.inSphere(v).multiply(new Vector3(R(cl), R(cl) * 0.35, R(cl)));
        P[o] = cl.center.x + v.x; P[o + 1] = cl.center.y + v.y; P[o + 2] = cl.center.z + v.z;
      }
      P[o + 3] = lerp(0.07, 0.17, r() * r());
      S[o] = r() * 10; S[o + 1] = lerp(0.6, 2.6, r()); S[o + 2] = Math.floor(r() * r() * 3) + 0.5; S[o + 3] = 0;
      C[o] = cl.center.x; C[o + 1] = cl.center.y; C[o + 2] = cl.center.z; C[o + 3] = cl.radius ?? 60;
    }
    function R(c) { return (c.radius ?? 60) * 0.8; }
  }

  _rebuild() {
    let s = 0;
    for (const p of this.patches) { this._fill(p, s); s += p.n; }
    this.count = s;
    this._upload();
  }

  _upload() {
    for (const a of [this.aPos, this.aSeed, this.aCtr]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.count * 4);
      a.needsUpdate = true;
    }
    this.mesh.geometry.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
  }

  clear() {
    this.patches.length = 0;
    this.count = 0;
    this._done = new WeakSet();
    this.mesh.geometry.instanceCount = 0;
    this.mesh.visible = false;
  }

  prune(center, r2) {
    const n0 = this.patches.length;
    // pruned clusters stay in _done so sync() does not re-seed them (clear() resets it)
    this.patches = this.patches.filter((p) => {
      const c = p.cluster.center;
      const keep = c.distanceToSquared(center) <= r2;
      return keep;
    });
    if (this.patches.length !== n0) this._rebuild();
  }

  update(dt, ctx) {
    if (!this.count) return;
    // the nearest grazing swarms light up the plankton around them
    const sw = this.eco.krill.swarms;
    const list = this._sorted || (this._sorted = []);
    list.length = 0;
    for (const s of sw) list.push(s);
    if (list.length > 8) list.sort((a, b) => a.center.distanceToSquared(ctx.cam) - b.center.distanceToSquared(ctx.cam));
    for (let i = 0; i < 8; i++) {
      const s = list[i];
      if (s) this.swarmU[i].set(s.center.x, s.center.y, s.center.z, s.R * 1.1 * Math.max(0.2, s.alive / s.count));
      else this.swarmU[i].set(0, 0, 0, 0);
    }
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
