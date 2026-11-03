// Procedural fish of Vur Sok (length 1 along +Z, nose at z = +0.5, tail tip at z = -0.5; +X is the
// fish's right side, +Y its back). Each species has a detailed near mesh and a light far mesh.
//
// Vertex attributes (read by fishMat.js):
//   aF: x part (0 body, 1 caudal fin, 2 dorsal fin / sail, 3 anal fin, 4 pectoral fin,
//            5 pelvic fin, 6 lure filament / stalk, 7 lure bulb, 8 finlet, 9 second dorsal, 10 eye,
//            11 bone: fangs, horns, spines and the spiralback's corkscrew bill),
//       y t along the body (0 nose .. 1 tail tip) where the vertex rides the swimming wave,
//       z s along the fin ray / filament (0 root .. 1 tip; body: 0),
//       w side (-1 left, +1 right, 0 midline) or the lure index; bone: 0 upper fang (rides the
//       head), 1 lower fang (rides the dropping jaw), 2 horn / spine, 3 bill
//   aR: xyz the hinge (ray root / fin base) in local units, w ray index across the fin 0..1
//       (body: angle around the section 0 top, 0.25 right, 0.5 belly, 0.75 left)
import { Builder, loft, membrane, tube, ellipsoid, smooth, lin, spow, TAU, V3 } from './kit.js';

export const FISH_ATTRS = { aF: 4, aR: 4 };

// ------------------------------------------------------------------------------------------
// Profiles: body stations (z, half width, top half height, bottom half height, centre height)
const GLINT = {
  z: [0.5, 0.494, 0.48, 0.455, 0.42, 0.37, 0.3, 0.22, 0.14, 0.06, -0.02, -0.1, -0.18, -0.24, -0.28, -0.3],
  hw: [0, 0.012, 0.02, 0.028, 0.035, 0.04, 0.043, 0.044, 0.042, 0.038, 0.032, 0.025, 0.018, 0.013, 0.01, 0.0085],
  ht: [0, 0.012, 0.022, 0.032, 0.041, 0.049, 0.055, 0.058, 0.057, 0.053, 0.046, 0.037, 0.027, 0.019, 0.014, 0.0125],
  hb: [0, 0.015, 0.028, 0.041, 0.054, 0.066, 0.075, 0.08, 0.079, 0.072, 0.059, 0.044, 0.029, 0.019, 0.014, 0.0125],
  cy: [-0.004, -0.003, -0.001, 0.001, 0.003, 0.004, 0.005, 0.006, 0.006, 0.006, 0.007, 0.008, 0.008, 0.008, 0.008, 0.008],
};
const SPIRAL = {
  z: [0.5, 0.488, 0.465, 0.43, 0.385, 0.33, 0.26, 0.18, 0.1, 0.02, -0.06, -0.14, -0.21, -0.26, -0.29, -0.305],
  hw: [0, 0.014, 0.028, 0.042, 0.054, 0.064, 0.071, 0.074, 0.072, 0.066, 0.056, 0.044, 0.031, 0.021, 0.017, 0.016],
  ht: [0, 0.015, 0.035, 0.055, 0.073, 0.088, 0.099, 0.104, 0.102, 0.093, 0.077, 0.058, 0.038, 0.024, 0.016, 0.014],
  hb: [0, 0.016, 0.033, 0.05, 0.066, 0.079, 0.089, 0.094, 0.092, 0.084, 0.07, 0.052, 0.034, 0.021, 0.015, 0.013],
  cy: [-0.006, -0.004, -0.002, 0.001, 0.003, 0.005, 0.006, 0.006, 0.006, 0.006, 0.006, 0.006, 0.006, 0.006, 0.006, 0.006],
};
const LANTERN = {
  z: [0.5, 0.492, 0.475, 0.45, 0.415, 0.37, 0.31, 0.24, 0.16, 0.07, -0.02, -0.1, -0.17, -0.22, -0.255, -0.275, -0.29],
  hw: [0, 0.018, 0.032, 0.044, 0.053, 0.059, 0.063, 0.064, 0.062, 0.057, 0.049, 0.04, 0.03, 0.022, 0.017, 0.015, 0.014],
  ht: [0, 0.035, 0.072, 0.105, 0.133, 0.155, 0.168, 0.171, 0.163, 0.145, 0.118, 0.087, 0.058, 0.038, 0.027, 0.022, 0.02],
  hb: [0, 0.03, 0.058, 0.085, 0.11, 0.132, 0.148, 0.153, 0.147, 0.13, 0.104, 0.075, 0.049, 0.032, 0.023, 0.019, 0.018],
  cy: [-0.035, -0.03, -0.024, -0.016, -0.008, -0.002, 0.004, 0.008, 0.01, 0.011, 0.011, 0.011, 0.01, 0.01, 0.01, 0.01, 0.01],
};

const prof = (P, z) => {
  // profiles are tabulated nose (z = 0.5) to tail; flip for increasing lookups
  const Z = P.z.slice().reverse();
  const f = (arr) => smooth(Z, arr.slice().reverse(), z);
  return { hw: Math.max(0, f(P.hw)), ht: Math.max(0, f(P.ht)), hb: Math.max(0, f(P.hb)), cy: f(P.cy) };
};
export const FISH_PROFILE = { glintfin: GLINT, spiralback: SPIRAL, lanternjack: LANTERN };
export function fishSection(species, z) { return prof(FISH_PROFILE[species], z); }

const tOf = (z) => 0.5 - z;

/** Body stations: denser at the snout and the peduncle. */
function stations(z0, z1, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    // ease-in-out spacing (more rings at both ends)
    const e = 0.5 - 0.5 * Math.cos(Math.PI * u);
    out.push(z0 + (z1 - z0) * (0.35 * u + 0.65 * e));
  }
  return out;
}

/**
 * The lofted body. opts: { ex, ey, eyb (belly keel exponent), eye: { y, z, r, bulge }, keel }
 */
