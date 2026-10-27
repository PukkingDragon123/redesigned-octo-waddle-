// The living sky: a functioning food chain around the herd.
//   moisture-rich cloud -> cloud plankton (drifting motes) -> sky krill (swarms)
//   -> sky rays and whales; sky jellies graze plankton; puffbirds roost on the elders' backs.
//
// One facade over five instanced systems (a handful of draw calls in total). Everything is
// lit by the shared stylized light model, fogged, and (rays, jellies) casts shadows.
//
//   const eco = new Ecosystem(game);          // call eco.update(dt) once per frame
//   eco.addKrillSwarm(center, 900);
//   eco.addRaySchool(center, 7);
//   eco.addJellies(center, 60, 10);
//   eco.addFlock(center, 60);
//   eco.eat(calfMouthPos, 0.8, dt, calf);     // from the calf every frame while feeding
//   eco.scatter(boomCenter, radius, strength); // sonic booms
//   eco.songFocus = herd.songCenter;          // rays circle, krill spiral
//   eco.threat = falcon.pos;                  // everything flees, birds scatter
//   eco.roosts = [...];                       // whale backs for the puffbirds
import { Vector3, Vector4, Frustum, Matrix4, Sphere } from 'three';
import { G } from '../render/Globals.js';
import { KrillSystem } from './eco/Krill.js';
import { RaySystem } from './eco/Rays.js';
import { JellySystem } from './eco/Jellies.js';
import { BirdSystem } from './eco/Birds.js';
import { PlanktonSystem } from './eco/Plankton.js';

const MAX_TRANSIENT = 48;

export class Ecosystem {
  constructor(game, opts = {}) {
    this.game = game;
    /** Vector3 | null: the herd is singing here. Rays circle it, krill spiral around it. */
    this.songFocus = null;
    /** Radius (m) of the singing whale(s): spirals and circles start outside it. */
    this.songRadius = opts.songRadius ?? 16;
    /** Vector3 | null: the falcon. Everything flees; birds scatter. */
    this.threat = null;
    /**
     * Whale backs puffbirds can perch on: Whale objects work directly (pos, up, fwd, L), or any
     * { pos, up, fwd?, L? | lift?, spread?, curve? }. Without L/lift, pos is taken as a point on the back.
     */
    this.roosts = [];
    /**
     * Optional: whales whose open mouths eat krill automatically (e.g. herd.adults while feeding).
     * Objects with pos, fwd, L and drive.mouth (Whale objects work), or { mouthPos, mouthRadius, open }.
     */
    this.feeders = [];
    /** Rays, jellies and birds stay above this height (the cloud sea's tops). */
    this.floorY = opts.floorY ?? 90;
    /** Read G.uBooms / G.uSongRipple automatically (sonic booms scatter creatures, songs focus them). */
    this.autoHooks = opts.autoHooks ?? true;
    this.enabled = true;

    this.krill = new KrillSystem(this);
    this.rays = new RaySystem(this);
    this.jellies = new JellySystem(this);
    this.birds = new BirdSystem(this);
    this.plankton = new PlanktonSystem(this);
    this.autoPlankton = opts.plankton !== false;
    if (this.autoPlankton) this.plankton.sync(game.clouds);

    this._transient = []; // short-lived predators: mouths, shocks
    this._mouthOf = new WeakMap();
    this._mouthByOwner = new WeakMap();
    this._mouths = [];
    this._fronts = [];
    this._recentScatter = [];
    this._boomSeen = G.uBooms.value.map((b) => b.w);
    this._threatPrev = new Vector3();
    this._threatVel = new Vector3();
    this._threatT = -1;
    this._syncT = 0;
    this._moist = [];
    this._frustum = new Frustum();
    this._pv = new Matrix4();
    this._sph = new Sphere();
    this.stats = { ms: 0, msAvg: 0, krill: 0, nearKrill: 0, rays: 0, jellies: 0, birds: 0, plankton: 0, t: { krill: 0, rays: 0, jellies: 0, birds: 0, plankton: 0 } };
    const sph = this._sph;
    this.ctx = {
      time: 0,
      dt: 0,
      cam: new Vector3(),
      camFwd: new Vector3(),
      frustum: this._frustum,
      sphere: (c, r) => { sph.center.copy(c); sph.radius = r; return sph; },
      drift: new Vector3(),
      cloudDriftVel: new Vector3(),
      wind: new Vector3(),
      moist: this._moist,
      predators: [],
      songFocus: null,
      songRadius: 16,
      floorY: 90,
      threat: null,
      threatVel: this._threatVel,
      movers: [],
      roosts: this.roosts,
      eco: this,
    };
  }

