// Procedural meshes for the reef life of Vur Sok (kelp, tube corals, anemones, spiral shells, sea
// fans, jellies, rays, lantern puffers and ribbon eels). Every mesh carries two per-vertex
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
  for (let i = 0; i < NS; i++) { pts.push([0, 0, 0]); rad.push(0.1 - 0.05 * (i / (NS - 1))); }
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
  // a lush frond: many long, broad ribbon blades streaming up the stipe (not leaves on a stick);
  // every other blade carries a gas bladder (keeps the triangle count near what it was)
  const NB = 24;
  for (let k = 0; k < NB; k++) {
    const t = k === NB - 1 ? 1 : 0.06 + (k / (NB - 1)) * 0.9;
    const th = k * 2.4;
    const dx = Math.cos(th), dz = Math.sin(th);
    const crown = k >= NB - 3;
    // bladder at the base of the blade
    const br = crown ? 0.05 : 0.07;
    if (k % 2 === 0 || crown) ellipsoid(m, [dx * 0.1, 0.02, dz * 0.1], [br, br * 1.6, br], 5, 3, (p) => [[2, t, 0, 0], [0, 0, 0, k]]);
    // blade: out and up, then streaming
    const L = crown ? 3.4 : 2.3 + (k % 3) * 0.45;
    const W = crown ? 0.22 : 0.27 + (k % 2) * 0.05;
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
 * Jelly (KIND 6): three alien species share this one mesh and the vertex shader shapes it per
 * species (reefMat.js jBell): a tall ribbed lantern, a low crown of five drooping lobes, and a
 * spired bell with a second bell nested inside it. Rim radius 0.5 at y = 0, apex up.
 * Parts: 20 bell (aP.y v 0 apex .. 1 rim, aP.z u round 0..1, aP.w layer 0 outer / 1 inner),
 * 21 gastric organ and gonads, 22 oral curtains (aP.y along, aP.z arm angle, aP.w across -1..1;
 * the normal is the sheet normal), 23 tentacles (aP.y along, aP.z root angle, aP.w 1 hunting),
 * 24 rim lens-eyes (aP.zw eye plane, aQ.x angle), 25 velum frill (aP.y across, aP.z u),
 * 27 organ cage ribs (aP.y along, aP.z rib), 28 barbs and hooks on the hunting tentacles
 * (aP.y = t on the tentacle, aP.z root angle, aP.w length; aQ.xyz offset from the axis there).
 * Tentacles, barbs and eyes are built at rest positions; the shader re-attaches them.
 */
export const JELLY_TENT = { n: 18, hunt: [0, 4, 9, 13] };
export function buildJelly() {
  const m = new Mk();
  // the bell: outer exumbrella and the inner (nested) bell, a polar grid in (v, u)
  for (let layer = 0; layer < 2; layer++) {
    const NU = layer ? 26 : 40, NV = layer ? 7 : 13;
    const base = m.count;
    for (let j = 0; j <= NV; j++) {
      const v = 0.015 + 0.985 * (j / NV) ** 0.9;
      for (let i = 0; i <= NU; i++) {
        const u = i / NU, az = u * TAU, ph = v * Math.PI * 0.5;
        m.v([Math.cos(az) * 0.5 * Math.sin(ph), 0.42 * Math.cos(ph), Math.sin(az) * 0.5 * Math.sin(ph)], [Math.cos(az) * Math.sin(ph), Math.cos(ph), Math.sin(az) * Math.sin(ph)], [20, v, u, layer]);
      }
    }
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
      const a = base + j * (NU + 1) + i, b = a + NU + 1;
      m.quad(a, a + 1, b + 1, b);
    }
    // close the apex
    const c = m.v([0, 0.42, 0], [0, 1, 0], [20, 0, 0, layer]);
    for (let i = 0; i < NU; i++) m.tri(c, base + i + 1, base + i);
  }
  // the gastric organ: a lumpy sac hanging in the bell, four gonad horseshoes round it
  ellipsoid(m, [0, 0.12, 0], [0.11, 0.15, 0.11], 12, 7, () => [[21, 0, 0, 0], [0, 0.12, 0, 0]]);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + 0.4;
    const pts = [], rad = [];
    for (let i = 0; i < 7; i++) {
      const t = i / 6, b = a + (t - 0.5) * 1.2;
      pts.push([Math.cos(b) * (0.17 + 0.03 * Math.sin(t * Math.PI)), 0.2 + 0.05 * Math.sin(t * Math.PI), Math.sin(b) * (0.17 + 0.03 * Math.sin(t * Math.PI))]);
      rad.push(0.022 * Math.sin(0.2 + t * 2.74) + 0.006);
    }
    tube(m, pts, rad, 4, (i, t) => [[21, t, a, 1], [0, 0.12, 0, 0]], true);
  }
  // the organ cage: cartilage hoops twisting from the apex round the organ
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * TAU;
    const pts = [], rad = [];
    for (let i = 0; i < 9; i++) {
      const t = i / 8, b = a + t * 0.9;
      const r = 0.035 + 0.25 * Math.sin(t * Math.PI * 0.92);
      pts.push([Math.cos(b) * r, 0.36 - t * 0.46, Math.sin(b) * r]);
      rad.push(0.0075 * (1 - 0.5 * t) + 0.002);
    }
    tube(m, pts, rad, 3, (i, t) => [[27, t, k, 0], [0, 0, 0, 0]], true);
  }
  // oral curtains: broad frilled sheets hanging from the mouth (the shader ruffles their edges)
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + 0.4;
    const NA = 18, NC = 3, base = m.count;
    const rd = [Math.cos(a), 0, Math.sin(a)], tg = [-Math.sin(a), 0, Math.cos(a)];
    for (let i = 0; i <= NA; i++) {
      const t = i / NA, tw = t * 1.6;
      const w = 0.1 * Math.sin(Math.min(t * 1.6 + 0.15, 1) * Math.PI * 0.5 + 0.2) * (1 - 0.55 * t) + 0.012;
      // the sheet slowly twists as it hangs
      const ax = [rd[0] * Math.cos(tw) + tg[0] * Math.sin(tw), 0, rd[2] * Math.cos(tw) + tg[2] * Math.sin(tw)];
      const nn = [-ax[2], 0, ax[0]];
      for (let j = 0; j <= NC; j++) {
        const s = (j / NC) * 2 - 1;
        m.v([rd[0] * 0.05 + ax[0] * w * s, -0.02 - t * 1.0, rd[2] * 0.05 + ax[2] * w * s], nn, [22, t, a, s]);
      }
    }
    for (let i = 0; i < NA; i++) for (let j = 0; j < NC; j++) {
      const q = base + i * (NC + 1) + j, r = q + NC + 1;
      m.quad(q, q + 1, r + 1, r);
    }
  }
  // tentacles: fine ones of many lengths and four thick hunting tentacles with barbs and a hook
  const NT = JELLY_TENT.n;
  for (let k = 0; k < NT; k++) {
    const a = ((k + 0.3 * Math.sin(k * 3.7)) / NT) * TAU;
    const hunt = JELLY_TENT.hunt.includes(k);
    const L = hunt ? 3.3 + 0.5 * ((k * 7) % 3) : 0.9 + 1.6 * (((k * 37) % 11) / 10);
    const NS = hunt ? 20 : 10, r0 = hunt ? 0.02 : 0.009;
    const pts = [], rad = [];
    for (let i = 0; i < NS; i++) { const t = i / (NS - 1); pts.push([Math.cos(a) * 0.46, -t * L, Math.sin(a) * 0.46]); rad.push(r0 * (1 - t * 0.65) * (1 + (hunt ? 0.25 * Math.sin(t * 40) : 0))); }
    tube(m, pts, rad, 3, (i, t) => [[23, t, a, hunt ? 1 : 0], [L, 0, 0, 0]], true);
    if (!hunt) continue;
    // barbs: recurved spines in a spiral up the hunting tentacle, pointing back toward the bell
    const spike = (t, rel, len, w) => {
      const b0 = m.count;
      const d = norm(rel);
      tube(m, [[0, 0, 0], [d[0] * len, d[1] * len + len * 0.45, d[2] * len]], [w, 0.0006], 3, (i, tt) => [[28, t, a, L], [0, 0, 0, tt]], true);
      for (let v = b0; v < m.count; v++) {
        m.q[v * 4] = m.p[v * 3]; m.q[v * 4 + 1] = m.p[v * 3 + 1]; m.q[v * 4 + 2] = m.p[v * 3 + 2];
        m.p[v * 3] = Math.cos(a) * 0.46; m.p[v * 3 + 1] = -t * L; m.p[v * 3 + 2] = Math.sin(a) * 0.46;
      }
    };
    for (let b = 0; b < 7; b++) {
      const t = 0.45 + b * 0.07, th = b * 2.1 + k;
      spike(t, [Math.cos(th), -0.15, Math.sin(th)], 0.11 - b * 0.006, 0.013);
    }
    // the hook at the tip: a curled claw
    {
      const b0 = m.count, hp = [], hr = [];
      for (let i = 0; i < 6; i++) { const u = i / 5, ang = u * 2.6; hp.push([Math.cos(a) * Math.sin(ang) * 0.12, -Math.sin(ang * 0.5) * 0.03 - (1 - Math.cos(ang)) * 0.1 + 0.1 * u * u, Math.sin(a) * Math.sin(ang) * 0.12]); hr.push(0.016 * (1 - u) + 0.001); }
      tube(m, hp, hr, 3, (i, tt) => [[28, 1, a, L], [0, 0, 0, tt]], true);
      for (let v = b0; v < m.count; v++) {
        m.q[v * 4] = m.p[v * 3]; m.q[v * 4 + 1] = m.p[v * 3 + 1]; m.q[v * 4 + 2] = m.p[v * 3 + 2];
        m.p[v * 3] = Math.cos(a) * 0.46; m.p[v * 3 + 1] = -L; m.p[v * 3 + 2] = Math.sin(a) * 0.46;
      }
    }
  }
  // lens-eyes round the margin, between the ribs
  for (let k = 0; k < 12; k++) {
    const a = ((k + 0.5) / 12) * TAU;
    const c = [Math.cos(a) * 0.47, 0.035, Math.sin(a) * 0.47];
    eyeDome(m, c, [Math.cos(a), -0.3, Math.sin(a)], 0.048, 2, 8, (qx, qy) => [[24, 0, qx, qy], [a, 0, 0, 0]]);
  }
  // the velum: a frilled skirt round the margin, folded in under the bell
  {
    const NU = 40, NK = 2, base = m.count;
    for (let i = 0; i <= NU; i++) for (let j = 0; j <= NK; j++) {
      const u = i / NU, az = u * TAU;
      m.v([Math.cos(az) * 0.5, 0, Math.sin(az) * 0.5], [Math.cos(az), 0, Math.sin(az)], [25, j / NK, u, 0]);
    }
    for (let i = 0; i < NU; i++) for (let j = 0; j < NK; j++) {
      const a = base + i * (NK + 1) + j, b = a + NK + 1;
      m.quad(a, a + 1, b + 1, b);
    }
  }
  return m.build();
}

