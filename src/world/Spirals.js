// Spiral geometry toolkit for Vur Sok: logarithmic and conical spirals, a rock mesh builder with
// two primitives (a lathe of horizontal rings and a profile swept along a curve), a painter pass
// that turns geometry into material weights, and area-weighted surface sampling for scattering.
//
// Everything is deterministic per seed (no Math.random) and allocation-light so whole archipelagos
// build in a few hundred milliseconds behind the title menu.
import { BufferGeometry, BufferAttribute, Vector3 } from 'three';
import { clamp, lerp, smoothstep, TAU } from '../core/math.js';

// ---- spiral curves ------------------------------------------------------------------------

/**
 * Logarithmic spiral in the xz plane: rho(phi) = a * exp(b * phi). Ammonites grow with
 * b ~ 0.1-0.18 (the whorl expands 2-3x per turn).
 */
export class LogSpiral {
  constructor({ a = 10, b = 0.15, phi0 = 0, phi1 = TAU * 2, dir = 1, rot = 0 } = {}) {
    this.a = a; this.b = b; this.phi0 = phi0; this.phi1 = phi1; this.dir = dir; this.rot = rot;
    this.cosA = 1 / Math.sqrt(1 + b * b); // perpendicular distance per unit of radial gap
  }
  rho(phi) { return this.a * Math.exp(this.b * phi); }
  /** Point (local xz) at spiral angle phi. */
  point(phi, out = { x: 0, z: 0 }) {
    const r = this.rho(phi);
    const ang = this.dir * phi + this.rot;
    out.x = Math.cos(ang) * r;
    out.z = Math.sin(ang) * r;
    return out;
  }
  /** Unit tangent (xz) pointing toward increasing phi. */
  tangent(phi, out = { x: 0, z: 0 }) {
    const ang = this.dir * phi + this.rot;
    const c = Math.cos(ang), s = Math.sin(ang);
    // d/dphi (r cos, r sin) = r (b cos - dir sin, b sin + dir cos)
    let x = this.b * c - this.dir * s, z = this.b * s + this.dir * c;
    const l = Math.hypot(x, z);
    out.x = x / l; out.z = z / l;
    return out;
  }
  /**
   * Visit every arm crossing near a local point: cb(phi, d) with the clamped spiral angle and the
   * approximate perpendicular distance to that arm. Callers take the minimum of their own SDF
   * (arms differ in width, so the nearest centreline is not always the nearest surface).
   */
  arms(x, z, cb) {
    const rr = Math.hypot(x, z) + 1e-6;
    const th = (Math.atan2(z, x) - this.rot) * this.dir;
    const phiR = Math.log(rr / this.a) / this.b;
    const k = Math.round((phiR - th) / TAU);
    for (let dk = -1; dk <= 1; dk++) {
      let phi = th + TAU * (k + dk);
      const inRange = phi >= this.phi0 && phi <= this.phi1;
      phi = clamp(phi, this.phi0, this.phi1);
      let d;
      if (inRange) d = Math.abs(rr - this.rho(phi)) * this.cosA;
      else {
        const ang = this.dir * phi + this.rot, rp = this.rho(phi);
        d = Math.hypot(x - Math.cos(ang) * rp, z - Math.sin(ang) * rp);
      }
      cb(phi, d);
    }
  }
  /**
   * Nearest arm crossing to a local point: returns { phi, d } where phi is the (clamped) spiral
   * angle and d the approximate perpendicular distance to the arm (negative never; unsigned).
   * Analytic: the arm crosses the ray through p at rho = a exp(b (theta + 2 pi k)).
   */
  nearest(x, z, out = { phi: 0, d: 0, side: 0 }) {
    const rr = Math.hypot(x, z) + 1e-6;
    let th = (Math.atan2(z, x) - this.rot) * this.dir;
    // continuous phi at this radius
    const phiR = Math.log(rr / this.a) / this.b;
    const k = Math.round((phiR - th) / TAU);
    let best = Infinity, bestPhi = this.phi0, side = 0;
    for (let dk = -1; dk <= 1; dk++) {
      let phi = th + TAU * (k + dk);
      const inRange = phi >= this.phi0 && phi <= this.phi1;
      phi = clamp(phi, this.phi0, this.phi1);
      let d;
      if (inRange) {
        const rp = this.rho(phi);
        d = Math.abs(rr - rp) * this.cosA;
        if (d < best) { best = d; bestPhi = phi; side = rr > rp ? 1 : -1; }
      } else {
        const ang = this.dir * phi + this.rot, rp = this.rho(phi);
        d = Math.hypot(x - Math.cos(ang) * rp, z - Math.sin(ang) * rp);
        if (d < best) { best = d; bestPhi = phi; side = 0; }
      }
    }
    out.phi = bestPhi; out.d = best; out.side = side;
    return out;
  }
}

