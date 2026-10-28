// Trees of Vur Sok: a few accents among the alien flora (contract 0.2: fewer trees, more moving
// plants). They are built with the flora's chain machinery (see Flora.js / shaders/flora.js):
// 3D trunks of twisted strands, roots gripping the rock, and hand-painted 2D canopy clumps as
// camera-facing billboards with spherically bent normals, so every crown reads as a soft painted
// volume that flutters in the wind. Far away each tree becomes a single painted impostor.
//   coilTree       spiral-trunk tree of the meadows (crowns of painted leaf clumps)
//   giantCoilTree  the colossal coil-trunk trees of the Coil Forest
//   pine           wind-bent pines on the tops of spires and stacks
//   palm, cycad    beaches and motus
//   blossomTree    the Oasis
//   motherTree     the Mother Tree on the central coiled island of the Oasis
//   giantFern      tree-sized fiddleheads (the Coil Forest)
//   impostor       far painted billboard of any of the above
import { Color } from 'three';
import { rng, lerp, clamp, TAU } from '../core/math.js';
import { SLOT } from './Painted.js';
import { FloraGeo, FloraSet, SPECIES, FLORA_PAL } from './Flora.js';
import { thin } from './Spirals.js';

const C = (h) => new Color(h);
const inst = (r, open = 1) => [r() * TAU, r() < 0.25 ? r() : 0, lerp(0.85, 1.1, r()), open];

// ---- chain helpers -------------------------------------------------------------------------------
/** Rest-pose point and direction along a rigid chain (matches the shader with no wind). */
export function chainPoint(ch, s, steps = 14) {
  let ang = ch.tilt, px = 0, py = 0, prev = 0;
  for (let i = 1; i <= steps; i++) {
    const f = i / steps, u1 = 1 - (1 - f) * (1 - f);
    if (prev >= s) break;
    const h = Math.min(u1, s) - prev;
    const a = ang + ch.curl * h * 0.5;
    px += Math.sin(a) * h * ch.L; py += Math.cos(a) * h * ch.L;
    ang += ch.curl * h;
    prev = u1;
  }
  return [ch.base[0] + Math.cos(ch.az) * px, ch.base[1] + py, ch.base[2] + Math.sin(ch.az) * px, ang];
}

/** A twisted trunk of n strands winding around its chain. */
function twistedTrunk(g, ch, o) {
  const n = o.strands ?? 3;
  for (let k = 0; k < n; k++) {
    const ph = (k / n) * TAU;
    g.tube(ch, {
      segs: o.segs ?? 14, sides: o.sides ?? 7, flex: o.flex ?? 0.05,
      r: (s) => o.r(s) * (0.55 + 0.1 * Math.sin(s * 11 + k)),
      center: (s) => { const a = ph + s * (o.turns ?? 1.3) * TAU; const R = o.r(s) * 0.62; return [Math.cos(a) * R, Math.sin(a) * R]; },
      col: (s) => o.col.clone().lerp(o.col2, 0.5 + 0.5 * Math.sin(s * 9 + k * 2.1)), acc: o.acc,
    });
  }
}

/**
 * A painted foliage pad: n clump billboards scattered in a flattened ellipsoid around `center`
 * (each on an invisible rigid stalk so it rides the tree's sway), lower clumps darker.
 */
function pad(g, center, radius, n, o) {
  const r = o.r;
  for (let i = 0; i < n; i++) {
    const az = r() * TAU, d = Math.sqrt(r()) * radius;
    const y = (r() - 0.35) * radius * (o.flat ?? 0.45);
    const ox = Math.cos(az) * d, oz = Math.sin(az) * d;
    const L = Math.hypot(ox, y, oz) + 1e-3;
    const tilt = Math.acos(clamp(y / L, -1, 1));
    const shade = lerp(0.72, 1.08, clamp(0.5 + y / (radius * 0.6), 0, 1));
    const col = (Array.isArray(o.col) ? o.col[i % o.col.length] : o.col).clone().multiplyScalar(shade);
    const size = o.size * lerp(0.7, 1.1, r()) * (1 - 0.25 * d / radius);
    g.bill({ base: center, L, az, tilt, curl: 0, kind: 0 }, { s: 1, size, slot: Array.isArray(o.slot) ? o.slot[Math.floor(r() * o.slot.length)] : o.slot, col, acc: o.acc, flex: o.flex ?? 0.25 });
  }
}

