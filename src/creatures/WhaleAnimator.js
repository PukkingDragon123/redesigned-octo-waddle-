// Procedural, physics-aware animation for skywhales.
// Locomotion (asymmetric wingbeats with elbow lag and feathering, a dorso-ventral tail wave),
// pose layers (dive tuck, hover sculling, sleep curl, charge, song), spring-driven secondary
// motion (tail/fin/head follow-through) and a facial rig (lids, gaze, pupils, jaw, fronds).
import { Vector3, Quaternion, Euler, Matrix4 } from 'three';
import { Spring, SpringVec3, clamp, lerp, smoothstep, damp, TAU, rng } from '../core/math.js';

const CALF = {
  fMin: 1.0, fMax: 2.5, fGlide: 0.55, flapA: 0.62, glideA: 0.07, dihedral: 0.16,
  tailA: 0.15, bob: 0.06, breath: 0.33, zeta: 0.42, wobble: 1.0, jawMax: 0.5,
  neckLook: 0.45, blinkMin: 1.6, blinkMax: 4.5, sacBase: 0.45,
};
const ADULT = {
  fMin: 0.24, fMax: 0.62, fGlide: 0.15, flapA: 0.5, glideA: 0.05, dihedral: 0.12,
  tailA: 0.085, bob: 0.32, breath: 0.12, zeta: 0.62, wobble: 0.25, jawMax: 0.36,
  neckLook: 0.35, blinkMin: 2.5, blinkMax: 7.0, sacBase: 0.35,
};

const _q = new Quaternion();
const _e = new Euler();
const _v = new Vector3();
const _m = new Matrix4();

export class WhaleAnimator {
  constructor(model, seed = 1) {
    this.m = model;
    this.calf = !!model.g.calf;
    this.P = this.calf ? CALF : ADULT;
    this.b = model.bones;
    this.r = rng(seed * 7 + 3);
    this.phase = this.r() * TAU;
    this.breathPhase = this.r() * TAU;
    this.time = this.r() * 100;
    const z = this.P.zeta;

    // smoothed drivers
    this.effort = 0;
    this.glide = 0;
    this.freq = this.P.fMin;
    this.amp = this.P.glideA;
    this.dive = 0;
    this.hover = 0;
    this.sleep = 0;
    this.charge = 0;
    this.sing = 0;
    this.feed = 0;
    this.hum = 0;
    this.mouth = 0;
    this.fear = 0;
    this.happy = 0;
    this.excite = 0;
    this.tired = 0;
    this.roll = 0;

    // secondary motion springs
    this.sTailYaw = [0, 1, 2, 3, 4].map((i) => new Spring(0, (this.calf ? 2.6 : 1.1) - i * 0.12, z));
    this.sTailPitch = new Spring(0, this.calf ? 2.2 : 0.9, z);
    this.sHeadPitch = new Spring(0, this.calf ? 2.8 : 1.2, z);
    this.sHeadYaw = new Spring(0, this.calf ? 2.4 : 1.0, z);
    this.sFinLag = new Spring(0, this.calf ? 2.4 : 1.0, z * 0.9);
    this.sFinFlare = new Spring(0, this.calf ? 3.0 : 1.5, 0.5);
    this.sJolt = new Spring(0, this.calf ? 3.0 : 1.6, 0.45);
    this.inertia = new SpringVec3(this.calf ? 2.4 : 1.2, 0.35);
    this.lookYaw = 0;
    this.lookPitch = 0;

    // face
    this.blinkT = 1 + this.r() * 3;
    this.blink = 0;
    this.saccade = new Vector3();
    this.saccadeT = 0;
    this.gaze = new Vector3(0, 0, 1);
    this.lids = { up: 0.55, lo: -0.6, upC: -0.25, loC: 0.15 };
    this.pupil = model.eyes.R.u.uPupil.value;
    this.basePupil = this.pupil;
    this.clumsy = 0;
    this.clumsyT = 2 + this.r() * 4;

    this.prevVel = new Vector3();
    this.accel = new Vector3();
    this._invQ = new Quaternion();
    this.bodyBob = 0;
  }

