// The whale's body geometry: a lofted skin with a true mouth cut (palate, tongue, baleen), local
// relief (rostrum tubercles, sonic dome, splashguard, eye sockets, brow ridges, mandible, shoulder)
// and every rigid organ merged into the same skinned mesh (organs.js): horns, brow / cheek / jaw
// spikes, dorsal plates, keratin dome bands and the sensor crest. One draw call, one shadow call.
import { Vector3 } from 'three';
import { GeoAcc, mixWeights } from './geo.js';
import { buildOrgans } from './organs.js';
import { smoothstep, clamp, lerp } from '../../core/math.js';

import { PART } from './anatomy.js';
export { PART };
// aTan: skin tangent (around the body, +s); aTex: baked-skin uv; aLoft: (t, s) of the skin point
// (parts: of their root); aPart: part id; aP: part parameters; aMask: x fur, y bellows, z breath, w jaw
export const BODY_LAYOUT = { aTan: 3, aTex: 2, aLoft: 2, aPart: 1, aP: 4, aMask: 4 };

export const BODY_RES = [
  { rings: 196, seg: 112, organs: 1.0 },
  { rings: 104, seg: 60, organs: 0.6 },
  { rings: 54, seg: 32, organs: 0.35 },
];

const _p = new Vector3();
const _n = new Vector3();

/** Fur length factor (0 bare .. ~2 mane) at a skin point. Shared by shells and locks. */
export function furAt(A, t, s) {
  const P = A.P, g = A.g;
  const sw = Math.abs(s - 0.5); // 0 dorsal .. 0.5 belly
  const ventral = 0.5 - sw; // 0 belly .. 0.5 dorsal
  const M = P.mane;
  let f = 0;
  // the lion mane over the nape, shoulders and throat sides
  const maneT = smoothstep(M.t0 - 0.03, M.t0 + 0.03, t) * (1 - smoothstep(M.t1 - 0.025, M.t1 + 0.01, t));
  const maneS = 1 - smoothstep(0.28, 0.4, sw);
  f = Math.max(f, maneT * maneS * lerp(1.0, 2.0, smoothstep(0.38, 0.0, sw)));
  // the dorsal ridge between the plate rows, down to the tail stock
  const ridgeW = P.plates.s0 * 1.05;
  const ridge = (1 - smoothstep(ridgeW * 0.55, ridgeW * 1.15, sw)) * smoothstep(0.05, 0.12, t) * (1 - smoothstep(M.t0 + 0.02, M.t0 + 0.05, t));
  f = Math.max(f, ridge * lerp(0.75, 1.35, smoothstep(0.1, M.t0, t)));
  // fringe under the tail stock (ventral keel) and along the upper keel near the flukes
  const keel = (1 - smoothstep(0.035, 0.09, ventral)) * smoothstep(0.02, 0.06, t) * (1 - smoothstep(0.18, 0.26, t));
  f = Math.max(f, keel * 1.2);
  // tufts at the wing roots
  const W = P.wing;
  const lm = A.landmarks();
  const sWing = lm.sWing;
  const dW = Math.hypot((t - W.t) / 0.045, (Math.min(Math.abs(s - sWing), Math.abs(s - (1 - sWing)))) / 0.06);
  f = Math.max(f, (1 - smoothstep(0.6, 1.1, dW)) * 1.1);
  if (A.calf) {
    // soft down all over (sleeker toward the tail), a fluffy crown and cheeks
    f = Math.max(f, 0.34 * lerp(0.55, 1, smoothstep(0.12, 0.4, t)));
    const crown = smoothstep(P.eye.t - 0.05, P.eye.t - 0.01, t) * (1 - smoothstep(P.blow.t + 0.005, P.blow.t + 0.03, t)) * (1 - smoothstep(0.18, 0.32, sw));
    f = Math.max(f, crown * 1.4);
  }
  // bare: the face around and in front of the eyes, lips, rostrum, throat bellows
  if (t > P.eye.t - 0.035) {
    const face = smoothstep(P.eye.t - 0.035, P.eye.t + (A.calf ? 0.0 : -0.012), t);
    f *= 1 - face * (A.calf ? (sw > 0.36 ? 1 : 0.55) : 1);
  }
  const eyeD = Math.min(
    Math.hypot((t - P.eye.t) / (P.eye.r * 4.5), Math.min(Math.abs(s - lm.sEye), Math.abs(s - (1 - lm.sEye))) / (P.eye.r * 3.2)),
    Math.hypot((t - P.eye2.t) / (P.eye2.r * 4.5), Math.min(Math.abs(s - lm.sEye2), Math.abs(s - (1 - lm.sEye2))) / (P.eye2.r * 3.2)));
  f *= smoothstep(1.0, 1.8, eyeD);
  const bell = bellowsAt(A, t, s);
  f *= 1 - smoothstep(0.05, 0.4, bell);
  // under the plates there is no fur (the plates' edges cover it)
  if (sw > P.plates.s0 * 1.15 && sw < P.plates.s1 * 0.92 && t > P.plates.t0 && t < P.plates.t1 - 0.01) f *= A.calf ? 1.2 : 0;
  // the crest base
  if (t > P.crest.t0 && t < P.crest.t1 && sw < 0.03) f *= 0.2;
  return f * (g.furAmount ?? 1);
}


