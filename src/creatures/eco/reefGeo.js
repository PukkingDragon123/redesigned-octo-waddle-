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
  const NB = 14;
  for (let k = 0; k < NB; k++) {
    const t = k === NB - 1 ? 1 : 0.1 + (k / (NB - 1)) * 0.86;
    const th = k * 2.4;
    const dx = Math.cos(th), dz = Math.sin(th);
    const crown = k >= NB - 2;
    // bladder at the base of the blade
    const br = crown ? 0.045 : 0.06;
    ellipsoid(m, [dx * 0.1, 0.02, dz * 0.1], [br, br * 1.6, br], 5, 3, (p) => [[2, t, 0, 0], [0, 0, 0, k]]);
    // blade: out and up, then streaming
    const L = crown ? 2.6 : 1.6 + (k % 3) * 0.3;
    const W = crown ? 0.13 : 0.15;
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
    tube(m, pts, rad, 6, (i, t) => [[3, t, k, t > 0.9 ? 1 : 0], [pts[0][0], 0, pts[0][2], h]], false);
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
  const N = 16;
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
    tube(m, pts, rad, 3, (i, t) => [[5, t, a, L], [Math.cos(a) * ring, 0.25, Math.sin(a) * ring, k]], true);
  }
  return m.build();
}

/** A spiral (conical) shell, the planet's signature (aP.y along the whorl). */
export function buildShell() {
  const m = new Mk();
  const pts = [], rad = [];
  const N = 20;
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
  ellipsoid(m, [0, 0.16, 0], [0.22, 0.09, 0.17], 20, 10, (p) => [[10, 0, 0, 0], [0, 0, 0, 0]]);
  for (let side = -1; side <= 1; side += 2) {
    // four jointed walking legs a side: coxa, a long merus up to the knee, carpus and propodus
    // down, and a pointed dactyl; the front legs reach forward, the back ones trail
    for (let k = 0; k < 4; k++) {
      const z = 0.09 - k * 0.07;
      const sw = (1.5 - k) * 0.05;
      const root = [side * 0.19, 0.15, z];
      const coxa = [side * 0.25, 0.2, z + sw * 0.2];
      const knee = [side * 0.41, 0.31, z + sw * 0.8];
      const carp = [side * 0.5, 0.22, z + sw * 1.2];
      const prop = [side * 0.56, 0.1, z + sw * 1.5];
      const foot = [side * 0.6, 0.0, z + sw * 1.7];
      const pts = [root, coxa, [(coxa[0] + knee[0]) / 2, (coxa[1] + knee[1]) / 2 + 0.025, (coxa[2] + knee[2]) / 2], knee, carp, prop, foot];
      tube(m, pts, [0.032, 0.03, 0.031, 0.026, 0.023, 0.017, 0.004], 6, (i, t) => [[11, t, k * 0.75, side], [root[0], root[1], root[2], 0]], true);
      // joint swellings at the knee and the wrist
      ellipsoid(m, knee, [0.034, 0.03, 0.03], 6, 3, () => [[15, 0.5, k * 0.75, side], [root[0], root[1], root[2], 0]]);
      ellipsoid(m, carp, [0.026, 0.024, 0.024], 5, 3, () => [[15, 0.7, k * 0.75, side], [root[0], root[1], root[2], 0]]);
    }
    // claw: arm then a big pincer
    const root = [side * 0.14, 0.17, 0.14];
    const elbow = [side * 0.28, 0.24, 0.3];
    tube(m, [root, elbow, [side * 0.24, 0.22, 0.38]], [0.04, 0.035, 0.035], 7, (i, t) => [[12, t * 0.5, 0, side], [root[0], root[1], root[2], 0]], false);
    ellipsoid(m, [side * 0.22, 0.22, 0.45], [0.07, 0.055, 0.11], 12, 6, () => [[12, 0.8, 1, side], [root[0], root[1], root[2], 0]]);
    // the fixed finger and the moving dactyl of the pincer, slightly gaping
    tube(m, [[side * 0.2, 0.19, 0.5], [side * 0.18, 0.18, 0.6], [side * 0.15, 0.2, 0.66]], [0.03, 0.022, 0.006], 6, () => [[12, 1, 2, side], [root[0], root[1], root[2], 0]], true);
    tube(m, [[side * 0.24, 0.25, 0.5], [side * 0.22, 0.27, 0.59], [side * 0.18, 0.24, 0.65]], [0.026, 0.019, 0.005], 6, () => [[12, 1, 2, side], [root[0], root[1], root[2], 0]], true);
    // eye stalk with a glowing eye
    tube(m, [[side * 0.06, 0.22, 0.13], [side * 0.08, 0.32, 0.16]], [0.015, 0.012], 6, () => [[13, 0.5, 0, side], [0, 0, 0, 0]], false);
    ellipsoid(m, [side * 0.08, 0.34, 0.165], [0.028, 0.028, 0.028], 8, 5, () => [[13, 1, 1, side], [0, 0, 0, 0]]);
    // antennae: two thin whips between the eyes
    tube(m, [[side * 0.03, 0.2, 0.17], [side * 0.06, 0.3, 0.3], [side * 0.11, 0.33, 0.42]], [0.006, 0.004, 0.0015], 3, () => [[13, 0.5, 0, side], [0, 0, 0, 0]], true);
  }
  // hermit's spiral shell (hidden by the shader on other species)
  const pts = [], rad = [];
  for (let i = 0; i < 30; i++) {
    const t = i / 29;
    const th = t * 2.6 * TAU;
    const R = 0.02 + 0.16 * t * t;
    pts.push([Math.cos(th) * R, 0.62 - t * 0.38, -0.08 + Math.sin(th) * R]);
    rad.push(0.015 + 0.18 * Math.pow(t, 1.5));
  }
  tube(m, pts, rad, 12, (i, t) => [[14, t, 0, 0], [0, 0, 0, 0]], false);
  return m.build();
}

