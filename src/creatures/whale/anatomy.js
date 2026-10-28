// Anatomy of the Vur Sok whale: a rorqual / humpback / tulkun body plan that flies.
// Shape tables (fractions of body length), the cross-section model, landmarks of every organ,
// and the per-individual layout (plates, scars, barnacles, tubercles, horns) derived from the
// genome. Everything here is plain math shared by the geometry builders, the skin baker and the
// animator, so organs land in exactly the same place in the mesh and in the baked textures.
//
// Model space: +Z toward the snout, +Y up, +X is the side the code calls 'R' (bones finR*, eyes.R).
// Loft parameters: t runs 0 (tail tip) .. 1 (snout tip); s runs around the ring
// 0 (belly) -> 0.25 (+X flank) -> 0.5 (dorsal midline) -> 0.75 (-X flank) -> 1 (belly).
import { Vector3 } from 'three';
import { smoothstep, clamp, lerp, rng } from '../../core/math.js';

export const T_ORIGIN = 0.55;
// Part ids of the merged body mesh (aPart).
export const PART = { SKIN: 0, MOUTH: 1, BALEEN: 2, HORN: 3, PLATE: 4, CREST: 5, DOME: 6, SPIKE: 7, TONGUE: 8 };

// ---- shape tables ----------------------------------------------------------------------------
// hw: half width, top / bot: height above / below the axis, cy: axis height, nT / nB: superellipse
// exponents of the upper / lower half (low = keeled, 2 = ellipse, high = boxy like the rostrum).
const ADULT = {
  t:   [0.000, 0.030, 0.070, 0.120, 0.180, 0.260, 0.350, 0.450, 0.550, 0.630, 0.700, 0.760, 0.820, 0.880, 0.930, 0.970, 1.000],
  hw:  [0.016, 0.022, 0.030, 0.040, 0.054, 0.079, 0.109, 0.138, 0.156, 0.159, 0.153, 0.143, 0.128, 0.110, 0.091, 0.068, 0.034],
  top: [0.024, 0.031, 0.040, 0.050, 0.063, 0.083, 0.106, 0.126, 0.138, 0.138, 0.128, 0.108, 0.088, 0.068, 0.051, 0.036, 0.016],
  bot: [0.022, 0.030, 0.039, 0.049, 0.063, 0.089, 0.119, 0.146, 0.160, 0.163, 0.161, 0.152, 0.133, 0.109, 0.083, 0.056, 0.024],
  cy:  [0.022, 0.020, 0.018, 0.016, 0.013, 0.009, 0.004, 0.000, -0.004, -0.006, -0.006, -0.006, -0.006, -0.006, -0.006, -0.006, -0.006],
  nT:  [1.65, 1.70, 1.75, 1.85, 1.95, 2.10, 2.22, 2.28, 2.30, 2.34, 2.45, 2.65, 2.95, 3.10, 3.00, 2.70, 2.30],
  nB:  [1.70, 1.75, 1.80, 1.86, 1.95, 2.05, 2.12, 2.15, 2.15, 2.15, 2.15, 2.16, 2.20, 2.25, 2.30, 2.35, 2.30],
};
const CALF = {
  t:   [0.000, 0.040, 0.090, 0.150, 0.230, 0.330, 0.440, 0.540, 0.620, 0.690, 0.750, 0.810, 0.870, 0.920, 0.960, 1.000],
  hw:  [0.020, 0.030, 0.043, 0.060, 0.090, 0.132, 0.172, 0.194, 0.198, 0.192, 0.179, 0.157, 0.128, 0.096, 0.064, 0.026],
  top: [0.030, 0.039, 0.050, 0.064, 0.088, 0.122, 0.155, 0.175, 0.180, 0.176, 0.166, 0.147, 0.120, 0.090, 0.060, 0.024],
  bot: [0.028, 0.037, 0.048, 0.064, 0.092, 0.132, 0.168, 0.186, 0.188, 0.183, 0.172, 0.153, 0.126, 0.096, 0.064, 0.027],
  cy:  [0.022, 0.020, 0.018, 0.015, 0.011, 0.006, 0.001, -0.002, -0.003, -0.003, -0.002, -0.002, -0.002, -0.002, -0.002, -0.002],
  nT:  [1.80, 1.85, 1.90, 1.98, 2.08, 2.18, 2.24, 2.26, 2.27, 2.30, 2.36, 2.46, 2.56, 2.54, 2.42, 2.25],
  nB:  [1.85, 1.88, 1.92, 1.98, 2.05, 2.10, 2.12, 2.12, 2.12, 2.12, 2.13, 2.15, 2.18, 2.22, 2.24, 2.22],
};