/** Conical helix: radius and height vary linearly with the turn parameter u (0..1). */
export function conicalHelix(u, { r0, r1, y0, y1, turns, phase = 0, dir = 1 }, out = new Vector3()) {
  const a = phase + dir * u * turns * TAU;
  const r = lerp(r0, r1, u);
  return out.set(Math.cos(a) * r, lerp(y0, y1, u), Math.sin(a) * r);
}

// ---- rock mesh builder ----------------------------------------------------------------------

/**
 * Accumulates rock vertices and triangles. Per vertex it stores position, a strata coordinate
 * (the height along the layering, which winds with the spiral), a cavity/AO term, and a tag
 * (primitive kind: lets the painter treat ledges, caps and stacks differently).
 */
export class RockMesh {
  constructor() {
    this.p = []; // xyz
    this.s = []; // strata coordinate
    this.ao = []; // cavity 0..1 (1 open)
    this.t = []; // tag
    this.idx = [];
  }
  get count() { return this.p.length / 3; }
  add(x, y, z, strata = y, ao = 1, tag = 0) {
    this.p.push(x, y, z);
    this.s.push(strata);
    this.ao.push(ao);
    this.t.push(tag);
    return this.count - 1;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  /** Connect two rows of vertex indices (same length) into quads. */
  strip(A, B, closed = false) {
    const n = A.length;
    const m = closed ? n : n - 1;
    for (let j = 0; j < m; j++) {
      const j1 = (j + 1) % n;
      this.idx.push(A[j], B[j], A[j1], A[j1], B[j], B[j1]);
    }
  }
  /** Fan from a centre vertex to a row. */
  fan(c, row, closed = true, flip = false) {
    const n = row.length;
    const m = closed ? n : n - 1;
    for (let j = 0; j < m; j++) {
      const j1 = (j + 1) % n;
      if (flip) this.idx.push(c, row[j], row[j1]);
      else this.idx.push(c, row[j1], row[j]);
    }
  }
  /** Append another RockMesh (translated). */
  append(o, dx = 0, dy = 0, dz = 0) {
    const base = this.count;
    for (let i = 0; i < o.p.length; i += 3) this.p.push(o.p[i] + dx, o.p[i + 1] + dy, o.p[i + 2] + dz);
    for (let i = 0; i < o.s.length; i++) { this.s.push(o.s[i]); this.ao.push(o.ao[i]); this.t.push(o.t[i]); }
    for (let i = 0; i < o.idx.length; i++) this.idx.push(o.idx[i] + base);
  }
}

/** Smooth vertex normals for an indexed triangle list (Float32Arrays). */
export function computeNormals(pos, idx) {
  const n = new Float32Array(pos.length);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    // area-weighted face normal
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    n[a] += nx; n[a + 1] += ny; n[a + 2] += nz;
    n[b] += nx; n[b + 1] += ny; n[b + 2] += nz;
    n[c] += nx; n[c + 1] += ny; n[c + 2] += nz;
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}

/**
 * Mean-curvature proxy per vertex: (average neighbour - vertex) . normal, divided by the mean edge
 * length and smoothed once. Positive in creases and hollows, negative on ridges, lips and corners.
 */
export function computeCurvature(pos, nor, idx) {
  const nV = pos.length / 3;
  const sx = new Float32Array(nV), sy = new Float32Array(nV), sz = new Float32Array(nV);
  const cnt = new Float32Array(nV), len = new Float32Array(nV);
  for (let t = 0; t < idx.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = idx[t + e], b = idx[t + ((e + 1) % 3)];
      const dx = pos[b * 3] - pos[a * 3], dy = pos[b * 3 + 1] - pos[a * 3 + 1], dz = pos[b * 3 + 2] - pos[a * 3 + 2];
      const l = Math.hypot(dx, dy, dz);
      sx[a] += dx; sy[a] += dy; sz[a] += dz; cnt[a]++; len[a] += l;
      sx[b] -= dx; sy[b] -= dy; sz[b] -= dz; cnt[b]++; len[b] += l;
    }
  }
  const k = new Float32Array(nV);
  for (let i = 0; i < nV; i++) {
    if (!cnt[i]) continue;
    const c = cnt[i], ml = len[i] / c || 1;
    k[i] = (sx[i] * nor[i * 3] + sy[i] * nor[i * 3 + 1] + sz[i] * nor[i * 3 + 2]) / c / ml;
  }
  // one smoothing pass over the edges
  const acc = new Float32Array(nV), w = new Float32Array(nV);
  for (let t = 0; t < idx.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = idx[t + e], b = idx[t + ((e + 1) % 3)];
      acc[a] += k[b]; w[a]++; acc[b] += k[a]; w[b]++;
    }
  }
  for (let i = 0; i < nV; i++) k[i] = w[i] ? k[i] * 0.5 + 0.5 * acc[i] / w[i] : k[i];
  return k;
}

