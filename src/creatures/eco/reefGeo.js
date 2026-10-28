// Procedural meshes for the reef life of Vur Sok (kelp, tube corals, anemones, spiral shells, sea
// fans, crabs, jellies, rays, lantern puffers and ribbon eels). Every mesh carries two per-vertex
// vec4 attributes the vertex shaders animate with (no bones):
//   aP: x part id, y position along the organism (0 root .. 1 tip), z/w part-specific parameters
//   aQ: a hinge / attachment point (local metres) and one more parameter
// Geometry is built once at construction; reefMat.js poses it per instance.
import { InstancedBufferGeometry, Float32BufferAttribute, Uint32BufferAttribute } from 'three';

const TAU = Math.PI * 2;

class Mk {
  constructor() { this.p = []; this.n = []; this.a = []; this.q = []; this.i = []; }
  get count() { return this.p.length / 3; }
  v(p, n, a, q) {
    this.p.push(p[0], p[1], p[2]);
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    this.n.push(n[0] / l, n[1] / l, n[2] / l);
    this.a.push(a[0], a[1], a[2] ?? 0, a[3] ?? 0);
    this.q.push(q ? q[0] : 0, q ? q[1] : 0, q ? q[2] : 0, q ? (q[3] ?? 0) : 0);
    return this.count - 1;
  }
  tri(a, b, c) { this.i.push(a, b, c); }
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  build() {
    const g = new InstancedBufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.n, 3));
    g.setAttribute('aP', new Float32BufferAttribute(this.a, 4));
    g.setAttribute('aQ', new Float32BufferAttribute(this.q, 4));
    g.setIndex(new Uint32BufferAttribute(this.i, 1));
    g.instanceCount = 0;
    return g;
  }
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/**
 * A generalized cylinder along a polyline (parallel-transport frames).
 * attr(i, k) => [aP, aQ] for ring i (k = i / (n - 1)). capEnd closes the last ring to a point.
 */
function tube(m, pts, radii, sides, attr, capEnd = true, flat = 1) {
  const n = pts.length;
  let T = norm(sub(pts[1], pts[0]));
  let U = Math.abs(T[1]) < 0.9 ? norm(cross(T, [0, 1, 0])) : norm(cross(T, [1, 0, 0]));
  const rings = [];
  for (let i = 0; i < n; i++) {
    const Tn = norm(sub(pts[Math.min(i + 1, n - 1)], pts[Math.max(i - 1, 0)]));
    // transport U onto the plane normal to Tn
    const d = U[0] * Tn[0] + U[1] * Tn[1] + U[2] * Tn[2];
    U = norm([U[0] - Tn[0] * d, U[1] - Tn[1] * d, U[2] - Tn[2] * d]);
    T = Tn;
    const W = cross(T, U);
    const [a, q] = attr(i, i / (n - 1));
    const ring = [];
    for (let s = 0; s < sides; s++) {
      const th = (s / sides) * TAU;
      const c = Math.cos(th), sn = Math.sin(th) * flat;
      const nn = [U[0] * c + W[0] * sn, U[1] * c + W[1] * sn, U[2] * c + W[2] * sn];
      const r = radii[i];
      ring.push(m.v([pts[i][0] + nn[0] * r, pts[i][1] + nn[1] * r, pts[i][2] + nn[2] * r], nn, a, q));
    }
    rings.push(ring);
  }
  for (let i = 0; i < n - 1; i++) {
    for (let s = 0; s < sides; s++) {
      const s1 = (s + 1) % sides;
      m.quad(rings[i][s], rings[i + 1][s], rings[i + 1][s1], rings[i][s1]);
    }
  }
  if (capEnd) {
    const [a, q] = attr(n - 1, 1);
    const tip = m.v(pts[n - 1], T, a, q);
    for (let s = 0; s < sides; s++) m.tri(rings[n - 1][s], tip, rings[n - 1][(s + 1) % sides]);
  }
}

