// Procedural geometry toolkit for the wildlife of Vur Sok. Every creature is one small mesh drawn
// with instancing; per-vertex attributes describe *where on the anatomy* a vertex is (part ids,
// position along the body, fin-ray and wing-span parameters, hinge roots), so the vertex shaders
// can swim, flap, fold and coil the animals without bones.
import { BufferGeometry, InstancedBufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, Uint32BufferAttribute } from 'three';

export const TAU = Math.PI * 2;

/** sign(v) * |v|^e: superellipse helper (e < 1 boxier, e > 1 pinched). */
export const spow = (v, e) => (v < 0 ? -Math.pow(-v, e) : Math.pow(v, e));

/** Catmull-Rom lookup in a table sampled at increasing T (values may be numbers). */
export function tab(T, V, t) {
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

/** Monotone piecewise-linear lookup (no overshoot): for profiles that must stay positive. */
export function lin(T, V, t) {
  const n = T.length;
  if (t <= T[0]) return V[0];
  if (t >= T[n - 1]) return V[n - 1];
  let i = 0;
  while (i < n - 2 && t > T[i + 1]) i++;
  const s = (t - T[i]) / (T[i + 1] - T[i]);
  return V[i] + (V[i + 1] - V[i]) * s;
}

/** Smooth (C1) lookup: piecewise cubic Hermite with monotone tangents (Fritsch-Carlson). */
export function smooth(T, V, t) {
  const n = T.length;
  if (t <= T[0]) return V[0];
  if (t >= T[n - 1]) return V[n - 1];
  let i = 0;
  while (i < n - 2 && t > T[i + 1]) i++;
  const h = T[i + 1] - T[i];
  const d = (k) => (V[k + 1] - V[k]) / (T[k + 1] - T[k]);
  const m = (k) => {
    if (k === 0) return d(0);
    if (k === n - 1) return d(n - 2);
    const a = d(k - 1), b = d(k);
    if (a * b <= 0) return 0;
    return (2 * a * b) / (a + b);
  };
  const s = (t - T[i]) / h, s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * V[i] + (s3 - 2 * s2 + s) * h * m(i) + (-2 * s3 + 3 * s2) * V[i + 1] + (s3 - s2) * h * m(i + 1);
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const V3 = { sub, add, mul, dot, cross, norm, mix };

export class Builder {
  /** attrs: { name: size } extra float attributes (every vertex gets all of them; missing = 0). */
  constructor(attrs = {}) {
    this.pos = [];
    this.nor = [];
    this.idx = [];
    this.attrs = {};
    for (const [k, size] of Object.entries(attrs)) this.attrs[k] = { size, data: [] };
  }
  get count() { return this.pos.length / 3; }
  get tris() { return this.idx.length / 3; }
  v(p, n, a = {}) {
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n ? n[0] : 0, n ? n[1] : 1, n ? n[2] : 0);
    for (const k in this.attrs) {
      const at = this.attrs[k];
      const val = a[k];
      for (let i = 0; i < at.size; i++) at.data.push(val ? val[i] ?? 0 : 0);
    }
    return this.pos.length / 3 - 1;
  }
  P(i) { return [this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]]; }
  N(i) { return [this.nor[i * 3], this.nor[i * 3 + 1], this.nor[i * 3 + 2]]; }
  tri(a, b, c) { this.idx.push(a, b, c); }
  /** A triangle wound so its face agrees with the stored vertex normals (front faces outward). */
  triO(a, b, c) {
    const pa = this.P(a), pb = this.P(b), pc = this.P(c);
    const f = cross(sub(pb, pa), sub(pc, pa));
    const n = add(add(this.N(a), this.N(b)), this.N(c));
    if (dot(f, n) < 0) this.idx.push(a, c, b);
    else this.idx.push(a, b, c);
  }
  quadO(a, b, c, d) { this.triO(a, b, c); this.triO(a, c, d); }
  build(instanced = true) {
    const g = instanced ? new InstancedBufferGeometry() : new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nor, 3));
    for (const [k, at] of Object.entries(this.attrs)) g.setAttribute(k, new Float32BufferAttribute(at.data, at.size));
    const big = this.count > 65535;
    g.setIndex(big ? new Uint32BufferAttribute(this.idx, 1) : new Uint16BufferAttribute(this.idx, 1));
    return g;
  }
}

/**
 * A lofted closed body along an axis (local +Z forward). `ring(i)` returns the section for station
 * i: { z, hw, ht, hb, cy, ex, ey, x0 } (half width, top / bottom half heights, centre height,
 * superellipse exponents for x and y, optional sideways centre offset). Sections are sampled at
 * nA angles from the top (theta 0) round the right side (+x, theta PI/2) to the bottom and back.
 * Normals come from finite differences on the grid, oriented outward. Optional apex points close
 * the ends. attr(i, j, th, p, n) gives each vertex its attributes.
 */
