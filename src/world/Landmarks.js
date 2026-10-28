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

/** Transitional alias for the pre-Vur Sok builder signature. */
export function buildArch(o) {
  const a = buildSpiralArch({ center: o.center, span: o.span, along: o.along, seed: o.seed ?? 7 });
  return { mesh: a.mesh, colliders: a.colliders, tops: a.tops, unders: a.unders, feet: a.feet.map((f) => f.pos) };
}
