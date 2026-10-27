// Procedural animation for the storm falcon. A small pose library (soaring glide, the
// teardrop stoop, the cupped C, the M-shape pull-out, the talon strike, a tumble) is blended
// by spring-smoothed weights, then layered with a skewed wingbeat (power downstroke, wrists
// folding and primaries slotting open on the upstroke), coordinated-turn asymmetry, flailing,
// the screech, spring-driven secondary motion (tail, streamers, crest, load-bent primaries,
// head stabilisation) and the face (gaze, lids, nictitating membrane, pupils).
import { Vector3, Matrix4, Quaternion } from 'three';
import { Spring, clamp, lerp, smoothstep, damp, TAU } from '../../core/math.js';
import { FG } from './FalconModel.js';

const KEYS = [
  // fore wings: shoulder, elbow, wrist
  'wElev', 'wSweep', 'wTwist', 'eElev', 'eFlex', 'eTwist', 'hElev', 'hFlex', 'hTwist', 'nElev', 'nFlex',
  // flight feathers
  'pSpread', 'pTwist', 'pBend', 'sBend', 'alula', 'ruffle',
  // hind wings
  'gElev', 'gSweep', 'gTwist', 'gFlex', 'gFlex2', 'gElev2', 'gSpread', 'gBend',
  // tail
  'tPitch', 'tSpread', 'tBend',
  // legs
  'hipX', 'kneeX', 'ankleX', 'footX', 'grip', 'toeSpread', 'legSplay',
  // body and head
  'bodyPitch', 'chestPitch', 'neckPitch', 'headPitch', 'crest', 'jaw', 'flap',
];
const NK = KEYS.length;
const I = Object.fromEntries(KEYS.map((k, i) => [k, i]));

const GLIDE = {
  wElev: 0.1, wSweep: 0.04, wTwist: 0.04, eElev: 0.02, eFlex: 0.1, eTwist: 0, hElev: -0.05, hFlex: 0.26, hTwist: -0.03,
  pSpread: 0.62, pTwist: 0.1, pBend: 0.06, sBend: 0.02, alula: 0, ruffle: 0,
  gElev: 0.1, gSweep: -0.12, gTwist: 0.02, gFlex: 0.15, gFlex2: 0.25, gElev2: 0, gSpread: 0.55, gBend: 0.04,
  tPitch: 0.0, tSpread: 0.28, tBend: 0,
  hipX: 1.6, kneeX: 0.05, ankleX: -0.1, footX: 0.3, grip: 1, toeSpread: 0, legSplay: -0.08,
  bodyPitch: 0, chestPitch: 0, neckPitch: 0, headPitch: 0, crest: 0.08, jaw: 0, flap: 1,
};

const mk = (o, base = GLIDE) => {
  const a = new Float32Array(NK);
  for (let i = 0; i < NK; i++) a[i] = o[KEYS[i]] ?? base[KEYS[i]] ?? 0;
  return a;
};

