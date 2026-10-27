// Sky krill: translucent pastel grazers that stream in shimmering, twisting ribbons around
// moisture-rich clouds, swirl into slow spirals around singing whales and burst away from
// mouths, rays, falcons and sonic booms (their photophores flash when startled).
//
// Simulation: no neighbour search. Each swarm owns a slowly evolving closed ribbon (a
// twisted band sampled at M points); every krill has a fixed slot across the band and
// streams along it, steering toward its slot with a damped spring plus predator escapes.
// Distant / off-screen swarms are simulated at a reduced rate and extrapolated on the GPU.
//
// Rendering: near krill (compacted every frame) are small instanced meshes with paddling
// swimmerets, flicking tail fans and sweeping antennae; all krill also feed a soft sprite
// impostor that takes over as they shrink below a few pixels (cross-faded in the shaders).
import {
  Mesh, ShaderMaterial, InstancedBufferAttribute, DynamicDrawUsage, StaticDrawUsage, Vector3, Vector4, DoubleSide,
  CustomBlending, OneFactor, OneMinusSrcAlphaFactor,
} from 'three';
import { G } from '../../render/Globals.js';
import { UNIFORMS, NOISE, SHADOW, LIGHTING, DEPTH } from '../../render/shaders/common.js';
import { ECO_GLSL, ECO_VERT_GLSL, KRILL_PALETTES, KRILL_GLOW, paletteUniforms } from './shaderlib.js';
import { buildKrillGeometry, buildQuadGeometry } from './geometry.js';
import { rng, lerp, clamp, smoothstep } from '../../core/math.js';

export const MAX_KRILL = 16384;
const MAX_NEAR = 6144;
const M = 48; // ribbon samples per swarm
const NPH = 8; // wobble phasors per swarm
const TAU = Math.PI * 2;
const VEIL_F = [0.35, 0.65, 0.9];

const KRILL_VERT = /* glsl */ `
${UNIFORMS}
${ECO_GLSL}
${ECO_VERT_GLSL}
attribute vec4 aPart;
attribute vec3 aRoot;
attribute vec4 aKPos;   // xyz, time written
attribute vec4 aKVel;   // velocity, packed state (floor: visibility*255, fract: startle flash)
attribute vec4 aKSeed;  // seed, size (m), palette (+ fractional tint), stroke phase
uniform vec4 uKLod;     // mesh fade px lo/hi, sprite fade px lo/hi
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vLocal;
varying vec4 vPart;
varying float vPal;
varying float vFlash;
varying float vSeed;
varying vec3 vLocalCam;
void main() {
  float age = clamp(uTime - aKPos.w, 0.0, 0.4);
  vec3 C = aKPos.xyz + aKVel.xyz * age;
  float vis = floor(aKVel.w) / 255.0;
  float flash = fract(aKVel.w);
  float size = aKSeed.y;
  float vz = -(viewMatrix * vec4(C, 1.0)).z;
  float px = projPx(size, vz);
  float lod = smoothstep(uKLod.x, uKLod.y, px) * vis;
  if (lod < 0.02 || vz < 0.05) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 f = aKVel.xyz;
  float sp = length(f);
  f = sp > 1e-3 ? f / sp : vec3(0.0, 0.0, 1.0);
  float roll = sin(uTime * 1.3 + aKSeed.x * 17.0) * 0.22;
  mat3 B = basisFromFwd(f, roll);
  vec3 p = position;
  vec3 n = normal;
  // swimmeret beat speeds up when fleeing
  float stroke = uTime * (8.5 + 9.0 * flash + 2.5 * fract(aKSeed.x * 3.7)) + fract(aKSeed.w) * 6.2831853;
  // abdomen flex; a startled krill tail-flips
  float flex = 0.1 * sin(stroke * 0.5) + flash * 0.6;
  float part = aPart.x;
  vec3 r0 = aRoot;
  float rb = max(0.05 - r0.z, 0.0);
  float rootDy = -flex * rb * rb * 1.6;
  if (part < 0.5) {
    float b = max(0.05 - p.z, 0.0);
    p.y -= flex * b * b * 1.6;
  } else if (part < 1.5) {
    mat3 R = rotX(-flex * 0.9 + 0.12 * sin(stroke * 0.5 + 1.0));
    p = r0 + R * (p - r0);
    p.y += rootDy;
    n = R * n;
  } else if (part < 2.5) {
    // metachronal wave, tail to head
    mat3 R = rotX(0.62 * sin(stroke - aPart.z * 0.95) - 0.12);
    p = r0 + R * (p - r0);
    p.y += rootDy;
    n = R * n;
  } else if (part < 3.5) {
    // antennae sway gently; fold away when tiny so they never shimmer
    float vis2 = smoothstep(7.0, 16.0, px);
    mat3 R = rotY(aPart.w * 0.12 * sin(uTime * 1.7 + aKSeed.x * 9.0)) * rotX(0.08 * sin(uTime * 2.3 + aPart.w));
    p = r0 + (R * (p - r0)) * vis2;
    n = R * n;
  } else {
    mat3 R = rotX(0.3 * sin(stroke * 0.7 + aPart.z * 1.3));
    p = r0 + R * (p - r0);
    n = R * n;
  }
  vec3 wp = C + B * (p * size * lod);
  vWorldPos = wp;
  vNormal = normalize(B * n);
  vLocal = position;
  vLocalCam = transpose(B) * (uCamPos - C) / (size * lod);
  vPart = aPart;
  vPal = aKSeed.z;
  vFlash = flash;
  vSeed = aKSeed.x;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const KRILL_FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${SHADOW}
${LIGHTING}
uniform vec3 uKBody[4];
uniform vec3 uKGut[4];
uniform vec3 uKGlow;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vLocal;
varying vec4 vPart;
varying float vPal;
varying float vFlash;
varying float vSeed;
varying vec3 vLocalCam;
// closest approach of a ray (o, d) to a segment (a, b): returns distance, t along the ray in tOut
float raySeg(vec3 o, vec3 d, vec3 a, vec3 b, out float tOut) {
  vec3 u = b - a, w = o - a;
  float uu = dot(u, u), ud = dot(u, d), uw = dot(u, w), dw = dot(d, w);
  float den = uu - ud * ud;
  float s = den > 1e-6 ? clamp((uw - ud * dw) / den, 0.0, 1.0) : 0.0;
  float t = max(dot(a + u * s - o, d), 0.0);
  tOut = t;
  return length(o + d * t - (a + u * s));
}
void main() {
  #ifdef DEPTH_PASS
    gl_FragColor = vec4(1.0);
    return;
  #endif
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  int pi = int(clamp(floor(vPal), 0.0, 3.0));
  vec3 body = uKBody[pi] * 0.82;
  vec3 gutC = uKGut[pi] * 0.82;
  body *= 0.94 + 0.12 * fract(vPal);
  vec3 L = vLocal;
  float part = vPart.x;
  vec3 albedo = body;
  float trans = 1.25;
  float emis = 0.0;
  float spec = 0.4;
  if (part < 0.5) {
    // body centre line (the abdomen arches down toward the tail)
    float cy = 0.008 + 0.034 * L.z - 0.14 * max(-L.z, 0.0) * max(-L.z, 0.0);
    float rel = L.y - cy;
    float dors = smoothstep(-0.03, 0.05, rel);
    // translucent shell: pale and glassy on the back, warmer and deeper underneath
    albedo = mix(mix(body, gutC, 0.4), mix(body, vec3(1.0), 0.42), dors);
    // organs seen *through* the glassy body (true parallax): the gut running down the
    // abdomen and the digestive gland under the carapace, tinted by the plankton they graze
    vec3 rd = normalize(L - vLocalCam);
    float tg;
    float dg = raySeg(L, rd, vec3(0.0, 0.006, 0.12), vec3(0.0, -0.036, -0.37), tg);
    float gut = smoothstep(0.016, 0.007, dg) * step(tg, 0.2);
    albedo = mix(albedo, gutC * 0.85, gut * 0.75);
    float tl;
    float dl = raySeg(L, rd, vec3(0.0, 0.016, 0.27), vec3(0.0, 0.01, 0.15), tl);
    float gland = smoothstep(0.042, 0.022, dl) * step(tl, 0.25);
    albedo = mix(albedo, mix(gutC, uKGlow * 0.7, 0.72), gland * 0.7);
    // abdominal segment rings
    float seg = smoothstep(0.7, 1.0, sin(L.z * 80.0 + 1.3)) * step(L.z, 0.03) * smoothstep(-0.01, 0.03, rel);
    albedo *= 1.0 - seg * 0.18;
    // big dark compound eyes with a catch-light
    vec3 e = vec3(abs(L.x) - 0.042, L.y - 0.02, (L.z - 0.405) * 0.85);
    float ed = length(e);
    float eye = smoothstep(0.038, 0.03, ed);
    albedo = mix(albedo, vec3(0.03, 0.035, 0.07), eye);
    spec += eye * 2.0;
    trans *= 1.0 - eye;
    // photophores: a ventral pair under the thorax and one at each eyestalk
    float ph = smoothstep(0.024, 0.006, length(vec2(abs(L.x) - 0.018, (L.z - 0.16) * 0.7))) * smoothstep(-0.03, -0.07, rel);
    ph += smoothstep(0.018, 0.004, length(vec3(abs(L.x) - 0.036, L.y + 0.012, L.z - 0.37))) * 0.8;
    emis = ph;
  } else if (part < 1.5) {
    // tail fan: thin, tinted tips
    albedo = mix(mix(body, vec3(1.0), 0.2), gutC, smoothstep(0.45, 1.0, vPart.y) * 0.6);
    trans = 1.9;
  } else {
    albedo = mix(body, vec3(1.0), 0.3);
    trans = 1.7;
    spec = 0.1;
  }
  // glassy shell: thicker (deeper, more saturated) toward the silhouette, clearer face-on
  vec3 Vv = normalize(uCamPos - vWorldPos);
  float edgeF = 1.0 - abs(dot(N, Vv));
  albedo = mix(albedo, gutC * 0.9, edgeF * edgeF * 0.5 * step(part, 1.5));
  Surface s = makeSurface(albedo, N, vWorldPos);
  s.shadow = sampleShadow(vWorldPos, N);
  s.rim = 1.15;
  s.trans = trans;
  s.wrap = 0.34;
  s.spec = spec;
  s.gloss = 0.84;
  s.ao = mix(0.78, 1.0, smoothstep(-0.07, 0.05, L.y));
  vec3 col = stylizedLight(s);
  float glow = (0.05 + 0.95 * uNight) * (0.8 + 0.2 * sin(uTime * 2.3 + vSeed * 20.0)) + vFlash * 2.2;
  col += uKGlow * emis * glow;
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
}
`;

