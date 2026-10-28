// Fur of the Vur Sok whale, in two layers that share the baked skin colour:
//  - shell fur: the dense soft coat (the calf's down, the base of the mane and ridge). The fur-
//    bearing triangles of the body and fins are drawn once per shell with instancing, so the shell
//    count is just the instance count (Whale.animate's LOD sets it, no geometry is duplicated).
//  - locks: instanced hair cards for the long hair: the lion mane over the nape, throat and
//    shoulders, the dorsal ridge between the plate rows, tufts at the wing roots and along each
//    wing's leading edge, and the fringe on the tail stock and flukes. Each card is a curved,
//    camera-facing ribbon of strands with clumping, curl and tapered, lighter tips.
import {
  BufferGeometry, InstancedBufferGeometry, InstancedBufferAttribute, Float32BufferAttribute,
  Uint16BufferAttribute, Vector3,
} from 'three';
import { furAt } from './body.js';
import { smoothstep, clamp, lerp, rng } from '../../core/math.js';

export const MAX_SHELLS = 32;

/** Shell heights in draw order: bit-reversed so any prefix covers the coat's depth evenly. */
export function shellHeights(n = MAX_SHELLS) {
  const bits = Math.ceil(Math.log2(n));
  const order = [];
  for (let i = 0; i < n; i++) order.push(i);
  const rev = (i) => { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); return r; };
  order.sort((a, b) => rev(a) - rev(b));
  return order.map((i) => (i + 1) / n);
}

function readV(geo, name, i, n) {
  const a = geo.attributes[name];
  if (!a) return new Array(n).fill(0);
  const out = [];
  for (let k = 0; k < n; k++) out.push(a.array[i * a.itemSize + k]);
  return out;
}

/**
 * Shell fur base geometry from the fur-bearing triangles of a body and a fin geometry.
 * Attributes: position, normal, aTex (skin uv), aLoft (t, s), aFur (length k, region, metric u, v),
 * aComb (comb direction), skinIndex / skinWeight.
 */
export function buildShellGeometry(A, bodyGeo, bodySkinTris, finGeo) {
  const pos = [], nor = [], tex = [], loft = [], fur = [], comb = [], si = [], sw = [];
  const idx = [];
  const L = A.L;
  const add = (geo, triCount, kind) => {
    const index = geo.index.array;
    const remap = new Map();
    const P = geo.attributes.position, N = geo.attributes.normal;
    const M = geo.attributes.aMask;
    const getV = (vi) => {
      if (remap.has(vi)) return remap.get(vi);
      const n = pos.length / 3;
      const px = P.getX(vi), py = P.getY(vi), pz = P.getZ(vi);
      pos.push(px, py, pz);
      const nx = N.getX(vi), ny = N.getY(vi), nz = N.getZ(vi);
      nor.push(nx, ny, nz);
      if (kind === 'body') {
        const [u, v] = readV(geo, 'aTex', vi, 2);
        const [t, s] = readV(geo, 'aLoft', vi, 2);
        tex.push(u, v);
        loft.push(t, s);
        const pr = A.prof(t);
        const per = 2 * Math.PI * Math.sqrt((pr.hw * pr.hw + (pr.top + pr.bot) * (pr.top + pr.bot) * 0.25) * 0.5);
        fur.push(M.getX(vi), 0, s * per, t * L);
        // combed back toward the tail and down the flanks; the mane falls like a lion's
        const n = new Vector3(nx, ny, nz);
        const c = new Vector3(0, -0.25, -1);
        const flank = 1 - Math.abs(Math.cos(s * Math.PI * 2));
        c.y -= flank * 0.9;
        c.addScaledVector(n, -c.dot(n)).normalize();
        comb.push(c.x, c.y, c.z);
      } else {
        const [u, v] = readV(geo, 'aTex', vi, 2);
        const [t, s] = readV(geo, 'aLoft', vi, 2);
        tex.push(u, v);
        loft.push(t, s);
        const [mu, mv] = readV(geo, 'aFin2', vi, 2);
        fur.push(M.getX(vi), 1, mu, mv);
        const n = new Vector3(nx, ny, nz);
        const c = new Vector3(0, 0, -1).addScaledVector(n, -n.z).normalize();
        comb.push(c.x, c.y, c.z);
      }
      const S = geo.attributes.skinIndex, W = geo.attributes.skinWeight;
      si.push(S.getX(vi), S.getY(vi), S.getZ(vi), S.getW(vi));
      sw.push(W.getX(vi), W.getY(vi), W.getZ(vi), W.getW(vi));
      remap.set(vi, n);
      return n;
    };
    for (let tr = 0; tr < triCount; tr++) {
      const i0 = index[tr * 3], i1 = index[tr * 3 + 1], i2 = index[tr * 3 + 2];
      const f = Math.max(M.getX(i0), M.getX(i1), M.getX(i2));
      if (f < 0.04) continue;
      idx.push(getV(i0), getV(i1), getV(i2));
    }
  };
  add(bodyGeo, bodySkinTris, 'body');
  if (finGeo) add(finGeo, finGeo.index.count / 3, 'fin');
  const geo = new InstancedBufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  geo.setAttribute('aTex', new Float32BufferAttribute(tex, 2));
  geo.setAttribute('aLoft', new Float32BufferAttribute(loft, 2));
  geo.setAttribute('aFur', new Float32BufferAttribute(fur, 4));
  geo.setAttribute('aComb', new Float32BufferAttribute(comb, 3));
  geo.setAttribute('skinIndex', new Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new Float32BufferAttribute(sw, 4));
  geo.setIndex(idx);
  geo.instanceCount = 0;
  return geo;
}

