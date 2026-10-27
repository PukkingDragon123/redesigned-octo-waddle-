// Sky jellies: buoyant gas-bag drifters (2-8 m). A soft translucent bell with a scalloped
// margin pulses slowly; light passes through it. Inside sits a small opaque gas gland that
// glows faintly at night (and, inflated to the bell's shape in the shadow pass, casts a soft
// dithered shadow). Long tentacles and frilly oral arms trail downwind and sway in gusts.
// They drift with the clouds and graze the plankton of moisture-rich clusters.
import {
  Mesh, ShaderMaterial, InstancedBufferAttribute, DynamicDrawUsage, Vector3, Quaternion, FrontSide,
  CustomBlending, OneFactor, OneMinusSrcAlphaFactor,
} from 'three';
import { G } from '../../render/Globals.js';
import { UNIFORMS, NOISE, SHADOW, LIGHTING, DEPTH, WIND } from '../../render/shaders/common.js';
import { ECO_GLSL, ECO_VERT_GLSL, JELLY_PALETTES, paletteUniforms } from './shaderlib.js';
import { buildJellyMembraneGeometry, buildJellyCoreGeometry } from './geometry.js';
import { rng, lerp, clamp, smoothstep } from '../../core/math.js';

const MAX_JELLIES = 64;
const DORMANT_DIST = 1500;
const TAU = Math.PI * 2;

const JELLY_SHAPE = /* glsl */ `
attribute vec4 aJ;      // part, v/along, angle, side + index*4
attribute vec4 aJPos;   // xyz, bell radius (m)
attribute vec4 aJQuat;  // orientation
attribute vec4 aJAnim;  // pulse 0..1, startle, cloud veil, night glow
attribute vec4 aJTrail; // world direction tentacles stream toward, tentacle length (m)
attribute vec4 aJSeed;  // seed, palette, arm length (m), height scale
vec3 bellP(float v, float th, float pulse, float hs) {
  float psi = v * 2.0;
  float r = sin(psi) * (1.0 + 0.07 * sin(psi * 2.0));
  float y = (cos(psi) * 0.95 + 0.05) * hs + 0.08 * (1.0 - v) * (1.0 - v);
  float m = smoothstep(0.72, 1.0, v);
  float sc = 0.5 + 0.5 * cos(th * 8.0);
  r *= 1.0 + 0.045 * (sc - 0.5) * 2.0 * m;
  y -= 0.06 * sc * m;
  float sq = pulse * 0.2 * smoothstep(0.15, 1.0, v);
  r *= 1.0 - sq;
  y *= 1.0 + pulse * 0.06;
  y -= pulse * 0.07 * m;
  return vec3(r * cos(th), y, r * sin(th));
}
vec3 bellN(float v, float th, float pulse, float hs) {
  float e = 0.01;
  vec3 a = bellP(min(v + e, 1.0), th, pulse, hs) - bellP(max(v - e, 0.0), th, pulse, hs);
  vec3 b = bellP(v, th + e, pulse, hs) - bellP(v, th - e, pulse, hs);
  vec3 n = cross(b, a);
  float l = length(n);
  return l > 1e-6 ? n / l : vec3(0.0, 1.0, 0.0);
}
vec3 coreP(float v, float th, float pulse) {
  // a four-lobed gas gland tapering into a short stalk
  float r = 0.26 * pow(sin(v * 3.14159), 0.75) * (1.0 - 0.62 * smoothstep(0.38, 1.0, v));
  r *= 1.0 + 0.1 * cos(th * 4.0) * smoothstep(0.05, 0.4, v) * smoothstep(0.85, 0.45, v);
  float y = 0.5 - v * 0.92 + pulse * 0.03;
  r *= 1.0 + pulse * 0.1;
  return vec3(r * cos(th), y, r * sin(th));
}
`;

