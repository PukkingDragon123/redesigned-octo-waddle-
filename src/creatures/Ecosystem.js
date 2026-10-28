// The living sea of Vur Sok: fish schools under the surface and bird-reptiles above it, one food
// chain around the herd.
//   plankton -> glintfin (bait balls in thousands) -> spiralbacks, lanternjacks, skimmers,
//   coilwings and the whales; the whales' spiral bubble net drives the fish up to the surface.
//
// One facade over a few instanced systems (a handful of draw calls in total). Everything is lit
// by the shared stylized light model and fogged through the water column (common.js applyFog).
//
//   const eco = new Ecosystem(game);                 // call eco.update(dt) once per frame
//   eco.addFishSchool(pos, 'glintfin', 1200);         // 'glintfin' | 'spiralback' | 'lanternjack'
//   eco.addReptileFlock(pos, 'coilwing', 80);         // 'skimmer' | 'coilwing'
//   eco.perches = world.perches;                      // rock tops, ledges, trees to land on
//   eco.roosts = [...whales];                         // coilwings ride the whales' backs
//   eco.feeders = herd.adults;                        // open mouths eat automatically
//   eco.eat(calfMouthPos, r, dt, calf);               // the calf feeding (returns food eaten)
//   eco.nearestSwarm(pos);                            // nearest fish school { pos, dist, ... }
//   eco.scatter(boomCenter, radius, strength);        // sonic booms
//   eco.bubbleNet(center, radius);                    // an explicit bubble net (also automatic)
//   eco.songFocus = herd.songCenter;                  // fish form spirals, coilwings wheel
//   eco.threat = falcon.pos;                          // birds flee, fish sound
// The sea surface comes from eco.ocean (default game.ocean; a flat sea at y = 0 without one).
import { Vector3, Frustum, Matrix4, Sphere } from 'three';
import { G } from '../render/Globals.js';
import { FishSystem } from './eco/Fish.js';
import { ReptileSystem } from './eco/Reptiles.js';
import { BubbleSystem } from './eco/Bubbles.js';
import { SeaGlow } from './eco/SeaGlow.js';

const MAX_TRANSIENT = 48;
const NO_PERCHES = [];
const _v = new Vector3();
const _v2 = new Vector3();

export class Ecosystem {
  constructor(game, opts = {}) {
    this.game = game;
    /** Vector3 | null: the herd is singing here. Fish spiral under it, coilwings wheel above. */
    this.songFocus = null;
    /** Radius (m) of the singing whale(s): spirals start outside it. */
    this.songRadius = opts.songRadius ?? 16;
    /** Vector3 | null: the falcon. Birds flee, take cover on perches and scatter. */
    this.threat = null;
    /**
     * Whale backs coilwings can ride: Whale objects work directly (pos, up, fwd, L, model.prof),
     * or any { pos, up, fwd?, L? | lift?, spread? }.
     */
    this.roosts = [];
    /**
     * Whales whose open mouths eat fish automatically (e.g. herd.adults while lunging).
     * Objects with pos, fwd, L and drive.mouth (Whale objects work), or { mouthPos, mouthRadius, open }.
     */
    this.feeders = [];
    /** Whale bodies the fish part around and whose circling makes a bubble net (default: the herd). */
    this.whales = null;
    /** Places bird-reptiles land: [{ p: Vector3, n: Vector3, chapter, ledge?, tree? }] (world.perches). */
    this.perches = null;
    /** Sea-floor height (x, z) => y, so shallow-water fish stay off the bottom (default: the world's). */
    this.seabedAt = null;
    /** Read G.uBooms / G.uSongRipple automatically (sonic booms scatter creatures, songs focus them). */
    this.autoHooks = opts.autoHooks ?? true;
    /** Emit bubble curtains for nets the herd blows (set false if the herd draws its own). */
    this.netBubbles = opts.netBubbles ?? true;
    this.enabled = true;
    this._ocean = undefined;

    this.fish = new FishSystem(this);
    this.reptiles = new ReptileSystem(this);
    this.bubbles = new BubbleSystem(this);
    /** Night plankton in the water: flares where fish, whales and the calf stir it. */
    this.plankton = new SeaGlow(this);

    this._transient = []; // short-lived predators: mouths, shocks
    this._mouthOf = new WeakMap();
    this._mouthByOwner = new WeakMap();
    this._mouths = [];
    this._fronts = [];
    this._recentScatter = [];
    this._nets = [];
    this._boomSeen = G.uBooms.value.map((b) => b.w);
    this._whalePreds = new WeakMap();
    this._bubbleT = new WeakMap();
    this._splashBudget = 0;
    this._frustum = new Frustum();
    this._pv = new Matrix4();
    this._sph = new Sphere();
    this._whaleList = [];
    this.stats = { ms: 0, msAvg: 0, fish: 0, fishVisible: 0, near: 0, tris: 0, schools: 0, birds: 0, bubbles: 0, t: { fish: 0, birds: 0 } };
    const sph = this._sph;
    this.ctx = {
      time: 0,
      dt: 0,
      cam: new Vector3(),
      camFwd: new Vector3(),
      frustum: this._frustum,
      sphere: (c, r) => { sph.center.copy(c); sph.radius = r; return sph; },
      wind: new Vector3(),
      predators: [],
      whales: this._whaleList,
      nets: [],
      songFocus: null,
      songRadius: 16,
      threat: null,
      threatVel: new Vector3(),
      roosts: this.roosts,
      perches: [],
      seabed: null,
      eco: this,
    };
    this._threatPrev = new Vector3();
    this._threatT = -1;
    this._plDone = new Set(); // chapters whose world plankton blooms were added
    this._plSeen = -1;
  }

