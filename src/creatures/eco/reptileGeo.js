// Procedural bird-reptiles of Vur Sok (local frame: +Z forward, +Y up, +X right; the unit is
// the half wingspan). The meshes are parameter grids: wings, neck and tail are posed entirely by
// the vertex shader (reptileMat.js) from a bone chain and per-instance animation, so `position`
// only holds a rough rest pose. Rigid parts (torso, head, beak, crest, claws) are real geometry
// in their own joint frame.
//
// aB:  x part, y u, z v, w side (-1 left, +1 right, 0 midline; 2 bone: teeth, horns, quills,
//      which ride their part's frame: y along the spike, z 0 tooth / 1 horn or quill)
//      eyes: y radius, z eye index (0 main, 1 the smaller rear eye)
// aB2: part data: wing surface (sign +1 top / -1 bottom, feather index, -, -);
//      tube ring (cos, sin, radius scale, -); rigid parts (-, -, -, -)
//
// Parts: 0 torso, 1 neck, 2 head, 3 upper beak / snout, 4 lower jaw, 5 crest, 6 tail, 7 tail vane,
//        8 fore wing, 9 hind wing (coilwing), 10 leg, 11 eye, 12 wrist claws
import { Builder, loft, ellipsoid, membrane, tube, smooth, TAU } from './kit.js';

export const REPTILE_ATTRS = { aB: 4, aB2: 4 };

// ------------------------------------------------------------------------------------------
// Skimmer (pterosaur-like). Torso, neck and head proportions in half-span units.
export const SKIMMER = {
  neckBase: [0, 0.03, 0.1],
  headBase: [0, 0.075, 0.27],
  hip: [0, -0.005, -0.12],
  tailLen: 0.42,
  shoulder: [0.035, 0.035, 0.075],
  hum: 0.13, fore: 0.2, finger: 0.66,
};
export const COILWING = {
  neckBase: [0, 0.04, 0.16],
  headBase: [0, 0.07, 0.25],
  hip: [0, 0.0, -0.13],
  tailLen: 1.15,
  shoulder: [0.05, 0.05, 0.11],
  hum: 0.2, fore: 0.27, finger: 0.5,
  hipJoint: [0.04, -0.01, -0.12],
};

function torso(B, z0, z1, hw, ht, hb, nS, nA, part = 0) {
  const T = [0, 0.15, 0.4, 0.7, 0.9, 1];
  const W = [0.35, 0.8, 1, 0.92, 0.6, 0.3];
  const H = [0.45, 0.85, 1, 0.95, 0.65, 0.3];
  loft(B, nS, (i) => {
    const u = i / (nS - 1);
    const w = smooth(T, W, u), h = smooth(T, H, u);
    return { z: z0 + (z1 - z0) * u, hw: hw * w, ht: ht * h, hb: hb * h * (1 + 0.25 * Math.sin(u * Math.PI)), cy: 0, ex: 0.9, ey: 0.95 };
  }, nA, (i, j, th) => ({ aB: [part, i / (nS - 1), th / TAU, 0] }));
}

/** A tube whose centreline the shader computes (neck, tail, legs): u along, ring in aB2. */
function procTube(B, part, nU, nSides, radius, side = 0, uMax = 1) {
  const rows = [];
  for (let i = 0; i <= nU; i++) {
    const u = (i / nU) * uMax;
    const row = [];
    for (let j = 0; j < nSides; j++) {
      const a = (j / nSides) * TAU;
      const r = radius(u);
      row.push(B.v([Math.cos(a) * r, Math.sin(a) * r, -u], [Math.cos(a), Math.sin(a), 0], { aB: [part, u, a / TAU, side], aB2: [Math.cos(a), Math.sin(a), r, 0] }));
    }
    rows.push(row);
  }
  for (let i = 0; i < nU; i++) {
    for (let j = 0; j < nSides; j++) {
      const a = rows[i][j], b = rows[i][(j + 1) % nSides], c = rows[i + 1][(j + 1) % nSides], d = rows[i + 1][j];
      // winding fixed by the shader-side frame (outward when the tube runs along -z)
      B.tri(a, d, c); B.tri(a, c, b);
    }
  }
}

