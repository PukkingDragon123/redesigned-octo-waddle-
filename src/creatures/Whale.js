// A skywhale entity: model + animator + flight physics. Used by the player calf and the herd.
import { Vector3, Quaternion, Euler } from 'three';
import { WhaleModel, T_ORIGIN } from './WhaleModel.js';
import { WhaleAnimator } from './WhaleAnimator.js';
import { clamp, damp, wrapAngle, lerp, smoothstep, dirFromYawPitch, TAU, easeInOutSine } from '../core/math.js';

const PHYS_CALF = {
  maxYawRate: 1.9, yawStiff: 16, yawDamp: 7.5,
  maxPitchRate: 1.5, pitchStiff: 14, pitchDamp: 7, maxPitch: 1.15,
  bankGain: 0.42, maxBank: 0.85, bankRate: 4,
  thrust: 9.5, surgeMul: 2.0, drag: 0.075, sideDrag: 3.2, sink: 1.1, brake: 1.6,
  diveGain: 6.5, climbCost: 0.35,
};
const PHYS_ADULT = {
  maxYawRate: 0.55, yawStiff: 3.0, yawDamp: 2.6,
  maxPitchRate: 0.45, pitchStiff: 2.6, pitchDamp: 2.4, maxPitch: 0.75,
  bankGain: 0.9, maxBank: 0.5, bankRate: 1.4,
  thrust: 5.0, surgeMul: 1.8, drag: 0.03, sideDrag: 1.4, sink: 0.6, brake: 0.8,
  diveGain: 4.0, climbCost: 0.3,
};

const _v = new Vector3();
const _v2 = new Vector3();
const _e = new Euler(0, 0, 0, 'YXZ');

export class Whale {
  constructor(genome, opts = {}) {
    this.genome = genome;
    this.name = genome.name;
    this.isCalf = !!genome.calf;
    this.model = new WhaleModel(genome);
    this.anim = new WhaleAnimator(this.model, genome.seed || 1);
    this.group = this.model.group;
    this.L = genome.length;
    this.radius = this.L * (this.isCalf ? 0.24 : 0.19);
    this.phys = Object.assign({}, this.isCalf ? PHYS_CALF : PHYS_ADULT, opts.phys || {});
    if (!this.isCalf) {
      // bigger whales are a little more ponderous
      const s = 22 / this.L;
      this.phys.maxYawRate *= Math.sqrt(s);
      this.phys.thrust *= Math.sqrt(1 / s) * 1.1;
    }
    this.pos = new Vector3();
    this.vel = new Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.yawRate = 0;
    this.pitchRate = 0;
    this.rollSpin = 0; // barrel roll progress 0..1 (0 = none)
    this.rollDir = 1;
    this.quat = new Quaternion();
    this.fwd = new Vector3(0, 0, 1);
    this.up = new Vector3(0, 1, 0);
    this.right = new Vector3(1, 0, 0);
    this.wind = new Vector3();
    this.drive = {
      effort: 0, glide: 0.5, climb: 0, mouth: 0, feed: 0, hum: 0, charge: 0, sing: 0, sleep: 0,
      fear: 0, happy: 0, excite: 0, tired: 0, lookAt: null,
    };
    this.ctl = { targetYaw: 0, targetPitch: 0, thrust: 0, surge: false, brake: 0, lift: 0 };
    this.lod = 0;
    this.visible = true;
    this.voice = null;
    this.energy = 1;
    this.lastBump = 0;
  }

  place(pos, yaw = 0, pitch = 0) {
    this.pos.copy(pos);
    this.yaw = yaw;
    this.pitch = pitch;
    this.ctl.targetYaw = yaw;
    this.ctl.targetPitch = pitch;
    this.vel.set(0, 0, 0);
    this._syncTransform();
  }

  barrelRoll(dir) {
    if (this.rollSpin > 0) return false;
    this.rollSpin = 0.0001;
    this.rollDir = dir;
    return true;
  }