/**
 * Lathe: horizontal rings stacked from yBot to the rim, then an optional cap.
 * spec: {
 *   ys: array of ring heights (bottom -> top), segs,
 *   radius(theta, y, ringIndex) -> r, center(y) -> [x, z] (lean),
 *   strata(theta, y) -> s, cavity(theta, y, r) -> ao,
 *   cap: { kind: 'dome'|'point'|'none', height, rings, bump(theta, f) }, tag
 * }
 * Returns { mesh, rim: [{x,y,z,theta}] } (rim = the top ring, for vines and waterfalls).
 */
export function lathe(spec, mesh = new RockMesh()) {
  const segs = spec.segs;
  const ys = spec.ys;
  const tag = spec.tag ?? 0;
  const rows = [];
  let rim = null;
  const cen = spec.center || (() => ZERO2);
  for (let i = 0; i < ys.length; i++) {
    const y = ys[i];
    const c = cen(y);
    const row = new Array(segs);
    const ringPts = [];
    for (let j = 0; j < segs; j++) {
      const th = (j / segs) * TAU;
      const r = Math.max(0.05, spec.radius(th, y, i));
      const x = c[0] + Math.cos(th) * r, z = c[1] + Math.sin(th) * r;
      const s = spec.strata ? spec.strata(th, y) : y;
      const ao = spec.cavity ? spec.cavity(th, y, r) : 1;
      row[j] = mesh.add(x, y, z, s, ao, tag);
      if (i === ys.length - 1) ringPts.push({ x, y, z, theta: th, r, ox: Math.cos(th), oz: Math.sin(th) });
    }
    if (i === ys.length - 1) rim = ringPts;
    rows.push(row);
  }
  for (let i = 0; i < rows.length - 1; i++) mesh.strip(rows[i], rows[i + 1], true);
  const cap = spec.cap || { kind: 'point' };
  const top = rows[rows.length - 1];
  const yTop = ys[ys.length - 1];
  const c = cen(yTop);
  if (cap.kind === 'dome') {
    // polar cap over the rim ring: a gentle dome with bumps (the meadow)
    const nR = cap.rings ?? 6;
    let prev = top;
    for (let k = 1; k <= nR; k++) {
      const f = 1 - k / (nR + 1); // radius fraction
      const row = new Array(segs);
      for (let j = 0; j < segs; j++) {
        const rp = rim[j];
        const dx = rp.x - c[0], dz = rp.z - c[1];
        const h = (cap.height ?? 2) * Math.pow(1 - f * f, 0.75) + (cap.bump ? cap.bump(rp.theta, f) : 0);
        const x = c[0] + dx * f, z = c[1] + dz * f;
        const y = yTop + h;
        row[j] = mesh.add(x, y, z, spec.strata ? spec.strata(rp.theta, y) : y, 1, tag | CAP);
      }
      mesh.strip(prev, row, true);
      prev = row;
    }
    const hc = (cap.height ?? 2) + (cap.bump ? cap.bump(0, 0) : 0);
    const ci = mesh.add(c[0], yTop + hc, c[1], spec.strata ? spec.strata(0, yTop + hc) : yTop + hc, 1, tag | CAP);
    mesh.fan(ci, prev, true, true);
  } else if (cap.kind === 'point') {
    const ci = mesh.add(c[0], yTop + (cap.height ?? 0.5), c[1], yTop, 1, tag | CAP);
    mesh.fan(ci, top, true, true);
  }
  return { mesh, rim };
}
const ZERO2 = [0, 0];

