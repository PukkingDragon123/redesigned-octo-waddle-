// The six fins of a Vur Sok whale in one skinned geometry: the long humpback flippers grown into
// wings (a thick fleshy arm with leading-edge tubercles, finger rays fanning back through a thin
// membrane with a scalloped trailing edge), a small rear pair, and the broad notched flukes with a
// serrated trailing edge. Per-fin dynamics (billow, flutter, tubercle flex, the torn membrane) run
// in the fin vertex shader from per-fin uniform arrays indexed by aFin.z.
import { Vector3, Quaternion, Matrix4 } from 'three';
import { GeoAcc } from './geo.js';
import { ramp } from './anatomy.js';
import { smoothstep, clamp, lerp, rng } from '../../core/math.js';

// aFin: (u span 0..1, v chord 0..1, fin id, top 1 / bottom 0)
// aFin2: (u in metres, v in metres, ray ridge 0..1, membrane flexibility 0..1)
export const FIN_LAYOUT = { aFin: 4, aFin2: 4, aTan: 3, aTex: 2, aLoft: 2, aMask: 4 };
export const FIN = { WING_R: 0, WING_L: 1, REAR_R: 2, REAR_L: 3, FLUKE_R: 4, FLUKE_L: 5 };
export const FIN_RES = [
  { nU: 88, nLoop: 46, fluke: 1 },
  { nU: 44, nLoop: 24, fluke: 0.6 },
  { nU: 22, nLoop: 12, fluke: 0.4 },
];

/** Orientation of the wing's span axis in the bind pose (outward, a slight droop and sweep). */
export function wingDir(side) {
  return new Vector3(side, -0.07, -0.12).normalize();
}

/**
 * One fin in its local frame (x outward along the span, y up, z forward), then placed by `xf`.
 * spec: { span, chordRoot, chordMax, armR, rays: [{u0, u1}], tub, scallop, serrate, sweep, droop,
 *         bulge, tipRound, camber, notch: {u, w, d}|null, kind, id, side, bones: [b0, b1, b2], parent }
 */
