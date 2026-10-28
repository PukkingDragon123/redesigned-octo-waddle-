// Living alien flora of Vur Sok (see shaders/flora.js for the motion model). Species:
//   fiddlehead  spiral croziers of a giant fern that slowly coil and uncoil (also giant, tree-sized)
//   anemone     a stalked crown of banded tentacles that sway and close up when a whale passes
//   kelp        ribbon plants streaming downwind from cliff rims, rising with the swell underwater
//   tubes       organ-pipe clusters that breathe (a slow swell travelling up each pipe)
//   bells       arching stalks hanging breathing bell flowers
//   fan         glassy fan corals on the shores, iridescent and backlit
//   puffs       spore puffballs on stalks (painted billboards on 3D stalks)
//   tufts       grass, tendril, reed and flower tufts (painted cards) that sway in the wind
//   vines       painted curtains hanging from cliff rims
// Each species is a handful of seeded templates, instanced per island.
import {
  BufferGeometry, Float32BufferAttribute, InstancedMesh, InstancedBufferAttribute, ShaderMaterial,
  DoubleSide, Color, Matrix4, Quaternion, Vector3, Group,
} from 'three';
import { G } from '../render/Globals.js';
import { FLORA_VERT, FLORA_FRAG } from './shaders/flora.js';
import { getFloraAtlas, slotUV, SLOT } from './Painted.js';
import { rng, lerp, clamp, smoothstep, TAU } from '../core/math.js';
import { sampleSurface, thin } from './Spirals.js';

// ---- material ----------------------------------------------------------------------------------
const _mats = new Map();
export function floraMaterial(fadeStart = 260, fadeEnd = 420, inStart = -2, inEnd = -1) {
  const key = fadeStart + ':' + fadeEnd + ':' + inStart + ':' + inEnd;
  if (_mats.has(key)) return _mats.get(key);
  const t0 = performance.now();
  getFloraAtlas();
  if (!_mats.size && typeof window !== 'undefined' && window.__vursokTiming) window.__vursokTiming.atlas = performance.now() - t0;
  const m = new ShaderMaterial({
    vertexShader: FLORA_VERT,
    fragmentShader: FLORA_FRAG,
    uniforms: Object.assign({}, G, {
      uAtlas: { value: getFloraAtlas() },
      uFade: { value: [fadeStart, fadeEnd] },
      uFadeIn: { value: [inStart, inEnd] },
    }),
    vertexColors: true,
    side: DoubleSide,
  });
  m.alphaToCoverage = true;
  _mats.set(key, m);
  return m;
}

// ---- geometry builder --------------------------------------------------------------------------
const C = (h) => new Color(h);