  // ---- public API ------------------------------------------------------------------------

  /** A krill swarm (default 600). opts: { radius, flow, palette 0-3, seed, anchor (Vector3 to follow), leash, graze } */
  addKrillSwarm(center, count = 600, opts = {}) {
    return this.krill.addSwarm(center, count, opts);
  }

  /** A school of sky rays (3-12). opts: { span: [min,max] m, palette, seed, anchor, leash, feed, leap } */
  addRaySchool(center, count = 6, opts = {}) {
    return this.rays.addSchool(center, count, opts);
  }

  /** Sky jellies drifting with the wind around center. opts: { size: [min,max] m, palette, seed } */
  addJellies(center, spread = 40, count = 10, opts = {}) {
    return this.jellies.addGroup(center, spread, count, opts);
  }

  /** A puffbird flock (murmuration; perches on this.roosts). opts: { palette, seed, anchor, leash, roost } */
  addFlock(center, count = 60, opts = {}) {
    return this.birds.addFlock(center, count, opts);
  }

  /** Seed cloud plankton in a moisture-rich cloud cluster (done automatically for moist clusters). */
  addPlankton(cluster, opts = {}) {
    return this.plankton.add(cluster, opts);
  }

  /**
   * Krill inside the mouth are eaten (hidden, respawned into their swarm later) with a small
   * sparkle. The mouth also scares nearby krill (they flee, but slower than a whale).
   * Pass `owner` (e.g. the whale) so nearby mouths never swap their frame-to-frame records.
   * Returns the number eaten by this call.
   */
  eat(mouthPos, mouthRadius = 0.8, dt = 1 / 60, owner = null) {
    if (!this.enabled) return 0;
    const t = this.game.time;
    let rec = null;
    if (owner) rec = this._mouthByOwner.get(owner) || null;
    else {
      // match this mouth to last frame's nearest (works whether or not the caller reuses its Vector3)
      let best = 36;
      for (const m of this._mouths) {
        const d2 = m.pos.distanceToSquared(mouthPos);
        if (m.t === t) {
          if (d2 < 1e-6) { rec = m; break; }
        } else if (t - m.t < 0.3 && d2 < best) { rec = m; best = d2; }
      }
    }
    if (!rec) {
      rec = { pos: new Vector3(), vel: new Vector3(), prevSeg: new Vector3(), t: -Infinity, pred: null };
      if (owner) this._mouthByOwner.set(owner, rec);
      else {
        if (this._mouths.length > 8) this._mouths.shift();
        this._mouths.push(rec);
      }
    }
    let prev = null;
    const el = t - rec.t;
    if (el >= 0.3) {
      // new, or not seen for a while: no sweep from a stale position, no speed
      rec.vel.set(0, 0, 0);
      rec.prevSeg.copy(mouthPos);
    } else if (el > 1e-4) {
      rec.vel.subVectors(mouthPos, rec.pos).divideScalar(el);
      if (rec.vel.lengthSq() > 3600) rec.vel.setLength(60);
      prev = rec.prevSeg.copy(rec.pos);
    } else prev = rec.prevSeg;
    rec.pos.copy(mouthPos);
    rec.t = t;
    const n = this.krill.eat(mouthPos, prev, mouthRadius);
    // the mouth as a predator: krill sense its pressure wave ahead of it
    const sp = rec.vel.length();
    const pred = rec.pred || (rec.pred = { x: 0, y: 0, z: 0, r: 0, s: 0, vx: 0, vy: 0, vz: 0, life: 0 });
    pred.x = mouthPos.x + rec.vel.x * 0.05; pred.y = mouthPos.y + rec.vel.y * 0.05; pred.z = mouthPos.z + rec.vel.z * 0.05;
    pred.r = mouthRadius * 1.6 + 1.4 + sp * 0.14;
    pred.s = 0.5;
    pred.vx = rec.vel.x; pred.vy = rec.vel.y; pred.vz = rec.vel.z;
    pred.life = 0.25;
    if (!this._transient.includes(pred)) this._addTransient(pred);
    return n;
  }