const MEMBRANE_VERT = /* glsl */ `
${UNIFORMS}
${NOISE}
${WIND}
${ECO_GLSL}
${ECO_VERT_GLSL}
${JELLY_SHAPE}
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec4 vJ;
varying float vPal;
varying float vCov;
varying vec4 vAnim;
varying float vViewZ;
varying vec3 vCoreC;
varying float vSize;

vec3 strandP(float t, float ang, float idx, bool arm, float pulse, float startle, vec4 q, float size, float seedT) {
  float hs = aJSeed.w;
  vec3 down = qrot(q, vec3(0.0, -1.0, 0.0));
  vec3 radial = qrot(q, vec3(cos(ang), 0.0, sin(ang)));
  vec3 tang = qrot(q, vec3(-sin(ang), 0.0, cos(ang)));
  vec3 trail = aJTrail.xyz;
  float L = arm ? aJSeed.z : aJTrail.w;
  L *= 1.0 - 0.28 * startle - 0.06 * pulse;
  vec3 rootL = arm ? vec3(cos(ang) * 0.12, coreP(0.97, ang, pulse).y - 0.02, sin(ang) * 0.12) : bellP(0.985, ang, pulse, hs) * 0.96;
  vec3 root = aJPos.xyz + qrot(q, rootL * size);
  // grazing: the tentacles splay out into a wide feeding net
  float graze = clamp((fract(aJSeed.y) - 0.05) / 0.9, 0.0, 1.0);
  vec3 d0 = normalize(down + radial * (arm ? 0.12 + 0.1 * graze : 0.3 + 0.55 * graze));
  float s = t;
  vec3 P = root + L * (d0 * (s - 0.5 * s * s) + trail * (0.5 * s * s));
  float wv = arm ? 0.05 : 0.09;
  P += radial * sin(seedT * 1.1 - s * 6.5 + idx * 1.7) * wv * L * s;
  P += tang * cos(seedT * 0.8 - s * 5.0 + idx * 2.3) * wv * 0.8 * L * s;
  // tentacle tips curl lazily
  if (!arm) P += (radial * cos(s * 9.0 - seedT * 0.7 + idx) + tang * sin(s * 9.0 - seedT * 0.7 + idx)) * 0.04 * L * s * s;
  if (arm) P += tang * sin(s * 9.0 - seedT * 1.6 + idx) * 0.06 * size * s;
  P += windSway(P, s * s * L * 0.3, idx * 0.7 + aJSeed.x);
  return P;
}

void main() {
  float part = aJ.x;
  float size = aJPos.w;
  vec4 q = aJQuat;
  float pulse = aJAnim.x, startle = aJAnim.y;
  float hs = aJSeed.w;
  float seedT = uTime + aJSeed.x * 20.0;
  vec3 wp;
  vec3 n;
  float cov = 1.0;
  if (part < 1.5) {
    float v = aJ.y, th = aJ.z;
    vec3 p = bellP(v, th, pulse, hs);
    // the gas bag breathes and ripples very slightly
    p *= 1.0 + 0.015 * sin(seedT * 1.7 + v * 5.0 + th * 2.0);
    n = bellN(v, th, pulse, hs);
    if (part > 0.5) n = -n;
    wp = aJPos.xyz + qrot(q, p * size);
    n = qrot(q, n);
  } else {
    bool arm = part > 2.5;
    float t = aJ.y, ang = aJ.z;
    float sideIdx = aJ.w;
    float idx = floor((sideIdx + 1.5) / 4.0);
    float side = sideIdx - idx * 4.0;
    vec3 P = strandP(t, ang, idx, arm, pulse, startle, q, size, seedT);
    vec3 P2 = strandP(t + 0.03, ang, idx, arm, pulse, startle, q, size, seedT);
    vec3 T = normalize(P2 - P + vec3(0.0, -1e-4, 0.0));
    float hw = arm ? mix(0.055, 0.018, t) * size * (0.8 + 0.2 * sin(t * 14.0 + idx)) : mix(0.014, 0.004, t) * size;
    vec3 across;
    wp = P + stripOffset(P, T, hw, side, 0.8, cov, across);
    vec3 V = normalize(uCamPos - P);
    n = normalize(across * side * 0.7 + V * 0.7);
  }
  vWorldPos = wp;
  vNormal = n;
  vJ = aJ;
  vPal = aJSeed.y;
  vCov = cov;
  vAnim = aJAnim;
  vSize = size;
  vCoreC = aJPos.xyz + qrot(q, vec3(0.0, 0.25, 0.0) * size);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vViewZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const MEMBRANE_FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${SHADOW}
${LIGHTING}
${DEPTH}
uniform vec3 uJMem[4];
uniform vec3 uJMargin[4];
uniform vec3 uJGlow[4];
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec4 vJ;
varying float vPal;
varying float vCov;
varying vec4 vAnim;
varying float vViewZ;
varying vec3 vCoreC;
varying float vSize;
void main() {
  int pi = int(clamp(floor(vPal), 0.0, 3.0));
  vec3 mem = uJMem[pi], margin = uJMargin[pi], glowC = uJGlow[pi];
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorldPos);
  float part = vJ.x;
  float alpha;
  vec3 albedo;
  float trans, rim, spec;
  if (part < 1.5) {
    float v = vJ.y, th = vJ.z;
    float facing = abs(dot(N, V));
    float fres = pow(1.0 - facing, 1.6);
    // meridional canals and the scalloped margin band
    float canal = smoothstep(0.035, 0.0, abs(fract(th * 8.0 / 6.2831853 + 0.5) - 0.5)) * smoothstep(0.15, 0.6, v);
    float band = smoothstep(0.82, 0.97, v);
    albedo = mix(mem, margin, band * 0.7 + canal * 0.35);
    albedo = mix(albedo, margin, smoothstep(0.55, 0.0, v) * 0.15);
    alpha = mix(0.16, 0.7, fres) + band * 0.22 + canal * 0.1;
    if (part > 0.5) alpha *= 0.55;
    trans = 1.7; rim = 1.0; spec = 0.7;
  } else {
    float t = vJ.y;
    bool arm = part > 2.5;
    albedo = arm ? mix(margin, mem, 0.35 + 0.4 * t) : mix(mem, vec3(1.0), 0.3 + 0.4 * t);
    alpha = (arm ? 0.6 : 0.5) * vCov * (1.0 - smoothstep(0.55, 1.0, t)) * smoothstep(0.0, 0.04, t);
    trans = 1.4; rim = 0.6; spec = 0.2;
  }
  Surface s = makeSurface(albedo, N, vWorldPos);
  // sampled outside the bell toward the sun so the jelly's own (inflated) core shadow is skipped
  s.shadow = sampleShadow(vCoreC + uSunDir * vSize * 1.5, uSunDir);
  s.rim = rim;
  s.trans = trans;
  s.spec = spec;
  s.gloss = 0.88;
  s.wrap = 0.38;
  vec3 col = stylizedLight(s);
  // faint night glow from the gland inside, scattered by the bell
  float night = uNight;
  float dc = length(vWorldPos - vCoreC) / max(vSize, 0.1);
  float inner = exp(-dc * dc * 1.6);
  col += glowC * night * (0.12 + 0.3 * inner) * vAnim.w * (part < 1.5 ? 1.0 : 0.5);
  // a jelly inside or behind cloud is veiled by it
  float veil = vAnim.z;
  col = mix(col, mix(uCloudShadow, uCloudLit, 0.6), veil * 0.6);
  alpha *= 1.0 - veil * 0.85;
  col = applyFog(col, vWorldPos);
  // soft intersection with opaque geometry
  float sceneZ = sceneDepthAt(gl_FragCoord.xy / uResolution);
  alpha *= clamp((sceneZ - vViewZ) / 0.6, 0.0, 1.0);
  alpha = clamp(alpha, 0.0, 1.0);
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(col * alpha, alpha);
}
`;