function body(B, P, nA, nS, zTail, opts = {}) {
  const Z = stations(0.497, zTail, nS);
  const ring = (i) => {
    const z = Z[i];
    const s = prof(P, z);
    return { z, hw: Math.max(s.hw, 1e-4), ht: Math.max(s.ht, 1e-4), hb: Math.max(s.hb, 1e-4), cy: s.cy, ex: opts.ex ?? 0.92, ey: opts.ey ?? 0.95, eyb: opts.eyb ?? 1.0 };
  };
  const eyes = opts.eyes || (opts.eye ? [opts.eye] : []);
  loft(B, nS, ring, nA, (i, j, th) => ({ aF: [0, tOf(Z[i]), 0, 0], aR: [0, 0, 0, th / TAU] }), {
    noseApex: { p: [0, prof(P, 0.5).cy, 0.5], n: [0, 0, 1], a: { aF: [0, 0, 0, 0], aR: [0, 0, 0, 0] } },
    tailApex: null,
  });
  // eye bulges: push body vertices near the eye outward (a dome), so the eye reads in silhouette
  for (const eye of eyes) {
    for (let v = 0; v < B.count; v++) {
      const part = B.attrs.aF.data[v * 4];
      if (part !== 0) continue;
      const x = B.pos[v * 3], y = B.pos[v * 3 + 1], z = B.pos[v * 3 + 2];
      if (Math.abs(x) < 1e-5) continue;
      const d = Math.hypot(y - eye.y, (z - eye.z) * 0.95) / eye.r;
      if (d >= 1.25) continue;
      const k = Math.max(0, 1 - d * d / 1.5625);
      B.pos[v * 3] = x + Math.sign(x) * eye.bulge * k * k;
    }
  }
  return Z;
}

// ------------------------------------------------------------------------------------------
// The hero LOD (the nearest few dozen fish): a denser loft whose surface is sculpted before its
// normals are taken: compressed, keeled sections; eyes set in sockets (a corneal dome, a groove
// and a bony rim); the operculum as a raised plate with a stepped free edge and a preopercle
// groove; lips and a slight gape along the mouth line (an underslung jaw on the jack); keels on
// the caudal peduncle. The mouth and gill-cover curves match the ones fishMat.js paints.
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const FISH_HEAD = {
  glintfin: { oper: 0.352, plate: 0.0042, mouthZ: 0.455, mouth: (z) => { const g = z - 0.5; return -0.006 + g * 0.05 - g * g * 2.2; }, mw: 0.0034, crease: 0.0045, lip: 0.0019, gape: 0.0034, under: 0.007, keel: 0.0006, belly: 0.3 },
  spiralback: { oper: 0.345, plate: 0.0052, mouthZ: 0.445, mouth: (z) => { const g = z - 0.5; return -0.012 + g * 0.06 - g * g * 2.0; }, mw: 0.004, crease: 0.0055, lip: 0.0024, gape: 0.0034, under: 0, keel: 0.0035, belly: 0.16 },
  // the jack's gape runs back under its eyes to the jaw angle, sagging in a sinister curve
  lanternjack: { oper: 0.31, plate: 0.0085, mouthZ: 0.335, mouth: (z) => jackMouth(z), mw: 0.0065, crease: 0.011, lip: 0.0046, gape: 0.004, under: 0.016, keel: 0.005, belly: 0.12, brow: 0.009 },
};
/** The lanternjack's mouth line (rest pose, local units); fishMat.js has the same curve. */
export function jackMouth(z) {
  const g = Math.min(Math.max(0.5 - z, 0), 0.17);
  return -0.03 + g * 0.12 - 0.3 * g * (0.17 - g);
}
/** The jaw joint the lower jaw swings down about (y, z). */
export const JACK_JAW = { y: -0.014, z: 0.322 };
function sculpt(p, th, P, H, eyes) {
  let [x, y, z] = p;
  const sd = x >= 0 ? 1 : -1;
  const s = prof(P, z);
  const phi = Math.atan2(Math.abs(x), y - 0.005);
  const cth = Math.cos(th);
  // compressed, keeled belly: the section narrows toward the ventral midline
  if (cth < 0) x *= 1 - H.belly * Math.pow(-cth, 1.6);
  // radial direction of the section (for raising plates)
  const rx = Math.abs(Math.sin(th)) * sd, ry = cth;
  let raise = 0;
  // operculum: a raised plate in front of its free edge, a step down onto the body behind it
  const opz = H.oper + 0.016 * Math.cos(phi * 1.15);
  const taper = smoothstep(0.45, 0.8, phi) * smoothstep(2.8, 2.35, phi);
  const dz = z - opz;
  raise += H.plate * taper * (smoothstep(-0.0015, 0.004, dz) * (1 - smoothstep(0.012, 0.075, dz)) - 0.35 * Math.exp(-(((dz + 0.004) / 0.005) ** 2)));
  // the preopercle: a shallow curved groove in front of the plate
  const pz = opz + 0.045 + 0.01 * Math.cos(phi * 1.4);
  raise -= H.plate * 0.45 * taper * Math.exp(-(((z - pz) / 0.004) ** 2));
  // eye sockets: corneal dome, a groove round it and a bony rim
  for (const eye of eyes) {
    const d = Math.hypot(y - eye.y, (z - eye.z) * 0.95) / eye.r;
    if (d < 2.2) {
      const b = eye.bulge;
      const dome = d < 1 ? (1 - d * d) ** 1.5 : 0;
      const k = b * (dome - 0.3 * Math.exp(-(((d - 1.06) / 0.11) ** 2)) + 0.32 * Math.exp(-(((d - 1.4) / 0.22) ** 2)));
      x += sd * k;
    }
  }
  // the jack's armour: a heavy brow ridge arching over its eye cluster, and a bony crest of
  // plates down the middle of the skull (wobbling, never ruled)
  if (H.brow) {
    const by = 0.085 + (z - 0.4) * 0.55 + 0.004 * Math.sin(z * 90.0);
    const ridge = Math.exp(-(((y - by) / 0.012) ** 2)) * smoothstep(0.3, 0.36, z) * smoothstep(0.49, 0.44, z);
    raise += H.brow * ridge;
    const crest = Math.exp(-((phi / 0.16) ** 2)) * smoothstep(0.27, 0.34, z) * smoothstep(0.47, 0.42, z);
    raise += H.brow * 0.8 * crest * (0.8 + 0.2 * Math.sin(z * 160.0));
  }
  // mouth: a crease along the gape line, lips either side, the lower jaw dropped a little
  if (z > H.mouthZ - 0.006 && Math.abs(x) > 1e-5) {
    const k = smoothstep(H.mouthZ - 0.006, H.mouthZ + 0.012, z);
    const dy = y - H.mouth(z);
    const w = H.mw;
    raise -= H.crease * k * Math.exp(-((dy / w) ** 2));
    raise += H.lip * k * Math.exp(-(((Math.abs(dy) - 1.8 * w) / (0.9 * w)) ** 2));
    if (dy < 0) y -= H.gape * k * smoothstep(0, -2.5 * w, dy);
    // the jack's underslung jaw: the upper snout sits back, the lower jaw juts
    if (H.under > 0 && dy > 0) z -= H.under * smoothstep(0.44, 0.5, z) * smoothstep(0, 2 * w, dy);
  }
  // keels on the caudal peduncle
  raise += H.keel * Math.exp(-(((phi - 1.57) / 0.22) ** 2)) * smoothstep(0.12, 0.24, -z);
  x += rx * raise;
  y += ry * raise * 0.6;
  void s;
  return [x, y, z];
}

