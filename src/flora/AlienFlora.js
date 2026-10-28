// The moving alien flora of Vur Sok: giant spiral fiddleheads, breathing tube and bell plants,
// anemone frond clusters that recoil from whales, kelp ribbons streaming in the wind, glassy sea
// fans, spore puffballs, moss cushions and curled sprouts.
//
//   const flora = new AlienFlora(game, { seed });
//   flora.addPatch({ center, radius, sample: (x, z) => ({ y, normal, slope, wet, tidal }) | null,
//                    biome: 'meadow'|'shore'|'cliff'|'reef'|'oasis'|'volcanic', density: 0..1 });
//   flora.place('fiddle', position, up, scale, seed);   // a hero plant
//   flora.build();                                      // instancing (call again after more patches)
//   scene.add(flora.root);
//   flora.update(dt, { disturbers: [{ pos, radius, vel?, strength? }, ...] });  // each frame
//
// Rendering: one instanced mesh per species and LOD (near: full template, mid: reduced; near and mid
// share one program), one shared mesh of painted far cards for every species, and depth-only shadow
// proxies (near plants cast with the mid template). Plants live in 16 m chunks (8 m for filler)
// grouped in 128 m regions. In Engine.beforeRender (only when the camera moved) chunks are culled
// against the frustum and distance; visible plants are packed into the LOD buffers (whole chunks
// where a chunk sits inside one LOD, plant by plant at the boundaries, a few species per frame).
// The vertex shader then picks the exact LOD per plant with a dithered cross-fade, so nothing pops.
// Reactions to whales run on the CPU as a per-plant startle state (a few hundred plants at most).
import {
  Group, Mesh, InstancedBufferAttribute, Vector2, Vector3, Vector4, Quaternion, Frustum, Matrix4,
  ShaderMaterial, DoubleSide, Color, DynamicDrawUsage,
} from 'three';
import { G } from '../render/Globals.js';
import { LAYER_SHADOW, depthVariant } from '../render/Shadows.js';
import { getNoiseTexture } from '../render/NoiseTex.js';
import { FLORA_VERT_HEAD, FLORA_FRAG_HEAD } from './glsl.js';
import { instancedGeometry } from './geometry.js';
import { scatterPatch, plantQuat, FOOTPRINT } from './scatter.js';
import { SPECIES } from './species/index.js';
import { buildImpostor } from './impostor.js';
import { BALLS, puffPeriod, puffPhase } from './species/puffball.js';
import { rng, clamp } from '../core/math.js';

const CHUNK = 16;
const REGION = 128;
const GRID = 8; // startle lookup grid (m)
const STRIDE = 12; // raw record: x y z s qx qy qz qw seed hue pal aux

const LOD_MARGIN = 5; // m: plants join a LOD early so budgeted repacks never open a hole
const _q = new Quaternion();
function markRange(attr, n) {
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, Math.max(1, n));
  attr.needsUpdate = true;
}
const _sp = new Vector3(), _sv = new Vector3(), _sq = new Quaternion();
const SPORE = new Color(1.0, 0.93, 0.74);
const SPORE_GLOW = new Color(0.75, 1.0, 0.6);

/** Instance buffers for one species LOD (capacity = all instances of the species). */
function makeBuffers(cap) {
  const mk = (n) => new InstancedBufferAttribute(new Float32Array(Math.max(1, cap) * n), n).setUsage(DynamicDrawUsage);
  return { iPos: mk(4), iQuat: mk(4), iPrm: mk(4), iState: mk(1), count: 0 };
}

export class AlienFlora {
  constructor(game, opts = {}) {
    this.game = game;
    this.seed = opts.seed ?? 1;
    this.root = new Group();
    this.root.name = 'alien-flora';
    this._enabled = true;
    this.quality = 1;
    this.built = false;
    this.patches = [];
    this.castShadows = opts.shadows !== false;
    this.density = opts.density ?? 1; // global multiplier on every patch's density
    this.timing = { update: 0, cull: 0, build: 0, packs: 0 };
    this._r = rng((this.seed * 2654435761) >>> 0);
    // uniforms shared by reference with every flora material
    this.shared = {
      uDist: { value: Array.from({ length: 8 }, () => new Vector4(0, -1e5, 0, 0)) },
      uDistV: { value: Array.from({ length: 8 }, () => new Vector4()) },
      uDistN: { value: 0 },
      uWindAmt: { value: opts.wind ?? 1 },
      uNoise: { value: getNoiseTexture() },
    };
    this._prevD = Array.from({ length: 8 }, () => new Vector4(0, -1e5, 0, -1));
    // species runtimes: materials exist from the start so Engine.precompile sees every program
    this.species = [];
    this.byName = new Map();
    for (const def of SPECIES) {
      const sp = {
        def, id: this.species.length, name: def.name,
        raw: [], n: 0,
        mats: [this._material(def, 0), this._material(def, 1)],
        tpl: [def.template(0), def.template(1)],
        meshes: [null, null], proxy: null, bufs: null,
        chunks: [], active: [], dirty: true,
      };
      this.species.push(sp);
      this.byName.set(def.name, sp);
    }
    this.known = new Set(this.byName.keys());
    for (const sp of this.species) this._createMeshes(sp);
    this.impostor = buildImpostor(this);
    this.root.add(this.impostor.mesh);
    this.regions = [];
    this.grid = new Map();
    this.startle = { list: [], set: null };
    this._frustum = new Frustum();
    // sphere-in-frustum without allocation (bound once)
    this._inFrustum = (x, y, z, r) => {
      const planes = this._frustum.planes;
      for (let i = 0; i < 6; i++) {
        const p = planes[i];
        if (p.normal.x * x + p.normal.y * y + p.normal.z * z + p.constant < -r) return false;
      }
      return true;
    };
    this._pv = new Matrix4();
    this._camPos = new Vector3();
    this.packBudget = opts.packBudget ?? 3;
    this.lodScale = opts.lodScale ?? 1; // multiplies every LOD distance (debug / tuning)
    this._packRR = 0;
    this._forceCull = true;
    this.setQuality(opts.quality ?? 1);
    // cull and pack with the final camera of each frame
    this._hook = (cam) => this._beforeRender(cam);
    game.engine?.beforeRender?.push(this._hook);
  }