export function loft(B, nStations, ring, nA, attr, { noseApex = null, tailApex = null, thetas = null } = {}) {
  const grid = [];
  const P = [];
  const TH = thetas || Array.from({ length: nA }, (_, j) => (j / nA) * TAU);
  for (let i = 0; i < nStations; i++) {
    const r = ring(i);
    const row = [];
    for (let j = 0; j < nA; j++) {
      const th = TH[j];
      const s = Math.sin(th), c = Math.cos(th);
      const x = (r.x0 || 0) + r.hw * spow(s, r.ex ?? 1);
      const y = r.cy + (c >= 0 ? r.ht : r.hb) * spow(c, c >= 0 ? (r.ey ?? 1) : (r.eyb ?? r.ey ?? 1));
      row.push([x, y, r.z]);
    }
    P.push(row);
  }
  const nS = nStations;
  for (let i = 0; i < nS; i++) {
    const row = [];
    const r = ring(i);
    for (let j = 0; j < nA; j++) {
      const p = P[i][j];
      const pl = P[i][(j + 1) % nA], pr = P[i][(j - 1 + nA) % nA];
      const qa = P[Math.min(nS - 1, i + 1)][j], qb = P[Math.max(0, i - 1)][j];
      let n = norm(cross(sub(pl, pr), sub(qb, qa)));
      // outward: away from the section centre
      const out = [p[0] - (r.x0 || 0), p[1] - r.cy, 0];
      if (dot(n, out) < 0) n = mul(n, -1);
      // degenerate (zero-size) sections: point along the axis
      if (!isFinite(n[0]) || Math.hypot(...n) < 0.5) n = [0, 0, i < nS / 2 ? 1 : -1];
      row.push(B.v(p, n, attr(i, j, TH[j], p, n)));
    }
    grid.push(row);
  }
  for (let i = 0; i < nS - 1; i++) {
    for (let j = 0; j < nA; j++) {
      const a = grid[i][j], b = grid[i][(j + 1) % nA], c = grid[i + 1][(j + 1) % nA], d = grid[i + 1][j];
      B.quadO(a, b, c, d);
    }
  }
  if (noseApex) {
    const r = ring(0);
    const ap = B.v(noseApex.p, noseApex.n || [0, 0, 1], noseApex.a || attr(-1, 0, 0, noseApex.p, [0, 0, 1]));
    for (let j = 0; j < nA; j++) B.triO(ap, grid[0][j], grid[0][(j + 1) % nA]);
    void r;
  }
  if (tailApex) {
    const ap = B.v(tailApex.p, tailApex.n || [0, 0, -1], tailApex.a || attr(nS, 0, 0, tailApex.p, [0, 0, -1]));
    for (let j = 0; j < nA; j++) B.triO(ap, grid[nS - 1][(j + 1) % nA], grid[nS - 1][j]);
  }
  return { grid, P };
}

/**
 * A fin / wing membrane between rays: ray k runs from roots[k] to tips[k] through optional
 * mids[k] (quadratic), sampled with nSeg segments. Built two-sided (front and back copies with
 * opposite normals) so the material can cull back faces. attr(k, s, side) per vertex.
 * normalHint: approximate front normal (the side that faces `normalHint` is side +1).
 */
export function membrane(B, roots, tips, nSeg, attr, { mids = null, normalHint = [1, 0, 0], twoSided = true, thick = 0 } = {}) {
  const nR = roots.length;
  const pts = [];
  for (let k = 0; k < nR; k++) {
    const row = [];
    for (let s = 0; s <= nSeg; s++) {
      const u = s / nSeg;
      let p;
      if (mids && mids[k]) {
        const a = roots[k], m = mids[k], b = tips[k];
        const w0 = (1 - u) * (1 - u), w1 = 2 * u * (1 - u), w2 = u * u;
        p = [a[0] * w0 + m[0] * w1 + b[0] * w2, a[1] * w0 + m[1] * w1 + b[1] * w2, a[2] * w0 + m[2] * w1 + b[2] * w2];
      } else p = mix(roots[k], tips[k], u);
      row.push(p);
    }
    pts.push(row);
  }
  const hint = norm(normalHint);
  const sides = twoSided ? [1, -1] : [1];
  const out = [];
  for (const side of sides) {
    const ids = [];
    for (let k = 0; k < nR; k++) {
      const row = [];
      for (let s = 0; s <= nSeg; s++) {
        const p = pts[k][s];
        const ta = sub(pts[Math.min(nR - 1, k + 1)][s], pts[Math.max(0, k - 1)][s]);
        const tb = sub(pts[k][Math.min(nSeg, s + 1)], pts[k][Math.max(0, s - 1)]);
        let n = norm(cross(ta, tb));
        if (!isFinite(n[0]) || Math.hypot(...n) < 0.5) n = hint;
        if (dot(n, hint) < 0) n = mul(n, -1);
        n = mul(n, side);
        const q = thick ? add(p, mul(n, thick * 0.5)) : p;
        row.push(B.v(q, n, attr(k, s / nSeg, side, p)));
      }
      ids.push(row);
    }
    for (let k = 0; k < nR - 1; k++) {
      for (let s = 0; s < nSeg; s++) {
        B.quadO(ids[k][s], ids[k + 1][s], ids[k + 1][s + 1], ids[k][s + 1]);
      }
    }
    out.push(ids);
  }
  return out;
}

