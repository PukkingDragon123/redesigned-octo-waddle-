// Rigid organs merged into the body mesh: the voice horns (hollow, ringed keratin with vents along
// the underside), brow / cheek / jaw spikes, the shingled dorsal plates, the keratin bands of the
// sonic dome, and the two-leaf sensor crest (the main singing organ: it rises and flares open in
// the vertex shader, showing its pink, pitted interior).
import { Vector3, Quaternion } from 'three';
import { PART } from './anatomy.js';
import { smoothstep, clamp, lerp, rng } from '../../core/math.js';

const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);

/** Rotate unit vector d toward unit target by angle a (radians). */
function turnToward(d, target, a) {
  const dot = d.dot(target);
  const perp = new Vector3().copy(target).addScaledVector(d, -dot);
  const l = perp.length();
  if (l < 1e-6 || Math.abs(a) < 1e-9) return d;
  perp.divideScalar(l);
  const c = Math.cos(a), s = Math.sin(a);
  return d.multiplyScalar(c).addScaledVector(perp, s).normalize();
}

/** Canonical ring-parameter -> angle at t. */
function thetaAtS(A, t, s) {
  return A.thetaOf(s, A.cornerTheta(t), A.P.jawFrac);
}

export function buildOrgans(A, acc, res) {
  const info = {};
  const q = res.organs; // resolution factor
  info.horns = buildHorns(A, acc, q);
  if (!A.calf || A.g.spikes) buildSpikes(A, acc, q);
  info.plates = buildPlates(A, acc, q);
  buildDomeBands(A, acc, q);
  info.crest = buildCrest(A, acc, q);
  return info;
}

