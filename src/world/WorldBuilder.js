// Builds Vur Sok along the migration route: spiral islands rising from the sea, reef shelves and
// spiral atolls, the Spiral Arch, waterfalls into the sea, clouds, and the spawn points of the
// living sea (fish schools, bird-reptile flocks, night plankton) and their perches.
//
// Two phases. layout() runs in the constructor: it decides every chapter's islands, atolls and
// spawns (cheap, no geometry), so collisions and seabedAt() work for the whole route at once.
// buildChapter() then builds geometry chapter by chapter, time-sliced so the title menu stays
// smooth while the world grows behind it.
import { Group, Vector3, Matrix4 } from 'three';
import { buildIsland, buildScree, stackShape, coilShape, ammoniteShape, peakShape } from './Islands.js';
import { Seabed, DEEP } from './Seabed.js';
import { buildWaterfall } from './Water.js';
import { buildSpiralArch, causeway, basaltMesh } from './Landmarks.js';
import { Backdrop } from './Backdrop.js';
import { FloraSet, SurfaceIndex, populateIsland, populateRims, populateSeabed, variants } from './Flora.js';
import { SPECIES, populateTrees } from './Trees.js';
import { AlienFlora } from '../flora/AlienFlora.js';
import { rng, lerp, clamp, smoothstep, TAU } from '../core/math.js';
import { topSurface, thin } from './Spirals.js';
import { terrainMaterial } from '../render/materials.js';

const nextFrame = () => new Promise((res) => requestAnimationFrame(() => res()));
export const CHAPTER_ORDER = ['cradle', 'valleys', 'krill', 'forest', 'song', 'night', 'storm', 'falcon', 'wall', 'oasis'];
const SHAPES = { stack: stackShape, coil: coilShape, ammonite: ammoniteShape, peak: peakShape };
// the flora biome of each chapter (painted tufts and vines), and its few accent trees
// ({ kind, max, per: m2 of meadow per tree }). Vur Sok is a world of moving alien plants: trees are
// rare accents where they tell the story (the Mother Tree, the Coil Forest's giant coil trees, a
// lone coil tree on a big meadow, palms on the motus, wind-bent pines on some spires); everything
// else is AlienFlora (src/flora): fiddlehead meadows, tube and bell clumps, anemone colonies, kelp,
// sea fans and puffballs, plus giant fiddleheads standing in for the old tree groves.
const BIOME = { cradle: 'lagoon', valleys: 'reach', krill: 'shoals', forest: 'forest', song: 'golden', night: 'night', storm: 'storm', falcon: 'storm', wall: 'storm', oasis: 'oasis' };
const TREES = {
  cradle: { kind: 'coil', max: 1, per: 9000, spacing: 60 }, valleys: { kind: 'coil', max: 1, per: 9000, spacing: 60 }, krill: null,
  forest: null, song: { kind: 'coil', max: 1, per: 12000, spacing: 60 }, night: null,
  storm: null, falcon: null, wall: null, oasis: { kind: 'blossom', max: 2, per: 6000, spacing: 50 },
};
// AlienFlora per chapter: the biome of the island meadows, a density multiplier, and the giant
// fiddleheads (hero plants, tree-sized) per island: { per: m2 of meadow per clump, max, scale }
const ALIEN = {
  cradle: { biome: 'meadow', dens: 1, giant: { per: 5000, max: 2, scale: [2.2, 4.2] } },
  valleys: { biome: 'meadow', dens: 1, giant: { per: 4500, max: 3, scale: [2.4, 4.8] } },
  krill: { biome: 'meadow', dens: 0.8, giant: { per: 8000, max: 1, scale: [2, 3.5] } },
  forest: { biome: 'oasis', dens: 1.15, giant: { per: 1400, max: 6, scale: [3.6, 8.5] } },
  song: { biome: 'meadow', dens: 1, giant: { per: 6000, max: 1, scale: [2.4, 4] } },
  night: { biome: 'meadow', dens: 1, giant: { per: 6000, max: 2, scale: [2.4, 4.4] } },
  storm: { biome: 'meadow', dens: 0.45, giant: null }, falcon: { biome: 'meadow', dens: 0.45, giant: null }, wall: { biome: 'meadow', dens: 0.4, giant: null },
  oasis: { biome: 'oasis', dens: 1.25, giant: { per: 3000, max: 4, scale: [2.8, 6] } },
};
const FLORA_NEAR = 520, TREES_NEAR = 1900, PAINTED_NEAR = 440;
const hash01 = (x) => { const v = Math.sin(x * 91.345 + 47.853) * 43758.5453; return v - Math.floor(v); };
const _v = new Vector3(), _w = new Vector3();
const _m4 = new Matrix4();

export class WorldBuilder {
  constructor(game, path, opts = {}) {
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
    this.shelters = []; // calm lagoon water: [x, z, radius, strength] for the ocean
    this.chapterOpts = {};
    // the moving alien flora of the whole route (one instanced system; materials exist from here
    // so Engine.precompile covers them). Chapters feed it their patches as they are built.
    this.flora = opts.flora === false ? null : new AlienFlora(game, { seed: opts.seed ?? 7 });
    if (this.flora) game.engine.scene.add(this.flora.root);
    this.chapterSets = []; // chapter-wide painted tufts / vines and accent trees: { group, chapter, x, z, r, near }
    this._sets = {};
    if (opts.layout !== false) this.layout();
    for (const sh of this.shelters) game.ocean?.shelter?.(...sh);
  }