function addFin(acc, spec, xf, nU, nLoop, extra) {
  const { span, chordRoot, chordMax, armR, rays, side } = spec;
  const v0 = acc.count, i0 = acc.idx.length;
  const r = rng(spec.seed || 1);
  const memT = Math.max(spec.memT ?? 0.0035 * spec.L, 0.01);
  const serr = [];
  for (let i = 0; i < 40; i++) serr.push(0.6 + r() * 0.8);
  // chord along the span: root -> widest (hand) -> tip, with a scalloped / serrated trailing edge
  const chordAt = (u) => {
    let ch = lerp(chordRoot, chordMax, smoothstep(0, spec.maxAt ?? 0.32, u)) * lerp(1, spec.tipChord ?? 0.3, smoothstep(spec.maxAt ?? 0.32, 1, u) ** 1.3);
    if (u > 1 - spec.tipRound) {
      const s = (u - (1 - spec.tipRound)) / spec.tipRound;
      ch *= Math.max(Math.sqrt(Math.max(0, 1 - s * s)), 0.02);
    }
    return ch;
  };
  const teFactor = (u) => {
    let k = 1;
    if (rays.length && spec.scallop) {
      let near = 0;
      // a soft, uneven hem between the finger tips (a living membrane, never a saw edge)
      for (const ry of rays) near = Math.max(near, Math.exp(-(((u - ry.u1) / 0.085) ** 2)));
      k *= 1 - spec.scallop * (1 - near) * smoothstep(0.08, 0.2, u) * (0.75 + 0.25 * Math.sin(u * 17 + (spec.seed || 1)));
    }
    if (spec.serrate) {
      // irregular points along the trailing edge (humpback flukes)
      const x = u * 26;
      const i = Math.floor(x), f = x - i;
      const tooth = Math.pow(1 - Math.abs(f - 0.5) * 2, 2.2) * serr[i % serr.length];
      k *= 1 - spec.serrate * (1 - tooth) * smoothstep(0.05, 0.15, u);
    }
    if (spec.notch) {
      const n = spec.notch;
      const d = Math.abs(u - n.u) / n.w;
      if (d < 1) k *= 1 - n.d * (1 - d) ** 0.7 * (0.85 + 0.15 * Math.sin(u * 140));
    }
    return k;
  };
  const leAt = (u) => {
    // swept, drooping leading edge with tubercle knobs pushed forward
    let z = -spec.sweep * span * u * u + (spec.bulge || 0) * span * Math.sin(Math.PI * Math.min(1, u * 1.1));
    let tub = 0;
    if (spec.tub) {
      const uu = (u - 0.14) / 0.8;
      if (uu > 0 && uu < 1) tub = Math.pow(Math.max(0, Math.sin(Math.PI * spec.tub * uu)), 1.6) * smoothstep(0, 0.08, uu) * smoothstep(1, 0.85, uu);
    }
    z += tub * armR * 0.55 * (1 - u * 0.5);
    return { x: u * span, y: -(spec.droop || 0) * span * u * u, z, tub };
  };
  const rayDist = (u, v) => {
    // distance (metres) from (u, v) to the nearest finger ray
    let best = 1e9, which = -1;
    for (let k = 0; k < rays.length; k++) {
      const ry = rays[k];
      if (v < ry.v0 - 0.02) continue;
      const f = clamp((v - ry.v0) / (1 - ry.v0), 0, 1);
      const ur = lerp(ry.u0, ry.u1, Math.pow(f, 0.85));
      const d = Math.abs(u - ur) * span;
      if (d < best) { best = d; which = k; }
    }
    return { d: best, k: which };
  };
  const rows = [];
  for (let i = 0; i <= nU; i++) {
    const u = i / nU;
    const le = leAt(u);
    const chord = chordAt(u);
    const thick = lerp(armR, armR * (spec.tipThick ?? 0.25), u) * (1 + le.tub * 0.28);
    const row = [];
    for (let k = 0; k < nLoop; k++) {
      const ph = (k / nLoop) * Math.PI * 2;
      const v = 0.5 - 0.5 * Math.cos(ph);
      const top = Math.sin(ph) >= 0 ? 1 : -1;
      const tef = teFactor(u);
      const ch = chord * (v > 0.25 ? lerp(1, tef, smoothstep(0.25, 1, v)) : 1);
      const vArm = Math.min(0.9, (2.6 * thick) / Math.max(ch, 1e-4));
      // rounded leading edge flowing smoothly into the thin membrane (no step)
      const x = v / vArm;
      let ht = x < 1 ? thick * Math.sqrt(Math.max(0, x)) * (1 - x) ** 0.55 * 1.35 + thick * 0.05 : 0;
      if (v < 0.02) ht = thick * Math.sqrt(v / 0.02) * 0.45 + ht * (v / 0.02);
      ht = Math.max(ht, memT * (1 - Math.pow(v, 4)) * 0.5 + 0.0004 * spec.L);
      const rd = rayDist(u, v);
      const rayW = (spec.rayW ?? 0.012) * spec.L;
      const ray = rays.length ? Math.exp(-((rd.d / rayW) ** 2)) * smoothstep(rays[0].v0 - 0.04, rays[0].v0 + 0.06, v) * (1 - smoothstep(0.9, 1.0, v)) : 0;
      ht += ray * (spec.rayH ?? 0.006) * spec.L * (1 - v * 0.55);
      const px = le.x + v * ch * (spec.splay ?? 0.16) * u;
      const camber = (spec.camber ?? 0.07) * ch * Math.sin(Math.PI * Math.min(1, v * 1.05)) * Math.sin(Math.PI * Math.min(1, u * 1.15 + 0.1));
      const y = le.y + top * ht + camber;
      const z = le.z - v * ch;
      const p = new Vector3(px * side, y, z).applyMatrix4(xf);
      // flexibility: membrane between rays, far from the arm, billows most
      const mem = smoothstep(vArm, Math.min(1, vArm + 0.35), v) * (1 - ray * 0.85);
      // weights along the span; the root blends into the body
      const ws = ramp(spec.bones.map((b, q) => [b, q === 0 ? 0 : q === 1 ? 0.38 : 0.72]), u);
      if (u < 0.1 && spec.parent) {
        const wp = (1 - u / 0.1) * 0.65;
        for (const e of ws) e[1] *= 1 - wp;
        ws.push([spec.parent, wp]);
      }
      const furM = spec.fur ? spec.fur(u, v, top) : 0;
      row.push(acc.add({
        p, w: ws, aTan: [side, 0, 0],
        aFin: [u, v, spec.id, top > 0 ? 1 : 0], aFin2: [u * span, v * ch, ray, mem],
        aTex: extra.tex, aLoft: extra.loft, aMask: [furM, 0, 0, 0],
      }));
    }
    rows.push(row);
  }
  for (let i = 0; i < nU; i++) {
    for (let k = 0; k < nLoop; k++) {
      const a = rows[i][k], b = rows[i][(k + 1) % nLoop], c = rows[i + 1][k], d = rows[i + 1][(k + 1) % nLoop];
      acc.tri(a, c, b);
      acc.tri(b, c, d);
    }
  }
  // close the root (inside the body) and keep the tip closed by the zero chord
  // orientation: normals away from the fin's mid-surface
  const mids = rows.map((row, i) => {
    const m = new Vector3();
    for (const v of row) m.add(acc.getPos(v));
    return m.divideScalar(row.length);
  });
  acc.orient(v0, i0, (p) => {
    let best = mids[0], bd = 1e9;
    for (const c of mids) { const d2 = c.distanceToSquared(p); if (d2 < bd) { bd = d2; best = c; } }
    return best;
  });
}

