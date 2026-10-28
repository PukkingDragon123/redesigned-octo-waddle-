// Builds every chapter of the migration along the path, time-sliced so the menu can play
// while the world grows behind it. Owns colliders (islands, the arch, giant trunks),
// waterfalls, lakes, chapter visibility, and spawn points for the living ecosystem.
import { Group, Vector3, Quaternion } from 'three';
import { buildIsland, islandDistance } from './LegacyIslands.js';
import { Vegetation, TEMPLATES, PALETTES } from './Trees.js';
import { buildWaterfall, buildLake } from './Water.js';
import { buildArch } from './Landmarks.js';
import { rng, lerp, clamp, smoothstep, TAU } from '../core/math.js';

const nextFrame = () => new Promise((res) => requestAnimationFrame(() => res()));

export class WorldBuilder {
  constructor(game, path) {
    this.game = game;
    this.path = path;
    this.groups = {};
    this.islands = [];
    this.sphereColliders = []; // {p, r}
    this.capsules = []; // {a, b, r}
    this.waterfalls = [];
    this.lakes = [];
    this.spawns = { krill: [], rays: [], jellies: [], birds: [], plankton: [] };
    this.lightningSpots = [];
    this.progress = 0;
    this.built = new Set();
    this.done = new Set(); // chapters whose islands, vegetation and spawns are complete
    this._v = new Vector3();
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

  // ---- placement helpers --------------------------------------------------------------
  placeIsland(chapter, spec, veg) {
    const isl = buildIsland(spec);
    isl.mesh.position.copy(spec.pos);
    const g = this.group(chapter);
    g.add(isl.mesh);
    this.game.engine.shadows.addCaster(isl.mesh);
    const rec = { pos: spec.pos.clone(), collider: isl.collider, island: isl, chapter, R: isl.R };
    this.islands.push(rec);
    const r = rng((spec.seed ?? 1) * 13 + 5);
    // vegetation on top
    const style = spec.style ?? 'grass';
    const density = spec.trees ?? (style === 'barren' ? 0.1 : style === 'forest' ? 1.5 : 0.7);
    const nTrees = Math.round(density * (isl.R * isl.R) / 450);
    for (let i = 0; i < nTrees; i++) {
      const a = r() * TAU, rr = Math.sqrt(r()) * isl.R * 0.78;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const pick = r();
      let kind = 'broadleaf';
      if (style === 'forest') kind = pick < 0.5 ? 'broadleaf' : pick < 0.8 ? 'willow' : 'cypress';
      else kind = pick < 0.35 ? 'umbrella' : pick < 0.6 ? 'broadleaf' : pick < 0.8 ? 'cypress' : 'willow';
      const seed = 1 + Math.floor(r() * 4);
      const pal = spec.palette || (kind === 'umbrella' ? PALETTES.deep : kind === 'willow' ? PALETTES.spring : r() < 0.15 ? PALETTES.blossom : PALETTES.green);
      const palName = Object.keys(PALETTES).find((k) => PALETTES[k] === pal) || 'green';
      veg.add(`${kind}-${seed}-${palName}`, () => TEMPLATES[kind](seed, pal), new Vector3(spec.pos.x + x, spec.pos.y + isl.surfaceY(x, z) - 0.4, spec.pos.z + z), lerp(0.8, 1.5, r()) * (spec.treeScale ?? 1), r() * TAU);
    }
    const nSmall = Math.round(nTrees * 1.6 + isl.R * 0.15);
    for (let i = 0; i < nSmall; i++) {
      const a = r() * TAU, rr = Math.sqrt(r()) * isl.R * 0.9;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const bush = r() < 0.65;
      const seed = 1 + Math.floor(r() * 3);
      veg.add(bush ? `bush-${seed}` : `boulder-${seed}`, () => (bush ? TEMPLATES.bush(seed, PALETTES.green) : TEMPLATES.boulder(seed)),
        new Vector3(spec.pos.x + x, spec.pos.y + isl.surfaceY(x, z) - 0.3, spec.pos.z + z), bush ? lerp(0.8, 1.8, r()) : lerp(1, 4, r()), r() * TAU);
    }
    // vines hanging from the rim
    const nV = Math.round((spec.vines ?? 0.5) * isl.R * 0.5);
    for (let i = 0; i < nV; i++) {
      const th = r() * TAU;
      const ro = isl.outlineR(th) * 0.98;
      const top = new Vector3(spec.pos.x + Math.cos(th) * ro, spec.pos.y + isl.surfaceY(Math.cos(th) * ro * 0.97, Math.sin(th) * ro * 0.97) - 1.5, spec.pos.z + Math.sin(th) * ro);
      veg.add('vine-1', () => TEMPLATES.vine(1), top, lerp(6, 22, r()), r() * TAU);
    }
    // waterfalls
    const nFalls = spec.falls ?? 0;
    for (let i = 0; i < nFalls; i++) {
      const th = spec.fallAngle !== undefined ? spec.fallAngle + i * 2.1 : r() * TAU;
      const ro = isl.outlineR(th);
      const out = new Vector3(Math.cos(th), 0, Math.sin(th));
      const lip = new Vector3(spec.pos.x + Math.cos(th) * ro * 1.01, spec.pos.y + isl.surfaceY(Math.cos(th) * ro * 0.95, Math.sin(th) * ro * 0.95) - 0.6, spec.pos.z + Math.sin(th) * ro * 1.01);
      const drop = Math.max(60, lip.y + 40);
      const wf = buildWaterfall(lip, out, lerp(4, 10, r()) * (spec.fallWidth ?? 1), drop, (spec.seed ?? 1) * 7 + i);
      this.game.engine.sceneT.add(wf);
      wf.userData.chapter = chapter;
      this.waterfalls.push(wf);
    }
    if (spec.lake) {
      const lake = buildLake(new Vector3(spec.pos.x, spec.pos.y + isl.dome * 0.12, spec.pos.z), (th) => isl.outlineR(th) * 0.86);
      this.game.engine.sceneT.add(lake);
      lake.userData.chapter = chapter;
      this.lakes.push(lake);
    }
    return rec;
  }

  /** Islands scattered along a path range, off the flight corridor. */
  scatterIslands(chapter, s0, s1, count, opts, veg, r) {
    for (let i = 0; i < count; i++) {
      const s = lerp(s0, s1, (i + r()) / count);
      const side = r() < 0.5 ? -1 : 1;
      const R = lerp(opts.rMin ?? 20, opts.rMax ?? 90, Math.pow(r(), 1.6));
      const lat = side * (lerp(opts.latMin ?? 110, opts.latMax ?? 520, r()) + R);
      const vert = lerp(opts.yMin ?? -110, opts.yMax ?? 70, r());
      const pos = this.path.offsetAt(s, lat, vert);
      const style = opts.styles ? opts.styles[Math.floor(r() * opts.styles.length)] : 'grass';
      this.placeIsland(chapter, {
        R, H: R * lerp(0.35, 0.6, r()), D: R * lerp(1.1, 1.9, r()), dome: R * lerp(0.06, 0.16, r()), seed: Math.floor(r() * 1e6),
        pos, style, falls: R > 45 && r() < (opts.fallChance ?? 0.4) ? 1 + (r() < 0.3 ? 1 : 0) : 0,
        detail: R > 60 ? 1 : 0.7, spikes: Math.round(R / 8), vines: opts.vines ?? 0.5, trees: opts.trees,
      }, veg);
    }
  }

  distantSpires(chapter, s0, s1, count, r) {
    const g = this.group(chapter);
    for (let i = 0; i < count; i++) {
      const s = lerp(s0, s1, r());
      const side = r() < 0.5 ? -1 : 1;
      const pos = this.path.offsetAt(s, side * lerp(1100, 2600, r()), lerp(-60, 160, r()));
      const R = lerp(90, 220, r());
      const isl = buildIsland({ R, H: R * lerp(0.6, 1.4, r()), D: R * lerp(1.6, 2.6, r()), dome: R * 0.08, seed: Math.floor(r() * 1e6), detail: 0.55, spikes: 3, segments: 48 });
      isl.mesh.position.copy(pos);
      g.add(isl.mesh);
    }
  }

  // ---- chapters -------------------------------------------------------------------------
  async build(onProgress) {
    const order = ['cradle', 'valleys', 'krill', 'forest', 'song', 'night', 'storm', 'falcon', 'wall', 'oasis'];
    for (let i = 0; i < order.length; i++) {
      await this.buildChapter(order[i]);
      this.progress = (i + 1) / order.length;
      onProgress?.(this.progress, order[i]);
      await nextFrame();
    }
  }

  async buildChapter(id) {
    if (this.built.has(id)) return;
    this.built.add(id);
    const ch = this.path.chapterById(id);
    const veg = new Vegetation(this.game);
    const r = rng(1000 + ch.index * 77);
    const clouds = this.game.clouds;
    const P = this.path;
    const s0 = ch.start, s1 = ch.end;
    const at = (s, lat = 0, vert = 0) => P.offsetAt(s, lat, vert);

    if (id === 'cradle') {
      // a sheltered ring of islands around the resting herd; the east stays open for sunrise
      const c = at(70);
      const ring = [
        [-2.6, 230, 40, 70, 2], [-1.9, 300, -20, 95, 1], [-1.2, 260, 50, 45, 0], [-0.4, 330, -50, 120, 1],
        [2.3, 260, 30, 60, 1], [2.9, 210, -10, 40, 0], [3.5, 300, 60, 80, 2], [1.0, 520, -30, 70, 1],
      ];
      ring.forEach(([a, dist, dy, R, falls], k) => {
        const pos = new Vector3(c.x + Math.cos(a) * dist, c.y + dy - R * 0.2, c.z + Math.sin(a) * dist);
        this.placeIsland(id, { R, H: R * 0.5, D: R * 1.6, dome: R * 0.12, seed: 31 + k, pos, falls, vines: 0.8, trees: 0.9 }, veg);
      });
      // the calf's sleeping rock: a small mossy island under the herd
      this.placeIsland(id, { R: 16, H: 8, D: 26, dome: 2.5, seed: 77, pos: at(70, -8, -16), trees: 0.4, vines: 1 }, veg);
      this.scatterIslands(id, 250, s1, 7, { rMin: 20, rMax: 70, latMin: 140 }, veg, r);
      for (let k = 0; k < 9; k++) {
        const s = lerp(s0 - 400, s1 + 200, r());
        const side = r() < 0.5 ? -1 : 1;
        clouds.cumulus(at(s, side * lerp(150, 900, r()), lerp(-90, 40, r())), lerp(140, 320, r()), lerp(70, 160, r()), { seed: 500 + k });
      }
      clouds.sheet(at(80, 0, -95), 1400, 1400, 30, { seed: 3, opacity: 0.45, minR: 26, maxR: 60, spacing: 9000 });
      this.distantSpires(id, s0 - 800, s1, 5, r);
      this.spawns.birds.push({ pos: at(90, 30, 25), count: 60, chapter: id });
    }

    if (id === 'valleys') {
      this.scatterIslands(id, s0, s1, 26, { rMin: 22, rMax: 110, latMin: 90, latMax: 460, yMin: -140, yMax: 90, fallChance: 0.55, vines: 0.8 }, veg, r);
      // tall spires close to the corridor
      for (let k = 0; k < 8; k++) {
        const s = lerp(s0 + 100, s1 - 100, r());
        const side = r() < 0.5 ? -1 : 1;
        const R = lerp(26, 48, r());
        this.placeIsland(id, { R, H: R * lerp(1.6, 2.6, r()), D: R * 2.4, dome: R * 0.1, seed: 900 + k, pos: at(s, side * lerp(90, 200, r()), lerp(-40, 60, r())), falls: r() < 0.5 ? 1 : 0, vines: 1.2, trees: 0.6 }, veg);
      }
      // the Great Arch spanning the route at its lowest point
      const sArch = 1860;
      const f = P.frameAt(sArch);
      const arch = buildArch({ center: f.pos.clone().add(new Vector3(0, 70, 0)), span: f.right, along: f.fwd, radius: 165, thick: 26, width: 46, seed: 7 });
      this.group(id).add(arch.mesh);
      this.game.engine.shadows.addCaster(arch.mesh);
      for (const cc of arch.colliders) this.sphereColliders.push({ p: cc.p, r: cc.r, chapter: id });
      for (const t of arch.tops) {
        if (r() < 0.55) veg.add(`umbrella-${1 + Math.floor(r() * 3)}-deep`, () => TEMPLATES.umbrella(1 + Math.floor(r() * 3), PALETTES.deep), t.p, lerp(0.8, 1.4, r()), r() * TAU);
        if (r() < 0.8) veg.add('bush-1', () => TEMPLATES.bush(1, PALETTES.green), t.p.clone().add(new Vector3((r() - 0.5) * 20, 0, (r() - 0.5) * 20)), lerp(1, 2, r()), r() * TAU);
      }
      for (const u of arch.unders) for (let q = 0; q < 2; q++) veg.add('vine-1', () => TEMPLATES.vine(1), u.p.clone().add(new Vector3((r() - 0.5) * 30, 0, (r() - 0.5) * 30)), lerp(10, 28, r()), r() * TAU);
      // anchor rocks at the feet
      arch.feet.forEach((fp, k) => this.placeIsland(id, { R: 70, H: 50, D: 160, dome: 6, seed: 61 + k, pos: fp.clone().add(new Vector3(0, -20, 0)), falls: 1, vines: 1, trees: 0.8 }, veg));
      this.archInfo = { s: sArch, pos: f.pos.clone() };
      for (let k = 0; k < 12; k++) {
        const s = lerp(s0, s1, r());
        clouds.cumulus(at(s, (r() < 0.5 ? -1 : 1) * lerp(200, 1100, r()), lerp(-80, 60, r())), lerp(140, 320, r()), lerp(80, 180, r()), { seed: 600 + k });
      }
      this.distantSpires(id, s0, s1, 9, r);
      this.spawns.birds.push({ pos: at(1500, 40, 40), count: 50, chapter: id });
      this.spawns.rays.push({ pos: at(2300, 60, -20), count: 5, chapter: id });
    }

    if (id === 'krill') {
      this.scatterIslands(id, s0, s1, 8, { rMin: 18, rMax: 60, latMin: 260, latMax: 700, yMin: -120, yMax: 40, fallChance: 0.3 }, veg, r);
      // moisture-rich wisps where plankton blooms: the feeding grounds
      for (let k = 0; k < 9; k++) {
        const s = lerp(s0 + 80, s1 - 80, (k + 0.5) / 9);
        const lat = (r() - 0.5) * 260;
        const c = at(s, lat, lerp(-25, 30, r()));
        clouds.wisps(c, lerp(90, 160, r()), Math.round(lerp(18, 30, r())), { seed: 700 + k, moisture: 1, opacity: 0.38 });
        this.spawns.krill.push({ pos: c.clone(), count: Math.round(lerp(500, 1100, r())), chapter: id });
        this.spawns.plankton.push({ pos: c.clone(), radius: 140, chapter: id });
      }
      for (let k = 0; k < 14; k++) {
        const s = lerp(s0, s1, r());
        clouds.cumulus(at(s, (r() < 0.5 ? -1 : 1) * lerp(250, 1300, r()), lerp(40, 220, r())), lerp(160, 360, r()), lerp(80, 200, r()), { seed: 800 + k });
      }
      this.spawns.rays.push({ pos: at(2900, 40, 10), count: 8, chapter: id }, { pos: at(3400, -60, 30), count: 6, chapter: id });
      this.spawns.jellies.push({ pos: at(3600, 120, 40), count: 6, chapter: id });
      this.distantSpires(id, s0, s1, 6, r);
    }

    if (id === 'forest') {
      // giant trees on islands flanking the corridor; the herd weaves between their crowns
      const nGiants = 9;
      for (let k = 0; k < nGiants; k++) {
        const s = lerp(s0 + 120, s1 - 200, (k + r() * 0.6) / nGiants);
        const side = k % 2 === 0 ? -1 : 1;
        const H = lerp(150, 210, r());
        const lat = side * lerp(95, 170, r());
        const base = at(s, lat, -H * 0.62);
        const R = lerp(55, 85, r());
        this.placeIsland(id, { R, H: R * 0.5, D: R * 1.7, dome: R * 0.1, seed: 1100 + k, pos: base, style: 'forest', falls: r() < 0.5 ? 1 : 0, vines: 1.5, trees: 0.8 }, veg);
        const gseed = 1 + (k % 3);
        veg.add(`giant-${gseed}`, () => TEMPLATES.giant(gseed, k % 2 ? PALETTES.deep : PALETTES.teal, { height: 180 }), base.clone().add(new Vector3(0, -2, 0)), H / 180, r() * TAU);
        const trunkR = 180 * 0.075 * (H / 180);
        this.capsules.push({ a: base.clone(), b: base.clone().add(new Vector3(0, H * 0.8, 0)), r: trunkR * 1.2, chapter: id });
        // crown colliders (soft): the calf can brush leaves but not pass through the core
        this.sphereColliders.push({ p: base.clone().add(new Vector3(0, H * 0.75, 0)), r: H * 0.18, chapter: id, soft: true });
      }
      this.scatterIslands(id, s0, s1, 12, { rMin: 25, rMax: 80, latMin: 220, latMax: 600, styles: ['forest', 'grass'], vines: 1.4, fallChance: 0.5 }, veg, r);
      // low mist banks in the canopy
      for (let k = 0; k < 6; k++) {
        const s = lerp(s0, s1, (k + 0.5) / 6);
        clouds.sheet(at(s, (r() - 0.5) * 300, -70), 700, 500, 40, { seed: 1200 + k, opacity: 0.5, minR: 24, maxR: 55, spacing: 6000 });
      }
      for (let k = 0; k < 8; k++) {
        const s = lerp(s0, s1, r());
        clouds.cumulus(at(s, (r() < 0.5 ? -1 : 1) * lerp(400, 1200, r()), lerp(60, 200, r())), lerp(160, 300, r()), lerp(90, 180, r()), { seed: 1300 + k });
      }
      this.spawns.jellies.push({ pos: at(4300, 40, 20), count: 10, chapter: id }, { pos: at(5000, -50, 10), count: 8, chapter: id });
      this.spawns.birds.push({ pos: at(4600, 20, 50), count: 80, chapter: id });
      this.distantSpires(id, s0, s1, 6, r);
    }

    if (id === 'song') {
      // a cathedral of towering cumulus around an open nave of sky
      const center = at(5800, 0, 0);
      this.songCenter = center.clone();
      for (let k = 0; k < 11; k++) {
        const a = (k / 11) * TAU + r() * 0.2;
        const d = lerp(620, 900, r());
        const c = new Vector3(center.x + Math.cos(a) * d, lerp(-30, 40, r()), center.z + Math.sin(a) * d);
        clouds.tower(c, lerp(220, 340, r()), lerp(420, 640, r()), { seed: 1400 + k, maxPuffs: 120 });
      }
      for (let k = 0; k < 6; k++) {
        const s = lerp(s0, s1, r());
        clouds.cumulus(at(s, (r() < 0.5 ? -1 : 1) * lerp(300, 500, r()), lerp(-90, -40, r())), lerp(140, 240, r()), lerp(60, 100, r()), { seed: 1500 + k });
      }
      this.scatterIslands(id, s0, s1, 5, { rMin: 30, rMax: 80, latMin: 400, latMax: 700, yMin: -160, yMax: -60 }, veg, r);
      this.spawns.krill.push({ pos: at(5800, 40, -20), count: 700, chapter: id });
      this.spawns.rays.push({ pos: at(5800, -90, -30), count: 10, chapter: id });
      this.distantSpires(id, s0, s1, 7, r);
    }

    if (id === 'night') {
      this.scatterIslands(id, s0, s1, 7, { rMin: 25, rMax: 90, latMin: 160, latMax: 600, yMin: -140, yMax: 20, fallChance: 0.5 }, veg, r);
      for (let k = 0; k < 8; k++) {
        const s = lerp(s0, s1, r());
        clouds.cumulus(at(s, (r() < 0.5 ? -1 : 1) * lerp(200, 900, r()), lerp(-100, 60, r())), lerp(160, 320, r()), lerp(80, 170, r()), { seed: 1600 + k });
      }
      for (let k = 0; k < 3; k++) {
        const c = at(lerp(s0 + 100, s1 - 100, (k + 0.5) / 3), (r() - 0.5) * 200, lerp(-30, 20, r()));
        clouds.wisps(c, 120, 18, { seed: 1650 + k, moisture: 1, opacity: 0.3 });
        this.spawns.krill.push({ pos: c, count: 900, chapter: id });
      }
      this.spawns.jellies.push({ pos: at(6600, 60, 30), count: 12, chapter: id });
      this.distantSpires(id, s0, s1, 5, r);
    }

    if (id === 'storm') {
      for (let k = 0; k < 14; k++) {
        const s = lerp(s0 - 100, s1 + 100, (k + r()) / 14);
        const side = r() < 0.5 ? -1 : 1;
        const c = at(s, side * lerp(140, 700, r()), lerp(-160, -60, r()));
        clouds.tower(c, lerp(260, 420, r()), lerp(500, 820, r()), { seed: 1700 + k, dark: 0.85, maxPuffs: 110 });
        this.lightningSpots.push(c.clone().add(new Vector3(0, 300, 0)));
      }
      for (let k = 0; k < 6; k++) {
        const s = lerp(s0, s1, (k + 0.5) / 6);
        clouds.sheet(at(s, 0, 140), 1600, 700, 60, { seed: 1800 + k, opacity: 0.7, dark: 0.8, minR: 40, maxR: 80, spacing: 9000 });
      }
      this.scatterIslands(id, s0, s1, 6, { rMin: 25, rMax: 70, latMin: 200, latMax: 600, styles: ['barren'], fallChance: 0.2 }, veg, r);
    }

    if (id === 'falcon') {
      // a torn ceiling of cloud above the route: the falcon hunts from inside it
      for (let k = 0; k < 7; k++) {
        const s = lerp(s0, s1, (k + 0.5) / 7);
        clouds.sheet(at(s, (r() - 0.5) * 300, lerp(150, 200, r())), 900, 500, 50, { seed: 1900 + k, opacity: 0.62, minR: 34, maxR: 70, spacing: 7000 });
      }
      for (let k = 0; k < 10; k++) {
        const s = lerp(s0, s1, r());
        clouds.cumulus(at(s, (r() < 0.5 ? -1 : 1) * lerp(160, 900, r()), lerp(-120, 20, r())), lerp(140, 300, r()), lerp(80, 160, r()), { seed: 2000 + k });
      }
      this.scatterIslands(id, s0, s1, 7, { rMin: 25, rMax: 90, latMin: 180, latMax: 600, yMin: -150, yMax: 0, fallChance: 0.4 }, veg, r);
      this.spawns.birds.push({ pos: at(8500, 60, 60), count: 70, chapter: id });
      this.distantSpires(id, s0, s1, 6, r);
    }

    if (id === 'wall') {
      // the cloud wall guarding the Oasis
      for (let k = 0; k < 16; k++) {
        const lat = lerp(-1100, 1100, k / 15) + (r() - 0.5) * 80;
        const s = 9650 + (r() - 0.5) * 120;
        const c = at(s, lat, -150);
        clouds.tower(c, lerp(260, 380, r()), lerp(520, 700, r()), { seed: 2100 + k, maxPuffs: 140, density: 1.3 });
      }
      clouds.sheet(at(9640, 0, 40), 2400, 260, 300, { seed: 2200, opacity: 0.8, minR: 50, maxR: 95, spacing: 4200, maxPuffs: 260 });
    }

    if (id === 'oasis') {
      // floating lakes spilling waterfalls, lush islands, the Mother Tree
      const lakes = [
        [10250, -260, -30, 120], [10450, 240, 10, 150], [10700, -180, 60, 95], [11000, 120, -50, 190],
        [11250, -300, 30, 130], [11500, 280, 70, 110], [10850, 420, -90, 85],
      ];
      lakes.forEach(([s, lat, vert, R], k) => {
        this.placeIsland(id, { R, H: R * 0.4, D: R * 1.5, dome: R * 0.1, seed: 2300 + k, pos: at(s, lat, vert - 10), lake: true, falls: 3, fallWidth: 1.6, fallAngle: r() * TAU, vines: 1.6, trees: 0.6, palette: PALETTES.spring }, veg);
      });
      // the Mother Tree on its island, where the herds gather
      const mt = at(11150, -40, -130);
      this.motherTree = mt.clone();
      this.placeIsland(id, { R: 140, H: 60, D: 220, dome: 10, seed: 2400, pos: mt, falls: 4, fallWidth: 2, vines: 2, trees: 0.4, palette: PALETTES.spring }, veg);
      veg.add('giant-mother', () => TEMPLATES.giant(5, PALETTES.blossom, { height: 300, trunkR: 26, layers: 6 }), mt.clone().add(new Vector3(0, 8, 0)), 1, 0.4);
      this.capsules.push({ a: mt.clone(), b: mt.clone().add(new Vector3(0, 240, 0)), r: 34, chapter: id });
      this.sphereColliders.push({ p: mt.clone().add(new Vector3(0, 250, 0)), r: 60, chapter: id, soft: true });
      this.scatterIslands(id, s0, s1, 16, { rMin: 25, rMax: 90, latMin: 160, latMax: 700, yMin: -160, yMax: 80, fallChance: 0.7, vines: 1.4, styles: ['grass', 'forest'] }, veg, r);
      for (let k = 0; k < 14; k++) {
        const s = lerp(s0, s1 + 400, r());
        clouds.cumulus(at(s, (r() < 0.5 ? -1 : 1) * lerp(350, 1400, r()), lerp(-100, 160, r())), lerp(160, 360, r()), lerp(90, 200, r()), { seed: 2500 + k });
      }
      // a soft ring of tall clouds embracing the basin
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * TAU;
        const c = at(10900, 0, 0);
        clouds.tower(new Vector3(c.x + Math.cos(a) * 1500, c.y - 250, c.z + Math.sin(a) * 1500), 380, 600, { seed: 2600 + k, maxPuffs: 90 });
      }
      for (let k = 0; k < 5; k++) {
        const c = at(lerp(s0 + 150, s1, (k + 0.5) / 5), (r() - 0.5) * 300, lerp(-20, 40, r()));
        // keep the feeding grounds (and their krill) out of the floating lakes' rock
        for (let i = 0; i < 4 && this.distance(c, 120) < 40; i++) c.add(this.collide(c, 40, new Vector3()));
        clouds.wisps(c, 110, 16, { seed: 2700 + k, moisture: 1, opacity: 0.3 });
        this.spawns.krill.push({ pos: c, count: 800, chapter: id });
      }
      this.spawns.rays.push({ pos: at(10500, 100, 20), count: 10, chapter: id }, { pos: at(11300, -120, 40), count: 12, chapter: id });
      this.spawns.jellies.push({ pos: at(10800, 200, 60), count: 12, chapter: id });
      this.spawns.birds.push({ pos: at(10600, 50, 40), count: 90, chapter: id }, { pos: at(11200, -60, 80), count: 80, chapter: id });
      this.distantSpires(id, s0, s1 + 600, 8, r);
    }

    veg.build(this.group(id), this.game.engine.shadows);
    this.done.add(id);
  }