/**
 * Jelly: a translucent bell (part 20, aP.y 0 apex .. 1 rim), inner glowing organs (21), frilled
 * oral arms (22) and long trailing tentacles (23, aP.y along, aP.z index). Rim at y = 0, 1 m wide.
 */
export function buildJelly() {
  const m = new Mk();
  // the bell: an outer exumbrella and, a little inside it, the subumbrella (layered, translucent)
  ellipsoid(m, [0, 0, 0], [0.5, 0.42, 0.5], 32, 12, (p, n, u, v) => [[20, 1 - (v - 0.5) * 2, u, 0], [0, 0, 0, 0]], 0.5, 1);
  ellipsoid(m, [0, -0.02, 0], [0.44, 0.34, 0.44], 24, 8, (p, n, u, v) => [[20, (1 - (v - 0.5) * 2) * 0.92, u, 0], [0, 0, 0, 0]], 0.5, 1);
  ellipsoid(m, [0, 0.12, 0], [0.18, 0.14, 0.18], 14, 7, (p, n, u, v) => [[21, 0.5, u, v], [0, 0, 0, 0]]);
  // frilled oral arms: ruffled, twisting curtains
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + 0.4;
    const pts = [], rad = [];
    for (let i = 0; i < 12; i++) {
      const t = i / 11, tw = a + t * 2.2;
      pts.push([Math.cos(a) * 0.08 + Math.cos(tw) * 0.03 * t, -t * 1.1, Math.sin(a) * 0.08 + Math.sin(tw) * 0.03 * t]);
      rad.push(0.065 * (1 - t * 0.6) * (1 + 0.25 * Math.sin(t * 19)));
    }
    tube(m, pts, rad, 6, (i, t) => [[22, t, a, 0], [0, 0, 0, 0]], true, 0.35);
  }
  // marginal tentacles: long and fine, two lengths alternating round the rim
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * TAU;
    const L = k % 2 ? 2.0 : 2.8;
    const pts = [], rad = [];
    for (let i = 0; i < 14; i++) { const t = i / 13; pts.push([Math.cos(a) * 0.46, -t * L, Math.sin(a) * 0.46]); rad.push(0.011 * (1 - t * 0.7)); }
    tube(m, pts, rad, 3, (i, t) => [[23, t, a, k * 10 / 16], [0, 0, 0, 0]], true);
  }
  return m.build();
}

/**
 * Manta (KIND 7). Span 2 (x -1..1, halfspan 1), facing +z, the terminal mouth at z ~ +0.47.
 * One lofted body that blends into the pectoral wings (part 30): every spanwise station is a closed
 * airfoil loop (thick rounded leading edge thinning to a fine trailing edge; the body a thick
 * central disc). aP.y = chord v (0 leading edge .. 1 trailing edge), aP.z = span u (signed),
 * aP.w = topness (sin of the loop angle: -1 belly .. +1 back); aQ.x = half thickness there.
 * Cephalic lobes (31: aP.y along, aP.z across 0..1, aP.w side; posed and curled in the shader),
 * whip tail (32, aP.y along), eyes (33, aP.w side, aQ centre), dorsal fin (34), pelvic fins (35).
 * lod 1 is the far mesh (coarse loft, no eyes or fins).
 */
