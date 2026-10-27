// Procedural storm falcon (apex predator of the sky). A hexapod raptor about 25 m long with a
// ~70 m primary wingspan: two pairs of wings, two taloned legs, a hooked serrated beak, a
// crimson fan crest of sound-sensing plumes and four eyes. One skeleton drives three skinned
// meshes: the painted body (trunk, head, beak, legs, wing arms), ~300 layered feather cards
// posed per group on the GPU, and the eyes. Model space: +Z forward, +Y up, +X = left side.
import {
  BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, Uint32BufferAttribute,
  Bone, Skeleton, SkinnedMesh, Group, ShaderMaterial, Color, Vector3, Vector4, Matrix4, DoubleSide,
  FrontSide,
} from 'three';
import { G } from '../../render/Globals.js';
import { BODY_VERT, BODY_FRAG, FEATHER_VERT, FEATHER_FRAG, EYE_VERT, EYE_FRAG, NG } from './falconShaders.js';
import { smoothstep, clamp, lerp, rng, TAU } from '../../core/math.js';

export const FALCON_LOOK = {
  back: '#5b7396', backDark: '#3d4e6b', hood: '#2a3348', belly: '#f2e7d1', bar: '#8e8a9a',
  cere: '#f2c24c', feet: '#efbd3c', talon: '#16181f', beak: '#5f6d88', beakTip: '#1d2029',
  mouth: '#7a3141',
  fTop: '#587093', fTopDark: '#283247', fUnder: '#efe6d6', fBar: '#a29da9',
  crest: '#c0283b', crestTip: '#ff7c5c',
  iris: '#f2aa1c', iris2: '#5e2a07', ring: '#f2c24c',
};

/** Feather groups: each shares one pose uniform pair (uGA/uGB). */
export const FG = {
  PRI_L: 0, PRI_R: 1, SEC_L: 2, SEC_R: 3, COV_L: 4, COV_R: 5, ALU_L: 6, ALU_R: 7,
  HW_L: 8, HW_R: 9, HWC_L: 10, HWC_R: 11, TAIL: 12, STREAM: 13, TAILCOV: 14, CREST: 15,
  SCAP_L: 16, SCAP_R: 17, TROU_L: 18, TROU_R: 19,
};

// Feather kinds (shape + paint in the shader).
const K = { PRIMARY: 0, SECONDARY: 1, COVERT: 2, RECTRIX: 3, STREAMER: 4, CREST: 5, CONTOUR: 6, ALULA: 7, PALE: 8 };

const V = (x, y, z) => new Vector3(x, y, z);
const spow = (x, e) => Math.sign(x) * Math.pow(Math.abs(x), e);
const gauss = (x) => Math.exp(-x * x);
const SE = 2.25; // superellipse exponent of the trunk cross-section

// Trunk cross-sections at z stations (metres): centre height and half sizes.
const BODY = {
  z:   [-7.0, -6.3, -5.3, -4.1, -2.7, -1.1, 0.5, 1.9, 3.1, 4.2, 5.1, 5.9, 6.7, 7.5, 8.2, 8.75],
  cy:  [0.62, 0.58, 0.47, 0.32, 0.18, 0.10, 0.12, 0.30, 0.62, 1.05, 1.48, 1.88, 2.08, 2.12, 2.05, 1.98],
  hw:  [0.36, 0.72, 1.22, 1.72, 2.18, 2.52, 2.72, 2.72, 2.48, 2.02, 1.62, 1.50, 1.56, 1.48, 1.18, 0.66],
  top: [0.28, 0.52, 0.82, 1.12, 1.38, 1.58, 1.74, 1.84, 1.84, 1.64, 1.42, 1.44, 1.5, 1.4, 1.12, 0.62],
  bot: [0.28, 0.58, 0.98, 1.42, 1.88, 2.28, 2.58, 2.64, 2.40, 1.90, 1.45, 1.3, 1.24, 1.14, 0.94, 0.55],
};
const BROW = { z: 7.45, sz: 0.62, th: 0.7, sth: 0.24, a: 0.62 };
const EYE = { z: 7.3, th: 1.14, r: 0.56, sink: 0.42, front: 0.45 };
const EYE2 = { z: 6.35, th: 0.92, r: 0.22, sink: 0.25, front: 0.05 };

function table(T, key, z) {
  const Z = T.z, A = T[key];
  const n = Z.length;
  if (z <= Z[0]) return A[0];
  if (z >= Z[n - 1]) return A[n - 1];
  let i = 0;
  while (i < n - 2 && z > Z[i + 1]) i++;
  const s = (z - Z[i]) / (Z[i + 1] - Z[i]);
  const p0 = A[Math.max(0, i - 1)], p1 = A[i], p2 = A[i + 1], p3 = A[Math.min(n - 1, i + 2)];
  const s2 = s * s, s3 = s2 * s;
  return 0.5 * (2 * p1 + (-p0 + p2) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s2 + (-p0 + 3 * p1 - 3 * p2 + p3) * s3);
}

/** Smooth partition-of-unity weights along a bone chain [[boneIndex, dist], ...]. */
function ramp(chain, d, soft = 0.42) {
  const R = chain.map(([, dk], k) => {
    if (k === 0) return 1;
    const del = (dk - chain[k - 1][1]) * soft;
    return smoothstep(dk - del, dk + del, d);
  });
  const res = [];
  for (let k = 0; k < chain.length; k++) {
    const w = R[k] * (k + 1 < chain.length ? 1 - R[k + 1] : 1);
    if (w > 1e-4) res.push([chain[k][0], w]);
  }
  return res;
}

function pushWeights(SI, SW, ws) {
  ws = ws.slice().sort((a, b) => b[1] - a[1]);
  const top = ws.slice(0, 4);
  const sum = top.reduce((s, e) => s + e[1], 0) || 1;
  for (let k = 0; k < 4; k++) {
    if (k < top.length) { SI.push(top[k][0]); SW.push(top[k][1] / sum); } else { SI.push(0); SW.push(0); }
  }
}

function mixWeights(a, b, t) {
  const out = [];
  for (const [i, w] of a) out.push([i, w * (1 - t)]);
  for (const [i, w] of b) out.push([i, w * t]);
  // merge duplicates
  const m = new Map();
  for (const [i, w] of out) m.set(i, (m.get(i) || 0) + w);
  return [...m.entries()].filter(([, w]) => w > 1e-4);
}

/** Vertex/index accumulator for the body mesh. */
class BodyBuf {
  constructor() {
    this.pos = []; this.uv = []; this.part = []; this.toe = []; this.si = []; this.sw = []; this.idx = []; this.ctr = [];
  }
  v(p, uv, part, ws, ctr, toe = null) {
    this.pos.push(p.x, p.y, p.z);
    this.uv.push(uv[0], uv[1]);
    this.part.push(part[0], part[1] ?? 0, part[2] ?? 0, part[3] ?? 0);
    if (toe) this.toe.push(toe[0], toe[1], toe[2], toe[3]); else this.toe.push(0, 0, 0, -1);
    pushWeights(this.si, this.sw, ws);
    this.ctr.push(ctr.x, ctr.y, ctr.z);
    return this.pos.length / 3 - 1;
  }
  /** Quads between consecutive rows of vertex ids (closed loops when `closed`). */
  grid(rows, closed = true) {
    for (let i = 0; i < rows.length - 1; i++) {
      const a = rows[i], b = rows[i + 1];
      const n = a.length;
      const m = closed ? n : n - 1;
      for (let j = 0; j < m; j++) {
        const j2 = (j + 1) % n;
        this.idx.push(a[j], b[j], a[j2], a[j2], b[j], b[j2]);
      }
    }
  }
  fan(center, ring) {
    for (let j = 0; j < ring.length; j++) this.idx.push(center, ring[j], ring[(j + 1) % ring.length]);
  }
  /** Flip every triangle whose face normal points toward its stored axis centre. */
  orient(from = 0) {
    const P = this.pos, C = this.ctr, I = this.idx;
    for (let t = from; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const ox = (P[a] + P[b] + P[c] - C[a] - C[b] - C[c]) / 3;
      const oy = (P[a + 1] + P[b + 1] + P[c + 1] - C[a + 1] - C[b + 1] - C[c + 1]) / 3;
      const oz = (P[a + 2] + P[b + 2] + P[c + 2] - C[a + 2] - C[b + 2] - C[c + 2]) / 3;
      if (nx * ox + ny * oy + nz * oz < 0) { const tmp = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = tmp; }
    }
  }
}

