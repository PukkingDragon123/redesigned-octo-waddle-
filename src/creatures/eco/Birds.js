// Puffbirds: small (0.4-0.8 m span) fluffy round birds with long thin tails. They fly in
// murmuration-like boids with rippling turn waves and bounding flight (flap bursts, folded
// glides), settle in staggered waves onto the backs of the big whales (roosts), preen and
// look around while perched, scatter when startled (threat / sonic boom) and settle again.
import {
  Mesh, ShaderMaterial, InstancedBufferAttribute, DynamicDrawUsage, Vector3, Quaternion, Matrix4, Euler, FrontSide,
} from 'three';
import { G } from '../../render/Globals.js';
import { UNIFORMS, NOISE, SHADOW, LIGHTING } from '../../render/shaders/common.js';
import { ECO_GLSL, BIRD_PALETTES, paletteUniforms } from './shaderlib.js';
import { buildBirdGeometry } from './geometry.js';
import { rng, lerp, clamp, smoothstep, wrapAngle } from '../../core/math.js';

const MAX_BIRDS = 512;
const TAU = Math.PI * 2;

const BIRD_VERT = /* glsl */ `
${UNIFORMS}
${ECO_GLSL}
attribute vec4 aB;      // part, along, chord, side
attribute vec4 aBPos;   // xyz, scale
attribute vec4 aBQuat;
attribute vec4 aBAnim;  // flap phase, flap amplitude, fold 0..1, head yaw
attribute vec4 aBSeed;  // seed, palette, tail lift, head tilt
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vLocal;
varying vec4 vB;
varying float vPal;
varying float vSeed;
void main() {
  float part = aB.x;
  vec3 p = position;
  vec3 n = normal;
  float phase = aBAnim.x, amp = aBAnim.y, fold = aBAnim.z;
  if (part < 0.5) {
    // fluffy, slightly lumpy silhouette that breathes
    float fl = sin(n.x * 9.0 + aBSeed.x) * sin(n.y * 7.0 + 1.3) * sin(n.z * 8.0 + aBSeed.x * 2.0);
    p += n * (0.006 * fl + 0.003 * sin(uTime * 3.1 + aBSeed.x * 5.0));
  } else if (part < 2.5) {
    vec3 piv = vec3(0.0, 0.035, 0.045);
    mat3 R = rotY(aBAnim.w) * rotX(aBSeed.w);
    p = piv + R * (p - piv);
    n = R * n;
    if (part < 1.5) p += n * 0.004 * sin(n.x * 8.0 + n.y * 6.0 + aBSeed.x);
  } else if (part < 3.5) {
    vec3 piv = vec3(0.0, 0.02, -0.09);
    mat3 R = rotX(-aBSeed.z + 0.05 * sin(phase * 0.5));
    p = piv + R * (p - piv);
    n = R * n;
  } else {
    float a = aB.y;
    float side = aB.w < 0.0 ? -1.0 : 1.0;
    vec3 r0 = vec3(side * 0.065, 0.03, 0.0);
    // flap: shoulder leads, wingtip lags
    float th = amp * (0.8 * sin(phase) + 0.35 * a * sin(phase - 1.1)) + 0.12 * (1.0 - amp);
    mat3 Rf = rotZ(side * th);
    vec3 ps = r0 + Rf * (p - r0);
    vec3 ns = Rf * n;
    // folded along the flank, leading edge up
    mat3 Rk = rotZ(side * 1.3) * rotY(side * 1.45);
    vec3 pf = r0 + vec3(side * 0.014, -0.012, 0.012) + Rk * ((p - r0) * vec3(0.92, 1.0, 0.9));
    vec3 nf = Rk * n;
    p = mix(ps, pf, fold);
    n = normalize(mix(ns, nf, fold));
  }
  p.y += 0.01 * amp * sin(phase + 1.6);
  float sc = aBPos.w;
  vec3 wp = aBPos.xyz + qrot(aBQuat, p * sc);
  vWorldPos = wp;
  vNormal = qrot(aBQuat, n);
  vLocal = position;
  vB = aB;
  vPal = aBSeed.y;
  vSeed = aBSeed.x;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const BIRD_FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${SHADOW}
${LIGHTING}
uniform vec3 uBBody[4];
uniform vec3 uBBreast[4];
uniform vec3 uBCap[4];
uniform vec3 uBWing[4];
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vLocal;
varying vec4 vB;
varying float vPal;
varying float vSeed;
void main() {
  #ifdef DEPTH_PASS
    gl_FragColor = vec4(1.0);
    return;
  #endif
  int pi = int(clamp(floor(vPal), 0.0, 3.0));
  vec3 body = uBBody[pi], breast = uBBreast[pi], cap = uBCap[pi], wing = uBWing[pi];
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorldPos);
  float part = vB.x;
  vec3 L = vLocal;
  vec3 albedo = body;
  float trans = 0.45, rim = 0.95, spec = 0.0, wrap = 0.4;
  bool thin = false;
  float fea = 1.0;
  if (part < 0.5) {
    // warm breast on the front, pale belly, soft back
    float br = smoothstep(-0.02, 0.06, L.z) * smoothstep(0.05, -0.04, L.y);
    albedo = mix(body, breast, br * 0.85);
    albedo = mix(albedo, mix(body, vec3(1.0), 0.45), smoothstep(-0.03, -0.075, L.y) * 0.6);
    albedo = mix(albedo, mix(body, wing, 0.35), smoothstep(0.03, 0.08, L.y) * smoothstep(0.02, -0.08, L.z));
  } else if (part < 1.5) {
    vec3 hl = L - vec3(0.0, 0.06, 0.08);
    albedo = mix(body, cap, smoothstep(0.012, 0.04, hl.y + 0.01 * sin(L.x * 60.0)));
    // rosy cheek and a big dark eye with a catch-light
    float cheek = smoothstep(0.03, 0.0, length(vec2(abs(hl.x) - 0.04, hl.y + 0.016))) * smoothstep(-0.01, 0.02, hl.z);
    albedo = mix(albedo, breast, cheek * 0.6);
    float ed = length(vec3(abs(hl.x) - 0.046, hl.y - 0.004, hl.z - 0.02));
    float eye = smoothstep(0.0125, 0.009, ed);
    albedo = mix(albedo, vec3(0.03, 0.025, 0.04), eye);
    spec = eye * 1.6;
    trans *= 1.0 - eye;
  } else if (part < 2.5) {
    albedo = vec3(0.3, 0.24, 0.22);
    trans = 0.1; spec = 0.3; rim = 0.4;
  } else if (part < 3.5) {
    // long tail with darker outer feathers and a soft notch at the tip
    float ax = abs(L.x) / (0.022 + vB.y * 0.022);
    albedo = mix(wing * 0.92, cap * 0.75, smoothstep(0.4, 1.0, ax) * 0.6 + smoothstep(0.5, 1.0, vB.y) * 0.3);
    thin = true;
    float notch = smoothstep(0.75, 1.0, vB.y) * smoothstep(0.35, 0.0, ax);
    fea = 1.0 - notch * 0.9;
  } else {
    float a = vB.y, c = vB.z;
    // pale coverts at the leading edge, darker flight feathers toward the tip
    albedo = mix(wing, mix(wing, vec3(1.0), 0.35), smoothstep(0.45, 0.0, c) * smoothstep(0.75, 0.25, a));
    albedo = mix(albedo, cap * 0.78, smoothstep(0.6, 0.95, a) * 0.65);
    float quill = smoothstep(0.75, 1.0, sin(a * 40.0)) * smoothstep(0.45, 0.85, c);
    albedo *= 1.0 - quill * 0.12;
    // scalloped trailing edge: one rounded tip per flight feather
    float edge = 0.86 + 0.14 * abs(sin(a * 3.14159 * 4.5));
    fea = smoothstep(edge + 0.04, edge - 0.04, c);
    thin = true;
    trans = 0.95;
  }
  if (thin && dot(N, V) < 0.0) N = -N;
  Surface s = makeSurface(albedo, N, vWorldPos);
  s.shadow = sampleShadow(vWorldPos, N);
  s.rim = rim;
  s.trans = trans;
  s.spec = spec;
  s.gloss = 0.9;
  s.wrap = wrap;
  s.ao = mix(0.78, 1.0, smoothstep(-0.08, 0.06, L.y));
  vec3 col = stylizedLight(s);
  col = applyFog(col, vWorldPos);
  // fluffy, feathered silhouette edges
  float a = fea;
  if (part < 1.5) a = clamp(abs(dot(N, V)) * 3.2 + 0.25 + (hash12(floor(gl_FragCoord.xy * 0.5) + vSeed) - 0.5) * 0.45, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}
`;

