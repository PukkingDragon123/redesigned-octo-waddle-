// Hand-painted 2D elements of Vur Sok, painted procedurally at load time with brush strokes on
// canvases: leaf clumps, fern pinnae, grass and tendril tufts, kelp ribbons, glass fans, tentacles,
// blossoms, vines, puffballs. The atlas stores painting data, not final colours, so one atlas
// serves every species and palette:
//   R = value (brush shading, light to the upper edge of each stroke)
//   G = accent mask (veins, tips, spots, petals: the species' second colour)
//   B = thickness / depth (fake volume: bends the normal, scales translucency)
//   A = coverage (alpha-tested with alpha-to-coverage, so painted edges stay soft)
import { DataTexture, RGBAFormat, UnsignedByteType, LinearFilter, LinearMipmapLinearFilter, ClampToEdgeWrapping } from 'three';
import { rng, lerp, clamp, TAU } from '../core/math.js';

export const ATLAS_SIZE = 2048;
export const ATLAS_GRID = 8; // 8 x 8 cells of 256 px
const CELL = ATLAS_SIZE / ATLAS_GRID;

/** Atlas slots. */
export const SLOT = {
  leafA: 0, leafB: 1, leafC: 2, needles: 3, blossom: 4, frond: 5, pinnae: 6, kelp: 7,
  fan: 8, tentacle: 9, grassA: 10, grassB: 11, flowers: 12, vine: 13, puff: 14, moss: 15,
  pinnaeB: 16, kelpB: 17, fanB: 18, tendril: 19, reed: 20, shrub: 21, palm: 22, bellTex: 23,
  farIsland: 24,
};

/** UV rectangle [u0, v0, u1, v1] of a slot (v up, OpenGL convention). */
export function slotUV(slot) {
  const cx = slot % ATLAS_GRID, cy = Math.floor(slot / ATLAS_GRID);
  const pad = 1.5 / ATLAS_SIZE;
  const u0 = cx / ATLAS_GRID + pad, u1 = (cx + 1) / ATLAS_GRID - pad;
  const v1 = 1 - cy / ATLAS_GRID - pad, v0 = 1 - (cy + 1) / ATLAS_GRID + pad;
  return [u0, v0, u1, v1];
}

// ---- brushes ------------------------------------------------------------------------------------
const rgba = (v, acc = 0, dep = 0.5, a = 1) => `rgba(${Math.round(clamp(v, 0, 1) * 255)},${Math.round(clamp(acc, 0, 1) * 255)},${Math.round(clamp(dep, 0, 1) * 255)},${a})`;

/** A pointed leaf: two quadratic arcs from base to tip. */
function leaf(ctx, x, y, len, wid, rot, fill) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const tx = x + c * len, ty = y + s * len;
  const nx = -s * wid, ny = c * wid;
  const mx = x + c * len * 0.45, my = y + s * len * 0.45;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(mx + nx, my + ny, tx, ty);
  ctx.quadraticCurveTo(mx - nx, my - ny, x, y);
  ctx.fill();
}

/** Tapered stroke along a polyline (pts: [[x, y], ...]), width w0 -> w1. */
function stroke(ctx, pts, w0, w1, fill) {
  const n = pts.length;
  const L = [], R = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    const w = lerp(w0, w1, i / (n - 1)) * 0.5;
    L.push([pts[i][0] - dy * w, pts[i][1] + dx * w]);
    R.push([pts[i][0] + dy * w, pts[i][1] - dx * w]);
  }
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(L[0][0], L[0][1]);
  for (let i = 1; i < n; i++) ctx.lineTo(L[i][0], L[i][1]);
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
  ctx.closePath();
  ctx.fill();
}

function dab(ctx, x, y, rx, ry, rot, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.3, rx), Math.max(0.3, ry), rot, 0, TAU);
  ctx.fill();
}

// ---- cell painters (each paints into a CELL x CELL square at its origin) -----------------------
const P = {};