export class FalconModel {
  constructor(look = FALCON_LOOK, seed = 5) {
    this.look = look;
    this.r = rng(seed);
    this.group = new Group();
    this.group.name = 'falcon';
    this.vanish = { value: 0 };
    this._buildSkeleton();
    this._buildEyesLayout();
    this.buf = new BodyBuf();
    this._buildTrunk();
    this._buildBeak();
    this._buildLegs();
    this._buildArms();
    this._finishBody();
    this._buildFeathers();
    this._buildEyes();
    this._bindAll();
  }

  // ---- skeleton -------------------------------------------------------------------------
  _buildSkeleton() {
    const abs = {}, bones = {}, list = [];
    const mk = (name, pos, parent) => {
      const b = new Bone();
      b.name = name;
      abs[name] = pos.clone();
      bones[name] = b;
      if (parent) { bones[parent].add(b); b.position.copy(pos).sub(abs[parent]); } else b.position.copy(pos);
      list.push(b);
      return b;
    };
    mk('root', V(0, 0, 0), null);
    mk('chest', V(0, 0.35, 1.9), 'root');
    mk('neck1', V(0, 0.95, 4.1), 'chest');
    mk('neck2', V(0, 1.5, 5.3), 'neck1');
    mk('head', V(0, 1.95, 6.5), 'neck2');
    mk('jaw', V(0, 1.42, 7.75), 'head');
    mk('beak', V(0, 2.55, 7.95), 'head');
    mk('crest', V(0, 2.95, 6.4), 'head');
    mk('pelvis', V(0, 0.15, -2.4), 'root');
    mk('tail1', V(0, 0.42, -5.0), 'pelvis');
    mk('tail2', V(0, 0.58, -6.5), 'tail1');
    this.wing = {};
    this.hind = {};
    this.leg = {};
    for (const s of [1, -1]) {
      const S = s > 0 ? 'L' : 'R';
      const sh = V(s * 2.0, 1.35, 1.75);
      const el = sh.clone().add(V(s * 6.5, 0, -0.3));
      const wr = el.clone().add(V(s * 9.0, 0, 0.25));
      const tip = wr.clone().add(V(s * 6.0, 0, -0.35));
      mk('sh' + S, sh, 'chest'); mk('el' + S, el, 'sh' + S); mk('wr' + S, wr, 'el' + S);
      this.wing[S] = { s, sh, el, wr, tip, d: [0, sh.distanceTo(el), sh.distanceTo(el) + el.distanceTo(wr), sh.distanceTo(el) + el.distanceTo(wr) + wr.distanceTo(tip)] };
      const h1 = V(s * 1.35, 0.8, -4.5);
      const h2 = h1.clone().add(V(s * 3.8, 0, -0.45));
      const h3 = h2.clone().add(V(s * 3.4, 0, -0.3));
      const ht = h3.clone().add(V(s * 2.4, 0, -0.35));
      mk('hw1' + S, h1, 'pelvis'); mk('hw2' + S, h2, 'hw1' + S); mk('hw3' + S, h3, 'hw2' + S);
      this.hind[S] = { s, sh: h1, el: h2, wr: h3, tip: ht, d: [0, h1.distanceTo(h2), h1.distanceTo(h2) + h2.distanceTo(h3), h1.distanceTo(h2) + h2.distanceTo(h3) + h3.distanceTo(ht)] };
      const hip = V(s * 1.35, -0.9, -1.8);
      const knee = hip.clone().add(V(0, -2.5, 0));
      const ankle = knee.clone().add(V(0, -3.0, 0));
      const foot = ankle.clone().add(V(0, -2.7, 0));
      mk('hip' + S, hip, 'pelvis'); mk('knee' + S, knee, 'hip' + S); mk('ankle' + S, ankle, 'knee' + S); mk('foot' + S, foot, 'ankle' + S);
      this.leg[S] = { s, hip, knee, ankle, foot };
    }
    this.bones = bones;
    this.boneAbs = abs;
    this.group.add(bones.root);
    this.group.updateMatrixWorld(true);
    this.skeleton = new Skeleton(list);
    this.bi = {};
    list.forEach((b, i) => (this.bi[b.name] = i));
  }

  // ---- trunk shape ------------------------------------------------------------------------
  prof(z) {
    let hw = table(BODY, 'hw', z), top = table(BODY, 'top', z), bot = table(BODY, 'bot', z);
    const cy = table(BODY, 'cy', z);
    const z1 = BODY.z[BODY.z.length - 1], z0 = BODY.z[0];
    // round the face front and the tail stub so they close cleanly
    let cap = 1;
    if (z > z1 - 0.55) { const s = (z - (z1 - 0.55)) / 0.55; cap = Math.sqrt(Math.max(0, 1 - s * s)); }
    if (z < z0 + 0.35) { const s = (z0 + 0.35 - z) / 0.35; cap = Math.sqrt(Math.max(0, 1 - s * s * 0.8)); }
    return { hw: hw * cap, top: top * cap, bot: bot * cap, cy };
  }

  trunkPoint(z, th, out = new Vector3(), brow = true) {
    const pr = this.prof(z);
    const sn = Math.sin(th), cs = Math.cos(th);
    let x = pr.hw * spow(sn, 2 / SE);
    let y = (cs >= 0 ? pr.top : pr.bot) * spow(cs, 2 / SE);
    if (brow) {
      // a heavy brow ridge over each eye gives the raptor its frown
      const b = BROW.a * gauss((z - BROW.z) / BROW.sz) * gauss((Math.abs(th) - BROW.th) / BROW.sth);
      // and a gently flattened crown between them
      const crown = -0.12 * gauss((z - 7.0) / 0.9) * gauss(th / 0.45);
      const r = Math.hypot(x, y) || 1;
      x += (x / r) * (b + crown);
      y += (y / r) * (b + crown);
    }
    return out.set(x, y + pr.cy, z);
  }

  trunkNormal(z, th, out = new Vector3()) {
    const e = 0.004;
    const p0 = this.trunkPoint(z, th, new Vector3(), false);
    const pz = this.trunkPoint(z + e, th, new Vector3(), false).sub(this.trunkPoint(z - e, th, new Vector3(), false));
    const pt = this.trunkPoint(z, th + e, new Vector3(), false).sub(this.trunkPoint(z, th - e, new Vector3(), false));
    out.crossVectors(pt, pz).normalize();
    const c = V(0, this.prof(z).cy, z);
    if (out.dot(p0.sub(c)) < 0) out.negate();
    return out;
  }

  _buildEyesLayout() {
    const mkEye = (E, s) => {
      const th = E.th * s;
      const sp = this.trunkPoint(E.z, th, new Vector3(), false);
      const sn = this.trunkNormal(E.z, th);
      const center = sp.clone().addScaledVector(sn, -E.r * E.sink);
      const gaze = sn.clone().multiplyScalar(1 - E.front).add(V(0, 0.02, E.front)).normalize();
      return { center, gaze, r: E.r, s };
    };
    this.eyeL = mkEye(EYE, 1);
    this.eyeR = mkEye(EYE, -1);
    this.eye2L = mkEye(EYE2, 1);
    this.eye2R = mkEye(EYE2, -1);
  }