const mSmooth = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
/** Planform: leading and trailing edge z at |x| = u (mirrored in reefMat.js). */
export function mantaLE(u) { return u < 0.2 ? 0.47 - 0.09 * mSmooth((u - 0.08) / 0.12) : 0.38 - 0.6 * Math.pow((u - 0.2) / 0.8, 1.45); }
export function mantaTE(u) { return -0.45 + 0.23 * u + 0.17 * Math.sin(Math.PI * Math.pow(u, 0.8)) * mSmooth(u / 0.35); }
function mantaHalf(u, v) {
  // body: a thick central disc, blunt at the head and the tail root
  const tb = 0.085 * Math.exp(-((u / 0.19) ** 2));
  const vb = Math.pow(Math.max(v, 0), 0.85);
  const pb = Math.pow(Math.max(4 * vb * (1 - vb), 0), 0.42);
  // wings: an airfoil (thick muscular leading edge, fine trailing edge), thinning to the tips
  const tw = 0.042 * Math.pow(Math.max(1 - u, 0), 1.15) + 0.0025;
  const vv = Math.max(v, 0);
  const pw = Math.max(0, 10 * (0.2969 * Math.sqrt(vv) - 0.126 * vv - 0.3516 * vv * vv + 0.2843 * vv ** 3 - 0.1015 * vv ** 4));
  return [tb * pb + tw * pw, 0.55 * tb * pb + 0.8 * tw * pw];
}
function mantaPoint(x, th) {
  const u = Math.min(Math.abs(x), 1);
  const zl = mantaLE(u), zt = mantaTE(u);
  const v = (1 - Math.cos(th)) * 0.5;
  const s = Math.sin(th);
  const [top, bot] = mantaHalf(u, v);
  // a slight droop toward the tips; the belly flatter than the back
  const yc = -0.035 * u * u;
  const y = yc + (s >= 0 ? top : -bot) * Math.pow(Math.abs(s), 0.15);
  return [x, y, zl + (zt - zl) * v];
}
export function buildRay(lod = 0) {
  const m = new Mk();
  const far = lod > 0;
  const NU = far ? 22 : 46, M = far ? 12 : 26;
  const base = m.count;
  for (let i = 0; i <= NU; i++) {
    const w = (i / NU) * 2 - 1;
    const x = Math.sign(w) * Math.pow(Math.abs(w), 1.1);
    const u = Math.abs(x);
    const xn = Math.sign(x || 1) * Math.min(u, 0.985); // normals: avoid the zero-chord tip
    for (let k = 0; k < M; k++) {
      const th = (k / M) * TAU;
      const P = mantaPoint(x, th);
      const e = 1e-3;
      const a0 = mantaPoint(xn, th - e), a1 = mantaPoint(xn, th + e);
      const b0 = mantaPoint(xn - e, th), b1 = mantaPoint(xn + e, th);
      let n = norm(cross(sub(a1, a0), sub(b1, b0)));
      // outward: away from the chord line
      const Pn = mantaPoint(xn, th);
      const zm = (mantaLE(Math.abs(xn)) + mantaTE(Math.abs(xn))) * 0.5;
      const out = [0, Pn[1] + 0.035 * xn * xn, Pn[2] - zm];
      if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) n = [-n[0], -n[1], -n[2]];
      const v = (1 - Math.cos(th)) * 0.5;
      const [top, bot] = mantaHalf(u, v);
      m.v(P, n, [30, v, x, Math.sin(th)], [Math.sin(th) >= 0 ? top : bot, k / M, 0, 0]);
    }
  }
  for (let i = 0; i < NU; i++) for (let k = 0; k < M; k++) {
    const k1 = (k + 1) % M;
    const a = base + i * M + k, b = base + i * M + k1, c = base + (i + 1) * M + k1, d = base + (i + 1) * M + k;
    m.quad(a, d, c, b);
  }
  // cephalic lobes: flat sheets the shader rolls into horns (cruising) or unfurls (feeding)
  for (let side = -1; side <= 1; side += 2) {
    const NA = far ? 3 : 7, NC = far ? 2 : 6;
    const lb = m.count;
    for (let i = 0; i <= NA; i++) for (let j = 0; j <= NC; j++) {
      const t = i / NA, c = j / NC;
      m.v([side * 0.125, -0.01 - c * 0.06, 0.455 + t * 0.19], [side, 0, 0], [31, t, c, side], [side * 0.125, -0.005, 0.455, 0]);
    }
    for (let i = 0; i < NA; i++) for (let j = 0; j < NC; j++) {
      const a = lb + i * (NC + 1) + j, b = a + NC + 1;
      if (side > 0) m.quad(a, b, b + 1, a + 1); else m.quad(a, a + 1, b + 1, b);
    }
  }
  // the whip tail
  {
    const pts = [], rad = [];
    const N = far ? 6 : 14;
    for (let i = 0; i < N; i++) { const t = i / (N - 1); pts.push([0, 0.004 + 0.01 * t, -0.42 - t * 0.95]); rad.push(0.03 * Math.pow(1 - t, 1.4) + 0.0025); }
    tube(m, pts, rad, far ? 3 : 6, (i, t) => [[32, t, 0, 0], [0, 0, 0, 0]], true);
  }
  if (far) return m.build();
  // eyes on the sides of the head, just above where the pectoral leading edge begins
  for (let side = -1; side <= 1; side += 2) {
    const c = [side * 0.19, 0.012, 0.36];
    ellipsoid(m, c, [0.024, 0.02, 0.026], 10, 6, (p, n) => [[33, 0, 0, side], [c[0], c[1], c[2], 0]]);
  }
  // a small swept dorsal fin at the tail root, and the pelvic fins either side of it
  {
    const th = 0.007;
    const outline = [[0, -0.33], [0.012, -0.36], [0.05, -0.43], [0.06, -0.47], [0.02, -0.45], [0, -0.44]];
    const yb = 0.035;
    for (let s = -1; s <= 1; s += 2) {
      const fb = m.count;
      for (const [h, z] of outline) m.v([s * th * (1 - h / 0.07), yb + h, z], [s, 0.25, 0], [34, h / 0.06, 0, s], [0, 0, 0, 0]);
      for (let i = 1; i < outline.length - 1; i++) if (s > 0) m.tri(fb, fb + i, fb + i + 1); else m.tri(fb, fb + i + 1, fb + i);
    }
    for (let side = -1; side <= 1; side += 2) {
      tube(m, [[side * 0.045, -0.012, -0.36], [side * 0.075, -0.016, -0.42], [side * 0.07, -0.016, -0.47]], [0.02, 0.016, 0.003], 5, (i, t) => [[35, t, 0, side], [0, 0, 0, 0]], true, 0.35);
    }
  }
  return m.build();
}