  get enabled() { return this._enabled; }
  set enabled(v) {
    this._enabled = !!v;
    this.root.visible = this._enabled;
  }

  _material(def, lod) {
    const pal = [];
    for (let p = 0; p < 4; p++) for (let k = 0; k < 5; k++) pal.push(new Color(def.palettes[p % def.palettes.length][k]));
    // near and mid share one program per species: LOD differences are uniforms
    const defines = { ['SP_' + def.name.toUpperCase()]: '' };
    const spine = def.spine ? def.spine[lod] : 8;
    const m = new ShaderMaterial({
      vertexShader: FLORA_VERT_HEAD + def.vert,
      fragmentShader: FLORA_FRAG_HEAD + def.frag,
      uniforms: Object.assign({}, G, this.shared, {
        uPal: { value: pal },
        uLod: { value: new Vector4(0, 100, 1, 1) },
        uLodCfg: { value: new Vector2(spine, lod === 1 && !def.lod[2] ? 1 : 0) },
      }, def.uniforms ? def.uniforms() : {}),
      defines,
      side: DoubleSide,
    });
    m.alphaToCoverage = !!def.alpha;
    m.name = `flora-${def.name}-${lod}`;
    return m;
  }

  // ---- placement -------------------------------------------------------------------------------

  /**
   * Scatter plants over a patch by biome rules. sample(x, z) returns the ground there:
   * { y, normal: Vector3, slope (0 flat .. 1 vertical), wet 0..1, tidal 0..1 } or null.
   */
  addPatch(opts) {
    const patch = Object.assign({ density: 1, biome: 'meadow', seed: this.seed * 31 + this.patches.length * 977 }, opts);
    if (!patch.center || !patch.radius || !patch.sample) throw new Error('AlienFlora.addPatch: center, radius and sample are required');
    patch.density = (patch.density ?? 1) * this.density;
    this._occ ||= { occ: new Map(), fill: new Map() };
    const counts = scatterPatch(patch, this.known, (name, x, y, z, s, q, seed, hue, pal, aux) => {
      this.byName.get(name).raw.push(x, y, z, s, q.x, q.y, q.z, q.w, seed, hue, pal, aux);
    }, this._occ);
    this.patches.push({ center: patch.center.clone(), radius: patch.radius, biome: patch.biome, counts });
    return counts;
  }

  /**
   * A single (hero) plant. up: growth direction (default world up); seed: any number (deterministic
   * look). opts: { palette 0..3, hue -1..1, yaw, aux } (aux 2..3 freezes the pose: curl / closed).
   */
  place(species, position, up = null, scale = 1, seed = null, opts = {}) {
    const sp = this.byName.get(species);
    if (!sp) { console.warn('[flora] unknown species', species); return; }
    const r = this._r;
    const q = plantQuat(up || new Vector3(0, 1, 0), 1, opts.yaw ?? r() * Math.PI * 2, _q);
    // any number works as a seed: fractions in [0, 1) are used as is, other values are hashed
    let sd = seed ?? r();
    if (!(sd >= 0 && sd < 1)) { const h = Math.sin(sd * 12.9898 + 78.233) * 43758.5453; sd = h - Math.floor(h); }
    sp.raw.push(position.x, position.y, position.z, scale, q.x, q.y, q.z, q.w, sd, opts.hue ?? 0, opts.palette ?? 0, opts.aux ?? r());
  }

  // ---- build -------------------------------------------------------------------------------------