/** Pose library. Values are joint angles (rad) or 0..1 drivers. */
export const POSES = {
  glide: mk(GLIDE),
  // active climbing flight: less dihedral, primaries closed, tail fanned for lift
  climb: mk({ wElev: 0.04, pSpread: 0.35, tSpread: 0.5, bodyPitch: 0.1, gSpread: 0.6 }),
  // T: the teardrop stoop, wings folded tight along the flanks, crest flattened
  stoop: mk({
    wElev: -0.06, wSweep: -1.38, wTwist: 0.0, eElev: -0.08, eFlex: 2.9, eTwist: 0, hElev: 0.06, hFlex: 3.0, hTwist: 0,
    pSpread: 0, pTwist: 0, pBend: 0, sBend: 0, gElev: 0.05, gSweep: -1.2, gFlex: 2.3, gFlex2: 2.7, gSpread: 0, gBend: 0,
    tPitch: 0.03, tSpread: 0, hipX: 1.62, kneeX: 0.05, ankleX: -0.1, footX: 0.3, grip: 1, legSplay: -0.09,
    neckPitch: 0.06, headPitch: 0.05, crest: 0, flap: 0,
  }),
  // C: wings half out and cupped (tips down), the first phase of the pull-out
  cup: mk({
    wElev: 0.5, wSweep: 0.1, wTwist: 0.2, eElev: -0.35, eFlex: 0.6, hElev: -0.45, hFlex: 0.75, hTwist: -0.1, nElev: -0.3,
    pSpread: 0.25, pTwist: 0.05, pBend: -0.04, gElev: 0.25, gSweep: -0.35, gFlex: 0.6, gFlex2: 0.8, gSpread: 0.3,
    tSpread: 0.2, crest: 0.2, flap: 0,
  }),
  // M: wrists forward, hands swept back, a fast high-lift planform for the final approach
  mshape: mk({
    wElev: 0.24, wSweep: 0.22, wTwist: 0.04, eElev: -0.08, eFlex: 1.25, hElev: -0.16, hFlex: 1.95, hTwist: 0,
    pSpread: 0.0, pTwist: 0, pBend: 0.02, gElev: 0.1, gSweep: -0.55, gFlex: 1.1, gFlex2: 1.5, gSpread: 0.1,
    tSpread: 0.12, crest: 0.35, flap: 0,
  }),
  // talon strike: body flared up, wings thrown high as air brakes, tail fanned down,
  // legs thrust forward with the toes spread wide, head up and locked on
  strike: mk({
    wElev: 0.7, wSweep: 0.3, wTwist: 0.72, eElev: 0.05, eFlex: 0.55, eTwist: 0.1, hElev: -0.12, hFlex: 0.5, hTwist: 0.3, nElev: -0.12, nFlex: 0.08,
    pSpread: 1.0, pTwist: 0.75, pBend: -0.1, sBend: -0.06, alula: 1, ruffle: 0.55,
    gElev: 0.55, gSweep: 0.3, gTwist: 0.6, gFlex: 0.15, gFlex2: 0.15, gSpread: 1, gBend: -0.06,
    tPitch: -0.5, tSpread: 1, tBend: -0.05,
    hipX: -0.55, kneeX: 0.35, ankleX: -0.65, footX: -0.55, grip: 0, toeSpread: 1, legSplay: 0.16,
    bodyPitch: 0.72, chestPitch: 0.05, neckPitch: 0.25, headPitch: 0.2, crest: 0.95, jaw: 0.28, flap: 0,
  }),
  // knocked out of the air: wings half open (the flail layer animates them), legs dangling
  tumble: mk({
    wElev: 0.3, wSweep: 0.0, wTwist: 0.1, eFlex: 0.55, hFlex: 0.8, nElev: -0.15, pSpread: 0.8, ruffle: 1,
    gElev: 0.2, gFlex: 0.6, gFlex2: 0.8, gSpread: 0.6, tSpread: 0.8,
    hipX: 0.3, kneeX: -0.5, ankleX: 0.9, footX: 0.3, grip: 0.35, toeSpread: 0.5, legSplay: 0.2,
    crest: 0, jaw: 0.35, flap: 0,
  }),
};

const RATES = { glide: 2.2, climb: 2.2, stoop: 1.7, cup: 3.5, mshape: 3.0, strike: 5.5, tumble: 7 };

const _v = new Vector3();
const _v2 = new Vector3();
const _m = new Matrix4();
const _q = new Quaternion();

export class FalconAnimator {
  constructor(model) {
    this.m = model;
    this.b = model.bones;
    this.w = {};
    for (const k in POSES) this.w[k] = k === 'glide' ? 1 : 0;
    this.v = new Float32Array(NK);
    this.L = new Float32Array(NK); // per-side working copies
    this.R = new Float32Array(NK);
    this.phase = 0.5;
    this.amp = 0;
    this.freq = 0.34;
    this.time = 0;
    this.flapEvent = null; // callback(strength)
    this.frozenPhase = null;
    // secondary motion
    this.sCrest = new Spring(0.08, 2.0, 0.36);
    this.sTailPitch = new Spring(0, 1.1, 0.5);
    this.sTailYaw = new Spring(0, 0.9, 0.55);
    this.sTailRoll = new Spring(0, 1.0, 0.5);
    this.sStream = new Spring(0, 0.7, 0.3);
    this.sStreamYaw = new Spring(0, 0.6, 0.3);
    this.sLoad = new Spring(1, 1.4, 0.45);
    this.sHeadYaw = new Spring(0, 1.4, 0.75);
    this.sHeadPitch = new Spring(0, 1.4, 0.75);
    this.sJolt = new Spring(0, 1.6, 0.35);
    this.sLegs = new Spring(0, 1.3, 0.3);
    this.lookYaw = 0;
    this.lookPitch = 0;
    // face
    this.blinkT = 3;
    this.nict = 0;
    this.saccade = new Vector3();
    this.saccadeT = 0;
    this.screechT = -1;
    this.screechDur = 1.9;
    this.pupil = 0.3;
    this.lid = 0.32;
    this.out = { load: 1, bob: 0, downstroke: false, flapPos: 0 };
  }

