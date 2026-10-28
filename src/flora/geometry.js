// Template builder for parametric plant geometry. Templates hold parameters, not posed vertices:
// the species vertex shader rebuilds the plant every frame from them.
//   position  vec3  species-specific parameters (usually s along the part, angle / across, part id)
//   aP        vec4  per-part parameters (placement in the cluster, lengths, angles)
//   aQ        vec4  more per-part parameters (sizes, phases, profile normal)
import { BufferAttribute, InstancedBufferGeometry } from 'three';

export class Template {
  constructor() {
    this.pos = [];
    this.p = [];
    this.q = [];
    this.idx = [];
  }
  get count() { return this.pos.length / 3; }
  /** Add one vertex. */
  v(x, y, z, p = null, q = null) {
    this.pos.push(x, y, z);
    if (p) this.p.push(p[0], p[1], p[2], p[3]); else this.p.push(0, 0, 0, 0);
    if (q) this.q.push(q[0], q[1], q[2], q[3]); else this.q.push(0, 0, 0, 0);
    return this.count - 1;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.idx.push(a, b, c, b, d, c); }
  /**
   * Grid of rows x cols vertices made by fn(i, j) -> vertex index (rows along the part, cols across
   * or around). Faces connect neighbouring rows. The front face points along (d col) x (d row);
   * flip reverses it. Shaders flip normals with gl_FrontFacing, so the winding must agree with the
   * normal the shader computes (lathes built row-up / angle-counterclockwise need flip).
   */
  grid(rows, cols, fn, flip = false) {
    const ids = [];
    for (let i = 0; i < rows; i++) {
      const row = [];
      for (let j = 0; j < cols; j++) row.push(fn(i, j));
      ids.push(row);
    }
    for (let i = 0; i < rows - 1; i++) {
      for (let j = 0; j < cols - 1; j++) {
        if (flip) this.quad(ids[i][j], ids[i + 1][j], ids[i][j + 1], ids[i + 1][j + 1]);
        else this.quad(ids[i][j], ids[i][j + 1], ids[i + 1][j], ids[i + 1][j + 1]);
      }
    }
    return ids;
  }
  /** Camera-facing strip along a part: n rings of two vertices (across -1, +1). */
  strip(n, fn) {
    return this.grid(n, 2, (i, j) => fn(i, j === 0 ? -1 : 1));
  }
  /** Finish: shared template attributes (used by several LOD geometries). */
  finish() {
    return {
      position: new BufferAttribute(new Float32Array(this.pos), 3),
      aP: new BufferAttribute(new Float32Array(this.p), 4),
      aQ: new BufferAttribute(new Float32Array(this.q), 4),
      index: new BufferAttribute(this.count > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), 1),
      tris: this.idx.length / 3,
      verts: this.count,
    };
  }
}

/** An instanced geometry from template attributes plus a set of instance attributes. */
export function instancedGeometry(tpl, inst) {
  const g = new InstancedBufferGeometry();
  g.setAttribute('position', tpl.position);
  g.setAttribute('aP', tpl.aP);
  g.setAttribute('aQ', tpl.aQ);
  g.setIndex(tpl.index);
  for (const k in inst) g.setAttribute(k, inst[k]);
  g.instanceCount = 0;
  return g;
}

/** Ring parameters denser where a curve bends: s values in [0, 1] from a curvature function. */
export function adaptiveRings(n, curvature, minStep = 0.012) {
  // integrate a density ~ 1 + curvature and invert it at n equal steps
  const M = 400;
  const cdf = new Float64Array(M + 1);
  for (let i = 1; i <= M; i++) {
    const s = (i - 0.5) / M;
    cdf[i] = cdf[i - 1] + (1 + curvature(s)) / M;
  }
  const total = cdf[M];
  const out = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    const target = (i / (n - 1)) * total;
    while (k < M && cdf[k + 1] < target) k++;
    const f = (target - cdf[k]) / Math.max(1e-9, cdf[k + 1] - cdf[k]);
    out.push(Math.min(1, (k + f) / M));
  }
  out[0] = 0;
  out[n - 1] = 1;
  for (let i = 1; i < n; i++) if (out[i] < out[i - 1] + minStep * 0.25) out[i] = Math.min(1, out[i - 1] + minStep * 0.25);
  return out;
}