/** Tag bits. */
export const CAP = 1 << 4; // top cap / meadow surface
export const LEDGE = 1 << 5; // terrace / ridge crown
export const VOLCANIC = 1 << 6;
export const BASALT = 1 << 7;

/**
 * Sweep a 2D profile along a curve. frame(t) -> { p: Vector3, s: Vector3 (side), u: Vector3 (up) };
 * profile(t) -> Float32Array/array [a0, b0, a1, b1, ...] with a fixed count of points; each point
 * maps to p + s * a + u * b. opts: { n (steps), closed (profile loop), strata(t, k, P), cavity(t, k),
 * tag(t, k), capStart, capEnd }
 * Returns the RockMesh and the per-step rows (indices) so callers can find shoulders and rims.
 */
export function sweep(frame, profile, opts, mesh = new RockMesh()) {
  const n = opts.n;
  const rows = [];
  const P = new Vector3();
  let M = 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const f = frame(t);
    const pr = profile(t);
    M = pr.length / 2;
    const row = new Array(M);
    for (let k = 0; k < M; k++) {
      const a = pr[k * 2], b = pr[k * 2 + 1];
      P.copy(f.p).addScaledVector(f.s, a).addScaledVector(f.u, b);
      const s = opts.strata ? opts.strata(t, k, P, a, b) : P.y;
      const ao = opts.cavity ? opts.cavity(t, k, a, b) : 1;
      const tg = opts.tag ? opts.tag(t, k) : 0;
      row[k] = mesh.add(P.x, P.y, P.z, s, ao, tg);
    }
    rows.push(row);
  }
  for (let i = 0; i < n; i++) mesh.strip(rows[i], rows[i + 1], !!opts.closed);
  if (opts.capStart || opts.capEnd) {
    for (const [end, flip] of [[0, false], [n, true]]) {
      if ((end === 0 && !opts.capStart) || (end === n && !opts.capEnd)) continue;
      const row = rows[end];
      let cx = 0, cy = 0, cz = 0;
      for (const v of row) { cx += mesh.p[v * 3]; cy += mesh.p[v * 3 + 1]; cz += mesh.p[v * 3 + 2]; }
      const c = mesh.add(cx / M, cy / M, cz / M, cy / M, 0.6, 0);
      mesh.fan(c, row, !!opts.closed, flip);
    }
  }
  return { mesh, rows };
}

