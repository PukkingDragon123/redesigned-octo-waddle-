// Splashes and spouts as real water (docs/VUR_SOK.md 0.10): no puff sprites. One instanced draw of
// curved sheets, each instance a parametric surface shaped on the GPU from its birth record:
//   0 crown: a thin curved ring (or a fan, for slaps) that rises, leans out, thins, tears into
//     fingers at its rim and falls back
//   1 jet: the central Worthington column of a big impact, necking into blobs at its top
//   2 foam: a lacy patch of whitewater spreading and fading on the sea
//   3 plume: a translucent streak sheet of atomised spray (a spout's mist), drifting downwind
// Instances age on the GPU (uTime minus their birth), so a frame costs nothing on the CPU; a birth
// rewrites one slot. Fine spray is the shared droplet particles (kinds 3 and 9), shed from the rim
// over the crown's life by a small pool of emitter jobs.
import {
  InstancedBufferGeometry, InstancedBufferAttribute, BufferAttribute, Mesh, ShaderMaterial,
  CustomBlending, OneFactor, OneMinusSrcAlphaFactor, Vector3, DoubleSide,
} from 'three';
import { G } from '../render/Globals.js';
import { UNIFORMS, NOISE, LIGHTING, DEPTH, SEA } from '../render/shaders/common.js';
import { getNoiseTexture } from '../render/NoiseTex.js';

const NU = 40; // around (or across a sheet)
const NV = 12; // up (or along)
const POOL = 64;
const JOBS = 16;