/**
 * Manta (KIND 7). Span 2 (x -1..1, halfspan 1), facing +z, the terminal mouth at z ~ +0.47.
 * One lofted body that blends into the pectoral wings (part 30): every spanwise station is a closed
 * airfoil loop (thick rounded leading edge thinning to a fine trailing edge; the body a thick
 * central disc). aP.y = chord v (0 leading edge .. 1 trailing edge), aP.z = span u (signed),
 * aP.w = topness (sin of the loop angle: -1 belly .. +1 back); aQ.x = half thickness there.
 * Cephalic lobes (31: aP.y along, aP.z across 0..1, aP.w side; posed and curled in the shader, split
 * into two hooked tines at the tip), twin barbed whip tails (32, aP.y along, aP.w side), eyes (33:
 * aQ.xyz centre, aQ.w 0 the main eye, 1 and 2 the eyes on stalks), dorsal fin and the ridge of
 * bony scutes (34, aP.w 0 fin / 2 scute), pelvic fins (35), tail barbs (36: aP.y = t on the tail,
 * aP.w side, aQ.xyz offset from the tail axis there, aQ.w along the barb), fangs (37: aP.y along,
 * aP.w +1 upper lip, -1 lower lip, 0 the ring round the under-maw; aQ.xyz root, aQ.w ring angle),
 * eye stalks (38, aP.y along, aP.z stalk id, aP.w side), horns (39: aP.y along, aP.z 0 the main
 * horn / 1 its tine, aP.w side; aQ.xyz root).
 * lod 1 is the far mesh (coarse loft, lobes, tails and horns only).
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
  // twin whip tails, diverging from the tail root
  const tailAt = (t, side) => [side * (0.022 + 0.1 * Math.pow(t, 1.3)), 0.006 + 0.012 * t, -0.4 - t * 1.15];
  for (let side = -1; side <= 1; side += 2) {
    const pts = [], rad = [];
    const N = far ? 6 : 16;
    for (let i = 0; i < N; i++) { const t = i / (N - 1); pts.push(tailAt(t, side)); rad.push(0.022 * Math.pow(1 - t, 1.3) + 0.002); }
    tube(m, pts, rad, far ? 3 : 5, (i, t) => [[32, t, 0, side], [0, 0, 0, 0]], true);
  }
  // swept-back horns from the crown, each with a forward tine
  const bez = (P, t) => { const u = 1 - t; return [0, 1, 2].map((k) => u * u * u * P[0][k] + 3 * u * u * t * P[1][k] + 3 * u * t * t * P[2][k] + t * t * t * P[3][k]); };
  for (let side = -1; side <= 1; side += 2) {
    const b = [side * 0.075, 0.05, 0.395];
    const P = [b, [b[0] + side * 0.03, b[1] + 0.07, b[2] + 0.07], [b[0] + side * 0.1, b[1] + 0.15, b[2] + 0.0], [b[0] + side * 0.17, b[1] + 0.13, b[2] - 0.15]];
    const NH = far ? 4 : 10;
    const pts = [], rad = [];
    for (let i = 0; i < NH; i++) { const t = i / (NH - 1); pts.push(bez(P, t)); rad.push(0.019 * Math.pow(1 - t, 0.9) + 0.0015); }
    tube(m, pts, rad, far ? 3 : 6, (i, t) => [[39, t, 0, side], [b[0], b[1], b[2], 0]], true);
    if (far) continue;
    const f0 = bez(P, 0.45);
    const tp = [f0, [f0[0] + side * 0.012, f0[1] + 0.04, f0[2] + 0.035], [f0[0] + side * 0.02, f0[1] + 0.06, f0[2] + 0.075]];
    tube(m, tp, [0.008, 0.005, 0.001], 4, (i, t) => [[39, 0.45 + 0.55 * t, 1, side], [b[0], b[1], b[2], 0]], true);
  }
  if (far) return m.build();
  // tail barbs: a saw of recurved spines along each tail's root, and a harpoon tip
  const tailBarb = (side, t, dir, len, w) => {
    const b0 = m.count, d = norm(dir);
    tube(m, [[0, 0, 0], [d[0] * len, d[1] * len, d[2] * len]], [w, 0.0007], 3, (i, tt) => [[36, t, 0, side], [0, 0, 0, tt]], true);
    const ax = tailAt(t, side);
    for (let v = b0; v < m.count; v++) {
      m.q[v * 4] = m.p[v * 3]; m.q[v * 4 + 1] = m.p[v * 3 + 1]; m.q[v * 4 + 2] = m.p[v * 3 + 2];
      m.p[v * 3] = ax[0]; m.p[v * 3 + 1] = ax[1]; m.p[v * 3 + 2] = ax[2];
    }
  };
  for (let side = -1; side <= 1; side += 2) {
    for (let k = 0; k < 6; k++) {
      const t = 0.05 + k * 0.055, up = k % 2;
      tailBarb(side, t, [side * (up ? 0.35 : 0.9), up ? 1 : 0.25, -1.2], 0.045 - k * 0.004, 0.006);
    }
    for (const sd of [-1, 1]) tailBarb(side, 0.985, [sd * 0.8, 0.1, 0.9], 0.03, 0.004);
  }
  // fangs: long overbite fangs from the upper lip, a lower row that drops with the jaw, and a ring
  // folded over the under-maw on the belly (it splays open when feeding)
  const fang = (root, dir, len, w, a, ring) => {
    const d = norm(dir);
    const mid = [root[0] + d[0] * len * 0.55, root[1] + d[1] * len * 0.55, root[2] + d[2] * len * 0.55 + len * 0.08];
    tube(m, [root, mid, [root[0] + d[0] * len, root[1] + d[1] * len, root[2] + d[2] * len - len * 0.12]], [w, w * 0.55, 0.0006], 4, (i, t) => [[37, t, 0, ring], [root[0], root[1], root[2], a]], true);
  };
  for (let k = 0; k < 6; k++) {
    const x = (k - 2.5) * 0.034, big = k === 1 || k === 4;
    fang([x, -0.004, 0.462 - Math.abs(x) * 0.25], [x * 0.6, -1, 0.25], big ? 0.062 : 0.032, big ? 0.0075 : 0.005, 0, 1);
    fang([x + 0.017, -0.03, 0.452 - Math.abs(x) * 0.25], [x * 0.4, 1, 0.3], 0.026, 0.0045, 0, -1);
  }
  const MZ = 0.3, MY = -0.04;
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * TAU + 0.3;
    const r = 0.042;
    const root = [Math.cos(a) * r, MY - 0.002, MZ + Math.sin(a) * r * 1.2];
    fang(root, [-Math.cos(a) * 0.7, -0.75, -Math.sin(a) * 0.7], 0.034 + 0.008 * (k % 2), 0.005, a, 0);
  }
  // eyes: the main pair, and two smaller eyes on stalks behind each
  for (let side = -1; side <= 1; side += 2) {
    const c = [side * 0.19, 0.014, 0.36];
    ellipsoid(m, c, [0.028, 0.024, 0.03], 12, 7, () => [[33, 0, 0, side], [c[0], c[1], c[2], 0]]);
    const stalks = [[[side * 0.145, 0.04, 0.325], [side * 0.03, 0.05, -0.01], 0.016], [[side * 0.11, 0.055, 0.27], [side * 0.02, 0.042, -0.012], 0.013]];
    stalks.forEach(([r0, d, er], id) => {
      const tip = [r0[0] + d[0], r0[1] + d[1], r0[2] + d[2]];
      tube(m, [r0, [r0[0] + d[0] * 0.5, r0[1] + d[1] * 0.55, r0[2] + d[2] * 0.5], tip], [0.009, 0.006, 0.005], 5, (i, t) => [[38, t, id + 1, side], [r0[0], r0[1], r0[2], 0]], false);
      ellipsoid(m, tip, [er, er * 0.9, er], 9, 5, () => [[33, 1, id + 1, side], [tip[0], tip[1], tip[2], id + 1]]);
    });
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
  // a ridge of bony scutes down the spine from the crown, and a shorter row on each shoulder
  const topAt = (x, z) => { const u = Math.abs(x); const v = (mantaLE(u) - z) / (mantaLE(u) - mantaTE(u)); return mantaHalf(u, v)[0] - 0.035 * u * u; };
  const scute = (x, z, h, w) => {
    const y = topAt(x, z) - 0.004;
    tube(m, [[x, y, z], [x, y + h * 0.55, z - h * 0.35], [x, y + h, z - h * 0.95]], [w, w * 0.5, 0.0008], 4, (i, t) => [[34, t, 0, 2], [0, 0, 0, 0]], true, 0.6);
  };
  for (let k = 0; k < 9; k++) { const z = 0.3 - k * 0.075; scute(0.004 * Math.sin(k * 2.3), z, 0.03 + 0.012 * Math.sin(k * 0.45 + 0.3), 0.016); }
  for (let side = -1; side <= 1; side += 2) for (let k = 0; k < 5; k++) scute(side * (0.075 + k * 0.004), 0.24 - k * 0.08, 0.017, 0.01);
  return m.build();
}

// ---------------------------------------------------------------------------------------------
/**
 * A lofted skin from a grid of rings: rows[i][j] (j around, closed). Normals from central
 * differences of the grid, turned away from each ring's centre. attr(i, j, p) => [aP, aQ].
 */