export class FloraGeo {
  constructor() {
    this.pos = []; this.v = []; this.a = []; this.b = []; this.uv = []; this.p = []; this.col = []; this.acc = []; this.idx = [];
  }
  get count() { return this.pos.length / 3; }
  vert(ch, s, ox, oy, oz, u, v, part, flex, col, acc) {
    // rest-pose position (for bounds only): a straight chain
    const dx = Math.cos(ch.az), dz = Math.sin(ch.az);
    const st = Math.sin(ch.tilt), ct = Math.cos(ch.tilt);
    const along = s * ch.L;
    this.pos.push(ch.base[0] + dx * st * along + ox, ch.base[1] + ct * along + oy, ch.base[2] + dz * st * along + oz);
    this.v.push(s, ox, oy, oz);
    this.a.push(ch.base[0], ch.base[1], ch.base[2], ch.L);
    this.b.push(ch.az, ch.tilt, ch.curl, ch.kind);
    this.uv.push(u, v);
    this.p.push(part, flex);
    this.col.push(col.r, col.g, col.b);
    this.acc.push(acc.r, acc.g, acc.b);
    return this.count - 1;
  }
  /** Tapered tube along a chain. o: { segs, sides, r(s), s0, s1, col, acc, flex, warp } */
  tube(ch, o) {
    const segs = o.segs ?? 8, sides = o.sides ?? 6;
    const s0 = o.s0 ?? 0, s1 = o.s1 ?? 1;
    const base = this.count;
    for (let i = 0; i <= segs; i++) {
      let f = i / segs;
      if (o.warp) f = 1 - Math.pow(1 - f, o.warp);
      const s = lerp(s0, s1, f);
      const r = o.r(s);
      const col = typeof o.col === 'function' ? o.col(s) : o.col;
      const c = o.center ? o.center(s) : null;
      for (let j = 0; j < sides; j++) {
        const a = (j / sides) * TAU;
        this.vert(ch, s, Math.cos(a) * r + (c ? c[0] : 0), Math.sin(a) * r + (c ? c[1] : 0), 0, j / sides, s, 0, o.flex ?? 1, col, o.acc);
      }
    }
    for (let i = 0; i < segs; i++) {
      for (let j = 0; j < sides; j++) {
        const a = base + i * sides + j, b = base + i * sides + ((j + 1) % sides);
        const c = a + sides, d = b + sides;
        this.idx.push(a, c, b, b, c, d);
      }
    }
  }
  /** Flat painted strip along a chain (spans the binormal). o: { segs, w(s), s0, s1, slot, col, acc, flex, warp } */
  card(ch, o) {
    const segs = o.segs ?? 6;
    const s0 = o.s0 ?? 0, s1 = o.s1 ?? 1;
    const [u0, v0, u1, v1] = slotUV(o.slot);
    const base = this.count;
    for (let i = 0; i <= segs; i++) {
      let f = i / segs;
      if (o.warp) f = 1 - Math.pow(1 - f, o.warp);
      const s = lerp(s0, s1, f);
      const w = o.w(s) * 0.5;
      const v = lerp(v0, v1, f);
      this.vert(ch, s, -w, o.lift ?? 0, 0, u0, v, 1, o.flex ?? 1, o.col, o.acc);
      this.vert(ch, s, w, o.lift ?? 0, 0, u1, v, 1, o.flex ?? 1, o.col, o.acc);
    }
    for (let i = 0; i < segs; i++) {
      const a = base + i * 2;
      this.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  /** Camera-facing painted billboard at chain position s. */
  bill(ch, o) {
    const [u0, v0, u1, v1] = slotUV(o.slot);
    const h = o.size * 0.5;
    const base = this.count;
    this.vert(ch, o.s ?? 1, -h, -h, 0, u0, v0, 2, o.flex ?? 1, o.col, o.acc);
    this.vert(ch, o.s ?? 1, h, -h, 0, u1, v0, 2, o.flex ?? 1, o.col, o.acc);
    this.vert(ch, o.s ?? 1, -h, h, 0, u0, v1, 2, o.flex ?? 1, o.col, o.acc);
    this.vert(ch, o.s ?? 1, h, h, 0, u1, v1, 2, o.flex ?? 1, o.col, o.acc);
    this.idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  /** A breathing bell (lathe along the chain tangent) hanging at the chain tip. */
  bell(ch, o) {
    const segs = o.segs ?? 7, sides = o.sides ?? 10;
    const base = this.count;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const r = o.R * Math.pow(Math.sin(Math.min(1, t * 1.1) * Math.PI * 0.5), 0.7) * (1 + 0.35 * Math.pow(t, 4));
      const oz = t * o.len;
      for (let j = 0; j < sides; j++) {
        const a = (j / sides) * TAU;
        const lobe = 1 + 0.12 * Math.cos(a * 5) * t * t;
        this.vert(ch, 1, Math.cos(a) * r * lobe, Math.sin(a) * r * lobe, oz, j / sides, t, 3, o.flex ?? 1, o.col, o.acc);
      }
    }
    for (let i = 0; i < segs; i++) {
      for (let j = 0; j < sides; j++) {
        const a = base + i * sides + j, b = base + i * sides + ((j + 1) % sides);
        const c = a + sides, d = b + sides;
        this.idx.push(a, c, b, b, c, d);
      }
    }
  }
  build() {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aV', new Float32BufferAttribute(this.v, 4));
    g.setAttribute('aA', new Float32BufferAttribute(this.a, 4));
    g.setAttribute('aB', new Float32BufferAttribute(this.b, 4));
    g.setAttribute('aUV', new Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aP', new Float32BufferAttribute(this.p, 2));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.setAttribute('aAcc', new Float32BufferAttribute(this.acc, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    // bending can reach further than the rest pose
    g.boundingSphere.radius *= 1.6;
    return g;
  }
}

// ---- palettes (linear albedo; accents are tips, veins, bands) -------------------------------------
export const FLORA_PAL = {
  fern: { stem: C('#3d5a2e'), leaf: C('#5f8a3c'), acc: C('#c9a35a') },
  fernTeal: { stem: C('#2f5248'), leaf: C('#3f7f6c'), acc: C('#9fd4b0') },
  fernRose: { stem: C('#4a3a33'), leaf: C('#7a5a3c'), acc: C('#e09a7a') },
  anemone: { stem: C('#6a4e5c'), leaf: C('#b4637a'), acc: C('#f2d1a8') },
  anemoneTeal: { stem: C('#3d5f63'), leaf: C('#3f9a94'), acc: C('#e8f4c8') },
  anemoneViolet: { stem: C('#4b4060'), leaf: C('#7d5fb0'), acc: C('#ffd27a') },
  kelp: { stem: C('#4f4a26'), leaf: C('#7e7a2f'), acc: C('#c7c070') },
  kelpRed: { stem: C('#4a2a22'), leaf: C('#8f3f2c'), acc: C('#e0905c') },
  tubes: { stem: C('#9a5a3e'), leaf: C('#c7774e'), acc: C('#f1d9b5') },
  tubesTeal: { stem: C('#2f6a6e'), leaf: C('#3b8e8a'), acc: C('#d4f2e4') },
  bells: { stem: C('#3f5a35'), leaf: C('#9a6fb8'), acc: C('#f6e4ff') },
  fan: { stem: C('#6a5f7a'), leaf: C('#7f9cb8'), acc: C('#d8e8f4') },
  fanCoral: { stem: C('#7a5050'), leaf: C('#c98a84'), acc: C('#f0d8c8') },
  puff: { stem: C('#6b6a4a'), leaf: C('#d9cfa8'), acc: C('#f1b36a') },
  puffBlue: { stem: C('#4a5a6a'), leaf: C('#a9c4d9'), acc: C('#f7f2c4') },
  grass: { stem: C('#3f6633'), leaf: C('#6f9a46'), acc: C('#d4c46a') },
  grassGold: { stem: C('#7a6a36'), leaf: C('#b3994a'), acc: C('#f0d58a') },
  grassTeal: { stem: C('#2f5a4c'), leaf: C('#4f8c74'), acc: C('#c0e0a0') },
  flowers: { stem: C('#3f6633'), leaf: C('#6f9a46'), acc: C('#c58ad6') },
  vine: { stem: C('#33502b'), leaf: C('#55803d'), acc: C('#b8d47a') },
  moss: { stem: C('#3a5530'), leaf: C('#5b7d3b'), acc: C('#a9b85a') },
};
for (const p of Object.values(FLORA_PAL)) for (const k of ['stem', 'leaf', 'acc']) p[k].multiplyScalar(k === 'acc' ? 0.85 : 0.75);

// ---- species templates (plant-local, base at the origin) --------------------------------------
export const SPECIES = {
  fiddlehead(seed, size, pal = FLORA_PAL.fern) {
    const r = rng(seed);
    const g = new FloraGeo();
    const n = 3 + Math.floor(r() * 5);
    for (let k = 0; k < n; k++) {
      const az = (k / n) * TAU + r() * 0.8;
      const open = r() < 0.35;
      const L = size * lerp(0.6, 1.0, r());
      const ch = { base: [Math.cos(az) * size * 0.04, 0, Math.sin(az) * size * 0.04], L, az, tilt: lerp(0.12, 0.45, r()) + (open ? 0.35 : 0), curl: open ? lerp(0.25, 0.45, r()) : lerp(0.85, 1.25, r()), kind: 1 };
      g.tube(ch, { segs: 18, sides: 6, warp: 1.7, r: (s) => L * lerp(0.03, 0.007, Math.pow(s, 0.8)), col: pal.stem, acc: pal.acc, flex: 0.6 });
      g.card(ch, { segs: 16, warp: 1.7, s0: 0.22, s1: 1, slot: r() < 0.5 ? SLOT.frond : SLOT.pinnaeB, w: (s) => L * 0.36 * Math.pow(Math.sin(Math.PI * clamp((s - 0.2) / 0.82, 0, 1)), 0.7), col: pal.leaf, acc: pal.acc, flex: 0.6 });
    }
    return { geo: g.build(), height: size * 0.9, radius: size * 0.6, shadow: true };
  },
  anemone(seed, size, pal = FLORA_PAL.anemone) {
    const r = rng(seed);
    const g = new FloraGeo();
    const stalkL = size * lerp(0.18, 0.32, r());
    const stalk = { base: [0, 0, 0], L: stalkL, az: r() * TAU, tilt: lerp(0, 0.2, r()), curl: 0.1, kind: 0 };
    // a fleshy column: flared foot, waisted middle, swollen oral disc
    g.tube(stalk, { segs: 6, sides: 12, r: (s) => size * (0.17 - 0.06 * Math.sin(Math.PI * s) + 0.05 * Math.pow(s, 4) + 0.06 * Math.pow(1 - s, 6)), col: pal.stem, acc: pal.acc, flex: 0.2 });
    const top = [Math.cos(stalk.az) * Math.sin(stalk.tilt) * stalkL, Math.cos(stalk.tilt) * stalkL, Math.sin(stalk.az) * Math.sin(stalk.tilt) * stalkL];
    const n = 20 + Math.floor(r() * 8);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + r() * 0.2;
      const ring = size * (k % 3 === 0 ? 0.08 : k % 3 === 1 ? 0.13 : 0.18);
      const L = size * lerp(0.5, 0.95, r()) * (k % 3 === 0 ? 0.7 : 1);
      const ch = { base: [top[0] + Math.cos(a) * ring, top[1], top[2] + Math.sin(a) * ring], L, az: a, tilt: lerp(0.35, 0.95, r()), curl: lerp(0.8, 1.6, r()), kind: 2 };
      g.tube(ch, { segs: 6, sides: 4, r: (s) => size * (s > 0.85 ? lerp(0.022, 0.034, (s - 0.85) / 0.15) : lerp(0.028, 0.015, s)), col: pal.leaf, acc: pal.acc, flex: 1 });
    }
    return { geo: g.build(), height: size, radius: size * 0.7, shadow: false };
  },
  kelp(seed, size, pal = FLORA_PAL.kelp) {
    const r = rng(seed);
    const g = new FloraGeo();
    const n = 3 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) {
      const az = r() * TAU;
      const L = size * lerp(0.6, 1.1, r());
      const ch = { base: [(r() - 0.5) * size * 0.08, 0, (r() - 0.5) * size * 0.08], L, az, tilt: lerp(0.1, 0.4, r()), curl: 0.2, kind: 3 };
      g.card(ch, { segs: 16, slot: r() < 0.5 ? SLOT.kelp : SLOT.kelpB, w: (s) => size * lerp(0.07, 0.13, r()) * (0.5 + 0.5 * Math.sin(Math.PI * Math.min(1, s * 1.05 + 0.1))), col: pal.leaf, acc: pal.acc, flex: 1 });
    }
    return { geo: g.build(), height: size * 0.6, radius: size, shadow: false };
  },
  tubes(seed, size, pal = FLORA_PAL.tubes) {
    const r = rng(seed);
    const g = new FloraGeo();
    const n = 5 + Math.floor(r() * 7);
    for (let k = 0; k < n; k++) {
      const a = r() * TAU, d = Math.sqrt(r()) * size * 0.3;
      const L = size * lerp(0.35, 1.0, r());
      const R0 = size * lerp(0.05, 0.1, r());
      const ch = { base: [Math.cos(a) * d, 0, Math.sin(a) * d], L, az: a, tilt: lerp(0.0, 0.3, r()), curl: lerp(-0.2, 0.25, r()), kind: 4 };
      g.tube(ch, { segs: 9, sides: 10, r: (s) => R0 * (1 + 0.35 * Math.pow(s, 3)) * (s > 0.97 ? 1.08 : 1), col: pal.leaf, acc: pal.acc, flex: 0.3 });
    }
    return { geo: g.build(), height: size, radius: size * 0.45, shadow: true };
  },
  bells(seed, size, pal = FLORA_PAL.bells) {
    const r = rng(seed);
    const g = new FloraGeo();
    const n = 2 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) {
      const az = r() * TAU;
      const L = size * lerp(0.7, 1.0, r());
      const ch = { base: [(r() - 0.5) * size * 0.1, 0, (r() - 0.5) * size * 0.1], L, az, tilt: lerp(0.1, 0.3, r()), curl: lerp(1.6, 2.4, r()), kind: 4 };
      g.tube(ch, { segs: 12, sides: 5, r: (s) => size * lerp(0.025, 0.012, s), col: pal.stem, acc: pal.acc, flex: 0.7 });
      g.bell(ch, { R: size * lerp(0.1, 0.16, r()), len: size * lerp(0.16, 0.24, r()), col: pal.leaf, acc: pal.acc, flex: 0.7 });
    }
    return { geo: g.build(), height: size, radius: size * 0.6, shadow: true };
  },
  fan(seed, size, pal = FLORA_PAL.fan) {
    const r = rng(seed);
    const g = new FloraGeo();
    const n = 1 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) {
      const az = r() * TAU;
      const L = size * lerp(0.7, 1.0, r());
      const ch = { base: [(r() - 0.5) * size * 0.3, 0, (r() - 0.5) * size * 0.3], L, az, tilt: lerp(0, 0.25, r()), curl: lerp(-0.2, 0.2, r()), kind: 5 };
      g.card(ch, { segs: 3, slot: r() < 0.5 ? SLOT.fan : SLOT.fanB, w: () => L * 1.15, col: pal.leaf, acc: pal.acc, flex: 0.3 });
    }
    return { geo: g.build(), height: size, radius: size * 0.6, shadow: false };
  },
  puffs(seed, size, pal = FLORA_PAL.puff) {
    const r = rng(seed);
    const g = new FloraGeo();
    const n = 3 + Math.floor(r() * 6);
    for (let k = 0; k < n; k++) {
      const a = r() * TAU, d = Math.sqrt(r()) * size * 0.4;
      const L = size * lerp(0.35, 1.0, r());
      const ch = { base: [Math.cos(a) * d, 0, Math.sin(a) * d], L, az: a, tilt: lerp(0.05, 0.35, r()), curl: lerp(-0.4, 0.4, r()), kind: 6 };
      g.tube(ch, { segs: 5, sides: 5, r: (s) => size * lerp(0.03, 0.018, s), col: pal.stem, acc: pal.acc, flex: 0.8 });
      g.bill(ch, { s: 1, size: size * lerp(0.28, 0.5, r()) * (L / size + 0.3), slot: SLOT.puff, col: pal.leaf, acc: pal.acc, flex: 0.8 });
    }
    return { geo: g.build(), height: size, radius: size * 0.5, shadow: false };
  },
  tuft(seed, size, pal = FLORA_PAL.grass, slot = SLOT.grassA) {
    const r = rng(seed);
    const g = new FloraGeo();
    for (let k = 0; k < 3; k++) {
      const az = (k / 3) * TAU + r() * 0.6;
      const ch = { base: [0, 0, 0], L: size * lerp(0.8, 1.1, r()), az, tilt: lerp(0.05, 0.3, r()), curl: lerp(0.05, 0.35, r()), kind: 7 };
      g.card(ch, { segs: 3, slot, w: () => size * 1.1, col: pal.leaf, acc: pal.acc, flex: 1 });
    }
    return { geo: g.build(), height: size, radius: size * 0.6, shadow: false };
  },
  vines(seed, length, pal = FLORA_PAL.vine) {
    const r = rng(seed);
    const g = new FloraGeo();
    const n = 2 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) {
      const off = (k - (n - 1) / 2) * 1.6;
      const L = length * lerp(0.55, 1.0, r());
      const ch = { base: [off, 0, (r() - 0.5) * 0.4], L, az: Math.PI / 2, tilt: Math.PI - 0.08, curl: 0, kind: 8 };
      g.card(ch, { segs: 8, slot: SLOT.vine, w: (s) => lerp(2.2, 1.2, s), col: pal.leaf, acc: pal.acc, flex: 1 });
    }
    return { geo: g.build(), height: length, radius: length * 0.5, shadow: false };
  },
  moss(seed, size, pal = FLORA_PAL.moss) {
    const r = rng(seed);
    const g = new FloraGeo();
    const n = 3 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) {
      const a = r() * TAU, d = Math.sqrt(r()) * size * 0.45;
      const ch = { base: [Math.cos(a) * d, 0, Math.sin(a) * d], L: size * lerp(0.15, 0.35, r()), az: a, tilt: 0.3, curl: 0, kind: 0 };
      g.bill(ch, { s: 1, size: size * lerp(0.45, 0.8, r()), slot: r() < 0.5 ? SLOT.moss : SLOT.shrub, col: pal.leaf, acc: pal.acc, flex: 0.2 });
    }
    return { geo: g.build(), height: size * 0.6, radius: size * 0.6, shadow: false };
  },
};