const VERT = /* glsl */ `
${UNIFORMS}
attribute vec4 iA; // birth position xyz, type
attribute vec4 iB; // birth time, life, radius R, height H
attribute vec4 iC; // fan dir x, z, fan 0..1, seed
attribute vec4 iD; // carrier velocity xyz (drift), alpha
varying vec3 vP;
varying vec3 vN;
varying vec2 vUv;
varying vec4 vK;   // x age01, y type, z seed, w alpha
varying float vViewZ;
varying float vFan;
const float PI = 3.14159265;
float hs(float n) { return fract(sin(n * 91.345) * 47453.21); }
// smooth angular irregularity (periodic in theta)
float wob(float th, float sd) {
  return sin(th * 3.0 + sd * 6.0) * 0.5 + sin(th * 7.0 + sd * 11.0) * 0.3 + sin(th * 13.0 + sd * 3.0) * 0.2;
}
float fanTheta(float u) {
  float base = atan(iC.y, iC.x);
  float w = mix(6.2831853, 1.9, iC.z);
  return iC.z < 0.01 ? u * 6.2831853 : base + (u - 0.5) * w;
}
// the crown wall at (theta, v) for age01 t
vec3 crownAt(float th, float v, float t) {
  float R = iB.z, H = iB.w, sd = iC.w;
  vec2 d = vec2(cos(th), sin(th));
  float fanAlong = iC.z > 0.01 ? max(dot(d, normalize(iC.xy + 1e-5)), 0.0) : 1.0;
  // the wall rises fast, hangs, and falls back under gravity
  float rise = sin(PI * clamp(t * 1.25, 0.0, 1.0));
  float h = H * pow(max(rise, 0.0), 0.7) * (0.8 + 0.35 * wob(th, sd)) * mix(1.0, 0.7 + 0.6 * fanAlong, iC.z);
  float rb = R * (0.4 + 0.75 * (1.0 - exp(-t * 3.5))) * mix(1.0, 0.6 + 0.9 * fanAlong, iC.z);
  float lean = mix(0.22, 0.85, t) * mix(1.0, 1.4, iC.z);
  float rad = rb + v * h * sin(lean) + R * 0.05 * wob(th * 1.7, sd + 2.0) * v;
  float y = v * h * cos(lean);
  // the rim curls out and over as the crown starts to fall
  rad += v * v * v * h * 0.25 * t;
  y -= v * v * v * h * 0.3 * t * t;
  return vec3(d.x * rad, y, d.y * rad);
}
vec3 jetAt(float th, float v, float t) {
  float R = iB.z, H = iB.w, sd = iC.w;
  // a Worthington jet: rises after the cavity collapses, necks, and falls back into itself
  float tt = clamp((t - 0.12) / 0.88, 0.0, 1.0);
  float h = H * sin(PI * pow(tt, 0.75));
  float rj = R * 0.16 * (1.0 - 0.55 * v) * (1.0 + 0.28 * sin(v * 9.0 + sd * 5.0 + t * 6.0)) * (0.6 + 0.6 * tt);
  rj *= 1.0 + 0.6 * smoothstep(0.85, 1.0, v); // the bulb at its tip
  vec2 d = vec2(cos(th), sin(th));
  vec2 lean = vec2(hs(sd) - 0.5, hs(sd + 1.0) - 0.5) * 0.25 * v * h;
  return vec3(d.x * rj + lean.x, v * h, d.y * rj + lean.y);
}
void main() {
  float type = iA.w;
  float age = uTime - iB.x;
  float life = iB.y;
  float t = age / life;
  vK = vec4(t, type, iC.w, iD.w);
  vUv = position.xy;
  vFan = iC.z;
  if (age < 0.0 || t >= 1.0 || iD.w <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float u = position.x, v = position.y;
  vec3 C = iA.xyz;
  vec3 P, N;
  if (type < 0.5 || (type > 0.5 && type < 1.5)) {
    float th = type < 0.5 ? fanTheta(u) : u * 6.2831853;
    float e = 0.01;
    vec3 a = type < 0.5 ? crownAt(th, v, t) : jetAt(th, v, t);
    vec3 b = type < 0.5 ? crownAt(th + e, v, t) : jetAt(th + e, v, t);
    vec3 c = type < 0.5 ? crownAt(th, v + e, t) : jetAt(th, v + e, t);
    N = normalize(cross(c - a, b - a));
    P = C + a;
  } else if (type < 2.5) {
    // foam: a flat disc on the sea, spreading
    float th = u * 6.2831853;
    float R = iB.z * (0.55 + 1.2 * sqrt(t));
    float r = v * R * (1.0 + 0.28 * wob(th, iC.w) * v);
    P = C + vec3(cos(th) * r, 0.04, sin(th) * r) + iD.xyz * age;
    N = vec3(0.0, 1.0, 0.0);
  } else {
    // plume: a streak sheet along a rising, slowing, downwind-bending axis, turned to face the eye
    float H = iB.w, R = iB.z, sd = iC.w;
    float reach = H * min(1.0, (1.0 - exp(-age * 2.2)) * 1.15);
    vec2 tilt = vec2(hs(sd) - 0.5, hs(sd + 3.0) - 0.5) * 0.35;
    vec3 drift = iD.xyz * age;
    vec3 ax0 = vec3(tilt.x * v, 1.0, tilt.y * v) * v * reach + drift * pow(v, 1.4);
    vec3 ax1 = vec3(tilt.x * (v + 0.02), 1.0, tilt.y * (v + 0.02)) * (v + 0.02) * reach + drift * pow(v + 0.02, 1.4);
    vec3 T = normalize(ax1 - ax0 + vec3(0.0, 1e-4, 0.0));
    vec3 toEye = normalize(uCamPos - (C + ax0));
    vec3 side = normalize(cross(T, toEye));
    float w = R * (0.5 + 5.5 * pow(v, 0.8)) * (0.6 + 0.7 * sqrt(t));
    P = C + ax0 + side * (u - 0.5) * w;
    N = toEye;
  }
  vP = P;
  vN = N;
  vec4 mv = viewMatrix * vec4(P, 1.0);
  if (type > 1.5 && type < 2.5) mv.xyz -= normalize(mv.xyz) * min(0.35, -mv.z * 0.02);
  vViewZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${LIGHTING}
${DEPTH}
${SEA}
uniform sampler2D uNoise;
varying vec3 vP;
varying vec3 vN;
varying vec2 vUv;
varying vec4 vK;
varying float vViewZ;
varying float vFan;
float hf(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
void main() {
  float t = vK.x, type = vK.y, sd = vK.z;
  float u = vUv.x, v = vUv.y;
  vec3 V = normalize(uCamPos - vP);
  vec3 N = normalize(vN);
  if (dot(N, V) < 0.0) N = -N;
  vec3 L = uSunDir;
  float sunUp = smoothstep(-0.06, 0.08, L.y);
  vec3 sunC = uSunColor * sunUp * (1.0 - 0.7 * uStorm) + uMoonColor * uNight * 0.5;
  float mu = dot(-V, L);
  float g1 = 0.6;
  float hg = (1.0 - g1 * g1) / pow(1.0 + g1 * g1 - 2.0 * g1 * mu, 1.5);
  vec3 amb = hemiAmbient(N) + uSkyAmbient * 0.25;
  float a = 0.0;
  vec3 col = vec3(0.0);
  if (type < 1.5) {
    // ---- a sheet of water: glassy where it is thick and whole, white where it is torn and aerated
    float mask = 1.0;
    float n1 = texture(uNoise, vec2(u * (type < 0.5 ? 5.0 : 2.0), v * 0.9) + sd * 0.37).r;
    float n2 = texture(uNoise, vec2(u * (type < 0.5 ? 13.0 : 5.0), v * 2.3 - t * 0.6) + sd * 0.71).b;
    if (type < 0.5) {
      // fingers at the rim, lengthening as the crown ages; holes tearing through the thinning sheet
      float nf = vFan > 0.01 ? 14.0 : 30.0 + floor(hf(sd) * 10.0);
      float fu = u * nf + (n1 - 0.5) * 1.4;
      float fp = abs(fract(fu) - 0.5) * 2.0;
      float vr = 0.62 - 0.3 * t;
      float fz = clamp((v - vr) / max(1.0 - vr, 0.05), 0.0, 1.0);
      float fw = mix(1.05, 0.12, pow(fz, 0.8)) * (0.75 + 0.5 * hf(floor(fu) + sd));
      mask *= 1.0 - smoothstep(fw - 0.12, fw, fp);
      float tear = smoothstep(0.35, 0.95, t) * 0.75;
      mask *= smoothstep(tear - 0.06, tear + 0.06, n2 * 0.6 + n1 * 0.4 + (1.0 - v) * 0.2);
      mask *= smoothstep(0.0, 0.06, v);
      if (vFan > 0.01) mask *= smoothstep(0.0, 0.12, u) * smoothstep(1.0, 0.88, u);
    } else {
      // the jet necks into blobs near its tip as it falls back
      float brk = mix(1.1, 0.55, smoothstep(0.4, 1.0, t));
      mask *= 1.0 - smoothstep(brk - 0.08, brk, v + (n2 - 0.5) * 0.25);
      mask *= smoothstep(0.0, 0.05, v);
    }
    if (mask < 0.01) discard;
    float aer = clamp(0.3 + 0.55 * smoothstep(0.15, 0.95, v) + 0.45 * t + (n2 - 0.5) * 0.5, 0.0, 1.0);
    if (type > 0.5) aer = clamp(0.55 + 0.4 * v + (n2 - 0.5) * 0.4, 0.0, 1.0);
    float nv = max(dot(N, V), 0.0);
    float F = seaFresnel(nv);
    vec3 R = reflect(-V, N);
    vec3 refl = skyEnv(vec3(R.x, abs(R.y), R.z), 1.5);
    // what the clear water shows through it: the sea below its rim, the sky bent above
    vec3 Tr = refract(-V, N, 0.75);
    vec3 through = Tr.y > 0.0 ? skyEnv(Tr, 2.5) * 0.8 : uSeaBody * 1.6 + uSeaScatter * 0.35;
    vec3 clear = refl * F + through * (1.0 - F) * vec3(0.78, 0.93, 0.95);
    // aerated water is white by multiple scattering: lit through when backlit
    float ndl = dot(N, L);
    vec3 white = sunC * (0.45 + 0.35 * max(ndl, 0.0) + 0.35 * min(hg, 3.0) * 0.4) + amb * 1.05;
    vec3 H = normalize(L + V);
    float glint = pow(max(dot(N, H), 0.0), 160.0) * 4.0 + pow(max(dot(N, H), 0.0), 24.0) * 0.12;
    col = mix(clear, white * 0.92, aer) + sunC * glint * (1.0 - 0.5 * aer);
    col += vec3(0.06, 0.45, 0.8) * uWaterParams.z * 0.4 * aer;
    float fade = 1.0 - smoothstep(0.7, 1.0, t);
    a = mask * mix(0.5 + 0.4 * F, 0.9, aer) * fade;
  } else if (type < 2.5) {
    // ---- foam: lacy cells of bubbles, densest where the water fell back, thinning to streaks
    float th = u * 6.2831853;
    vec2 q = vec2(cos(th), sin(th)) * v;
    vec2 wp = vP.xz;
    float c1 = texture(uNoise, wp * 0.09 + sd).g;
    float c2 = texture(uNoise, wp * 0.31 + sd * 1.7).g;
    float c3 = texture(uNoise, wp * 0.023 + sd * 0.3).r;
    float lace = smoothstep(0.48 + 0.22 * t, 0.68 + 0.2 * t, c1 * 0.55 + c2 * 0.45);
    float fine = smoothstep(0.35, 0.6, texture(uNoise, wp * 0.9 + sd * 2.3).g);
    float ring = exp(-pow((v - mix(0.5, 0.85, t)) / 0.22, 2.0));
    float core = (1.0 - smoothstep(0.0, 0.45, v)) * (1.0 - smoothstep(0.0, 0.35, t));
    float body = max(ring, core * 0.8) * (1.0 - smoothstep(0.55 + 0.3 * c3, 1.0, v));
    float patchy = smoothstep(0.25, 0.65, c3);
    a = clamp((lace * 0.8 + fine * 0.2) * body * (0.45 + 0.55 * patchy), 0.0, 0.7);
    a *= pow(1.0 - t, 1.3) * smoothstep(0.0, 0.05, t);
    vec3 foamC = sunC * max(L.y, 0.0) * 0.85 + uSkyAmbient * 0.9 + uBounce * 0.2;
    col = foamC * 0.9;
    col += vec3(0.06, 0.45, 0.8) * uWaterParams.z * 0.6;
    if (a < 0.004) discard;
  } else {
    // ---- plume: atomised spray in long streaks, forward scattering the sun (silver when backlit)
    float x = (u - 0.5) * 2.0;
    float across = exp(-x * x * 2.4);
    float s1 = texture(uNoise, vec2(u * 0.9 + sd, v * 0.18 - vK.x * 0.15)).g;
    float s2 = texture(uNoise, vec2(u * 2.3 + sd * 1.3, v * 0.4 - vK.x * 0.3)).a;
    float streak = smoothstep(0.25, 0.85, s1 * 0.6 + s2 * 0.4);
    float along = smoothstep(0.02, 0.3, v) * (1.0 - smoothstep(0.5, 1.0, v));
    float dens = across * along * (0.2 + 0.95 * streak) * (1.0 - smoothstep(0.3, 1.0, t)) * smoothstep(0.0, 0.06, t);
    a = clamp(dens * 0.2, 0.0, 1.0);
    if (a < 0.003) discard;
    vec3 sky = mix(uSkyHorizon, uSkyZenith, 0.4);
    col = sunC * (0.35 + 0.55 * min(hg, 4.0)) + amb * 0.95 + sky * 0.15;
  }
  a *= vK.w;
  float sceneZ = sceneDepthAt(gl_FragCoord.xy / uResolution);
  a *= clamp((sceneZ - vViewZ + (type > 1.5 && type < 2.5 ? 0.3 : 0.0)) / (type > 1.5 && type < 2.5 ? 0.6 : 0.35), 0.0, 1.0);
  a *= smoothstep(0.4, 2.5, vViewZ);
  if (a < 0.002) discard;
  col = applyFog(col, vP);
  gl_FragColor = vec4(col * a, a);
}
`;

