// Geometry accumulator for the whale builders: one vertex layout for every merged part, skin
// weights by bone name, explicit seam welding and compact typed-array output.
import { BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, Uint32BufferAttribute, Vector3 } from 'three';

export class GeoAcc {
  /**
   * layout: { name: itemSize } extra float attributes (position / normal / skin are implicit).
   * boneIndex: { boneName: index }.
   */
  constructor(layout, boneIndex) {
    this.layout = layout;
    this.bi = boneIndex;
    this.pos = [];
    this.nor = [];
    this.si = [];
    this.sw = [];
    this.attr = {};
    for (const k in layout) this.attr[k] = [];
    this.idx = [];
    this.count = 0;
    this._noNormal = []; // vertices whose normal is authored (not recomputed)
  }

  /** v: { p: Vector3|[x,y,z], n?: Vector3, w: [[bone, weight], ...], <attr>: number|array } */
  add(v) {
    const p = v.p;
    if (Array.isArray(p)) this.pos.push(p[0], p[1], p[2]);
    else this.pos.push(p.x, p.y, p.z);
    if (v.n) {
      this.nor.push(v.n.x, v.n.y, v.n.z);
      if (v.keepNormal) this._noNormal.push(this.count);
    } else this.nor.push(0, 1, 0);
    for (const k in this.layout) {
      const n = this.layout[k];
      const a = this.attr[k];
      const val = v[k];
      if (val === undefined) for (let i = 0; i < n; i++) a.push(0);
      else if (typeof val === 'number') { a.push(val); for (let i = 1; i < n; i++) a.push(0); }
      else if (val.isVector3) a.push(val.x, val.y, val.z);
      else for (let i = 0; i < n; i++) a.push(val[i] ?? 0);
    }
    pushWeights(this.si, this.sw, v.w, this.bi);
    return this.count++;
  }

  tri(a, b, c) {
    this.idx.push(a, b, c);
  }

  quad(a, b, c, d) {
    // a-b along u, c-d the next row: (a, b, c), (b, d, c)
    this.idx.push(a, b, c, b, d, c);
  }

