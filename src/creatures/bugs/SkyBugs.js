// Flying bugs of Vur Sok: three alien sky-insect species the calf can catch and eat.
//  - lumen moth:  big soft four-winged moths with glowing eye spots; drifting clouds near islands,
//                 brighter at dusk and night. Also flown into rings for the playmates' races.
//  - spiral gnat: tiny glowing gnats in tight clouds that coil like the planet's spirals.
//  - skitterfly:  iridescent four-winged skimmers in shimmering ribbons just over the sea.
// One instanced draw per species (5 quads per bug: body billboard + two pairs of flapping wings),
// CPU-simulated in swarms (formation + a sprung flee offset), only swarms near the camera are
// simulated and drawn. No per-frame allocations.
import {
  InstancedBufferGeometry, InstancedBufferAttribute, BufferAttribute, Mesh, ShaderMaterial,
  CustomBlending, OneFactor, OneMinusSrcAlphaFactor, DynamicDrawUsage, Vector3, Vector4, Color,
} from 'three';
import { G } from '../../render/Globals.js';
import { UNIFORMS, NOISE, LIGHTING } from '../../render/shaders/common.js';

const TAU = Math.PI * 2;

/** Species definitions (sizes in metres; the calf is 4.2 m long). */
export const BUG_SPECIES = {
  moth: {
    slots: 10, block: 32, size: 0.62, flap: 9, amp: 0.8, base: 0.3, minPx: 2.2,
    bodyW: 0.1, bodyL: 0.42, wing: [1.0, 0.85, 0.82, 0.8],
    colA: 0xffc878, colB: 0x7fd8ff, glow: 0xffd28a, glowDay: 0.35, glowNight: 2.4,
    flee: 6.5, fleeR: 6.5, catchR: 1.9, energy: 0.03, wake: 1, shape: 0, drawDist: 520,
  },
  gnat: {
    slots: 5, block: 96, size: 0.24, flap: 38, amp: 0.55, base: 0.35, minPx: 1.7,
    bodyW: 0.3, bodyL: 0.42, wing: [0.8, 0.5, 0.6, 0.45],
    colA: 0xc8ff9a, colB: 0x6ff2d8, glow: 0xb8ff8a, glowDay: 0.9, glowNight: 2.0,
    flee: 3.2, fleeR: 4.5, catchR: 2.3, energy: 0.009, wake: 0.6, shape: 1, drawDist: 380,
  },
  skitter: {
    slots: 5, block: 40, size: 0.56, flap: 24, amp: 0.42, base: 0.04, minPx: 1.9,
    bodyW: 0.07, bodyL: 0.95, wing: [1.0, 0.36, 0.95, 0.34],
    colA: 0x5ff2e6, colB: 0xd27aff, glow: 0x8ff0ff, glowDay: 0.3, glowNight: 1.6,
    flee: 9, fleeR: 9, catchR: 1.7, energy: 0.04, wake: 1.2, shape: 2, drawDist: 420,
  },
};

