// The low terrain of Vur Sok: everything near sea level that is not cliff. Reef shelves around the
// islands (beaches, rock platforms, a reef crest and a sandy back-reef), spiral atolls (a reef rim
// winding along a logarithmic spiral with sand motus above the water and a turquoise lagoon inside),
// submerged shoals, and the open sea floor at -200 m. One height function serves both the meshes
// (world-aligned tiles, so neighbouring features never overlap or z-fight) and world.seabedAt().
import { BufferGeometry, BufferAttribute, Mesh, Color } from 'three';
import { Noise } from '../core/noise.js';
import { clamp, lerp, smoothstep, TAU } from '../core/math.js';
import { smax, computeNormals, LogSpiral } from './Spirals.js';
import { terrainMaterial } from '../render/materials.js';

const noise = new Noise(9191);
export const DEEP = -200;
const CELL = 256;

const SAND = new Color('#e9dcc0').multiplyScalar(0.72);
const SAND_GOLD = new Color('#d8c08e').multiplyScalar(0.66);
const SAND_DEEP = new Color('#b9b39a').multiplyScalar(0.55);
const SEAGRASS = new Color('#4f6b3c').multiplyScalar(0.55);
const REEF_A = new Color('#b48270').multiplyScalar(0.6); // coralline pinks
const REEF_B = new Color('#8e7a9a').multiplyScalar(0.55); // violet encrusters
const REEF_C = new Color('#b9a46a').multiplyScalar(0.6); // ochre
const ROCKY = new Color('#6f6a62').multiplyScalar(0.6);
const BLACK = new Color('#2c2a2c');

/** Reef-shelf profile by distance outside a shoreline (d >= 0 water side). */
function shelfProfile(d, o, beach) {
  const W = o.shelf ?? 70;
  // beach or rock platform at the foot, a sandy back-reef, the reef crest, then the drop-off
  const foot = lerp(o.rockFoot ?? -2.5, o.beachTop ?? 1.3, beach);
  let h = lerp(foot, o.backReef ?? -4.5, smoothstep(0, (o.beachW ?? 26) * (0.6 + beach), d));
  const crest = o.crest ?? -0.9;
  const cd = W * 0.72;
  h = smax(h, crest - Math.pow(Math.abs(d - cd) / (W * 0.16), 2) * 2.2, 2.5);
  // beyond the crest the reef wall falls away to the deep
  const fall = smoothstep(cd + W * 0.05, W + (o.drop ?? 70), d);
  h = lerp(h, DEEP, Math.pow(fall, 0.7) * smoothstep(cd - 4, cd + 8, d));
  return h;
}

export class Seabed {
  constructor() {
    this.features = [];
    this.grid = new Map();
  }

