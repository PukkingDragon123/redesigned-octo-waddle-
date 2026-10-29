// Instanced particles with CPU simulation, drawn as a hand-animated film's 2D effects layer: painted
// cloud puffs, drawn droplets, ink-ring bubbles, four-point stars, soft dots and brushed wind strokes.
// Two flavours (one draw each):
//  - 'mist': alpha-blended, lit like cloud (mist trails, spray, breath, dust, wind strokes)
//  - 'glow': additive, restrained (krill sparkle, plankton motes, embers of lightning)
import {
  InstancedBufferGeometry, InstancedBufferAttribute, BufferAttribute, Mesh, ShaderMaterial,
  CustomBlending, OneFactor, OneMinusSrcAlphaFactor, AdditiveBlending, Vector3, Color, DynamicDrawUsage,
} from 'three';
import { G } from './Globals.js';
import { UNIFORMS, NOISE, LIGHTING, DEPTH } from './shaders/common.js';
import { getNoiseTexture } from './NoiseTex.js';

const VERT = /* glsl */ `
${UNIFORMS}
${NOISE}
${LIGHTING}
attribute vec4 aPos;    // xyz, size
attribute vec4 aCol;    // rgb, alpha
attribute vec4 aParam;  // x seed, y age01, z stretch (wind strokes), w kind
attribute vec3 aVel;    // world velocity (stretches droplets and orients wind strokes)
uniform vec3 uStretchVel;
varying vec2 vUv;       // shape frame: x along the long axis (stretched kinds) or the spun axis
varying vec2 vScr;      // the same point in the screen frame (x right, y up): light from above
varying float vLen;     // long-axis stretch (1 = round)
varying vec4 vCol;
varying vec4 vParam;
varying float vFog;
varying vec3 vFogCol;
varying float vViewZ;
varying float vSize;
void main() {
  float s = aPos.w;
  float kind = aParam.w;
  float seed = aParam.x;
  vec4 mvc = viewMatrix * vec4(aPos.xyz, 1.0);
  vec2 ax;
  float len = 1.0;
  if ((kind > 2.5 && kind < 3.5) || kind > 5.5) {
    // droplets and wind strokes lie along their motion on screen (with perspective)
    vec3 vv = mat3(viewMatrix) * aVel;
    float z = max(-mvc.z, 0.1);
    vec2 sd = vv.xy * z + mvc.xy * vv.z;
    float sp = length(sd) / z;
    float th0 = seed * 6.2831;
    ax = sp > 0.05 ? normalize(sd) : vec2(cos(th0), sin(th0));
    if (kind > 6.5) ax = vec2(-ax.y, ax.x);
    len = kind < 3.5 ? clamp(1.0 + sp * 0.02 / max(s, 0.03), 1.0, 2.4) : max(aParam.z, 1.0);
  } else if (kind > 3.5 && kind < 4.5) {
    ax = vec2(1.0, 0.0); // bubbles keep their highlight up and to the left
  } else {
    // every puff, dot and star gets its own angle and a slow turn over its life
    float th = seed * 6.2831 + aParam.y * (fract(seed * 7.31) - 0.5) * 2.4;
    ax = vec2(cos(th), sin(th));
  }
  vec2 bx = vec2(-ax.y, ax.x);
  vec2 q = ax * (position.x * len) + bx * position.y;
  vUv = position.xy;
  vScr = q;
  vLen = len;
  vCol = aCol;
  vParam = aParam;
  vec3 toP = aPos.xyz - uCamPos;
  float d = length(toP);
  vFog = fogAmount(aPos.xyz);
  vFogCol = fogColorFor(toP / max(d, 1e-3));
  vec4 mv = mvc + vec4(q * s, 0.0, 0.0);
  vViewZ = -mv.z;
  vSize = s;
  gl_Position = projectionMatrix * mv;
}
`;

