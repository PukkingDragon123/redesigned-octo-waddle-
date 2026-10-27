// Hero landmarks: the Great Arch (a colossal banded rock arc spanning the route, after the
// floating-mountain concept art), stacked spires, and rock "bridges".
import { BufferGeometry, Float32BufferAttribute, Mesh, Vector3, Color } from 'three';
import { Noise } from '../core/noise.js';
import { rng, lerp, clamp, smoothstep, TAU } from '../core/math.js';
import { terrainMaterial } from '../render/materials.js';

const noise = new Noise(9090);
const STRATA = ['#cdbca2', '#a59cb2', '#d9c8ab', '#8f879c', '#bba289', '#ab9ea9', '#c9b59b'].map((h) => new Color(h));
const MOSS = new Color('#6e9257');
const GRASS = new Color('#86a566');

/**
 * Sweep an irregular rock cross-section along a curve.
 * pathFn(t) -> {p: Vector3, n: Vector3 (cross-section 'up'), b: Vector3 (cross-section 'side')}
 * thickFn(t) -> [up-extent, side-extent]
 */
function sweepRock(pathFn, thickFn, nAlong, nAround, seed, opts = {}) {
  const pos = [], col = [], grass = [], idx = [];
  const c = new Color();
  const phase = seed * 3.1;
  for (let i = 0; i <= nAlong; i++) {
    const t = i / nAlong;
    const { p, n, b } = pathFn(t);
    const [tu, tb] = thickFn(t);
    for (let j = 0; j < nAround; j++) {
      const a = (j / nAround) * TAU;
      const ca = Math.cos(a), sa = Math.sin(a);
      // rounded-rectangle-ish section with craggy noise and strata ledges
      const sq = 0.55;
      const ex = Math.sign(ca) * Math.pow(Math.abs(ca), sq), ey = Math.sign(sa) * Math.pow(Math.abs(sa), sq);
      const nn = noise.noise3(ca * 1.5 + phase, t * 9, sa * 1.5) * 0.16 + noise.noise3(ca * 4, t * 30 + phase, sa * 4) * 0.06;
      const band = Math.sin(t * 60 + ey * 4 + phase + noise.noise2(t * 7, phase) * 2) ;
      const ledge = Math.round(band * 1.4) / 1.4 * 0.045;
      const ru = tu * (1 + nn + ledge), rb = tb * (1 + nn * 0.8 + ledge);
      const v = p.clone().addScaledVector(n, ey * ru).addScaledVector(b, ex * rb);
      pos.push(v.x, v.y, v.z);
      const bi = Math.floor(((t * 13 + ey * 2.2 + phase) % STRATA.length + STRATA.length) % STRATA.length);
      c.copy(STRATA[bi]).lerp(STRATA[(bi + 2) % STRATA.length], 0.3 + 0.3 * noise.noise2(t * 20, ey * 3));
      const upness = n.y * ey;
      c.lerp(MOSS, smoothstep(0.35, 0.8, upness) * 0.6);
      pos.length; // keep
      col.push(c.r, c.g, c.b);
      grass.push(smoothstep(0.55, 0.9, upness) * (opts.grass ?? 1));
    }
  }
  for (let i = 0; i < nAlong; i++) {
    for (let j = 0; j < nAround; j++) {
      const a = i * nAround + j, b = i * nAround + ((j + 1) % nAround);
      const cc = (i + 1) * nAround + j, d = (i + 1) * nAround + ((j + 1) % nAround);
      idx.push(a, cc, b, b, cc, d);
    }
  }
  // cap ends
  for (const end of [0, nAlong]) {
    const centerIdx = pos.length / 3;
    const { p } = pathFn(end / nAlong);
    pos.push(p.x, p.y, p.z);
    col.push(STRATA[3].r, STRATA[3].g, STRATA[3].b);
    grass.push(0);
    for (let j = 0; j < nAround; j++) {
      const a = end * nAround + j, b = end * nAround + ((j + 1) % nAround);
      if (end === 0) idx.push(centerIdx, a, b);
      else idx.push(centerIdx, b, a);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.setAttribute('aGrass', new Float32BufferAttribute(grass, 1));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * The Great Arch. center: where the path passes under the apex; span: unit vector across
 * the path; along: path direction. radius: arc radius; the opening apex sits ~radius above
 * the feet.
 */
export function buildArch({ center, span, along, radius = 150, thick = 26, width = 44, seed = 7, a0 = 0.12, a1 = Math.PI - 0.18 }) {
  const up = new Vector3(0, 1, 0);
  const base = center.clone().addScaledVector(up, -radius * 0.82);
  const r = rng(seed);
  const pathFn = (t) => {
    const ang = lerp(a0, a1, t);
    const wob = noise.noise2(t * 3 + seed, 1.7) * radius * 0.06;
    const rr = radius + wob;
    const p = base.clone().addScaledVector(span, Math.cos(ang) * rr).addScaledVector(up, Math.sin(ang) * rr);
    // the arch leans and twists slightly
    p.addScaledVector(along, Math.sin(t * Math.PI) * radius * 0.08 + noise.noise2(t * 2, seed) * radius * 0.05);
    const n = span.clone().multiplyScalar(Math.cos(ang)).addScaledVector(up, Math.sin(ang)).normalize();
    return { p, n, b: along.clone() };
  };
  const thickFn = (t) => {
    const k = 1 + 0.35 * Math.pow(Math.abs(t - 0.5) * 2, 2); // thicker toward the feet
    return [thick * k, width * k * (0.85 + 0.15 * Math.sin(t * 9 + seed))];
  };
  const geo = sweepRock(pathFn, thickFn, 90, 22, seed);
  const mesh = new Mesh(geo, terrainMaterial());
  mesh.name = 'arch';
  const feet = [pathFn(0).p, pathFn(1).p];
  // sample points along the top for vegetation, and along the underside for vines
  const tops = [], unders = [];
  for (let i = 0; i < 40; i++) {
    const t = 0.05 + (i / 39) * 0.9;
    const { p, n } = pathFn(t);
    const [tu] = thickFn(t);
    tops.push({ p: p.clone().addScaledVector(n, tu * 0.95), n: n.clone(), t });
    unders.push({ p: p.clone().addScaledVector(n, -tu * 0.9), n: n.clone(), t });
  }
  // colliders: a chain of spheres along the arc, sized to the thickness, with side spheres
  // spreading them across the wider extent
  const colliders = [];
  for (let i = 0; i <= 30; i++) {
    const t = i / 30;
    const { p } = pathFn(t);
    const [tu, tb] = thickFn(t);
    const rr = tu * 0.95;
    colliders.push({ p, r: rr });
    if (tb > tu) for (const sgn of [-1, 1]) colliders.push({ p: p.clone().addScaledVector(along, sgn * (tb - tu)), r: rr });
  }
  return { mesh, feet, tops, unders, colliders };
}