/** Ellipsoid (latitudes v0..v1 of 0 bottom .. 1 top). attr(p, n, u, v) => [aP, aQ]. */
function ellipsoid(m, c, r, nu, nv, attr, v0 = 0, v1 = 1) {
  const base = m.count;
  for (let j = 0; j <= nv; j++) {
    const v = v0 + (v1 - v0) * (j / nv);
    const ph = (v - 0.5) * Math.PI;
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const th = u * TAU;
      const nx = Math.cos(ph) * Math.cos(th), ny = Math.sin(ph), nz = Math.cos(ph) * Math.sin(th);
      const p = [c[0] + nx * r[0], c[1] + ny * r[1], c[2] + nz * r[2]];
      const [a, q] = attr(p, [nx / r[0], ny / r[1], nz / r[2]], u, v);
      m.v(p, [nx / r[0], ny / r[1], nz / r[2]], a, q);
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = base + j * (nu + 1) + i, b = a + nu + 1;
      m.quad(a, a + 1, b + 1, b);
    }
  }
}

// ---------------------------------------------------------------------------------------------
/**
 * Kelp: a stalk of normalized height (aP.y = t, the shader multiplies by the instance height),
 * gas bladders and long ruffled blades at alternating nodes, a streaming crown.
 * parts: 0 stalk (position = ring offset), 1 blade (position = offset from its node at t = aP.y,
 * aP.z = along blade 0..1, aP.w = across -1..1), 2 bladder (offset from its node).
 */
export function buildKelp() {
  const m = new Mk();
  const NS = 11;
  const pts = [], rad = [];
  for (let i = 0; i < NS; i++) { pts.push([0, 0, 0]); rad.push(0.07 - 0.035 * (i / (NS - 1))); }
  // stalk rings stay at y = 0: the shader places each ring at t * H on the bent spine
  {
    const sides = 4, base = m.count;
    for (let i = 0; i < NS; i++) {
      const t = i / (NS - 1);
      for (let s = 0; s < sides; s++) {
        const th = (s / sides) * TAU + 0.4;
        const c = Math.cos(th), sn = Math.sin(th);
        m.v([c * rad[i], 0, sn * rad[i]], [c, 0, sn], [0, t, 0, 0]);
      }
    }
    for (let i = 0; i < NS - 1; i++) for (let s = 0; s < sides; s++) {
      const s1 = (s + 1) % sides;
      m.quad(base + i * sides + s, base + i * sides + s1, base + (i + 1) * sides + s1, base + (i + 1) * sides + s);
    }
  }
  const NB = 12;
  for (let k = 0; k < NB; k++) {
    const t = k === NB - 1 ? 1 : 0.1 + (k / (NB - 1)) * 0.86;
    const th = k * 2.4;
    const dx = Math.cos(th), dz = Math.sin(th);
    const crown = k >= NB - 2;
    // bladder at the base of the blade
    const br = crown ? 0.07 : 0.1;
    ellipsoid(m, [dx * 0.12, 0.02, dz * 0.12], [br, br * 1.35, br], 5, 3, (p) => [[2, t, 0, 0], [0, 0, 0, k]]);
    // blade: out and up, then streaming
    const L = crown ? 2.2 : 1.25 + (k % 3) * 0.2;
    const W = crown ? 0.16 : 0.2;
    const NA = 7;
    const base = m.count;
    for (let i = 0; i <= NA; i++) {
      const u = i / NA;
      const out = 0.16 + u * L * 0.55, up = 0.1 + u * L * 0.8;
      const ruffle = Math.sin(u * 14) * 0.04 * u;
      const w = W * Math.sin(Math.min(u * 1.15 + 0.08, 1) * Math.PI) * (1 - u * 0.25) + 0.02;
      for (let j = -1; j <= 1; j += 2) {
        const sx = -dz * w * j, sz = dx * w * j;
        m.v([dx * out + sx, up + ruffle * j, dz * out + sz], [dx * 0.3, -0.2, dz * 0.3].map((v, a) => v + [ -dz, 0.4, dx][a] * 0.8), [1, t, u, j], [dx, 0, dz, k]);
      }
    }
    for (let i = 0; i < NA; i++) m.quad(base + i * 2, base + i * 2 + 1, base + i * 2 + 3, base + i * 2 + 2);
  }
  return m.build();
}