const VERT = /* glsl */ `
${UNIFORMS}
${NOISE}
${LIGHTING}
attribute vec4 aP; // xyz position, w size multiplier
attribute vec4 aD; // xyz heading, w phase
attribute vec4 aS; // x flap rate, y excitement (fleeing), z variant, w alpha
uniform float uSize, uFlap, uAmp, uBase, uMinPx, uBodyW, uBodyL;
uniform vec4 uWing;
varying vec2 vUv;
varying float vPart;
varying float vAlpha;
varying float vFar;
varying float vFog;
varying vec3 vFogCol;
varying vec3 vN;
varying vec3 vV;
varying vec2 vVar;
void main() {
  vec3 f = aD.xyz;
  float fl = length(f);
  f = fl > 1e-4 ? f / fl : vec3(0.0, 0.0, 1.0);
  vec3 r = cross(vec3(0.0, 1.0, 0.0), f);
  float rl = length(r);
  r = rl > 1e-3 ? r / rl : vec3(1.0, 0.0, 0.0);
  vec3 u = cross(f, r);
  vec3 toC = uCamPos - aP.xyz;
  float dist = max(length(toC), 0.05);
  vec3 V = toC / dist;
  // keep a minimum size on screen (far swarms read as glittering specks, never alias away)
  float px = aP.w * uSize * projectionMatrix[1][1] * uResolution.y * 0.5 / dist;
  float grow = max(1.0, uMinPx / max(px, 1e-3));
  float s = aP.w * uSize * grow;
  vFar = smoothstep(1.2, 3.0, grow);
  float part = position.y;
  float ph = uTime * uFlap * aS.x + aD.w * 6.2831;
  vec3 lp;
  if (part < 0.5) {
    vec3 side = cross(f, V);
    float sl = length(side);
    side = sl > 1e-3 ? side / sl : r;
    lp = side * position.x * uBodyW * (1.0 + vFar * 2.0) + f * position.z * uBodyL;
    vN = V;
    vUv = position.xz;
  } else {
    float hind = part > 2.5 ? 1.0 : 0.0;
    float sgn = position.x < 0.0 ? -1.0 : 1.0;
    float span = abs(position.x);
    float a = uBase + sin(ph - hind * 0.7) * uAmp * (1.0 - 0.15 * hind) * (1.0 + aS.y * 0.4);
    // wings fold back a little on the downstroke
    float sweep = (0.12 + 0.12 * sin(ph)) * span;
    float sx = mix(uWing.x, uWing.z, hind), sz = mix(uWing.y, uWing.w, hind);
    span *= sx * (1.0 - vFar * 0.6);
    lp = r * sgn * span * cos(a) + u * span * sin(a) + f * (position.z * sz - sweep);
    vN = normalize(-r * sgn * sin(a) + u * cos(a));
    vUv = vec2(abs(position.x), position.z + (hind > 0.5 ? 0.95 : 0.3));
  }
  vPart = part;
  vec3 wp = aP.xyz + lp * s;
  vAlpha = aS.w / mix(1.0, grow, 0.7);
  vVar = aS.zy;
  vV = V;
  vFog = fogAmount(aP.xyz);
  vFogCol = fogColorFor(-V);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const FRAG = /* glsl */ `
