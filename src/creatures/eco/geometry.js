// Procedural geometry for the sky ecosystem. Every creature is a single small mesh drawn
// with instancing; the per-vertex attributes describe *where on the anatomy* a vertex is
// (part ids, span/chord/along parameters, hinge roots) so the vertex shaders can animate
// legs, fins, wings, tails and tentacles without bones.
import { BufferGeometry, InstancedBufferGeometry, BufferAttribute, Float32BufferAttribute, Uint16BufferAttribute } from 'three';

const TAU = Math.PI * 2;

/** Catmull-Rom lookup in a table sampled at increasing T. */
function tab(T, V, t) {
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

class Builder {
  constructor(attrs) {
    this.pos = [];
    this.nor = [];
    this.idx = [];
    this.attrs = {};
    for (const [k, size] of Object.entries(attrs)) this.attrs[k] = { size, data: [] };
  }
  v(p, n, a) {
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n ? n[0] : 0, n ? n[1] : 1, n ? n[2] : 0);
    for (const [k, at] of Object.entries(this.attrs)) {
      const val = a[k] || [];
      for (let i = 0; i < at.size; i++) at.data.push(val[i] ?? 0);
    }
    return this.pos.length / 3 - 1;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  build(instanced = false, computeNormals = false) {
    const g = instanced ? new InstancedBufferGeometry() : new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nor, 3));
    for (const [k, at] of Object.entries(this.attrs)) g.setAttribute(k, new Float32BufferAttribute(at.data, at.size));
    g.setIndex(new Uint16BufferAttribute(this.idx, 1));
    if (computeNormals) g.computeVertexNormals();
    return g;
  }
}

