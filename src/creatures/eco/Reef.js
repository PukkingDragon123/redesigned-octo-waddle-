// The reef life of Vur Sok: what the calf finds when it dives.
//
// Flora (static instances, re-scattered around the camera as it moves; animated on the GPU):
//   kelp forests in the shallows (tall stalks with glowing gas bladders, a canopy on the surface),
//   tube corals with glowing lips, anemone gardens, spiral shells, lattice sea fans.
//   All of them react to whales on the GPU (uActors): kelp parts, anemones close into buds, tube
//   corals retract and glow, fans bend away.
// Fauna (small recycled pools simulated on the CPU around the camera):
//   crabs (spiral-shelled hermits that duck into their shells, long-legged glass crabs that scuttle
//   off and burrow, armoured plate crabs that rear up, wave their claws and glow), jellies (drifting
//   blooms that pulse, flare and flee), rays (glide over the reef; curious ones swim alongside the
//   calf), lantern puffers (inflate into spiky balls when startled) and ribbon eels in the kelp.
//   Small ones are food: eatAt() / nearestFood() feed Ecosystem.eat / nearestSwarm.
// Placement uses the world's sea floor (ctx.seabed = world.seabedAt): kelp and gardens grow on
// reef shelves, shoals and atoll lagoons; jellies and rays live in any water deep enough.
// About ten draw calls; nothing is allocated per frame.
import { Mesh, InstancedBufferAttribute, DynamicDrawUsage, Vector3, Vector4 } from 'three';
import { G } from '../../render/Globals.js';
import { buildKelp, buildTubes, buildAnemone, buildShell, buildFan, buildCrab, buildJelly, buildRay, buildPuffer, buildEel, triCount } from './reefGeo.js';
import { reefMaterial, makeActors } from './reefMat.js';

const TAU = Math.PI * 2;
const _v = new Vector3();
const _v2 = new Vector3();

function hash2(x, z) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  let fx = x - ix, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
/** Kelp forest density 0..1 (patchy forests a few hundred metres across). */
export function kelpDensity(x, z) { return vnoise(x / 70 + 13.1, z / 70 - 7.7) * 0.7 + vnoise(x / 19, z / 19) * 0.3; }
/** Reef garden density 0..1. */
export function gardenDensity(x, z) { return vnoise(x / 34 - 3.3, z / 34 + 9.1) * 0.75 + vnoise(x / 9, z / 9) * 0.25; }
/** Jelly blooms 0..1. */
function bloomDensity(x, z) { return vnoise(x / 45 + 31.0, z / 45 + 2.0); }

/** Instanced mesh with three vec4 per-instance attributes. */
class Inst {
  constructor(sys, kind, geo, max, transparent = false) {
    this.kind = kind;
    this.max = max;
    this.n = 0;
    this.A = new Float32Array(max * 4);
    this.B = new Float32Array(max * 4);
    this.C = new Float32Array(max * 4);
    const mk = (arr) => new InstancedBufferAttribute(arr, 4).setUsage(DynamicDrawUsage);
    this.aA = mk(this.A); this.aB = mk(this.B); this.aC = mk(this.C);
    geo.setAttribute('iA', this.aA);
    geo.setAttribute('iB', this.aB);
    geo.setAttribute('iC', this.aC);
    geo.instanceCount = 0;
    this.geo = geo;
    this.tris = triCount(geo);
    this.fade = new Vector4(0, 0, 1e6, 2e6);
    this.mesh = new Mesh(geo, reefMaterial(kind, sys.actors, this.fade));
    this.mesh.frustumCulled = false;
    this.mesh.name = `reef-${kind}`;
    if (transparent) {
      this.mesh.renderOrder = 6;
      sys.game.engine.sceneT.add(this.mesh);
    } else sys.game.engine.scene.add(this.mesh);
  }
  set(i, ax, ay, az, aw, bx, by, bz, bw, cx = 0, cy = 0, cz = 0, cw = 0) {
    const k = i * 4;
    const A = this.A, B = this.B, C = this.C;
    A[k] = ax; A[k + 1] = ay; A[k + 2] = az; A[k + 3] = aw;
    B[k] = bx; B[k + 1] = by; B[k + 2] = bz; B[k + 3] = bw;
    C[k] = cx; C[k + 1] = cy; C[k + 2] = cz; C[k + 3] = cw;
  }
  commit(n) {
    this.n = n;
    this.geo.instanceCount = n;
    for (const a of [this.aA, this.aB, this.aC]) {
      a.clearUpdateRanges();
      if (n > 0) a.addUpdateRange(0, n * 4);
      a.needsUpdate = true;
    }
  }
}

/** A recycled pool of simulated creatures. */
class Pool {
  constructor(n) {
    this.max = n;
    this.alive = new Uint8Array(n);
    this.P = new Float32Array(n * 3);
    this.V = new Float32Array(n * 3);
    this.H = new Float32Array(n * 3); // home / target
    this.yaw = new Float32Array(n);
    this.pitch = new Float32Array(n);
    this.roll = new Float32Array(n);
    this.ph = new Float32Array(n);
    this.s = new Float32Array(n); // scale
    this.seed = new Float32Array(n);
    this.vr = new Uint8Array(n); // variant
    this.a = new Float32Array(n); // state slots
    this.b = new Float32Array(n);
    this.c = new Float32Array(n);
    this.d = new Float32Array(n);
    this.t = new Float32Array(n); // timers
    this.t2 = new Float32Array(n);
    this.floor = new Float32Array(n);
    this.wait = new Float32Array(n); // respawn back-off after a failed placement (open sea)
  }
  /** A slot that is free (or left behind) may try to respawn now. */
  ready(i, dt) {
    this.alive[i] = 0;
    if (this.wait[i] > 0) { this.wait[i] -= dt; return false; }
    this.wait[i] = 0.8 + Math.random() * 1.2;
    return true;
  }
}

export const REEF_FOOD = { crab: 0.5, puffer: 0.6, jelly: 0.4 };

