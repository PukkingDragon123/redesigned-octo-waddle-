// Hero landmarks of Vur Sok: the Spiral Arch (a rope of rock twisting over the route at the
// Spiral Reach, its feet planted in the sea as helical stacks).
import { Vector3 } from 'three';
import { Noise } from '../core/noise.js';
import { rng, lerp, clamp, smoothstep, TAU } from '../core/math.js';
import { RockMesh, sweep, rmFrames, finishGeometry, LEDGE } from './Spirals.js';
import { stackShape, rockPainter } from './Islands.js';
import { terrainMaterial } from '../render/materials.js';
import { Mesh } from 'three';

const noise = new Noise(9090);

/**
 * The Spiral Arch. center: the point on the route under the apex (y = sea level used for feet);
 * span: unit vector across the route; along: route direction. The arch rises from two stacks at
 * +-halfSpan, peaks at apexY, and its lobed cross-section twists `twist` turns along its length.
 */
export function buildSpiralArch({ center, span, along, halfSpan = 150, apexY = 110, thick = 15, twist = 1.5, seed = 7, rock = 'banded', det = 1 }) {
  const r = rng(seed);
  const up = new Vector3(0, 1, 0);
  const base = new Vector3(center.x, 0, center.z);
  // the arch curve: a leaning parabola with a gentle S in plan
  const N = 120;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = lerp(-halfSpan, halfSpan, t);
    const y = lerp(28, apexY, 1 - Math.pow(Math.abs(t - 0.5) * 2, 1.9)) + noise.noise2(t * 3 + seed, 0.5) * 4;
    const z = Math.sin(t * Math.PI * 2) * halfSpan * 0.08 + noise.noise2(t * 2, seed) * 6;
    pts.push(base.clone().addScaledVector(span, x).addScaledVector(along, z).addScaledVector(up, y));
  }
  const fr = rmFrames(pts, up);
  const thickAt = (t) => thick * (1 + 0.55 * Math.pow(Math.abs(t - 0.5) * 2, 2.2));
  const M = 26;
  const prof = new Float32Array(M * 2);
  const frame = (t) => {
    const i = Math.min(N, Math.round(t * N));
    return { p: pts[i], s: fr.S[i], u: fr.U[i] };
  };
  const profile = (t) => {
    const R = thickAt(t);
    const rot = t * twist * TAU + seed;
    for (let k = 0; k < M; k++) {
      const a = (k / M) * TAU;
      // three twisted lobes: a rope of rock
      let rr = R * (1 + 0.22 * Math.cos(3 * (a - rot)));
      rr *= 1 + 0.06 * noise.noise3(t * 14 + seed, Math.cos(a) * 1.5, Math.sin(a) * 1.5) + 0.03 * noise.noise3(t * 40, Math.cos(a) * 4 + seed, Math.sin(a) * 4);
      prof[k * 2] = Math.cos(a) * rr;
      prof[k * 2 + 1] = Math.sin(a) * rr * 0.85;
    }
    return prof;
  };
  const mesh = new RockMesh();
  const n = clamp(Math.round(N * det), 30, N);
  sweep(frame, profile, {
    n, closed: true,
    strata: (t, k, P) => P.y + t * 12.15,
    tag: (t, k) => (Math.sin((k / M) * TAU) > 0.6 ? LEDGE : 0),
  }, mesh);
  // the feet: two helical stacks the arch springs from
  const feet = [];
  for (const sgn of [-1, 1]) {
    const fp = base.clone().addScaledVector(span, sgn * halfSpan * 1.02);
    const st = stackShape({ R: thick * 2.1, H: 44, lobes: 3, lobeAmp: 0.2, twist: 0.5 * sgn, topFrac: 0.75, seed: seed + (sgn > 0 ? 3 : 5), cap: 'dome', capH: 4 });
    const b = st.build(det);
    mesh.append(b.mesh, fp.x, 0, fp.z);
    feet.push({ pos: fp, shape: st });
  }
  const geo = finishGeometry(mesh, rockPainter({ rock, seed }));
  const m = new Mesh(geo, terrainMaterial());
  m.name = 'spiral-arch';
  // colliders: spheres along the arch, plus the feet stacks (SDFs)
  const colliders = [];
  for (let i = 0; i <= N; i += 3) colliders.push({ p: pts[i].clone(), r: thickAt(i / N) * 1.1 });
  const tops = [], unders = [];
  for (let i = 6; i <= N - 6; i += 3) {
    const R = thickAt(i / N);
    tops.push({ p: pts[i].clone().addScaledVector(up, R * 0.8), n: up.clone() });
    unders.push({ p: pts[i].clone().addScaledVector(up, -R * 0.75), n: up.clone().negate() });
  }
  const apex = pts[Math.round(N / 2)].clone();
  return { mesh: m, colliders, feet, tops, unders, apex, points: pts };
}


// ---- cooling basalt: hexagonal columns stepping down into the sea ---------------------------------
import { BufferGeometry, BufferAttribute, InstancedMesh, Matrix4, Quaternion, Color } from 'three';