// ---------------------------------------------------------------------------------------
// Sky krill (length 1 along +Z, scaled per instance to 0.2-0.4 m).
// aPart: x part (0 body, 1 tail fan, 2 swimmeret, 3 antenna, 4 thoracic leg), y along, z leg index, w side
// aRoot: hinge point of the part
export function buildKrillGeometry() {
  const B = new Builder({ aPart: 4, aRoot: 3 });
  const ST = [
    // z, half-width, half-height, centre y
    [0.46, 0.022, 0.020, 0.022],
    [0.40, 0.054, 0.052, 0.016],
    [0.31, 0.073, 0.077, 0.010],
    [0.19, 0.077, 0.083, 0.004],
    [0.07, 0.069, 0.074, -0.002],
    [-0.04, 0.058, 0.061, -0.008],
    [-0.15, 0.049, 0.051, -0.016],
    [-0.25, 0.041, 0.042, -0.026],
    [-0.33, 0.032, 0.033, -0.037],
    [-0.40, 0.022, 0.023, -0.047],
    [-0.445, 0.012, 0.012, -0.053],
  ];
  const SIDES = 6;
  const prof = (z) => {
    // interpolate the station table (used to place legs on the hull)
    for (let i = 0; i < ST.length - 1; i++) {
      const a = ST[i], b = ST[i + 1];
      if (z <= a[0] && z >= b[0]) {
        const t = (a[0] - z) / (a[0] - b[0]);
        return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
      }
    }
    return [0.03, 0.03, 0];
  };
  const apex = B.v([0, 0.022, 0.505], [0, 0, 1], { aPart: [0, 1, 0, 0] });
  const rings = [];
  for (const [z, hw, hh, cy] of ST) {
    const ring = [];
    for (let k = 0; k < SIDES; k++) {
      const a = (k / SIDES) * TAU;
      ring.push(B.v([hw * Math.sin(a), cy + hh * Math.cos(a), z], null, { aPart: [0, z + 0.5, 0, 0] }));
    }
    rings.push(ring);
  }
  for (let k = 0; k < SIDES; k++) B.tri(apex, rings[0][(k + 1) % SIDES], rings[0][k]);
  for (let r = 0; r < rings.length - 1; r++) {
    for (let k = 0; k < SIDES; k++) {
      const a = rings[r][k], b = rings[r][(k + 1) % SIDES], c = rings[r + 1][k], d = rings[r + 1][(k + 1) % SIDES];
      B.tri(a, b, c);
      B.tri(b, d, c);
    }
  }
  const last = rings[rings.length - 1];
  const tailC = B.v([0, -0.054, -0.455], [0, 0, -1], { aPart: [0, 0.04, 0, 0] });
  for (let k = 0; k < SIDES; k++) B.tri(tailC, last[k], last[(k + 1) % SIDES]);

  // Tail fan: five lobes (telson + two pairs of uropods) with notches between them.
  {
    const root = [0, -0.052, -0.43];
    const c = B.v(root, [0, 1, 0], { aPart: [1, 0, 0, 0], aRoot: root });
    const pts = [];
    const n = 11;
    for (let k = 0; k < n; k++) {
      const ang = (-75 + (150 * k) / (n - 1)) * (Math.PI / 180);
      const lobe = k % 2 === 1; // odd = blade tip
      const edge = k === 0 || k === n - 1;
      const r = edge ? 0.045 : lobe ? (k === 5 ? 0.125 : 0.135) : 0.075;
      const x = Math.sin(ang) * r, z = root[2] - Math.cos(ang) * r;
      pts.push(B.v([x, root[1] - 0.012 * (r / 0.13), z], [0, 1, 0], { aPart: [1, r / 0.135, 0, Math.sign(x)], aRoot: root }));
    }
    for (let k = 0; k < n - 1; k++) B.tri(c, pts[k + 1], pts[k]);
  }

  // Swimmerets: five pairs of paddles under the abdomen (metachronal stroke).
  const swim = [-0.02, -0.11, -0.2, -0.28, -0.35];
  swim.forEach((z, li) => {
    const [hw, hh, cy] = prof(z);
    const len = 0.07 - li * 0.005;
    for (const side of [-1, 1]) {
      const root = [side * Math.min(0.02, hw * 0.45), cy - hh * 0.85, z];
      const w = 0.011;
      const a = B.v([root[0], root[1], z + w], null, { aPart: [2, 0, li, side], aRoot: root });
      const b = B.v([root[0], root[1], z - w], null, { aPart: [2, 0, li, side], aRoot: root });
      const tip = [root[0] + side * 0.01, root[1] - len, z - 0.022];
      const c = B.v([tip[0], tip[1], tip[2] + w * 0.35], null, { aPart: [2, 1, li, side], aRoot: root });
      const d = B.v([tip[0], tip[1], tip[2] - w * 0.75], null, { aPart: [2, 1, li, side], aRoot: root });
      B.tri(a, b, c);
      B.tri(b, d, c);
    }
  });

  // Thoracic legs: a feeding basket under the carapace.
  const legs = [0.29, 0.23, 0.17, 0.11];
  legs.forEach((z, li) => {
    const [hw, hh, cy] = prof(z);
    for (const side of [-1, 1]) {
      const root = [side * hw * 0.45, cy - hh * 0.85, z];
      const w = 0.007;
      const tip = [root[0] + side * 0.018, root[1] - 0.1 + li * 0.008, z + 0.035];
      const a = B.v([root[0], root[1], z + w], null, { aPart: [4, 0, li, side], aRoot: root });
      const b = B.v([root[0], root[1], z - w], null, { aPart: [4, 0, li, side], aRoot: root });
      const c = B.v([tip[0], tip[1], tip[2] + w], null, { aPart: [4, 1, li, side], aRoot: root });
      const d = B.v([tip[0], tip[1], tip[2] - w], null, { aPart: [4, 1, li, side], aRoot: root });
      B.tri(a, b, c);
      B.tri(b, d, c);
    }
  });

  // Antennae: long, thin, sweeping back.
  for (const side of [-1, 1]) {
    const root = [side * 0.022, 0.032, 0.45];
    let p = root.slice();
    let yaw = side * 0.32, pitch = 0.32;
    const segs = 4, segL = 0.135, w = 0.006;
    let prev = null;
    for (let s = 0; s <= segs; s++) {
      const dx = Math.sin(yaw) * Math.cos(pitch), dy = Math.sin(pitch), dz = Math.cos(yaw) * Math.cos(pitch);
      // across = horizontal perpendicular
      const ax = dz, az = -dx;
      const la = Math.hypot(ax, az) || 1;
      const ww = w * (1 - s / (segs + 1));
      const a = B.v([p[0] + (ax / la) * ww, p[1], p[2] + (az / la) * ww], [0, 1, 0], { aPart: [3, s / segs, 0, side], aRoot: root });
      const b = B.v([p[0] - (ax / la) * ww, p[1], p[2] - (az / la) * ww], [0, 1, 0], { aPart: [3, s / segs, 0, side], aRoot: root });
      if (prev) {
        B.tri(prev[0], prev[1], a);
        B.tri(prev[1], b, a);
      }
      prev = [a, b];
      p = [p[0] + dx * segL, p[1] + dy * segL, p[2] + dz * segL];
      yaw += side * 0.22;
      pitch -= 0.2;
    }
  }
  return B.build(true, true);
}