const _v = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _m = new Matrix4();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _e = new Euler(0, 0, 0, 'YXZ');
const UP = new Vector3(0, 1, 0);
const ROOST_RANGE = 450;
const NEIGHBOURS = 28;
const DORMANT_DIST = 1300;

export class BirdSystem {
  constructor(eco) {
    this.eco = eco;
    this.game = eco.game;
    this.birds = [];
    this.flocks = [];
    this._seed = 701;
    this._roostInfo = new WeakMap();
    const mk = () => new InstancedBufferAttribute(new Float32Array(MAX_BIRDS * 4), 4).setUsage(DynamicDrawUsage);
    this.aPos = mk();
    this.aQuat = mk();
    this.aAnim = mk();
    this.aSeed = mk();
    this._attrs = [this.aPos, this.aQuat, this.aAnim, this.aSeed];
    const geo = buildBirdGeometry();
    geo.setAttribute('aBPos', this.aPos);
    geo.setAttribute('aBQuat', this.aQuat);
    geo.setAttribute('aBAnim', this.aAnim);
    geo.setAttribute('aBSeed', this.aSeed);
    geo.instanceCount = 0;
    const pal = paletteUniforms(BIRD_PALETTES, ['body', 'breast', 'cap', 'wing']);
    this.material = new ShaderMaterial({
      vertexShader: BIRD_VERT,
      fragmentShader: BIRD_FRAG,
      uniforms: Object.assign({}, G, {
        uBBody: { value: pal.body }, uBBreast: { value: pal.breast }, uBCap: { value: pal.cap }, uBWing: { value: pal.wing },
      }),
      side: FrontSide,
    });
    this.material.alphaToCoverage = true;
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'puffbirds';
    this.mesh.visible = false;
    this.game.engine.scene.add(this.mesh);
    this._frame = 0;
  }