/** A curved, tapering spike of bone or keratin (tooth, horn, quill) riding part `part`. */
function spike(B, part, root, mid, tip, r0, nSides, nSeg, kind) {
  const path = [], radii = [];
  for (let i = 0; i <= nSeg; i++) {
    const u = i / nSeg;
    const w0 = (1 - u) * (1 - u), w1 = 2 * u * (1 - u), w2 = u * u;
    path.push([root[0] * w0 + mid[0] * w1 + tip[0] * w2, root[1] * w0 + mid[1] * w1 + tip[1] * w2, root[2] * w0 + mid[2] * w1 + tip[2] * w2]);
    radii.push(r0 * (1 - u * 0.95));
  }
  tube(B, path, radii, nSides, (i, j, u) => ({ aB: [part, u, kind, 2] }), { capEnd: true });
}

/** A wing surface grid: u span 0..1 (root to tip), v chord 0..1, top and bottom sheets. */
function wingGrid(B, part, nU, nV, side, uWarp = (u) => u) {
  for (const sgn of [1, -1]) {
    const ids = [];
    for (let i = 0; i <= nU; i++) {
      const u = uWarp(i / nU);
      const row = [];
      for (let j = 0; j <= nV; j++) {
        const v = j / nV;
        // rest pose: a flat wing out to the side (only for bounds)
        row.push(B.v([side * (0.05 + u), sgn * 0.005, 0.05 - v * 0.3], [0, sgn, 0], { aB: [part, u, v, side], aB2: [sgn, 0, 0, 0] }));
      }
      ids.push(row);
    }
    for (let i = 0; i < nU; i++) {
      for (let j = 0; j < nV; j++) {
        const a = ids[i][j], b = ids[i + 1][j], c = ids[i + 1][j + 1], d = ids[i][j + 1];
        // the shader's surface normal is cross(dP/du, dP/dv) * sgn * side: wind to match
        if ((sgn * side) > 0) { B.tri(a, c, b); B.tri(a, d, c); } else { B.tri(a, b, c); B.tri(a, c, d); }
      }
    }
  }
}