/** Tube coral cluster: 6 flared tubes (aP.y along, aP.z tube index, aP.w 1 at the glowing lip). */
export function buildTubes() {
  const m = new Mk();
  const N = 7;
  for (let k = 0; k < N; k++) {
    const a = k * 2.39 + 0.3, r0 = k === 0 ? 0 : 0.18 + 0.1 * (k % 3);
    const h = 0.55 + ((k * 37) % 7) * 0.12;
    const lean = 0.18 * (k === 0 ? 0 : 1);
    const pts = [], rad = [];
    const NS = 6;
    for (let i = 0; i < NS; i++) {
      const t = i / (NS - 1);
      const rr = r0 + lean * t * t;
      pts.push([Math.cos(a) * rr, t * h, Math.sin(a) * rr]);
      rad.push(0.07 + 0.02 * Math.sin(t * 3) + (t > 0.85 ? 0.05 * (t - 0.85) / 0.15 : 0));
    }
    tube(m, pts, rad, 7, (i, t) => [[3, t, k, t > 0.9 ? 1 : 0], [pts[0][0], 0, pts[0][2], h]], false);
    // the dark inner throat: a disc just inside the lip
    const top = pts[NS - 1], c = m.v([top[0], top[1] - 0.02, top[2]], [0, 1, 0], [3, 1, k, 2], [pts[0][0], 0, pts[0][2], h]);
    const ring = [];
    for (let s = 0; s < 7; s++) {
      const th = (s / 7) * TAU;
      ring.push(m.v([top[0] + Math.cos(th) * rad[NS - 1] * 0.92, top[1] - 0.01, top[2] + Math.sin(th) * rad[NS - 1] * 0.92], [0, 1, 0], [3, 1, k, 2], [pts[0][0], 0, pts[0][2], h]));
    }
    for (let s = 0; s < 7; s++) m.tri(c, ring[(s + 1) % 7], ring[s]);
  }
  return m.build();
}

/** Anemone: a squat column with a ring of long tentacles (aP.y along tentacle, aP.z angle). */
export function buildAnemone() {
  const m = new Mk();
  ellipsoid(m, [0, 0.12, 0], [0.22, 0.16, 0.22], 9, 4, (p) => [[4, 0, 0, 0], [0, 0, 0, 0]], 0.25, 1);
  const N = 22;
  for (let k = 0; k < N; k++) {
    const a = (k / N) * TAU, ring = k % 2 ? 0.2 : 0.13;
    const L = (k % 2 ? 0.55 : 0.42) + ((k * 13) % 5) * 0.03;
    const pts = [], rad = [];
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const out = ring + t * L * 0.55, up = 0.25 + t * L * 0.85;
      pts.push([Math.cos(a) * out, up, Math.sin(a) * out]);
      rad.push(0.028 * (1 - t * 0.7));
    }
    tube(m, pts, rad, 4, (i, t) => [[5, t, a, L], [Math.cos(a) * ring, 0.25, Math.sin(a) * ring, k]], true);
  }
  return m.build();
}

/** A spiral (conical) shell, the planet's signature (aP.y along the whorl). */
export function buildShell() {
  const m = new Mk();
  const pts = [], rad = [];
  const N = 26;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const th = t * 3.4 * TAU;
    const R = 0.02 + 0.2 * t * t;
    pts.push([Math.cos(th) * R, 0.45 - t * 0.4 - t * t * 0.02, Math.sin(th) * R]);
    rad.push(0.012 + 0.16 * Math.pow(t, 1.6));
  }
  tube(m, pts, rad, 7, (i, t) => [[6, t, 0, 0], [0, 0, 0, 0]], false);
  return m.build();
}