function skin(m, rows, attr, centres) {
  const nI = rows.length, nJ = rows[0].length;
  const base = m.count;
  for (let i = 0; i < nI; i++) {
    for (let j = 0; j < nJ; j++) {
      const p = rows[i][j];
      const a = rows[Math.min(i + 1, nI - 1)][j], b = rows[Math.max(i - 1, 0)][j];
      const c = rows[i][(j + 1) % nJ], d = rows[i][(j - 1 + nJ) % nJ];
      let n = norm(cross(sub(a, b), sub(c, d)));
      const o = sub(p, centres[i]);
      if (n[0] * o[0] + n[1] * o[1] + n[2] * o[2] < 0) n = [-n[0], -n[1], -n[2]];
      const [aa, q] = attr(i, j, p);
      m.v(p, n, aa, q);
    }
  }
  for (let i = 0; i < nI - 1; i++) for (let j = 0; j < nJ; j++) {
    const j1 = (j + 1) % nJ;
    m.quad(base + i * nJ + j, base + i * nJ + j1, base + (i + 1) * nJ + j1, base + (i + 1) * nJ + j);
  }
  return base;
}

/** A fin membrane: rays from roots to tips (curved through mids), nSeg segments along each ray. */
function finFan(m, roots, tips, mids, nSeg, attr) {
  const nR = roots.length, base = m.count;
  const P = [];
  for (let k = 0; k < nR; k++) for (let s = 0; s <= nSeg; s++) {
    const u = s / nSeg;
    const r = roots[k], t = tips[k], c = mids ? mids[k] : [(r[0] + t[0]) / 2, (r[1] + t[1]) / 2, (r[2] + t[2]) / 2];
    // quadratic Bezier root -> mid -> tip
    const w0 = (1 - u) * (1 - u), w1 = 2 * u * (1 - u), w2 = u * u;
    P.push([r[0] * w0 + c[0] * w1 + t[0] * w2, r[1] * w0 + c[1] * w1 + t[1] * w2, r[2] * w0 + c[2] * w1 + t[2] * w2]);
  }
  const at = (k, s) => P[k * (nSeg + 1) + s];
  for (let k = 0; k < nR; k++) for (let s = 0; s <= nSeg; s++) {
    const along = sub(at(k, Math.min(s + 1, nSeg)), at(k, Math.max(s - 1, 0)));
    const across = sub(at(Math.min(k + 1, nR - 1), s), at(Math.max(k - 1, 0), s));
    const n = norm(cross(along, across));
    const [a, q] = attr(k / Math.max(nR - 1, 1), s / nSeg);
    m.v(at(k, s), n, a, q);
  }
  for (let k = 0; k < nR - 1; k++) for (let s = 0; s < nSeg; s++) {
    const a = base + k * (nSeg + 1) + s, b = a + nSeg + 1;
    m.quad(a, a + 1, b + 1, b);
  }
}