export class ReefLife {
  constructor(eco, opts = {}) {
    this.eco = eco;
    this.game = eco.game;
    this.enabled = true;
    this.actors = makeActors();
    /** Living radius around the camera (m). */
    this.radius = opts.radius ?? 78;
    this.density = opts.density ?? 1;
    this.inst = {
      kelp: new Inst(this, 'kelp', buildKelp(), 380),
      tubes: new Inst(this, 'tubes', buildTubes(), 130),
      anemone: new Inst(this, 'anemone', buildAnemone(), 140),
      shell: new Inst(this, 'shell', buildShell(), 80),
      fan: new Inst(this, 'fan', buildFan(), 110),
      crab: new Inst(this, 'crab', buildCrab(), 70),
      jelly: new Inst(this, 'jelly', buildJelly(), 60, true),
      ray: new Inst(this, 'ray', buildRay(), 8),
      puffer: new Inst(this, 'puffer', buildPuffer(), 40),
      eel: new Inst(this, 'eel', buildEel(), 18),
    };
    this.instList = Object.values(this.inst);
    this.crabs = new Pool(this.inst.crab.max);
    this.jellies = new Pool(this.inst.jelly.max);
    this.rays = new Pool(this.inst.ray.max);
    this.puffers = new Pool(this.inst.puffer.max);
    this.eels = new Pool(this.inst.eel.max);
    this._scatterAt = new Vector3(1e9, 0, 1e9);
    this._seabed = null;
    this.focus = new Vector3();
    this.actor = null; // the nearest whale under water (the calf, usually)
    this._actorVel = new Vector3();
    this.food = { pos: new Vector3(), dist: Infinity, species: 'reef', kind: '', count: 1, radius: 1, depth: 0, school: null, swarm: null, reef: true };
    this.stats = { kelp: 0, garden: 0, crabs: 0, jellies: 0, rays: 0, puffers: 0, eels: 0, draws: 0, tris: 0, eaten: 0, scatterMs: 0 };
    this.lastEaten = 0;
    this._bloomT = -1e9;
    this._rayT = -1e9;
    this._underT = 0;
    this._scatterCool = 0;
    this.visible = true;
  }

  // ---- placement -----------------------------------------------------------------------------
  floorAt(x, z) {
    const f = this._seabed;
    return f ? f(x, z) : -200;
  }

  seaAt(x, z) { return this.eco.seaHeightFast(x, z); }