const CORE_VERT = /* glsl */ `
${UNIFORMS}
${ECO_GLSL}
${JELLY_SHAPE}
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vV;
varying float vPal;
varying vec4 vAnim;
void main() {
  float v = aJ.y, th = aJ.z;
  float pulse = aJAnim.x;
  float size = aJPos.w;
  #ifdef DEPTH_PASS
    // shadow pass: the whole bell casts (dithered in the fragment stage)
    vec3 p = bellP(v, th, pulse, aJSeed.w);
    vec3 n = vec3(0.0, 1.0, 0.0);
  #else
    vec3 p = coreP(v, th, pulse);
    float e = 0.01;
    vec3 a = coreP(min(v + e, 1.0), th, pulse) - coreP(max(v - e, 0.0), th, pulse);
    vec3 b = coreP(v, th + e, pulse) - coreP(v, th - e, pulse);
    vec3 n = cross(b, a);
    n = length(n) > 1e-6 ? normalize(n) : vec3(0.0, sign(0.5 - v), 0.0);
  #endif
  vec3 wp = aJPos.xyz + qrot(aJQuat, p * size);
  vWorldPos = wp;
  vNormal = qrot(aJQuat, n);
  vV = v;
  vPal = aJSeed.y;
  vAnim = aJAnim;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const CORE_FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${SHADOW}
${LIGHTING}
uniform vec3 uJCore[4];
uniform vec3 uJGlow[4];
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vV;
varying float vPal;
varying vec4 vAnim;
void main() {
  #ifdef DEPTH_PASS
    // a translucent bell: half the light gets through
    if (mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 2.0) > 0.5) discard;
    gl_FragColor = vec4(1.0);
    return;
  #endif
  int pi = int(clamp(floor(vPal), 0.0, 3.0));
  vec3 N = normalize(vNormal);
  vec3 albedo = uJCore[pi];
  // the gland's lobes, slightly deeper at the stalk; it is seen through the bell
  albedo *= 0.82 + 0.22 * smoothstep(0.9, 0.2, vV);
  vec3 Vv = normalize(uCamPos - vWorldPos);
  albedo = mix(albedo, albedo * vec3(1.06, 0.98, 1.02), 1.0 - abs(dot(N, Vv)));
  Surface s = makeSurface(albedo, N, vWorldPos);
  s.shadow = sampleShadow(vWorldPos, N);
  s.rim = 0.6;
  s.trans = 1.2;
  s.wrap = 0.4;
  s.spec = 0.3;
  s.gloss = 0.8;
  vec3 col = stylizedLight(s);
  // biology: a faint gas-gland glow, only at night
  col += uJGlow[pi] * uNight * 0.55 * vAnim.w * (0.8 + 0.2 * sin(uTime * 1.3 + vV * 3.0));
  col = mix(col, mix(uCloudShadow, uCloudLit, 0.6), vAnim.z * 0.7);
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, 1.0);
}
`;

