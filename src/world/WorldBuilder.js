// Builds Vur Sok along the migration route: spiral islands rising from the sea, reef shelves and
// spiral atolls, the Spiral Arch, waterfalls into the sea, clouds, and the spawn points of the
// living sea (fish schools, bird-reptile flocks, night plankton) and their perches.
//
// Two phases. layout() runs in the constructor: it decides every chapter's islands, atolls and
// spawns (cheap, no geometry), so collisions and seabedAt() work for the whole route at once.
// buildChapter() then builds geometry chapter by chapter, time-sliced so the title menu stays
// smooth while the world grows behind it.
import { Group, Vector3 } from 'three';
import { buildIsland, stackShape, coilShape, ammoniteShape, peakShape } from './Islands.js';
import { Seabed, DEEP } from './Seabed.js';
import { buildWaterfall } from './Water.js';
import { buildSpiralArch } from './Landmarks.js';
import { rng, lerp, clamp, smoothstep, TAU } from '../core/math.js';

const nextFrame = () => new Promise((res) => requestAnimationFrame(() => res()));
export const CHAPTER_ORDER = ['cradle', 'valleys', 'krill', 'forest', 'song', 'night', 'storm', 'falcon', 'wall', 'oasis'];
const SHAPES = { stack: stackShape, coil: coilShape, ammonite: ammoniteShape, peak: peakShape };
const _v = new Vector3(), _w = new Vector3();

export class WorldBuilder {
  constructor(game, path) {
    this.game = game;
    this.path = path;
    this.groups = {};
    this.plan = {};
    this.islands = []; // { chapter, kind, shape, pos, R, H, style, mesh, far, rim }
    this.sphereColliders = []; // { p, r, chapter, soft }
    this.capsules = []; // { a, b, r, chapter }
    this.waterfalls = [];
    this.lakes = [];
    this.perches = []; // { p, n, chapter }
    // fish / reptiles / plankton are Vur Sok's; the old sky spawns stay as empty lists
    this.spawns = { fish: [], reptiles: [], plankton: [], krill: [], rays: [], jellies: [], birds: [] };
    this.lightningSpots = [];
    this.vents = []; // steam vents of forming islands: { p, strength, chapter }
    this.seabed = new Seabed();
    this.progress = 0;
    this.built = new Set();
    this.done = new Set();
    this._tiles = new Set();
    this._v = new Vector3();
    this.lodDist = 650;
    for (const id of CHAPTER_ORDER) this.plan[id] = { islands: [], extras: [], features: [] };
    this.layout();
  }

  group(id) {
    if (!this.groups[id]) {
      const g = new Group();
      g.name = 'chapter-' + id;
      this.groups[id] = g;
      this.game.engine.scene.add(g);
    }
    return this.groups[id];
  }

  // ---- layout helpers ---------------------------------------------------------------------
  /** Sea-level point in the route frame (lateral metres to the right of the route). */
  at(s, lat = 0, out = new Vector3()) {
    this.path.offsetAt(s, lat, 0, 0, out);
    out.y = 0;
    return out;
  }

  /** Push an island sideways until the route keeps `clear` metres from its rock. */
  _clearCorridor(shape, pos, s, clear) {
    const f = this.path.frameAt(s);
    const side = Math.sign(_v.subVectors(pos, f.pos).dot(f.right)) || 1;
    const span = shape.R + 450;
    for (let it = 0; it < 8; it++) {
      let worst = Infinity;
      for (let q = s - span; q <= s + span; q += 25) {
        if (q < -300 || q > this.path.length + 300) continue;
        this.path.pointAt(clamp(q, 0, this.path.length), _w);
        const d = shape.dist(_w.x - pos.x, _w.y, _w.z - pos.z);
        if (d < worst) worst = d;
      }
      if (worst >= clear) break;
      pos.addScaledVector(f.right, side * (clear - worst + 8));
    }
    return pos;
  }

