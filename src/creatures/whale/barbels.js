// Sensor whips: long barbels trailing beneath the mouth. Built once per type as thin tapered
// tubes in the jaw bone's frame; the vertex shader integrates each whip as a flexible rod (stiff
// at the fleshy root, limp toward the tip, its length preserved) bent by gravity, the relative
// wind and flight inertia, with its own natural curl and a slow travelling sway (they feel the
// water and air like catfish whiskers), so they hang in soft curves even in a still pose.
import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import { lerp } from '../../core/math.js';

const SEG = 22, SIDES = 7;

/** Returns { geo, count } with attributes: aB (index, along, angle, radius), aRoot, aDir. */
export function buildBarbels(A, jawAbs) {
  const P = A.P, L = A.L, calf = A.calf;
  const k = A.g.barbelScale ?? 1;
  // (t, m, side, length, root radius)
  const spec = calf
    ? [[0.986, -0.82, 1, 0.075, 0.0032], [0.986, -0.82, -1, 0.075, 0.0032], [0.93, -0.6, 1, 0.04, 0.0022], [0.93, -0.6, -1, 0.04, 0.0022]]
    : [[0.988, -0.84, 1, 0.15, 0.0026], [0.988, -0.84, -1, 0.15, 0.0026],
      [0.95, -0.66, 1, 0.075, 0.0018], [0.95, -0.66, -1, 0.075, 0.0018],
      [0.9, -0.55, 1, 0.055, 0.0015], [0.9, -0.55, -1, 0.055, 0.0015]];
  const pos = [], aB = [], aRoot = [], aDir = [], idx = [];
  spec.forEach(([t, m, side, len, rad], bi) => {
    const sp = A.spot(t, m, side);
    const root = sp.p.clone().addScaledVector(sp.n, -rad * L * 0.6).sub(jawAbs);
    // rest: the root sweeps out sideways and a little forward, then the whip droops and curls
    // back (the shader bends it); each whip leans its own way
    const h = Math.sin(bi * 12.9898 + (A.g.seed || 1) * 78.233) * 43758.5453;
    const j = h - Math.floor(h);
    const dir = new Vector3(side * (0.62 + 0.2 * j), -0.42 - 0.15 * j, 0.18 - 0.3 * j).normalize();
    for (let i = 0; i <= SEG; i++) {
      const a = i / SEG;
      // a fleshy root that narrows quickly, then a long fine whip
      const r = rad * L * k * 1.45 * lerp(1, 0.08, Math.pow(a, 0.55));
      for (let j = 0; j <= SIDES; j++) {
        pos.push(root.x, root.y, root.z);
        aB.push(bi, a, (j / SIDES) * Math.PI * 2, r);
        aRoot.push(root.x, root.y, root.z, len * L * k);
        aDir.push(dir.x, dir.y, dir.z);
      }
    }
    const base = bi * (SEG + 1) * (SIDES + 1);
    for (let i = 0; i < SEG; i++) {
      for (let j = 0; j < SIDES; j++) {
        const a = base + i * (SIDES + 1) + j, b = a + 1, c = a + SIDES + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
  });
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('aB', new Float32BufferAttribute(aB, 4));
  geo.setAttribute('aRoot', new Float32BufferAttribute(aRoot, 4));
  geo.setAttribute('aDir', new Float32BufferAttribute(aDir, 3));
  geo.setIndex(idx);
  return { geo, count: spec.length };
}