SPECIES.coilTree = (seed, H, pal = { bark: C('#5a4a3e'), bark2: C('#7a6a58'), leaf: C('#4f7f3c'), acc: C('#c9b45a'), slot: SLOT.leafA }) => {
  const r = rng(seed);
  const g = new FloraGeo();
  const trunk = { base: [0, -H * 0.02, 0], L: H * 0.62, az: r() * TAU, tilt: lerp(0.02, 0.16, r()), curl: lerp(-0.2, 0.2, r()), kind: 0 };
  twistedTrunk(g, trunk, { strands: 3, turns: lerp(0.8, 1.6, r()), r: (s) => H * lerp(0.05, 0.026, s), col: pal.bark, col2: pal.bark2, acc: pal.acc });
  // roots gripping the rock
  for (let k = 0; k < 5; k++) {
    const az = (k / 5) * TAU + r() * 0.5;
    const ch = { base: [0, H * 0.04, 0], L: H * lerp(0.12, 0.22, r()), az, tilt: lerp(1.75, 2.1, r()), curl: -0.6, kind: 0 };
    g.tube(ch, { segs: 6, sides: 6, flex: 0, r: (s) => H * lerp(0.03, 0.006, s), col: pal.bark, acc: pal.acc });
  }
  // branches spiralling up the crown, each ending in painted clumps
  const nB = 5 + Math.floor(r() * 4);
  for (let k = 0; k < nB; k++) {
    const st = lerp(0.55, 0.95, k / nB);
    const [bx, by, bz] = chainPoint(trunk, st);
    const az = k * 2.4 + r() * 0.6;
    const ch = { base: [bx, by, bz], L: H * lerp(0.22, 0.38, r()) * (1.15 - st * 0.4), az, tilt: lerp(0.95, 1.35, r()), curl: lerp(-0.9, -0.4, r()), kind: 0 };
    g.tube(ch, { segs: 6, sides: 5, flex: 0.15, r: (s) => H * lerp(0.016, 0.005, s), col: pal.bark, acc: pal.acc });
    const [ex, ey, ez] = chainPoint(ch, 1);
    pad(g, [ex, ey + H * 0.02, ez], H * lerp(0.13, 0.2, r()), 7, { r, size: H * 0.16, slot: [pal.slot, SLOT.leafC], col: pal.leaf, acc: pal.acc, flat: 0.5, flex: 0.3 });
  }
  const top = chainPoint(trunk, 1);
  pad(g, [top[0], top[1] + H * 0.04, top[2]], H * 0.2, 8, { r, size: H * 0.18, slot: pal.slot, col: pal.leaf, acc: pal.acc, flat: 0.55, flex: 0.3 });
  return { geo: g.build(), height: H, radius: H * 0.45, shadow: true, fade: [1200, 1700] };
};

SPECIES.palm = (seed, H, pal = { bark: C('#6d5d48'), bark2: C('#8d7b62'), leaf: C('#5a8a3a'), acc: C('#c7c36a') }) => {
  const r = rng(seed);
  const g = new FloraGeo();
  const trunk = { base: [0, -0.2, 0], L: H, az: r() * TAU, tilt: lerp(0.15, 0.45, r()), curl: lerp(-0.45, -0.15, r()), kind: 0 };
  g.tube(trunk, { segs: 12, sides: 7, flex: 0.12, r: (s) => H * lerp(0.03, 0.02, s) * (1 + 0.12 * Math.max(0, Math.sin(s * 70))), col: (s) => pal.bark.clone().lerp(pal.bark2, 0.5 + 0.5 * Math.sin(s * 70)), acc: pal.acc });
  const [tx, ty, tz] = chainPoint(trunk, 1);
  const n = 10 + Math.floor(r() * 5);
  for (let k = 0; k < n; k++) {
    const az = (k / n) * TAU + r() * 0.3;
    const ch = { base: [tx, ty, tz], L: H * lerp(0.38, 0.5, r()), az, tilt: lerp(0.7, 1.4, r()), curl: lerp(1.0, 1.8, r()), kind: 7 };
    g.card(ch, { segs: 7, slot: SLOT.palm, w: (s) => H * 0.17 * Math.sin(Math.PI * Math.min(1, s * 0.9 + 0.1)), col: pal.leaf, acc: pal.acc, flex: 0.5 });
  }
  for (let q = 0; q < 4; q++) g.bill({ base: [tx, ty - H * 0.03, tz], L: H * 0.03, az: r() * TAU, tilt: 1.5, curl: 0, kind: 0 }, { s: 1, size: H * 0.08, slot: SLOT.puff, col: C('#7a6a3a'), acc: C('#a08a4a'), flex: 0.1 });
  return { geo: g.build(), height: H, radius: H * 0.5, shadow: true, fade: [1000, 1500] };
};