  /** The chapter's shared painted (tufts, vines) or tree set, in world coordinates. */
  _set(id, kind) {
    const S = (this._sets[id] ||= {});
    return (S[kind] ||= new FloraSet(kind + '-' + id));
  }

  /** Build a chapter set into the chapter group, with its bounds for distance culling. */
  _finishSet(id, kind, g, near) {
    const set = this._sets[id]?.[kind];
    if (!set || !set.count) return;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const list of set.items.values()) {
      for (const it of list) {
        const e = it.m.elements;
        x0 = Math.min(x0, e[12]); x1 = Math.max(x1, e[12]); z0 = Math.min(z0, e[14]); z1 = Math.max(z1, e[14]);
      }
    }
    set.build(this.game.engine.shadows);
    g.add(set.group);
    this.chapterSets.push({ group: set.group, chapter: id, x: (x0 + x1) / 2, z: (z0 + z1) / 2, r: Math.hypot(x1 - x0, z1 - z0) / 2, near });
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
    // how close the route ever comes (islands far off the route never need their near detail)
    let rd = Infinity;
    for (let q = Math.max(0, s - shape.R - 2200); q <= Math.min(this.path.length, s + shape.R + 2200); q += 40) {
      this.path.pointAt(q, _w);
      rd = Math.min(rd, Math.hypot(_w.x - rec.pos.x, _w.z - rec.pos.z) - shape.R);
    }
    rec.routeDist = o.near ? 0 : rd;
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