const SPRITE_VERT = /* glsl */ `
${UNIFORMS}
${LIGHTING}
${ECO_GLSL}
${ECO_VERT_GLSL}
attribute vec4 aKPos;
attribute vec4 aKVel;
attribute vec4 aKSeed;
uniform vec4 uKLod;
uniform vec3 uKBody[4];
uniform vec3 uKGlow;
uniform float uKVeil[32];
varying vec2 vUv;
varying vec3 vBase;
varying vec3 vAdd;
varying vec3 vGlow;
varying float vA;
varying float vGA;
varying float vViewZ;
varying float vR;
void main() {
  float age = clamp(uTime - aKPos.w, 0.0, 0.4);
  vec3 C = aKPos.xyz + aKVel.xyz * age;
  float vis = floor(aKVel.w) / 255.0;
  float flash = fract(aKVel.w);
  float size = aKSeed.y;
  vec4 cv = viewMatrix * vec4(C, 1.0);
  float vz = -cv.z;
  float px = projPx(size, vz);
  float w = (1.0 - smoothstep(uKLod.z, uKLod.w, px)) * vis;
  if (w < 0.01 || vz < 0.3) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  // an elongated soft streak along the (screen-projected) body axis, like the mesh it replaces
  vec3 viewDir = normalize(C - uCamPos);
  vec3 f = aKVel.xyz;
  float fl = length(f);
  f = fl > 1e-3 ? f / fl : vec3(0.0, 0.0, 1.0);
  vec3 ax = f - viewDir * dot(f, viewDir);
  float la = length(ax);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  ax = la > 1e-3 ? ax / la : right;
  vec3 ay = cross(ax, viewDir); // keeps the quad front-facing (counter-clockwise on screen)
  float pxPerM = px / size;
  float lenW = size * 0.5 * max(la, 0.32);
  float widW = size * 0.11;
  float kl = max(1.0, 0.9 / max(lenW * pxPerM, 1e-4));
  float kw = max(1.0, 0.9 / max(widW * pxPerM, 1e-4));
  lenW *= kl; widW *= kw;
  float rW = max(lenW, widW);
  vec3 wp = C + ax * position.x * lenW + ay * position.y * widW;
  int pi = int(clamp(floor(aKSeed.z), 0.0, 3.0));
  vec3 albedo = uKBody[pi] * 0.82 * (0.94 + 0.12 * fract(aKSeed.z));
  // a tumbling carapace normal: glints travel through the ribbon as krill turn
  float ph = uTime * (1.1 + 1.9 * fract(aKSeed.x * 7.13)) + aKSeed.x * 40.0;
  vec3 n = normalize(vec3(sin(ph) * 0.75, 0.5 + 0.35 * sin(ph * 0.7 + 1.0), cos(ph * 1.3) * 0.75));
  Surface s = makeSurface(albedo, n, C);
  s.wrap = 0.42; s.rim = 0.25; s.trans = 1.0;
  vec3 lit = stylizedLight(s);
  vec3 V = normalize(uCamPos - C);
  float glint = pow(max(dot(reflect(-uSunDir, n), V), 0.0), 36.0);
  float fog = fogAmount(C);
  // a swarm behind / inside cloud is veiled by it (clouds do not write depth)
  float veil = uKVeil[int(clamp(floor(aKSeed.w), 0.0, 31.0))];
  vBase = mix(mix(lit, fogColorFor(-V), fog), mix(uCloudShadow, uCloudLit, 0.6), veil * 0.35);
  float glow = (0.04 + 0.85 * uNight) * (0.7 + 0.3 * sin(uTime * 2.1 + aKSeed.x * 33.0)) + flash * 2.2;
  vAdd = uSunColor * glint * 0.55 * (1.0 - fog);
  vGlow = uKGlow * glow * 0.75 * (1.0 - fog);
  vA = w / (kl * kw) * (1.0 - veil * 0.7);
  // photophores are point lights: a distant swarm still reads as a faint glowing ribbon
  vGA = w * min(1.0, 3.0 / (kl * kw)) * (1.0 - veil * 0.6);
  vUv = position.xy;
  vViewZ = vz;
  vR = rW;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const SPRITE_FRAG = /* glsl */ `