  // ---- runtime ----------------------------------------------------------------------------
  /** Hide chapters far from the current path position. */
  updateVisibility(s) {
    for (const ch of this.path.chapters) {
      const g = this.groups[ch.id];
      if (!g) continue;
      const near = s > ch.start - 2600 && s < ch.end + 2600;
      g.visible = near;
    }
    for (const w of this.waterfalls) w.visible = this.groups[w.userData.chapter]?.visible ?? true;
    for (const l of this.lakes) l.visible = this.groups[l.userData.chapter]?.visible ?? true;
  }

  /** Signed distance to the nearest solid (approximate). */
  distance(p, maxCheck = 400) {
    let d = Infinity;
    for (const isl of this.islands) {
      const dx = p.x - isl.pos.x, dz = p.z - isl.pos.z;
      if (Math.abs(dx) > isl.R * 1.3 + maxCheck || Math.abs(dz) > isl.R * 1.3 + maxCheck) continue;
      d = Math.min(d, islandDistance(isl, p));
    }
    for (const sc of this.sphereColliders) {
      d = Math.min(d, p.distanceTo(sc.p) - sc.r);
    }
    for (const c of this.capsules) d = Math.min(d, capsuleDist(p, c));
    return d;
  }

  /** Push a sphere out of solids. Returns the correction vector (zero if none). */
  collide(p, radius, out = new Vector3()) {
    out.set(0, 0, 0);
    const e = 0.8;
    const d = this.distance(p, radius + 60);
    if (d >= radius) return out;
    // gradient by central differences
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
    for (let i = 0; i < 24 && t < len; i++) {
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
      // distance to the falling column (vertical segment under the lip)
      const dx = p.x - lip.x, dz = p.z - lip.z;
      const dy = p.y > lip.y ? p.y - lip.y : p.y < lip.y - w.userData.drop ? lip.y - w.userData.drop - p.y : 0;
      const d = Math.hypot(dx, dz, dy);
      if (d < bd) { bd = d; best = w; }
    }
    return best ? { wf: best, dist: bd } : null;
  }
}

function capsuleDist(p, c) {
  const ab = new Vector3().subVectors(c.b, c.a);
  const t = clamp(new Vector3().subVectors(p, c.a).dot(ab) / ab.lengthSq(), 0, 1);
  const q = c.a.clone().addScaledVector(ab, t);
  return p.distanceTo(q) - c.r;
}