// ---------------------------------------------------------------------------------------
// Sky ray (half-span 1 along X, nose +Z). aRay: x part (0 wing/body surface, 1 cephalic lobe,
// 2 tail, 3 wingtip ribbon); surface: y = |x| span, z = chord (0 leading .. 1 trailing), w = top(+1)/bottom(-1)
const A_TAB = [0, 0.08, 0.15, 0.25, 0.4, 0.55, 0.7, 0.85, 0.95, 1.0];
const LE_TAB = [0.4, 0.395, 0.37, 0.32, 0.22, 0.1, -0.03, -0.15, -0.235, -0.285];
const TE_TAB = [-0.46, -0.44, -0.37, -0.29, -0.225, -0.205, -0.215, -0.25, -0.285, -0.3];
export const RAY_SHAPE = {
  le: (a) => tab(A_TAB, LE_TAB, a),
  te: (a) => tab(A_TAB, TE_TAB, a),
  thick: (a, c) => {
    const b = Math.max(0, 1 - a / 0.3);
    const span = 0.15 * Math.pow(b, 1.3) + 0.024 * (1 - a) + 0.003;
    return span * 2.6 * Math.sqrt(Math.max(c, 0)) * (1 - c);
  },
  camber: (a) => 0.05 * a * a - 0.03 * a * a * a * a,
  tailLen: 1.35,
  ribbonLen: 0.95,
};

