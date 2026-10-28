// Procedural fish of Vur Sok (length 1 along +Z, nose at z = +0.5, tail tip at z = -0.5; +X is the
// fish's right side, +Y its back). Each species has a detailed near mesh and a light far mesh.
//
// Vertex attributes (read by fishMat.js):
//   aF: x part (0 body, 1 caudal fin, 2 dorsal fin / sail, 3 anal fin, 4 pectoral fin,
//            5 pelvic fin, 6 lure filament, 7 lure bulb, 8 finlet, 9 second dorsal, 10 eye),
//       y t along the body (0 nose .. 1 tail tip) where the vertex rides the swimming wave,
//       z s along the fin ray / filament (0 root .. 1 tip; body: 0),
//       w side (-1 left, +1 right, 0 midline) or the lure index
//   aR: xyz the hinge (ray root / fin base) in local units, w ray index across the fin 0..1
//       (body: angle around the section 0 top, 0.25 right, 0.5 belly, 0.75 left)
import { Builder, loft, membrane, tube, ellipsoid, smooth, lin, spow, TAU } from './kit.js';

export const FISH_ATTRS = { aF: 4, aR: 4 };

// ------------------------------------------------------------------------------------------
// Profiles: body stations (z, half width, top half height, bottom half height, centre height)
const GLINT = {
  z: [0.5, 0.494, 0.48, 0.455, 0.42, 0.37, 0.3, 0.22, 0.14, 0.06, -0.02, -0.1, -0.18, -0.24, -0.28, -0.3],
  hw: [0, 0.012, 0.02, 0.028, 0.035, 0.04, 0.043, 0.044, 0.042, 0.038, 0.032, 0.025, 0.018, 0.013, 0.01, 0.0085],
  ht: [0, 0.014, 0.026, 0.039, 0.051, 0.062, 0.071, 0.075, 0.074, 0.069, 0.06, 0.048, 0.035, 0.025, 0.018, 0.016],
  hb: [0, 0.015, 0.028, 0.042, 0.056, 0.068, 0.078, 0.084, 0.083, 0.076, 0.064, 0.049, 0.034, 0.024, 0.018, 0.016],
  cy: [-0.004, -0.003, -0.001, 0.001, 0.003, 0.004, 0.005, 0.006, 0.006, 0.006, 0.007, 0.008, 0.008, 0.008, 0.008, 0.008],
};
const SPIRAL = {
  z: [0.5, 0.488, 0.465, 0.43, 0.385, 0.33, 0.26, 0.18, 0.1, 0.02, -0.06, -0.14, -0.21, -0.26, -0.29, -0.305],
  hw: [0, 0.014, 0.028, 0.042, 0.054, 0.064, 0.071, 0.074, 0.072, 0.066, 0.056, 0.044, 0.031, 0.021, 0.017, 0.016],
  ht: [0, 0.013, 0.029, 0.045, 0.059, 0.071, 0.081, 0.086, 0.085, 0.079, 0.067, 0.052, 0.036, 0.024, 0.017, 0.015],
  hb: [0, 0.014, 0.028, 0.042, 0.055, 0.066, 0.075, 0.08, 0.079, 0.073, 0.062, 0.048, 0.033, 0.022, 0.016, 0.014],
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
  const eye = opts.eye;
  loft(B, nS, ring, nA, (i, j, th) => ({ aF: [0, tOf(Z[i]), 0, 0], aR: [0, 0, 0, th / TAU] }), {
    noseApex: { p: [0, prof(P, 0.5).cy, 0.5], n: [0, 0, 1], a: { aF: [0, 0, 0, 0], aR: [0, 0, 0, 0] } },
    tailApex: null,
  });
  // eye bulges: push body vertices near the eye outward (a dome), so the eye reads in silhouette
  if (eye) {
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

// ------------------------------------------------------------------------------------------
// Glintfin: a small silver bait fish (herring-like, laterally compressed, keeled belly, deeply
// forked tail). Its alien trait: long iridescent "glint fins" (pectorals) folded along the flank,
// flared open as a flash signal when the school is threatened.
export const GLINT_EYE = { y: 0.014, z: 0.432, r: 0.0195 };

export function buildGlintfin(near = true) {
  const B = new Builder(FISH_ATTRS);
  const nA = near ? 12 : 4;
  const nS = near ? 15 : 5;
  const zT = -0.3;
  body(B, GLINT, nA, nS, zT, { ex: near ? 0.9 : 1, ey: near ? 0.95 : 1, eyb: near ? 1.18 : 1, eye: near ? { ...GLINT_EYE, bulge: 0.006 } : null });
  capTail(B, GLINT, zT, nA);
  // deeply forked caudal fin: two lobes from the peduncle
  const tC = tOf(zT);
  const nRc = near ? 7 : 3, nSc = near ? 3 : 1;
  medianFin(B, 1, nRc, nSc,
    (u) => [0.016 - u * 0.032, zT + 0.006],
    (u) => {
      // fork: lobe tips at the ends, notch in the middle
      const a = (u - 0.5) * 2; // -1 bottom .. 1 top
      const fork = Math.abs(a);
      const len = 0.075 + 0.135 * Math.pow(fork, 1.4);
      return [a * (0.03 + 0.1 * fork), zT - len];
    }, null, tC, { fixedT: tC });
  // single dorsal fin, mid-back
  if (near) {
    medianFin(B, 2, 6, 2,
      (u) => { const z = 0.2 - u * 0.13; const s = prof(GLINT, z); return [s.cy + s.ht - 0.004, z]; },
      (u) => { const z = 0.17 - u * 0.15; const s = prof(GLINT, 0.2 - u * 0.13); return [s.cy + s.ht + 0.068 * (1 - u) ** 1.2 + 0.008, z - 0.022]; },
      null, 0);
    // anal fin
    medianFin(B, 3, 5, 2,
      (u) => { const z = -0.08 - u * 0.12; const s = prof(GLINT, z); return [s.cy - s.hb + 0.004, z]; },
      (u) => { const z = -0.08 - u * 0.12; const s = prof(GLINT, z); return [s.cy - s.hb - 0.04 * (1 - u) - 0.008, z - 0.03]; },
      null, 0);
    // pelvic fins: small, under the belly
    pairedFin(B, 5, 3, 1,
      (u) => { const z = 0.07 - u * 0.03; const s = prof(GLINT, z); return [s.hw * 0.35, s.cy - s.hb * 0.92, z]; },
      (u) => { const z = 0.07 - u * 0.03; return [0.03, prof(GLINT, z).cy - prof(GLINT, z).hb - 0.012, z - 0.055]; },
      null, [0.3, -1, 0]);
    // glint fins (pectorals): long, swept back along the lower flank behind the gill cover
    pairedFin(B, 4, 5, 3,
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
// Spiralback: a mid-size torpedo fish (mackerel / bonito / mullet) with helical banding, a tall
// dorsal sail whose upper edge rolls into a fiddlehead spiral (the shader curls and unfurls it),
// finlets, keeled peduncle, crescent tail and long sickle pectorals spread to glide in leaps.
export const SPIRAL_EYE = { y: 0.021, z: 0.428, r: 0.0205 };

export function buildSpiralback(near = true) {
  const B = new Builder(FISH_ATTRS);
  const nA = near ? 16 : 6;
  const nS = near ? 18 : 6;
  const zT = -0.305;
  body(B, SPIRAL, nA, nS, zT, { ex: near ? 0.86 : 1, ey: near ? 0.9 : 1, eyb: 0.95, eye: near ? { ...SPIRAL_EYE, bulge: 0.008 } : null });
  capTail(B, SPIRAL, zT, nA);
  const tC = tOf(zT);
  // lunate caudal fin
  const nRc = near ? 9 : 3, nSc = near ? 3 : 1;
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
  const nRs = near ? 12 : 3, nSs = near ? 7 : 2;
  medianFin(B, 2, nRs, nSs,
    (u) => { const z = 0.3 - u * 0.36; const s = prof(SPIRAL, z); return [s.cy + s.ht - 0.004, z]; },
    (u) => {
      const z0 = 0.3 - u * 0.36;
      const s = prof(SPIRAL, z0);
      // tallest at the front, falling to the rear; rays rake back
      const h = 0.21 * Math.pow(1 - u, 0.7) * (0.35 + 0.65 * Math.sin(Math.min(1, u * 3 + 0.25) * Math.PI * 0.5)) + 0.012;
      return [s.cy + s.ht + h, z0 - h * 0.45];
    }, null, 0);
  if (near) {
    // anal fin
    medianFin(B, 3, 5, 2,
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
  // long sickle pectorals (glide wings in a leap)
  pairedFin(B, 4, near ? 6 : 2, near ? 4 : 1,
    (u) => { const z = 0.33 - u * 0.045; const s = prof(SPIRAL, z); return [s.hw * 0.95, s.cy - s.hb * 0.15 + u * 0.015, z]; },
    (u) => [0.07 + u * 0.018, -0.015 + u * 0.02, 0.33 - 0.25 + u * 0.05 - (1 - u) * 0.02],
    (u) => [0.08 + u * 0.006, -0.01 + u * 0.015, 0.33 - 0.12 - u * 0.02],
    [0.25, 1, 0]);
  return B.build(true);
}

// ------------------------------------------------------------------------------------------
// Lanternjack: a large predatory jack (giant trevally / tarpon) with a steep blunt head, heavy
// jaw, big scales and scutes, sickle fins and a lunate tail. Fin-lures: the front rays of the
// first dorsal fin trail long whip filaments tipped with bioluminescent bulbs (the shader sways
// them and pulses their light while the jack stalks).
export const LANTERN_EYE = { y: 0.045, z: 0.4, r: 0.03 };
export const LANTERN_LURES = 3; // whip lures on the first dorsal fin

export function buildLanternjack(near = true) {
  const B = new Builder(FISH_ATTRS);
  const nA = near ? 22 : 8;
  const nS = near ? 24 : 8;
  const zT = -0.29;
  body(B, LANTERN, nA, nS, zT, { ex: near ? 0.88 : 1, ey: near ? 0.92 : 1, eyb: 1.05, eye: near ? { ...LANTERN_EYE, bulge: 0.012 } : null });
  capTail(B, LANTERN, zT, nA);
  const tC = tOf(zT);
  // lunate caudal fin, big and stiff
  medianFin(B, 1, near ? 11 : 3, near ? 4 : 1,
    (u) => [0.02 - u * 0.04, zT + 0.006],
    (u) => {
      const a = (u - 0.5) * 2, fa = Math.abs(a);
      return [a * (0.05 + 0.2 * Math.pow(fa, 0.85)), zT - 0.07 - 0.14 * Math.pow(fa, 1.6) + (1 - fa) * 0.02];
    },
    (u) => { const a = (u - 0.5) * 2; return [a * 0.07, zT - 0.05 - 0.06 * Math.abs(a)]; }, tC, { fixedT: tC });
  // first dorsal (spiny, short) with the lure rays at its front
  medianFin(B, 2, near ? 7 : 2, near ? 3 : 1,
    (u) => { const z = 0.2 - u * 0.11; const s = prof(LANTERN, z); return [s.cy + s.ht - 0.006, z]; },
    (u) => { const z = 0.2 - u * 0.11; const s = prof(LANTERN, z); return [s.cy + s.ht + 0.07 * (1 - u * 0.75), z - 0.035]; },
    null, 0);
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
    (u) => { const z = 0.32 - u * 0.05; const s = prof(LANTERN, z); return [s.hw * 0.96, s.cy - s.hb * 0.2 + u * 0.03, z]; },
    (u) => [0.09 + u * 0.04, -0.06 + u * 0.05, 0.32 - 0.33 + u * 0.12 - (1 - u) * 0.03],
    (u) => [0.11 + u * 0.01, -0.035 + u * 0.03, 0.32 - 0.15 - u * 0.02],
    [0.3, 1, 0]);
  if (near) {
    // pelvic fins
    pairedFin(B, 5, 4, 2,
      (u) => { const z = 0.27 - u * 0.04; const s = prof(LANTERN, z); return [s.hw * 0.3, s.cy - s.hb * 0.95, z]; },
      (u) => [0.035 + u * 0.01, prof(LANTERN, 0.27).cy - prof(LANTERN, 0.27).hb - 0.05, 0.27 - 0.1 - u * 0.03],
      null, [0.3, -1, 0]);
  }
  // fin-lures: whip filaments with glowing bulbs trailing from the first dorsal fin's front rays
  const lure = (index, root, dir, len, r0, bulbR) => {
    const n = near ? 9 : 4;
    const path = [], radii = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      // a gentle droop backwards (the shader adds trailing sway)
      path.push([root[0] + dir[0] * len * u, root[1] + dir[1] * len * u - 0.04 * u * u * len, root[2] + dir[2] * len * u]);
      radii.push(r0 * (1 - 0.65 * u));
    }
    tube(B, path, radii, near ? 5 : 3, (i, j, u) => ({ aF: [6, tOf(root[2]), u, index], aR: [root[0], root[1], root[2], 0] }), { capEnd: false });
    const tip = path[n];
    ellipsoid(B, tip, [bulbR, bulbR, bulbR * 1.25], near ? 5 : 2, near ? 8 : 4, () => ({ aF: [7, tOf(root[2]), 1, index], aR: [root[0], root[1], root[2], 0] }));
  };
  const dz = (z) => { const s = prof(LANTERN, z); return [0, s.cy + s.ht + 0.02, z]; };
  const n3 = near ? 3 : 1;
  for (let k = 0; k < n3; k++) {
    const r = dz(0.2 - k * 0.025);
    lure(k, r, normalize3([0, 0.55 - k * 0.12, -0.85]), 0.34 - k * 0.07, 0.0055, 0.014 - k * 0.002);
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