  _index(f) {
    const x0 = Math.floor((f.x - f.R) / CELL), x1 = Math.floor((f.x + f.R) / CELL);
    const z0 = Math.floor((f.z - f.R) / CELL), z1 = Math.floor((f.z + f.R) / CELL);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const k = i * 100003 + j;
      if (!this.grid.has(k)) this.grid.set(k, []);
      this.grid.get(k).push(f);
    }
  }

  /**
   * Shelf around an island. footprint(lx, lz) is the island's signed sea-level distance (local).
   * o: { R (island radius), shelf, beach (0..1 amount), beachTop, backReef, crest, drop, volcanic, lagoon }
   */
  addShelf(x, z, footprint, o = {}) {
    const W = o.shelf ?? 70;
    const seed = o.seed ?? 1;
    const beachAmt = o.beach ?? 0.5;
    const f = {
      x, z, R: (o.R ?? 100) + W + (o.drop ?? 70) + 20, kind: 'shelf', chapter: o.chapter, volcanic: !!o.volcanic,
      height: (lx, lz) => {
        const d = footprint(lx, lz);
        if (d < 0) return Math.min(o.beachTop ?? 1.3, 0.5 - d * 0.3); // under the rock: rises into it
        const a = Math.atan2(lz, lx);
        const bn = noise.noise2(Math.cos(a) * 1.3 + seed, Math.sin(a) * 1.3 - seed);
        const beach = smoothstep(0.55 - beachAmt, 0.85 - beachAmt * 0.6, bn * 0.5 + 0.5);
        let h = shelfProfile(d, o, beach);
        // patch reefs and bommies on the back-reef, ripples of relief
        h += noise.noise2(lx * 0.035 + seed, lz * 0.035) * 1.2 * smoothstep(-30, -2, h);
        return h;
      },
      paint: (lx, lz, h, out) => {
        const d = footprint(lx, lz);
        const a = Math.atan2(lz, lx);
        const bn = noise.noise2(Math.cos(a) * 1.3 + seed, Math.sin(a) * 1.3 - seed);
        const beach = smoothstep(0.55 - beachAmt, 0.85 - beachAmt * 0.6, bn * 0.5 + 0.5);
        const W2 = o.shelf ?? 70;
        const reef = Math.exp(-(((d - W2 * 0.72) / (W2 * 0.14)) ** 2));
        paintLow(out, h, reef, 1 - beach, f.volcanic, lx + x, lz + z);
      },
    };
    this.features.push(f);
    this._index(f);
    return f;
  }

  /**
   * Spiral atoll: a reef rim along a logarithmic spiral (or a ring when b = 0), sand motus above
   * the water, a lagoon floor inside. o: { a, b, turns, rot, dir, rimW, lagoon (depth), motu (0..1), R }
   */
  addAtoll(x, z, o = {}) {
    const seed = o.seed ?? 3;
    const sp = new LogSpiral({ a: o.a ?? 120, b: o.b ?? 0.08, phi0: 0, phi1: (o.turns ?? 1.25) * TAU, dir: o.dir ?? 1, rot: o.rot ?? 0 });
    const rimW = o.rimW ?? 40;
    const R = sp.rho(sp.phi1) + rimW * 3;
    const lagoon = o.lagoon ?? -7;
    const motu = o.motu ?? 0.5;
    let best = 0, bestPhi = 0;
    const visit = (phi, d) => { if (d < best) { best = d; bestPhi = phi; } };
    const rim = (lx, lz) => {
      best = 1e9; bestPhi = 0;
      sp.arms(lx, lz, visit);
      return { d: best, phi: bestPhi };
    };
    // the outermost arm crossing a direction: points closer to the centre are in the lagoon
    const outerRho = (lx, lz) => {
      let th = ((Math.atan2(lz, lx) - sp.rot) * sp.dir) % TAU;
      if (th < 0) th += TAU;
      const k = Math.floor((sp.phi1 - th) / TAU);
      const phi = th + TAU * k;
      return phi < sp.phi0 ? 0 : sp.rho(phi);
    };
    const f = {
      x, z, R: R + 120, kind: 'atoll', chapter: o.chapter, spiral: sp,
      height: (lx, lz) => {
        const { d, phi } = rim(lx, lz);
        const rho = Math.hypot(lx, lz);
        const t = (phi - sp.phi0) / (sp.phi1 - sp.phi0);
        // rim crest: a reef flat with sand motus where the noise rises (open at the spiral's tip)
        const mn = noise.noise2(phi * 1.7 + seed, 0.5) * 0.6 + noise.noise2(phi * 5.1, seed) * 0.4;
        const motuH = smoothstep(0.1 - motu * 0.5, 0.45 - motu * 0.3, mn) * 2.6 * smoothstep(1.0, 0.86, t) * smoothstep(0.0, 0.08, t);
        const w = rimW * (0.65 + 0.35 * smoothstep(0, 0.3, t)) * (1 + 0.25 * noise.noise2(phi * 3 + seed, 2));
        const hRim = -0.7 + motuH - Math.pow(d / w, 2) * 2.2;
        const inLagoon = rho < outerRho(lx, lz) - w * 0.3;
        let floor;
        if (inLagoon) {
          floor = lagoon + noise.noise2(lx * 0.012 + seed, lz * 0.012) * 2.0;
          // patch reefs and coral heads rising toward the surface
          floor += Math.max(0, noise.noise2(lx * 0.045, lz * 0.045 + seed) - 0.3) * 10;
        } else {
          floor = lerp(-4, DEEP, Math.pow(smoothstep(w * 0.4, w * 3.4, d), 0.75));
        }
        return smax(hRim, floor, 3);
      },
      paint: (lx, lz, h, out) => {
        const { d } = rim(lx, lz);
        const reef = Math.exp(-((d / (rimW * 0.9)) ** 2)) * smoothstep(-0.2, -3, h);
        const patch = smoothstep(-5, -2, h) * smoothstep(0.2, 0.6, noise.noise2(lx * 0.045, lz * 0.045 + seed));
        paintLow(out, h, Math.max(reef, patch), 0, false, lx + x, lz + z);
      },
    };
    this.features.push(f);
    this._index(f);
    return f;
  }

  /** A submerged sandbank: depth at its crown, radius R. */
  addShoal(x, z, R, depth = -9, o = {}) {
    const seed = o.seed ?? 7;
    const f = {
      x, z, R: R * 1.6, kind: 'shoal', chapter: o.chapter,
      height: (lx, lz) => {
        const q = Math.hypot(lx, lz) / R;
        const n = noise.noise2(lx * 0.01 + seed, lz * 0.01);
        return lerp(depth + n * 3, DEEP, smoothstep(0.5, 1.5, q + n * 0.2));
      },
      paint: (lx, lz, h, out) => paintLow(out, h, 0, 0, false, lx + x, lz + z),
    };
    this.features.push(f);
    this._index(f);
    return f;
  }

  /** Sea-floor height at a world point (shallow reefs, lagoons, beaches; DEEP in open sea). */
  heightAt(x, z) {
    const l = this.grid.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
    if (!l) return DEEP;
    let h = DEEP;
    for (let i = 0; i < l.length; i++) {
      const f = l[i];
      const dx = x - f.x, dz = z - f.z;
      if (dx * dx + dz * dz > f.R * f.R) continue;
      const v = f.height(dx, dz);
      h = h === DEEP ? Math.max(h, v) : smax(h, v, 3);
    }
    return h;
  }

  /** Height and the dominant (highest) feature at a world point. */
  sample(x, z, out) {
    out.h = DEEP; out.f = null;
    const l = this.grid.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
    if (!l) return out;
    let bh = -1e9;
    for (let i = 0; i < l.length; i++) {
      const f = l[i];
      const dx = x - f.x, dz = z - f.z;
      if (dx * dx + dz * dz > f.R * f.R) continue;
      const v = f.height(dx, dz);
      out.h = out.h === DEEP ? Math.max(out.h, v) : smax(out.h, v, 3);
      if (v > bh) { bh = v; out.f = f; }
    }
    return out;
  }

  /**
   * Build the meshes covering a set of features (world-aligned tiles; a tile is built once).
   * Returns an array of Meshes to add to a chapter group. `slice` (async) is awaited between tiles
   * so long builds stay time-sliced.
   */
  async buildFor(features, built = new Set(), opts = {}, slice = null) {
    const T = opts.tile ?? 192;
    const step = opts.step ?? 4;
    const keys = new Set();
    for (const f of features) {
      const x0 = Math.floor((f.x - f.R) / T), x1 = Math.floor((f.x + f.R) / T);
      const z0 = Math.floor((f.z - f.R) / T), z1 = Math.floor((f.z + f.R) / T);
      for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
        const k = `${i},${j}`;
        if (!built.has(k)) keys.add(k);
      }
    }
    const pos = [], col = [], mat = [], ext = [], idx = [];
    const out = { r: 0, g: 0, b: 0, sand: 1, kind: 0, grass: 0 };
    const n = Math.round(T / step);
    const smp = { h: 0, f: null };
    const fs = [];
    for (const k of keys) {
      const [ti, tj] = k.split(',').map(Number);
      // skip tiles with nothing above the deep floor
      const hs = new Float32Array((n + 1) * (n + 1));
      fs.length = 0;
      let any = false;
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
        const x = ti * T + i * step, z = tj * T + j * step;
        this.sample(x, z, smp);
        hs[j * (n + 1) + i] = smp.h;
        fs.push(smp.f);
        if (smp.h > -110) any = true;
      }
      built.add(k);
      if (slice) await slice();
      if (!any) continue;
      const base = pos.length / 3;
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
        const x = ti * T + i * step, z = tj * T + j * step;
        const h = hs[j * (n + 1) + i];
        pos.push(x, Math.max(h, -130), z);
        const f = fs[j * (n + 1) + i];
        if (f) f.paint(x - f.x, z - f.z, h, out);
        else paintLow(out, h, 0, 0, false, x, z);
        col.push(out.r, out.g, out.b);
        mat.push(out.grass, out.sand, out.kind, 0);
        ext.push(1, h, 0);
      }
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const a = base + j * (n + 1) + i, b = a + 1, c = a + (n + 1), d = c + 1;
        const ha = hs[j * (n + 1) + i], hb = hs[j * (n + 1) + i + 1], hc = hs[(j + 1) * (n + 1) + i], hd = hs[(j + 1) * (n + 1) + i + 1];
        if (Math.max(ha, hb, hc, hd) < -115) continue;
        idx.push(a, c, b, b, c, d);
      }
    }
    if (!idx.length) return [];
    const P = new Float32Array(pos);
    const I = P.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
    const N = computeNormals(P, I);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(P, 3));
    geo.setAttribute('normal', new BufferAttribute(N, 3));
    geo.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
    geo.setAttribute('aMat', new BufferAttribute(new Float32Array(mat), 4));
    geo.setAttribute('aExt', new BufferAttribute(new Float32Array(ext), 3));
    geo.setIndex(new BufferAttribute(I, 1));
    geo.computeBoundingSphere();
    const mesh = new Mesh(geo, terrainMaterial());
    mesh.name = 'seabed';
    return [mesh];
  }
}