const _v = new Vector3();
const _v2 = new Vector3();
const _q = new Quaternion();
const _q2 = new Quaternion();
const UP = new Vector3(0, 1, 0);
const VEIL_F = [0.35, 0.7];

export class JellySystem {
  constructor(eco) {
    this.eco = eco;
    this.game = eco.game;
    this.jellies = [];
    this.groups = [];
    this._seed = 501;
    this._order = [];
    const mk = () => new InstancedBufferAttribute(new Float32Array(MAX_JELLIES * 4), 4).setUsage(DynamicDrawUsage);
    this.attrs = { aJPos: mk(), aJQuat: mk(), aJAnim: mk(), aJTrail: mk(), aJSeed: mk() };
    this._attrList = Object.values(this.attrs);
    const pal = paletteUniforms(JELLY_PALETTES, ['mem', 'margin', 'core', 'glow']);
    const mgeo = buildJellyMembraneGeometry();
    const cgeo = buildJellyCoreGeometry();
    for (const [k, a] of Object.entries(this.attrs)) { mgeo.setAttribute(k, a); cgeo.setAttribute(k, a); }
    mgeo.instanceCount = 0;
    cgeo.instanceCount = 0;
    this.memMat = new ShaderMaterial({
      vertexShader: MEMBRANE_VERT,
      fragmentShader: MEMBRANE_FRAG,
      uniforms: Object.assign({}, G, { uJMem: { value: pal.mem }, uJMargin: { value: pal.margin }, uJGlow: { value: pal.glow } }),
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: FrontSide,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      premultipliedAlpha: true,
    });
    this.membrane = new Mesh(mgeo, this.memMat);
    this.membrane.frustumCulled = false;
    this.membrane.renderOrder = 12;
    this.membrane.name = 'jelly-membranes';
    this.membrane.visible = false;
    this.game.engine.sceneT.add(this.membrane);
    this.coreMat = new ShaderMaterial({
      vertexShader: CORE_VERT,
      fragmentShader: CORE_FRAG,
      uniforms: Object.assign({}, G, { uJCore: { value: pal.core }, uJGlow: { value: pal.glow } }),
    });
    this.core = new Mesh(cgeo, this.coreMat);
    this.core.frustumCulled = false;
    this.core.name = 'jelly-cores';
    this.core.visible = false;
    this.game.engine.scene.add(this.core);
    this.game.engine.shadows?.addCaster(this.core);
    this._occI = 0;
  }

