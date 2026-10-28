// The fish of Vur Sok: glintfin bait balls, spiralback spiral columns and lanternjack predators.
//
// Simulation (no neighbour search): every schooling fish owns a slot in its school's formation
// and steers toward it with a damped spring, plus escapes from predators (repulsion, the fountain
// slip past a predator's path, flash expansion from shocks) and a travelling wave of agitation
// that makes a startled school flash. A school blends five formations, each eased in and out:
//   cruise  a polarised, elongated school travelling over its range
//   mill    a slow vortex (the resting bait ball)
//   ball    the tight, fast-milling ball of a threatened school
//   net     the bubble-net column: fish crowd inward and up against the surface ("boil")
//   song    spiral arms under the singing herd
// Spiralbacks swim in a twisting, meandering vortex column and leap clear of the water in arcs.
// Lanternjacks are individual hunters: they patrol beneath bait balls, stalk with their lures
// glowing, strike up through the fish and sometimes breach.
//
// Rendering: per species a detailed near mesh and a light far mesh, both instanced from buffers
// compacted every frame from the visible schools (nearest first). Reduced-rate schools are
// extrapolated on the GPU (pos + vel * age).
import {
  Mesh, InstancedInterleavedBuffer, InterleavedBufferAttribute, DynamicDrawUsage, Vector3, Vector4,
} from 'three';
import { G } from '../../render/Globals.js';
import { buildGlintfin, buildSpiralback, buildLanternjack, triCount } from './fishGeo.js';
import { fishMaterial, SPECIES_ID, FISH_PALETTES } from './fishMat.js';
import { rng, lerp, clamp, smoothstep } from '../../core/math.js';

const TAU = Math.PI * 2;
const STRIDE = 20; // floats per fish in the GPU layout (5 x vec4)
// 0-2 pos, 3 time | 4-6 vel, 7 vis | 8 phase, 9 amp, 10 bend, 11 roll | 12 arch, 13 flare,
// 14 special, 15 flash | 16 seed, 17 length, 18 palette+tint, 19 surface height

export const FISH_SPECIES = {
  glintfin: { max: 24576, nearMax: 1400, len: [0.22, 0.34], cruise: 1.25, burst: 6.5, beat: 5.2, amp: 0.07, nearPx: 30, minPx: 0.75, edible: 1, spacing: 1.65, react: 1 },
  spiralback: { max: 4096, nearMax: 420, len: [0.8, 1.35], cruise: 1.9, burst: 8, beat: 2.8, amp: 0.075, nearPx: 34, minPx: 0.8, edible: 2, spacing: 2.0, react: 0.8 },
  lanternjack: { max: 64, nearMax: 32, len: [2.6, 4.1], cruise: 2.1, burst: 11, beat: 1.25, amp: 0.06, nearPx: 46, minPx: 0.9, edible: 0, spacing: 0, react: 0.3 },
};

const _v = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();

function markAll(buf, n) {
  buf.clearUpdateRanges();
  if (n > 0) buf.addUpdateRange(0, n * STRIDE);
  buf.needsUpdate = true;
}

class Pool {
  constructor(sys, name) {
    const spec = FISH_SPECIES[name];
    this.name = name;
    this.spec = spec;
    this.id = SPECIES_ID[name];
    this.n = 0;
    const max = spec.max;
    this.max = max;
    // GPU layout (also the simulation's position / velocity / animation state)
    this.S = new Float32Array(max * STRIDE);
    // simulation-only state
    this.SL = new Float32Array(max * 4); // slot: unit-ball point (x, y, z), random
    this.ANG = new Float32Array(max); // accumulated mill / column angle
    this.EAT = new Float32Array(max); // regrow timer (> 0: eaten, hidden)
    this.FEAR = new Float32Array(max);
    this.ST = new Uint8Array(max); // 0 schooling, 1 rising to leap, 2 airborne, 3 returning
    this.LT = new Float32Array(max); // leap timer
    this.LV = new Float32Array(max * 3); // leap exit velocity
    // instance buffers: near (detailed) and far
    const mk = (n) => new InstancedInterleavedBuffer(new Float32Array(n * STRIDE), STRIDE).setUsage(DynamicDrawUsage);
    this.nearBuf = mk(spec.nearMax);
    this.farBuf = mk(max);
    this.nearN = 0;
    this.farN = 0;
    this.lodNear = new Vector4(spec.nearPx * 0.5, 1, 0, 0);
    this.lodFar = new Vector4(spec.minPx, 1, 0, 0);
    const build = name === 'glintfin' ? buildGlintfin : name === 'spiralback' ? buildSpiralback : buildLanternjack;
    const mkMesh = (near) => {
      const geo = build(near);
      const buf = near ? this.nearBuf : this.farBuf;
      geo.setAttribute('iPos', new InterleavedBufferAttribute(buf, 4, 0));
      geo.setAttribute('iVel', new InterleavedBufferAttribute(buf, 4, 4));
      geo.setAttribute('iAnim', new InterleavedBufferAttribute(buf, 4, 8));
      geo.setAttribute('iMisc', new InterleavedBufferAttribute(buf, 4, 12));
      geo.setAttribute('iSeed', new InterleavedBufferAttribute(buf, 4, 16));
      geo.instanceCount = 0;
      const mat = fishMaterial(name, near, near ? this.lodNear : this.lodFar);
      const mesh = new Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.name = `${name}-${near ? 'near' : 'far'}`;
      mesh.visible = false;
      sys.game.engine.scene.add(mesh);
      return mesh;
    };
    this.near = mkMesh(true);
    this.far = mkMesh(false);
    this.trisNear = triCount(this.near.geometry);
    this.trisFar = triCount(this.far.geometry);
  }
}

export class FishSystem {
  constructor(eco) {
    this.eco = eco;
    this.game = eco.game;
    this.pools = {};
    for (const k of Object.keys(FISH_SPECIES)) this.pools[k] = new Pool(this, k);
    this.schools = [];
    this.jacks = [];
    this._seed = 1301;
    this.frame = 0;
    this.preds = new Float32Array(48 * 8);
    this.stats = { fish: 0, near: 0, far: 0, tris: 0, schools: 0, active: 0 };
    this.dormantDist = 900;
    this._sorted = [];
    this._res = new Map();
    this.debugSpecial = null;
    this.debugFlare = null;
  }