/** Leaf clump for tree canopies: overlapping leaves, darker deep inside, lit upper-left edges. */
P.clump = (ctx, r, o = {}) => {
  const C = CELL / 2;
  const n = o.n ?? 420;
  for (let i = 0; i < n; i++) {
    const k = i / n; // later = outer and higher
    const a = r() * TAU;
    const rr = Math.sqrt(r()) * C * lerp(0.5, 0.86, k);
    const x = C + Math.cos(a) * rr, y = C + Math.sin(a) * rr * 0.92;
    const depth = 1 - rr / (C * 0.86);
    const light = clamp(0.35 + 0.45 * k + 0.25 * (-(x - C) - (y - C)) / C + (r() - 0.5) * 0.25, 0, 1);
    const len = lerp(o.lenMin ?? 9, o.lenMax ?? 18, r());
    const rot = a + (r() - 0.5) * 1.6;
    leaf(ctx, x, y, len, len * (o.wid ?? 0.32), rot, rgba(light, r() < (o.accent ?? 0.08) ? 1 : 0, 0.4 + depth * 0.6));
  }
};

P.needles = (ctx, r) => {
  const C = CELL / 2;
  for (let i = 0; i < 260; i++) {
    const a = -Math.PI / 2 + (r() - 0.5) * 2.6;
    const x0 = C + (r() - 0.5) * 60, y0 = C + 40 + (r() - 0.5) * 30;
    const len = lerp(40, 100, r());
    const pts = [[x0, y0], [x0 + Math.cos(a) * len * 0.5, y0 + Math.sin(a) * len * 0.5 - 6], [x0 + Math.cos(a) * len, y0 + Math.sin(a) * len]];
    stroke(ctx, pts, 3.2, 0.6, rgba(lerp(0.25, 0.85, r() * 0.5 + (1 - i / 260) * 0.0 + 0.3), r() < 0.1 ? 1 : 0, 0.6));
  }
};

P.blossom = (ctx, r) => {
  P.clump(ctx, r, { n: 160, lenMin: 8, lenMax: 14, wid: 0.3 });
  const C = CELL / 2;
  for (let i = 0; i < 150; i++) {
    const a = r() * TAU, rr = Math.sqrt(r()) * C * 0.8;
    const x = C + Math.cos(a) * rr, y = C + Math.sin(a) * rr;
    const s = lerp(4, 8, r());
    for (let p = 0; p < 5; p++) {
      const pa = (p / 5) * TAU + r();
      dab(ctx, x + Math.cos(pa) * s * 0.7, y + Math.sin(pa) * s * 0.7, s * 0.65, s * 0.42, pa, rgba(lerp(0.65, 1, r()), 1, 0.5));
    }
    dab(ctx, x, y, s * 0.3, s * 0.3, 0, rgba(0.3, 0.2, 0.6));
  }
};

/** Fern pinnae strip: rachis along v, leaflets on both sides (u across). */
P.pinnae = (ctx, r, o = {}) => {
  const W = CELL, H = CELL;
  const cx = W / 2;
  const n = o.n ?? 26;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const y = H - t * H;
    const len = (W * 0.46) * Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.08)) * (o.taper ?? 1);
    for (const sg of [-1, 1]) {
      const rot = sg > 0 ? -0.45 : Math.PI + 0.45;
      // each pinna: a stalk of overlapping lobes
      stroke(ctx, [[cx, y], [cx + sg * len * 0.5, y - len * 0.2], [cx + sg * len, y - len * 0.42]], 3.5, 1.2, rgba(0.4, 0.2, 0.7));
      const m = 7;
      for (let k = 0; k < m; k++) {
        const f = k / m;
        const px = cx + sg * (4 + f * len), py = y - f * len * 0.42;
        const ls = lerp(18, 8, f) * (o.lobe ?? 1);
        leaf(ctx, px, py, ls, ls * 0.45, rot + (r() - 0.5) * 0.3 - sg * 0.5, rgba(lerp(0.45, 0.95, f * 0.5 + r() * 0.35), f > 0.72 ? 1 : 0, 0.55));
        leaf(ctx, px, py, ls * 0.8, ls * 0.4, rot + (r() - 0.5) * 0.3 + sg * 0.9, rgba(lerp(0.35, 0.8, f * 0.5 + r() * 0.35), 0, 0.45));
      }
    }
  }
  stroke(ctx, [[cx, H], [cx, H * 0.5], [cx, 0]], 6, 2, rgba(0.35, 0.6, 0.8));
};