  spineWeights(z) {
    const bi = this.bi;
    if (z <= 0) {
      return ramp([[bi.root, 0], [bi.pelvis, 2.4], [bi.tail1, 5.0], [bi.tail2, 6.5]], -z);
    }
    return ramp([[bi.root, 0], [bi.chest, 1.9], [bi.neck1, 4.1], [bi.neck2, 5.3], [bi.head, 6.5]], z, 0.48);
  }

  // ---- body parts -------------------------------------------------------------------------
  _buildTrunk() {
    const B = this.buf;
    const nR = 76, nS = 44;
    const z0 = BODY.z[0], z1 = BODY.z[BODY.z.length - 1];
    const rows = [];
    const p = new Vector3();
    let firstRing = null, lastRing = null;
    for (let i = 0; i < nR; i++) {
      const t = i / (nR - 1);
      // denser rings toward the head where the detail is
      const z = lerp(z0, z1, t + 0.06 * Math.sin(Math.PI * t) * (t - 0.2));
      const pr = this.prof(z);
      const ctr = V(0, pr.cy, z);
      const ws = this.spineWeights(z);
      // arc length from the dorsal midline (mirror-symmetric uv)
      const pts = [];
      for (let j = 0; j < nS; j++) {
        const th = -Math.PI + (j / nS) * TAU;
        pts.push({ th, p: this.trunkPoint(z, th, new Vector3()) });
      }
      const arc = new Float32Array(nS);
      // walk from the top (j = nS/2) outward both ways
      const top = nS / 2;
      arc[top] = 0;
      for (let k = 1; k <= nS / 2; k++) {
        const a = (top + k) % nS, a0 = (top + k - 1) % nS;
        const b = (top - k + nS) % nS, b0 = (top - k + 1 + nS) % nS;
        arc[a] = arc[a0] + pts[a].p.distanceTo(pts[a0].p);
        arc[b] = arc[b0] + pts[b].p.distanceTo(pts[b0].p);
      }
      const row = [];
      for (let j = 0; j < nS; j++) {
        p.copy(pts[j].p);
        row.push(B.v(p, [arc[j], z], [0, t, pts[j].th / Math.PI, 0], ws, ctr));
      }
      rows.push(row);
      if (i === 0) firstRing = { row, z, pr, ws };
      lastRing = { row, z, pr, ws };
    }
    B.grid(rows, true);
    // caps: the tail stub (hidden under the tail coverts) and the face front (inside the beak)
    const ct = B.v(V(0, firstRing.pr.cy, z0 - 0.12), [0, z0], [0, 0, 0, 0], firstRing.ws, V(0, firstRing.pr.cy, z0 + 0.5));
    B.fan(ct, firstRing.row);
    const cf = B.v(V(0, lastRing.pr.cy, z1 + 0.08), [0, z1], [0, 1, 0, 0], lastRing.ws, V(0, lastRing.pr.cy, z1 - 0.5));
    B.fan(cf, lastRing.row);
    B.orient(0);
  }

  _buildBeak() {
    const B = this.buf, bi = this.bi;
    const start = B.idx.length;
    const X = V(1, 0, 0);
    const crSpline = (pts, u, out) => {
      const n = pts.length - 1;
      const f = clamp(u, 0, 1) * n;
      const i = Math.min(n - 1, Math.floor(f));
      const s = f - i;
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
      const s2 = s * s, s3 = s2 * s;
      const c = (a, b, cc, d) => 0.5 * (2 * b + (-a + cc) * s + (2 * a - 5 * b + 4 * cc - d) * s2 + (-a + 3 * b - 3 * cc + d) * s3);
      return out.set(0, c(p0[1], p1[1], p2[1], p3[1]), c(p0[0], p1[0], p2[0], p3[0]));
    };
    const lerpArr = (arr, u) => {
      const n = arr.length - 1;
      const f = clamp(u, 0, 1) * n;
      const i = Math.min(n - 1, Math.floor(f));
      return lerp(arr[i], arr[i + 1], f - i);
    };
    const mandible = ({ pts, h, hTop, w, nU, nS, part, bone, tooth = false, nostrilY = 0 }) => {
      const rows = [];
      const c = new Vector3(), c2 = new Vector3(), T = new Vector3(), Up = new Vector3(), P = new Vector3();
      const ringInfo = [];
      for (let i = 0; i < nU; i++) {
        const u = i / (nU - 1);
        crSpline(pts, u, c);
        crSpline(pts, Math.min(1, u + 0.01), c2);
        if (u >= 0.99) { crSpline(pts, u - 0.01, T); T.subVectors(c, T); } else T.subVectors(c2, c);
        T.normalize();
        Up.crossVectors(T, X).normalize();
        const hh = lerpArr(h, u), ht = lerpArr(hTop, u), ww = lerpArr(w, u);
        const wb = smoothstep(0.03, 0.14, u);
        const ws = [[bi.head, 1 - wb], [bi[bone], wb]].filter((e) => e[1] > 1e-4);
        const row = [];
        for (let j = 0; j < nS; j++) {
          const th = -Math.PI + (j / nS) * TAU;
          const sn = Math.sin(th), cs = Math.cos(th);
          const ex = cs >= 0 ? 2 / 2.1 : 2 / 3.2; // rounded culmen, flatter cutting edge
          const x = ww * spow(sn, ex);
          let y = (cs >= 0 ? ht : hh) * spow(cs, ex);
          if (tooth && cs < -0.2) {
            // tomial "teeth": two serrations along the cutting edge before the hook
            const tt = Math.max(0, 1 - Math.abs(u - 0.58) / 0.045) + 0.8 * Math.max(0, 1 - Math.abs(u - 0.68) / 0.04);
            y -= tt * 0.16 * smoothstep(-0.2, -0.75, cs);
          }
          P.copy(c).addScaledVector(X, x).addScaledVector(Up, y);
          row.push(B.v(P, [Math.abs(th) * ww, u * 2.6], [part, u, th / Math.PI, nostrilY], ws, c));
        }
        rows.push(row);
        ringInfo.push({ c: c.clone(), ws });
      }
      B.grid(rows, true);
      // close the base (inside the head) and the tip
      const b0 = ringInfo[0];
      const cb = B.v(b0.c.clone().add(V(0, 0, -0.3)), [0, 0], [part, 0, 0, nostrilY], b0.ws, b0.c.clone().add(V(0, 0, 0.4)));
      B.fan(cb, rows[0]);
      const bl = ringInfo[nU - 1];
      crSpline(pts, 0.97, c2);
      const ctip = B.v(bl.c.clone().addScaledVector(bl.c.clone().sub(c2).normalize(), 0.03), [0, 2.6], [part, 1, 0, nostrilY], bl.ws, c2.clone());
      B.fan(ctip, rows[nU - 1]);
      return rows;
    };
    // upper mandible: cere -> hooked tip (z, y)
    this.upperPts = [[7.72, 2.1], [8.42, 2.13], [9.02, 2.02], [9.48, 1.83], [9.82, 1.52], [9.98, 1.1], [9.84, 0.7]];
    mandible({
      pts: this.upperPts,
      h: [0.68, 0.64, 0.57, 0.47, 0.35, 0.21, 0.03], hTop: [0.7, 0.64, 0.57, 0.45, 0.33, 0.19, 0.03],
      w: [0.94, 0.8, 0.63, 0.46, 0.3, 0.17, 0.03], nU: 34, nS: 22, part: 1, bone: 'beak', tooth: true, nostrilY: 2.3,
    });
    // lower mandible
    mandible({
      pts: [[7.65, 1.2], [8.25, 1.22], [8.85, 1.21], [9.3, 1.17], [9.58, 1.1]],
      h: [0.38, 0.32, 0.25, 0.16, 0.03], hTop: [0.42, 0.38, 0.31, 0.2, 0.04],
      w: [0.8, 0.66, 0.49, 0.29, 0.04], nU: 24, nS: 18, part: 2, bone: 'jaw',
    });
    // rictal walls: dark skin closing the sides of the gape when the beak opens
    for (const s of [1, -1]) {
      const rows = [];
      for (let i = 0; i <= 8; i++) {
        const u = i / 8;
        const z = lerp(7.8, 8.7, u);
        const x = s * lerp(0.74, 0.5, u);
        const row = [];
        for (let k = 0; k <= 3; k++) {
          const f = k / 3;
          const y = lerp(1.62, 1.28, f);
          const wj = f * smoothstep(0.0, 0.25, u);
          const ws = mixWeights([[bi.beak, 1]], [[bi.jaw, 1]], wj);
          row.push(B.v(V(x, y, z), [u, f], [7, u, 0, 0], ws, V(0, y, z)));
        }
        rows.push(row);
      }
      B.grid(rows, false);
    }
    B.orient(start);
  }

