// Soft, bouncy collisions between whales: every whale is a tapered capsule along its body axis
// (the same proxy as Whale.nearestOnBody: tail to nose, radius from the body profile). Masses grow
// with the cube of length, so a calf bounces off its mother while she barely sways; contacts are
// rubbery (restitution with a speed threshold, friction, a soft positional correction), glancing
// bumps yaw, pitch and roll the bodies, and touching pairs that rest together go quiet (no bounce,
// no events, a gentle correction) so whales can lie against each other without jitter.
//
//   const phys = new WhalePhysics();
//   phys.add(whale);                       // or let step() register whales it meets
//   phys.step(dt, extraWhales);            // after every whale has stepped this frame
//   phys.onContact = (a, b, point, k) => {}; // a contact began (or a hard re-impact): k 0..2
//   phys.addListener(fn);                  // same signature, for the herd's behaviours
//   phys.touching(a, b, within)            // did a and b touch in the last `within` seconds?
//
// `point` passed to callbacks is a scratch vector: clone it to keep it. No per-frame allocations.
import { Vector3 } from 'three';
import { clamp } from '../core/math.js';

const MAX_IDS = 128; // whales the pair cache can track (herd 12 + Oasis gathering 19 = 31)
const N_PROF = 13; // radius samples along the axis
const MAX_CONTACTS = 256;
const S_TAIL = -0.5, S_NOSE = 0.42; // axis extent in body lengths (Whale.nearestOnBody)

const _d = new Vector3();
const _r = new Vector3();
const _pa = new Vector3();
const _pb = new Vector3();
const _t = new Vector3();
const _J = new Vector3();
const _tau = new Vector3();
const _dw = new Vector3();
const _rt = new Vector3();
const _q = new Vector3();
const _best = { gap: 0, ua: 0, ub: 0, d: 0 };
const _seg = { s: 0, t: 0 };

/** Per-whale collision body (kept on the whale as w.wphys). */
class Body {
  constructor(w, id) {
    this.w = w;
    this.id = id;
    const L = w.L || 10;
    this.L = L;
    this.sMin = S_TAIL * L;
    this.sMax = S_NOSE * L;
    this.len = this.sMax - this.sMin;
    this.r = new Float32Array(N_PROF);
    this.cy = new Float32Array(N_PROF);
    let rMax = 0, cySum = 0;
    for (let i = 0; i < N_PROF; i++) {
      const s = this.sMin + (i / (N_PROF - 1)) * this.len;
      let rad = w.radius || L * 0.2, cy = 0;
      if (w.nearestOnBody && w.pos && w.fwd && w.up) {
        // the body's own collision proxy (profile radius and axis height at s)
        _q.copy(w.pos).addScaledVector(w.fwd, s);
        rad = w.nearestOnBody(_q, _pa);
        cy = _pa.sub(w.pos).dot(w.up) - (w.anim?.bodyBob || 0);
      }
      this.r[i] = rad;
      this.cy[i] = cy;
      rMax = Math.max(rMax, rad);
      cySum += cy;
    }
    this.rMax = rMax;
    this.cyMean = cySum / N_PROF;
    for (let i = 0; i < N_PROF; i++) this.cy[i] -= this.cyMean;
    // mass ~ volume (length cubed, girth squared); inertia of a thick rod
    const g = w.genome?.girth ?? 1;
    this.m0 = Math.pow(L / 4, 3) * g * g * 10;
    this.massScale = 1;
    this.Ilong = 0;
    this.Itrans = 0;
    this.invM = 0;
    this.setMass(1);
    this.kick = new Vector3(); // bounce velocity the flight model's side drag does not eat
    this.rollVel = 0;
    // world frame, refreshed every step
    this.base = new Vector3(); // axis line origin (pos + up * mean axis height)
    this.dir = new Vector3(); // axis direction (nose), includes the gesture pose
    this.up = new Vector3();
    this.right = new Vector3();
    this.c = new Vector3(); // bounding sphere
    this.R = 0;
    this.moved = false;
    this.lastHit = -99;
    this.lastHitK = 0;
  }