/** A corneal dome: a spherical cap of radius r around axis ax, rising h above its rim. */
function eyeDome(m, c, ax, r, nRing, nSeg, attr) {
  ax = norm(ax);
  const up0 = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const U = norm(cross(up0, ax)), W = cross(ax, U);
  const base = m.count;
  const cap = 1.05; // cap half-angle (rad)
  for (let i = 0; i <= nRing; i++) {
    const th = (i / nRing) * cap;
    for (let j = 0; j < nSeg; j++) {
      const ph = (j / nSeg) * TAU;
      const st = Math.sin(th), ct = Math.cos(th);
      const n = [ax[0] * ct + (U[0] * Math.cos(ph) + W[0] * Math.sin(ph)) * st, ax[1] * ct + (U[1] * Math.cos(ph) + W[1] * Math.sin(ph)) * st, ax[2] * ct + (U[2] * Math.cos(ph) + W[2] * Math.sin(ph)) * st];
      const p = [c[0] + n[0] * r, c[1] + n[1] * r, c[2] + n[2] * r];
      // eye-plane coordinates (normalized to the cap rim): x toward U, y toward W
      const q = st / Math.sin(cap);
      const [a, qq] = attr(q * Math.cos(ph), q * Math.sin(ph), i / nRing);
      m.v(p, n, a, qq);
    }
  }
  for (let i = 0; i < nRing; i++) for (let j = 0; j < nSeg; j++) {
    const j1 = (j + 1) % nSeg;
    const a = base + i * nSeg + j, b = base + i * nSeg + j1, c2 = base + (i + 1) * nSeg + j1, d = base + (i + 1) * nSeg + j;
    if (i === 0) m.tri(a, c2, d); else m.quad(a, d, c2, b);
  }
  return { U, W };
}

const lerpT = (Z, V, z) => {
  // Z decreasing (nose first): piecewise smooth (cosine) interpolation
  if (z >= Z[0]) return V[0];
  for (let i = 0; i < Z.length - 1; i++) {
    if (z >= Z[i + 1]) {
      const u = (Z[i] - z) / (Z[i] - Z[i + 1]);
      const e = 0.5 - 0.5 * Math.cos(Math.PI * u);
      return V[i] + (V[i + 1] - V[i]) * (0.3 * u + 0.7 * e);
    }
  }
  return V[V.length - 1];
};