  /**
   * Finalize instancing. May be called again after more patches: plants added since the last build
   * are sorted into new chunks appended to each species' store (the earlier chunks are kept, so a
   * chapter-by-chapter build costs only the new chapter).
   */
  build() {
    const t0 = performance.now();
    const allChunks = [];
    for (const sp of this.species) {
      const n = sp.raw.length / STRIDE;
      const n0 = this.built && sp.pos ? sp.n : 0;
      if (n0 === n && sp.pos) {
        // unchanged since the last build: keep the stores, only reset the culling state
        for (const c of sp.chunks) { c.mask = 0; c.inActive = false; c.off[0] = c.off[1] = c.off[2] = -1; c.used = 0; allChunks.push(c); }
        sp.active = [];
        sp.slot[0].fill(-1);
        sp.slot[1].fill(-1);
        for (const b of sp.bufs) b.iState.array.fill(0);
        sp.dirty = true;
        continue;
      }
      // the new plants (n0..n), sorted by chunk so each chunk is one contiguous range
      const m = n - n0;
      const keys = new Float64Array(m);
      const order = new Uint32Array(m);
      for (let j = 0; j < m; j++) {
        const i = n0 + j;
        const x = sp.raw[i * STRIDE], z = sp.raw[i * STRIDE + 2];
        const rx = Math.floor(x / REGION), rz = Math.floor(z / REGION);
        // dense filler uses smaller chunks: tighter culling and less LOD overlap
        const csz = sp.def.chunk ?? CHUNK;
        const cx = Math.floor(x / csz), cz = Math.floor(z / csz);
        // region-major, then chunk; random order inside a chunk (filler thinning takes a prefix)
        keys[j] = ((rx + 4096) * 8192 + (rz + 4096)) * 1048576 + ((cx + 4096) & 1023) * 1024 + ((cz + 4096) & 1023) + sp.raw[i * STRIDE + 8] * 0.999;
        order[j] = j;
      }
      order.sort((a, b) => keys[a] - keys[b]);
      const grow = (old, len, fillV = 0) => {
        const a = new Float32Array(len);
        if (fillV) a.fill(fillV);
        if (old) a.set(old.subarray(0, Math.min(old.length, len)));
        return a;
      };
      sp.pos = grow(n0 ? sp.pos : null, n * 4);
      sp.quat = grow(n0 ? sp.quat : null, n * 4);
      sp.prm = grow(n0 ? sp.prm : null, n * 4);
      sp.state = grow(n0 ? sp.state : null, n);
      sp.trig = grow(n0 ? sp.trig : null, n, Infinity);
      if (n0) sp.trig.fill(Infinity, n0);
      sp.hold = grow(n0 ? sp.hold : null, n);
      const chunkOf = new Int32Array(n);
      if (n0) chunkOf.set(sp.chunkOf.subarray(0, n0));
      sp.chunkOf = chunkOf;
      // where each plant sits in the near / mid buffers (-1: not packed there)
      sp.slot = [new Int32Array(n).fill(-1), new Int32Array(n).fill(-1)];
      sp.packCam = new Vector3(1e9, 0, 0);
      if (!n0) sp.chunks = [];
      sp.active = [];
      // earlier chunks: fresh culling state (their typed-array views are rebuilt below)
      for (const c of sp.chunks) { c.mask = 0; c.inActive = false; c.off[0] = c.off[1] = c.off[2] = -1; c.used = 0; }
      const firstNew = sp.chunks.length;
      let cur = null, curKey = -1;
      const rad = sp.def.radius;
      const R = sp.raw;
      for (let j = 0; j < m; j++) {
        const k = n0 + j;
        const o = (n0 + order[j]) * STRIDE;
        sp.pos[k * 4] = R[o]; sp.pos[k * 4 + 1] = R[o + 1]; sp.pos[k * 4 + 2] = R[o + 2]; sp.pos[k * 4 + 3] = R[o + 3];
        sp.quat[k * 4] = R[o + 4]; sp.quat[k * 4 + 1] = R[o + 5]; sp.quat[k * 4 + 2] = R[o + 6]; sp.quat[k * 4 + 3] = R[o + 7];
        sp.prm[k * 4] = R[o + 8]; sp.prm[k * 4 + 1] = R[o + 9]; sp.prm[k * 4 + 2] = R[o + 10]; sp.prm[k * 4 + 3] = R[o + 11];
        const key = Math.floor(keys[order[j]] - R[o + 8] * 0.999 + 0.5);
        if (key !== curKey) {
          curKey = key;
          cur = { sp, start: k, count: 0, used: 0, x: 0, y: 0, z: 0, r: 0, mask: 0, inActive: false, off: [-1, -1, -1] };
          sp.chunks.push(cur);
        }
        cur.count++;
        sp.chunkOf[k] = sp.chunks.length - 1;
      }
      sp.n = n;
      // chunk bounding spheres of the new chunks (plants reach up to height * scale)
      for (let ci = firstNew; ci < sp.chunks.length; ci++) {
        const c = sp.chunks[ci];
        let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
        for (let k = c.start; k < c.start + c.count; k++) {
          const x = sp.pos[k * 4], y = sp.pos[k * 4 + 1], z = sp.pos[k * 4 + 2], s = sp.pos[k * 4 + 3];
          x0 = Math.min(x0, x - rad * s); x1 = Math.max(x1, x + rad * s);
          z0 = Math.min(z0, z - rad * s); z1 = Math.max(z1, z + rad * s);
          y0 = Math.min(y0, y); y1 = Math.max(y1, y + sp.def.height * s * 1.2);
        }
        c.x = (x0 + x1) / 2; c.y = (y0 + y1) / 2; c.z = (z0 + z1) / 2;
        c.r = 0.5 * Math.hypot(x1 - x0, y1 - y0, z1 - z0);
        // LOD distance scale of its plants (d / max(1, 0.6 s), as in the shaders)
        let smin = 1e9, smax = 0;
        for (let k = c.start; k < c.start + c.count; k++) { const ls = Math.max(1, sp.pos[k * 4 + 3] * 0.6); smin = Math.min(smin, ls); smax = Math.max(smax, ls); }
        c.lsMin = smin; c.lsMax = smax;
      }
      for (const c of sp.chunks) { this._chunkViews(c); allChunks.push(c); }
      this._buildMeshes(sp);
      // startle lookup grid: add the new plants of the species that react to whales
      if (sp.def.reacts) {
        if (!n0) sp.gridN = 0;
        for (let k = sp.gridN || 0; k < sp.n; k++) {
          const gk = this._gridKey(Math.floor(sp.pos[k * 4] / GRID), Math.floor(sp.pos[k * 4 + 2] / GRID));
          let list = this.grid.get(gk);
          if (!list) this.grid.set(gk, (list = []));
          list.push(sp.id, k);
        }
        sp.gridN = sp.n;
      }
      sp.dirty = true;
    }
    // regions: coarse culling over groups of chunks
    const regionMap = new Map();
    this.regions = [];
    for (const c of allChunks) {
      const key = Math.floor(c.x / REGION) * 100003 + Math.floor(c.z / REGION);
      let reg = regionMap.get(key);
      if (!reg) {
        reg = { chunks: [], x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9, z0: 1e9, z1: -1e9, x: 0, y: 0, z: 0, r: 0, live: false, maxLod: 0 };
        regionMap.set(key, reg);
        this.regions.push(reg);
      }
      reg.chunks.push(c);
      reg.x0 = Math.min(reg.x0, c.x - c.r); reg.x1 = Math.max(reg.x1, c.x + c.r);
      reg.y0 = Math.min(reg.y0, c.y - c.r); reg.y1 = Math.max(reg.y1, c.y + c.r);
      reg.z0 = Math.min(reg.z0, c.z - c.r); reg.z1 = Math.max(reg.z1, c.z + c.r);
      reg.maxLod = Math.max(reg.maxLod, this._maxDist(c.sp) * c.lsMax);
    }
    for (const reg of this.regions) {
      reg.x = (reg.x0 + reg.x1) / 2; reg.y = (reg.y0 + reg.y1) / 2; reg.z = (reg.z0 + reg.z1) / 2;
      reg.r = 0.5 * Math.hypot(reg.x1 - reg.x0, reg.y1 - reg.y0, reg.z1 - reg.z0);
    }
    this.impostor.allocate();
    // startles in flight refer to buffer slots that no longer exist: let them settle from scratch
    for (const sp of this.species) {
      if (!sp.state) continue;
      sp.state.fill(0);
      sp.trig.fill(Infinity);
      sp.hold.fill(0);
    }
    this.startle.list = [];
    this.startle.set = new Set();
    this.built = true;
    this._forceCull = true;
    this.timing.build = performance.now() - t0;
    return this;
  }