function heroBody(B, P, nA, nS, zTail, species, opts) {
  const { sub, cross, norm, dot, mul } = V3;
  const H = FISH_HEAD[species];
  const Z = stations(0.497, zTail, nS);
  const TH = Array.from({ length: nA }, (_, j) => (j / nA) * TAU);
  const G = [];
  for (let i = 0; i < nS; i++) {
    const z = Z[i], r = prof(P, z);
    const row = [];
    for (let j = 0; j < nA; j++) {
      const th = TH[j], sn = Math.sin(th), c = Math.cos(th);
      const x = Math.max(r.hw, 1e-4) * spow(sn, opts.ex);
      const y = r.cy + (c >= 0 ? Math.max(r.ht, 1e-4) * spow(c, opts.ey) : Math.max(r.hb, 1e-4) * spow(c, opts.eyb));
      row.push(sculpt([x, y, z], th, P, H, opts.eyes || (opts.eye ? [opts.eye] : [])));
    }
    G.push(row);
  }
  const grid = [];
  for (let i = 0; i < nS; i++) {
    const row = [];
    const cy = prof(P, Z[i]).cy;
    for (let j = 0; j < nA; j++) {
      const p = G[i][j];
      const pl = G[i][(j + 1) % nA], pr = G[i][(j - 1 + nA) % nA];
      const qa = G[Math.min(nS - 1, i + 1)][j], qb = G[Math.max(0, i - 1)][j];
      let n = norm(cross(sub(pl, pr), sub(qb, qa)));
      if (dot(n, [p[0], p[1] - cy, 0]) < 0) n = mul(n, -1);
      if (!isFinite(n[0]) || Math.hypot(n[0], n[1], n[2]) < 0.5) n = [0, 0, i < nS / 2 ? 1 : -1];
      row.push(B.v(p, n, { aF: [0, tOf(Z[i]), 0, 0], aR: [0, 0, 0, TH[j] / TAU] }));
    }
    grid.push(row);
  }
  for (let i = 0; i < nS - 1; i++) for (let j = 0; j < nA; j++) {
    B.quadO(grid[i][j], grid[i][(j + 1) % nA], grid[i + 1][(j + 1) % nA], grid[i + 1][j]);
  }
  // the snout tip (the jack's is its jutting lower jaw)
  const n0 = prof(P, 0.5);
  const ap = B.v([0, n0.cy, 0.5], [0, 0, 1], { aF: [0, 0, 0, 0], aR: [0, 0, 0, 0] });
  for (let j = 0; j < nA; j++) B.triO(ap, grid[0][j], grid[0][(j + 1) % nA]);
}

/** Close the peduncle with a small cap so the caudal fin root never shows a hole. */
function capTail(B, P, z, nA, tIdxAttr) {
  const s = prof(P, z);
  const c = B.v([0, s.cy, z - 0.004], [0, 0, -1], { aF: [0, tOf(z), 0, 0], aR: [0, 0, 0, 0.5] });
  const ring = [];
  for (let j = 0; j < nA; j++) {
    const th = (j / nA) * TAU;
    const x = s.hw * spow(Math.sin(th), 0.92), y = s.cy + (Math.cos(th) >= 0 ? s.ht : s.hb) * spow(Math.cos(th), 0.95);
    ring.push(B.v([x, y, z], [Math.sin(th), Math.cos(th), -0.4], { aF: [0, tOf(z), 0, 0], aR: [0, 0, 0, th / TAU] }));
  }
  for (let j = 0; j < nA; j++) B.triO(c, ring[(j + 1) % nA], ring[j]);
  void tIdxAttr;
}

/**
 * A median fin (dorsal, anal, caudal lobes): rays from base points to tips, in the x = 0 plane
 * (two-sided). base(k) and tip(k) give [y, z] for ray k of nR; mid(k) optional curve control.
 */