  addGroup(center, spread = 40, count = 10, opts = {}) {
    count = Math.max(0, Math.min(Math.round(count), MAX_JELLIES - this.jellies.length));
    const r = rng(opts.seed ?? (this._seed += 11));
    const size = opts.size ?? [2, 8];
    const grp = {
      kind: 'jellies',
      home: center.clone(),
      anchor: opts.anchor || null,
      anchorOffset: opts.anchor ? center.clone().sub(opts.anchor) : null,
      spread,
      jellies: [],
      palette: opts.palette,
      rng: r,
      seekT: 0,
      pasture: null,
      dormant: false,
    };
    for (let i = 0; i < count; i++) {
      const diam = lerp(size[0], size[1], Math.pow(r(), 1.6));
      const p = r.inSphere(new Vector3()).multiply(_v.set(spread, spread * 0.35, spread)).add(center);
      const j = {
        group: grp,
        pos: p,
        vel: new Vector3(),
        size: diam * 0.5,
        tentLen: diam * lerp(1.6, 2.8, r()),
        armLen: diam * lerp(0.55, 0.9, r()),
        hs: lerp(1.0, 1.25, r()),
        phase: r(),
        period: lerp(3.2, 6.0, r()) * Math.sqrt(diam / 4),
        pulse: 0,
        spin: r() * TAU,
        spinRate: lerp(-0.05, 0.05, r()),
        tilt: new Quaternion(),
        quat: new Quaternion(),
        palette: grp.palette ?? Math.floor(r() * JELLY_PALETTES.length),
        seed: r() * 10,
        startle: 0,
        veil: 0,
        veilT: 0,
        glow: lerp(0.6, 1.0, r()),
        trail: new Vector3(0, -1, 0),
        graze: 0,
        wander: new Vector3(r() - 0.5, (r() - 0.5) * 0.3, r() - 0.5),
        depth: 0,
      };
      grp.jellies.push(j);
      this.jellies.push(j);
    }
    this.groups.push(grp);
    return grp;
  }

  clear() {
    this.jellies.length = 0;
    this.groups.length = 0;
    this.membrane.visible = this.core.visible = false;
    this.membrane.geometry.instanceCount = this.core.geometry.instanceCount = 0;
  }

  prune(center, r2) {
    for (const g of this.groups.slice()) {
      if (g.home.distanceToSquared(center) <= r2) continue;
      this.groups.splice(this.groups.indexOf(g), 1);
      for (const j of g.jellies) this.jellies.splice(this.jellies.indexOf(j), 1);
    }
  }

  shock(c, rIn, rOut, radius, strength) {
    for (const j of this.jellies) {
      const d = j.pos.distanceTo(c);
      if (d < rIn || d >= rOut || d > radius) continue;
      const k = (1 - d / radius) * strength;
      j.vel.addScaledVector(_v.subVectors(j.pos, c).normalize(), k * 6 / Math.sqrt(j.size));
      j.startle = Math.min(1, j.startle + k * 1.4);
    }
  }