const _v = new Vector3();
const _w = new Vector3();

export class Splash {
  constructor(game) {
    this.game = game;
    const nv = (NU + 1) * (NV + 1);
    const pos = new Float32Array(nv * 3);
    for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
      const k = (j * (NU + 1) + i) * 3;
      pos[k] = i / NU; pos[k + 1] = j / NV; pos[k + 2] = 0;
    }
    const idx = [];
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
      const a = j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
    const geo = new InstancedBufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setIndex(idx);
    this.iA = new InstancedBufferAttribute(new Float32Array(POOL * 4), 4);
    this.iB = new InstancedBufferAttribute(new Float32Array(POOL * 4), 4);
    this.iC = new InstancedBufferAttribute(new Float32Array(POOL * 4), 4);
    this.iD = new InstancedBufferAttribute(new Float32Array(POOL * 4), 4);
    for (let i = 0; i < POOL; i++) { this.iB.array[i * 4] = -1e5; this.iB.array[i * 4 + 1] = 1; }
    geo.setAttribute('iA', this.iA);
    geo.setAttribute('iB', this.iB);
    geo.setAttribute('iC', this.iC);
    geo.setAttribute('iD', this.iD);
    geo.instanceCount = 0;
    this.geo = geo;
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: Object.assign({}, G, { uNoise: { value: getNoiseTexture() } }),
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
    this.mesh.renderOrder = 18;
    this.mesh.name = 'fx-splash';
    game.engine.sceneT.add(this.mesh);
    this.slot = 0;
    this.live = 0;
    // droplet-shedding jobs: { t0, dur, x, y, z, R, H, n, acc, fx, fz, fan, kind }
    this.jobs = Array.from({ length: JOBS }, () => ({ on: false, t0: 0, dur: 1, x: 0, y: 0, z: 0, R: 1, H: 1, rate: 0, acc: 0, fx: 0, fz: 0, fan: 0, up: 1 }));
    this._em = { pos: new Vector3(), vel: new Vector3(), life: 1, size: 0.01, sizeEnd: 0.01, alpha: 0.9, drag: 0.2, gravity: 9.8, kind: 3, color: [0.96, 0.98, 1], fadeIn: 0.01, stretch: 4 };
  }

  _spawn(type, x, y, z, life, R, H, fx = 0, fz = 0, fan = 0, vx = 0, vy = 0, vz = 0, alpha = 1) {
    const i = this.slot++ % POOL;
    const A = this.iA.array, B = this.iB.array, C = this.iC.array, D = this.iD.array, k = i * 4;
    A[k] = x; A[k + 1] = y; A[k + 2] = z; A[k + 3] = type;
    B[k] = G.uTime.value; B[k + 1] = life; B[k + 2] = R; B[k + 3] = H;
    C[k] = fx; C[k + 1] = fz; C[k + 2] = fan; C[k + 3] = Math.random() * 10;
    D[k] = vx; D[k + 1] = vy; D[k + 2] = vz; D[k + 3] = alpha;
    this.live = Math.max(this.live, G.uTime.value + life);
    this.geo.instanceCount = POOL;
    this.iA.needsUpdate = this.iB.needsUpdate = this.iC.needsUpdate = this.iD.needsUpdate = true;
  }

  _job(x, y, z, R, H, dur, rate, fx, fz, fan, up) {
    let J = null, oldest = Infinity;
    for (const j of this.jobs) {
      if (!j.on) { J = j; break; }
      if (j.t0 < oldest) { oldest = j.t0; J = j; }
    }
    J.on = true; J.t0 = G.uTime.value; J.dur = dur; J.x = x; J.y = y; J.z = z; J.R = R; J.H = H;
    J.rate = rate; J.acc = 0; J.fx = fx; J.fz = fz; J.fan = fan; J.up = up;
  }

  /**
   * Something hitting (or leaving) the sea at pos: a crown or a fan along dir, a jet for big ones,
   * foam, and droplets shed from the rim. s ~0.2 (a skim) .. 3 (a whale landing), radius in m.
   */
  impact(pos, s, radius, dir = null) {
    if (G.uUnderwater.value > 0.5 || s < 0.25) return;
    const k = Math.min(Math.max(s, 0.05), 3);
    const R = Math.max(0.4, radius * 0.38) * (0.7 + 0.3 * Math.sqrt(k));
    const H = Math.min(R * 1.7, (0.8 + 2.6 * Math.sqrt(k)) * Math.sqrt(radius / 3));
    let fx = 0, fz = 0, fan = 0;
    if (dir) {
      const l = Math.hypot(dir.x, dir.z);
      if (l > 1e-3) { fx = dir.x / l; fz = dir.z / l; fan = 0.75; }
    }
    const life = 0.8 + 0.55 * Math.sqrt(k);
    const y = pos.y;
    this._spawn(0, pos.x, y, pos.z, life, R, H, fx, fz, fan);
    if (k > 0.6 && !fan) this._spawn(0, pos.x, y, pos.z, life * 0.8, R * 0.65, H * 0.55, 0, 0, 0, 0, 0, 0, 0.8);
    if (k >= 1.1 && !fan) this._spawn(1, pos.x, y, pos.z, life * 1.25, R, H * (1.1 + 0.25 * k), 0, 0, 0);
    if (k >= 0.3) {
      const wind = G.uWind.value;
      this._spawn(2, pos.x, y, pos.z, 4 + 3 * Math.sqrt(k), R * 1.25, 0, 0, 0, 0, wind.x * 0.04, 0, wind.z * 0.04, Math.min(1, 0.5 + k * 0.35));
    }
    // fine spray off the rim over the crown's rise
    this._job(pos.x, y, pos.z, R, H, life * 0.6, 260 + 420 * Math.min(k, 2.5), fx, fz, fan, 1);
  }

  /** A burst of spray off the sea with no crown (a pressure wave skimming it, a skid). */
  sheet(pos, R, H, dir = null, alpha = 0.8) {
    let fx = 0, fz = 0, fan = 0;
    if (dir) {
      const l = Math.hypot(dir.x, dir.z);
      if (l > 1e-3) { fx = dir.x / l; fz = dir.z / l; fan = 0.6; }
    }
    // no wall of water: the surface is torn into flying whitewater and left foamed
    this._spawn(2, pos.x, pos.y, pos.z, 3.5, R * 0.8, 0, 0, 0, 0, 0, 0, 0, alpha * 0.8);
    this._job(pos.x, pos.y, pos.z, R, H, 0.35, 520, fx, fz, fan, 0.6);
  }

  /**
   * A whale's blow: a narrow jet of fine drops that atomises into a faint plume of streak sheets
   * drifting off with the wind. p: blowhole, w: the whale (L, up, vel), k strength. air: a small
   * breath away from the sea (no fall-back rain).
   */
  spout(p, w, k = 1, air = false) {
    const L = w.L || 4;
    const sc = Math.sqrt(L / 4.2);
    const H = (air ? 1.6 : 3.2) * sc * Math.min(1.4, 0.6 + 0.4 * k);
    const wind = G.uWind.value;
    const vx = wind.x * 0.55 + (w.vel ? w.vel.x * 0.3 : 0), vz = wind.z * 0.55 + (w.vel ? w.vel.z * 0.3 : 0);
    const nSheets = air ? 3 : 5;
    for (let i = 0; i < nSheets; i++) {
      const life = (air ? 1.8 : 3.2) + Math.random() * 1.2;
      this._spawn(3, p.x, p.y, p.z, life, (0.22 + 0.12 * Math.random()) * sc, H * (0.7 + 0.5 * Math.random()), 0, 0, 0, vx, 0, vz, (air ? 0.6 : 0.85) * (0.7 + 0.3 * Math.random()));
    }
    // the jet itself: fine drops shot up fast, a few heavier ones raining back
    const g = this.game, E = this._em;
    if (!g.mist) return;
    const up = w.up || _w.set(0, 1, 0);
    const n = Math.round((air ? 40 : 110) * Math.min(k, 1.5) * sc);
    for (let i = 0; i < n; i++) {
      const u = Math.random();
      const sp = (4 + 9 * Math.pow(u, 0.5)) * sc * Math.min(1.2, 0.6 + 0.4 * k) * (air ? 0.6 : 1);
      const a = Math.random() * 6.2832, r = Math.random() * (0.4 + 1.6 * u) * sc;
      E.pos.copy(p);
      E.vel.copy(up).multiplyScalar(sp).add(_v.set(Math.cos(a) * r, 0, Math.sin(a) * r));
      if (w.vel) E.vel.addScaledVector(w.vel, 0.5);
      E.vel.x += wind.x * 0.2; E.vel.z += wind.z * 0.2;
      const big = i % 6 === 0;
      E.life = 0.9 + Math.random() * 0.9;
      E.size = big ? 0.005 + 0.006 * Math.random() : 0.0025 + 0.0025 * Math.random(); E.sizeEnd = E.size;
      E.alpha = big ? 0.9 : 0.7; E.drag = big ? 0.5 : 1.6 + Math.random(); E.gravity = 9.8; E.kind = 3; E.fadeIn = 0.01;
      E.color[0] = 0.97; E.color[1] = 0.98; E.color[2] = 1.0;
      g.mist.emit(E);
    }
  }

  /** A drifting veil of fine spray (a waterfall's foot, a churned lip): one streak sheet. */
  veil(pos, R, H, life = 4, alpha = 0.7) {
    const wind = G.uWind.value;
    this._spawn(3, pos.x, pos.y, pos.z, life, R, H, 0, 0, 0, wind.x * 0.5, 0, wind.z * 0.5, alpha);
  }

  update(dt) {
    const now = G.uTime.value;
    const g = this.game;
    // nothing alive: draw nothing (the draw call stays, with no instances)
    if (now > this.live || now < this.live - 60) this.geo.instanceCount = 0;
    if (!g.mist) return;
    const E = this._em;
    for (const J of this.jobs) {
      if (!J.on) continue;
      const age = now - J.t0;
      if (age > J.dur || age < 0) { J.on = false; continue; }
      J.acc += J.rate * dt;
      let n = Math.min(120, Math.floor(J.acc));
      J.acc -= n;
      const t = age / J.dur;
      // the rim of the rising crown, roughly (matches crownAt in the shader)
      const rb = J.R * (0.4 + 0.75 * (1 - Math.exp(-t * 0.6 * 3.5)));
      const h = J.H * Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.75)), 0.7);
      const base = Math.atan2(J.fz, J.fx);
      while (n-- > 0) {
        const th = J.fan ? base + (Math.random() - 0.5) * 1.9 : Math.random() * 6.2832;
        const cx = Math.cos(th), cz = Math.sin(th);
        const v = 0.6 + Math.random() * 0.45;
        const rr = rb + v * h * 0.35;
        E.pos.set(J.x + cx * rr, J.y + v * h * 0.9, J.z + cz * rr);
        const out = (1.2 + Math.random() * 2.6) * Math.sqrt(J.H) * (J.fan ? 1.8 : 1);
        const upv = (1.5 + Math.random() * 3.5) * Math.sqrt(J.H) * J.up * (1 - t * 0.6);
        E.vel.set(cx * out, upv, cz * out);
        const u = Math.random();
        const cluster = u < 0.22;
        E.kind = cluster ? 9 : 3;
        E.life = 0.6 + Math.random() * 0.9;
        E.size = cluster ? 0.05 + 0.08 * Math.random() * Math.min(1.5, J.H / 2) : 0.003 + 0.01 * u * u;
        E.sizeEnd = cluster ? E.size * 2 : E.size;
        E.alpha = cluster ? 0.8 : 0.92; E.drag = cluster ? 0.6 : 0.12 + 0.3 * Math.random(); E.gravity = 9.8; E.fadeIn = 0.01;
        E.color[0] = 0.96; E.color[1] = 0.98; E.color[2] = 1.0;
        g.mist.emit(E);
      }
    }
  }
}