// ---- horns ------------------------------------------------------------------------------------
function buildHorns(A, acc, q) {
  const P = A.P, L = A.L, hs = A.layout.horns;
  const out = [];
  for (const side of [1, -1]) {
    const sname = side > 0 ? 'R' : 'L';
    const sp = A.spot(P.horn.t, P.horn.m, side);
    const r = rng(A.shapeSeed + (side > 0 ? 11 : 23));
    const nAlong = Math.max(10, Math.round((hs.style === 'nub' ? 16 : 84) * q));
    const nSides = Math.max(8, Math.round(22 * Math.sqrt(q)));
    const lenM = hs.len * L * (A.g.hornScale ?? 1);
    const baseR = hs.baseR * L * (A.g.hornScale ?? 1) ** 0.7;
    // centreline by integrating curvature from the skull outward
    const out3 = new Vector3(side, 0, 0);
    let d = new Vector3().addScaledVector(Y, hs.up).addScaledVector(Z, -hs.back).addScaledVector(out3, hs.out).normalize();
    d.addScaledVector(sp.n, 0.25).normalize();
    const pts = [];
    const dirs = [];
    let c = sp.p.clone().addScaledVector(sp.n, -baseR * 0.55);
    const snapAt = hs.snap === sname ? 0.72 + r() * 0.06 : 1;
    const ds = lenM / nAlong;
    for (let k = 0; k <= nAlong; k++) {
      const s = k / nAlong;
      pts.push(c.clone());
      dirs.push(d.clone());
      if (k === nAlong) break;
      // bends: back, out, droop near the tip, forward sweep, curl (ram), gnarl wobble
      d = turnToward(d, new Vector3(0, 0, -1), hs.bendBack * ds / lenM * (0.6 + 0.8 * s));
      d = turnToward(d, out3, hs.bendOut * ds / lenM);
      if (hs.droop) d = turnToward(d, new Vector3(0, -1, 0), hs.droop * ds / lenM * smoothstep(0.3, 1, s) * 2);
      if (hs.fwd) d = turnToward(d, new Vector3(0, 0.35, 1).normalize(), hs.fwd * ds / lenM * smoothstep(0.4, 1, s) * 2);
      if (hs.curl) {
        const axis = new Vector3(1, 0, 0).addScaledVector(d, -d.x).normalize();
        const a = hs.curl * ds / lenM * (0.4 + 1.6 * s);
        d.applyQuaternion(new Quaternion().setFromAxisAngle(axis, -a)).normalize();
        d = turnToward(d, out3, 0.25 * ds / lenM);
      }
      if (hs.gnarl) {
        const w = new Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(hs.gnarl * 0.5 * ds / lenM * 6);
        d.add(w).normalize();
      }
      c = c.clone().addScaledVector(d, ds);
    }
    // frames by parallel transport, starting with "down" as the vent side
    const frames = [];
    let nrm = new Vector3(0, -1, 0).addScaledVector(dirs[0], dirs[0].y).normalize();
    for (let k = 0; k <= nAlong; k++) {
      const T = dirs[k];
      nrm.addScaledVector(T, -nrm.dot(T)).normalize();
      const B = new Vector3().crossVectors(T, nrm).normalize();
      frames.push({ T, N: nrm.clone(), B });
    }
    const nubby = hs.style === 'nub';
    const radiusAt = (s) => {
      if (nubby) return baseR * Math.sqrt(Math.max(0, 1 - s * s)) * (0.95 + 0.05 * Math.cos(s * 9));
      let rr = baseR * ((1 - s) ** 0.85 * 0.93 + 0.07);
      // growth rings: closer together near the base, worn away toward the tip
      const ph = hs.rings * (1 - (1 - s) ** 1.35);
      const ridge = Math.pow(0.5 + 0.5 * Math.cos(ph * Math.PI * 2), 3);
      rr *= 1 + hs.ringAmp * ridge * (1 - smoothstep(0.62, 0.92, s));
      if (hs.gnarl) rr *= 1 + 0.06 * Math.sin(s * 37 + 1.3) * hs.gnarl;
      return rr;
    };
    // vents: slits along the underside (phi near 0 = the frame's N side)
    const vents = [];
    if (!nubby) {
      const nv = 5;
      for (let i = 0; i < nv; i++) vents.push({ s: lerp(0.16, Math.min(0.6, snapAt - 0.1), (i + 0.5) / nv), len: 0.055, phi: (i % 2 ? 1 : -1) * 0.05 });
    }
    const ventSDF = (s, phi, rr) => {
      let best = 9;
      for (const v of vents) {
        const da = Math.max(0, Math.abs(s - v.s) - v.len * 0.5) * lenM;
        const dp = Math.abs(angWrap(phi - v.phi)) * rr;
        best = Math.min(best, Math.hypot(da, dp) - baseR * 0.06);
      }
      return best;
    };
    const kEnd = Math.min(nAlong, Math.ceil(snapAt * nAlong));
    const v0 = acc.count, i0 = acc.idx.length;
    const rows = [];
    const jag = (phi) => (Math.sin(phi * 3 + 1.7) * 0.5 + Math.sin(phi * 7 + 0.3) * 0.3 + Math.sin(phi * 13) * 0.2);
    for (let k = 0; k <= kEnd; k++) {
      let s = k / nAlong;
      if (k === kEnd) s = Math.min(snapAt, 1);
      const kk = Math.min(nAlong, Math.round(s * nAlong));
      const F = frames[kk];
      const cen = pts[kk];
      const rr = radiusAt(s);
      const row = [];
      for (let j = 0; j <= nSides; j++) {
        const phi = (j / nSides) * Math.PI * 2 + hs.twist * s * Math.PI * 2 * 0.15;
        const cs = Math.cos(phi), sn = Math.sin(phi);
        // slightly flattened section (deeper than wide), a keel on the upper edge
        const ell = 0.86;
        const keel = 1 + 0.07 * Math.pow(Math.max(0, -cs), 8) * (1 - s);
        const sdf = ventSDF(s, angWrap(phi), rr);
        // vent lips: a sunken slit with a raised rim
        const lip = vents.length ? (0.08 * Math.exp(-((sdf / (baseR * 0.06)) ** 2)) - 0.12 * smoothstep(0, -baseR * 0.04, sdf)) : 0;
        let rad = rr * keel * (1 + lip);
        const p = cen.clone().addScaledVector(F.N, cs * rad).addScaledVector(F.B, sn * rad * ell);
        // snapped end: a jagged break
        if (k === kEnd && snapAt < 1) p.addScaledVector(F.T, jag(phi) * rr * 0.55);
        row.push(acc.add({
          p, w: [['head', 1]], aTan: F.T, aTex: [s, j / nSides], aLoft: [P.horn.t, side > 0 ? 0.3 : 0.7],
          aPart: PART.HORN, aP: [s, j / nSides, sdf / L, 0], aMask: [0, 0, 0, side],
        }));
      }
      rows.push(row);
    }
    for (let k = 0; k < rows.length - 1; k++) {
      for (let j = 0; j < nSides; j++) {
        const a = rows[k][j], b = rows[k][j + 1], c = rows[k + 1][j], d = rows[k + 1][j + 1];
        // outward winding
        acc.tri(a, c, b);
        acc.tri(b, c, d);
      }
    }
    // tip cap / break surface with the hollow core
    const last = rows[rows.length - 1];
    const sEnd = Math.min(snapAt, 1);
    const kE = Math.min(nAlong, Math.round(sEnd * nAlong));
    const Fe = frames[kE];
    const ce = pts[kE].clone();
    if (snapAt < 1) {
      // keratin wall annulus, then a dark hollow going down the horn
      const rrE = radiusAt(sEnd);
      const inner = [];
      for (let j = 0; j <= nSides; j++) {
        const phi = (j / nSides) * Math.PI * 2;
        const p = ce.clone().addScaledVector(Fe.N, Math.cos(phi) * rrE * 0.52).addScaledVector(Fe.B, Math.sin(phi) * rrE * 0.52 * 0.86)
          .addScaledVector(Fe.T, jag(phi) * rrE * 0.25 - rrE * 0.1);
        inner.push(acc.add({ p, w: [['head', 1]], aTan: Fe.T, aTex: [sEnd, j / nSides], aLoft: [P.horn.t, 0.5], aPart: PART.HORN, aP: [sEnd, j / nSides, 1, 1], aMask: [0, 0, 0, side] }));
      }
      for (let j = 0; j < nSides; j++) { acc.tri(last[j], last[j + 1], inner[j]); acc.tri(last[j + 1], inner[j + 1], inner[j]); }
      const deep = [];
      for (let j = 0; j <= nSides; j++) {
        const phi = (j / nSides) * Math.PI * 2;
        const p = ce.clone().addScaledVector(Fe.N, Math.cos(phi) * rrE * 0.4).addScaledVector(Fe.B, Math.sin(phi) * rrE * 0.4 * 0.86).addScaledVector(Fe.T, -rrE * 1.6);
        deep.push(acc.add({ p, w: [['head', 1]], aTan: Fe.T, aTex: [sEnd, j / nSides], aLoft: [P.horn.t, 0.5], aPart: PART.HORN, aP: [sEnd, j / nSides, 1, 2], aMask: [0, 0, 0, side] }));
      }
      for (let j = 0; j < nSides; j++) { acc.tri(inner[j], inner[j + 1], deep[j]); acc.tri(inner[j + 1], deep[j + 1], deep[j]); }
      const bot = acc.add({ p: ce.clone().addScaledVector(Fe.T, -rrE * 1.8), w: [['head', 1]], aTan: Fe.T, aTex: [sEnd, 0], aLoft: [P.horn.t, 0.5], aPart: PART.HORN, aP: [sEnd, 0, 1, 2], aMask: [0, 0, 0, side] });
      for (let j = 0; j < nSides; j++) acc.tri(deep[j], deep[j + 1], bot);
    } else {
      const tip = acc.add({ p: ce.clone().addScaledVector(Fe.T, radiusAt(1) * 0.8), w: [['head', 1]], aTan: Fe.T, aTex: [1, 0], aLoft: [P.horn.t, 0.5], aPart: PART.HORN, aP: [1, 0, 1, 0], aMask: [0, 0, 0, side] });
      for (let j = 0; j < nSides; j++) acc.tri(last[j], last[j + 1], tip);
    }
    acc.orient(v0, i0, (p) => {
      let best = pts[0], bd = 1e9;
      for (const c of pts) { const d2 = c.distanceToSquared(p); if (d2 < bd) { bd = d2; best = c; } }
      return best;
    });
    acc.weld(rows.map((row) => [row[0], row[nSides]]));
    out.push({ side, root: sp.p.clone(), tip: pts[kE].clone(), len: lenM, baseR, snapped: snapAt < 1, vents: vents.map((v) => pts[Math.round(v.s * nAlong)].clone()) });
  }
  return out;
}