function medianFin(B, part, nR, nSeg, base, tip, mid, tRoot, extra = {}) {
  const roots = [], tips = [], mids = mid ? [] : null;
  for (let k = 0; k < nR; k++) {
    const u = nR === 1 ? 0 : k / (nR - 1);
    const b = base(u), t = tip(u);
    roots.push([0, b[0], b[1]]);
    tips.push([0, t[0], t[1]]);
    if (mid) { const m = mid(u); mids.push([0, m[0], m[1]]); }
  }
  membrane(B, roots, tips, nSeg, (k, s, side, p) => {
    const u = nR === 1 ? 0 : k / (nR - 1);
    // fins ride the body wave at their own position (caudal at the peduncle)
    const t = extra.fixedT ?? tOf(p[2]);
    return { aF: [part, t, s, side], aR: [roots[k][0], roots[k][1], roots[k][2], u] };
  }, { mids, normalHint: [1, 0, 0] });
  void tRoot;
}

/** A paired fin on both flanks (pectoral, pelvic): built on the right side and mirrored. */
function pairedFin(B, part, nR, nSeg, rootFn, tipFn, midFn, normalHint) {
  for (const side of [1, -1]) {
    const roots = [], tips = [], mids = midFn ? [] : null;
    for (let k = 0; k < nR; k++) {
      const u = nR === 1 ? 0 : k / (nR - 1);
      const r = rootFn(u), t = tipFn(u);
      roots.push([r[0] * side, r[1], r[2]]);
      tips.push([t[0] * side, t[1], t[2]]);
      if (midFn) { const m = midFn(u); mids.push([m[0] * side, m[1], m[2]]); }
    }
    const hinge = roots[0];
    membrane(B, roots, tips, nSeg, (k, s, sd, p) => {
      const u = nR === 1 ? 0 : k / (nR - 1);
      return { aF: [part, tOf(hinge[2]), s, side], aR: [hinge[0], hinge[1], hinge[2], u] };
    }, { mids, normalHint: [normalHint[0] * side, normalHint[1], normalHint[2]] });
  }
}

/**
 * A curved, tapering spike of bone (fang, horn, spine): nSides-gon rings along a quadratic path
 * from root through mid to tip, closed with a point. aF / aR as for the body (part 11).
 */
function spike(B, root, mid, tip, r0, nSides, nSeg, kind, tRoot) {
  const path = [], radii = [];
  for (let i = 0; i <= nSeg; i++) {
    const u = i / nSeg;
    const w0 = (1 - u) * (1 - u), w1 = 2 * u * (1 - u), w2 = u * u;
    path.push([root[0] * w0 + mid[0] * w1 + tip[0] * w2, root[1] * w0 + mid[1] * w1 + tip[1] * w2, root[2] * w0 + mid[2] * w1 + tip[2] * w2]);
    radii.push(r0 * Math.pow(1 - u * 0.97, 1.1));
  }
  const t = tRoot ?? tOf(root[2]);
  tube(B, path, radii, nSides, (i, j, u) => ({ aF: [11, t, u, kind], aR: [root[0], root[1], root[2], j / nSides] }), { capEnd: true });
}

/** The body surface's x at height y on the section at z (for rooting teeth and spines). */
function surfX(P, z, y, ex = 0.88, ey = 0.92, eyb = 1.12) {
  const s = prof(P, z);
  const h = y >= s.cy ? s.ht : s.hb;
  const c = Math.min(1, Math.abs(y - s.cy) / Math.max(h, 1e-4));
  const cth = Math.pow(c, 1 / (y >= s.cy ? ey : eyb));
  return s.hw * Math.pow(Math.sqrt(Math.max(0, 1 - cth * cth)), ex);
}

// ------------------------------------------------------------------------------------------
// Glintfin: a small silver bait fish (herring-like, laterally compressed, keeled belly, deeply
// forked tail) gone strange: mirror-plated flanks, a glass-clear head through which the skull,
// the eye's bony orbit and the red gill arches show (painted in fishMat.js), an underslung jaw
// of needle teeth, and three pairs of paired fins: long iridescent "glint fins" (pectorals)
// flared as a flash signal when the school is threatened, pelvics, and a trailing pair of
// thread-fins streaming behind the belly.
export const GLINT_EYE = { y: 0.014, z: 0.432, r: 0.0195 };