let _hexGeo = null;
/** Unit hexagonal prism (radius 1, height 1, base at y = 0) with a bevelled, worn top. */
export function hexColumnGeometry() {
  if (_hexGeo) return _hexGeo;
  const pos = [], nor = [], col = [], mat = [], ext = [], idx = [];
  const c0 = new Color('#3c3d43').multiplyScalar(0.9), c1 = new Color('#55524f').multiplyScalar(0.9);
  const ring = (y, r, ny, edge, c) => {
    const base = pos.length / 3;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU;
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
      const l = Math.hypot(Math.cos(a), ny, Math.sin(a));
      nor.push(Math.cos(a) / l * (1 - Math.abs(ny)), ny, Math.sin(a) / l * (1 - Math.abs(ny)));
      col.push(c.r, c.g, c.b);
      mat.push(0, 0, 1, 0);
      ext.push(edge > 0 ? 1 : 0.8, y, edge);
    }
    return base;
  };
  // sides as separate rings so the faces stay flat-shaded
  for (let k = 0; k < 6; k++) {
    const a0 = (k / 6) * TAU, a1 = ((k + 1) / 6) * TAU, am = (a0 + a1) / 2;
    const b = pos.length / 3;
    for (const [a, y] of [[a0, 0], [a1, 0], [a0, 0.94], [a1, 0.94]]) {
      pos.push(Math.cos(a), y, Math.sin(a));
      nor.push(Math.cos(am), 0, Math.sin(am));
      const c = y > 0.5 ? c1 : c0;
      col.push(c.r, c.g, c.b);
      mat.push(0, 0, 1, 0);
      ext.push(y > 0.5 ? 1 : 0.7, y, y > 0.5 ? 0.6 : 0);
    }
    idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
  }
  // bevel ring and top cap
  const rb = ring(0.94, 1, 0.5, 1, c1);
  const rt = ring(1.0, 0.86, 1, 0.7, c1);
  for (let k = 0; k < 6; k++) {
    const k1 = (k + 1) % 6;
    idx.push(rb + k, rt + k, rb + k1, rb + k1, rt + k, rt + k1);
  }
  const cIdx = pos.length / 3;
  pos.push(0, 1.0, 0); nor.push(0, 1, 0); col.push(c1.r, c1.g, c1.b); mat.push(0, 0, 1, 0); ext.push(1, 1, 0);
  for (let k = 0; k < 6; k++) idx.push(cIdx, rt + ((k + 1) % 6), rt + k);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setAttribute('aMat', new BufferAttribute(new Float32Array(mat), 4));
  g.setAttribute('aExt', new BufferAttribute(new Float32Array(ext), 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  _hexGeo = g;
  return g;
}

/**
 * A causeway of basalt columns around `center` (world, y ignored): a hex grid whose heights rise
 * in steps from the sea toward `up` (a horizontal direction), cracked into terraces.
 * Returns an array of Matrix4 (column instances).
 */
export function causeway(center, up, n, seed, o = {}) {
  const r = rng(seed);
  const out = [];
  const rad = o.radius ?? 0.85;
  const sp = rad * 1.74;
  const span = Math.max(2, Math.ceil(Math.sqrt(n) * 0.55));
  const m = new Matrix4(), q = new Quaternion(), s = new Vector3(), p = new Vector3();
  const side = new Vector3(-up.z, 0, up.x);
  for (let i = -span; i <= span; i++) {
    for (let j = -span; j <= span; j++) {
      const x = (i + (j & 1) * 0.5) * sp, z = j * sp * 0.866;
      const d = Math.hypot(x, z) / (span * sp);
      if (d > 1 || r() < d * 0.35) continue;
      const along = (x * up.x + z * up.z), across = (x * side.x + z * side.z);
      // terraces stepping up landward, with ragged edges
      let h = (o.base ?? -1.5) + Math.max(0, along / (span * sp) + 0.6) * (o.rise ?? 7) + noise.noise2(x * 0.15 + seed, z * 0.15) * 1.6;
      h = Math.round(h / 0.9) * 0.9 + (r() - 0.5) * 0.35;
      h *= 1 - 0.6 * Math.pow(d, 3);
      const len = h + 6;
      p.set(center.x + across * side.x + along * up.x, h - len, center.z + across * side.z + along * up.z);
      q.setFromAxisAngle(new Vector3(r() - 0.5, 0, r() - 0.5).normalize(), (r() - 0.5) * 0.06);
      s.set(rad * lerp(0.9, 1.05, r()), len, rad * lerp(0.9, 1.05, r()));
      m.compose(p, q, s);
      out.push(m.clone());
    }
  }
  return out;
}

/** Build one instanced mesh for a list of column matrices. */
export function basaltMesh(matrices) {
  const mesh = new InstancedMesh(hexColumnGeometry(), terrainMaterial(), matrices.length);
  for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i]);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.name = 'basalt-columns';
  return mesh;
}