/**
 * Build all six fins for an anatomy. bones: boneIndex map; boneAbs: bind positions.
 * Returns { geo, info } with the fin frames for the model and animator.
 */
export function buildFins(A, bi, boneAbs, res) {
  const P = A.P, L = A.L, g = A.g;
  const acc = new GeoAcc(FIN_LAYOUT, bi);
  const info = { wings: {}, rear: {}, flukes: {} };
  const calf = A.calf;
  // ---- wings ----
  const W = P.wing;
  const span = W.span * L * A.finScale;
  const raysWing = calf
    ? [{ u0: 0.3, u1: 0.3, v0: 0.2 }, { u0: 0.48, u1: 0.58, v0: 0.18 }, { u0: 0.66, u1: 0.84, v0: 0.16 }]
    : [{ u0: 0.26, u1: 0.22, v0: 0.2 }, { u0: 0.42, u1: 0.46, v0: 0.18 }, { u0: 0.58, u1: 0.68, v0: 0.16 }, { u0: 0.74, u1: 0.88, v0: 0.14 }];
  for (const side of [1, -1]) {
    const s = side > 0 ? 'R' : 'L';
    const sh = boneAbs['fin' + s + '1'];
    const q = new Quaternion().setFromUnitVectors(new Vector3(side, 0, 0), wingDir(side));
    const xf = new Matrix4().compose(sh, q, new Vector3(1, 1, 1));
    const root = A.spot(W.t, W.m, side);
    addFin(acc, {
      // slender, tapering wings: the chord narrows steadily from the hand to a pointed tip
      L, span, chordRoot: W.chordRoot * L, chordMax: W.chordMax * L * A.finScale * (calf ? 0.94 : 0.84), armR: W.armR * L,
      rays: raysWing, tub: calf ? 0 : 9, scallop: calf ? 0.025 : 0.05, sweep: 0.18, droop: 0.02, bulge: 0.05,
      tipRound: 0.16, camber: 0.085, maxAt: 0.3, tipChord: calf ? 0.2 : 0.13, splay: 0.2, side, id: side > 0 ? 0 : 1,
      bones: ['fin' + s + '1', 'fin' + s + '2', 'fin' + s + '3'], parent: 'chest', seed: A.shapeSeed + 3 + side,
      rayW: calf ? 0.016 : 0.0105, rayH: calf ? 0.008 : 0.0055, memT: L * (calf ? 0.005 : 0.0028),
      fur: (u, v, top) => (1 - smoothstep(0.05, 0.16, v)) * (top > 0 ? 1 : 0.5) * (calf ? 1 - smoothstep(0.5, 0.85, u) * 0.7 : 1 - smoothstep(0.35, 0.8, u)) * (calf ? 1.0 : 0.8),
    }, xf, res.nU, res.nLoop, { tex: [side > 0 ? 0.47 : 0.53, A.texV(W.t - 0.02)], loft: [W.t, A.sOf(W.t, root.th)] });
    info.wings[s] = { xf, span, side };
  }
  // ---- rear fins ----
  const R = P.rearFin;
  for (const side of [1, -1]) {
    const s = side > 0 ? 'R' : 'L';
    const at = boneAbs['rear' + s];
    const dir = new Vector3(side * 0.72, -0.5, -0.48).normalize();
    const q = new Quaternion().setFromUnitVectors(new Vector3(side, 0, 0), dir);
    const xf = new Matrix4().compose(at, q, new Vector3(1, 1, 1));
    const root = A.spot(R.t, R.m, side);
    addFin(acc, {
      L, span: R.span * L, chordRoot: R.chord * L, chordMax: R.chord * L * 1.15, armR: R.armR * L,
      rays: [{ u0: 0.38, u1: 0.4, v0: 0.22 }, { u0: 0.66, u1: 0.8, v0: 0.2 }], tub: calf ? 0 : 3, scallop: 0.05, sweep: 0.45,
      droop: 0.15, tipRound: 0.32, camber: 0.05, maxAt: 0.3, tipChord: 0.35, side, id: side > 0 ? 2 : 3,
      bones: ['rear' + s, 'rear' + s, 'rear' + s], parent: 'spine2', seed: A.shapeSeed + 9 + side,
      rayW: 0.006, rayH: 0.003, memT: L * 0.0022,
    }, xf, Math.max(8, Math.round(res.nU * 0.4)), Math.max(8, Math.round(res.nLoop * 0.6)), { tex: [A.sOf(R.t, root.th), A.texV(R.t)], loft: [R.t, A.sOf(R.t, root.th)] });
    info.rear[s] = { xf, side };
  }
  // ---- flukes ----
  const F = P.fluke;
  const tail = A.prof(0.02);
  const base = boneAbs.fluke.clone().add(new Vector3(0, 0, 0.018 * L));
  for (const side of [1, -1]) {
    const s = side > 0 ? 'R' : 'L';
    const xf = new Matrix4().makeTranslation(base.x, base.y, base.z);
    const notch = g.notchedFluke && ((g.notchedFluke === true && side > 0) || g.notchedFluke === s)
      ? { u: 0.62, w: 0.13, d: 0.55 } : null;
    addFin(acc, {
      L, span: F.span * L, chordRoot: F.chord * L, chordMax: F.chord * L * 0.98, armR: tail.hw * 0.85,
      rays: [], tub: 0, scallop: 0, serrate: calf ? 0.03 : 0.07, sweep: 0.62, droop: -0.02, bulge: 0.06,
      tipRound: 0.18, camber: 0.02, maxAt: 0.25, tipChord: 0.4, tipThick: 0.2, splay: 0.05, side, id: side > 0 ? 4 : 5,
      bones: ['tail3', 'fluke', 'fluke' + s], parent: 'tail3', seed: A.shapeSeed + 17 + side, notch, memT: L * 0.004,
      fur: (u, v, top) => (1 - smoothstep(0.04, 0.14, v)) * (1 - smoothstep(0.3, 0.6, u)) * 0.9,
    }, xf, Math.max(10, Math.round(res.nU * 0.55 * res.fluke)), Math.max(10, Math.round(res.nLoop * 0.7)), { tex: [0.5, A.texV(0.02)], loft: [0.02, 0.5] });
    info.flukes[s] = { xf, side };
  }
  return { geo: acc.build(), info };
}
