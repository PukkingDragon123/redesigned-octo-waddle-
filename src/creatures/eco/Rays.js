// Sky rays: manta-like flyers (3-8 m span) with a smooth membrane, rolled cephalic lobes that
// unfurl to feed, a long whip tail and trailing wingtip ribbons. A travelling wave runs out
// through the wings (vertex shader); flap bouts alternate with long glides. Schools cruise,
// make feeding passes through krill swarms, arc and leap through clouds, circle singing
// whales and flee threats.
import {
  Mesh, ShaderMaterial, InstancedBufferAttribute, DynamicDrawUsage, Vector3, Vector4, Quaternion, Euler, FrontSide,
} from 'three';
import { G } from '../../render/Globals.js';
import { UNIFORMS, NOISE, SHADOW, LIGHTING } from '../../render/shaders/common.js';
import { ECO_GLSL, ECO_VERT_GLSL, RAY_PALETTES, paletteUniforms } from './shaderlib.js';
import { buildRayGeometry, RAY_SHAPE } from './geometry.js';
import { rng, lerp, clamp, smoothstep, wrapAngle } from '../../core/math.js';

const MAX_RAYS = 96;
const DORMANT_DIST = 1600;
const TAU = Math.PI * 2;

const RAY_VERT = /* glsl */ `
${UNIFORMS}
${ECO_GLSL}
${ECO_VERT_GLSL}
attribute vec4 aRay;
attribute vec4 aRPos;   // xyz, half-span (m)
attribute vec4 aRQuat;
attribute vec4 aRAnim;  // flap phase, flap amplitude, path curvature (1/m), feed 0..1
attribute vec4 aRSeed;  // seed, palette, speed, startle
uniform vec4 uRShape;   // tail length, ribbon length, wingtip z, wingtip y (local units)
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec4 vRay;
varying vec3 vLocal;
varying float vPal;
varying float vCov;
varying float vSeed;
varying float vFeed;

float flapBend(float a, float c, float phase, float amp) {
  float w = smoothstep(0.08, 0.95, a);
  return amp * 0.62 * sin(phase - a * 1.7 - c * 0.8) * w * (0.3 + 0.7 * a);
}
// Bend a wing point about the body edge: each span station rotates by its own angle, so the
// wing curls like a membrane rather than hinging like a plate.
vec3 bendWing(vec3 p, float c, float phase, float amp, float seedT, out float beta) {
  float a = abs(p.x);
  float side = p.x < 0.0 ? -1.0 : 1.0;
  beta = flapBend(a, c, phase, amp);
  beta += 0.035 * sin(seedT * 1.9 - a * 4.5) * smoothstep(0.2, 1.0, a) * (0.4 + 0.6 * c);
  float a0 = 0.1;
  if (a > a0) {
    float rel = a - a0;
    float cb = cos(beta), sb = sin(beta);
    vec2 q = vec2(rel * cb - p.y * sb, rel * sb + p.y * cb);
    p.x = side * (a0 + q.x);
    p.y = q.y;
  } else beta = 0.0;
  return p;
}
vec3 tailPoint(float t, float phase, float amp, float curvL, float seedT) {
  float s = t * uRShape.x;
  float sway = 0.05 * sin(seedT * 1.4 - t * 5.5) * t;
  float lag = 0.08 * amp * sin(phase - 1.4 - t * 2.6) * t;
  return vec3(sway + 0.5 * curvL * s * s, -0.012 + lag - 0.05 * t * t, -0.44 - s);
}
vec3 ribbonPoint(float t, float wing, float phase, float amp, float curvL, float seedT) {
  float b;
  vec3 tip = vec3(wing, uRShape.w, uRShape.z);
  vec3 r = bendWing(tip, 0.95, phase - t * 2.4, amp, seedT - t * 1.2, b);
  float s = t * uRShape.y;
  r += vec3(wing * 0.05 * t + 0.5 * curvL * s * s + 0.035 * sin(seedT * 2.6 - t * 7.0) * t,
            -0.07 * t * t + 0.03 * sin(seedT * 2.1 - t * 6.0 + wing) * t,
            -s);
  return r;
}
void main() {
  float part = aRay.x;
  float scale = aRPos.w;
  float phase = aRAnim.x, amp = aRAnim.y;
  float curvL = aRAnim.z * scale;
  float seedT = uTime + aRSeed.x * 30.0;
  float bob = -0.03 * amp * cos(phase);
  vec3 wp;
  vec3 n;
  float cov = 1.0;
  if (part < 0.5) {
    float beta;
    vec3 p = bendWing(position, aRay.z, phase, amp, seedT, beta);
    float side = position.x < 0.0 ? -1.0 : 1.0;
    n = normal;
    float nxa = n.x * side;
    float cb = cos(beta), sb = sin(beta);
    n = vec3(side * (nxa * cb - n.y * sb), nxa * sb + n.y * cb, n.z);
    p.y += bob;
    wp = aRPos.xyz + qrot(aRQuat, p * scale);
    n = qrot(aRQuat, n);
  } else if (part < 1.5) {
    float t = aRay.y, ac = aRay.z, sd = aRay.w < 0.0 ? -1.0 : 1.0;
    float L = 0.13;
    float curl = mix(2.8, 0.55, aRAnim.w) + 0.18 * sin(seedT * 1.3 + sd);
    float k = curl / L;
    float ang = k * t * L;
    vec3 root = vec3(sd * 0.1 + ac * 0.024, 0.006, 0.37);
    vec3 p = root + vec3(sd * 0.02 * aRAnim.w * t, -(1.0 - cos(ang)) / k, sin(ang) / k);
    p.y += bob;
    n = vec3(0.0, cos(ang), sin(ang));
    wp = aRPos.xyz + qrot(aRQuat, p * scale);
    n = qrot(aRQuat, n);
  } else {
    float t = aRay.y, side = aRay.z;
    vec3 c0, c1;
    float hw;
    if (part < 2.5) {
      c0 = tailPoint(t, phase, amp, curvL, seedT);
      c1 = tailPoint(t + 0.02, phase, amp, curvL, seedT);
      hw = mix(0.017, 0.0022, pow(t, 0.75)) * scale;
    } else {
      c0 = ribbonPoint(t, aRay.w, phase, amp, curvL, seedT);
      c1 = ribbonPoint(t + 0.02, aRay.w, phase, amp, curvL, seedT);
      hw = mix(0.014, 0.006, t) * scale;
    }
    c0.y += bob; c1.y += bob;
    vec3 P = aRPos.xyz + qrot(aRQuat, c0 * scale);
    vec3 T = normalize(qrot(aRQuat, c1 - c0));
    vec3 across;
    #ifdef DEPTH_PASS
      across = normalize(cross(T, qrot(aRQuat, vec3(0.0, 1.0, 0.0))) + 1e-4);
      wp = P + across * hw * side * 1.5;
    #else
      wp = P + stripOffset(P, T, hw, side, 0.9, cov, across);
    #endif
    vec3 V = normalize(uCamPos - P);
    if (part < 2.5) n = normalize(across * side * 0.85 + V * 0.55);
    else n = normalize(qrot(aRQuat, vec3(0.0, 1.0, 0.0)) * (0.8 + 0.2 * sin(t * 9.0 + seedT * 2.0)) + across * 0.3 * sin(t * 7.0 - seedT));
  }
  vWorldPos = wp;
  vNormal = n;
  vRay = aRay;
  vLocal = position;
  vPal = aRSeed.y;
  vCov = cov;
  vSeed = aRSeed.x;
  vFeed = aRAnim.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const RAY_FRAG = /* glsl */ `