  setMass(k) {
    this.massScale = k;
    const m = this.m0 * k;
    this.m = m;
    this.invM = k > 0 ? 1 / m : 0;
    const R = this.rMax;
    this.Ilong = Math.max(1e-3, 0.5 * m * R * R);
    this.Itrans = Math.max(1e-3, m * (this.len * this.len / 12 + R * R / 4));
  }

  /** Refresh the world-space axis from the whale's transform (and its gesture pose). */
  frame() {
    const w = this.w;
    const pq = w.anim?.poseQuat;
    if (pq && (pq.x !== 0 || pq.y !== 0 || pq.z !== 0)) {
      this.dir.set(0, 0, 1).applyQuaternion(pq).applyQuaternion(w.quat);
      this.up.set(0, 1, 0).applyQuaternion(pq).applyQuaternion(w.quat);
    } else {
      this.dir.copy(w.fwd);
      this.up.copy(w.up);
    }
    this.right.crossVectors(this.up, this.dir);
    const bob = w.anim?.bodyBob || 0;
    this.base.copy(w.pos).addScaledVector(this.up, this.cyMean + bob);
    this.c.copy(this.base).addScaledVector(this.dir, (this.sMin + this.sMax) * 0.5);
    this.R = this.len * 0.5 + this.rMax;
  }

  _lerp(arr, u) {
    const x = clamp(u, 0, 1) * (N_PROF - 1);
    const i = Math.min(N_PROF - 2, x | 0);
    const f = x - i;
    return arr[i] + (arr[i + 1] - arr[i]) * f;
  }

  radiusAt(u) { return this._lerp(this.r, u); }

  /** Axis point at u (0 tail .. 1 nose), with the profile's axis height. */
  pointAt(u, out) {
    return out.copy(this.base).addScaledVector(this.dir, this.sMin + u * this.len).addScaledVector(this.up, this._lerp(this.cy, u));
  }

  /** Parameter u of the straight axis line closest to p. */
  project(p) {
    _q.copy(p).sub(this.base);
    return clamp((_q.dot(this.dir) - this.sMin) / this.len, 0, 1);
  }
}

class Contact {
  constructor() {
    this.A = null;
    this.B = null;
    this.n = new Vector3(); // from B to A
    this.p = new Vector3(); // contact point (between the surfaces)
    this.gap = 0;
    this.ua = 0;
    this.ub = 0;
    this.pair = 0;
    this.vn0 = 0;
    this.target = 0;
    this.jn = 0;
    this.jt = 0;
    this.tdir = new Vector3();
    this.resting = false;
    this.touch = false;
  }
}