  /** Trigger a sonic-boom recoil. */
  blast(strength = 1) {
    this.sJolt.impulse(-6 * strength);
    this.sFinFlare.impulse(9 * strength);
    this.mouthKick = 1;
  }

  /** Little hop/flinch (bumps, fright). */
  flinch(strength = 1) {
    this.sHeadPitch.impulse(-3 * strength);
    this.sFinLag.impulse(5 * strength);
    this.blinkT = 0;
  }

  /**
   * s: {
   *   vel (world Vector3), quat (world Quaternion), angVel {yaw,pitch,roll} (rad/s),
   *   effort 0..1, glide 0..1, climb -1..1, mouth 0..1, feed 0..1, hum 0..1, charge 0..1,
   *   sing 0..1, sleep 0..1, fear 0..1, happy 0..1, excite 0..1, tired 0..1,
   *   lookAt (world Vector3|null), worldPos (Vector3), wind (Vector3), rollSpin 0..1
   * }
   */
  update(dt, s, lod = 0) {
    const P = this.P, b = this.b, m = this.m;
    this.time += dt;
    const k = (rate) => 1 - Math.exp(-rate * dt);

    // ---- smoothed drivers --------------------------------------------------------
    const speed = s.vel.length();
    this.effort = damp(this.effort, s.effort ?? 0, this.calf ? 5 : 2.5, dt);
    this.glide = damp(this.glide, s.glide ?? 0, 2, dt);
    this.dive = damp(this.dive, clamp(-(s.climb ?? 0) * 1.4 - 0.3, 0, 1) * smoothstep(4, 12, speed * (this.calf ? 1.6 : 0.45)), 2.5, dt);
    this.hover = damp(this.hover, 1 - smoothstep(1.5, this.calf ? 5 : 8, speed), 2, dt);
    this.sleep = damp(this.sleep, s.sleep ?? 0, 0.8, dt);
    this.charge = damp(this.charge, s.charge ?? 0, 6, dt);
    this.sing = damp(this.sing, s.sing ?? 0, 2, dt);
    this.feed = damp(this.feed, s.feed ?? 0, 4, dt);
    this.hum = damp(this.hum, s.hum ?? 0, 8, dt);
    this.fear = damp(this.fear, s.fear ?? 0, 4, dt);
    this.happy = damp(this.happy, s.happy ?? 0, 2.5, dt);
    this.excite = damp(this.excite, s.excite ?? 0, 3, dt);
    this.tired = damp(this.tired, s.tired ?? 0, 1, dt);
    let mouthT = Math.max(s.mouth ?? 0, this.feed * 0.85, this.hum * 0.18, this.sing * 0.25);
    if (this.mouthKick) { mouthT = 1; this.mouthKick = Math.max(0, this.mouthKick - dt * 3); }
    this.mouth = damp(this.mouth, mouthT, this.calf ? 9 : 5, dt);

    // acceleration in world space (for fur inertia, fin lag)
    if (dt > 0) {
      this.accel.copy(s.vel).sub(this.prevVel).divideScalar(Math.max(dt, 1e-3));
      this.prevVel.copy(s.vel);
    }
    this.accel.clampLength(0, 40);

    // ---- wingbeat ------------------------------------------------------------------
    const eff = clamp(this.effort * (1 - this.tired * 0.35), 0, 1);
    const glideMix = clamp(this.glide * (1 - eff * 0.7), 0, 1);
    let fT = lerp(P.fMin, P.fMax, eff);
    fT = lerp(fT, P.fGlide, glideMix);
    fT = lerp(fT, P.fMin * 0.6, this.sleep);
    fT *= 1 + this.excite * 0.25;
    this.freq = damp(this.freq, fT, 3, dt);
    let aT = lerp(P.flapA * 0.55, P.flapA, eff);
    aT = lerp(aT, P.glideA, glideMix);
    aT *= 1 - this.dive * 0.75;
    aT *= 1 - this.sleep * 0.85;
    aT *= 1 - this.charge * 0.6;
    this.amp = damp(this.amp, aT, 3, dt);
    // calves are slightly irregular: a stroke now and then is a bit off
    if (this.calf) {
      this.clumsyT -= dt;
      if (this.clumsyT <= 0) {
        this.clumsy = (this.r() - 0.5) * 0.5;
        this.clumsyT = 1.5 + this.r() * 4;
      }
      this.clumsy = damp(this.clumsy, 0, 1.5, dt);
    }
    this.phase += TAU * this.freq * dt * (1 + this.clumsy * 0.3);
    const ph = this.phase;
    // skewed cycle: quick, powerful downstroke; slower recovery
    const sk = ph + 0.32 * Math.sin(ph);
    const flapPos = -Math.cos(sk); // -1 bottom .. 1 top
    const flapVel = Math.sin(sk) * (1 + 0.32 * Math.cos(ph)); // >0 rising
    const downstroke = 0.5 - 0.5 * Math.sin(sk); // smooth 0..1 (sin(sk) has flapVel's sign), no snap at reversal

    // body bob: the whole body rises on the downstroke
    this.bodyBob = -flapPos * P.bob * (0.3 + this.amp / P.flapA) * (1 - this.sleep);

    // ---- breathing ------------------------------------------------------------------
    const bRate = P.breath * (1 + this.tired * 1.6 + this.fear * 0.8 + this.excite * 0.4) * (1 - this.sleep * 0.4);
    this.breathPhase += TAU * bRate * dt;
    const breath = Math.sin(this.breathPhase);
    const breathIn = 0.5 + 0.5 * breath;

    // ---- turning & secondary motion ------------------------------------------------
    const yawRate = clamp(s.angVel?.yaw ?? 0, -2, 2);
    const pitchRate = clamp(s.angVel?.pitch ?? 0, -2, 2);
    const turn = clamp(yawRate / (this.calf ? 1.6 : 0.5), -1, 1);
    // local acceleration
    this._invQ.copy(s.quat).invert();
    const aLocal = _v.copy(this.accel).applyQuaternion(this._invQ);
    for (let i = 0; i < this.sTailYaw.length; i++) this.sTailYaw[i].update(dt, -turn * (0.06 + i * 0.03) * (this.calf ? 1.4 : 1));
    this.sTailPitch.update(dt, clamp(-pitchRate * 0.15 - aLocal.y * 0.006, -0.4, 0.4));
    this.sHeadPitch.update(dt, clamp(aLocal.y * 0.004 + aLocal.z * 0.003, -0.3, 0.3));
    this.sHeadYaw.update(dt, turn * 0.18);
    this.sFinLag.update(dt, clamp(-aLocal.y * (this.calf ? 0.03 : 0.015), -0.5, 0.5));
    this.sFinFlare.update(dt, 0);
    this.sJolt.update(dt, 0);

    // ---- look-at -----------------------------------------------------------------------
    let lyT = 0, lpT = 0;
    if (s.lookAt && s.worldPos) {
      _v.copy(s.lookAt).sub(s.worldPos).applyQuaternion(this._invQ);
      if (_v.lengthSq() > 1) {
        lyT = clamp(Math.atan2(_v.x, _v.z), -1.0, 1.0);
        lpT = clamp(Math.atan2(_v.y, Math.hypot(_v.x, _v.z)), -0.6, 0.6);
        if (_v.z < 0) lyT *= 0.6;
      }
    }
    this.lookYaw = damp(this.lookYaw, lyT, this.calf ? 4 : 2, dt);
    this.lookPitch = damp(this.lookPitch, lpT, this.calf ? 4 : 2, dt);

    // tremble while charging the throat organ
    const tr = this.charge * this.charge;
    const trem = (f, o) => Math.sin(this.time * f + o) * tr;

    // ---- spine --------------------------------------------------------------------------
    // tail: dorso-ventral travelling wave, stronger when swimming hard
    const tailAmp = P.tailA * (0.35 + eff * 0.9) * (1 - this.sleep * 0.7) * (1 - glideMix * 0.6) * (1 - this.dive * 0.5);
    const tph = ph - 1.2;
    const tailBones = ['spine1', 'spine2', 'tail1', 'tail2', 'tail3', 'fluke'];
    const tailW = [0.15, 0.35, 0.6, 0.85, 1.0, 1.1];
    const sleepCurl = this.sleep * 0.1;
    for (let i = 0; i < tailBones.length; i++) {
      const bone = b[tailBones[i]];
      const wave = Math.sin(tph - i * 0.55) * tailAmp * tailW[i];
      const yaw = (this.sTailYaw[Math.min(i, 4)].x) * (i > 0 ? 1 : 0.5) + trem(31 + i * 7, i) * 0.02;
      const pitch = wave + this.sTailPitch.x * (0.1 + i * 0.1) + sleepCurl * (i / 5) - this.charge * 0.05 * (i / 5)
        + this.sing * 0.03 * Math.sin(this.time * 0.8 - i * 0.4);
      bone.rotation.set(pitch, yaw, 0, 'YXZ');
    }
    // front: head steadied against the stroke, looks around, raises to sing
    const neck = b.neck, head = b.head, chest = b.chest;
    const steady = -Math.sin(tph + 0.6) * tailAmp * 0.25;
    const lookN = P.neckLook;
    chest.rotation.set(steady * 0.5 + trem(37, 1) * 0.01, this.lookYaw * 0.1, 0, 'YXZ');
    const singLift = this.sing * 0.12;
    const sleepDroop = this.sleep * 0.12;
    neck.rotation.set(
      steady + (-this.lookPitch * lookN * 0.5) - singLift * 0.5 + sleepDroop + this.sHeadPitch.x * 0.5 + this.sJolt.x * 0.04 + trem(43, 2) * 0.015,
      this.lookYaw * lookN * 0.5 + this.sHeadYaw.x * 0.5 + trem(39, 3) * 0.012,
      0, 'YXZ');
    head.rotation.set(
      (-this.lookPitch * lookN * 0.5) - singLift * 0.5 + sleepDroop + this.sHeadPitch.x * 0.5 + this.sJolt.x * 0.05,
      this.lookYaw * lookN * 0.5 + this.sHeadYaw.x * 0.5,
      Math.sin(this.time * 0.9) * 0.02 * this.happy, 'YXZ');
    // body bob carried by the root bone
    b.root.position.y = this.m.boneAbs.root.y + this.bodyBob;
    b.root.rotation.set(0, 0, 0);
    // jaw
    b.jaw.rotation.set(this.mouth * P.jawMax, 0, 0);

    // ---- fins ---------------------------------------------------------------------------
    const amp = this.amp;
    const dihedral = P.dihedral * (1 - this.dive) + glideMix * 0.06 - this.sleep * 0.3;
    for (const side of [1, -1]) {
      const sname = side > 0 ? 'R' : 'L';
      const outer = side > 0 ? -turn : turn; // outer fin works harder in a turn
      const a = amp * (1 + clamp(outer, -0.5, 0.5) * 0.45);
      // hover: sculling (sweep) rather than flapping
      const scull = this.hover * (1 - this.sleep) * Math.sin(ph) * 0.35;
      const flare = this.sFinFlare.x * 0.1;
      const lag = this.sFinLag.x;
      const shoulderFlap = dihedral + flapPos * a + lag * 0.4 + flare * 0.5 - this.charge * 0.25 + this.sing * 0.1 * Math.sin(this.time * 1.2);
      const shoulderSweep = this.dive * 0.75 + scull - flare * 0.4 + this.charge * 0.55 + this.sleep * 0.55;
      const shoulderTwist = -flapVel * a * 0.55 + this.hover * Math.cos(ph) * 0.3;
      // elbow lags the shoulder; the wing folds slightly on the upstroke
      const elbowFlap = -Math.cos(sk - 0.75) * a * 0.55 + lag * 0.3 + (1 - downstroke) * a * 0.15 - this.sleep * 0.6;
      const elbowSweep = (1 - downstroke) * a * 0.25 + this.dive * 0.35 + this.charge * 0.2 + this.sleep * 0.5;
      const elbowTwist = -Math.sin(sk - 0.8) * a * 0.35;
      const wristFlap = -Math.cos(sk - 1.4) * a * 0.45 + lag * 0.25 - this.sleep * 0.5;
      const wristTwist = -Math.sin(sk - 1.5) * a * 0.3;
      // left/right mirror: flap about Z and sweep about Y flip sign on the left
      const f1 = b['fin' + sname + '1'], f2 = b['fin' + sname + '2'], f3 = b['fin' + sname + '3'];
      f1.rotation.set(shoulderTwist, side * shoulderSweep, side * shoulderFlap, 'ZYX');
      f2.rotation.set(elbowTwist, side * elbowSweep, side * elbowFlap, 'ZYX');
      f3.rotation.set(wristTwist, 0, side * wristFlap, 'ZYX');
      // rear fins steer and paddle
      const r = b['rear' + sname];
      r.rotation.set(0.2 * Math.sin(ph - 0.5) * (0.3 + eff), side * (turn * 0.3), side * (0.2 * Math.sin(ph) * 0.4 - this.sleep * 0.3), 'ZYX');
      // membrane billow follows flap velocity
      const fm = m.fins[sname].material.uniforms;
      fm.uBillow.value = -flapVel * a * (this.calf ? 0.32 : 0.42) + lag * 0.1;
      fm.uFlutter.value = 0.006 + Math.min(speed, 30) * 0.0012;
    }
    for (const sname of ['R', 'L']) {
      const fl = m.flukes[sname].material.uniforms;
      fl.uBillow.value = -Math.cos(tph - 2.9) * tailAmp * 1.6;
      fl.uFlutter.value = 0.01 + Math.min(speed, 30) * 0.001;
    }

    // ---- organs -------------------------------------------------------------------------
    const u = m.u;
    const climb = s.climb ?? 0;
    u.uSac.value = clamp(P.sacBase + breath * 0.18 + climb * 0.25 + this.sing * 0.2 - this.dive * 0.25, 0, 1.2);
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 6.0);
    u.uThroat.value = clamp(this.hum * (0.45 + 0.1 * pulse) + this.charge * 1.0 + this.sing * 0.35 + this.feed * 0.25, 0, 1.4);
    u.uVib.value = clamp(this.hum * 0.35 + this.charge * 1.1 + this.sing * 0.15, 0, 1.4);
    u.uGill.value = clamp(this.feed + this.tired * 0.3, 0, 1);
    if (u.uBreath) u.uBreath.value = breath * (this.calf ? 1 : 0.6) * (1 + this.tired);