SPECIES.blossomTree = (seed, H, pal = { bark: C('#4f4044'), bark2: C('#6d5a5a'), leaf: C('#e4a9bb'), acc: C('#fff1f4'), slot: SLOT.blossom }) => {
  const r = rng(seed);
  const g = new FloraGeo();
  const trunk = { base: [0, -H * 0.02, 0], L: H * 0.45, az: r() * TAU, tilt: lerp(0.1, 0.3, r()), curl: lerp(-0.4, 0.4, r()), kind: 0 };
  twistedTrunk(g, trunk, { strands: 2, turns: 1.1, r: (s) => H * lerp(0.05, 0.03, s), col: pal.bark, col2: pal.bark2, acc: pal.acc });
  const nB = 6 + Math.floor(r() * 4);
  for (let k = 0; k < nB; k++) {
    const st = lerp(0.5, 1.0, r());
    const [bx, by, bz] = chainPoint(trunk, st);
    const ch = { base: [bx, by, bz], L: H * lerp(0.3, 0.5, r()), az: r() * TAU, tilt: lerp(0.7, 1.3, r()), curl: lerp(-0.7, 0.1, r()), kind: 0 };
    g.tube(ch, { segs: 6, sides: 5, flex: 0.15, r: (s) => H * lerp(0.02, 0.006, s), col: pal.bark, acc: pal.acc });
    const [ex, ey, ez] = chainPoint(ch, 0.9);
    pad(g, [ex, ey + H * 0.03, ez], H * lerp(0.16, 0.24, r()), 7, { r, size: H * 0.2, slot: [pal.slot, pal.slot, SLOT.leafC], col: pal.leaf, acc: pal.acc, flat: 0.6, flex: 0.3 });
  }
  return { geo: g.build(), height: H, radius: H * 0.5, shadow: true, fade: [1200, 1700] };
};

/** Wind-bent pine on the tops of spires: a crooked leaning trunk under flat pads of needles. */
SPECIES.pine = (seed, H, pal = { bark: C('#4f4038').multiplyScalar(0.8), bark2: C('#6e5a48').multiplyScalar(0.8), leaf: C('#355a3c').multiplyScalar(0.8), acc: C('#9ab86a') }) => {
  const r = rng(seed);
  const g = new FloraGeo();
  const lean = r() * TAU;
  const trunk = { base: [0, -0.3, 0], L: H * 0.85, az: lean, tilt: lerp(0.35, 0.7, r()), curl: lerp(-0.6, -0.25, r()), kind: 0 };
  twistedTrunk(g, trunk, { strands: 2, turns: 0.7, segs: 10, sides: 6, r: (s) => H * lerp(0.045, 0.02, s), col: pal.bark, col2: pal.bark2, acc: pal.acc });
  const nP = 4 + Math.floor(r() * 3);
  for (let k = 0; k < nP; k++) {
    const st = lerp(0.55, 1.0, k / (nP - 1));
    const [bx, by, bz] = chainPoint(trunk, st);
    // flat pads swept downwind (the trunk's lean)
    const ch = { base: [bx, by, bz], L: H * lerp(0.25, 0.42, r()) * (1.2 - st * 0.5), az: lean + (r() - 0.5) * 1.6, tilt: lerp(1.35, 1.6, r()), curl: lerp(-0.25, 0.1, r()), kind: 0 };
    g.tube(ch, { segs: 4, sides: 4, flex: 0.1, r: (s) => H * lerp(0.014, 0.005, s), col: pal.bark, acc: pal.acc });
    const [ex, ey, ez] = chainPoint(ch, 0.85);
    pad(g, [ex, ey + H * 0.02, ez], H * lerp(0.14, 0.2, r()), 5, { r, size: H * 0.2, slot: SLOT.needles, col: pal.leaf, acc: pal.acc, flat: 0.25, flex: 0.25 });
  }
  return { geo: g.build(), height: H, radius: H * 0.5, shadow: true, fade: [1200, 1700] };
};