  /** A free-standing region outside the route (dev showcases): { biome, trees }. */
  addChapter(id, o = {}) {
    this.plan[id] ||= { islands: [], extras: [], features: [] };
    this.chapterOpts[id] = o;
    return id;
  }

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
      this.shelters.push([C.x, C.z, 330, 0.9]);
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
        const caves = big ? [{ th: r() * TAU, w: lerp(0.18, 0.32, r()), h: lerp(6, 12, r()), depth: lerp(0.3, 0.45, r()) }] : [];
        this.island(id, 'stack', { R: Rr, H, lobes: r() < 0.5 ? 2 : 3, twist: lerp(0.4, 1.3, r()), seed: 210 + k, cap: r() < 0.25 ? 'point' : 'dome', topFrac: lerp(0.55, 0.95, r()), caves }, s, lat, { clear: 34, style: { rock: r() < 0.5 ? 'banded' : 'limestone' }, falls: big && r() < 0.5 ? 1 : 0 });
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
        const H = lerp(70, 130, r());
        const rec = this.island(id, 'stack', { R: lerp(12, 20, r()), H, lobes: 3, twist: lerp(0.6, 1.4, r()), seed: 420 + k, topFrac: 0.7 }, s, side * lerp(130, 190, r()), { clear: 36, rookery: true });
        // a skimmer rookery on every ledge of the stack
        this.reptiles(id, rec.pos.clone().setY(H * 0.85), 'skimmer', Math.round(lerp(10, 18, r())));
      }
      this.island(id, 'peak', { R: 85, H: 220, turns: 2.2, seed: 430 }, 4700, 800, { style: { rock: 'warm' } });
      for (let k = 0; k < 5; k++) this.fish(id, lerp(3950, 5350, r()), (r() < 0.5 ? -1 : 1) * lerp(160, 300, r()), lerp(3, 6, r()), 'glintfin', Math.round(lerp(200, 500, r())));
      for (let k = 0; k < 4; k++) this.reptiles(id, this.at(lerp(4000, 5300, r()), (r() < 0.5 ? -1 : 1) * lerp(150, 260, r())).setY(lerp(60, 110, r())), 'coilwing', Math.round(lerp(70, 120, r())));
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
      this.shelters.push([c.x, c.z, 520, 0.6]);
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
      this.shelters.push([mt.x + 40, mt.z + 120, 560, 0.85]);
      const Hin = 44;
      this.island(id, 'coil', { a: 30, b: 0.19, turns: 1.6, kw: 0.24, Hin, fall: 1.7, seed: 1001, steps: 10, horn: { R: 40, H: Hin + 8, cap: 'dome', topFrac: 0.92, twist: 0.25, lobes: 2, lobeAmp: 0.08, taperPow: 2.2, capH: 4, notch: 0.12 } }, 11150, -40, { pos: mt, clear: false, avoid: false, falls: 4, central: true });
      this.motherTree = new Vector3(mt.x, Hin + 8 + 3, mt.z);
      // trunk and crown (the crown spans ~100 m around the trunk, ~110-235 m up)
      this.capsules.push({ a: this.motherTree.clone(), b: this.motherTree.clone().add(new Vector3(0, 110, 0)), r: 22, chapter: id });
      this.sphereColliders.push({ p: this.motherTree.clone().add(new Vector3(0, 118, 0)), r: 78, chapter: id, soft: true });
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
      this.extra(id, (w) => w._motherTree());
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

  _arch(id, sArch, at = null) {
    const f = at ? { pos: at.center, right: at.span, fwd: at.along } : this.path.frameAt(sArch);
    const arch = buildSpiralArch({ center: f.pos, span: f.right, along: f.fwd, halfSpan: 150, apexY: 118, thick: 15, twist: 1.5, seed: 7 });
    this.group(id).add(arch.mesh);
    this.game.engine.shadows?.addCaster(arch.mesh);
    for (const c of arch.colliders) this.sphereColliders.push({ p: c.p, r: c.r, chapter: id });
    for (const ft of arch.feet) {
      this.islands.push({ chapter: id, kind: 'stack', shape: ft.shape, pos: new Vector3(ft.pos.x, 0, ft.pos.z), R: ft.shape.R, H: ft.shape.H, style: {}, mesh: null, far: null, landmark: true });
      // the feet stand on their own reef shelves (registered before this chapter's seabed is built)
      this.plan[id].features.push(this.seabed.addShelf(ft.pos.x, ft.pos.z, ft.shape.footprint, { R: ft.shape.R, seed: 77, beach: 0.5, shelf: 40, chapter: id }));
    }
    for (let i = 0; i < arch.tops.length; i += 4) this.perches.push({ p: arch.tops[i].p.clone(), n: new Vector3(0, 1, 0), chapter: id });
    if (!at) {
      this.archInfo = { s: sArch, pos: f.pos.clone(), apex: arch.apex };
      this.arch = arch;
    }
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
    const prof = this.timing ||= {};
    const tm = (k, t0) => { prof[k] = (prof[k] || 0) + performance.now() - t0; };
    for (const rec of plan.islands) {
      this._buildIsland(rec, g);
      await slice();
    }
    let t0 = performance.now();
    for (const fn of plan.extras) { fn(this); await slice(); }
    tm('extras', t0);
    if (!this.backdrop && this.withBackdrop !== false) {
      // the painted horizon: anchored mid-route so it drifts slowly as the herd travels
      t0 = performance.now();
      this.backdrop = new Backdrop(this.game, { anchor: this.path.pointAt(this.path.length * 0.5) });
      tm('backdrop', t0);
      await slice();
    }
    t0 = performance.now();
    const meshes = await this.seabed.buildFor(plan.features, this._tiles, {}, slice);
    for (const m of meshes) g.add(m);
    tm('seabed', t0);
    t0 = performance.now();
    // beach tufts and palms on the motus (the reef life itself is AlienFlora's; builtinFlora /
    // builtinTrees = false hand the painted tufts / the palms over)
    const alien = !!this.flora;
    for (const f of plan.features) {
      const n = Math.round(clamp((f.R * f.R) / 300, 40, f.kind === 'atoll' ? 1400 : 600) * (this.floraDensity ?? 1));
      if (this.builtinFlora !== false) populateSeabed(this._set(id, 'painted'), this.seabed, f, BIOME[id] || this.chapterOpts[id]?.biome, Math.round(f.x * 0.37 + f.z), n, { alien: !alien });
      if (this.builtinTrees !== false && (f.kind === 'atoll' || f.kind === 'shelf')) this._motus(this._set(id, 'trees'), f, id);
      await slice();
    }
    this._finishSet(id, 'painted', g, PAINTED_NEAR);
    this._finishSet(id, 'trees', g, TREES_NEAR);
    tm('reef', t0);
    const imp = this._imp?.[id];
    if (imp && imp.count) g.add(imp.build(null));
    // the moving alien flora: meadows, cliffs, shores and reefs of every island near the route
    if (this.flora) {
      t0 = performance.now();
      this.prepareGround(id);
      await slice();
      for (const p of this.floraPatches(id)) {
        this.flora.addPatch(p);
        await slice();
      }
      tm('alienScatter', t0);
      t0 = performance.now();
      this.flora.build();
      tm('alienBuild', t0);
    }
    this.done.add(id);
  }

  _buildIsland(rec, g) {
    const prof = this.timing ||= {};
    let t0 = performance.now();
    const far = rec.routeDist > 700;
    const isl = buildIsland({ shape: rec.shape, style: Object.assign({ seed: rec.seed }, rec.style, rec.opts?.forming ? { heat: formingHeat(rec) } : {}), seed: rec.seed, lod: rec.R > 22 && !far, detail: far ? 0.55 : 1 });
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
    // living flora on the rock, its rims and crests
    const volcanic = rec.style.rock === 'volcanic';
    const biome = rec.opts?.biome ?? (volcanic ? 'volcanic' : BIOME[rec.chapter] || this.chapterOpts[rec.chapter]?.biome || 'reach');
    prof.rock = (prof.rock || 0) + performance.now() - t0;
    t0 = performance.now();
    const alien = !!this.flora;
    const needsFlora = rec.routeDist < FLORA_NEAR + 150 && this.builtinFlora !== false;
    const needsTrees = rec.routeDist < TREES_NEAR && this.builtinTrees !== false;
    const needsGiants = alien && rec.routeDist < FLORA_NEAR + 300 && !volcanic;
    const S = needsFlora || needsTrees || needsGiants ? new SurfaceIndex(isl.geo0) : null;
    if (needsFlora) {
      // painted tufts and vine curtains (the alien plants come from AlienFlora patches)
      const set = alien ? this._set(rec.chapter, 'painted') : null;
      const fl = populateIsland(isl.geo0, biome, rec.seed, { index: S, density: this.floraDensity ?? 1, origin: rec.pos, seabedAt: (x, z) => this.seabed.heightAt(x, z), set, offset: set ? rec.pos : null, alien: !alien, tufts: alien ? 1.4 : 1 });
      const rims = (isl.rim || []).filter((q, i) => i % 2 === 0);
      if (set) populateRims(set, rims, biome, rec.seed, rec.pos, { kelp: false, vines: 1.3 });
      else {
        populateRims(fl, rims, biome, rec.seed);
        fl.build(this.game.engine.shadows);
        fl.group.position.copy(rec.pos);
        g.add(fl.group);
        rec.flora = fl.group;
      }
    }
    // giant fiddleheads: tree-sized croziers that coil and uncoil, the alien stand-in for groves
    const AL = ALIEN[rec.chapter] || this.chapterOpts[rec.chapter]?.alien || ALIEN.valleys;
    if (needsGiants && AL.giant) this._giants(rec, S, AL.giant);
    let tc = rec.opts?.trees === false ? null : (rec.opts?.giant ? (rec.seed % 2 === 0 ? { kind: 'giantFern', max: 1, per: 4000, spacing: 45 } : null) : (TREES[rec.chapter] ?? this.chapterOpts[rec.chapter]?.trees ?? null));
    // a few spires wear wind-bent pines (one in three; storms leave a lone one on one in four)
    if (rec.kind === 'stack' && !rec.opts?.giant) {
      const harsh = rec.chapter === 'storm' || rec.chapter === 'falcon';
      tc = hash01(rec.seed * 1.37) < (harsh ? 0.25 : 0.34) ? { kind: 'pine', max: harsh ? 1 : 2, per: 900, spacing: 9 } : null;
    }
    const giantCoil = rec.opts?.giant && rec.shape.horn && needsTrees;
    if ((tc || giantCoil) && !volcanic && needsTrees) {
      const ts = this._set(rec.chapter, 'trees');
      const before = new Map();
      for (const [k, l] of ts.items) before.set(k, l.length);
      if (tc) populateTrees(S, tc.kind, rec.seed, Object.assign({ groves: 0 }, tc, { set: ts, offset: rec.pos }));
      const added = [];
      for (const [k, l] of ts.items) for (let i = before.get(k) || 0; i < l.length; i++) added.push([k, l[i]]);
      // giant fiddle-trees are solid enough to bump into, and bird-reptiles perch on their coils
      for (const [key, it] of added) {
        if (!key.startsWith('gfern')) continue;
        _w.setFromMatrixPosition(it.m);
        const sc = _v.setFromMatrixScale(it.m).x;
        this.capsules.push({ a: _w.clone(), b: _w.clone().add(new Vector3(0, 60 * sc, 0)), r: 2.5 * sc, chapter: rec.chapter });
        this.perches.push({ p: _w.clone().add(new Vector3(0, 66 * sc, 0)), n: new Vector3(0, 1, 0), chapter: rec.chapter });
      }
      // the Coil Forest's giant coil-trunk tree crowns the island's central horn (its signature)
      if (giantCoil) {
        const hp = new Vector3(0, rec.shape.horn.top + (rec.shape.horn.H - rec.shape.horn.top) * 0.6, 0);
        const H = lerp(120, 160, (rec.seed % 7) / 7);
        const wp = hp.clone().add(rec.pos);
        added.push(['giantCoil-' + (rec.seed % 3), ts.add('giantCoil-' + (rec.seed % 3), () => SPECIES.giantCoilTree(9400 + (rec.seed % 3), 140), wp, H / 140, rec.seed, [0, 0, 1, 1])]);
        this.capsules.push({ a: wp.clone(), b: wp.clone().add(new Vector3(0, H * 0.7, 0)), r: H * 0.06, chapter: rec.chapter });
        this.sphereColliders.push({ p: wp.clone().add(new Vector3(0, H * 0.82, 0)), r: H * 0.16, chapter: rec.chapter, soft: true });
        for (let q = 0; q < 6; q++) this.perches.push({ p: wp.clone().add(new Vector3(Math.cos(q) * H * 0.25, H * (0.6 + 0.06 * q), Math.sin(q) * H * 0.25)), n: new Vector3(0, 1, 0), chapter: rec.chapter });
      }
      // coilwings roost in the crowns; far painted impostors take over where the 3D trees fade out
      const imp = this._impostors(rec.chapter);
      for (const [key, it] of added) {
        _w.setFromMatrixPosition(it.m);
        const sc = _v.setFromMatrixScale(it.m).x;
        const Hh = key.startsWith('gfern') ? 66 : key.startsWith('giantCoil') ? 120 : key.startsWith('pine') ? 14 : key.startsWith('blossom') ? 16 : key.startsWith('palm') ? 14 : 20;
        this.perches.push({ p: _w.clone().add(new Vector3(0, Hh * sc * 0.92, 0)), n: new Vector3(0, 1, 0), chapter: rec.chapter, tree: true });
        const kind = key.startsWith('pine') ? 'pine' : key.startsWith('blossom') ? 'blossom' : key.startsWith('gfern') || key.startsWith('giantCoil') ? 'giant' : key.startsWith('palm') ? 'palm' : 'coil';
        const H = kind === 'giant' ? 110 : kind === 'pine' ? 16 : kind === 'blossom' ? 18 : 22;
        imp.add('imp-' + kind, () => SPECIES.impostor(kind, H), _w, sc, 0, [0, 0, 1, 1]);
      }
    }
    // scree: boulders fallen at the foot of the cliffs
    if (rec.routeDist < FLORA_NEAR + 150) {
      const sc = buildScree(rec, (x, z) => this.seabed.heightAt(x, z), Math.round(clamp(rec.R * 0.9, 12, 110)));
      if (sc) {
        g.add(sc);
        this.game.engine.shadows?.addCaster(sc);
        rec.scree = sc;
      }
    }
    prof.flora = (prof.flora || 0) + performance.now() - t0;
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
    // rookeries: skimmers nest on the strata ledges all the way up the stack
    if (rec.opts?.rookery && rec.shape.layers && rec.shape.radius) {
      for (const L of rec.shape.layers) {
        if (L.y1 < 10 || L.y1 > rec.shape.top - 4) continue;
        for (let q = 0; q < 2; q++) {
          const th = r() * TAU;
          const c = rec.shape.center(L.y1);
          const rr = rec.shape.radius(th, L.y1 + 0.6) + 0.4;
          this.perches.push({ p: new Vector3(rec.pos.x + c[0] + Math.cos(th) * rr, L.y1 + 0.6, rec.pos.z + c[1] + Math.sin(th) * rr), n: new Vector3(0, 1, 0), chapter: rec.chapter, ledge: true });
        }
      }
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
    // forming islands: steam vents along the young outer arm, cooling basalt where it meets the sea
    if (rec.opts?.forming && rec.shape.spiral) {
      const sp = rec.shape.spiral;
      for (let k = 0; k < 6; k++) {
        const t = lerp(0.72, 0.98, k / 5);
        const phi = rec.shape.phiAt(t);
        const p = sp.point(phi);
        this.vents.push({ p: new Vector3(p.x + rec.pos.x, Math.max(0.5, rec.shape.topAt(t)), p.z + rec.pos.z), strength: lerp(0.5, 1, t), chapter: rec.chapter });
      }
      const cols = [];
      for (let k = 0; k < 4; k++) {
        const t = lerp(0.45, 0.85, k / 3);
        const phi = rec.shape.phiAt(t);
        const p = sp.point(phi), tg = sp.tangent(phi);
        // on the outer flank of the arm, stepping down into the sea
        const out = new Vector3(tg.z, 0, -tg.x);
        if (out.x * p.x + out.z * p.z < 0) out.negate();
        const c = new Vector3(p.x + rec.pos.x, 0, p.z + rec.pos.z).addScaledVector(out, rec.shape.halfW(t) * 1.05);
        cols.push(...causeway(c, out.clone().negate(), 140, rec.seed * 5 + k, { rise: 6, base: -1.2 }));
      }
      if (cols.length) {
        const bm = basaltMesh(cols);
        g.add(bm);
        this.game.engine.shadows?.addCaster(bm);
        rec.basalt = bm;
      }
    }
  }

  /** Palms (and in the Oasis blossom trees) on beaches and motus above the water. */
  _motus(set, f, id) {
    const r = rng(Math.round(f.x * 0.13 + f.z * 0.71));
    // each variant is a draw call: a reef keeps two palm shapes, one cycad and two blossom trees
    const V = variants(Math.round(f.x * 0.29 - f.z * 0.17), { palm: [[0, 1, 2, 3], 2], cycad: [[0, 1, 2], 1], blossom: [[0, 1, 2], 2] });
    // a few palms only: atolls keep a handful per motu, one shelf in three a lone palm or two
    const want = f.kind === 'atoll' ? 16 : hash01(f.x * 0.013 + f.z * 0.007) < 0.35 ? 2 : 0;
    if (!want) return;
    let placed = 0;
    for (let i = 0; i < want * 12 && placed < want; i++) {
      const a = r() * TAU, d = Math.sqrt(r()) * f.R * 0.9;
      const x = f.x + Math.cos(a) * d, z = f.z + Math.sin(a) * d;
      const h = this.seabed.heightAt(x, z);
      if (h < 1.1 || h > 3.2) continue;
      const p = new Vector3(x, h - 0.2, z);
      const v = Math.floor(r() * 4);
      const bv = V('blossom', v % 3), cv = V('cycad', v % 3), pv = V('palm', v);
      if (id === 'oasis' && r() < 0.25) set.add(`blossom-${bv}`, () => SPECIES.blossomTree(9600 + bv, 18), p, lerp(0.6, 1.0, r()), r() * TAU, [r() * 6, 0, 1, 1]);
      else if (r() < 0.3) set.add(`cycad-${cv}`, () => SPECIES.cycad(9850 + cv, 5), p, lerp(0.7, 1.3, r()), r() * TAU, [r() * 6, 0, 1, 1]);
      else set.add(`palm-${pv}`, () => SPECIES.palm(9800 + pv, 14), p, lerp(0.7, 1.25, r()), r() * TAU, [r() * 6, 0, 1, 1]);
      placed++;
    }
  }

  /**
   * Giant fiddleheads on an island's meadows: a tall parent crozier with a few smaller ones around
   * it, coiling and uncoiling, recoiling when whales pass (AlienFlora hero plants). The biggest are
   * solid (capsules) and bird-reptiles perch on their crowns.
   */
  _giants(rec, S, cfg) {
    const r = rng(rec.seed * 29 + 13);
    const meadow = (ny, y, gr) => (gr > 0.4 && ny > 0.78 && y > 5 ? gr : 0);
    const A = S.weights(meadow);
    const n = Math.round(clamp(A / cfg.per + (r() - 0.5), 0, cfg.max));
    if (!n) return;
    const spots = thin(S.sample(n * 4, r), 14 + cfg.scale[1] * 2, new Map()).slice(0, n);
    const up = _v.set(0, 1, 0);
    const p = new Vector3();
    for (const sm of spots) {
      const members = 1 + Math.floor(r() * 3);
      for (let i = 0; i < members; i++) {
        const parent = i === 0;
        const sc = parent ? lerp(cfg.scale[0], cfg.scale[1], Math.pow(r(), 0.8)) : lerp(cfg.scale[0] * 0.45, cfg.scale[0] * 0.9, r());
        const a = r() * TAU, d = parent ? 0 : lerp(2.5, 5, r()) * cfg.scale[0];
        p.set(sm.p.x + Math.cos(a) * d + rec.pos.x, 0, sm.p.z + Math.sin(a) * d + rec.pos.z);
        const g = this.groundAt(p.x, p.z, this._gg ||= { y: 0, normal: new Vector3(0, 1, 0), island: null });
        if (g.y < 3 || g.normal.y < 0.7) continue;
        p.y = g.y - 0.1 * sc;
        this.flora.place('fiddle', p, up, sc, r(), { palette: r() < 0.7 ? 0 : 3, hue: (r() - 0.5) * 0.4, aux: r() * 0.9 });
        if (sc >= 3.5) {
          this.capsules.push({ a: p.clone(), b: p.clone().add(new Vector3(0, 2.6 * sc, 0)), r: 0.32 * sc, chapter: rec.chapter });
          this.perches.push({ p: p.clone().add(new Vector3(0, 3.3 * sc, 0)), n: new Vector3(0, 1, 0), chapter: rec.chapter, tree: true });
        }
      }
    }
  }

  /** The chapter's far-tree impostor set (built when the chapter finishes). */
  _impostors(id) {
    this._imp ||= {};
    return (this._imp[id] ||= new FloraSet('tree-impostors'));
  }

  _motherTree() {
    if (!this.motherTree) return;
    const set = new FloraSet('mother-tree');
    set.add('mother', () => SPECIES.motherTree(5, 210), this.motherTree.clone().setY(this.motherTree.y - 3), 1, 0.4, [0, 0, 1, 1]);
    set.build(this.game.engine.shadows);
    this.group('oasis').add(set.group);
    this.motherTreeMesh = set.group;
    // coilwings roost on the crown: its highest point in each of twelve sectors
    const tops = new Array(12).fill(null);
    set.group.updateMatrixWorld(true);
    set.group.traverse((o) => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position;
      const n = o.isInstancedMesh ? o.count : 1;
      for (let k = 0; k < n; k++) {
        if (o.isInstancedMesh) o.getMatrixAt(k, _m4).premultiply(o.matrixWorld);
        else _m4.copy(o.matrixWorld);
        for (let i = 0; i < pos.count; i += 2) {
          _v.fromBufferAttribute(pos, i).applyMatrix4(_m4);
          const dx = _v.x - this.motherTree.x, dz = _v.z - this.motherTree.z;
          const r = Math.hypot(dx, dz);
          if (r < 20 || r > 95 || _v.y < this.motherTree.y + 90) continue;
          const sec = Math.floor(((Math.atan2(dz, dx) / TAU) + 1) * 12) % 12;
          if (!tops[sec] || _v.y > tops[sec].y) tops[sec] = _v.clone();
        }
      }
    });
    for (const p of tops) if (p) this.perches.push({ p: p.add(new Vector3(0, 0.5, 0)), n: new Vector3(0, 1, 0), chapter: 'oasis', tree: true });
  }

  // ---- runtime ----------------------------------------------------------------------------------
  /** Hide chapters far from the current path position; pick island LODs by camera distance. */
  updateVisibility(s) {
    // if the game does not call update(dt) itself (before this), keep the world alive from here
    const now = this.game.time;
    const dt = this._visT === undefined ? 0 : now - this._visT;
    this._visT = now;
    if (this._updT !== now && dt > 0) this.update(Math.min(dt, 0.1));
    for (const ch of this.path.chapters) {
      const g = this.groups[ch.id];
      if (!g) continue;
      g.visible = s > ch.start - 2600 && s < ch.end + 2600;
    }
    for (const w of this.waterfalls) w.visible = this.groups[w.userData.chapter]?.visible ?? true;
    for (const l of this.lakes) l.visible = this.groups[l.userData.chapter]?.visible ?? true;
    const cam = this.game.engine.camera.position;
    for (const rec of this.islands) {
      if (!rec.mesh) continue;
      if (!this.groups[rec.chapter]?.visible) continue;
      const d = Math.hypot(cam.x - rec.pos.x, cam.z - rec.pos.z) - rec.R;
      if (rec.far) {
        const near = d < this.lodDist + rec.R * 0.5;
        rec.mesh.visible = near;
        rec.far.visible = !near;
      }
      if (rec.flora) rec.flora.visible = d < FLORA_NEAR;
      if (rec.scree) rec.scree.visible = d < FLORA_NEAR + 200;
    }
    // chapter-wide painted tufts / vines and accent trees: on while the camera is near their extent
    for (const cs of this.chapterSets) {
      if (!this.groups[cs.chapter]?.visible) continue;
      cs.group.visible = Math.hypot(cam.x - cs.x, cam.z - cs.z) - cs.r < cs.near;
    }
  }

  /**
   * Per-frame life of the world: steam from forming islands, foam where waterfalls meet the sea.
   * Cheap (only near, visible things). updateVisibility() calls it when the game does not.
   */
  update(dt) {
    this._updT = this.game.time;
    if (!(dt > 0)) return;
    const g = this.game;
    const cam = g.engine.camera.position;
    const t = g.time;
    // steam vents: billowing white plumes where young rock meets the sea
    if (g.mist?.emit) {
      for (const v of this.vents) {
        if (!this.groups[v.chapter]?.visible) continue;
        const d = Math.hypot(cam.x - v.p.x, cam.z - v.p.z);
        if (d > 1600) continue;
        v.acc = (v.acc || 0) + dt * v.strength * (d < 600 ? 6 : 2.5);
        while (v.acc > 1) {
          v.acc -= 1;
          const k = Math.random();
          _v.set(v.p.x + (Math.random() - 0.5) * 6, v.p.y + Math.random() * 2, v.p.z + (Math.random() - 0.5) * 6);
          _w.set((Math.random() - 0.5) * 1.5, 2.5 + k * 3, (Math.random() - 0.5) * 1.5);
          g.mist.emit({ pos: _v, vel: _w, life: 7 + k * 5, size: 6 + k * 6, sizeEnd: 30 + k * 30, alpha: 0.32, drag: 0.15, kind: 0, fadeIn: 1.2 });
        }
      }
    }
    // plunge pools: rings of foam where the falls hit the water
    const ocean = g.ocean;
    if (ocean?.splash) {
      for (const w of this.waterfalls) {
        if (!w.visible) continue;
        const lip = w.userData.lip;
        if (Math.abs(lip.x - cam.x) > 500 || Math.abs(lip.z - cam.z) > 500) continue;
        w.userData.foamT = (w.userData.foamT ?? Math.random()) - dt;
        if (w.userData.foamT > 0) continue;
        w.userData.foamT = 0.7 + Math.random() * 0.5;
        const out = w.userData.out;
        _v.set(lip.x + out.x * 5, 0, lip.z + out.z * 5);
        ocean.splash(_v, 0.22, w.userData.width * 0.8);
      }
    }
    void t;
  }

  /**
   * The ground a plant or a landing creature stands on at (x, z): the highest up-facing island
   * surface (meadows, ledges, beaches at the rock's foot) or else the sea floor / atoll sand.
   * Returns { y, normal: Vector3, island: rec | null }. Island grids are built on first use.
   */
  groundAt(x, z, out = { y: 0, normal: new Vector3(0, 1, 0), island: null }) {
    if (out.normal === undefined) out.normal = new Vector3(0, 1, 0);
    let best = -1e9, bestRec = null;
    const smp = this._gs ||= { y: 0, nx: 0, ny: 1, nz: 0 };
    for (const rec of this.islands) {
      if (!rec.geo) continue;
      const dx = x - rec.pos.x, dz = z - rec.pos.z;
      if (dx * dx + dz * dz > rec.R * rec.R * 2.2) continue;
      rec.ground ||= topSurface(rec.geo, rec.R > 120 ? 1.5 : 1);
      const g = rec.ground.sample(dx, dz, smp);
      if (g && g.y > best) { best = g.y; bestRec = rec; out.normal.set(g.nx, g.ny, g.nz); }
    }
    const sb = this.seabed.heightAt(x, z);
    if (sb >= best) {
      best = sb;
      bestRec = null;
      const e = 1.5;
      out.normal.set(this.seabed.heightAt(x - e, z) - this.seabed.heightAt(x + e, z), 2 * e, this.seabed.heightAt(x, z - e) - this.seabed.heightAt(x, z + e)).normalize();
    }
    out.y = best;
    out.island = bestRec;
    return out;
  }

  /** groundAt() over a short list of candidate islands (flora scattering: many samples per patch). */
  _groundNear(list, x, z, out) {
    let best = -1e9, bestRec = null;
    const smp = this._gs ||= { y: 0, nx: 0, ny: 1, nz: 0 };
    for (let i = 0; i < list.length; i++) {
      const rec = list[i];
      const dx = x - rec.pos.x, dz = z - rec.pos.z;
      if (dx * dx + dz * dz > rec.R * rec.R * 2.2) continue;
      rec.ground ||= topSurface(rec.geo, rec.R > 120 ? 1.5 : 1);
      const g = rec.ground.sample(dx, dz, smp);
      if (g && g.y > best) { best = g.y; bestRec = rec; out.normal.set(g.nx, g.ny, g.nz); }
    }
    const sb = this.seabed.heightAt(x, z);
    if (sb >= best) {
      best = sb;
      bestRec = null;
      if (sb > -200) {
        // forward differences (two more lookups instead of four)
        const e = 1.5;
        out.normal.set(sb - this.seabed.heightAt(x + e, z), e, sb - this.seabed.heightAt(x, z + e)).normalize();
      } else out.normal.set(0, 1, 0);
    }
    out.y = best;
    out.island = bestRec;
    return out;
  }

  /** Builds now (instead of on first use, 1-20 ms each) the height grids groundAt() reads for a chapter. */
  prepareGround(id) {
    for (const rec of this.islands) if (rec.chapter === id && rec.geo && !rec.ground) rec.ground = topSurface(rec.geo, rec.R > 120 ? 1.5 : 1);
  }

  /**
   * Flora patches for an external plant system (e.g. AlienFlora.addPatch): per island a meadow /
   * cliff / shore patch over its rock, and a reef patch over every shelf or atoll. Each sample(x, z)
   * returns { y, normal, slope, wet, tidal } or null. Set world.builtinFlora = false before building
   * to leave the small plants (island and reef flora) to that system; the trees stay unless
   * world.builtinTrees = false too.
   */
  floraPatches(id) {
    const out = [];
    // a route of islands is seen from 20-120 m up: tall plants carry it, ground cover only matters
    // close up, so filler (moss cushions, sprouts) and the small anemones are thinned out
    const MULT = { moss: 0.16, sprouts: 0.1, anemone: 0.7 };
    const REEF = { moss: 0.1, anemone: 0.8, seafan: 0.9, kelp: 1, tubes: 0.8 };
    const mk = (center, radius, biome, density) => {
      const g = { y: 0, normal: new Vector3(0, 1, 0), island: null };
      // only the islands that can reach into this patch (groundAt would test every island)
      const near = this.islands.filter((rec) => rec.geo && Math.hypot(rec.pos.x - center.x, rec.pos.z - center.z) < radius + rec.R * 1.5 + 5);
      return {
        center, radius, biome, density, chapter: id, mult: biome === 'reef' ? REEF : MULT, fillerCap: 2500,
        sample: (x, z) => {
          this._groundNear(near, x, z, g);
          if (g.y < -24) return null;
          const n = g.normal.clone();
          return { y: g.y, normal: n, slope: 1 - n.y, wet: g.y < 3 ? 0.9 : 0.55, tidal: smoothstep(1.4, 0, Math.abs(g.y + 0.2)) };
        },
      };
    };
    const AL = ALIEN[id] || this.chapterOpts[id]?.alien || ALIEN.valleys;
    const q = this.floraDensity ?? 1;
    for (const rec of this.plan[id].islands) {
      if (rec.routeDist > FLORA_NEAR + 150) continue;
      const c = new Vector3(rec.pos.x, 0, rec.pos.z);
      const volcanic = rec.style.rock === 'volcanic';
      const k = AL.dens * q;
      out.push(mk(c, rec.R, volcanic ? 'volcanic' : AL.biome, k));
      out.push(mk(c, rec.R, 'cliff', (volcanic ? 0.3 : 0.9) * Math.max(k, 0.6)));
      out.push(mk(c, rec.R * 1.15, 'shore', 0.85 * Math.max(k, 0.6)));
    }
    for (const f of this.plan[id].features) out.push(mk(new Vector3(f.x, 0, f.z), f.R * 0.8, 'reef', (f.kind === 'atoll' ? 0.5 : 0.7) * Math.max(AL.dens, 0.6) * q));
    return out;
  }

  /**
   * Quality 0..1 (like the engine presets): terrain micro detail fades sooner, flora thins out in
   * chapters built afterwards, island LODs switch closer.
   */
  setQuality(q) {
    this.quality = clamp(q, 0, 1);
    const m = terrainMaterial();
    if (m.uniforms.uDetail) m.uniforms.uDetail.value = lerp(0.55, 1, this.quality);
    this.floraDensity = lerp(0.45, 1, this.quality);
    this.lodDist = lerp(420, 650, this.quality);
    this.flora?.setQuality(Math.max(0.4, this.quality));
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
    const dir = (this._rcDir ||= new Vector3()).subVectors(to, from);
    const len = dir.length();
    dir.normalize();
    let t = 0;
    const p = (this._rcP ||= new Vector3());
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
    if (!best) return null;
    const res = (this._nwf ||= { wf: null, dist: 0 });
    res.wf = best;
    res.dist = bd;
    return res;
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
    return smoothstep(0.45, 0.9, t) * smoothstep(14, 0.5, P.y);
  };
}

function capsuleDist(p, c) {
  const abx = c.b.x - c.a.x, aby = c.b.y - c.a.y, abz = c.b.z - c.a.z;
  const t = clamp(((p.x - c.a.x) * abx + (p.y - c.a.y) * aby + (p.z - c.a.z) * abz) / (abx * abx + aby * aby + abz * abz), 0, 1);
  return Math.hypot(p.x - (c.a.x + abx * t), p.y - (c.a.y + aby * t), p.z - (c.a.z + abz * t)) - c.r;
}