// ---- instancing ---------------------------------------------------------------------------------
const _templates = new Map();
function template(key, make) {
  if (!_templates.has(key)) _templates.set(key, make());
  return _templates.get(key);
}

const _m = new Matrix4(), _q = new Quaternion(), _s = new Vector3(), _up = new Vector3(0, 1, 0), _n = new Vector3();

/** One island's (or one region's) flora: template key -> instances. */
export class FloraSet {
  constructor(name = 'flora') {
    this.items = new Map();
    this.group = new Group();
    this.group.name = name;
  }
  add(key, make, pos, scale = 1, rotY = 0, inst = [0, 0, 1, 1], normal = null, lean = 0) {
    template(key, make);
    if (!this.items.has(key)) this.items.set(key, []);
    _q.setFromAxisAngle(_up, rotY);
    if (normal && lean > 0) {
      // lean the plant partly into the surface normal (cliff dwellers grow outward)
      _n.copy(_up).lerp(normal, lean).normalize();
      const qa = new Quaternion().setFromUnitVectors(_up, _n);
      _q.premultiply(qa);
    }
    _m.compose(pos, _q, _s.set(scale, scale, scale));
    this.items.get(key).push({ m: _m.clone(), inst });
  }
  build(shadows = null, fade = null) {
    for (const [key, list] of this.items) {
      const t = _templates.get(key);
      // share the template's vertex buffers; only the per-instance data is this set's own
      const geo = new BufferGeometry();
      for (const name in t.geo.attributes) geo.setAttribute(name, t.geo.attributes[name]);
      geo.setIndex(t.geo.index);
      geo.boundingSphere = t.geo.boundingSphere.clone();
      const ia = new Float32Array(list.length * 4);
      for (let i = 0; i < list.length; i++) ia.set(list[i].inst, i * 4);
      geo.setAttribute('aInst', new InstancedBufferAttribute(ia, 4));
      const mesh = new InstancedMesh(geo, floraMaterial(...(fade || t.fade || [260, 420])), list.length);
      for (let i = 0; i < list.length; i++) mesh.setMatrixAt(i, list[i].m);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      if (mesh.boundingSphere) mesh.boundingSphere.radius += t.radius * 2;
      mesh.name = 'flora-' + key;
      this.group.add(mesh);
      if (shadows && t.shadow) shadows.addCaster(mesh);
    }
    this.items.clear();
    return this.group;
  }
  get count() { let n = 0; for (const l of this.items.values()) n += l.length; return n; }
}

