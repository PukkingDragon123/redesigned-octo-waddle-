// The migration route: one seamless spline from the Dawn Lagoon to the Oasis, with chapters
// (regions) along its arc length. Everything in the world is placed relative to this path.
import { CatmullRomCurve3, Vector3 } from 'three';
import { clamp } from '../core/math.js';

// Vur Sok: the route skims the sea (y = 0) at 15-110 m, weaving between the spiral islands. The
// x/z course and the total arc length (~12.09 km) are those of the original route, so every chapter
// keeps its start; only the altitudes changed (the Feasting Shoals run at 15-30 m over the water).
const POINTS = [
  [0, 8, 0], [60, 22, -480], [-30, 45, -981],
  [-150, 70, -1451], [-120, 40, -1861], [30, 46, -2261],
  [170, 20, -2702], [230, 17, -3202], [130, 24, -3702],
  [-40, 70, -4153], [-180, 85, -4603], [-150, 75, -5053],
  [0, 55, -5454], [90, 50, -5824], [70, 45, -6224],
  [-60, 55, -6704], [-130, 80, -7205], [-40, 95, -7705],
  [100, 100, -8205], [170, 110, -8706], [90, 70, -9206],
  [0, 55, -9606], [-20, 65, -10007], [-30, 70, -10507],
  [0, 60, -11207], [20, 55, -11808],
];

export const CHAPTERS = [
  { id: 'cradle', name: 'Dawn Lagoon', start: 0, time: 'dawn', mood: 'dawn' },
  { id: 'valleys', name: 'The Spiral Reach', start: 900, time: 'morning', mood: 'flight' },
  { id: 'krill', name: 'The Feasting Shoals', start: 2600, time: 'noon', mood: 'krill' },
  { id: 'forest', name: 'The Coil Forest', start: 3900, time: 'afternoon', mood: 'forest' },
  { id: 'song', name: 'The Herd Song', start: 5400, time: 'golden', mood: 'song' },
  { id: 'night', name: 'Night Passage', start: 6250, time: 'night', mood: 'night' },
  { id: 'storm', name: 'The Storm', start: 6950, time: 'storm', mood: 'storm' },
  { id: 'falcon', name: 'The Falcon', start: 8350, time: 'stormDawn', mood: 'danger' },
  { id: 'wall', name: 'The Fog Wall', start: 9350, time: 'stormDawn', mood: 'cloudwall' },
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