${UNIFORMS}
${DEPTH}
varying vec2 vUv;
varying vec3 vBase;
varying vec3 vAdd;
varying vec3 vGlow;
varying float vA;
varying float vGA;
varying float vViewZ;
varying float vR;
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  float soft = clamp((sceneDepthAt(gl_FragCoord.xy / uResolution) - vViewZ) / max(vR * 2.0, 0.05), 0.0, 1.0);
  float a = exp(-r2 * 3.2) * vA * soft;
  // photophores are tiny: their light is a tight core, not the whole body
  float g = (exp(-r2 * 9.0) + exp(-r2 * 3.0) * 0.2) * vGA * soft;
  if (a < 0.002 && g < 0.002) discard;
  gl_FragColor = vec4(vBase * a * 0.92 + vAdd * a + vGlow * g, a * 0.92);
}
`;

function markRange(attr, start, count) {
  if (attr.updateRanges.length > 48) {
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, attr.array.length);
  } else attr.addUpdateRange(start, count);
  attr.needsUpdate = true;
}

export class KrillSystem {
  constructor(eco) {
    this.eco = eco;
    this.game = eco.game;
    this.n = 0;
    this.swarms = [];
    this._seed = 101;
    // simulation state
    this.P = new Float32Array(MAX_KRILL * 3);
    this.V = new Float32Array(MAX_KRILL * 3);
    this.S = new Float32Array(MAX_KRILL);
    this.CA = new Float32Array(MAX_KRILL);
    this.CB = new Float32Array(MAX_KRILL);
    this.SPD = new Float32Array(MAX_KRILL);
    this.REACT = new Float32Array(MAX_KRILL);
    this.WK = new Uint8Array(MAX_KRILL);
    this.WA = new Float32Array(MAX_KRILL * 2);
    this.SPIR = new Float32Array(MAX_KRILL * 2);
    this.EAT = new Float32Array(MAX_KRILL);
    this.SC = new Float32Array(MAX_KRILL);
    this.FL = new Float32Array(MAX_KRILL);
    this.SEED = new Float32Array(MAX_KRILL * 4);
    this.preds = new Float32Array(32 * 8);

    // GPU: every krill (sprite impostors) ...
    this.aPos = new InstancedBufferAttribute(new Float32Array(MAX_KRILL * 4), 4).setUsage(DynamicDrawUsage);
    this.aVel = new InstancedBufferAttribute(new Float32Array(MAX_KRILL * 4), 4).setUsage(DynamicDrawUsage);
    this.aSeed = new InstancedBufferAttribute(this.SEED, 4).setUsage(StaticDrawUsage);
    // ... and the compacted near set (meshes)
    this.nPos = new InstancedBufferAttribute(new Float32Array(MAX_NEAR * 4), 4).setUsage(DynamicDrawUsage);
    this.nVel = new InstancedBufferAttribute(new Float32Array(MAX_NEAR * 4), 4).setUsage(DynamicDrawUsage);
    this.nSeed = new InstancedBufferAttribute(new Float32Array(MAX_NEAR * 4), 4).setUsage(DynamicDrawUsage);
    this.nearCount = 0;
    this._nearAttrs = [this.nPos, this.nVel, this.nSeed];

    const pal = paletteUniforms(KRILL_PALETTES, ['body', 'gut']);
    this.veil = new Float32Array(32);
    this._veilI = 0;
    // mesh shrinks away between 12 and 7 px long, the sprite fades in between 13 and 8 px
    this.lod = new Vector4(7.0, 12.0, 8.0, 13.0);
    const shared = {
      uKBody: { value: pal.body },
      uKGut: { value: pal.gut },
      uKGlow: { value: KRILL_GLOW.clone() },
      uKLod: { value: this.lod },
      uKVeil: { value: this.veil },
    };
    const mgeo = buildKrillGeometry();
    mgeo.setAttribute('aKPos', this.nPos);
    mgeo.setAttribute('aKVel', this.nVel);
    mgeo.setAttribute('aKSeed', this.nSeed);
    mgeo.instanceCount = 0;
    this.meshMat = new ShaderMaterial({
      vertexShader: KRILL_VERT,
      fragmentShader: KRILL_FRAG,
      uniforms: Object.assign({}, G, shared),
      side: DoubleSide,
    });
    this.mesh = new Mesh(mgeo, this.meshMat);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'krill';
    this.mesh.visible = false;
    this.game.engine.scene.add(this.mesh);

    const sgeo = buildQuadGeometry();
    sgeo.setAttribute('aKPos', this.aPos);
    sgeo.setAttribute('aKVel', this.aVel);
    sgeo.setAttribute('aKSeed', this.aSeed);
    sgeo.instanceCount = 0;
    this.spriteMat = new ShaderMaterial({
      vertexShader: SPRITE_VERT,
      fragmentShader: SPRITE_FRAG,
      uniforms: Object.assign({}, G, shared),
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      premultipliedAlpha: true,
    });
    this.sprites = new Mesh(sgeo, this.spriteMat);
    this.sprites.frustumCulled = false;
    this.sprites.renderOrder = 14;
    this.sprites.name = 'krill-sprites';
    this.sprites.visible = false;
    this.game.engine.sceneT.add(this.sprites);

    this._v = new Vector3();
    this.frame = 0;
    /** Swarms farther than this from the camera (m) stop simulating individual krill. */
    this.dormantDist = 1100;
  }

  get count() { return this.n; }

  // ---- swarms --------------------------------------------------------------------------
  addSwarm(center, count = 600, opts = {}) {
    count = Math.round(count);
    // full: retire the farthest swarm that is well out of sight
    while (this.n + count > MAX_KRILL && this.swarms.length) {
      const cam = this.game.engine.camera.position;
      let far = null, fd = 1500;
      for (const o of this.swarms) {
        const d = o.center.distanceTo(cam);
        if (d > fd) { fd = d; far = o; }
      }
      if (!far) break;
      this.removeSwarm(far);
    }
    count = Math.min(count, MAX_KRILL - this.n);
    if (count <= 0) {
      console.warn('[ecosystem] krill capacity reached');
      return null;
    }
    const r = rng(opts.seed ?? (this._seed += 17));
    const sign = () => (r() < 0.5 ? -1 : 1);
    const R = opts.radius ?? 3 + Math.sqrt(count) * 0.3;
    const sw = {
      kind: 'krill',
      start: this.n,
      count,
      alive: count,
      center: center.clone(),
      home: center.clone(),
      vel: new Vector3(),
      anchor: opts.anchor || null,
      anchorOffset: opts.anchor ? center.clone().sub(opts.anchor) : null,
      leash: opts.leash ?? 260,
      R,
      extent: R * 1.75,
      e1: lerp(0.18, 0.42, r()), e2: lerp(0.15, 0.4, r()), kz: lerp(0.55, 0.9, r()),
      v1: lerp(0.12, 0.26, r()), v2: lerp(0.04, 0.1, r()),
      ph: [r() * TAU, r() * TAU, r() * TAU, r() * TAU, r() * TAU],
      rates: [0, 0, 0, 0, 0].map(() => lerp(0.02, 0.06, r()) * sign()),
      yaw: r() * TAU, yawRate: lerp(0.006, 0.016, r()) * sign(),
      twists: r() < 0.5 ? 1 : 2, twist0: r() * TAU, twistRate: lerp(0.04, 0.1, r()) * sign(),
      width: R * lerp(0.2, 0.27, r()),
      flow: opts.flow ?? lerp(1.4, 2.3, r()),
      palette: opts.palette ?? Math.floor(r() * KRILL_PALETTES.length) % KRILL_PALETTES.length,
      curve: new Float32Array(M * 3), nrm: new Float32Array(M * 3), bin: new Float32Array(M * 3),
      tan: new Float32Array(M * 3), wid: new Float32Array(M),
      phs: new Float32Array(NPH * 2), phRate: new Float32Array(NPH), phAng: new Float32Array(NPH),
      swirl: 0, tight: 0, songR0: 8, songR1: 30,
      slot: this._freeSlot(), veil: 0, veilT: 0, dormant: false, sleepAt: new Vector3(),
      graze: { cluster: null, off: new Vector3(), point: center.clone(), t: 0 },
      grazing: opts.graze !== false,
      acc: 0, rate: 1, lastSim: -1, simT: 0, nPred: 0,
      rng: r,
    };
    sw.thick = sw.width * 0.3;
    for (let k = 0; k < NPH; k++) { sw.phRate[k] = lerp(0.6, 1.7, r()) * sign(); sw.phAng[k] = r() * TAU; }
    this._curve(sw, this.game.time);
    const sizeMin = opts.sizeMin ?? 0.22, sizeMax = opts.sizeMax ?? 0.38;
    const { P, V, S, CA, CB, SPD, REACT, WK, WA, SPIR, EAT, SC, FL, SEED } = this;
    for (let i = sw.start; i < sw.start + count; i++) {
      S[i] = r();
      CA[i] = r() + r() - 1;
      CB[i] = r() + r() - 1;
      SPD[i] = lerp(0.82, 1.18, r());
      REACT[i] = lerp(0.45, 1.3, r());
      WK[i] = Math.floor(r() * NPH);
      const wa = r() * TAU, amp = lerp(0.25, 1, r());
      WA[i * 2] = Math.cos(wa) * amp;
      WA[i * 2 + 1] = Math.sin(wa) * amp;
      SPIR[i * 2] = Math.sqrt(r());
      SPIR[i * 2 + 1] = Math.floor(r() * 3) * (TAU / 3) + (r() - 0.5) * 0.2;
      EAT[i] = 0;
      SC[i] = 1;
      FL[i] = 0;
      SEED[i * 4] = r();
      SEED[i * 4 + 1] = lerp(sizeMin, sizeMax, r() * r());
      SEED[i * 4 + 2] = sw.palette + 0.03 + r() * 0.92;
      SEED[i * 4 + 3] = sw.slot + r() * 0.999;
      this._placeOnRibbon(sw, i);
    }
    this.n += count;
    markRange(this.aSeed, sw.start * 4, count * 4);
    this._writeAll(sw, this.game.time);
    this.swarms.push(sw);
    return sw;
  }

  _freeSlot() {
    for (let k = 0; k < 32; k++) if (!this.swarms.some((o) => o.slot === k)) return k;
    return 31;
  }

  removeSwarm(sw) {
    const i = this.swarms.indexOf(sw);
    if (i < 0) return;
    this.swarms.splice(i, 1);
    // compact the pool
    const s0 = sw.start, c = sw.count, end = this.n;
    const mv = (arr, k) => arr.copyWithin(s0 * k, (s0 + c) * k, end * k);
    mv(this.P, 3); mv(this.V, 3); mv(this.S, 1); mv(this.CA, 1); mv(this.CB, 1); mv(this.SPD, 1); mv(this.REACT, 1);
    mv(this.WK, 1); mv(this.WA, 2); mv(this.SPIR, 2); mv(this.EAT, 1); mv(this.SC, 1); mv(this.FL, 1); mv(this.SEED, 4);
    mv(this.aPos.array, 4); mv(this.aVel.array, 4);
    for (const o of this.swarms) if (o.start > s0) o.start -= c;
    this.n -= c;
    for (const a of [this.aPos, this.aVel, this.aSeed]) { a.clearUpdateRanges(); a.needsUpdate = true; }
  }

  clear() {
    this.swarms.length = 0;
    this.n = 0;
    this.nearCount = 0;
    this.mesh.geometry.instanceCount = 0;
    this.sprites.geometry.instanceCount = 0;
    this.mesh.visible = false;
    this.sprites.visible = false;
  }

  /** Rebuild the swarm's ribbon (positions, tangents, twisted band frame, width). */
  _curve(sw, t) {
    const R = sw.R, c = sw.curve, nv = sw.nrm, bv = sw.bin, tv = sw.tan, wv = sw.wid;
    const p = sw.ph, rt = sw.rates;
    const a1 = p[0] + rt[0] * t, a2 = p[1] + rt[1] * t, a3 = p[2] + rt[2] * t, a4 = p[3] + rt[3] * t, a5 = p[4] + rt[4] * t;
    const yaw = sw.yaw + sw.yawRate * t;
    const cyw = Math.cos(yaw), syw = Math.sin(yaw);
    const tight = 1 - sw.tight * 0.4;
    const Rt = R * tight;
    for (let k = 0; k < M; k++) {
      const th = (k / M) * TAU;
      const x = Rt * (Math.cos(th) + sw.e1 * Math.cos(2 * th + a1));
      const z = Rt * (sw.kz * Math.sin(th) + sw.e2 * Math.sin(2 * th + a2));
      const y = Rt * (sw.v1 * Math.sin(th + a3) + sw.v2 * Math.sin(3 * th + a4));
      c[k * 3] = x * cyw - z * syw;
      c[k * 3 + 1] = y;
      c[k * 3 + 2] = x * syw + z * cyw;
      wv[k] = sw.width * tight * (0.6 + 0.4 * Math.sin(3 * th + a5));
    }
    const tw0 = sw.twist0 + sw.twistRate * t;
    for (let k = 0; k < M; k++) {
      const a = ((k + M - 1) % M) * 3, b = ((k + 1) % M) * 3;
      let tx = c[b] - c[a], ty = c[b + 1] - c[a + 1], tz = c[b + 2] - c[a + 2];
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      // horizontal side vector, then binormal
      let nx = -tz, nz = tx;
      const nl = Math.hypot(nx, nz) || 1;
      nx /= nl; nz /= nl;
      const bx = -nz * ty, by = nz * tx - nx * tz, bz = nx * ty; // cross(N0, T) with N0=(nx,0,nz)
      const tw = tw0 + sw.twists * (k / M) * TAU;
      const ct = Math.cos(tw), st = Math.sin(tw);
      const o = k * 3;
      tv[o] = tx; tv[o + 1] = ty; tv[o + 2] = tz;
      nv[o] = ct * nx + st * bx; nv[o + 1] = st * by; nv[o + 2] = ct * nz + st * bz;
      bv[o] = -st * nx + ct * bx; bv[o + 1] = ct * by; bv[o + 2] = -st * nz + ct * bz;
    }
  }

  _ribbonPoint(sw, s, ca, cb, out) {
    const f = s * M, j = Math.floor(f) % M, fr = f - Math.floor(f), j1 = (j + 1) % M;
    const c = sw.curve, nv = sw.nrm, bv = sw.bin;
    const w = (sw.wid[j] + (sw.wid[j1] - sw.wid[j]) * fr) * ca, h = sw.thick * cb;
    const a = j * 3, b = j1 * 3;
    for (let k = 0; k < 3; k++) {
      const cc = c[a + k] + (c[b + k] - c[a + k]) * fr;
      const nn = nv[a + k] + (nv[b + k] - nv[a + k]) * fr;
      const bb = bv[a + k] + (bv[b + k] - bv[a + k]) * fr;
      out[k] = cc + nn * w + bb * h;
    }
    return out;
  }

  _placeOnRibbon(sw, i) {
    const o = this._tmp3 || (this._tmp3 = [0, 0, 0]);
    this._ribbonPoint(sw, this.S[i], this.CA[i], this.CB[i], o);
    const i3 = i * 3;
    this.P[i3] = sw.center.x + o[0];
    this.P[i3 + 1] = sw.center.y + o[1];
    this.P[i3 + 2] = sw.center.z + o[2];
    const f = this.S[i] * M, j = Math.floor(f) % M;
    this.V[i3] = sw.tan[j * 3] * sw.flow;
    this.V[i3 + 1] = sw.tan[j * 3 + 1] * sw.flow;
    this.V[i3 + 2] = sw.tan[j * 3 + 2] * sw.flow;
  }

  _writeAll(sw, time) {
    const AP = this.aPos.array, AV = this.aVel.array, P = this.P, V = this.V;
    for (let i = sw.start; i < sw.start + sw.count; i++) {
      const o = i * 4, i3 = i * 3;
      AP[o] = P[i3]; AP[o + 1] = P[i3 + 1]; AP[o + 2] = P[i3 + 2]; AP[o + 3] = time;
      AV[o] = V[i3]; AV[o + 1] = V[i3 + 1]; AV[o + 2] = V[i3 + 2];
      AV[o + 3] = Math.floor(this.SC[i] * 255) + Math.min(this.FL[i], 0.999);
    }
    markRange(this.aPos, sw.start * 4, sw.count * 4);
    markRange(this.aVel, sw.start * 4, sw.count * 4);
  }

  // ---- swarm-level behaviour (every frame, cheap) -------------------------------------
  _updateSwarm(sw, dt, ctx) {
    const game = this.game;
    const r = sw.rng;
    if (sw.anchor) sw.home.copy(sw.anchor).add(sw.anchorOffset);
    else sw.home.addScaledVector(ctx.cloudDriftVel, dt);
    // graze along the rim of a moisture-rich cloud
    const gz = sw.graze;
    gz.t -= dt;
    if (gz.t <= 0 && sw.grazing) {
      gz.t = lerp(18, 38, r());
      let best = null, bd = 700 * 700;
      for (const cl of ctx.moist) {
        const dx = cl.center.x + ctx.drift.x - sw.home.x, dz = cl.center.z + ctx.drift.z - sw.home.z, dy = cl.center.y - sw.home.y;
        const d2 = dx * dx + dy * dy * 4 + dz * dz;
        if (d2 < bd) { bd = d2; best = cl; }
      }
      gz.cluster = best;
      if (best) {
        const a = r() * TAU, rr = best.radius * lerp(0.65, 0.95, r());
        gz.off.set(Math.cos(a) * rr, lerp(-0.15, 0.2, r()) * best.radius, Math.sin(a) * rr);
      } else {
        gz.off.set((r() - 0.5) * 60, (r() - 0.5) * 16, (r() - 0.5) * 60);
      }
    }
    const tgt = this._v;
    if (gz.cluster) tgt.copy(gz.cluster.center).add(ctx.drift).add(gz.off);
    else tgt.copy(sw.home).add(gz.off);
    // never wander too far from home
    const hx = tgt.x - sw.home.x, hy = tgt.y - sw.home.y, hz = tgt.z - sw.home.z;
    const hd = Math.hypot(hx, hy, hz);
    if (hd > sw.leash) tgt.set(sw.home.x + (hx / hd) * sw.leash, sw.home.y + (hy / hd) * sw.leash, sw.home.z + (hz / hd) * sw.leash);
    // the herd is singing: gather into slow spirals around the song
    let swirlT = 0;
    let singing = false;
    const F = ctx.songFocus;
    if (F) {
      const d = sw.center.distanceTo(F);
      if (d < 220 + sw.extent) {
        // travel toward the song as a ribbon, unrolling into spirals on arrival
        swirlT = smoothstep(150 + sw.extent, 50 + sw.extent, d);
        singing = true;
        tgt.copy(F);
        sw.songR0 = ctx.songRadius * 0.9 + 4;
        sw.songR1 = sw.songR0 + Math.max(12, sw.R * 1.2);
      }
    }
    sw.swirl += (swirlT - sw.swirl) * (1 - Math.exp(-dt * (swirlT > sw.swirl ? 0.35 : 0.25)));
    // threatened swarms tighten into a ball and slide away
    let tightT = 0;
    if (ctx.threat) {
      const tx = sw.center.x - ctx.threat.x, ty = sw.center.y - ctx.threat.y, tz = sw.center.z - ctx.threat.z;
      const td = Math.hypot(tx, ty, tz);
      if (td < 90 + sw.extent) {
        tightT = 1;
        singing = false;
        tgt.set(sw.center.x + (tx / td) * 30, sw.center.y + (ty / td) * 10, sw.center.z + (tz / td) * 30);
      }
    }
    sw.tight += (tightT - sw.tight) * (1 - Math.exp(-dt * 1.5));
    const maxSp = (singing ? 2.4 : 1.3) + sw.tight * 1.5;
    const k = singing ? 0.12 : 0.05;
    const dvx = (tgt.x - sw.center.x) * k, dvy = (tgt.y - sw.center.y) * k, dvz = (tgt.z - sw.center.z) * k;
    sw.vel.x += (dvx - sw.vel.x) * (1 - Math.exp(-dt * 0.6));
    sw.vel.y += (dvy - sw.vel.y) * (1 - Math.exp(-dt * 0.6));
    sw.vel.z += (dvz - sw.vel.z) * (1 - Math.exp(-dt * 0.6));
    const sp = sw.vel.length();
    if (sp > maxSp) sw.vel.multiplyScalar(maxSp / sp);
    sw.center.addScaledVector(sw.vel, dt);
    // drift with the clouds
    sw.center.addScaledVector(ctx.cloudDriftVel, dt);
  }

  /** Gather the predators that can reach this swarm (packed x,y,z,R,strength,vx,vy,vz). */
  _gatherPredators(sw, ctx) {
    const out = this.preds;
    let n = 0;
    const cx = sw.center.x, cy = sw.center.y, cz = sw.center.z, ext = sw.extent;
    const L = ctx.predators;
    for (let p = 0; p < L.length && n < 32; p++) {
      const q = L[p];
      const dx = q.x - cx, dy = q.y - cy, dz = q.z - cz;
      const rr = ext + q.r;
      if (dx * dx + dy * dy + dz * dz > rr * rr) continue;
      const o = n * 8;
      out[o] = q.x; out[o + 1] = q.y; out[o + 2] = q.z; out[o + 3] = q.r;
      out[o + 4] = q.s; out[o + 5] = q.vx; out[o + 6] = q.vy; out[o + 7] = q.vz;
      n++;
    }
    sw.nPred = n;
    return n;
  }

  // ---- per-krill simulation --------------------------------------------------------------
  _simSwarm(sw, dt, ctx, nearD2) {
    const time = ctx.time;
    this._curve(sw, time);
    for (let k = 0; k < NPH; k++) {
      sw.phAng[k] += sw.phRate[k] * dt;
      sw.phs[k * 2] = Math.cos(sw.phAng[k]);
      sw.phs[k * 2 + 1] = Math.sin(sw.phAng[k]);
    }
    const np = this._gatherPredators(sw, ctx);
    const pr = this.preds;
    const { P, V, S, CA, CB, SPD, REACT, WK, WA, SPIR, EAT, SC, FL, SEED } = this;
    const AP = this.aPos.array, AV = this.aVel.array;
    const NP = this.nPos.array, NV = this.nVel.array, NS = this.nSeed.array;
    const cv = sw.curve, nv = sw.nrm, bv = sw.bin, tv = sw.tan, wv = sw.wid, phs = sw.phs;
    const cx = sw.center.x, cy = sw.center.y, cz = sw.center.z;
    const flowS = sw.flow / (TAU * sw.R * 1.25);
    const thick = sw.thick;
    const swirl = sw.swirl;
    const F = ctx.songFocus;
    const fx = F ? F.x : 0, fy = F ? F.y : 0, fz = F ? F.z : 0;
    const sR0 = sw.songR0, sR1 = sw.songR1;
    const wob = 0.35 + sw.R * 0.02;
    const kPos = 1.3, kVel = (1 - Math.exp(-dt * 2.4)) / Math.max(dt, 1e-4);
    const camx = ctx.cam.x, camy = ctx.cam.y, camz = ctx.cam.z;
    let near = this.nearCount;
    let alive = 0;
    let maxD2 = 0;
    for (let i = sw.start, end = sw.start + sw.count; i < end; i++) {
      const i3 = i * 3, o4 = i * 4;
      if (EAT[i] > 0) {
        EAT[i] -= dt;
        if (EAT[i] > 0) {
          AV[o4 + 3] = 0;
          continue;
        }
        this._respawn(sw, i, ctx);
      }
      alive++;
      let s = S[i] + flowS * SPD[i] * dt * (1 - swirl * 0.8);
      if (s >= 1) s -= 1;
      S[i] = s;
      const f = s * M;
      const j = f | 0, fr = f - j, j1 = j + 1 === M ? 0 : j + 1;
      const a3 = j * 3, b3 = j1 * 3;
      const w = (wv[j] + (wv[j1] - wv[j]) * fr) * CA[i];
      const h = thick * CB[i];
      let tx = cv[a3] + (cv[b3] - cv[a3]) * fr + (nv[a3] + (nv[b3] - nv[a3]) * fr) * w + (bv[a3] + (bv[b3] - bv[a3]) * fr) * h;
      let ty = cv[a3 + 1] + (cv[b3 + 1] - cv[a3 + 1]) * fr + (nv[a3 + 1] + (nv[b3 + 1] - nv[a3 + 1]) * fr) * w + (bv[a3 + 1] + (bv[b3 + 1] - bv[a3 + 1]) * fr) * h;
      let tz = cv[a3 + 2] + (cv[b3 + 2] - cv[a3 + 2]) * fr + (nv[a3 + 2] + (nv[b3 + 2] - nv[a3 + 2]) * fr) * w + (bv[a3 + 2] + (bv[b3 + 2] - bv[a3 + 2]) * fr) * h;
      const sp = sw.flow * SPD[i];
      let ux = (tv[a3] + (tv[b3] - tv[a3]) * fr) * sp;
      let uy = (tv[a3 + 1] + (tv[b3 + 1] - tv[a3 + 1]) * fr) * sp;
      let uz = (tv[a3 + 2] + (tv[b3 + 2] - tv[a3 + 2]) * fr) * sp;
      // individual wobble
      const pk = WK[i] * 2, pc = phs[pk], ps = phs[pk + 1], wa = WA[i * 2], wb = WA[i * 2 + 1];
      tx += (pc * wa - ps * wb) * wob + cx;
      ty += (pc * wb + ps * wa) * wob * 0.5 + cy;
      tz += (ps * wa + pc * wb) * wob + cz;
      let song = 0;
      if (swirl > 0.002) {
        const rr = sR0 + (sR1 - sR0) * SPIR[i * 2];
        const om = (sw.flow * 0.7) / rr;
        const ang = SPIR[i * 2 + 1] + rr * 0.12 - time * om;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const sx = fx + ca * rr, sy = fy + CB[i] * 2.2 + Math.sin(ang * 2 + rr * 0.15) * 1.4, sz = fz + sa * rr;
        // photophores pulse in waves running out along the spiral arms while the herd sings
        const pulse = Math.sin(rr * 0.35 - time * 2.2);
        if (pulse > 0.6) song = (pulse - 0.6) * 0.9 * swirl;
        tx += (sx - tx) * swirl; ty += (sy - ty) * swirl; tz += (sz - tz) * swirl;
        const vt = om * rr;
        ux += (sa * vt - ux) * swirl; uy *= 1 - swirl; uz += (-ca * vt - uz) * swirl;
      }
      const px = P[i3], py = P[i3 + 1], pz = P[i3 + 2];
      let vx = V[i3], vy = V[i3 + 1], vz = V[i3 + 2];
      let ax = (ux + (tx - px) * kPos - vx) * kVel;
      let ay = (uy + (ty - py) * kPos - vy) * kVel;
      let az = (uz + (tz - pz) * kPos - vz) * kVel;
      let fear = 0;
      for (let p = 0; p < np; p++) {
        const o = p * 8;
        const dx = px - pr[o], dy = py - pr[o + 1], dz = pz - pr[o + 2];
        const R = pr[o + 3];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= R * R) continue;
        const d = Math.sqrt(d2) + 1e-3;
        let k = 1 - d / R;
        k = k * k * pr[o + 4] * REACT[i];
        const ix = dx / d, iy = dy / d, iz = dz / d;
        ax += ix * k * 26; ay += iy * k * 26; az += iz * k * 26;
        // fountain effect: slip sideways out of the predator's path
        const qx = pr[o + 5], qy = pr[o + 6], qz = pr[o + 7];
        const q2 = qx * qx + qy * qy + qz * qz;
        if (q2 > 1) {
          const ql = Math.sqrt(q2), dd = (ix * qx + iy * qy + iz * qz) / ql;
          ax += (ix - (dd * qx) / ql) * k * 18;
          ay += (iy - (dd * qy) / ql) * k * 18;
          az += (iz - (dd * qz) / ql) * k * 18;
        }
        if (k > fear) fear = k;
      }
      vx += ax * dt; vy += ay * dt; vz += az * dt;
      const vmax = 2.8 * SPD[i] + 3.4 * Math.min(fear * 2, 1) + swirl * 1.2 + FL[i] * 9;
      const v2 = vx * vx + vy * vy + vz * vz;
      if (v2 > vmax * vmax) {
        const kk = vmax / Math.sqrt(v2);
        vx *= kk; vy *= kk; vz *= kk;
      }
      V[i3] = vx; V[i3 + 1] = vy; V[i3 + 2] = vz;
      const nx = px + vx * dt, ny = py + vy * dt, nz = pz + vz * dt;
      P[i3] = nx; P[i3 + 1] = ny; P[i3 + 2] = nz;
      const bx = nx - cx, by = ny - cy, bz = nz - cz;
      const bd2 = bx * bx + by * by + bz * bz;
      if (bd2 > maxD2) maxD2 = bd2;
      let fl = FL[i] - dt * 1.4;
      if (fear * 1.6 > fl) fl = Math.min(fear * 1.6, 0.999);
      if (song > fl) fl = song;
      FL[i] = fl > 0 ? fl : 0;
      let sc = SC[i];
      if (sc < 1) SC[i] = sc = Math.min(1, sc + dt * 0.7);
      const st = Math.floor(sc * 255) + FL[i];
      AP[o4] = nx; AP[o4 + 1] = ny; AP[o4 + 2] = nz; AP[o4 + 3] = time;
      AV[o4] = vx; AV[o4 + 1] = vy; AV[o4 + 2] = vz; AV[o4 + 3] = st;
      if (nearD2 > 0 && near < MAX_NEAR) {
        const ex = nx - camx, ey = ny - camy, ez = nz - camz;
        if (ex * ex + ey * ey + ez * ez < nearD2) {
          const q = near * 4;
          NP[q] = nx; NP[q + 1] = ny; NP[q + 2] = nz; NP[q + 3] = time;
          NV[q] = vx; NV[q + 1] = vy; NV[q + 2] = vz; NV[q + 3] = st;
          NS[q] = SEED[o4]; NS[q + 1] = SEED[o4 + 1]; NS[q + 2] = SEED[o4 + 2]; NS[q + 3] = SEED[o4 + 3];
          near++;
        }
      }
    }
    sw.alive = alive;
    // true bounding radius (krill spread out while spiralling or fleeing)
    sw.extent = Math.max(sw.R * 1.75, Math.sqrt(maxD2) + 1);
    this.nearCount = near;
    markRange(this.aPos, sw.start * 4, sw.count * 4);
    markRange(this.aVel, sw.start * 4, sw.count * 4);
  }

  _respawn(sw, i, ctx) {
    const r = sw.rng;
    // reappear somewhere along the ribbon away from predators, growing in from nothing
    let best = r(), bestD = -1;
    const tmp = this._tmp3 || (this._tmp3 = [0, 0, 0]);
    for (let k = 0; k < 3; k++) {
      const s = r();
      this._ribbonPoint(sw, s, 0, 0, tmp);
      let dmin = 1e9;
      for (let p = 0; p < sw.nPred; p++) {
        const o = p * 8;
        const d = Math.hypot(sw.center.x + tmp[0] - this.preds[o], sw.center.y + tmp[1] - this.preds[o + 1], sw.center.z + tmp[2] - this.preds[o + 2]);
        dmin = Math.min(dmin, d);
      }
      if (dmin > bestD) { bestD = dmin; best = s; }
    }
    this.S[i] = best;
    this.EAT[i] = 0;
    this.SC[i] = 0;
    this.FL[i] = 0;
    this._placeOnRibbon(sw, i);
  }

  // ---- per-frame ---------------------------------------------------------------------------
  update(dt, ctx) {
    this.frame++;
    this.nearCount = 0;
    if (this.n === 0) {
      this.mesh.visible = this.sprites.visible = false;
      return;
    }
    // mesh LOD distance from the projected size of the largest krill
    const cam = this.game.engine.camera;
    const projScale = 1 / Math.tan((cam.fov * Math.PI) / 360);
    const resY = G.uResolution.value.y;
    const meshDist = (0.4 * projScale * resY * 0.5) / this.lod.x;
    const nearD2 = meshDist * meshDist;
    // cloud veil: one swarm probed per frame (density along the view ray)
    const ns = this.swarms.length;
    if (ns) {
      const sw = this.swarms[this._veilI++ % ns];
      const clouds = this.game.clouds;
      let clear = 1;
      if (sw.center.distanceTo(ctx.cam) > sw.extent + 8) {
        for (const f of VEIL_F) {
          this._v.copy(ctx.cam).lerp(sw.center, f);
          clear *= 1 - Math.min(1, clouds.densityAt(this._v) * 1.1);
        }
      }
      sw.veilT = 1 - clear;
    }
    for (const sw of this.swarms) {
      sw.veil += (sw.veilT - sw.veil) * (1 - Math.exp(-dt * 2));
      this.veil[sw.slot] = sw.veil;
    }
    for (let si = 0; si < this.swarms.length; si++) {
      const sw = this.swarms[si];
      this._updateSwarm(sw, dt, ctx);
      const d = Math.max(0, sw.center.distanceTo(ctx.cam) - sw.extent);
      // far beyond sight (sub-pixel): only the swarm's centre lives on
      if (d > this.dormantDist) {
        if (!sw.dormant) { sw.dormant = true; sw.sleepAt.copy(sw.center); }
        continue;
      }
      if (sw.dormant) this._wake(sw, ctx.time);
      const inView = ctx.frustum.intersectsSphere(ctx.sphere(sw.center, sw.extent + 4));
      // simulation rate LOD (the GPU extrapolates each krill along its velocity in between)
      let rate;
      if (d < meshDist) rate = 1;
      else if (!inView) rate = d < 120 ? 3 : 6;
      else rate = d < 60 ? 1 : d < 170 ? 2 : d < 420 ? 3 : 5;
      // anything interacting with the swarm gets full-rate simulation
      if (rate > 1 && this._hasActivePredators(sw, ctx)) rate = 1;
      sw.rate = rate;
      sw.acc += dt;
      // staggered by swarm index so reduced-rate swarms spread evenly over frames
      if ((this.frame + si) % rate !== 0 && sw.acc < 0.25) continue;
      const sdt = Math.min(sw.acc, 0.1);
      sw.acc = 0;
      this._simSwarm(sw, sdt, ctx, d < meshDist ? nearD2 : 0);
    }
    const near = this.nearCount;
    this.mesh.geometry.instanceCount = near;
    this.mesh.visible = near > 0;
    if (near > 0) {
      for (const a of this._nearAttrs) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, near * 4);
        a.needsUpdate = true;
      }
    }
    this.sprites.geometry.instanceCount = this.n;
    this.sprites.visible = this.n > 0;
  }

  /** A dormant swarm wakes: carry every krill along with the distance the swarm drifted. */
  _wake(sw, time) {
    sw.dormant = false;
    const ox = sw.center.x - sw.sleepAt.x, oy = sw.center.y - sw.sleepAt.y, oz = sw.center.z - sw.sleepAt.z;
    const P = this.P;
    for (let i = sw.start, end = sw.start + sw.count; i < end; i++) {
      P[i * 3] += ox; P[i * 3 + 1] += oy; P[i * 3 + 2] += oz;
    }
    sw.acc = 0;
    this._writeAll(sw, time);
  }

  _hasActivePredators(sw, ctx) {
    const cx = sw.center.x, cy = sw.center.y, cz = sw.center.z;
    for (const q of ctx.predators) {
      const rr = sw.extent + q.r;
      const dx = q.x - cx, dy = q.y - cy, dz = q.z - cz;
      if (dx * dx + dy * dy + dz * dz < rr * rr) return true;
    }
    return false;
  }

  // ---- interactions ------------------------------------------------------------------------
  /** Eat krill inside a capsule (prev -> cur) of the given radius. Returns how many. */
  eat(cur, prev, radius, opts = {}) {
    let eaten = 0;
    const r2 = radius * radius;
    const { P, EAT, SC, SEED } = this;
    const ax = prev ? prev.x : cur.x, ay = prev ? prev.y : cur.y, az = prev ? prev.z : cur.z;
    const sx = cur.x - ax, sy = cur.y - ay, sz = cur.z - az;
    const sl2 = sx * sx + sy * sy + sz * sz;
    const glow = this.game.glow;
    let sparkles = 0;
    const maxSparkle = opts.sparkles ?? 5;
    for (const sw of this.swarms) {
      const rr = sw.extent + radius + Math.sqrt(sl2);
      if (sw.center.distanceToSquared(cur) > rr * rr) continue;
      const r = sw.rng;
      for (let i = sw.start, end = sw.start + sw.count; i < end; i++) {
        if (EAT[i] > 0 || SC[i] < 0.3) continue;
        const i3 = i * 3;
        let dx = P[i3] - ax, dy = P[i3 + 1] - ay, dz = P[i3 + 2] - az;
        if (sl2 > 1e-6) {
          const t = clamp((dx * sx + dy * sy + dz * sz) / sl2, 0, 1);
          dx -= sx * t; dy -= sy * t; dz -= sz * t;
        }
        if (dx * dx + dy * dy + dz * dz > r2) continue;
        EAT[i] = lerp(7, 18, r());
        SC[i] = 0;
        this.aVel.array[i * 4 + 3] = 0;
        eaten++;
        if (glow && sparkles < maxSparkle && (opts.sparkleChance ?? 1) > Math.random()) {
          sparkles++;
          const night = G.uNight.value;
          const pal = KRILL_PALETTES[Math.floor(SEED[i * 4 + 2])] || KRILL_PALETTES[0];
          const c = pal.body.clone().lerp(KRILL_GLOW, 0.35 + night * 0.5);
          glow.emit({
            pos: this._v.set(P[i3], P[i3 + 1], P[i3 + 2]),
            vel: { x: (Math.random() - 0.5) * 0.6, y: 0.3 + Math.random() * 0.4, z: (Math.random() - 0.5) * 0.6 },
            life: 0.45 + Math.random() * 0.35, size: 0.16 + night * 0.08, sizeEnd: 0.03,
            color: c, alpha: 0.42 + night * 0.25, drag: 2.5, kind: 2, fadeIn: 0.04,
          });
        }
      }
      if (eaten) {
        markRange(this.aVel, sw.start * 4, sw.count * 4);
        sw.alive = Math.max(0, sw.alive - eaten);
      }
    }
    return eaten;
  }

  /** Sonic boom / shock front: krill between rIn and rOut (of a shock reaching `radius`) are kicked outward and flash. */
  shock(center, rIn, rOut, radius, strength) {
    const { P, V, FL, REACT, EAT } = this;
    const o2 = rOut * rOut, i2 = rIn * rIn;
    for (const sw of this.swarms) {
      const rr = sw.extent + rOut;
      if (sw.center.distanceToSquared(center) > rr * rr) continue;
      let hit = false;
      for (let i = sw.start, end = sw.start + sw.count; i < end; i++) {
        if (EAT[i] > 0) continue;
        const i3 = i * 3;
        const dx = P[i3] - center.x, dy = P[i3 + 1] - center.y, dz = P[i3 + 2] - center.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= o2 || d2 < i2) continue;
        const d = Math.sqrt(d2) + 0.01;
        const k = Math.sqrt(Math.max(0, 1 - d / radius)) * strength * (0.6 + 0.4 * REACT[i]) * 9;
        V[i3] += (dx / d) * k; V[i3 + 1] += (dy / d) * k * 0.8; V[i3 + 2] += (dz / d) * k;
        FL[i] = Math.min(0.999, FL[i] + 0.6 + strength * 0.3);
        hit = true;
      }
      if (hit) sw.acc = Math.max(sw.acc, 0.25);
    }
  }

  nearest(pos) {
    let best = null, bd = Infinity;
    const out = new Vector3();
    const tmp = [0, 0, 0];
    for (const sw of this.swarms) {
      if (sw.alive < sw.count * 0.08) continue;
      const dc = sw.center.distanceTo(pos);
      if (dc - sw.extent > bd) continue;
      for (let k = 0; k < M; k += 2) {
        const x = sw.center.x + sw.curve[k * 3], y = sw.center.y + sw.curve[k * 3 + 1], z = sw.center.z + sw.curve[k * 3 + 2];
        const d = Math.hypot(x - pos.x, y - pos.y, z - pos.z);
        if (d < bd) { bd = d; best = sw; tmp[0] = x; tmp[1] = y; tmp[2] = z; }
      }
    }
    if (!best) return null;
    return { swarm: best, pos: out.set(tmp[0], tmp[1], tmp[2]), dist: bd };
  }

  dispose() {
    this.mesh.removeFromParent();
    this.sprites.removeFromParent();
    this.mesh.geometry.dispose();
    this.sprites.geometry.dispose();
    this.meshMat.dispose();
    this.spriteMat.dispose();
  }
}