// ---- biomes and scattering ----------------------------------------------------------------------
/**
 * Biome densities (plants per 1000 m2 of suitable surface) and palettes per chapter mood.
 */
export const BIOMES = {
  reach: { fern: 1.1, puffs: 0.5, tufts: 9, flowers: 2, tubes: 0.6, bells: 0.25, kelpRim: 0.5, shore: 1.0, moss: 1.2, pal: ['fern', 'fernTeal'], tuft: ['grass', 'grassTeal'] },
  lagoon: { fern: 0.8, puffs: 0.8, tufts: 9, flowers: 3, tubes: 0.5, bells: 0.3, kelpRim: 0.3, shore: 1.4, moss: 1.0, pal: ['fern', 'fernRose'], tuft: ['grass', 'grassGold'] },
  forest: { fern: 2.2, puffs: 0.6, tufts: 8, flowers: 1, tubes: 1.0, bells: 0.8, kelpRim: 0.6, shore: 0.8, moss: 2.2, pal: ['fernTeal', 'fern'], tuft: ['grassTeal', 'grass'] },
  shoals: { fern: 0.5, puffs: 0.4, tufts: 6, flowers: 1, tubes: 0.4, bells: 0.1, kelpRim: 0.8, shore: 1.2, moss: 0.8, pal: ['fern'], tuft: ['grass'] },
  golden: { fern: 0.6, puffs: 0.6, tufts: 11, flowers: 3, tubes: 0.5, bells: 0.2, kelpRim: 0.5, shore: 1.0, moss: 1.0, pal: ['fernRose', 'fern'], tuft: ['grassGold', 'grass'] },
  night: { fern: 0.8, puffs: 0.6, tufts: 7, flowers: 1, tubes: 1.2, bells: 0.6, kelpRim: 0.4, shore: 1.6, moss: 1.0, pal: ['fernTeal'], tuft: ['grassTeal'] },
  storm: { fern: 0.3, puffs: 0.1, tufts: 6, flowers: 0, tubes: 0.3, bells: 0, kelpRim: 1.4, shore: 1.0, moss: 1.4, pal: ['fernTeal'], tuft: ['grassTeal'] },
  oasis: { fern: 1.4, puffs: 1.0, tufts: 10, flowers: 4, tubes: 0.8, bells: 0.7, kelpRim: 0.5, shore: 1.8, moss: 1.4, pal: ['fern', 'fernRose', 'fernTeal'], tuft: ['grass', 'grassGold', 'grassTeal'] },
  volcanic: { fern: 0.15, puffs: 0.2, tufts: 2, flowers: 0, tubes: 0.4, bells: 0, kelpRim: 0.3, shore: 0.6, moss: 0.8, pal: ['fernTeal'], tuft: ['grassTeal'] },
};