  /**
   * Sonic boom / shock: krill are blown outward and flash, rays and birds flee, jellies are
   * pushed and contract. The shock travels outward as a front at `speed` m/s (default matches
   * SonicBooms: 70 + 0.6 * radius); pass speed = 0 for an instant shock.
   */
  scatter(center, radius = 40, strength = 1, speed = 70 + radius * 0.6) {
    this._recentScatter.push({ c: center.clone(), t: this.game.time });
    if (this._recentScatter.length > 6) this._recentScatter.shift();
    this._startFront(center, radius, strength, speed);
  }

  /** Nearest krill swarm: { swarm, pos (a point on its ribbon), dist } or null. */
  nearestSwarm(pos) {
    return this.krill.nearest(pos);
  }

  /** Remove every creature (chapter restart). Plankton re-seeds from moist clouds automatically. */
  clear() {
    this.krill.clear();
    this.rays.clear();
    this.jellies.clear();
    this.birds.clear();
    this.plankton.clear();
    this._transient.length = 0;
    this._mouths.length = 0;
    this._mouthByOwner = new WeakMap();
    this._fronts.length = 0;
    this.songFocus = null;
    this.threat = null;
    this._threatT = -1;
  }

  /** Remove groups whose home is farther than `radius` from `center` (long migrations). */
  prune(center, radius) {
    const r2 = radius * radius;
    for (const sw of this.krill.swarms.slice()) if (sw.home.distanceToSquared(center) > r2) this.krill.removeSwarm(sw);
    this.rays.prune(center, r2);
    this.jellies.prune(center, r2);
    this.birds.prune(center, r2);
    this.plankton.prune(center, r2);
  }

  dispose() {
    for (const s of [this.krill, this.rays, this.jellies, this.birds, this.plankton]) s.dispose();
  }

  // ---- per frame ------------------------------------------------------------------------
  update(dt) {
    if (!this.enabled) return;
    const t0 = performance.now();
    const g = this.game;
    dt = Math.min(Math.max(dt, 0), 0.1);
    const ctx = this.ctx;
    ctx.time = g.time;
    ctx.dt = dt;
    const cam = g.engine.camera;
    ctx.cam.copy(cam.position);
    cam.getWorldDirection(ctx.camFwd);
    this._pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._pv);
    ctx.drift.copy(g.wind.drift);
    ctx.wind.copy(g.wind.base);
    ctx.cloudDriftVel.copy(g.wind.driftVel);
    ctx.roosts = this.roosts;
    ctx.songRadius = this.songRadius;
    ctx.floorY = this.floorY;

    // cloud bookkeeping (cheap, every couple of seconds)
    this._syncT -= dt;
    if (this._syncT <= 0) {
      this._syncT = 2;
      this._moist.length = 0;
      for (const c of g.clouds.moistClusters()) this._moist.push(c);
      if (this.autoPlankton) this.plankton.sync(g.clouds);
    }

    // song focus (explicit, or the herd's song ripple)
    ctx.songFocus = this.songFocus;
    if (!ctx.songFocus && this.autoHooks && G.uSongAmp.value > 0.05 && G.uSongRipple.value.y > -9000) {
      ctx.songFocus = this._songTmp || (this._songTmp = new Vector3());
      ctx.songFocus.set(G.uSongRipple.value.x, G.uSongRipple.value.y, G.uSongRipple.value.z);
    }
    // threat and its velocity (for anticipation)
    ctx.threat = this.threat;
    if (this.threat) {
      if (this._threatT >= 0 && g.time - this._threatT < 0.5 && g.time > this._threatT) {
        const v = this._threatVel.subVectors(this.threat, this._threatPrev).divideScalar(g.time - this._threatT);
        if (v.length() > 80) v.setLength(80);
      } else this._threatVel.set(0, 0, 0);
      this._threatPrev.copy(this.threat);
      this._threatT = g.time;
    } else this._threatT = -1;

