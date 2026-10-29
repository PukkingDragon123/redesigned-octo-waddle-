// Wind lines (docs/VUR_SOK.md 0.10): thin, faint streamlines in the air that show the wind and the
// calf's speed, the way film shows moving air. One instanced draw of tapered camera-facing ribbons,
// every point placed on the GPU (no per-frame buffers; only a few uniforms change):
//   0 air: tracers riding the wind around the calf, streaked along the flow the camera sees (the
//     wind minus the calf's own motion), longer and more numerous at speed, parting around its body
//   1 gust: long low lines over the sea, brightest where a gust is coming (the wind's own future
//     gust curve, laid out upwind), so a gust is seen sweeping in before it arrives
//   2 wingtip: the vortex trails off the wing tips at high speed (a recorded path)
//   4 burst: lines thrown out by a sonic boom, racing away with the pressure wave
//   5 spindrift: spray-laden streaks blown off the crests in a gale
// Nothing is a ring or a stroke: soft alpha, a faint sun-side highlight, fading near the eye and far.
import {
  InstancedBufferGeometry, InstancedBufferAttribute, BufferAttribute, Mesh, ShaderMaterial,
  CustomBlending, OneFactor, OneMinusSrcAlphaFactor, Vector3, Vector4, DoubleSide,
} from 'three';
import { G } from '../render/Globals.js';
import { UNIFORMS, LIGHTING, DEPTH } from '../render/shaders/common.js';
import { noise } from '../core/noise.js';
import { clamp, smoothstep, damp } from '../core/math.js';

const NS = 22;      // segments along a line
const NT = 24;      // wingtip path samples per side
const COUNTS = [[0, 150], [1, 70], [2, 2], [4, 48], [5, 50]];

