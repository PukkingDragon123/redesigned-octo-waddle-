// Bird-reptiles of Vur Sok.
//
// Coilwings: small four-winged feathered lizards in murmurations (boids with a rotating
// topological window and turning waves that ripple through the flock). They settle in staggered
// waves onto perches (spires, rock tops, trees: eco.perches) and onto the backs of the whales
// (eco.roosts), coil their tails into spirals while they sit, raise their quills when alarmed,
// scatter from threats and booms, and wheel in a great spiral over a singing herd.
//
// Skimmers: pterosaur-like fishers that nest on ledges. They soar in thermals, then hunt: either
// skimming the swell with the long lower jaw cutting the water (a wake line, snapping up fish
// near the surface) or climbing over a school and plunge-diving with folded wings, chasing fish
// under water, floating to swallow, and running across the water to take off again.
import {
  Mesh, InstancedInterleavedBuffer, InterleavedBufferAttribute, DynamicDrawUsage, Vector3, Quaternion, Matrix4, Euler,
} from 'three';
import { G } from '../../render/Globals.js';
import { buildSkimmer, buildCoilwing, triCount } from './reptileGeo.js';
import { reptileMaterial } from './reptileMat.js';
import { rng, lerp, clamp, smoothstep } from '../../core/math.js';

const smooth01 = (x, a, b) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
const TAU = Math.PI * 2;
const STRIDE = 20;
// 0-2 pos, 3 scale | 4-7 quat | 8 phase, 9 amp, 10 fold, 11 sweep | 12 head yaw, 13 head pitch,
// 14 jaw, 15 tail curl / crest display | 16 seed, 17 palette+tint, 18 legs down, 19 quills / extra

const SPEC = {
  skimmer: { max: 192, nearMax: 72, span: [1.25, 1.75], nearPx: 70, minPx: 0.8, beat: 2.3 },
  coilwing: { max: 2048, nearMax: 120, span: [0.27, 0.37], nearPx: 40, minPx: 0.7, beat: 7.5 },
};
const ROOST_RANGE = 420;
const PERCH_RANGE = 320;
const NEIGHBOURS = 24;
const DORMANT_DIST = 1400;
const UP = new Vector3(0, 1, 0);
const _v = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _m = new Matrix4();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _e = new Euler(0, 0, 0, 'YXZ');

function markAll(buf, n) {
  buf.clearUpdateRanges();
  if (n > 0) buf.addUpdateRange(0, n * STRIDE);
  buf.needsUpdate = true;
}

class Pool {
  constructor(sys, species) {
    const spec = SPEC[species];
    this.spec = spec;
    this.species = species;
    const mk = (n) => new InstancedInterleavedBuffer(new Float32Array(n * STRIDE), STRIDE).setUsage(DynamicDrawUsage);
    this.nearBuf = mk(spec.nearMax);
    this.farBuf = mk(spec.max);
    const build = species === 'skimmer' ? buildSkimmer : buildCoilwing;
    const mkMesh = (near) => {
      const geo = build(near);
      const buf = near ? this.nearBuf : this.farBuf;
      geo.setAttribute('iPos', new InterleavedBufferAttribute(buf, 4, 0));
      geo.setAttribute('iQuat', new InterleavedBufferAttribute(buf, 4, 4));
      geo.setAttribute('iAnim', new InterleavedBufferAttribute(buf, 4, 8));
      geo.setAttribute('iAnim2', new InterleavedBufferAttribute(buf, 4, 12));
      geo.setAttribute('iSeed', new InterleavedBufferAttribute(buf, 4, 16));
      geo.instanceCount = 0;
      const mesh = new Mesh(geo, reptileMaterial(species));
      mesh.frustumCulled = false;
      mesh.name = `${species}-${near ? 'near' : 'far'}`;
      mesh.visible = false;
      sys.game.engine.scene.add(mesh);
      sys.game.engine.shadows?.addCaster?.(mesh);
      return mesh;
    };
    this.near = mkMesh(true);
    this.far = mkMesh(false);
    this.trisNear = triCount(this.near.geometry);
    this.trisFar = triCount(this.far.geometry);
    this.nearN = 0;
    this.farN = 0;
  }
}

export class ReptileSystem {
  constructor(eco) {
    this.eco = eco;
    this.game = eco.game;
    this.flocks = [];
    this.birds = [];
    this.pools = { skimmer: new Pool(this, 'skimmer'), coilwing: new Pool(this, 'coilwing') };
    this.poolList = Object.values(this.pools);
    this._eatOpts = { only: null, sparkles: 1 };
    this._seed = 911;
    this._frame = 0;
    this._roostInfo = new WeakMap();
    this._perchOcc = new Map();
    this.stats = { birds: 0, tris: 0, near: 0 };
    this.debugPose = null;
    this.lastKind = '';
    this._nipT = 0; // the next moment a skimmer may dive at a hunting whale
  }