  /** Re-scatter the plants around (fx, fz). Deterministic per place (hashes of world cells). */
  scatter(fx, fz) {
    const t0 = performance.now();
    this._scatterAt.set(fx, 0, fz);
    const sea = G.uSeaLevel.value;
    const dens = this.density;
    // kelp forests
    {
      const I = this.inst.kelp, CELL = 6.5, R = this.radius + 6;
      let n = 0;
      const x0 = Math.floor((fx - R) / CELL), x1 = Math.floor((fx + R) / CELL);
      const z0 = Math.floor((fz - R) / CELL), z1 = Math.floor((fz + R) / CELL);
      for (let i = x0; i <= x1 && n < I.max; i++) for (let j = z0; j <= z1 && n < I.max; j++) {
        const h = hash2(i * 3 + 1, j * 7 + 2);
        const x = (i + 0.15 + 0.7 * hash2(i, j + 99)) * CELL, z = (j + 0.15 + 0.7 * hash2(i + 77, j)) * CELL;
        const dx = x - fx, dz = z - fz;
        if (dx * dx + dz * dz > R * R) continue;
        const d = kelpDensity(x, z);
        if (h > (d - 0.42) * 3.2 * dens) continue;
        const y = this.floorAt(x, z);
        const depth = sea - y;
        if (depth < 2.5 || depth > 26) continue;
        const H = depth * (0.75 + 0.6 * hash2(i + 5, j + 11)) + 1;
        I.set(n++, x, y - 0.2, z, hash2(i, j) * TAU, 0.8 + 0.5 * hash2(i + 3, j), hash2(i + 9, j + 4), H, 0);
      }
      I.commit(n);
      this.stats.kelp = n;
    }
    // reef gardens: tube corals, anemones, shells, fans
    {
      const T = this.inst.tubes, A = this.inst.anemone, S = this.inst.shell, F = this.inst.fan;
      let nt = 0, na = 0, ns = 0, nf = 0;
      const CELL = 4.2, R = this.radius * 0.66;
      const x0 = Math.floor((fx - R) / CELL), x1 = Math.floor((fx + R) / CELL);
      const z0 = Math.floor((fz - R) / CELL), z1 = Math.floor((fz + R) / CELL);
      for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
        const h = hash2(i * 5 + 3, j * 3 + 8);
        const x = (i + 0.1 + 0.8 * hash2(i + 31, j)) * CELL, z = (j + 0.1 + 0.8 * hash2(i, j + 57)) * CELL;
        const dx = x - fx, dz = z - fz;
        if (dx * dx + dz * dz > R * R) continue;
        const g = gardenDensity(x, z);
        if (h > (g - 0.3) * 2.2 * dens) continue;
        const y = this.floorAt(x, z);
        const depth = sea - y;
        if (depth < 0.9 || depth > 32) continue;
        const pick = hash2(i + 13, j + 17), yaw = hash2(i + 2, j + 5) * TAU, sd = hash2(i + 41, j + 43);
        if (pick < 0.32) { if (nt < T.max) T.set(nt++, x, y - 0.05, z, yaw, 1.2 + 1.6 * sd, sd, 0, 0); }
        else if (pick < 0.62) { if (na < A.max) A.set(na++, x, y - 0.05, z, yaw, 1.3 + 1.7 * sd, sd, 0, 0); }
        else if (pick < 0.8) { if (nf < F.max) F.set(nf++, x, y - 0.1, z, yaw, 1.4 + 1.8 * sd, sd, 0, 0); }
        else if (ns < S.max) S.set(ns++, x, y, z, yaw, 0.9 + 1.4 * sd, sd, 0, 0);
      }
      T.commit(nt); A.commit(na); S.commit(ns); F.commit(nf);
      this.stats.garden = nt + na + ns + nf;
    }
    this.stats.scatterMs = performance.now() - t0;
  }

  // ---- fauna spawning --------------------------------------------------------------------------
  _ring(rMin, rMax) {
    const a = Math.random() * TAU, r = rMin + (rMax - rMin) * Math.sqrt(Math.random());
    _v.set(this.focus.x + Math.cos(a) * r, 0, this.focus.z + Math.sin(a) * r);
    return _v;
  }

  _spawnCrab(i, rMin, rMax) {
    const C = this.crabs, sea = G.uSeaLevel.value;
    for (let tries = 0; tries < 5; tries++) {
      const p = this._ring(rMin, rMax);
      const y = this.floorAt(p.x, p.z);
      const depth = sea - y;
      if (depth < 1.0 || depth > 28) continue;
      if (gardenDensity(p.x, p.z) < 0.3 && Math.random() < 0.6) continue;
      const v = Math.random();
      const vr = v < 0.42 ? 0 : v < 0.72 ? 1 : 2;
      C.alive[i] = 1;
      C.P[i * 3] = p.x; C.P[i * 3 + 1] = y; C.P[i * 3 + 2] = p.z;
      C.floor[i] = y;
      C.vr[i] = vr;
      C.s[i] = vr === 0 ? 1.0 + Math.random() * 0.9 : vr === 1 ? 1.3 + Math.random() * 1.0 : 1.8 + Math.random() * 1.5;
      C.seed[i] = Math.random();
      C.yaw[i] = Math.random() * TAU;
      C.a[i] = 0; C.b[i] = 0; C.c[i] = 0; C.d[i] = 0;
      C.t[i] = Math.random() * 4; C.t2[i] = 0;
      C.ph[i] = Math.random() * TAU;
      return true;
    }
    C.alive[i] = 0;
    return false;
  }

  _spawnJelly(i, rMin, rMax, near = null) {
    const J = this.jellies, sea = G.uSeaLevel.value;
    for (let tries = 0; tries < 6; tries++) {
      let p;
      if (near) p = _v.set(near.x + (Math.random() - 0.5) * 22, 0, near.z + (Math.random() - 0.5) * 22);
      else p = this._ring(rMin, rMax);
      if (!near && bloomDensity(p.x, p.z) < 0.5) continue;
      const y = this.floorAt(p.x, p.z);
      const depth = sea - y;
      if (depth < 5) continue;
      const top = 1.6, bot = Math.min(18, depth - 2.5);
      const yy = near ? Math.min(sea - top, Math.max(sea - bot, near.y + (Math.random() - 0.5) * 8)) : sea - (top + Math.random() * (bot - top));
      J.alive[i] = 1;
      J.P[i * 3] = p.x; J.P[i * 3 + 1] = yy; J.P[i * 3 + 2] = p.z;
      J.V[i * 3] = 0; J.V[i * 3 + 1] = 0; J.V[i * 3 + 2] = 0;
      J.floor[i] = y;
      J.s[i] = Math.random() < 0.12 ? 2.0 + Math.random() * 1.2 : 0.55 + Math.random() * 0.9;
      J.seed[i] = Math.random();
      J.ph[i] = Math.random() * TAU;
      J.yaw[i] = Math.random() * TAU;
      J.a[i] = 0; // flare
      return true;
    }
    J.alive[i] = 0;
    return false;
  }

  _spawnRay(i, rMin, rMax) {
    const Rr = this.rays, sea = G.uSeaLevel.value;
    for (let tries = 0; tries < 6; tries++) {
      const p = this._ring(rMin, rMax);
      const y = this.floorAt(p.x, p.z);
      const depth = sea - y;
      if (depth < 5) continue;
      const yy = sea - Math.min(3 + Math.random() * 8, depth * 0.6);
      Rr.alive[i] = 1;
      Rr.P[i * 3] = p.x; Rr.P[i * 3 + 1] = yy; Rr.P[i * 3 + 2] = p.z;
      Rr.H[i * 3] = p.x; Rr.H[i * 3 + 1] = yy; Rr.H[i * 3 + 2] = p.z;
      Rr.yaw[i] = Math.random() * TAU;
      Rr.s[i] = 2.4 + Math.random() * 2.2;
      Rr.seed[i] = Math.random();
      Rr.ph[i] = Math.random() * TAU;
      Rr.a[i] = 0; Rr.b[i] = 0; Rr.t[i] = 0; Rr.t2[i] = Math.random() * 10;
      Rr.floor[i] = y;
      Rr.d[i] = 0.5 + Math.random() * 0.5; // turn direction & rate
      if (Math.random() < 0.5) Rr.d[i] = -Rr.d[i];
      return true;
    }
    Rr.alive[i] = 0;
    return false;
  }

  _spawnPuffer(i, rMin, rMax) {
    const Pf = this.puffers, sea = G.uSeaLevel.value;
    for (let tries = 0; tries < 5; tries++) {
      const p = this._ring(rMin, rMax);
      const y = this.floorAt(p.x, p.z);
      const depth = sea - y;
      if (depth < 2.5 || depth > 30) continue;
      const yy = y + 1 + Math.random() * Math.min(4, depth - 1.8);
      Pf.alive[i] = 1;
      Pf.P[i * 3] = p.x; Pf.P[i * 3 + 1] = yy; Pf.P[i * 3 + 2] = p.z;
      Pf.H[i * 3] = p.x; Pf.H[i * 3 + 1] = yy; Pf.H[i * 3 + 2] = p.z;
      Pf.V[i * 3] = 0; Pf.V[i * 3 + 1] = 0; Pf.V[i * 3 + 2] = 0;
      Pf.floor[i] = y;
      Pf.s[i] = 1.5 + Math.random() * 1.3;
      Pf.seed[i] = Math.random();
      Pf.yaw[i] = Math.random() * TAU;
      Pf.a[i] = 0; Pf.t[i] = 0; Pf.t2[i] = 0;
      return true;
    }
    Pf.alive[i] = 0;
    return false;
  }

  _spawnEel(i, rMin, rMax) {
    const E = this.eels, sea = G.uSeaLevel.value;
    for (let tries = 0; tries < 6; tries++) {
      const p = this._ring(rMin, rMax);
      if (kelpDensity(p.x, p.z) < 0.5) continue;
      const y = this.floorAt(p.x, p.z);
      const depth = sea - y;
      if (depth < 3 || depth > 26) continue;
      const yy = y + 1.5 + Math.random() * depth * 0.5;
      E.alive[i] = 1;
      E.P[i * 3] = p.x; E.P[i * 3 + 1] = yy; E.P[i * 3 + 2] = p.z;
      E.H[i * 3] = p.x; E.H[i * 3 + 1] = yy; E.H[i * 3 + 2] = p.z;
      E.floor[i] = y;
      E.s[i] = 2.4 + Math.random() * 1.8;
      E.seed[i] = Math.random();
      E.yaw[i] = Math.random() * TAU;
      E.pitch[i] = 0;
      E.a[i] = 0; E.t[i] = 0;
      return true;
    }
    E.alive[i] = 0;
    return false;
  }

  /** Fill every pool around the focus (first frame, after a jump, after clear()). */
  _fill() {
    const R = this.radius;
    for (let i = 0; i < this.crabs.max; i++) this._spawnCrab(i, 4, R);
    for (let i = 0; i < this.jellies.max; i++) this._spawnJelly(i, 6, R);
    for (let i = 0; i < this.rays.max; i++) this._spawnRay(i, 10, R);
    for (let i = 0; i < this.puffers.max; i++) this._spawnPuffer(i, 5, R);
    for (let i = 0; i < this.eels.max; i++) this._spawnEel(i, 5, R);
  }

  // ---- per frame -------------------------------------------------------------------------------
  update(dt, ctx) {
    if (!this.enabled) return;
    const g = this.game;
    const cam = ctx.cam;
    this._seabed = ctx.seabed;
    const sea = G.uSeaLevel.value;
    // nothing to see from high in the sky
    const show = cam.y < sea + 140 && !!this._seabed;
    if (show !== this.visible) {
      this.visible = show;
      for (const I of this.instList) I.mesh.visible = show;
    }
    if (!show) return;
    this.focus.copy(cam);
    const R = this.radius;
    for (const I of this.instList) {
      const k = I.kind;
      const r = k === 'kelp' ? R + 6 : k === 'tubes' || k === 'anemone' || k === 'shell' || k === 'fan' ? R * 0.66 : R;
      I.fade.set(cam.x, cam.z, r * 0.8, r);
    }
    // the garden follows the camera
    const sx = this._scatterAt.x - cam.x, sz = this._scatterAt.z - cam.z;
    const moved = sx * sx + sz * sz;
    this._scatterCool -= dt;
    if (moved > 100 && (this._scatterCool <= 0 || moved > R * R * 0.25)) {
      this._scatterCool = cam.y > G.uSeaLevel.value + 25 ? 0.6 : 0.15;
      if (moved > R * R * 0.8) this._fill();
      this.scatter(cam.x, cam.z);
      for (const I of this.instList) if (I.kind === 'kelp' || I.kind === 'tubes' || I.kind === 'anemone' || I.kind === 'shell' || I.kind === 'fan') I.fade.set(cam.x, cam.z, I.fade.z, I.fade.w);
    }
    // actors: whales near the camera (the calf first), for the GPU and the critters
    this._gatherActors(ctx);
    const t = ctx.time;
    // a few delightful moments: a jelly bloom ahead of a diving calf, a manta that comes along
    this._moments(dt, t);
    this._crabs(dt, t);
    this._jellies(dt, t);
    this._rays(dt, t);
    this._puffers(dt, t);
    this._eels(dt, t);
    let tris = 0, draws = 0;
    for (const I of this.instList) if (I.n > 0) { draws++; tris += I.n * I.tris; }
    this.stats.draws = draws;
    this.stats.tris = tris;
  }

  _gatherActors(ctx) {
    const A = this.actors;
    let k = 0;
    this.actor = null;
    const W = ctx.whales;
    const cam = ctx.cam;
    const sea = G.uSeaLevel.value;
    let best = Infinity;
    for (let i = 0; i < W.length && k < 4; i++) {
      const w = W[i];
      if (!w || !w.pos) continue;
      const L = w.L || 8;
      if (w.pos.y > sea + L * 0.3) continue;
      const d = w.pos.distanceToSquared(cam);
      if (d > 160 * 160) continue;
      A[k++].set(w.pos.x, w.pos.y, w.pos.z, L * 0.32 + 1.2);
      // the critters care most about the whale nearest the camera (the calf in play)
      if (d < best) { best = d; this.actor = w; }
    }
    for (; k < 4; k++) A[k].w = 0;
    if (this.actor) {
      if (this.actor.vel) this._actorVel.copy(this.actor.vel);
      else this._actorVel.set(0, 0, 0);
    }
  }

  /** Distance to the actor (calf) and the unit direction away from it in _v2. */
  _threat(x, y, z) {
    const a = this.actor;
    if (!a) return Infinity;
    const dx = x - a.pos.x, dy = y - a.pos.y, dz = z - a.pos.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-3;
    _v2.set(dx / d, dy / d, dz / d);
    // the body is long: measure from its skin, roughly
    return Math.max(0, d - (a.L || 8) * 0.3);
  }

  _far(x, z, k = 1.12) {
    const dx = x - this.focus.x, dz = z - this.focus.z;
    const R = this.radius * k;
    return dx * dx + dz * dz > R * R;
  }

  _moments(dt, t) {
    const a = this.actor;
    const sea = G.uSeaLevel.value;
    if (!a || a.pos.y > sea - 2) { this._underT = 0; return; }
    this._underT += dt;
    const sp = this._actorVel.length();
    const fx = sp > 0.5 ? this._actorVel.x / sp : Math.sin(a.yaw || 0);
    const fz = sp > 0.5 ? this._actorVel.z / sp : Math.cos(a.yaw || 0);
    // a jelly bloom drifting ahead (every 45 s under water, where the water is deep enough)
    if (this._underT > 2.5 && t - this._bloomT > 45) {
      const cx = a.pos.x + fx * 30, cz = a.pos.z + fz * 30;
      const depth = sea - this.floorAt(cx, cz);
      if (depth > 7) {
        this._bloomT = t;
        const J = this.jellies;
        const c = _v2.set(cx, Math.max(a.pos.y, sea - Math.min(12, depth - 3)), cz);
        // move the farthest jellies into the bloom
        let moved = 0;
        for (let i = 0; i < J.max && moved < 26; i++) {
          const dx = J.P[i * 3] - a.pos.x, dz = J.P[i * 3 + 2] - a.pos.z;
          if (J.alive[i] && dx * dx + dz * dz < 30 * 30) continue;
          if (this._spawnJelly(i, 0, 0, c)) moved++;
        }
      }
    }
    // a curious ray comes to swim alongside (every 50 s)
    if (this._underT > 4 && t - this._rayT > 50) {
      const Rr = this.rays;
      let pick = -1;
      for (let i = 0; i < Rr.max; i++) if (Rr.alive[i] && Rr.a[i] < 0.5) { pick = i; break; }
      if (pick < 0) for (let i = 0; i < Rr.max; i++) if (!Rr.alive[i]) { if (this._spawnRay(i, 30, 40)) pick = i; break; }
      if (pick >= 0) {
        this._rayT = t;
        const i = pick;
        const side = Math.random() < 0.5 ? -1 : 1;
        // in from the dim water off to one side, ahead of the calf
        const ox = a.pos.x + fx * 24 + -fz * side * 26, oz = a.pos.z + fz * 24 + fx * side * 26;
        Rr.P[i * 3] = ox; Rr.P[i * 3 + 1] = Math.min(a.pos.y + 1, sea - 2); Rr.P[i * 3 + 2] = oz;
        Rr.yaw[i] = Math.atan2(a.pos.x - ox, a.pos.z - oz);
        Rr.a[i] = 1; // following
        Rr.t[i] = 20; // for this long
        Rr.b[i] = side;
      }
    }
  }

  _crabs(dt, t) {
    const C = this.crabs, I = this.inst.crab;
    const R = this.radius;
    let n = 0;
    for (let i = 0; i < C.max; i++) {
      if (!C.alive[i] || this._far(C.P[i * 3], C.P[i * 3 + 2])) {
        if (!C.ready(i, dt) || !this._spawnCrab(i, R * 0.75, R)) continue;
      }
      const k = i * 3;
      const vr = C.vr[i];
      const d = this._threat(C.P[k], C.P[k + 1], C.P[k + 2]);
      const s = C.s[i];
      // states: a hide (0..1), b claw display, c walk, d glow (alarm)
      let hideT = 0, clawT = 0, walkT = 0, speed = 0, dir = 0;
      if (d < 3 + s * 1.5) {
        hideT = 1;
        C.t2[i] = 2.5 + Math.random();
      } else if (C.t2[i] > 0) {
        C.t2[i] -= dt;
        hideT = 1;
      } else if (d < 9 + s * 2) {
        // alarm: glass crabs scuttle off, plate crabs rear up and wave their claws, hermits freeze
        if (vr === 1) { walkT = 1; speed = 1.8; dir = Math.atan2(_v2.x, _v2.z); }
        else if (vr === 2) clawT = 1;
        else hideT = 0.25;
      } else {
        // calm: wander sideways in short bursts, now and then wave a claw
        C.t[i] -= dt;
        if (C.t[i] <= 0) {
          C.t[i] = 1.5 + Math.random() * 4;
          C.d[i] = Math.random() < 0.55 ? (Math.random() < 0.5 ? -1 : 1) : 0;
          if (Math.random() < 0.15) C.d[i] = 2; // a claw wave
        }
        if (C.d[i] === 2) clawT = 0.6;
        else if (C.d[i] !== 0) { walkT = 1; speed = 0.35 + 0.15 * vr; dir = C.yaw[i] + C.d[i] * Math.PI * 0.5; }
      }
      const prevHide = C.a[i];
      C.a[i] += (hideT - C.a[i]) * Math.min(1, dt * (hideT > C.a[i] ? 7 : 1.2));
      C.b[i] += (clawT - C.b[i]) * Math.min(1, dt * 4);
      C.c[i] += (walkT - C.c[i]) * Math.min(1, dt * 5);
      if (prevHide < 0.5 && C.a[i] >= 0.5) this._puff(C.P[k], C.P[k + 1] + 0.2, C.P[k + 2], vr === 1 ? 'sand' : 'bubbles', s);
      if (speed > 0 && C.a[i] < 0.5) {
        const dx = Math.sin(dir) * speed * dt * s * 0.6, dz = Math.cos(dir) * speed * dt * s * 0.6;
        const nx = C.P[k] + dx, nz = C.P[k + 2] + dz;
        const fy = this.floorAt(nx, nz);
        if (G.uSeaLevel.value - fy > 0.8) {
          C.P[k] = nx; C.P[k + 2] = nz; C.P[k + 1] = fy;
          C.ph[i] += speed * dt * 14;
        } else C.d[i] = -C.d[i];
        // fleeing crabs turn their side to the threat (crabs run sideways)
        if (vr === 1 && walkT > 0 && d < 20) C.yaw[i] = dir - Math.PI * 0.5;
      }
      I.set(n++, C.P[k], C.P[k + 1], C.P[k + 2], C.yaw[i], s, C.seed[i], vr, C.ph[i], C.a[i], C.b[i], C.c[i], Math.max(C.b[i] * 0.5, vr === 2 ? C.a[i] : 0));
    }
    I.commit(n);
    this.stats.crabs = n;
  }

  _jellies(dt, t) {
    const J = this.jellies, I = this.inst.jelly;
    const sea = G.uSeaLevel.value;
    const R = this.radius;
    let n = 0;
    for (let i = 0; i < J.max; i++) {
      if (!J.alive[i] || this._far(J.P[i * 3], J.P[i * 3 + 2])) {
        if (!J.ready(i, dt) || !this._spawnJelly(i, R * 0.75, R)) continue;
      }
      const k = i * 3;
      const d = this._threat(J.P[k], J.P[k + 1], J.P[k + 2]);
      // flare and flee from a whale close by
      if (d < 4 + J.s[i]) {
        J.a[i] = Math.min(1, J.a[i] + dt * 5);
        J.V[k] += _v2.x * dt * 1.2; J.V[k + 1] += _v2.y * dt * 1.2; J.V[k + 2] += _v2.z * dt * 1.2;
      } else J.a[i] = Math.max(0, J.a[i] - dt * 0.6);
      const prev = J.ph[i];
      J.ph[i] += dt * (1.5 + J.a[i] * 3.5) / Math.sqrt(J.s[i]);
      // thrust on each contraction, a slow sink between
      const c = Math.max(Math.sin(J.ph[i]), 0);
      const tilt = J.pitch[i];
      J.V[k + 1] += (c * c * 1.1 - 0.16) * dt;
      J.V[k] += Math.sin(tilt) * c * 0.3 * dt + 0.06 * dt;
      J.V[k + 2] += 0.03 * dt;
      const drag = Math.exp(-dt * 1.4);
      J.V[k] *= drag; J.V[k + 1] *= drag; J.V[k + 2] *= drag;
      J.P[k] += J.V[k] * dt; J.P[k + 1] += J.V[k + 1] * dt; J.P[k + 2] += J.V[k + 2] * dt;
      // stay in the water column
      const top = sea - 1.2 - J.s[i] * 0.5, bot = J.floor[i] + 2;
      if (J.P[k + 1] > top) { J.P[k + 1] = top; J.V[k + 1] = Math.min(J.V[k + 1], -0.05); }
      if (J.P[k + 1] < bot) { J.P[k + 1] = bot; J.V[k + 1] = Math.max(J.V[k + 1], 0.1); }
      J.pitch[i] = Math.sin(t * 0.3 + J.seed[i] * 20) * 0.25;
      J.roll[i] = Math.cos(t * 0.27 + J.seed[i] * 13) * 0.2;
      I.set(n++, J.P[k], J.P[k + 1], J.P[k + 2], J.yaw[i], J.s[i], J.seed[i], J.ph[i], J.a[i], J.pitch[i], J.roll[i], 0, 0);
      void prev;
    }
    I.commit(n);
    this.stats.jellies = n;
  }

  _rays(dt, t) {
    const Rr = this.rays, I = this.inst.ray;
    const sea = G.uSeaLevel.value;
    const R = this.radius;
    const a = this.actor;
    let n = 0;
    for (let i = 0; i < Rr.max; i++) {
      if (!Rr.alive[i] || (Rr.a[i] < 0.5 && this._far(Rr.P[i * 3], Rr.P[i * 3 + 2], 1.3))) {
        if (!Rr.ready(i, dt) || !this._spawnRay(i, R * 0.8, R)) continue;
      }
      const k = i * 3;
      const s = Rr.s[i];
      let tx, ty, tz, speed;
      if (Rr.a[i] > 0.5 && a) {
        // alongside the calf: a little ahead and off to one side, matching its pace
        Rr.t[i] -= dt;
        if (Rr.t[i] <= 0) { Rr.a[i] = 0; Rr.t2[i] = 0; }
        const v = this._actorVel, sp = v.length();
        const fx = sp > 0.3 ? v.x / sp : Math.sin(a.yaw || 0), fz = sp > 0.3 ? v.z / sp : Math.cos(a.yaw || 0);
        const off = (a.L || 8) * 0.5 + s * 1.4 + 2;
        tx = a.pos.x + fx * 3 - fz * Rr.b[i] * off;
        tz = a.pos.z + fz * 3 + fx * Rr.b[i] * off;
        ty = Math.min(a.pos.y + 0.5, sea - 1.5 - s * 0.2);
        const dd = Math.hypot(tx - Rr.P[k], tz - Rr.P[k + 2]);
        speed = Math.min(9, Math.max(1.6, sp * 1.0 + dd * 0.25));
      } else {
        // gliding wide loops over home, rising and settling
        Rr.t2[i] += dt;
        const yaw = Rr.yaw[i] + Rr.d[i] * 0.12;
        tx = Rr.P[k] + Math.sin(yaw) * 8; tz = Rr.P[k + 2] + Math.cos(yaw) * 8;
        ty = Rr.H[k + 1] + Math.sin(Rr.t2[i] * 0.15 + Rr.seed[i] * 10) * 2;
        // drift back toward home if wandering off
        const hx = Rr.H[k] - Rr.P[k], hz = Rr.H[k + 2] - Rr.P[k + 2];
        const hd = Math.hypot(hx, hz);
        if (hd > 40) { tx = Rr.P[k] + hx / hd * 8; tz = Rr.P[k + 2] + hz / hd * 8; }
        speed = 2.0 + 0.3 * Math.sin(Rr.t2[i] * 0.4);
        // curious: a calf nearby draws it in for a look
        if (a && this._threat(Rr.P[k], Rr.P[k + 1], Rr.P[k + 2]) < 22 && Rr.t2[i] > 25) { Rr.a[i] = 1; Rr.t[i] = 14; Rr.b[i] = Math.random() < 0.5 ? -1 : 1; }
      }
      // steer: yaw toward target with a limited turn rate, bank into the turn
      const want = Math.atan2(tx - Rr.P[k], tz - Rr.P[k + 2]);
      let dy = want - Rr.yaw[i];
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const turn = Math.max(-0.7, Math.min(0.7, dy * 1.5)) ;
      Rr.yaw[i] += turn * dt;
      Rr.roll[i] += (-turn * 0.9 - Rr.roll[i]) * Math.min(1, dt * 2);
      const sp0 = Rr.c[i] || speed;
      Rr.c[i] = sp0 + (speed - sp0) * Math.min(1, dt * 0.8);
      const vy = Math.max(-1.5, Math.min(1.5, (ty - Rr.P[k + 1]) * 0.6));
      Rr.pitch[i] += (Math.atan2(vy, Rr.c[i]) - Rr.pitch[i]) * Math.min(1, dt * 2);
      Rr.P[k] += Math.sin(Rr.yaw[i]) * Rr.c[i] * dt;
      Rr.P[k + 2] += Math.cos(Rr.yaw[i]) * Rr.c[i] * dt;
      Rr.P[k + 1] += vy * dt;
      const floor = this.floorAt(Rr.P[k], Rr.P[k + 2]);
      if (Rr.P[k + 1] < floor + 1.5) Rr.P[k + 1] = floor + 1.5;
      if (Rr.P[k + 1] > sea - 1) Rr.P[k + 1] = sea - 1;
      // wing beats: slow and deep, quicker when hurrying
      const amp = Math.min(1, 0.45 + Math.abs(turn) * 0.5 + Math.max(0, Rr.c[i] - 2.5) * 0.15);
      Rr.ph[i] += dt * (1.0 + Rr.c[i] * 0.22);
      I.set(n++, Rr.P[k], Rr.P[k + 1], Rr.P[k + 2], Rr.yaw[i], s, Rr.seed[i], Rr.ph[i], 0, Rr.pitch[i], Rr.roll[i], amp, Rr.a[i] > 0.5 ? 0.8 : 0);
    }
    I.commit(n);
    this.stats.rays = n;
  }

  _puffers(dt, t) {
    const Pf = this.puffers, I = this.inst.puffer;
    const sea = G.uSeaLevel.value;
    const R = this.radius;
    let n = 0;
    for (let i = 0; i < Pf.max; i++) {
      if (!Pf.alive[i] || this._far(Pf.P[i * 3], Pf.P[i * 3 + 2])) {
        if (!Pf.ready(i, dt) || !this._spawnPuffer(i, R * 0.75, R)) continue;
      }
      const k = i * 3;
      const d = this._threat(Pf.P[k], Pf.P[k + 1], Pf.P[k + 2]);
      const startled = d < 5 + Pf.s[i];
      if (startled) Pf.t2[i] = 3;
      else Pf.t2[i] -= dt;
      const prev = Pf.a[i];
      if (Pf.t2[i] > 0) Pf.a[i] = Math.min(1, Pf.a[i] + dt * 5);
      else Pf.a[i] = Math.max(0, Pf.a[i] - dt * 0.35);
      if (prev < 0.5 && Pf.a[i] >= 0.5) this._puff(Pf.P[k], Pf.P[k + 1], Pf.P[k + 2], 'bubbles', Pf.s[i] * 0.7);
      // wander around home; a startled puffer backs off slowly (it is a ball now)
      Pf.t[i] -= dt;
      if (Pf.t[i] <= 0) {
        Pf.t[i] = 2.5 + Math.random() * 4;
        Pf.H[k] += (Math.random() - 0.5) * 6; Pf.H[k + 2] += (Math.random() - 0.5) * 6;
        const fl = this.floorAt(Pf.H[k], Pf.H[k + 2]);
        Pf.H[k + 1] = Math.min(sea - 1.5, fl + 1 + Math.random() * 3);
      }
      let ax = Pf.H[k] - Pf.P[k], ay = Pf.H[k + 1] - Pf.P[k + 1], az = Pf.H[k + 2] - Pf.P[k + 2];
      const hl = Math.hypot(ax, ay, az) || 1;
      const sp = (0.55 - Pf.a[i] * 0.35) * Pf.s[i] * 0.5;
      ax = ax / hl * sp; ay = ay / hl * sp * 0.5; az = az / hl * sp;
      if (d < 12) { ax += _v2.x * 0.6; ay += _v2.y * 0.3; az += _v2.z * 0.6; }
      const e = Math.min(1, dt * 1.5);
      Pf.V[k] += (ax - Pf.V[k]) * e; Pf.V[k + 1] += (ay - Pf.V[k + 1]) * e; Pf.V[k + 2] += (az - Pf.V[k + 2]) * e;
      Pf.P[k] += Pf.V[k] * dt; Pf.P[k + 1] += Pf.V[k + 1] * dt; Pf.P[k + 2] += Pf.V[k + 2] * dt;
      if (Pf.P[k + 1] > sea - 1) Pf.P[k + 1] = sea - 1;
      const hs = Math.hypot(Pf.V[k], Pf.V[k + 2]);
      if (hs > 0.05) {
        // face where it swims (or the threat, eyes wide, when puffed up)
        let want = Math.atan2(Pf.V[k], Pf.V[k + 2]);
        if (Pf.a[i] > 0.5 && d < 15) want = Math.atan2(-_v2.x, -_v2.z);
        let dy = want - Pf.yaw[i];
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        Pf.yaw[i] += dy * Math.min(1, dt * 3);
      }
      Pf.ph[i] += dt * (5 + hs * 6);
      Pf.pitch[i] = Math.sin(t * 0.7 + Pf.seed[i] * 10) * 0.1;
      I.set(n++, Pf.P[k], Pf.P[k + 1] + Math.sin(t * 1.3 + Pf.seed[i] * 7) * 0.05, Pf.P[k + 2], Pf.yaw[i], Pf.s[i], Pf.seed[i], Pf.ph[i], Pf.a[i], Pf.pitch[i], 0, Pf.a[i], 0);
    }
    I.commit(n);
    this.stats.puffers = n;
  }

  _eels(dt, t) {
    const E = this.eels, I = this.inst.eel;
    const sea = G.uSeaLevel.value;
    const R = this.radius;
    let n = 0;
    for (let i = 0; i < E.max; i++) {
      if (!E.alive[i] || this._far(E.P[i * 3], E.P[i * 3 + 2])) {
        if (!E.ready(i, dt) || !this._spawnEel(i, R * 0.7, R)) continue;
      }
      const k = i * 3;
      const sd = E.seed[i] * 50;
      const d = this._threat(E.P[k], E.P[k + 1], E.P[k + 2]);
      let tx, ty, tz, speed;
      if (d < 6) { E.t[i] = 1.6; E.a[i] = 1; }
      if (E.t[i] > 0) {
        // darting away, glowing
        E.t[i] -= dt;
        tx = E.P[k] + _v2.x * 6; ty = E.P[k + 1] + _v2.y * 2; tz = E.P[k + 2] + _v2.z * 6;
        speed = 4.5;
      } else {
        E.a[i] = Math.max(0, E.a[i] - dt * 0.8);
        // weaving through the kelp around home
        tx = E.H[k] + Math.sin(t * 0.21 + sd) * 7 + Math.sin(t * 0.53 + sd * 2) * 2;
        tz = E.H[k + 2] + Math.cos(t * 0.17 + sd) * 7 + Math.sin(t * 0.47 + sd * 3) * 2;
        ty = E.H[k + 1] + Math.sin(t * 0.3 + sd) * 1.5;
        speed = 1.3;
      }
      const dx = tx - E.P[k], dy = ty - E.P[k + 1], dz = tz - E.P[k + 2];
      const want = Math.atan2(dx, dz);
      let dyaw = want - E.yaw[i];
      dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      E.yaw[i] += Math.max(-2.5, Math.min(2.5, dyaw * 3)) * dt;
      const hd = Math.hypot(dx, dz) || 1;
      E.pitch[i] += (Math.atan2(dy, hd) * 0.8 - E.pitch[i]) * Math.min(1, dt * 2);
      const c = E.c[i] = (E.c[i] || speed) + (speed - (E.c[i] || speed)) * Math.min(1, dt * 3);
      E.P[k] += Math.sin(E.yaw[i]) * Math.cos(E.pitch[i]) * c * dt;
      E.P[k + 2] += Math.cos(E.yaw[i]) * Math.cos(E.pitch[i]) * c * dt;
      E.P[k + 1] += Math.sin(E.pitch[i]) * c * dt;
      if (E.P[k + 1] > sea - 1.2) E.P[k + 1] = sea - 1.2;
      if (E.P[k + 1] < E.floor[i] + 0.6) E.P[k + 1] = E.floor[i] + 0.6;
      E.ph[i] += dt * (5 + c * 3);
      I.set(n++, E.P[k], E.P[k + 1], E.P[k + 2], E.yaw[i], E.s[i], E.seed[i], E.ph[i], E.a[i], E.pitch[i], 0, 0, 0);
    }
    I.commit(n);
    this.stats.eels = n;
  }

  // ---- effects -------------------------------------------------------------------------------
  _puff(x, y, z, kind, s = 1) {
    const g = this.game;
    const mist = g.mist;
    if (!mist) return;
    const n = Math.round(4 + s * 4);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      if (kind === 'sand') {
        mist.emit({
          pos: _v.set(x + Math.cos(a) * 0.3 * s, y, z + Math.sin(a) * 0.3 * s), vel: _v2.set(Math.cos(a) * 0.6, 0.4 + Math.random() * 0.5, Math.sin(a) * 0.6),
          life: 1.6 + Math.random(), size: 0.25 * s, sizeEnd: 0.9 * s, color: [0.75, 0.68, 0.52], alpha: 0.35, drag: 1.6, gravity: 0.15, kind: 0, fadeIn: 0.05,
        });
      } else {
        mist.emit({
          pos: _v.set(x + Math.cos(a) * 0.2 * s, y + Math.random() * 0.2, z + Math.sin(a) * 0.2 * s), vel: _v2.set(Math.cos(a) * 0.3, 0.6 + Math.random() * 0.8, Math.sin(a) * 0.3),
          life: 1.6 + Math.random() * 1.2, size: 0.03 + Math.random() * 0.05 * s, sizeEnd: 0.06, color: [0.9, 1, 1], alpha: 0.8, drag: 0.4, gravity: -1.2, kind: 4, fadeIn: 0.05,
        });
      }
    }
  }

  _gulpFx(x, y, z, glow) {
    const g = this.game;
    if (g.glow && glow) {
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * TAU;
        g.glow.emit({
          pos: _v.set(x, y, z), vel: _v2.set(Math.cos(a) * 1.2, (Math.random() - 0.3) * 1.2, Math.sin(a) * 1.2),
          life: 0.8 + Math.random() * 0.6, size: 0.12, sizeEnd: 0.02, color: [0.3, 0.9, 1.0], alpha: 0.8, drag: 1.2, gravity: 0, kind: 1,
        });
      }
    }
    this._puff(x, y, z, 'bubbles', 1.2);
  }

  // ---- food ------------------------------------------------------------------------------------
  /**
   * Creatures inside the mouth sphere are eaten (crabs, puffers, jellies); they come back later
   * somewhere out of sight. Returns food units (see REEF_FOOD).
   */
  eatAt(mouth, r, max = 4) {
    if (!this.enabled || !this.visible) return 0;
    this._food = 0;
    this._n = 0;
    this._eatPool(this.crabs, mouth, r, max, 0.25, 0, 'crab');
    this._eatPool(this.puffers, mouth, r, max, 0.25, 0.7, 'puffer');
    this._eatPool(this.jellies, mouth, r, max, 0.45, 0, 'jelly');
    const food = this._food;
    if (food > 0) { this.stats.eaten += food; this.lastEaten = this.game.time; }
    this.lastCount = this._n;
    return food;
  }

  _eatPool(Pl, mouth, r, max, rk, grow, kind) {
    for (let i = 0; i < Pl.max && this._n < max; i++) {
      if (!Pl.alive[i]) continue;
      const k = i * 3;
      const dx = Pl.P[k] - mouth.x, dy = Pl.P[k + 1] - mouth.y, dz = Pl.P[k + 2] - mouth.z;
      const R = r + rk * Pl.s[i] * (1 + Pl.a[i] * grow);
      if (dx * dx + dy * dy + dz * dz > R * R) continue;
      this._gulpFx(Pl.P[k], Pl.P[k + 1], Pl.P[k + 2], kind !== 'crab');
      Pl.alive[i] = 0; // respawns out of sight next frame
      this._food += REEF_FOOD[kind];
      this._n++;
    }
  }

  /** Nearest edible creature within maxDist (a reused object), or null. */
  nearestFood(pos, maxDist = 16) {
    if (!this.enabled || !this.visible) return null;
    this._best = maxDist * maxDist;
    this._bi = -1;
    this._scan(this.crabs, pos, 'crab');
    this._scan(this.puffers, pos, 'puffer');
    this._scan(this.jellies, pos, 'jelly');
    if (this._bi < 0) return null;
    const bp = this._bp, bi = this._bi;
    const f = this.food;
    f.pos.set(bp.P[bi * 3], bp.P[bi * 3 + 1], bp.P[bi * 3 + 2]);
    f.dist = Math.sqrt(this._best);
    f.kind = this._bk;
    f.depth = G.uSeaLevel.value - f.pos.y;
    return f;
  }

  _scan(Pl, pos, kind) {
    for (let i = 0; i < Pl.max; i++) {
      if (!Pl.alive[i]) continue;
      const k = i * 3;
      const dx = Pl.P[k] - pos.x, dy = Pl.P[k + 1] - pos.y, dz = Pl.P[k + 2] - pos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < this._best) { this._best = d2; this._bi = i; this._bp = Pl; this._bk = kind; }
    }
  }

  clear() {
    for (const Pl of [this.crabs, this.jellies, this.rays, this.puffers, this.eels]) Pl.alive.fill(0);
    this._scatterAt.set(1e9, 0, 1e9);
    this._bloomT = -1e9;
    this._rayT = -1e9;
  }

  dispose() {
    for (const I of this.instList) {
      I.mesh.parent?.remove(I.mesh);
      I.geo.dispose();
      I.mesh.material.dispose();
    }
  }
}