/** Sea fan: a flat fan of veins drawn in the fragment shader (aP.zw = fan uv). */
export function buildFan() {
  const m = new Mk();
  const NU = 6, NV = 4;
  const base = m.count;
  for (let j = 0; j <= NV; j++) {
    const v = j / NV;
    for (let i = 0; i <= NU; i++) {
      const u = i / NU;
      const a = (u - 0.5) * 2.2;
      const r = 0.08 + v * 1.0;
      m.v([Math.sin(a) * r, Math.cos(a) * r * 0.95, Math.sin(u * 7 + v * 3) * 0.04 * v], [0, 0, 1], [7, v, u, v], [0, 0, 0, 0]);
    }
  }
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
    const a = base + j * (NU + 1) + i, b = a + NU + 1;
    m.quad(a, a + 1, b + 1, b);
  }
  return m.build();
}

// ---------------------------------------------------------------------------------------------
/**
 * Crab (one mesh, three species by instance variant): a plated body (part 10), 6 legs (11:
 * aP.y along leg, aP.z leg index 0-2, aP.w side; aQ hinge), two claws (12: aP.z 0 arm 1 pincer,
 * aP.w side, aQ hinge), eye stalks (13), a spiral shell on the back (14, hermits only), glowing
 * joint beads (15). Faces +z, about 0.5 m across.
 */
export function buildCrab() {
  const m = new Mk();
  ellipsoid(m, [0, 0.16, 0], [0.22, 0.09, 0.17], 10, 5, (p) => [[10, 0, 0, 0], [0, 0, 0, 0]]);
  for (let side = -1; side <= 1; side += 2) {
    for (let k = 0; k < 3; k++) {
      const z = 0.08 - k * 0.09;
      const root = [side * 0.19, 0.15, z];
      const knee = [side * 0.42, 0.3, z + (1 - k) * 0.06];
      const foot = [side * 0.6, 0.0, z + (1 - k) * 0.12];
      const pts = [root, [(root[0] + knee[0]) / 2, (root[1] + knee[1]) / 2 + 0.03, (root[2] + knee[2]) / 2], knee, [(knee[0] + foot[0]) / 2, (knee[1] + foot[1]) / 2, (knee[2] + foot[2]) / 2], foot];
      tube(m, pts, [0.03, 0.028, 0.026, 0.02, 0.008], 4, (i, t) => [[11, t, k, side], [root[0], root[1], root[2], 0]], true);
      ellipsoid(m, knee, [0.035, 0.035, 0.035], 4, 2, () => [[15, 0.5, k, side], [root[0], root[1], root[2], 0]]);
    }
    // claw: arm then a big pincer
    const root = [side * 0.14, 0.17, 0.14];
    const elbow = [side * 0.28, 0.24, 0.3];
    tube(m, [root, elbow, [side * 0.24, 0.22, 0.38]], [0.04, 0.035, 0.035], 5, (i, t) => [[12, t * 0.5, 0, side], [root[0], root[1], root[2], 0]], false);
    ellipsoid(m, [side * 0.22, 0.22, 0.45], [0.07, 0.055, 0.11], 6, 3, () => [[12, 0.8, 1, side], [root[0], root[1], root[2], 0]]);
    tube(m, [[side * 0.2, 0.19, 0.5], [side * 0.18, 0.18, 0.6], [side * 0.15, 0.2, 0.66]], [0.03, 0.022, 0.006], 4, () => [[12, 1, 2, side], [root[0], root[1], root[2], 0]], true);
    // eye stalk with a glowing eye
    tube(m, [[side * 0.06, 0.22, 0.13], [side * 0.08, 0.32, 0.16]], [0.015, 0.012], 4, () => [[13, 0.5, 0, side], [0, 0, 0, 0]], false);
    ellipsoid(m, [side * 0.08, 0.34, 0.165], [0.028, 0.028, 0.028], 5, 3, () => [[13, 1, 1, side], [0, 0, 0, 0]]);
  }
  // hermit's spiral shell (hidden by the shader on other species)
  const pts = [], rad = [];
  for (let i = 0; i < 18; i++) {
    const t = i / 17;
    const th = t * 2.6 * TAU;
    const R = 0.02 + 0.16 * t * t;
    pts.push([Math.cos(th) * R, 0.62 - t * 0.38, -0.08 + Math.sin(th) * R]);
    rad.push(0.015 + 0.18 * Math.pow(t, 1.5));
  }
  tube(m, pts, rad, 7, (i, t) => [[14, t, 0, 0], [0, 0, 0, 0]], false);
  return m.build();
}