  _gridKey(ix, iz) { return (ix + 32768) * 65536 + (iz + 32768); }

  _maxDist(sp) {
    const L = sp.def.lod, Bd = sp.def.band;
    return ((L[2] || L[1]) + (L[2] ? Bd[2] : Bd[1]) * 0.5) * this._distScale + LOD_MARGIN;
  }

  /**
   * Meshes exist from the constructor (with placeholder buffers) so Engine.precompile sees every
   * program and shadow variant even before build(); build() swaps in the real instance buffers.
   */
  _createMeshes(sp) {
    const shadows = this.game.engine?.shadows;
    sp.bufs = [makeBuffers(1), makeBuffers(1)];
    for (let l = 0; l < 2; l++) {
      const b = sp.bufs[l];
      const mesh = new Mesh(instancedGeometry(sp.tpl[l], { iPos: b.iPos, iQuat: b.iQuat, iPrm: b.iPrm, iState: b.iState }), sp.mats[l]);
      mesh.name = `flora-${sp.name}-${l ? 'mid' : 'near'}`;
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.matrixAutoUpdate = false;
      this.root.add(mesh);
      sp.meshes[l] = mesh;
    }
    if (shadows && this.castShadows && sp.def.shadow) {
      // near instances cast with the reduced mid template (soft shadows hide the difference)
      const b = sp.bufs[0];
      const depth = depthVariant(sp.mats[0]);
      depth.name = sp.mats[0].name + '-shadow';
      const proxy = new Mesh(instancedGeometry(sp.tpl[1], { iPos: b.iPos, iQuat: b.iQuat, iPrm: b.iPrm, iState: b.iState }), depth);
      proxy.name = `flora-${sp.name}-shadow`;
      proxy.frustumCulled = false;
      proxy.visible = false;
      proxy.matrixAutoUpdate = false;
      proxy.layers.set(LAYER_SHADOW);
      shadows.addCaster(proxy, depth);
      this.root.add(proxy);
      sp.proxy = proxy;
      shadows.addCaster(sp.meshes[1]);
    }
  }

  /** New instance storage sized for the species (fresh geometries reset three's instance limits). */
  _buildMeshes(sp) {
    sp.bufs = [makeBuffers(sp.n), makeBuffers(sp.n)];
    const swap = (mesh, tpl, b) => {
      if (!mesh) return;
      const old = mesh.geometry;
      mesh.geometry = instancedGeometry(tpl, { iPos: b.iPos, iQuat: b.iQuat, iPrm: b.iPrm, iState: b.iState });
      old.dispose();
      mesh.visible = false;
    };
    swap(sp.meshes[0], sp.tpl[0], sp.bufs[0]);
    swap(sp.meshes[1], sp.tpl[1], sp.bufs[1]);
    swap(sp.proxy, sp.tpl[1], sp.bufs[0]);
  }

  // ---- quality ---------------------------------------------------------------------------------

  /** q 0..1: LOD distances, filler density, shadows. */
  setQuality(q) {
    this.quality = clamp(q, 0, 1);
    this._distScale = (0.55 + 0.45 * this.quality) * (this.lodScale ?? 1);
    this._fill = 0.35 + 0.65 * this.quality;
    const ds = this._distScale;
    for (const sp of this.species) {
      const L = sp.def.lod, Bd = sp.def.band;
      sp.mats[0].uniforms.uLod.value.set(0, L[0] * ds, 0, Bd[0] * ds);
      sp.mats[1].uniforms.uLod.value.set(L[0] * ds, L[1] * ds, Bd[0] * ds, Bd[1] * ds);
      sp.dirty = true;
    }
    this.impostor?.setDistances(ds);
    for (const sp of this.species) for (const c of sp.chunks) this._chunkViews(c);
    this._shadowSmall = this.quality >= 0.4;
    for (const sp of this.species) {
      if (sp.proxy) sp.proxy.userData.qualityOff = !this._shadowSmall && sp.def.radius < 1;
    }
    for (const reg of this.regions) reg.maxLod = 0;
    for (const reg of this.regions) for (const c of reg.chunks) reg.maxLod = Math.max(reg.maxLod, this._maxDist(c.sp) * c.lsMax);
    this._forceCull = true;
  }