    // fur dynamics
    const air = _v.copy(s.wind || new Vector3()).sub(s.vel);
    u.uAirflow.value.copy(air).clampLength(0, 30);
    this.inertia.update(dt, this.accel);
    u.uInertia.value.copy(this.inertia.x).multiplyScalar(this.calf ? 0.02 : 0.012).clampLength(0, 0.6);

    // fronds
    const fu = m.frondU;
    const flareT = clamp(0.3 + this.feed * 0.7 + this.happy * 0.3 + this.excite * 0.2 + this.sing * 0.4 - this.fear * 0.6 - this.sleep * 0.3, 0, 1);
    fu.uFlare.value = damp(fu.uFlare.value, flareT, 3, dt);
    fu.uFlareF.value = fu.uFlare.value;
    fu.uStream.value = damp(fu.uStream.value, clamp(speed / (this.calf ? 12 : 20), 0, 1) + this.fear * 0.5, 3, dt);
    fu.uWiggle.value = damp(fu.uWiggle.value, 0.15 + this.excite * 0.6 + this.happy * 0.25 + this.fear * 0.4 + this.charge * 0.6, 3, dt);

    // ---- face ----------------------------------------------------------------------------
    if (lod < 2) this._face(dt, s);
  }

  _face(dt, s) {
    const P = this.P, m = this.m;
    // blinking
    this.blinkT -= dt;
    if (this.blinkT <= 0) {
      this.blink = 1;
      this.blinkT = lerp(P.blinkMin, P.blinkMax, this.r()) * (1 - this.tired * 0.5);
      if (this.r() < 0.15) this.blinkT = 0.25; // double blink
    }
    this.blink = Math.max(0, this.blink - dt * 7);
    const bl = Math.sin(Math.min(1, this.blink) * Math.PI);

    // expression targets
    let up = 0.55, lo = -0.62, upC = -0.25, loC = 0.12;
    const mix4 = (w, u2, l2, uc2, lc2) => {
      up = lerp(up, u2, w); lo = lerp(lo, l2, w); upC = lerp(upC, uc2, w); loC = lerp(loC, lc2, w);
    };
    mix4(this.happy * 0.8, 0.5, -0.08, -0.15, 0.75);
    mix4(this.sing * 0.7, 0.18, -0.22, -0.1, 0.5);
    mix4(this.charge, 0.22, -0.4, 0.05, 0.25);
    mix4(this.tired * 0.5, 0.2, -0.55, -0.2, 0.1);
    mix4(this.fear, 0.85, -0.9, -0.3, 0.05);
    mix4(this.sleep, -0.06, -0.12, -0.05, 0.2);
    const L = this.lids;
    L.up = damp(L.up, up, 14, dt);
    L.lo = damp(L.lo, lo, 14, dt);
    L.upC = damp(L.upC, upC, 10, dt);
    L.loC = damp(L.loC, loC, 10, dt);
    // blink closes toward the lower lid line; applied after the damping, which would swallow the short pulse
    const mid = (L.up + L.lo) * 0.5 + 0.08;
    const lidUp = lerp(L.up, mid, bl), lidLo = lerp(L.lo, mid - 0.02, bl);

    // pupils: big & round when happy (cute), pinpoint when frightened
    const pT = this.basePupil * (1 + this.happy * 0.15 + this.sing * 0.1 - this.fear * 0.45 + this.excite * 0.1);
    this.pupil = damp(this.pupil, pT, 6, dt);

    // gaze: toward look target with micro-saccades
    this.saccadeT -= dt;
    if (this.saccadeT <= 0) {
      this.saccade.set((this.r() - 0.5) * 0.12, (this.r() - 0.5) * 0.08, 0);
      this.saccadeT = 0.4 + this.r() * 1.8;
    }
    for (const sname of ['R', 'L']) {
      const eye = m.eyes[sname];
      const gz = _v.set(0, 0, 1);
      if (s.lookAt) {
        // target into socket space: world -> eye mesh local
        eye.mesh.updateWorldMatrix(true, false);
        _m.copy(eye.mesh.matrixWorld).invert();
        gz.copy(s.lookAt).applyMatrix4(_m).normalize();
        // limit within a cone
        if (gz.z < 0.55) {
          gz.z = 0.55;
          const xy = Math.hypot(gz.x, gz.y) || 1;
          const sc = Math.sqrt(1 - 0.55 * 0.55) / xy;
          gz.x *= sc; gz.y *= sc;
        }
      }
      gz.x += this.saccade.x;
      gz.y += this.saccade.y;
      gz.normalize();
      const eu = eye.u;
      eu.uGaze.value.lerp(gz, 1 - Math.exp(-18 * dt)).normalize();
      eu.uLids.value.set(lidUp, lidLo, L.upC, L.loC);
      eu.uPupil.value = this.pupil;
    }
  }
}