  addFlock(center, count = 60, opts = {}) {
    count = Math.max(0, Math.min(Math.round(count), MAX_BIRDS - this.birds.length));
    const r = rng(opts.seed ?? (this._seed += 19));
    const fl = {
      kind: 'birds',
      home: center.clone(),
      anchor: opts.anchor || null,
      anchorOffset: opts.anchor ? center.clone().sub(opts.anchor) : null,
      leash: opts.leash ?? 70,
      birds: [],
      mode: 'fly',
      calmT: lerp(0, 8, r()),
      restAfter: opts.restAfter ?? lerp(10, 22, r()),
      perchT: 0,
      perchFor: lerp(40, 90, r()),
      roost: opts.roost !== false,
      target: center.clone(),
      a: [lerp(0.11, 0.17, r()), lerp(0.19, 0.27, r()), lerp(0.13, 0.2, r()), r() * TAU, r() * TAU],
      centroid: center.clone(),
      fwd: new Vector3(1, 0, 0),
      riding: null,
      palettes: opts.palette !== undefined ? [opts.palette] : [0, 1, 2, 3].filter(() => r() < 0.75),
      rng: r,
    };
    if (!fl.palettes.length) fl.palettes = [Math.floor(r() * 4)];
    for (let i = 0; i < count; i++) {
      const p = r.inSphere(new Vector3()).multiplyScalar(8).add(center);
      const b = {
        flock: fl,
        pos: p,
        vel: new Vector3(r() - 0.5, (r() - 0.5) * 0.2, r() - 0.5).normalize().multiplyScalar(7),
        acc: new Vector3(),
        mode: 'fly',
        roost: null,
        off: new Vector3(),
        perchYaw: 0,
        landDelay: 0,
        phase: r() * TAU,
        amp: 0.8,
        fold: 0,
        boundT: r(),
        bounding: false,
        headYaw: 0,
        headYawT: 0,
        headT: r() * 2,
        tilt: 0,
        tailLift: 0,
        hop: 0,
        hopT: lerp(3, 12, r()),
        flutter: 0,
        seed: r() * 10,
        palette: fl.palettes[Math.floor(r() * fl.palettes.length)],
        scale: lerp(0.4, 0.8, Math.pow(r(), 1.3)) / 0.6,
        quat: new Quaternion(),
        roll: 0,
        pitch: 0,
        startle: 0,
        kick: new Vector3(),
        snap: new Vector3(),
        neighborT: i % 2,
        sep: new Vector3(), ali: new Vector3(), coh: new Vector3(),
      };
      fl.birds.push(b);
      this.birds.push(b);
    }
    this.flocks.push(fl);
    return fl;
  }

  clear() {
    this.birds.length = 0;
    this.flocks.length = 0;
    this.mesh.visible = false;
    this.mesh.geometry.instanceCount = 0;
  }