// Lantern puffer (a tetraodontid): a blunt-headed, box-rounded body that narrows to a short
// peduncle, a small terminal beak of fused tooth plates, high-set eyes in bony sockets, a gill
// slit before each fan-shaped pectoral, the dorsal and anal fins set far back (they scull it
// along), a rounded fan tail and no pelvic fins. Its prickles lie in skin pockets until it gulps
// water, when the belly balloons and they stand up (reefMat.js inflates it on the GPU).
// Parts: 40 body (aP.y = t nose 0 .. tail 1, aP.z = angle round / TAU), 41 eye dome (aP.zw eye
// plane, aQ centre, aQ.w side), 42 fins (aP.y along ray, aP.z across, aP.w fin id: 0 caudal,
// 1 dorsal, 2 anal, 3 pectoral, 4 the ventral pectorals; aQ hinge, aQ.w side), 43 prickles (aP.y
// along; aP.zw + aQ.w the skin normal; aQ.xyz root), 44 beak plates, 45 the gape, 46 hooked chitin
// mandibles (aP.y along, aP.z 1 teeth; aQ hinge, aQ.w side), 47 brow horns and the spine crest
// (aP.y along; aQ root, aQ.w 1 crest). The Vur Sok puffer is armoured: bony plates over the back,
// a second pair of eyes, four pectorals, mandibles that scissor and gape when it puffs up.
export const PUF = {
  z: [0.272, 0.266, 0.252, 0.228, 0.19, 0.13, 0.06, -0.02, -0.09, -0.145, -0.185, -0.21, -0.226],
  hw: [0.024, 0.044, 0.076, 0.112, 0.15, 0.18, 0.19, 0.18, 0.146, 0.098, 0.058, 0.04, 0.035],
  ht: [0.02, 0.042, 0.076, 0.114, 0.148, 0.168, 0.172, 0.16, 0.124, 0.082, 0.052, 0.04, 0.037],
  hb: [0.02, 0.038, 0.07, 0.106, 0.138, 0.16, 0.17, 0.163, 0.126, 0.078, 0.048, 0.036, 0.033],
  cy: [-0.038, -0.036, -0.03, -0.02, -0.008, 0.003, 0.008, 0.009, 0.01, 0.012, 0.013, 0.013, 0.013],
};
export const PUF_EYE = { z: 0.17, y: 0.094, r: 0.036 };
const pufS = (z) => ({ hw: lerpT(PUF.z, PUF.hw, z), ht: lerpT(PUF.z, PUF.ht, z), hb: lerpT(PUF.z, PUF.hb, z), cy: lerpT(PUF.z, PUF.cy, z) });
const SE = 2.25; // superellipse exponent of the sections (a little boxy, like a real puffer)
function pufPoint(z, th) {
  const s = pufS(z);
  const sn = Math.sin(th), cs = Math.cos(th);
  const x = s.hw * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / SE);
  const y = s.cy + (cs >= 0 ? s.ht : s.hb) * Math.sign(cs) * Math.pow(Math.abs(cs), 2 / SE);
  return [x, y, z];
}

