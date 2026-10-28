// Bubble curtains: the spiral bubble net. Whales circling beneath a school breathe out curtains of
// bubbles that rise in a spiral and fence the fish in; at the surface they burst into a ring of
// foam. Each source is a short stream of bubbles animated entirely on the GPU (rise speed grows
// with bubble size, bubbles wobble and swell as the pressure drops, and pop at the surface).
import {
  Mesh, ShaderMaterial, InstancedBufferAttribute, DynamicDrawUsage, Vector3,
  CustomBlending, OneFactor, OneMinusSrcAlphaFactor,
} from 'three';
import { G } from '../../render/Globals.js';
import { UNIFORMS, LIGHTING, DEPTH } from '../../render/shaders/common.js';
import { quadGeometry } from './kit.js';

const MAX_SRC = 256;
const PER = 64; // bubbles per source

const VERT = /* glsl */ `
${UNIFORMS}
${LIGHTING}
attribute vec4 aSrc;   // source xyz, start time
attribute vec4 aB;     // seed, rise speed (m/s), radius (m), surface height at the source
attribute vec4 aB2;    // emission delay (s), spread (m), life (s), strength
varying vec2 vUv;
varying vec3 vCol;
varying float vA;
varying float vViewZ;
varying float vR;
void main() {
  float age = uTime - aSrc.w - aB2.x;
  float life = aB2.z;
  vec3 P = aSrc.xyz;
  float rise = aB.y;
  float y = P.y + rise * age + 0.08 * age * age;
  if (age < 0.0 || age > life || y > aB.w + 0.15) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float s = aB.x;
  // drift and wobble (bigger bubbles wobble more and spiral as they rise)
  float sp = aB2.y * (0.4 + 0.6 * min(age / 3.0, 1.0));
  float a = s * 6.2831 + age * (1.3 + s * 1.7);
  P.x += cos(s * 37.0) * sp + sin(a) * aB.z * 1.6;
  P.z += sin(s * 53.0) * sp + cos(a * 1.1) * aB.z * 1.6;
  P.y = y;
  // bubbles swell as the pressure drops on the way up
  float depth0 = max(aB.w - aSrc.y, 0.1);
  float depth = max(aB.w - y, 0.0);
  float r = aB.z * pow((10.0 + depth0) / (10.0 + depth), 0.333);
  vec4 mv = viewMatrix * vec4(P, 1.0);
  float vz = -mv.z;
  float px = r * projectionMatrix[1][1] * uResolution.y * 0.5 / max(vz, 0.01);
  float k = max(1.0, 1.2 / max(px, 1e-4));
  float fade = smoothstep(0.0, 0.3, age) * (1.0 - smoothstep(life * 0.85, life, age)) * smoothstep(0.0, 0.4, aB.w - y);
  float fog = fogAmount(P);
  vA = fade * aB2.w / (k * k) * (1.0 - fog);
  if (vA < 0.004 || vz < 0.2) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float rw = r * k;
  vec3 wp = P + (right * position.x + up * position.y) * rw;
  // lit by the light in the water: the sky above them, the sun glint
  vec3 base = uWaterTint * 3.0 + uSkyAmbient * 0.35 + uSunColor * 0.08 * max(uSunDir.y, 0.0);
  vCol = mix(base, vec3(1.0), 0.3) * (1.0 - uNight * 0.6) + vec3(0.06, 0.45, 0.8) * uWaterParams.z * 0.4;
  vUv = position.xy;
  vViewZ = vz;
  vR = rw;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const FRAG = /* glsl */ `