export function buildRayGeometry() {
  const B = new Builder({ aRay: 4 });
  const S = RAY_SHAPE;
  const half = [0, 0.035, 0.075, 0.12, 0.17, 0.23, 0.3, 0.38, 0.46, 0.54, 0.62, 0.7, 0.78, 0.85, 0.91, 0.955, 0.985, 1.0];
  const xs = [];
  for (let i = half.length - 1; i > 0; i--) xs.push(-half[i]);
  for (const h of half) xs.push(h);
  const nW = 16;
  const grid = [];
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i], a = Math.abs(x);
    const le = S.le(a), te = S.te(a);
    const row = [];
    for (let j = 0; j < nW; j++) {
      const w = j / nW;
      const c = 0.5 - 0.5 * Math.cos(TAU * w);
      const top = j <= nW / 2 ? 1 : -1;
      const th = S.thick(a, c);
      const y = S.camber(a) + (top > 0 ? 0.62 : -0.38) * th;
      const z = le + (te - le) * c;
      row.push([x, y, z, a, c, j === 0 || j === nW / 2 ? 0 : top]);
    }
    grid.push(row);
  }
  // normals by central differences on the closed loop / open span
  const nS = xs.length;
  const idx = [];
  for (let i = 0; i < nS; i++) {
    for (let j = 0; j < nW; j++) {
      const p = grid[i][j];
      const pl = grid[i][(j + 1) % nW], pr = grid[i][(j - 1 + nW) % nW];
      const qa = grid[Math.min(nS - 1, i + 1)][j], qb = grid[Math.max(0, i - 1)][j];
      const t1 = [pl[0] - pr[0], pl[1] - pr[1], pl[2] - pr[2]];
      const t2 = [qa[0] - qb[0], qa[1] - qb[1], qa[2] - qb[2]];
      let n = [t1[1] * t2[2] - t1[2] * t2[1], t1[2] * t2[0] - t1[0] * t2[2], t1[0] * t2[1] - t1[1] * t2[0]];
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      n = n.map((v) => v / l);
      // orient outward: top vertices up, bottom down, leading edge forward
      const want = p[5] > 0 ? 1 : p[5] < 0 ? -1 : 0;
      if (want !== 0 && Math.sign(n[1]) !== want && Math.abs(n[1]) > 0.05) n = n.map((v) => -v);
      if (want === 0) {
        const fwd = j === 0 ? 1 : -1;
        if (Math.sign(n[2]) !== fwd && Math.abs(n[2]) > 0.05) n = n.map((v) => -v);
      }
      idx.push(B.v([p[0], p[1], p[2]], n, { aRay: [0, p[3], p[4], p[5]] }));
    }
  }
  const at = (i, j) => idx[i * nW + (j % nW)];
  for (let i = 0; i < nS - 1; i++) {
    for (let j = 0; j < nW; j++) {
      // winding chosen so faces point outward (checked against the top surface normal)
      B.tri(at(i, j), at(i + 1, j), at(i, j + 1));
      B.tri(at(i, j + 1), at(i + 1, j), at(i + 1, j + 1));
    }
  }
  // Cephalic lobes: rolled flaps either side of the mouth (unfurl to feed). Two copies with
  // opposite winding so both sides render with front-face culling.
  for (const side of [-1, 1]) {
    const nL = 7;
    for (const back of [0, 1]) {
      const ids = [];
      for (let k = 0; k < nL; k++) {
        const t = k / (nL - 1);
        for (const ac of [-1, 1]) {
          ids.push(B.v([side * (0.1 + ac * 0.025), 0, 0.38 + t * 0.12], [0, 1, 0], { aRay: [1, t, ac, side * (back ? 2 : 1)] }));
        }
      }
      for (let k = 0; k < nL - 1; k++) {
        const a = ids[k * 2], b = ids[k * 2 + 1], c = ids[k * 2 + 2], d = ids[k * 2 + 3];
        if (back) { B.tri(a, c, b); B.tri(b, c, d); } else { B.tri(a, b, c); B.tri(b, d, c); }
      }
    }
  }
  // Tail and wingtip ribbons: camera-facing strips built in the vertex shader.
  const strip = (part, n, extra, restFn) => {
    const ids = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      for (const side of [-1, 1]) ids.push(B.v(restFn(t), [0, 1, 0], { aRay: [part, t, side, extra] }));
    }
    for (let k = 0; k < n; k++) {
      const a = ids[k * 2], b = ids[k * 2 + 1], c = ids[k * 2 + 2], d = ids[k * 2 + 3];
      B.tri(a, b, c);
      B.tri(b, d, c);
    }
  };
  strip(2, 26, 0, (t) => [0, 0, -0.44 - t * S.tailLen]);
  for (const wing of [-1, 1]) strip(3, 22, wing, (t) => [wing, S.camber(1), -0.27 - t * S.ribbonLen]);
  const g = B.build(true, false);
  return g;
}

// ---------------------------------------------------------------------------------------
// Sky jelly (bell radius ~1, apex at +Y). aJ: x part (0 bell outer, 1 bell inner, 2 tentacle,
// 3 oral arm, 4 core), y v / along, z angle, w side / index
export const JELLY_TENTACLES = 10;
export const JELLY_ARMS = 4;