    // automatic sonic booms from the shared uniforms
    if (this.autoHooks) this._watchBooms();

    // predators the krill react to this frame
    const P = ctx.predators;
    P.length = 0;
    for (let i = this._transient.length - 1; i >= 0; i--) {
      const q = this._transient[i];
      q.life -= dt;
      if (q.life <= 0) { this._transient.splice(i, 1); continue; }
      if (q.decay) q.s = q.s0 * Math.min(1, q.life / q.decay);
      P.push(q);
    }
    if (this.threat) {
      const tv = this._threatVel;
      const th = this._threatPred || (this._threatPred = { x: 0, y: 0, z: 0, r: 26, s: 1.3, vx: 0, vy: 0, vz: 0 });
      th.x = this.threat.x + tv.x * 0.3; th.y = this.threat.y + tv.y * 0.3; th.z = this.threat.z + tv.z * 0.3;
      th.vx = tv.x; th.vy = tv.y; th.vz = tv.z;
      P.push(th);
    }
    // big whales part the swarms (G.uMovers: xyz, radius; velocity from G.uMoverVel or estimated)
    ctx.movers.length = 0;
    const mv = G.uMovers.value, mvv = G.uMoverVel.value;
    const mp = this._moverPrev || (this._moverPrev = mv.map(() => new Vector4(0, -9999, 0, -1)));
    for (let i = 0; i < mv.length; i++) {
      const m = mv[i];
      if (m.w <= 0 || m.y < -9000) { mp[i].w = -1; continue; }
      ctx.movers.push(m);
      const q = this._moverPreds?.[i] || ((this._moverPreds ||= [])[i] = { x: 0, y: 0, z: 0, r: 0, s: 0.7, vx: 0, vy: 0, vz: 0 });
      let vx = mvv[i].x, vy = mvv[i].y, vz = mvv[i].z;
      if (vx === 0 && vy === 0 && vz === 0) {
        const el = g.time - mp[i].w;
        if (mp[i].w >= 0 && el > 1e-4 && el < 0.5) {
          vx = q.vx + ((m.x - mp[i].x) / el - q.vx) * 0.3;
          vy = q.vy + ((m.y - mp[i].y) / el - q.vy) * 0.3;
          vz = q.vz + ((m.z - mp[i].z) / el - q.vz) * 0.3;
        }
        if (el > 1e-4 || mp[i].w < 0) mp[i].set(m.x, m.y, m.z, g.time);
      }
      q.x = m.x; q.y = m.y; q.z = m.z; q.r = m.w * 1.35 + 2;
      q.vx = vx; q.vy = vy; q.vz = vz;
      P.push(q);
    }
    // whales feeding with open mouths
    for (const f of this.feeders) this._feed(f, dt);
    this.rays.pushPredators(P);

    this._advanceFronts(dt);

    // per-system timing (exponential averages in this.stats.t, ms)
    const T = this.stats.t;
    let t1 = performance.now(), t2;
    this.krill.update(dt, ctx);
    t2 = performance.now(); T.krill += (t2 - t1 - T.krill) * 0.05; t1 = t2;
    this.rays.update(dt, ctx);
    t2 = performance.now(); T.rays += (t2 - t1 - T.rays) * 0.05; t1 = t2;
    this.jellies.update(dt, ctx);
    t2 = performance.now(); T.jellies += (t2 - t1 - T.jellies) * 0.05; t1 = t2;
    this.birds.update(dt, ctx);
    t2 = performance.now(); T.birds += (t2 - t1 - T.birds) * 0.05; t1 = t2;
    this.plankton.update(dt, ctx);
    t2 = performance.now(); T.plankton += (t2 - t1 - T.plankton) * 0.05;