// ------------------------------------------------------------------------------------------
export function buildSkimmer(near = true) {
  const B = new Builder(REPTILE_ATTRS);
  // torso: compact, deep-chested
  torso(B, 0.115, -0.13, 0.042, 0.04, 0.048, near ? 14 : 5, near ? 16 : 6);
  // neck and tail (shader-posed tubes)
  procTube(B, 1, near ? 10 : 3, near ? 10 : 5, (u) => 0.026 - u * 0.008);
  procTube(B, 6, near ? 20 : 5, near ? 8 : 4, (u) => 0.016 * (1 - u * 0.75));
  // head: skull + a long, hooked, toothed beak (a fish-trap of interlocking needles), horns,
  // the spiral crest fringed with spines, and four eyes
  const nSk = near ? 12 : 4, nAk = near ? 14 : 6;
  loft(B, nSk, (i) => {
    const u = i / (nSk - 1);
    const z = -0.01 + u * 0.12;
    const w = Math.sin(Math.min(1, 0.25 + u * 0.95) * Math.PI) * 0.026 + 0.004;
    return { z, hw: w, ht: w * 1.15, hb: w * 0.95, cy: 0, ex: 0.9, ey: 0.9 };
  }, nAk, (i, j, th) => ({ aB: [2, i / (nSk - 1), th / TAU, 0] }));
  const hook = (u) => Math.pow(Math.max(0, (u - 0.72) / 0.28), 2);
  const BEAK = {
    // upper: the tip curls down into a raptor's hook over the lower jaw
    up: { z0: 0.1, len: 0.29, h0: 0.015, w: (u) => 0.018 * (1 - u * 0.9) + 0.0012, h: (u) => 0.015 * (1 - u * 0.8) + 0.0015, cy: (u) => 0.004 - 0.016 * u * u - 0.03 * hook(u), z: (u) => 0.1 + u * 0.29 - 0.018 * hook(u) },
    lo: { z0: 0.1, len: 0.27, h0: 0.013, w: (u) => 0.017 * (1 - u * 0.9) + 0.001, h: (u) => 0.013 * (1 - u * 0.85) + 0.001, cy: (u) => -0.012 - 0.02 * u * u, z: (u) => 0.1 + u * 0.27 },
  };
  const beak = (part, Bk, under) => {
    const n = near ? 16 : 4, a = near ? 10 : 4;
    loft(B, n, (i) => {
      const u = i / (n - 1);
      const h = Bk.h(u);
      return { z: Bk.z(u), hw: Bk.w(u), ht: under ? h * 0.4 : h, hb: under ? h : h * 0.35, cy: Bk.cy(u), ex: 0.85, ey: 0.85 };
    }, a, (i, j, th) => ({ aB: [part, i / (n - 1), th / TAU, 0] }), { tailApex: null });
  };
  beak(3, BEAK.up, false);
  beak(4, BEAK.lo, true);
  // the spiral crest: an ammonite coil of bone and skin rising from the back of the skull
  {
    const n = near ? 40 : 10;
    const roots = [], tips = [];
    for (let k = 0; k < n; k++) {
      const u = k / (n - 1);
      const th = 0.2 + u * TAU * 1.45;
      const r = 0.085 * Math.pow(1 - u, 1.15) + 0.008;
      const c = [0, 0.065, -0.035];
      const p = [0, c[1] + Math.sin(th) * r, c[2] - Math.cos(th) * r];
      const wdt = (0.03 * (1 - u) + 0.006);
      const q = [0, c[1] + Math.sin(th) * (r - wdt), c[2] - Math.cos(th) * (r - wdt)];
      roots.push(q); tips.push(p);
    }
    membrane(B, roots, tips, near ? 2 : 1, (k, s, sd) => ({ aB: [5, k / (n - 1), s, sd] }), { normalHint: [1, 0, 0] });
  }
  // horns: a pair swept back from behind the eyes over the neck (Monster Hunter style)
  for (const side of [1, -1]) {
    const r = [side * 0.016, 0.022, 0.028];
    spike(B, 2, r, [side * 0.042, 0.052, -0.012], [side * 0.072, 0.066, -0.075], 0.0095, near ? 5 : 3, near ? 4 : 1, 1);
    if (near) {
      // a cheek spur and a brow spike
      spike(B, 2, [side * 0.02, -0.006, 0.05], [side * 0.032, -0.012, 0.03], [side * 0.036, -0.022, 0.004], 0.0045, 4, 2, 1);
      spike(B, 2, [side * 0.012, 0.026, 0.07], [side * 0.02, 0.04, 0.06], [side * 0.022, 0.046, 0.04], 0.0035, 4, 2, 1);
    }
  }
  if (near) {
    // four eyes: the main pair and a smaller rear pair above and behind (like the whales)
    for (const side of [1, -1]) {
      ellipsoid(B, [side * 0.024, 0.012, 0.075], [0.008, 0.009, 0.01], 7, 10, () => ({ aB: [11, 0.009, 0, side] }));
      ellipsoid(B, [side * 0.02, 0.02, 0.045], [0.0048, 0.0052, 0.0058], 5, 8, () => ({ aB: [11, 0.0053, 1, side] }));
    }
    // tooth rows: long, forward-raked needles that interlock outside the closed jaws
    for (const side of [1, -1]) {
      for (const [part, Bk, dir] of [[3, BEAK.up, -1], [4, BEAK.lo, 1]]) {
        const nT = 9;
        for (let k = 0; k < nT; k++) {
          const u = 0.12 + (k + (part === 4 ? 0.5 : 0)) / nT * 0.72;
          const h = Bk.h(u);
          const y = Bk.cy(u) + (dir < 0 ? -h * 0.3 : h * 0.36);
          const x = side * Bk.w(u) * 0.85;
          const z = Bk.z(u);
          // every needle its own: lengths, rake and splay vary (a few broken short)
          const h1 = (Math.sin(k * 12.9898 + side * 4.1 + part * 7.3) * 43758.5453) % 1;
          const jit = Math.abs(h1);
          const len = (0.011 + 0.013 * Math.sin(Math.min(1, u * 1.6) * Math.PI * 0.85)) * (0.6 + 0.75 * jit);
          const rake = 0.55 + 0.5 * Math.abs((h1 * 7.1) % 1);
          const spl = 0.25 + 0.45 * Math.abs((h1 * 3.7) % 1);
          spike(B, part, [x, y, z], [x + side * len * spl * 0.7, y + dir * len * 0.55, z + len * rake * 0.4], [x + side * len * spl, y + dir * len * (0.95 - rake * 0.25), z + len * rake], 0.0022, 3, 1, 0);
        }
      }
    }
    // claws at the wrists (three hooked fingers, in the wrist frame)
    for (const side of [1, -1]) {
      for (let k = 0; k < 3; k++) {
        const roots = [[0, 0.004 - k * 0.004, 0], [0, -0.004 - k * 0.004, 0]];
        const tips = [[0, -k * 0.004, 0.04 - k * 0.005], [0, -0.006 - k * 0.004, 0.035 - k * 0.005]];
        membrane(B, roots, tips, 1, (kk, s, sd) => ({ aB: [12, s, k, side] }), { normalHint: [1, 0, 0] });
      }
    }
    // quills: a ridge of raised spines down the back, longest over the shoulders
    for (let k = 0; k < 7; k++) {
      const f = k / 6;
      const z = 0.085 - f * 0.2;
      const y = 0.036 * Math.sin(Math.min(1, 0.3 + (1 - f) * 0.8) * Math.PI) + 0.006;
      const len = 0.03 + 0.045 * Math.sin((1 - f) * Math.PI * 0.8) ;
      spike(B, 0, [0, y, z], [0, y + len * 0.7, z - len * 0.3], [0, y + len * 0.9, z - len * 0.85], 0.006, 4, 2, 1);
    }
  }
  // tail vane (diamond)
  {
    const roots = [[0, 0, 0.0], [0, 0, -0.07]];
    const tips = [[0, 0.03, -0.035], [0, -0.03, -0.035]];
    membrane(B, [[0, 0, 0], [0, 0.026, -0.035], [0, 0, -0.075]], [[0, 0, 0], [0, -0.026, -0.035], [0, 0, -0.075]], 2, (k, s, sd) => ({ aB: [7, k / 2, s, sd] }), { normalHint: [1, 0, 0] });
    void roots; void tips;
  }
  // wings: the great fore wings, and a smaller hind pair of membrane stretched from leg to tail
  for (const side of [1, -1]) wingGrid(B, 8, near ? 34 : 7, near ? 11 : 2, side, (u) => u);
  for (const side of [1, -1]) wingGrid(B, 9, near ? 16 : 3, near ? 6 : 1, side, (u) => u);
  // legs (thigh-shin-foot), posed by the shader
  for (const side of [1, -1]) procTube(B, 10, near ? 8 : 3, near ? 6 : 3, (u) => 0.012 - u * 0.007, side);
  return B.build(true);
}