export function buildPuffer() {
  const m = new Mk();
  const NS = 30, NA = 28;
  const zs = [];
  for (let i = 0; i < NS; i++) { const u = i / (NS - 1); zs.push(0.272 + (-0.226 - 0.272) * (0.4 * u + 0.6 * (0.5 - 0.5 * Math.cos(Math.PI * u)))); }
  const E = PUF_EYE;
  const eyeC = (side) => { const p = pufPoint(E.z, Math.atan2(1, 0) * 0 + 0.98 * side); return p; };
  const eSurf = [pufPoint(E.z, 0.98), pufPoint(E.z, -0.98)];
  const rows = [], centres = [];
  for (let i = 0; i < NS; i++) {
    const z = zs[i], ring = [];
    for (let j = 0; j < NA; j++) {
      const th = (j / NA) * TAU;
      const p = pufPoint(z, th);
      // bony eye sockets: a raised rim around a shallow orbit where the cornea sits
      for (const es of eSurf) {
        if (Math.sign(p[0]) !== Math.sign(es[0])) continue;
        const d = Math.hypot(p[1] - es[1], (p[2] - es[2]) * 0.95) / E.r;
        if (d < 1.9) {
          const rimK = Math.exp(-((d - 1.15) ** 2) / 0.09) * 0.014 - Math.exp(-(d * d) / 0.5) * 0.01;
          p[0] += Math.sign(p[0]) * rimK;
          p[1] += rimK * 0.4;
        }
      }
      // a brow ridge over the eyes and a slight nuchal hump
      p[1] += 0.008 * Math.exp(-(((z - 0.12) / 0.07) ** 2)) * Math.max(Math.cos(th), 0) ** 3;
      // the lips: a fleshy ring round the beak
      if (z > 0.258) { const k = (z - 0.258) / 0.014; p[0] *= 1 + 0.12 * k; p[1] = pufS(z).cy + (p[1] - pufS(z).cy) * (1 + 0.12 * k); }
      ring.push(p);
    }
    rows.push(ring);
    centres.push([0, pufS(z).cy, z]);
  }
  skin(m, rows, (i, j) => [[40, (0.272 - zs[i]) / 0.498, j / NA, 0], [0, 0, 0, 0]], centres);
  void eyeC;
  // the gape: a dark recessed disc inside the lips
  {
    const s = pufS(0.272), c = m.v([0, s.cy, 0.262], [0, 0, 1], [45, 0, 0, 0]);
    const ring = [];
    for (let j = 0; j < 10; j++) { const th = (j / 10) * TAU; ring.push(m.v([Math.sin(th) * s.hw * 0.98, s.cy + Math.cos(th) * s.ht * 0.98, 0.271], [0, 0, 1], [45, 1, 0, 0])); }
    for (let j = 0; j < 10; j++) m.tri(c, ring[j], ring[(j + 1) % 10]);
  }
  // beak: upper and lower fused tooth plates, each split by a midline suture (two arcs)
  for (const ud of [1, -1]) {
    for (const sd of [1, -1]) {
      const pts = [], rad = [];
      for (let i = 0; i < 5; i++) {
        const u = i / 4, a = u * 1.25;
        pts.push([sd * Math.sin(a) * 0.021, -0.038 + ud * (0.006 + Math.cos(a) * 0.006), 0.274 - u * u * 0.012]);
        rad.push(0.0055 * (1 - u * 0.4));
      }
      tube(m, pts, rad, 5, (i, t) => [[44, t, ud, sd], [0, -0.038, 0.27, 0]], true, 0.6);
    }
  }
  // eyes: corneal domes in the orbits
  for (const side of [1, -1]) {
    const es = eSurf[side > 0 ? 0 : 1];
    const ax = norm([side, 0.38, 0.12]);
    const c = [es[0] - ax[0] * E.r * 0.28, es[1] - ax[1] * E.r * 0.28, es[2] - ax[2] * E.r * 0.28];
    eyeDome(m, c, ax, E.r * 0.92, 6, 16, (qx, qy) => [[41, 0, qx, qy * side], [c[0], c[1], c[2], side]]);
  }
  // fins ---------------------------------------------------------------------------------------
  const fin = (id, side, hinge, roots, tips, mids, nSeg) => finFan(m, roots, tips, mids, nSeg, (u, s) => [[42, s, u, id], [hinge[0], hinge[1], hinge[2], side]]);
  // rounded fan tail
  {
    const z0 = -0.222, cy = pufS(z0).cy, nR = 13;
    const roots = [], tips = [], mids = [];
    for (let k = 0; k < nR; k++) {
      const u = k / (nR - 1), a = (u - 0.5) * 1.55;
      const L = 0.145 * (1 - 0.18 * a * a) * (0.96 + 0.04 * Math.cos(k * 2.1));
      roots.push([0, cy + (u - 0.5) * 0.066, z0 + 0.004]);
      tips.push([0, cy + Math.sin(a) * L, z0 - Math.cos(a) * L]);
      mids.push([0, cy + (u - 0.5) * 0.066 + Math.sin(a) * L * 0.42, z0 - Math.cos(a) * L * 0.5]);
    }
    fin(0, 0, [0, cy, z0], roots, tips, mids, 5);
  }
  // dorsal and anal: small rounded sculls far back, opposite each other
  for (const ud of [1, -1]) {
    const nR = 9, roots = [], tips = [], mids = [];
    for (let k = 0; k < nR; k++) {
      const u = k / (nR - 1);
      const z = -0.075 - u * 0.075;
      const s = pufS(z);
      const y0 = s.cy + ud * ((ud > 0 ? s.ht : s.hb) - 0.006);
      const h = (0.095 - 0.03 * u) * Math.sin(Math.PI * (0.22 + 0.78 * u) * 0.5 + 0.55) ;
      roots.push([0, y0, z]);
      tips.push([0, y0 + ud * h, z - 0.06 - u * 0.03]);
      mids.push([0, y0 + ud * h * 0.55, z - 0.018 - u * 0.01]);
    }
    const hz = -0.11, hs = pufS(hz);
    fin(ud > 0 ? 1 : 2, 0, [0, hs.cy + ud * (ud > 0 ? hs.ht : hs.hb), hz], roots, tips, mids, 4);
  }
  // pectorals: rounded fans behind the gill slits
  for (const side of [1, -1]) {
    const nR = 11, roots = [], tips = [], mids = [];
    const z = 0.075, s = pufS(z);
    for (let k = 0; k < nR; k++) {
      const u = k / (nR - 1);
      const y = s.cy - 0.03 + u * 0.075;
      const p = pufPoint(z - u * 0.008, Math.acos(Math.max(-1, Math.min(1, (y - s.cy) / s.ht))) * side);
      const a = (u - 0.5) * 1.6;
      const L = 0.085 * (1 - 0.2 * a * a);
      roots.push([p[0] - side * 0.004, y, z - u * 0.008]);
      tips.push([p[0] + side * L * 0.42, y + Math.sin(a) * L * 0.75, z - u * 0.008 - Math.cos(a) * L * 0.85]);
      mids.push([p[0] + side * L * 0.25, y + Math.sin(a) * L * 0.36, z - u * 0.008 - Math.cos(a) * L * 0.4]);
    }
    fin(3, side, [roots[5][0], s.cy + 0.008, z], roots, tips, mids, 4);
  }
  // prickles: short spines in skin pockets all over the body (none on the snout, eyes, fins)
  const NP = 96;
  for (let k = 0; k < NP; k++) {
    const u = (k + 0.5) / NP;
    const z = 0.21 - u * 0.36;
    const th = k * 2.39996 + 0.3;
    const p = pufPoint(z, th);
    if (Math.hypot(p[1] - E.y, p[2] - E.z) < 0.065 && Math.abs(p[0]) > 0.08) continue;
    if (Math.abs(p[0]) < 0.02 && z < -0.06) continue; // the dorsal and anal fin bases
    const s = pufS(z);
    const h = p[1] >= s.cy ? s.ht : s.hb;
    const n = norm([p[0] / (s.hw * s.hw), (p[1] - s.cy) / (h * h), (z > 0.05 ? (z - 0.05) * 6 : (z + 0.05) * 3) * 0.4]);
    const L = 0.05 + 0.025 * ((k * 7919) % 13) / 13 + 0.02 * Math.max(0, -n[1]);
    const root = [p[0] - n[0] * 0.004, p[1] - n[1] * 0.004, p[2] - n[2] * 0.004];
    const tip = [root[0] + n[0] * L, root[1] + n[1] * L, root[2] + n[2] * L];
    const mid = [root[0] + n[0] * L * 0.35, root[1] + n[1] * L * 0.35, root[2] + n[2] * L * 0.35];
    tube(m, [root, mid, tip], [0.0075, 0.0042, 0.0006], 4, (i, t) => [[43, t, n[0], n[1]], [root[0], root[1], root[2], n[2]]], true);
  }
  // ---- what makes it a monster of Vur Sok ----------------------------------------------------
  // hooked chitin mandibles either side of the beak (part 46: aP.y along, aP.w side; aQ hinge),
  // each with a row of teeth along its inner edge; they scissor as it breathes and gape when it puffs
  for (const side of [1, -1]) {
    const h = [side * 0.06, -0.05, 0.222];
    const pts = [], rad = [];
    for (let i = 0; i < 8; i++) {
      const u = i / 7;
      pts.push([side * (0.06 + 0.035 * Math.sin(u * 2.4) - 0.075 * u * u), -0.05 - 0.02 * Math.sin(u * 3.0), 0.222 + 0.15 * u]);
      rad.push(0.016 * (1 - u * 0.85) + 0.0012);
    }
    tube(m, pts, rad, 5, (i, t) => [[46, t, 0, side], [h[0], h[1], h[2], side]], true, 0.75);
    for (let k = 0; k < 4; k++) {
      const u = 0.3 + k * 0.15, p0 = pts[Math.round(u * 7)];
      tube(m, [p0, [p0[0] - side * 0.024, p0[1] + 0.004, p0[2] + 0.006]], [0.005, 0.0006], 3, (i, t) => [[46, u, 1, side], [h[0], h[1], h[2], side]], true);
    }
  }
  // bony brow horns swept back over the eyes, and a crest of long spines down the back
  // (part 47: aP.y along; aQ root, aQ.w 0 horn / 1 crest)
  for (const side of [1, -1]) {
    const r0 = [side * 0.068, 0.118, 0.165];
    tube(m, [r0, [side * 0.1, 0.17, 0.14], [side * 0.135, 0.21, 0.06], [side * 0.13, 0.215, -0.0]], [0.018, 0.012, 0.006, 0.001], 5, (i, t) => [[47, t, 0, side], [r0[0], r0[1], r0[2], 0]], true);
  }
  for (let k = 0; k < 5; k++) {
    const z = 0.13 - k * 0.045, sp = pufS(z);
    const y0 = sp.cy + sp.ht - 0.004;
    const hh = 0.1 - k * 0.012;
    tube(m, [[0, y0, z], [0, y0 + hh * 0.6, z - hh * 0.25], [0, y0 + hh, z - hh * 0.6]], [0.008, 0.004, 0.0007], 4, (i, t) => [[47, t, 0, 0], [0, y0, z, 1]], true);
  }
  // a second, ventral pair of pectorals (fin id 4)
  for (const side of [1, -1]) {
    const nR = 9, roots = [], tips = [], mids = [];
    const z = 0.035, sp = pufS(z);
    for (let k = 0; k < nR; k++) {
      const u = k / (nR - 1);
      const y = sp.cy - 0.1 + u * 0.05;
      const p = pufPoint(z - u * 0.006, Math.acos(Math.max(-1, Math.min(1, (y - sp.cy) / sp.hb))) * side);
      const a = (u - 0.5) * 1.4 - 0.5;
      const L = 0.075 * (1 - 0.2 * a * a);
      roots.push([p[0] - side * 0.004, y, z - u * 0.006]);
      tips.push([p[0] + side * L * 0.55, y + Math.sin(a) * L * 0.6, z - u * 0.006 - Math.cos(a) * L * 0.8]);
      mids.push([p[0] + side * L * 0.3, y + Math.sin(a) * L * 0.3, z - u * 0.006 - Math.cos(a) * L * 0.38]);
    }
    fin(4, side, [roots[4][0], sp.cy - 0.08, z], roots, tips, mids, 3);
  }
  // a second, smaller pair of eyes above and behind the first
  for (const side of [1, -1]) {
    const p = pufPoint(0.115, side * 0.62);
    const ax = norm([side * 0.7, 0.75, -0.1]);
    const c = [p[0] - ax[0] * 0.006, p[1] - ax[1] * 0.006, p[2] - ax[2] * 0.006];
    eyeDome(m, c, ax, 0.022, 4, 12, (qx, qy) => [[41, 0, qx, qy * side], [c[0], c[1], c[2], side]]);
  }
  return m.build();
}