export function buildGlintfin(near = true, hero = false) {
  const B = new Builder(FISH_ATTRS);
  const nA = hero ? 28 : near ? 12 : 4;
  const nS = hero ? 44 : near ? 15 : 5;
  const zT = -0.3;
  const Rn = (n) => (hero ? Math.round(n * 1.7) : n), Sg = (n) => (hero ? n + 2 : n);
  if (hero) heroBody(B, GLINT, nA, nS, zT, 'glintfin', { ex: 0.9, ey: 0.95, eyb: 1.3, eye: { ...GLINT_EYE, bulge: 0.0055 } });
  else body(B, GLINT, nA, nS, zT, { ex: near ? 0.9 : 1, ey: near ? 0.95 : 1, eyb: near ? 1.18 : 1, eye: near ? { ...GLINT_EYE, bulge: 0.006 } : null });
  capTail(B, GLINT, zT, nA);
  // deeply forked caudal fin: two long slender lobes from the peduncle
  const tC = tOf(zT);
  const nRc = near ? Rn(7) : 3, nSc = near ? Sg(3) : 1;
  medianFin(B, 1, nRc, nSc,
    (u) => [0.016 - u * 0.032, zT + 0.006],
    (u) => {
      // fork: lobe tips at the ends, notch in the middle
      const a = (u - 0.5) * 2; // -1 bottom .. 1 top
      const fork = Math.abs(a);
      const len = 0.065 + 0.18 * Math.pow(fork, 1.6);
      return [a * (0.022 + 0.115 * fork), zT - len];
    }, null, tC, { fixedT: tC });
  // single dorsal fin, mid-back
  if (near) {
    medianFin(B, 2, Rn(6), Sg(2),
      (u) => { const z = 0.2 - u * 0.13; const s = prof(GLINT, z); return [s.cy + s.ht - 0.004, z]; },
      (u) => { const z = 0.17 - u * 0.15; const s = prof(GLINT, 0.2 - u * 0.13); return [s.cy + s.ht + 0.068 * (1 - u) ** 1.2 + 0.008, z - 0.022]; },
      null, 0);
    // anal fin
    medianFin(B, 3, Rn(5), Sg(2),
      (u) => { const z = -0.08 - u * 0.12; const s = prof(GLINT, z); return [s.cy - s.hb + 0.004, z]; },
      (u) => { const z = -0.08 - u * 0.12; const s = prof(GLINT, z); return [s.cy - s.hb - 0.04 * (1 - u) - 0.008, z - 0.03]; },
      null, 0);
    // pelvic fins: small, under the belly
    pairedFin(B, 5, 3, 1,
      (u) => { const z = 0.07 - u * 0.03; const s = prof(GLINT, z); return [s.hw * 0.35, s.cy - s.hb * 0.92, z]; },
      (u) => { const z = 0.07 - u * 0.03; return [0.03, prof(GLINT, z).cy - prof(GLINT, z).hb - 0.012, z - 0.055]; },
      null, [0.3, -1, 0]);
    // thread-fins: a third pair, two long filament rays streaming back from the throat
    pairedFin(B, 5, 2, hero ? 5 : 3,
      (u) => { const z = 0.22 - u * 0.012; const s = prof(GLINT, z); return [s.hw * 0.4, s.cy - s.hb * 0.9, z]; },
      (u) => [0.03 + u * 0.004, -0.11 + u * 0.01, 0.22 - 0.36 - u * 0.03],
      (u) => [0.024, -0.1, 0.22 - 0.16 - u * 0.01],
      [0.2, -1, 0]);
    if (hero) {
      // needle teeth standing out of the underslung lower jaw
      for (const sd of [1, -1]) {
        for (let k = 0; k < 5; k++) {
          const z = 0.488 - k * 0.011;
          const y = FISH_HEAD.glintfin.mouth(z) - 0.002;
          const x = surfX(GLINT, z, y, 0.9, 0.95, 1.3) * 0.95 * sd;
          const len = 0.007 + 0.006 * (1 - k / 4) * (k === 1 ? 1.4 : 1);
          spike(B, [x, y, z], [x * 1.08, y + len * 0.6, z + len * 0.15], [x * 1.12, y + len, z - len * 0.1], 0.0016, 3, 1, 0);
        }
      }
    }
    // glint fins (pectorals): long, swept back along the lower flank behind the gill cover
    pairedFin(B, 4, Rn(5), Sg(3),
      (u) => { const z = 0.335 - u * 0.03; const s = prof(GLINT, z); return [s.hw * 0.92, s.cy - s.hb * 0.42 + u * 0.022, z]; },
      (u) => [0.06 + u * 0.012, -0.03 + u * 0.022 - (1 - u) * 0.012, 0.335 - 0.25 - u * 0.05 + (1 - u) * 0.02],
      (u) => [0.062 + u * 0.004, -0.018 + u * 0.016, 0.335 - 0.12 - u * 0.04],
      [0.4, 1, 0]);
  } else {
    // far: a single dorsal sliver keeps the silhouette
    medianFin(B, 2, 2, 1,
      (u) => { const z = 0.2 - u * 0.13; const s = prof(GLINT, z); return [s.cy + s.ht - 0.004, z]; },
      (u) => { const z = 0.17 - u * 0.15; const s = prof(GLINT, 0.2 - u * 0.13); return [s.cy + s.ht + 0.07 * (1 - u) + 0.01, z - 0.02]; },
      null, 0);
  }
  return B.build(true);
}

// ------------------------------------------------------------------------------------------
// Spiralback: a mid-size torpedo fish (mackerel / bonito / sailfish) with helical banding, a tall
// dorsal crest twisted into a corkscrew whose upper edge rolls into a fiddlehead spiral (the
// shader twists, curls and unfurls it), a fluted corkscrew bill like a narwhal's tusk, finlets,
// keeled peduncle, crescent tail and long sickle pectorals spread to glide in leaps.
export const SPIRAL_EYE = { y: 0.021, z: 0.428, r: 0.0205 };