const VERT = /* glsl */ `
${UNIFORMS}
attribute vec4 iL; // seed xyz (0..1), phase
attribute vec4 iM; // type, length k, width k, seed2
uniform vec3 uFocus;
uniform vec3 uFwd;
uniform vec3 uVel;
uniform vec4 uBody;     // L, radius, speed, on
uniform vec4 uAmb;      // air density, length k, alpha, storm
uniform vec3 uWindOff;  // integrated wind displacement (m)
uniform vec4 uGustA[2]; // the gust to come at 0, 2.5, .. 17.5 s
uniform vec4 uTip[${NT * 2}];
uniform float uTipK;
uniform vec4 uBoom;     // centre, birth time
uniform vec4 uBoomP;    // reach, speed, power, life
uniform vec4 uSpin;     // spindrift density, gust-line density
varying vec2 vSL;       // side -1..1, s 0..1
varying float vA;
varying float vLit;
varying float vType;
varying vec3 vP;
varying float vViewZ;
float hs(float n) { return fract(sin(n * 78.233) * 43758.5453); }
float gustAt(float tau) {
  float f = clamp(tau / 2.5, 0.0, 7.0);
  int i = int(floor(f));
  float w = f - float(i);
  float a0 = 0.0, a1 = 0.0;
  for (int k = 0; k < 8; k++) {
    float g = k < 4 ? uGustA[0][k] : uGustA[1][k - 4];
    if (k == i) a0 = g;
    if (k == min(i + 1, 7)) a1 = g;
  }
  return mix(a0, a1, w);
}
vec3 wrapAround(vec3 X, vec3 c, vec3 B) { return c + mod(X - c + 0.5 * B, B) - 0.5 * B; }
// the calf's body as a capsule: lines are pushed out around it, so the flow parts at the head
vec3 deflect(vec3 p) {
  if (uBody.w < 0.5) return p;
  vec3 a = uFocus + uFwd * uBody.x * 0.38, b = uFocus - uFwd * uBody.x * 0.5;
  vec3 ab = b - a;
  float h = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
  vec3 d = p - (a + ab * h);
  float r = length(d);
  float Rb = uBody.y * 1.35 + 0.25;
  float k = smoothstep(Rb * 3.5, Rb * 0.9, r);
  return p + d / max(r, 1e-3) * Rb * Rb / max(r, Rb * 0.6) * k * 0.9;
}
void main() {
  float type = iM.x;
  float s = position.x;      // 0 head .. 1 tail
  float side = position.y;   // -1 .. 1
  vec3 seed = iL.xyz;
  float sd2 = iM.w;
  vType = type;
  vSL = vec2(side, s);
  float alpha = 0.0;
  float width = 0.04 * iM.z;
  vec3 P = vec3(0.0), Pn = vec3(0.0);
  float ds = 0.03;
  vec3 wind = uWind;
  float wsp = length(wind.xz);
  vec3 wdir = wsp > 0.01 ? vec3(wind.x / wsp, 0.0, wind.z / wsp) : vec3(1.0, 0.0, 0.0);
  if (type < 0.5) {
    // ---- air tracers around the calf
    if (hs(sd2 * 7.1) > uAmb.x) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vec3 B = vec3(64.0, 30.0, 64.0);
    vec3 X = seed * B + uWindOff;
    vec3 an = wrapAround(X, uFocus + vec3(0.0, 2.0, 0.0), B);
    vec3 rel = wind * (1.0 + uGust * 0.5) - uVel * 0.95;
    float sp = length(rel);
    vec3 dir = sp > 0.05 ? rel / sp : wdir;
    float len = clamp(sp * 0.3, 3.0, 17.0) * iM.y * uAmb.y;
    vec3 e1 = normalize(cross(dir, abs(dir.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0)));
    vec3 e2 = cross(e1, dir);
    // never ruler-straight: even at speed every line keeps a hand-drawn waver
    float straight = 0.5 + 0.5 / (1.0 + sp * 0.04);
    float A1 = (0.35 + 1.2 * hs(sd2 + 1.3)) * straight * (0.7 + uGust) * len / 12.0, A2 = A1 * 0.7;
    float ph = sd2 * 20.0 + uTime * (0.5 + 0.6 * hs(sd2));
    for (int q = 0; q < 2; q++) {
      float ss = s + float(q) * ds;
      vec3 p = an - dir * len * ss + e1 * sin(ss * 4.2 + ph) * A1 + e2 * sin(ss * 2.9 + ph * 1.3) * A2;
      p = deflect(p);
      if (q == 0) P = p; else Pn = p;
    }
    vec3 dd = abs(an - uFocus - vec3(0.0, 2.0, 0.0)) / (0.5 * B);
    float edge = max(max(dd.x, dd.y), dd.z);
    float life = sin(3.14159 * fract(uTime / (3.0 + 3.0 * hs(sd2 + 4.0)) + iL.w));
    alpha = uAmb.z * (1.0 - smoothstep(0.55, 0.95, edge)) * life * (0.6 + 0.4 * hs(sd2 + 9.0));
    width *= 4.0 + 1.0 * uAmb.w;
  } else if (type < 1.5) {
    // ---- gust lines low over the sea, lit by the gust that is on its way
    vec3 B = vec3(240.0, 1.0, 240.0);
    vec3 X = vec3(seed.x * B.x, 0.0, seed.z * B.z) + uWindOff * 1.15;
    vec3 an = wrapAround(X, uFocus, B);
    an.y = uSeaLevel + 2.0 + 5.0 * seed.y + uSeaState * 2.0;
    float up = dot(uFocus - an, wdir);
    float tau = up / max(wsp * 1.15, 1.0);
    float gst = up > 0.0 ? gustAt(tau) : gustAt(0.0) * (1.0 - smoothstep(0.0, 40.0, -up));
    float len = (8.0 + 1.2 * wsp) * iM.y;
    vec3 e1 = vec3(-wdir.z, 0.0, wdir.x);
    float ph = sd2 * 17.0 + uTime * 0.4;
    for (int q = 0; q < 2; q++) {
      float ss = s + float(q) * ds;
      vec3 p = an - wdir * len * ss + e1 * sin(ss * 3.1 + ph) * 1.2 + vec3(0.0, sin(ss * 2.3 + ph * 0.7) * 0.35, 0.0);
      if (q == 0) P = p; else Pn = p;
    }
    float dist = length(an.xz - uFocus.xz);
    float life = sin(3.14159 * fract(uTime / (4.0 + 4.0 * hs(sd2 + 2.0)) + iL.w));
    alpha = uSpin.y * smoothstep(0.08, 0.6, gst + 0.1 * smoothstep(4.0, 12.0, wsp)) * (1.0 - smoothstep(70.0, 118.0, dist)) * life * 0.7;
    width *= 2.2;
  } else if (type < 2.5) {
    // ---- a wingtip vortex trail from the recorded path
    int base = seed.x < 0.5 ? 0 : ${NT};
    for (int q = 0; q < 2; q++) {
      float ss = min(s + float(q) * ds, 1.0);
      float f = ss * float(${NT - 1}) * 0.5;
      int i0 = int(floor(f));
      int i1 = min(i0 + 1, ${NT - 1});
      vec4 a0 = uTip[base + i0], a1 = uTip[base + i1];
      vec3 p = mix(a0.xyz, a1.xyz, f - float(i0));
      if (q == 0) { P = p; alpha = mix(a0.w, a1.w, f - float(i0)); } else Pn = p;
    }
    if (s > 0.97) Pn = P + (P - Pn);
    alpha *= uTipK * 0.22;
    width *= 1.5;
  } else if (type < 4.5) {
    // ---- a boom's burst: lines racing out with the pressure front
    float age = uTime - uBoom.w;
    float lifeB = uBoomP.w;
    if (age < 0.0 || age > lifeB) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vec3 d = normalize(seed * 2.0 - 1.0 + vec3(0.0, 0.0001, 0.0));
    d.y *= 0.55;
    d = normalize(d);
    vec3 tg = normalize(cross(d, vec3(0.0, 1.0, 0.0)) + vec3(0.0001));
    float k = age / lifeB;
    float r = uBoomP.y * age * (0.55 + 0.45 * hs(sd2)) + uBoomP.x * 0.04;
    float len = clamp(r * 0.3, 2.0, 18.0) * iM.y;
    for (int q = 0; q < 2; q++) {
      float ss = s + float(q) * ds;
      vec3 p = uBoom.xyz + d * (r - len * ss) + tg * ss * ss * len * 0.35 * (hs(sd2 + 3.0) - 0.5) + vec3(0.0, sin(ss * 3.0 + sd2) * len * 0.05, 0.0);
      if (q == 0) P = p; else Pn = p;
    }
    alpha = pow(1.0 - k, 1.5) * smoothstep(0.0, 0.05, age) * 0.4 * uBoomP.z * (0.4 + 0.6 * hs(sd2 + 8.0));
    width *= 1.6 + r * 0.02;
  } else {
    // ---- spindrift streaming off the crests in a gale
    vec3 B = vec3(110.0, 1.0, 110.0);
    vec3 X = vec3(seed.x * B.x, 0.0, seed.z * B.z) + uWindOff * 1.6;
    vec3 an = wrapAround(X, uFocus, B);
    an.y = uSeaLevel + 0.3 + 1.6 * seed.y * seed.y + uSeaState * 0.8;
    float len = (5.0 + 0.8 * wsp) * iM.y;
    float ph = sd2 * 13.0 + uTime * 1.3;
    for (int q = 0; q < 2; q++) {
      float ss = s + float(q) * ds;
      vec3 p = an - wdir * len * ss + vec3(0.0, -ss * ss * 0.6 + sin(ss * 5.0 + ph) * 0.12, 0.0);
      if (q == 0) P = p; else Pn = p;
    }
    float dist = length(an.xz - uFocus.xz);
    float life = sin(3.14159 * fract(uTime / (1.4 + 1.4 * hs(sd2 + 5.0)) + iL.w));
    alpha = uSpin.x * life * (1.0 - smoothstep(30.0, 54.0, dist)) * 0.8;
    width *= 2.6;
  }
  // a ribbon expanded across its own direction on screen (robust even when the line runs straight
  // at the eye), a couple of pixels or more wide (thinner ones only get fainter)
  vec3 toEye = uCamPos - P;
  float dc = length(toEye);
  vec4 mvc = viewMatrix * vec4(P, 1.0);
  vec4 mvn = viewMatrix * vec4(Pn, 1.0);
  float z = max(-mvc.z, 0.05);
  float pxPerM = projectionMatrix[1][1] * uResolution.y * 0.5 / z;
  float wpx = width * pxPerM;
  if (wpx < 3.5) { alpha *= wpx / 3.5; wpx = 3.5; }
  // never in front of the lens, gone with distance, never under the sea
  alpha *= (type > 1.5 && type < 2.5 ? smoothstep(3.0, 10.0, dc) : smoothstep(4.0, 15.0, dc)) * (1.0 - smoothstep(45.0, 95.0, dc));
  alpha *= smoothstep(-0.1, 0.4, P.y - uSeaLevel) * (1.0 - uUnderwater);
  vec4 c0 = projectionMatrix * mvc;
  vec4 c1 = projectionMatrix * vec4(mvn.xyz, 1.0);
  if (mvn.z > -0.05) c1 = projectionMatrix * vec4(mvc.xyz + normalize(mvn.xyz - mvc.xyz) * 0.01, 1.0);
  vec2 s0 = c0.xy / max(c0.w, 1e-3) * uResolution, s1 = c1.xy / max(c1.w, 1e-3) * uResolution;
  vec2 sd = s1 - s0;
  vec2 dir = length(sd) > 1e-4 ? sd / length(sd) : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  c0.xy += nrm * side * wpx / uResolution * c0.w;
  // the half facing the sun catches a little more light
  vec3 wn = normalize(mat3(transpose(viewMatrix)) * vec3(nrm, 0.0));
  vLit = dot(wn * sign(side + 1e-4), uSunDir);
  vA = alpha;
  vP = P;
  vViewZ = z;
  gl_Position = alpha > 0.0005 && mvc.z < -0.05 ? c0 : vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const FRAG = /* glsl */ `
