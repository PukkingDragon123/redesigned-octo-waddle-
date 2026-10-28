// Procedural bird-reptiles of Vur Sok (local frame: +Z forward, +Y up, +X right; the unit is
// the half wingspan). The meshes are parameter grids: wings, neck and tail are posed entirely by
// the vertex shader (reptileMat.js) from a bone chain and per-instance animation, so `position`
// only holds a rough rest pose. Rigid parts (torso, head, beak, crest, claws) are real geometry
// in their own joint frame.
//
// aB:  x part, y u, z v, w side (-1 left, +1 right, 0 midline)
// aB2: part data: wing surface (sign +1 top / -1 bottom, feather index, -, -);
//      tube ring (cos, sin, radius scale, -); rigid parts (-, -, -, -)
//
// Parts: 0 torso, 1 neck, 2 head, 3 upper beak / snout, 4 lower jaw, 5 crest, 6 tail, 7 tail vane,
//        8 fore wing, 9 hind wing (coilwing), 10 leg, 11 eye, 12 wrist claws
import { Builder, loft, ellipsoid, membrane, smooth, TAU } from './kit.js';

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
  torso(B, 0.115, -0.13, 0.042, 0.04, 0.048, near ? 9 : 5, near ? 12 : 6);
  // neck and tail (shader-posed tubes)
  procTube(B, 1, near ? 7 : 3, near ? 8 : 5, (u) => 0.026 - u * 0.008);
  procTube(B, 6, near ? 14 : 5, near ? 6 : 4, (u) => 0.016 * (1 - u * 0.75));
  // head: skull + long beak, the lower jaw longer than the upper (skimming), crest coil
  const nSk = near ? 8 : 4, nAk = near ? 10 : 6;
  loft(B, nSk, (i) => {
    const u = i / (nSk - 1);
    const z = -0.01 + u * 0.12;
    const w = Math.sin(Math.min(1, 0.25 + u * 0.95) * Math.PI) * 0.026 + 0.004;
    return { z, hw: w, ht: w * 1.15, hb: w * 0.95, cy: 0, ex: 0.9, ey: 0.9 };
  }, nAk, (i, j, th) => ({ aB: [2, i / (nSk - 1), th / TAU, 0] }));
  const beak = (part, z0, len, h0, droop, under) => {
    const n = near ? 10 : 4, a = near ? 8 : 4;
    loft(B, n, (i) => {
      const u = i / (n - 1);
      const z = z0 + u * len;
      const w = 0.018 * (1 - u * 0.92) + 0.001;
      const h = h0 * (1 - u * 0.85) + 0.001;
      return { z, hw: w, ht: under ? h * 0.4 : h, hb: under ? h : h * 0.35, cy: (under ? -0.012 : 0.004) - droop * u * u, ex: 0.85, ey: 0.85 };
    }, a, (i, j, th) => ({ aB: [part, i / (n - 1), th / TAU, 0] }), { tailApex: null });
  };
  beak(3, 0.1, 0.27, 0.014, 0.02, false);
  beak(4, 0.1, 0.33, 0.013, 0.026, true);
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
  if (near) {
    // eyes
    for (const side of [1, -1]) ellipsoid(B, [side * 0.024, 0.012, 0.075], [0.008, 0.009, 0.01], 4, 6, () => ({ aB: [11, 0, 0, side] }));
    // claws at the wrists (three hooked fingers, in the wrist frame)
    for (const side of [1, -1]) {
      for (let k = 0; k < 3; k++) {
        const roots = [[0, 0.004 - k * 0.004, 0], [0, -0.004 - k * 0.004, 0]];
        const tips = [[0, -k * 0.004, 0.04 - k * 0.005], [0, -0.006 - k * 0.004, 0.035 - k * 0.005]];
        membrane(B, roots, tips, 1, (kk, s, sd) => ({ aB: [12, s, k, side] }), { normalHint: [1, 0, 0] });
      }
    }
  }
  // tail vane (diamond)
  {
    const roots = [[0, 0, 0.0], [0, 0, -0.07]];
    const tips = [[0, 0.03, -0.035], [0, -0.03, -0.035]];
    membrane(B, [[0, 0, 0], [0, 0.026, -0.035], [0, 0, -0.075]], [[0, 0, 0], [0, -0.026, -0.035], [0, 0, -0.075]], 2, (k, s, sd) => ({ aB: [7, k / 2, s, sd] }), { normalHint: [1, 0, 0] });
    void roots; void tips;
  }
  // wings
  for (const side of [1, -1]) wingGrid(B, 8, near ? 22 : 7, near ? 7 : 2, side, (u) => u);
  // legs (thigh-shin-foot), posed by the shader
  for (const side of [1, -1]) procTube(B, 10, near ? 6 : 3, near ? 5 : 3, (u) => 0.012 - u * 0.007, side);
  return B.build(true);
}

// ------------------------------------------------------------------------------------------
// Coilwing: a small four-winged feathered lizard (Microraptor-like); its long tail coils into a
// spiral when it perches and streams with a feather frond in flight.
export function buildCoilwing(near = true) {
  const B = new Builder(REPTILE_ATTRS);
  torso(B, 0.17, -0.15, 0.068, 0.066, 0.07, near ? 9 : 4, near ? 10 : 5);
  procTube(B, 1, near ? 4 : 1, near ? 8 : 4, (u) => 0.045 - u * 0.008);
  procTube(B, 6, near ? 18 : 6, near ? 5 : 3, (u) => 0.026 * Math.pow(1 - u, 0.8) + 0.003);
  // head: a lizard skull, flat-topped and wedge-shaped, with a long toothed snout, heavy brow
  // ridges over the eyes and a crest of quills
  const nH = near ? 10 : 4, aH = near ? 10 : 6;
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
    const n = near ? 7 : 3;
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
    for (const side of [1, -1]) ellipsoid(B, [side * 0.027, 0.012, 0.045], [0.009, 0.0095, 0.0105], 4, 6, () => ({ aB: [11, 0, 0, side] }));
  }
  // tail frond: a fan of feathers at the tip (two-sided strip along the tail end, posed by shader)
  {
    const n = near ? 6 : 3;
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
    wingGrid(B, 8, near ? 15 : 5, near ? 5 : 1, side);
    wingGrid(B, 9, near ? 9 : 3, near ? 3 : 1, side);
    procTube(B, 10, near ? 4 : 2, near ? 4 : 3, (u) => 0.016 - u * 0.009, side);
  }
  return B.build(true);
}

export function triCount(g) { return g.index ? g.index.count / 3 : g.attributes.position.count / 3; }