export function buildSpiralback(near = true, hero = false) {
  const B = new Builder(FISH_ATTRS);
  const nA = hero ? 32 : near ? 16 : 6;
  const nS = hero ? 48 : near ? 18 : 6;
  const zT = -0.305;
  const Rn = (n) => (hero ? Math.round(n * 1.6) : n), Sg = (n) => (hero ? n + 2 : n);
  if (hero) heroBody(B, SPIRAL, nA, nS, zT, 'spiralback', { ex: 0.86, ey: 0.9, eyb: 1.1, eye: { ...SPIRAL_EYE, bulge: 0.0075 } });
  else body(B, SPIRAL, nA, nS, zT, { ex: near ? 0.86 : 1, ey: near ? 0.9 : 1, eyb: 0.95, eye: near ? { ...SPIRAL_EYE, bulge: 0.008 } : null });
  capTail(B, SPIRAL, zT, nA);
  const tC = tOf(zT);
  // lunate caudal fin
  const nRc = near ? Rn(9) : 3, nSc = near ? Sg(3) : 1;
  medianFin(B, 1, nRc, nSc,
    (u) => [0.014 - u * 0.028, zT + 0.008],
    (u) => {
      const a = (u - 0.5) * 2;
      const fa = Math.abs(a);
      // crescent: long swept lobes, shallow concave trailing edge
      return [a * (0.035 + 0.15 * Math.pow(fa, 0.8)), zT - 0.07 - 0.12 * Math.pow(fa, 1.5) + (1 - fa) * 0.015];
    },
    (u) => { const a = (u - 0.5) * 2; return [a * 0.05, zT - 0.05 - 0.05 * Math.abs(a)]; }, tC, { fixedT: tC });
  // the spiral sail: tall dorsal fin from the nape to mid-back (straight here, curled in the shader)
  const nRs = near ? Rn(12) : 3, nSs = near ? Sg(7) : 2;
  medianFin(B, 2, nRs, nSs,
    (u) => { const z = 0.3 - u * 0.36; const s = prof(SPIRAL, z); return [s.cy + s.ht - 0.004, z]; },
    (u) => {
      const z0 = 0.3 - u * 0.36;
      const s = prof(SPIRAL, z0);
      // tallest at the front, falling to the rear; rays rake back
      const h = 0.25 * Math.pow(1 - u, 0.7) * (0.35 + 0.65 * Math.sin(Math.min(1, u * 3 + 0.25) * Math.PI * 0.5)) + 0.012;
      return [s.cy + s.ht + h, z0 - h * 0.45];
    }, null, 0);
  if (near) {
    // anal fin
    medianFin(B, 3, Rn(5), Sg(2),
      (u) => { const z = -0.02 - u * 0.1; const s = prof(SPIRAL, z); return [s.cy - s.hb + 0.004, z]; },
      (u) => { const z = -0.02 - u * 0.1; const s = prof(SPIRAL, z); return [s.cy - s.hb - 0.05 * (1 - u) ** 0.8 - 0.006, z - 0.04]; },
      null, 0);
    // finlets: small flags along the back and belly behind the sail and anal fin
    for (let k = 0; k < 5; k++) {
      const z = -0.1 - k * 0.04;
      const s = prof(SPIRAL, z);
      for (const top of [1, -1]) {
        const y0 = top > 0 ? s.cy + s.ht - 0.002 : s.cy - s.hb + 0.002;
        const roots = [[0, y0, z + 0.008], [0, y0, z - 0.012]];
        const tips = [[0, y0 + top * 0.026, z - 0.014], [0, y0 + top * 0.012, z - 0.024]];
        membrane(B, roots, tips, 1, (kk, ss, side) => ({ aF: [8, tOf(z), ss, side], aR: [0, y0, z, kk] }), { normalHint: [1, 0, 0] });
      }
    }
    // pelvic fins
    pairedFin(B, 5, 3, 1,
      (u) => { const z = 0.25 - u * 0.03; const s = prof(SPIRAL, z); return [s.hw * 0.3, s.cy - s.hb * 0.95, z]; },
      (u) => [0.03, prof(SPIRAL, 0.25).cy - prof(SPIRAL, 0.25).hb - 0.02, 0.25 - 0.07 - u * 0.02],
      null, [0.3, -1, 0]);
  }
  // the corkscrew bill: a fluted tusk with three helical ridges, twisting ~2.5 turns to its tip
  {
    const n0 = prof(SPIRAL, 0.49);
    const nR = hero ? 12 : near ? 9 : 3, nSg = hero ? 14 : near ? 9 : 2;
    const L = 0.2, r0 = 0.0125;
    const rows = [];
    for (let i = 0; i <= nSg; i++) {
      const u = i / nSg;
      const z = 0.485 + u * L;
      const cy = n0.cy - 0.002 - 0.008 * u * u;
      const rr = r0 * Math.pow(1 - u * 0.96, 0.9);
      const row = [];
      for (let j = 0; j < nR; j++) {
        const a = (j / nR) * TAU;
        const f = near ? 1 + 0.28 * Math.cos(3 * (a + u * TAU * 2.5)) : 1;
        const x = Math.sin(a) * rr * f, y = Math.cos(a) * rr * f;
        row.push(B.v([x, cy + y, z], [Math.sin(a), Math.cos(a), 0.15], { aF: [11, 0, u, 3], aR: [0, cy, 0.485, j / nR] }));
      }
      rows.push(row);
    }
    for (let i = 0; i < nSg; i++) for (let j = 0; j < nR; j++) B.quadO(rows[i][j], rows[i][(j + 1) % nR], rows[i + 1][(j + 1) % nR], rows[i + 1][j]);
    const tip = B.v([0, n0.cy - 0.012, 0.485 + L + 0.004], [0, 0, 1], { aF: [11, 0, 1, 3], aR: [0, 0, 0.485, 0] });
    for (let j = 0; j < nR; j++) B.triO(tip, rows[nSg][j], rows[nSg][(j + 1) % nR]);
  }
  // long sickle pectorals (glide wings in a leap)
  pairedFin(B, 4, near ? Rn(6) : 2, near ? Sg(4) : 1,
    (u) => { const z = 0.33 - u * 0.045; const s = prof(SPIRAL, z); return [s.hw * 0.95, s.cy - s.hb * 0.15 + u * 0.015, z]; },
    (u) => [0.07 + u * 0.018, -0.015 + u * 0.02, 0.33 - 0.25 + u * 0.05 - (1 - u) * 0.02],
    (u) => [0.08 + u * 0.006, -0.01 + u * 0.015, 0.33 - 0.12 - u * 0.02],
    [0.25, 1, 0]);
  return B.build(true);
}

// ------------------------------------------------------------------------------------------
// Lanternjack: the open sea's hunter, a monster built on a jack (giant trevally / tarpon) and a
// deep-sea angler: a massive armoured head with a brow ridge and a crown of backswept horns,
// THREE eyes a side in a spider-like cluster, a cavernous gape running back under the eyes whose
// lower jaw drops and splays (fishMat.js) to bare interlocking recurved fangs, opercular spines,
// spiny serrated fins and a lunate tail. Its lure: a hinged, jointed stalk (illicium) rooted on
// the brow; folded back along the crest when it cruises, swung forward to dangle a softly lit
// bulb in front of the jaws when it stalks and charges.
export const LANTERN_EYES = [
  { y: 0.045, z: 0.4, r: 0.03 },
  { y: 0.076, z: 0.366, r: 0.0155 },
  { y: 0.096, z: 0.342, r: 0.0105 },
];
export const LANTERN_EYE = LANTERN_EYES[0];
export const LANTERN_LURES = 1; // the brow stalk
/** The lure stalk's root and its joint (the pendant hangs from the joint), local units. */
export const LANTERN_LURE = { root: [0, 0.104, 0.425], joint: [0, 0.27, 0.555], bulb: [0, 0.03, 0.588] };