/** Cycad: a stout scaly trunk crowned with a rosette of stiff fronds. */
SPECIES.cycad = (seed, H, pal = { bark: C('#5a5040').multiplyScalar(0.8), bark2: C('#7a6e56').multiplyScalar(0.8), leaf: C('#3f6e3a').multiplyScalar(0.8), acc: C('#d2b86a') }) => {
  const r = rng(seed);
  const g = new FloraGeo();
  const trunk = { base: [0, -0.2, 0], L: H * 0.45, az: r() * TAU, tilt: lerp(0, 0.2, r()), curl: 0, kind: 0 };
  g.tube(trunk, { segs: 8, sides: 8, flex: 0, r: (s) => H * lerp(0.09, 0.07, s) * (1 + 0.1 * Math.max(0, Math.sin(s * 40))), col: (s) => pal.bark.clone().lerp(pal.bark2, 0.5 + 0.5 * Math.sin(s * 40)), acc: pal.acc });
  const [tx, ty, tz] = chainPoint(trunk, 1);
  const n = 14 + Math.floor(r() * 6);
  for (let k = 0; k < n; k++) {
    const ch = { base: [tx, ty, tz], L: H * lerp(0.5, 0.65, r()), az: (k / n) * TAU + r() * 0.2, tilt: lerp(0.5, 1.1, r()), curl: lerp(0.3, 0.7, r()), kind: 7 };
    g.card(ch, { segs: 5, slot: SLOT.palm, w: (s) => H * 0.16 * Math.sin(Math.PI * Math.min(1, s * 0.9 + 0.1)), col: pal.leaf, acc: pal.acc, flex: 0.2 });
  }
  return { geo: g.build(), height: H, radius: H * 0.6, shadow: true, fade: [900, 1300] };
};