export function buildJellyMembraneGeometry() {
  const B = new Builder({ aJ: 4 });
  const strip = (part, n, ang, idx) => {
    const ids = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      for (const side of [-1, 1]) ids.push(B.v([Math.cos(ang) * 0.9, -t * 2, Math.sin(ang) * 0.9], [0, 1, 0], { aJ: [part, t, ang, side + idx * 4] }));
    }
    for (let k = 0; k < n; k++) {
      const a = ids[k * 2], b = ids[k * 2 + 1], c = ids[k * 2 + 2], d = ids[k * 2 + 3];
      B.tri(a, b, c);
      B.tri(b, d, c);
    }
  };
  // Draw order inside one instance: tentacles and arms, then the bell's far (inner) wall, then the near (outer) wall.
  for (let k = 0; k < JELLY_TENTACLES; k++) strip(2, 20, (k / JELLY_TENTACLES) * TAU + 0.17, k);
  for (let k = 0; k < JELLY_ARMS; k++) strip(3, 22, (k / JELLY_ARMS) * TAU + 0.6, k);
  const nV = 14, nT = 36;
  const lathe = (part, reverse) => {
    const ids = [];
    for (let i = 0; i <= nV; i++) {
      const v = i / nV;
      for (let j = 0; j < nT; j++) {
        const th = (j / nT) * TAU;
        const psi = v * 2.0;
        ids.push(B.v([Math.sin(psi) * Math.cos(th), Math.cos(psi), Math.sin(psi) * Math.sin(th)], [0, 1, 0], { aJ: [part, v, th, 0] }));
      }
    }
    for (let i = 0; i < nV; i++) {
      for (let j = 0; j < nT; j++) {
        const a = ids[i * nT + j], b = ids[i * nT + ((j + 1) % nT)], c = ids[(i + 1) * nT + j], d = ids[(i + 1) * nT + ((j + 1) % nT)];
        if (reverse) { B.tri(a, c, b); B.tri(b, c, d); } else { B.tri(a, b, c); B.tri(b, d, c); }
      }
    }
  };
  lathe(1, true);
  lathe(0, false);
  return B.build(true, false);
}

/** The jelly's inner organ (opaque). Same lathe parameterisation as the bell so the shadow
 * pass can inflate it into the bell shape. */
export function buildJellyCoreGeometry() {
  const B = new Builder({ aJ: 4 });
  const nV = 16, nT = 24;
  const ids = [];
  for (let i = 0; i <= nV; i++) {
    const v = i / nV;
    for (let j = 0; j < nT; j++) {
      const th = (j / nT) * TAU;
      ids.push(B.v([Math.cos(th) * Math.sin(v * Math.PI) * 0.3, 0.6 - v * 0.8, Math.sin(th) * Math.sin(v * Math.PI) * 0.3], [0, 1, 0], { aJ: [4, v, th, 0] }));
    }
  }
  for (let i = 0; i < nV; i++) {
    for (let j = 0; j < nT; j++) {
      const a = ids[i * nT + j], b = ids[i * nT + ((j + 1) % nT)], c = ids[(i + 1) * nT + j], d = ids[(i + 1) * nT + ((j + 1) % nT)];
      B.tri(a, b, c);
      B.tri(b, d, c);
    }
  }
  return B.build(true, false);
}