    const ms = performance.now() - t0;
    const s = this.stats;
    s.ms = ms;
    s.msAvg = s.msAvg ? s.msAvg * 0.95 + ms * 0.05 : ms;
    s.krill = this.krill.n;
    s.nearKrill = this.krill.nearCount;
    s.rays = this.rays.rays.length;
    s.jellies = this.jellies.jellies.length;
    s.birds = this.birds.birds.length;
    s.plankton = this.plankton.count;
  }

  // ---- internals ------------------------------------------------------------------------
  _feed(f, dt) {
    if (!f) return;
    let open, pos, r;
    if (f.mouthPos) {
      open = f.open ?? 1;
      pos = f.mouthPos;
      r = f.mouthRadius ?? 1.5;
    } else {
      if (!f.pos || !f.fwd) return;
      open = f.drive ? f.drive.mouth ?? 0 : f.mouth ?? 0;
      const L = f.L ?? 20;
      pos = this._mouthOf.get(f);
      if (!pos) this._mouthOf.set(f, (pos = new Vector3()));
      pos.copy(f.pos).addScaledVector(f.fwd, L * 0.48);
      r = L * 0.11 * Math.min(1, open * 1.4);
    }
    if (open < 0.4 || r <= 0) return;
    // only bother when a swarm is close to the mouth
    let near = false;
    for (const sw of this.krill.swarms) {
      const rr = sw.extent + r + 20;
      if (sw.center.distanceToSquared(pos) < rr * rr) { near = true; break; }
    }
    if (near) this.eat(pos, r, dt, f);
  }

  _addTransient(q) {
    if (this._transient.length >= MAX_TRANSIENT) this._transient.shift();
    this._transient.push(q);
  }

  _startFront(center, radius, strength, speed) {
    const f = { c: center.clone(), radius, strength, speed, r: 0 };
    if (!speed || speed <= 0) {
      this._applyShock(f.c, 0, radius, radius, strength);
    } else {
      this._fronts.push(f);
    }
    // a lingering pressure field keeps krill dispersed for a moment, then they re-form
    this._addTransient({ x: center.x, y: center.y, z: center.z, r: radius * 0.75, s: 1.2 * strength, s0: 1.2 * strength, decay: 2.5, vx: 0, vy: 0, vz: 0, life: 2.5 + radius / Math.max(speed || 1e9, 1) });
  }

  _advanceFronts(dt) {
    for (let i = this._fronts.length - 1; i >= 0; i--) {
      const f = this._fronts[i];
      const r0 = f.r;
      f.r = Math.min(f.radius, f.r + f.speed * dt);
      this._applyShock(f.c, r0, f.r, f.radius, f.strength);
      if (f.r >= f.radius) this._fronts.splice(i, 1);
    }
  }

  _applyShock(c, rIn, rOut, radius, strength) {
    this.krill.shock(c, rIn, rOut, radius, strength);
    this.rays.shock(c, rIn, rOut, radius, strength);
    this.jellies.shock(c, rIn, rOut, radius, strength);
    this.birds.shock(c, rIn, rOut, radius, strength);
  }

  _watchBooms() {
    const b = G.uBooms.value, bp = G.uBoomParams.value;
    const t = this.game.time;
    for (let i = 0; i < b.length; i++) {
      const w = b[i].w;
      if (w === this._boomSeen[i]) continue;
      this._boomSeen[i] = w;
      if (t - w > 0.6 || w < 0) continue;
      const c = new Vector3(b[i].x, b[i].y, b[i].z);
      // skip booms the game already reported through scatter()
      if (this._recentScatter.some((s) => Math.abs(s.t - w) < 0.6 && s.c.distanceTo(c) < 8)) continue;
      const radius = bp[i].x > 0 ? bp[i].x : 40;
      const speed = bp[i].z > 0 ? bp[i].z : 80;
      this._startFront(c, radius * 1.2, Math.min(2, 0.6 + radius / 80), speed);
    }
  }
}
