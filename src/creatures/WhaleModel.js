// Procedural skywhale: lofted body with a true mouth cut (palate, floor, filter combs),
// a ~25-bone skeleton with smooth skin weights, membrane wing-fins, fluke, rear fins,
// expressive eyes, feathery gill fronds and shell fur. One genome -> one individual.
import {
  BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, Uint32BufferAttribute,
  Bone, Skeleton, SkinnedMesh, Mesh, Group, ShaderMaterial, Color, Vector3, Vector4, Matrix4,
  Quaternion, Sphere, SphereGeometry, DoubleSide,
} from 'three';
import { G } from '../render/Globals.js';
import {
  BODY_VERT, BODY_FRAG, FUR_VERT, FUR_FRAG, FIN_VERT, FIN_FRAG, EYE_VERT, EYE_FRAG,
  FROND_VERT, FROND_FRAG,
} from './whaleShaders.js';
import { smoothstep, clamp, lerp, rng } from '../core/math.js';

export const T_ORIGIN = 0.55;

// ---- Profiles (fractions of body length) ------------------------------------------------
const PROFILES = {
  adult: {
    t:   [0.00, 0.05, 0.13, 0.25, 0.38, 0.50, 0.60, 0.70, 0.79, 0.87, 0.93, 1.00],
    hw:  [0.030, 0.040, 0.066, 0.116, 0.160, 0.185, 0.192, 0.185, 0.166, 0.142, 0.118, 0.090],
    top: [0.026, 0.034, 0.058, 0.100, 0.140, 0.158, 0.163, 0.156, 0.142, 0.124, 0.102, 0.078],
    bot: [0.024, 0.032, 0.055, 0.098, 0.150, 0.178, 0.181, 0.170, 0.147, 0.118, 0.092, 0.068],
    cy:  [0.040, 0.030, 0.018, 0.006, -0.004, -0.008, -0.006, 0.000, 0.008, 0.014, 0.016, 0.016],
    noseCap: 0.9, tailCap: 0.03,
    hinge: 0.835, mouthBack: -0.12, mouthFront: -0.24,
    joints: { tail3: 0.04, tail2: 0.13, tail1: 0.24, spine2: 0.36, spine1: 0.47, root: 0.55, chest: 0.64, neck: 0.75, head: 0.83 },
    eyeT: 0.875, eyeTheta: 1.12, eyeR: 0.029, eyeFront: 0.45,
    finT: 0.625, finTheta: 1.68, finSpan: 0.54, finChord: 0.3, finChordMax: 0.36, armR: 0.024,
    rearT: 0.31, rearTheta: 2.2, rearSpan: 0.12, rearChord: 0.075,
    flukeSpan: 0.25, flukeChord: 0.15,
    gill: [0.77, 0.815], frondLen: 0.1, frondT: 0.79,
    furLen: 0.011, furDensity: 12, maneBoost: 1.8,
  },
  calf: {
    t:   [0.00, 0.06, 0.16, 0.30, 0.44, 0.56, 0.66, 0.75, 0.83, 0.90, 0.95, 1.00],
    hw:  [0.040, 0.060, 0.105, 0.170, 0.214, 0.232, 0.236, 0.232, 0.218, 0.194, 0.165, 0.128],
    top: [0.036, 0.052, 0.092, 0.150, 0.194, 0.212, 0.220, 0.218, 0.206, 0.184, 0.155, 0.118],
    bot: [0.034, 0.050, 0.090, 0.150, 0.198, 0.210, 0.206, 0.196, 0.180, 0.158, 0.130, 0.096],
    cy:  [0.045, 0.035, 0.022, 0.008, 0.000, -0.004, -0.002, 0.004, 0.010, 0.014, 0.016, 0.016],
    noseCap: 0.86, tailCap: 0.04,
    hinge: 0.805, mouthBack: -0.14, mouthFront: -0.3,
    joints: { tail3: 0.05, tail2: 0.15, tail1: 0.27, spine2: 0.38, spine1: 0.48, root: 0.55, chest: 0.63, neck: 0.71, head: 0.78 },
    eyeT: 0.86, eyeTheta: 0.92, eyeR: 0.066, eyeFront: 0.62,
    finT: 0.6, finTheta: 1.74, finSpan: 0.42, finChord: 0.28, finChordMax: 0.33, armR: 0.036,
    rearT: 0.33, rearTheta: 2.25, rearSpan: 0.11, rearChord: 0.085,
    flukeSpan: 0.26, flukeChord: 0.17,
    gill: [0.735, 0.775], frondLen: 0.15, frondT: 0.76,
    furLen: 0.025, furDensity: 30, maneBoost: 1.4,
  },
};