/** A giant coil-trunk tree of the Coil Forest (many strands, crown in layered pads). */
SPECIES.giantCoilTree = (seed, H) => {
  const r = rng(seed);
  const g = new FloraGeo();
  const bark = C('#56483e').multiplyScalar(0.8), bark2 = C('#7c6a58').multiplyScalar(0.8), moss = C('#56703e').multiplyScalar(0.75);
  const leaf = [C('#3f7a5a'), C('#4f8a46'), C('#2f6a62')].map((c) => c.multiplyScalar(0.72));
  const trunk = { base: [0, -3, 0], L: H * 0.7, az: r() * TAU, tilt: lerp(0.02, 0.1, r()), curl: lerp(-0.1, 0.1, r()), kind: 0 };
  twistedTrunk(g, trunk, { strands: 5, turns: lerp(1.2, 2.0, r()), segs: 22, sides: 8, r: (s) => H * lerp(0.075, 0.035, Math.pow(s, 0.8)), col: bark, col2: bark2, acc: moss });
  for (let k = 0; k < 8; k++) {
    const az = (k / 8) * TAU + r() * 0.3;
    const ch = { base: [0, H * 0.03, 0], L: H * lerp(0.15, 0.26, r()), az: az + 0.4, tilt: lerp(1.6, 1.95, r()), curl: -0.4, kind: 0 };
    g.tube(ch, { segs: 8, sides: 6, flex: 0, r: (s) => H * lerp(0.035, 0.006, s), col: bark, acc: moss });
  }
  // layered crown pads on long limbs (the herd weaves under and between them)
  const layers = 4;
  for (let l = 0; l < layers; l++) {
    const st = lerp(0.55, 1.0, l / (layers - 1));
    const nL = l === layers - 1 ? 3 : 5;
    for (let k = 0; k < nL; k++) {
      const [bx, by, bz] = chainPoint(trunk, st);
      const ch = { base: [bx, by, bz], L: H * lerp(0.26, 0.38, r()) * (1.15 - st * 0.4), az: k * (TAU / nL) + l * 1.1 + r() * 0.4, tilt: lerp(1.15, 1.45, r()), curl: lerp(-0.7, -0.35, r()), kind: 0 };
      g.tube(ch, { segs: 8, sides: 6, flex: 0.03, r: (s) => H * lerp(0.022, 0.006, s), col: bark, acc: moss });
      const [ex, ey, ez] = chainPoint(ch, 1);
      pad(g, [ex, ey + H * 0.02, ez], H * lerp(0.13, 0.19, r()), 13, { r, size: H * 0.11, slot: [SLOT.leafB, SLOT.leafA, SLOT.leafC], col: leaf, acc: C('#c9d47a'), flat: 0.42, flex: 0.18 });
      const [mx, my, mz] = chainPoint(ch, 0.55);
      pad(g, [mx, my + H * 0.015, mz], H * 0.08, 4, { r, size: H * 0.075, slot: SLOT.leafB, col: leaf, acc: C('#c9d47a'), flat: 0.5, flex: 0.18 });
      for (let q = 0; q < 2; q++) {
        const [vx, vy, vz] = chainPoint(ch, lerp(0.3, 0.9, r()));
        g.card({ base: [vx, vy, vz], L: H * lerp(0.06, 0.16, r()), az: ch.az + Math.PI / 2, tilt: Math.PI - 0.05, curl: 0, kind: 8 }, { segs: 8, slot: SLOT.vine, w: () => H * 0.02, col: FLORA_PAL.vine.leaf, acc: FLORA_PAL.vine.acc, flex: 1 });
      }
    }
  }
  const [tx, ty, tz] = chainPoint(trunk, 1);
  pad(g, [tx, ty + H * 0.04, tz], H * 0.16, 14, { r, size: H * 0.12, slot: [SLOT.leafB, SLOT.leafA], col: leaf, acc: C('#c9d47a'), flat: 0.5, flex: 0.15 });
  return { geo: g.build(), height: H, radius: H * 0.45, shadow: true, fade: [3000, 4200] };
};