  // ---------------------------------------------------------------------------------------
  addFlock(center, species = 'coilwing', count = 60, opts = {}) {
    const pool = this.pools[species];
    if (!pool) { console.warn('[ecosystem] unknown bird-reptile', species); return null; }
    const used = this.birds.filter((b) => b.species === species).length;
    count = Math.max(0, Math.min(Math.round(count), pool.spec.max - used));
    if (!count) return null;
    const r = rng(opts.seed ?? (this._seed += 29));
    const fl = {
      kind: 'reptiles',
      species,
      home: center.clone(),
      anchor: opts.anchor || null,
      anchorOffset: opts.anchor ? center.clone().sub(opts.anchor) : null,
      leash: opts.leash ?? (species === 'skimmer' ? 220 : 80),
      birds: [],
      mode: 'fly',
      calmT: lerp(0, 6, r()),
      restAfter: opts.restAfter ?? lerp(12, 26, r()),
      perchT: 0,
      perchFor: lerp(40, 90, r()),
      roost: opts.roost !== false,
      perchOK: opts.perch !== false,
      target: center.clone(),
      a: [lerp(0.09, 0.15, r()), lerp(0.17, 0.25, r()), lerp(0.11, 0.18, r()), r() * TAU, r() * TAU],
      centroid: center.clone(),
      fwd: new Vector3(1, 0, 0),
      riding: null,
      palettes: opts.palette !== undefined ? [opts.palette] : [0, 1, 2, 3].filter(() => r() < 0.7),
      perchList: null,
      perchListN: -1,
      nests: null,
      rng: r,
      songT: 0,
      alarmT: -99,
    };
    if (!fl.palettes.length) fl.palettes = [Math.floor(r() * 4)];
    const spec = pool.spec;
    for (let i = 0; i < count; i++) {
      const p = r.inSphere(new Vector3()).multiplyScalar(species === 'skimmer' ? 20 : 9).add(center);
      const span = lerp(spec.span[0], spec.span[1], Math.pow(r(), 1.3));
      const b = {
        species,
        flock: fl,
        pos: p,
        vel: new Vector3(r() - 0.5, (r() - 0.5) * 0.2, r() - 0.5).normalize().multiplyScalar(species === 'skimmer' ? 9 : 7),
        acc: new Vector3(),
        quat: new Quaternion(),
        span,
        mode: 'fly',
        t: lerp(2, 10, r()),
        phase: r() * TAU,
        amp: 0.8,
        fold: 0,
        sweep: 0,
        hy: 0, hp: 0, jaw: 0, curl: 0, legs: 0, crest: 0,
        hyT: 0, hpT: 0, headT: r() * 2,
        roll: 0, pitch: 0,
        seed: r() * 10,
        palette: fl.palettes[Math.floor(r() * fl.palettes.length)] + 0.02 + r() * 0.96,
        perch: null, roost: null, off: new Vector3(), perchYaw: 0,
        landDelay: 0, liftDelay: undefined,
        boundT: r(), bounding: false,
        startle: 0, kick: new Vector3(), snap: new Vector3(),
        neighborT: i % 2,
        sep: new Vector3(), ali: new Vector3(), coh: new Vector3(),
        hop: 0, hopT: lerp(3, 12, r()),
        // skimmer hunting state
        nest: null, prey: null, hunts: 0, aim: new Vector3(), dir: new Vector3(1, 0, 0), under: 0, ate: 0,
        rng: r,
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
    this._perchOcc.clear();
    for (const p of Object.values(this.pools)) {
      p.near.visible = p.far.visible = false;
      p.near.geometry.instanceCount = p.far.geometry.instanceCount = 0;
    }
  }

  prune(center, r2) {
    for (const f of this.flocks.slice()) {
      if (f.home.distanceToSquared(center) <= r2) continue;
      this.flocks.splice(this.flocks.indexOf(f), 1);
      for (const b of f.birds) { this._release(b); this.birds.splice(this.birds.indexOf(b), 1); }
    }
  }

  dispose() {
    for (const p of Object.values(this.pools)) {
      for (const m of [p.near, p.far]) {
        this.game.engine.shadows?.removeCaster?.(m);
        m.removeFromParent();
        m.geometry.dispose();
        m.material.dispose();
      }
    }
  }

  /** Sonic boom / shock front: birds in the ring are thrown outward and the flocks scatter. */
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

  /** A hunter's bite: birds in the jaws are eaten (removed). Returns how many. */
  biteAt(c, radius) {
    let n = 0;
    this.lastKind = '';
    for (let fi = this.flocks.length - 1; fi >= 0; fi--) {
      const fl = this.flocks[fi];
      let here = 0;
      for (let i = fl.birds.length - 1; i >= 0; i--) {
        const b = fl.birds[i];
        const rr = radius + (b.span || 1) * 0.35;
        if (b.pos.distanceToSquared(c) > rr * rr) continue;
        this._release(b);
        fl.birds.splice(i, 1);
        const k = this.birds.indexOf(b);
        if (k >= 0) this.birds.splice(k, 1);
        this.lastKind = b.species;
        here++;
      }
      if (!here) continue;
      n += here;
      if (!fl.birds.length) this.flocks.splice(fi, 1);
      else this._alarm(fl, c);
    }
    return n;
  }

  /** A hunter close by: flocks with a bird within `radius` take off and scatter. */
  flush(c, radius) {
    const r2 = radius * radius, t = this.game.time;
    for (const fl of this.flocks) {
      if (t - (fl.alarmT ?? -9) < 2.5) continue;
      for (const b of fl.birds) {
        if (b.pos.distanceToSquared(c) < r2) { this._alarm(fl, c); break; }
      }
    }
  }

  // ---------------------------------------------------------------------------------------
  update(dt, ctx) {
    this._frame++;
    if (!this.birds.length) {
      for (const p of Object.values(this.pools)) p.near.visible = p.far.visible = false;
      this.stats.birds = 0;
      return;
    }
    const roosts = ctx.roosts || [];
    // the day's rhythm: coilwings murmurate at dusk and roost at night; everyone shelters in storms
    const A = this.act || (this.act = { dusk: 0, night: 0, storm: 0, shelter: 0 });
    A.night = G.uNight.value;
    A.dusk = Math.max(0, Math.min(1, (0.3 - G.uSunDir.value.y) / 0.35)) * (1 - A.night);
    A.storm = G.uStorm ? G.uStorm.value : 0;
    A.shelter = Math.max(smooth01(A.storm, 0.35, 0.7), smooth01(A.night, 0.6, 0.9));
    for (const r of roosts) if (r && r.pos) this._roostFrame(r, dt, ctx.time).occ = 0;
    for (const b of this.birds) if (b.roost) { const info = this._roostInfo.get(b.roost); if (info) info.occ++; }
    for (let fi = 0; fi < this.flocks.length; fi++) {
      const fl = this.flocks[fi];
      if (fl.anchor) fl.home.copy(fl.anchor).add(fl.anchorOffset);
      const dc = Math.sqrt(Math.min(fl.centroid.distanceToSquared(ctx.cam), fl.home.distanceToSquared(ctx.cam)));
      if (dc > DORMANT_DIST && !fl.riding) continue;
      // distant flocks think less often (their birds are a few pixels); positions are
      // extrapolated in between when written for the GPU
      const rate = dc < 260 || fl.riding ? 1 : dc < 650 ? 2 : 3;
      fl.acc = (fl.acc || 0) + dt;
      if ((this._frame + fi) % rate !== 0 && fl.acc < 0.2) continue;
      const fdt = Math.min(fl.acc, 0.1);
      fl.acc = 0;
      fl.tUpd = ctx.time;
      this._candidatePerches(fl, ctx);
      if (fl.species === 'coilwing') this._updateCoilFlock(fl, fdt, ctx, roosts);
      else this._updateSkimFlock(fl, fdt, ctx);
    }
    this._write(ctx);
  }

  _write(ctx) {
    const cam = this.game.engine.camera;
    const pxPerM = (1 / Math.tan((cam.fov * Math.PI) / 360)) * G.uResolution.value.y * 0.5;
    let tris = 0, near = 0;
    for (const pool of this.poolList) {
      const spec = pool.spec;
      const NB = pool.nearBuf.array, FB = pool.farBuf.array;
      let nn = 0, nf = 0;
      for (const b of this.birds) {
        if (b.species !== pool.species) continue;
        const d = b.pos.distanceTo(ctx.cam) + 1e-3;
        const px = (b.span * pxPerM) / d;
        if (px < spec.minPx) continue;
        if (!ctx.frustum.intersectsSphere(ctx.sphere(b.pos, b.span * 1.6 + 1))) continue;
        let B, o;
        if (px > spec.nearPx && nn < spec.nearMax) { B = NB; o = nn * STRIDE; nn++; } else if (nf < spec.max) { B = FB; o = nf * STRIDE; nf++; } else continue;
        const ex = b.mode === 'perch' ? 0 : ctx.time - (b.flock.tUpd ?? ctx.time);
        B[o] = b.pos.x + b.vel.x * ex; B[o + 1] = b.pos.y + b.hop + b.vel.y * ex; B[o + 2] = b.pos.z + b.vel.z * ex; B[o + 3] = b.span;
        B[o + 4] = b.quat.x; B[o + 5] = b.quat.y; B[o + 6] = b.quat.z; B[o + 7] = b.quat.w;
        B[o + 8] = b.phase; B[o + 9] = b.amp; B[o + 10] = b.fold; B[o + 11] = b.sweep;
        B[o + 12] = b.hy; B[o + 13] = b.hp; B[o + 14] = b.jaw; B[o + 15] = b.species === 'coilwing' ? b.curl : b.crest;
        B[o + 16] = b.seed; B[o + 17] = b.palette; B[o + 18] = b.legs; B[o + 19] = b.crest;
        const dp = this.debugPose;
        if (dp) {
          // dev inspection: pin a pose (amp, fold, sweep, legs, curl, crest, jaw, phase)
          if (dp.amp != null) B[o + 9] = dp.amp;
          if (dp.fold != null) B[o + 10] = dp.fold;
          if (dp.sweep != null) B[o + 11] = dp.sweep;
          if (dp.legs != null) B[o + 18] = dp.legs;
          if (dp.curl != null) B[o + 15] = dp.curl;
          if (dp.crest != null) { B[o + 19] = dp.crest; if (b.species === 'skimmer') B[o + 15] = dp.crest; }
          if (dp.jaw != null) B[o + 14] = dp.jaw;
          if (dp.phase != null) B[o + 8] = dp.phase;
        }
      }
      pool.nearN = nn; pool.farN = nf;
      pool.near.geometry.instanceCount = nn;
      pool.far.geometry.instanceCount = nf;
      pool.near.visible = nn > 0;
      pool.far.visible = nf > 0;
      if (nn) markAll(pool.nearBuf, nn);
      if (nf) markAll(pool.farBuf, nf);
      tris += nn * pool.trisNear + nf * pool.trisFar;
      near += nn;
    }
    this.stats.birds = this.birds.length;
    this.stats.tris = tris;
    this.stats.near = near;
  }

  // ---------------------------------------------------------------------------------------
  // perches (world) and roosts (whales)
  _candidatePerches(fl, ctx) {
    const all = ctx.perches || [];
    if (fl.perchList && fl.perchListN === all.length) return;
    fl.perchListN = all.length;
    fl.perchList = [];
    fl.nests = [];
    for (const pe of all) {
      if (!pe || !pe.p) continue;
      const d = pe.p.distanceTo(fl.home);
      if (d > PERCH_RANGE) continue;
      // skimmers nest on ledges (or high rock); coilwings take anything above the spray
      if (fl.species === 'skimmer') {
        if (pe.tree) continue;
        if (pe.ledge || pe.p.y > 6) fl.nests.push(pe);
      } else if (pe.p.y > 3) fl.perchList.push(pe);
    }
    fl.perchList.sort((a, b) => a.p.distanceToSquared(fl.home) - b.p.distanceToSquared(fl.home));
    fl.nests.sort((a, b) => a.p.distanceToSquared(fl.home) - b.p.distanceToSquared(fl.home));
  }

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
    if (roost.fwd) info.fwd.copy(roost.fwd);
    else if (roost.quat) info.fwd.set(0, 0, 1).applyQuaternion(roost.quat);
    else if (info.vel.lengthSq() > 0.25) info.fwd.lerp(_v.copy(info.vel).normalize(), 1 - Math.exp(-dt * 2));
    info.fwd.addScaledVector(info.up, -info.fwd.dot(info.up));
    if (info.fwd.lengthSq() < 1e-6) info.fwd.set(1, 0, 0).addScaledVector(info.up, -info.up.x);
    info.fwd.normalize();
    info.right.crossVectors(info.up, info.fwd).normalize();
    info.spread = roost.spread ?? (roost.L ? roost.L * 0.12 : 2.2);
    info.lift = roost.lift ?? (roost.L ? roost.L * 0.165 : 0);
    info.capacity = roost.capacity ?? Math.max(4, Math.round(info.spread * info.spread * 3));
    info.level = info.up.y;
    return info;
  }

  /** Where a perched bird sits: on a whale's back (riding its body bob), or on a perch point. */
  _perchPos(b, out) {
    if (b.roost) {
      const w = b.roost;
      const info = this._roostInfo.get(w) || this._roostFrame(w, 0, this.game.time);
      const o = b.off;
      let h;
      if (w.model?.prof && w.L) {
        const pr = w.model.prof(clamp(0.55 + o.z / w.L, 0.05, 0.95));
        const u = Math.min(1, Math.abs(o.x) / Math.max(pr.hw, 1e-3));
        // on the back: above the armour plates and the fur of the dorsal ridge
        h = pr.top * Math.pow(1 - Math.pow(u, 2.25), 1 / 2.25) + pr.cy + (w.model.u?.uFurLen?.value ?? 0) * 0.5 + (w.anim?.bodyBob ?? 0) + 0.014 * w.L + 0.12 * b.span;
      } else h = info.lift + 0.12 * b.span;
      return out.copy(w.pos).addScaledVector(info.up, h).addScaledVector(info.right, o.x).addScaledVector(info.fwd, o.z);
    }
    const pe = b.perch;
    return out.copy(pe.p).add(b.off).addScaledVector(pe.n || UP, b.species === 'skimmer' ? 0.32 * b.span : 0.14 * b.span);
  }

  _pickPerch(b, fl, roosts, time, dt) {
    // whales first (when one is near), otherwise the world's perches
    let best = null, bd = ROOST_RANGE, kind = null;
    if (fl.roost) {
      for (const ro of roosts) {
        if (!ro || !ro.pos) continue;
        const info = this._roostFrame(ro, dt, time);
        if (info.level < 0.8 || info.occ >= info.capacity) continue;
        const d = ro.pos.distanceTo(b.pos) * (0.7 + Math.random() * 0.4);
        if (d < bd) { bd = d; best = ro; kind = 'roost'; }
      }
    }
    if (fl.perchOK && fl.perchList?.length) {
      for (let k = 0; k < Math.min(fl.perchList.length, 12); k++) {
        const pe = fl.perchList[k];
        const occ = this._perchOcc.get(pe) || 0;
        if (occ >= 10) continue;
        const d = pe.p.distanceTo(b.pos) * (0.8 + Math.random() * 0.5) + occ * 3;
        if (d < bd) { bd = d; best = pe; kind = 'perch'; }
      }
    }
    if (!best) return false;
    if (kind === 'roost') {
      const info = this._roostFrame(best, dt, time);
      const others = fl.birds.filter((o) => o !== b && o.roost === best);
      let ok = false;
      for (let k = 0; k < 10 && !ok; k++) {
        b.off.set((Math.random() * 2 - 1) * info.spread * 0.45, 0, (Math.random() * 2 - 1) * info.spread * 1.2);
        ok = others.every((o) => o.off.distanceTo(b.off) > 0.55 * (b.span + o.span));
      }
      if (!ok) return false;
      b.roost = best;
      b.perch = null;
      info.occ++;
      b.perchYaw = (Math.random() - 0.5) * 1.4 + (Math.random() < 0.15 ? Math.PI : 0);
    } else {
      const occ = this._perchOcc.get(best) || 0;
      // a ring of places around the perch point, outermost last
      const ringR = 0.45 + Math.floor(occ / 4) * 0.55;
      const a = occ * 2.4 + Math.random() * 0.5;
      b.off.set(Math.cos(a) * ringR, 0, Math.sin(a) * ringR);
      b.perch = best;
      b.roost = null;
      this._perchOcc.set(best, occ + 1);
      // face outward (a lookout), with a little scatter
      b.perchYaw = Math.atan2(b.off.x, b.off.z) + (Math.random() - 0.5) * 0.8;
    }
    return true;
  }

  _release(b) {
    if (b.perch) {
      const occ = this._perchOcc.get(b.perch) || 0;
      this._perchOcc.set(b.perch, Math.max(0, occ - 1));
    }
    b.perch = null;
    b.roost = null;
  }

  _alarm(fl, from) {
    fl.calmT = -lerp(6, 12, fl.rng());
    fl.mode = 'fly';
    fl.alarmT = this.game.time;
    for (const b of fl.birds) {
      if (b.mode === 'perch' || b.mode === 'land') this._takeOff(b, from);
      b.startle = Math.max(b.startle, 0.7);
      if (b.species === 'skimmer' && (b.mode === 'skim' || b.mode === 'aim')) { b.mode = 'soar'; b.t = lerp(6, 12, Math.random()); }
    }
  }

  _takeOff(b, from) {
    let base = _v.set(0, 0, 0);
    if (b.roost) { const info = this._roostInfo.get(b.roost); if (info) base = info.vel; }
    const up = b.roost?.up || UP;
    this._release(b);
    b.mode = 'fly';
    b.vel.copy(base).addScaledVector(up, b.species === 'skimmer' ? 3 : 3.5 + Math.random() * 2.5);
    if (from) b.vel.addScaledVector(_v3.subVectors(b.pos, from).setY(0).normalize(), 3 + Math.random() * 3);
    else b.vel.add(_v3.set(Math.random() - 0.5, 0, Math.random() - 0.5).multiplyScalar(4));
    b.fold = Math.min(b.fold, 0.4);
    b.amp = 1.1;
    b.bounding = false;
    b.boundT = 0.8;
    if (b.species === 'skimmer') { b.mode = 'takeoff'; b.t = 1.6; }
  }

  // ---------------------------------------------------------------------------------------
  // coilwings
  _updateCoilFlock(fl, dt, ctx, roosts) {
    const t = ctx.time;
    const r = fl.rng;
    let riding = null;
    for (const b of fl.birds) if (b.roost && b.mode === 'perch') { riding = b.roost; break; }
    fl.riding = riding;
    if (riding && !fl.anchor) {
      _v.copy(riding.pos).addScaledVector(riding.up || UP, 12);
      fl.home.lerp(_v, 1 - Math.exp(-dt * 0.4));
    }
    if (ctx.threat) {
      const near = fl.birds.some((b) => b.pos.distanceToSquared(ctx.threat) < 110 * 110);
      if (near && t - fl.alarmT > 1) this._alarm(fl, ctx.threat);
    }
    fl.calmT += dt;
    // a song draws the flock into a great wheel above the herd
    let song = null;
    if (ctx.songFocus && ctx.songFocus.distanceTo(fl.centroid) < 380) song = ctx.songFocus;
    fl.songT += ((song ? 1 : 0) - fl.songT) * (1 - Math.exp(-dt * 0.4));
    const a = fl.a, R = fl.leash * 0.55;
    if (song) {
      const ang = t * 0.35;
      const rr = 28 + 10 * Math.sin(t * 0.21);
      fl.target.set(song.x + Math.cos(ang) * rr, Math.max(song.y + 16, this.eco.seaHeightFast(song.x, song.z) + 18) + Math.sin(t * 0.5) * 6, song.z + Math.sin(ang) * rr);
      if (fl.mode !== 'fly') { fl.mode = 'fly'; for (const b of fl.birds) if (b.mode !== 'fly') b.liftDelay = Math.random() * 2; }
      fl.calmT = 0;
    } else {
      fl.target.set(
        fl.home.x + Math.sin(t * a[0] + a[3]) * R,
        fl.home.y + 4 + Math.sin(t * a[1]) * R * 0.25,
        fl.home.z + Math.sin(t * a[2] + a[4]) * R,
      );
      // dusk: the murmuration, great folding loops round the home spire before roosting
      const dk = this.act ? this.act.dusk : 0;
      if (dk > 0.05) {
        const ang = t * (0.32 + a[0]) + a[3];
        const rr = R * (0.55 + 0.35 * Math.sin(t * a[2] * 1.7 + a[4]));
        _v3.set(fl.home.x + Math.cos(ang) * rr, fl.home.y + 10 + Math.sin(t * 0.43 + a[3]) * R * 0.3, fl.home.z + Math.sin(ang * 1.3) * rr);
        fl.target.lerp(_v3, dk);
      }
    }
    const shelter = this.act ? this.act.shelter : 0;
    // by day they settle often; at dusk the flock keeps wheeling; at night and in storms it roosts
    if (this.act && this.act.dusk > 0.4 && !shelter) fl.calmT = Math.min(fl.calmT, fl.restAfter * 0.5);
    if (shelter > 0.5 && fl.mode === 'fly') fl.calmT = Math.max(fl.calmT, fl.restAfter);
    if (shelter > 0.5 && fl.mode === 'settle') fl.perchT = Math.min(fl.perchT, fl.perchFor - 1);
    let nf = 0;
    _v.set(0, 0, 0);
    _v2.set(0, 0, 0);
    for (const b of fl.birds) if (b.mode === 'fly') { _v.add(b.pos); _v2.add(b.vel); nf++; }
    if (nf) {
      fl.centroid.copy(_v.divideScalar(nf));
      if (_v2.lengthSq() > 0.01) fl.fwd.copy(_v2.normalize());
    }
    // settle after a calm spell, if there is anywhere to land
    let canRoost = false;
    if (fl.mode === 'fly' && fl.calmT > fl.restAfter && !song) {
      if (fl.perchOK && fl.perchList?.length) canRoost = true;
      if (fl.roost) for (const ro of roosts) if (ro && ro.pos && ro.pos.distanceToSquared(fl.centroid) < ROOST_RANGE * ROOST_RANGE) { canRoost = true; break; }
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
        fl.mode = 'fly';
        fl.calmT = 0;
        fl.restAfter = lerp(14, 30, r());
        for (const b of fl.birds) if (b.mode === 'perch' || b.mode === 'land') b.liftDelay = r() * 2.5;
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
        // a whale that banks hard, rolls or dives shakes its passengers off
        if (info && (info.level < 0.55 || b.roost.pos.y < this.eco.seaHeightFast(b.roost.pos.x, b.roost.pos.z) + 0.5)) { b.startle = Math.max(b.startle, 0.4); this._takeOff(b, null); }
      }
      if (fl.mode === 'settle' && b.mode === 'fly' && b.liftDelay === undefined) {
        b.landDelay -= dt;
        if (b.landDelay <= 0 && b.startle < 0.1) {
          if (this._pickPerch(b, fl, roosts, t, dt)) b.mode = 'land';
          else b.landDelay = 2 + r() * 4;
        }
      }
      if (b.mode === 'fly') this._flyCoil(b, fl, dt, ctx, i);
      else if (b.mode === 'land') this._land(b, dt, ctx);
      else this._perchIdle(b, dt, ctx);
    }
  }