/** Closest parameters (0..1) between segments p1 + s*d1 and p2 + t*d2 (Ericson 5.1.9). */
function segSeg(p1, d1, p2, d2, out) {
  _r.copy(p1).sub(p2);
  const a = d1.lengthSq(), e = d2.lengthSq(), f = d2.dot(_r);
  let s, t;
  if (a <= 1e-9 && e <= 1e-9) { out.s = 0; out.t = 0; return out; }
  if (a <= 1e-9) { s = 0; t = clamp(f / e, 0, 1); }
  else {
    const c = d1.dot(_r);
    if (e <= 1e-9) { t = 0; s = clamp(-c / a, 0, 1); }
    else {
      const b = d1.dot(d2), den = a * e - b * b;
      s = den > 1e-9 ? clamp((b * f - c * e) / den, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  out.s = s;
  out.t = t;
  return out;
}

const _d1 = new Vector3();
const _d2 = new Vector3();
const _p1 = new Vector3();
const _p2 = new Vector3();

export class WhalePhysics {
  constructor(opts = {}) {
    this.enabled = true;
    this.restitution = opts.restitution ?? 0.55; // bouncy but soft
    this.bounceSpeed = opts.bounceSpeed ?? 0.7; // m/s: slower approaches do not bounce (resting contact)
    this.friction = opts.friction ?? 0.35;
    this.slop = opts.slop ?? 0.05; // m of overlap left alone (no jitter)
    this.correction = opts.correction ?? 9; // 1/s: how fast overlap is pushed out (soft bodies)
    this.restCorrection = opts.restCorrection ?? 3.5;
    this.angular = opts.angular ?? 0.4; // gain of the bump torque on yaw/pitch/roll
    this.sway = opts.sway ?? 0.14; // rad/s: the least a heavy whale sways when bumped
    this.kickGain = opts.kickGain ?? 0.55;
    this.radiusScale = opts.radiusScale ?? 0.97; // contact surface vs the profile's widest extent
    this.iterations = opts.iterations ?? 3;
    this.posIterations = opts.posIterations ?? 2;
    this.onContact = null; // (a, b, point, strength) => void
    this.listeners = [];
    this.time = 0;
    this.bodies = [];
    this._list = [];
    this._ids = 0;
    this._free = [];
    const n2 = MAX_IDS * MAX_IDS;
    this.touchT = new Float32Array(n2).fill(-99);
    this.restT = new Float32Array(n2);
    this.eventT = new Float32Array(n2).fill(-99);
    this.contacts = [];
    for (let i = 0; i < MAX_CONTACTS; i++) this.contacts.push(new Contact());
    this.nContacts = 0;
    this.stats = { bodies: 0, pairs: 0, contacts: 0, events: 0, ms: 0, msAvg: 0, msMax: 0 };
  }

  /** Register a whale (idempotent): it is solved every step. Returns its body. */
  add(w) {
    const b = this._body(w);
    if (b && !b.registered) { b.registered = true; this.bodies.push(b); }
    return b;
  }

  /** The whale's collision body (made on first use; extras get one without being registered). */
  _body(w) {
    if (w.wphys && w.wphys.owner === this) return w.wphys;
    const id = this._free.length ? this._free.pop() : this._ids++;
    if (id >= MAX_IDS) {
      if (!this._warned) console.warn('[WhalePhysics] too many whales');
      this._warned = true;
      return null;
    }
    const b = new Body(w, id);
    b.owner = this;
    b.registered = false;
    b.stamp = -1;
    w.wphys = b;
    return b;
  }

  remove(w) {
    const b = w.wphys;
    if (!b || b.owner !== this) return;
    if (b.registered) this.bodies.splice(this.bodies.indexOf(b), 1);
    this._free.push(b.id);
    for (let i = 0; i < MAX_IDS; i++) {
      const k1 = b.id * MAX_IDS + i, k2 = i * MAX_IDS + b.id;
      this.touchT[k1] = this.touchT[k2] = -99;
      this.eventT[k1] = this.eventT[k2] = -99;
      this.restT[k1] = this.restT[k2] = 0;
    }
    w.wphys = null;
  }

  /** Heavier or lighter than its size says (0 = immovable). */
  setMassScale(w, k) {
    (w.wphys || this.add(w))?.setMass(k);
  }

  addListener(fn) {
    this.listeners.push(fn);
  }

  /** Did a and b touch within the last `within` seconds? */
  touching(a, b, within = 0.3) {
    const A = a.wphys, B = b.wphys;
    if (!A || !B || A.owner !== this || B.owner !== this) return false;
    return this.time - this.touchT[this._pair(A, B)] < within;
  }

  /** Clear transient motion (teleports, chapter starts). */
  reset() {
    for (const b of this.bodies) { b.kick.set(0, 0, 0); b.rollVel = 0; }
    this.touchT.fill(-99);
    this.eventT.fill(-99);
    this.restT.fill(0);
  }

  _pair(A, B) {
    return A.id < B.id ? A.id * MAX_IDS + B.id : B.id * MAX_IDS + A.id;
  }

  /**
   * Resolve every contact between the registered whales and `extra` (array, optional).
   * Call once per frame after all whales have moved (Whale.step).
   */
  step(dt, extra = null) {
    if (!this.enabled || !(dt > 0)) return;
    const t0 = performance.now();
    this.time += dt;
    dt = Math.min(dt, 0.1);
    const list = this._list;
    list.length = 0;
    const stamp = (this._stamp = (this._stamp || 0) + 1);
    for (const b of this.bodies) if (this._live(b.w)) { b.stamp = stamp; list.push(b); }
    if (extra) {
      for (const w of extra) {
        if (!w || !this._live(w)) continue;
        const b = this._body(w);
        if (b && b.stamp !== stamp) { b.stamp = stamp; list.push(b); }
      }
    }
    // integrate the bounce channels, refresh the axes
    for (const b of list) {
      const w = b.w;
      b.moved = false;
      if (b.kick.lengthSq() > 1e-6) {
        w.pos.addScaledVector(b.kick, dt);
        const sub = w.water ? w.water.sub : 0;
        b.kick.multiplyScalar(Math.exp(-(2.4 + sub * 4) * dt));
        b.moved = true;
      }
      if (Math.abs(b.rollVel) > 1e-4) {
        w.roll += b.rollVel * dt;
        b.rollVel *= Math.exp(-3 * dt);
        b.moved = true;
      }
      if (b.moved) w._syncTransform?.();
      b.frame();
    }
    // broad phase (bounding spheres, padded by how far the pair closes this step) + narrow phase
    let nc = 0, pairs = 0;
    const n = list.length;
    for (let i = 0; i < n; i++) {
      const A = list[i];
      for (let j = i + 1; j < n; j++) {
        const B = list[j];
        if (A.invM === 0 && B.invM === 0) continue;
        const rel = _d.copy(A.w.vel).sub(B.w.vel).length() * dt + 0.3;
        const rr = A.R + B.R + rel;
        if (A.c.distanceToSquared(B.c) > rr * rr) continue;
        pairs++;
        if (nc >= MAX_CONTACTS) break;
        const c = this.contacts[nc];
        if (!this._narrow(A, B, c)) continue;
        if (c.gap > rel) continue;
        c.A = A;
        c.B = B;
        c.pair = this._pair(A, B);
        nc++;
      }
    }
    this.nContacts = nc;
    this._solveVelocities(nc, dt);
    this._respond(nc, dt);
    for (let it = 0; it < this.posIterations; it++) this._solvePositions(nc, dt);
    for (const b of list) if (b.moved) b.w._syncTransform?.();
    const ms = performance.now() - t0;
    const st = this.stats;
    st.bodies = n;
    st.pairs = pairs;
    st.contacts = nc;
    st.ms = ms;
    st.msAvg = st.msAvg ? st.msAvg * 0.95 + ms * 0.05 : ms;
    st.msMax = Math.max(st.msMax * 0.999, ms);
  }

  _live(w) {
    return w && w.pos && w.vel && w.physicsOff !== true && (!w.group || w.group.visible !== false || w.collideHidden);
  }

  /**
   * Narrow phase between two tapered capsules: closest points of the axis segments, refined by
   * sampling along A (the deepest point shifts toward the thick part of the body). Fills c.
   */
  _narrow(A, B, c) {
    _d1.copy(A.dir).multiplyScalar(A.len);
    _d2.copy(B.dir).multiplyScalar(B.len);
    _p1.copy(A.base).addScaledVector(A.dir, A.sMin);
    _p2.copy(B.base).addScaledVector(B.dir, B.sMin);
    segSeg(_p1, _d1, _p2, _d2, _seg);
    const ks = this.radiusScale;
    const best = _best;
    best.gap = Infinity;
    const u0 = _seg.s;
    const span = 0.22;
    for (let k = -2; k <= 2; k++) {
      const ua = clamp(u0 + k * span * 0.5, 0, 1);
      if (k !== 0 && ua === u0) continue;
      A.pointAt(ua, _pa);
      const ub = B.project(_pa);
      B.pointAt(ub, _pb);
      const d = _pa.distanceTo(_pb);
      const gap = d - (A.radiusAt(ua) + B.radiusAt(ub)) * ks;
      if (gap < best.gap) { best.gap = gap; best.ua = ua; best.ub = ub; best.d = d; }
    }
    // one more pass from B's side
    B.pointAt(best.ub, _pb);
    const ua2 = A.project(_pb);
    A.pointAt(ua2, _pa);
    const d2 = _pa.distanceTo(_pb);
    const gap2 = d2 - (A.radiusAt(ua2) + B.radiusAt(best.ub)) * ks;
    if (gap2 < best.gap) { best.gap = gap2; best.ua = ua2; best.d = d2; }
    else { A.pointAt(best.ua, _pa); B.pointAt(best.ub, _pb); }
    // normal from B to A
    if (best.d > 1e-4) c.n.copy(_pa).sub(_pb).divideScalar(best.d);
    else {
      c.n.copy(A.w.pos).sub(B.w.pos);
      if (c.n.lengthSq() < 1e-8) c.n.set(0, 1, 0);
      c.n.normalize();
    }
    c.gap = best.gap;
    c.ua = best.ua;
    c.ub = best.ub;
    const rb = B.radiusAt(best.ub) * ks;
    c.p.copy(_pb).addScaledVector(c.n, rb + best.gap * 0.5);
    return true;
  }

  _solveVelocities(nc, dt) {
    const e = this.restitution;
    for (let i = 0; i < nc; i++) {
      const c = this.contacts[i];
      const A = c.A, B = c.B;
      const vn = _d.copy(A.w.vel).sub(B.w.vel).dot(c.n);
      c.vn0 = vn;
      c.jn = 0;
      c.jt = 0;
      c.resting = this.restT[c.pair] > 0.5;
      // will they touch during this step? (speculative contact: no tunnelling at dt = 0.05)
      c.touch = c.gap <= 0 || vn * dt < -c.gap;
      if (!c.touch) { c.target = -Infinity; continue; }
      if (vn < -this.bounceSpeed && !c.resting) c.target = -e * vn;
      else c.target = c.gap > 0 ? -c.gap / dt : 0;
      // bounce channels never push into the contact
      const ka = A.kick.dot(c.n);
      if (ka < 0) A.kick.addScaledVector(c.n, -ka);
      const kb = B.kick.dot(c.n);
      if (kb > 0) B.kick.addScaledVector(c.n, -kb);
    }
    for (let it = 0; it < this.iterations; it++) {
      for (let i = 0; i < nc; i++) {
        const c = this.contacts[i];
        if (!c.touch) continue;
        const A = c.A, B = c.B;
        const im = A.invM + B.invM;
        if (im <= 0) continue;
        const vn = _d.copy(A.w.vel).sub(B.w.vel).dot(c.n);
        let jn = (c.target - vn) / im;
        const acc = Math.max(0, c.jn + jn);
        jn = acc - c.jn;
        c.jn = acc;
        if (jn !== 0) {
          A.w.vel.addScaledVector(c.n, jn * A.invM);
          B.w.vel.addScaledVector(c.n, -jn * B.invM);
        }
      }
    }
    // friction (once, Coulomb-limited by the normal impulse)
    for (let i = 0; i < nc; i++) {
      const c = this.contacts[i];
      if (!c.touch || c.jn <= 0) continue;
      const A = c.A, B = c.B;
      const im = A.invM + B.invM;
      _d.copy(A.w.vel).sub(B.w.vel);
      _t.copy(_d).addScaledVector(c.n, -_d.dot(c.n));
      const vt = _t.length();
      if (vt < 1e-3) continue;
      c.tdir.copy(_t).divideScalar(vt);
      const jt = Math.min(vt / im, this.friction * c.jn);
      c.jt = jt;
      A.w.vel.addScaledVector(c.tdir, -jt * A.invM);
      B.w.vel.addScaledVector(c.tdir, jt * B.invM);
    }
  }

  /** Angular response, bounce channels, pair bookkeeping and contact events. */
  _respond(nc, dt) {
    const now = this.time;
    for (let i = 0; i < nc; i++) {
      const c = this.contacts[i];
      if (!c.touch) continue;
      const A = c.A, B = c.B;
      // resting bookkeeping
      const vrel = _d.copy(A.w.vel).sub(B.w.vel).length();
      const was = now - this.touchT[c.pair] < 0.4;
      if (!was) this.restT[c.pair] = 0;
      this.restT[c.pair] = vrel < 0.6 ? this.restT[c.pair] + dt : 0;
      this.touchT[c.pair] = now;
      const approach = -c.vn0;
      const im = A.invM + B.invM;
      const shareA = im > 0 ? A.invM / im : 0.5;
      const strength = clamp(approach / 6, 0, 2);
      if (c.jn > 0 && !c.resting) {
        // the total impulse at the contact point: torque on each body
        _J.copy(c.n).multiplyScalar(c.jn).addScaledVector(c.tdir, -c.jt);
        this._spin(A, c.p, _J, 1, strength * (1 - shareA));
        this._spin(B, c.p, _J, -1, strength * shareA);
        // part of the sideways bounce survives the flight model's side drag
        this._kick(A, c.n, c.jn * A.invM);
        this._kick(B, c.n, -c.jn * B.invM);
      }
      const event = !c.resting && ((!was && approach > 0.05) || (was && approach > 2.5 && now - this.eventT[c.pair] > 0.4));
      if (!event) continue;
      this.eventT[c.pair] = now;
      this.stats.events++;
      const sA = strength * (0.35 + 0.65 * shareA), sB = strength * (0.35 + 0.65 * (1 - shareA));
      if (strength > 0.12) {
        A.w.anim?.bump?.(c.n, sA);
        _t.copy(c.n).negate();
        B.w.anim?.bump?.(_t, sB);
      }
      A.lastHit = B.lastHit = now;
      A.lastHitK = sA;
      B.lastHitK = sB;
      this.onContact?.(A.w, B.w, c.p, strength);
      for (let k = 0; k < this.listeners.length; k++) this.listeners[k](A.w, B.w, c.p, strength, c.n);
    }
  }

  /** Torque from impulse J (sign: +1 on A, -1 on B) at point p -> yaw / pitch / roll rates. */
  _spin(b, p, J, sign, swayK) {
    if (b.invM === 0) return;
    const w = b.w;
    _rt.copy(p).sub(w.pos);
    _tau.crossVectors(_rt, J).multiplyScalar(sign);
    const tl = _tau.dot(b.dir), tu = _tau.dot(b.up), tr = _tau.dot(b.right);
    const g = this.angular;
    _dw.set(0, 0, 0)
      .addScaledVector(b.dir, (tl / b.Ilong) * g * 0.35)
      .addScaledVector(b.up, (tu / b.Itrans) * g)
      .addScaledVector(b.right, (tr / b.Itrans) * g);
    // heavy whales still sway a little when something bumps them
    const mag = _dw.length();
    const want = this.sway * swayK;
    if (mag > 1e-6 && mag < want) _dw.multiplyScalar(want / mag);
    const calf = w.isCalf;
    const maxYaw = (w.phys?.maxYawRate ?? 1) * 1.5;
    w.yawRate = clamp((w.yawRate || 0) + _dw.y, -maxYaw, maxYaw);
    const maxPitch = (w.phys?.maxPitchRate ?? 1) * 1.5;
    w.pitchRate = clamp((w.pitchRate || 0) - _dw.dot(w.right), -maxPitch, maxPitch);
    const maxRoll = calf ? 3 : 0.45;
    b.rollVel = clamp(b.rollVel + _dw.dot(w.fwd), -maxRoll, maxRoll);
  }

  _kick(b, n, dv) {
    if (b.invM === 0) return;
    const w = b.w;
    // only the part across the body: the flight model keeps the part along it anyway
    _t.copy(n).multiplyScalar(dv);
    _t.addScaledVector(w.fwd, -_t.dot(w.fwd));
    b.kick.addScaledVector(_t, this.kickGain * (w.isCalf ? 1 : 0.6));
    const kl = b.kick.length();
    if (kl > 8) b.kick.multiplyScalar(8 / kl);
  }

  _solvePositions(nc, dt) {
    const kN = 1 - Math.exp(-this.correction * dt);
    const kR = 1 - Math.exp(-this.restCorrection * dt);
    for (let i = 0; i < nc; i++) {
      const c = this.contacts[i];
      const A = c.A, B = c.B;
      const im = A.invM + B.invM;
      if (im <= 0) continue;
      // re-measure with the current positions (earlier corrections moved them)
      if (A.moved) A.frame();
      if (B.moved) B.frame();
      A.pointAt(c.ua, _pa);
      B.pointAt(c.ub, _pb);
      _d.copy(_pa).sub(_pb);
      const d = _d.length();
      const depth = (A.radiusAt(c.ua) + B.radiusAt(c.ub)) * this.radiusScale - d;
      if (depth <= this.slop) continue;
      if (d > 1e-4) _d.divideScalar(d); else _d.copy(c.n);
      const corr = Math.min((depth - this.slop) * (c.resting ? kR : kN), 2.5 * dt * 10) / this.posIterations;
      A.w.pos.addScaledVector(_d, corr * A.invM / im);
      B.w.pos.addScaledVector(_d, -corr * B.invM / im);
      A.moved = A.invM > 0 || A.moved;
      B.moved = B.invM > 0 || B.moved;
      if (A.moved) A.frame();
      if (B.moved) B.frame();
    }
  }
}