function tableAt(P, key, t) {
  const T = P.t, V = P[key];
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

const SUPER_N = 2.25;
// Geometry is shared between whales with identical proportions (only bones and materials
// are per individual), which keeps large gatherings cheap to build and to hold in memory.
const GEO_CACHE = new Map();
const spow = (x, e) => Math.sign(x) * Math.pow(Math.abs(x), e);

export class WhaleModel {
  constructor(genome) {
    this.g = genome;
    const P = (this.P = PROFILES[genome.calf ? 'calf' : 'adult']);
    this.L = genome.length;
    this.group = new Group();
    this.group.name = genome.name || 'whale';
    this.r = rng(genome.seed || 1);
    // per-genome proportion jitter
    this.girth = genome.girth ?? 1;
    this.finScale = genome.finScale ?? 1;
    this.key = [genome.calf ? 'c' : 'a', this.L, this.girth, this.finScale, genome.belly ?? 1, genome.frondScale ?? 1].join('|');
    this.cacheHit = GEO_CACHE.has(this.key);
    if (!this.cacheHit) GEO_CACHE.set(this.key, {});
    this.cache = GEO_CACHE.get(this.key);

    this._buildUniforms();
    this._buildSkeleton();
    this._buildBody();
    this._buildFins();
    this._buildFluke();
    this._buildEyes();
    this._buildFronds();
    this._buildFur();
    this._bindAll();
  }

  // ---- shape helpers -----------------------------------------------------------------
  prof(t) {
    const P = this.P, L = this.L, gth = this.girth;
    let hw = tableAt(P, 'hw', t) * L * gth;
    let top = tableAt(P, 'top', t) * L * gth;
    let bot = tableAt(P, 'bot', t) * L * gth * (this.g.belly ?? 1);
    const cy = tableAt(P, 'cy', t) * L;
    let cap = 1;
    if (t > P.noseCap) {
      const s = (t - P.noseCap) / (1 - P.noseCap);
      cap = Math.sqrt(Math.max(0, 1 - s * s));
    } else if (t < P.tailCap) {
      const s = (P.tailCap - t) / P.tailCap;
      cap = Math.sqrt(Math.max(0, 1 - s * s * 0.85));
    }
    return { hw: hw * cap, top: top * cap, bot: bot * cap, cy, z: (t - T_ORIGIN) * L };
  }

  mouthM(t) {
    const P = this.P;
    if (t <= P.hinge) return P.mouthBack;
    return lerp(P.mouthBack, P.mouthFront, smoothstep(P.hinge, 1, t));
  }

  cornerTheta(t) {
    const m = this.mouthM(t);
    return Math.PI - Math.acos(Math.pow(-m, SUPER_N / 2));
  }

  /** Cross-section point for angle theta (0 = top, PI = belly, + toward right/+X). */
  ringXY(pr, theta) {
    const sn = Math.sin(theta), cs = Math.cos(theta);
    const x = pr.hw * spow(sn, 2 / SUPER_N);
    const h = cs >= 0 ? pr.top : pr.bot;
    const y = h * spow(cs, 2 / SUPER_N);
    return [x, y];
  }

  /** Ring parameter s (0 belly .. 0.5 top .. 1 belly, right side first) -> theta. */
  thetaOf(s, thM, sR) {
    if (s <= sR) return lerp(Math.PI, thM, s / sR);
    if (s >= 1 - sR) return lerp(-thM, -Math.PI, (s - (1 - sR)) / sR);
    return lerp(thM, -thM, (s - sR) / (1 - 2 * sR));
  }

  surfacePoint(t, theta, out = new Vector3()) {
    const pr = this.prof(t);
    const [x, y] = this.ringXY(pr, theta);
    return out.set(x, y + pr.cy, pr.z);
  }

  surfaceNormal(t, theta, out = new Vector3()) {
    const e = 0.002;
    const p0 = this.surfacePoint(t, theta, new Vector3());
    const pt = this.surfacePoint(Math.min(1, t + e), theta, new Vector3()).sub(this.surfacePoint(Math.max(0, t - e), theta, new Vector3()));
    const pa = this.surfacePoint(t, theta + e, new Vector3()).sub(this.surfacePoint(t, theta - e, new Vector3()));
    out.crossVectors(pa, pt).normalize();
    // ensure outward
    const c = new Vector3(0, this.prof(t).cy, p0.z);
    if (out.dot(p0.clone().sub(c)) < 0) out.negate();
    return out;
  }

  // ---- uniforms -------------------------------------------------------------------------
  _buildUniforms() {
    const g = this.g, P = this.P;
    const c = (h) => new Color(h);
    this.u = {
      uBack: { value: c(g.back) },
      uBelly: { value: c(g.belly_c || '#f4eadb') },
      uMark: { value: c(g.mark || g.back) },
      uMark2: { value: c(g.mark2 || '#ffffff') },
      uPattern: { value: new Vector4(0, 0, 0, 0) },
      uEyeLoc: { value: new Vector4(P.eyeT, 0.3, P.eyeR * 1.6, 0) },
      // x lip seam ring parameter, y jaw hinge t, z ink strength, w line width (ring units)
      uMouthLine: { value: new Vector4(10 / 48, P.hinge, g.calf ? 0.75 : 0.55, g.calf ? 0.007 : 0.0045) },
      uSeed: { value: (g.seed || 1) * 0.37 % 10 },
      uGarden: { value: g.garden ? 1 : 0 },
      uBlush: { value: new Color(g.blush || '#ff9a9a') },
      uBlushAmt: { value: g.calf ? 0.45 : 0.0 },
      uLen: { value: this.L },
      uSac: { value: 0.3 },
      uThroat: { value: 0 },
      uVib: { value: 0 },
      uGill: { value: 0 },
      uBreath: { value: 0 },
      uGillColor: { value: c(g.gill || '#ff8f8a') },
      uMouthColor: { value: c(g.mouth || '#9c4a5c') },
      uFurShade: { value: g.furShade ?? 0.72 },
      uFurTip: { value: g.furTip ?? 1.12 },
      uFurLen: { value: P.furLen * this.L * (g.furScale ?? 1) },
      // strands per metre: fine on the calf, a little coarser (painterly) on the giants
      uFurDensity: { value: (g.calf ? P.furDensity : 11) * (g.furDensityScale ?? 1) },
      uInertia: { value: new Vector3() },
      uAirflow: { value: new Vector3() },
    };
    const pat = g.pattern || {};
    this.u.uPattern.value.set(pat.spots || 0, pat.stripes || 0, pat.crescent || 0, pat.blaze || 0);
  }

  // ---- skeleton -----------------------------------------------------------------------
  _buildSkeleton() {
    const P = this.P, L = this.L;
    const abs = {};
    const bones = {};
    const list = [];
    const mk = (name, pos, parent) => {
      const b = new Bone();
      b.name = name;
      abs[name] = pos.clone();
      bones[name] = b;
      if (parent) {
        bones[parent].add(b);
        b.position.copy(pos).sub(abs[parent]);
      } else b.position.copy(pos);
      list.push(b);
      return b;
    };
    const spineP = (t) => new Vector3(0, this.prof(t).cy, (t - T_ORIGIN) * L);
    const J = P.joints;
    mk('root', spineP(J.root), null);
    mk('spine1', spineP(J.spine1), 'root');
    mk('spine2', spineP(J.spine2), 'spine1');
    mk('tail1', spineP(J.tail1), 'spine2');
    mk('tail2', spineP(J.tail2), 'tail1');
    mk('tail3', spineP(J.tail3), 'tail2');
    mk('fluke', spineP(0.0), 'tail3');
    mk('chest', spineP(J.chest), 'root');
    mk('neck', spineP(J.neck), 'chest');
    mk('head', spineP(J.head), 'neck');
    // jaw hinge at the mouth corner height
    const hp = this.prof(P.hinge);
    const [, yc] = this.ringXY(hp, this.cornerTheta(P.hinge));
    mk('jaw', new Vector3(0, yc + hp.cy, (P.hinge - T_ORIGIN) * L), 'head');
    // pectoral fins
    for (const side of [1, -1]) {
      const sp = this.surfacePoint(P.finT, P.finTheta * side);
      const sn = this.surfaceNormal(P.finT, P.finTheta * side);
      const shoulder = sp.clone().addScaledVector(sn, -P.armR * L * 0.35);
      const s = side > 0 ? 'R' : 'L';
      // fin chain runs along the fin span in bind pose (outward, slightly down and back)
      const dir = this.finDir(side);
      const S = P.finSpan * L * this.finScale;
      mk('fin' + s + '1', shoulder, 'chest');
      mk('fin' + s + '2', shoulder.clone().addScaledVector(dir, S * 0.38), 'fin' + s + '1');
      mk('fin' + s + '3', shoulder.clone().addScaledVector(dir, S * 0.72), 'fin' + s + '2');
      const rp = this.surfacePoint(P.rearT, P.rearTheta * side);
      mk('rear' + s, rp, 'spine2');
    }
    this.bones = bones;
    this.boneAbs = abs;
    this.boneList = list;
    this.group.add(bones.root);
    this.group.updateMatrixWorld(true);
    this.skeleton = new Skeleton(list);
    this.boneIndex = {};
    list.forEach((b, i) => (this.boneIndex[b.name] = i));
  }

  finDir(side) {
    // span axis in bind pose: outward with slight droop and sweep
    const d = new Vector3(side, -0.06, -0.1);
    return d.normalize();
  }

  /** Chain weights along t: returns [[boneIndex, w], ...] (partition of unity). */
  chainWeights(t) {
    const J = this.P.joints;
    const bi = this.boneIndex;
    const out = [];
    if (t <= J.root) {
      const chain = [['root', J.root], ['spine1', J.spine1], ['spine2', J.spine2], ['tail1', J.tail1], ['tail2', J.tail2], ['tail3', J.tail3], ['fluke', 0.0]];
      const d = J.root - t;
      return this._ramp(chain.map(([n, tt]) => [bi[n], J.root - tt]), d);
    }
    const chain = [['root', J.root], ['chest', J.chest], ['neck', J.neck], ['head', J.head]];
    const d = t - J.root;
    return this._ramp(chain.map(([n, tt]) => [bi[n], tt - J.root]), d);
    return out;
  }

  _ramp(chain, d) {
    // chain: [[bone, dist], ...] increasing dist; weights telescope to 1.
    const R = chain.map(([, dk], k) => {
      if (k === 0) return 1;
      const seg = dk - chain[k - 1][1];
      const del = seg * 0.42;
      return smoothstep(dk - del, dk + del, d);
    });
    const res = [];
    for (let k = 0; k < chain.length; k++) {
      const w = R[k] * (k + 1 < chain.length ? 1 - R[k + 1] : 1);
      if (w > 1e-4) res.push([chain[k][0], w]);
    }
    return res;
  }

  // ---- body ---------------------------------------------------------------------------------
  _bodyMesh() {
    const mat = new ShaderMaterial({
      vertexShader: BODY_VERT,
      fragmentShader: BODY_FRAG,
      uniforms: Object.assign({}, G, this.u),
      side: DoubleSide,
    });
    const mesh = new SkinnedMesh(this.bodyGeo, mat);
    mesh.frustumCulled = false;
    mesh.name = 'body';
    this.body = mesh;
    this.group.add(mesh);
  }

  _buildBody() {
    if (this.cacheHit) {
      const C = this.cache;
      this.bodyGeo = C.bodyGeo;
      this.outerVertCount = C.outerVertCount;
      this.outerIndexCount = C.outerIndexCount;
      this.u.uEyeLoc.value.y = C.eyeLocY;
      this._bodyMesh();
      return;
    }
    const P = this.P, L = this.L, bi = this.boneIndex;
    const nRings = this.g.calf ? 70 : 84;
    const nSeg = 48;
    const jR = 10; // lower jaw spans 10 segments each side of the belly
    const sR = jR / nSeg;
    const jL = nSeg - jR;
    const pos = [], nor = [], uv = [], loft = [], mask = [], inner = [], skinI = [], skinW = [], comb = [];
    const idx = [];
    const ringStart = [];
    const tAt = (i) => {
      // denser rings near head and tail tip
      const u = i / (nRings - 1);
      return u;
    };
    const eyeT = P.eyeT, eyeTh = P.eyeTheta;
    const arc = new Float32Array(nRings);
    let along = 0;
    let prevZ = null;
    const vTmp = new Vector3();

    // per-ring arc lengths (for fur uv in metres)
    const ringPts = [];
    for (let i = 0; i < nRings; i++) {
      const t = tAt(i);
      const pr = this.prof(t);
      if (prevZ !== null) along += Math.hypot(pr.z - prevZ.z, pr.cy - prevZ.cy);
      prevZ = pr;
      arc[i] = along;
      const thM = this.cornerTheta(t);
      const pts = [];
      let perim = 0;
      let last = null;
      for (let j = 0; j <= nSeg; j++) {
        const s = j / nSeg;
        const th = this.thetaOf(s, thM, sR);
        const [x, y] = this.ringXY(pr, th);
        if (last) perim += Math.hypot(x - last[0], y - last[1]);
        pts.push({ x, y: y + pr.cy, z: pr.z, th, s, u: perim });
        last = [x, y];
      }
      ringPts.push({ t, pr, pts, thM });
    }

    const dorsalOf = (s) => -Math.cos(s * Math.PI * 2);
    const gTA = P.gill[0], gTB = P.gill[1];
    const isCalf = !!this.g.calf;
    const addVert = (rp, p, i, j, split) => {
      const t = rp.t;
      pos.push(p.x, p.y, p.z);
      nor.push(0, 0, 0);
      uv.push(p.u, arc[i]);
      loft.push(t, p.s);
      const dorsal = dorsalOf(p.s);
      const absTh = Math.abs(p.th);
      // fur
      let fur = isCalf ? smoothstep(-1.0, -0.55, dorsal) * 0.8 + 0.2 * smoothstep(-0.6, 0.0, dorsal)
                       : smoothstep(-0.8, -0.25, dorsal);
      fur *= smoothstep(0.03, 0.12, t);
      // mane: longer fur over the shoulders and nape
      const mane = smoothstep(0.35, 0.85, dorsal) * smoothstep(P.joints.chest - 0.1, P.joints.chest, t) * smoothstep(P.hinge + 0.03, P.joints.neck, t);
      fur *= 1 + mane * (P.maneBoost - 1);
      // calves wear a fluffy cowlick on the crown of the head
      if (isCalf) fur *= 1 + 1.3 * smoothstep(0.7, 0.95, dorsal) * smoothstep(P.hinge - 0.02, P.hinge + 0.03, t) * (1 - smoothstep(P.eyeT + 0.02, P.eyeT + 0.07, t));
      // none on the face front / lips / around eyes
      // bare lips: a narrow band along the mouth line, fading in at the corner
      const lipK = smoothstep(P.hinge - 0.03, P.hinge + 0.02, t);
      if (lipK > 0) fur *= 1 - lipK * (1 - smoothstep(0.03, 0.16, Math.abs(absTh - rp.thM)));
      if (t > P.hinge) fur *= 1 - smoothstep(isCalf ? 0.88 : 0.9, isCalf ? 0.97 : 0.985, t);
      const dEye = Math.hypot((t - eyeT) / (P.eyeR * 1.15), (absTh - eyeTh) / (P.eyeR * 7.0));
      fur *= smoothstep(1.0, 1.6, dEye);
      // buoyancy sacs (lower flanks)
      // an elliptical dome; fur thins over it rather than stopping at an edge
      const sac = Math.max(0, 1 - ((t - 0.46) / 0.11) ** 2 - ((absTh - 2.2) / 0.42) ** 2);
      const sacM = smoothstep(0.0, 0.6, sac);
      fur *= 1 - smoothstep(0.1, 0.9, sac) * 0.85;
      // gills
      const gill = smoothstep(gTA - 0.006, gTA + 0.004, t) * (1 - smoothstep(gTB - 0.004, gTB + 0.006, t)) * smoothstep(1.2, 1.38, absTh) * (1 - smoothstep(2.0, 2.2, absTh));
      fur *= 1 - gill * 0.6; // short fur over the gill slits, which show through it
      // throat pleats
      const throat = smoothstep(P.joints.neck - 0.08, P.joints.neck - 0.02, t) * smoothstep(-0.55, -0.85, dorsal) * (1 - smoothstep(0.95, 0.99, t));
      fur *= 1 - throat * 0.9;
      mask.push(Math.max(0, fur), sacM, gill, throat);
      inner.push(0);
      // skin weights
      let ws = this.chainWeights(t);
      if (split === 'lower' && t > P.hinge - 1e-6) {
        // a wide ramp that starts from the cheek weight at the hinge, so the open jaw doesn't fold the skin
        const wj = Math.max(smoothstep(P.hinge, P.hinge + 0.12, t), 0.25 * smoothstep(-0.3, -0.8, dorsal));
        ws = ws.map(([b, w]) => [b, w * (1 - wj)]);
        ws.push([bi.jaw, wj]);
      } else if (split === 'lowerPre') {
        // lower vertices just behind the hinge stretch a little with the jaw (cheek)
        const wj = smoothstep(P.hinge - 0.05, P.hinge, t) * 0.25 * smoothstep(-0.3, -0.8, dorsal);
        ws = ws.map(([b, w]) => [b, w * (1 - wj)]);
        ws.push([bi.jaw, wj]);
      }
      pushWeights(skinI, skinW, ws);
      // comb direction: toward the tail and slightly down the flanks
      const cdir = new Vector3(0, 0, -1).addScaledVector(new Vector3(Math.sign(p.x) * 0.15, -0.25, 0), 1 - Math.abs(dorsal));
      comb.push(cdir.x, cdir.y, cdir.z);
      return pos.length / 3 - 1;
    };

    // vertices: for split rings, duplicates at jR and jL
    const vid = []; // vid[i][j] = {up, lo}
    for (let i = 0; i < nRings; i++) {
      const rp = ringPts[i];
      const split = rp.t >= P.hinge;
      const row = [];
      for (let j = 0; j <= nSeg; j++) {
        const p = rp.pts[j];
        const lowerSide = j <= jR || j >= jL;
        if (split && (j === jR || j === jL)) {
          const up = addVert(rp, p, i, j, 'upper');
          const lo = addVert(rp, p, i, j, 'lower');
          row.push({ up, lo });
        } else {
          const kind = split ? (lowerSide ? 'lower' : 'upper') : (lowerSide ? 'lowerPre' : 'upper');
          const v = addVert(rp, p, i, j, kind);
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
        idx.push(a, b, c, b, d, c);
      }
    }
    const outerVertCount = pos.length / 3;
    const outerIndexCount = idx.length;

    // ---- mouth interior: palate (up into the head) and floor (down into the jaw) ----
    const nP = 10;
    const iStart = ringPts.findIndex((r) => r.t >= P.hinge);
    const addInnerStrip = (isPalate) => {
      const rows = [];
      for (let i = iStart; i < nRings; i++) {
        const rp = ringPts[i];
        const t = rp.t;
        const pr = rp.pr;
        const cR = rp.pts[jR];
        const xc = cR.x, yc = cR.y;
        const k = smoothstep(P.hinge, P.hinge + 0.05, t);
        const depth = (isPalate ? 0.5 * pr.top : -0.55 * pr.bot) * k;
        const row = [];
        for (let q = 0; q <= nP; q++) {
          const f = q / nP; // 0 right corner -> 1 left corner
          const x = lerp(xc, -xc, f);
          const arch = 1 - (2 * f - 1) ** 2;
          const y = yc + depth * Math.sqrt(Math.max(arch, 0));
          pos.push(x, y, pr.z);
          nor.push(0, 0, 0);
          uv.push(f * 2 * Math.abs(xc), arc[i]);
          loft.push(t, 0.5);
          mask.push(arch * k, 0, 0, 0);
          inner.push(1);
          let ws = this.chainWeights(t);
          if (!isPalate) {
            const wj = smoothstep(P.hinge, P.hinge + 0.12, t); // matches the lip corner's ramp
            ws = ws.map(([b, w]) => [b, w * (1 - wj)]);
            ws.push([bi.jaw, wj]);
          }
          pushWeights(skinI, skinW, ws);
          comb.push(0, 0, -1);
          row.push(pos.length / 3 - 1);
        }
        rows.push(row);
      }
      for (let i = 0; i < rows.length - 1; i++) {
        for (let q = 0; q < nP; q++) {
          const a = rows[i][q], b = rows[i][q + 1], c = rows[i + 1][q], d = rows[i + 1][q + 1];
          // palate faces down (visible from below), floor faces up
          if (isPalate) idx.push(a, c, b, b, c, d);
          else idx.push(a, b, c, b, d, c);
        }
      }
      return rows;
    };
    const palate = addInnerStrip(true);
    addInnerStrip(false);

    // ---- filter combs hanging from the upper jaw sides ----
    for (const side of [1, -1]) {
      const rows = [];
      for (let i = iStart + 2; i < nRings - 3; i++) {
        const rp = ringPts[i];
        const t = rp.t;
        const pr = rp.pr;
        const cR = rp.pts[jR];
        const xc = cR.x * 0.86 * side, yc = cR.y;
        const k = smoothstep(P.hinge + 0.02, P.hinge + 0.06, t) * (1 - smoothstep(0.95, 0.985, t));
        const hang = 0.22 * pr.bot * k;
        const top = yc + 0.06 * pr.top * k;
        const row = [];
        for (const yy of [top, yc - hang]) {
          pos.push(xc, yy, pr.z);
          nor.push(-side, 0, 0);
          uv.push(t * L, yy);
          loft.push(t, 0.5);
          mask.push(0, 0, 0, 0);
          inner.push(2);
          pushWeights(skinI, skinW, this.chainWeights(t));
          comb.push(0, 0, -1);
          row.push(pos.length / 3 - 1);
        }
        rows.push(row);
      }
      for (let i = 0; i < rows.length - 1; i++) {
        const a = rows[i][0], b = rows[i][1], c = rows[i + 1][0], d = rows[i + 1][1];
        idx.push(a, b, c, b, d, c);
      }
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    geo.setAttribute('aLoft', new Float32BufferAttribute(loft, 2));
    geo.setAttribute('aMask', new Float32BufferAttribute(mask, 4));
    geo.setAttribute('aInner', new Float32BufferAttribute(inner, 1));
    geo.setAttribute('aComb', new Float32BufferAttribute(comb, 3));
    geo.setAttribute('skinIndex', new Uint16BufferAttribute(skinI, 4));
    geo.setAttribute('skinWeight', new Float32BufferAttribute(skinW, 4));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // weld normals across the belly seam (j = 0 and j = nSeg duplicates)
    const N = geo.attributes.normal;
    for (let i = 0; i < nRings; i++) {
      const a = vid[i][0].lo, b = vid[i][nSeg].lo;
      const nx = N.getX(a) + N.getX(b), ny = N.getY(a) + N.getY(b), nz = N.getZ(a) + N.getZ(b);
      const l = Math.hypot(nx, ny, nz) || 1;
      N.setXYZ(a, nx / l, ny / l, nz / l);
      N.setXYZ(b, nx / l, ny / l, nz / l);
    }
    // combs are double-sided flat cards: keep their authored normals
    // ring parameter of the right eye, for the face markings
    const thM = this.cornerTheta(P.eyeT);
    this.u.uEyeLoc.value.y = sR + ((thM - P.eyeTheta) / (2 * thM)) * (1 - 2 * sR);
    this.bodyGeo = geo;
    this.outerVertCount = outerVertCount;
    this.outerIndexCount = outerIndexCount;
    Object.assign(this.cache, { bodyGeo: geo, outerVertCount, outerIndexCount, eyeLocY: this.u.uEyeLoc.value.y });
    this._bodyMesh();
  }

  // ---- fins ----------------------------------------------------------------------------------
  _finGeometry({ span, chordRoot, chordMax, armR, rays = 4, scallop = 0.1, sweep = 0.12, side = 1, bones, tipRound = 0.15, fur = true, droop = 0, bulge = 0, camberAmt = 0.07 }) {
    const nU = 26, nLoop = 22;
    const pos = [], nor = [], uv = [], fin = [], loft = [], mask = [], skinI = [], skinW = [], comb = [];
    const idx = [];
    const rayU = [];
    for (let r = 0; r < rays; r++) rayU.push(0.2 + (0.72 / rays) * (r + 0.5));
    const memT = Math.max(0.004 * this.L * (this.g.calf ? 1.6 : 1), 0.012);
    const P = this.P;
    for (let i = 0; i <= nU; i++) {
      const u = i / nU;
      let chord = lerp(chordRoot, chordMax, smoothstep(0, 0.32, u)) * lerp(1, 0.32, smoothstep(0.32, 1, u) ** 1.4);
      let thick = lerp(armR, armR * 0.28, u);
      if (u > 1 - tipRound) {
        const s = (u - (1 - tipRound)) / tipRound;
        const c = Math.sqrt(Math.max(0, 1 - s * s));
        chord *= Math.max(c, 0.02);
        thick *= Math.max(c, 0.05);
      }
      const leX = u * span;
      const leZ = -sweep * span * u * u + bulge * span * Math.sin(Math.PI * Math.min(1, u * 1.1));
      const leY = -droop * span * u * u;
      for (let k = 0; k < nLoop; k++) {
        const ph = (k / nLoop) * Math.PI * 2;
        const v = 0.5 - 0.5 * Math.cos(ph);
        const top = Math.sin(ph) >= 0 ? 1 : -1;
        // scalloped trailing edge between rays
        let sc = 1;
        if (rays > 0) {
          let near = 1;
          for (const ru of rayU) near = Math.min(near, Math.abs(u - (ru + 0.1)) / 0.12);
          sc = 1 - scallop * smoothstep(0.15, 1, Math.min(near, 1)) * smoothstep(0.1, 0.25, u);
        }
        const ch = chord * (v > 0.25 ? lerp(1, sc, smoothstep(0.25, 1, v)) : 1);
        const vArm = Math.min(0.9, (2 * thick) / Math.max(ch, 1e-4));
        let ht;
        if (v < vArm) ht = thick * Math.sqrt(Math.max(0, 1 - (v / vArm) ** 2)) + memT * 0.5;
        else ht = memT * (1 - Math.pow(v, 4)) * 0.5 + 0.0005;
        const x = leX + v * ch * 0.18 * u; // trailing points splay outward slightly
        // camber: the membrane arches like a sail between arm and trailing edge
        const camber = (camberAmt ?? 0.07) * ch * Math.sin(Math.PI * Math.min(1, v * 1.05)) * Math.sin(Math.PI * Math.min(1, u * 1.15 + 0.1));
        const y = leY + top * ht + camber;
        const z = leZ - v * ch;
        // bind-space: rotate into place (side mirror)
        pos.push(x * side, y, z);
        nor.push(0, 0, 0);
        uv.push(u * span, v * ch);
        let rayM = 0;
        fin.push(u, v, rayM, top > 0 ? 1 : 0);
        const furM = fur ? (1 - smoothstep(0.06, 0.22, v)) * (top > 0 ? 1 : 0.35) * (1 - smoothstep(0.6, 0.95, u)) : 0;
        loft.push(P.finT + 0.01, side > 0 ? 0.3 : 0.7);
        mask.push(furM, 0, 0, 0);
        // weights along the span
        const ws = [];
        const chain = bones.map((b, q) => [b, q === 0 ? 0 : q === 1 ? 0.38 : 0.72]);
        const r = this._ramp(chain, u);
        for (const [b, w] of r) ws.push([b, w]);
        if (u < 0.08 && bones.parent !== undefined) {
          const wp = (1 - u / 0.08) * 0.6;
          for (const e of ws) e[1] *= 1 - wp;
          ws.push([bones.parent, wp]);
        }
        pushWeights(skinI, skinW, ws);
        comb.push(side * 0.6, 0, -0.8);
      }
    }
    for (let i = 0; i < nU; i++) {
      for (let k = 0; k < nLoop; k++) {
        const a = i * nLoop + k, b = i * nLoop + ((k + 1) % nLoop);
        const c = (i + 1) * nLoop + k, d = (i + 1) * nLoop + ((k + 1) % nLoop);
        if (side > 0) idx.push(a, c, b, b, c, d);
        else idx.push(a, b, c, b, d, c);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    geo.setAttribute('aFin', new Float32BufferAttribute(fin, 4));
    geo.setAttribute('aLoft', new Float32BufferAttribute(loft, 2));
    geo.setAttribute('aMask', new Float32BufferAttribute(mask, 4));
    geo.setAttribute('aComb', new Float32BufferAttribute(comb, 3));
    geo.setAttribute('skinIndex', new Uint16BufferAttribute(skinI, 4));
    geo.setAttribute('skinWeight', new Float32BufferAttribute(skinW, 4));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  _finMaterial(opts) {
    const g = this.g;
    const u = Object.assign({}, G, {
      uArm: { value: new Color(g.arm || g.back) },
      uMembrane: { value: new Color(g.membrane || '#f2c4b8') },
      uFinTip: { value: new Color(g.finTip || g.membrane || '#e8a8a0') },
      uRayCol: { value: new Color(g.ray || g.back) },
      uSeed: this.u.uSeed,
      uBillow: { value: 0 },
      uFinUp: { value: opts.up || new Vector3(0, 1, 0) },
      uFlutter: { value: 0.02 },
      uLen: this.u.uLen,
      uChordLen: { value: opts.chordLen || 1 },
      uRays: { value: opts.rays ?? 4 },
    });
    const m = new ShaderMaterial({ vertexShader: FIN_VERT, fragmentShader: FIN_FRAG, uniforms: u, side: DoubleSide });
    return m;
  }

  _buildFins() {
    const P = this.P, L = this.L, bi = this.boneIndex;
    this.fins = {};
    for (const side of [1, -1]) {
      const s = side > 0 ? 'R' : 'L';
      const bones = [bi['fin' + s + '1'], bi['fin' + s + '2'], bi['fin' + s + '3']];
      bones.parent = bi.chest;
      const span = P.finSpan * L * this.finScale;
      const q = new Quaternion().setFromUnitVectors(new Vector3(side, 0, 0), this.finDir(side));
      const up = new Vector3(0, 1, 0).applyQuaternion(q);
      let geo = this.cache['fin' + s];
      if (!geo) {
        geo = this._finGeometry({
          span, chordRoot: P.finChord * L, chordMax: P.finChordMax * L * this.finScale, armR: P.armR * L,
          rays: this.g.calf ? 4 : 5, scallop: this.g.calf ? 0.09 : 0.16, sweep: 0.2, side, bones, droop: 0.03, bulge: 0.07, tipRound: 0.24, camberAmt: 0.08,
        });
        // orient: fin was generated along +X*side from origin; move to shoulder & tilt
        const sh = this.boneAbs['fin' + s + '1'];
        geo.applyMatrix4(new Matrix4().compose(sh, q, new Vector3(1, 1, 1)));
        this.cache['fin' + s] = geo;
      }
      const mat = this._finMaterial({ up, chordLen: P.finChordMax * L, rays: 4 });
      const mesh = new SkinnedMesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.name = 'fin' + s;
      this.group.add(mesh);
      this.fins[s] = mesh;
    }
    // rear fins
    this.rear = {};
    for (const side of [1, -1]) {
      const s = side > 0 ? 'R' : 'L';
      const bones = [bi['rear' + s], bi['rear' + s], bi['rear' + s]];
      bones.parent = bi.spine2;
      const dir = new Vector3(side * 0.7, -0.55, -0.45).normalize();
      const q = new Quaternion().setFromUnitVectors(new Vector3(side, 0, 0), dir);
      let geo = this.cache['rear' + s];
      if (!geo) {
        geo = this._finGeometry({
          span: P.rearSpan * L, chordRoot: P.rearChord * L, chordMax: P.rearChord * L * 1.1, armR: P.armR * L * 0.45,
          rays: 2, scallop: 0.08, sweep: 0.5, side, bones, fur: false, tipRound: 0.35, droop: 0.2,
        });
        const at = this.boneAbs['rear' + s];
        geo.applyMatrix4(new Matrix4().compose(at, q, new Vector3(1, 1, 1)));
        this.cache['rear' + s] = geo;
      }
      const mat = this._finMaterial({ up: new Vector3(0, 1, 0).applyQuaternion(q), chordLen: P.rearChord * L, rays: 2 });
      const mesh = new SkinnedMesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.name = 'rear' + s;
      this.group.add(mesh);
      this.rear[s] = mesh;
    }
  }

  _buildFluke() {
    const P = this.P, L = this.L, bi = this.boneIndex;
    // two lobes built as mirrored fins from the tail tip
    this.flukes = {};
    const base = this.boneAbs.fluke.clone().add(new Vector3(0, 0, 0.02 * L));
    for (const side of [1, -1]) {
      const s = side > 0 ? 'R' : 'L';
      const bones = [bi.tail3, bi.fluke, bi.fluke];
      bones.parent = bi.tail3;
      let geo = this.cache['fluke' + s];
      if (!geo) {
        geo = this._finGeometry({
          span: P.flukeSpan * L, chordRoot: P.flukeChord * L, chordMax: P.flukeChord * L * 0.95,
          armR: this.prof(0.02).hw * 0.9, rays: 3, scallop: 0.05, sweep: 0.7, side, bones, fur: true, tipRound: 0.32, bulge: 0.05,
        });
        geo.applyMatrix4(new Matrix4().makeTranslation(base.x, base.y, base.z));
        this.cache['fluke' + s] = geo;
      }
      const mat = this._finMaterial({ up: new Vector3(0, 1, 0), chordLen: P.flukeChord * L, rays: 3 });
      mat.uniforms.uFlutter.value = 0.03;
      const mesh = new SkinnedMesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.name = 'fluke' + s;
      this.group.add(mesh);
      this.flukes[s] = mesh;
    }
  }

  // ---- eyes ----------------------------------------------------------------------------------
  _buildEyes() {
    const P = this.P, L = this.L, g = this.g;
    this.eyes = {};
    const r = P.eyeR * L;
    const geo = this.cache.eyeGeo || (this.cache.eyeGeo = new SphereGeometry(r, 40, 28));
    for (const side of [1, -1]) {
      const s = side > 0 ? 'R' : 'L';
      const th = P.eyeTheta * side;
      const sp = this.surfacePoint(P.eyeT, th);
      const sn = this.surfaceNormal(P.eyeT, th);
      const center = sp.clone().addScaledVector(sn, -r * 0.42);
      // socket frame: gaze forward-outward, up = world up
      const fwd = sn.clone().multiplyScalar(1 - P.eyeFront).add(new Vector3(0, 0.05, P.eyeFront)).normalize();
      const up = new Vector3(0, 1, 0);
      const x = new Vector3().crossVectors(up, fwd).normalize();
      const y = new Vector3().crossVectors(fwd, x).normalize();
      const basis = new Matrix4().makeBasis(x, y, fwd);
      const q = new Quaternion().setFromRotationMatrix(basis);
      const u = Object.assign({}, G, {
        uGaze: { value: new Vector3(0, 0, 1) },
        uLids: { value: new Vector4(0.62, -0.62, -0.25, 0.15) },
        uPupil: { value: g.calf ? 0.36 : 0.22 },
        uIrisR: { value: g.calf ? 0.62 : 0.5 },
        uIris: { value: new Color(g.iris || '#5cc8d6') },
        uIris2: { value: new Color(g.iris2 || '#18304a') },
        uLidCol: { value: new Color(g.lid || g.back) },
        uSclera: { value: new Color(g.sclera || '#f3efe6') },
        uSide: { value: side },
        uSparkle: { value: 1 },
      });
      const mat = new ShaderMaterial({ vertexShader: EYE_VERT, fragmentShader: EYE_FRAG, uniforms: u });
      const mesh = new Mesh(geo, mat);
      mesh.name = 'eye' + s;
      // parent to head bone (bind: bone world = translation only)
      const hb = this.bones.head;
      mesh.position.copy(center).sub(this.boneAbs.head);
      mesh.quaternion.copy(q);
      hb.add(mesh);
      mesh.frustumCulled = false;
      this.eyes[s] = { mesh, u, basis: q.clone(), center };
    }
  }

  // ---- gill fronds ---------------------------------------------------------------------------
  _buildFronds() {
    const P = this.P, L = this.L, g = this.g;
    const len = P.frondLen * L * (g.frondScale ?? 1);
    this.fronds = {};
    let geo = this.cache.frondGeo;
    if (!geo) {
    const pos = [], nor = [], fr = [], idx = [];
    const count = 3;
    for (let f = 0; f < count; f++) {
      // Each frond is one feathery ribbon (axolotl-like external gill): the barbs are cut
      // out in the shader, so the outline stays soft at any distance. The three fan out.
      const fl = len * (1 - Math.abs(f - 1) * 0.16);
      const nS = 14;
      const base = pos.length / 3;
      for (let i = 0; i <= nS; i++) {
        const a = i / nS;
        // lift away from the cheek, then sweep back; the outer two splay up and down
        const cx = (0.12 + a * 0.55) * fl * Math.sin(Math.min(1, a * 1.6) * 1.4) + (f - 1) * fl * 0.03;
        const cy = (f - 1) * (fl * 0.08 + a * fl * 0.62) + Math.sin(a * 2.0) * fl * 0.05;
        const cz = -a * fl * 0.92;
        const w = fl * (0.04 + 0.19 * Math.pow(Math.sin(Math.PI * Math.min(1, a * 0.85 + 0.12)), 0.8));
        for (const side of [-1, 1]) {
          pos.push(cx, cy + side * w, cz);
          nor.push(1, 0, 0);
          fr.push(a, side, f);
        }
      }
      for (let i = 0; i < nS; i++) {
        const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
        idx.push(a, c, b, b, c, d);
      }
    }
    geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new Float32BufferAttribute(nor, 3));
    geo.setAttribute('aFrond', new Float32BufferAttribute(fr, 3));
    geo.setIndex(idx);
    this.cache.frondGeo = geo;
    }
    const fu = {
      uFlare: { value: 0.3 },
      uStream: { value: 0.3 },
      uWiggle: { value: 0.3 },
      uFrondLen: { value: len },
      uFlowDir: { value: new Vector3(0, 0, -1) },
      uFrondCol: { value: new Color(g.frond || '#ff9f9a') },
      uFrondTip: { value: new Color(g.frondTip || '#ffd2c4') },
      uFrondRoot: { value: new Color(g.back).lerp(new Color(g.frond || '#ff9f9a'), 0.3) },
      uFlareF: { value: 0.3 },
    };
    this.frondU = fu;
    for (const side of [1, -1]) {
      const s = side > 0 ? 'R' : 'L';
      const th = side * 1.62;
      const sp = this.surfacePoint(P.frondT, th);
      const sn = this.surfaceNormal(P.frondT, th);
      const root = sp.clone().addScaledVector(sn, len * 0.02);
      const mat = new ShaderMaterial({
        vertexShader: FROND_VERT, fragmentShader: FROND_FRAG,
        uniforms: Object.assign({}, G, fu), side: DoubleSide,
      });
      mat.alphaToCoverage = true;
      const mesh = new Mesh(geo, mat);
      mesh.name = 'fronds' + s;
      mesh.frustumCulled = false;
      // local frame: +X along surface normal (outward), -Z backward
      const x = sn.clone();
      x.z *= 0.3;
      x.normalize();
      const z = new Vector3(0, 0, 1);
      const y = new Vector3().crossVectors(z, x).normalize();
      const z2 = new Vector3().crossVectors(x, y).normalize();
      const basis = new Matrix4().makeBasis(x, y, z2);
      mesh.quaternion.setFromRotationMatrix(basis);
      mesh.position.copy(root).sub(this.boneAbs.neck);
      if (side < 0) {
        // mirrored frame keeps the frond geometry's +X pointing outward
      }
      this.bones.neck.add(mesh);
      this.fronds[s] = mesh;
    }
  }

  // ---- fur shells ------------------------------------------------------------------------------
  _buildFur() {
    // the LOD in Whale.animate draws only as many as the fur's height on screen needs
    const shells = this.g.calf ? 24 : 20;
    this.maxShells = shells;
    if (this.cache.furGeo) {
      this.furTriPerShell = this.cache.furTriPerShell;
      this._furMesh(this.cache.furGeo, shells);
      return;
    }
    // gather fur-bearing triangles from body outer surface + fin/fluke arms
    const parts = [
      { geo: this.bodyGeo, triCount: this.outerIndexCount / 3 },
      { geo: this.fins.R.geometry }, { geo: this.fins.L.geometry },
      { geo: this.flukes.R.geometry }, { geo: this.flukes.L.geometry },
    ];
    const srcPos = [], srcNor = [], srcUv = [], srcLoft = [], srcMask = [], srcComb = [], srcSI = [], srcSW = [];
    const tris = [];
    for (const part of parts) {
      const g = part.geo;
      const a = g.attributes;
      const index = g.index.array;
      const triCount = part.triCount ?? index.length / 3;
      const remap = new Map();
      const getV = (vi) => {
        if (remap.has(vi)) return remap.get(vi);
        const n = srcPos.length / 3;
        srcPos.push(a.position.getX(vi), a.position.getY(vi), a.position.getZ(vi));
        srcNor.push(a.normal.getX(vi), a.normal.getY(vi), a.normal.getZ(vi));
        srcUv.push(a.uv.getX(vi), a.uv.getY(vi));
        srcLoft.push(a.aLoft.getX(vi), a.aLoft.getY(vi));
        srcMask.push(a.aMask.getX(vi), a.aMask.getY(vi), a.aMask.getZ(vi), a.aMask.getW(vi));
        srcComb.push(a.aComb.getX(vi), a.aComb.getY(vi), a.aComb.getZ(vi));
        srcSI.push(a.skinIndex.getX(vi), a.skinIndex.getY(vi), a.skinIndex.getZ(vi), a.skinIndex.getW(vi));
        srcSW.push(a.skinWeight.getX(vi), a.skinWeight.getY(vi), a.skinWeight.getZ(vi), a.skinWeight.getW(vi));
        remap.set(vi, n);
        return n;
      };
      for (let tr = 0; tr < triCount; tr++) {
        const i0 = index[tr * 3], i1 = index[tr * 3 + 1], i2 = index[tr * 3 + 2];
        const f = Math.max(a.aMask.getX(i0), a.aMask.getX(i1), a.aMask.getX(i2));
        if (f < 0.03) continue;
        tris.push(getV(i0), getV(i1), getV(i2));
      }
    }
    const nv = srcPos.length / 3;
    // bit-reversed shell order: any prefix of the index buffer covers heights evenly (LOD)
    const order = [];
    for (let i = 0; i < shells; i++) order.push(i);
    order.sort((a, b) => bitrev(a) - bitrev(b));
    const pos = new Float32Array(nv * 3 * shells);
    const nor = new Float32Array(nv * 3 * shells);
    const uvA = new Float32Array(nv * 2 * shells);
    const loft = new Float32Array(nv * 2 * shells);
    const mask = new Float32Array(nv * 4 * shells);
    const comb = new Float32Array(nv * 3 * shells);
    const shell = new Float32Array(nv * shells);
    const si = new Uint16Array(nv * 4 * shells);
    const sw = new Float32Array(nv * 4 * shells);
    const index = new Uint32Array(tris.length * shells);
    for (let k = 0; k < shells; k++) {
      const h = (order[k] + 1) / shells;
      const o = k * nv;
      pos.set(srcPos, o * 3); nor.set(srcNor, o * 3); uvA.set(srcUv, o * 2); loft.set(srcLoft, o * 2);
      mask.set(srcMask, o * 4); comb.set(srcComb, o * 3); si.set(srcSI, o * 4); sw.set(srcSW, o * 4);
      shell.fill(h, o, o + nv);
      for (let i = 0; i < tris.length; i++) index[k * tris.length + i] = tris[i] + o;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new Float32BufferAttribute(uvA, 2));
    geo.setAttribute('aLoft', new Float32BufferAttribute(loft, 2));
    geo.setAttribute('aMask', new Float32BufferAttribute(mask, 4));
    geo.setAttribute('aComb', new Float32BufferAttribute(comb, 3));
    geo.setAttribute('aShell', new Float32BufferAttribute(shell, 1));
    geo.setAttribute('skinIndex', new Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new Float32BufferAttribute(sw, 4));
    geo.setIndex(new Uint32BufferAttribute(index, 1));
    this.furTriPerShell = tris.length;
    this.cache.furGeo = geo;
    this.cache.furTriPerShell = tris.length;
    this._furMesh(geo, shells);
  }

  _furMesh(geo, shells) {
    const mat = new ShaderMaterial({
      vertexShader: FUR_VERT,
      fragmentShader: FUR_FRAG,
      uniforms: Object.assign({}, G, this.u),
      side: DoubleSide,
    });
    mat.alphaToCoverage = true;
    const mesh = new SkinnedMesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.name = 'fur';
    this.fur = mesh;
    this.furShells = shells;
    mesh.onBeforeRender = () => {
      geo.drawRange.start = 0;
      geo.drawRange.count = this.furTriPerShell * this.furShells;
    };
    this.group.add(mesh);
  }

  setFurShells(n) {
    this.furShells = Math.max(0, Math.min(this.maxShells, Math.round(n)));
    this.fur.visible = this.furShells > 0;
  }

  _bindAll() {
    this.group.updateMatrixWorld(true);
    const ident = new Matrix4();
    for (const m of [this.body, this.fur, this.fins.R, this.fins.L, this.rear.R, this.rear.L, this.flukes.R, this.flukes.L]) {
      m.bind(this.skeleton, ident);
      // preset bounds (radius L holds the fins): three would otherwise skin every vertex on the CPU at first draw
      m.boundingSphere = new Sphere(new Vector3(), this.L);
    }
    this.meshes = [this.body, this.fins.R, this.fins.L, this.rear.R, this.rear.L, this.flukes.R, this.flukes.L];
  }

  castShadows(shadows) {
    for (const m of this.meshes) shadows.addCaster(m);
  }

  setVisible(v) {
    this.group.visible = v;
  }
}

function bitrev(i) {
  let r = 0;
  for (let b = 0; b < 8; b++) r |= ((i >> b) & 1) << (7 - b);
  return r;
}

function pushWeights(SI, SW, ws) {
  ws.sort((a, b) => b[1] - a[1]);
  const top = ws.slice(0, 4);
  const sum = top.reduce((s, e) => s + e[1], 0) || 1;
  for (let k = 0; k < 4; k++) {
    if (k < top.length) { SI.push(top[k][0]); SW.push(top[k][1] / sum); }
    else { SI.push(0); SW.push(0); }
  }
}