  // ---------------------------------------------------------------------------------------
  // schools
  /**
   * A school (glintfin bait ball, spiralback column) or a lanternjack group (count 1-3).
   * opts: { radius, palette, seed, depth (m below the surface), leash, anchor, mode }
   */
  addSchool(center, species = 'glintfin', count = 600, opts = {}) {
    const pool = this.pools[species];
    if (!pool) { console.warn('[ecosystem] unknown fish', species); return null; }
    const spec = pool.spec;
    count = Math.max(1, Math.round(count));
    // full: retire the farthest school of this species that is out of sight
    while (pool.n + count > pool.max) {
      const cam = this.game.engine.camera.position;
      let far = null, fd = 600;
      for (const o of this.schools) {
        if (o.pool !== pool) continue;
        const d = o.center.distanceTo(cam);
        if (d > fd) { fd = d; far = o; }
      }
      if (!far) break;
      this.removeSchool(far);
    }
    count = Math.min(count, pool.max - pool.n);
    if (count <= 0) { console.warn('[ecosystem] fish capacity reached', species); return null; }
    const r = rng(opts.seed ?? (this._seed += 23));
    const lenMid = (spec.len[0] + spec.len[1]) * 0.5;
    const R = opts.radius ?? (species === 'lanternjack' ? 14 : Math.max(2.2, lenMid * spec.spacing * Math.cbrt(count)));
    const surf = this.eco.seaHeight(center.x, center.z);
    const depth = opts.depth ?? Math.max(R * 0.8 + 1, surf - center.y);
    const sc = {
      kind: 'fish',
      species,
      pool,
      start: pool.n,
      count,
      alive: count,
      center: center.clone(),
      home: center.clone(),
      vel: new Vector3(),
      heading: r() * TAU,
      R,
      extent: R * 1.6,
      depth,
      surf,
      surfT: 0,
      floor: -1e9,
      floorT: 0,
      leash: opts.leash ?? (species === 'spiralback' ? 70 : 90),
      anchor: opts.anchor || null,
      anchorOffset: opts.anchor ? center.clone().sub(opts.anchor) : null,
      // formation weights (current, eased) and the wander that drives them
      w: { cruise: 0.5, mill: 0.5, ball: 0, net: 0, song: 0 },
      wanderT: lerp(6, 18, r()),
      mood: opts.mode || (r() < 0.5 ? 'cruise' : 'mill'),
      millDir: r() < 0.5 ? -1 : 1,
      wobble: [r() * TAU, r() * TAU, lerp(0.06, 0.12, r()), lerp(0.04, 0.09, r())],
      threat: 0,
      alarmT: -99,
      alarmP: new Vector3(),
      net: 0,
      netT: 0,
      netC: new Vector3(),
      netR: R,
      netHold: 0,
      song: 0,
      songF: new Vector3(),
      songR: 20,
      // spiral column (spiralback)
      colPh: [r() * TAU, r() * TAU, lerp(0.07, 0.14, r()), lerp(0.05, 0.11, r())],
      twist: lerp(0.5, 0.9, r()) * (r() < 0.5 ? -1 : 1),
      leapAcc: 0,
      leapRate: opts.leapRate ?? lerp(0.25, 0.55, r()),
      // bookkeeping
      dormant: false,
      sleepAt: new Vector3(),
      acc: 0,
      rate: 1,
      forceSim: false,
      nPred: 0,
      lastSim: this.game.time,
      palette: opts.palette ?? Math.floor(r() * 4),
      rng: r,
      boilAcc: 0,
      visible: false,
    };
    if (species === 'lanternjack') { sc.w.cruise = 0; sc.w.mill = 0; }
    const S = pool.S, SL = pool.SL;
    const now = this.game.time;
    for (let i = sc.start; i < sc.start + count; i++) {
      const o = i * STRIDE;
      // a point in the unit ball (uniform density)
      let x, y, z;
      do { x = r() * 2 - 1; y = r() * 2 - 1; z = r() * 2 - 1; } while (x * x + y * y + z * z > 1);
      SL[i * 4] = x; SL[i * 4 + 1] = y; SL[i * 4 + 2] = z; SL[i * 4 + 3] = r();
      pool.ANG[i] = Math.atan2(z, x);
      pool.EAT[i] = 0;
      pool.FEAR[i] = 0;
      pool.ST[i] = 0;
      pool.LT[i] = 0;
      const len = lerp(spec.len[0], spec.len[1], Math.pow(r(), 1.4));
      S[o] = center.x + x * R; S[o + 1] = center.y + y * R * 0.6; S[o + 2] = center.z + z * R; S[o + 3] = now;
      S[o + 4] = 0; S[o + 5] = 0; S[o + 6] = 0; S[o + 7] = 1;
      S[o + 8] = r() * TAU; S[o + 9] = spec.amp; S[o + 10] = 0; S[o + 11] = 0;
      S[o + 12] = 0; S[o + 13] = 0; S[o + 14] = species === 'spiralback' ? 0.1 : 0.3; S[o + 15] = 0;
      S[o + 16] = r(); S[o + 17] = len;
      S[o + 18] = sc.palette + (r() < 0.12 ? (sc.palette + 1) % 4 - sc.palette : 0) + 0.02 + r() * 0.96;
      S[o + 19] = surf;
    }
    pool.n += count;
    this.schools.push(sc);
    if (species === 'lanternjack') {
      for (let i = sc.start; i < sc.start + count; i++) {
        const a = r() * TAU;
        const jk = {
          i, school: sc, state: 'patrol', t: lerp(4, 12, r()), cool: lerp(4, 10, r()),
          prey: null, orbitA: a, orbitR: lerp(10, 18, r()), dir: r() < 0.5 ? -1 : 1,
          target: new Vector3(), vel: new Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(spec.cruise),
          glow: 0.3, evade: 0, depth: depth + lerp(4, 10, r()), air: false, splashT: -9, rng: r,
        };
        const o = i * STRIDE;
        S[o] = center.x + Math.cos(a) * 12; S[o + 1] = center.y - 4; S[o + 2] = center.z + Math.sin(a) * 12;
        S[o + 4] = jk.vel.x; S[o + 6] = jk.vel.z;
        this.jacks.push(jk);
      }
    }
    return sc;
  }

  removeSchool(sc) {
    const i = this.schools.indexOf(sc);
    if (i < 0) return;
    this.schools.splice(i, 1);
    const pool = sc.pool;
    const s0 = sc.start, c = sc.count, end = pool.n;
    const mv = (arr, k) => arr.copyWithin(s0 * k, (s0 + c) * k, end * k);
    mv(pool.S, STRIDE); mv(pool.SL, 4); mv(pool.ANG, 1); mv(pool.EAT, 1); mv(pool.FEAR, 1); mv(pool.ST, 1); mv(pool.LT, 1); mv(pool.LV, 3);
    for (const o of this.schools) if (o.pool === pool && o.start > s0) o.start -= c;
    pool.n -= c;
    if (sc.species === 'lanternjack') {
      this.jacks = this.jacks.filter((j) => j.school !== sc);
      for (const j of this.jacks) if (j.i >= s0 + c && j.school.pool === pool) j.i -= c;
    }
  }

  clear() {
    this.schools.length = 0;
    this.jacks.length = 0;
    for (const p of Object.values(this.pools)) {
      p.n = 0; p.nearN = 0; p.farN = 0;
      p.near.visible = p.far.visible = false;
      p.near.geometry.instanceCount = p.far.geometry.instanceCount = 0;
    }
  }

  prune(center, r2) {
    for (const sc of this.schools.slice()) if (sc.home.distanceToSquared(center) > r2) this.removeSchool(sc);
  }