const inst = (r, open = 1) => [r() * TAU, r() < 0.25 ? r() : 0, lerp(0.85, 1.1, r()), open];

/**
 * Every plant variant (geometry x palette) a set uses is one draw call, so a set keeps a seeded few
 * of each plant's variants; the variety comes from island to island and reef to reef.
 * pick(name, i) maps a full-range choice i onto the kept ones (the main random stream is unchanged).
 */
export function variants(seed, spec) {
  const r = rng(seed * 7 + 3);
  const kept = {};
  for (const name in spec) {
    const [options, keep] = spec[name];
    const list = options.slice();
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = list[i]; list[i] = list[j]; list[j] = t; }
    list.length = Math.max(1, Math.min(keep, list.length));
    kept[name] = list;
  }
  return (name, i) => kept[name][i % kept[name].length];
}

/**
 * Populate an island's surface with flora. geo: the island's LOD0 geometry (local coordinates,
 * y = world height). Returns a FloraSet whose group is positioned at the island.
 */
export function populateIsland(geo, biome, seed, opts = {}) {
  const r = rng(seed * 31 + 7);
  const B = BIOMES[biome] || BIOMES.reach;
  const set = new FloraSet('flora-island');
  const S = opts.index || new SurfaceIndex(geo);
  const dens = opts.density ?? 1;
  const V = variants(seed, {
    fern: [[0, 1, 2, 3], 2], fernPal: [B.pal, 2], puff: [[0, 1, 2], 2], puffPal: [['puff', 'puffBlue'], 1], moss: [[0, 1, 2], 2],
    tuftPal: [B.tuft, 1], tubes: [[0, 1, 2], 2], tubesPal: [['tubes', 'tubesTeal'], 1], bells: [[0, 1, 2], 2],
    anem: [[0, 1, 2], 2], anemPal: [['anemone', 'anemoneTeal', 'anemoneViolet'], 1], fan: [[0, 1], 1], fanPal: [['fan', 'fanCoral'], 2],
  });
  // meadow (gentle grassy surfaces above the spray)
  const meadow = (ny, y, gr) => (gr > 0.45 && ny > 0.72 && y > 4 ? gr : 0);
  const k = S.weights(meadow) / 1000 * dens;
  const grid = new Map();
  // fiddlehead groves (clustered)
  const ferns = thin(S.sample(Math.round(B.fern * k * 1.6), r), 6, grid).slice(0, Math.round(B.fern * k));
  for (const sm of ferns) {
    const n = 1 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      const sz = lerp(1.6, 5.5, Math.pow(r(), 1.5));
      const v = V('fern', Math.floor(r() * 4));
      const pk = V('fernPal', Math.floor(r() * B.pal.length));
      const p = sm.p.clone().add(new Vector3((r() - 0.5) * 7, -0.15, (r() - 0.5) * 7));
      set.add(`fern-${v}-${pk}`, () => SPECIES.fiddlehead(1000 + v, 4, FLORA_PAL[pk]), p, sz / 4, r() * TAU, inst(r));
    }
  }
  for (const sm of S.sample(Math.round(B.puffs * k), r)) {
    const v = V('puff', Math.floor(r() * 3)), pk = V('puffPal', r() < 0.5 ? 0 : 1);
    set.add(`puffs-${v}-${pk}`, () => SPECIES.puffs(2000 + v, 2, FLORA_PAL[pk]), sm.p.clone().setY(sm.p.y - 0.1), lerp(0.6, 1.6, r()), r() * TAU, inst(r));
  }
  for (const sm of S.sample(Math.round(B.moss * k), r)) {
    const v = V('moss', Math.floor(r() * 3));
    set.add(`moss-${v}`, () => SPECIES.moss(3000 + v, 2.4, FLORA_PAL.moss), sm.p.clone().setY(sm.p.y - 0.3), lerp(0.7, 1.8, r()), r() * TAU, inst(r));
  }
  // tufts: grass, tendrils, flowers, reeds
  for (const sm of S.sample(Math.round(B.tufts * k), r)) {
    const pick = r();
    const slot = pick < 0.45 ? SLOT.grassA : pick < 0.7 ? SLOT.grassB : pick < 0.85 ? SLOT.tendril : SLOT.reed;
    const tk = V('tuftPal', Math.floor(r() * B.tuft.length));
    set.add(`tuft-${slot}-${tk}`, () => SPECIES.tuft(4000 + slot, 1, FLORA_PAL[tk], slot), sm.p.clone().setY(sm.p.y - 0.05), lerp(0.7, 1.6, r()), r() * TAU, inst(r));
  }
  for (const sm of S.sample(Math.round(B.flowers * k), r)) {
    set.add('tuft-flowers', () => SPECIES.tuft(4100, 1, FLORA_PAL.flowers, SLOT.flowers), sm.p.clone().setY(sm.p.y - 0.05), lerp(0.6, 1.1, r()), r() * TAU, inst(r));
  }
  // cliff dwellers: tube and bell clusters growing out of ledges and crevices
  const cArea = S.weights((ny, y) => (ny > 0.25 && ny < 0.75 && y > 6 ? 1 : 0)) / 1000 * dens;
  for (const sm of S.sample(Math.round(B.tubes * cArea), r)) {
    const v = V('tubes', Math.floor(r() * 3)), pk = V('tubesPal', r() < 0.6 ? 0 : 1);
    set.add(`tubes-${v}-${pk}`, () => SPECIES.tubes(5000 + v, 2.5, FLORA_PAL[pk]), sm.p.clone().addScaledVector(sm.n, -0.3), lerp(0.6, 1.5, r()), r() * TAU, inst(r), sm.n, 0.6);
  }
  S.weights((ny, y, gr) => (ny > 0.25 && ny < 0.75 && y > 6 ? 1 : 0) + meadow(ny, y, gr) * 0.5);
  for (const sm of S.sample(Math.round(B.bells * (cArea + k)), r)) {
    const v = V('bells', Math.floor(r() * 3));
    set.add(`bells-${v}`, () => SPECIES.bells(6000 + v, 3, FLORA_PAL.bells), sm.p.clone().addScaledVector(sm.n, -0.2), lerp(0.8, 1.8, r()), r() * TAU, inst(r), sm.n, 0.4);
  }
  // shore: anemones and glass fans in the intertidal zone and on the drowned skirt (not where the
  // beach sand has buried the skirt)
  const sArea = S.weights((ny, y) => (y > -7 && y < 2.5 && ny > 0.2 ? 1 : 0)) / 1000 * dens;
  const o = opts.origin;
  for (const sm of S.sample(Math.round(B.shore * sArea * 2.5), r)) {
    if (opts.seabedAt && o && opts.seabedAt(sm.p.x + o.x, sm.p.z + o.z) > sm.p.y - 0.25) continue;
    if (r() < 0.6) {
      const v = V('anem', Math.floor(r() * 3)), pk = V('anemPal', Math.floor(r() * 3));
      set.add(`anem-${v}-${pk}`, () => SPECIES.anemone(7000 + v, 1.5, FLORA_PAL[pk]), sm.p.clone().addScaledVector(sm.n, -0.1), lerp(0.5, 1.6, r()), r() * TAU, inst(r), sm.n, 0.5);
    } else {
      const v = V('fan', Math.floor(r() * 2)), pk = V('fanPal', r() < 0.5 ? 0 : 1);
      set.add(`fan-${v}-${pk}`, () => SPECIES.fan(8000 + v, 2, FLORA_PAL[pk]), sm.p.clone().addScaledVector(sm.n, -0.1), lerp(0.6, 1.8, r()), r() * TAU, inst(r), sm.n, 0.3);
    }
  }
  set.index = S;
  return set;
}