// Landmarks. Positions on the ring are given as m = y / height (the level on the side of the
// cross-section: +1 top midline, 0 widest point, -1 belly) so they survive shape changes.
export const PROFILES = {
  adult: Object.assign({}, ADULT, {
    noseCap: 0.955, tailCap: 0.025,
    hinge: 0.765, // mouth corner (gape)
    mouthT: [0.765, 0.800, 0.850, 0.900, 0.950, 0.985, 1.000],
    mouthM: [-0.04, 0.050, 0.120, 0.150, 0.130, 0.070, 0.020],
    jawFrac: 0.27, // fraction of the ring each side of the belly that belongs to the lower jaw
    joints: { tail3: 0.05, tail2: 0.13, tail1: 0.23, spine2: 0.35, spine1: 0.46, root: 0.55, chest: 0.63, neck: 0.70, head: 0.758 },
    eye: { t: 0.742, m: 0.07, r: 0.0052 }, eye2: { t: 0.721, m: 0.40, r: 0.0033 },
    blow: { t: 0.797, len: 0.026, gap: 0.006, splay: 0.38 }, splash: 0.811,
    dome: { t0: 0.818, t1: 0.915, w: 0.62, h: 0.010 },
    crest: { t0: 0.676, t1: 0.788, h: 0.098, peak: 0.34 },
    horn: { t: 0.704, m: 0.74 },
    wing: { t: 0.664, m: -0.46, span: 0.56, chordRoot: 0.15, chordMax: 0.24, armR: 0.019 },
    rearFin: { t: 0.405, m: -0.62, span: 0.13, chord: 0.075, armR: 0.009 },
    fluke: { span: 0.185, chord: 0.11 },
    plates: { t0: 0.15, t1: 0.63, n: 8, s0: 0.017, s1: 0.165, thick: 0.0125 },
    pleats: { t0: 0.47, t1: 0.985, n: 34 },
    mane: { t0: 0.565, t1: 0.716 },
    navel: 0.47,
    texWarp: 1.25, // extra texel density on the head
  }),
  calf: Object.assign({}, CALF, {
    noseCap: 0.91, tailCap: 0.03,
    hinge: 0.79,
    mouthT: [0.790, 0.830, 0.880, 0.930, 0.970, 1.000],
    mouthM: [-0.03, 0.040, 0.090, 0.090, 0.060, 0.020],
    jawFrac: 0.26,
    joints: { tail3: 0.06, tail2: 0.15, tail1: 0.26, spine2: 0.37, spine1: 0.47, root: 0.55, chest: 0.63, neck: 0.71, head: 0.775 },
    eye: { t: 0.772, m: 0.10, r: 0.0118 }, eye2: { t: 0.752, m: 0.43, r: 0.0072 },
    blow: { t: 0.822, len: 0.026, gap: 0.007, splay: 0.36 }, splash: 0.836,
    dome: { t0: 0.842, t1: 0.925, w: 0.6, h: 0.012 },
    crest: { t0: 0.722, t1: 0.814, h: 0.06, peak: 0.4 },
    horn: { t: 0.742, m: 0.72 },
    wing: { t: 0.69, m: -0.44, span: 0.47, chordRoot: 0.15, chordMax: 0.22, armR: 0.028 },
    rearFin: { t: 0.42, m: -0.6, span: 0.12, chord: 0.085, armR: 0.013 },
    fluke: { span: 0.19, chord: 0.125 },
    plates: { t0: 0.18, t1: 0.65, n: 7, s0: 0.022, s1: 0.13, thick: 0.007 },
    pleats: { t0: 0.5, t1: 0.985, n: 24 },
    mane: { t0: 0.6, t1: 0.77 },
    navel: 0.5,
    texWarp: 1.0,
  }),
};