  /** Area-weighted normals for vertices [v0, v1) from triangles [i0, i1) of the index list. */
  computeNormals(v0, v1, i0 = 0, i1 = this.idx.length) {
    const P = this.pos, N = this.nor, I = this.idx;
    const keep = this._noNormal.length ? new Set(this._noNormal) : null;
    for (let v = v0; v < v1; v++) if (!keep || !keep.has(v)) { N[v * 3] = 0; N[v * 3 + 1] = 0; N[v * 3 + 2] = 0; }
    for (let i = i0; i < i1; i += 3) {
      const a = I[i], b = I[i + 1], c = I[i + 2];
      if (a < v0 || a >= v1) continue;
      const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
      const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az;
      const wx = P[c * 3] - ax, wy = P[c * 3 + 1] - ay, wz = P[c * 3 + 2] - az;
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      if (!keep || !keep.has(a)) { N[a * 3] += nx; N[a * 3 + 1] += ny; N[a * 3 + 2] += nz; }
      if (!keep || !keep.has(b)) { N[b * 3] += nx; N[b * 3 + 1] += ny; N[b * 3 + 2] += nz; }
      if (!keep || !keep.has(c)) { N[c * 3] += nx; N[c * 3 + 1] += ny; N[c * 3 + 2] += nz; }
    }
    for (let v = v0; v < v1; v++) {
      if (keep && keep.has(v)) continue;
      const l = Math.hypot(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]) || 1;
      N[v * 3] /= l; N[v * 3 + 1] /= l; N[v * 3 + 2] /= l;
    }
  }

  /** Average the normals of vertex pairs that share a position (seams). */
  weld(pairs) {
    const N = this.nor;
    for (const [a, b] of pairs) {
      const x = N[a * 3] + N[b * 3], y = N[a * 3 + 1] + N[b * 3 + 1], z = N[a * 3 + 2] + N[b * 3 + 2];
      const l = Math.hypot(x, y, z) || 1;
      N[a * 3] = N[b * 3] = x / l;
      N[a * 3 + 1] = N[b * 3 + 1] = y / l;
      N[a * 3 + 2] = N[b * 3 + 2] = z / l;
    }
  }

  /**
   * Recompute normals of the part [v0, count) / [i0, idx.length) and flip its winding when most
   * normals point toward inside(p) (a point inside the closed part, e.g. its axis).
   */
  orient(v0, i0, inside) {
    this.computeNormals(v0, this.count, i0, this.idx.length);
    const p = new Vector3(), n = new Vector3();
    let score = 0;
    for (let v = v0; v < this.count; v++) {
      this.getPos(v, p);
      this.getNormal(v, n);
      score += n.dot(p.sub(inside(this.getPos(v, new Vector3()))));
    }
    if (score < 0) {
      const I = this.idx;
      for (let i = i0; i < I.length; i += 3) { const b = I[i + 1]; I[i + 1] = I[i + 2]; I[i + 2] = b; }
      const N = this.nor;
      for (let v = v0; v < this.count; v++) { N[v * 3] *= -1; N[v * 3 + 1] *= -1; N[v * 3 + 2] *= -1; }
    }
    return score >= 0;
  }

  getNormal(v, out = new Vector3()) {
    return out.set(this.nor[v * 3], this.nor[v * 3 + 1], this.nor[v * 3 + 2]);
  }

  getPos(v, out = new Vector3()) {
    return out.set(this.pos[v * 3], this.pos[v * 3 + 1], this.pos[v * 3 + 2]);
  }

  build() {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new Float32BufferAttribute(this.nor, 3));
    for (const k in this.layout) geo.setAttribute(k, new Float32BufferAttribute(this.attr[k], this.layout[k]));
    geo.setAttribute('skinIndex', new Uint16BufferAttribute(this.si, 4));
    geo.setAttribute('skinWeight', new Float32BufferAttribute(this.sw, 4));
    geo.setIndex(this.count > 65535 ? new Uint32BufferAttribute(this.idx, 1) : this.idx);
    return geo;
  }
}

const _wb = new Int32Array(16), _ww = new Float64Array(16);
export function pushWeights(SI, SW, ws, bi) {
  // merge duplicate bones, keep the four strongest, normalise (allocation free)
  let n = 0;
  const list = ws || [['root', 1]];
  for (let k = 0; k < list.length; k++) {
    const e = list[k];
    const b = typeof e[0] === 'number' ? e[0] : bi[e[0]];
    const w = e[1];
    if (b === undefined || !(w > 1e-5)) continue;
    let j = 0;
    while (j < n && _wb[j] !== b) j++;
    if (j < n) _ww[j] += w;
    else if (n < 16) { _wb[n] = b; _ww[n] = w; n++; }
  }
  // partial selection sort for the top four
  let sum = 0;
  const m = Math.min(4, n);
  for (let k = 0; k < m; k++) {
    let best = k;
    for (let j = k + 1; j < n; j++) if (_ww[j] > _ww[best]) best = j;
    const tb = _wb[k], tw = _ww[k];
    _wb[k] = _wb[best]; _ww[k] = _ww[best];
    _wb[best] = tb; _ww[best] = tw;
    sum += _ww[k];
  }
  sum = sum || 1;
  for (let k = 0; k < 4; k++) {
    if (k < m) { SI.push(_wb[k]); SW.push(_ww[k] / sum); } else { SI.push(0); SW.push(0); }
  }
}

/** Blend two weight lists: (1 - k) * a + k * b. */
export function mixWeights(a, b, k) {
  const out = [];
  for (const [n, w] of a) out.push([n, w * (1 - k)]);
  for (const [n, w] of b) out.push([n, w * k]);
  return out;
}