// ---- locks (hair cards) -------------------------------------------------------------------------
const LOCK_SEG = 8;

/** The card template: LOCK_SEG segments, two columns (x = -1 / +1), y = 0 root .. 1 tip. */
function lockTemplate() {
  const pos = [], idx = [];
  for (let i = 0; i <= LOCK_SEG; i++) {
    const a = i / LOCK_SEG;
    pos.push(-1, a, 0, 1, a, 0);
  }
  for (let i = 0; i < LOCK_SEG; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  return { pos, idx };
}

/** Area-weighted samples of a triangle soup: [{ p, n, tan, tex, loft, si, sw, w }] */
function sampleTris(geo, triCount, weightFn, count, r, kind) {
  const P = geo.attributes.position, N = geo.attributes.normal;
  const index = geo.index.array;
  const tris = [];
  let total = 0;
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  for (let t = 0; t < triCount; t++) {
    const i0 = index[t * 3], i1 = index[t * 3 + 1], i2 = index[t * 3 + 2];
    a.fromBufferAttribute(P, i0); b.fromBufferAttribute(P, i1); c.fromBufferAttribute(P, i2);
    const area = b.clone().sub(a).cross(c.clone().sub(a)).length() * 0.5;
    const w = weightFn(i0, i1, i2) * area;
    if (w <= 0) continue;
    total += w;
    tris.push({ i0, i1, i2, cum: total });
  }
  const out = [];
  if (!tris.length) return out;
  for (let k = 0; k < count; k++) {
    const x = r() * total;
    let lo = 0, hi = tris.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (tris[m].cum < x) lo = m + 1; else hi = m; }
    const tr = tris[lo];
    let u = r(), v = r();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const wv = [1 - u - v, u, v];
    const ids = [tr.i0, tr.i1, tr.i2];
    const p = new Vector3(), n = new Vector3();
    const tex = [0, 0], loft = [0, 0];
    const bones = new Map();
    for (let q = 0; q < 3; q++) {
      const i = ids[q];
      p.addScaledVector(a.fromBufferAttribute(P, i), wv[q]);
      n.addScaledVector(b.fromBufferAttribute(N, i), wv[q]);
      const tx = geo.attributes.aTex, lf = geo.attributes.aLoft;
      tex[0] += tx.getX(i) * wv[q]; tex[1] += tx.getY(i) * wv[q];
      loft[0] += lf.getX(i) * wv[q]; loft[1] += lf.getY(i) * wv[q];
      const S = geo.attributes.skinIndex, W = geo.attributes.skinWeight;
      for (let j = 0; j < 4; j++) {
        const bi = S.array[i * 4 + j], bw = W.array[i * 4 + j] * wv[q];
        if (bw > 0) bones.set(bi, (bones.get(bi) || 0) + bw);
      }
    }
    n.normalize();
    const extra = kind === 'fin' ? { fin: [geo.attributes.aFin.getX(tr.i0), geo.attributes.aFin.getY(tr.i0), geo.attributes.aFin.getW(tr.i0)] } : {};
    out.push(Object.assign({ p, n, tex, loft, bones }, extra));
  }
  return out;
}

/**
 * Hair cards for an anatomy. Returns an InstancedBufferGeometry (template + per-card attributes)
 * with cards in random order, so drawing a prefix (instanceCount) thins the coat evenly.
 */