  // ---- per frame -------------------------------------------------------------------------------

  /**
   * dt: seconds. disturbers: up to 8 of { pos|position: Vector3, radius|r, vel?: Vector3,
   * strength?: 0..1 } (or Vector4 xyz + w radius). Whales make anemones recoil (and their neighbours
   * after them, one plant after another), fiddleheads coil tight, tubes and bells close, puffballs
   * puff; every plant leans away from a body passing close.
   */
  update(dt, { disturbers = null } = {}) {
    if (!this._enabled || !this.built) return;
    const t0 = performance.now();
    this._setDisturbers(dt, disturbers);
    this._simStartle(dt);
    this.impostor.update?.(dt);
    this._spores(dt);
    this.timing.update = this.timing.update * 0.9 + (performance.now() - t0) * 0.1;
  }

  _setDisturbers(dt, list) {
    const D = this.shared.uDist.value, DV = this.shared.uDistV.value;
    let n = 0;
    if (list) {
      for (let i = 0; i < list.length && n < 8; i++) {
        const d = list[i];
        if (!d) continue;
        const p = d.pos || d.position || d;
        const rad = d.radius ?? d.r ?? (d.isVector4 ? d.w : 6);
        D[n].set(p.x, p.y, p.z, rad);
        const prev = this._prevD[n];
        let vx = 0, vy = 0, vz = 0;
        if (d.vel) { vx = d.vel.x; vy = d.vel.y; vz = d.vel.z; }
        else if (prev.w >= 0 && dt > 0) {
          vx = (p.x - prev.x) / dt; vy = (p.y - prev.y) / dt; vz = (p.z - prev.z) / dt;
          const sp = Math.hypot(vx, vy, vz);
          if (sp > 80) { vx = vy = vz = 0; } // teleports
          const k = 1 - Math.exp(-dt * 6);
          vx = DV[n].x + (vx - DV[n].x) * k; vy = DV[n].y + (vy - DV[n].y) * k; vz = DV[n].z + (vz - DV[n].z) * k;
        }
        DV[n].set(vx, vy, vz, d.strength ?? 1);
        prev.set(p.x, p.y, p.z, 1);
        n++;
      }
    }
    for (let i = n; i < 8; i++) this._prevD[i].w = -1;
    this.shared.uDistN.value = n;
  }

  _simStartle(dt) {
    const now = G.uTime.value;
    const st = this.startle;
    const D = this.shared.uDist.value, DV = this.shared.uDistV.value;
    const nD = this.shared.uDistN.value;
    // trigger: direct contact closes at once, the recoil then travels out through the colony
    for (let d = 0; d < nD; d++) {
      const s = DV[d].w;
      if (s <= 0.05) continue;
      const dx0 = D[d].x, dy0 = D[d].y, dz0 = D[d].z, R = D[d].w;
      const reach = R * 1.25 + 3.5;
      const wave = reach + 13;
      const g0x = Math.floor((dx0 - wave) / GRID), g1x = Math.floor((dx0 + wave) / GRID);
      const g0z = Math.floor((dz0 - wave) / GRID), g1z = Math.floor((dz0 + wave) / GRID);
      for (let gx = g0x; gx <= g1x; gx++) {
        for (let gz = g0z; gz <= g1z; gz++) {
          const list = this.grid.get(this._gridKey(gx, gz));
          if (!list) continue;
          for (let j = 0; j < list.length; j += 2) {
            const sp = this.species[list[j]], i = list[j + 1];
            const ex = sp.pos[i * 4] - dx0, ey = sp.pos[i * 4 + 1] - dy0, ez = sp.pos[i * 4 + 2] - dz0;
            const dist = Math.sqrt(ex * ex + ey * ey + ez * ez);
            if (dist > wave) continue;
            const jitter = sp.prm[i * 4] * 0.35;
            const tt = now + Math.max(0, dist - reach) / 7.5 + jitter * (dist > reach ? 1 : 0.2);
            if (tt < sp.trig[i]) sp.trig[i] = tt;
            const hold = tt + 1.6 + sp.prm[i * 4] * 1.8;
            if (hold > sp.hold[i]) sp.hold[i] = hold;
            const key = sp.id * 16777216 + i;
            if (!st.set.has(key)) { st.set.add(key); st.list.push(sp.id, i); }
          }
        }
      }
    }
    if (!st.list.length) return;
    // integrate: close fast, hold, reopen slowly
    const L = st.list;
    let w = 0;
    for (let j = 0; j < L.length; j += 2) {
      const sp = this.species[L[j]], i = L[j + 1];
      let s = sp.state[i];
      if (now >= sp.trig[i] && now < sp.hold[i]) {
        s += (1 - s) * (1 - Math.exp(-dt * (sp.def.closeRate ?? 6)));
      } else if (now >= sp.hold[i]) {
        s = Math.max(0, s - dt / (sp.def.reopen ?? 5) * (0.6 + 0.8 * sp.prm[i * 4 + 3]));
      }
      sp.state[i] = s;
      this._writeState(sp, i, s);
      if (s <= 0 && now >= sp.hold[i]) {
        sp.trig[i] = Infinity;
        st.set.delete(sp.id * 16777216 + i);
      } else {
        L[w++] = L[j]; L[w++] = L[j + 1];
      }
    }
    L.length = w;
  }

