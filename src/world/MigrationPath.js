// The migration route: one seamless spline from the Dawn Cradle to the Oasis, with chapters
// (regions) along its arc length. Everything in the world is placed relative to this path.
import { CatmullRomCurve3, Vector3 } from 'three';
import { clamp } from '../core/math.js';

const POINTS = [
  [0, 150, 0], [60, 156, -480], [-30, 150, -980],
  [-150, 138, -1450], [-120, 120, -1860], [30, 146, -2260],
  [170, 168, -2700], [230, 176, -3200], [130, 166, -3700],
  [-40, 146, -4150], [-180, 140, -4600], [-150, 152, -5050],
  [0, 205, -5450], [90, 222, -5820], [70, 212, -6220],
  [-60, 186, -6700], [-130, 160, -7200], [-40, 150, -7700],
  [100, 166, -8200], [170, 196, -8700], [90, 212, -9200],
  [0, 262, -9600], [-20, 322, -10000], [-30, 332, -10500],
  [0, 322, -11200], [20, 316, -11800],
];

export const CHAPTERS = [
  { id: 'cradle', name: 'Dawn Cradle', start: 0, time: 'dawn', mood: 'dawn' },
  { id: 'valleys', name: 'Floating Valleys', start: 900, time: 'morning', mood: 'flight' },
  { id: 'krill', name: 'Krill Fields', start: 2600, time: 'noon', mood: 'krill' },
  { id: 'forest', name: 'Cloud Forest', start: 3900, time: 'afternoon', mood: 'forest' },
  { id: 'song', name: 'The Herd Song', start: 5400, time: 'golden', mood: 'song' },
  { id: 'night', name: 'Night Passage', start: 6250, time: 'night', mood: 'night' },
  { id: 'storm', name: 'The Storm', start: 6950, time: 'storm', mood: 'storm' },
  { id: 'falcon', name: 'The Falcon', start: 8350, time: 'stormDawn', mood: 'danger' },
  { id: 'wall', name: 'The Cloud Wall', start: 9350, time: 'stormDawn', mood: 'cloudwall' },
  { id: 'oasis', name: 'The Oasis', start: 9950, time: 'oasis', mood: 'oasis' },
];

export class MigrationPath {
  constructor() {
    this.curve = new CatmullRomCurve3(POINTS.map((p) => new Vector3(...p)), false, 'centripetal', 0.5);
    this.curve.arcLengthDivisions = 2000;
    this.length = this.curve.getLength();
    this.chapters = CHAPTERS.map((c, i) => Object.assign({ index: i }, c, { end: i + 1 < CHAPTERS.length ? CHAPTERS[i + 1].start : this.length }));
    this._t = new Vector3();
  }

  u(s) {
    return clamp(s / this.length, 0, 1);
  }

  pointAt(s, out = new Vector3()) {
    return this.curve.getPointAt(this.u(s), out);
  }

  tangentAt(s, out = new Vector3()) {
    return this.curve.getTangentAt(this.u(s), out).normalize();
  }

  /** Orthonormal frame at arc length s: forward along the path, right, up (world-up based). */
  frameAt(s) {
    const pos = this.pointAt(s);
    const fwd = this.tangentAt(s);
    const right = new Vector3().crossVectors(fwd, new Vector3(0, 1, 0)).normalize();
    const up = new Vector3().crossVectors(right, fwd).normalize();
    return { pos, fwd, right, up };
  }

  /** Point offset in the path frame: lateral (right), vertical (up), along (forward). */
  offsetAt(s, lateral = 0, vertical = 0, along = 0, out = new Vector3()) {
    const f = this.frameAt(s + along);
    return out.copy(f.pos).addScaledVector(f.right, lateral).addScaledVector(f.up, vertical);
  }

  chapterAt(s) {
    let c = this.chapters[0];
    for (const ch of this.chapters) if (s >= ch.start) c = ch;
    return c;
  }

  chapterById(id) {
    return this.chapters.find((c) => c.id === id);
  }

  /** Closest arc length to a world point (coarse search + refinement around a hint). */
  project(p, hint = null, window = 600) {
    const L = this.length;
    let best = 0, bestD = Infinity;
    const lo = hint === null ? 0 : Math.max(0, hint - window);
    const hi = hint === null ? L : Math.min(L, hint + window);
    const step = hint === null ? 40 : 10;
    for (let s = lo; s <= hi; s += step) {
      const d = this.pointAt(s, this._t).distanceToSquared(p);
      if (d < bestD) { bestD = d; best = s; }
    }
    let h = step * 0.5;
    for (let k = 0; k < 6; k++) {
      for (const s of [best - h, best + h]) {
        if (s < 0 || s > L) continue;
        const d = this.pointAt(s, this._t).distanceToSquared(p);
        if (d < bestD) { bestD = d; best = s; }
      }
      h *= 0.5;
    }
    return { s: best, dist: Math.sqrt(bestD) };
  }
}