  update(dt, ctx) {
    const n = this.jellies.length;
    if (n === 0) {
      this.membrane.visible = this.core.visible = false;
      return;
    }
    const game = this.game;
    const wind = ctx.wind;
    for (const g of this.groups) {
      g.dormant = g.home.distanceToSquared(ctx.cam) > DORMANT_DIST * DORMANT_DIST;
      if (g.anchor) g.home.copy(g.anchor).add(g.anchorOffset);
      else g.home.addScaledVector(ctx.cloudDriftVel, dt);
      // drift into the nearest plankton-rich cloud to graze
      g.seekT -= dt;
      if (g.seekT <= 0) {
        g.seekT = 2;
        g.pasture = null;
        let bd = 320 * 320;
        for (const cl of ctx.moist) {
          const d = _v.copy(cl.center).add(ctx.drift).distanceToSquared(g.home);
          if (d < bd) { bd = d; g.pasture = cl; }
        }
      }
      if (g.pasture && !g.anchor) {
        _v.copy(g.pasture.center).add(ctx.drift).sub(g.home);
        const d = _v.length();
        const want = Math.max(0, d - g.pasture.radius * 0.35);
        if (want > 0.5) g.home.addScaledVector(_v, (Math.min(0.4, want * 0.02) * dt) / d);
      }
    }
    // cloud veil: a few density probes per frame, round-robin
    const probes = Math.min(n, 3);
    for (let k = 0; k < probes; k++) {
      const j = this.jellies[this._occI++ % n];
      const clouds = game.clouds;
      let clear = 1 - Math.min(1, clouds.densityAt(j.pos) * 1.3);
      for (const f of VEIL_F) {
        _v.copy(ctx.cam).lerp(j.pos, f);
        clear *= 1 - Math.min(1, clouds.densityAt(_v) * 1.1);
      }
      j.veilT = 1 - clear;
    }
    for (const j of this.jellies) {
      const g = j.group;
      if (g.dormant) continue;
      // grazing inside the plankton cloud: calmer pulses, tentacles spread
      let grazeT = 0;
      if (g.pasture) {
        const pc = _v.copy(g.pasture.center).add(ctx.drift);
        grazeT = 1 - smoothstep(g.pasture.radius * 0.55, g.pasture.radius * 1.0, pc.distanceTo(j.pos));
      }
      j.graze += (grazeT * (1 - j.startle) - j.graze) * (1 - Math.exp(-dt * 0.4));
      // pulse: quick contraction, slow relaxation; each stroke gives a little lift
      const per = j.period * (1 - j.startle * 0.55) * (1 + j.graze * 0.35);
      const prev = j.phase;
      j.phase += dt / per;
      if (j.phase >= 1) j.phase -= 1;
      const ph = j.phase;
      j.pulse = ph < 0.22 ? smoothstep(0, 0.22, ph) : 1 - smoothstep(0.22, 1.0, ph);
      _v.set(0, 1, 0).applyQuaternion(j.quat);
      if (prev < 0.22 && ph < 0.22) j.vel.addScaledVector(_v, (dt / (0.22 * per)) * 0.45 / Math.sqrt(j.size));
      // drift with the air mass around the clouds, a gentle wander, a slow sink between strokes
      j.vel.x += (ctx.cloudDriftVel.x + j.wander.x * 0.35 - j.vel.x) * (1 - Math.exp(-dt * 0.35));
      j.vel.z += (ctx.cloudDriftVel.z + j.wander.z * 0.35 - j.vel.z) * (1 - Math.exp(-dt * 0.35));
      j.vel.y += (j.wander.y * 0.2 - 0.06 - j.vel.y * 0.4) * dt;
      // stay near the group (grazing their cloud)
      _v.subVectors(g.home, j.pos);
      const d = _v.length();
      if (d > g.spread) j.vel.addScaledVector(_v, ((d - g.spread) / d) * 0.02 * dt * 10);
      // personal space and big whales
      for (const o of g.jellies) {
        if (o === j) continue;
        _v.subVectors(j.pos, o.pos);
        const dd = _v.length();
        const min = (j.size + o.size) * 1.5;
        if (dd < min && dd > 1e-3) j.vel.addScaledVector(_v, ((min - dd) / min) * 0.6 * dt / dd);
      }
      for (const m of ctx.movers) {
        _v.set(j.pos.x - m.x, j.pos.y - m.y, j.pos.z - m.z);
        const dd = _v.length();
        const min = m.w + j.size * 2 + 4;
        if (dd < min && dd > 1e-3) {
          j.vel.addScaledVector(_v, ((min - dd) / min) * 3 * dt / dd);
          j.startle = Math.min(1, j.startle + dt * 0.5);
        }
      }
      if (ctx.threat) {
        _v.subVectors(j.pos, ctx.threat);
        const dd = _v.length();
        if (dd < 45) {
          j.startle = Math.min(1, j.startle + dt * 0.8);
          j.vel.addScaledVector(_v, 0.4 * dt / Math.max(dd, 1));
        }
      }
      if (Math.random() < dt * 0.05) j.wander.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.3, Math.random() - 0.5);
      const sp = j.vel.length();
      if (sp > 6) j.vel.multiplyScalar(6 / sp);
      j.pos.addScaledVector(j.vel, dt);
      if (j.pos.y < ctx.floorY) j.vel.y += (ctx.floorY - j.pos.y) * 0.02 * dt;
      j.startle = Math.max(0, j.startle - dt * 0.35);
      j.veil += (j.veilT - j.veil) * (1 - Math.exp(-dt * 2));
      // orientation: lean away from the relative air, rock with each stroke, slow spin
      const rel = _v2.subVectors(wind, j.vel);
      const lean = _v.set(rel.x * 0.035, 1, rel.z * 0.035);
      lean.x += Math.sin(ctx.time * 0.31 + j.seed) * 0.05;
      lean.z += Math.cos(ctx.time * 0.27 + j.seed * 1.3) * 0.05;
      lean.normalize();
      j.spin += j.spinRate * dt;
      _q.setFromUnitVectors(UP, lean);
      _q2.setFromAxisAngle(UP, j.spin);
      j.quat.copy(_q).multiply(_q2);
      // tentacles stream downwind of the jelly
      j.trail.set(rel.x * 0.12, -1, rel.z * 0.12).normalize();
      j.depth = _v.subVectors(j.pos, ctx.cam).dot(ctx.camFwd);
    }
    // back-to-front for the translucent bells
    const order = this._order;
    order.length = 0;
    for (const j of this.jellies) order.push(j);
    order.sort((a, b) => b.depth - a.depth);
    const A = this.attrs;
    const P = A.aJPos.array, Q = A.aJQuat.array, N = A.aJAnim.array, T = A.aJTrail.array, S = A.aJSeed.array;
    for (let i = 0; i < n; i++) {
      const j = order[i];
      const o = i * 4;
      P[o] = j.pos.x; P[o + 1] = j.pos.y; P[o + 2] = j.pos.z; P[o + 3] = j.size;
      Q[o] = j.quat.x; Q[o + 1] = j.quat.y; Q[o + 2] = j.quat.z; Q[o + 3] = j.quat.w;
      N[o] = j.pulse; N[o + 1] = j.startle; N[o + 2] = j.veil; N[o + 3] = j.glow;
      T[o] = j.trail.x; T[o + 1] = j.trail.y; T[o + 2] = j.trail.z; T[o + 3] = j.tentLen;
      S[o] = j.seed; S[o + 1] = j.palette + 0.05 + 0.9 * clamp(j.graze, 0, 1); S[o + 2] = j.armLen; S[o + 3] = j.hs;
    }
    for (const a of this._attrList) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * 4);
      a.needsUpdate = true;
    }
    this.membrane.geometry.instanceCount = n;
    this.core.geometry.instanceCount = n;
    this.membrane.visible = this.core.visible = true;
  }

  dispose() {
    this.game.engine.shadows?.removeCaster(this.core);
    this.membrane.removeFromParent();
    this.core.removeFromParent();
    this.membrane.geometry.dispose();
    this.core.geometry.dispose();
    this.memMat.dispose();
    this.coreMat.dispose();
  }
}