function tableAt(T, V, t) {
  const n = T.length;
  if (t <= T[0]) return V[0];
  if (t >= T[n - 1]) return V[n - 1];
  let i = 0;
  while (i < n - 2 && t > T[i + 1]) i++;
  const s = (t - T[i]) / (T[i + 1] - T[i]);
  const p0 = V[Math.max(0, i - 1)], p1 = V[i], p2 = V[i + 1], p3 = V[Math.min(n - 1, i + 2)];
  const s2 = s * s, s3 = s2 * s;
  return 0.5 * (2 * p1 + (-p0 + p2) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s2 + (-p0 + 3 * p1 - 3 * p2 + p3) * s3);
}
export const spow = (x, e) => Math.sign(x) * Math.pow(Math.abs(x), e);
const wrap01 = (x) => x - Math.floor(x);
const hashStr = (str) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
};

/**
 * Body shape and landmarks for one genome. The shape seed is derived from the genome's base
 * name, so copies of a genome (the Oasis gathering) share geometry and baked skin.
 */
export class Anatomy {
  constructor(genome) {
    const g = (this.g = genome);
    this.calf = !!g.calf;
    const P = (this.P = PROFILES[this.calf ? 'calf' : 'adult']);
    this.L = g.length;
    this.girth = g.girth ?? 1;
    this.bellyK = g.belly ?? 1;
    this.finScale = g.finScale ?? 1;
    this.baseName = String(g.name || 'whale').replace(/-\d+$/, '');
    this.shapeSeed = hashStr(this.baseName + '|' + (g.calf ? 'c' : 'a')) % 100000;
    this.layout = buildLayout(this);
  }

  // ---- cross-section ------------------------------------------------------------------------
  /** Profile at t: half width, top / bottom heights, axis height, z, exponents (metres). */
  prof(t, out = {}) {
    const P = this.P, L = this.L, gth = this.girth;
    let hw = tableAt(P.t, P.hw, t) * L * gth;
    let top = tableAt(P.t, P.top, t) * L * gth;
    let bot = tableAt(P.t, P.bot, t) * L * gth * this.bellyK;
    const cy = tableAt(P.t, P.cy, t) * L;
    // dorsal hump (the humpback's small fin) and the knuckles of the tail stock
    if (!this.calf) {
      top += L * 0.0075 * Math.exp(-(((t - 0.335) / 0.028) ** 2));
      top += L * 0.0035 * Math.max(0, Math.sin((t - 0.08) * Math.PI * 2 / 0.045)) * smoothstep(0.07, 0.12, t) * (1 - smoothstep(0.24, 0.3, t));
    } else {
      top += L * 0.005 * Math.exp(-(((t - 0.36) / 0.035) ** 2));
    }
    let cap = 1;
    if (t > P.noseCap) {
      const s = (t - P.noseCap) / (1 - P.noseCap);
      cap = Math.sqrt(Math.max(0, 1 - s * s * 0.97));
    } else if (t < P.tailCap) {
      const s = (P.tailCap - t) / P.tailCap;
      cap = Math.sqrt(Math.max(0, 1 - s * s * 0.8));
    }
    out.hw = hw * cap;
    out.top = top * cap;
    out.bot = bot * cap;
    out.cy = cy;
    out.z = (t - T_ORIGIN) * L;
    out.nT = tableAt(P.t, P.nT, t);
    out.nB = tableAt(P.t, P.nB, t);
    return out;
  }

  /** Mouth line level (y / height) at t; behind the gape it stays at the corner's level. */
  mouthM(t) {
    const P = this.P;
    if (t <= P.hinge) return P.mouthM[0];
    return tableAt(P.mouthT, P.mouthM, t);
  }