// Every kind is drawn like a hand-animated film's effects layer (section 0.6): flat painted fills with
// crisp, slightly wobbling edges, a thin darker ink line where it helps, per-particle shape seeds.
const FRAG = /* glsl */ `
${UNIFORMS}
${DEPTH}
uniform sampler2D uNoise;
uniform float uAdditive;
varying vec2 vUv;
varying vec2 vScr;
varying float vLen;
varying vec4 vCol;
varying vec4 vParam;
varying float vFog;
varying vec3 vFogCol;
varying float vViewZ;
varying float vSize;
float h1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
// 1 inside a shape (d < 0), 0 outside, with about a pixel of anti-aliasing
#define EDGE(d) (1.0 - smoothstep(-aa, aa, (d)))
void main() {
  float kind = vParam.w;
  float seed = vParam.x;
  float age = vParam.y;
  vec2 p = vUv;
  float r = length(p);
  float th = atan(p.y, p.x);
  // about one pixel of anti-aliasing (computed in uniform control flow)
  float aa = clamp(length(fwidth(p)) * 0.8, 0.004, 0.5);
  float a = 0.0;
  float ink = 0.0;
  vec3 col = vCol.rgb;
  if (kind < 0.5) {
    // mist, spray sheets, breath: a painted cloud puff. A scalloped rim (round brush dabs), two-tone
    // light from above, a thin darker ink rim, and it breaks into wisps as it ages.
    float nb = 2.0 + floor(h1(seed) * 2.5);
    float n = texture2D(uNoise, p * 0.18 + seed * 0.37).g;
    float rim = 0.64 + 0.26 * pow(abs(sin(th * nb + seed * 3.1)), 0.6) + (n - 0.5) * 0.1;
    float d = r - rim;
    float n2 = texture2D(uNoise, p * 0.3 + vec2(seed * 0.71, seed * 0.29)).r;
    float body = (1.0 - r / rim) * 0.75 + n2 * 0.55;
    d = max(d, (age * age * 1.1 - body) * 0.6);
    a = EDGE(d) * (0.82 + 0.18 * (1.0 - r));
    ink = smoothstep(-0.13, -0.02, d) * 0.9;
    float lit = smoothstep(-0.35, 0.3, vScr.y + (n - 0.5) * 0.6);
    col = mix(uCloudShadow, uCloudLit, 0.28 + 0.72 * lit) * vCol.rgb;
  } else if (kind < 1.5) {
    // glow mote: a soft round dot with a tiny bright core; its rim wobbles like a brush dot
    float rim = 0.78 + 0.07 * sin(th * 3.0 + seed * 5.0) + 0.04 * sin(th * 5.0 - seed * 3.0);
    float core = EDGE(r - 0.22);
    a = EDGE(r - rim) * (0.22 + 0.3 * (1.0 - smoothstep(0.0, rim, r))) + core * 0.75;
    col = mix(vCol.rgb, vec3(1.0), core * 0.3);
  } else if (kind < 2.5) {
    // sparkle: a small painted four-point star that twinkles
    float tw = 0.78 + 0.22 * sin(uTime * 9.0 + seed * 17.0);
    vec2 q = abs(p) / tw;
    float st = pow(q.x + 1e-4, 0.55) + pow(q.y + 1e-4, 0.55);
    a = EDGE(st - 0.95) * 0.75 + EDGE(r - 0.14) * 0.5;
  } else if (kind < 3.5) {
    // sea spray: a drawn droplet, a teardrop drawn out along its flight, a dark contour and a glint
    vec2 q = vec2(p.x * vLen, p.y);
    float R = 0.74;
    float cx = vLen - 0.9;
    float tip = -vLen + 0.06;
    float d;
    if (q.x >= cx) d = length(q - vec2(cx, 0.0)) - R;
    else {
      float u = clamp((cx - q.x) / max(cx - tip, 1e-3), 0.0, 1.0);
      d = max(abs(q.y) - R * pow(1.0 - u, 0.9), tip - q.x);
    }
    a = EDGE(d);
    ink = smoothstep(-0.2, -0.04, d);
    float glint = EDGE(length(q - vec2(cx + 0.18, 0.28)) - 0.2);
    vec3 lit = uSunColor * 0.55 + uSkyAmbient * 0.75 + uMoonColor * uNight * 0.5;
    // at night the spray carries the sea's plankton light
    lit += vec3(0.06, 0.45, 0.8) * uWaterParams.z * 0.6;
    col = mix(lit * vCol.rgb, lit * 1.6 + 0.1, glint * 0.7);
    ink *= 1.0 - glint;
  } else if (kind < 4.5) {
    // bubble: a drawn ring (pen pressure varies around it), a highlight crescent, a hint of fill
    float rim = 0.78 + 0.035 * sin(th * 3.0 + seed * 4.0);
    float w = 0.05 + 0.05 * (0.5 + 0.5 * sin(th + seed * 2.0 + 2.4));
    float ring = EDGE(abs(r - rim) - w);
    float ang = abs(th - 2.2);
    float cw = 0.065 * (1.0 - smoothstep(0.0, 0.8, ang));
    float cres = EDGE(abs(r - rim * 0.64) - cw) * step(ang, 0.8);
    float fill = EDGE(r - rim) * 0.1;
    a = max(max(ring * 0.9, cres), fill);
    vec3 base = mix(uWaterTint * 3.0 + uSkyAmbient * 0.4, vec3(1.0), 0.35);
    col = mix(base, vec3(1.0), cres * 0.6) * vCol.rgb;
  } else if (kind < 5.5) {
    // drifting mote in the water (marine snow): a small irregular painted fleck
    float rim = 0.5 + 0.34 * pow(abs(sin(th * 1.5 + seed * 2.0)), 0.8);
    a = EDGE(r - rim) * (0.5 + 0.5 * (1.0 - r));
    col = (uWaterTint * 2.5 + uSunColor * 0.04) * vCol.rgb;
  } else {
    // a hand-drawn wind stroke: a tapered, curved brush line, along its motion (6) or as an arc across
    // it bowed the way it travels (7). It draws on fast and wipes away from its tail.
    float arc = step(6.5, kind);
    float sd = h1(seed + 1.7);
    // the quad is a few line-widths wide so the stroke has room to bow; arcs: local +y points back
    float bend = mix((sd - 0.5) * 1.5, -0.55 - 0.25 * sd, arc);
    float x = p.x;
    float yc = bend * (0.5 - x * x) + 0.07 * sin(x * (2.0 + vLen * 0.7) + seed * 4.0);
    float tp = pow(max(1.0 - x * x, 0.0), 0.6) * mix(0.6 + 0.4 * x, 1.0, arc);
    float hw = 0.13 * tp * (1.0 - 0.45 * age) * (0.8 + 0.4 * h1(seed + 3.3));
    float d = abs(p.y - yc) - hw;
    float head = -1.0 + 2.3 * clamp(age / 0.16, 0.0, 1.0);
    float tail = -1.05 + 2.2 * smoothstep(0.3, 1.0, age);
    float lim = clamp(age / 0.14, 0.0, 1.0) * (1.0 - 0.85 * smoothstep(0.4, 1.0, age));
    float cut = mix(max(x - head, tail - x), abs(x) - lim, arc) * vLen;
    d = max(d, cut);
    float n = texture2D(uNoise, vec2(x * vLen * 0.06, p.y * 0.4) + seed * 0.13).g;
    a = EDGE(d) * (0.65 + 0.35 * smoothstep(0.3, 0.65, n));
    col = mix(uCloudLit, uSkyAmbient + uSunColor * 0.4, 0.3) * vCol.rgb;
  }
  // the ink line: a thin darker contour just inside painted shapes (not on light that adds)
  if (uAdditive < 0.5) col *= 1.0 - ink * 0.24;
  a *= vCol.a;
  vec2 suv = gl_FragCoord.xy / uResolution;
  float sceneZ = sceneDepthAt(suv);
  a *= clamp((sceneZ - vViewZ) / max(vSize * 0.5, 0.2), 0.0, 1.0);
  // fade puffs the camera is inside of, so a burst never veils the whole view
  // mist puffs also fade as they grow large on screen: a big painted puff hanging over the view
  // reads as a pale disc, not as mist
  float nearK = kind < 0.5
    ? smoothstep(vSize * 1.2, vSize * 4.0, vViewZ) * (1.0 - smoothstep(0.1, 0.28, vSize / max(vViewZ, 0.1)))
    : smoothstep(vSize * 0.35, vSize * 1.5, vViewZ);
  a *= smoothstep(0.3, 1.2, vViewZ) * nearK;
  if (a < 0.003) discard;
  if (uAdditive > 0.5) {
    col *= mix(1.0, 0.0, vFog);
    gl_FragColor = vec4(col * a, 0.0);
  } else {
    col = mix(col, vFogCol, vFog);
    gl_FragColor = vec4(col * a, a);
  }
}
`;