${UNIFORMS}
${LIGHTING}
${DEPTH}
varying vec2 vSL;
varying float vA;
varying float vLit;
varying float vType;
varying vec3 vP;
varying float vViewZ;
void main() {
  float side = vSL.x, s = vSL.y;
  float cross_ = exp(-side * side * 3.2);
  float taper = smoothstep(0.0, 0.12, s) * pow(1.0 - s, 1.4);
  if (vType > 1.5 && vType < 2.5) taper = smoothstep(0.0, 0.05, s) * pow(1.0 - s, 2.2);
  float a = vA * cross_ * taper;
  if (a < 0.002) discard;
  vec3 V = normalize(vP - uCamPos);
  float mu = dot(V, uSunDir);
  float g1 = 0.55;
  float hg = (1.0 - g1 * g1) / pow(1.0 + g1 * g1 - 2.0 * g1 * mu, 1.5);
  float sunUp = smoothstep(-0.06, 0.08, uSunDir.y);
  vec3 sunC = uSunColor * sunUp * (1.0 - 0.6 * uStorm) + uMoonColor * uNight * 0.5;
  vec3 sky = uSkyAmbient * 0.9 + uSkyHorizon * 0.35;
  float lit = 0.75 + 0.45 * clamp(vLit, -1.0, 1.0);
  vec3 col = sky + sunC * (0.22 + 0.3 * min(hg, 4.0)) * lit;
  // spray-laden lines are whiter and denser
  if (vType > 4.5) col = col * 1.1 + sunC * 0.15;
  float sceneZ = sceneDepthAt(gl_FragCoord.xy / uResolution);
  a *= clamp((sceneZ - vViewZ) / 0.4, 0.0, 1.0);
  col = mix(col, fogColorFor(V), fogAmount(vP));
  gl_FragColor = vec4(col * a, a);
}
`;

const _a = new Vector3();

export class WindLines {
  constructor(game) {
    this.game = game;
    // ribbon: (s, side)
    const pos = new Float32Array((NS + 1) * 2 * 3);
    for (let i = 0; i <= NS; i++) {
      pos[(i * 2) * 3] = i / NS; pos[(i * 2) * 3 + 1] = -1;
      pos[(i * 2 + 1) * 3] = i / NS; pos[(i * 2 + 1) * 3 + 1] = 1;
    }
    const idx = [];
    for (let i = 0; i < NS; i++) { const a = i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    const n = COUNTS.reduce((s, c) => s + c[1], 0);
    const L = new Float32Array(n * 4), M = new Float32Array(n * 4);
    let k = 0;
    let rs = 9871;
    const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
    for (const [type, cnt] of COUNTS) {
      for (let j = 0; j < cnt; j++, k++) {
        L[k * 4] = type === 2 ? (j === 0 ? 0.25 : 0.75) : rnd(); L[k * 4 + 1] = rnd(); L[k * 4 + 2] = rnd(); L[k * 4 + 3] = rnd();
        M[k * 4] = type; M[k * 4 + 1] = type === 2 ? 1 : 0.6 + 0.8 * rnd(); M[k * 4 + 2] = 0.7 + 0.6 * rnd(); M[k * 4 + 3] = rnd() * 10;
      }
    }
    const geo = new InstancedBufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.setAttribute('iL', new InstancedBufferAttribute(L, 4));
    geo.setAttribute('iM', new InstancedBufferAttribute(M, 4));
    geo.instanceCount = n;
    this.tip = Array.from({ length: NT * 2 }, () => new Vector4(0, -1e4, 0, 0));
    this.u = {
      uFocus: { value: new Vector3() }, uFwd: { value: new Vector3(0, 0, 1) }, uVel: { value: new Vector3() },
      uBody: { value: new Vector4(4, 0.6, 0, 0) }, uAmb: { value: new Vector4(0.3, 1, 0.12, 0) },
      uWindOff: { value: new Vector3() }, uGustA: { value: [new Vector4(), new Vector4()] },
      uTip: { value: this.tip }, uTipK: { value: 0 },
      uBoom: { value: new Vector4(0, 0, 0, -1e5) }, uBoomP: { value: new Vector4(10, 60, 1, 1) },
      uSpin: { value: new Vector4(0, 0.6, 0, 0) },
    };
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: Object.assign({}, G, this.u),
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: DoubleSide,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      premultipliedAlpha: true,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 22;
    this.mesh.name = 'fx-windlines';
    game.engine.sceneT.add(this.mesh);
    this.w = null;       // the whale whose speed and body the air lines show (Moves.update tracks it)
    this.zone = 'air';
    this.seen = -1;
    this.boost = 0;      // extra density (dives, dashes)
    this.tipAcc = 0;
    this.amb = 0.3;
    this.tipK = 0;
  }

  /** Called each frame by the player's moves: whose flight the air lines follow. */
  track(w, zone = 'air', boost = 0) {
    this.w = w;
    this.zone = zone;
    this.seen = G.uTime.value;
    this.boost = Math.max(this.boost, boost);
  }

  /** A sonic boom: lines thrown out with the pressure front. */
  burst(center, radius, speed, power = 1) {
    this.u.uBoom.value.set(center.x, center.y, center.z, G.uTime.value);
    this.u.uBoomP.value.set(radius, Math.min(speed, 90) * 0.5, clamp(0.6 + power * 0.5, 0.6, 1.4), clamp(radius / speed * 1.6, 0.6, 1.6));
  }

  update(dt) {
    const g = this.game, u = this.u;
    const wind = g.wind;
    if (wind) {
      u.uWindOff.value.addScaledVector(wind.base, dt);
      // the gust curve ahead (Wind.update's own formula, evaluated in the future)
      const ga = u.uGustA.value;
      for (let k = 0; k < 8; k++) {
        const t = wind.t + k * 2.5;
        const gg = Math.max(0, noise.fbm2(t * 0.18, 7.3, 3)) * wind.turbulence * 2;
        ga[k >> 2].setComponent(k & 3, clamp(gg, 0, 1.5));
      }
    }
    let w = this.w;
    if (!w || G.uTime.value - this.seen > 0.5) w = g.story?.herd?.calf || null;
    const focus = u.uFocus.value;
    let sp = 0;
    if (w) {
      focus.copy(w.pos);
      u.uFwd.value.copy(w.fwd);
      u.uVel.value.copy(w.vel);
      sp = w.vel.length();
      u.uBody.value.set(w.L || 4, w.radius || 0.6, sp, this.zone === 'under' ? 0 : 1);
    } else {
      focus.copy(g.focus);
      u.uVel.value.set(0, 0, 0);
      u.uBody.value.w = 0;
    }
    const storm = G.uStorm.value;
    const windS = wind ? wind.strength * (1 + wind.gust) : 3;
    // more, longer air lines the faster the calf flies (and in dives and dashes)
    const target = clamp(0.18 + 0.7 * smoothstep(6, 30, sp) + this.boost * 0.3 + 0.25 * smoothstep(6, 16, windS) + storm * 0.3, 0, 1);
    this.amb = damp(this.amb, target, 3, dt);
    this.boost = damp(this.boost, 0, 2, dt);
    u.uAmb.value.set(this.amb, 0.8 + 0.4 * smoothstep(10, 34, sp), 0.3 + 0.15 * smoothstep(10, 30, sp) + 0.08 * storm, storm);
    // a gale tears spray off the crests; the gust lines over the sea show wind on the water
    const state = G.uSeaState.value;
    u.uSpin.value.set(smoothstep(0.55, 0.95, Math.max(state, storm)) * smoothstep(6, 14, windS), 0.45 + 0.3 * storm, 0, 0);
    // wingtip vortex trails at high speed
    const tipT = w && this.zone === 'air' ? smoothstep(16, 27, sp) : 0;
    this.tipK = damp(this.tipK, tipT, 6, dt);
    u.uTipK.value = this.tipK;
    if (w && dt > 0) {
      const m = w.model;
      const T = this.tip;
      for (let side = 0; side < 2; side++) {
        const b = side * NT;
        for (let i = NT - 1; i > 0; i--) T[b + i].copy(T[b + i - 1]);
        if (m?.wingTipPos) m.wingTipPos(side ? 'R' : 'L', _a);
        else _a.copy(w.pos).addScaledVector(w.right || w.fwd, (side ? 1 : -1) * (w.L || 4) * 0.5);
        T[b].set(_a.x, _a.y, _a.z, tipT > 0.01 ? 1 : 0);
      }
    }
  }
}