  prune(center, r2) {
    for (const f of this.flocks.slice()) {
      if (f.home.distanceToSquared(center) <= r2) continue;
      this.flocks.splice(this.flocks.indexOf(f), 1);
      for (const b of f.birds) this.birds.splice(this.birds.indexOf(b), 1);
    }
  }

  shock(c, rIn, rOut, radius, strength) {
    for (const fl of this.flocks) {
      let hit = false;
      for (const b of fl.birds) {
        const d = b.pos.distanceTo(c);
        if (d < rIn || d >= rOut || d > radius * 1.6) continue;
        const k = clamp(1 - d / (radius * 1.6), 0, 1) * strength;
        b.kick.subVectors(b.pos, c).normalize().multiplyScalar(4 + k * 10);
        b.startle = 1;
        hit = true;
      }
      if (hit) this._alarm(fl, c);
    }
  }

  /** Everyone up: perched birds burst off the whale, flyers scatter. */
  _alarm(fl, from) {
    fl.calmT = -lerp(6, 12, fl.rng());
    fl.mode = 'fly';
    for (const b of fl.birds) {
      if (b.mode === 'perch' || b.mode === 'land') this._takeOff(b, from);
      b.startle = Math.max(b.startle, 0.7);
    }
  }

  _takeOff(b, from) {
    const info = b.roost ? this._roostInfo.get(b.roost) : null;
    b.mode = 'fly';
    b.vel.copy(info ? info.vel : _v.set(0, 0, 0));
    _v2.copy(b.roost && b.roost.up ? b.roost.up : UP).multiplyScalar(3.5 + Math.random() * 2.5);
    b.vel.add(_v2);
    if (from) b.vel.addScaledVector(_v3.subVectors(b.pos, from).setY(0).normalize(), 3 + Math.random() * 3);
    else b.vel.add(_v3.set(Math.random() - 0.5, 0, Math.random() - 0.5).multiplyScalar(4));
    b.roost = null;
    b.fold = 0;
    b.amp = 1.1;
    b.bounding = false;
    b.boundT = 0.8;
  }

  // ---- roosts -------------------------------------------------------------------------------
  _roostFrame(roost, dt, time) {
    let info = this._roostInfo.get(roost);
    if (!info) {
      info = { prev: roost.pos.clone(), t: time, vel: new Vector3(), fwd: new Vector3(0, 0, 1), up: new Vector3(0, 1, 0), right: new Vector3(1, 0, 0), frame: -1, occ: 0, capacity: 8, level: 1 };
      this._roostInfo.set(roost, info);
    }
    if (info.frame === this._frame) return info;
    info.frame = this._frame;
    const el = time - info.t;
    if (el > 1e-4) {
      _v.subVectors(roost.pos, info.prev).divideScalar(el);
      if (_v.length() < 80) info.vel.lerp(_v, 1 - Math.exp(-el * 6));
      info.prev.copy(roost.pos);
      info.t = time;
    }
    info.up.copy(roost.up || UP).normalize();
    // heading: explicit fwd / quat, else the direction of travel
    if (roost.fwd) info.fwd.copy(roost.fwd);
    else if (roost.quat) info.fwd.set(0, 0, 1).applyQuaternion(roost.quat);
    else if (info.vel.lengthSq() > 0.25) info.fwd.lerp(_v.copy(info.vel).normalize(), 1 - Math.exp(-dt * 2));
    info.fwd.addScaledVector(info.up, -info.fwd.dot(info.up));
    if (info.fwd.lengthSq() < 1e-6) info.fwd.set(1, 0, 0).addScaledVector(info.up, -info.up.x);
    info.fwd.normalize();
    info.right.crossVectors(info.up, info.fwd).normalize();
    info.spread = roost.spread ?? (roost.L ? roost.L * 0.13 : 2.2);
    info.lift = roost.lift ?? (roost.L ? roost.L * 0.165 : 0);
    info.curve = roost.curve ?? (roost.L ? 1.8 / roost.L : 0.06);
    info.capacity = roost.capacity ?? Math.max(4, Math.round(info.spread * info.spread * 4));
    // a whale that banks hard or rolls shakes its passengers off
    info.level = info.up.y;
    return info;
  }

  _perchPos(b, info, out) {
    const o = b.off;
    const h = info.lift - info.curve * (o.x * o.x + 0.3 * o.z * o.z) + 0.07 * b.scale;
    return out.copy(b.roost.pos).addScaledVector(info.up, h).addScaledVector(info.right, o.x).addScaledVector(info.fwd, o.z);
  }