  _buildLegs() {
    const B = this.buf, bi = this.bi;
    this.toes = [];
    for (const S of ['L', 'R']) {
      const L = this.leg[S];
      const s = L.s;
      const start = B.idx.length;
      const D1 = 2.5, D2 = 5.5, D3 = 8.2;
      const chain = [[bi['hip' + S], 0], [bi['knee' + S], D1], [bi['ankle' + S], D2], [bi['foot' + S], D3]];
      const nR = 40, nA = 16;
      const rows = [];
      const radius = (d) => {
        if (d < D1) return 0.95 + 0.14 * Math.sin(Math.PI * d / D1);
        if (d < D2) { const u = (d - D1) / (D2 - D1); return lerp(0.98, 0.6, smoothstep(0.0, 0.85, u)) - 0.16 * smoothstep(0.85, 1.0, u); }
        if (d < D3) return lerp(0.42, 0.36, (d - D2) / (D3 - D2));
        const u = (d - D3) / 0.45;
        return 0.5 * Math.sqrt(Math.max(0, 1 - u * u)) + 0.02;
      };
      for (let i = 0; i < nR; i++) {
        const t = i / (nR - 1);
        const d = t * (D3 + 0.45);
        const c = L.hip.clone().add(V(0, -d, 0));
        let ws = ramp(chain, d, 0.22);
        if (d < 0.9) ws = mixWeights([[bi.pelvis, 1]], ws, smoothstep(0.0, 0.9, d) * 0.6 + 0.4);
        const r = radius(d);
        const part = d < D2 - 0.25 ? 3 : 4;
        const row = [];
        for (let j = 0; j < nA; j++) {
          const a = (j / nA) * TAU;
          const rx = Math.sin(a), rz = Math.cos(a);
          const p = c.clone().add(V(rx * r * (d > D2 ? 0.92 : 1), 0, rz * r));
          row.push(B.v(p, [Math.abs(a - Math.PI) * r, d], [part, part === 4 ? (d - D2) / (D3 - D2) : d / D2, rz, 0], ws, c));
        }
        rows.push(row);
      }
      B.grid(rows, true);
      // toes: middle, inner, outer, hallux (with curved talons)
      const F = L.foot;
      const specs = [
        { dir: V(0, 0, 1), len: 2.75, tal: 1.15 },
        { dir: V(-s * Math.sin(0.42), 0, Math.cos(0.42)), len: 2.35, tal: 1.1 },
        { dir: V(s * Math.sin(0.5), 0, Math.cos(0.5)), len: 2.45, tal: 1.05 },
        { dir: V(-s * 0.18, 0, -1).normalize(), len: 1.95, tal: 1.3 },
      ];
      specs.forEach((sp, k) => {
        const ti = (s > 0 ? 0 : 4) + k;
        const root = F.clone().add(V(0, -0.22, 0)).addScaledVector(sp.dir, 0.22);
        const down = V(0, -1, 0);
        const axis = new Vector3().crossVectors(sp.dir, down).normalize();
        const side = new Vector3().crossVectors(down, sp.dir).normalize();
        this.toes[ti] = { dir: sp.dir.clone(), axis, len: sp.len, side: s, k };
        const toeRows = [];
        const nT = 16, nTal = 10, nA2 = 10;
        const ws = [[bi['foot' + S], 1]];
        for (let i = 0; i <= nT + nTal; i++) {
          let cpos, rad, part, along;
          if (i <= nT) {
            const a = i / nT;
            along = a;
            cpos = root.clone().addScaledVector(sp.dir, a * sp.len);
            // phalanx pads bulge between the knuckles
            rad = lerp(0.31, 0.23, a) * (1 + 0.1 * Math.pow(Math.sin(a * Math.PI * 3), 2));
            part = 5;
          } else {
            const tt = (i - nT) / nTal;
            along = 1 + tt;
            const beta = 1.75;
            const Lt = sp.tal;
            const tipBase = root.clone().addScaledVector(sp.dir, sp.len);
            cpos = tipBase.addScaledVector(sp.dir, Math.sin(beta * tt) / beta * Lt).addScaledVector(down, (1 - Math.cos(beta * tt)) / beta * Lt);
            rad = 0.21 * Math.pow(1 - tt, 0.85) + 0.004;
            part = 6;
          }
          const row = [];
          for (let j = 0; j < nA2; j++) {
            const a = (j / nA2) * TAU;
            const up = -Math.cos(a);
            const off = side.clone().multiplyScalar(Math.sin(a) * rad).addScaledVector(down, Math.cos(a) * rad * (part === 5 ? 0.9 : 1));
            row.push(B.v(cpos.clone().add(off), [along * 2, a], [part, part === 5 ? along : along - 1, up, 0], ws, cpos, [root.x, root.y, root.z, ti]));
          }
          toeRows.push(row);
        }
        B.grid(toeRows, true);
        const last = toeRows[toeRows.length - 1];
        const tipC = B.v(V(0, 0, 0), [0, 0], [6, 1, 0, 0], ws, V(0, 0, 0), [root.x, root.y, root.z, ti]);
        // place the tip vertex at the average of the last ring
        let ax = 0, ay = 0, az = 0;
        for (const id of last) { ax += B.pos[id * 3]; ay += B.pos[id * 3 + 1]; az += B.pos[id * 3 + 2]; }
        B.pos[tipC * 3] = ax / last.length; B.pos[tipC * 3 + 1] = ay / last.length; B.pos[tipC * 3 + 2] = az / last.length;
        const prevRing = toeRows[toeRows.length - 2];
        let px = 0, py = 0, pz = 0;
        for (const id of prevRing) { px += B.pos[id * 3]; py += B.pos[id * 3 + 1]; pz += B.pos[id * 3 + 2]; }
        B.ctr[tipC * 3] = px / last.length; B.ctr[tipC * 3 + 1] = py / last.length; B.ctr[tipC * 3 + 2] = pz / last.length;
        B.fan(tipC, last);
      });
      B.orient(start);
    }
  }