  screech() { this.screechT = 0; }

  jolt(k = 1) { this.sJolt.impulse(-5 * k); }

  /** Pose weights currently in effect (smoothed), for physics to read wing configuration. */
  weights() { return this.w; }

  /**
   * s: { poses: {name: w}, effort 0..1, turn -1..1 (+ toward +X), roll (rad), pitchRate,
   *      load (g), speed, lookAt (Vector3|null), crest 0..1, grip (0..1|undefined),
   *      flail 0..1, instant (bool: snap weights) }
   */
  update(dt, s) {
    this.time += dt;
    const b = this.b, m = this.m;
    // ---- pose weights --------------------------------------------------------------------
    const P = s.poses || {};
    let wsum = 0;
    for (const k in POSES) {
      const tgt = P[k] ?? 0;
      this.w[k] = s.instant ? tgt : damp(this.w[k], tgt, RATES[k], dt);
      wsum += this.w[k];
    }
    const v = this.v;
    v.fill(0);
    if (wsum < 1e-4) v.set(POSES.glide);
    else {
      for (const k in POSES) {
        const w = this.w[k] / wsum;
        if (w < 1e-5) continue;
        const p = POSES[k];
        for (let i = 0; i < NK; i++) v[i] += p[i] * w;
      }
    }

    // ---- wingbeat ------------------------------------------------------------------------
    const effort = clamp(s.effort ?? 0, 0, 1);
    const allow = clamp(v[I.flap], 0, 1);
    const ampT = s.flapAmp ?? effort * allow;
    this.amp = s.instant ? ampT : damp(this.amp, ampT, 2.4, dt);
    this.freq = damp(this.freq, lerp(0.3, 0.5, effort), 2, dt);
    const prev = this.phase;
    if (this.frozenPhase !== null) this.phase = this.frozenPhase;
    else this.phase += TAU * this.freq * dt;
    // downstroke starts at the top of the stroke (phase = 0 mod 2pi)
    if (Math.floor(this.phase / TAU) !== Math.floor(prev / TAU) && this.amp > 0.18 && this.flapEvent) this.flapEvent(this.amp);
    const A = this.amp;
    const ph = this.phase;
    const sk = ph + 0.3 * Math.sin(ph);
    const c = Math.cos(sk);           // +1 top .. -1 bottom
    const sn = Math.sin(sk);          // > 0 downstroke
    const up = Math.max(0, -sn);      // upstroke amount
    const dn = Math.max(0, sn);
    v[I.wElev] += A * (0.74 * c + 0.05);
    v[I.wSweep] += A * 0.16 * sn;
    v[I.wTwist] += A * (-0.3 * sn + 0.08);
    v[I.eFlex] += A * 0.5 * Math.max(0, -Math.sin(sk - 0.35));
    v[I.eElev] += A * 0.24 * Math.cos(sk - 0.7);
    v[I.hFlex] += A * 0.95 * Math.max(0, -Math.sin(sk - 0.55));
    v[I.hElev] += A * 0.34 * Math.cos(sk - 1.2);
    v[I.hTwist] += A * -0.22 * Math.sin(sk - 0.6);
    v[I.nElev] += A * 0.2 * Math.cos(sk - 1.6);
    v[I.nFlex] += A * 0.18 * Math.max(0, -Math.sin(sk - 0.8));
    v[I.pSpread] += A * (0.5 * up - 0.4 * dn);
    v[I.pTwist] += A * 0.9 * Math.max(0, -Math.sin(sk - 0.3));
    v[I.pBend] += A * 0.16 * sn;
    v[I.sBend] += A * 0.08 * sn;
    v[I.gElev] += A * 0.4 * Math.cos(sk - 0.9);
    v[I.gFlex2] += A * 0.45 * Math.max(0, -Math.sin(sk - 1.0));
    v[I.tPitch] += A * 0.05 * Math.sin(sk - 1.4);
    v[I.bodyPitch] += A * 0.025 * Math.sin(sk - 0.8);
    const bob = -A * 0.5 * Math.cos(sk - 0.5);
    this.out.downstroke = sn > 0;
    this.out.flapPos = c;

    // ---- secondary motion inputs ---------------------------------------------------------
    const turn = clamp(s.turn ?? 0, -1, 1);
    const load = s.load ?? 1;
    this.sLoad.update(dt, clamp(load, -1, 4));
    const pitchRate = clamp(s.pitchRate ?? 0, -2, 2);
    this.sTailPitch.update(dt, clamp(-pitchRate * 0.12 + (this.sLoad.x - 1) * 0.03, -0.35, 0.35));
    this.sTailYaw.update(dt, turn * 0.14);
    this.sTailRoll.update(dt, turn * 0.42);
    const speed = s.speed ?? 20;
    this.sStream.update(dt, clamp(-pitchRate * 0.08 - (this.sLoad.x - 1) * 0.05 + 0.02, -0.25, 0.25));
    this.sStreamYaw.update(dt, -turn * 0.12);
    this.sJolt.update(dt, 0);

    // ---- per-side copies + asymmetric layers -------------------------------------------------
    const L = this.L, R = this.R;
    L.set(v); R.set(v);
    const flail = clamp(s.flail ?? 0, 0, 1);
    const t = this.time;
    for (const [W, sd] of [[L, 1], [R, -1]]) {
      // coordinated turn: the inside wing flexes a touch, the outside reaches
      const inner = turn * sd > 0 ? Math.abs(turn) : 0;
      const outer = turn * sd < 0 ? Math.abs(turn) : 0;
      W[I.hFlex] += inner * 0.22 - outer * 0.06;
      W[I.eFlex] += inner * 0.12;
      W[I.wTwist] += (outer - inner) * 0.06;
      W[I.gTwist] += (outer - inner) * 0.12;
      W[I.pSpread] += outer * 0.15;
      if (flail > 0) {
        const o = sd > 0 ? 0 : 1.7;
        W[I.wElev] += flail * (0.75 * Math.sin(t * 7.3 + o) + 0.35 * Math.sin(t * 12.7 + o * 2.3));
        W[I.wSweep] += flail * 0.55 * Math.sin(t * 5.1 + 2 * o);
        W[I.wTwist] += flail * 0.6 * Math.sin(t * 8.9 + o);
        W[I.eFlex] += flail * (0.4 + 0.45 * Math.sin(t * 6.1 + 3 * o));
        W[I.hFlex] += flail * (0.5 + 0.6 * Math.sin(t * 9.4 - o));
        W[I.hElev] += flail * 0.5 * Math.sin(t * 10.3 + o);
        W[I.gElev] += flail * 0.6 * Math.sin(t * 8.1 + o * 1.3);
        W[I.nElev] += flail * 0.35 * Math.sin(t * 11.2 + o * 0.7);
        W[I.pSpread] += flail * 0.3 * Math.sin(t * 13.0 + o);
      }
    }

    // ---- screech overlay ------------------------------------------------------------------------
    let scr = 0, scrT = 0;
    if (this.screechT >= 0) {
      this.screechT += dt;
      scrT = this.screechT;
      scr = smoothstep(0, 0.14, scrT) * (1 - smoothstep(this.screechDur - 0.4, this.screechDur, scrT));
      if (this.screechT > this.screechDur) this.screechT = -1;
    }

    // ---- write the skeleton ---------------------------------------------------------------------
    // root: bob + whole-body pitch (strike flare)
    b.root.position.set(0, bob + this.sJolt.x * 0.2, 0);
    b.root.rotation.set(-(v[I.bodyPitch] + this.sJolt.x * 0.05), 0, 0, 'YXZ');
    b.chest.rotation.set(-v[I.chestPitch] - scr * 0.06, 0, 0);
    b.pelvis.rotation.set(0, 0, 0);
    // wings
    this._wing('L', L, 1);
    this._wing('R', R, -1);
    // tail
    const tp = v[I.tPitch] + this.sTailPitch.x;
    b.tail1.rotation.set(tp * 0.45, this.sTailYaw.x * 0.5, this.sTailRoll.x * 0.4, 'YXZ');
    b.tail2.rotation.set(tp * 0.55, this.sTailYaw.x * 0.5, this.sTailRoll.x * 0.6, 'YXZ');
    // legs (+ dangling springs when flailing)
    this.sLegs.update(dt, flail * Math.sin(t * 4.3) * 0.5);
    for (const [S, sd] of [['L', 1], ['R', -1]]) {
      const W = sd > 0 ? L : R;
      const dang = this.sLegs.x * (sd > 0 ? 1 : -0.7);
      b['hip' + S].rotation.set(W[I.hipX] + dang * 0.6, 0, sd * W[I.legSplay], 'XYZ');
      b['knee' + S].rotation.set(W[I.kneeX] - dang * 0.4, 0, 0);
      b['ankle' + S].rotation.set(W[I.ankleX] + dang * 0.5, 0, 0);
      b['foot' + S].rotation.set(W[I.footX], 0, 0);
    }
    // toes: curl from the grip, front toes splay with toeSpread
    const toes = m.uBody.uToe.value;
    for (let i = 0; i < 8; i++) {
      const k = i % 4;
      const sd = i < 4 ? 1 : -1;
      const W = sd > 0 ? L : R;
      const g = clamp(s.grip ?? W[I.grip], 0, 1);
      const curl = lerp(-0.35, k === 3 ? 2.3 : 2.6, g) + (k === 0 ? 0.05 : 0);
      const spread = W[I.toeSpread];
      const sp = k === 1 ? -sd * (0.08 + 0.3 * spread) : k === 2 ? sd * (0.06 + 0.32 * spread) : k === 3 ? sd * 0.1 * spread : 0;
      toes[i].x = curl;
      toes[i].y = sp;
    }

    // ---- head & neck: track the target, stay level in banks, screech shake ---------------------------
    let lyT = 0, lpT = 0;
    if (s.lookAt) {
      m.group.updateMatrixWorld(false);
      _m.copy(m.group.matrixWorld).invert();
      _v.copy(s.lookAt).applyMatrix4(_m).sub(m.boneAbs.neck1);
      // remove the body pitch carried by the root bone
      const bp = v[I.bodyPitch];
      const cy = Math.cos(bp), sy = Math.sin(bp);
      const y = _v.y * cy - _v.z * sy, z = _v.y * sy + _v.z * cy;
      _v.y = y; _v.z = z;
      if (_v.lengthSq() > 4) {
        lyT = clamp(Math.atan2(_v.x, _v.z), -1.65, 1.65);
        lpT = clamp(Math.atan2(_v.y, Math.hypot(_v.x, _v.z)), -1.0, 0.75);
      }
    }
    this.sHeadYaw.update(dt, lyT);
    this.sHeadPitch.update(dt, lpT);
    const ly = this.sHeadYaw.x, lp = this.sHeadPitch.x;
    const shake = scr * 0.11 * Math.sin(scrT * TAU * 6.5) * (1 - smoothstep(0.6, 1.6, scrT) * 0.5);
    const level = (s.levelHead ?? 1) * clamp(-(s.roll ?? 0) * 0.75, -0.9, 0.9);
    const np = v[I.neckPitch], hp = v[I.headPitch];
    b.neck1.rotation.set(-lp * 0.28 + np * 0.5 + scr * 0.12, ly * 0.24, level * 0.2, 'YXZ');
    b.neck2.rotation.set(-lp * 0.32 + np * 0.5 + scr * 0.1, ly * 0.32 + shake * 0.4, level * 0.35, 'YXZ');
    b.head.rotation.set(-lp * 0.4 + hp - scr * 0.32 + this.sJolt.x * 0.04, ly * 0.44 + shake, level * 0.45 + shake * 0.5, 'YXZ');
    // beak: the jaw drops and the upper mandible lifts a little (cranial kinesis)
    const jaw = Math.max(v[I.jaw], s.jaw ?? 0, scr * (0.88 + 0.08 * Math.sin(scrT * 47)));
    b.jaw.rotation.set(jaw * 0.6, 0, 0);
    b.beak.rotation.set(-jaw * 0.11, 0, 0);
    // crest: flares on screech and in the hunt, with an under-damped settle
    const crestT = clamp(Math.max(s.crest ?? 0, v[I.crest], scr * 1.1), 0, 1.15);
    this.sCrest.update(dt, crestT);
    const cr = this.sCrest.x;
    // folded plumes stay laid along the nape whatever the head does; flared, they rise
    // flared, the bone stands the plumes up and they fan into a forward-facing dish
    const headPitch = -lp + np + hp - scr * 0.1;
    b.crest.rotation.set(-headPitch * 0.75 * (1 - smoothstep(0.2, 0.8, cr)) + clamp(cr, 0, 1.1) * 1.2, 0, 0);

    // ---- feather groups -----------------------------------------------------------------------------
    const GA = m.uFeather.uGA.value, GB = m.uFeather.uGB.value;
    const air = clamp(speed / 60, 0, 1.5);
    const flutterP = 0.004 + air * 0.012;
    const loadBend = (this.sLoad.x - 1) * 0.035;
    for (const [W, sd] of [[L, 1], [R, -1]]) {
      const pFold = clamp((W[I.hFlex] - 0.3) / 2.6, 0, 1);
      const sFold = clamp((W[I.eFlex] - 0.2) / 2.55, 0, 1);
      const gFold = clamp((W[I.gFlex2] - 0.3) / 2.3, 0, 1);
      const sp = clamp(W[I.pSpread], -0.3, 1.4) * (1 - pFold);
      const rf = W[I.ruffle];
      GA[sd > 0 ? FG.PRI_L : FG.PRI_R].set(sp, pFold, W[I.pTwist] * (1 - pFold), W[I.pBend] + loadBend * (1 - pFold));
      GB[sd > 0 ? FG.PRI_L : FG.PRI_R].set(flutterP * (1 - pFold), 0, rf * 0.25, 14);
      GA[sd > 0 ? FG.SEC_L : FG.SEC_R].set(0, sFold, W[I.pTwist] * 0.25, W[I.sBend] + loadBend * 0.5 * (1 - sFold));
      GB[sd > 0 ? FG.SEC_L : FG.SEC_R].set(flutterP * 0.6 * (1 - sFold), 0, rf * 0.2, 12);
      GA[sd > 0 ? FG.COV_L : FG.COV_R].set(0, (pFold + sFold) * 0.5, 0, 0);
      GB[sd > 0 ? FG.COV_L : FG.COV_R].set(0, rf * 0.35 + W[I.alula] * 0.12, rf, 0);
      GA[sd > 0 ? FG.ALU_L : FG.ALU_R].set(0, pFold, 0, 0);
      GB[sd > 0 ? FG.ALU_L : FG.ALU_R].set(0, W[I.alula] * 0.55, rf * 0.5, 0);
      GA[sd > 0 ? FG.HW_L : FG.HW_R].set(W[I.gSpread] * (1 - gFold), gFold, W[I.pTwist] * 0.6 * (1 - gFold), W[I.gBend]);
      GB[sd > 0 ? FG.HW_L : FG.HW_R].set(flutterP * (1 - gFold), 0, rf * 0.25, 13);
      GA[sd > 0 ? FG.HWC_L : FG.HWC_R].set(0, gFold, 0, 0);
      GB[sd > 0 ? FG.HWC_L : FG.HWC_R].set(0, rf * 0.3, rf, 0);
      // scapulars lift a little when the wing is raised so the root stays covered
      GB[sd > 0 ? FG.SCAP_L : FG.SCAP_R].set(0, clamp(W[I.wElev] * 0.35, -0.2, 0.5), rf * 0.6, 0);
      GB[sd > 0 ? FG.TROU_L : FG.TROU_R].set(0.01 + air * 0.01, rf * 0.5, rf, 9);
    }
    const ts = clamp(v[I.tSpread] + Math.abs(turn) * 0.3 + scr * 0.2, 0, 1.2);
    GA[FG.TAIL].set(ts, 0, this.sTailRoll.x * 0.3, v[I.tBend]);
    GB[FG.TAIL].set(flutterP * 0.7, 0, v[I.ruffle] * 0.3, 11);
    // streamers: shared sideways swing in turns (fold slot) plus a lazy wander
    GA[FG.STREAM].set(ts, this.sStreamYaw.x + 0.035 * Math.sin(t * 1.3), 0, this.sStream.x + 0.02);
    GB[FG.STREAM].set(0.012 + air * 0.035, 0, 0, 4.5 + air * 4);
    GA[FG.TAILCOV].set(ts * 0.5, 0, 0, 0);
    GB[FG.TAILCOV].set(0, 0, v[I.ruffle] * 0.6, 0);
    GA[FG.CREST].set(clamp(cr, 0, 1.1), 0, 0, 0.04 * cr);
    GB[FG.CREST].set(0.01 + 0.03 * cr * air, cr * 0.2, 0, 7);
    this.out.load = this.sLoad.x;
    this.out.bob = bob;
    this.out.scr = scr;
  }