  _pickPerch(b, roosts, time, dt) {
    let best = null, bd = ROOST_RANGE;
    for (const ro of roosts) {
      if (!ro || !ro.pos) continue;
      const info = this._roostFrame(ro, dt, time);
      if (info.level < 0.8 || info.occ >= info.capacity) continue;
      const d = ro.pos.distanceTo(b.pos) * (0.8 + Math.random() * 0.4);
      if (d < bd) { bd = d; best = ro; }
    }
    if (!best) return false;
    const info = this._roostFrame(best, dt, time);
    const others = b.flock.birds.filter((o) => o !== b && o.roost === best);
    let ok = false;
    for (let k = 0; k < 10 && !ok; k++) {
      b.off.set((Math.random() * 2 - 1) * info.spread * 0.55, 0, (Math.random() * 2 - 1) * info.spread * 1.15);
      ok = others.every((o) => o.off.distanceTo(b.off) > 0.3 * (b.scale + o.scale));
    }
    if (!ok) return false;
    b.roost = best;
    info.occ++;
    b.perchYaw = (Math.random() - 0.5) * 1.6 + (Math.random() < 0.15 ? Math.PI : 0);
    return true;
  }

  // ---- update -------------------------------------------------------------------------------
  update(dt, ctx) {
    this._frame++;
    const n = this.birds.length;
    if (n === 0) {
      this.mesh.visible = false;
      return;
    }
    const roosts = ctx.roosts || [];
    for (const r of roosts) if (r && r.pos) this._roostFrame(r, dt, ctx.time).occ = 0;
    for (const b of this.birds) {
      if (!b.roost) continue;
      const info = this._roostInfo.get(b.roost);
      if (info) info.occ++;
    }
    for (const fl of this.flocks) {
      // far beyond sight and nobody riding a whale: the flock rests
      if (!fl.riding && fl.centroid.distanceToSquared(ctx.cam) > DORMANT_DIST * DORMANT_DIST && fl.home.distanceToSquared(ctx.cam) > DORMANT_DIST * DORMANT_DIST) continue;
      this._updateFlock(fl, dt, ctx, roosts);
    }
    const P = this.aPos.array, Q = this.aQuat.array, A = this.aAnim.array, S = this.aSeed.array;
    for (let i = 0; i < n; i++) {
      const b = this.birds[i];
      const o = i * 4;
      P[o] = b.pos.x; P[o + 1] = b.pos.y + b.hop; P[o + 2] = b.pos.z; P[o + 3] = b.scale;
      Q[o] = b.quat.x; Q[o + 1] = b.quat.y; Q[o + 2] = b.quat.z; Q[o + 3] = b.quat.w;
      A[o] = b.phase; A[o + 1] = b.amp; A[o + 2] = b.fold; A[o + 3] = b.headYaw;
      S[o] = b.seed; S[o + 1] = b.palette + 0.5; S[o + 2] = b.tailLift; S[o + 3] = b.tilt;
    }
    for (const a of this._attrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * 4);
      a.needsUpdate = true;
    }
    this.mesh.geometry.instanceCount = n;
    this.mesh.visible = true;
  }

  _updateFlock(fl, dt, ctx, roosts) {
    const t = ctx.time;
    const r = fl.rng;
    if (fl.anchor) fl.home.copy(fl.anchor).add(fl.anchorOffset);
    // while the flock rides a whale its home range travels with it (the herd carries its birds)
    let riding = null, nRide = 0;
    for (const b of fl.birds) if (b.roost && b.mode === 'perch') { riding = b.roost; nRide++; }
    fl.riding = riding;
    if (riding && !fl.anchor) {
      _v.copy(riding.pos).addScaledVector(riding.up || UP, 10);
      fl.home.lerp(_v, 1 - Math.exp(-dt * 0.5));
    }
    // threat: scatter everyone within reach
    if (ctx.threat) {
      const near = fl.birds.some((b) => b.pos.distanceToSquared(ctx.threat) < 90 * 90);
      if (near) this._alarm(fl, ctx.threat);
    }
    fl.calmT += dt;
    // flock target sweeps through the sky in long curves (murmuration)
    const a = fl.a, R = fl.leash * 0.55;
    fl.target.set(
      fl.home.x + Math.sin(t * a[0] + a[3]) * R,
      fl.home.y + 6 + Math.sin(t * a[1]) * R * 0.22,
      fl.home.z + Math.sin(t * a[2] + a[4]) * R,
    );
    // centroid and heading of the flyers
    let nf = 0;
    _v.set(0, 0, 0);
    _v2.set(0, 0, 0);
    for (const b of fl.birds) if (b.mode === 'fly') { _v.add(b.pos); _v2.add(b.vel); nf++; }
    if (nf) {
      fl.centroid.copy(_v.divideScalar(nf));
      if (_v2.lengthSq() > 0.01) fl.fwd.copy(_v2.normalize());
    }
    // settle onto the whales after a calm spell (only if one is within reach)
    let canRoost = false;
    if (fl.roost && fl.mode === 'fly' && fl.calmT > fl.restAfter) {
      for (const ro of roosts) {
        if (ro && ro.pos && ro.pos.distanceToSquared(fl.centroid) < ROOST_RANGE * ROOST_RANGE) { canRoost = true; break; }
      }
      if (!canRoost) fl.calmT = fl.restAfter * 0.6;
    }
    if (fl.mode === 'fly' && canRoost && !ctx.threat) {
      fl.mode = 'settle';
      fl.perchT = 0;
      fl.perchFor = lerp(40, 90, r());
      for (const b of fl.birds) b.landDelay = r() * 7;
    }
    if (fl.mode === 'settle') {
      fl.perchT += dt;
      if (fl.perchT > fl.perchFor) {
        // wanderlust: the whole flock lifts off for another murmuration
        fl.mode = 'fly';
        fl.calmT = 0;
        fl.restAfter = lerp(14, 30, r());
        for (const b of fl.birds) if (b.mode === 'perch' || b.mode === 'land') { b.liftDelay = r() * 2.5; }
      }
    }
    const nb = fl.birds.length;
    for (let i = 0; i < nb; i++) {
      const b = fl.birds[i];
      if (b.liftDelay !== undefined) {
        b.liftDelay -= dt;
        if (b.liftDelay <= 0) { b.liftDelay = undefined; if (b.mode !== 'fly') this._takeOff(b, null); }
      }
      if (b.roost && !roosts.includes(b.roost)) this._takeOff(b, null);
      else if (b.roost && (b.mode === 'perch' || b.mode === 'land')) {
        const info = this._roostInfo.get(b.roost);
        if (info && info.level < 0.55) { b.startle = Math.max(b.startle, 0.4); this._takeOff(b, null); }
      }
      if (fl.mode === 'settle' && b.mode === 'fly' && b.liftDelay === undefined) {
        b.landDelay -= dt;
        if (b.landDelay <= 0 && b.startle < 0.1) {
          if (this._pickPerch(b, roosts, t, dt)) b.mode = 'land';
          else b.landDelay = 2 + r() * 4;
        }
      }
      if (b.mode === 'fly') this._fly(b, fl, dt, ctx, i);
      else if (b.mode === 'land') this._land(b, dt, ctx);
      else this._perch(b, dt, ctx);
    }
  }

  _fly(b, fl, dt, ctx, i) {
    const t = ctx.time;
    const acc = b.acc.set(0, 0, 0);
    // neighbours (every other frame per bird; the result is kept between updates)
    if ((this._frame + b.neighborT) % 2 === 0) {
      b.sep.set(0, 0, 0); b.ali.set(0, 0, 0); b.coh.set(0, 0, 0);
      let na = 0, nc = 0;
      const sepR = 0.9 * b.scale + 0.5;
      // a rotating window of flockmates (topological-ish neighbourhood, bounded cost)
      const L = fl.birds, nL = L.length;
      const win = Math.min(nL, NEIGHBOURS);
      const start = (i * 7 + this._frame * 5) % nL;
      for (let k = 0; k < win; k++) {
        const o = L[(start + k) % nL];
        if (o === b || o.mode !== 'fly') continue;
        const dx = b.pos.x - o.pos.x, dy = b.pos.y - o.pos.y, dz = b.pos.z - o.pos.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > 49) continue;
        if (d2 < sepR * sepR) {
          const d = Math.sqrt(d2) + 1e-3;
          b.sep.x += (dx / d) * (sepR - d) / sepR; b.sep.y += (dy / d) * (sepR - d) / sepR; b.sep.z += (dz / d) * (sepR - d) / sepR;
        }
        if (d2 < 16) { b.ali.add(o.vel); na++; }
        b.coh.x += o.pos.x; b.coh.y += o.pos.y; b.coh.z += o.pos.z; nc++;
      }
      if (na) b.ali.divideScalar(na).sub(b.vel);
      if (nc) b.coh.divideScalar(nc).sub(b.pos); else b.coh.set(0, 0, 0);
    }
    const startle = b.startle;
    acc.addScaledVector(b.sep, 26 * (1 + startle * 2));
    acc.addScaledVector(b.ali, 1.8 * (1 - startle * 0.7));
    acc.addScaledVector(b.coh, 0.9 * (1 - startle));
    // flock target and overall cohesion
    _v.subVectors(fl.target, b.pos);
    const dT = _v.length();
    acc.addScaledVector(_v, (0.25 + Math.max(0, dT - 25) * 0.02) / Math.max(dT, 1) * 6);
    _v.subVectors(fl.centroid, b.pos);
    acc.addScaledVector(_v, 0.22 * (1 - startle));
    // a turning wave ripples through the murmuration
    const along = (b.pos.x - fl.centroid.x) * fl.fwd.x + (b.pos.z - fl.centroid.z) * fl.fwd.z;
    const wave = Math.sin(t * 1.1 - along * 0.18) * Math.sin(t * 0.23 + fl.a[3]);
    acc.x += -fl.fwd.z * wave * 2.2;
    acc.z += fl.fwd.x * wave * 2.2;
    acc.y += Math.sin(t * 0.9 - along * 0.12) * 0.8;
    // threats and shocks
    if (ctx.threat) {
      _v.subVectors(b.pos, ctx.threat);
      const d = _v.length();
      if (d < 70) acc.addScaledVector(_v, (70 - d) / 70 * 30 / Math.max(d, 1));
    }
    if (b.kick.lengthSq() > 0.01) {
      acc.addScaledVector(b.kick, 3);
      b.kick.multiplyScalar(Math.exp(-dt * 3));
    }
    for (const m of ctx.movers) {
      _v.set(b.pos.x - m.x, b.pos.y - m.y, b.pos.z - m.z);
      const d = _v.length();
      const min = m.w + 3;
      if (d < min && d > 1e-3 && b.mode === 'fly') acc.addScaledVector(_v, (min - d) / min * 18 / d);
    }
    if (b.pos.y < ctx.floorY) acc.y += (ctx.floorY - b.pos.y) * 0.5;
    // limit acceleration, integrate, regulate speed
    const al = acc.length();
    const amax = 16 + startle * 14;
    if (al > amax) acc.multiplyScalar(amax / al);
    b.vel.addScaledVector(acc, dt);
    const sp = b.vel.length();
    const vmin = 5, vmax = 10.5 + startle * 5;
    if (sp > vmax) b.vel.multiplyScalar(vmax / sp);
    else if (sp < vmin) b.vel.multiplyScalar(vmin / Math.max(sp, 1e-3));
    b.pos.addScaledVector(b.vel, dt);
    b.startle = Math.max(0, b.startle - dt * 0.25);
    // flight attitude from velocity and lateral acceleration
    const fwd = _v.copy(b.vel).normalize();
    const lat = acc.dot(_v2.crossVectors(UP, fwd).normalize());
    this._orient(b, fwd, clamp(lat / 12, -1.1, 1.1), dt, 0);
    // bounding flight: flap bursts, folded glides; flap hard when climbing or startled
    const effort = clamp(fwd.y * 2 + startle + (sp < 7 ? 0.4 : 0), 0, 1);
    b.boundT -= dt;
    if (b.boundT <= 0) {
      b.bounding = !b.bounding && effort < 0.5;
      b.boundT = b.bounding ? lerp(0.18, 0.32, Math.random()) : lerp(0.45, 0.9, Math.random());
    }
    const foldT = b.bounding ? 0.85 : 0;
    b.fold += (foldT - b.fold) * (1 - Math.exp(-dt * 14));
    const ampT = b.bounding ? 0 : 0.85 + effort * 0.35;
    b.amp += (ampT - b.amp) * (1 - Math.exp(-dt * 10));
    b.phase += TAU * (6.5 + effort * 3) * dt / Math.sqrt(b.scale);
    b.headYaw += (0 - b.headYaw) * (1 - Math.exp(-dt * 4));
    b.tilt += (0 - b.tilt) * (1 - Math.exp(-dt * 4));
    b.tailLift += (0 - b.tailLift) * (1 - Math.exp(-dt * 4));
    b.hop = 0;
  }

  _land(b, dt, ctx) {
    const info = this._roostFrame(b.roost, dt, ctx.time);
    const tgt = this._perchPos(b, info, _v3);
    // approach from above and behind, matching the whale's motion, flaring at the end
    _v.subVectors(tgt, b.pos);
    const d = _v.length();
    const approach = _v2.copy(info.up).multiplyScalar(Math.min(d * 0.25, 4));
    _v.add(approach);
    const want = _v.normalize().multiplyScalar(Math.min(9, d * 1.3 + 0.4)).add(info.vel);
    const dv = want.sub(b.vel);
    const amax = 14;
    if (dv.length() > amax * dt) dv.setLength(amax * dt);
    b.vel.add(dv);
    b.pos.addScaledVector(b.vel, dt);
    const rel = _v.subVectors(b.vel, info.vel);
    const relSp = rel.length();
    const fwd = relSp > 0.5 ? _v2.copy(rel).normalize() : _v2.copy(info.fwd);
    const flare = 1 - smoothstep(0.5, 4, d);
    this._orient(b, fwd, 0, dt, flare * 0.9);
    b.fold += (0 - b.fold) * (1 - Math.exp(-dt * 10));
    b.amp += (0.9 + flare * 0.4 - b.amp) * (1 - Math.exp(-dt * 8));
    b.phase += TAU * (7 + flare * 3) * dt / Math.sqrt(b.scale);
    b.tailLift += (flare * 0.5 - b.tailLift) * (1 - Math.exp(-dt * 6));
    if (d < 0.3 + 0.1 * b.scale) {
      b.mode = 'perch';
      b.headT = 0.5;
      b.hopT = lerp(4, 12, Math.random());
      // touch down: the last few centimetres settle smoothly instead of snapping
      b.snap.subVectors(b.pos, tgt);
    }
  }

  _perch(b, dt, ctx) {
    const info = this._roostFrame(b.roost, dt, ctx.time);
    this._perchPos(b, info, b.pos);
    b.snap.multiplyScalar(Math.exp(-dt * 7));
    b.pos.add(b.snap);
    b.vel.copy(info.vel);
    // sit facing (mostly) along the whale, body tilted up a little; turn smoothly into place
    _m.makeBasis(info.right, info.up, info.fwd);
    _q.setFromRotationMatrix(_m);
    _e.set(-0.35, b.perchYaw, 0, 'YXZ');
    _q.multiply(_q2.setFromEuler(_e));
    b.quat.slerp(_q, 1 - Math.exp(-dt * 9));
    // idle life: look around, hop, flutter, preen
    b.headT -= dt;
    if (b.headT <= 0) {
      b.headT = lerp(0.6, 2.8, Math.random());
      b.headYawT = (Math.random() - 0.5) * 2.2;
      b.tiltT = (Math.random() - 0.5) * 0.6;
    }
    b.headYaw += (b.headYawT - b.headYaw) * (1 - Math.exp(-dt * 9));
    b.tilt += ((b.tiltT || 0) - b.tilt) * (1 - Math.exp(-dt * 7));
    b.hopT -= dt;
    if (b.hopT <= 0) {
      b.hopT = lerp(5, 16, Math.random());
      b.hopPh = 0;
      if (Math.random() < 0.5) b.flutter = 0.45;
      b.perchYaw += (Math.random() - 0.5) * 0.9;
    }
    if (b.hopPh !== undefined) {
      b.hopPh += dt * 4;
      b.hop = Math.sin(Math.min(b.hopPh, 1) * Math.PI) * 0.12 * b.scale;
      if (b.hopPh >= 1) { b.hopPh = undefined; b.hop = 0; }
    }
    b.flutter = Math.max(0, b.flutter - dt);
    const fl = b.flutter > 0;
    b.fold += ((fl ? 0.35 : 1) - b.fold) * (1 - Math.exp(-dt * 12));
    b.amp += ((fl ? 0.6 : 0) - b.amp) * (1 - Math.exp(-dt * 12));
    b.phase += TAU * 9 * dt;
    b.tailLift += (0.15 + Math.sin(ctx.time * 0.7 + b.seed) * 0.08 - b.tailLift) * (1 - Math.exp(-dt * 4));
    // something big coming? (whales nearby are fine: they are the roost)
    if (ctx.threat && ctx.threat.distanceToSquared(b.pos) < 90 * 90) this._alarm(b.flock, ctx.threat);
  }

  _orient(b, fwd, bankT, dt, flare) {
    const yaw = Math.atan2(fwd.x, fwd.z);
    let pitch = Math.asin(clamp(fwd.y, -1, 1));
    pitch += flare;
    b.roll += (-bankT - b.roll) * (1 - Math.exp(-dt * 8));
    b.pitch += (pitch - b.pitch) * (1 - Math.exp(-dt * 10));
    _e.set(-b.pitch, yaw, b.roll, 'YXZ');
    _q.setFromEuler(_e);
    b.quat.slerp(_q, 1 - Math.exp(-dt * 14));
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