${UNIFORMS}
${NOISE}
${SHADOW}
${LIGHTING}
uniform vec3 uRTop[4];
uniform vec3 uRBelly[4];
uniform vec3 uRMargin[4];
uniform vec3 uRRibbon[4];
uniform vec3 uRMark[4];
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec4 vRay;
varying vec3 vLocal;
varying float vPal;
varying float vCov;
varying float vSeed;
varying float vFeed;
void main() {
  #ifdef DEPTH_PASS
    gl_FragColor = vec4(1.0);
    return;
  #endif
  int pi = int(clamp(floor(vPal), 0.0, 3.0));
  vec3 top = uRTop[pi], belly = uRBelly[pi], margin = uRMargin[pi], ribbon = uRRibbon[pi], mark = uRMark[pi];
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(uCamPos - vWorldPos);
  float part = vRay.x;
  vec3 albedo;
  float trans = 0.3, spec = 0.2, rim = 0.55, alpha = 1.0, ao = 1.0, wrap = 0.22;
  if (part < 0.5) {
    float a = vRay.y, c = vRay.z;
    vec3 L = vLocal;
    float topW = smoothstep(-0.3, 0.3, vRay.w);
    // thin translucent membrane along the trailing margin and out at the wingtips
    float mem = clamp(smoothstep(0.62, 0.98, c) * smoothstep(0.2, 0.7, a) + smoothstep(0.86, 1.0, a) * 0.6, 0.0, 1.0);
    vec3 dors = mix(top, margin, mem * 0.75);
    // body form: a slightly darker spine, lighter wing shoulders
    dors *= mix(0.86, 1.0, smoothstep(0.02, 0.2, a));
    dors = mix(dors, mix(top, margin, 0.3), smoothstep(0.2, 0.55, a) * smoothstep(0.9, 0.5, a) * 0.35);
    // pale shoulder bands: two soft diagonal strokes from behind the head out onto the wings
    vec2 q0 = vec2(0.09, 0.2), q1 = vec2(0.4, -0.02);
    vec2 pq = vec2(a, L.z) - q0, dq = q1 - q0;
    float hq = clamp(dot(pq, dq) / dot(dq, dq), 0.0, 1.0);
    float dl = length(pq - dq * hq);
    float band = smoothstep(0.1, 0.0, dl) * smoothstep(0.0, 0.35, hq) * (1.0 - hq * 0.6);
    dors = mix(dors, mark, band * 0.16);
    // hand-painted value variation
    dors *= 0.94 + 0.12 * fbm2(vec2(a * 3.0, L.z * 3.0) + vSeed);
    // light catches the leading edge; the trailing membrane is a touch deeper
    dors *= mix(1.06, 0.93, smoothstep(0.1, 0.9, c));
    // a few soft freckles near the back, fine radiating fin rays on the wings
    vec2 cell = vec2(a * 14.0, L.z * 14.0 + 0.5);
    vec2 cid = floor(cell);
    vec2 cf = fract(cell) - 0.5 - (hash22(cid + vSeed * 3.0) - 0.5) * 0.5;
    float frk = smoothstep(0.16, 0.08, length(cf)) * step(0.82, hash12(cid + 7.0 + vSeed)) * smoothstep(0.42, 0.18, a) * smoothstep(-0.25, -0.05, L.z);
    dors = mix(dors, mark, frk * 0.2);
    float fin = smoothstep(0.6, 1.0, sin(atan(L.z + 0.12, a + 0.02) * 44.0)) * smoothstep(0.3, 0.7, a);
    dors *= 1.0 - fin * 0.05;
    // belly: cream with a blush toward the margin, gill slits and the mouth
    vec3 bel = mix(belly, mix(belly, margin, 0.6), smoothstep(0.42, 1.0, a) * 0.85 + smoothstep(0.7, 1.0, c) * 0.25);
    float gz = (L.z - 0.06) / 0.036;
    float gill = smoothstep(0.16, 0.0, abs(fract(gz) - 0.5) - 0.25) * step(0.0, gz) * step(gz, 5.0) * smoothstep(0.06, 0.08, a) * smoothstep(0.17, 0.15, a);
    bel *= 1.0 - gill * 0.3;
    float mouth = smoothstep(0.1, 0.085, a) * smoothstep(0.345, 0.375, L.z) * (0.45 + 0.55 * vFeed);
    bel = mix(bel, vec3(0.22, 0.12, 0.16), mouth);
    albedo = mix(bel, dors, topW);
    // eyes on the sides of the head
    float eye = smoothstep(0.022, 0.014, length(vec2((a - 0.128) * 1.2, L.z - 0.315)));
    albedo = mix(albedo, vec3(0.04, 0.04, 0.06), eye);
    spec += eye * 1.2;
    trans = mix(0.15, 1.7, mem) * (1.0 - eye);
    ao = mix(0.8, 1.0, topW) * mix(0.9, 1.0, smoothstep(0.05, 0.25, a));
    wrap = 0.24;
  } else if (part < 1.5) {
    albedo = mix(top, margin, 0.45);
    trans = 0.9;
    rim = 0.7;
    if (dot(N, V) < 0.0) N = -N;
  } else if (part < 2.5) {
    albedo = top * 0.9;
    spec = 0.25;
    trans = 0.4;
    alpha = vCov;
  } else {
    float t = vRay.y;
    albedo = mix(ribbon, mix(ribbon, vec3(1.0), 0.4), t);
    trans = 1.8;
    rim = 0.85;
    wrap = 0.35;
    alpha = vCov * (1.0 - smoothstep(0.7, 1.0, t));
    if (dot(N, V) < 0.0) N = -N;
  }
  Surface s = makeSurface(albedo, N, vWorldPos);
  s.shadow = sampleShadow(vWorldPos, N);
  s.rim = rim;
  s.spec = spec;
  s.gloss = 0.8;
  s.trans = trans;
  s.wrap = wrap;
  s.ao = ao;
  vec3 col = stylizedLight(s);
  col = applyFog(col, vWorldPos);
  gl_FragColor = vec4(col, alpha);
}
`;

const _e = new Euler(0, 0, 0, 'YXZ');
const _v = new Vector3();
const _v2 = new Vector3();
const _d = new Vector3();

export class RaySystem {
  constructor(eco) {
    this.eco = eco;
    this.game = eco.game;
    this.rays = [];
    this.schools = [];
    this._seed = 301;
    this.aPos = new InstancedBufferAttribute(new Float32Array(MAX_RAYS * 4), 4).setUsage(DynamicDrawUsage);
    this.aQuat = new InstancedBufferAttribute(new Float32Array(MAX_RAYS * 4), 4).setUsage(DynamicDrawUsage);
    this.aAnim = new InstancedBufferAttribute(new Float32Array(MAX_RAYS * 4), 4).setUsage(DynamicDrawUsage);
    this.aSeed = new InstancedBufferAttribute(new Float32Array(MAX_RAYS * 4), 4).setUsage(DynamicDrawUsage);
    this._attrs = [this.aPos, this.aQuat, this.aAnim, this.aSeed];
    const geo = buildRayGeometry();
    geo.setAttribute('aRPos', this.aPos);
    geo.setAttribute('aRQuat', this.aQuat);
    geo.setAttribute('aRAnim', this.aAnim);
    geo.setAttribute('aRSeed', this.aSeed);
    geo.instanceCount = 0;
    const pal = paletteUniforms(RAY_PALETTES, ['top', 'belly', 'margin', 'ribbon', 'mark']);
    this.material = new ShaderMaterial({
      vertexShader: RAY_VERT,
      fragmentShader: RAY_FRAG,
      uniforms: Object.assign({}, G, {
        uRShape: { value: new Vector4(RAY_SHAPE.tailLen, RAY_SHAPE.ribbonLen, RAY_SHAPE.te(1) + 0.004, RAY_SHAPE.camber(1)) },
        uRTop: { value: pal.top },
        uRBelly: { value: pal.belly },
        uRMargin: { value: pal.margin },
        uRRibbon: { value: pal.ribbon },
        uRMark: { value: pal.mark },
      }),
      side: FrontSide,
    });
    this.material.alphaToCoverage = true;
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'sky-rays';
    this.mesh.visible = false;
    this.game.engine.scene.add(this.mesh);
    this.game.engine.shadows?.addCaster(this.mesh);
    this._rr = 0;
  }

  addSchool(center, count = 6, opts = {}) {
    count = Math.max(1, Math.min(Math.round(count), MAX_RAYS - this.rays.length));
    if (count <= 0) return null;
    const r = rng(opts.seed ?? (this._seed += 13));
    const span = opts.span ?? [3, 8];
    const sc = {
      kind: 'rays',
      home: center.clone(),
      anchor: opts.anchor || null,
      anchorOffset: opts.anchor ? center.clone().sub(opts.anchor) : null,
      leash: opts.leash ?? 260,
      rays: [],
      mode: 'cruise',
      modeT: 0,
      lead: center.clone(),
      leadYaw: r() * TAU,
      leadPitch: 0,
      leadYawRate: 0,
      leadSpeed: 6.5,
      leadFwd: new Vector3(),
      goal: new Vector3(),
      wander: r() * TAU,
      wanderRate: lerp(0.025, 0.05, r()) * (r() < 0.5 ? -1 : 1),
      wanderR: lerp(0.35, 0.6, r()),
      feedT: opts.feed === false ? Infinity : lerp(4, 14, r()),
      leapT: opts.leap === false ? Infinity : lerp(14, 30, r()),
      fleeT: 0,
      fleeFrom: new Vector3(),
      circleA: 0,
      circleDir: r() < 0.5 ? 1 : -1,
      wps: [],
      wpi: 0,
      ref: null,
      passes: 0,
      palette: opts.palette ?? Math.floor(r() * RAY_PALETTES.length),
      rng: r,
    };
    const spacing = lerp(span[0], span[1], 0.5) * 1.15;
    for (let i = 0; i < count; i++) {
      const spanM = lerp(span[0], span[1], Math.pow(r(), 1.4)) * (i === 0 ? 1.12 : 1);
      const k = Math.ceil(i / 2), side = i % 2 ? 1 : -1;
      const off = new Vector3(side * k * spacing * lerp(0.75, 1.05, r()), lerp(-2.5, 2.5, r()) - k * 0.6, -k * spacing * lerp(0.6, 0.9, r()));
      const ray = {
        school: sc,
        idx: i,
        off,
        pos: center.clone().add(_v.copy(off).applyAxisAngle(new Vector3(0, 1, 0), sc.leadYaw)),
        yaw: sc.leadYaw + (r() - 0.5) * 0.2,
        pitch: 0,
        roll: 0,
        yawRate: 0,
        speed: 6.5,
        scale: spanM / 2,
        phase: r() * TAU,
        amp: 0.1,
        boutT: r() * 2,
        glideT: lerp(2, 7, r()),
        feed: 0,
        seed: r() * 10,
        palette: sc.palette === 'mixed' ? Math.floor(r() * RAY_PALETTES.length) : sc.palette,
        quat: new Quaternion(),
        fwd: new Vector3(0, 0, 1),
        wob: [r() * TAU, r() * TAU, r() * TAU],
        cloudD: 0,
        mouth: new Vector3(),
        mouthPrev: new Vector3(),
        mouthOk: false,
        startle: 0,
        kick: new Vector3(),
      };
      sc.rays.push(ray);
      this.rays.push(ray);
    }
    this.schools.push(sc);
    return sc;
  }

  clear() {
    this.rays.length = 0;
    this.schools.length = 0;
    this.mesh.geometry.instanceCount = 0;
    this.mesh.visible = false;
  }

  prune(center, r2) {
    for (const sc of this.schools.slice()) {
      if (sc.home.distanceToSquared(center) <= r2) continue;
      this.schools.splice(this.schools.indexOf(sc), 1);
      for (const ray of sc.rays) this.rays.splice(this.rays.indexOf(ray), 1);
    }
  }

  /** Feeding rays scare krill around their mouths. */
  pushPredators(P) {
    for (const ray of this.rays) {
      if (ray.feed < 0.3) continue;
      const q = ray.pred || (ray.pred = { x: 0, y: 0, z: 0, r: 0, s: 0.7, vx: 0, vy: 0, vz: 0 });
      q.x = ray.mouth.x + ray.fwd.x * ray.scale * 0.6;
      q.y = ray.mouth.y + ray.fwd.y * ray.scale * 0.6;
      q.z = ray.mouth.z + ray.fwd.z * ray.scale * 0.6;
      q.r = 1.8 + ray.scale * 0.9;
      q.vx = ray.fwd.x * ray.speed; q.vy = ray.fwd.y * ray.speed; q.vz = ray.fwd.z * ray.speed;
      P.push(q);
    }
  }

  shock(c, rIn, rOut, radius, strength) {
    for (const sc of this.schools) {
      let hit = false;
      for (const ray of sc.rays) {
        const d = ray.pos.distanceTo(c);
        if (d < rIn || d >= rOut || d > radius) continue;
        const k = (1 - d / radius) * strength;
        ray.kick.subVectors(ray.pos, c).normalize().multiplyScalar(k * 7);
        ray.startle = Math.min(1, ray.startle + k * 1.5);
        ray.boutT = Math.max(ray.boutT, 2.5);
        hit = true;
      }
      if (hit) {
        sc.fleeT = Math.max(sc.fleeT, 3 + strength * 2);
        sc.fleeFrom.copy(c);
      }
    }
  }

  // ---- behaviour --------------------------------------------------------------------------
  _setMode(sc, mode, ctx) {
    sc.mode = mode;
    sc.modeT = 0;
    sc.wps.length = 0;
    sc.wpi = 0;
    sc.ref = null;
    const r = sc.rng;
    if (mode === 'feed') {
      const ns = this.eco.krill.nearest(sc.lead);
      if (!ns || ns.dist > 280) { sc.mode = 'cruise'; return; }
      sc.ref = ns.swarm;
      sc.passes = 2 + Math.floor(r() * 2);
      this._planPass(sc);
    } else if (mode === 'leap') {
      // a cloud near the school: dive under its base, burst up through it, glide down beyond
      let best = null, bd = 420;
      for (const cl of this.game.clouds.clusters) {
        if (cl.kind === 'sheet') continue;
        const c = _v.copy(cl.center).add(ctx.drift);
        const d = c.distanceTo(sc.lead);
        if (d < bd && cl.radius < 160 && d > cl.radius * 0.5) { bd = d; best = cl; }
      }
      if (!best) { sc.mode = 'cruise'; sc.leapT = lerp(20, 40, r()); return; }
      sc.ref = best;
      const c = _v.copy(best.center).add(ctx.drift);
      const dir = _d.subVectors(c, sc.lead).setY(0).normalize();
      const R = Math.max(best.radius * 0.55, 20);
      const lowY = c.y - R * 0.55 - 6;
      const topY = c.y + R * 0.6 + 14;
      sc.wps = [
        { off: new Vector3(-dir.x * R * 1.3, lowY - c.y, -dir.z * R * 1.3), r: 14 },
        { off: new Vector3(-dir.x * R * 0.25, -R * 0.2, -dir.z * R * 0.25), r: 10 },
        { off: new Vector3(dir.x * R * 0.35, topY - c.y, dir.z * R * 0.35), r: 12 },
        { off: new Vector3(dir.x * R * 1.6, topY - c.y - 6, dir.z * R * 1.6), r: 16 },
        { off: new Vector3(dir.x * R * 2.6, sc.home.y - c.y, dir.z * R * 2.6), r: 20 },
      ];
    }
  }

  _planPass(sc) {
    const r = sc.rng;
    const sw = sc.ref;
    const dir = _d.subVectors(sw.center, sc.lead).setY(0);
    if (dir.lengthSq() < 1) dir.set(Math.cos(sc.leadYaw), 0, Math.sin(sc.leadYaw));
    dir.normalize().applyAxisAngle(_v2.set(0, 1, 0), (r() - 0.5) * 0.8);
    const L = sw.extent + 22;
    const side = new Vector3(-dir.z, 0, dir.x).multiplyScalar((r() - 0.5) * sw.R * 0.6);
    sc.wps = [
      { off: dir.clone().multiplyScalar(-L).add(side).setY(lerp(-4, 6, r())), r: 12, swarm: true },
      { off: side.clone().setY(lerp(-2, 2, r())), r: 6, swarm: true, feed: true },
      { off: dir.clone().multiplyScalar(L).add(side).setY(lerp(-3, 8, r())), r: 14, swarm: true },
    ];
    sc.wpi = 0;
  }

  _goal(sc, ctx, out) {
    const wp = sc.wps[sc.wpi];
    if (!wp) return null;
    if (sc.mode === 'feed') out.copy(sc.ref.center).add(wp.off);
    else out.copy(sc.ref.center).add(ctx.drift).add(wp.off);
    return wp;
  }

  _updateSchool(sc, dt, ctx) {
    const r = sc.rng;
    if (sc.anchor) sc.home.copy(sc.anchor).add(sc.anchorOffset);
    sc.modeT += dt;
    sc.feedT -= dt;
    sc.leapT -= dt;
    sc.fleeT -= dt;
    // decide what the school is doing
    if (ctx.threat && ctx.threat.distanceTo(sc.lead) < 170) {
      sc.fleeT = Math.max(sc.fleeT, 4);
      sc.fleeFrom.copy(ctx.threat);
    }
    const F = ctx.songFocus;
    if (sc.fleeT > 0) {
      if (sc.mode !== 'flee') this._setMode(sc, 'flee', ctx);
    } else if (F && F.distanceTo(sc.lead) < 340) {
      if (sc.mode !== 'circle') {
        this._setMode(sc, 'circle', ctx);
        _v.subVectors(sc.lead, F);
        sc.circleA = Math.atan2(_v.z, _v.x);
        // circle the same way the school is already turning
        const tang = new Vector3(-Math.sin(sc.circleA), 0, Math.cos(sc.circleA));
        sc.circleDir = tang.dot(sc.leadFwd) >= 0 ? 1 : -1;
      }
    } else if (sc.mode === 'flee' || sc.mode === 'circle') {
      this._setMode(sc, 'cruise', ctx);
    } else if (sc.mode === 'cruise') {
      if (sc.feedT <= 0) {
        sc.feedT = lerp(30, 55, r());
        this._setMode(sc, 'feed', ctx);
      } else if (sc.leapT <= 0) {
        sc.leapT = lerp(35, 70, r());
        this._setMode(sc, 'leap', ctx);
      }
    }
    // leader goal
    const goal = sc.goal;
    let speed = 6.5, maxYaw = 0.42;
    if (sc.mode === 'cruise') {
      sc.wander += sc.wanderRate * dt;
      const R = sc.leash * sc.wanderR;
      goal.set(sc.home.x + Math.cos(sc.wander) * R, sc.home.y + Math.sin(sc.wander * 1.7) * 14, sc.home.z + Math.sin(sc.wander) * R);
      // aim a little ahead along the wander circle
      goal.x += -Math.sin(sc.wander) * 40 * Math.sign(sc.wanderRate);
      goal.z += Math.cos(sc.wander) * 40 * Math.sign(sc.wanderRate);
    } else if (sc.mode === 'feed') {
      speed = 7.5;
      maxYaw = 0.6;
      if (!this.eco.krill.swarms.includes(sc.ref)) this._setMode(sc, 'cruise', ctx);
      else {
        const wp = this._goal(sc, ctx, goal);
        if (wp && goal.distanceTo(sc.lead) < wp.r) {
          sc.wpi++;
          if (sc.wpi >= sc.wps.length) {
            sc.passes--;
            if (sc.passes > 0) this._planPass(sc);
            else this._setMode(sc, 'cruise', ctx);
          }
        }
        if (sc.mode === 'feed') this._goal(sc, ctx, goal);
        if (sc.modeT > 70) this._setMode(sc, 'cruise', ctx);
      }
    } else if (sc.mode === 'leap') {
      speed = sc.wpi <= 2 ? 10.5 : 8;
      maxYaw = 0.55;
      const wp = this._goal(sc, ctx, goal);
      if (!wp || sc.modeT > 50) this._setMode(sc, 'cruise', ctx);
      else if (goal.distanceTo(sc.lead) < wp.r) {
        sc.wpi++;
        if (sc.wpi >= sc.wps.length) this._setMode(sc, 'cruise', ctx);
      }
    } else if (sc.mode === 'circle') {
      const R = ctx.songRadius + 18;
      speed = 7;
      sc.circleA += (sc.circleDir * speed) / R * dt;
      goal.set(F.x + Math.cos(sc.circleA + sc.circleDir * 0.5) * R, F.y + 8 + Math.sin(sc.modeT * 0.3) * 3, F.z + Math.sin(sc.circleA + sc.circleDir * 0.5) * R);
      maxYaw = 0.7;
    } else if (sc.mode === 'flee') {
      speed = 12.5;
      maxYaw = 0.9;
      _v.subVectors(sc.lead, sc.fleeFrom).setY(0);
      if (_v.lengthSq() < 1) _v.set(1, 0, 0);
      goal.copy(sc.lead).addScaledVector(_v.normalize(), 120);
      goal.y = Math.max(sc.home.y - 20, Math.min(sc.home.y + 30, sc.lead.y + 10));
    }
    if (sc.mode === 'cruise' && sc.lead.distanceTo(sc.home) > sc.leash) goal.copy(sc.home);
    // leader kinematics (heading with limited turn rate: graceful arcs)
    _d.subVectors(goal, sc.lead);
    const yawT = Math.atan2(_d.x, _d.z);
    const pitchT = clamp(Math.atan2(_d.y, Math.hypot(_d.x, _d.z)), -0.42, 0.42);
    const yErr = wrapAngle(yawT - sc.leadYaw);
    sc.leadYawRate += (clamp(yErr * 0.9, -maxYaw, maxYaw) - sc.leadYawRate) * (1 - Math.exp(-dt * 1.2));
    sc.leadYaw = wrapAngle(sc.leadYaw + sc.leadYawRate * dt);
    sc.leadPitch += (pitchT - sc.leadPitch) * (1 - Math.exp(-dt * 0.8));
    sc.leadSpeed += (speed - sc.leadSpeed) * (1 - Math.exp(-dt * 0.5));
    const cp = Math.cos(sc.leadPitch);
    sc.leadFwd.set(Math.sin(sc.leadYaw) * cp, Math.sin(sc.leadPitch), Math.cos(sc.leadYaw) * cp);
    sc.lead.addScaledVector(sc.leadFwd, sc.leadSpeed * dt);
    // keep above the cloud sea
    const floor = ctx.floorY + 5;
    if (sc.lead.y < floor) sc.lead.y += (floor - sc.lead.y) * (1 - Math.exp(-dt * 0.5));
  }

  _updateRay(ray, dt, ctx) {
    const sc = ray.school;
    const t = ctx.time;
    // where this ray wants to be
    const T = _v;
    if (sc.mode === 'circle' && ctx.songFocus) {
      const F = ctx.songFocus;
      const n = sc.rays.length;
      const R = ctx.songRadius + 14 + (ray.idx % 3) * 5;
      const a = sc.circleA - sc.circleDir * ray.idx * ((TAU * 0.75) / Math.max(n, 1));
      T.set(F.x + Math.cos(a) * R, F.y + 6 + ((ray.idx % 4) - 1.5) * 3 + Math.sin(t * 0.4 + ray.seed) * 2, F.z + Math.sin(a) * R);
      // aim a little ahead on the circle
      T.x += -Math.sin(a) * sc.circleDir * 8;
      T.z += Math.cos(a) * sc.circleDir * 8;
    } else {
      const cy = Math.cos(sc.leadYaw), sy = Math.sin(sc.leadYaw);
      const o = ray.off;
      const spread = sc.mode === 'flee' ? 1.5 : sc.mode === 'feed' ? 0.8 : 1;
      T.set(sc.lead.x + (o.x * cy + o.z * sy) * spread, sc.lead.y + o.y, sc.lead.z + (-o.x * sy + o.z * cy) * spread);
      T.x += Math.sin(t * 0.21 + ray.wob[0]) * 2.5;
      T.y += Math.sin(t * 0.17 + ray.wob[1]) * 1.6;
      T.z += Math.sin(t * 0.19 + ray.wob[2]) * 2.5;
      T.addScaledVector(sc.leadFwd, sc.leadSpeed * 0.8);
    }
    const dir = _d.subVectors(T, ray.pos);
    const dist = dir.length();
    dir.divideScalar(Math.max(dist, 1e-3));
    // separation from schoolmates
    for (const o of sc.rays) {
      if (o === ray) continue;
      _v2.subVectors(ray.pos, o.pos);
      const d = _v2.length();
      const min = (ray.scale + o.scale) * 1.5;
      if (d < min && d > 1e-3) dir.addScaledVector(_v2, ((min - d) / min) * 1.4 / d);
    }
    // steer around big whales
    for (const m of ctx.movers) {
      _v2.set(ray.pos.x - m.x, ray.pos.y - m.y, ray.pos.z - m.z);
      const d = _v2.length();
      const min = m.w + ray.scale * 2 + 8;
      if (d < min && d > 1e-3) dir.addScaledVector(_v2, ((min - d) / min) * 2 / d);
    }
    if (ray.pos.y < ctx.floorY + 2) dir.y += (ctx.floorY + 2 - ray.pos.y) * 0.05;
    dir.normalize();
    // turn with limited rates
    const yawT = Math.atan2(dir.x, dir.z);
    const pitchT = clamp(Math.asin(clamp(dir.y, -1, 1)), -0.5, 0.55);
    const maxYaw = (sc.mode === 'flee' ? 1.2 : 0.75) * Math.sqrt(2.5 / ray.scale);
    const yErr = wrapAngle(yawT - ray.yaw);
    const wantRate = clamp(yErr * 1.5, -maxYaw, maxYaw);
    ray.yawRate += (wantRate - ray.yawRate) * (1 - Math.exp(-dt * 2.2));
    ray.yaw = wrapAngle(ray.yaw + ray.yawRate * dt);
    ray.pitch += (pitchT - ray.pitch) * (1 - Math.exp(-dt * 1.4));
    // speed: keep station in the formation
    const ahead = (T.x - ray.pos.x) * ray.fwd.x + (T.y - ray.pos.y) * ray.fwd.y + (T.z - ray.pos.z) * ray.fwd.z;
    const want = clamp((sc.mode === 'circle' ? 7 : sc.leadSpeed) + clamp(ahead * 0.25, -2.5, 4.5), 3.2, 15);
    // flap control: bouts of strokes, long glides
    const climb = Math.max(0, ray.pitch);
    const effort = clamp((want - ray.speed) * 0.35 + climb * 1.6 + (sc.mode === 'flee' ? 0.8 : 0) + (sc.mode === 'leap' && sc.wpi <= 2 ? 0.55 : 0) + ray.startle, 0, 1);
    ray.glideT -= dt;
    if (effort > 0.3 && ray.boutT <= 0) ray.boutT = 1.6 / this._freq(ray);
    if (ray.glideT <= 0 && ray.boutT <= 0) {
      ray.boutT = lerp(2, 3.5, Math.random()) / this._freq(ray);
      ray.glideT = lerp(4, 9, Math.random());
    }
    const flapping = ray.boutT > 0;
    ray.boutT -= dt;
    const ampT = flapping ? 0.42 + 0.5 * effort : 0.07;
    ray.amp += (ampT - ray.amp) * (1 - Math.exp(-dt * (flapping ? 1.8 : 0.9)));
    const freq = this._freq(ray) * (flapping ? 0.85 + 0.45 * effort : 0.5);
    ray.phase += TAU * freq * dt;
    if (ray.phase > 1e4) ray.phase -= TAU * 1000;
    const acc = flapping ? 0.9 : 0.18;
    ray.speed += (want - ray.speed) * (1 - Math.exp(-dt * acc)) - Math.sin(ray.pitch) * 2.2 * dt;
    ray.speed = clamp(ray.speed, 3, 16);
    // bank into turns
    const rollT = clamp(-ray.yawRate * ray.speed * 0.13, -0.85, 0.85);
    ray.roll += (rollT - ray.roll) * (1 - Math.exp(-dt * 1.8));
    _e.set(-ray.pitch, ray.yaw, ray.roll, 'YXZ');
    ray.quat.setFromEuler(_e);
    const cp = Math.cos(ray.pitch);
    ray.fwd.set(Math.sin(ray.yaw) * cp, Math.sin(ray.pitch), Math.cos(ray.yaw) * cp);
    ray.pos.addScaledVector(ray.fwd, ray.speed * dt);
    // shock kicks decay
    if (ray.kick.lengthSq() > 1e-4) {
      ray.pos.addScaledVector(ray.kick, dt);
      ray.kick.multiplyScalar(Math.exp(-dt * 2.5));
    }
    ray.startle = Math.max(0, ray.startle - dt * 0.5);
    // feeding: lobes unfurl and the mouth opens inside the swarm
    let feedT = 0;
    if (sc.mode === 'feed' && sc.ref) {
      const d = sc.ref.center.distanceTo(ray.pos);
      feedT = 1 - smoothstep(sc.ref.extent * 0.9, sc.ref.extent + 18, d);
    }
    ray.feed += (feedT - ray.feed) * (1 - Math.exp(-dt * 1.5));
    ray.mouthPrev.copy(ray.mouth);
    ray.mouth.copy(ray.pos).addScaledVector(ray.fwd, ray.scale * 0.42);
    if (ray.feed > 0.5 && ray.mouthOk) {
      this.eco.krill.eat(ray.mouth, ray.mouthPrev, 0.2 + ray.scale * 0.22, { sparkles: 1, sparkleChance: 0.12 });
    }
    ray.mouthOk = true;
    // leaping through cloud: mist bursts as the rays punch in and out
    if (sc.mode === 'leap') {
      const den = this.game.clouds.densityAt(ray.pos);
      if ((den > 0.12) !== (ray.cloudD > 0.12)) this._splash(ray, den > ray.cloudD);
      ray.cloudD = den;
    } else ray.cloudD = 0;
  }

  _freq(ray) {
    return 0.55 * Math.sqrt(2.5 / ray.scale);
  }

  _splash(ray, entering) {
    const mist = this.game.mist;
    if (!mist) return;
    const n = entering ? 5 : 8;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * TAU;
      _v2.set(Math.cos(a), (Math.random() - 0.3) * 0.6, Math.sin(a)).multiplyScalar(ray.scale * 0.9);
      mist.emit({
        pos: _v.copy(ray.pos).addScaledVector(_v2, 0.6),
        vel: _v2.multiplyScalar(0.6).addScaledVector(ray.fwd, ray.speed * (entering ? 0.15 : 0.45)),
        life: lerp(1.8, 3.2, Math.random()), size: ray.scale * 0.7, sizeEnd: ray.scale * 2.2,
        alpha: 0.32, drag: 1.1, kind: 0,
      });
    }
  }

  update(dt, ctx) {
    const n = this.rays.length;
    if (n === 0) {
      this.mesh.visible = false;
      return;
    }
    for (const sc of this.schools) {
      // far beyond sight the school rests (a 5 m ray is a pixel or two at this range)
      sc.dormant = sc.lead.distanceToSquared(ctx.cam) > DORMANT_DIST * DORMANT_DIST;
      if (!sc.dormant) this._updateSchool(sc, dt, ctx);
    }
    const P = this.aPos.array, Q = this.aQuat.array, A = this.aAnim.array, S = this.aSeed.array;
    for (let i = 0; i < n; i++) {
      const ray = this.rays[i];
      if (!ray.school.dormant) this._updateRay(ray, dt, ctx);
      const o = i * 4;
      P[o] = ray.pos.x; P[o + 1] = ray.pos.y; P[o + 2] = ray.pos.z; P[o + 3] = ray.scale;
      Q[o] = ray.quat.x; Q[o + 1] = ray.quat.y; Q[o + 2] = ray.quat.z; Q[o + 3] = ray.quat.w;
      A[o] = ray.phase; A[o + 1] = ray.amp; A[o + 2] = ray.yawRate / Math.max(ray.speed, 1); A[o + 3] = ray.feed;
      S[o] = ray.seed; S[o + 1] = ray.palette + 0.5; S[o + 2] = ray.speed; S[o + 3] = ray.startle;
    }
    for (const a of this._attrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * 4);
      a.needsUpdate = true;
    }
    this.mesh.geometry.instanceCount = n;
    this.mesh.visible = true;
  }

  dispose() {
    this.game.engine.shadows?.removeCaster(this.mesh);
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