${UNIFORMS}
${DEPTH}
varying vec2 vUv;
varying vec3 vCol;
varying float vA;
varying float vViewZ;
varying float vR;
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  float r = sqrt(r2);
  // clear centre, bright rim (total internal reflection) and a glint toward the light
  float a = smoothstep(0.5, 0.86, r) * smoothstep(1.0, 0.88, r) * 0.85 + 0.08;
  vec2 g = vUv - vec2(-0.32, 0.36);
  a += exp(-dot(g, g) * 38.0) * 0.9;
  float soft = clamp((sceneDepthAt(gl_FragCoord.xy / uResolution) - vViewZ) / max(vR * 2.0, 0.05), 0.0, 1.0);
  a *= vA * soft;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vCol * a, a * 0.85);
}
`;

export class BubbleSystem {
  constructor(eco) {
    this.eco = eco;
    this.game = eco.game;
    const n = MAX_SRC * PER;
    this.aSrc = new InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(DynamicDrawUsage);
    this.aB = new InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(DynamicDrawUsage);
    this.aB2 = new InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(DynamicDrawUsage);
    // nothing alive yet: every bubble starts long dead
    this.aSrc.array.fill(-1e6);
    for (let i = 0; i < n; i++) this.aB2.array[i * 4 + 2] = 1;
    const geo = quadGeometry();
    geo.setAttribute('aSrc', this.aSrc);
    geo.setAttribute('aB', this.aB);
    geo.setAttribute('aB2', this.aB2);
    geo.instanceCount = n;
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: Object.assign({}, G),
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
    this.mesh.renderOrder = 16;
    this.mesh.name = 'bubbles';
    this.mesh.visible = false;
    this.game.engine.sceneT.add(this.mesh);
    this.next = 0;
    this.live = []; // { x, y, z, t0, surf, popped, k }
    this.lastT = -1e9;
    this._seed = 1;
  }

  /**
   * A short stream of bubbles from pos (a whale's blowhole, a skimmer's dive). strength 0..2
   * scales the number and size. surf: surface height above (default: the sea at pos).
   */
  emit(pos, strength = 1, opts = {}) {
    const t = this.game.time;
    const surf = opts.surf ?? this.eco.seaHeightFast(pos.x, pos.z);
    if (pos.y > surf - 0.2) return;
    const slot = this.next;
    this.next = (this.next + 1) % MAX_SRC;
    const S = this.aSrc.array, B = this.aB.array, B2 = this.aB2.array;
    const stream = opts.stream ?? 1.4;
    const spread = opts.spread ?? 0.7 * Math.min(2, strength);
    let s = (this._seed = (this._seed * 16807) % 2147483647);
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const depth = surf - pos.y;
    for (let k = 0; k < PER; k++) {
      const i = slot * PER + k, o = i * 4;
      const big = rnd();
      const rad = (0.012 + 0.05 * big * big * big) * (0.6 + 0.4 * Math.min(strength, 2)) * (opts.big ?? 1);
      S[o] = pos.x; S[o + 1] = pos.y - rnd() * 0.4; S[o + 2] = pos.z; S[o + 3] = t;
      B[o] = rnd(); B[o + 1] = 0.35 + 6 * Math.sqrt(rad) * (0.8 + 0.4 * rnd()); B[o + 2] = rad; B[o + 3] = surf;
      B2[o] = (k / PER) * stream * (0.6 + 0.4 * rnd()); B2[o + 1] = spread; B2[o + 2] = depth / B[o + 1] + 2.5; B2[o + 3] = Math.min(1, 0.45 + strength * 0.35);
    }
    for (const a of [this.aSrc, this.aB, this.aB2]) {
      if (a.updateRanges.length > 32) { a.clearUpdateRanges(); a.addUpdateRange(0, a.array.length); } else a.addUpdateRange(slot * PER * 4, PER * 4);
      a.needsUpdate = true;
    }
    this.live.push({ x: pos.x, z: pos.z, t0: t, pop: t + depth / 0.9, surf, k: strength, popped: false });
    if (this.live.length > MAX_SRC) this.live.shift();
    this.lastT = t;
    this.mesh.visible = true;
  }

  update() {
    const t = this.game.time;
    // the curtains reach the surface: a ring of foam bursts where each stream arrives
    let fx = 0;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const b = this.live[i];
      if (!b.popped && t > b.pop) {
        b.popped = true;
        if (fx++ < 3) this.eco.splash(_p.set(b.x, b.surf, b.z), 0.1 + 0.1 * b.k, 1.6, true, { foamOnly: true });
      }
      if (t - b.t0 > 30) this.live.splice(i, 1);
    }
    if (t - this.lastT > 40) this.mesh.visible = false;
  }

  clear() {
    this.aSrc.array.fill(-1e6);
    this.aSrc.clearUpdateRanges();
    this.aSrc.needsUpdate = true;
    this.live.length = 0;
    this.mesh.visible = false;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

const _p = new Vector3();