/** The Mother Tree: a colossal tree of many strands spiralling up from roots that grip the island. */
SPECIES.motherTree = (seed = 5, H = 210) => {
  const r = rng(seed);
  const g = new FloraGeo();
  const bark = C('#5d4c44').multiplyScalar(0.8), bark2 = C('#8a7766').multiplyScalar(0.8), moss = C('#58703f').multiplyScalar(0.75);
  const trunk = { base: [0, -4, 0], L: H * 0.6, az: 0.4, tilt: 0.04, curl: 0.05, kind: 0 };
  twistedTrunk(g, trunk, { strands: 7, turns: 1.6, segs: 24, sides: 9, r: (s) => H * lerp(0.13, 0.06, Math.pow(s, 0.7)), col: bark, col2: bark2, acc: moss });
  // buttress roots spiralling out over the island
  for (let k = 0; k < 11; k++) {
    const az = (k / 11) * TAU + r() * 0.3;
    const ch = { base: [Math.cos(az) * H * 0.05, H * 0.05, Math.sin(az) * H * 0.05], L: H * lerp(0.28, 0.45, r()), az: az + 0.5, tilt: lerp(1.55, 1.85, r()), curl: lerp(-0.35, -0.15, r()), kind: 0 };
    g.tube(ch, { segs: 10, sides: 7, flex: 0, r: (s) => H * lerp(0.05, 0.008, Math.pow(s, 0.8)), col: bark, acc: moss });
  }
  // great limbs spiralling up, canopy of blossom and leaf clumps, hanging vines
  const nB = 16;
  for (let k = 0; k < nB; k++) {
    const st = lerp(0.42, 1.0, k / (nB - 1));
    const [bx, by, bz] = chainPoint(trunk, st);
    const az = k * 2.39996;
    const ch = { base: [bx, by, bz], L: H * lerp(0.32, 0.5, r()) * (1.2 - st * 0.5), az, tilt: lerp(1.0, 1.4, r()), curl: lerp(-0.8, -0.35, r()), kind: 0 };
    g.tube(ch, { segs: 10, sides: 7, flex: 0.04, r: (s) => H * lerp(0.03, 0.006, s), col: bark, acc: moss });
    const mcols = [C('#e8b4c2').multiplyScalar(0.8), C('#f0c9b0').multiplyScalar(0.8), C('#5f8f4a').multiplyScalar(0.75), C('#e3a6bd').multiplyScalar(0.78)];
    for (const st2 of [0.55, 1.0]) {
      const [ex, ey, ez] = chainPoint(ch, st2);
      pad(g, [ex, ey + H * 0.02, ez], H * (st2 > 0.9 ? 0.13 : 0.08), st2 > 0.9 ? 12 : 6, { r, size: H * (st2 > 0.9 ? 0.1 : 0.08), slot: [SLOT.blossom, SLOT.blossom, SLOT.leafA, SLOT.leafC], col: mcols, acc: C('#fff3e8'), flat: 0.45, flex: 0.22 });
    }
    for (let q = 0; q < 3; q++) {
      const [vx, vy, vz] = chainPoint(ch, lerp(0.3, 0.9, r()));
      const vch = { base: [vx, vy, vz], L: H * lerp(0.08, 0.2, r()), az: az + Math.PI / 2, tilt: Math.PI - 0.05, curl: 0, kind: 8 };
      g.card(vch, { segs: 8, slot: SLOT.vine, w: () => H * 0.025, col: FLORA_PAL.vine.leaf, acc: FLORA_PAL.vine.acc, flex: 1 });
    }
  }
  const top = chainPoint(trunk, 1);
  pad(g, [top[0], top[1] + H * 0.05, top[2]], H * 0.2, 22, { r, size: H * 0.13, slot: [SLOT.blossom, SLOT.blossom, SLOT.leafA], col: [C('#efc2cf').multiplyScalar(0.8), C('#f3d2bd').multiplyScalar(0.8), C('#5f8f4a').multiplyScalar(0.75)], acc: C('#fff7ee'), flat: 0.5, flex: 0.2 });
  return { geo: g.build(), height: H, radius: H * 0.6, shadow: true, fade: [6000, 8000] };
};

/** Giant fiddleheads of the Coil Forest: tree-sized croziers. */
SPECIES.giantFern = (seed, H, pal = FLORA_PAL.fernTeal) => {
  const r = rng(seed);
  const g = new FloraGeo();
  const n = 3 + Math.floor(r() * 3);
  for (let k = 0; k < n; k++) {
    const az = (k / n) * TAU + r() * 0.8;
    const L = H * lerp(0.75, 1.0, r());
    const open = k === 0 ? false : r() < 0.4;
    const ch = { base: [Math.cos(az) * H * 0.03, 0, Math.sin(az) * H * 0.03], L, az, tilt: lerp(0.05, 0.25, r()) + (open ? 0.3 : 0), curl: open ? lerp(0.3, 0.5, r()) : lerp(0.9, 1.2, r()), kind: 1 };
    g.tube(ch, { segs: 30, sides: 10, warp: 1.7, flex: 0.15, r: (s) => L * lerp(0.028, 0.006, Math.pow(s, 0.8)), col: (s) => pal.stem.clone().lerp(pal.leaf, s * 0.6), acc: pal.acc });
    g.card(ch, { segs: 28, warp: 1.7, s0: 0.25, s1: 1, slot: SLOT.frond, w: (s) => L * 0.34 * Math.pow(Math.sin(Math.PI * clamp((s - 0.22) / 0.8, 0, 1)), 0.7), col: pal.leaf, acc: pal.acc, flex: 0.2 });
  }
  return { geo: g.build(), height: H, radius: H * 0.5, shadow: true, fade: [3000, 4200] };
};

/**
 * Far painted impostor of a tree: a single canopy billboard on an invisible stalk, faded in where
 * the 3D tree fades out. kind: coil | pine | palm | blossom | giant.
 */