  /** The sea under a flock (sampled at its centroid now and then: birds fly well above it). */
  _flockSurf(fl, ctx) {
    if (fl.surfT === undefined || ctx.time - fl.surfT > 0.3) {
      fl.surfT = ctx.time;
      fl.surf = this.eco.seaHeightFast(fl.centroid.x, fl.centroid.z);
    }
    return fl.surf;
  }

  _flyCoil(b, fl, dt, ctx, i) {
    const t = ctx.time;
    const acc = b.acc.set(0, 0, 0);
    if ((this._frame + b.neighborT) % 2 === 0) {
      b.sep.set(0, 0, 0); b.ali.set(0, 0, 0); b.coh.set(0, 0, 0);
      let na = 0, nc = 0;
      const sepR = 1.6 * b.span + 0.5;
      const L = fl.birds, nL = L.length;
      const win = Math.min(nL, NEIGHBOURS);
      const start = (i * 7 + this._frame * 5) % nL;
      for (let k = 0; k < win; k++) {
        const o = L[(start + k) % nL];
        if (o === b || o.mode !== 'fly') continue;
        const dx = b.pos.x - o.pos.x, dy = b.pos.y - o.pos.y, dz = b.pos.z - o.pos.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > 64) continue;
        if (d2 < sepR * sepR) {
          const d = Math.sqrt(d2) + 1e-3;
          b.sep.x += (dx / d) * (sepR - d) / sepR; b.sep.y += (dy / d) * (sepR - d) / sepR; b.sep.z += (dz / d) * (sepR - d) / sepR;
        }
        if (d2 < 20) { b.ali.add(o.vel); na++; }
        b.coh.x += o.pos.x; b.coh.y += o.pos.y; b.coh.z += o.pos.z; nc++;
      }
      if (na) b.ali.divideScalar(na).sub(b.vel);
      if (nc) b.coh.divideScalar(nc).sub(b.pos); else b.coh.set(0, 0, 0);
    }
    const startle = b.startle;
    acc.addScaledVector(b.sep, 24 * (1 + startle * 2));
    acc.addScaledVector(b.ali, 1.9 * (1 - startle * 0.7));
    acc.addScaledVector(b.coh, 0.8 * (1 - startle));
    _v.subVectors(fl.target, b.pos);
    const dT = _v.length();
    acc.addScaledVector(_v, (0.25 + Math.max(0, dT - 25) * 0.02) / Math.max(dT, 1) * 6);
    _v.subVectors(fl.centroid, b.pos);
    acc.addScaledVector(_v, 0.2 * (1 - startle));
    // turning waves ripple through the murmuration
    const along = (b.pos.x - fl.centroid.x) * fl.fwd.x + (b.pos.z - fl.centroid.z) * fl.fwd.z;
    const wave = Math.sin(t * 1.15 - along * 0.17) * Math.sin(t * 0.23 + fl.a[3]);
    acc.x += -fl.fwd.z * wave * 2.4;
    acc.z += fl.fwd.x * wave * 2.4;
    acc.y += Math.sin(t * 0.9 - along * 0.12) * 0.9;
    if (ctx.threat) {
      _v.subVectors(b.pos, ctx.threat);
      const d = _v.length();
      if (d < 80) acc.addScaledVector(_v, (80 - d) / 80 * 32 / Math.max(d, 1));
    }
    if (b.kick.lengthSq() > 0.01) {
      acc.addScaledVector(b.kick, 3);
      b.kick.multiplyScalar(Math.exp(-dt * 3));
    }
    for (const w of ctx.whales) {
      if (!w.pos) continue;
      _v.subVectors(b.pos, w.pos);
      const d = _v.length();
      const min = (w.L || 10) * 0.45 + 3;
      if (d < min && d > 1e-3) acc.addScaledVector(_v, (min - d) / min * 18 / d);
    }
    // above the spray
    const surf = this._flockSurf(fl, ctx);
    if (b.pos.y < surf + 5) acc.y += (surf + 5 - b.pos.y) * 1.2;
    const al = acc.length();
    const amax = 18 + startle * 14;
    if (al > amax) acc.multiplyScalar(amax / al);
    b.vel.addScaledVector(acc, dt);
    const sp = b.vel.length();
    const vmin = 5.5, vmax = 11 + startle * 5;
    if (sp > vmax) b.vel.multiplyScalar(vmax / sp);
    else if (sp < vmin) b.vel.multiplyScalar(vmin / Math.max(sp, 1e-3));
    b.pos.addScaledVector(b.vel, dt);
    b.startle = Math.max(0, b.startle - dt * 0.25);
    const fwd = _v.copy(b.vel).normalize();
    const lat = acc.dot(_v2.crossVectors(UP, fwd).normalize());
    this._orient(b, fwd, clamp(lat / 12, -1.1, 1.1), dt, 0);
    // flight: flap bursts and glides; hard flapping when climbing or startled
    const effort = clamp(fwd.y * 2 + startle + (sp < 7 ? 0.4 : 0), 0, 1);
    b.boundT -= dt;
    if (b.boundT <= 0) {
      b.bounding = !b.bounding && effort < 0.5;
      b.boundT = b.bounding ? lerp(0.25, 0.6, Math.random()) : lerp(0.5, 1.1, Math.random());
    }
    const ampT = b.bounding ? 0.08 : 0.85 + effort * 0.3;
    b.amp += (ampT - b.amp) * (1 - Math.exp(-dt * 8));
    b.phase += TAU * (SPEC.coilwing.beat + effort * 3) * dt / Math.sqrt(b.span / 0.32) * (b.bounding ? 0.3 : 1);
    b.fold += (0 - b.fold) * (1 - Math.exp(-dt * 8));
    b.sweep += ((b.bounding ? 0.25 : 0) - b.sweep) * (1 - Math.exp(-dt * 5));
    b.curl += (0 - b.curl) * (1 - Math.exp(-dt * 4));
    b.legs += (0 - b.legs) * (1 - Math.exp(-dt * 5));
    b.crest += ((startle > 0.2 ? 1 : 0.15) - b.crest) * (1 - Math.exp(-dt * 6));
    b.hy += (0 - b.hy) * (1 - Math.exp(-dt * 4));
    b.hp += (0 - b.hp) * (1 - Math.exp(-dt * 4));
    b.jaw += (0 - b.jaw) * (1 - Math.exp(-dt * 6));
    b.hop = 0;
  }

  _land(b, dt, ctx) {
    if (b.roost) this._roostFrame(b.roost, dt, ctx.time);
    const tgt = this._perchPos(b, _v3);
    const info = b.roost ? this._roostInfo.get(b.roost) : null;
    const up = info ? info.up : UP;
    const base = info ? info.vel : _v2.set(0, 0, 0);
    _v.subVectors(tgt, b.pos);
    const d = _v.length();
    _v.addScaledVector(up, Math.min(d * 0.25, 4));
    const want = _v.normalize().multiplyScalar(Math.min(9, d * 1.3 + 0.4)).add(base);
    const dv = want.sub(b.vel);
    const amax = 14;
    if (dv.length() > amax * dt) dv.setLength(amax * dt);
    b.vel.add(dv);
    b.pos.addScaledVector(b.vel, dt);
    const rel = _v.subVectors(b.vel, base);
    const relSp = rel.length();
    const fwd = relSp > 0.5 ? _v2.copy(rel).normalize() : _v2.set(Math.sin(b.perchYaw), 0, Math.cos(b.perchYaw));
    const flare = 1 - smoothstep(0.5, 4, d);
    this._orient(b, fwd, 0, dt, flare * 0.9);
    b.fold += (0 - b.fold) * (1 - Math.exp(-dt * 8));
    b.amp += (0.9 + flare * 0.4 - b.amp) * (1 - Math.exp(-dt * 8));
    b.phase += TAU * (SPEC.coilwing.beat + flare * 3) * dt;
    b.legs += (flare - b.legs) * (1 - Math.exp(-dt * 6));
    b.crest += (flare * 0.6 - b.crest) * (1 - Math.exp(-dt * 4));
    if (d < 0.25 + 0.2 * b.span) {
      b.mode = 'perch';
      b.headT = 0.5;
      b.hopT = lerp(4, 12, Math.random());
      b.snap.subVectors(b.pos, tgt);
    }
  }

  _perchIdle(b, dt, ctx) {
    this._perchPos(b, b.pos);
    b.snap.multiplyScalar(Math.exp(-dt * 7));
    b.pos.add(b.snap);
    let fwd, up;
    if (b.roost) {
      const info = this._roostFrame(b.roost, dt, ctx.time);
      b.vel.copy(info.vel);
      _m.makeBasis(info.right, info.up, info.fwd);
      _q.setFromRotationMatrix(_m);
      fwd = info.fwd; up = info.up;
    } else {
      b.vel.set(0, 0, 0);
      _q.identity();
    }
    void fwd; void up;
    _e.set(-0.32, b.perchYaw, 0, 'YXZ');
    _q.multiply(_q2.setFromEuler(_e));
    b.quat.slerp(_q, 1 - Math.exp(-dt * 9));
    b.headT -= dt;
    if (b.headT <= 0) {
      b.headT = lerp(0.5, 2.6, Math.random());
      b.hyT = (Math.random() - 0.5) * 2.2;
      b.hpT = (Math.random() - 0.5) * 0.5;
    }
    b.hy += (b.hyT - b.hy) * (1 - Math.exp(-dt * 10));
    b.hp += (b.hpT - b.hp) * (1 - Math.exp(-dt * 8));
    b.hopT -= dt;
    if (b.hopT <= 0) {
      b.hopT = lerp(5, 16, Math.random());
      b.hopPh = 0;
      if (Math.random() < 0.5) b.flutter = 0.45;
      b.perchYaw += (Math.random() - 0.5) * 0.8;
      if (Math.random() < 0.3) b.crestFlash = 1.2;
    }
    if (b.hopPh !== undefined) {
      b.hopPh += dt * 4;
      b.hop = Math.sin(Math.min(b.hopPh, 1) * Math.PI) * 0.1 * b.span;
      if (b.hopPh >= 1) { b.hopPh = undefined; b.hop = 0; }
    }
    b.flutter = Math.max(0, (b.flutter || 0) - dt);
    b.crestFlash = Math.max(0, (b.crestFlash || 0) - dt);
    const fl = b.flutter > 0;
    b.fold += ((fl ? 0.45 : 1) - b.fold) * (1 - Math.exp(-dt * 10));
    b.amp += ((fl ? 0.7 : 0) - b.amp) * (1 - Math.exp(-dt * 10));
    b.phase += TAU * 9 * dt;
    b.sweep += (0 - b.sweep) * (1 - Math.exp(-dt * 6));
    // the tail rolls up into its spiral, slowly
    b.curl += (1 - b.curl) * (1 - Math.exp(-dt * 1.2));
    b.legs += (1 - b.legs) * (1 - Math.exp(-dt * 8));
    b.crest += ((b.crestFlash > 0 ? 1 : 0.1) - b.crest) * (1 - Math.exp(-dt * 5));
    if (ctx.threat && ctx.threat.distanceToSquared(b.pos) < 110 * 110) this._alarm(b.flock, ctx.threat);
  }

  // ---------------------------------------------------------------------------------------
  // skimmers
  _updateSkimFlock(fl, dt, ctx) {
    const t = ctx.time;
    if (ctx.threat) {
      const near = fl.birds.some((b) => b.pos.distanceToSquared(ctx.threat) < 140 * 140);
      if (near && t - fl.alarmT > 2) this._alarm(fl, ctx.threat);
    }
    // nests: one ledge per bird (shared ledges keep a wingspan apart)
    if (fl.nests && fl.nests.length) {
      let k = 0;
      for (const b of fl.birds) {
        if (b.nest && fl.nests.includes(b.nest.pe)) continue;
        const pe = fl.nests[k++ % fl.nests.length];
        const slot = Math.floor(k / Math.max(1, fl.nests.length));
        const a = slot * 2.1 + fl.rng() * 0.4;
        b.nest = { pe, off: new Vector3(Math.cos(a) * slot * 1.6, 0, Math.sin(a) * slot * 1.6), yaw: fl.rng() * TAU };
        if (b.mode === 'fly' && fl.rng() < 0.6) { b.mode = 'perch'; b.perch = pe; b.off.copy(b.nest.off); b.perchYaw = Math.atan2(pe.p.x - fl.home.x, pe.p.z - fl.home.z) + Math.PI + (fl.rng() - 0.5); this._perchPos(b, b.pos); b.t = lerp(4, 25, fl.rng()); b.fold = 1; b.legs = 1; }
      }
    }
    for (const b of fl.birds) this._skimmer(b, fl, dt, ctx);
  }

  /** Nearest school a skimmer can reach: shallow enough to dive or skim for. */
  _prey(b, fl) {
    let best = null, bd = 380;
    for (const sc of this.eco.fish.schools) {
      if (sc.species === 'lanternjack' || sc.alive < 10) continue;
      const top = sc.surf - (sc.center.y + sc.R * 0.6);
      if (top > 7) continue;
      const d = Math.hypot(sc.center.x - b.pos.x, sc.center.z - b.pos.z);
      if (d < bd) { bd = d; best = sc; }
    }
    void fl;
    return best;
  }

  _skimmer(b, fl, dt, ctx) {
    const t = ctx.time;
    const r = b.rng;
    const spec = SPEC.skimmer;
    b.t -= dt;
    const surf = this.eco.seaHeightFast(b.pos.x, b.pos.z);
    const song = ctx.songFocus && ctx.songFocus.distanceTo(b.pos) < 420 ? ctx.songFocus : null;
    let tgt = null, speed = 9, flapK = 0.4, legsT = 0, foldT = 0, sweepT = 0, jawT = 0, crestT = 0.1, hpT = 0;
    switch (b.mode) {
      case 'perch': {
        // at the nest: preening, looking out to sea, displaying the crest now and then
        this._perchPos(b, _v3);
        b.pos.lerp(_v3, 1 - Math.exp(-dt * 8));
        b.vel.set(0, 0, 0);
        _e.set(-0.42, b.perchYaw, 0, 'YXZ');
        _q.setFromEuler(_e);
        b.quat.slerp(_q, 1 - Math.exp(-dt * 6));
        b.headT -= dt;
        if (b.headT <= 0) { b.headT = lerp(0.8, 3.2, r()); b.hyT = (r() - 0.5) * 2; b.hpT = (r() - 0.5) * 0.6; if (r() < 0.25) b.display = 2.2; }
        b.display = Math.max(0, (b.display || 0) - dt);
        b.hy += (b.hyT - b.hy) * (1 - Math.exp(-dt * 6));
        b.hp += (b.hpT - b.hp) * (1 - Math.exp(-dt * 6));
        b.fold += (1 - b.fold) * (1 - Math.exp(-dt * 4));
        b.legs += (1 - b.legs) * (1 - Math.exp(-dt * 6));
        b.amp += ((b.display > 1.4 ? 0.35 : 0) - b.amp) * (1 - Math.exp(-dt * 5));
        b.phase += TAU * 1.5 * dt;
        b.crest += ((b.display > 0 ? 1 : 0.1) - b.crest) * (1 - Math.exp(-dt * 4));
        b.jaw += ((b.display > 0.6 && b.display < 1.6 ? 0.25 : 0) - b.jaw) * (1 - Math.exp(-dt * 10));
        b.sweep += (0 - b.sweep) * (1 - Math.exp(-dt * 4));
        // storms and the night are sat out on the ledge
        if (this.act && this.act.shelter > 0.5 && !song) b.t = Math.max(b.t, 2);
        if (b.t <= 0 || song) {
          this._release(b);
          b.mode = 'takeoff';
          b.t = 1.8;
          // drop off the ledge, out to sea
          b.vel.set(Math.sin(b.perchYaw), -0.6, Math.cos(b.perchYaw)).multiplyScalar(5);
        }
        return;
      }
      case 'takeoff':
        tgt = _v.copy(b.pos).addScaledVector(b.vel.lengthSq() > 0.1 ? _v2.copy(b.vel).setY(0).normalize() : _v2.set(1, 0, 0), 20).setY(Math.max(b.pos.y + 4, surf + 12));
        speed = 10; flapK = 1.15;
        if (b.t <= 0) { b.mode = 'soar'; b.t = lerp(6, 16, r()); b.circleA = r() * TAU; }
        break;
      case 'nip': {
        // a hunting whale in the air near the nests: dive at it, jaws open, one nip and away
        const H = this.eco.hunter;
        if (!H || H.under || b.t <= 0) { b.mode = 'soar'; b.t = lerp(6, 10, r()); break; }
        tgt = _v.copy(H.pos).addScaledVector(H.up || UP, (H.L || 8) * 0.2);
        speed = 15; flapK = 0.9; jawT = 0.65; crestT = 1; hpT = 0.25;
        if (b.pos.distanceTo(H.pos) < (H.L || 8) * 0.4 + 1.4) {
          this.eco._hit('skimmer', b.pos, 0.4);
          b.kick.subVectors(b.pos, H.pos).normalize().multiplyScalar(9);
          b.kick.y += 6;
          b.startle = 1;
          b.mode = 'soar';
          b.t = lerp(8, 14, r());
        }
        break;
      }
      case 'soar': {
        // a hunting whale flying close: one of the flock may dive at it
        const H = this.eco.hunter;
        if (H && !H.under && H.hunting > 0.25 && t > this._nipT && H.pos.y > surf + 4 && b.pos.distanceToSquared(H.pos) < 80 * 80 && r() < dt * 0.4 * H.hunting) {
          b.mode = 'nip'; b.t = 5; this._nipT = t + 8;
        }
        // thermal circles over the hunting ground (or round the song)
        const c = song || (b.prey ? b.prey.center : fl.home);
        b.circleA = (b.circleA || 0) + dt * 0.28 * (b.seed > 5 ? 1 : -1);
        const rr = song ? 30 : 34 + (b.seed % 3) * 8;
        const alt = (song ? Math.max(song.y + 10, surf + 20) : surf + 26 + (b.seed % 4) * 6);
        tgt = _v.set(c.x + Math.cos(b.circleA) * rr, alt, c.z + Math.sin(b.circleA) * rr);
        speed = 9.5; flapK = 0.25; crestT = song ? 1 : 0.1;
        // a storm or the night coming on: home to the ledge
        if (!song && b.nest && this.act && this.act.shelter > 0.5) { b.mode = 'return'; b.t = 40; b.hunts = 0; break; }
        if (b.t <= 0 && !song) {
          b.prey = this._prey(b, fl);
          if (b.prey && b.hunts < 4) {
            const sc = b.prey;
            const top = sc.surf - (sc.center.y + sc.R * 0.6);
            b.hunts++;
            if (top < 2.6 && r() < 0.6) {
              // skim: a straight pass across the school, jaw in the water
              const a = r() * TAU;
              b.dir.set(Math.cos(a), 0, Math.sin(a));
              b.aim.copy(sc.center).addScaledVector(b.dir, -(sc.R + 34));
              b.mode = 'skimIn';
              b.t = 14;
            } else {
              b.mode = 'aim';
              b.t = lerp(2.5, 5, r());
            }
          } else if (b.nest && b.hunts >= 2) { b.mode = 'return'; b.t = 40; b.hunts = 0; }
          else b.t = lerp(5, 12, r());
        }
        break;
      }
      case 'skimIn': {
        // descend to the start of the pass
        const sc = b.prey;
        if (!sc) { b.mode = 'soar'; b.t = 4; break; }
        tgt = _v.copy(b.aim).setY(surf + 0.7);
        speed = 11; flapK = 0.6;
        const d = Math.hypot(b.pos.x - b.aim.x, b.pos.z - b.aim.z);
        if (d < 6 || b.t <= 0) { b.mode = 'skim'; b.t = (sc.R * 2 + 60) / 11; }
        break;
      }
      case 'skim': {
        // glide just above the swell, the lower jaw ploughing a line through the water
        const sc = b.prey;
        tgt = _v.copy(b.pos).addScaledVector(b.dir, 12).setY(surf + 0.55);
        speed = 11; flapK = 0.12; jawT = 0.42; hpT = 0.35;
        const tip = _v3.copy(b.pos).addScaledVector(b.dir, b.span * 0.55).setY(surf - 0.05);
        this.eco.ocean?.wake?.(tip, b.vel, 0.25 * b.span);
        if (sc && sc.alive > 0) {
          this._eatOpts.only = sc;
          const n = this.eco.fish.eatAt(_v2.copy(tip).setY(surf - 0.35), null, 0.45 * b.span, this._eatOpts);
          if (n > 0) { b.snapT = 0.35; b.ate += n; this.eco.splash(tip, 0.12, 0.3, true, { tag: 'snap' }); }
        }
        if ((b.snapT || 0) > 0) { b.snapT -= dt; jawT = 0; hpT = -0.3; }
        if (b.t <= 0) { b.mode = 'soar'; b.t = lerp(4, 9, r()); }
        break;
      }
      case 'aim': {
        // hang over the school, then fold and drop
        const sc = b.prey;
        if (!sc) { b.mode = 'soar'; b.t = 4; break; }
        b.circleA = (b.circleA || 0) + dt * 0.6;
        tgt = _v.set(sc.center.x + Math.cos(b.circleA) * 6, sc.surf + 18 + (b.seed % 3) * 2, sc.center.z + Math.sin(b.circleA) * 6);
        speed = 7; flapK = 0.6; hpT = 0.6;
        if (b.t <= 0) { b.mode = 'plunge'; b.t = 4; }
        break;
      }
      case 'plunge': {
        const sc = b.prey;
        const aim = sc ? _v2.copy(sc.center).setY(sc.surf) : _v2.copy(b.pos).setY(surf);
        _v3.subVectors(aim, b.pos);
        const d = _v3.length();
        b.vel.lerp(_v3.normalize().multiplyScalar(Math.min(20, b.vel.length() + 14 * dt)), 1 - Math.exp(-dt * 3));
        b.vel.y -= 9.81 * dt * 0.5;
        b.pos.addScaledVector(b.vel, dt);
        sweepT = 1; flapK = 0; hpT = 0.0;
        b.sweep += (1 - b.sweep) * (1 - Math.exp(-dt * 5));
        b.amp += (0 - b.amp) * (1 - Math.exp(-dt * 6));
        this._orient(b, _v3.copy(b.vel).normalize(), 0, dt, 0);
        // the diving bird is a predator the fish feel coming
        this._predator(b, ctx, 3.5, 1.2);
        if (b.pos.y < surf + 0.1 || d < 0.5) {
          b.mode = 'under';
          b.t = lerp(1.2, 2.2, r());
          this.eco.splash(_v.copy(b.pos).setY(surf), 0.55 + b.span * 0.12, 0.9, false);
          this.eco.bubbles?.emit?.(_v.copy(b.pos).setY(surf - 1.2), 0.5, { stream: 0.4, spread: 0.3 });
        }
        return;
      }
      case 'under': {
        // momentum carries it down; it chases fish with half-open wings, then floats up
        const sc = b.prey;
        b.vel.multiplyScalar(Math.exp(-dt * 2.2));
        // a short chase (only while its breath and momentum last, and never deep), then up
        const depth = surf - b.pos.y;
        if (sc && b.t > 0 && depth < 3.5) {
          _v3.subVectors(sc.center, b.pos);
          b.vel.addScaledVector(_v3.normalize(), 5 * dt);
        }
        b.vel.y += (b.t > 0 ? 3.2 : 9) * dt;
        b.pos.addScaledVector(b.vel, dt);
        b.sweep += (0.6 - b.sweep) * (1 - Math.exp(-dt * 4));
        b.amp += (0.35 - b.amp) * (1 - Math.exp(-dt * 4));
        b.phase += TAU * 2.0 * dt;
        this._orient(b, _v3.copy(b.vel).lengthSq() > 0.01 ? _v3.normalize() : _v3.set(0, 1, 0), 0, dt, 0);
        if (sc) {
          const beak = _v3.copy(b.pos).addScaledVector(_v2.set(0, 0, 1).applyQuaternion(b.quat), b.span * 0.5);
          this._eatOpts.only = sc;
          const n = this.eco.fish.eatAt(beak, null, 0.5 * b.span, this._eatOpts);
          if (n) b.ate += n;
        }
        this._predator(b, ctx, 2.2, 1.0);
        if ((b.t <= 0 && b.pos.y > surf - 0.3) || (b.pos.y > surf && b.vel.y > 0) || b.t < -6) {
          b.mode = 'float';
          b.t = lerp(2, 5, r());
          b.pos.y = surf;
          b.vel.y = 0;
        }
        return;
      }
      case 'float': {
        // rides the swell, wings folded, swallowing
        b.pos.y = surf + 0.05 * b.span;
        b.vel.multiplyScalar(Math.exp(-dt * 1.5));
        b.vel.y = 0;
        b.pos.addScaledVector(b.vel, dt);
        const yaw = Math.atan2(b.dir.x, b.dir.z);
        _e.set(0.1, yaw, Math.sin(t * 1.3 + b.seed) * 0.08, 'YXZ');
        _q.setFromEuler(_e);
        b.quat.slerp(_q, 1 - Math.exp(-dt * 3));
        b.fold += (0.9 - b.fold) * (1 - Math.exp(-dt * 3));
        b.sweep += (0 - b.sweep) * (1 - Math.exp(-dt * 3));
        b.amp += (0 - b.amp) * (1 - Math.exp(-dt * 4));
        b.legs += (0.3 - b.legs) * (1 - Math.exp(-dt * 4));
        // swallowing: the head tips back, the jaw works
        const sw = Math.max(0, Math.sin(t * 6 + b.seed)) * (b.ate > 0 ? 1 : 0.2);
        b.hp += (0.5 * sw - b.hp) * (1 - Math.exp(-dt * 8));
        b.jaw += (0.18 * sw - b.jaw) * (1 - Math.exp(-dt * 10));
        if (b.t <= 0) { b.mode = 'waterOff'; b.t = 2.2; b.ate = 0; const a = r() * TAU; b.dir.set(Math.cos(a), 0, Math.sin(a)); b.vel.copy(b.dir).multiplyScalar(1.5); }
        return;
      }
      case 'waterOff': {
        // running across the water, beating hard; a splash with each downstroke
        tgt = _v.copy(b.pos).addScaledVector(b.dir, 15).setY(surf + (b.t < 1 ? 3 : 0.4));
        speed = 9; flapK = 1.25; legsT = 0.8;
        const s0 = Math.sin(b.phase);
        if (s0 > 0.95 && b.pos.y < surf + 1) this.eco.splash(_v3.copy(b.pos).setY(surf), 0.08, 0.35, true, { tag: 'run' });
        if (b.t <= 0) { b.mode = 'soar'; b.t = lerp(5, 12, r()); }
        break;
      }
      case 'return': {
        if (!b.nest) { b.mode = 'soar'; b.t = 10; break; }
        const pe = b.nest.pe;
        b.perch = pe;
        b.off.copy(b.nest.off);
        const tp = this._perchPos(b, _v3);
        const d = tp.distanceTo(b.pos);
        tgt = _v.copy(tp).add(_v2.set(0, Math.min(d * 0.3, 12), 0));
        speed = Math.min(10, 2.5 + d * 0.4); flapK = d < 15 ? 0.9 : 0.3; legsT = smoothstep(18, 4, d);
        if (d < 1.2) {
          b.mode = 'perch';
          b.t = lerp(12, 40, r());
          b.perchYaw = Math.atan2(pe.p.x - fl.home.x, pe.p.z - fl.home.z) + Math.PI + (r() - 0.5) * 0.8;
          const occ = this._perchOcc.get(pe) || 0;
          this._perchOcc.set(pe, occ + 1);
          return;
        }
        if (b.t <= 0) { b.mode = 'soar'; b.t = 8; }
        break;
      }
      default:
        b.mode = 'soar';
        b.t = 5;
        tgt = _v.copy(fl.home);
    }
    // ---- generic steering flight for the states above ----
    if (!tgt) tgt = _v.copy(fl.home);
    // flee threats and shocks
    const acc = b.acc;
    _v2.subVectors(tgt, b.pos);
    const dT = _v2.length();
    const want = _v2.multiplyScalar(speed / Math.max(dT, 1e-3));
    if (ctx.threat) {
      _v3.subVectors(b.pos, ctx.threat);
      const d = _v3.length();
      if (d < 120) want.addScaledVector(_v3, (120 - d) / 120 * 14 / Math.max(d, 1));
    }
    if (b.kick.lengthSq() > 0.01) { want.add(b.kick); b.kick.multiplyScalar(Math.exp(-dt * 2)); }
    acc.subVectors(want, b.vel).multiplyScalar(b.mode === 'skim' ? 3 : 1.6);
    // stay off the water unless skimming / taking off
    const floor = b.mode === 'skim' || b.mode === 'waterOff' || b.mode === 'skimIn' ? surf + 0.45 : surf + 5;
    if (b.pos.y < floor) acc.y += (floor - b.pos.y) * 4;
    b.vel.addScaledVector(acc, dt);
    const sp = b.vel.length();
    if (sp > 16) b.vel.multiplyScalar(16 / sp);
    if (sp < 3 && b.mode !== 'waterOff') b.vel.multiplyScalar(3 / Math.max(sp, 1e-3));
    b.pos.addScaledVector(b.vel, dt);
    if ((b.mode === 'skim' || b.mode === 'waterOff') && b.pos.y < surf + 0.4) b.pos.y = surf + 0.4;
    const fwd = _v3.copy(b.vel).normalize();
    const lat = acc.dot(_v2.crossVectors(UP, fwd).normalize());
    this._orient(b, fwd, clamp(lat / 10, -0.9, 0.9), dt, b.mode === 'return' ? legsT * 0.7 : 0);
    // wings: long glides, slow deep beats when working
    const effort = clamp(flapK + Math.max(0, fwd.y) * 1.5 + (sp < 7 ? 0.3 : 0) + b.startle, 0, 1.3);
    const glide = effort < 0.3 && Math.sin(t * 0.3 + b.seed) > -0.3;
    b.amp += ((glide ? 0.06 : 0.55 + effort * 0.4) - b.amp) * (1 - Math.exp(-dt * 4));
    b.phase += TAU * spec.beat * (glide ? 0.25 : 0.8 + effort * 0.35) * dt;
    b.fold += (foldT - b.fold) * (1 - Math.exp(-dt * 5));
    b.sweep += (sweepT - b.sweep) * (1 - Math.exp(-dt * 4));
    b.legs += (legsT - b.legs) * (1 - Math.exp(-dt * 4));
    b.jaw += (jawT - b.jaw) * (1 - Math.exp(-dt * (jawT < b.jaw ? 18 : 6)));
    b.crest += (crestT - b.crest) * (1 - Math.exp(-dt * 3));
    b.hp += (hpT - b.hp) * (1 - Math.exp(-dt * 4));
    b.hy += (0 - b.hy) * (1 - Math.exp(-dt * 4));
    b.startle = Math.max(0, b.startle - dt * 0.3);
  }

  /** A bird hunting in or over the water: fish feel it (and flee) this frame. */
  _predator(b, ctx, r, s) {
    const q = b._pred || (b._pred = { x: 0, y: 0, z: 0, r: 0, s: 0, vx: 0, vy: 0, vz: 0 });
    q.x = b.pos.x + b.vel.x * 0.2; q.y = b.pos.y + b.vel.y * 0.2; q.z = b.pos.z + b.vel.z * 0.2;
    q.r = r; q.s = s;
    q.vx = b.vel.x; q.vy = b.vel.y; q.vz = b.vel.z;
    ctx.predators.push(q);
  }

  _orient(b, fwd, bankT, dt, flare) {
    const yaw = Math.atan2(fwd.x, fwd.z);
    let pitch = Math.asin(fwd.y < -1 ? -1 : fwd.y > 1 ? 1 : fwd.y);
    pitch += flare;
    b.roll += (-bankT - b.roll) * (1 - Math.exp(-dt * 6));
    b.pitch += (pitch - b.pitch) * (1 - Math.exp(-dt * 9));
    // YXZ euler (yaw, -pitch, roll) straight to a quaternion, then a normalised lerp
    const hy = yaw * 0.5, hx = -b.pitch * 0.5, hz = b.roll * 0.5;
    const cy = Math.cos(hy), sy = Math.sin(hy), cx = Math.cos(hx), sx = Math.sin(hx), cz = Math.cos(hz), sz = Math.sin(hz);
    let qx = sx * cy * cz + cx * sy * sz;
    let qy = cx * sy * cz - sx * cy * sz;
    let qz = cx * cy * sz - sx * sy * cz;
    let qw = cx * cy * cz + sx * sy * sz;
    const q = b.quat;
    if (q.x * qx + q.y * qy + q.z * qz + q.w * qw < 0) { qx = -qx; qy = -qy; qz = -qz; qw = -qw; }
    const k = 1 - Math.exp(-dt * 12);
    q.set(q.x + (qx - q.x) * k, q.y + (qy - q.y) * k, q.z + (qz - q.z) * k, q.w + (qw - q.w) * k).normalize();
  }
}