/** Rim dwellers: kelp ribbons streaming from cliff edges and vine curtains hanging below them. */
export function populateRims(set, rims, biome, seed) {
  const r = rng(seed * 17 + 3);
  const B = BIOMES[biome] || BIOMES.reach;
  const V = variants(seed + 11, { kelp: [[0, 1, 2], 2], kelpPal: [['kelp', 'kelpRed'], 1], vines: [[0, 1, 2], 2] });
  for (const q of rims) {
    if (q.y < 8) continue;
    const pick = r();
    if (pick < 0.08 * B.kelpRim) {
      const v = V('kelp', Math.floor(r() * 3)), pk = V('kelpPal', r() < 0.6 ? 0 : 1);
      set.add(`kelp-${v}-${pk}`, () => SPECIES.kelp(9000 + v, 8, FLORA_PAL[pk]), new Vector3(q.x, q.y - 0.5, q.z), lerp(0.6, 1.5, r()), r() * TAU, inst(r));
    } else if (pick < 0.08 * B.kelpRim + 0.12) {
      const v = V('vines', Math.floor(r() * 3));
      const len = lerp(6, Math.min(26, q.y * 0.6), r());
      set.add(`vines-${v}`, () => SPECIES.vines(9100 + v, 10, FLORA_PAL.vine), new Vector3(q.x + (q.ox || 0) * 0.6, q.y - 0.3, q.z + (q.oz || 0) * 0.6), len / 10, Math.atan2(-(q.oz || 0), q.ox || 1) + Math.PI / 2, inst(r));
    }
  }
}