  _wing(S, W, sd) {
    const b = this.b;
    b['sh' + S].rotation.set(-W[I.wTwist], -sd * W[I.wSweep], sd * W[I.wElev], 'ZYX');
    b['el' + S].rotation.set(-W[I.eTwist], -sd * W[I.eFlex], sd * W[I.eElev], 'ZYX');
    b['wr' + S].rotation.set(-W[I.hTwist], sd * W[I.hFlex], sd * W[I.hElev], 'ZYX');
    b['hd' + S].rotation.set(0, sd * W[I.nFlex], sd * W[I.nElev], 'ZYX');
    b['hw1' + S].rotation.set(-W[I.gTwist], -sd * W[I.gSweep], sd * W[I.gElev], 'ZYX');
    b['hw2' + S].rotation.set(0, -sd * W[I.gFlex], sd * W[I.gElev2], 'ZYX');
    b['hw3' + S].rotation.set(-W[I.gTwist] * 0.5, sd * W[I.gFlex2], sd * W[I.gElev] * 0.3, 'ZYX');
  }

  /**
   * Eyes: gaze into socket space, lids by mood, blinks with the nictitating membrane.
   * Call after the group's world matrices are current.
   * f: { lookAt, intensity 0..1 (hunting focus), wide 0..1, squint 0..1 }
   */
  updateFace(dt, f) {
    const m = this.m;
    const eu = m.uEye;
    // nictitating blink every few seconds (a quick horizontal sweep)
    this.blinkT -= dt;
    if (this.blinkT <= 0) {
      this.nict = 1;
      this.blinkT = 2.5 + Math.random() * 4;
    }
    this.nict = Math.max(0, this.nict - dt * 4.2);
    eu.uNict.value = Math.sin(Math.min(1, this.nict) * Math.PI);
    const scr = this.out.scr || 0;
    const wide = clamp(Math.max(f.wide ?? 0, scr), 0, 1);
    const squint = clamp(f.squint ?? 0, 0, 1);
    const focus = clamp(f.intensity ?? 0, 0, 1);
    const lidT = lerp(lerp(0.22, 0.12, focus), 0.5, wide) - squint * 0.3;
    this.lid = damp(this.lid, lidT, 10, dt);
    const slant = lerp(0.24, 0.34, focus) * (1 - wide * 0.7);
    eu.uLids.value.set(this.lid, lerp(-0.62, -0.45, squint), slant, 0.1);
    eu.uLids2.value.set(lerp(0.55, 0.15, squint), -0.7, 0, 0);
    this.pupil = damp(this.pupil, lerp(0.27, 0.19, Math.max(focus, wide)), 5, dt);
    eu.uPupil.value = this.pupil;
    // gaze
    this.saccadeT -= dt;
    if (this.saccadeT <= 0) {
      this.saccade.set((Math.random() - 0.5) * 0.05, (Math.random() - 0.5) * 0.03, 0);
      this.saccadeT = 0.3 + Math.random() * 1.4;
    }
    const head = this.b.head;
    _m.copy(head.matrixWorld);
    _q.setFromRotationMatrix(_m).invert();
    const gz = eu.uGaze.value;
    for (let i = 0; i < 4; i++) {
      const eb = m.eyeBasis[i];
      const out = _v2.set(0, 0, 1);
      if (f.lookAt) {
        // eye centre in world space: head bone world * (centre - head bind position)
        _v.copy(eb.center).sub(m.boneAbs.head).applyMatrix4(_m);
        _v.subVectors(f.lookAt, _v).normalize().applyQuaternion(_q);
        out.set(_v.dot(eb.x), _v.dot(eb.y), _v.dot(eb.z));
        // raptor eyes barely rotate in the socket: the head does the looking
        if (out.z < 0.94) {
          out.z = 0.94;
          const xy = Math.hypot(out.x, out.y) || 1;
          const k = Math.sqrt(1 - 0.94 * 0.94) / xy;
          out.x *= k; out.y *= k;
        }
      }
      out.x += this.saccade.x;
      out.y += this.saccade.y;
      out.normalize();
      gz[i].lerp(out, 1 - Math.exp(-14 * dt)).normalize();
    }
  }
}