  /**
   * Spore puffs: the puffball shader contracts each ball on a fixed schedule; mirror it here and
   * emit a small cloud of spores from the vent (near plants only), and puff on a startle.
   */
  _spores(dt) {
    const sp = this.byName.get('puffball');
    const mist = this.game.mist;
    const now = G.uTime.value;
    const prev = this._sporeT ?? now;
    this._sporeT = now;
    if (!sp || !sp.n || !mist || this.quality < 0.3 || now <= prev || now - prev > 1) return;
    if (!sp.puffed || sp.puffed.length !== sp.n) sp.puffed = new Uint8Array(sp.n);
    let budget = 6; // puffs per frame at most
    for (const c of sp.active) {
      if (!(c.mask & 1)) continue;
      for (let i = c.start; i < c.start + c.count && budget > 0; i++) {
        const seed = sp.prm[i * 4];
        let startle = false;
        if (sp.state[i] > 0.5 && !sp.puffed[i]) { sp.puffed[i] = 1; startle = true; }
        else if (sp.state[i] < 0.15) sp.puffed[i] = 0;
        for (let k = 0; k < BALLS.length; k++) {
          const per = puffPeriod(seed, k), ph = puffPhase(seed, k);
          if (!startle && Math.floor((prev + ph) / per) === Math.floor((now + ph) / per)) continue;
          this._puff(sp, i, k, startle ? 0.7 : 1);
          budget--;
        }
      }
    }
  }

  _puff(sp, i, k, amount) {
    const b = BALLS[k];
    const S = sp.pos[i * 4 + 3];
    _sq.set(sp.quat[i * 4], sp.quat[i * 4 + 1], sp.quat[i * 4 + 2], sp.quat[i * 4 + 3]);
    _sp.set(b[0], b[3] + b[2] * 0.82 + b[2] * 0.86, b[1]).multiplyScalar(S).applyQuaternion(_sq);
    _sp.x += sp.pos[i * 4]; _sp.y += sp.pos[i * 4 + 1]; _sp.z += sp.pos[i * 4 + 2];
    if (_sp.distanceToSquared(this._camPos) > 70 * 70) return;
    let h = (i * 2654435761 + k * 97 + Math.floor(G.uTime.value * 10)) >>> 0;
    const rnd = () => { h = (Math.imul(h ^ (h >>> 15), 2246822519) + 0x9e3779b9) >>> 0; return h / 4294967296; };
    const n = Math.round(5 * amount + 2);
    const R = b[2] * S;
    for (let j = 0; j < n; j++) {
      _sv.set((rnd() - 0.5) * 0.9, 0.7 + rnd() * 0.9, (rnd() - 0.5) * 0.9).multiplyScalar(0.6 + R * 2);
      this.game.mist.emit({
        pos: _sp, vel: _sv, life: 3 + rnd() * 2.5, size: R * 0.35, sizeEnd: R * (2.2 + rnd() * 1.5),
        color: SPORE, alpha: 0.32 * amount, drag: 1.4, gravity: -0.04, kind: 0, fadeIn: 0.08,
      });
    }
    const night = G.uNight.value;
    if (night > 0.3 && this.game.glow) {
      for (let j = 0; j < 3; j++) {
        _sv.set((rnd() - 0.5) * 0.6, 0.4 + rnd() * 0.6, (rnd() - 0.5) * 0.6);
        this.game.glow.emit({ pos: _sp, vel: _sv, life: 3 + rnd() * 2, size: 0.05 + R * 0.08, sizeEnd: 0.02, color: SPORE_GLOW, alpha: 0.45 * night, drag: 1.0, gravity: -0.03, kind: 1 });
      }
    }
  }

  _writeState(sp, i, s) {
    for (let l = 0; l < 2; l++) {
      const k = sp.slot[l][i];
      if (k < 0) continue;
      sp.bufs[l].iState.array[k] = s;
      sp.bufs[l].stateDirty = true;
    }
  }

  /** Typed-array views of a chunk's instance range (no allocation when packing). */
  _chunkViews(c) {
    const sp = c.sp;
    const n = sp.def.filler && this._fill < 1 ? Math.max(1, Math.ceil(c.count * this._fill)) : c.count;
    const a = c.start, e = c.start + n;
    c.n = n;
    c.vPos = sp.pos.subarray(a * 4, e * 4);
    c.vQuat = sp.quat.subarray(a * 4, e * 4);
    c.vPrm = sp.prm.subarray(a * 4, e * 4);
    c.vState = sp.state.subarray(a, e);
    // the far cards always draw every plant of the chunk
    c.vPosAll = sp.pos.subarray(a * 4, (a + c.count) * 4);
    c.vQuatAll = sp.quat.subarray(a * 4, (a + c.count) * 4);
    c.vPrmAll = sp.prm.subarray(a * 4, (a + c.count) * 4);
    sp.dirty = true;
  }

  _camChanged(cam) {
    const e = cam.matrixWorld.elements, p = cam.projectionMatrix.elements, L = this._lastCamM || (this._lastCamM = new Float64Array(32));
    let changed = false;
    for (let i = 0; i < 16; i++) {
      if (Math.abs(e[i] - L[i]) > 1e-4) { changed = true; L[i] = e[i]; }
      if (Math.abs(p[i] - L[16 + i]) > 1e-6) { changed = true; L[16 + i] = p[i]; }
    }
    return changed;
  }