/**
 * Jelly: a translucent bell (part 20, aP.y 0 apex .. 1 rim), inner glowing organs (21), frilled
 * oral arms (22) and long trailing tentacles (23, aP.y along, aP.z index). Rim at y = 0, 1 m wide.
 */
export function buildJelly() {
  const m = new Mk();
  ellipsoid(m, [0, 0, 0], [0.5, 0.42, 0.5], 14, 6, (p, n, u, v) => [[20, 1 - (v - 0.5) * 2, u, 0], [0, 0, 0, 0]], 0.5, 1);
  ellipsoid(m, [0, 0.12, 0], [0.18, 0.14, 0.18], 8, 4, (p, n, u, v) => [[21, 0.5, u, v], [0, 0, 0, 0]]);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + 0.4;
    const pts = [], rad = [];
    for (let i = 0; i < 6; i++) { const t = i / 5; pts.push([Math.cos(a) * 0.08, -t * 1.0, Math.sin(a) * 0.08]); rad.push(0.06 * (1 - t * 0.6)); }
    tube(m, pts, rad, 4, (i, t) => [[22, t, a, 0], [0, 0, 0, 0]], true, 0.35);
  }
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * TAU;
    const pts = [], rad = [];
    for (let i = 0; i < 9; i++) { const t = i / 8; pts.push([Math.cos(a) * 0.45, -t * 2.6, Math.sin(a) * 0.45]); rad.push(0.012 * (1 - t * 0.6)); }
    tube(m, pts, rad, 3, (i, t) => [[23, t, a, k], [0, 0, 0, 0]], true);
  }
  return m.build();
}

/**
 * Ray: a flat diamond body with thick centre (part 30: aP.z = x / halfspan signed, aP.y = along
 * nose 0 .. tail 1, aP.w top 1 / bottom -1), cephalic horns (31) and a whip tail (32). Span 2 m
 * (x -1..1), facing +z.
 */
export function buildRay() {
  const m = new Mk();
  const NU = 12, NV = 8;
  for (let face = 1; face >= -1; face -= 2) {
    const base = m.count;
    for (let j = 0; j <= NV; j++) {
      const v = j / NV; // nose (0) to tail root (1)
      const z = 0.55 - v * 1.1;
      // half span at this z: widest a little behind the head, swept wings
      const half = Math.sin(Math.min(1, v * 1.35) * Math.PI) * 1.0 * (1 - 0.15 * v) + 0.12 * (1 - v);
      for (let i = 0; i <= NU; i++) {
        const u = (i / NU) * 2 - 1;
        // wing tips sweep back
        const x = u * half;
        const zz = z - Math.pow(Math.abs(u), 2) * 0.35 * Math.sin(v * Math.PI);
        const thick = 0.11 * (1 - u * u) * Math.sin(Math.min(1, v * 1.3 + 0.1) * Math.PI) + 0.008;
        m.v([x, face * thick, zz], [0, face, 0], [30, v, u, face], [0, 0, 0, 0]);
      }
    }
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
      const a = base + j * (NU + 1) + i, b = a + NU + 1;
      if (face > 0) m.quad(a, b, b + 1, a + 1); else m.quad(a, a + 1, b + 1, b);
    }
  }
  for (let side = -1; side <= 1; side += 2) {
    tube(m, [[side * 0.14, 0, 0.5], [side * 0.17, -0.02, 0.68], [side * 0.12, -0.06, 0.8]], [0.05, 0.04, 0.012], 4, (i, t) => [[31, t, side, 0], [0, 0, 0, 0]], true, 0.5);
  }
  const pts = [], rad = [];
  for (let i = 0; i < 9; i++) { const t = i / 8; pts.push([0, 0, -0.5 - t * 1.6]); rad.push(0.04 * (1 - t * 0.85)); }
  tube(m, pts, rad, 4, (i, t) => [[32, t, 0, 0], [0, 0, 0, 0]], true);
  return m.build();
}