  /** Ring angle of a level m (y / height) on the side of the section at t. */
  thetaOfM(t, m, pr = this.prof(t)) {
    const n = m >= 0 ? pr.nT : pr.nB;
    return Math.acos(clamp(spow(m, n / 2), -1, 1));
  }

  cornerTheta(t, pr) {
    return this.thetaOfM(t, this.mouthM(t), pr);
  }

  /** Cross-section point for angle theta (0 top, PI belly, + toward +X). */
  ringXY(pr, theta, out = [0, 0]) {
    const sn = Math.sin(theta), cs = Math.cos(theta);
    const n = cs >= 0 ? pr.nT : pr.nB;
    // blend exponents near the equator so the flank stays smooth
    const nx = lerp(pr.nB, pr.nT, smoothstep(-0.25, 0.25, cs));
    out[0] = pr.hw * spow(sn, 2 / nx);
    out[1] = (cs >= 0 ? pr.top : pr.bot) * spow(cs, 2 / n);
    return out;
  }

  /** Ring parameter s -> theta, with the lower jaw owning sR of the ring on each side. */
  thetaOf(s, thM, sR) {
    if (s <= sR) return lerp(Math.PI, thM, s / sR);
    if (s >= 1 - sR) return lerp(-thM, -Math.PI, (s - (1 - sR)) / sR);
    return lerp(thM, -thM, (s - sR) / (1 - 2 * sR));
  }

  /** Inverse of thetaOf at t: ring parameter s of an angle. */
  sOf(t, theta) {
    const sR = this.P.jawFrac;
    const thM = this.cornerTheta(t);
    let th = theta;
    while (th > Math.PI) th -= Math.PI * 2;
    while (th < -Math.PI) th += Math.PI * 2;
    if (th >= thM) return lerp(0, sR, (Math.PI - th) / (Math.PI - thM));
    if (th <= -thM) return lerp(1 - sR, 1, (-thM - th) / (Math.PI - thM));
    return lerp(sR, 1 - sR, (thM - th) / (2 * thM));
  }

  /** sOf with the corner angle already known (hot path of the mesh builder). */
  sOfTh(theta, thM) {
    const sR = this.P.jawFrac;
    let th = theta;
    while (th > Math.PI) th -= Math.PI * 2;
    while (th < -Math.PI) th += Math.PI * 2;
    if (th >= thM) return lerp(0, sR, (Math.PI - th) / (Math.PI - thM));
    if (th <= -thM) return lerp(1 - sR, 1, (-thM - th) / (Math.PI - thM));
    return lerp(sR, 1 - sR, (thM - th) / (2 * thM));
  }

  /** Smooth body surface (no local bumps) at (t, theta). */
  surfacePoint(t, theta, out = new Vector3()) {
    const pr = this.prof(t, _pr);
    this.ringXY(pr, theta, _xy);
    return out.set(_xy[0], _xy[1] + pr.cy, pr.z);
  }

  surfaceNormal(t, theta, out = new Vector3()) {
    const e = 0.0015;
    const a = this.surfacePoint(Math.min(1, t + e), theta, _n1);
    const b = this.surfacePoint(Math.max(0, t - e), theta, _n2);
    _n3.subVectors(a, b);
    const c = this.surfacePoint(t, theta + e, _n1);
    const d = this.surfacePoint(t, theta - e, _n2);
    _n4.subVectors(c, d);
    out.crossVectors(_n4, _n3).normalize();
    const p = this.surfacePoint(t, theta, _n1);
    _n2.set(0, this.prof(t, _pr).cy, p.z);
    if (out.dot(_n1.sub(_n2)) < 0) out.negate();
    return out;
  }

  /** Constants of the relief field, computed once. */
  _reliefConsts() {
    if (this._rc) return this._rc;
    const P = this.P, L = this.L;
    const eyes = [P.eye, P.eye2].map((e) => {
      const pr = this.prof(e.t);
      return { e, th: this.thetaOfM(e.t, e.m, pr), rr: Math.max(pr.hw, pr.top) * 0.9, R: e.r * L };
    });
    const W = P.wing;
    this._rc = { eyes, wth: this.thetaOfM(W.t, W.m), tubT: Math.min(...this.layout.tubercles.map((k) => k.t), 2) - 0.03 };
    return this._rc;
  }