/** Lantern puffer: round body (40), lantern eyes (41), little fins and tail (42), spines (43). */
export function buildPuffer() {
  const m = new Mk();
  ellipsoid(m, [0, 0, 0], [0.2, 0.18, 0.26], 22, 13, (p, n, u, v) => [[40, (p[2] + 0.26) / 0.52, u, v], [0, 0, 0, 0]]);
  for (let side = -1; side <= 1; side += 2) {
    ellipsoid(m, [side * 0.13, 0.08, 0.14], [0.075, 0.075, 0.075], 10, 7, (p, n) => [[41, 0, side, n[2]], [0, 0, 0, 0]]);
    tube(m, [[side * 0.17, -0.02, 0.02], [side * 0.22, -0.025, -0.01], [side * 0.27, -0.03, -0.04]], [0.05, 0.035, 0.01], 5, () => [[42, 0.5, side, 1], [side * 0.17, -0.02, 0.02, 0]], true, 0.3);
  }
  tube(m, [[0, 0, -0.24], [0, 0.0, -0.3], [0, 0.0, -0.36], [0, 0.0, -0.42]], [0.04, 0.065, 0.08, 0.09], 6, (i, t) => [[42, t, 0, 0], [0, 0, -0.24, 0]], false, 0.25);
  // spines over the body (folded flat until the puffer inflates)
  for (let k = 0; k < 44; k++) {
    const y = 1 - (k + 0.5) / 44 * 2, r = Math.sqrt(1 - y * y), th = k * 2.39996;
    const n = [Math.cos(th) * r, y, Math.sin(th) * r];
    const p = [n[0] * 0.19, n[1] * 0.17, n[2] * 0.25];
    tube(m, [p, [p[0] + n[0] * 0.09, p[1] + n[1] * 0.09, p[2] + n[2] * 0.09]], [0.012, 0.002], 3, (i, t) => [[43, t, 0, 0], [p[0], p[1], p[2], 0]], true);
  }
  return m.build();
}

/** Ribbon eel: a flat ribbon body (50, aP.y nose 0 .. tail 1) with a dorsal frill, 1 m long. */
export function buildEel() {
  const m = new Mk();
  const N = 40;
  const pts = [], rad = [];
  for (let i = 0; i < N; i++) { const t = i / (N - 1); pts.push([0, 0, 0.5 - t]); rad.push(0.035 * Math.sin(Math.min(1, t * 1.2 + 0.15) * Math.PI) + 0.004); }
  tube(m, pts, rad, 8, (i, t) => [[50, t, 0, 0], [0, 0, 0, 0]], true, 0.55);
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