${UNIFORMS}
uniform vec3 uColA, uColB, uGlowCol;
uniform float uGlowDay, uGlowNight, uShape;
varying vec2 vUv;
varying float vPart;
varying float vAlpha;
varying float vFar;
varying float vFog;
varying vec3 vFogCol;
varying vec3 vN;
varying vec3 vV;
varying vec2 vVar;
float ell(vec2 p, vec2 c, vec2 r) { vec2 q = (p - c) / r; return dot(q, q); }
void main() {
  float a = 0.0;
  float emis = 0.0;
  vec3 col;
  float var = vVar.x;
  vec3 cA = mix(uColA, uColB, var * 0.35);
  vec3 cB = mix(uColB, uColA, var * 0.25);
  if (vPart < 0.5) {
    // body: a soft glowing capsule (a round glow mote when far)
    vec2 q = vUv;
    float d = length(vec2(q.x, q.y * mix(1.0, 0.35, vFar)));
    a = smoothstep(1.0, 0.55, d);
    col = mix(cB * 0.25, cA * 0.7, 0.5 + 0.5 * q.y);
    emis = (1.0 - d) * (uShape > 0.5 && uShape < 1.5 ? 1.6 : 0.7) + vFar * 0.9;
    a = max(a, vFar * exp(-d * d * 3.0));
  } else {
    float hind = vPart > 2.5 ? 1.0 : 0.0;
    vec2 p = vUv; // x: span 0..1, y: chord 0..1
    float d;
    float vein = 0.0;
    if (uShape < 0.5) {
      // lumen moth: broad rounded forewings with a glowing eye spot, tailed hindwings
      if (hind < 0.5) {
        d = ell(p, vec2(0.52, 0.42 + p.x * 0.12), vec2(0.56, 0.4));
        float eye = length((p - vec2(0.62, 0.5)) / vec2(1.0, 1.15));
        emis = smoothstep(0.13, 0.07, eye) * (0.6 + 0.4 * smoothstep(0.05, 0.0, eye)) * 2.2 + smoothstep(0.75, 1.0, d) * 0.55;
        col = mix(cB, cA, smoothstep(0.1, 0.9, p.x));
        col = mix(col, vec3(0.08, 0.05, 0.12), smoothstep(0.16, 0.12, eye) * smoothstep(0.07, 0.1, eye));
      } else {
        d = min(ell(p, vec2(0.36, 0.62), vec2(0.4, 0.38)), ell(p, vec2(0.52 + (0.1 - p.y) * 0.4, 0.18), vec2(0.07, 0.22)));
        col = mix(cA, cB, 0.4 + 0.4 * p.x);
        emis = smoothstep(0.6, 1.0, d) * 0.5 + smoothstep(0.35, 0.0, p.y) * 0.9;
      }
      vein = smoothstep(0.92, 1.0, sin(atan(p.y - 0.5, p.x) * 11.0)) * 0.25;
    } else if (uShape < 1.5) {
      // spiral gnat: little clear wings, all shimmer
      d = ell(p, vec2(0.5, hind > 0.5 ? 0.6 : 0.45), vec2(0.5, 0.32));
      col = mix(cA, vec3(1.0), 0.4);
      emis = 0.4;
    } else {
      // skitterfly: long narrow dragonfly wings, iridescent, a dark pterostigma near the tip
      d = ell(p, vec2(0.5, hind > 0.5 ? 0.62 : 0.4), vec2(0.52, 0.42));
      float irid = 0.5 + 0.5 * sin(dot(normalize(vN), vV) * 7.0 + p.x * 5.0 + var * 6.0);
      col = mix(cA, cB, irid);
      vein = (smoothstep(0.9, 1.0, sin(p.x * 34.0)) + smoothstep(0.85, 1.0, sin(p.y * 15.0))) * 0.18;
      col = mix(col, vec3(0.06, 0.08, 0.14), smoothstep(0.05, 0.02, length((p - vec2(0.86, 0.55)) / vec2(1.0, 2.5))));
      emis = smoothstep(0.7, 1.0, d) * 0.6 + irid * 0.25;
    }
    a = smoothstep(1.0, 0.82, d);
    col *= 1.0 - vein;
    // wings are thin: translucent toward the light, fading out when far (the body glow takes over)
    a *= (uShape > 0.5 && uShape < 1.5 ? 0.35 : 0.9) * (1.0 - vFar);
  }
  if (a < 0.004) discard;
  float dusk = smoothstep(0.3, -0.05, uSunDir.y);
  float glowK = mix(uGlowDay, uGlowNight, max(uNight, dusk)) * (1.0 + vVar.y * 0.8);
  vec3 N = normalize(vN);
  float wrap = 0.35 + 0.65 * abs(dot(N, uSunDir));
  float back = pow(max(dot(-vV, uSunDir), 0.0), 4.0) * 0.8; // the sun through the wing
  vec3 lit = col * (uSkyAmbient * 1.1 + uSunColor * (wrap * 0.55 + back) + uMoonColor * uNight * 0.4);
  col = lit + uGlowCol * emis * glowK;
  col = mix(col, vFogCol, vFog * 0.92);
  a *= vAlpha;
  gl_FragColor = vec4(col * a, a);
}
`;

/** 5 quads: body (billboard), forewing L/R, hindwing L/R. position = (span, part, chord). */
function bugGeometry() {
  const P = [], I = [];
  const quad = (part, x0, x1, z0, z1) => {
    const b = P.length / 3;
    P.push(x0, part, z0, x1, part, z0, x1, part, z1, x0, part, z1);
    I.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  quad(0, -1, 1, -1, 1);
  quad(1, 0, -1, -0.3, 0.7);
  quad(2, 0, 1, -0.3, 0.7);
  quad(3, 0, -0.95, -0.95, 0.05);
  quad(4, 0, 0.95, -0.95, 0.05);
  const geo = new InstancedBufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(P), 3));
  geo.setIndex(I);
  return geo;
}

const _c = new Vector3();

export class SkyBugs {
  constructor(game, opts = {}) {
    this.game = game;
    this.kinds = {};
    this.swarms = [];
    this.t = 0;
    this.frame = 0;
    this.stats = { ms: 0, msAvg: 0, drawn: 0, sim: 0, eaten: 0 };
    this.mouthWant = 0; // 0..1: a live bug is right in front of the first eater's mouth
    this.nearest = Infinity;
    this.onCatch = null; // (kind, x, y, z, swarm) for the first eater
    const scene = opts.scene || game.engine.sceneT;
    for (const name of Object.keys(BUG_SPECIES)) {
      const def = BUG_SPECIES[name];
      const cap = def.slots * def.block;
      const geo = bugGeometry();
      const aP = new InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(DynamicDrawUsage);
      const aD = new InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(DynamicDrawUsage);
      const aS = new InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(DynamicDrawUsage);
      geo.setAttribute('aP', aP);
      geo.setAttribute('aD', aD);
      geo.setAttribute('aS', aS);
      geo.instanceCount = 0;
      const mat = new ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG,
        uniforms: Object.assign({}, G, {
          uSize: { value: def.size }, uFlap: { value: def.flap }, uAmp: { value: def.amp }, uBase: { value: def.base },
          uMinPx: { value: def.minPx }, uBodyW: { value: def.bodyW }, uBodyL: { value: def.bodyL },
          uWing: { value: new Vector4(def.wing[0], def.wing[1], def.wing[2], def.wing[3]) },
          uColA: { value: new Color(def.colA) }, uColB: { value: new Color(def.colB) }, uGlowCol: { value: new Color(def.glow) },
          uGlowDay: { value: def.glowDay }, uGlowNight: { value: def.glowNight }, uShape: { value: def.shape },
        }),
        transparent: true, depthWrite: false, depthTest: true, side: 2,
        blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor, premultipliedAlpha: true,
      });
      const mesh = new Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 24;
      mesh.name = `bugs-${name}`;
      scene.add(mesh);
      const K = {
        name, def, cap, mesh, geo, aP, aD, aS,
        pos: new Float32Array(cap * 3), off: new Float32Array(cap * 3), offV: new Float32Array(cap * 3),
        head: new Float32Array(cap * 3), seed: new Float32Array(cap * 4), fade: new Float32Array(cap),
        alive: new Uint8Array(cap), respawn: new Float32Array(cap), fleeCd: new Float32Array(cap),
        excite: new Float32Array(cap), seaY: new Float32Array(cap), init: new Uint8Array(cap),
        glowCol: new Color(def.glow), colA: new Color(def.colA),
      };
      let s = 12345 + name.length * 977;
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < cap * 4; i++) K.seed[i] = rnd();
      this.kinds[name] = K;
      for (let k = 0; k < def.slots; k++) {
        this.swarms.push({
          kind: name, K, first: k * def.block, block: def.block, count: 0, active: false, dying: false, fade: 0,
          center: new Vector3(), vel: new Vector3(), dir: new Vector3(1, 0, 0), lat: new Vector3(0, 0, 1),
          e1: new Vector3(1, 0, 0), e2: new Vector3(0, 1, 0), axis: new Vector3(0, 0, 1),
          radius: 6, shape: 'cloud', t: 0, seaY: 0, age: 0, near: false, tag: null, ringR: 5, eaten: 0, life: Infinity,
        });
      }
    }
  }

  /** Spawn a swarm. opts: { count, radius, shape: cloud|coil|ribbon|ring, dir (Vector3), normal, ringR, seaY, drift, tag, life } */
  spawn(kind, center, opts = {}) {
    const K = this.kinds[kind];
    if (!K) return null;
    let S = null;
    for (const s of this.swarms) if (s.kind === kind && !s.active) { S = s; break; }
    if (!S) return null;
    S.active = true;
    S.dying = false;
    S.fade = 0;
    S.t = Math.random() * 50;
    S.age = 0;
    S.eaten = 0;
    S.tag = opts.tag || null;
    S.life = opts.life ?? Infinity;
    S.center.copy(center);
    S.count = Math.min(S.block, Math.max(1, Math.round(opts.count ?? S.block * 0.75)));
    S.radius = opts.radius ?? (kind === 'gnat' ? 4.5 : kind === 'skitter' ? 7 : 9);
    S.shape = opts.shape || (kind === 'gnat' ? 'coil' : kind === 'skitter' ? 'ribbon' : 'cloud');
    S.seaY = opts.seaY ?? 0;
    S.ringR = opts.ringR ?? 5.5;
    S.dir.copy(opts.dir || S.dir).setY(0);
    if (S.dir.lengthSq() < 1e-6) S.dir.set(1, 0, 0);
    S.dir.normalize();
    S.lat.set(-S.dir.z, 0, S.dir.x);
    S.vel.set(0, 0, 0);
    if (opts.drift !== undefined) S.vel.copy(S.dir).multiplyScalar(opts.drift);
    if (S.shape === 'ring') {
      S.axis.copy(opts.normal || S.dir).normalize();
      S.e1.set(0, 1, 0).cross(S.axis);
      if (S.e1.lengthSq() < 1e-6) S.e1.set(1, 0, 0);
      S.e1.normalize();
      S.e2.copy(S.axis).cross(S.e1).normalize();
    }
    for (let j = 0; j < S.count; j++) {
      const i = S.first + j;
      K.alive[i] = 1;
      K.fade[i] = 0;
      K.respawn[i] = 0;
      K.fleeCd[i] = 0;
      K.excite[i] = 0;
      K.init[i] = 0;
      K.off[i * 3] = K.off[i * 3 + 1] = K.off[i * 3 + 2] = 0;
      K.offV[i * 3] = K.offV[i * 3 + 1] = K.offV[i * 3 + 2] = 0;
      K.seaY[i] = S.seaY;
    }
    return S;
  }

  /** Let a swarm fade away (its slot frees when invisible). */
  release(S) {
    if (S && S.active) S.dying = true;
  }

  clear() {
    for (const S of this.swarms) { S.active = false; S.dying = false; S.count = 0; }
    for (const k in this.kinds) this.kinds[k].geo.instanceCount = 0;
  }

  countActive(kind) {
    let n = 0;
    for (const S of this.swarms) if (S.active && !S.dying && S.kind === kind && !S.tag) n++;
    return n;
  }

  /** Every bug within radius bolts away from center. */
  scatter(center, radius, strength = 1) {
    const r2 = radius * radius;
    for (const S of this.swarms) {
      if (!S.active || S.center.distanceToSquared(center) > (radius + S.radius * 3) ** 2) continue;
      const K = S.K;
      for (let j = 0; j < S.count; j++) {
        const i = S.first + j, i3 = i * 3;
        const dx = K.pos[i3] - center.x, dy = K.pos[i3 + 1] - center.y, dz = K.pos[i3 + 2] - center.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > r2) continue;
        const d = Math.sqrt(d2) + 1e-3, k = K.def.flee * strength * (1.2 - d / radius);
        K.offV[i3] += (dx / d) * k;
        K.offV[i3 + 1] += (dy / d) * k + k * 0.3;
        K.offV[i3 + 2] += (dz / d) * k;
        K.excite[i] = 1;
      }
    }
  }

  /**
   * Simulate and upload. eater: { mouth: Vector3, fwd: Vector3, speed, open 0..1, body: Vector3 } or null.
   * Bugs that come within catch range of an open mouth are eaten (onCatch is called).
   */
  update(dt, eater = null) {
    const t0 = performance.now();
    this.t += dt;
    this.frame++;
    const cam = this.game.engine.camera.position;
    const ocean = this.game.ocean;
    const seaFn = ocean && ocean.enabled !== false ? (ocean.heightApprox ? ocean.heightApprox.bind(ocean) : ocean.heightAt ? ocean.heightAt.bind(ocean) : null) : null;
    let want = 0, nearest = Infinity;
    const mx = eater ? eater.mouth.x : 0, my = eater ? eater.mouth.y : 0, mz = eater ? eater.mouth.z : 0;
    const bx = eater ? eater.body.x : 0, by = eater ? eater.body.y : 0, bz = eater ? eater.body.z : 0;
    const fx = eater ? eater.fwd.x : 0, fy = eater ? eater.fwd.y : 0, fz = eater ? eater.fwd.z : 1;
    const openR = eater ? 5 + Math.min(eater.speed, 20) * 0.45 : 0;
    let drawn = 0, sim = 0;
    for (const k in this.kinds) this.kinds[k].n = 0;
    for (const S of this.swarms) {
      if (!S.active) continue;
      const K = S.K, def = K.def;
      S.age += dt;
      if (S.age > S.life) S.dying = true;
      S.fade = Math.min(1, Math.max(0, S.fade + (S.dying ? -dt * 0.8 : dt * 0.6)));
      if (S.dying && S.fade <= 0) { S.active = false; continue; }
      S.t += dt;
      S.center.addScaledVector(S.vel, dt);
      const dc = S.center.distanceTo(cam);
      S.near = dc < def.drawDist + S.radius * 4;
      if (!S.near) continue;
      sim += S.count;
      const R = S.radius, t = S.t, cx = S.center.x, cy = S.center.y, cz = S.center.z;
      const eaterNear = eater && Math.abs(bx - cx) < R * 3 + 30 && Math.abs(bz - cz) < R * 3 + 30 && Math.abs(by - cy) < R * 3 + 30;
      const fleeR2 = def.fleeR * def.fleeR, catchR2 = def.catchR * def.catchR;
      const refresh = this.frame & 3;
      for (let j = 0; j < S.count; j++) {
        const i = S.first + j, i3 = i * 3, i4 = i * 4;
        const k1 = K.seed[i4], k2 = K.seed[i4 + 1], k3 = K.seed[i4 + 2], ph = K.seed[i4 + 3];
        if (!K.alive[i]) {
          K.respawn[i] -= dt;
          if (K.respawn[i] > 0 || S.dying || S.shape === 'ring') continue;
          K.alive[i] = 1;
          K.fade[i] = 0;
          K.off[i3] = K.off[i3 + 1] = K.off[i3 + 2] = 0;
          K.offV[i3] = K.offV[i3 + 1] = K.offV[i3 + 2] = 0;
        }
        // ---- formation target ----
        let x, y, z;
        if (S.shape === 'coil') {
          // a tight cloud that coils: a spinning helix, twisting along its height
          const ang = t * (2.0 + k2 * 1.6) + ph * TAU;
          const h = (k1 - 0.5) * R * 1.5;
          const rr = R * (0.2 + 0.8 * k3) * (0.65 + 0.35 * Math.sin(t * 0.8 + k1 * 6));
          const tw = h * 0.35 + t * 0.4;
          x = cx + Math.cos(ang) * rr + Math.cos(tw) * R * 0.35;
          z = cz + Math.sin(ang) * rr + Math.sin(tw) * R * 0.35;
          y = cy + h + Math.sin(ang * 0.5 + t) * R * 0.08;
        } else if (S.shape === 'ribbon') {
          // a shimmering ribbon skimming the sea, sliding along itself
          let a = (k1 + t * 0.05 * (0.8 + 0.4 * k2)) % 1;
          a = (a - 0.5) * R * 5;
          const lat = Math.sin(a * 0.09 + t * 0.8 + k3) * R * 0.4 + (k2 - 0.5) * R * 0.35;
          x = cx + S.dir.x * a + S.lat.x * lat;
          z = cz + S.dir.z * a + S.lat.z * lat;
          if (seaFn && ((i + refresh) & 3) === 0) K.seaY[i] = seaFn(x, z);
          y = K.seaY[i] + 0.55 + 0.45 * Math.abs(Math.sin(t * 2.6 + ph * TAU)) + k3 * 0.5;
        } else if (S.shape === 'ring') {
          // a living ring to fly through: moths circling a hoop
          const ag = (j / S.count) * TAU + t * 0.45;
          const rr = S.ringR * (1 + 0.05 * Math.sin(t * 3 + k1 * 9));
          const wob = Math.sin(t * 2 + k2 * 6) * 0.35;
          x = cx + S.e1.x * Math.cos(ag) * rr + S.e2.x * Math.sin(ag) * rr + S.axis.x * wob;
          y = cy + S.e1.y * Math.cos(ag) * rr + S.e2.y * Math.sin(ag) * rr + S.axis.y * wob;
          z = cz + S.e1.z * Math.cos(ag) * rr + S.e2.z * Math.sin(ag) * rr + S.axis.z * wob;
        } else {
          // drifting cloud: lazy looping paths
          const a = t * (0.3 + 0.35 * k2) + ph * TAU;
          const rr = R * (0.35 + 0.65 * k1);
          x = cx + Math.sin(a) * rr + Math.sin(t * 0.7 + k3 * 9) * R * 0.15;
          z = cz + Math.cos(a * 0.83 + k3 * 3) * rr;
          y = cy + Math.sin(t * (0.5 + k1 * 0.4) + ph * 11) * R * 0.3 + (k3 - 0.5) * R * 0.45;
        }
        // ---- flee offset (a damped spring back to the formation) ----
        let ox = K.off[i3], oy = K.off[i3 + 1], oz = K.off[i3 + 2];
        let vx = K.offV[i3], vy = K.offV[i3 + 1], vz = K.offV[i3 + 2];
        vx += (-ox * 1.6 - vx * 1.5) * dt;
        vy += (-oy * 1.6 - vy * 1.5) * dt;
        vz += (-oz * 1.6 - vz * 1.5) * dt;
        ox += vx * dt; oy += vy * dt; oz += vz * dt;
        K.fleeCd[i] -= dt;
        K.excite[i] = Math.max(0, K.excite[i] - dt * 0.8);
        let px = x + ox, py = y + oy, pz = z + oz;
        if (eaterNear && K.alive[i]) {
          const ex = px - bx, ey = py - by, ez = pz - bz;
          const d2 = ex * ex + ey * ey + ez * ez;
          if (d2 < fleeR2 && K.fleeCd[i] <= 0) {
            // a little burst away, sideways to the calf's path (so a quick calf still gets some)
            const d = Math.sqrt(d2) + 1e-3;
            const along = (ex * fx + ey * fy + ez * fz) / d;
            const k = def.flee * (0.7 + 0.6 * k2);
            vx += ((ex / d) - fx * along * 0.7) * k + (k3 - 0.5) * 2;
            vy += ((ey / d) - fy * along * 0.7) * k + k * 0.35;
            vz += ((ez / d) - fz * along * 0.7) * k + (k1 - 0.5) * 2;
            K.fleeCd[i] = 0.9 + k1 * 0.8;
            K.excite[i] = 1;
          }
          const mx2 = px - mx, my2 = py - my, mz2 = pz - mz;
          const m2 = mx2 * mx2 + my2 * my2 + mz2 * mz2;
          if (m2 < nearest) nearest = m2;
          if (m2 < openR * openR && (mx2 * fx + my2 * fy + mz2 * fz) > -1.2) want = 1;
          if (eater.open > 0.3 && m2 < catchR2 * (0.6 + 0.4 * eater.open) * (1 + Math.min(eater.speed, 20) * 0.03)) {
            K.alive[i] = 0;
            K.respawn[i] = 7 + k1 * 8;
            S.eaten++;
            this.stats.eaten++;
            if (this.onCatch) this.onCatch(S.kind, px, py, pz, S);
            K.off[i3] = ox; K.off[i3 + 1] = oy; K.off[i3 + 2] = oz;
            K.offV[i3] = vx; K.offV[i3 + 1] = vy; K.offV[i3 + 2] = vz;
            continue;
          }
        }
        K.off[i3] = ox; K.off[i3 + 1] = oy; K.off[i3 + 2] = oz;
        K.offV[i3] = vx; K.offV[i3 + 1] = vy; K.offV[i3 + 2] = vz;
        // heading from motion (smoothed)
        let hx, hy, hz;
        if (!K.init[i]) {
          K.init[i] = 1;
          hx = S.dir.x; hy = 0; hz = S.dir.z;
        } else {
          const inv = 1 / Math.max(dt, 1e-4), kh = 1 - Math.exp(-dt * 8);
          hx = K.head[i3] + ((px - K.pos[i3]) * inv - K.head[i3]) * kh;
          hy = K.head[i3 + 1] + ((py - K.pos[i3 + 1]) * inv - K.head[i3 + 1]) * kh;
          hz = K.head[i3 + 2] + ((pz - K.pos[i3 + 2]) * inv - K.head[i3 + 2]) * kh;
        }
        K.head[i3] = hx; K.head[i3 + 1] = hy; K.head[i3 + 2] = hz;
        K.pos[i3] = px; K.pos[i3 + 1] = py; K.pos[i3 + 2] = pz;
        K.fade[i] = Math.min(1, K.fade[i] + dt * 1.2);
        // ---- pack for drawing ----
        const n = K.n++;
        const P = K.aP.array, D = K.aD.array, A = K.aS.array, n4 = n * 4;
        P[n4] = px; P[n4 + 1] = py; P[n4 + 2] = pz; P[n4 + 3] = 0.8 + 0.4 * k2;
        D[n4] = hx; D[n4 + 1] = hy * 0.5; D[n4 + 2] = hz; D[n4 + 3] = ph;
        A[n4] = 0.8 + 0.4 * k3 + K.excite[i] * 0.5; A[n4 + 1] = K.excite[i]; A[n4 + 2] = k1; A[n4 + 3] = K.fade[i] * S.fade;
      }
    }
    for (const k in this.kinds) {
      const K = this.kinds[k];
      K.geo.instanceCount = K.n;
      drawn += K.n;
      if (K.n > 0) {
        for (const a of [K.aP, K.aD, K.aS]) {
          a.clearUpdateRanges?.();
          a.addUpdateRange?.(0, K.n * 4);
          a.needsUpdate = true;
        }
      }
    }
    this.mouthWant = want;
    this.nearest = Math.sqrt(nearest);
    const ms = performance.now() - t0;
    this.stats.ms = ms;
    this.stats.msAvg = this.stats.msAvg * 0.95 + ms * 0.05;
    this.stats.drawn = drawn;
    this.stats.sim = sim;
  }
}