  // ---------------------------------------------------------------------------------------
  // school-level behaviour (cheap, every frame)
  _updateSchool(sc, dt, ctx) {
    const r = sc.rng;
    const t = ctx.time;
    if (sc.anchor) sc.home.copy(sc.anchor).add(sc.anchorOffset);
    // the surface and the floor above / below the school (sampled now and then)
    sc.surfT -= dt;
    if (sc.surfT <= 0) {
      sc.surfT = 0.25 + r() * 0.1;
      sc.surf = this.eco.seaHeight(sc.center.x, sc.center.z);
    }
    sc.floorT -= dt;
    if (sc.floorT <= 0) {
      sc.floorT = 2 + r();
      const fl = ctx.seabed ? ctx.seabed(sc.center.x, sc.center.z) : -1e9;
      sc.floor = Number.isFinite(fl) ? fl : -1e9;
    }
    // what is going on around the school: predators, booms, the bubble net, song
    let threat = 0;
    const P = ctx.predators;
    for (let k = 0; k < P.length; k++) {
      const q = P[k];
      if (q.fishOnly === false) continue;
      const dx = q.x - sc.center.x, dy = q.y - sc.center.y, dz = q.z - sc.center.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - sc.R - q.r;
      const th = smoothstep(30, 0, d) * Math.min(1.2, q.s);
      if (th > threat) threat = th;
    }
    sc.threat += (threat - sc.threat) * (1 - Math.exp(-dt * (threat > sc.threat ? 3 : 0.4)));
    this._detectNet(sc, dt, ctx);
    // song: drift under the singing herd and form spiral arms
    let songT = 0;
    const F = ctx.songFocus;
    if (F && sc.species !== 'lanternjack') {
      const d = Math.hypot(F.x - sc.center.x, F.z - sc.center.z);
      if (d < 280) {
        songT = smoothstep(220, 60, d);
        sc.songF.set(F.x, Math.min(F.y, sc.surf), F.z);
        sc.songR = (ctx.songRadius || 16) * 0.8 + 6;
      }
    }
    sc.song += (songT - sc.song) * (1 - Math.exp(-dt * (songT > sc.song ? 0.25 : 0.15)));
    // wandering moods: cruise around the range, then mill for a while
    sc.wanderT -= dt;
    if (sc.wanderT <= 0) {
      sc.mood = sc.mood === 'cruise' ? 'mill' : 'cruise';
      sc.wanderT = sc.mood === 'cruise' ? lerp(10, 22, r()) : lerp(8, 20, r());
      if (r() < 0.3) sc.millDir *= -1;
    }
    // formation weights
    const w = sc.w;
    const net = sc.net, song = sc.song * (1 - net);
    const ball = clamp(sc.threat * 1.4, 0, 1) * (1 - net) * (1 - song * 0.7);
    const free = (1 - net) * (1 - song) * (1 - ball);
    const cr = sc.mood === 'cruise' ? 1 : 0;
    const ease = (k, v, rate) => { w[k] += (v - w[k]) * (1 - Math.exp(-dt * rate)); };
    ease('cruise', free * cr, 0.5);
    ease('mill', free * (1 - cr), 0.5);
    ease('ball', ball, ball > w.ball ? 2.5 : 0.5);
    ease('net', net, 1.2);
    ease('song', song, 0.4);
    // the school's centre: wander (cruise), hold (mill), slide away from danger, rise in the net
    const tgt = _v;
    if (sc.mood === 'cruise' || w.cruise > 0.2) {
      const a = sc.wobble;
      const hx = Math.sin(t * a[2] + a[0]) * sc.leash * 0.6, hz = Math.sin(t * a[3] + a[1]) * sc.leash * 0.6;
      tgt.set(sc.home.x + hx, sc.home.y, sc.home.z + hz);
    } else tgt.copy(sc.center).setY(sc.home.y);
    if (ball > 0.05) {
      // slide away from the strongest nearby predator
      let best = null, bd = 1e9;
      for (let k = 0; k < P.length; k++) {
        const q = P[k];
        const d = Math.hypot(q.x - sc.center.x, q.y - sc.center.y, q.z - sc.center.z) - q.r;
        if (d < bd) { bd = d; best = q; }
      }
      if (best) {
        _v2.set(sc.center.x - best.x, 0, sc.center.z - best.z);
        const l = _v2.length() || 1;
        tgt.x = sc.center.x + (_v2.x / l) * 20 * ball;
        tgt.z = sc.center.z + (_v2.z / l) * 20 * ball;
        // fish dive away from things above them and rise from things below
        tgt.y = sc.center.y + clamp(sc.center.y - best.y, -6, 6) * 0.6 * ball;
      }
    }
    if (net > 0.02) tgt.lerp(_v2.set(sc.netC.x, sc.surf - sc.R * 0.5, sc.netC.z), net);
    if (song > 0.02) tgt.lerp(_v2.set(sc.songF.x, sc.surf - Math.max(3, sc.R * 0.6), sc.songF.z), song);
    // stay under the surface and above the floor
    const top = sc.surf - 0.8 - sc.R * 0.55 * (1 - net);
    if (tgt.y > top) tgt.y = top;
    const bottom = sc.floor + sc.R * 0.6 + 1.2;
    if (tgt.y < bottom) tgt.y = Math.min(bottom, top);
    // leash
    const hx = tgt.x - sc.home.x, hz = tgt.z - sc.home.z;
    const hd = Math.hypot(hx, hz);
    const leash = sc.leash * (1 + song * 3 + net * 0.5);
    if (hd > leash) { tgt.x = sc.home.x + (hx / hd) * leash; tgt.z = sc.home.z + (hz / hd) * leash; }
    const spec = sc.pool.spec;
    const maxSp = spec.cruise * (0.6 + w.cruise * 0.5 + ball * 1.4 + song * 0.8 + net * 0.6);
    const k = 0.08 + net * 0.25 + ball * 0.12;
    const dvx = (tgt.x - sc.center.x) * k, dvy = (tgt.y - sc.center.y) * k * 1.5, dvz = (tgt.z - sc.center.z) * k;
    const e = 1 - Math.exp(-dt * 0.8);
    sc.vel.x += (dvx - sc.vel.x) * e;
    sc.vel.y += (dvy - sc.vel.y) * e;
    sc.vel.z += (dvz - sc.vel.z) * e;
    const sp = sc.vel.length();
    if (sp > maxSp) sc.vel.multiplyScalar(maxSp / sp);
    sc.center.addScaledVector(sc.vel, dt);
    if (sp > 0.2) {
      const hd2 = Math.atan2(sc.vel.x, sc.vel.z);
      let dh = hd2 - sc.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      sc.heading += dh * (1 - Math.exp(-dt * 0.7));
    }
  }

  /**
   * The spiral bubble net: whales circling beneath / around a school (or an explicit
   * eco.bubbleNet call) confine it; the fish crowd inward and up against the surface.
   */
  _detectNet(sc, dt, ctx) {
    let circling = 0;
    if (sc.species !== 'lanternjack') {
      for (const wh of ctx.whales) {
        const p = wh.pos, v = wh.vel;
        if (!p || !v) continue;
        const rx = p.x - sc.center.x, rz = p.z - sc.center.z;
        const r2 = rx * rx + rz * rz;
        const rr = Math.sqrt(r2);
        const L = wh.L || 10;
        if (rr > sc.R + 30 + L * 0.8 || rr < sc.R * 0.3) continue;
        // only whales in the water count (below the surface, around or under the fish)
        if (p.y > sc.surf + 1 || p.y < sc.center.y - 40) continue;
        const om = (rx * v.z - rz * v.x) / Math.max(r2, 1);
        const k = smoothstep(0.04, 0.12, Math.abs(om)) * smoothstep(sc.R + 30 + L * 0.8, sc.R + 6, rr);
        circling += k * (wh.isCalf ? 0.25 : 1);
      }
    }
    // explicit nets from the herd / story
    for (const n of ctx.nets) {
      const d = Math.hypot(n.c.x - sc.center.x, n.c.z - sc.center.z);
      if (d < n.r + sc.R) { circling = Math.max(circling, n.k * 1.5); sc.netC.lerp(n.c, 0.1); sc.netR = n.r; }
    }
    sc.netHold = circling > 0.6 ? Math.min(sc.netHold + dt, 6) : Math.max(0, sc.netHold - dt * 0.5);
    const target = smoothstep(1.2, 4, sc.netHold) * clamp(circling, 0, 1);
    sc.net += (target - sc.net) * (1 - Math.exp(-dt * (target > sc.net ? 0.6 : 0.25)));
    if (circling > 0.6 && ctx.nets.length === 0) {
      // the net centres on the school
      sc.netC.lerp(sc.center, 1 - Math.exp(-dt * 0.5));
    }
  }

  /** Gather the predators that can reach this school (packed x,y,z,R,strength,vx,vy,vz). */
  _gather(sc, ctx) {
    const out = this.preds;
    let n = 0;
    const cx = sc.center.x, cy = sc.center.y, cz = sc.center.z, ext = sc.extent + 4;
    const L = ctx.predators;
    const isJack = sc.species === 'lanternjack';
    for (let p = 0; p < L.length && n < 48; p++) {
      const q = L[p];
      if (isJack && !q.whale) continue;
      if (q.school === sc) continue;
      const dx = q.x - cx, dy = q.y - cy, dz = q.z - cz;
      const rr = ext + q.r;
      if (dx * dx + dy * dy + dz * dz > rr * rr) continue;
      const o = n * 8;
      out[o] = q.x; out[o + 1] = q.y; out[o + 2] = q.z; out[o + 3] = q.r;
      out[o + 4] = q.s; out[o + 5] = q.vx; out[o + 6] = q.vy; out[o + 7] = q.vz;
      n++;
    }
    sc.nPred = n;
    return n;
  }