  /** Local relief added along the normal (metres): dome, splashguard, brows, jaw, tubercles. */
  relief(t, theta, thM) {
    const P = this.P, L = this.L, lay = this.layout, rc = this._reliefConsts();
    const at = Math.abs(theta);
    let d = 0;
    // sonic dome (melon) on the forehead
    const D = P.dome;
    const dt = (t - (D.t0 + D.t1) * 0.5) / ((D.t1 - D.t0) * 0.5);
    if (dt > -1.2 && dt < 1.2) {
      const dth = at / D.w;
      d += L * D.h * Math.max(0, 1 - dt * dt - dth * dth) ** 0.8;
    }
    // splashguard ridge in front of the blowholes, the blowhole pit
    if (Math.abs(t - P.blow.t) < 0.06 && at < 1.2) {
      d += L * 0.0042 * Math.exp(-(((t - P.splash) / 0.006) ** 2)) * Math.exp(-((at / 0.3) ** 2));
      d -= L * 0.0022 * Math.exp(-(((t - P.blow.t) / 0.009) ** 2)) * Math.exp(-((at / 0.12) ** 2));
    }
    // eye bulges: the eye sits in a raised socket just above the gape; a brow ridge over it
    for (const k of rc.eyes) {
      const e = k.e;
      if (Math.abs(t - e.t) * L > k.R * 12) continue;
      const rr = Math.hypot((t - e.t) * L, (at - k.th) * k.rr) / k.R;
      d += k.R * 0.55 * Math.exp(-((rr / 2.6) ** 2));
      const br = Math.hypot((t - e.t - e.r * 0.4) * L / (k.R * 3.2), (at - k.th + 0.04) * k.rr / (k.R * 1.6));
      d += k.R * 0.45 * Math.exp(-br * br);
    }
    // mandible: the lower lip rolls outward along the gape
    if (t > P.hinge - 0.04) {
      const tm = thM ?? this.cornerTheta(t);
      const k = smoothstep(P.hinge - 0.04, P.hinge + 0.03, t) * (1 - smoothstep(0.985, 1.0, t));
      d += L * 0.0028 * k * Math.exp(-(((at - tm - 0.12) / 0.09) ** 2));
    }
    // shoulder bulge at the wing root
    if (Math.abs(t - P.wing.t) < 0.12) d += L * 0.012 * Math.exp(-(((t - P.wing.t) / 0.035) ** 2) - (((at - rc.wth) / 0.32) ** 2));
    // tubercles ("stovebolts") on the rostrum and the lower jaw
    if (t > rc.tubT) {
      for (const k of lay.tubercles) {
        if (Math.abs(t - k.t) * L > k.r * 2) continue;
        const dd = Math.hypot((t - k.t) * L, angDist(theta, k.th) * k.rr) / k.r;
        if (dd < 2) d += k.h * Math.max(0, 1 - dd * dd) ** 1.5;
      }
    }
    return d;
  }

  /** Surface with relief (what the mesh shows). */
  surfacePointR(t, theta, out = new Vector3()) {
    this.surfacePoint(t, theta, out);
    const r = this.relief(t, theta);
    if (r !== 0) {
      this.surfaceNormal(t, theta, _n5);
      out.addScaledVector(_n5, r);
    }
    return out;
  }

  /** Point and outward normal of a landmark given as (t, m) on side (+1 = +X). */
  spot(t, m, side, outP = new Vector3(), outN = new Vector3()) {
    const th = this.thetaOfM(t, m) * side;
    this.surfacePointR(t, th, outP);
    this.surfaceNormal(t, th, outN);
    return { p: outP, n: outN, th };
  }