  /** Flight integration. */
  step(dt) {
    const P = this.phys, c = this.ctl;
    // heading control (springs on yaw/pitch rates)
    const yawErr = wrapAngle(c.targetYaw - this.yaw);
    this.yawRate += (P.yawStiff * yawErr - P.yawDamp * this.yawRate) * dt;
    this.yawRate = clamp(this.yawRate, -P.maxYawRate, P.maxYawRate);
    this.yaw = wrapAngle(this.yaw + this.yawRate * dt);
    const tp = clamp(c.targetPitch, -P.maxPitch, P.maxPitch);
    this.pitchRate += (P.pitchStiff * (tp - this.pitch) - P.pitchDamp * this.pitchRate) * dt;
    this.pitchRate = clamp(this.pitchRate, -P.maxPitchRate, P.maxPitchRate);
    this.pitch = clamp(this.pitch + this.pitchRate * dt, -P.maxPitch - 0.1, P.maxPitch + 0.1);

    const speed = this.vel.length();
    const sf = smoothstep(0.5, 8, speed);
    // coordinated bank into turns
    const bankT = clamp(-this.yawRate * P.bankGain * (0.35 + 0.65 * sf), -P.maxBank, P.maxBank);
    this.roll = damp(this.roll, bankT, P.bankRate, dt);

    dirFromYawPitch(this.yaw, this.pitch, this.fwd);

    // forces
    const air = _v.copy(this.vel).sub(this.wind);
    const airSpeed = air.length();
    const climbing = Math.max(0, Math.sin(this.pitch));
    const diving = Math.max(0, -Math.sin(this.pitch));
    let thrust = P.thrust * c.thrust * (c.surge ? P.surgeMul : 1) * (1 - climbing * P.climbCost);
    thrust *= 0.55 + 0.45 * this.energy;
    const acc = _v2.copy(this.fwd).multiplyScalar(thrust);
    // dive: gravity accelerates along the body
    acc.addScaledVector(this.fwd, P.diveGain * diving * (0.5 + 0.5 * (1 - c.thrust)));
    // drag (quadratic, relative to the air)
    acc.addScaledVector(air, -P.drag * airSpeed);
    // buoyancy organs nearly cancel gravity; gliding at speed generates lift
    const lift = smoothstep(2, 9, speed) * 0.85 + c.thrust * 0.3 + c.lift;
    acc.y -= P.sink * clamp(1 - lift, 0, 1);
    this.vel.addScaledVector(acc, dt);
    // lateral drag: the body resists sliding sideways, so momentum turns with the heading
    const along = this.vel.dot(this.fwd);
    const side = _v.copy(this.vel).addScaledVector(this.fwd, -along);
    const sideKeep = Math.exp(-P.sideDrag * dt);
    this.vel.copy(this.fwd).multiplyScalar(along).addScaledVector(side, sideKeep);
    if (c.brake > 0) this.vel.multiplyScalar(Math.exp(-P.brake * c.brake * dt));
    this.pos.addScaledVector(this.vel, dt);

    // barrel roll
    if (this.rollSpin > 0) {
      this.rollSpin += dt / (this.isCalf ? 0.95 : 3.0);
      if (this.rollSpin >= 1) this.rollSpin = 0;
    }
    this._syncTransform();
  }

  _syncTransform() {
    let spin = 0;
    if (this.rollSpin > 0) spin = easeInOutSine(this.rollSpin) * TAU * this.rollDir;
    _e.set(-this.pitch, this.yaw, this.roll + spin, 'YXZ');
    this.quat.setFromEuler(_e);
    this.right.set(1, 0, 0).applyQuaternion(this.quat);
    this.up.set(0, 1, 0).applyQuaternion(this.quat);
    this.group.position.copy(this.pos);
    this.group.quaternion.copy(this.quat);
  }

  /** Collision proxy: writes the body-axis point nearest p to out and returns the body's radius there. */
  nearestOnBody(p, out) {
    const s = clamp(out.copy(p).sub(this.pos).dot(this.fwd), -0.5 * this.L, 0.42 * this.L);
    out.copy(this.pos).addScaledVector(this.fwd, s);
    const pr = this.model.prof(T_ORIGIN + s / this.L);
    out.addScaledVector(this.up, pr.cy);
    return Math.max(pr.hw, pr.top, pr.bot);
  }

  /** Animate (call after step). */
  animate(dt, camPos) {
    const d = camPos ? this.pos.distanceTo(camPos) : 0;
    // level of detail for fur and facial animation: about one shell per pixel of fur
    // height on screen (mane fur is longer), so layers never separate at silhouettes
    const furFar = this.isCalf ? 160 : 620;
    const furPx = (this.model.u.uFurLen.value * 1.6 * Whale.pxPerRad) / Math.max(d, 0.5);
    const max = this.model.maxShells * (this.furQuality ?? 1);
    this.model.setFurShells(d < furFar && furPx > 0.5 ? Math.ceil(clamp(furPx * 1.5, 4, max)) : 0);
    this.lod = d < (this.isCalf ? 60 : 250) ? 0 : d < (this.isCalf ? 200 : 900) ? 1 : 2;
    const dr = this.drive;
    const s = this._animState || (this._animState = {});
    s.vel = this.vel;
    s.quat = this.quat;
    s.angVel = { yaw: this.yawRate, pitch: this.pitchRate, roll: 0 };
    s.effort = dr.effort;
    s.glide = dr.glide;
    s.climb = dr.climb;
    s.mouth = dr.mouth;
    s.feed = dr.feed;
    s.hum = dr.hum;
    s.charge = dr.charge;
    s.sing = dr.sing;
    s.sleep = dr.sleep;
    s.fear = dr.fear;
    s.happy = dr.happy;
    s.excite = dr.excite;
    s.tired = dr.tired;
    s.lookAt = dr.lookAt;
    s.worldPos = this.pos;
    s.wind = this.wind;
    this.anim.update(dt, s, this.lod);
  }
}

/** Screen pixels per radian at the centre of the view; kept current by the game loop. */
Whale.pxPerRad = 1100;
