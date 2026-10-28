// The curled flying-whale embryo inside the egg: a big-headed calf folded in a spiral, tiny wing
// buds, rear fin buds, a coiled tail ending in soft flukes, four closed eyes. The body is a tube
// along a planar spiral spine (plus a little helix so the tail coils beside the body) that the CPU
// recomputes when the embryo twitches, uncurls or swims; the GPU bends the mesh along it.
import {
  BufferGeometry, Float32BufferAttribute, Mesh, ShaderMaterial, Vector3, Vector4, Vector2, Color, DoubleSide,
} from 'three';
import { G } from '../../render/Globals.js';
import { EMBRYO_VERT, EMBRYO_FRAG } from './shaders.js';

const NSPINE = 24;
const RINGS = 44;
const SEG = 18;

/** Body radius at spine parameter t (fraction of the length): a big rounded head, a short body,
 *  a long thin tail. Returns [lateral, dorsal] half-widths. */
function radius(t, L) {
  const head = 0.125 * Math.sqrt(Math.min(1, t / 0.085)) * (1 - 0.32 * smooth(0.11, 0.3, t));
  const taper = Math.pow(1 - smooth(0.33, 1.0, t), 0.95);
  const r = L * (head * taper + 0.01 * (1 - smooth(0.9, 1, t)) + 0.002);
  // the head is a little taller than wide (the cranium), the tail flattens toward the flukes
  return [r * (1 - 0.15 * smooth(0.7, 1, t)), r * (1 + 0.12 * (1 - smooth(0.05, 0.2, t)))];
}
function smooth(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Tube body + fins, in the spine frame. */
function buildGeometry(L) {
  const pos = [], nrm = [], aT = [], aOff = [], aRing = [], idx = [];
  // body tube (closed at the snout by a collapsed ring)
  for (let i = 0; i <= RINGS; i++) {
    const t = i / RINGS;
    const [rl, rd] = radius(t, L);
    for (let j = 0; j <= SEG; j++) {
      const a = (j / SEG) * Math.PI * 2 - Math.PI;
      const cy = Math.cos(a), cz = Math.sin(a);
      // a little forehead bulge and a soft keel under the tail stock
      const bulge = 1 + 0.12 * Math.exp(-(((t - 0.06) / 0.05) ** 2)) * Math.max(cy, 0);
      pos.push(0, 0, 0);
      aT.push(t);
      aOff.push(0, cy * rd * bulge, cz * rl);
      nrm.push(0, cy / rd, cz / rl);
      aRing.push(a, 0);
    }
  }
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < SEG; j++) {
      const a = i * (SEG + 1) + j, b = a + SEG + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  // fins: leaf-shaped double-sided blades rooted at t0, sweeping back (along -T) and out
  const fin = (t0, side, len, wid, down, sweep, flat = false) => {
    const base = pos.length / 3;
    const NU = 6, NV = 3;
    const [rl, rd] = radius(t0, L);
    for (let u = 0; u <= NU; u++) {
      const s = u / NU;
      const w = wid * Math.sin(Math.PI * Math.min(1, s * 0.9 + 0.1)) * (1 - 0.5 * s);
      for (let v = 0; v <= NV; v++) {
        const c = (v / NV - 0.5) * w;
        // root on the flank, the blade reaching out and back, a soft droop
        const along = -s * len * sweep + c * 0.6 - 0.02 * L;
        const out = flat ? rl + s * len : rl * 0.85 + s * len * 0.75;
        const dn = flat ? c * 0.15 : -rd * 0.2 - s * len * down + c * 0.4;
        pos.push(0, 0, 0);
        aT.push(t0 + (flat ? 0 : s * 0.02));
        aOff.push(along, dn, out * side);
        nrm.push(0, flat ? 1 : 0.55, flat ? 0 : 0.8 * side);
        aRing.push(side * 1.57, 1);
      }
    }
    for (let u = 0; u < NU; u++) {
      for (let v = 0; v < NV; v++) {
        const a = base + u * (NV + 1) + v, b = a + NV + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  };
  fin(0.27, 1, L * 0.16, L * 0.05, 0.45, 0.8);   // front wing buds
  fin(0.27, -1, L * 0.16, L * 0.05, 0.45, 0.8);
  fin(0.5, 1, L * 0.07, L * 0.03, 0.4, 0.7);      // rear pair
  fin(0.5, -1, L * 0.07, L * 0.03, 0.4, 0.7);
  fin(0.985, 1, L * 0.075, L * 0.045, 0, 0.25, true); // flukes
  fin(0.985, -1, L * 0.075, L * 0.045, 0, 0.25, true);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
  g.setAttribute('aT', new Float32BufferAttribute(aT, 1));
  g.setAttribute('aOff', new Float32BufferAttribute(aOff, 3));
  g.setAttribute('aRing', new Float32BufferAttribute(aRing, 2));
  g.setIndex(idx);
  // the spine moves the vertices on the GPU: bound generously
  g.boundingSphere = null;
  return g;
}

export class Embryo {
  /** L: body length (m) uncurled. */
  constructor(L = 2.6, { skin = '#e9b3a6', back = '#6f8cc4', fluid = '#ffb066' } = {}) {
    this.L = L;
    this.curl = 1;          // 1 curled in the egg .. 0 straight
    this.curlTarget = 1;
    this.twitch = 0;        // a kick's travelling bend (decays)
    this._kickT = 99;
    this._kickAmp = 0;
    this.time = 0;
    this.swim = 0;          // tail beat amplitude when out of the egg
    this.offset = new Vector3();   // egg-local placement of the spine's centre
    this.spine = Array.from({ length: NSPINE }, () => new Vector4());
    this.spineZ = Array.from({ length: NSPINE }, () => new Vector2());
    this.uniforms = Object.assign({}, G, {
      uSpine: { value: this.spine },
      uSpineZ: { value: this.spineZ },
      uGlow: { value: 1 },
      uBeat: { value: 0 },
      uSkin: { value: new Color(skin) },
      uBack: { value: new Color(back) },
      uFluid: { value: new Color(fluid) },
      uFade: { value: 1 },
      uInside: { value: 1 },
      uLocalSea: { value: 0 },
    });
    this.material = new ShaderMaterial({
      vertexShader: EMBRYO_VERT, fragmentShader: EMBRYO_FRAG, uniforms: this.uniforms, side: DoubleSide,
    });
    this.mesh = new Mesh(buildGeometry(L), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'egg-embryo';
    this.group = this.mesh;
    this._solve();
  }

  /** A twitch: a bend runs down the body (the egg's heart races a beat). strength ~0.3..1.5. */
  kick(strength = 1) {
    this._kickT = 0;
    this._kickAmp = Math.min(2, Math.max(0.1, strength));
    return this;
  }

  update(dt) {
    this.time += dt;
    this._kickT += dt;
    this.curl += (this.curlTarget - this.curl) * Math.min(1, dt * 1.6);
    this._solve();
  }

  /** Recompute the spine: a planar spiral whose curvature grows toward the tail, plus kick and swim. */
  _solve() {
    const L = this.L, n = NSPINE, ds = L / (n - 1);
    const c = this.curl;
    const kt = this._kickT, ka = this._kickAmp * Math.exp(-kt * 3.2) * (kt < 3 ? 1 : 0);
    const t0 = this.time;
    let ang = 0, x = 0, y = 0;
    let cx = 0, cy = 0;
    const sp = this.spine, sz = this.spineZ;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      // curvature (rad per m): the head tucked down to the chest, the tail wound into a spiral
      let k = c * (1.6 + 2.6 * t * t + 3.4 * smooth(0.7, 1, t)) / L * 2.2;
      // a kick: a bend wave racing tailward, and a nod of the head
      k += ka * Math.sin(t * 7 - kt * 14) * (0.4 + t) * 2.2 / L;
      // swimming: a travelling body wave, strongest at the tail
      k += this.swim * Math.sin(t * 6 - t0 * 7) * (0.2 + t * t) * 4 / L;
      if (i === 0) ang = -1.2 * c;
      sp[i].set(x, y, 0, ang);
      sz[i].set(0.11 * L * c * smooth(0.5, 1, t), 0);
      cx += x;
      cy += y;
      ang -= k * ds;
      x += Math.cos(ang) * ds;
      y += Math.sin(ang) * ds;
    }
    // centre it (the curled body sits in the middle of the egg)
    cx /= n;
    cy /= n;
    for (let i = 0; i < n; i++) {
      const s = sp[i];
      s.x += this.offset.x - cx;
      s.y += this.offset.y - cy;
      s.z += this.offset.z;
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