export class Particles {
  constructor(game, { max = 3000, additive = false, name = 'particles', order = 20 } = {}) {
    this.max = max;
    this.additive = additive;
    this.n = 0;
    // sim state
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.life = new Float32Array(max);
    this.age = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.size1 = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.kind = new Float32Array(max);
    this.seed = new Float32Array(max);
    this.fadeIn = new Float32Array(max);
    this.stretch = new Float32Array(max);
    const quad = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
    const geo = new InstancedBufferGeometry();
    geo.setAttribute('position', new BufferAttribute(quad, 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(DynamicDrawUsage);
    this.aCol = new InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(DynamicDrawUsage);
    this.aParam = new InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(DynamicDrawUsage);
    this.aVel = new InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(DynamicDrawUsage);
    this._attrs = [this.aPos, this.aCol, this.aParam];
    geo.setAttribute('aPos', this.aPos);
    geo.setAttribute('aVel', this.aVel);
    geo.setAttribute('aCol', this.aCol);
    geo.setAttribute('aParam', this.aParam);
    geo.instanceCount = 0;
    this.geo = geo;
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: Object.assign({}, G, {
        uNoise: { value: getNoiseTexture() },
        uAdditive: { value: additive ? 1 : 0 },
        uStretchVel: { value: new Vector3() },
      }),
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: additive ? OneFactor : OneMinusSrcAlphaFactor,
      premultipliedAlpha: true,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
    this.mesh.name = name;
    game.engine.sceneT.add(this.mesh);
    this.wind = null;
  }

  /**
   * o: { pos, vel, life, size, sizeEnd, color (Color or [r,g,b]), alpha, drag, gravity,
   *      kind (0 mist, 1 glow, 2 sparkle, 3 sea spray droplet, 4 bubble, 5 underwater mote,
   *            6 wind stroke along its motion, 7 wind arc across its motion),
   *      stretch (kinds 6, 7: stroke length in widths, default 4) }
   */
  emit(o) {
    let i;
    if (this.n < this.max) i = this.n++;
    else {
      // recycle the oldest-looking particle
      i = (this._rr = ((this._rr || 0) + 1) % this.max);
    }
    const p = o.pos, v = o.vel;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v ? v.x : 0; this.vel[i * 3 + 1] = v ? v.y : 0; this.vel[i * 3 + 2] = v ? v.z : 0;
    const c = o.color;
    const cr = c ? (c.isColor ? c.r : c[0]) : 1, cg = c ? (c.isColor ? c.g : c[1]) : 1, cb = c ? (c.isColor ? c.b : c[2]) : 1;
    this.col[i * 4] = cr; this.col[i * 4 + 1] = cg; this.col[i * 4 + 2] = cb; this.col[i * 4 + 3] = o.alpha ?? 1;
    this.life[i] = o.life ?? 2;
    this.age[i] = 0;
    this.size0[i] = o.size ?? 1;
    this.size1[i] = o.sizeEnd ?? (o.size ?? 1) * 2;
    this.drag[i] = o.drag ?? 0.6;
    this.grav[i] = o.gravity ?? 0;
    this.kind[i] = o.kind ?? 0;
    this.seed[i] = Math.random() * 10;
    this.fadeIn[i] = o.fadeIn ?? 0.15;
    this.stretch[i] = o.stretch ?? 4;
  }

  update(dt) {
    let w = 0;
    const P = this.aPos.array, C = this.aCol.array, Q = this.aParam.array, V = this.aVel.array;
    const wind = G.uWind.value;
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        // swap-remove
        const last = this.n - 1;
        if (i !== last) this._copy(last, i);
        this.n--;
        i--;
        continue;
      }
      const k = Math.exp(-this.drag[i] * dt);
      const i3 = i * 3;
      // bubbles and motes live under the sea, out of the wind
      const wk = this.kind[i] > 3.5 ? 0 : (1 - k) * 0.6;
      this.vel[i3] = this.vel[i3] * k + wind.x * wk;
      this.vel[i3 + 1] = this.vel[i3 + 1] * k - this.grav[i] * dt;
      this.vel[i3 + 2] = this.vel[i3 + 2] * k + wind.z * wk;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const t = this.age[i] / this.life[i];
      const fade = Math.min(1, this.age[i] / Math.max(this.fadeIn[i], 1e-3)) * (1 - t * t);
      const w4 = w * 4;
      P[w4] = this.pos[i3]; P[w4 + 1] = this.pos[i3 + 1]; P[w4 + 2] = this.pos[i3 + 2];
      P[w4 + 3] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      C[w4] = this.col[i * 4]; C[w4 + 1] = this.col[i * 4 + 1]; C[w4 + 2] = this.col[i * 4 + 2];
      C[w4 + 3] = this.col[i * 4 + 3] * fade;
      Q[w4] = this.seed[i]; Q[w4 + 1] = t; Q[w4 + 2] = this.stretch[i]; Q[w4 + 3] = this.kind[i];
      const w3 = w * 3;
      V[w3] = this.vel[i3]; V[w3 + 1] = this.vel[i3 + 1]; V[w3 + 2] = this.vel[i3 + 2];
      w++;
    }
    this.geo.instanceCount = w;
    if (w > 0) {
      for (let k = 0; k < 3; k++) {
        const a = this._attrs[k];
        a.clearUpdateRanges();
        a.addUpdateRange(0, w * 4);
        a.needsUpdate = true;
      }
      this.aVel.clearUpdateRanges();
      this.aVel.addUpdateRange(0, w * 3);
      this.aVel.needsUpdate = true;
    }
  }

  _copy(from, to) {
    for (let k = 0; k < 3; k++) { this.pos[to * 3 + k] = this.pos[from * 3 + k]; this.vel[to * 3 + k] = this.vel[from * 3 + k]; }
    for (let k = 0; k < 4; k++) this.col[to * 4 + k] = this.col[from * 4 + k];
    this.life[to] = this.life[from]; this.age[to] = this.age[from];
    this.size0[to] = this.size0[from]; this.size1[to] = this.size1[from];
    this.drag[to] = this.drag[from]; this.grav[to] = this.grav[from];
    this.kind[to] = this.kind[from]; this.seed[to] = this.seed[from]; this.fadeIn[to] = this.fadeIn[from];
    this.stretch[to] = this.stretch[from];
  }
}
