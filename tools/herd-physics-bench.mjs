// Headless (node) check of src/game/WhalePhysics.js with stand-in whales: stability at dt up to
// 0.05, no NaNs, overlap resolution, resting without jitter, and the solver's cost with 31 whales.
//   node tools/herd-physics-bench.mjs [dt=0.05] [n=31] [seconds=30]
import { Vector3, Quaternion, Euler } from 'three';
import { WhalePhysics } from '../src/game/WhalePhysics.js';

const [dtArg = '0.05', nArg = '31', secArg = '30'] = process.argv.slice(2);
const DT = +dtArg, N = +nArg, SECS = +secArg;
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

class FakeWhale {
  constructor(L, calf) {
    this.L = L; this.isCalf = calf; this.radius = L * (calf ? 0.24 : 0.19);
    this.pos = new Vector3(); this.vel = new Vector3();
    this.yaw = 0; this.pitch = 0; this.roll = 0; this.yawRate = 0; this.pitchRate = 0;
    this.quat = new Quaternion(); this.fwd = new Vector3(0, 0, 1); this.up = new Vector3(0, 1, 0); this.right = new Vector3(1, 0, 0);
    this.phys = { maxYawRate: calf ? 1.9 : 0.5, maxPitchRate: calf ? 1.5 : 0.45, sideDrag: calf ? 3.2 : 1.4 };
    this.anim = { bodyBob: 0, bumps: 0, bump() { this.bumps++; } };
    this.target = new Vector3();
    this.group = { visible: true };
    this._e = new Euler();
  }
  nearestOnBody(p, out) {
    const s = Math.max(-0.5 * this.L, Math.min(0.42 * this.L, out.copy(p).sub(this.pos).dot(this.fwd)));
    out.copy(this.pos).addScaledVector(this.fwd, s);
    const u = (s / this.L + 0.5) / 0.92;
    const r = this.L * (this.isCalf ? 0.15 : 0.11) * Math.max(0.15, Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, u * 0.9 + 0.05))), 0.6));
    return r;
  }
  _syncTransform() {
    this._e.set(-this.pitch, this.yaw, this.roll, 'YXZ');
    this.quat.setFromEuler(this._e);
    this.fwd.set(0, 0, 1).applyQuaternion(this.quat);
    this.up.set(0, 1, 0).applyQuaternion(this.quat);
    this.right.set(1, 0, 0).applyQuaternion(this.quat);
  }
  step(dt, speed) {
    // steer toward the target (pile-up), like Herd.steer + Whale.step in miniature
    const to = new Vector3().copy(this.target).sub(this.pos);
    const want = Math.atan2(to.x, to.z);
    let e = want - this.yaw; e = Math.atan2(Math.sin(e), Math.cos(e));
    this.yawRate += (4 * e - 3 * this.yawRate) * dt;
    this.yawRate = Math.max(-this.phys.maxYawRate, Math.min(this.phys.maxYawRate, this.yawRate));
    this.yaw += this.yawRate * dt;
    this.pitchRate += (-3 * this.pitchRate) * dt;
    this.pitch += this.pitchRate * dt;
    this.roll *= Math.exp(-2 * dt);
    this._syncTransform();
    const along = this.vel.dot(this.fwd);
    const side = this.vel.clone().addScaledVector(this.fwd, -along);
    const thrust = (speed - along) * 0.8;
    this.vel.copy(this.fwd).multiplyScalar(along + thrust * dt).addScaledVector(side, Math.exp(-this.phys.sideDrag * dt));
    this.pos.addScaledVector(this.vel, dt);
  }
}

const whales = [];
for (let i = 0; i < N; i++) {
  const calf = i % 3 === 0;
  const w = new FakeWhale(calf ? 4.2 + rnd() * 1.5 : 18 + rnd() * 16, calf);
  w.pos.set((rnd() - 0.5) * 120, (rnd() - 0.5) * 30, (rnd() - 0.5) * 120);
  w.yaw = rnd() * 6.28;
  w._syncTransform();
  w.target.set((rnd() - 0.5) * 10, (rnd() - 0.5) * 4, (rnd() - 0.5) * 10);
  whales.push(w);
}
const phys = new WhalePhysics();
let events = 0;
phys.onContact = () => events++;
for (const w of whales) phys.add(w);

const steps = Math.round(SECS / DT);
let worst = 0, nan = false, maxMs = 0, sumMs = 0;
const msList = [];
const restSpeeds = [];
for (let k = 0; k < steps; k++) {
  const settle = k * DT > SECS * 0.6; // last 40%: everyone stops pushing and rests together
  for (const w of whales) w.step(DT, settle ? 0 : (w.isCalf ? 9 : 5));
  const t0 = performance.now();
  phys.step(DT);
  const ms = performance.now() - t0;
  if (k > steps * 0.3) { sumMs += ms; maxMs = Math.max(maxMs, ms); msList.push(ms); }
  for (const w of whales) if (!Number.isFinite(w.pos.x + w.pos.y + w.pos.z + w.vel.x + w.yaw + w.roll)) nan = true;
  if (settle && k * DT > SECS * 0.85) for (const w of whales) restSpeeds.push(w.vel.length());
}
// remaining overlap between axes after the run
const a = new Vector3(), b = new Vector3();
for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
  const A = whales[i].wphys, B = whales[j].wphys;
  A.frame(); B.frame();
  const c = phys.contacts[0];
  phys._narrow(A, B, c);
  worst = Math.max(worst, -c.gap);
}
restSpeeds.sort((x, y) => x - y);
console.log(JSON.stringify({
  dt: DT, whales: N, steps, nan,
  solverMsAvg: +(sumMs / Math.max(1, steps * 0.7)).toFixed(4), solverMsMax: +maxMs.toFixed(3), solverMsP99: +(msList.sort((x, y) => x - y)[Math.floor(msList.length * 0.99)] || 0).toFixed(3),
  contactsLast: phys.stats.contacts, pairsLast: phys.stats.pairs, events,
  worstOverlapM: +worst.toFixed(3),
  restSpeedMedian: +(restSpeeds[restSpeeds.length >> 1] || 0).toFixed(4),
  restSpeedP95: +(restSpeeds[Math.floor(restSpeeds.length * 0.95)] || 0).toFixed(4),
  bumps: whales.reduce((s, w) => s + w.anim.bumps, 0),
}));