export function buildLocks(A, bodyGeo, bodySkinTris, finGeo, density = 1) {
  const r = rng(A.shapeSeed * 31 + 5);
  const L = A.L, P = A.P, calf = A.calf;
  const cards = [];
  const M = bodyGeo.attributes.aMask, LF = bodyGeo.attributes.aLoft;
  const tAt = (i) => LF.getX(i), sAt = (i) => LF.getY(i);
  const furTri = (i0, i1, i2) => Math.min(M.getX(i0), M.getX(i1), M.getX(i2));
  const region = (name, count, wfn, opts) => {
    const n = Math.round(count * density);
    if (n <= 0) return;
    const samples = sampleTris(bodyGeo, bodySkinTris, wfn, n, r, 'body');
    for (const sm of samples) cards.push(Object.assign({ region: name }, sm, opts(sm)));
  };
  const lenK = L * (A.g.lockScale ?? 1);
  // mane: long, thick, falling back and down over the nape, shoulders and throat sides
  region('mane', calf ? 620 : 2100, (a, b, c) => {
    const f = furTri(a, b, c);
    const t = tAt(a);
    return f > 0.9 && t > P.mane.t0 - 0.02 && t < P.mane.t1 ? Math.pow(f, 1.5) : 0;
  }, (sm) => {
    const t = sm.loft[0], s = sm.loft[1];
    const along = smoothstep(P.mane.t1, P.mane.t0 + 0.04, t);
    const dorsal = 1 - Math.abs(s - 0.5) * 2;
    return {
      len: lenK * (calf ? 0.04 : 0.05) * (0.55 + 0.6 * along) * (0.7 + 0.45 * dorsal) * lerp(0.75, 1.25, r()),
      wid: lenK * (calf ? 0.0095 : 0.011) * lerp(0.7, 1.3, r()),
      lift: lerp(0.5, 1.0, r()), droop: lerp(0.2, 0.5, r()), curl: lerp(0.1, calf ? 0.6 : 0.4, r()),
    };
  });
  // dorsal ridge: a mohawk between the plate rows down to the tail stock
  region('ridge', calf ? 160 : 520, (a, b, c) => {
    const s = sAt(a), t = tAt(a);
    return Math.abs(s - 0.5) < P.plates.s0 * 1.1 && t > 0.06 && t < P.mane.t0 + 0.02 && furTri(a, b, c) > 0.3 ? 1 : 0;
  }, (sm) => ({
    len: lenK * (calf ? 0.03 : 0.028) * lerp(0.55, 1.0, smoothstep(0.05, P.mane.t0, sm.loft[0])) * lerp(0.75, 1.2, r()),
    wid: lenK * (calf ? 0.01 : 0.0065) * lerp(0.7, 1.3, r()),
    lift: lerp(0.55, 0.9, r()), droop: lerp(0.0, 0.25, r()), curl: lerp(0.05, 0.25, r()),
  }));
  // fringe under the tail stock
  region('fringe', calf ? 90 : 260, (a, b, c) => {
    const s = sAt(a), t = tAt(a);
    return Math.min(s, 1 - s) < 0.07 && t > 0.025 && t < 0.24 && furTri(a, b, c) > 0.3 ? 1 : 0;
  }, () => ({
    len: lenK * (calf ? 0.028 : 0.032) * lerp(0.7, 1.2, r()), wid: lenK * 0.007 * lerp(0.7, 1.3, r()),
    lift: lerp(0.1, 0.3, r()), droop: lerp(0.6, 1.0, r()), curl: lerp(0.05, 0.3, r()),
  }));
  // wing-root tufts
  region('tuft', calf ? 120 : 220, (a, b, c) => {
    const t = tAt(a);
    const f = furTri(a, b, c);
    return Math.abs(t - P.wing.t) < 0.05 && f > 0.6 && Math.abs(sAt(a) - 0.5) > 0.2 ? f : 0;
  }, () => ({
    len: lenK * (calf ? 0.03 : 0.024) * lerp(0.7, 1.2, r()), wid: lenK * 0.007 * lerp(0.7, 1.3, r()),
    lift: lerp(0.3, 0.7, r()), droop: lerp(0.2, 0.5, r()), curl: lerp(0.1, 0.35, r()),
  }));
  if (calf) {
    // the calf's fluffy crown and cheeks
    region('crown', 420, (a, b, c) => (furTri(a, b, c) > 1.15 ? 1 : 0), () => ({
      len: lenK * 0.028 * lerp(0.7, 1.25, r()), wid: lenK * 0.009 * lerp(0.7, 1.3, r()),
      lift: lerp(0.6, 1.0, r()), droop: lerp(0.0, 0.3, r()), curl: lerp(0.3, 0.8, r()),
    }));
  }
  // fins: tufts along each wing's leading edge, a fringe along the flukes' leading edges
  if (finGeo) {
    const FA = finGeo.attributes.aFin;
    const wingLE = (i0) => {
      const id = FA.getZ(i0), u = FA.getX(i0), v = FA.getY(i0), top = FA.getW(i0);
      return id < 1.5 && v < 0.12 && top > 0.5 && u > 0.04 && u < (calf ? 0.7 : 0.55) ? 1 - u : 0;
    };
    const flukeLE = (i0) => {
      const id = FA.getZ(i0), u = FA.getX(i0), v = FA.getY(i0);
      return id > 3.5 && v < 0.1 && u < 0.5 ? 1 - u : 0;
    };
    const finCards = (name, n, wfn, opts) => {
      const samples = sampleTris(finGeo, finGeo.index.count / 3, wfn, Math.round(n * density), r, 'fin');
      for (const sm of samples) cards.push(Object.assign({ region: name }, sm, opts(sm)));
    };
    finCards('wingLE', calf ? 140 : 260, wingLE, () => ({
      len: lenK * (calf ? 0.022 : 0.018) * lerp(0.7, 1.2, r()), wid: lenK * 0.0055 * lerp(0.7, 1.3, r()),
      lift: lerp(0.15, 0.4, r()), droop: lerp(0.1, 0.3, r()), curl: lerp(0.05, 0.2, r()), finBack: 1,
    }));
    finCards('flukeLE', calf ? 60 : 160, flukeLE, () => ({
      len: lenK * (calf ? 0.02 : 0.02) * lerp(0.7, 1.2, r()), wid: lenK * 0.005 * lerp(0.7, 1.3, r()),
      lift: lerp(0.1, 0.3, r()), droop: lerp(0.0, 0.2, r()), curl: lerp(0.05, 0.2, r()), finBack: 1,
    }));
  }
  // shuffle so any prefix is an even subset (LOD by instanceCount)
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const tmp = cards[i]; cards[i] = cards[j]; cards[j] = tmp;
  }
  const n = cards.length;
  const aRoot = new Float32Array(n * 4), aNrm = new Float32Array(n * 3), aDir = new Float32Array(n * 3);
  const aShape = new Float32Array(n * 4), aTex = new Float32Array(n * 4), sI = new Uint16Array(n * 4), sW = new Float32Array(n * 4);
  const down = new Vector3(0, -1, 0), back = new Vector3(0, 0, -1);
  cards.forEach((cd, k) => {
    aRoot.set([cd.p.x, cd.p.y, cd.p.z, cd.len], k * 4);
    aNrm.set([cd.n.x, cd.n.y, cd.n.z], k * 3);
    // comb: back toward the tail, down the flanks (the mane falls), a little swirl
    const s = cd.loft[1];
    const flank = 1 - Math.abs(Math.cos(s * Math.PI * 2));
    const dir = back.clone().addScaledVector(down, cd.region === 'fringe' ? 1.4 : 0.25 + flank * 0.9 * (cd.region === 'ridge' ? 0.2 : 1));
    dir.x += (r() - 0.5) * 0.5;
    dir.addScaledVector(cd.n, -dir.dot(cd.n)).normalize();
    aDir.set([dir.x, dir.y, dir.z], k * 3);
    aShape.set([cd.wid, cd.lift, cd.droop, cd.curl + Math.floor(r() * 997) * 10], k * 4);
    aTex.set([cd.tex[0], cd.tex[1], cd.region === 'mane' ? 1 : 0, r()], k * 4);
    const arr = [...cd.bones.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4);
    const sum = arr.reduce((acc, e) => acc + e[1], 0) || 1;
    for (let j = 0; j < 4; j++) {
      sI[k * 4 + j] = j < arr.length ? arr[j][0] : 0;
      sW[k * 4 + j] = j < arr.length ? arr[j][1] / sum : 0;
    }
  });
  const tpl = lockTemplate();
  const geo = new InstancedBufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(tpl.pos, 3));
  geo.setIndex(tpl.idx);
  geo.setAttribute('aRoot', new InstancedBufferAttribute(aRoot, 4));
  geo.setAttribute('aNrm', new InstancedBufferAttribute(aNrm, 3));
  geo.setAttribute('aDir', new InstancedBufferAttribute(aDir, 3));
  geo.setAttribute('aShape', new InstancedBufferAttribute(aShape, 4));
  geo.setAttribute('aLockTex', new InstancedBufferAttribute(aTex, 4));
  geo.setAttribute('skinIndex', new InstancedBufferAttribute(sI, 4));
  geo.setAttribute('skinWeight', new InstancedBufferAttribute(sW, 4));
  geo.instanceCount = n;
  geo.userData.cards = n;
  return geo;
}