/** Colour and material weights of the low terrain at height h (reef 0..1, rocky 0..1). */
function paintLow(out, h, reef, rocky, volcanic, x, z) {
  const n1 = noise.noise2(x * 0.02, z * 0.02), n2 = noise.noise2(x * 0.09 + 5, z * 0.09);
  const c = _c.copy(SAND).lerp(SAND_GOLD, smoothstep(-0.3, 0.6, n1) * 0.5);
  c.lerp(SAND_DEEP, smoothstep(-6, -30, h));
  // seagrass meadows on the sandy back-reef
  const sg = smoothstep(0.15, 0.45, n2) * smoothstep(-1.5, -3.5, h) * smoothstep(-16, -8, h);
  c.lerp(SEAGRASS, sg * 0.75);
  // reef: coralline pinks, violets and ochres in patches
  if (reef > 0.01) {
    const rc = _c2.copy(REEF_A).lerp(REEF_B, smoothstep(-0.3, 0.4, n2)).lerp(REEF_C, smoothstep(0.2, 0.7, n1));
    c.lerp(rc, clamp(reef * 1.3, 0, 1) * smoothstep(1.0, -0.5, h));
  }
  if (rocky > 0.01) c.lerp(ROCKY, rocky * smoothstep(-6, -1, h) * 0.7);
  if (volcanic) c.lerp(BLACK, 0.85);
  out.r = c.r; out.g = c.g; out.b = c.b;
  out.sand = clamp(1 - reef * 0.9 - rocky * 0.5 * smoothstep(-6, -1, h) - sg * 0.6, 0, 1);
  out.kind = volcanic ? 1 : 0;
  // a little meadow behind the beach crest (motus)
  out.grass = smoothstep(1.2, 2.2, h) * 0.9;
}
const _c = new Color(), _c2 = new Color();