/** Rotation-minimizing frames along a sampled polyline (double reflection, Wang et al. 2008). */
export function rmFrames(points, up0 = new Vector3(0, 1, 0)) {
  const n = points.length;
  const T = [], U = [], S = [];
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)];
    T.push(new Vector3().subVectors(b, a).normalize());
  }
  let u = up0.clone().addScaledVector(T[0], -up0.dot(T[0])).normalize();
  if (u.lengthSq() < 1e-6) u.set(1, 0, 0);
  U.push(u.clone());
  S.push(new Vector3().crossVectors(T[0], u).normalize());
  const v1 = new Vector3(), rL = new Vector3(), tL = new Vector3();
  for (let i = 0; i < n - 1; i++) {
    v1.subVectors(points[i + 1], points[i]);
    const c1 = v1.dot(v1) || 1e-9;
    rL.copy(U[i]).addScaledVector(v1, (-2 / c1) * v1.dot(U[i]));
    tL.copy(T[i]).addScaledVector(v1, (-2 / c1) * v1.dot(T[i]));
    const v2 = new Vector3().subVectors(T[i + 1], tL);
    const c2 = v2.dot(v2) || 1e-9;
    const un = rL.clone().addScaledVector(v2, (-2 / c2) * v2.dot(rL)).normalize();
    U.push(un);
    S.push(new Vector3().crossVectors(T[i + 1], un).normalize());
  }
  return { T, U, S };
}

// ---- geometry assembly ------------------------------------------------------------------------

/**
 * Turn a RockMesh into a BufferGeometry, running `paint(i, out)` per vertex after normals are
 * known. paint receives (P, N, strata, ao, tag) and fills out = { r, g, b, grass, sand, kind, heat, ao }.
 */
export function finishGeometry(mesh, paint, opts = {}) {
  const nV = mesh.count;
  const pos = new Float32Array(mesh.p);
  const idx = nV > 65535 ? new Uint32Array(mesh.idx) : new Uint16Array(mesh.idx);
  const nor = computeNormals(pos, idx);
  const curv = computeCurvature(pos, nor, idx);
  const col = new Float32Array(nV * 3);
  const mat = new Float32Array(nV * 4);
  const ext = new Float32Array(nV * 3);
  const out = { r: 0.5, g: 0.5, b: 0.5, grass: 0, sand: 0, kind: 0, heat: 0, ao: 1, strata: 0 };
  const P = new Vector3(), N = new Vector3();
  for (let i = 0; i < nV; i++) {
    P.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    N.set(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]);
    out.grass = 0; out.sand = 0; out.kind = 0; out.heat = 0;
    // crevices darken (cavity AO), convex edges wear pale
    const k = curv[i];
    const cavity = smoothstep(0.04, 0.32, k), edge = smoothstep(0.04, 0.3, -k);
    out.ao = mesh.ao[i] * (1 - 0.55 * cavity);
    out.strata = mesh.s[i];
    out.edge = edge;
    out.cavity = cavity;
    paint(P, N, mesh.s[i], out.ao, mesh.t[i], out, i);
    col[i * 3] = out.r; col[i * 3 + 1] = out.g; col[i * 3 + 2] = out.b;
    mat[i * 4] = out.grass; mat[i * 4 + 1] = out.sand; mat[i * 4 + 2] = out.kind; mat[i * 4 + 3] = out.heat;
    ext[i * 3] = out.ao; ext[i * 3 + 1] = out.strata; ext[i * 3 + 2] = out.edge;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('normal', new BufferAttribute(nor, 3));
  geo.setAttribute('color', new BufferAttribute(col, 3));
  geo.setAttribute('aMat', new BufferAttribute(mat, 4));
  geo.setAttribute('aExt', new BufferAttribute(ext, 3));
  geo.setIndex(new BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  if (opts.keep) geo.userData.src = { pos, nor, mat, idx };
  return geo;
}

/**
 * Area-weighted random samples on a painted geometry. weight(P, N, mat4) -> w >= 0.
 * Returns [{ p: Vector3, n: Vector3, w }] (local coordinates of the geometry).
 */
export function sampleSurface(geo, count, weight, r) {
  const pos = geo.attributes.position.array, nor = geo.attributes.normal.array;
  const mat = geo.attributes.aMat.array;
  const idx = geo.index.array;
  const nT = idx.length / 3;
  const cdf = new Float32Array(nT);
  let acc = 0;
  const P = new Vector3(), N = new Vector3(), M = [0, 0, 0, 0];
  for (let t = 0; t < nT; t++) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    P.set((pos[a * 3] + pos[b * 3] + pos[c * 3]) / 3, (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3, (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[c * 3 + 2]) / 3);
    N.set(nor[a * 3] + nor[b * 3] + nor[c * 3], nor[a * 3 + 1] + nor[b * 3 + 1] + nor[c * 3 + 1], nor[a * 3 + 2] + nor[b * 3 + 2] + nor[c * 3 + 2]).normalize();
    for (let k = 0; k < 4; k++) M[k] = (mat[a * 4 + k] + mat[b * 4 + k] + mat[c * 4 + k]) / 3;
    const w = area * Math.max(0, weight(P, N, M));
    acc += w;
    cdf[t] = acc;
  }
  const out = [];
  if (acc <= 0) return out;
  for (let i = 0; i < count; i++) {
    const x = r() * acc;
    let lo = 0, hi = nT - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < x) lo = mid + 1; else hi = mid; }
    const t = lo;
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    let u = r(), v = r();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const w0 = 1 - u - v;
    const p = new Vector3(
      pos[a * 3] * w0 + pos[b * 3] * u + pos[c * 3] * v,
      pos[a * 3 + 1] * w0 + pos[b * 3 + 1] * u + pos[c * 3 + 1] * v,
      pos[a * 3 + 2] * w0 + pos[b * 3 + 2] * u + pos[c * 3 + 2] * v,
    );
    const n = new Vector3(
      nor[a * 3] * w0 + nor[b * 3] * u + nor[c * 3] * v,
      nor[a * 3 + 1] * w0 + nor[b * 3 + 1] * u + nor[c * 3 + 1] * v,
      nor[a * 3 + 2] * w0 + nor[b * 3 + 2] * u + nor[c * 3 + 2] * v,
    ).normalize();
    out.push({ p, n, grass: mat[a * 4] * w0 + mat[b * 4] * u + mat[c * 4] * v, sand: mat[a * 4 + 1] * w0 + mat[b * 4 + 1] * u + mat[c * 4 + 1] * v });
  }
  return out;
}