/** Kelp ribbon: a long ruffled blade with a midrib and translucent veins. */
P.kelp = (ctx, r, o = {}) => {
  const W = CELL, H = CELL;
  const pts = [];
  ctx.beginPath();
  for (let i = 0; i <= 64; i++) {
    const t = i / 64;
    const w = W * 0.42 * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.05))) * (1 + 0.12 * Math.sin(t * 60 + r() * 2));
    pts.push([W / 2 + w, H - t * H]);
  }
  for (let i = 64; i >= 0; i--) {
    const t = i / 64;
    const w = W * 0.42 * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.05))) * (1 + 0.12 * Math.sin(t * 57 + 1.3));
    pts.push([W / 2 - w, H - t * H]);
  }
  ctx.fillStyle = rgba(0.6, 0, 0.3);
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const q of pts) ctx.lineTo(q[0], q[1]);
  ctx.closePath();
  ctx.fill();
  // value bands and veins
  for (let i = 0; i < 40; i++) {
    const y = H - (i / 40) * H;
    stroke(ctx, [[W * 0.5, y], [W * 0.2 + r() * 10, y - 18], [W * 0.05, y - 26]], 2.5, 0.8, rgba(0.85, 1, 0.2, 0.7));
    stroke(ctx, [[W * 0.5, y], [W * 0.8 - r() * 10, y - 18], [W * 0.95, y - 26]], 2.5, 0.8, rgba(0.85, 1, 0.2, 0.7));
  }
  stroke(ctx, [[W / 2, H], [W / 2, 0]], 7, 3, rgba(0.4, 0.4, 0.9));
  // ruffled darker edge
  ctx.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 90; i++) dab(ctx, r() < 0.5 ? W * 0.12 : W * 0.88, r() * H, 10, 20, 0, rgba(0.3, 0.3, 0.6, 0.35));
  ctx.globalCompositeOperation = 'source-over';
};