  _beforeRender(cam) {
    if (!this._enabled || !this.built) return;
    const t0 = performance.now();
    cam.updateMatrixWorld();
    if (this._camChanged(cam) || this._forceCull) {
      this._forceCull = false;
      this._cull(cam);
    }
    // repack at most a few species per frame (the chunk masks carry a margin, so a pack that
    // waits a frame or two never leaves a hole; the shader picks the exact LOD per plant)
    let budget = this.packBudget;
    const n = this.species.length;
    for (let k = 0; k < n && budget > 0; k++) {
      const sp = this.species[(this._packRR + k) % n];
      if (sp.dirty) { this._pack(sp); budget--; }
    }
    this._packRR = (this._packRR + 1) % n;
    for (const sp of this.species) {
      for (let l = 0; l < 2; l++) {
        const b = sp.bufs[l];
        if (b.stateDirty) {
          b.stateDirty = false;
          b.iState.clearUpdateRanges();
          b.iState.addUpdateRange(0, Math.max(1, b.count));
          b.iState.needsUpdate = true;
        }
      }
    }
    if (this.impostor.dirty) this.impostor.pack();
    this.timing.cull = this.timing.cull * 0.9 + (performance.now() - t0) * 0.1;
  }

  _cull(cam) {
    const cp = this._camPos.setFromMatrixPosition(cam.matrixWorld);
    this._pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._pv);
    const inFrustum = this._inFrustum;
    const ds = this._distScale;
    for (const reg of this.regions) {
      const dx = reg.x - cp.x, dy = reg.y - cp.y, dz = reg.z - cp.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const live = d - reg.r < reg.maxLod && (d - reg.r < 40 || inFrustum(reg.x, reg.y, reg.z, reg.r + 8));
      if (!live && !reg.live) continue;
      reg.live = live;
      for (const c of reg.chunks) {
        let mask = 0;
        if (live) {
          const ex = c.x - cp.x, ey = c.y - cp.y, ez = c.z - cp.z;
          const dc = Math.sqrt(ex * ex + ey * ey + ez * ez);
          const dmin = Math.max(0, dc - c.r), dmax = dc + c.r;
          c.dmin = dmin; c.dmax = dmax;
          const def = c.sp.def;
          const L0 = def.lod[0] * ds, L1 = def.lod[1] * ds, L2 = (def.lod[2] || 0) * ds;
          const M = LOD_MARGIN;
          const b0 = def.band[0] * ds * 0.5 + M, b1 = def.band[1] * ds * 0.5 + M, b2 = (def.band[2] || 0) * ds * 0.5 + M;
          // near chunks stay packed off screen too: they cast shadows into view
          const vis = dmin < 30 || inFrustum(c.x, c.y, c.z, c.r + 2 + dc * 0.02);
          if (vis) {
            // conservative in plant size: the biggest plant reaches farthest, the smallest nearest
            const nA = dmin / c.lsMax, fA = dmax / c.lsMin;
            if (nA < L0 + b0) mask |= 1;
            if (fA > L0 - b0 && nA < L1 + b1) mask |= 2;
            if (L2 > 0 && fA > L1 - b1 && nA < L2 + b2) mask |= 4;
          }
        }
        if (mask !== c.mask) {
          if ((mask & 3) !== (c.mask & 3)) c.sp.dirty = true;
          if ((mask & 4) !== (c.mask & 4)) this.impostor.dirty = true;
          if (mask && !c.inActive) { c.inActive = true; c.sp.active.push(c); }
          if (!mask) c.sp.compact = true;
          c.mask = mask;
        }
      }
    }
    // plants are assigned to LODs one by one at pack time (with a margin): repack a species
    // after the camera has travelled half that margin
    for (const sp of this.species) {
      if (!sp.def.filler && sp.active.length && sp.packCam.distanceToSquared(cp) > (LOD_MARGIN * 0.4) ** 2) sp.dirty = true;
    }
    // drop chunks that left every LOD from the active lists
    for (const sp of this.species) {
      if (!sp.compact) continue;
      sp.compact = false;
      let w = 0;
      for (const c of sp.active) {
        if (c.mask) sp.active[w++] = c;
        else {
          c.inActive = false;
          c.off[0] = c.off[1] = c.off[2] = -1;
          c.used = 0;
          for (let i = c.start, e = c.start + c.count; i < e; i++) { sp.slot[0][i] = -1; sp.slot[1][i] = -1; }
          sp.dirty = true;
        }
      }
      sp.active.length = w;
    }
  }

  _pack(sp) {
    sp.dirty = false;
    this.timing.packs++;
    const cp = this._camPos;
    sp.packCam.copy(cp);
    const ds = this._distScale, def = sp.def, m = LOD_MARGIN;
    // a plant goes to near if closer than near0, to mid if between mid0 and mid1 (both in the
    // cross-fade band); the shader then picks the exact weight per plant
    const near0 = def.lod[0] * ds + def.band[0] * ds * 0.5 + m;
    const mid0 = def.lod[0] * ds - def.band[0] * ds * 0.5 - m;
    const mid1 = def.lod[1] * ds + def.band[1] * ds * 0.5 + m;
    const b0 = sp.bufs[0], b1 = sp.bufs[1];
    const s0 = sp.slot[0], s1 = sp.slot[1];
    let o0 = 0, o1 = 0;
    for (const c of sp.active) {
      // clear the old slots of this chunk
      for (let i = c.start, e = c.start + c.count; i < e; i++) { s0[i] = -1; s1[i] = -1; }
      if (!(c.mask & 3)) continue;
      const nA = c.dmin / c.lsMax, fA = c.dmax / c.lsMin;
      if (def.filler) {
        // cheap filler: whole chunks (a little overlap costs less than per-plant tests)
        if (nA < near0) o0 = this._copyChunk(sp, c, b0, o0, s0);
        if (fA > mid0 && nA < mid1) o1 = this._copyChunk(sp, c, b1, o1, s1);
      } else if (fA < mid0 && fA < near0) {
        // whole chunk is near
        o0 = this._copyChunk(sp, c, b0, o0, s0);
      } else if (nA > near0 && nA > mid0 && fA < mid1) {
        o1 = this._copyChunk(sp, c, b1, o1, s1);
      } else {
        const P = sp.pos;
        for (let i = c.start, e = c.start + c.n; i < e; i++) {
          const dx = P[i * 4] - cp.x, dy = P[i * 4 + 1] - cp.y, dz = P[i * 4 + 2] - cp.z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) / Math.max(1, P[i * 4 + 3] * 0.6);
          if (d < near0) { this._copyOne(sp, i, b0, o0); s0[i] = o0++; }
          if (d > mid0 && d < mid1) { this._copyOne(sp, i, b1, o1); s1[i] = o1++; }
        }
      }
    }
    const counts = [o0, o1];
    for (let l = 0; l < 2; l++) {
      const b = sp.bufs[l];
      const o = counts[l];
      b.count = o;
      markRange(b.iPos, o * 4);
      markRange(b.iQuat, o * 4);
      markRange(b.iPrm, o * 4);
      markRange(b.iState, o);
      const mesh = sp.meshes[l];
      mesh.geometry.instanceCount = o;
      mesh.visible = o > 0;
      if (l === 0 && sp.proxy) {
        sp.proxy.geometry.instanceCount = o;
        sp.proxy.visible = o > 0 && !sp.proxy.userData.qualityOff;
      }
    }
  }

  _copyChunk(sp, c, b, o, slots) {
    b.iPos.array.set(c.vPos, o * 4);
    b.iQuat.array.set(c.vQuat, o * 4);
    b.iPrm.array.set(c.vPrm, o * 4);
    b.iState.array.set(c.vState, o);
    for (let i = c.start, e = c.start + c.n; i < e; i++) slots[i] = o++;
    return o;
  }

  _copyOne(sp, i, b, o) {
    const P = b.iPos.array, Q = b.iQuat.array, M = b.iPrm.array;
    const i4 = i * 4, o4 = o * 4;
    P[o4] = sp.pos[i4]; P[o4 + 1] = sp.pos[i4 + 1]; P[o4 + 2] = sp.pos[i4 + 2]; P[o4 + 3] = sp.pos[i4 + 3];
    Q[o4] = sp.quat[i4]; Q[o4 + 1] = sp.quat[i4 + 1]; Q[o4 + 2] = sp.quat[i4 + 2]; Q[o4 + 3] = sp.quat[i4 + 3];
    M[o4] = sp.prm[i4]; M[o4 + 1] = sp.prm[i4 + 1]; M[o4 + 2] = sp.prm[i4 + 2]; M[o4 + 3] = sp.prm[i4 + 3];
    b.iState.array[o] = sp.state[i];
  }

  // ---- debug -------------------------------------------------------------------------------------

  /** Visible instances per species and LOD, estimated triangles (main pass + shadow proxies). */
  stats() {
    const out = { species: {}, tris: 0, shadowTris: 0, calls: 0, instances: 0 };
    for (const sp of this.species) {
      const near = sp.bufs ? sp.bufs[0].count : 0, mid = sp.bufs ? sp.bufs[1].count : 0;
      out.species[sp.name] = { total: sp.n, near, mid, ktris: +((near * sp.tpl[0].tris + mid * sp.tpl[1].tris) / 1000).toFixed(1), tpl: [sp.tpl[0].tris, sp.tpl[1].tris] };
      out.instances += sp.n;
      out.tris += near * sp.tpl[0].tris + mid * sp.tpl[1].tris;
      if (sp.proxy?.visible) out.shadowTris += near * sp.tpl[1].tris;
      if (sp.meshes[1] && sp.def.shadow && this.castShadows) out.shadowTris += mid * sp.tpl[1].tris;
      out.calls += (near ? 1 : 0) + (mid ? 1 : 0) + (sp.proxy?.visible ? 1 : 0) + (mid && sp.def.shadow && this.castShadows ? 1 : 0);
    }
    const far = this.impostor.count;
    out.far = far;
    out.tris += far * 2;
    out.calls += far ? 1 : 0;
    out.cpuMs = { update: +this.timing.update.toFixed(3), cull: +this.timing.cull.toFixed(3), build: +this.timing.build.toFixed(1) };
    return out;
  }

  dispose() {
    const eng = this.game.engine;
    const i = eng?.beforeRender?.indexOf(this._hook) ?? -1;
    if (i >= 0) eng.beforeRender.splice(i, 1);
    const shadows = eng?.shadows;
    for (const sp of this.species) {
      for (const m of sp.meshes) if (m) { shadows?.removeCaster(m); m.geometry.dispose(); }
      if (sp.proxy) { shadows?.removeCaster(sp.proxy); sp.proxy.geometry.dispose(); sp.proxy.material.dispose(); }
      for (const m of sp.mats) m.dispose();
    }
    this.impostor.dispose();
    this.root.parent?.remove(this.root);
    this.built = false;
  }
}

export { FOOTPRINT };
