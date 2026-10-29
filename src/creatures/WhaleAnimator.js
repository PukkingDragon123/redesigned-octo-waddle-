// Procedural, physics-aware animation for the whales of Vur Sok.
// Locomotion: heavy wingbeats (asymmetric stroke, elbow and wrist lag, feathering, membrane billow,
// the torn wing's loose flaps), a whale's dorso-ventral body wave that grows toward the flukes,
// fluke lobes that flex with the stroke. Layers on top: dive tuck, hover sculling, sleep, charge,
// song, social gestures (tailSlap, finSlap, spyhop, nuzzle, happyWiggle, breachArch, rollOver),
// and a bump response (squash-and-stretch jiggle on a spring, a blink, surprise then delight).
// Organs: the throat bellows, the sensor crest, the horn vents, the sonic dome, the blowholes and
// the heat flush all follow the voice (hum, sing, charge), breathing and feeding.
// Face: blinks, saccades, gaze, pupils, lids and brows over all four eyes.
// Eating (bugs, fish): focus(pos, w) eyes and head on prey, the jaw on a spring (snap(): a quick shut
// with a bounce, held a beat, then it reopens), gulp(k): a swallow that travels throat -> neck ->
// chest -> flank sacs as a bulge, a little chew, cheeks puffed; then a contented shimmy and smile.
import { Vector3, Quaternion, Matrix4, Euler } from 'three';
import { Spring, SpringVec3, clamp, lerp, smoothstep, damp, TAU, rng } from '../core/math.js';
import { G as GLOBALS } from '../render/Globals.js';

const CALF = {
  fMin: 0.95, fMax: 2.2, fGlide: 0.5, flapA: 0.6, glideA: 0.06, dihedral: 0.14,
  tailA: 0.16, bob: 0.05, breath: 0.3, zeta: 0.42, jawMax: 0.5, neckLook: 0.45,
  blinkMin: 1.8, blinkMax: 4.5, sacBase: 0.45, heavy: 0,
};
const ADULT = {
  fMin: 0.2, fMax: 0.52, fGlide: 0.13, flapA: 0.48, glideA: 0.045, dihedral: 0.11,
  tailA: 0.075, bob: 0.3, breath: 0.1, zeta: 0.62, jawMax: 0.38, neckLook: 0.32,
  blinkMin: 2.8, blinkMax: 7.5, sacBase: 0.35, heavy: 1,
};

// Gestures: duration (s) and the moment (0..1) of their event (a slap hits the water).
export const GESTURES = {
  tailSlap: { dur: 3.4, event: 0.68 },
  finSlap: { dur: 3.0, event: 0.62 },
  spyhop: { dur: 5.0 },
  nuzzle: { dur: 2.8 },
  happyWiggle: { dur: 1.8 },
  breachArch: { dur: 2.6 },
  rollOver: { dur: 4.2 },
};

const _e = new Euler();
const _v = new Vector3();
const _v2 = new Vector3();
const _m = new Matrix4();
const ZERO = new Vector3();
const SPINE = ['spine1', 'spine2', 'tail1', 'tail2', 'tail3', 'fluke'];
const SPINE_W = [0.12, 0.3, 0.55, 0.8, 1.0, 1.15];
const SIDES = [1, -1];
const clearWing = (w) => { w.flap = 0; w.sweep = 0; w.twist = 0; w.elbow = 0; w.wrist = 0; w.rear = 0; w.billow = 0; return w; };