/** Glass fan: a semicircle of membrane with a branching vein network. */
P.fan = (ctx, r) => {
  const W = CELL, H = CELL;
  const ox = W / 2, oy = H * 0.96;
  ctx.fillStyle = rgba(0.55, 0, 0.15, 0.62);
  ctx.beginPath();
  ctx.moveTo(ox, oy);
  for (let i = 0; i <= 48; i++) {
    const a = Math.PI + (i / 48) * Math.PI;
    const rr = H * 0.9 * (0.88 + 0.12 * Math.sin(i * 1.3 + r()));
    ctx.lineTo(ox + Math.cos(a) * rr * 0.55, oy + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
  const branch = (x, y, a, len, w, depth) => {
    if (depth > 6 || len < 6) return;
    const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
    stroke(ctx, [[x, y], [(x + x2) / 2 + (r() - 0.5) * 6, (y + y2) / 2], [x2, y2]], w, w * 0.7, rgba(0.95, 1, 0.7));
    const n = r() < 0.3 ? 3 : 2;
    for (let k = 0; k < n; k++) branch(x2, y2, a + (k - (n - 1) / 2) * 0.42 + (r() - 0.5) * 0.2, len * lerp(0.62, 0.8, r()), w * 0.72, depth + 1);
  };
  for (let k = 0; k < 5; k++) branch(ox, oy, -Math.PI / 2 + (k - 2) * 0.32, H * 0.2, 6, 0);
};

/** Anemone tentacle strip: banded, with a swollen tip. */
P.tentacle = (ctx, r) => {
  const W = CELL, H = CELL;
  for (let i = 0; i < 24; i++) {
    const t0 = i / 24;
    dab(ctx, W / 2, H - t0 * H * 0.92, W * 0.32 * (1 - t0 * 0.5), H / 40, 0, rgba(lerp(0.4, 0.8, t0), i % 3 === 0 ? 1 : 0, 0.7));
  }
  dab(ctx, W / 2, H * 0.08, W * 0.3, H * 0.07, 0, rgba(1, 1, 0.8));
};

/** Grass tuft: blades fanning from the base, lighter tips. */
P.grass = (ctx, r, o = {}) => {
  const W = CELL, H = CELL;
  const n = o.n ?? 70;
  for (let i = 0; i < n; i++) {
    const x0 = W / 2 + (r() - 0.5) * W * 0.3;
    const lean = (r() - 0.5) * 1.3;
    const len = lerp(0.45, 0.95, r()) * H;
    const curl = (o.curl ?? 0.15) * (r() - 0.5);
    const pts = [];
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      const a = -Math.PI / 2 + lean * t + curl * t * t * 6;
      pts.push([x0 + Math.sin(lean * t) * len * 0.5 + Math.sin(curl * t * 6) * 20 * t, H - t * len * (1 - 0.15 * Math.abs(lean))]);
    }
    stroke(ctx, pts, lerp(6, 11, r()), 1, rgba(lerp(0.3, 0.9, r()), r() < (o.accent ?? 0.15) ? 1 : 0, 0.5));
  }
  if (o.seeds) for (let i = 0; i < 12; i++) dab(ctx, W / 2 + (r() - 0.5) * W * 0.7, H * lerp(0.08, 0.35, r()), 5, 9, (r() - 0.5), rgba(0.9, 1, 0.5));
};

/** Alien tendril tuft: curling spirals rising from a base. */
P.tendril = (ctx, r) => {
  const W = CELL, H = CELL;
  for (let i = 0; i < 24; i++) {
    const x0 = W / 2 + (r() - 0.5) * W * 0.4;
    const len = lerp(0.4, 0.85, r()) * H;
    const dir = r() < 0.5 ? -1 : 1;
    const pts = [];
    let x = x0, y = H, a = -Math.PI / 2 + (r() - 0.5) * 0.6;
    for (let k = 0; k <= 30; k++) {
      const t = k / 30;
      pts.push([x, y]);
      const step = len / 30 * (1 - t * 0.4);
      a += dir * Math.pow(t, 2.2) * 0.55;
      x += Math.cos(a) * step; y += Math.sin(a) * step;
    }
    stroke(ctx, pts, 7, 1.5, rgba(lerp(0.4, 0.9, r()), r() < 0.3 ? 1 : 0, 0.5));
  }
};

P.flowers = (ctx, r) => {
  P.grass(ctx, r, { n: 40 });
  const W = CELL, H = CELL;
  for (let i = 0; i < 16; i++) {
    const x = W / 2 + (r() - 0.5) * W * 0.6, y = H * lerp(0.1, 0.5, r());
    const s = lerp(8, 14, r());
    for (let p = 0; p < 6; p++) {
      const pa = (p / 6) * TAU + r();
      dab(ctx, x + Math.cos(pa) * s * 0.6, y + Math.sin(pa) * s * 0.6, s * 0.6, s * 0.34, pa, rgba(lerp(0.7, 1, r()), 1, 0.5));
    }
    dab(ctx, x, y, s * 0.28, s * 0.28, 0, rgba(0.95, 0.3, 0.7));
  }
};

/** Vine strip: hanging strands with small leaves. */
P.vine = (ctx, r) => {
  const W = CELL, H = CELL;
  for (let k = 0; k < 7; k++) {
    const x0 = W * (0.1 + 0.8 * (k + r() * 0.5) / 7);
    const pts = [];
    for (let i = 0; i <= 20; i++) pts.push([x0 + Math.sin(i * 0.7 + k) * 5, (i / 20) * H]);
    stroke(ctx, pts, 4, 2, rgba(0.35, 0, 0.6));
    for (let i = 0; i < 26; i++) {
      const t = r();
      leaf(ctx, x0 + Math.sin(t * 14 + k) * 5, t * H, lerp(8, 15, r()), 4.5, (r() < 0.5 ? 0.4 : Math.PI - 0.4) + (r() - 0.5) * 0.6, rgba(lerp(0.4, 0.9, r()), r() < 0.08 ? 1 : 0, 0.5));
    }
  }
};

/** Puffball: a soft sphere of spores (painted shading baked into B as height for bent normals). */
P.puff = (ctx, r) => {
  const C = CELL / 2;
  for (let i = 0; i < 900; i++) {
    const a = r() * TAU, rr = Math.sqrt(r()) * C * 0.9;
    const x = C + Math.cos(a) * rr, y = C + Math.sin(a) * rr;
    const d = rr / (C * 0.9);
    dab(ctx, x, y, lerp(3, 7, r()) * (1 - d * 0.5), lerp(3, 7, r()) * (1 - d * 0.5), r(), rgba(lerp(0.55, 1, r()), r() < 0.12 ? 1 : 0, 1 - d * d));
  }
  // fuzzy rim of spore filaments
  for (let i = 0; i < 160; i++) {
    const a = r() * TAU;
    const x = C + Math.cos(a) * C * 0.86, y = C + Math.sin(a) * C * 0.86;
    stroke(ctx, [[x, y], [x + Math.cos(a) * 10, y + Math.sin(a) * 10]], 2.2, 0.5, rgba(0.9, 0.5, 0.1, 0.8));
  }
};

P.moss = (ctx, r) => P.clump(ctx, r, { n: 600, lenMin: 4, lenMax: 8, wid: 0.5, accent: 0.15 });
P.shrub = (ctx, r) => P.clump(ctx, r, { n: 300, lenMin: 10, lenMax: 22, wid: 0.22, accent: 0.05 });

/** Palm frond: a long arching rachis with drooping leaflets, painted flat. */
P.palm = (ctx, r) => {
  const W = CELL, H = CELL;
  const cx = W / 2;
  for (let i = 0; i < 46; i++) {
    const t = (i + 0.5) / 46;
    const y = H - t * H;
    const len = W * 0.47 * Math.sin(Math.PI * Math.min(1, t * 0.95 + 0.1));
    for (const sg of [-1, 1]) {
      const pts = [[cx, y], [cx + sg * len * 0.5, y - 6], [cx + sg * len, y + 10]];
      stroke(ctx, pts, 6, 1, rgba(lerp(0.4, 0.95, r() * 0.5 + 0.3), r() < 0.06 ? 1 : 0, 0.5));
    }
  }
  stroke(ctx, [[cx, H], [cx, 0]], 7, 2, rgba(0.5, 0.6, 0.8));
};

P.reed = (ctx, r) => P.grass(ctx, r, { n: 34, curl: 0.05, seeds: true, accent: 0.05 });

/** Distant island silhouettes for the impostor/backdrop band. */
P.farIsland = (ctx, r) => {
  const W = CELL, H = CELL;
  ctx.fillStyle = rgba(0.6, 0, 0.5);
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    ctx.lineTo(t * W, H - H * 0.6 * Math.sin(Math.PI * t) * (0.8 + 0.2 * r()));
  }
  ctx.lineTo(W, H);
  ctx.fill();
};