/** Lantern puffer: round body (40), lantern eyes (41), little fins and tail (42), spines (43). */
export function buildPuffer() {
  const m = new Mk();
  ellipsoid(m, [0, 0, 0], [0.2, 0.18, 0.26], 12, 7, (p, n, u, v) => [[40, (p[2] + 0.26) / 0.52, u, v], [0, 0, 0, 0]]);
  for (let side = -1; side <= 1; side += 2) {
    ellipsoid(m, [side * 0.13, 0.08, 0.14], [0.075, 0.075, 0.075], 6, 4, (p, n) => [[41, 0, side, n[2]], [0, 0, 0, 0]]);
    tube(m, [[side * 0.17, -0.02, 0.02], [side * 0.27, -0.03, -0.04]], [0.05, 0.01], 3, () => [[42, 0.5, side, 1], [side * 0.17, -0.02, 0.02, 0]], true, 0.3);
  }
  tube(m, [[0, 0, -0.24], [0, 0.0, -0.36], [0, 0.0, -0.42]], [0.04, 0.08, 0.09], 4, (i, t) => [[42, t, 0, 0], [0, 0, -0.24, 0]], false, 0.25);
  // spines over the body (folded flat until the puffer inflates)
  for (let k = 0; k < 26; k++) {
    const y = 1 - (k + 0.5) / 26 * 2, r = Math.sqrt(1 - y * y), th = k * 2.39996;
    const n = [Math.cos(th) * r, y, Math.sin(th) * r];
    const p = [n[0] * 0.19, n[1] * 0.17, n[2] * 0.25];
    tube(m, [p, [p[0] + n[0] * 0.09, p[1] + n[1] * 0.09, p[2] + n[2] * 0.09]], [0.012, 0.002], 3, (i, t) => [[43, t, 0, 0], [p[0], p[1], p[2], 0]], true);
  }
  return m.build();
}

/** Ribbon eel: a flat ribbon body (50, aP.y nose 0 .. tail 1) with a dorsal frill, 1 m long. */
export function buildEel() {
  const m = new Mk();
  const N = 22;
  const pts = [], rad = [];
  for (let i = 0; i < N; i++) { const t = i / (N - 1); pts.push([0, 0, 0.5 - t]); rad.push(0.035 * Math.sin(Math.min(1, t * 1.2 + 0.15) * Math.PI) + 0.004); }
  tube(m, pts, rad, 5, (i, t) => [[50, t, 0, 0], [0, 0, 0, 0]], true, 0.55);
  // the frill: a ribbon along the back and belly
  for (let s = -1; s <= 1; s += 2) {
    const base = m.count;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const h = 0.07 * Math.sin(Math.min(1, t * 1.1 + 0.05) * Math.PI);
      m.v([0, s * rad[i] * 0.6, 0.5 - t], [1, 0, 0], [51, t, 0, s], [0, 0, 0, 0]);
      m.v([0, s * (rad[i] * 0.6 + h), 0.5 - t], [1, 0, 0], [51, t, 1, s], [0, 0, 0, 0]);
    }
    for (let i = 0; i < N - 1; i++) m.quad(base + i * 2, base + i * 2 + 2, base + i * 2 + 3, base + i * 2 + 1);
  }
  return m.build();
}

export function triCount(g) { return (g.index ? g.index.count : g.attributes.position.count) / 3; }