const env = (u, a, r) => smoothstep(0, a, u) * (1 - smoothstep(1 - r, 1, u));
// a tent bump of the swallowed bolus at position p around c (width w)
const tent = (p, c, w) => (p <= 1 ? Math.max(0, 1 - Math.abs(p - c) / w) : 0);

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
    this.wetK = 0; // 1 soaked (in the sea) .. 0 dry; drives the wet sheen and the wet coat
    this.surprise = 0;
    this.delight = 0;

    // secondary motion springs (Story and SongGame impulse sHeadPitch / sFinFlare directly)
    const k = this.calf ? 1 : 0.42;
    this.sTailYaw = [0, 1, 2, 3, 4, 5].map((i) => new Spring(0, 2.6 * k + 0.2 - i * 0.1 * k, z));
    this.sTailPitch = new Spring(0, 2.2 * k + 0.1, z);
    this.sHeadPitch = new Spring(0, 2.8 * k + 0.1, z);
    this.sHeadYaw = new Spring(0, 2.4 * k + 0.1, z);
    this.sFinLag = new Spring(0, 2.4 * k + 0.1, z * 0.9);
    this.sFinFlare = new Spring(0, 3.0 * k + 0.3, 0.5);
    this.sJolt = new Spring(0, 3.0 * k + 0.3, 0.45);
    this.inertia = new SpringVec3(this.calf ? 2.4 : 1.1, 0.35);
    // bump jiggle (model space): bouncy, under-damped
    this.jig = new SpringVec3(this.calf ? 2.2 : 1.05, 0.28);
    this.jigLook = new Vector3();
    this.jigLookT = 0;
    this.lookYaw = 0;
    this.lookPitch = 0;

    // gestures
    this.gest = null;
    this.gestW = 0;
    this.onGestureEvent = null; // (name, event, worldPos) => void
    this.onBreath = null; // (strength, worldPos) => void
    this.poseQuat = new Quaternion(); // extra whole-body rotation of the current pose (gestures)

    // face
    this.blinkT = 1 + this.r() * 3;
    this.blink = 0;
    this.saccade = new Vector3();
    this.saccadeT = 0;
    this.lids = { up: 0.3, lo: -0.26, upC: -0.55, loC: 0.32 };
    this.pupil = model.eyes.R.u.uPupil.value;
    this.basePupil = this.pupil;
    this.clumsy = 0;
    this.clumsyT = 2 + this.r() * 4;
    this.brow = 0;

    // breathing through the blowholes
    this.breathT = 3 + this.r() * 6;
    this.blowK = 0;
    this.blowStrength = 0;

    // eating: jaw spring, snap hold, the swallowed bolus, chew, savour shimmy, prey focus
    this.jawS = new Spring(0, this.calf ? 4.2 : 2.6, 0.55);
    this.snapHold = 0;      // s the jaw stays shut after a snap
    this.snapK = 0;         // 1 at a snap, decays (head nod, cheek puff)
    this.lastSnap = -9;
    this.bolusP = 1.2;      // where the swallowed bolus is: 0 throat .. 1 flank sacs (>1 none)
    this.bolusA = 0;        // its size
    this.gulpQ = 0;         // a gulp queued behind the snap
    this.chew = 0;          // chew envelope
    this.chewT = 0;
    this.savor = 0;         // contented shimmy envelope
    this.savorT = 0;
    this.cheek = 0;         // puffed cheeks (throat swell at the head end)
    this.focusP = new Vector3();
    this.focusW = 0;        // 0..1 eyes and head locked on prey (decays unless refreshed)
    this.focusWT = 0;
    this.reach = 0;         // 0..1 prey coming within reach: the mouth opens wider

    this.prevVel = new Vector3();
    this.accel = new Vector3();
    this._invQ = new Quaternion();
    this._quat = new Quaternion();
    this._pos = new Vector3();
    this.bodyBob = 0;
    this.speed = 0;
  }

  // ---- triggers ---------------------------------------------------------------------------------
  /** Sonic-boom recoil. */
  blast(strength = 1) {
    this.sJolt.impulse(-6 * strength);
    this.sFinFlare.impulse(9 * strength);
    this.mouthKick = 1;
    this.jig.v.z -= 2.5 * strength * (this.calf ? 1 : 0.5);
  }

  /** Little hop / flinch (fright, hitting rock). */
  flinch(strength = 1) {
    this.sHeadPitch.impulse(-3 * strength);
    this.sFinLag.impulse(5 * strength);
    this.blinkT = 0;
    this.surprise = Math.min(1, this.surprise + 0.6 * strength);
  }

  /**
   * Contact response (the collision solver calls this on every whale contact).
   * worldDir: direction this whale is pushed (away from the other body); strength 0..2.
   */
  bump(worldDir, strength = 1) {
    const s = clamp(strength, 0, 2);
    if (s <= 0.001) return;
    _v.copy(worldDir || ZERO);
    if (_v.lengthSq() < 1e-8) _v.set(0, 1, 0);
    _v.normalize();
    // into model space
    this._invQ.copy(this._quat).invert();
    _v2.copy(_v).applyQuaternion(this._invQ);
    const k = (this.calf ? 3.2 : 1.4) * s;
    this.jig.v.addScaledVector(_v2, k);
    // the head turns toward whoever bumped us for a moment
    this.jigLook.copy(_v).negate();
    this.jigLookT = 1.6 + s;
    this.sFinFlare.impulse(5 * s);
    this.sHeadPitch.impulse(-1.5 * s * (this.calf ? 1 : 0.5));
    this.blinkT = 0;
    this.surprise = Math.min(1, this.surprise + 0.55 + 0.25 * s);
    this.delightT = 0.45 + 0.2 * s; // then a smile
    this.m.furU && (this.m.furU.uJiggle.value.w = this.time * 20);
  }

  /** Start a social gesture by name (see GESTURES). Returns false if unknown. */
  gesture(name, opts = {}) {
    const G = GESTURES[name];
    if (!G) return false;
    this.gest = { name, t: 0, dur: G.dur * (opts.speed ? 1 / opts.speed : 1) * (this.calf ? 0.8 : 1.15), event: G.event, fired: false, side: opts.side ?? (this.r() < 0.5 ? 1 : -1) };
    return true;
  }

  get gestureName() {
    return this.gest ? this.gest.name : null;
  }

  /** An explosive breath through the blowholes (surfacing): opens them wide, fires onBreath. */
  breathe(strength = 1) {
    this.blowK = 1;
    this.blowStrength = strength;
    this.breathT = 6 + this.r() * 8;
    if (this.onBreath) this.onBreath(strength, this.m.blowholePos ? this.m.blowholePos(_v) : null);
  }

  /**
   * Prey in view: eyes and head turn to `pos` with weight w (0..1), the mouth opens wider with
   * `reach` (0..1, prey coming within reach). Call every frame while it lasts; it fades by itself.
   */
  focus(pos, w = 1, reach = 0) {
    if (pos) this.focusP.copy(pos);
    this.focusWT = Math.max(this.focusWT, clamp(w, 0, 1));
    this.reach = Math.max(this.reach, clamp(reach, 0, 1));
  }

  /**
   * The jaw snaps shut on a morsel (overshoot and settle), holds a beat, then reopens if the mouth
   * still wants to be open. Snaps closer together than the jaw can travel merge into one (no jitter).
   * Returns true when a fresh snap started.
   */
  snap(strength = 1) {
    const k = clamp(strength, 0.2, 1.5);
    const t = this.time;
    if (t - this.lastSnap < 0.32 && this.snapHold > 0) {
      // already shut: hold a little longer, chew a little more
      this.snapHold = Math.max(this.snapHold, 0.1);
      this.chew = Math.min(1, this.chew + 0.3);
      return false;
    }
    this.lastSnap = t;
    this.snapHold = 0.13 + 0.05 * k;
    this.jawS.impulse(-(this.calf ? 9 : 5) * k);
    this.snapK = Math.min(1.2, this.snapK + 0.8 * k);
    this.cheek = Math.min(1.2, this.cheek + 0.7 * k);
    // the whole head bites forward and nods
    this.sHeadPitch.impulse(1.6 * k);
    this.sJolt.impulse(2 * k);
    this.sFinFlare.impulse(2 * k);
    return true;
  }

  /** Swallow: a bulge travels down the throat into the chest and flank sacs, a small chew first. */
  gulp(strength = 1) {
    const k = clamp(strength, 0.1, 1.5);
    if (this.bolusP > 1) { this.bolusP = -0.12; this.bolusA = k; } else {
      // a second morsel joins the first: it grows, and slides back up a little (no restart pop)
      this.bolusA = Math.min(1.5, Math.max(this.bolusA, k) + k * 0.25);
      this.bolusP = Math.min(this.bolusP, 0.25);
    }
    this.chew = Math.min(1, this.chew + 0.6);
    this.chewT = 0;
    // then delight: smiling eyes, a little shimmy of contentment
    this.delightT = Math.min(this.delightT > 0 ? this.delightT : 9, 0.35);
    this.savor = Math.min(1, this.savor + 0.55 * k + 0.2);
  }

  /**
   * s: {
   *   vel (world Vector3), quat (world Quaternion), angVel {yaw,pitch,roll} (rad/s),
   *   effort 0..1, glide 0..1, climb -1..1, mouth 0..1, feed 0..1, hum 0..1, charge 0..1,
   *   sing 0..1, sleep 0..1, fear 0..1, happy 0..1, excite 0..1, tired 0..1,
   *   lookAt (world Vector3|null), worldPos (Vector3), wind (Vector3)
   * }
   */
  update(dt, s, lod = 0) {
    const P = this.P, b = this.b, m = this.m;
    this.time += dt;
    if (s.quat) this._quat.copy(s.quat);
    if (s.worldPos) this._pos.copy(s.worldPos);

    // ---- smoothed drivers --------------------------------------------------------
    const speed = (this.speed = s.vel.length());
    this.effort = damp(this.effort, s.effort ?? 0, this.calf ? 5 : 2.2, dt);
    this.glide = damp(this.glide, s.glide ?? 0, 2, dt);
    this.dive = damp(this.dive, clamp(-(s.climb ?? 0) * 1.4 - 0.3, 0, 1) * smoothstep(4, 12, speed * (this.calf ? 1.6 : 0.45)), 2.5, dt);
    this.hover = damp(this.hover, 1 - smoothstep(1.5, this.calf ? 5 : 8, speed), 2, dt);
    this.sleep = damp(this.sleep, s.sleep ?? 0, 0.8, dt);
    this.charge = damp(this.charge, s.charge ?? 0, 6, dt);
    this.sing = damp(this.sing, s.sing ?? 0, 2, dt);
    this.feed = damp(this.feed, s.feed ?? 0, 4, dt);
    this.hum = damp(this.hum, s.hum ?? 0, 8, dt);
    this.fear = damp(this.fear, s.fear ?? 0, 4, dt);
    this.happy = damp(this.happy, Math.max(s.happy ?? 0, this.delight), 2.5, dt);
    this.excite = damp(this.excite, s.excite ?? 0, 3, dt);
    this.tired = damp(this.tired, s.tired ?? 0, 1, dt);
    // bump expression: surprise first, then delight
    this.surprise = Math.max(0, this.surprise - dt * 1.6);
    if (this.delightT !== undefined && this.delightT > 0) {
      this.delightT -= dt;
      if (this.delightT <= 0) this.delight = 1;
    }
    this.delight = Math.max(0, this.delight - dt * 0.45);
    let mouthT = Math.max(s.mouth ?? 0, this.feed * 0.85, this.hum * 0.12, this.sing * 0.22, this.surprise * 0.25);
    if (this.mouthKick) { mouthT = 1; this.mouthKick = Math.max(0, this.mouthKick - dt * 3); }
    this.mouth = damp(this.mouth, mouthT, this.calf ? 9 : 4, dt);
    // eating clocks: focus fades unless refreshed; the bolus travels; chew and shimmy decay
    this.focusW = damp(this.focusW, this.focusWT, this.focusWT > this.focusW ? 6 : 2.5, dt);
    this.focusWT = 0;
    this.reachS = damp(this.reachS ?? 0, this.reach, 7, dt);
    this.reach = 0;
    this.snapHold = Math.max(0, this.snapHold - dt);
    this.snapK = Math.max(0, this.snapK - dt * 3.2);
    this.cheek = Math.max(0, this.cheek - dt * 1.6);
    if (this.bolusP <= 1) {
      this.bolusP += dt * (this.calf ? 1.25 : 0.7);
      if (this.bolusP > 1) { this.bolusP = 1.2; this.bolusA = 0; }
    }
    this.chewT += dt;
    this.chew = Math.max(0, this.chew - dt * 1.4);
    this.savorT += dt;
    this.savor = Math.max(0, this.savor - dt * 0.7);
    const bp = this.bolusP, ba = this.bolusA;
    this.bThroat = ba * tent(bp, 0.08, 0.3) * 0.8 + this.cheek * 0.3;
    this.bNeck = ba * tent(bp, 0.4, 0.28);
    this.bChest = ba * tent(bp, 0.68, 0.3);
    this.bSac = ba * tent(bp, 0.94, 0.26);

    // acceleration in world space (fur and hair inertia, fin lag)
    if (dt > 0) {
      this.accel.copy(s.vel).sub(this.prevVel).divideScalar(Math.max(dt, 1e-3));
      this.prevVel.copy(s.vel);
    }
    this.accel.clampLength(0, 40);

    // ---- gesture clock ---------------------------------------------------------------
    let G = this.gest, gu = 0, gw = 0;
    if (G) {
      G.t += dt;
      gu = G.t / G.dur;
      if (G.event !== undefined && !G.fired && gu >= G.event) {
        G.fired = true;
        this._gestureEvent(G);
      }
      if (gu >= 1) { this.gest = G = null; gu = 0; }
    }
    this.gestW = damp(this.gestW, G ? 1 : 0, 6, dt);

    // ---- wingbeat ------------------------------------------------------------------
    const eff = clamp(this.effort * (1 - this.tired * 0.35), 0, 1);
    const glideMix = clamp(this.glide * (1 - eff * 0.7), 0, 1);
    let fT = lerp(P.fMin, P.fMax, eff);
    fT = lerp(fT, P.fGlide, glideMix);
    fT = lerp(fT, P.fMin * 0.6, this.sleep);
    fT *= 1 + this.excite * 0.25;
    this.freq = damp(this.freq, fT, 2.5, dt);
    let aT = lerp(P.flapA * 0.55, P.flapA, eff);
    aT = lerp(aT, P.glideA, glideMix);
    aT *= 1 - this.dive * 0.75;
    aT *= 1 - this.sleep * 0.85;
    aT *= 1 - this.charge * 0.6;
    if (G) aT *= 1 - 0.7 * env(gu, 0.15, 0.25);
    this.amp = damp(this.amp, aT, 2.5, dt);
    if (this.calf) {
      // calves are slightly irregular: a stroke now and then is a bit off
      this.clumsyT -= dt;
      if (this.clumsyT <= 0) { this.clumsy = (this.r() - 0.5) * 0.5; this.clumsyT = 1.5 + this.r() * 4; }
      this.clumsy = damp(this.clumsy, 0, 1.5, dt);
    }
    this.phase += TAU * this.freq * dt * (1 + this.clumsy * 0.3);
    const ph = this.phase;
    // skewed cycle: a powerful downstroke and a slower recovery; heavier for the adults
    const skew = 0.32 + P.heavy * 0.08;
    const sk = ph + skew * Math.sin(ph);
    const flapPos = -Math.cos(sk); // -1 bottom .. 1 top
    const flapVel = Math.sin(sk) * (1 + skew * Math.cos(ph));
    const downstroke = 0.5 - 0.5 * Math.sin(sk);

    // the whole body heaves against each downstroke (adults: big slow heave)
    this.bodyBob = -flapPos * P.bob * (0.3 + this.amp / P.flapA) * (1 - this.sleep);

    // ---- breathing ------------------------------------------------------------------
    const bRate = P.breath * (1 + this.tired * 1.6 + this.fear * 0.8 + this.excite * 0.4) * (1 - this.sleep * 0.4);
    this.breathPhase += TAU * bRate * dt;
    const breath = Math.sin(this.breathPhase);
    // the blowholes open with each breath (and wide on an explosive surfacing breath)
    this.breathT -= dt;
    if (this.breathT <= 0) { this.blowK = Math.max(this.blowK, 0.55); this.breathT = (this.calf ? 4 : 9) + this.r() * 6; }
    this.blowK = Math.max(0, this.blowK - dt * (this.blowK > 0.6 ? 0.7 : 0.9));

    // ---- turning & secondary motion ------------------------------------------------
    const yawRate = clamp(s.angVel?.yaw ?? 0, -2, 2);
    const pitchRate = clamp(s.angVel?.pitch ?? 0, -2, 2);
    const turn = clamp(yawRate / (this.calf ? 1.6 : 0.45), -1, 1);
    this._invQ.copy(this._quat).invert();
    const aLocal = _v.copy(this.accel).applyQuaternion(this._invQ);
    for (let i = 0; i < this.sTailYaw.length; i++) this.sTailYaw[i].update(dt, -turn * (0.05 + i * 0.03) * (this.calf ? 1.4 : 1));
    this.sTailPitch.update(dt, clamp(-pitchRate * 0.15 - aLocal.y * 0.006, -0.4, 0.4));
    this.sHeadPitch.update(dt, clamp(aLocal.y * 0.004 + aLocal.z * 0.003, -0.3, 0.3));
    this.sHeadYaw.update(dt, turn * 0.16);
    this.sFinLag.update(dt, clamp(-aLocal.y * (this.calf ? 0.03 : 0.015), -0.5, 0.5));
    this.sFinFlare.update(dt, 0);
    this.sJolt.update(dt, 0);
    this.jig.update(dt, ZERO);
    const J = this.jig.x;
    const jAmt = J.length();

    // ---- look-at -----------------------------------------------------------------------
    let lyT = 0, lpT = 0;
    let lookAt = s.lookAt;
    if (this.jigLookT > 0) {
      this.jigLookT -= dt;
      lookAt = _v2.copy(this._pos).addScaledVector(this.jigLook, 30);
    } else if (this.focusW > 0.05) {
      // prey: the eyes lock on and the head follows (blended with whatever else it looked at)
      if (lookAt) lookAt = _v2.copy(lookAt).lerp(this.focusP, this.focusW);
      else lookAt = this.focusW > 0.3 ? this.focusP : null;
    }
    if (lookAt && s.worldPos) {
      _v.copy(lookAt).sub(s.worldPos).applyQuaternion(this._invQ);
      if (_v.lengthSq() > 1) {
        lyT = clamp(Math.atan2(_v.x, _v.z), -1.0, 1.0);
        lpT = clamp(Math.atan2(_v.y, Math.hypot(_v.x, _v.z)), -0.6, 0.6);
        if (_v.z < 0) lyT *= 0.6;
      }
    }
    this.lookYaw = damp(this.lookYaw, lyT, this.calf ? 4 : 1.6, dt);
    this.lookPitch = damp(this.lookPitch, lpT, this.calf ? 4 : 1.6, dt);

    // tremble while charging the voice organs
    const tr = this.charge * this.charge;
    const trem = (f, o) => Math.sin(this.time * f + o) * tr;

    // ---- gesture pose (additive channels) -----------------------------------------------
    const gp = this._gesturePose(G, gu, dt);
    // eating: a contented shimmy after a swallow, a curious head tilt toward prey, the snap's nod
    const sav = this.savor * this.savor * (3 - 2 * this.savor);
    if (sav > 0.001) {
      const st = this.savorT;
      for (let i = 0; i < 6; i++) gp.spineYaw[i] += Math.sin(st * 11.0 - i * 0.85) * 0.07 * SPINE_W[i] * sav;
      gp.rootRoll += Math.sin(st * 5.5) * 0.06 * sav;
      gp.smile = Math.max(gp.smile, sav);
    }
    gp.headRoll += -this.lookYaw * 0.3 * this.focusW;
    gp.headPitch += this.snapK * 0.05;

    // ---- spine: a whale's dorso-ventral wave, growing toward the flukes ------------------
    const tailAmp = P.tailA * (0.35 + eff * 0.9) * (1 - this.sleep * 0.7) * (1 - glideMix * 0.6) * (1 - this.dive * 0.5);
    const tph = ph - 1.25;
    const sleepCurl = this.sleep * 0.1;
    for (let i = 0; i < SPINE.length; i++) {
      const bone = b[SPINE[i]];
      // travelling wave: each segment lags the one before; the flukes trail furthest
      const wave = Math.sin(tph - i * 0.62) * tailAmp * SPINE_W[i];
      const yaw = this.sTailYaw[Math.min(i, 5)].x * (i > 0 ? 1 : 0.5) + trem(31 + i * 7, i) * 0.02
        + J.x * 0.18 * SPINE_W[i] * (this.calf ? 1.2 : 0.8) + gp.spineYaw[i];
      const pitch = wave + this.sTailPitch.x * (0.1 + i * 0.1) + sleepCurl * (i / 5) - this.charge * 0.05 * (i / 5)
        + this.sing * 0.03 * Math.sin(this.time * 0.8 - i * 0.4) - J.y * 0.14 * SPINE_W[i] + gp.spinePitch[i];
      bone.rotation.set(pitch, yaw, gp.spineRoll[i], 'YXZ');
    }
    // fluke lobes flex with the stroke (the trailing edges lag)
    const flex = Math.cos(tph - 3.3) * tailAmp * 1.6 + gp.flukeFlex;
    b.flukeR.rotation.set(0, 0, -flex * 0.6, 'XYZ');
    b.flukeL.rotation.set(0, 0, flex * 0.6, 'XYZ');

    // front: the head is steadied against the stroke, looks around, lifts to sing
    const neck = b.neck, head = b.head, chest = b.chest;
    const steady = -Math.sin(tph + 0.6) * tailAmp * 0.22;
    const lookN = P.neckLook;
    chest.rotation.set(steady * 0.5 + trem(37, 1) * 0.01 + J.y * 0.05 + gp.chestPitch, this.lookYaw * 0.1 - J.x * 0.05, 0, 'YXZ');
    const singLift = this.sing * 0.1;
    const sleepDroop = this.sleep * 0.1;
    neck.rotation.set(
      steady + (-this.lookPitch * lookN * 0.5) - singLift * 0.5 + sleepDroop + this.sHeadPitch.x * 0.5 + this.sJolt.x * 0.04 + trem(43, 2) * 0.015 + gp.headPitch * 0.5,
      this.lookYaw * lookN * 0.5 + this.sHeadYaw.x * 0.5 + trem(39, 3) * 0.012 + gp.headYaw * 0.5,
      0, 'YXZ');
    head.rotation.set(
      (-this.lookPitch * lookN * 0.5) - singLift * 0.5 + sleepDroop + this.sHeadPitch.x * 0.5 + this.sJolt.x * 0.05 + gp.headPitch * 0.5,
      this.lookYaw * lookN * 0.5 + this.sHeadYaw.x * 0.5 + gp.headYaw * 0.5,
      Math.sin(this.time * 0.9) * 0.02 * this.happy + gp.headRoll, 'YXZ');
    // root: body heave, whole-body gesture rotation, bump squash-and-stretch
    const root = b.root;
    root.position.copy(m.boneAbs.root);
    root.position.y += this.bodyBob + gp.rootY;
    this.poseQuat.setFromEuler(_e.set(gp.rootPitch, gp.rootYaw, gp.rootRoll, 'YXZ'));
    root.quaternion.copy(this.poseQuat);
    // squash along the push, stretch across it (volume kept); clamp so it never looks rubbery
    const sq = clamp(jAmt * (this.calf ? 0.07 : 0.045), 0, 0.12);
    if (sq > 1e-4) {
      const nx = Math.abs(J.x) / (jAmt + 1e-6), ny = Math.abs(J.y) / (jAmt + 1e-6), nz = Math.abs(J.z) / (jAmt + 1e-6);
      const st = sq * 0.5;
      root.scale.set(1 - sq * nx + st * (1 - nx), 1 - sq * ny + st * (1 - ny), 1 - sq * nz + st * (1 - nz));
    } else root.scale.set(1, 1, 1);
    // the swallow's bulge in the girth of the neck and chest (children compensate, so the head,
    // eyes and wings keep their size)
    const gN = 1 + this.bNeck * 0.11, gC = 1 + this.bChest * 0.09;
    chest.scale.set(gC, gC, 1);
    neck.scale.set(gN / gC, gN / gC, 1);
    head.scale.set(1 / gN, 1 / gN, 1);
    if (b.finR1) { b.finR1.scale.set(1 / gC, 1 / gC, 1); b.finL1.scale.set(1 / gC, 1 / gC, 1); }
    // jaw: a spring toward the wanted opening (wider as prey comes within reach); a snap holds it
    // shut a beat and it bounces off the closed lips (overshoot and settle); a little chew after
    const jawWant = this.snapHold > 0 ? 0 : this.mouth * P.jawMax * (1 + this.reachS * 0.35);
    let jx = this.jawS.update(dt, jawWant);
    if (jx < -0.01) { jx = this.jawS.x = -0.01; if (this.jawS.v < 0) this.jawS.v *= -0.38; }
    const chew = this.chew * this.chew * Math.max(0, Math.sin(this.chewT * 17.0)) * P.jawMax * 0.28;
    b.jaw.rotation.set(jx + chew + gp.jaw, 0, 0);
    this.jawAngle = jx + chew;

    // ---- wings ---------------------------------------------------------------------------
    const amp = this.amp;
    const dihedral = P.dihedral * (1 - this.dive) + glideMix * 0.05 - this.sleep * 0.3;
    const fu = m.finU;
    for (let si = 0; si < 2; si++) {
      const side = SIDES[si];
      const sname = side > 0 ? 'R' : 'L';
      const outer = side > 0 ? -turn : turn; // the outer wing works harder in a turn
      const a = amp * (1 + clamp(outer, -0.5, 0.5) * 0.45);
      const scull = this.hover * (1 - this.sleep) * Math.sin(ph) * 0.3;
      const flare = this.sFinFlare.x * 0.1 + jAmt * 0.04;
      const lag = this.sFinLag.x;
      const gw = gp.wing[sname];
      const shoulderFlap = dihedral + flapPos * a + lag * 0.4 + flare * 0.5 - this.charge * 0.25 + this.sing * 0.08 * Math.sin(this.time * 1.1) + gw.flap;
      const shoulderSweep = this.dive * 0.75 + scull - flare * 0.4 + this.charge * 0.55 + this.sleep * 0.55 + gw.sweep;
      const shoulderTwist = -flapVel * a * 0.5 + this.hover * Math.cos(ph) * 0.28 + gw.twist;
      // the elbow lags the shoulder, the wrist lags the elbow; the hand folds on the upstroke
      const elbowFlap = -Math.cos(sk - 0.8) * a * 0.55 + lag * 0.3 + (1 - downstroke) * a * 0.18 - this.sleep * 0.6 + gw.elbow;
      const elbowSweep = (1 - downstroke) * a * 0.28 + this.dive * 0.35 + this.charge * 0.2 + this.sleep * 0.5;
      const elbowTwist = -Math.sin(sk - 0.85) * a * 0.32;
      const wristFlap = -Math.cos(sk - 1.5) * a * 0.5 + lag * 0.25 - this.sleep * 0.5 + gw.wrist;
      const wristTwist = -Math.sin(sk - 1.6) * a * 0.3;
      const f1 = b['fin' + sname + '1'], f2 = b['fin' + sname + '2'], f3 = b['fin' + sname + '3'];
      f1.rotation.set(shoulderTwist, side * shoulderSweep, side * shoulderFlap, 'ZYX');
      f2.rotation.set(elbowTwist, side * elbowSweep, side * elbowFlap, 'ZYX');
      f3.rotation.set(wristTwist, 0, side * wristFlap, 'ZYX');
      // rear fins steer and paddle
      const r = b['rear' + sname];
      r.rotation.set(0.2 * Math.sin(ph - 0.5) * (0.3 + eff), side * (turn * 0.3), side * (0.18 * Math.sin(ph) * 0.4 - this.sleep * 0.3 + gw.rear), 'ZYX');
      // the membrane bellies out against the stroke; the trailing edge flutters in the airflow
      const id = side > 0 ? 0 : 1;
      if (fu) {
        fu.uBillow.value[id] = -flapVel * a * (this.calf ? 0.3 : 0.4) + lag * 0.1 + gw.billow;
        fu.uFlutter.value[id] = 0.005 + Math.min(speed, 30) * 0.0011 + jAmt * 0.004;
        fu.uBillow.value[id + 2] = Math.sin(ph - 0.6) * 0.1 * (0.3 + eff);
        fu.uFlutter.value[id + 2] = 0.006 + Math.min(speed, 30) * 0.0008;
      }
    }
    if (fu) {
      const fb = -Math.cos(tph - 2.9) * tailAmp * 1.5;
      fu.uBillow.value[4] = fb;
      fu.uBillow.value[5] = fb;
      fu.uFlutter.value[4] = fu.uFlutter.value[5] = 0.008 + Math.min(speed, 30) * 0.0008;
      // the alpha's torn flaps flap harder at speed and in wind
      fu.uTear.value.y = 1 + Math.min(speed, 30) * 0.03;
    }

    // ---- organs ---------------------------------------------------------------------------
    const u = m.u;
    const climb = s.climb ?? 0;
    const voice = Math.max(this.hum * 0.55, this.sing, this.charge);
    // the swallowed bolus: throat (pleats) -> neck -> chest -> the flank sacs
    const bThroat = this.bThroat, bNeck = this.bNeck, bSac = this.bSac;
    u.uSac.value = clamp(P.sacBase + breath * 0.18 + climb * 0.25 + this.sing * 0.2 - this.dive * 0.25 + bSac * 0.45, 0, 1.4);
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 6.0);
    const songPulse = 0.5 + 0.5 * Math.sin(this.time * 2.1);
    // throat bellows: swell with the voice, balloon when charging or lunge-feeding
    u.uThroat.value = clamp(this.hum * (0.4 + 0.1 * pulse) + this.charge * 1.05 + this.sing * (0.35 + 0.15 * songPulse) + this.feed * 0.45 + gp.throat + bThroat * 0.55 + bNeck * 0.25 + this.cheek * 0.12, 0, 1.5);
    u.uVib.value = clamp(this.hum * 0.35 + this.charge * 1.1 + this.sing * 0.2, 0, 1.4);
    u.uGill.value = clamp(this.feed + this.tired * 0.3, 0, 1);
    u.uBreath.value = breath * (this.calf ? 1 : 0.6) * (1 + this.tired);
    // sensor crest: half-raised at rest, up when alert, flared open to sing, shivering when charging
    const crestRaise = clamp(0.62 + this.excite * 0.2 + voice * 0.38 + this.surprise * 0.3 - this.sleep * 0.45 + gp.crest, 0, 1);
    const crestFlare = clamp(this.hum * 0.35 + this.sing * (0.75 + 0.1 * songPulse) + this.charge + gp.crestFlare, 0, 1);
    const cr = u.uCrest.value;
    cr.x = damp(cr.x, crestRaise, 4, dt);
    cr.y = damp(cr.y, crestFlare, 5, dt);
    cr.z = clamp(this.charge * 0.9 + this.sing * 0.25 + this.hum * 0.2, 0, 1);
    // horn vents flare open with the voice; heat flush when charging (no glow: skin colour)
    u.uVent.value = damp(u.uVent.value, clamp(this.sing * 0.9 + this.hum * 0.5 + this.charge, 0, 1), 6, dt);
    u.uFlush.value = damp(u.uFlush.value, clamp(this.charge * 0.85 + this.sing * 0.3 + this.tired * 0.2, 0, 1), 2, dt);
    u.uBlow.value = clamp(Math.max(this.blowK, (breath > 0.92 ? (breath - 0.92) * 4 : 0)), 0, 1);
    u.uWhip.value = clamp(this.excite * 0.6 + this.feed * 0.5 + this.happy * 0.2, 0, 1);
    // wet sheen: soaked while the body is in the sea, glossy and dripping as it emerges, then
    // drying over about half a minute in the air (s.wet, when given, overrides)
    if (s.wet !== undefined) this.wetK = clamp(s.wet, 0, 1);
    else if (s.worldPos) {
      const seaY = GLOBALS.uSeaLevel ? GLOBALS.uSeaLevel.value : 0;
      if (s.worldPos.y < seaY + m.L * 0.07) this.wetK = 1;
      else this.wetK = Math.max(0, this.wetK - dt / (this.calf ? 34 : 26));
    }
    u.uWetSelf.value = this.wetK > 0 ? Math.pow(this.wetK, 0.6) * 0.9 : 0;

    // fur and hair dynamics: wind relative to the body, lag behind acceleration, a bump's ripple
    const air = _v.copy(s.wind || ZERO).sub(s.vel);
    u.uAirflow.value.copy(air).clampLength(0, 30);
    this.inertia.update(dt, this.accel);
    u.uInertia.value.copy(this.inertia.x).multiplyScalar(this.calf ? 0.02 : 0.012).clampLength(0, 0.6);
    if (m.furU) {
      const jg = m.furU.uJiggle.value;
      _v2.copy(J).applyQuaternion(this._quat).multiplyScalar(this.calf ? 0.25 : 0.12);
      jg.x = _v2.x; jg.y = _v2.y; jg.z = _v2.z;
      jg.w += dt * 14;
    }

    // ---- face ----------------------------------------------------------------------------
    if (lod < 2) this._face(dt, s, lookAt, gp);
  }

  // ---- gestures ---------------------------------------------------------------------------------
  _gestureEvent(G) {
    if (!this.onGestureEvent) return;
    const m = this.m;
    let pos = null;
    if (G.name === 'tailSlap') pos = m.flukePos ? m.flukePos(null, new Vector3()) : null;
    if (G.name === 'finSlap') pos = m.wingTipPos ? m.wingTipPos(G.side > 0 ? 'R' : 'L', new Vector3()) : null;
    this.onGestureEvent(G.name, 'slap', pos);
  }

  /** Additive pose channels for the active gesture (all zero when none). */
  _gesturePose(G, u, dt) {
    const gp = this._gp || (this._gp = {
      spinePitch: [0, 0, 0, 0, 0, 0], spineYaw: [0, 0, 0, 0, 0, 0], spineRoll: [0, 0, 0, 0, 0, 0],
      wing: { R: {}, L: {} },
    });
    for (let i = 0; i < 6; i++) { gp.spinePitch[i] = 0; gp.spineYaw[i] = 0; gp.spineRoll[i] = 0; }
    clearWing(gp.wing.R);
    clearWing(gp.wing.L);
    gp.rootPitch = gp.rootYaw = gp.rootRoll = gp.rootY = 0;
    gp.headPitch = gp.headYaw = gp.headRoll = gp.chestPitch = 0;
    gp.jaw = gp.throat = gp.crest = gp.crestFlare = gp.flukeFlex = 0;
    gp.eyesClosed = gp.eyesWide = gp.smile = 0;
    if (!G) return gp;
    const side = G.side;
    const sn = side > 0 ? 'R' : 'L', so = side > 0 ? 'L' : 'R';
    const t = G.t;
    switch (G.name) {
      case 'tailSlap': {
        // head dips, the tail stock rises high... then whips down onto the water
        const rise = smoothstep(0.0, 0.5, u) * (1 - smoothstep(0.62, 0.7, u));
        const whip = smoothstep(0.6, 0.7, u) * (1 - smoothstep(0.75, 1.0, u));
        const e = env(u, 0.12, 0.2);
        gp.rootPitch = (0.45 * rise - 0.15 * whip) * e;
        for (let i = 0; i < 6; i++) gp.spinePitch[i] = (-0.32 * rise + 0.42 * whip) * SPINE_W[i] * e;
        gp.flukeFlex = (0.3 * rise - 0.5 * whip) * e;
        gp.headPitch = 0.12 * rise * e;
        gp.wing.R.flap = gp.wing.L.flap = -0.15 * e;
        gp.wing.R.sweep = gp.wing.L.sweep = 0.3 * e;
        gp.eyesWide = whip * 0.5;
        break;
      }
      case 'finSlap': {
        // roll onto the side, lift one wing high, slap it down
        const e = env(u, 0.18, 0.22);
        const lift = smoothstep(0.1, 0.5, u) * (1 - smoothstep(0.58, 0.64, u));
        const slap = smoothstep(0.58, 0.64, u) * (1 - smoothstep(0.7, 1.0, u));
        gp.rootRoll = -side * 1.1 * e;
        gp.wing[sn].flap = (1.25 * lift - 0.65 * slap) * e;
        gp.wing[sn].elbow = (0.3 * lift - 0.4 * slap) * e;
        gp.wing[sn].twist = 0.3 * lift * e;
        gp.wing[sn].billow = -0.3 * slap * e;
        gp.wing[so].flap = -0.25 * e;
        gp.headYaw = side * 0.15 * e;
        gp.smile = 0.6 * e;
        break;
      }
      case 'spyhop': {
        // the body stands up out of the water, head high, slowly turning to look around
        const e = env(u, 0.22, 0.25);
        gp.rootPitch = -1.15 * e;
        gp.rootYaw = Math.sin(t * 0.9) * 0.35 * smoothstep(0.25, 0.4, u) * e;
        for (let i = 0; i < 6; i++) gp.spinePitch[i] = 0.06 * SPINE_W[i] * e;
        gp.headPitch = 0.12 * e;
        gp.wing.R.flap = gp.wing.L.flap = -0.35 * e;
        gp.wing.R.sweep = gp.wing.L.sweep = 0.25 * e + Math.sin(t * 2.0) * 0.1 * e;
        gp.wing.R.twist = gp.wing.L.twist = Math.sin(t * 2.0) * 0.2 * e;
        gp.eyesWide = 0.7 * e;
        gp.crest = 0.3 * e;
        break;
      }
      case 'nuzzle': {
        // head lowered and turned, a slow rub, eyes closed, a soft hum in the throat
        const e = env(u, 0.2, 0.25);
        gp.headPitch = 0.12 * e;
        gp.headYaw = (side * 0.18 + Math.sin(t * 3.2) * 0.07) * e;
        gp.headRoll = side * 0.1 * e;
        gp.chestPitch = 0.04 * e;
        gp.rootRoll = side * 0.12 * e;
        gp.eyesClosed = 0.85 * e;
        gp.smile = 0.8 * e;
        gp.throat = 0.18 * e * (0.6 + 0.4 * Math.sin(t * 5.0));
        gp.crest = -0.25 * e;
        gp.wing.R.flap = gp.wing.L.flap = -0.1 * e;
        break;
      }
      case 'happyWiggle': {
        // a quick shimmy down the spine, wing flutters, flicking crest, smiling eyes
        const e = env(u, 0.1, 0.25);
        for (let i = 0; i < 6; i++) gp.spineYaw[i] = Math.sin(t * 13.0 - i * 0.9) * 0.12 * SPINE_W[i] * e;
        gp.headYaw = Math.sin(t * 13.0 + 0.9) * 0.06 * e;
        gp.rootRoll = Math.sin(t * 6.5) * 0.12 * e;
        gp.wing.R.flap = Math.sin(t * 15.0) * 0.18 * e;
        gp.wing.L.flap = Math.sin(t * 15.0 + 1.0) * 0.18 * e;
        gp.crest = 0.25 * e;
        gp.crestFlare = (0.5 + 0.5 * Math.sin(t * 9.0)) * 0.35 * e;
        gp.smile = 1 * e;
        break;
      }
      case 'breachArch': {
        // an arching leap: head up, body bowed, wings spread and swept back, flukes trailing
        const e = env(u, 0.15, 0.3);
        gp.rootPitch = -0.35 * e;
        for (let i = 0; i < 6; i++) gp.spinePitch[i] = 0.12 * SPINE_W[i] * e;
        gp.chestPitch = -0.1 * e;
        gp.headPitch = -0.1 * e;
        gp.wing.R.flap = gp.wing.L.flap = 0.25 * e;
        gp.wing.R.sweep = gp.wing.L.sweep = 0.55 * e;
        gp.wing.R.elbow = gp.wing.L.elbow = -0.2 * e;
        gp.flukeFlex = 0.2 * e;
        gp.jaw = 0.1 * e;
        gp.eyesWide = 0.6 * e;
        gp.crest = 0.35 * e;
        break;
      }
      case 'rollOver': {
        // a lazy roll onto the back, belly to the sky, wings open; then back again
        const e = env(u, 0.05, 0.05);
        const roll = smoothstep(0.0, 0.42, u) * (1 - smoothstep(0.62, 1.0, u));
        gp.rootRoll = side * Math.PI * roll * e;
        gp.wing.R.flap = gp.wing.L.flap = 0.2 * Math.sin(Math.PI * roll) * e;
        gp.wing.R.sweep = gp.wing.L.sweep = -0.15 * Math.sin(Math.PI * roll) * e;
        gp.smile = 0.7 * Math.sin(Math.PI * roll) * e;
        gp.eyesClosed = 0.3 * Math.sin(Math.PI * roll) * e;
        break;
      }
      default: break;
    }
    return gp;
  }

  // ---- face ------------------------------------------------------------------------------------
  _face(dt, s, lookAt, gp) {
    const P = this.P, m = this.m;
    // blinking (both pairs together; the small upper pair a beat later)
    this.blinkT -= dt;
    if (this.blinkT <= 0) {
      this.blink = 1;
      this.blinkT = lerp(P.blinkMin, P.blinkMax, this.r()) * (1 - this.tired * 0.5);
      if (this.r() < 0.15) this.blinkT = 0.28; // double blink
    }
    this.blink = Math.max(0, this.blink - dt * 6.5);
    const bl = Math.sin(Math.min(1, this.blink) * Math.PI);
    const bl2 = Math.sin(Math.min(1, Math.max(0, this.blink * 1.15 - 0.1)) * Math.PI);

    // expression targets (socket elevations in radians; lids are thick and the opening small)
    let up = 0.3, lo = -0.26, upC = -0.55, loC = 0.32;
    const mix4 = (w, u2, l2, uc2, lc2) => {
      up = lerp(up, u2, w); lo = lerp(lo, l2, w); upC = lerp(upC, uc2, w); loC = lerp(loC, lc2, w);
    };
    const happy = Math.max(this.happy, gp.smile);
    mix4(happy * 0.8, 0.26, -0.02, -0.45, 0.65);           // smiling: the lower lid rises
    mix4(this.sing * 0.7, 0.14, -0.14, -0.35, 0.45);        // singing: half-closed, rapt
    mix4(this.charge, 0.2, -0.32, -0.25, 0.3);              // charging: a hard squint
    mix4(this.tired * 0.5, 0.12, -0.24, -0.45, 0.25);
    mix4(this.focusW * 0.4 * (1 - happy), 0.36, -0.3, -0.5, 0.36);  // prey in sight: eager, wide-eyed
    mix4(this.snapK * 0.5, 0.18, -0.12, -0.45, 0.4);         // the bite: a squeeze of the eyes
    mix4(Math.max(this.fear, this.surprise, gp.eyesWide), 0.62, -0.62, -0.6, 0.2); // wide
    mix4(Math.max(this.sleep, gp.eyesClosed), -0.04, -0.08, -0.2, 0.25);
    const L = this.lids;
    L.up = damp(L.up, up, 14, dt);
    L.lo = damp(L.lo, lo, 14, dt);
    L.upC = damp(L.upC, upC, 10, dt);
    L.loC = damp(L.loC, loC, 10, dt);
    const mid = (L.up + L.lo) * 0.5 + 0.05;
    // brows: raised in surprise, knitted when charging, soft when happy
    const browT = clamp(Math.max(this.surprise, gp.eyesWide) * 0.8 - this.charge * 0.6 + happy * 0.15 - this.fear * 0.2, -1, 1);
    this.brow = damp(this.brow, browT, 8, dt);
    const bR = this.m.bones.browR, bL = this.m.bones.browL;
    if (bR && bL) {
      bR.rotation.set(-this.brow * 0.12, 0, this.brow * 0.08);
      bL.rotation.set(-this.brow * 0.12, 0, -this.brow * 0.08);
    }

    // pupils: open and round when happy or in dim light, pinpoint when frightened
    const pT = this.basePupil * (1 + happy * 0.12 + this.sing * 0.1 - this.fear * 0.45 - this.surprise * 0.3 + this.excite * 0.1 + this.sleep * 0.2 + this.focusW * 0.22);
    this.pupil = damp(this.pupil, pT, 6, dt);

    // gaze: toward the look target with micro-saccades
    this.saccadeT -= dt;
    if (this.saccadeT <= 0) {
      this.saccade.set((this.r() - 0.5) * 0.1, (this.r() - 0.5) * 0.07, 0);
      this.saccadeT = 0.4 + this.r() * 1.8;
    }
    for (const sname in m.eyes) {
      const eye = m.eyes[sname];
      const gz = _v.set(0, 0, 1);
      if (lookAt) {
        eye.mesh.updateWorldMatrix(true, false);
        _m.copy(eye.mesh.matrixWorld).invert();
        gz.copy(lookAt).applyMatrix4(_m).normalize();
        // limit within the socket's cone
        if (gz.z < 0.6) {
          gz.z = 0.6;
          const xy = Math.hypot(gz.x, gz.y) || 1;
          const sc = Math.sqrt(1 - 0.36) / xy;
          gz.x *= sc; gz.y *= sc;
        }
      }
      gz.x += this.saccade.x;
      gz.y += this.saccade.y;
      gz.normalize();
      const eu = eye.u;
      eu.uGaze.value.lerp(gz, 1 - Math.exp(-18 * dt)).normalize();
      const b2 = eye.primary ? bl : bl2;
      eu.uLids.value.set(lerp(L.up, mid, b2), lerp(L.lo, mid - 0.02, b2), L.upC, L.loC);
      eu.uPupil.value = this.pupil * (eye.primary ? 1 : 0.9);
    }
  }
}