/** Keep samples at least `minD` apart (hash-grid rejection; first come first served). */
export function thin(samples, minD, existing = null) {
  const cell = minD;
  const grid = existing || new Map();
  const key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  const out = [];
  for (const s of samples) {
    const cx = Math.floor(s.p.x / cell), cz = Math.floor(s.p.z / cell);
    let ok = true;
    for (let dz = -1; dz <= 1 && ok; dz++) {
      for (let dx = -1; dx <= 1 && ok; dx++) {
        const l = grid.get(`${cx + dx},${cz + dz}`);
        if (!l) continue;
        for (const q of l) {
          if ((q.x - s.p.x) ** 2 + (q.z - s.p.z) ** 2 < minD * minD && Math.abs(q.y - s.p.y) < minD * 2) { ok = false; break; }
        }
      }
    }
    if (!ok) continue;
    const k = key(s.p.x, s.p.z);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(s.p);
    out.push(s);
  }
  return out;
}

/** Smooth maximum (polynomial), k = blend width. */
export function smax(a, b, k) {
  const h = clamp(0.5 + 0.5 * (a - b) / k, 0, 1);
  return lerp(b, a, h) + k * h * (1 - h);
}
export function smin(a, b, k) {
  return -smax(-a, -b, k);
}

/** Wave-cut notch profile: radius multiplier near the waterline (deepest just above y = 0). */
export function notch(y, depth = 0.12, center = 1.2, width = 2.2) {
  const d = (y - center) / width;
  return 1 - depth * Math.exp(-d * d);
}

/** Terraced strata steps: returns -1..1 with flat treads (k = sharpness). */
export function terrace(x, k = 0.7) {
  const f = x - Math.floor(x);
  const s = smoothstep(0.5 - k * 0.5, 0.5 + k * 0.5, f);
  return (Math.floor(x) + s) - x;
}

export { clamp, lerp, smoothstep, TAU };