  // ---- the sea ----------------------------------------------------------------------------
  /** The ocean the creatures live in (game.ocean unless set). */
  get ocean() {
    if (this._ocean !== undefined) return this._ocean;
    return this.game.ocean || null;
  }
  set ocean(o) { this._ocean = o; }

  /** Sea surface height at (x, z): accurate (ocean.heightAt), else the flat sea at y = 0. */
  seaHeight(x, z) {
    const o = this.ocean;
    if (o && o.enabled !== false && o.heightAt) return o.heightAt(x, z);
    return o?.level ?? 0;
  }

  /** A cheaper height for effects (strongest waves only). */
  seaHeightFast(x, z) {
    const o = this.ocean;
    if (o && o.enabled !== false) {
      if (o.heightApprox) return o.heightApprox(x, z);
      if (o.heightAt) return o.heightAt(x, z);
    }
    return o?.level ?? 0;
  }

  /**
   * A splash on the sea (fish leaping and re-entering, skimmers plunging, the jacks' breaches).
   * small splashes share a budget so a boiling bait ball never floods the ocean's sources.
   */
  splash(pos, strength = 0.3, radius = 0.6, small = false, opts = {}) {
    const o = this.ocean;
    if (this.debugSplashes) { this.debugSplashes.push([+pos.x.toFixed(1), +pos.z.toFixed(1), small ? 1 : 0, opts.tag || '']); if (this.debugSplashes.length > 60) this.debugSplashes.shift(); }
    if (small) {
      if (this._splashBudget <= 0) return;
      this._splashBudget -= 1;
      // a fish-sized splash: a few fine droplets and a ripple (the ocean's own splash spray is
      // sized for whales)
      this._smallSplash(pos, strength, radius, opts);
      // a ripple on the sea's sheet (every other splash: a boiling school must not paint a disc of foam)
      this._rip = (this._rip || 0) + 1;
      if (o && o.enabled !== false && o.wake && (this._rip & 1)) o.wake(_v.set(pos.x, pos.y - 0.05, pos.z), _v2.set(1.0, 0, 0), Math.max(0.25, radius * 0.6));
      return;
    }
    if (o && o.enabled !== false && o.splash) {
      o.splash(pos, strength, radius, opts.dir || null);
      return;
    }
    // no ocean: a little spray so leaps still read
    const mist = this.game.mist;
    if (!mist || opts.foamOnly) return;
    const n = Math.round(4 + strength * 14);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, rr = Math.random() * radius;
      mist.emit({
        pos: _v.set(pos.x + Math.cos(a) * rr, pos.y + 0.05, pos.z + Math.sin(a) * rr),
        vel: _v2.set(Math.cos(a) * (0.5 + rr), (1.5 + Math.random() * 3) * (0.5 + strength), Math.sin(a) * (0.5 + rr)),
        life: 0.8 + Math.random() * 0.6, size: 0.05 + 0.08 * strength, sizeEnd: 0.2 + 0.3 * strength,
        alpha: 0.7, drag: 0.4, gravity: 8, color: [0.95, 0.98, 1.0], kind: 3, fadeIn: 0.02,
      });
    }
  }

  _smallSplash(pos, strength, radius, opts) {
    const mist = this.game.mist;
    if (!mist || opts.foamOnly) return;
    const k = Math.min(strength, 1.2);
    const n = Math.round(5 + k * 30);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, rr = Math.random() * radius * 0.6;
      const out = (0.4 + Math.random() * 1.2) * (0.5 + k);
      mist.emit({
        pos: _v.set(pos.x + Math.cos(a) * rr, pos.y + 0.03, pos.z + Math.sin(a) * rr),
        vel: _v2.set(Math.cos(a) * out, (1.2 + Math.random() * 2.6) * (0.6 + k), Math.sin(a) * out),
        life: 0.45 + Math.random() * 0.5, size: 0.018 + 0.05 * radius * Math.random(), sizeEnd: 0.012,
        alpha: 0.85, drag: 0.3, gravity: 9.8, color: [0.95, 0.98, 1.0], kind: 3, fadeIn: 0.02,
      });
    }
  }

  // ---- public API ------------------------------------------------------------------------
  /**
   * A fish school: 'glintfin' bait ball (hundreds to thousands), 'spiralback' spiral column
   * (tens to hundreds) or a 'lanternjack' hunting pair (1-3).
   * opts: { radius, palette 0-3, seed, depth (m below the surface), leash, anchor (Vector3 to follow) }
   */
  addFishSchool(pos, species = 'glintfin', count = 600, opts = {}) {
    return this.fish.addSchool(pos, species, count, opts);
  }

  /**
   * A bird-reptile flock: 'skimmer' (pterosaur-like fishers that nest on ledges) or 'coilwing'
   * (four-winged feathered lizards in murmurations, roosting on spires, trees and whales).
   * opts: { palette, seed, anchor, leash, roost (land on whales), perch (land on perches) }
   */
  addReptileFlock(pos, species = 'coilwing', count = 60, opts = {}) {
    return this.reptiles.addFlock(pos, species, count, opts);
  }

  /** A bloom of bioluminescent plankton (world spawns.plankton): it glows where stirred at night. */
  addPlankton(pos, radius = 200) {
    // the same bloom added twice (by the game and by the automatic spawn sync) is kept once
    const dup = this.plankton.patches.find((p) => p.pos.distanceToSquared(pos) < 1);
    if (dup) { dup.radius = Math.max(dup.radius, radius); return dup; }
    return this.plankton.addPatch(pos, radius);
  }

  /** Start (or reinforce) a spiral bubble net at center: the fish crowd inward and up. */
  bubbleNet(center, radius = 14, strength = 1, duration = 18) {
    const t = this.game.time;
    let n = this._nets.find((e) => e.c.distanceTo(center) < radius);
    if (!n) {
      n = { c: center.clone(), r: radius, k: 0, kT: strength, until: t + duration, ang: Math.random() * 6.28, t0: t, emitT: 0, explicit: true };
      this._nets.push(n);
    } else {
      n.c.copy(center);
      n.r = radius;
      n.kT = strength;
      n.until = Math.max(n.until, t + duration);
    }
    return n;
  }

  /** End explicit bubble nets (all, or the one around center). */
  stopBubbleNet(center = null) {
    for (const n of this._nets) if (!center || n.c.distanceTo(center) < n.r * 2) n.until = Math.min(n.until, this.game.time);
  }

  /**
   * Fish inside the mouth are eaten (they regrow into their school later) with a few silver
   * flakes. The mouth also scares nearby fish (they flee, but slower than a lunging whale).
   * Pass `owner` (e.g. the whale) so nearby mouths never swap their frame-to-frame records.
   * Returns the food eaten by this call, in food units (a glintfin 0.25, a spiralback 1).
   */
  eat(mouthPos, mouthRadius = 0.8, dt = 1 / 60, owner = null) {
    if (!this.enabled) return 0;
    const t = this.game.time;
    let rec = null;
    if (owner) rec = this._mouthByOwner.get(owner) || null;
    else {
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
      rec.vel.set(0, 0, 0);
      rec.prevSeg.copy(mouthPos);
    } else if (el > 1e-4) {
      rec.vel.subVectors(mouthPos, rec.pos).divideScalar(el);
      if (rec.vel.lengthSq() > 3600) rec.vel.setLength(60);
      prev = rec.prevSeg.copy(rec.pos);
    } else prev = rec.prevSeg;
    rec.pos.copy(mouthPos);
    rec.t = t;
    // a mouth takes fish only as fast as it can gulp (a calf ~13 fish a second, more for adults)
    const rate = 6 + 3.5 * mouthRadius, cap = 10 + 4 * mouthRadius;
    rec.budget = Math.min(cap, (rec.budget ?? cap * 0.5) + rate * Math.min(el, 0.3));
    let n = 0;
    if (rec.budget >= 1) {
      n = this.fish.eatAt(mouthPos, prev, mouthRadius, { max: Math.floor(rec.budget) });
      rec.budget -= this.fish.lastCount;
    }
    // the mouth as a predator: fish sense its pressure wave ahead of it
    const sp = rec.vel.length();
    const pred = rec.pred || (rec.pred = { x: 0, y: 0, z: 0, r: 0, s: 0, vx: 0, vy: 0, vz: 0, life: 0 });
    pred.x = mouthPos.x + rec.vel.x * 0.06; pred.y = mouthPos.y + rec.vel.y * 0.06; pred.z = mouthPos.z + rec.vel.z * 0.06;
    // fish bolt from an open mouth: a vacuole opens round it, only the slow ones are taken
    pred.r = mouthRadius * 1.8 + 1.5 + sp * 0.15;
    pred.s = 1.0;
    pred.vx = rec.vel.x; pred.vy = rec.vel.y; pred.vz = rec.vel.z;
    pred.life = 0.25;
    if (!this._transient.includes(pred)) this._addTransient(pred);
    return n;
  }

  /**
   * Sonic boom / shock: fish are blown outward and flash (weakly through the surface), birds
   * scatter. The shock travels outward as a front at `speed` m/s (default matches SonicBooms:
   * 70 + 0.6 * radius); pass speed = 0 for an instant shock.
   */
  scatter(center, radius = 40, strength = 1, speed = 70 + radius * 0.6) {
    this._recentScatter.push({ c: center.clone(), t: this.game.time });
    if (this._recentScatter.length > 6) this._recentScatter.shift();
    this._startFront(center, radius, strength, speed);
  }

  /** Nearest fish school the herd can feed on: { school, swarm, pos, dist, radius, species, count, depth } or null. */
  nearestSwarm(pos, species = null) {
    return this.fish.nearest(pos, species);
  }

  /** Remove every creature (chapter restart). */
  clear() {
    this.fish.clear();
    this.reptiles.clear();
    this.bubbles.clear();
    this.plankton.clear();
    this._transient.length = 0;
    this._mouths.length = 0;
    this._mouthByOwner = new WeakMap();
    this._fronts.length = 0;
    this._nets.length = 0;
    this.songFocus = null;
    this.threat = null;
    this._threatT = -1;
    this._plDone.clear();
    this._plSeen = -1;
  }

  /** Remove groups whose home is farther than `radius` from `center` (long migrations). */
  prune(center, radius) {
    const r2 = radius * radius;
    this.fish.prune(center, r2);
    this.reptiles.prune(center, r2);
    this.plankton.prune(center, r2);
  }

  dispose() {
    this.fish.dispose();
    this.reptiles.dispose();
    this.bubbles.dispose();
    this.plankton.dispose();
  }

  // ---- compatibility with the sky ecosystem's call sites ----------------------------------
  /** (Sky krill) -> a glintfin bait ball under the sea below center. */
  addKrillSwarm(center, count = 600, opts = {}) {
    const p = center.clone();
    p.y = Math.min(p.y, this.seaHeight(p.x, p.z) - 4);
    return this.addFishSchool(p, 'glintfin', count, opts);
  }
  /** (Sky rays) -> a spiralback column. */
  addRaySchool(center, count = 6, opts = {}) {
    const p = center.clone();
    p.y = Math.min(p.y, this.seaHeight(p.x, p.z) - 6);
    return this.addFishSchool(p, 'spiralback', Math.round(count * 24), opts);
  }
  /** (Sky jellies) no longer exist on Vur Sok. */
  addJellies() { return null; }
  /** (Puffbirds) -> a coilwing flock. */
  addFlock(center, count = 60, opts = {}) {
    return this.addReptileFlock(center, 'coilwing', count, opts);
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
    cam.updateMatrixWorld();
    this._pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._pv);
    if (g.wind?.base) ctx.wind.copy(g.wind.base);
    ctx.roosts = this.roosts;
    ctx.songRadius = this.songRadius;
    ctx.perches = this.perches || g.story?.world?.perches || NO_PERCHES;
    if (this.seabedAt) ctx.seabed = this.seabedAt;
    else if (g.story?.world?.seabedAt) ctx.seabed = this._worldSeabed || (this._worldSeabed = (x, z) => g.story.world.seabedAt(x, z));
    else ctx.seabed = null;
    // small splashes: about a dozen a second at most
    this._splashBudget = Math.min(6, this._splashBudget + dt * 12);

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
        const v = ctx.threatVel.subVectors(this.threat, this._threatPrev).divideScalar(g.time - this._threatT);
        if (v.length() > 80) v.setLength(80);
      } else ctx.threatVel.set(0, 0, 0);
      this._threatPrev.copy(this.threat);
      this._threatT = g.time;
    } else this._threatT = -1;

    if (this.autoHooks) { this._watchBooms(); this._syncPlankton(); }

    // predators this frame: mouths and shocks, then the whales' bodies
    const P = ctx.predators;
    P.length = 0;
    for (let i = this._transient.length - 1; i >= 0; i--) {
      const q = this._transient[i];
      q.life -= dt;
      if (q.life <= 0) { this._transient.splice(i, 1); continue; }
      if (q.decay) q.s = q.s0 * Math.min(1, q.life / q.decay);
      P.push(q);
    }
    this._gatherWhales(ctx);
    for (const f of this.feeders) this._feed(f, dt);
    this._updateNets(dt, ctx);
    this._advanceFronts(dt);

    const T = this.stats.t;
    let t1 = performance.now(), t2;
    this.fish.update(dt, ctx);
    t2 = performance.now(); T.fish += (t2 - t1 - T.fish) * 0.05; t1 = t2;
    this.reptiles.update(dt, ctx);
    t2 = performance.now(); T.birds += (t2 - t1 - T.birds) * 0.05;
    this._netBubbles(dt, ctx);
    this.bubbles.update(dt);
    this.plankton.update(dt, ctx);

    const ms = performance.now() - t0;
    const s = this.stats;
    s.ms = ms;
    s.msAvg = s.msAvg ? s.msAvg * 0.95 + ms * 0.05 : ms;
    s.fish = this.fish.count;
    s.fishVisible = this.fish.stats.fish;
    s.near = this.fish.stats.near;
    s.tris = this.fish.stats.tris + (this.reptiles.stats.tris || 0);
    s.schools = this.fish.schools.length;
    s.birds = this.reptiles.birds.length;
    s.bubbles = this.bubbles.live.length;
  }

  // ---- internals ------------------------------------------------------------------------
  /** Whale bodies (head, chest and tail spheres) as predators the fish part around. */
  _gatherWhales(ctx) {
    const W = this._whaleList;
    W.length = 0;
    const add = (w) => { if (w && w.pos && !W.includes(w)) W.push(w); };
    const src = this.whales || this.game.story?.herd?.whales || null;
    if (src) for (const w of src) add(w);
    for (const w of this.feeders) if (w && w.pos && w.vel) add(w);
    for (const w of this.roosts) if (w && w.pos && w.vel && w.L) add(w);
    const P = ctx.predators;
    for (const w of W) {
      if (!w.vel) continue;
      // only whales in or near the sea matter to fish
      const surf = this.seaHeightFast(w.pos.x, w.pos.z);
      const L = w.L || 10;
      if (w.pos.y - surf > L * 0.5) continue;
      let pr = this._whalePreds.get(w);
      if (!pr) {
        pr = [0, 1, 2].map(() => ({ x: 0, y: 0, z: 0, r: 0, s: 0, vx: 0, vy: 0, vz: 0, whale: true }));
        this._whalePreds.set(w, pr);
      }
      const f = w.fwd || _v.set(0, 0, 1);
      const sc = w.isCalf ? 0.65 : 0.85;
      const offs = [0.3, 0, -0.3], rads = [0.2, 0.25, 0.15];
      for (let k = 0; k < 3; k++) {
        const q = pr[k];
        q.x = w.pos.x + f.x * L * offs[k] + w.vel.x * 0.25;
        q.y = w.pos.y + f.y * L * offs[k] + w.vel.y * 0.25;
        q.z = w.pos.z + f.z * L * offs[k] + w.vel.z * 0.25;
        q.r = L * rads[k] + 1.5 + (w.isCalf ? 0.5 : 2);
        q.s = sc;
        q.vx = w.vel.x; q.vy = w.vel.y; q.vz = w.vel.z;
        P.push(q);
      }
    }
    // no whale objects: fall back to the shared movers (xyz, radius)
    if (!W.length) {
      const mv = G.uMovers.value, mvv = G.uMoverVel.value;
      const mp = this._moverPreds || (this._moverPreds = mv.map(() => ({ x: 0, y: 0, z: 0, r: 0, s: 0.8, vx: 0, vy: 0, vz: 0, whale: true })));
      for (let i = 0; i < mv.length; i++) {
        const m = mv[i];
        if (m.w <= 0 || m.y < -9000) continue;
        const q = mp[i];
        q.x = m.x; q.y = m.y; q.z = m.z; q.r = m.w * 1.3 + 2;
        q.vx = mvv[i].x; q.vy = mvv[i].y; q.vz = mvv[i].z;
        P.push(q);
      }
    }
  }

  _updateNets(dt, ctx) {
    const t = this.game.time;
    ctx.nets.length = 0;
    for (let i = this._nets.length - 1; i >= 0; i--) {
      const n = this._nets[i];
      const target = t < n.until ? n.kT : 0;
      n.k += (target - n.k) * (1 - Math.exp(-dt * (target > n.k ? 0.5 : 0.3)));
      if (t > n.until && n.k < 0.02) { this._nets.splice(i, 1); continue; }
      ctx.nets.push(n);
    }
  }

  /** Bubble curtains: explicit nets trace a closing spiral; circling whales breathe out their own. */
  _netBubbles(dt, ctx) {
    if (!this.netBubbles) return;
    const t = this.game.time;
    for (const n of this._nets) {
      if (!n.explicit || t > n.until) continue;
      n.emitT -= dt;
      while (n.emitT <= 0) {
        n.emitT += 0.12;
        // a spiral closing inward and rising as the (unseen) whales circle up
        const age = t - n.t0;
        n.ang += 0.22;
        const rr = n.r * (1 - 0.45 * Math.min(age / 14, 1)) * (0.92 + 0.08 * Math.sin(n.ang * 3));
        const surf = this.seaHeightFast(n.c.x, n.c.z);
        const depth = Math.max(4, 16 - age * 0.8);
        this.bubbles.emit(_v.set(n.c.x + Math.cos(n.ang) * rr, surf - depth, n.c.z + Math.sin(n.ang) * rr), 1.2, { surf });
      }
    }
    // whales under a netted school: bubbles from the blowholes trace their circling path
    for (const sc of this.fish.schools) {
      if (sc.net < 0.15) continue;
      for (const w of ctx.whales) {
        if (!w.pos) continue;
        const dx = w.pos.x - sc.center.x, dz = w.pos.z - sc.center.z;
        if (dx * dx + dz * dz > (sc.R + 40) * (sc.R + 40)) continue;
        if (w.pos.y > sc.surf - 1.5) continue;
        const nt = (this._bubbleT.get(w) ?? 0) - dt;
        if (nt > 0) { this._bubbleT.set(w, nt); continue; }
        this._bubbleT.set(w, 0.16);
        const L = w.L || 10;
        const up = w.up || _v2.set(0, 1, 0);
        const f = w.fwd || _v.set(0, 0, 1);
        const p = _v.set(w.pos.x + f.x * L * 0.18 + up.x * L * 0.08, w.pos.y + f.y * L * 0.18 + up.y * L * 0.08, w.pos.z + f.z * L * 0.18 + up.z * L * 0.08);
        this.bubbles.emit(p, 1.6 * sc.net, { stream: 2.4, spread: 1.1, big: 1.5 });
      }
    }
  }

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
    let near = false;
    for (const sc of this.fish.schools) {
      const rr = sc.extent + r + 20;
      if (sc.center.distanceToSquared(pos) < rr * rr) { near = true; break; }
    }
    if (near) this.eat(pos, r, dt, f);
  }

  /**
   * Night plankton blooms (world.spawns.plankton) follow the chapters the story has populated with
   * fish and reptiles, so the game needs no extra call (an explicit addPlankton is deduplicated).
   */
  _syncPlankton() {
    const s = this.game.story;
    const sp = s?.world?.spawns?.plankton, done = s?.spawned;
    if (!sp || !sp.length || !done || done.size === this._plSeen) return;
    this._plSeen = done.size;
    for (const id of done) {
      if (this._plDone.has(id)) continue;
      this._plDone.add(id);
      for (const k of sp) if (k.chapter === id && k.pos) this.addPlankton(k.pos, k.radius ?? 200);
    }
  }

  _addTransient(q) {
    if (this._transient.length >= MAX_TRANSIENT) this._transient.shift();
    this._transient.push(q);
  }

  _startFront(center, radius, strength, speed) {
    const f = { c: center.clone(), radius, strength, speed, r: 0 };
    if (!speed || speed <= 0) this._applyShock(f.c, 0, radius, radius, strength);
    else this._fronts.push(f);
    // a lingering pressure field keeps fish dispersed for a moment, then they re-form
    this._addTransient({ x: center.x, y: center.y, z: center.z, r: radius * 0.7, s: 1.1 * strength, s0: 1.1 * strength, decay: 2.5, vx: 0, vy: 0, vz: 0, life: 2.5 + radius / Math.max(speed || 1e9, 1) });
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
    this.fish.shock(c, rIn, rOut, radius, strength);
    this.reptiles.shock(c, rIn, rOut, radius, strength);
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
      if (this._recentScatter.some((s) => Math.abs(s.t - w) < 0.6 && s.c.distanceTo(c) < 8)) continue;
      const radius = bp[i].x > 0 ? bp[i].x : 40;
      const speed = bp[i].z > 0 ? bp[i].z : 80;
      this._startFront(c, radius * 1.2, Math.min(2, 0.6 + radius / 80), speed);
    }
  }
}