// ---- the atlas ------------------------------------------------------------------------------------
let _atlas = null;

function paintCell(ctx, slot, fn, seed) {
  const cx = slot % ATLAS_GRID, cy = Math.floor(slot / ATLAS_GRID);
  ctx.save();
  ctx.translate(cx * CELL, cy * CELL);
  ctx.beginPath();
  ctx.rect(0, 0, CELL, CELL);
  ctx.clip();
  fn(ctx, rng(seed));
  ctx.restore();
}

/**
 * The flora atlas (DataTexture, mipmapped). Painted once on first use (~0.2-0.4 s). In
 * environments without a canvas (node tests) it returns a 1x1 placeholder.
 */
export function getFloraAtlas() {
  if (_atlas) return _atlas;
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(ATLAS_SIZE, ATLAS_SIZE)
    : (typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: ATLAS_SIZE, height: ATLAS_SIZE }) : null);
  if (!canvas) {
    _atlas = new DataTexture(new Uint8Array([200, 0, 128, 255]), 1, 1, RGBAFormat, UnsignedByteType);
    _atlas.needsUpdate = true;
    return _atlas;
  }
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
  paintCell(ctx, SLOT.leafA, P.clump, 11);
  paintCell(ctx, SLOT.leafB, (c, r) => P.clump(c, r, { n: 360, lenMin: 12, lenMax: 24, wid: 0.28 }), 12);
  paintCell(ctx, SLOT.leafC, (c, r) => P.clump(c, r, { n: 520, lenMin: 7, lenMax: 13, wid: 0.4, accent: 0.18 }), 13);
  paintCell(ctx, SLOT.needles, P.needles, 14);
  paintCell(ctx, SLOT.blossom, P.blossom, 15);
  paintCell(ctx, SLOT.frond, P.pinnae, 16);
  paintCell(ctx, SLOT.pinnae, (c, r) => P.pinnae(c, r, { n: 22 }), 17);
  paintCell(ctx, SLOT.kelp, P.kelp, 18);
  paintCell(ctx, SLOT.fan, P.fan, 19);
  paintCell(ctx, SLOT.tentacle, P.tentacle, 20);
  paintCell(ctx, SLOT.grassA, P.grass, 21);
  paintCell(ctx, SLOT.grassB, (c, r) => P.grass(c, r, { n: 50, curl: 0.4, seeds: true }), 22);
  paintCell(ctx, SLOT.flowers, P.flowers, 23);
  paintCell(ctx, SLOT.vine, P.vine, 24);
  paintCell(ctx, SLOT.puff, P.puff, 25);
  paintCell(ctx, SLOT.moss, P.moss, 26);
  paintCell(ctx, SLOT.pinnaeB, (c, r) => P.pinnae(c, r, { n: 34, taper: 0.8 }), 27);
  paintCell(ctx, SLOT.kelpB, P.kelp, 28);
  paintCell(ctx, SLOT.fanB, P.fan, 29);
  paintCell(ctx, SLOT.tendril, P.tendril, 30);
  paintCell(ctx, SLOT.reed, P.reed, 31);
  paintCell(ctx, SLOT.shrub, P.shrub, 32);
  paintCell(ctx, SLOT.palm, P.palm, 33);
  paintCell(ctx, SLOT.farIsland, P.farIsland, 34);
  const img = ctx.getImageData(0, 0, ATLAS_SIZE, ATLAS_SIZE);
  const data = flipAndDilate(img.data, ATLAS_SIZE);
  const tex = new DataTexture(data, ATLAS_SIZE, ATLAS_SIZE, RGBAFormat, UnsignedByteType);
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  _atlas = tex;
  return tex;
}

/**
 * Flip rows (canvas is top-down, GL bottom-up) and bleed RGB into transparent pixels so mipmaps
 * do not fringe the painted edges with black.
 */
function flipAndDilate(src, N) {
  const out = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) out.set(src.subarray((N - 1 - y) * N * 4, (N - y) * N * 4), y * N * 4);
  for (let pass = 0; pass < 2; pass++) {
    const prev = out.slice();
    for (let y = 1; y < N - 1; y++) {
      for (let x = 1; x < N - 1; x++) {
        const i = (y * N + x) * 4;
        if (prev[i + 3] > 8) continue;
        let r = 0, g = 0, b = 0, c = 0;
        for (const o of [-4, 4, -N * 4, N * 4]) {
          const j = i + o;
          if (prev[j + 3] > 8 || (pass > 0 && (prev[j] | prev[j + 1] | prev[j + 2]))) { r += prev[j]; g += prev[j + 1]; b += prev[j + 2]; c++; }
        }
        if (c) { out[i] = r / c; out[i + 1] = g / c; out[i + 2] = b / c; }
      }
    }
  }
  return out;
}