  // ---------------------------------------------------------------------------------------
  // per-fish simulation for schooling species
  _simSchool(sc, dt, ctx) {
    const pool = sc.pool, spec = pool.spec;
    const S = pool.S, SL = pool.SL, ANG = pool.ANG, EAT = pool.EAT, FEAR = pool.FEAR, ST = pool.ST;
    const time = ctx.time;
    const np = this._gather(sc, ctx);
    const pr = this.preds;
    const w = sc.w;
    const wsum = w.cruise + w.mill + w.ball + w.net + w.song + 1e-6;
    const wc = w.cruise / wsum, wm = w.mill / wsum, wb = w.ball / wsum, wn = w.net / wsum, ws = w.song / wsum;
    const R = sc.R;
    const cx = sc.center.x, cy = sc.center.y, cz = sc.center.z;
    const cruise = spec.cruise;
    const ch = Math.cos(sc.heading), shd = Math.sin(sc.heading);
    const isSpiral = sc.species === 'spiralback';
    // mill (and ball): vortex speeds
    const millSp = cruise * (0.75 + wb * 1.1 + wn * 0.9);
    const Rm = R * (1 - wb * 0.42 - wn * 0.25);
    // net column
    const Rn = Math.min(sc.netR, R) * 0.5;
    const netTop = sc.surf - 0.35;
    const netH = R * 1.7;
    // song arms
    const sF = sc.songF, sR0 = sc.songR;
    const songRot = time * 0.05;
    // spiral column (spiralback)
    const cp = sc.colPh;
    const colH = R * 2.2, colTop = sc.surf - 1.5;
    const kPos = 1.25, kVel = (1 - Math.exp(-dt * 2.6)) / Math.max(dt, 1e-4);
    const agitT = time - sc.alarmT;
    const agit = agitT < 3.5;
    const ax0 = sc.alarmP.x, ay0 = sc.alarmP.y, az0 = sc.alarmP.z;
    const react = spec.react;
    const beat = spec.beat;
    let alive = 0;
    let maxD2 = 0;
    const r = sc.rng;
    // leaps: spiralbacks leap now and then (and in rhythm when the herd sings)
    let leapNow = -1;
    if (isSpiral) {
      sc.leapAcc += dt * sc.leapRate * (1 + sc.threat * 2.5 + sc.song * 4 + sc.net * 2);
      if (sc.leapAcc >= 1) {
        sc.leapAcc -= 1;
        leapNow = sc.start + Math.floor(r() * sc.count);
      }
    }
    for (let i = sc.start, end = sc.start + sc.count; i < end; i++) {
      const o = i * STRIDE;
      if (EAT[i] > 0) {
        EAT[i] -= dt;
        if (EAT[i] > 0) continue;
        this._regrow(sc, i, ctx);
      }
      alive++;
      const sx = SL[i * 4], sy = SL[i * 4 + 1], sz = SL[i * 4 + 2], sr = SL[i * 4 + 3];
      let px = S[o], py = S[o + 1], pz = S[o + 2];
      let vx = S[o + 4], vy = S[o + 5], vz = S[o + 6];
      const st = ST[i];
      if (st === 2) {
        // airborne: a ballistic arc, fins spread, the body bowed
        vy -= 9.81 * dt;
        px += vx * dt; py += vy * dt; pz += vz * dt;
        const surf = this.eco.seaHeightFast(px, pz);
        S[o + 12] += (0.16 - S[o + 12]) * (1 - Math.exp(-dt * 8));
        S[o + 13] = 1;
        S[o + 14] += (1 - S[o + 14]) * (1 - Math.exp(-dt * 6));
        S[o + 9] += (0.025 - S[o + 9]) * (1 - Math.exp(-dt * 5));
        S[o + 8] += TAU * 1.5 * dt;
        S[o + 11] += Math.sin(S[o + 16] * 40) * dt * 1.2;
        if (py < surf && vy < 0) {
          ST[i] = 3;
          pool.LT[i] = 1.6;
          this.eco.splash(_v.set(px, surf, pz), 0.12 + S[o + 17] * 0.12, S[o + 17] * 0.6, true);
          vx *= 0.5; vy *= 0.4; vz *= 0.5;
        }
        S[o] = px; S[o + 1] = py; S[o + 2] = pz; S[o + 3] = time;
        S[o + 4] = vx; S[o + 5] = vy; S[o + 6] = vz;
        S[o + 19] = surf;
        continue;
      }
      // ---- the formation target ----
      let tx = 0, ty = 0, tz = 0, ux = 0, uy = 0, uz = 0;
      if (isSpiral && wn < 0.98) {
        // a meandering vortex column, the fish rotating in twisted bands
        const h = sy * 0.5 + 0.5;
        const y = colTop - h * colH;
        const mx = Math.sin(h * 2.3 + time * cp[2] + cp[0]) * R * 0.5;
        const mz = Math.cos(h * 1.9 + time * cp[3] + cp[1]) * R * 0.5;
        const rad = R * (0.38 + 0.42 * Math.sqrt(sx * sx + sz * sz)) * (0.65 + 0.35 * Math.sin(h * Math.PI)) * (1 - wb * 0.3);
        const om = (millSp * 1.15) / Math.max(rad, 0.5) * sc.millDir;
        ANG[i] += om * dt;
        const a = ANG[i] + sc.twist * h * 4;
        const ca = Math.cos(a), sa = Math.sin(a);
        const kk = 1 - wn - ws;
        // cruise turns the column into a travelling stream
        const cxx = wc * kk;
        const sxx = sx * R * 0.6, szz = sz * R * 1.6;
        const tcx = cx + (sxx * ch + szz * shd), tcz = cz + (-sxx * shd + szz * ch);
        tx += (cx + mx + ca * rad) * kk * (1 - cxx) + tcx * cxx;
        ty += y * kk * (1 - cxx) + (cy + sy * R * 0.3) * cxx;
        tz += (cz + mz + sa * rad) * kk * (1 - cxx) + tcz * cxx;
        const vt = om * rad;
        ux += (-sa * vt) * kk * (1 - cxx) + shd * cruise * 1.2 * cxx;
        uy += Math.sin(a * 2 + h * 5) * 0.25 * kk;
        uz += (ca * vt) * kk * (1 - cxx) + ch * cruise * 1.2 * cxx;
      } else {
        if (wc > 0.002) {
          // cruising: an elongated, polarised school travelling along the heading
          const lx = sx * R * 0.75, ly = sy * R * 0.38, lz = sz * R * 1.55;
          const wob = Math.sin(time * 0.7 + sr * 20) * R * 0.05;
          tx += (cx + lx * ch + lz * shd + wob) * wc;
          ty += (cy + ly) * wc;
          tz += (cz - lx * shd + lz * ch) * wc;
          const spc = cruise * (1 + (sr - 0.5) * 0.15);
          ux += (shd * spc + sc.vel.x) * wc;
          uy += sc.vel.y * wc;
          uz += (ch * spc + sc.vel.z) * wc;
        }
        if (wm + wb > 0.002) {
          // the mill: a vortex about the vertical axis (tighter and faster as a ball)
          const rho = Math.max(Math.sqrt(sx * sx + sz * sz), 0.15) * Rm;
          const om = millSp / Math.max(rho, Rm * 0.3) * sc.millDir;
          ANG[i] += om * dt * (wm + wb);
          const a = ANG[i];
          const ca = Math.cos(a), sa = Math.sin(a);
          const k = wm + wb;
          tx += (cx + ca * rho) * k;
          ty += (cy + sy * Rm * (0.7 - wb * 0.15)) * k;
          tz += (cz + sa * rho) * k;
          const vt = om * rho;
          ux += -sa * vt * k + sc.vel.x * k;
          uy += sc.vel.y * k;
          uz += ca * vt * k + sc.vel.z * k;
        }
      }
      if (wn > 0.002) {
        // the bubble net: a dense, fast-milling column pressed up against the surface
        const rho = Math.max(Math.sqrt(sx * sx + sz * sz), 0.1) * Rn;
        const om = (millSp * 1.3) / Math.max(rho, 0.6) * sc.millDir;
        ANG[i] += om * dt * wn;
        const a = ANG[i];
        const ca = Math.cos(a), sa = Math.sin(a);
        const h = (sy * 0.5 + 0.5);
        tx += (sc.netC.x + ca * rho) * wn;
        ty += (netTop - h * h * netH) * wn;
        tz += (sc.netC.z + sa * rho) * wn;
        const vt = om * rho;
        ux += -sa * vt * wn;
        uy += 0.4 * wn;
        uz += ca * vt * wn;
      }
      if (ws > 0.002) {
        // song: spiral arms just under the surface, slowly turning (seen from above, a galaxy)
        const arm = Math.floor(sr * 3);
        const u = Math.sqrt(sx * sx + sz * sz);
        const rr = sR0 + u * R * 3.2;
        const th = arm * (TAU / 3) + Math.log(1 + (rr - sR0) / 6) * 1.6 - songRot + sy * 0.18;
        const ca = Math.cos(th), sa = Math.sin(th);
        tx += (sF.x + ca * rr) * ws;
        ty += (sc.surf - 1.3 - (sy * 0.5 + 0.5) * 2.2) * ws;
        tz += (sF.z + sa * rr) * ws;
        // swim along the arm (outward and round)
        const vt = cruise * 0.9;
        ux += (-sa * 0.85 + ca * 0.5) * vt * ws;
        uz += (ca * 0.85 + sa * 0.5) * vt * ws;
      }
      if (st === 1) {
        // rising to leap: aim for the exit point, accelerating
        const lt = pool.LT[i] -= dt;
        const surf = this.eco.seaHeightFast(px, pz);
        const ex = pool.LV[i * 3], ey = pool.LV[i * 3 + 1], ez = pool.LV[i * 3 + 2];
        ux = ex; uy = ey; uz = ez;
        tx = px + ex * 0.4; ty = surf + 0.5; tz = pz + ez * 0.4;
        if (py > surf - 0.1 && vy > 0) {
          ST[i] = 2;
          vx = ex; vy = ey; vz = ez;
          this.eco.splash(_v.set(px, surf, pz), 0.1 + S[o + 17] * 0.1, S[o + 17] * 0.5, true);
        } else if (lt <= 0) ST[i] = 3;
      }
      // ---- steer ----
      let ax, ay, az;
      if (st === 1) {
        ax = (ux - vx) * 4 + (tx - px) * 0.5;
        ay = (uy - vy) * 4 + (ty - py) * 0.5;
        az = (uz - vz) * 4 + (tz - pz) * 0.5;
      } else {
        const kp = st === 3 ? 0.5 : kPos;
        ax = (ux + (tx - px) * kp - vx) * kVel;
        ay = (uy + (ty - py) * kp - vy) * kVel;
        az = (uz + (tz - pz) * kp - vz) * kVel;
      }
      // predators: repulsion and the fountain slip past their path
      let fear = 0;
      for (let p = 0; p < np; p++) {
        const q = p * 8;
        const dx = px - pr[q], dy = py - pr[q + 1], dz = pz - pr[q + 2];
        const Rq = pr[q + 3];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= Rq * Rq) continue;
        const d = Math.sqrt(d2) + 1e-3;
        let k = 1 - d / Rq;
        k = k * k * pr[q + 4] * react;
        const ix = dx / d, iy = dy / d, iz = dz / d;
        ax += ix * k * 30; ay += iy * k * 22; az += iz * k * 30;
        const qx = pr[q + 5], qy = pr[q + 6], qz = pr[q + 7];
        const q2 = qx * qx + qy * qy + qz * qz;
        if (q2 > 1) {
          const ql = Math.sqrt(q2), dd = (ix * qx + iy * qy + iz * qz) / ql;
          ax += (ix - (dd * qx) / ql) * k * 22;
          ay += (iy - (dd * qy) / ql) * k * 22;
          az += (iz - (dd * qz) / ql) * k * 22;
        }
        if (k > fear) fear = k;
      }
      // the wave of agitation after an alarm: a ring running out from where it started
      let flashT = 0;
      if (agit) {
        const dx = px - ax0, dy = py - ay0, dz = pz - az0;
        const dd = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const ph = agitT - dd / 9;
        if (ph > 0 && ph < 0.6) flashT = Math.sin((ph / 0.6) * Math.PI) * (1 - agitT / 3.5);
      }
      // ---- integrate ----
      vx += ax * dt; vy += ay * dt; vz += az * dt;
      const vmax = (cruise * (1.5 + wb * 0.8 + wn * 0.8) + spec.burst * Math.min(fear * 2.2, 1)) * (st === 1 ? 2.5 : 1);
      const v2 = vx * vx + vy * vy + vz * vz;
      if (v2 > vmax * vmax) {
        const kk = vmax / Math.sqrt(v2);
        vx *= kk; vy *= kk; vz *= kk;
      }
      const nx = px + vx * dt, nz = pz + vz * dt;
      let ny = py + vy * dt;
      // never through the surface (unless leaping) or the floor
      if (st !== 1) {
        const lim = sc.surf - 0.25;
        if (ny > lim) { ny = lim - (ny - lim) * 0.2; if (vy > 0) vy *= -0.3; }
      }
      if (ny < sc.floor + 0.4) { ny = sc.floor + 0.4; if (vy < 0) vy = 0; }
      // ---- animation state ----
      const sp = Math.sqrt(vx * vx + vy * vy + vz * vz) + 1e-4;
      // lateral acceleration (turning) bends and banks the fish
      const fxn = vx / sp, fzn = vz / sp;
      const hl = Math.hypot(fxn, fzn) + 1e-4;
      const rx = fzn / hl, rz = -fxn / hl;
      const alat = ax * rx + az * rz;
      const bendT = clamp(-0.55 * S[o + 17] * alat / Math.max(sp * sp, 0.6), -0.32, 0.32);
      S[o + 10] += (bendT - S[o + 10]) * (1 - Math.exp(-dt * 6));
      let fr = FEAR[i];
      fr = Math.max(fr - dt * 0.8, fear * 1.4, flashT * 0.6);
      FEAR[i] = fr;
      const len = S[o + 17];
      const freq = beat * (0.55 + 0.45 * sp / cruise) / Math.sqrt(len / 0.3) * (0.92 + sr * 0.16);
      S[o + 8] += TAU * Math.min(freq, beat * 3.5) * dt;
      const accN = Math.sqrt(ax * ax + ay * ay + az * az);
      const ampT = spec.amp * (0.65 + 0.35 * Math.min(sp / cruise, 2)) + Math.min(accN / 40, 1) * 0.06 + fr * 0.05;
      S[o + 9] += (ampT - S[o + 9]) * (1 - Math.exp(-dt * 5));
      // every fish rolls a little on its own (the shimmer of a school), much more when startled
      const wig = fr * 0.7 * Math.sin(S[o + 8] * 0.23 + S[o + 16] * 31) + 0.2 * Math.sin(time * (0.5 + sr * 0.9) + S[o + 16] * 40);
      const rollT = clamp(-alat * 0.05, -0.75, 0.75) + wig;
      S[o + 11] += (rollT - S[o + 11]) * (1 - Math.exp(-dt * 9));
      S[o + 12] += (0 - S[o + 12]) * (1 - Math.exp(-dt * 3));
      const flareT = isSpiral ? clamp(fr * 0.6 + wn * 0.3, 0, 1) : clamp(fr * 1.6 + flashT * 1.2 + wn * 0.6, 0, 1);
      S[o + 13] += (flareT - S[o + 13]) * (1 - Math.exp(-dt * (flareT > S[o + 13] ? 12 : 2.5)));
      if (isSpiral) {
        // the sail lies folded while cruising; it rises when alarmed, singing, in the net, and
        // now and then in display (each fish on its own slow rhythm)
        const disp = smoothstep(0.75, 0.95, Math.sin(time * 0.21 + S[o + 16] * 37));
        const raiseT = clamp(0.08 + fr * 1.4 + ws * 0.9 + wn * 0.6 + disp * 0.8 + (st === 1 ? 1 : 0), 0, 1);
        S[o + 14] += (raiseT - S[o + 14]) * (1 - Math.exp(-dt * 3));
      }
      S[o + 15] = Math.max(S[o + 15] * Math.exp(-dt * 3), flashT, fr * 0.5);
      if (S[o + 7] < 1) S[o + 7] = Math.min(1, S[o + 7] + dt * 0.6);
      if (st === 3) {
        pool.LT[i] -= dt;
        if (pool.LT[i] <= 0) ST[i] = 0;
      }
      // start a leap (spiralbacks near the top of the column)
      if (i === leapNow && st === 0 && py > sc.surf - 9) {
        const hx = vx / sp, hz = vz / sp;
        const hh = Math.hypot(hx, hz) || 1;
        const ang = lerp(0.6, 0.95, r());
        const vex = lerp(5.5, 8, r()) * (0.8 + sc.song * 0.3);
        pool.LV[i * 3] = (hx / hh) * Math.cos(ang) * vex;
        pool.LV[i * 3 + 1] = Math.sin(ang) * vex;
        pool.LV[i * 3 + 2] = (hz / hh) * Math.cos(ang) * vex;
        pool.LT[i] = 4;
        ST[i] = 1;
      }
      S[o] = nx; S[o + 1] = ny; S[o + 2] = nz; S[o + 3] = time;
      S[o + 4] = vx; S[o + 5] = vy; S[o + 6] = vz;
      S[o + 19] = sc.surf;
      const bx = nx - cx, by = ny - cy, bz = nz - cz;
      const bd2 = bx * bx + by * by + bz * bz;
      if (bd2 > maxD2) maxD2 = bd2;
    }
    sc.alive = alive;
    sc.extent = Math.max(sc.R * 1.6, Math.sqrt(maxD2) + 1);
  }

  _regrow(sc, i, ctx) {
    const pool = sc.pool, S = pool.S, o = i * STRIDE;
    // reappear in the school, far from whatever ate the others, growing in from nothing
    const SL = pool.SL;
    let x = SL[i * 4], y = SL[i * 4 + 1], z = SL[i * 4 + 2];
    if (sc.nPred > 0) {
      const q = this.preds;
      const dx = sc.center.x - q[0], dz = sc.center.z - q[2];
      const l = Math.hypot(dx, dz) || 1;
      x = Math.abs(x) * (dx / l); z = Math.abs(z) * (dz / l);
    }
    S[o] = sc.center.x + x * sc.R; S[o + 1] = sc.center.y + y * sc.R * 0.5; S[o + 2] = sc.center.z + z * sc.R;
    S[o + 3] = ctx.time;
    S[o + 4] = sc.vel.x; S[o + 5] = 0; S[o + 6] = sc.vel.z;
    S[o + 7] = 0;
    pool.EAT[i] = 0;
    pool.ST[i] = 0;
    pool.FEAR[i] = 0;
  }

  // ---------------------------------------------------------------------------------------
  // lanternjacks: individual hunters
  _simJacks(dt, ctx) {
    const time = ctx.time;
    for (const jk of this.jacks) {
      const sc = jk.school, pool = sc.pool, S = pool.S, o = jk.i * STRIDE;
      const spec = pool.spec;
      if (sc.dormant) continue;
      const r = jk.rng;
      let px = S[o], py = S[o + 1], pz = S[o + 2];
      let vx = S[o + 4], vy = S[o + 5], vz = S[o + 6];
      const len = S[o + 17];
      const surf = this.eco.seaHeightFast(px, pz);
      if (jk.air) {
        // breaching: up out of the sea, a twisting arc and a crash
        vy -= 9.81 * dt;
        px += vx * dt; py += vy * dt; pz += vz * dt;
        S[o + 12] += (0.14 - S[o + 12]) * (1 - Math.exp(-dt * 6));
        S[o + 11] += dt * 1.6 * jk.dir;
        S[o + 13] = 1;
        S[o + 8] += TAU * 1.0 * dt;
        if (py < surf && vy < 0) {
          jk.air = false;
          jk.state = 'recover';
          jk.t = lerp(5, 8, r());
          this.eco.splash(_v.set(px, surf, pz), 1.1 + len * 0.15, len * 0.7, false);
          vx *= 0.4; vy *= 0.3; vz *= 0.4;
        }
        S[o] = px; S[o + 1] = py; S[o + 2] = pz; S[o + 3] = time;
        S[o + 4] = vx; S[o + 5] = vy; S[o + 6] = vz; S[o + 19] = surf;
        continue;
      }
      // pick prey: the nearest bait ball within reach
      if (!jk.prey || !this.schools.includes(jk.prey) || jk.prey.alive < 10) {
        jk.prey = null;
        let bd = 220;
        for (const s2 of this.schools) {
          if (s2.species !== 'glintfin' || s2.alive < 20) continue;
          const d = Math.hypot(s2.center.x - px, s2.center.z - pz);
          if (d < bd) { bd = d; jk.prey = s2; }
        }
      }
      const prey = jk.prey;
      const base = prey ? prey.center : sc.home;
      const baseR = prey ? prey.R : 6;
      jk.t -= dt;
      jk.cool -= dt;
      // whales nearby: give them room
      let ex = 0, ez = 0, ey = 0, evade = 0;
      for (const wh of ctx.whales) {
        if (!wh.pos) continue;
        const dx = px - wh.pos.x, dy = py - wh.pos.y, dz = pz - wh.pos.z;
        const R = (wh.L || 10) * 0.6 + 8;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > R * R) continue;
        const d = Math.sqrt(d2) + 1e-3;
        const k = 1 - d / R;
        ex += (dx / d) * k; ey += (dy / d) * k - k * 0.5; ez += (dz / d) * k;
        evade = Math.max(evade, k);
      }
      jk.evade = Math.max(jk.evade - dt, evade > 0.2 ? 2.5 : 0);
      let speed = spec.cruise;
      const tgt = jk.target;
      let glowT = 0.3;
      if (jk.evade > 0) {
        tgt.set(px + ex * 20, py + ey * 10 - 2, pz + ez * 20);
        speed = spec.burst * 0.6;
        if (jk.state === 'strike' || jk.state === 'stalk') { jk.state = 'recover'; jk.t = 4; }
        glowT = 0.1;
      } else if (jk.state === 'patrol') {
        // slow circles beneath the fish
        jk.orbitA += (speed / jk.orbitR) * dt * jk.dir;
        const depth = Math.max(baseR + 6, 9);
        tgt.set(base.x + Math.cos(jk.orbitA) * jk.orbitR, Math.min(base.y - depth, surf - jk.depth * 0.5), base.z + Math.sin(jk.orbitA) * jk.orbitR);
        if (sc.threat > 0.5) jk.t -= dt * 2;
        if (jk.t <= 0 && jk.cool <= 0 && prey && prey.alive > 30) {
          // only one of a pair strikes at a time
          const busy = this.jacks.some((o2) => o2 !== jk && o2.prey === prey && (o2.state === 'stalk' || o2.state === 'strike'));
          if (!busy) { jk.state = 'stalk'; jk.t = lerp(6, 10, r()); } else jk.t = 3;
        }
      } else if (jk.state === 'stalk') {
        // drift in beneath the ball, lures pulsing
        tgt.set(base.x, base.y - baseR - 7, base.z);
        speed = spec.cruise * 0.75;
        glowT = 1;
        const d = Math.hypot(px - tgt.x, py - tgt.y, pz - tgt.z);
        if (d < 4 || jk.t <= 0) {
          jk.state = 'strike';
          jk.t = 3.5;
          // the strike scatters the school: a flash runs through it
          if (prey) { prey.alarmT = time; prey.alarmP.set(px, py, pz); }
        }
      } else if (jk.state === 'strike') {
        // up through the fish at full speed
        tgt.set(base.x, base.y + baseR * 2.5 + 4, base.z);
        speed = spec.burst;
        glowT = 0.6;
        if (prey) {
          const n = this.eatAt(_v.set(px, py, pz).addScaledVector(_v2.set(vx, vy, vz).normalize(), len * 0.45), null, len * 0.16, { sparkles: 0, only: prey, quiet: true });
          void n;
        }
        // momentum through the surface: breach
        if (py > surf - 2.5 && vy > 5 && !jk.air) {
          jk.air = true;
          vy = Math.max(vy, 7.5);
          this.eco.splash(_v.set(px, surf, pz), 0.9 + len * 0.1, len * 0.6, false);
        }
        if (jk.t <= 0 || py > base.y + baseR + 3) {
          jk.state = 'recover';
          jk.t = lerp(4, 7, r());
        }
      } else {
        // recover: glide back down
        tgt.set(base.x + Math.cos(jk.orbitA) * jk.orbitR, base.y - Math.max(baseR + 6, 9), base.z + Math.sin(jk.orbitA) * jk.orbitR);
        speed = spec.cruise * 1.3;
        glowT = 0.2;
        if (jk.t <= 0) { jk.state = 'patrol'; jk.t = lerp(10, 22, r()); jk.cool = lerp(8, 16, r()); }
      }
      if (ctx.songFocus) glowT = Math.max(glowT, 0.5 + 0.5 * Math.sin(time * 2.2 + jk.i));
      jk.glow += (glowT - jk.glow) * (1 - Math.exp(-dt * 2));
      // steer toward the target at the wanted speed (smooth, heavy turns)
      let dx = tgt.x - px, dy = tgt.y - py, dz = tgt.z - pz;
      const d = Math.hypot(dx, dy, dz) + 1e-4;
      const arrive = jk.state === 'strike' ? 1 : smoothstep(0, 6, d);
      const wx = (dx / d) * speed * arrive, wy = (dy / d) * speed * arrive, wz = (dz / d) * speed * arrive;
      const turn = jk.state === 'strike' ? 2.2 : 0.9;
      const ax = (wx - vx) * turn, ay = (wy - vy) * turn, az = (wz - vz) * turn;
      vx += ax * dt; vy += ay * dt; vz += az * dt;
      // keep below the surface unless breaching, and above the floor
      if (py > surf - len * 0.4 && jk.state !== 'strike') vy -= (py - (surf - len * 0.4)) * 2 * dt;
      if (py < sc.floor + len) vy += (sc.floor + len - py) * dt;
      const sp = Math.max(Math.hypot(vx, vy, vz), 0.3);
      if (sp < 0.6) { vx *= 0.6 / sp; vz *= 0.6 / sp; }
      px += vx * dt; py += vy * dt; pz += vz * dt;
      // animation
      const fxn = vx / sp, fzn = vz / sp;
      const hl = Math.hypot(fxn, fzn) + 1e-4;
      const alat = ax * (fzn / hl) + az * (-fxn / hl);
      S[o + 10] += (clamp(-0.4 * len * alat / Math.max(sp * sp, 1), -0.25, 0.25) - S[o + 10]) * (1 - Math.exp(-dt * 4));
      S[o + 11] += (clamp(-alat * 0.03, -0.5, 0.5) - S[o + 11]) * (1 - Math.exp(-dt * 4));
      S[o + 12] += (0 - S[o + 12]) * (1 - Math.exp(-dt * 2));
      const freq = spec.beat * (0.5 + 0.5 * sp / spec.cruise) / Math.sqrt(len / 3);
      S[o + 8] += TAU * Math.min(freq, 4) * dt;
      S[o + 9] += (spec.amp * (0.7 + 0.5 * Math.min(sp / spec.cruise, 2.5)) - S[o + 9]) * (1 - Math.exp(-dt * 3));
      S[o + 13] += ((jk.state === 'strike' ? 0.2 : jk.state === 'stalk' ? 0.7 : 0.4) - S[o + 13]) * (1 - Math.exp(-dt * 2));
      S[o + 14] = jk.glow;
      S[o] = px; S[o + 1] = py; S[o + 2] = pz; S[o + 3] = time;
      S[o + 4] = vx; S[o + 5] = vy; S[o + 6] = vz; S[o + 19] = surf;
      if (S[o + 7] < 1) S[o + 7] = Math.min(1, S[o + 7] + dt * 0.5);
      // the jack is a predator the other fish feel
      const pq = jk.pred || (jk.pred = { x: 0, y: 0, z: 0, r: 0, s: 0, vx: 0, vy: 0, vz: 0, school: sc, fishOnly: true });
      pq.x = px + vx * 0.3; pq.y = py + vy * 0.3; pq.z = pz + vz * 0.3;
      pq.r = len * (jk.state === 'strike' ? 2.2 : 1.3) + 1.5;
      pq.s = jk.state === 'strike' ? 1.6 : jk.state === 'stalk' ? 0.5 : 0.7;
      pq.vx = vx; pq.vy = vy; pq.vz = vz;
      ctx.predators.push(pq);
    }
    // the group's centre follows its members (for LOD / culling)
    for (const sc of this.schools) {
      if (sc.species !== 'lanternjack' || sc.dormant) continue;
      const S = sc.pool.S;
      let x = 0, y = 0, z = 0, m = 0;
      for (let i = sc.start; i < sc.start + sc.count; i++) { x += S[i * STRIDE]; y += S[i * STRIDE + 1]; z += S[i * STRIDE + 2]; m++; }
      if (m) sc.center.set(x / m, y / m, z / m);
      let e = 0;
      for (let i = sc.start; i < sc.start + sc.count; i++) e = Math.max(e, Math.hypot(S[i * STRIDE] - sc.center.x, S[i * STRIDE + 1] - sc.center.y, S[i * STRIDE + 2] - sc.center.z));
      sc.extent = e + 6;
      sc.alive = sc.count;
    }
  }

  // ---------------------------------------------------------------------------------------
  update(dt, ctx) {
    this.frame++;
    const cam = this.game.engine.camera;
    const projScale = 1 / Math.tan((cam.fov * Math.PI) / 360);
    const resY = G.uResolution.value.y;
    const pxPerM = projScale * resY * 0.5; // px = len * pxPerM / dist
    const under = G.uUnderwater.value > 0.5;
    // beyond this the water has swallowed them (from below), or the surface hides them (from above)
    const visDist = under ? 120 : 340;
    // lanternjacks first: they are predators for the schools this frame
    this._simJacks(dt, ctx);
    let active = 0;
    for (let si = 0; si < this.schools.length; si++) {
      const sc = this.schools[si];
      if (sc.species === 'lanternjack') {
        const d = Math.max(0, sc.center.distanceTo(ctx.cam) - sc.extent);
        sc.dormant = d > this.dormantDist;
        sc.visible = !sc.dormant && d < visDist + 60 && ctx.frustum.intersectsSphere(ctx.sphere(sc.center, sc.extent + 6));
        continue;
      }
      this._updateSchool(sc, dt, ctx);
      const d = Math.max(0, sc.center.distanceTo(ctx.cam) - sc.extent);
      if (d > this.dormantDist) {
        if (!sc.dormant) { sc.dormant = true; sc.sleepAt.copy(sc.center); }
        sc.visible = false;
        continue;
      }
      if (sc.dormant) this._wake(sc, ctx.time);
      const inView = ctx.frustum.intersectsSphere(ctx.sphere(sc.center, sc.extent + 3));
      sc.visible = inView && d < visDist;
      let rate;
      if (d < 40) rate = 1;
      else if (!sc.visible) rate = d < 150 ? 4 : 8;
      else rate = d < 90 ? 1 : d < 180 ? 2 : 3;
      if (rate > 1 && (sc.threat > 0.1 || sc.net > 0.05 || sc.song > 0.05 || sc.forceSim)) rate = 1;
      sc.rate = rate;
      sc.acc += dt;
      if (!sc.forceSim && (this.frame + si) % rate !== 0 && sc.acc < 0.3) continue;
      sc.forceSim = false;
      const sdt = Math.min(sc.acc, 0.1);
      sc.acc = 0;
      this._simSchool(sc, sdt, ctx);
      active++;
    }
    // dev overrides (inspection): force the sail / fin flare of every fish
    if (this.debugSpecial != null || this.debugFlare != null) {
      for (const sc of this.schools) {
        const S = sc.pool.S;
        for (let i = sc.start; i < sc.start + sc.count; i++) {
          if (this.debugSpecial != null && sc.species === 'spiralback') S[i * STRIDE + 14] = this.debugSpecial;
          if (this.debugFlare != null) S[i * STRIDE + 13] = this.debugFlare;
        }
      }
    }
    this._compact(pxPerM, ctx);
    this.stats.active = active;
    this.stats.schools = this.schools.length;
  }

  _wake(sc, time) {
    sc.dormant = false;
    const ox = sc.center.x - sc.sleepAt.x, oy = sc.center.y - sc.sleepAt.y, oz = sc.center.z - sc.sleepAt.z;
    const S = sc.pool.S;
    for (let i = sc.start, end = sc.start + sc.count; i < end; i++) {
      const o = i * STRIDE;
      S[o] += ox; S[o + 1] += oy; S[o + 2] += oz; S[o + 3] = time;
    }
    sc.acc = 0;
  }

  /** Fill the near / far instance buffers from the visible schools, nearest first. */
  _compact(pxPerM, ctx) {
    const list = this._sorted;
    list.length = 0;
    for (const sc of this.schools) {
      if (!sc.visible) continue;
      sc._d = sc.center.distanceToSquared(ctx.cam);
      list.push(sc);
    }
    list.sort((a, b) => a._d - b._d);
    let fish = 0, tris = 0;
    const camx = ctx.cam.x, camy = ctx.cam.y, camz = ctx.cam.z;
    for (const pool of Object.values(this.pools)) {
      const spec = pool.spec;
      const NB = pool.nearBuf.array, FB = pool.farBuf.array, S = pool.S, EAT = pool.EAT;
      let nn = 0, nf = 0;
      const nearMax = spec.nearMax, farMax = pool.max;
      const nearPx = spec.nearPx, minPx = spec.minPx;
      for (const sc of list) {
        if (sc.pool !== pool) continue;
        for (let i = sc.start, end = sc.start + sc.count; i < end; i++) {
          if (EAT[i] > 0) continue;
          const o = i * STRIDE;
          const dx = S[o] - camx, dy = S[o + 1] - camy, dz = S[o + 2] - camz;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-3;
          const px = (S[o + 17] * pxPerM) / d;
          if (px < minPx) continue;
          let B, q;
          if (px > nearPx && nn < nearMax) { B = NB; q = nn * STRIDE; nn++; } else if (nf < farMax) { B = FB; q = nf * STRIDE; nf++; } else continue;
          for (let k = 0; k < STRIDE; k++) B[q + k] = S[o + k];
        }
      }
      pool.nearN = nn;
      pool.farN = nf;
      pool.near.geometry.instanceCount = nn;
      pool.far.geometry.instanceCount = nf;
      pool.near.visible = nn > 0;
      pool.far.visible = nf > 0;
      if (nn) markAll(pool.nearBuf, nn);
      if (nf) markAll(pool.farBuf, nf);
      fish += nn + nf;
      tris += nn * pool.trisNear + nf * pool.trisFar;
    }
    this.stats.fish = fish;
    this.stats.tris = tris;
    this.stats.near = this.pools.glintfin.nearN + this.pools.spiralback.nearN + this.pools.lanternjack.nearN;
    this.stats.far = this.pools.glintfin.farN + this.pools.spiralback.farN + this.pools.lanternjack.farN;
  }

  // ---------------------------------------------------------------------------------------
  // interactions
  /**
   * Eat fish inside a capsule (prev -> cur) of the given radius. Returns the food value eaten
   * (glintfin 1, spiralback 2; lanternjacks are never eaten).
   * opts: { only (one school), sparkles, quiet }
   */
  eatAt(cur, prev, radius, opts = {}) {
    let eaten = 0;
    const r2 = radius * radius;
    const ax = prev ? prev.x : cur.x, ay = prev ? prev.y : cur.y, az = prev ? prev.z : cur.z;
    const sx = cur.x - ax, sy = cur.y - ay, sz = cur.z - az;
    const sl2 = sx * sx + sy * sy + sz * sz;
    let sparkles = 0;
    const maxSparkle = opts.sparkles ?? 4;
    for (const sc of this.schools) {
      if (opts.only && sc !== opts.only) continue;
      const pool = sc.pool;
      const value = pool.spec.edible;
      if (!value) continue;
      const rr = sc.extent + radius + Math.sqrt(sl2);
      if (sc.center.distanceToSquared(cur) > rr * rr) continue;
      const S = pool.S, EAT = pool.EAT, r = sc.rng;
      let here = 0;
      for (let i = sc.start, end = sc.start + sc.count; i < end; i++) {
        const o = i * STRIDE;
        if (EAT[i] > 0 || S[o + 7] < 0.4 || pool.ST[i] === 2) continue;
        let dx = S[o] - ax, dy = S[o + 1] - ay, dz = S[o + 2] - az;
        if (sl2 > 1e-6) {
          const t = clamp((dx * sx + dy * sy + dz * sz) / sl2, 0, 1);
          dx -= sx * t; dy -= sy * t; dz -= sz * t;
        }
        const len = S[o + 17] * 0.5;
        const rr2 = radius + len;
        if (dx * dx + dy * dy + dz * dz > Math.max(r2, rr2 * rr2 * 0.6)) continue;
        EAT[i] = lerp(18, 45, r());
        here++;
        if (!opts.quiet && sparkles < maxSparkle && Math.random() < 0.5) {
          sparkles++;
          this._eatFx(S[o], S[o + 1], S[o + 2]);
        }
      }
      if (here) {
        sc.alive = Math.max(0, sc.alive - here);
        eaten += here * value;
        // the school feels the bite: a flash runs out from the mouth
        if (ctx_time(this) - sc.alarmT > 1.5) { sc.alarmT = ctx_time(this); sc.alarmP.copy(cur); }
        sc.forceSim = true;
      }
    }
    return eaten;
  }

  /** A few silver scales flutter where a fish was taken. */
  _eatFx(x, y, z) {
    const mist = this.game.mist;
    if (!mist) return;
    for (let k = 0; k < 3; k++) {
      mist.emit({
        pos: _v3.set(x + (Math.random() - 0.5) * 0.2, y + (Math.random() - 0.5) * 0.2, z + (Math.random() - 0.5) * 0.2),
        vel: _v2.set((Math.random() - 0.5) * 0.6, (Math.random() - 0.3) * 0.5, (Math.random() - 0.5) * 0.6),
        life: 1.6 + Math.random(), size: 0.035, sizeEnd: 0.025, alpha: 0.9, drag: 2.5, gravity: 0.15,
        color: [2.2, 2.3, 2.4], kind: 5, fadeIn: 0.02,
      });
    }
  }

  /** Sonic boom / shock front between rIn and rOut: fish are blown outward and flash. */
  shock(center, rIn, rOut, radius, strength) {
    const o2 = rOut * rOut, i2 = rIn * rIn;
    const time = ctx_time(this);
    for (const sc of this.schools) {
      const rr = sc.extent + rOut;
      if (sc.center.distanceToSquared(center) > rr * rr) continue;
      const pool = sc.pool, S = pool.S, EAT = pool.EAT;
      // a boom in the air reaches into the sea only weakly
      const above = Math.max(0, center.y - sc.surf);
      const k0 = strength * Math.exp(-above / 25);
      let hit = false;
      for (let i = sc.start, end = sc.start + sc.count; i < end; i++) {
        if (EAT[i] > 0) continue;
        const o = i * STRIDE;
        const dx = S[o] - center.x, dy = S[o + 1] - center.y, dz = S[o + 2] - center.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= o2 || d2 < i2) continue;
        const d = Math.sqrt(d2) + 0.01;
        const depth = Math.max(0, sc.surf - S[o + 1]);
        const k = Math.sqrt(Math.max(0, 1 - d / radius)) * k0 * Math.exp(-depth / 12) * 8 * pool.spec.react;
        S[o + 4] += (dx / d) * k; S[o + 5] += (dy / d) * k * 0.5 - k * 0.3; S[o + 6] += (dz / d) * k;
        pool.FEAR[i] = Math.min(1, pool.FEAR[i] + 0.5 + k0 * 0.3);
        S[o + 15] = 1;
        hit = true;
      }
      if (hit) {
        sc.forceSim = true;
        sc.threat = Math.min(1.2, sc.threat + 0.6 * k0);
        if (time - sc.alarmT > 1) { sc.alarmT = time; sc.alarmP.copy(center); }
      }
    }
    for (const jk of this.jacks) {
      const S = jk.school.pool.S, o = jk.i * STRIDE;
      const d = Math.hypot(S[o] - center.x, S[o + 1] - center.y, S[o + 2] - center.z);
      if (d < rOut && d >= rIn) { jk.evade = 3; jk.state = 'recover'; jk.t = 5; }
    }
  }

  /** Nearest school the herd can feed on: { school, swarm, pos, dist, radius, species, count, depth }. */
  nearest(pos, species = null) {
    let best = null, bd = Infinity;
    for (const sc of this.schools) {
      if (!sc.pool.spec.edible || sc.alive < sc.count * 0.08) continue;
      if (species && sc.species !== species) continue;
      const d = Math.max(0, sc.center.distanceTo(pos) - sc.R);
      if (d < bd) { bd = d; best = sc; }
    }
    if (!best) return null;
    let res = this._res.get(best);
    if (!res) { res = { school: best, swarm: best, pos: new Vector3(), dist: 0, radius: 0, species: best.species, count: 0, depth: 0 }; this._res.set(best, res); }
    res.pos.copy(best.center);
    res.dist = bd;
    res.radius = best.R;
    res.count = best.alive;
    res.depth = best.surf - best.center.y;
    return res;
  }

  get count() {
    let n = 0;
    for (const p of Object.values(this.pools)) n += p.n;
    return n;
  }

  dispose() {
    for (const p of Object.values(this.pools)) {
      for (const m of [p.near, p.far]) {
        m.removeFromParent();
        m.geometry.dispose();
        m.material.dispose();
      }
    }
  }
}

function ctx_time(sys) { return sys.game.time; }

export { FISH_PALETTES };