function angWrap(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// ---- spikes -----------------------------------------------------------------------------------
function spike(A, acc, base, nrm, dir, len, r0, bone, q, curve = 0.25) {
  const nS = Math.max(5, Math.round(8 * Math.sqrt(q)));
  const nA = 5;
  const v0 = acc.count, i0 = acc.idx.length;
  const T0 = dir.clone().normalize();
  const side = new Vector3().crossVectors(T0, nrm).normalize();
  const up = new Vector3().crossVectors(side, T0).normalize();
  const rows = [];
  for (let k = 0; k <= nA; k++) {
    const s = k / nA;
    // bend from the skin normal toward the sweep direction
    const T = nrm.clone().multiplyScalar(1 - s).addScaledVector(T0, s + curve).normalize();
    const c = base.clone().addScaledVector(nrm, -r0 * 0.6).addScaledVector(nrm, len * s * 0.45).addScaledVector(T0, len * s * s * 0.75);
    const rr = r0 * Math.pow(1 - s, 0.9) + r0 * 0.04;
    const row = [];
    for (let j = 0; j <= nS; j++) {
      const phi = (j / nS) * Math.PI * 2;
      const u = side.clone().multiplyScalar(Math.cos(phi)).addScaledVector(up, Math.sin(phi));
      u.addScaledVector(T, -u.dot(T)).normalize();
      row.push(acc.add({ p: c.clone().addScaledVector(u, rr), w: [[bone, 1]], aTan: T, aTex: [s, j / nS], aLoft: [0, 0], aPart: PART.SPIKE, aP: [s, j / nS, 0, 0], aMask: [0, 0, 0, 0] }));
    }
    rows.push(row);
  }
  const tipP = base.clone().addScaledVector(nrm, len * 0.45 - r0 * 0.6).addScaledVector(T0, len * 0.78);
  const tip = acc.add({ p: tipP, w: [[bone, 1]], aTan: T0, aTex: [1, 0], aLoft: [0, 0], aPart: PART.SPIKE, aP: [1, 0, 0, 0], aMask: [0, 0, 0, 0] });
  for (let k = 0; k < nA; k++) for (let j = 0; j < nS; j++) {
    const a = rows[k][j], b = rows[k][j + 1], c = rows[k + 1][j], d = rows[k + 1][j + 1];
    acc.tri(a, c, b);
    acc.tri(b, c, d);
  }
  const lastRow = rows[nA];
  for (let j = 0; j < nS; j++) acc.tri(lastRow[j], tip, lastRow[j + 1]);
  const inner = base.clone().addScaledVector(nrm, -r0 * 3);
  acc.orient(v0, i0, (p) => {
    // nearest point on the spike's axis
    const ax = tipP.clone().sub(inner);
    const k = clamp(p.clone().sub(inner).dot(ax) / ax.lengthSq(), 0, 1);
    return inner.clone().addScaledVector(ax, k * 0.9);
  });
  acc.weld(rows.map((row) => [row[0], row[nS]]));
}

function buildSpikes(A, acc, q) {
  const P = A.P, L = A.L;
  const k = A.g.spikeScale ?? 1;
  const e = P.eye;
  for (const side of [1, -1]) {
    const sname = side > 0 ? 'R' : 'L';
    // brow: an arc of three small horns over the eye, sweeping back
    for (let i = 0; i < 3; i++) {
      const t = e.t + e.r * (1.6 - i * 2.4);
      const m = e.m + 0.2 + i * 0.03;
      const sp = A.spot(t, m, side);
      const dir = new Vector3(side * 0.35, 0.35, -1);
      spike(A, acc, sp.p, sp.n, dir, L * (0.016 - i * 0.003) * k, L * (0.0042 - i * 0.0007) * k, 'brow' + sname, q, 0.3);
    }
    // cheek: two behind the gape
    for (let i = 0; i < 2; i++) {
      const t = P.hinge - 0.012 - i * 0.016;
      const sp = A.spot(t, -0.12 - i * 0.06, side);
      spike(A, acc, sp.p, sp.n, new Vector3(side * 0.5, -0.1, -1), L * (0.014 - i * 0.003) * k, L * (0.0036 - i * 0.0005) * k, 'head', q, 0.35);
    }
    // jaw: a row along the mandible, pointing down and back
    for (let i = 0; i < 4; i++) {
      const t = lerp(0.8, 0.93, i / 3);
      const sp = A.spot(t, -0.42 - (i % 2) * 0.05, side);
      spike(A, acc, sp.p, sp.n, new Vector3(side * 0.3, -0.6, -1), L * (0.011 - i * 0.0012) * k, L * (0.003 - i * 0.0003) * k, 'jaw', q, 0.3);
    }
  }
}

// ---- dorsal plates ---------------------------------------------------------------------------
function plateShape(A, acc, pl, q, opts) {
  const P = A.P, L = A.L;
  const nR = Math.max(3, Math.round(6 * q));
  const nPhi = Math.max(12, Math.round(30 * q));
  const r = rng(Math.floor(pl.seed * 1000) + 7);
  const chips = [];
  for (let i = 0; i < 5; i++) chips.push({ a: r() * Math.PI * 2, w: 0.15 + r() * 0.3, d: 0.04 + r() * 0.1 * (0.5 + pl.chip) });
  const sc = pl.sc, hs = pl.hs, tc = pl.tc, ht = pl.ht;
  const ws = pl.weights;
  const thick = pl.thick;
  const v0 = acc.count, i0 = acc.idx.length;
  const outline = (phi) => {
    const c = Math.cos(phi), s = Math.sin(phi);
    let rad = Math.pow(Math.pow(Math.abs(c), opts.exp) + Math.pow(Math.abs(s), opts.exp), -1 / opts.exp);
    for (const ch of chips) rad *= 1 - ch.d * Math.exp(-((angWrap(phi - ch.a) / ch.w) ** 2));
    rad *= 1 + 0.025 * Math.sin(phi * 9 + pl.seed) + 0.015 * Math.sin(phi * 17 + pl.seed * 2);
    return rad;
  };
  const pAt = (a, b, hgt, out) => {
    const s = sc + a * hs;
    const t = tc + b * ht;
    const th = thetaAtS(A, t, s);
    A.surfacePointR(t, th, out);
    const n = A.surfaceNormal(t, th, new Vector3());
    out.addScaledVector(n, hgt);
    return { s, t };
  };
  const perim = 2 * Math.PI * Math.max(A.prof(tc).hw, A.prof(tc).top) * 0.85;
  const rows = [];
  const tmp = new Vector3();
  // rings: 0..nR across the top face, then the bevel and the foot below the skin
  const rings = [];
  for (let i = 0; i <= nR; i++) rings.push({ rho: (i / nR) ** 0.85, h: 1, kind: 0 });
  rings.push({ rho: 1.035, h: 0.45, kind: 1 });
  rings.push({ rho: 1.06, h: -0.35, kind: 2 });
  for (const ring of rings) {
    const row = [];
    for (let j = 0; j <= nPhi; j++) {
      const phi = (j / nPhi) * Math.PI * 2;
      const rad = outline(phi) * ring.rho;
      const a = Math.cos(phi) * rad, b = Math.sin(phi) * rad;
      // thickness: domed top, lifted rear edge (b < 0 is tail-ward), tucked front edge
      const front = (b + 1) * 0.5;
      let h;
      if (ring.kind === 0) {
        const dome = Math.sqrt(Math.max(0, 1 - Math.pow(ring.rho, 6)));
        h = thick * (0.32 + 0.68 * dome) * lerp(opts.rearK, opts.frontK, front);
        h += thick * opts.lift * smoothstep(0.2, -0.9, b) * ring.rho * ring.rho;
      } else if (ring.kind === 1) {
        h = thick * 0.3 * lerp(opts.rearK, opts.frontK, front) + thick * opts.lift * 0.8 * smoothstep(0.2, -0.9, b);
      } else h = -thick * 0.3;
      const st = pAt(a, b, h, tmp);
      row.push(acc.add({
        p: tmp.clone(), w: ws, aTan: [1, 0, 0], aTex: [st.s, A.texV(st.t)], aLoft: [st.t, st.s],
        aPart: opts.part, aP: [a * hs * perim, b * ht * L, Math.min(1, ring.rho), Math.floor(pl.seed) + ring.kind * 0.25],
        aMask: [0, 0, 0, opts.band ?? 0],
      }));
    }
    rows.push(row);
  }
  // centre fan
  const cst = pAt(0, 0, thick * lerp(opts.rearK, opts.frontK, 0.5) + 0, tmp);
  const center = acc.add({ p: tmp.clone(), w: ws, aTan: [1, 0, 0], aTex: [cst.s, A.texV(cst.t)], aLoft: [cst.t, cst.s], aPart: opts.part, aP: [0, 0, 0, Math.floor(pl.seed)], aMask: [0, 0, 0, opts.band ?? 0] });
  for (let j = 0; j < nPhi; j++) acc.tri(center, rows[0][j], rows[0][j + 1]);
  for (let i = 0; i < rows.length - 1; i++) {
    for (let j = 0; j < nPhi; j++) {
      const a = rows[i][j], b = rows[i][j + 1], c = rows[i + 1][j], d = rows[i + 1][j + 1];
      acc.tri(a, c, b);
      acc.tri(b, c, d);
    }
  }
  const cy = A.prof(tc).cy;
  acc.orient(v0, i0, (p) => new Vector3(0, cy, p.z));
  acc.weld(rows.map((row) => [row[0], row[nPhi]]));
}

function buildPlates(A, acc, q) {
  const out = [];
  for (const pl of A.layout.plates) {
    const side = pl.side;
    const sc = 0.5 - side * (pl.s0 + pl.s1) * 0.5;
    const hs = (pl.s1 - pl.s0) * 0.5;
    const tc = (pl.tf + pl.tb) * 0.5, ht = (pl.tf - pl.tb) * 0.5;
    const plate = { sc, hs: hs * -side, tc, ht, thick: pl.thick, seed: pl.seed, chip: pl.chip, weights: A.chainWeights(tc) };
    plateShape(A, acc, plate, q, { exp: 3.2, rearK: 1.12, frontK: 0.62, lift: 0.55, part: PART.PLATE });
    out.push({ side, tc, sc });
  }
  return out;
}

function buildDomeBands(A, acc, q) {
  const D = A.P.dome, L = A.L;
  const n = A.calf ? 2 : 3;
  const r = rng(A.shapeSeed + 77);
  for (let i = 0; i < n; i++) {
    const f0 = i / n, f1 = (i + 1) / n;
    const ta = lerp(D.t1 - 0.004, D.t0 + 0.01, f0), tb = lerp(D.t1 - 0.004, D.t0 + 0.01, f1);
    const tc = (ta + tb) * 0.5 - 0.002;
    const ht = (ta - tb) * 0.5 + 0.006;
    // half width in ring parameter: the dome is narrower at its ends
    const w = D.w * (0.62 + 0.38 * Math.sin(Math.PI * (0.25 + 0.6 * (f0 + f1) * 0.5)));
    const sHalf = w / (Math.PI * 2) * 1.05;
    const plate = { sc: 0.5, hs: sHalf, tc, ht, thick: L * (A.calf ? 0.0025 : 0.0042), seed: 50 + i + r(), chip: 0.2 * r(), weights: [['head', 1]] };
    plateShape(A, acc, plate, q * 0.8, { exp: 2.6, rearK: 1.2, frontK: 0.55, lift: 0.4, part: PART.DOME, band: i / n });
  }
}

// ---- sensor crest -----------------------------------------------------------------------------
function buildCrest(A, acc, q) {
  const P = A.P, L = A.L, C = P.crest;
  const nU = Math.max(10, Math.round(40 * q));
  const nW = Math.max(5, Math.round(14 * q));
  const H = C.h * L * (A.g.crestScale ?? 1);
  const nRibs = A.calf ? 5 : 8;
  const ribs = [];
  for (let k = 0; k < nRibs; k++) ribs.push((k + 0.6) / (nRibs + 0.2));
  const pExp = Math.log(0.5) / Math.log(C.peak);
  const gap = L * 0.0004;
  const baseThick = L * (A.calf ? 0.0035 : 0.0042);
  const lean = 0.55;
  const ribNear = (u) => {
    let m = 0;
    for (const rk of ribs) m = Math.max(m, Math.exp(-(((u - rk) / 0.022) ** 2)));
    return m;
  };
  const heightAt = (u) => {
    const base = Math.pow(Math.sin(Math.PI * Math.pow(clamp(u, 0, 1), pExp)), 0.75);
    // scalloped edge between the ribs; the ribs run out into short spines
    const sc = 1 - 0.16 * (1 - ribNear(u)) * smoothstep(0.02, 0.15, u) * smoothstep(0.98, 0.85, u);
    return H * base * sc * (1 + 0.1 * ribNear(u));
  };
  const v0 = acc.count, i0 = acc.idx.length;
  const leaves = [];
  for (const side of [1, -1]) {
    const faces = { outer: [], inner: [] };
    for (const face of ['outer', 'inner']) {
      for (let iu = 0; iu <= nU; iu++) {
        const u = iu / nU;
        const t = lerp(C.t1, C.t0, u);
        const B = A.surfacePointR(t, 0, new Vector3());
        const nb = A.surfaceNormal(t, 0, new Vector3());
        B.addScaledVector(nb, -L * 0.002);
        const h = heightAt(u);
        const row = [];
        for (let iw = 0; iw <= nW; iw++) {
          const w = iw / nW;
          const hh = h * w;
          const thk = baseThick * (1 - w * 0.82) * (1 + 0.9 * ribNear(u) * (1 - w * 0.6)) * (face === 'outer' ? 1 : 0);
          const bow = H * 0.1 * w * (1 - w) + H * 0.04 * w;
          const p = B.clone();
          p.y += hh;
          p.z -= hh * lean * (0.6 + 0.4 * w);
          p.x += side * (gap + (face === 'outer' ? thk + bow * 0.4 : 0));
          const ws = A.chainWeights(t);
          row.push(acc.add({
            p, w: ws, aTan: [0, 0, -1], aTex: [u, w], aLoft: [t, 0.5],
            aPart: PART.CREST, aP: [side, B.y, w, face === 'inner' ? 1 : 0], aMask: [B.z, ribNear(u), u, 0],
          }));
        }
        faces[face].push(row);
      }
    }
    // stitch faces (outer faces outward, inner faces toward the midline)
    const O = faces.outer, I = faces.inner;
    const outward = side > 0;
    for (let iu = 0; iu < nU; iu++) {
      for (let iw = 0; iw < nW; iw++) {
        const a = O[iu][iw], b = O[iu][iw + 1], c = O[iu + 1][iw], d = O[iu + 1][iw + 1];
        if (outward) { acc.tri(a, c, b); acc.tri(b, c, d); } else { acc.tri(a, b, c); acc.tri(b, d, c); }
        const a2 = I[iu][iw], b2 = I[iu][iw + 1], c2 = I[iu + 1][iw], d2 = I[iu + 1][iw + 1];
        if (outward) { acc.tri(a2, b2, c2); acc.tri(b2, d2, c2); } else { acc.tri(a2, c2, b2); acc.tri(b2, c2, d2); }
      }
      // edge rim between the faces along the free edge
      const a = O[iu][nW], b = O[iu + 1][nW], c = I[iu][nW], d = I[iu + 1][nW];
      if (outward) { acc.tri(a, b, c); acc.tri(b, d, c); } else { acc.tri(a, c, b); acc.tri(b, c, d); }
    }
    leaves.push({ side });
  }
  acc.computeNormals(v0, acc.count, i0, acc.idx.length);
  const front = A.surfacePointR(C.t1, 0, new Vector3());
  return { H, front, back: A.surfacePointR(C.t0, 0, new Vector3()) };
}