// Ribbon eel (a moray, Rhinomuraena-like): a long, laterally compressed ribbon of a body, a
// pointed head with a jutting lower jaw and barbel-like chin tentacles, leaf-like flared nostrils
// on the snout, small eyes high on the head, a continuous dorsal fin from the nape to the tail tip
// and an anal fin from mid-body that meets it there. Length 1 along z (nose +0.5).
// Parts: 50 body (aP.y = t, aP.z = angle round / TAU), 51 fins (aP.y = t, aP.z = s up the fin,
// aP.w = +1 dorsal / -1 anal), 52 eye (aP.zw eye plane, aQ.w side), 53 nostril flaps and chin
// barbels (aP.y along the flap, aP.w side; the shader pins them to the snout), 54 the hinged lower
// jaw (aP.y = t, aP.z round; aQ.yz hinge), 55 needle teeth (aP.w -1 on the jaw, +1 on the upper
// lip), 56 external gill plumes. The Vur Sok ribbon eel is armoured in bony bands, has a second
// pair of eyes and a spined dorsal crest.
const EEL_EYE = { t: 0.03, y: 0.0062, r: 0.0042 };
function eelS(t) {
  // half depth, half width, centre height along the body
  const head = Math.min(1, t / 0.06);
  const ht = 0.0165 * Math.pow(head, 0.55) * (1 - Math.pow(Math.max(t - 0.55, 0) / 0.45, 1.6) * 0.92) + 0.0012;
  const hw = 0.0085 * Math.pow(head, 0.5) * (1 - 0.35 * t) * (1 - Math.pow(Math.max(t - 0.6, 0) / 0.4, 1.3) * 0.9) + 0.0006;
  // the head is a little deeper over the gills, and the jaw juts
  const gill = 0.0025 * Math.exp(-(((t - 0.055) / 0.02) ** 2));
  return { ht: ht + gill, hw: hw + gill * 0.6, cy: -0.002 * Math.exp(-((t / 0.03) ** 2)) };
}
export function buildEel() {
  const m = new Mk();
  const NS = 96, NA = 10;
  const ts = [];
  for (let i = 0; i < NS; i++) { const u = i / (NS - 1); ts.push(Math.pow(u, 1.25) * 0.998 + 0.002); }
  const rows = [], centres = [];
  for (let i = 0; i < NS; i++) {
    const t = ts[i], s = eelS(t), z = 0.5 - t, ring = [];
    for (let j = 0; j < NA; j++) {
      const th = (j / NA) * TAU;
      const sn = Math.sin(th), cs = Math.cos(th);
      let x = s.hw * Math.sign(sn) * Math.pow(Math.abs(sn), 0.9);
      let y = s.cy + s.ht * Math.sign(cs) * Math.pow(Math.abs(cs), 1.1);
      // the eye bumps out of the head
      const de = Math.hypot(y - EEL_EYE.y, (t - EEL_EYE.t) * 1.0) / EEL_EYE.r;
      if (de < 1.8) x += Math.sign(x) * 0.0018 * Math.max(0, 1 - de * de / 3.24);
      // the lower jaw juts past the upper at the snout
      if (cs < 0 && t < 0.02) { const k = 1 - t / 0.02; y -= 0.0012 * k; }
      ring.push([x, y, z]);
    }
    rows.push(ring);
    centres.push([0, s.cy, z]);
  }
  skin(m, rows, (i, j) => [[50, ts[i], j / NA, 0], [0, 0, 0, 0]], centres);
  // tip of the snout: close the first ring
  {
    const c = m.v([0, eelS(0.002).cy - 0.0004, 0.5005], [0, 0, 1], [50, 0, 0, 0]);
    for (let j = 0; j < NA; j++) m.tri(c, j + 1 === NA ? 0 : j + 1, j);
  }
  // continuous fins: dorsal from the nape, anal from mid-body; both run out to the tail tip
  for (const ud of [1, -1]) {
    const t0 = ud > 0 ? 0.07 : 0.33;
    const N = ud > 0 ? 90 : 66, NSg = 3;
    const base = m.count;
    for (let i = 0; i < N; i++) {
      const t = t0 + (1 - t0) * (i / (N - 1)) * 0.998;
      const s = eelS(t), z = 0.5 - t;
      const H = (ud > 0 ? 0.023 * (1 + 0.7 * Math.exp(-(((t - 0.14) / 0.09) ** 2))) : 0.017) * Math.min(1, (t - t0) / 0.06) * (1 - 0.45 * Math.max(t - 0.85, 0) / 0.15) + 0.001;
      for (let k = 0; k <= NSg; k++) {
        const sk = k / NSg;
        const y = s.cy + ud * (s.ht * 0.92 + H * sk);
        m.v([0, y, z - sk * 0.004], [1, 0, 0], [51, t, sk, ud], [0, 0, 0, 0]);
      }
    }
    for (let i = 0; i < N - 1; i++) for (let k = 0; k < NSg; k++) {
      const a = base + i * (NSg + 1) + k, b = a + NSg + 1;
      m.quad(a, a + 1, b + 1, b);
    }
  }
  // eyes: small glossy domes
  for (const side of [1, -1]) {
    const s = eelS(EEL_EYE.t);
    const c = [side * (s.hw * 0.78), EEL_EYE.y, 0.5 - EEL_EYE.t];
    eyeDome(m, c, [side, 0.3, 0.15], EEL_EYE.r * 0.95, 4, 10, (qx, qy) => [[52, 0, qx, qy * side], [c[0], c[1], c[2], side]]);
  }
  // flared leaf nostrils on the snout, and two short chin barbels
  for (const side of [1, -1]) {
    const r = [side * 0.0022, 0.0035, 0.497];
    const roots = [r, [r[0], r[1] - 0.0012, r[2] - 0.0025]];
    const tips = [[side * 0.009, 0.012, 0.506], [side * 0.012, 0.006, 0.503]];
    finFan(m, roots, tips, null, 3, (u, s) => [[53, s, u, side], [r[0], r[1], r[2], side]]);
    tube(m, [[side * 0.002, -0.006, 0.497], [side * 0.004, -0.011, 0.5], [side * 0.005, -0.014, 0.505]], [0.0011, 0.0008, 0.0003], 3, (i, t) => [[53, t, 2, side], [side * 0.002, -0.006, 0.497, side]], true);
  }
  // ---- what makes it a monster of Vur Sok ----------------------------------------------------
  // a hinged lower jaw (part 54: aP.y = t, aP.z = j round / NA, the last three the tongue; aQ.yz the
  // hinge): a shell round the underside of the head that drops open on its hinge
  const TJ = 0.062, hz = 0.5 - TJ, hy = eelS(TJ).cy;
  {
    const NJ = 9, NAJ = 10, rows = [], centres = [], tsJ = [];
    for (let i = 0; i < NJ; i++) {
      const t = 0.004 + (TJ - 0.004) * Math.pow(i / (NJ - 1), 0.8), sv = eelS(t), z = 0.5 - t;
      const hw = sv.hw * 1.14 + 0.0004, ht = sv.ht * 1.12 + 0.0004;
      const ring = [];
      for (let j = 0; j < 7; j++) { const th = Math.PI * 0.5 + (j / 6) * Math.PI; ring.push([hw * Math.sin(th), sv.cy + ht * Math.cos(th) * 0.95 - 0.0003, z + (i === 0 ? 0.0015 : 0)]); }
      for (let j = 0; j < 3; j++) { const x = -hw * 0.55 + (j / 2) * hw * 1.1; ring.push([x, sv.cy - 0.0006, z]); }
      rows.push(ring); centres.push([0, sv.cy - ht * 0.45, z]); tsJ.push(t);
    }
    const jb = skin(m, rows, (i, j) => [[54, tsJ[i], j / NAJ, 0], [0, hy, hz, 0]], centres);
    const c = m.v([0, eelS(0.004).cy - 0.004, 0.4985], [0, -0.3, 1], [54, 0.004, 0.2, 0], [0, hy, hz, 0]);
    for (let j = 0; j < NAJ; j++) m.tri(c, jb + j, jb + ((j + 1) % NAJ));
  }
  // needle teeth: up from the jaw's rim (they drop with it) and down from the upper lip
  // (part 55: aP.y = t, aP.w -1 jaw / +1 upper; aQ.yz the hinge)
  for (const side of [1, -1]) for (let k = 0; k < 7; k++) {
    const t = 0.008 + k * 0.0075, sv = eelS(t), z = 0.5 - t;
    const L = 0.0062 - k * 0.0004 + (k === 1 ? 0.0025 : 0);
    const xj = side * sv.hw * 1.0, xu = side * sv.hw * 0.82;
    tube(m, [[xj, sv.cy - 0.0008, z], [xj * 0.9, sv.cy - 0.0008 + L, z - L * 0.25]], [0.0011, 0.0001], 3, (i, tt) => [[55, t, tt, -1], [0, hy, hz, 0]], true);
    tube(m, [[xu, sv.cy - sv.ht * 0.35, z - 0.003], [xu * 0.92, sv.cy - sv.ht * 0.35 - L * 0.9, z - 0.003 - L * 0.2]], [0.001, 0.0001], 3, (i, tt) => [[55, t, tt, 1], [0, hy, hz, 0]], true);
  }
  // external gill plumes behind the head: three feathery fans a side (part 56: aP.y = t, aP.z along
  // the plume, aP.w side)
  for (const side of [1, -1]) for (let k = 0; k < 3; k++) {
    const t = 0.07 + k * 0.011, sv = eelS(t), z = 0.5 - t;
    const r = [side * sv.hw * 0.9, sv.cy + sv.ht * (0.15 + 0.25 * k), z];
    const roots = [r, [r[0], r[1] - 0.003, r[2] - 0.004]];
    const L = 0.026 - k * 0.004;
    const tips = [[side * (sv.hw + L * 0.7), r[1] + L * 0.5, z - L * 0.75], [side * (sv.hw + L * 0.8), r[1] - L * 0.05, z - L * 0.9]];
    finFan(m, roots, tips, null, 4, (u, sg) => [[56, t, sg, side], [r[0], r[1], r[2], u]]);
  }
  // a second, smaller pair of eyes behind the first
  for (const side of [1, -1]) {
    const t = 0.048, sv = eelS(t);
    const c = [side * (sv.hw * 0.8), 0.0085, 0.5 - t];
    eyeDome(m, c, [side, 0.55, 0.05], 0.0029, 3, 8, (qx, qy) => [[52, t, qx, qy * side], [c[0], c[1], c[2], side]]);
  }
  return m.build();
}

export function triCount(g) { return (g.index ? g.index.count : g.attributes.position.count) / 3; }