/**
 * A tube along a polyline path with per-point radius (rx, ry optional ellipse), closed at the
 * far end with an apex. frame: per-point { t (tangent), n (normal) } or derived from upHint.
 * attr(i, j, u, p, n) per vertex (u = 0..1 along the path).
 */
export function tube(B, path, radii, nSides, attr, { upHint = [0, 1, 0], capEnd = true, capStart = false, ry = null } = {}) {
  const n = path.length;
  const rings = [];
  let prevN = null;
  for (let i = 0; i < n; i++) {
    const t = norm(sub(path[Math.min(n - 1, i + 1)], path[Math.max(0, i - 1)]));
    let nn;
    if (prevN) {
      // parallel transport the previous normal
      nn = norm(sub(prevN, mul(t, dot(prevN, t))));
    } else {
      nn = norm(sub(upHint, mul(t, dot(upHint, t))));
      if (!isFinite(nn[0])) nn = norm(cross(t, [1, 0, 0]));
    }
    prevN = nn;
    const bn = cross(t, nn);
    const row = [];
    const u = i / (n - 1);
    const rx = radii[i], rr = ry ? ry[i] : radii[i];
    for (let j = 0; j < nSides; j++) {
      const a = (j / nSides) * TAU;
      const dir = add(mul(nn, Math.cos(a)), mul(bn, Math.sin(a)));
      const p = add(path[i], add(mul(nn, Math.cos(a) * rr), mul(bn, Math.sin(a) * rx)));
      row.push(B.v(p, dir, attr(i, j, u, p, dir)));
    }
    rings.push(row);
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < nSides; j++) {
      B.quadO(rings[i][j], rings[i][(j + 1) % nSides], rings[i + 1][(j + 1) % nSides], rings[i + 1][j]);
    }
  }
  if (capEnd) {
    const t = norm(sub(path[n - 1], path[n - 2]));
    const tip = add(path[n - 1], mul(t, radii[n - 1] * 0.6));
    const ap = B.v(tip, t, attr(n - 1, 0, 1, tip, t));
    for (let j = 0; j < nSides; j++) B.triO(ap, rings[n - 1][j], rings[n - 1][(j + 1) % nSides]);
  }
  if (capStart) {
    const t = norm(sub(path[0], path[1]));
    const tip = add(path[0], mul(t, radii[0] * 0.6));
    const ap = B.v(tip, t, attr(0, 0, 0, tip, t));
    for (let j = 0; j < nSides; j++) B.triO(ap, rings[0][(j + 1) % nSides], rings[0][j]);
  }
  return rings;
}

/** An ellipsoid (eyes, lure bulbs, joints). attr(nrm, p) per vertex. */
export function ellipsoid(B, c, r, nLat, nLon, attr, { rot = null } = {}) {
  const ids = [];
  for (let i = 0; i <= nLat; i++) {
    const th = (i / nLat) * Math.PI;
    const row = [];
    for (let j = 0; j < nLon; j++) {
      const ph = (j / nLon) * TAU;
      let n = [Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph)];
      let p = [n[0] * r[0], n[1] * r[1], n[2] * r[2]];
      let nn = norm([n[0] / r[0], n[1] / r[1], n[2] / r[2]]);
      if (rot) { p = rot(p); nn = rot(nn); }
      p = add(p, c);
      row.push(B.v(p, nn, attr(nn, p, i / nLat, j / nLon)));
    }
    ids.push(row);
  }
  for (let i = 0; i < nLat; i++) {
    for (let j = 0; j < nLon; j++) {
      B.quadO(ids[i][j], ids[i][(j + 1) % nLon], ids[i + 1][(j + 1) % nLon], ids[i + 1][j]);
    }
  }
  return ids;
}

/** Rotation helpers for building (column vectors). */
export function rotX(a) { const c = Math.cos(a), s = Math.sin(a); return (p) => [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c]; }
export function rotY(a) { const c = Math.cos(a), s = Math.sin(a); return (p) => [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]; }
export function rotZ(a) { const c = Math.cos(a), s = Math.sin(a); return (p) => [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]]; }
export function compose(...fs) { return (p) => fs.reduceRight((q, f) => f(q), p); }

/** Unit quad for sprite impostors (bubbles, plankton motes). */
export function quadGeometry() {
  const g = new InstancedBufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}