  /** Ring parameters of the main landmarks (cached). */
  landmarks() {
    if (this._lm) return this._lm;
    const P = this.P;
    const sAt = (e) => this.sOf(e.t, this.thetaOfM(e.t, e.m));
    this._lm = { sWing: sAt(P.wing), sEye: sAt(P.eye), sEye2: sAt(P.eye2), sHorn: sAt(P.horn), sRear: sAt(P.rearFin) };
    return this._lm;
  }

  /** Texture v coordinate (head gets more texels). */
  texV(t) {
    return this._warp ? this._warpAt(t) : (this._buildWarp(), this._warpAt(t));
  }

  _buildWarp() {
    const N = 512, P = this.P;
    const w = new Float32Array(N + 1);
    let acc = 0;
    const dens = (t) => 1 + P.texWarp * smoothstep(0.6, 0.74, t);
    for (let i = 0; i <= N; i++) {
      if (i > 0) acc += 0.5 * (dens((i - 1) / N) + dens(i / N)) / N;
      w[i] = acc;
    }
    for (let i = 0; i <= N; i++) w[i] /= acc;
    this._warp = w;
    this._warpDens = (t) => dens(t) / acc; // dv/dt
  }

  _warpAt(t) {
    const N = 512;
    const x = clamp(t, 0, 1) * N;
    const i = Math.min(N - 1, Math.floor(x));
    return lerp(this._warp[i], this._warp[i + 1], x - i);
  }

  /** dv/dt of the texture warp. */
  texDvDt(t) {
    if (!this._warp) this._buildWarp();
    return this._warpDens(t);
  }

  /** Projected chain weights along the spine for a vertex at t ([[boneName, w], ...]). */
  chainWeights(t) {
    const J = this.P.joints;
    if (t <= J.root) {
      const chain = [['root', J.root], ['spine1', J.spine1], ['spine2', J.spine2], ['tail1', J.tail1], ['tail2', J.tail2], ['tail3', J.tail3], ['fluke', 0.0]];
      return ramp(chain.map(([n, tt]) => [n, J.root - tt]), J.root - t);
    }
    const chain = [['root', J.root], ['chest', J.chest], ['neck', J.neck], ['head', J.head]];
    return ramp(chain.map(([n, tt]) => [n, tt - J.root]), t - J.root);
  }
}

const _pr = {};
const _xy = [0, 0];
const _n1 = new Vector3(), _n2 = new Vector3(), _n3 = new Vector3(), _n4 = new Vector3(), _n5 = new Vector3();