/** Throat bellows (inflatable pleated throat) mask. */
export function bellowsAt(A, t, s) {
  const P = A.P;
  const sb = Math.min(s, 1 - s); // 0 belly midline .. 0.5 top
  const band = 1 - smoothstep(lerp(0.17, 0.2, smoothstep(0.75, 0.95, t)), lerp(0.24, 0.27, smoothstep(0.75, 0.95, t)), sb);
  return band * smoothstep(P.joints.chest - 0.05, P.joints.chest + 0.04, t) * (1 - smoothstep(0.955, 0.99, t));
}

/** Ring t positions: denser on the head, around the wings and at the tail tip. */
function ringTs(A, n) {
  const P = A.P;
  const dens = (t) => 1 + 1.6 * smoothstep(P.joints.neck - 0.04, P.hinge - 0.01, t) + 0.6 * Math.exp(-(((t - P.wing.t) / 0.05) ** 2)) + 0.8 * smoothstep(0.06, 0.0, t) + 0.6 * smoothstep(0.96, 1.0, t);
  const N = 2048;
  const cum = new Float64Array(N + 1);
  for (let i = 1; i <= N; i++) cum[i] = cum[i - 1] + 0.5 * (dens((i - 1) / N) + dens(i / N)) / N;
  const tot = cum[N];
  const out = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    const target = (i / (n - 1)) * tot;
    while (k < N && cum[k + 1] < target) k++;
    const f = (target - cum[k]) / Math.max(1e-9, cum[k + 1] - cum[k]);
    out.push(clamp((k + f) / N, 0, 1));
  }
  out[0] = 0;
  out[n - 1] = 1;
  return out;
}

/**
 * Build the merged body geometry at one resolution.
 * Returns { geo, outerIndexCount, info } where info holds landmark data for the model.
 */