// ------------------------------------------------------------------------------------------
// Coilwing: a small four-winged feathered lizard (Microraptor-like); its long tail coils into a
// spiral when it perches and streams with a feather frond in flight.
export function buildCoilwing(near = true) {
  const B = new Builder(REPTILE_ATTRS);
  torso(B, 0.17, -0.15, 0.068, 0.066, 0.07, near ? 13 : 4, near ? 14 : 5);
  procTube(B, 1, near ? 6 : 1, near ? 10 : 4, (u) => 0.045 - u * 0.008);
  procTube(B, 6, near ? 28 : 6, near ? 7 : 3, (u) => 0.026 * Math.pow(1 - u, 0.8) + 0.003);
  // head: a lizard skull, flat-topped and wedge-shaped, with a long toothed snout, heavy brow
  // ridges over the eyes and a crest of quills
  const nH = near ? 14 : 4, aH = near ? 14 : 6;
  const HT = [0, 0.12, 0.3, 0.5, 0.75, 1], HW = [0.55, 0.95, 1, 0.82, 0.55, 0.22], HH = [0.6, 0.95, 0.9, 0.7, 0.48, 0.25];
  loft(B, nH, (i) => {
    const u = i / (nH - 1);
    const z = -0.02 + u * 0.17;
    const w = 0.032 * smooth(HT, HW, u) + 0.002;
    const h = 0.032 * smooth(HT, HH, u) + 0.002;
    return { z, hw: w, ht: h * 0.85, hb: h * 0.75, cy: 0.004 - u * 0.012, ex: 0.85, ey: 0.75, eyb: 1.0 };
  }, aH, (i, j, th) => ({ aB: [2, i / (nH - 1), th / TAU, 0] }), { noseApex: { p: [0, -0.007, 0.155], n: [0, 0, 1], a: { aB: [2, 1, 0, 0] } } });
  // the quill crest: a fan of thin spines raised from the crown
  {
    const n = near ? 11 : 3;
    const roots = [], tips = [];
    for (let k = 0; k < n; k++) {
      const u = k / (n - 1);
      roots.push([0, 0.03, 0.05 - u * 0.06]);
      const a = 0.35 + u * 0.9;
      const L = 0.09 - Math.abs(u - 0.35) * 0.05;
      tips.push([0, 0.03 + Math.cos(a) * L, 0.05 - u * 0.06 - Math.sin(a) * L]);
    }
    membrane(B, roots, tips, near ? 3 : 1, (k, s, sd) => ({ aB: [5, k / (n - 1), s, sd] }), { normalHint: [1, 0, 0] });
  }
  if (near) {
    for (const side of [1, -1]) {
      ellipsoid(B, [side * 0.027, 0.012, 0.045], [0.009, 0.0095, 0.0105], 7, 10, () => ({ aB: [11, 0.0095, 0, side] }));
      // backswept horns behind the eyes, and a row of needle teeth jutting from the gape
      spike(B, 2, [side * 0.02, 0.02, 0.02], [side * 0.034, 0.04, -0.01], [side * 0.04, 0.042, -0.055], 0.0065, 4, 3, 1);
      for (let k = 0; k < 6; k++) {
        const z = 0.135 - k * 0.014;
        const y = -0.006 - (z - 0.06) * 0.1 - 0.002;
        const w = 0.032 * smooth(HT, HW, (z + 0.02) / 0.17) * 0.85 + 0.002;
        const len = 0.008 + 0.005 * Math.sin(k * 1.9);
        spike(B, 2, [side * w, y, z], [side * (w + 0.002), y - len * 0.6, z + len * 0.2], [side * (w + 0.003), y - len, z + len * 0.35], 0.0018, 3, 1, 0);
      }
    }
  }
  // tail frond: a fan of feathers at the tip (two-sided strip along the tail end, posed by shader)
  {
    const n = near ? 10 : 3;
    for (const side of [1, -1]) {
      const roots = [], tips = [];
      for (let k = 0; k < n; k++) {
        const u = k / (n - 1);
        roots.push([0, 0, -u]);
        tips.push([side * (0.06 + 0.05 * Math.sin(u * Math.PI)), 0, -u - 0.04]);
      }
      membrane(B, roots, tips, 1, (k, s, sd) => ({ aB: [7, k / (n - 1), s, side] }), { normalHint: [0, 1, 0] });
    }
  }
  // four wings: fore (arm) and hind (leg), feathered
  for (const side of [1, -1]) {
    wingGrid(B, 8, near ? 26 : 5, near ? 8 : 1, side);
    wingGrid(B, 9, near ? 15 : 3, near ? 5 : 1, side);
    procTube(B, 10, near ? 6 : 2, near ? 6 : 3, (u) => 0.016 - u * 0.009, side);
  }
  return B.build(true);
}

export function triCount(g) { return g.index ? g.index.count / 3 : g.attributes.position.count / 3; }