export function buildLanternjack(near = true, hero = false) {
  const B = new Builder(FISH_ATTRS);
  // the hero predator is seen up close: a smoother silhouette (a tight gill-cover curve, the brow)
  const nA = hero ? 40 : near ? 30 : 8;
  const nS = hero ? 56 : near ? 34 : 8;
  const zT = -0.29;
  const eyes = (b) => LANTERN_EYES.map((e, k) => ({ ...e, bulge: b * (k ? 0.75 : 1) }));
  if (hero) heroBody(B, LANTERN, nA, nS, zT, 'lanternjack', { ex: 0.88, ey: 0.92, eyb: 1.12, eyes: eyes(0.011) });
  else body(B, LANTERN, nA, nS, zT, { ex: near ? 0.88 : 1, ey: near ? 0.92 : 1, eyb: 1.05, eyes: near ? eyes(0.012) : null });
  capTail(B, LANTERN, zT, nA);
  const tC = tOf(zT);
  // lunate caudal fin, big and stiff (its trailing edge is serrated in the shader)
  medianFin(B, 1, near ? 17 : 3, near ? 6 : 1,
    (u) => [0.02 - u * 0.04, zT + 0.006],
    (u) => {
      const a = (u - 0.5) * 2, fa = Math.abs(a);
      return [a * (0.05 + 0.21 * Math.pow(fa, 0.85)), zT - 0.07 - 0.15 * Math.pow(fa, 1.6) + (1 - fa) * 0.02];
    },
    (u) => { const a = (u - 0.5) * 2; return [a * 0.07, zT - 0.05 - 0.06 * Math.abs(a)]; }, tC, { fixedT: tC });
  // first dorsal: a crest of tall venomous spines raked back, webbed only near their roots
  medianFin(B, 2, hero ? 11 : near ? 9 : 2, near ? 4 : 1,
    (u) => { const z = 0.25 - u * 0.17; const s = prof(LANTERN, z); return [s.cy + s.ht - 0.006, z]; },
    (u) => {
      const z = 0.25 - u * 0.17;
      const s = prof(LANTERN, z);
      const h = 0.13 * Math.pow(1 - u * 0.7, 1.3) * (0.82 + 0.18 * Math.sin(u * 19.0)) + 0.02;
      return [s.cy + s.ht + h, z - 0.05 - h * 0.3];
    },
    (u) => { const z = 0.25 - u * 0.17; const s = prof(LANTERN, z); return [s.cy + s.ht + 0.05, z - 0.008]; }, 0);
  // second dorsal: sickle
  medianFin(B, 9, near ? 9 : 2, near ? 4 : 1,
    (u) => { const z = 0.06 - u * 0.24; const s = prof(LANTERN, z); return [s.cy + s.ht - 0.006, z]; },
    (u) => {
      const z = 0.06 - u * 0.24;
      const s = prof(LANTERN, z);
      const h = 0.2 * Math.pow(1 - u, 2.2) + 0.018;
      return [s.cy + s.ht + h, z - 0.04 - h * 0.6];
    }, null, 0);
  // anal fin: sickle, mirroring the second dorsal
  medianFin(B, 3, near ? 8 : 2, near ? 4 : 1,
    (u) => { const z = 0.0 - u * 0.19; const s = prof(LANTERN, z); return [s.cy - s.hb + 0.006, z]; },
    (u) => {
      const z = 0.0 - u * 0.19;
      const s = prof(LANTERN, z);
      const h = 0.15 * Math.pow(1 - u, 2.2) + 0.015;
      return [s.cy - s.hb - h, z - 0.04 - h * 0.6];
    }, null, 0);
  // long falcate pectorals
  pairedFin(B, 4, near ? 7 : 2, near ? 5 : 1,
    (u) => { const z = 0.29 - u * 0.05; const s = prof(LANTERN, z); return [s.hw * 0.96, s.cy - s.hb * 0.2 + u * 0.03, z]; },
    (u) => [0.09 + u * 0.04, -0.06 + u * 0.05, 0.29 - 0.33 + u * 0.12 - (1 - u) * 0.03],
    (u) => [0.11 + u * 0.01, -0.035 + u * 0.03, 0.29 - 0.15 - u * 0.02],
    [0.3, 1, 0]);
  if (near) {
    // pelvic fins
    pairedFin(B, 5, 4, 2,
      (u) => { const z = 0.25 - u * 0.04; const s = prof(LANTERN, z); return [s.hw * 0.3, s.cy - s.hb * 0.95, z]; },
      (u) => [0.035 + u * 0.01, prof(LANTERN, 0.25).cy - prof(LANTERN, 0.25).hb - 0.05, 0.25 - 0.1 - u * 0.03],
      null, [0.3, -1, 0]);
    // ---- bone: fangs, horns and spines -------------------------------------------------------
    const H = FISH_HEAD.lanternjack;
    const sides = hero ? 4 : 3;
    const under = (z) => H.under * smoothstep(0.44, 0.5, z);
    for (const sd of [1, -1]) {
      // upper fangs: recurved daggers hanging over the lower lip, the front pair the longest
      const nU = 7;
      for (let k = 0; k < nU; k++) {
        const f = k / (nU - 1);
        const z = 0.485 - f * 0.13 - under(0.485 - f * 0.13);
        const y = jackMouth(z) + 0.004;
        const x = surfX(LANTERN, z, y) * 0.93 * sd;
        const big = k === 1 ? 1.35 : k === 0 ? 0.8 : 1.0;
        const len = (0.011 + 0.03 * Math.pow(1 - f, 1.4)) * big * (0.9 + 0.2 * Math.sin(k * 2.3 + sd));
        const r0 = 0.0028 + 0.0035 * (1 - f) * big;
        spike(B, [x, y, z], [x * 1.03, y - len * 0.6, z - len * 0.02], [x * 1.05, y - len, z - len * 0.32], r0, sides, 2, 0);
      }
      // lower fangs: they stand outside the upper lip (like a fangtooth's), riding the jaw
      const nL = 6;
      for (let k = 0; k < nL; k++) {
        const f = (k + 0.5) / nL;
        const z = 0.493 - f * 0.135;
        const y = jackMouth(z) - 0.005;
        const x = surfX(LANTERN, z, y) * 0.98 * sd;
        const big = k === 0 ? 1.3 : 1.0;
        const len = (0.009 + 0.026 * Math.pow(1 - f, 1.2)) * big * (0.9 + 0.2 * Math.sin(k * 3.1 - sd));
        const r0 = 0.0026 + 0.003 * (1 - f) * big;
        spike(B, [x, y, z], [x * 1.06, y + len * 0.6, z + len * 0.05], [x * 1.08, y + len, z - len * 0.18], r0, sides, 2, 1);
      }
      // a crown of horns along the brow ridge, swept back and out, growing toward the rear
      for (let k = 0; k < 3; k++) {
        const z = 0.43 - k * 0.042;
        const y = 0.085 + (z - 0.4) * 0.55 + 0.012;
        const x = surfX(LANTERN, z, y) * 0.92 * sd;
        const len = 0.03 + k * 0.022;
        spike(B, [x, y, z], [x + sd * len * 0.35, y + len * 0.7, z - len * 0.25], [x + sd * len * 0.55, y + len * 0.95, z - len * 0.95], 0.0075 + k * 0.002, sides + 1, hero ? 3 : 2, 2);
      }
      // the opercular spine: a long blade at the gill cover's upper corner, and two at the jaw angle
      {
        const z = 0.31, y = 0.04;
        const x = surfX(LANTERN, z, y) * 0.95 * sd;
        spike(B, [x, y, z], [x + sd * 0.02, y + 0.006, z - 0.05], [x + sd * 0.028, y - 0.004, z - 0.11], 0.009, sides + 1, hero ? 3 : 2, 2);
      }
      for (let k = 0; k < 2; k++) {
        const z = 0.33 - k * 0.012, y = -0.045 - k * 0.022;
        const x = surfX(LANTERN, z, y) * 0.95 * sd;
        spike(B, [x, y, z], [x + sd * 0.012, y - 0.008, z - 0.025], [x + sd * 0.016, y - 0.02, z - 0.055 + k * 0.012], 0.006, sides, 2, 2);
      }
    }
  }
  // ---- the lure: a jointed stalk from the brow, a pendant line and a bulb ------------------------
  {
    const L = LANTERN_LURE;
    const n = hero ? 16 : near ? 11 : 5;
    const r0 = L.root, J = L.joint;
    // the stalk arches up and forward (a cubic through two control points); the pendant hangs
    const c1 = [0, r0[1] + 0.12, r0[2] - 0.03], c2 = [0, J[1] + 0.035, J[2] - 0.075];
    const path = [], radii = [], sv = [];
    const nStalk = Math.ceil(n * 0.62), nPend = n - nStalk;
    for (let i = 0; i <= nStalk; i++) {
      const u = i / nStalk, w = 1 - u;
      const b = [w * w * w, 3 * w * w * u, 3 * w * u * u, u * u * u];
      path.push([0, b[0] * r0[1] + b[1] * c1[1] + b[2] * c2[1] + b[3] * J[1], b[0] * r0[2] + b[1] * c1[2] + b[2] * c2[2] + b[3] * J[2]]);
      // knuckled: it swells at two joints like a jointed fin spine
      const knuckle = near ? 0.0018 * (Math.exp(-(((u - 0.38) / 0.06) ** 2)) + Math.exp(-(((u - 0.72) / 0.06) ** 2))) : 0;
      radii.push(0.0085 * (1 - u * 0.6) + knuckle);
      sv.push(u * 0.6);
    }
    const bulbTop = [L.bulb[0], L.bulb[1] + 0.016, L.bulb[2]];
    for (let i = 1; i <= nPend; i++) {
      const u = i / nPend;
      // a slack line: it sags forward a little before the bulb
      path.push([0, J[1] + (bulbTop[1] - J[1]) * u, J[2] + (bulbTop[2] - J[2]) * u + 0.012 * Math.sin(u * Math.PI)]);
      radii.push(0.0024 * (1 - u * 0.3));
      sv.push(0.6 + u * 0.4);
    }
    tube(B, path, radii, near ? 5 : 3, (i) => ({ aF: [6, tOf(r0[2]), sv[Math.min(i, sv.length - 1)], 0], aR: [r0[0], r0[1], r0[2], 0] }), { capEnd: false });
    const bR = 0.017;
    ellipsoid(B, L.bulb, [bR, bR * 1.15, bR], near ? 6 : 2, near ? 9 : 4, () => ({ aF: [7, tOf(r0[2]), 1, 0], aR: [r0[0], r0[1], r0[2], 0] }));
    if (near) {
      // three short frilled barbels hang from the bulb
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * TAU + 0.4;
        const top = [L.bulb[0] + Math.sin(a) * bR * 0.5, L.bulb[1] - bR * 0.9, L.bulb[2] + Math.cos(a) * bR * 0.5];
        const pth = [], rr = [];
        for (let i = 0; i <= 3; i++) {
          const u = i / 3;
          pth.push([top[0] + Math.sin(a) * 0.012 * u, top[1] - 0.04 * u * (0.8 + 0.3 * k / 2), top[2] + Math.cos(a) * 0.012 * u - 0.01 * u * u]);
          rr.push(0.0022 * (1 - u * 0.8));
        }
        tube(B, pth, rr, 3, () => ({ aF: [7, tOf(r0[2]), 1, 1], aR: [r0[0], r0[1], r0[2], 0] }), { capEnd: true });
      }
    }
  }
  return B.build(true);
}

function normalize3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Rough per-species triangle counts (for budgets and stats). */
export function triCount(g) {
  return g.index ? g.index.count / 3 : g.attributes.position.count / 3;
}

export { lin };