// ---------------------------------------------------------------------------------------
// Puffbird (wingspan ~0.6 m, nose +Z). aB: x part (0 body, 1 head, 2 beak, 3 tail, 4 wing),
// wing: y along span, z chord (0 leading, 1 trailing), w side
export function buildBirdGeometry() {
  const B = new Builder({ aB: 4 });
  const sphere = (part, c, r, nLat, nLon) => {
    const ids = [];
    for (let i = 0; i <= nLat; i++) {
      const th = (i / nLat) * Math.PI;
      for (let j = 0; j < nLon; j++) {
        const ph = (j / nLon) * TAU;
        const n = [Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph)];
        ids.push(B.v([c[0] + n[0] * r[0], c[1] + n[1] * r[1], c[2] + n[2] * r[2]], n, { aB: [part, 0, 0, 0] }));
      }
    }
    for (let i = 0; i < nLat; i++) {
      for (let j = 0; j < nLon; j++) {
        const a = ids[i * nLon + j], b = ids[i * nLon + ((j + 1) % nLon)], cc = ids[(i + 1) * nLon + j], d = ids[(i + 1) * nLon + ((j + 1) % nLon)];
        B.tri(a, cc, b);
        B.tri(b, cc, d);
      }
    }
  };
  sphere(0, [0, 0, -0.012], [0.084, 0.079, 0.1], 7, 10);
  sphere(1, [0, 0.06, 0.08], [0.06, 0.058, 0.06], 6, 9);
  // beak
  {
    const base = [0, 0.052, 0.136], tip = [0, 0.046, 0.168];
    const t = B.v(tip, [0, 0, 1], { aB: [2, 1, 0, 0] });
    const ring = [];
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU + Math.PI / 4;
      const n = [Math.sin(a), Math.cos(a), 0.3];
      ring.push(B.v([base[0] + Math.sin(a) * 0.012, base[1] + Math.cos(a) * 0.01, base[2]], n, { aB: [2, 0, 0, 0] }));
    }
    for (let k = 0; k < 4; k++) B.tri(ring[k], ring[(k + 1) % 4], t);
  }
  // tail: long, narrow, slightly spread fan (both faces)
  {
    const pts = [
      [[-0.022, 0.02, -0.088], [0.022, 0.02, -0.088]],
      [[-0.032, 0.022, -0.2], [0.032, 0.022, -0.2]],
      [[-0.044, 0.016, -0.305], [0.044, 0.016, -0.305]],
    ];
    for (const back of [0, 1]) {
      const ids = pts.map((row, k) => row.map((p) => B.v(p, [0, back ? -1 : 1, 0], { aB: [3, k / 2, 0, back ? -1 : 1] })));
      for (let k = 0; k < 2; k++) {
        const a = ids[k][0], b = ids[k][1], c = ids[k + 1][0], d = ids[k + 1][1];
        if (back) { B.tri(a, c, b); B.tri(b, c, d); } else { B.tri(a, b, c); B.tri(b, d, c); }
      }
    }
  }
  // wings: rounded, five stations from shoulder to tip (both faces)
  const st = [
    [0.0, 0.046, -0.055],
    [0.28, 0.046, -0.078],
    [0.52, 0.038, -0.088],
    [0.74, 0.022, -0.084],
    [0.9, 0.002, -0.068],
    [1.0, -0.024, -0.042],
  ];
  for (const side of [-1, 1]) {
    for (const back of [0, 1]) {
      const ids = st.map(([a, le, te]) => {
        const x = side * (0.065 + a * 0.24);
        const y = 0.03 + a * 0.01;
        return [
          B.v([x, y, le], [0, back ? -1 : 1, 0], { aB: [4, a, 0, side * (back ? 2 : 1)] }),
          B.v([x, y, te], [0, back ? -1 : 1, 0], { aB: [4, a, 1, side * (back ? 2 : 1)] }),
        ];
      });
      for (let k = 0; k < st.length - 1; k++) {
        const a = ids[k][0], b = ids[k][1], c = ids[k + 1][0], d = ids[k + 1][1];
        const flip = (side < 0) !== !!back;
        if (flip) { B.tri(a, b, c); B.tri(b, d, c); } else { B.tri(a, c, b); B.tri(b, c, d); }
      }
    }
  }
  return B.build(true, false);
}

/** Unit quad for sprite impostors (krill sparkles, plankton). */
export function buildQuadGeometry() {
  const g = new InstancedBufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}
