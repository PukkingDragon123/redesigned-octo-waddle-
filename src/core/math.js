// Small math toolkit shared by every system.
import { Vector3, Quaternion, Color } from 'three';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const saturate = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, x) => (x - a) / (b - a);
export const remap = (x, a, b, c, d) => c + ((x - a) / (b - a)) * (d - c);
export const remapClamped = (x, a, b, c, d) => c + saturate((x - a) / (b - a)) * (d - c);
export const smoothstep = (a, b, x) => {
  const t = saturate((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const smootherstep = (a, b, x) => {
  const t = saturate((x - a) / (b - a));
  return t * t * t * (t * (t * 6 - 15) + 10);
};
export const easeInOut = (t) => t * t * (3 - 2 * t);
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t) => t * t * t;
export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

/** Frame-rate independent exponential approach. `rate` is ~1/time-constant. */
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));
export const dampVec3 = (v, target, rate, dt) => v.lerp(target, 1 - Math.exp(-rate * dt));
export const dampQuat = (q, target, rate, dt) => q.slerp(target, 1 - Math.exp(-rate * dt));
export const dampColor = (c, target, rate, dt) => c.lerp(target, 1 - Math.exp(-rate * dt));

/** Wrap an angle to [-PI, PI]. */
export const wrapAngle = (a) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};
export const dampAngle = (a, b, rate, dt) => a + wrapAngle(b - a) * (1 - Math.exp(-rate * dt));

/** Seeded PRNG (mulberry32). */
export function rng(seed = 1) {
  let s = seed >>> 0;
  const r = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (a, b) => a + (b - a) * r();
  r.int = (a, b) => Math.floor(a + (b - a + 1) * r());
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.sign = () => (r() < 0.5 ? -1 : 1);
  r.gauss = () => {
    let u = 0, v = 0;
    while (u === 0) u = r();
    while (v === 0) v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  };
  r.inSphere = (out = new Vector3()) => {
    for (;;) {
      out.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1);
      if (out.lengthSq() <= 1) return out;
    }
  };
  r.onSphere = (out = new Vector3()) => r.inSphere(out).normalize();
  return r;
}

export const hash1 = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
};

/**
 * Damped harmonic spring on a scalar. Slightly under-damped springs (zeta 0.5-0.7)
 * read as "alive"; critical damping reads as mechanical.
 */
export class Spring {
  constructor(value = 0, freq = 3, zeta = 0.6) {
    this.x = value;
    this.v = 0;
    this.target = value;
    this.freq = freq;
    this.zeta = zeta;
  }
  update(dt, target = this.target) {
    this.target = target;
    // Semi-implicit integration, sub-stepped for stability.
    const w = TAU * this.freq;
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = -w * w * (this.x - this.target) - 2 * this.zeta * w * this.v;
      this.v += a * h;
      this.x += this.v * h;
    }
    return this.x;
  }
  impulse(dv) { this.v += dv; }
  reset(v = 0) { this.x = v; this.v = 0; this.target = v; }
}

export class SpringVec3 {
  constructor(freq = 3, zeta = 0.6) {
    this.x = new Vector3();
    this.v = new Vector3();
    this.freq = freq;
    this.zeta = zeta;
  }
  update(dt, target) {
    const w = TAU * this.freq;
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const ax = -w * w * (this.x.x - target.x) - 2 * this.zeta * w * this.v.x;
      const ay = -w * w * (this.x.y - target.y) - 2 * this.zeta * w * this.v.y;
      const az = -w * w * (this.x.z - target.z) - 2 * this.zeta * w * this.v.z;
      this.v.x += ax * h; this.v.y += ay * h; this.v.z += az * h;
      this.x.x += this.v.x * h; this.x.y += this.v.y * h; this.x.z += this.v.z * h;
    }
    return this.x;
  }
  reset(p) { this.x.copy(p); this.v.set(0, 0, 0); }
}

/** sRGB hex -> linear Color */
export const lin = (hex, mul = 1) => new Color(hex).multiplyScalar(mul);

export const tmpV = () => new Vector3();
export const tmpQ = () => new Quaternion();

/** Shortest-arc yaw/pitch from a direction vector (Z forward convention). */
export function yawPitchFromDir(d) {
  return {
    yaw: Math.atan2(d.x, d.z),
    pitch: Math.asin(clamp(d.y, -1, 1)),
  };
}
export function dirFromYawPitch(yaw, pitch, out = new Vector3()) {
  const cp = Math.cos(pitch);
  return out.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp);
}

/** Catmull-Rom helper on arrays of Vector3 (centripetal-ish uniform). */
export function catmull(p0, p1, p2, p3, t, out) {
  const t2 = t * t, t3 = t2 * t;
  out.set(
    0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
    0.5 * (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
  );
  return out;
}