/** Reef and beach flora from the seabed (world coordinates; set group stays at the origin). */
export function populateSeabed(set, seabed, feature, biome, seed, count) {
  const r = rng(seed * 13 + 5);
  const B = BIOMES[biome] || BIOMES.reach;
  const V = variants(seed, {
    anem: [[0, 1, 2], 2], anemPal: [['anemone', 'anemoneTeal', 'anemoneViolet'], 2], fan: [[0, 1], 1], fanPal: [['fan', 'fanCoral'], 2],
    kelp: [[0, 1, 2], 1], kelpPal: [['kelp', 'kelpRed'], 2], puff: [[0, 1, 2], 1], puffPal: [['puff', 'puffBlue'], 2], tuftPal: [B.tuft, 1],
  });
  for (let i = 0; i < count; i++) {
    const a = r() * TAU, d = Math.sqrt(r()) * feature.R * 0.9;
    const x = feature.x + Math.cos(a) * d, z = feature.z + Math.sin(a) * d;
    const h = seabed.heightAt(x, z);
    const p = new Vector3(x, h - 0.1, z);
    // reef life clusters on the reef crest and the coral heads, not across open lagoon sand
    if (h > -9 && h < -1.6 && (h > -4 || r() < 0.25)) {
      const pick = r();
      if (pick < 0.45) {
        const v = V('anem', Math.floor(r() * 3)), pk = V('anemPal', Math.floor(r() * 3));
        // reef plants stay under the surface (their tops would stand out of the water like sticks)
        set.add(`anem-${v}-${pk}`, () => SPECIES.anemone(7000 + v, 1.5, FLORA_PAL[pk]), p, Math.min(lerp(0.7, 2.2, r()), (-h - 0.4) / 1.5), r() * TAU, inst(r));
      } else if (pick < 0.75) {
        const v = V('fan', Math.floor(r() * 2)), pk = V('fanPal', r() < 0.5 ? 0 : 1);
        set.add(`fan-${v}-${pk}`, () => SPECIES.fan(8000 + v, 2, FLORA_PAL[pk]), p, Math.min(lerp(0.8, 2.4, r()), (-h - 0.4) / 2), r() * TAU, inst(r));
      } else {
        const v = V('kelp', Math.floor(r() * 3)), pk = V('kelpPal', r() < 0.6 ? 0 : 1);
        set.add(`kelp-${v}-${pk}`, () => SPECIES.kelp(9000 + v, 8, FLORA_PAL[pk]), p, Math.min(lerp(0.4, 1.1, Math.min(1, -h / 8)) * lerp(0.7, 1.2, r()), (-h - 0.3) / 8), r() * TAU, inst(r));
      }
    } else if (h > 0.9 && h < 3) {
      // beaches and motus: puffballs, tendrils, reeds
      const pick = r();
      if (pick < 0.3) {
        const v = V('puff', Math.floor(r() * 3)), pk = V('puffPal', r() < 0.5 ? 0 : 1);
        set.add(`puffs-${v}-${pk}`, () => SPECIES.puffs(2000 + v, 2, FLORA_PAL[pk]), p, lerp(0.6, 1.4, r()), r() * TAU, inst(r));
      } else {
        const slot = pick < 0.65 ? SLOT.tendril : SLOT.reed;
        const tk = V('tuftPal', Math.floor(r() * B.tuft.length));
        set.add(`tuft-${slot}-${tk}`, () => SPECIES.tuft(4000 + slot, 1, FLORA_PAL[tk], slot), p, lerp(0.8, 1.6, r()), r() * TAU, inst(r));
      }
    }
  }
}