  /** Keep a new island off the ones already placed (centre spacing by radius). */
  _clearIslands(rec) {
    for (let it = 0; it < 6; it++) {
      let moved = false;
      for (const o of this.islands) {
        if (o === rec) continue;
        const d = Math.hypot(rec.pos.x - o.pos.x, rec.pos.z - o.pos.z);
        const need = (rec.R + o.R) * 0.62;
        if (d < need) {
          const k = (need - d + 4) / Math.max(d, 1);
          rec.pos.x += (rec.pos.x - o.pos.x) * k;
          rec.pos.z += (rec.pos.z - o.pos.z) * k;
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  /**
   * Plan an island. kind: stack | coil | ammonite | peak. params: archetype options. o: { style,
   * clear (corridor clearance), shelf: shelf options, falls, perch, veg }.
   */
  island(chapter, kind, params, s, lat, o = {}) {
    const shape = SHAPES[kind](params);
    const pos = o.pos ? new Vector3(o.pos.x, 0, o.pos.z) : this.at(s, lat);
    if (o.clear !== false) this._clearCorridor(shape, pos, s, o.clear ?? 40);
    const rec = {
      chapter, kind, shape, pos, s, R: shape.R, H: shape.H, style: Object.assign({ rock: 'banded' }, o.style),
      seed: params.seed ?? 1, falls: o.falls ?? 0, mesh: null, far: null, rim: null, opts: o,
    };
    if (o.avoid !== false) this._clearIslands(rec);
    this.islands.push(rec);
    this.plan[chapter].islands.push(rec);
    const volcanic = rec.style.rock === 'volcanic' || rec.style.rock === 'basalt';
    const sh = Object.assign({ R: shape.R, seed: rec.seed + 17, beach: volcanic ? 0.6 : 0.4, volcanic: rec.style.rock === 'volcanic', shelf: clamp(shape.R * 0.45, 30, 95), chapter }, o.shelf || {});
    const fp = shape.footprint;
    this.plan[chapter].features.push(this.seabed.addShelf(pos.x, pos.z, fp, sh));
    return rec;
  }

  atoll(chapter, x, z, o) {
    const f = this.seabed.addAtoll(x, z, Object.assign({ chapter }, o));
    this.plan[chapter].features.push(f);
    return f;
  }

  shoal(chapter, x, z, R, depth, o = {}) {
    const f = this.seabed.addShoal(x, z, R, depth, Object.assign({ chapter }, o));
    this.plan[chapter].features.push(f);
    return f;
  }

  fish(chapter, s, lat, depth, species, count) {
    const p = this.at(s, lat);
    const floor = this.seabedAt(p.x, p.z);
    p.y = Math.max(-depth, floor + 3);
    if (p.y > -1.5) p.y = -1.5;
    this.spawns.fish.push({ pos: p, species, count, chapter });
  }

  reptiles(chapter, pos, species, count) {
    this.spawns.reptiles.push({ pos: pos.clone(), species, count, chapter });
  }

  extra(chapter, fn) { this.plan[chapter].extras.push(fn); }

  // ---- layout ------------------------------------------------------------------------------
  layout() {
    const P = this.path;
    const ch = (id) => P.chapterById(id);
    const R = (k) => rng(1000 + ch(k).index * 77);

    // 0 · Dawn Lagoon: the herd wakes inside a sheltering spiral atoll; lit stacks to the west
    {
      const id = 'cradle', r = R(id);
      const C = this.at(150, 0);
      this.atoll(id, C.x, C.z, { a: 255, b: 0.045, turns: 1.14, rimW: 40, lagoon: -6.5, motu: 0.62, rot: 1.9, seed: 21 });
      this.island(id, 'ammonite', { R: 62, yaw: 0.15, seed: 101 }, 300, -250, { clear: 60 });
      this.island(id, 'stack', { R: 17, H: 78, lobes: 2, twist: 0.6, seed: 102, caves: [{ th: 0.2, w: 0.3, h: 9, depth: 0.4 }] }, 40, -210, { style: { rock: 'limestone' } });
      this.island(id, 'stack', { R: 10, H: 52, lobes: 3, twist: 1.1, seed: 103 }, 120, -150, { clear: 35, style: { rock: 'limestone' } });
      this.island(id, 'stack', { R: 7, H: 30, lobes: 2, twist: 1.4, seed: 104, cap: 'point', topFrac: 0.3 }, 200, -120, { clear: 30 });
      this.island(id, 'coil', { a: 14, b: 0.2, turns: 1.5, kw: 0.24, Hin: 34, fall: 1.8, seed: 105, steps: 8, horn: { H: 52, twist: 1.0 } }, 30, 170, { clear: 45 });
      this.island(id, 'peak', { R: 80, H: 210, turns: 2.4, seed: 106 }, 650, -720, { style: { rock: 'warm' }, falls: 1 });
      this.island(id, 'stack', { R: 24, H: 120, lobes: 3, twist: 0.9, seed: 107 }, 520, -380, { falls: 1 });
      this.island(id, 'stack', { R: 15, H: 64, lobes: 2, twist: 0.5, seed: 108 }, 760, 260);
      this.island(id, 'coil', { a: 20, b: 0.2, turns: 1.7, kw: 0.23, Hin: 66, fall: 2.0, seed: 109, steps: 11 }, -380, -520, { falls: 2 });
      for (let k = 0; k < 6; k++) this.fish(id, lerp(60, 330, r()), lerp(-160, 140, r()), lerp(2.5, 5, r()), r() < 0.7 ? 'glintfin' : 'spiralback', Math.round(lerp(120, 360, r())));
      this.reptiles(id, this.at(260, -200).setY(35), 'coilwing', 50);
      this.reptiles(id, this.at(520, -360).setY(60), 'skimmer', 7);
      this.extra(id, (w) => w._clouds(id, 8, { yMin: 320, yMax: 560, latMin: 300, latMax: 1400, s0: -600, s1: 1100 }));
      this.extra(id, (w) => w.game.clouds?.sheet?.(w.at(-200, -600).setY(18), 1600, 900, 14, { seed: 3, opacity: 0.32, minR: 26, maxR: 55, spacing: 12000 }));
    }

    // 1 · The Spiral Reach: coiled islands, helical stacks, waterfalls, the Spiral Arch
    {
      const id = 'valleys', r = R(id);
      this.island(id, 'ammonite', { R: 72, yaw: 1.2, seed: 201 }, 1010, -300, { falls: 0 });
      this.island(id, 'coil', { a: 22, b: 0.2, turns: 1.75, kw: 0.23, Hin: 78, fall: 2.0, seed: 202, steps: 12 }, 1180, 360, { falls: 3 });
      this.island(id, 'peak', { R: 90, H: 230, turns: 2.6, seed: 203 }, 1420, -640, { style: { rock: 'warm' }, falls: 2 });
      this.island(id, 'coil', { a: 18, b: 0.21, turns: 1.6, kw: 0.25, Hin: 60, fall: 1.8, seed: 204, steps: 10, dir: -1 }, 1620, -360, { falls: 2 });
      this.island(id, 'coil', { a: 26, b: 0.19, turns: 1.8, kw: 0.22, Hin: 90, fall: 2.1, seed: 205, steps: 13 }, 2330, 420, { falls: 3 });
      this.island(id, 'ammonite', { R: 58, yaw: -0.6, seed: 206 }, 2140, -330);
      this.island(id, 'peak', { R: 70, H: 180, turns: 2.0, seed: 207 }, 2500, -560, { style: { rock: 'limestone' } });
      // helical stacks near the corridor, in families
      for (let k = 0; k < 13; k++) {
        const s = lerp(960, 2560, (k + r() * 0.6) / 13);
        if (Math.abs(s - 1860) < 120) continue;
        const side = k % 2 ? 1 : -1;
        const big = r() < 0.35;
        const Rr = big ? lerp(16, 26, r()) : lerp(7, 15, r());
        const H = Rr * lerp(3.2, 5.5, r());
        const lat = side * lerp(110, 230, r());
        this.island(id, 'stack', { R: Rr, H, lobes: r() < 0.5 ? 2 : 3, twist: lerp(0.4, 1.3, r()), seed: 210 + k, cap: r() < 0.25 ? 'point' : 'dome', topFrac: lerp(0.55, 0.95, r()) }, s, lat, { clear: 34, style: { rock: r() < 0.5 ? 'banded' : 'limestone' }, falls: big && r() < 0.5 ? 1 : 0 });
        if (r() < 0.5) this.island(id, 'stack', { R: Rr * 0.45, H: H * lerp(0.35, 0.6, r()), lobes: 2, twist: 1.2, seed: 240 + k, cap: 'point', topFrac: 0.35 }, s + lerp(-40, 40, r()), lat + side * lerp(30, 50, r()), { clear: 30 });
      }
      // the Spiral Arch spans the route where it dips lowest
      const sArch = 1860;
      const f = P.frameAt(sArch);
      this.archInfo = { s: sArch, pos: f.pos.clone() };
      this.extra(id, (w) => w._arch(id, sArch));
      for (let k = 0; k < 8; k++) this.fish(id, lerp(950, 2550, r()), (r() < 0.5 ? -1 : 1) * lerp(150, 380, r()), lerp(3, 7, r()), r() < 0.6 ? 'glintfin' : 'spiralback', Math.round(lerp(150, 420, r())));
      for (let k = 0; k < 4; k++) this.reptiles(id, this.at(lerp(1000, 2500, r()), (r() < 0.5 ? -1 : 1) * lerp(120, 300, r())).setY(lerp(40, 90, r())), k % 2 ? 'skimmer' : 'coilwing', k % 2 ? 9 : 70);
      this.extra(id, (w) => w._clouds(id, 12, { yMin: 330, yMax: 650, latMin: 250, latMax: 1500 }));
    }

    // 2 · The Feasting Shoals: open sea over pale sandbanks; bait balls, distant volcanic coil
    {
      const id = 'krill', r = R(id);
      for (let k = 0; k < 6; k++) {
        const s = lerp(2700, 3820, (k + 0.5) / 6);
        const c = this.at(s, (r() - 0.5) * 140);
        this.shoal(id, c.x, c.z, lerp(150, 260, r()), lerp(-7, -12, r()), { seed: 300 + k });
      }
      this.island(id, 'coil', { a: 16, b: 0.2, turns: 1.5, kw: 0.28, Hin: 36, fall: 1.6, seed: 301, steps: 7, dir: -1, tipH: -3, horn: { H: 60, twist: 0.6, lobes: 2 } }, 3300, 820, { style: { rock: 'volcanic', meadow: 0.25 }, forming: true });
      this.island(id, 'stack', { R: 22, H: 110, lobes: 3, twist: 1.0, seed: 302 }, 2800, -900);
      this.island(id, 'stack', { R: 13, H: 70, lobes: 2, twist: 0.7, seed: 303 }, 2870, -820);
      this.island(id, 'peak', { R: 95, H: 240, turns: 2.5, seed: 304 }, 3700, -1150, { style: { rock: 'warm' } });
      this.island(id, 'ammonite', { R: 60, yaw: 0.9, seed: 305 }, 3150, -700);
      // the feast: bait balls over the shoals, spiral columns, patrolling lanternjacks
      for (let k = 0; k < 11; k++) this.fish(id, lerp(2680, 3840, (k + r() * 0.5) / 11), (r() - 0.5) * 170, lerp(5, 9, r()), 'glintfin', Math.round(lerp(900, 1600, r())));
      for (let k = 0; k < 5; k++) this.fish(id, lerp(2700, 3800, r()), (r() - 0.5) * 220, lerp(8, 14, r()), 'spiralback', Math.round(lerp(160, 320, r())));
      for (let k = 0; k < 4; k++) this.fish(id, lerp(2750, 3800, r()), (r() - 0.5) * 200, lerp(14, 22, r()), 'lanternjack', 2 + Math.floor(r() * 2));
      for (let k = 0; k < 4; k++) this.reptiles(id, this.at(lerp(2750, 3800, r()), (r() - 0.5) * 200).setY(lerp(12, 24, r())), 'skimmer', Math.round(lerp(8, 14, r())));
      this.extra(id, (w) => w._clouds(id, 14, { yMin: 350, yMax: 750, latMin: 300, latMax: 1600 }));
    }

    // 3 · The Coil Forest: coiled islands crowned with giant spiral trees, rookery stacks, sea mist
    {
      const id = 'forest', r = R(id);
      this.giantSpots = [];
      for (let k = 0; k < 7; k++) {
        const s = lerp(4000, 5300, (k + 0.3 + r() * 0.4) / 7);
        const side = k % 2 ? 1 : -1;
        const rec = this.island(id, 'coil', { a: lerp(16, 22, r()), b: 0.2, turns: lerp(1.4, 1.7, r()), kw: 0.25, Hin: lerp(42, 62, r()), fall: 1.8, seed: 400 + k, steps: 9, horn: { R: 22, H: lerp(55, 70, r()), cap: 'dome', topFrac: 0.85, twist: 0.4, lobes: 2, lobeAmp: 0.12, taperPow: 2, capH: 5 } }, s, side * lerp(230, 300, r()), { clear: 70, falls: 2, giant: true });
        this.giantSpots.push(rec);
      }
      for (let k = 0; k < 5; k++) {
        const s = lerp(3950, 5350, r());
        const side = r() < 0.5 ? -1 : 1;
        this.island(id, 'stack', { R: lerp(12, 20, r()), H: lerp(70, 130, r()), lobes: 3, twist: lerp(0.6, 1.4, r()), seed: 420 + k, topFrac: 0.7 }, s, side * lerp(130, 190, r()), { clear: 36, rookery: true });
      }
      this.island(id, 'peak', { R: 85, H: 220, turns: 2.2, seed: 430 }, 4700, 800, { style: { rock: 'warm' } });
      for (let k = 0; k < 5; k++) this.fish(id, lerp(3950, 5350, r()), (r() < 0.5 ? -1 : 1) * lerp(160, 300, r()), lerp(3, 6, r()), 'glintfin', Math.round(lerp(200, 500, r())));
      for (let k = 0; k < 4; k++) this.reptiles(id, this.at(lerp(4000, 5300, r()), (r() < 0.5 ? -1 : 1) * lerp(150, 260, r())).setY(lerp(60, 110, r())), 'coilwing', Math.round(lerp(70, 120, r())));
      for (let k = 0; k < 3; k++) this.reptiles(id, this.at(lerp(4000, 5300, r()), (r() < 0.5 ? -1 : 1) * lerp(130, 180, r())).setY(lerp(50, 80, r())), 'skimmer', Math.round(lerp(10, 16, r())));
      this.extra(id, (w) => {
        for (let k = 0; k < 6; k++) w.game.clouds?.sheet?.(w.at(lerp(3950, 5350, (k + 0.5) / 6), (r() - 0.5) * 400).setY(lerp(14, 30, r())), 800, 500, 16, { seed: 1200 + k, opacity: 0.42, minR: 24, maxR: 52, spacing: 7000 });
        w._clouds(id, 8, { yMin: 380, yMax: 650, latMin: 400, latMax: 1400 });
      });
    }

    // 4 · The Herd Song: a ring of helical stacks around calm water, golden hour
    {
      const id = 'song', r = R(id);
      const c = this.path.pointAt(5800);
      this.songCenter = c.clone();
      const fwd = this.path.tangentAt(5800);
      const inA = Math.atan2(-fwd.z, -fwd.x), outA = Math.atan2(fwd.z, fwd.x);
      const n = 13;
      for (let k = 0; k < n; k++) {
        let a = (k / n) * TAU + 0.21;
        const gapIn = Math.abs(Math.atan2(Math.sin(a - inA), Math.cos(a - inA))), gapOut = Math.abs(Math.atan2(Math.sin(a - outA), Math.cos(a - outA)));
        if (gapIn < 0.28 || gapOut < 0.28) continue;
        const d = lerp(430, 560, r());
        const H = lerp(90, 200, r());
        const Rr = H / lerp(4.2, 6.5, r());
        const pos = new Vector3(c.x + Math.cos(a) * d, 0, c.z + Math.sin(a) * d);
        this.island(id, 'stack', { R: Rr, H, lobes: 3, twist: lerp(0.6, 1.5, r()) * (k % 2 ? 1 : -1), seed: 500 + k, topFrac: lerp(0.6, 0.9, r()) }, 5800, 0, { pos, clear: false, avoid: false, falls: H > 160 ? 1 : 0, style: { rock: r() < 0.5 ? 'banded' : 'warm' } });
      }
      this.fish(id, 5800, 0, 8, 'glintfin', 900);
      this.fish(id, 5760, 120, 10, 'spiralback', 240);
      this.reptiles(id, this.at(5800, 300).setY(90), 'coilwing', 80);
      this.extra(id, (w) => w._clouds(id, 10, { yMin: 350, yMax: 700, latMin: 700, latMax: 1600 }));
    }

    // 5 · Night Passage: a forming island glows faintly at its foot; the sea lights up
    {
      const id = 'night', r = R(id);
      this.island(id, 'coil', { a: 15, b: 0.21, turns: 1.45, kw: 0.3, Hin: 30, fall: 1.5, seed: 601, steps: 6, tipH: -3, horn: { H: 48, twist: 0.5, lobes: 2 } }, 6600, 380, { style: { rock: 'volcanic', meadow: 0.2 }, forming: true });
      this.island(id, 'stack', { R: 16, H: 85, lobes: 2, twist: 0.8, seed: 602 }, 6350, -260);
      this.island(id, 'stack', { R: 11, H: 58, lobes: 3, twist: 1.2, seed: 603 }, 6820, -220);
      this.island(id, 'ammonite', { R: 66, yaw: -0.3, seed: 604 }, 6520, -480);
      for (let k = 0; k < 5; k++) {
        const p = this.at(lerp(6280, 6930, (k + 0.5) / 5), (r() - 0.5) * 200);
        this.spawns.plankton.push({ pos: p, radius: lerp(160, 260, r()), chapter: id });
      }
      for (let k = 0; k < 4; k++) this.fish(id, lerp(6300, 6900, r()), (r() - 0.5) * 300, lerp(4, 9, r()), 'glintfin', Math.round(lerp(400, 800, r())));
      this.fish(id, 6600, 120, 16, 'lanternjack', 3);
      this.extra(id, (w) => w._clouds(id, 8, { yMin: 350, yMax: 600, latMin: 300, latMax: 1300 }));
    }

    // 6 · The Storm: black basalt stacks far off, lightning over the heaving sea
    {
      const id = 'storm', r = R(id);
      for (let k = 0; k < 8; k++) {
        const s = lerp(7000, 8300, (k + r()) / 8);
        const side = k % 2 ? 1 : -1;
        this.island(id, 'stack', { R: lerp(12, 26, r()), H: lerp(80, 170, r()), lobes: 2, twist: lerp(0.3, 0.9, r()), seed: 700 + k, cap: r() < 0.5 ? 'point' : 'dome', topFrac: 0.5, sides: 6 }, s, side * lerp(260, 560, r()), { style: { rock: 'basalt', meadow: 0.4 } });
      }
      for (let k = 0; k < 14; k++) {
        const s = lerp(6900, 8400, (k + r()) / 14);
        this.lightningSpots.push(this.at(s, (r() < 0.5 ? -1 : 1) * lerp(150, 800, r())).setY(lerp(300, 520, r())));
      }
      this.extra(id, (w) => {
        const clouds = w.game.clouds;
        for (let k = 0; k < 14; k++) {
          const s = lerp(6850, 8450, (k + r()) / 14);
          const c = w.at(s, (r() < 0.5 ? -1 : 1) * lerp(250, 900, r())).setY(lerp(120, 220, r()));
          clouds?.tower?.(c, lerp(260, 420, r()), lerp(500, 800, r()), { seed: 1700 + k, dark: 0.85, maxPuffs: 110 });
        }
        for (let k = 0; k < 6; k++) clouds?.sheet?.(w.at(lerp(7000, 8300, (k + 0.5) / 6), 0).setY(260), 1600, 700, 60, { seed: 1800 + k, opacity: 0.7, dark: 0.8, minR: 40, maxR: 80, spacing: 9000 });
      });
    }

    // 7 · The Falcon: stormy dawn, basalt spires and a forming coil steaming under a torn ceiling
    {
      const id = 'falcon', r = R(id);
      this.island(id, 'coil', { a: 17, b: 0.2, turns: 1.5, kw: 0.3, Hin: 38, fall: 1.6, seed: 801, steps: 7, dir: -1, tipH: -3, horn: { H: 70, twist: 0.7, lobes: 2 } }, 8800, -460, { style: { rock: 'volcanic', meadow: 0.2 }, forming: true });
      this.island(id, 'peak', { R: 90, H: 240, turns: 2.3, seed: 802 }, 9200, 720, { style: { rock: 'basalt', meadow: 0.5 } });
      for (let k = 0; k < 6; k++) {
        const s = lerp(8400, 9300, (k + r()) / 6);
        this.island(id, 'stack', { R: lerp(10, 22, r()), H: lerp(70, 150, r()), lobes: 2, twist: lerp(0.4, 1.0, r()), seed: 810 + k, cap: 'point', topFrac: 0.45, sides: 6 }, s, (k % 2 ? 1 : -1) * lerp(200, 420, r()), { style: { rock: 'basalt', meadow: 0.5 } });
      }
      for (let k = 0; k < 3; k++) this.reptiles(id, this.at(lerp(8400, 9300, r()), (r() - 0.5) * 500).setY(lerp(40, 90, r())), 'skimmer', 8);
      this.extra(id, (w) => {
        const clouds = w.game.clouds;
        for (let k = 0; k < 7; k++) clouds?.sheet?.(w.at(lerp(8350, 9350, (k + 0.5) / 7), (r() - 0.5) * 300).setY(lerp(180, 230, r())), 900, 500, 50, { seed: 1900 + k, opacity: 0.62, minR: 34, maxR: 70, spacing: 7000 });
        w._clouds(id, 8, { yMin: 320, yMax: 600, latMin: 300, latMax: 1200 });
      });
    }

    // 8 · The Fog Wall: a sea-fog bank, whiteout, a few stacks looming out of it
    {
      const id = 'wall', r = R(id);
      this.island(id, 'stack', { R: 18, H: 100, lobes: 3, twist: 0.8, seed: 901 }, 9520, -250);
      this.island(id, 'stack', { R: 12, H: 70, lobes: 2, twist: 1.1, seed: 902 }, 9760, 230);
      this.extra(id, (w) => {
        const clouds = w.game.clouds;
        for (let k = 0; k < 16; k++) {
          const lat = lerp(-1200, 1200, k / 15) + (r() - 0.5) * 80;
          clouds?.tower?.(w.at(9660 + (r() - 0.5) * 120, lat).setY(-20), lerp(260, 380, r()), lerp(220, 340, r()), { seed: 2100 + k, maxPuffs: 120, density: 1.3 });
        }
        clouds?.sheet?.(w.at(9640, 0).setY(55), 2600, 320, 110, { seed: 2200, opacity: 0.85, minR: 50, maxR: 95, spacing: 3600, maxPuffs: 300 });
        clouds?.sheet?.(w.at(9560, 0).setY(20), 2400, 400, 40, { seed: 2201, opacity: 0.6, minR: 40, maxR: 70, spacing: 5000, maxPuffs: 200 });
      });
    }

    // 9 · The Oasis: a vast spiral atoll; the Mother Tree on the central coiled island
    {
      const id = 'oasis', r = R(id);
      const mt = this.at(11150, -150);
      this.atoll(id, mt.x + 40, mt.z + 120, { a: 470, b: 0.05, turns: 1.16, rimW: 60, lagoon: -8, motu: 0.72, rot: -0.4, seed: 31 });
      const Hin = 44;
      this.island(id, 'coil', { a: 30, b: 0.19, turns: 1.6, kw: 0.24, Hin, fall: 1.7, seed: 1001, steps: 10, horn: { R: 40, H: Hin + 8, cap: 'dome', topFrac: 0.92, twist: 0.25, lobes: 2, lobeAmp: 0.08, taperPow: 2.2, capH: 4, notch: 0.12 } }, 11150, -40, { pos: mt, clear: false, avoid: false, falls: 4, central: true });
      this.motherTree = new Vector3(mt.x, Hin + 8 + 3, mt.z);
      this.capsules.push({ a: this.motherTree.clone(), b: this.motherTree.clone().add(new Vector3(0, 200, 0)), r: 26, chapter: id });
      this.sphereColliders.push({ p: this.motherTree.clone().add(new Vector3(0, 230, 0)), r: 60, chapter: id, soft: true });
      // lagoon stacks and islets
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * TAU + r() * 0.4;
        const d = lerp(300, 440, r());
        const H = lerp(40, 110, r());
        const pos = new Vector3(mt.x + Math.cos(a) * d, 0, mt.z + Math.sin(a) * d);
        this.island(id, 'stack', { R: H / lerp(3.5, 5.5, r()), H, lobes: 2 + (k % 2), twist: lerp(0.5, 1.2, r()), seed: 1010 + k, topFrac: 0.8 }, 11150, 0, { pos, clear: false, avoid: false, falls: H > 90 ? 1 : 0 });
      }
      this.island(id, 'ammonite', { R: 70, yaw: 2.0, seed: 1030 }, 10450, 380);
      this.island(id, 'coil', { a: 18, b: 0.2, turns: 1.55, kw: 0.25, Hin: 50, fall: 1.9, seed: 1031, steps: 9 }, 10300, -420, { falls: 2 });
      this.island(id, 'peak', { R: 100, H: 260, turns: 2.6, seed: 1032 }, 11900, 900, { style: { rock: 'warm' }, falls: 2 });
      for (let k = 0; k < 10; k++) this.fish(id, lerp(10100, 12000, r()), (r() - 0.5) * 700, lerp(3, 6, r()), 'glintfin', Math.round(lerp(400, 900, r())));
      for (let k = 0; k < 6; k++) this.fish(id, lerp(10200, 11900, r()), (r() - 0.5) * 600, lerp(4, 7, r()), 'spiralback', Math.round(lerp(150, 300, r())));
      for (let k = 0; k < 3; k++) this.fish(id, lerp(10300, 11800, r()), (r() - 0.5) * 500, lerp(5, 7.5, r()), 'lanternjack', 2);
      for (let k = 0; k < 5; k++) this.reptiles(id, mt.clone().add(new Vector3((r() - 0.5) * 600, lerp(50, 140, r()), (r() - 0.5) * 600)), 'coilwing', Math.round(lerp(80, 140, r())));
      for (let k = 0; k < 3; k++) this.reptiles(id, mt.clone().add(new Vector3((r() - 0.5) * 900, lerp(30, 60, r()), (r() - 0.5) * 900)), 'skimmer', 10);
      this.extra(id, (w) => w._clouds(id, 14, { yMin: 380, yMax: 800, latMin: 600, latMax: 1800, s0: 9950, s1: 12400 }));
    }
  }

  _clouds(id, n, o) {
    const clouds = this.game.clouds;
    if (!clouds?.cumulus) return;
    const ch = this.path.chapterById(id);
    const r = rng(5000 + ch.index * 31);
    for (let k = 0; k < n; k++) {
      const s = lerp(o.s0 ?? ch.start - 200, o.s1 ?? ch.end + 200, r());
      const c = this.at(s, (r() < 0.5 ? -1 : 1) * lerp(o.latMin ?? 300, o.latMax ?? 1400, r()));
      c.y = lerp(o.yMin ?? 320, o.yMax ?? 700, r());
      clouds.cumulus(c, lerp(220, 420, r()), lerp(120, 260, r()), { seed: 600 + ch.index * 50 + k });
    }
  }

  _arch(id, sArch) {
    const f = this.path.frameAt(sArch);
    const arch = buildSpiralArch({ center: f.pos, span: f.right, along: f.fwd, halfSpan: 150, apexY: 118, thick: 15, twist: 1.5, seed: 7 });
    this.group(id).add(arch.mesh);
    this.game.engine.shadows?.addCaster(arch.mesh);
    for (const c of arch.colliders) this.sphereColliders.push({ p: c.p, r: c.r, chapter: id });
    for (const ft of arch.feet) {
      this.islands.push({ chapter: id, kind: 'stack', shape: ft.shape, pos: new Vector3(ft.pos.x, 0, ft.pos.z), R: ft.shape.R, H: ft.shape.H, style: {}, mesh: null, far: null, landmark: true });
    }
    for (let i = 0; i < arch.tops.length; i += 4) this.perches.push({ p: arch.tops[i].p.clone(), n: new Vector3(0, 1, 0), chapter: id });
    this.archInfo = { s: sArch, pos: f.pos.clone(), apex: arch.apex };
    this.arch = arch;
  }

  // ---- building -------------------------------------------------------------------------------
  async build(onProgress) {
    for (let i = 0; i < CHAPTER_ORDER.length; i++) {
      await this.buildChapter(CHAPTER_ORDER[i]);
      this.progress = (i + 1) / CHAPTER_ORDER.length;
      onProgress?.(this.progress, CHAPTER_ORDER[i]);
      await nextFrame();
    }
  }

  async buildChapter(id) {
    if (this.built.has(id)) return;
    this.built.add(id);
    const g = this.group(id);
    let tk = performance.now();
    const budget = this.sliceMs ?? 10;
    const slice = async () => {
      if (performance.now() - tk > budget) { await nextFrame(); tk = performance.now(); }
    };
    const plan = this.plan[id];
    for (const rec of plan.islands) {
      this._buildIsland(rec, g);
      await slice();
    }
    for (const fn of plan.extras) { fn(this); await slice(); }
    const meshes = await this.seabed.buildFor(plan.features, this._tiles, {}, slice);
    for (const m of meshes) g.add(m);
    this.done.add(id);
  }

  _buildIsland(rec, g) {
    const isl = buildIsland({ shape: rec.shape, style: Object.assign({ seed: rec.seed }, rec.style, rec.opts?.forming ? { heat: formingHeat(rec) } : {}), seed: rec.seed, lod: rec.R > 22 });
    isl.mesh.position.copy(rec.pos);
    g.add(isl.mesh);
    this.game.engine.shadows?.addCaster(isl.mesh);
    if (isl.far) {
      isl.far.position.copy(rec.pos);
      isl.far.visible = false;
      g.add(isl.far);
    }
    rec.mesh = isl.mesh;
    rec.far = isl.far;
    rec.rim = isl.rim;
    rec.geo = isl.geo0;
    const r = rng(rec.seed * 13 + 7);
    // perches: the summit and a few high rim points
    const bb = isl.geo0.boundingBox;
    const top = new Vector3();
    {
      const pos = isl.geo0.attributes.position.array;
      let best = -1, by = -1e9;
      for (let i = 0; i < pos.length; i += 3) if (pos[i + 1] > by) { by = pos[i + 1]; best = i; }
      if (best >= 0) top.set(pos[best] + rec.pos.x, pos[best + 1], pos[best + 2] + rec.pos.z);
      if (top.y > 12) this.perches.push({ p: top.clone(), n: new Vector3(0, 1, 0), chapter: rec.chapter });
    }
    const rims = (isl.rim || []).filter((q) => q.y > 14);
    const nPerch = Math.min(rims.length, rec.opts?.rookery ? 14 : 4);
    for (let k = 0; k < nPerch; k++) {
      const q = rims[Math.floor(r() * rims.length)];
      this.perches.push({ p: new Vector3(q.x + rec.pos.x, q.y + 0.3, q.z + rec.pos.z), n: new Vector3(0, 1, 0), chapter: rec.chapter });
    }
    // waterfalls from the highest outer rims, into the sea
    if (rec.falls > 0 && rims.length) {
      const cands = rims.filter((q) => !q.terrace && !q.peak).sort((a, b) => b.y - a.y);
      const used = [];
      for (const q of cands) {
        if (used.length >= rec.falls) break;
        if (used.some((u) => Math.hypot(u.x - q.x, u.z - q.z) < 60)) continue;
        const lip = new Vector3(q.x + rec.pos.x + q.ox * 0.8, q.y - 0.4, q.z + rec.pos.z + q.oz * 0.8);
        const out = new Vector3(q.ox, 0, q.oz).normalize();
        const land = this.seabedAt(lip.x + out.x * 6, lip.z + out.z * 6);
        if (land > -0.5) continue;
        const wf = buildWaterfall(lip, out, lerp(4, 9, r()) * (rec.opts?.central ? 1.6 : 1), lip.y, rec.seed * 7 + used.length);
        this.game.engine.sceneT.add(wf);
        wf.userData.chapter = rec.chapter;
        this.waterfalls.push(wf);
        used.push(q);
      }
    }
    // forming islands: steam vents along the young outer arm
    if (rec.opts?.forming && rec.shape.spiral) {
      const sp = rec.shape.spiral;
      for (let k = 0; k < 6; k++) {
        const t = lerp(0.72, 0.98, k / 5);
        const phi = rec.shape.phiAt(t);
        const p = sp.point(phi);
        this.vents.push({ p: new Vector3(p.x + rec.pos.x, Math.max(0.5, rec.shape.topAt(t)), p.z + rec.pos.z), strength: lerp(0.5, 1, t), chapter: rec.chapter });
      }
    }
  }

  // ---- runtime ----------------------------------------------------------------------------------
  /** Hide chapters far from the current path position; pick island LODs by camera distance. */
  updateVisibility(s) {
    for (const ch of this.path.chapters) {
      const g = this.groups[ch.id];
      if (!g) continue;
      g.visible = s > ch.start - 2600 && s < ch.end + 2600;
    }
    for (const w of this.waterfalls) w.visible = this.groups[w.userData.chapter]?.visible ?? true;
    for (const l of this.lakes) l.visible = this.groups[l.userData.chapter]?.visible ?? true;
    const cam = this.game.engine.camera.position;
    for (const rec of this.islands) {
      if (!rec.mesh || !rec.far) continue;
      if (!this.groups[rec.chapter]?.visible) continue;
      const d = Math.hypot(cam.x - rec.pos.x, cam.z - rec.pos.z) - rec.R;
      const near = d < this.lodDist + rec.R * 0.5;
      rec.mesh.visible = near;
      rec.far.visible = !near;
    }
  }

  /** Height of the sea floor (reefs, lagoons, beaches above the water; -200 in the open sea). */
  seabedAt(x, z) {
    return this.seabed.heightAt(x, z);
  }

  /** Signed distance to the nearest solid (approximate): island rock, landmarks, trunks, sea floor. */
  distance(p, maxCheck = 400) {
    let d = Infinity;
    for (let i = 0; i < this.islands.length; i++) {
      const isl = this.islands[i];
      const dx = p.x - isl.pos.x, dz = p.z - isl.pos.z;
      const lim = isl.R + maxCheck;
      if (dx > lim || dx < -lim || dz > lim || dz < -lim || p.y > isl.H + maxCheck) continue;
      const v = isl.shape.dist(dx, p.y, dz);
      if (v < d) d = v;
    }
    for (const sc of this.sphereColliders) d = Math.min(d, p.distanceTo(sc.p) - sc.r);
    for (const c of this.capsules) d = Math.min(d, capsuleDist(p, c));
    if (p.y < maxCheck + 5) {
      const h = this.seabed.heightAt(p.x, p.z);
      if (h > DEEP + 1 || p.y < DEEP + maxCheck) d = Math.min(d, (p.y - h) * 0.85);
    }
    return d;
  }

  /** Push a sphere out of solids. Returns the correction vector (zero if none). */
  collide(p, radius, out = new Vector3()) {
    out.set(0, 0, 0);
    const e = 0.8;
    const d = this.distance(p, radius + 60);
    if (d >= radius) return out;
    const v = this._v;
    const gx = this.distance(v.set(p.x + e, p.y, p.z)) - this.distance(v.set(p.x - e, p.y, p.z));
    const gy = this.distance(v.set(p.x, p.y + e, p.z)) - this.distance(v.set(p.x, p.y - e, p.z));
    const gz = this.distance(v.set(p.x, p.y, p.z + e)) - this.distance(v.set(p.x, p.y, p.z - e));
    out.set(gx, gy, gz);
    if (out.lengthSq() < 1e-8) out.set(0, 1, 0);
    out.normalize().multiplyScalar(radius - d);
    return out;
  }

  /** Distance along a segment to the first solid (camera collision), or null. */
  raycast(from, to) {
    const dir = new Vector3().subVectors(to, from);
    const len = dir.length();
    dir.normalize();
    let t = 0;
    const p = new Vector3();
    for (let i = 0; i < 28 && t < len; i++) {
      p.copy(from).addScaledVector(dir, t);
      const d = this.distance(p, 60);
      if (d < 1.0) return t;
      t += Math.max(d * 0.9, 0.8);
    }
    return null;
  }

  nearestWaterfall(p) {
    let best = null, bd = Infinity;
    for (const w of this.waterfalls) {
      if (!w.visible) continue;
      const lip = w.userData.lip;
      const dx = p.x - lip.x, dz = p.z - lip.z;
      const dy = p.y > lip.y ? p.y - lip.y : p.y < lip.y - w.userData.drop ? lip.y - w.userData.drop - p.y : 0;
      const d = Math.hypot(dx, dz, dy);
      if (d < bd) { bd = d; best = w; }
    }
    return best ? { wf: best, dist: bd } : null;
  }
}

/** Heat of a forming island: its young outer arm still glows where it meets the sea. */
function formingHeat(rec) {
  const sh = rec.shape;
  return (P) => {
    if (!sh.spiral) return 0;
    let best = 1e9, bphi = 0;
    sh.spiral.arms(P.x, P.z, (phi, d) => { if (d < best) { best = d; bphi = phi; } });
    const t = sh.tAt(bphi);
    return smoothstep(0.6, 0.95, t) * smoothstep(7, 0.5, P.y);
  };
}

function capsuleDist(p, c) {
  const abx = c.b.x - c.a.x, aby = c.b.y - c.a.y, abz = c.b.z - c.a.z;
  const t = clamp(((p.x - c.a.x) * abx + (p.y - c.a.y) * aby + (p.z - c.a.z) * abz) / (abx * abx + aby * aby + abz * abz), 0, 1);
  return Math.hypot(p.x - (c.a.x + abx * t), p.y - (c.a.y + aby * t), p.z - (c.a.z + abz * t)) - c.r;
}