  /** Lofted wing arm (leading-edge muscle + lesser coverts) along a wing bone chain. */
  _armLoft(W, S, opts, part) {
    const B = this.buf, bi = this.bi;
    const start = B.idx.length;
    const s = W.s;
    const pts = [W.sh, W.el, W.wr, W.tip];
    const D = W.d;
    const total = D[3];
    const chainPt = (d, out) => {
      let k = 0;
      while (k < 2 && d > D[k + 1]) k++;
      const f = clamp((d - D[k]) / (D[k + 1] - D[k]), 0, 1);
      return out.copy(pts[k]).lerp(pts[k + 1], f);
    };
    const prof = (arr, d) => {
      const f = clamp(d / total, 0, 1) * (arr.length - 1);
      const i = Math.min(arr.length - 2, Math.floor(f));
      return lerp(arr[i], arr[i + 1], smoothstep(0, 1, f - i));
    };
    const nU = opts.nU, nL = opts.nL;
    const boneChain = [[bi[opts.bones[0] + S], D[0]], [bi[opts.bones[1] + S], D[1]], [bi[opts.bones[2] + S], D[2]]];
    const rows = [];
    const c = new Vector3();
    for (let i = 0; i < nU; i++) {
      const u = i / (nU - 1);
      const d = u * total;
      chainPt(d, c);
      let chord = prof(opts.chord, d), thick = prof(opts.thick, d);
      const lead = prof(opts.lead, d);
      const tipK = d > total - opts.tipRound ? Math.sqrt(Math.max(0, 1 - ((d - (total - opts.tipRound)) / opts.tipRound) ** 2)) : 1;
      chord *= Math.max(tipK, 0.04);
      thick *= Math.max(tipK, 0.04);
      let ws = ramp(boneChain, d, 0.3);
      if (d < opts.rootBlend) ws = mixWeights([[bi[opts.parent], 1]], ws, smoothstep(0, opts.rootBlend, d));
      const ctr = c.clone().add(V(0, 0, lead - chord * 0.35));
      const row = [];
      const h = nL / 2;
      for (let k = 0; k <= nL; k++) {
        // k <= h: top surface LE -> TE; k > h: bottom surface TE -> LE (TE vertex duplicated)
        const kk = k <= h ? k : k - 1;
        const ph = (kk / nL) * TAU;
        const v = 0.5 - 0.5 * Math.cos(ph);
        const top = k <= h && k > 0 ? 1 : k === 0 ? 0 : -1;
        const ht = thick * 1.56 * Math.sqrt(v) * Math.pow(1 - v, 1.6) + 0.01;
        const camber = 0.05 * chord * Math.sin(Math.PI * v);
        const p = c.clone().add(V(0, camber + Math.sign(top || 1) * (top === 0 ? 0 : ht), lead - v * chord));
        row.push(B.v(p, [d, v * chord], [part, u, v, top], ws, ctr));
      }
      rows.push(row);
    }
    B.grid(rows, true);
    B.orient(start);
  }

  _buildArms() {
    for (const S of ['L', 'R']) {
      this._armLoft(this.wing[S], S, {
        nU: 34, nL: 18, bones: ['sh', 'el', 'wr'], parent: 'chest', rootBlend: 1.8, tipRound: 1.4,
        chord: [4.4, 3.9, 3.3, 2.6, 1.2], thick: [1.3, 0.85, 0.62, 0.45, 0.16], lead: [0.9, 0.6, 0.5, 0.42, 0.2],
      }, 8);
      this._armLoft(this.hind[S], S, {
        nU: 20, nL: 14, bones: ['hw1', 'hw2', 'hw3'], parent: 'pelvis', rootBlend: 1.2, tipRound: 0.9,
        chord: [2.4, 2.0, 1.6, 1.1, 0.5], thick: [0.75, 0.5, 0.36, 0.24, 0.1], lead: [0.5, 0.36, 0.3, 0.22, 0.1],
      }, 9);
    }
  }