/**
 * Per-triangle habitat data of a painted geometry, computed once: area, centroid height, normal,
 * meadow and sand weights. Habitat queries and area-weighted samples then cost one cheap pass.
 */
export class SurfaceIndex {
  constructor(geo) {
    const pos = geo.attributes.position.array, nor = geo.attributes.normal.array, mat = geo.attributes.aMat.array;
    const idx = geo.index.array;
    const nT = idx.length / 3;
    this.geo = geo; this.nT = nT;
    this.area = new Float32Array(nT); this.cy = new Float32Array(nT); this.ny = new Float32Array(nT);
    this.grass = new Float32Array(nT); this.sand = new Float32Array(nT);
    for (let t = 0; t < nT; t++) {
      const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
      const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
      const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
      const cx = uy * vz - uz * vy, cyy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      const l = Math.hypot(cx, cyy, cz);
      this.area[t] = 0.5 * l;
      this.ny[t] = (nor[a * 3 + 1] + nor[b * 3 + 1] + nor[c * 3 + 1]) / 3;
      this.cy[t] = (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3;
      this.grass[t] = (mat[a * 4] + mat[b * 4] + mat[c * 4]) / 3;
      this.sand[t] = (mat[a * 4 + 1] + mat[b * 4 + 1] + mat[c * 4 + 1]) / 3;
    }
    this._cdf = new Float32Array(nT);
  }
  /** w(t) per triangle from (ny, y, grass, sand). */
  weights(fn) {
    let acc = 0;
    for (let t = 0; t < this.nT; t++) {
      const w = fn(this.ny[t], this.cy[t], this.grass[t], this.sand[t]);
      acc += w > 0 ? this.area[t] * w : 0;
      this._cdf[t] = acc;
    }
    return acc;
  }
  /** n area-weighted samples (after weights()). */
  sample(n, r) {
    const out = [];
    const total = this._cdf[this.nT - 1];
    if (!(total > 0)) return out;
    const pos = this.geo.attributes.position.array, nor = this.geo.attributes.normal.array, idx = this.geo.index.array;
    for (let i = 0; i < n; i++) {
      const x = r() * total;
      let lo = 0, hi = this.nT - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (this._cdf[mid] < x) lo = mid + 1; else hi = mid; }
      const a = idx[lo * 3], b = idx[lo * 3 + 1], c = idx[lo * 3 + 2];
      let u = r(), v = r();
      if (u + v > 1) { u = 1 - u; v = 1 - v; }
      const w0 = 1 - u - v;
      const p = new Vector3(pos[a * 3] * w0 + pos[b * 3] * u + pos[c * 3] * v, pos[a * 3 + 1] * w0 + pos[b * 3 + 1] * u + pos[c * 3 + 1] * v, pos[a * 3 + 2] * w0 + pos[b * 3 + 2] * u + pos[c * 3 + 2] * v);
      const nn = new Vector3(nor[a * 3] * w0 + nor[b * 3] * u + nor[c * 3] * v, nor[a * 3 + 1] * w0 + nor[b * 3 + 1] * u + nor[c * 3 + 1] * v, nor[a * 3 + 2] * w0 + nor[b * 3 + 2] * u + nor[c * 3 + 2] * v).normalize();
      out.push({ p, n: nn });
    }
    return out;
  }
}

/** Area of the triangles that pass a habitat test (for densities). */
export function surfaceArea(geo, weight) {
  const pos = geo.attributes.position.array, nor = geo.attributes.normal.array, mat = geo.attributes.aMat.array;
  const idx = geo.index.array;
  let A = 0;
  const P = new Vector3(), N = new Vector3(), M = [0, 0, 0, 0];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    P.set((pos[a * 3] + pos[b * 3] + pos[c * 3]) / 3, (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3, (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[c * 3 + 2]) / 3);
    N.set(nor[a * 3] + nor[b * 3] + nor[c * 3], nor[a * 3 + 1] + nor[b * 3 + 1] + nor[c * 3 + 1], nor[a * 3 + 2] + nor[b * 3 + 2] + nor[c * 3 + 2]).normalize();
    for (let k = 0; k < 4; k++) M[k] = (mat[a * 4 + k] + mat[b * 4 + k] + mat[c * 4 + k]) / 3;
    const w = weight(P, N, M);
    if (w <= 0) continue;
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    A += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) * w;
  }
  return A;
}