SPECIES.impostor = (kind, H) => {
  const g = new FloraGeo();
  const look = {
    coil: [SLOT.leafA, C('#4f7a44').multiplyScalar(0.7), 0.62, 0.62],
    pine: [SLOT.needles, C('#3a5a40').multiplyScalar(0.7), 0.75, 0.55],
    palm: [SLOT.palm, C('#5a8a3a').multiplyScalar(0.7), 0.92, 0.6],
    blossom: [SLOT.blossom, C('#e0a8b8').multiplyScalar(0.75), 0.68, 0.7],
    giant: [SLOT.leafB, C('#3f6f58').multiplyScalar(0.7), 0.78, 0.55],
  }[kind] || [SLOT.leafA, C('#4f7a44').multiplyScalar(0.7), 0.62, 0.62];
  const ch = { base: [0, 0, 0], L: H * look[2], az: 0, tilt: 0, curl: 0, kind: 0 };
  g.bill(ch, { s: 1, size: H * look[3], slot: look[0], col: look[1], acc: look[1].clone().multiplyScalar(1.4), flex: 0 });
  return { geo: g.build(), height: H, radius: H * 0.4, shadow: false, fade: [5200, 6800, 1450, 1750] };
};


// ---- placement --------------------------------------------------------------------------------------
/**
 * Accent trees on an island's meadow crests (a few per island; the Coil Forest grows giant
 * fiddleheads). Returns a FloraSet with long fade distances.
 */
export function populateTrees(S, kind, seed, opts = {}) {
  const r = rng(seed * 7 + 11);
  const set = new FloraSet('trees');
  const meadow = (ny, y, gr) => (gr > 0.5 && ny > 0.8 && y > 6 ? gr : 0);
  const A = S.weights(meadow);
  const n = Math.round(clamp(A / (opts.per ?? 2500), 0, opts.max ?? 6));
  const grid = new Map();
  const spots = thin(S.sample(n * 3, r), opts.spacing ?? 22, grid).slice(0, n);
  for (const sm of spots) {
    const p = sm.p.clone().setY(sm.p.y - 0.3);
    if (kind === 'giantFern') {
      const v = Math.floor(r() * 3);
      set.add(`gfern-${v}`, () => SPECIES.giantFern(9500 + v, 80), p, lerp(0.6, 1.25, r()), r() * TAU, inst(r));
    } else if (kind === 'pine') {
      const v = Math.floor(r() * 3);
      set.add(`pine-${v}`, () => SPECIES.pine(9900 + v, 16), p, lerp(0.6, 1.3, r()), r() * TAU, inst(r));
    } else if (kind === 'blossom') {
      const v = Math.floor(r() * 3);
      set.add(`blossom-${v}`, () => SPECIES.blossomTree(9600 + v, 18), p, lerp(0.7, 1.3, r()), r() * TAU, inst(r));
    } else {
      const v = Math.floor(r() * 4);
      const pal = TREE_PALS[v % TREE_PALS.length];
      set.add(`coil-${v}`, () => SPECIES.coilTree(9700 + v, 22, pal), p, lerp(0.6, 1.4, r()), r() * TAU, inst(r));
    }
  }
  return set;
}

const TREE_PALS = [
  { bark: C('#5a4a3e').multiplyScalar(0.8), bark2: C('#7a6a58').multiplyScalar(0.8), leaf: C('#4f7f3c').multiplyScalar(0.75), acc: C('#c9b45a'), slot: SLOT.leafA },
  { bark: C('#4a4642').multiplyScalar(0.8), bark2: C('#6e665c').multiplyScalar(0.8), leaf: C('#3e7a6a').multiplyScalar(0.75), acc: C('#a8d0a0'), slot: SLOT.leafB },
  { bark: C('#5a463e').multiplyScalar(0.8), bark2: C('#86705a').multiplyScalar(0.8), leaf: C('#8a7a3a').multiplyScalar(0.75), acc: C('#e0b060'), slot: SLOT.leafC },
  { bark: C('#4e4048').multiplyScalar(0.8), bark2: C('#6e5a66').multiplyScalar(0.8), leaf: C('#6a5a8a').multiplyScalar(0.75), acc: C('#e6c8ff'), slot: SLOT.leafA },
];

export { SPECIES };