export function angDist(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** chain: [[bone, dist], ...] increasing dist; weights telescope to 1. */
export function ramp(chain, d) {
  const R = chain.map(([, dk], k) => {
    if (k === 0) return 1;
    const seg = dk - chain[k - 1][1];
    const del = seg * 0.45;
    return smoothstep(dk - del, dk + del, d);
  });
  const res = [];
  for (let k = 0; k < chain.length; k++) {
    const w = R[k] * (k + 1 < chain.length ? 1 - R[k + 1] : 1);
    if (w > 1e-4) res.push([chain[k][0], w]);
  }
  return res;
}

// ---- individual layout ---------------------------------------------------------------------
// Horn styles: 'swept' (default), 'straight', 'curl', 'forward', 'gnarled', 'elegant', 'nub'.
const HORN_STYLES = {
  swept: { len: 0.27, baseR: 0.023, up: 0.55, back: 0.62, out: 0.42, bendBack: 1.15, bendOut: 0.35, curl: 0, twist: 0.35, rings: 16, ringAmp: 0.09, droop: 0.25, fwd: 0, gnarl: 0 },
  straight: { len: 0.26, baseR: 0.019, up: 0.48, back: 0.78, out: 0.32, bendBack: 0.2, bendOut: 0.1, curl: 0, twist: 0.15, rings: 22, ringAmp: 0.07, droop: 0.05, fwd: 0, gnarl: 0 },
  curl: { len: 0.3, baseR: 0.024, up: 0.62, back: 0.5, out: 0.55, bendBack: 1.2, bendOut: 0.4, curl: 3.4, twist: 0.6, rings: 24, ringAmp: 0.11, droop: 0, fwd: 0, gnarl: 0.15 },
  forward: { len: 0.25, baseR: 0.021, up: 0.72, back: 0.5, out: 0.45, bendBack: 0.6, bendOut: 0.5, curl: 0, twist: 0.4, rings: 14, ringAmp: 0.08, droop: 0, fwd: 1.9, gnarl: 0 },
  gnarled: { len: 0.28, baseR: 0.026, up: 0.6, back: 0.55, out: 0.5, bendBack: 1.3, bendOut: 0.45, curl: 2.4, twist: 0.9, rings: 30, ringAmp: 0.16, droop: 0.1, fwd: 0, gnarl: 1 },
  elegant: { len: 0.27, baseR: 0.0185, up: 0.5, back: 0.72, out: 0.36, bendBack: 0.9, bendOut: 0.25, curl: 0, twist: 0.2, rings: 7, ringAmp: 0.025, droop: 0.32, fwd: 0, gnarl: 0 },
  nub: { len: 0.055, baseR: 0.024, up: 0.8, back: 0.55, out: 0.3, bendBack: 0.6, bendOut: 0.1, curl: 0, twist: 0, rings: 3, ringAmp: 0.04, droop: 0, fwd: 0, gnarl: 0 },
};

function buildLayout(A) {
  const g = A.g, P = A.P, L = A.L;
  const r = rng(A.shapeSeed * 13 + 7);
  const lay = {};
  // horns
  const style = g.horns?.style || (A.calf ? 'nub' : 'swept');
  const hs = Object.assign({}, HORN_STYLES[style] || HORN_STYLES.swept, g.horns || {});
  hs.style = style;
  hs.snap = g.horns?.snap ?? null; // 'L' | 'R' | null: that horn's tip is snapped off
  lay.horns = hs;
  // tubercles on the rostrum (three rows) and the chin / mandible (scattered)
  const tub = [];
  const nT = A.calf ? 0 : Math.round(lerp(22, 34, r()) * (g.tubercles ?? 1));
  const wear = g.wornTubercles ? 0.55 : 1;
  for (let i = 0; i < nT; i++) {
    const row = i % 3;
    const t = lerp(P.dome.t1 + 0.012, 0.992, (i / nT) ** 0.9) + (r() - 0.5) * 0.008;
    let th;
    if (row === 0) th = (r() - 0.5) * 0.12; // median row
    else {
      const thM = A.cornerTheta(t);
      th = (row === 1 ? 1 : -1) * lerp(thM * 0.55, thM * 0.86, r());
    }
    const pr = A.prof(t);
    tub.push({ t, th, r: L * lerp(0.0045, 0.0065, r()), h: L * lerp(0.0016, 0.0026, r()) * wear, rr: Math.max(pr.hw, pr.top) * 0.95 });
  }
  const nJ = A.calf ? 0 : Math.round(lerp(14, 22, r()) * (g.tubercles ?? 1));
  for (let i = 0; i < nJ; i++) {
    const side = i % 2 ? 1 : -1;
    const t = lerp(0.86, 0.995, Math.sqrt(r()));
    const thM = A.cornerTheta(t);
    const th = side * lerp(thM + 0.12, Math.min(Math.PI, thM + 0.9 + (t - 0.86) * 4), r());
    const pr = A.prof(t);
    tub.push({ t, th, r: L * lerp(0.004, 0.006, r()), h: L * lerp(0.0014, 0.0024, r()) * wear, rr: Math.max(pr.hw, pr.bot) * 0.95 });
  }
  lay.tubercles = tub;
  // dorsal plates: two rows flanking the furred ridge, shingled tail-ward
  const PL = P.plates;
  const plates = [];
  const nP = g.plates ?? PL.n;
  for (let i = 0; i < nP; i++) {
    const f0 = i / nP, f1 = (i + 1) / nP;
    // longer plates over the shoulders, shorter toward the tail
    const ta = lerp(PL.t1, PL.t0, f0 ** 1.12);
    const tb = lerp(PL.t1, PL.t0, f1 ** 1.12);
    const sizeK = lerp(1, 0.55, f0);
    for (const side of [1, -1]) {
      plates.push({
        side, tf: ta + 0.006, tb: tb - 0.02 * sizeK, // overlaps the next plate
        s0: PL.s0 * lerp(1, 0.6, f0), s1: PL.s1 * lerp(1.0, 0.62, f0 ** 0.8) * (1 + (r() - 0.5) * 0.12),
        thick: PL.thick * L * lerp(1, 0.6, f0) * (g.plateThick ?? 1),
        seed: r() * 100, chip: r(), idx: i,
      });
    }
  }
  lay.plates = plates;
  // scars: rake marks (parallel scratches) and cookie-cutter ovals, in (s, t) with metric scale
  const sc = g.scars ?? (A.calf ? 0.05 : 0.35);
  const scars = [];
  const nRake = Math.round(sc * (A.calf ? 2 : 14));
  for (let i = 0; i < nRake; i++) {
    const t = lerp(0.12, 0.86, r());
    const s = r() < 0.75 ? lerp(0.12, 0.88, r()) : r();
    scars.push({ kind: 0, s, t, ang: lerp(-1.2, 1.2, r()) + (r() < 0.5 ? 0 : Math.PI / 2), len: L * lerp(0.03, 0.11, r()) * (A.calf ? 0.6 : 1), n: 2 + Math.floor(r() * 3), gap: L * lerp(0.002, 0.0045, r()), w: L * lerp(0.0007, 0.0016, r()), age: r() });
  }
  const nCook = Math.round(sc * (A.calf ? 3 : 26));
  for (let i = 0; i < nCook; i++) {
    scars.push({ kind: 1, s: r(), t: lerp(0.1, 0.9, r()), ang: r() * Math.PI, len: L * lerp(0.0028, 0.0065, r()), n: 1, gap: 0, w: L * lerp(0.002, 0.0042, r()), age: r() });
  }
  // the alpha's great scars: a few long healed gashes over the flank and head
  if (g.alpha) {
    for (let i = 0; i < 4; i++) {
      scars.push({ kind: 0, s: i % 2 ? lerp(0.62, 0.78, r()) : lerp(0.22, 0.38, r()), t: lerp(0.45, 0.82, r()), ang: lerp(-0.6, 0.6, r()), len: L * lerp(0.1, 0.18, r()), n: 3 + (i % 2), gap: L * 0.006, w: L * 0.0022, age: 0.6 + r() * 0.3 });
    }
  }
  lay.scars = scars.slice(0, 40);
  // barnacle clusters (acorn barnacles) with whale lice in their lee
  const bk = g.barnacles ?? (A.calf ? 0 : 0.3);
  const barn = [];
  const nB = Math.round(bk * 22);
  const spots = [
    () => ({ t: lerp(0.93, 0.995, r()), s: lerp(0.0, 1.0, r()) }), // snout and chin
    () => ({ t: lerp(0.86, 0.97, r()), s: r() < 0.5 ? lerp(0.0, 0.2, r()) : lerp(0.8, 1.0, r()) }), // mandible
    () => ({ t: lerp(0.62, 0.7, r()), s: r() < 0.5 ? lerp(0.12, 0.24, r()) : lerp(0.76, 0.88, r()) }), // wing root
    () => ({ t: lerp(0.3, 0.34, r()), s: lerp(0.44, 0.56, r()) }), // dorsal hump
    () => ({ t: lerp(0.03, 0.14, r()), s: r() }), // tail stock
    () => ({ t: lerp(0.46, 0.6, r()), s: lerp(0.0, 1.0, r()) }), // navel / belly
  ];
  for (let i = 0; i < nB; i++) {
    const sp = spots[i % spots.length]();
    barn.push({ s: sp.s, t: sp.t, rad: L * lerp(0.008, 0.022, r()) * (0.6 + bk * 0.6), dens: lerp(0.5, 1, r()), lice: r() });
  }
  lay.barnacles = barn.slice(0, 24);
  lay.eyePatch = Object.assign({ size: 1, len: 1.0, angle: 0.15, dark: 0.75 }, g.eyePatch || {});
  return lay;
}