  _finishBody() {
    const B = this.buf;
    const L = this.look;
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(B.pos, 3));
    geo.setAttribute('normal', new Float32BufferAttribute(new Float32Array(B.pos.length), 3));
    geo.setAttribute('uv', new Float32BufferAttribute(B.uv, 2));
    geo.setAttribute('aPart', new Float32BufferAttribute(B.part, 4));
    geo.setAttribute('aToe', new Float32BufferAttribute(B.toe, 4));
    geo.setAttribute('skinIndex', new Uint16BufferAttribute(B.si, 4));
    geo.setAttribute('skinWeight', new Float32BufferAttribute(B.sw, 4));
    geo.setIndex(B.pos.length / 3 > 65535 ? new Uint32BufferAttribute(B.idx, 1) : new Uint16BufferAttribute(B.idx, 1));
    geo.computeVertexNormals();
    const c = (h) => new Color(h);
    const toeDir = [], toeAxis = [], toe = [];
    for (let i = 0; i < 8; i++) {
      const t = this.toes[i];
      toeDir.push(t.dir.clone());
      toeAxis.push(t.axis.clone());
      toe.push(new Vector4(0, 0, t.len, 0));
    }
    this.uBody = {
      uBack: { value: c(L.back) }, uBackDark: { value: c(L.backDark) }, uHood: { value: c(L.hood) },
      uBelly: { value: c(L.belly) }, uBar: { value: c(L.bar) }, uCere: { value: c(L.cere) },
      uFeet: { value: c(L.feet) }, uTalon: { value: c(L.talon) }, uBeak: { value: c(L.beak) },
      uBeakTip: { value: c(L.beakTip) }, uMouth: { value: c(L.mouth) },
      uEye: { value: new Vector4(this.eyeL.center.x, this.eyeL.center.y, this.eyeL.center.z, this.eyeL.r) },
      uEye2: { value: new Vector4(this.eye2L.center.x, this.eye2L.center.y, this.eye2L.center.z, this.eye2L.r) },
      uToeDir: { value: toeDir }, uToeAxis: { value: toeAxis }, uToe: { value: toe },
      uVanish: this.vanish,
    };
    const mat = new ShaderMaterial({
      vertexShader: BODY_VERT, fragmentShader: BODY_FRAG,
      uniforms: Object.assign({}, G, this.uBody), side: DoubleSide,
    });
    const mesh = new SkinnedMesh(geo, mat);
    mesh.name = 'falconBody';
    mesh.frustumCulled = false;
    this.body = mesh;
    this.group.add(mesh);
    this.buf = null;
  }

  // ---- feathers ----------------------------------------------------------------------------------
  _buildFeathers() {
    const bi = this.bi;
    const A = {
      pos: [], nor: [], root: [], axis: [], p1: [], p2: [], shape: [], si: [], sw: [], idx: [],
    };
    this.featherCount = 0;
    const r = this.r;
    /**
     * f: { root, dir, n, len, w, kind, group, fan, fold, raise, twist, notch, stack, ws, side, curve, tilt }
     */
    const add = (f) => {
      const n = f.n.clone().normalize();
      const dir = f.dir.clone().sub(n.clone().multiplyScalar(f.dir.dot(n))).normalize();
      const side = f.side ?? 1;
      // across axis: x < 0 is the outer (leading) vane
      const across = new Vector3().crossVectors(dir, n).multiplyScalar(-side);
      const rows = f.len > 7 ? 8 : f.len > 3.5 ? 6 : 4;
      const cols = [-1, 0, 1];
      const base = A.pos.length / 3;
      const curve = f.curve ?? 0.1;
      const tilt = f.tilt ?? 0.07;
      const seed = r();
      for (let i = 0; i < rows; i++) {
        const along = i / (rows - 1);
        for (const x of cols) {
          const cw = f.w * 1.06;
          const p = f.root.clone()
            .addScaledVector(dir, along * f.len)
            .addScaledVector(across, x * cw)
            .addScaledVector(n, -curve * cw * x * x - tilt * cw * x);
          A.pos.push(p.x, p.y, p.z);
          A.nor.push(n.x, n.y, n.z);
          A.root.push(f.root.x, f.root.y, f.root.z, f.group);
          A.axis.push(dir.x, dir.y, dir.z, f.len);
          A.p1.push(f.fan ?? 0, f.fold ?? 0, f.raise ?? 0, f.kind);
          A.p2.push(seed, f.notch ?? 0, f.stack ?? 0, f.twist ?? 0);
          A.shape.push(x * 1.06, along, f.w);
          pushWeights(A.si, A.sw, f.ws);
        }
      }
      for (let i = 0; i < rows - 1; i++) {
        for (let j = 0; j < 2; j++) {
          const a = base + i * 3 + j, b = a + 1, c2 = a + 3, d = a + 4;
          // front face = dorsal side (along n)
          const pa = V(A.pos[a * 3], A.pos[a * 3 + 1], A.pos[a * 3 + 2]);
          const pb = V(A.pos[b * 3], A.pos[b * 3 + 1], A.pos[b * 3 + 2]);
          const pc = V(A.pos[c2 * 3], A.pos[c2 * 3 + 1], A.pos[c2 * 3 + 2]);
          const fn = pb.sub(pa).cross(pc.sub(pa));
          if (fn.dot(n) >= 0) A.idx.push(a, b, c2, b, d, c2);
          else A.idx.push(a, c2, b, b, c2, d);
        }
      }
      this.featherCount++;
    };
    this._wingFeathers(add);
    this._hindFeathers(add);
    this._tailFeathers(add);
    this._crestFeathers(add);
    this._contourFeathers(add);

    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(A.pos, 3));
    geo.setAttribute('normal', new Float32BufferAttribute(A.nor, 3));
    geo.setAttribute('aRoot', new Float32BufferAttribute(A.root, 4));
    geo.setAttribute('aAxis', new Float32BufferAttribute(A.axis, 4));
    geo.setAttribute('aP1', new Float32BufferAttribute(A.p1, 4));
    geo.setAttribute('aP2', new Float32BufferAttribute(A.p2, 4));
    geo.setAttribute('aShape', new Float32BufferAttribute(A.shape, 3));
    geo.setAttribute('skinIndex', new Uint16BufferAttribute(A.si, 4));
    geo.setAttribute('skinWeight', new Float32BufferAttribute(A.sw, 4));
    geo.setIndex(A.pos.length / 3 > 65535 ? new Uint32BufferAttribute(A.idx, 1) : new Uint16BufferAttribute(A.idx, 1));
    const L = this.look;
    const c = (h) => new Color(h);
    this.uFeather = {
      uGA: { value: Array.from({ length: NG }, () => new Vector4(0, 0, 0, 0)) },
      uGB: { value: Array.from({ length: NG }, () => new Vector4(0, 0, 0, 10)) },
      uFTop: { value: c(L.fTop) }, uFTopDark: { value: c(L.fTopDark) }, uFUnder: { value: c(L.fUnder) },
      uFBar: { value: c(L.fBar) }, uCrest: { value: c(L.crest) }, uCrestTip: { value: c(L.crestTip) },
      uBelly: { value: c(L.belly) }, uBar: { value: c(L.bar) }, uHood: { value: c(L.hood) },
      uVanish: this.vanish,
    };
    const mat = new ShaderMaterial({
      vertexShader: FEATHER_VERT, fragmentShader: FEATHER_FRAG,
      uniforms: Object.assign({}, G, this.uFeather), side: DoubleSide,
    });
    mat.alphaToCoverage = true;
    const mesh = new SkinnedMesh(geo, mat);
    mesh.name = 'falconFeathers';
    mesh.frustumCulled = false;
    this.feathers = mesh;
    this.group.add(mesh);
  }

  /** Bone weights for a point on a wing given its span distance from the shoulder. */
  _wingWeights(W, S, d, names, parent, rootBlend) {
    const bi = this.bi;
    let ws = ramp([[bi[names[0] + S], W.d[0]], [bi[names[1] + S], W.d[1]], [bi[names[2] + S], W.d[2]]], d, 0.25);
    if (d < rootBlend) ws = mixWeights([[bi[parent], 1]], ws, smoothstep(0, rootBlend, d));
    return ws;
  }

  _wingFeathers(add) {
    const bi = this.bi;
    const up = V(0, 1, 0);
    for (const S of ['L', 'R']) {
      const W = this.wing[S];
      const s = W.s;
      const gP = s > 0 ? FG.PRI_L : FG.PRI_R, gS = s > 0 ? FG.SEC_L : FG.SEC_R;
      const gC = s > 0 ? FG.COV_L : FG.COV_R, gA = s > 0 ? FG.ALU_L : FG.ALU_R;
      const dirAt = (ang) => V(s * Math.sin(ang), 0, -Math.cos(ang));
      const hand = (f) => W.wr.clone().lerp(W.tip, f);
      const arm = (f) => W.el.clone().lerp(W.wr, f);
      // primaries P1 (inner) .. P10 (outer) fan from the hand
      const PL = [8.2, 8.6, 9.1, 9.6, 10.1, 10.6, 11.1, 11.5, 11.6, 11.0];
      const PW = [0.9, 0.9, 0.88, 0.85, 0.82, 0.78, 0.72, 0.66, 0.6, 0.55];
      const PN = [0, 0, 0, 0, 0, 0, 0, 0.45, 0.75, 0.85];
      const pAng = [];
      for (let i = 0; i < 10; i++) {
        const f = i / 9;
        const ang = lerp(0.2, 1.32, Math.pow(f, 1.05));
        pAng.push(ang);
        const root = hand(0.08 + 0.92 * Math.pow(f, 0.9)).add(V(0, -0.05, -0.25 + 0.1 * f));
        add({
          root, dir: dirAt(ang), n: up, len: PL[i], w: PW[i], kind: K.PRIMARY, group: gP, side: s,
          fan: -s * (0.08 + 0.42 * f), fold: -s * (1.5 - ang), twist: -s * (0.25 + 0.75 * f), notch: PN[i],
          stack: 0.035 * (9 - i), ws: [[bi['wr' + S], 1]],
        });
      }
      // secondaries along the forearm
      const NS = 14;
      for (let j = 0; j < NS; j++) {
        const f = (j + 0.5) / NS;
        const root = arm(f).add(V(0, -0.02, -0.35));
        const ang = lerp(-0.06, 0.16, f);
        const d = W.d[1] + f * (W.d[2] - W.d[1]);
        add({
          root, dir: dirAt(ang), n: up, len: lerp(7.6, 7.9, f), w: 0.86, kind: K.SECONDARY, group: gS, side: s,
          fan: -s * 0.04 * f, fold: -s * (-1.45 - ang), twist: -s * 0.25 * f, stack: 0.03 * (NS - j) + 0.04,
          ws: this._wingWeights(W, S, d, ['sh', 'el', 'wr'], 'chest', 0),
        });
      }
      // tertials near the body
      for (let k = 0; k < 4; k++) {
        const f = 0.45 + 0.17 * k;
        const root = W.sh.clone().lerp(W.el, f).add(V(0, 0.12, -0.5));
        const ang = -0.1 - 0.05 * k;
        const d = f * W.d[1];
        add({
          root, dir: dirAt(ang), n: up, len: 7.2 - 0.3 * k, w: 0.95, kind: K.SECONDARY, group: gS, side: s,
          fold: -s * (1.0 - ang) * 0.85, stack: 0.5 + 0.05 * (4 - k),
          ws: this._wingWeights(W, S, d, ['sh', 'el', 'wr'], 'chest', 1.5),
        });
      }
      // greater + median coverts over the secondaries
      for (let j = 0; j < NS; j++) {
        const f = (j + 0.5) / NS;
        const d = W.d[1] + f * (W.d[2] - W.d[1]);
        const ang = lerp(-0.06, 0.16, f);
        const ws = this._wingWeights(W, S, d, ['sh', 'el', 'wr'], 'chest', 0);
        const jit = (this.r() - 0.5);
        add({
          root: arm(f).add(V(0, 0.3, 0.05)), dir: dirAt(ang + jit * 0.06), n: up, len: 3.3 + jit * 0.5, w: 0.74, kind: K.COVERT, group: gC, side: s,
          fold: -s * (-1.45 - ang) * 0.95, raise: 0.6, stack: 0.25 + 0.02 * (NS - j), ws, curve: 0.14,
        });
        if (j % 1 === 0) {
          const f2 = clamp(f + 0.5 / NS, 0, 1);
          add({
            root: arm(f2).add(V(0, 0.48, 0.65)), dir: dirAt(ang + 0.02 - jit * 0.05), n: up, len: 2.2 - jit * 0.4, w: 0.62, kind: K.COVERT, group: gC, side: s,
            fold: -s * (-1.45 - ang) * 0.9, raise: 0.9, stack: 0.4 + 0.02 * (NS - j), ws, curve: 0.16,
          });
        }
      }
      // coverts over the inner arm (humerus)
      for (let j = 0; j < 6; j++) {
        const f = 0.25 + 0.13 * j;
        const d = f * W.d[1];
        add({
          root: W.sh.clone().lerp(W.el, f).add(V(0, 0.5, 0.3)), dir: dirAt(-0.12), n: up, len: 3.0, w: 0.8, kind: K.COVERT,
          group: gC, side: s, fold: -s * 1.0 * 0.8, raise: 0.7, stack: 0.6 + 0.02 * j, curve: 0.14,
          ws: this._wingWeights(W, S, d, ['sh', 'el', 'wr'], 'chest', 1.5),
        });
      }
      // primary coverts over the hand
      for (let i = 0; i < 9; i++) {
        const f = (i + 0.5) / 9;
        add({
          root: hand(0.05 + 0.8 * f).add(V(0, 0.28, 0.1)), dir: dirAt(lerp(0.25, 1.2, f)), n: up, len: 3.6 - 0.8 * f,
          w: 0.62, kind: K.COVERT, group: gC, side: s, fold: -s * (1.5 - lerp(0.25, 1.2, f)) * 0.95, raise: 0.5,
          stack: 0.3 + 0.02 * (9 - i), ws: [[bi['wr' + S], 1]], curve: 0.12,
        });
      }
      // alula: the bastard wing at the wrist, raised as a slat when braking
      for (let k = 0; k < 3; k++) {
        add({
          root: W.wr.clone().add(V(s * 0.25 * k, 0.4, 0.55 - 0.08 * k)), dir: V(s * 0.9, 0.0, -0.42 - 0.12 * k).normalize(),
          n: up, len: 2.7 - 0.4 * k, w: 0.36, kind: K.ALULA, group: gA, side: s, raise: 1.0 - 0.15 * k, stack: 0.55 + 0.03 * k,
          fold: -s * 0.5, ws: [[bi['wr' + S], 1]], curve: 0.05,
        });
      }
    }
  }

  _hindFeathers(add) {
    const bi = this.bi;
    const up = V(0, 1, 0);
    for (const S of ['L', 'R']) {
      const W = this.hind[S];
      const s = W.s;
      const g = s > 0 ? FG.HW_L : FG.HW_R, gc = s > 0 ? FG.HWC_L : FG.HWC_R;
      const dirAt = (ang) => V(s * Math.sin(ang), 0, -Math.cos(ang));
      for (let i = 0; i < 7; i++) {
        const f = i / 6;
        const ang = lerp(0.22, 1.2, f);
        add({
          root: W.wr.clone().lerp(W.tip, 0.1 + 0.9 * f).add(V(0, -0.03, -0.15)), dir: dirAt(ang), n: up,
          len: [4.4, 4.7, 5.0, 5.3, 5.5, 5.4, 4.9][i], w: 0.55, kind: K.PRIMARY, group: g, side: s,
          fan: -s * (0.06 + 0.4 * f), fold: -s * (1.45 - ang), twist: -s * (0.3 + 0.7 * f), notch: i > 4 ? 0.6 : 0,
          stack: 0.03 * (6 - i), ws: [[bi['hw3' + S], 1]],
        });
      }
      for (let j = 0; j < 7; j++) {
        const f = (j + 0.5) / 7;
        const d = W.d[1] + f * (W.d[2] - W.d[1]);
        const ang = lerp(-0.05, 0.14, f);
        const ws = this._wingWeights(W, S, d, ['hw1', 'hw2', 'hw3'], 'pelvis', 0);
        add({
          root: W.el.clone().lerp(W.wr, f).add(V(0, -0.02, -0.25)), dir: dirAt(ang), n: up, len: 4.0, w: 0.56,
          kind: K.SECONDARY, group: g, side: s, fold: -s * (-1.4 - ang) * 0.7, stack: 0.03 * (7 - j) + 0.03, ws,
        });
        add({
          root: W.el.clone().lerp(W.wr, f).add(V(0, 0.22, 0.15)), dir: dirAt(ang), n: up, len: 1.9, w: 0.5,
          kind: K.COVERT, group: gc, side: s, fold: -s * (-1.4 - ang) * 0.65, raise: 0.6, stack: 0.2 + 0.02 * (7 - j), ws, curve: 0.14,
        });
      }
      // inner hind-wing feathers bridge the gap to the body
      for (let k = 0; k < 3; k++) {
        const f = 0.3 + 0.25 * k;
        add({
          root: W.sh.clone().lerp(W.el, f).add(V(0, 0.05, -0.3)), dir: dirAt(-0.15), n: up, len: 3.6, w: 0.62,
          kind: K.SECONDARY, group: g, side: s, fold: -s * 0.8, stack: 0.3,
          ws: this._wingWeights(W, S, f * W.d[1], ['hw1', 'hw2', 'hw3'], 'pelvis', 1.0),
        });
      }
    }
  }

  _tailFeathers(add) {
    const bi = this.bi;
    const T = this.boneAbs.tail2;
    const up = V(0, 1, 0);
    const N = 12;
    for (let k = 0; k < N; k++) {
      const a = (k - (N - 1) / 2) / ((N - 1) / 2); // -1..1 (+X side positive)
      add({
        root: T.clone().add(V(a * 0.85, 0.02 + 0.02 * (1 - Math.abs(a)), -0.2)), dir: V(a * 0.1, 0, -1).normalize(), n: up,
        len: 7.0 + 0.5 * (1 - a * a), w: 0.8, kind: K.RECTRIX, group: FG.TAIL, side: Math.sign(a) || 1,
        fan: -a * 1.15, stack: 0.035 * (6 - Math.abs(k - (N - 1) / 2)), ws: [[bi.tail2, 1]],
      });
    }
    // two long racket-tipped streamers from the centre of the tail
    for (const s of [1, -1]) {
      add({
        root: T.clone().add(V(s * 0.14, 0.16, -0.1)), dir: V(s * 0.025, 0.0, -1).normalize(), n: up, len: 15.5, w: 0.62,
        kind: K.STREAMER, group: FG.STREAM, side: s, fan: -s * 0.22, stack: 0.32, ws: [[bi.tail2, 1]], curve: 0.06, tilt: 0,
      });
    }
    // upper tail coverts
    for (let k = 0; k < 7; k++) {
      const a = (k - 3) / 3;
      const p = V(a * 0.75, 0.98 - 0.12 * a * a, -5.0);
      add({
        root: p, dir: V(a * 0.12, -0.06, -1).normalize(), n: V(0, 1, 0.05), len: 3.7, w: 0.78, kind: K.COVERT,
        group: FG.TAILCOV, side: Math.sign(a) || 1, fan: -a * 0.35, stack: 0.03 * (3 - Math.abs(k - 3)),
        ws: [[bi.tail1, 0.6], [bi.tail2, 0.4]], curve: 0.12,
      });
    }
    // pale under-tail coverts
    for (let k = 0; k < 5; k++) {
      const a = (k - 2) / 2;
      add({
        root: V(a * 0.7, -0.05, -5.2), dir: V(a * 0.14, 0.02, -1).normalize(), n: V(0, -1, 0), len: 4.6, w: 0.8,
        kind: K.PALE, group: FG.TAILCOV, side: Math.sign(a) || 1, fan: a * 0.3, stack: 0.03 * (2 - Math.abs(k - 2)),
        ws: [[bi.tail1, 0.6], [bi.tail2, 0.4]], curve: 0.1,
      });
    }
  }

  _crestFeathers(add) {
    const bi = this.bi;
    const N = 9;
    for (let k = 0; k < N; k++) {
      const a = (k - (N - 1) / 2) / ((N - 1) / 2);
      const root = V(a * 0.7, 3.5 - 0.22 * a * a, 7.2 - 0.3 * a * a);
      add({
        root, dir: V(a * 0.2, -0.2, -1).normalize(), n: V(0, 1, -0.2), len: 4.0 - 1.1 * Math.abs(a), w: 0.44,
        kind: K.CREST, group: FG.CREST, side: Math.sign(a) || 1, fan: -a * 0.95, raise: 1.0 - 0.3 * Math.abs(a),
        stack: 0.05 * (4 - Math.abs(k - 4)), ws: [[bi.crest, 1]], curve: 0.12, tilt: 0.02,
      });
    }
  }

  _contourFeathers(add) {
    const bi = this.bi;
    for (const S of ['L', 'R']) {
      const s = S === 'L' ? 1 : -1;
      // scapulars: shingle over the wing root and blend it into the back
      for (let k = 0; k < 7; k++) {
        const z = 2.6 - 0.62 * k;
        const pr = this.prof(z);
        const root = V(s * (pr.hw * 0.52), pr.cy + pr.top * 0.86, z);
        add({
          root, dir: V(s * 0.42, -0.08, -1).normalize(), n: V(s * 0.3, 1, 0).normalize(), len: 4.6 + 0.2 * k, w: 0.98,
          kind: K.CONTOUR, group: s > 0 ? FG.SCAP_L : FG.SCAP_R, side: s, raise: 0.6, stack: 0.03 * k,
          ws: [[bi.chest, 0.6], [bi['sh' + S], 0.4]], curve: 0.14,
        });
      }
      // trousers: pale feathered fringe hanging over the top of the tarsus
      const Lg = this.leg[S];
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * TAU;
        const rad = V(Math.sin(a), 0, Math.cos(a));
        const root = Lg.knee.clone().add(V(0, -1.75, 0)).addScaledVector(rad, 0.66);
        add({
          root, dir: V(0, -1, 0).addScaledVector(rad, 0.22).normalize(), n: rad, len: 2.2, w: 0.6, kind: K.PALE,
          group: s > 0 ? FG.TROU_L : FG.TROU_R, side: 1, raise: 0.4, stack: 0.0, ws: [[bi['knee' + S], 1]], curve: 0.1, tilt: 0.0,
        });
      }
      // flank feathers that cover the thighs
      for (let k = 0; k < 4; k++) {
        const z = -0.6 - 0.9 * k;
        const pr = this.prof(z);
        const root = V(s * pr.hw * 0.86, pr.cy - pr.bot * 0.42, z);
        add({
          root, dir: V(s * 0.12, -0.3, -1).normalize(), n: V(s * 0.85, -0.5, 0).normalize(), len: 3.4, w: 0.9, kind: K.PALE,
          group: s > 0 ? FG.TROU_L : FG.TROU_R, side: s, raise: 0.5, stack: 0.03 * k, ws: [[bi.pelvis, 0.7], [bi.root, 0.3]], curve: 0.12,
        });
      }
    }
  }

  // ---- eyes ------------------------------------------------------------------------------------------
  _buildEyes() {
    const bi = this.bi;
    const pos = [], nor = [], eye = [], si = [], sw = [], idx = [];
    const eyes = [this.eyeL, this.eyeR, this.eye2L, this.eye2R];
    this.eyeBasis = [];
    eyes.forEach((E, i) => {
      const z = E.gaze.clone();
      const y = V(0, 1, 0).sub(z.clone().multiplyScalar(z.y)).normalize();
      const x = new Vector3().crossVectors(y, z).normalize().multiplyScalar(-E.s);
      this.eyeBasis.push({ x, y, z, center: E.center.clone(), r: E.r });
      const nLat = i < 2 ? 22 : 12, nLon = i < 2 ? 30 : 16;
      const base = pos.length / 3;
      for (let a = 0; a <= nLat; a++) {
        const th = (a / nLat) * Math.PI;
        for (let b = 0; b <= nLon; b++) {
          const ph = (b / nLon) * TAU;
          // local direction: +z gaze pole
          const d = V(Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th));
          const w = x.clone().multiplyScalar(d.x).addScaledVector(y, d.y).addScaledVector(z, d.z);
          const p = E.center.clone().addScaledVector(w, E.r);
          pos.push(p.x, p.y, p.z);
          nor.push(w.x, w.y, w.z);
          eye.push(d.x, d.y, d.z, i);
          si.push(bi.head, 0, 0, 0);
          sw.push(1, 0, 0, 0);
        }
      }
      for (let a = 0; a < nLat; a++) {
        for (let b = 0; b < nLon; b++) {
          const p0 = base + a * (nLon + 1) + b, p1 = p0 + 1, p2 = p0 + nLon + 1, p3 = p2 + 1;
          // choose winding so faces point outward
          const A = V(pos[p0 * 3], pos[p0 * 3 + 1], pos[p0 * 3 + 2]);
          const Bv = V(pos[p1 * 3], pos[p1 * 3 + 1], pos[p1 * 3 + 2]);
          const Cv = V(pos[p2 * 3], pos[p2 * 3 + 1], pos[p2 * 3 + 2]);
          const fn = Bv.clone().sub(A).cross(Cv.clone().sub(A));
          const out = A.clone().sub(E.center);
          if (fn.lengthSq() < 1e-12 || fn.dot(out) > 0) idx.push(p0, p1, p2, p1, p3, p2);
          else idx.push(p0, p2, p1, p1, p2, p3);
        }
      }
    });
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new Float32BufferAttribute(nor, 3));
    geo.setAttribute('aEye', new Float32BufferAttribute(eye, 4));
    geo.setAttribute('skinIndex', new Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new Float32BufferAttribute(sw, 4));
    geo.setIndex(idx);
    const L = this.look;
    const c = (h) => new Color(h);
    this.uEye = {
      uGaze: { value: [V(0, 0, 1), V(0, 0, 1), V(0, 0, 1), V(0, 0, 1)] },
      uLids: { value: new Vector4(0.2, -0.62, 0.45, 0.1) },
      uLids2: { value: new Vector4(0.6, -0.7, 0.0, 0.0) },
      uNict: { value: 0 },
      uPupil: { value: 0.3 },
      uIris: { value: c(L.iris) }, uIris2: { value: c(L.iris2) }, uLidCol: { value: c(L.hood) }, uRing: { value: c(L.ring) },
      uVanish: this.vanish,
    };
    const mat = new ShaderMaterial({
      vertexShader: EYE_VERT, fragmentShader: EYE_FRAG,
      uniforms: Object.assign({}, G, this.uEye), side: FrontSide,
    });
    const mesh = new SkinnedMesh(geo, mat);
    mesh.name = 'falconEyes';
    mesh.frustumCulled = false;
    this.eyes = mesh;
    this.group.add(mesh);
  }

  _bindAll() {
    this.group.updateMatrixWorld(true);
    const ident = new Matrix4();
    for (const m of [this.body, this.feathers, this.eyes]) m.bind(this.skeleton, ident);
    this.meshes = [this.body, this.feathers];
  }

  castShadows(shadows) {
    for (const m of this.meshes) shadows.addCaster(m);
  }

  removeShadows(shadows) {
    for (const m of this.meshes) shadows.removeCaster(m);
  }
}