export function buildBody(A, bi, res) {
  const P = A.P, L = A.L, calf = A.calf;
  const acc = new GeoAcc(BODY_LAYOUT, bi);
  const nRings = res.rings, nSeg = res.seg;
  const jR = Math.max(2, Math.round(nSeg * P.jawFrac));
  const sR = jR / nSeg;
  const jL = nSeg - jR;
  const ts = ringTs(A, nRings);
  const hinge = P.hinge;

  // ---- skin loft ------------------------------------------------------------------------------
  const vid = [];
  const browC = [];
  for (const side of [1, -1]) {
    const e = P.eye;
    const sp = A.spot(e.t + e.r * 0.9, e.m + 0.16, side);
    browC.push({ side, p: sp.p.clone(), r: e.r * L * 3.4 });
  }
  const along = [];
  let acc0 = 0, prevZ = null;
  for (let i = 0; i < nRings; i++) {
    const pr = A.prof(ts[i]);
    if (prevZ !== null) acc0 += Math.hypot(pr.z - prevZ.z, pr.cy - prevZ.cy);
    prevZ = pr;
    along.push(acc0);
  }
  const profs = ts.map((t) => A.prof(t));
  const xy = [0, 0];
  const pt = (pr, th, out) => { A.ringXY(pr, th, xy); return out.set(xy[0], xy[1] + pr.cy, pr.z); };
  const ta = new Vector3(), tb = new Vector3(), na = new Vector3(), nb = new Vector3();
  for (let i = 0; i < nRings; i++) {
    const t = ts[i];
    const pr = profs[i];
    const thM = A.cornerTheta(t, pr);
    const split = t >= hinge;
    const row = [];
    const ringP = [];
    const ringS = [];
    const prA = profs[Math.min(nRings - 1, i + 1)], prB = profs[Math.max(0, i - 1)];
    for (let j = 0; j <= nSeg; j++) {
      const th = A.thetaOf(j / nSeg, thM, sR);
      const p = pt(pr, th, new Vector3());
      // smooth-surface normal from the cached neighbouring profiles, then the local relief
      pt(prA, th, ta); pt(prB, th, tb);
      na.subVectors(ta, tb);
      pt(pr, th + 0.003, ta); pt(pr, th - 0.003, tb);
      nb.subVectors(ta, tb);
      const n = new Vector3().crossVectors(nb, na);
      if (n.lengthSq() < 1e-14) n.set(0, p.y - pr.cy, 0);
      n.normalize();
      if (n.x * p.x + n.y * (p.y - pr.cy) < 0) n.negate();
      const rel = A.relief(t, th, thM);
      if (rel !== 0) p.addScaledVector(n, rel);
      ringP.push(p);
      // canonical ring parameter (identical at every LOD, so the baked skin lines up)
      ringS.push(j === 0 ? 0 : j === nSeg ? 1 : A.sOfTh(th, thM));
    }
    // tangent around the ring (+s direction)
    const tans = ringP.map((p, j) => {
      const a = ringP[Math.min(nSeg, j + 1)], b = ringP[Math.max(0, j - 1)];
      const d = new Vector3().subVectors(a, b);
      if (d.lengthSq() < 1e-12) d.set(j < nSeg / 2 ? -1 : 1, 0, 0);
      return d.normalize();
    });
    for (let j = 0; j <= nSeg; j++) {
      const s = ringS[j];
      const p = ringP[j];
      const lowerSide = j <= jR || j >= jL;
      const mk = (kind) => {
        const fur = furAt(A, t, s);
        const bell = bellowsAt(A, t, s);
        const sw = Math.abs(s - 0.5);
        const breath = smoothstep(0.42, 0.5, t) * (1 - smoothstep(0.64, 0.7, t)) * (1 - bell);
        const sac = Math.max(0, 1 - ((t - 0.47) / 0.1) ** 2 - ((sw - 0.33) / 0.07) ** 2);
        // skin weights along the spine, the jaw ramp, cheeks and brows
        let ws = A.chainWeights(t);
        let jawF = 0;
        if (kind === 'lower' && t > hinge - 1e-6) {
          const dorsal = -Math.cos(s * Math.PI * 2);
          jawF = Math.max(smoothstep(hinge, hinge + 0.1, t), 0.3 * smoothstep(-0.3, -0.8, dorsal));
          ws = mixWeights(ws, [['jaw', 1]], jawF);
        } else if (kind === 'lowerPre') {
          const dorsal = -Math.cos(s * Math.PI * 2);
          jawF = smoothstep(hinge - 0.06, hinge, t) * 0.3 * smoothstep(-0.3, -0.8, dorsal);
          ws = mixWeights(ws, [['jaw', 1]], jawF);
        }
        for (const b of browC) {
          const d = p.distanceTo(b.p) / b.r;
          if (d < 1.6 && (b.side > 0 ? p.x > 0 : p.x < 0)) ws = mixWeights(ws, [[b.side > 0 ? 'browR' : 'browL', 1]], 0.85 * Math.exp(-d * d * 1.6));
        }
        return acc.add({
          p, w: ws, aTan: tans[j],
          aTex: [s, A.texV(t)], aLoft: [t, s], aPart: 0,
          aP: [along[i], 0, 0, 0],
          aMask: [fur, bell, breath, Math.max(jawF, sac * 0.001 + (kind === 'lower' ? 1 : 0) * smoothstep(hinge - 0.01, hinge + 0.02, t))],
        });
      };
      if (split && (j === jR || j === jL)) {
        row.push({ up: mk('upper'), lo: mk('lower') });
      } else {
        const kind = split ? (lowerSide ? 'lower' : 'upper') : (lowerSide ? 'lowerPre' : 'upper');
        const v = mk(kind);
        row.push({ up: v, lo: v });
      }
    }
    vid.push(row);
  }
  for (let i = 0; i < nRings - 1; i++) {
    for (let j = 0; j < nSeg; j++) {
      const lower = j < jR || j >= jL;
      const k = lower ? 'lo' : 'up';
      const a = vid[i][j][k], b = vid[i][j + 1][k], c = vid[i + 1][j][k], d = vid[i + 1][j + 1][k];
      acc.tri(a, b, c);
      acc.tri(b, d, c);
    }
  }
  const skinVerts = acc.count;
  const outerIndexCount = acc.idx.length;
  acc.computeNormals(0, skinVerts, 0, outerIndexCount);
  // weld the belly seam
  const seam = [];
  for (let i = 0; i < nRings; i++) seam.push([vid[i][0].lo, vid[i][nSeg].lo]);
  acc.weld(seam);

  // ---- mouth interior: palate (up into the head) and tongue / floor (down into the jaw) ----
  const iStart = ts.findIndex((t) => t >= hinge);
  const nP = Math.max(6, Math.round(nSeg / 9));
  const corner = (i, side) => acc.getPos(vid[i][side > 0 ? jR : jL].up, new Vector3());
  const strip = (isPalate) => {
    const rows = [];
    for (let i = iStart; i < nRings; i++) {
      const t = ts[i];
      const pr = A.prof(t);
      const cR = corner(i, 1), cL = corner(i, -1);
      const k = smoothstep(hinge, hinge + 0.05, t);
      const depth = (isPalate ? 0.62 * pr.top : -0.62 * pr.bot) * k;
      const row = [];
      for (let q = 0; q <= nP; q++) {
        const f = q / nP;
        const x = lerp(cR.x, cL.x, f);
        const arch = 1 - (2 * f - 1) ** 2;
        // the tongue is a soft rounded mound on the floor
        const tongue = isPalate ? 0 : 0.28 * pr.bot * k * Math.sqrt(Math.max(0, arch)) * smoothstep(hinge, hinge + 0.06, t) * (1 - smoothstep(0.9, 0.97, t));
        const y = lerp(cR.y, cL.y, f) + depth * Math.sqrt(Math.max(arch, 0)) + tongue;
        let ws = A.chainWeights(t);
        if (!isPalate) ws = mixWeights(ws, [['jaw', 1]], smoothstep(hinge, hinge + 0.1, t));
        row.push(acc.add({
          p: [x, y, cR.z], w: ws, aTan: [1, 0, 0], aTex: [f, A.texV(t)], aLoft: [t, 0.5],
          aPart: isPalate ? PART.MOUTH : PART.TONGUE, aP: [f, k, arch, 0], aMask: [0, 0, 0, isPalate ? 0 : 1],
        }));
      }
      rows.push(row);
    }
    const v0 = rows[0][0];
    const i0 = acc.idx.length;
    for (let i = 0; i < rows.length - 1; i++) {
      for (let q = 0; q < nP; q++) {
        const a = rows[i][q], b = rows[i][q + 1], c = rows[i + 1][q], d = rows[i + 1][q + 1];
        if (isPalate) { acc.tri(a, c, b); acc.tri(b, c, d); } else { acc.tri(a, b, c); acc.tri(b, d, c); }
      }
    }
    acc.computeNormals(v0, acc.count, i0, acc.idx.length);
  };
  strip(true);
  strip(false);

  // ---- baleen: fringed plates hanging from the upper jaw edges ----
  for (const side of [1, -1]) {
    const rows = [];
    for (let i = iStart + 2; i < nRings - 3; i++) {
      const t = ts[i];
      const pr = A.prof(t);
      const c = corner(i, side);
      const k = smoothstep(hinge + 0.015, hinge + 0.06, t) * (1 - smoothstep(0.95, 0.985, t));
      const hang = 0.34 * pr.bot * k;
      const x = c.x * 0.9;
      const row = [];
      for (const [yy, f] of [[c.y + 0.04 * pr.top * k, 0], [c.y - hang, 1]]) {
        row.push(acc.add({
          p: [x, yy, c.z], n: new Vector3(-side, 0, 0), keepNormal: true, w: A.chainWeights(t), aTan: [0, 0, 1],
          aTex: [t * L, f], aLoft: [t, 0.5], aPart: PART.BALEEN, aP: [t * L, f, side, 0], aMask: [0, 0, 0, 0],
        }));
      }
      rows.push(row);
    }
    for (let i = 0; i < rows.length - 1; i++) {
      const a = rows[i][0], b = rows[i][1], c = rows[i + 1][0], d = rows[i + 1][1];
      acc.tri(a, b, c);
      acc.tri(b, d, c);
    }
  }

  // ---- organs ---------------------------------------------------------------------------------
  const info = buildOrgans(A, acc, res);
  info.jR = jR;
  info.sR = sR;
  info.nRings = nRings;
  info.nSeg = nSeg;
  info.ts = ts;
  info.skinVerts = skinVerts;

  const geo = acc.build();
  return { geo, outerIndexCount, info };
}
