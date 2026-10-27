// The storm falcon: SKYSONG's apex predator. A ~25 m hexapod raptor with a ~70 m primary
// wingspan that hunts sky-whale calves by listening for their song.
//
// Flight is a point-mass glider with aerodynamic limits: lift is perpendicular to the
// velocity, capped by wing configuration (folded wings cannot turn hard) and by a load
// factor; the bird banks its lift vector into turns at a finite roll rate (so it never
// slides), gravity accelerates it in the stoop, drag and induced drag bleed speed in the
// pull-out, and flapping only adds thrust when the physics asks for it. Attacks use
// proportional navigation, the guidance law real peregrines follow (Brighton et al. 2017).
//
//   const falcon = new Falcon(game);
//   falcon.target = calf;                 // anything with .pos and .vel (Vector3)
//   falcon.obstacles = adults;            // optional: things with .pos and .radius it won't fly through
//   falcon.on('strikeHit', ({ target }) => ...);
//   falcon.setMode('circle', { center, radius: 220, altitude: 320 });
//   falcon.setMode('dive');               // dive -> strike -> pullout -> circle flow automatically
//   falcon.update(dt);                    // every frame
//
// Modes: 'hidden' | 'circle' | 'shadowPass' | 'stalk' | 'dive' | 'strike' | 'pullout' | 'knockback' | 'retreat'
// Events: 'screech', 'flap', 'strikeHit', 'strikeMiss', 'retreated', 'modeChange'
//         (+ 'knockback', 'passDone', 'stoop' for audio/camera cues)
import { Vector3, Quaternion, Matrix4 } from 'three';
import { FalconModel } from './falcon/FalconModel.js';
import { FalconAnimator } from './falcon/FalconAnimator.js';
import { G } from '../render/Globals.js';
import { clamp, lerp, damp, smoothstep, rng } from '../core/math.js';

const GRAV = 9.81;
// Wing configurations: lift capacity (fraction of the open wing) and profile drag per v².
const CONFIG = {
  glide: { area: 1.0, kD: 0.0009 },
  climb: { area: 1.0, kD: 0.001 },
  stoop: { area: 0.15, kD: 0.00052 },
  cup: { area: 0.62, kD: 0.0019 },
  mshape: { area: 0.58, kD: 0.0011 },
  strike: { area: 1.1, kD: 0.0042 },
  tumble: { area: 0.3, kD: 0.003 },
};
const PHYS = {
  kL: 0.045,      // max lift per v² with open wings (stall speed ~15 m/s)
  nMax: 3.4,      // load factor limit (g): a 70 m bird turns slower than it dives
  kI: 1.8,        // induced drag factor
  pMax: 52,       // flapping power per unit mass: thrust = P / v
  tMax: 4.6,      // max flapping thrust (m/s²)
  rollRate: 1.45, // rad/s
};
const SOAR_LIFT = 0.85; // rising air the falcon rides while soaring (m/s²)

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _d = new Vector3();
const _e = new Vector3();
const _q = new Quaternion();
const _m = new Matrix4();
const _gv = new Vector3(0, -GRAV, 0);
const _gTmp = new Vector3();
const UP = new Vector3(0, 1, 0);
const IDQ = new Quaternion();

export const FALCON_MODES = ['hidden', 'circle', 'shadowPass', 'stalk', 'dive', 'strike', 'pullout', 'knockback', 'retreat'];

export class Falcon {
  constructor(game, opts = {}) {
    this.game = game;
    this.model = new FalconModel(opts.look);
    this.anim = new FalconAnimator(this.model);
    this.group = this.model.group;
    game.engine.scene.add(this.group);
    if (opts.shadows !== false) this.model.castShadows(game.engine.shadows);
    this.wingspan = 70;
    this.length = 25;
    this.radius = 13; // body collision radius (talons excluded)

    this.pos = new Vector3(0, 400, 0);
    this.vel = new Vector3(0, 0, 25);
    this.up = new Vector3(0, 1, 0);       // lift / bank direction (perpendicular to vel)
    this.fwd = new Vector3(0, 0, 1);      // body axis
    this.right = new Vector3(1, 0, 0);    // model +X (the falcon's left wing)
    this.quat = new Quaternion();
    this.tumbleQ = new Quaternion();
    this.tumbleW = new Vector3();
    this.talonPos = new Vector3();
    this._talonPrev = new Vector3();
    this._tgtPrev = new Vector3();
    this._vdirPrev = new Vector3(0, 0, 1);

    this.target = null;
    this.obstacles = [];
    this.mode = 'hidden';
    this.modeT = 0;
    this.params = {};
    this.time = 0;
    this.effort = 0;
    this.load = 1;
    this.speed = 25;
    this.turnRate = 0;
    this.pitchRate = 0;
    this.roll = 0;
    this.aoa = 0;
    this.circleCfg = null;
    this.moverSlot = opts.moverSlot ?? 11; // G.uMovers slot used to part clouds (-1 = off)
    this.fx = opts.fx ?? true;
    this.frozen = false;                   // dev: hold position, keep animating
    this.posePreview = null;               // dev: { poses, effort, flail, crest, grip }
    this.r = rng(opts.seed ?? 3);
    this._ai = {};
    this._cmd = {
      acc: new Vector3(), poses: { glide: 1 }, effort: undefined, burst: 0, crest: 0, grip: undefined,
      look: null, focus: 0, wide: 0, squint: 0, flail: 0, updraft: 0, levelHead: 1, brake: 0, jaw: 0,
    };
    this._as = { poses: null };
    this.listeners = {};
    this._fxT = 0;
    this._cloudT = 0;
    this._inCloud = 0;
    this.anim.flapEvent = (a) => {
      this.emit('flap', { strength: a, pos: this.pos });
      if (this.fx && a > 0.5) this._flapPuffs(a);
    };
    this.group.visible = false;
  }

  // ---- events ---------------------------------------------------------------------------------
  on(ev, fn) {
    (this.listeners[ev] || (this.listeners[ev] = [])).push(fn);
    return () => this.off(ev, fn);
  }
  off(ev, fn) {
    const l = this.listeners[ev];
    if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }
  }
  emit(ev, data = {}) {
    const l = this.listeners[ev];
    if (l) for (const f of l.slice()) f(data, this);
  }

  // ---- public API -----------------------------------------------------------------------------------
  setMode(mode, params = {}) {
    if (!FALCON_MODES.includes(mode)) { console.warn('[falcon] unknown mode', mode); return; }
    const prev = this.mode;
    const wasHidden = prev === 'hidden' || !this.group.visible;
    this.mode = mode;
    this.modeT = 0;
    this.params = params || {};
    this._ai = {};
    const P = this.params;
    const T = this.target;
    switch (mode) {
      case 'hidden':
        this.group.visible = false;
        this.model.vanish.value = 0;
        this._mover(false);
        break;
      case 'circle': {
        const c = this.circleCfg || {};
        // the centre may be a live reference (e.g. the herd centre) so the circle travels with it
        const center = P.center || c.center || (T && T.pos) || this.pos.clone();
        this.circleCfg = {
          center,
          radius: P.radius ?? c.radius ?? 220,
          altitude: P.altitude ?? c.altitude ?? center.y + 150,
          dir: P.dir ?? c.dir ?? 1,
          speed: P.speed ?? c.speed ?? 27,
        };
        if (wasHidden || P.teleport) {
          const cc = this.circleCfg;
          const a = P.startAngle ?? this.r() * Math.PI * 2;
          this.pos.set(cc.center.x + Math.sin(a) * cc.radius, cc.altitude, cc.center.z + Math.cos(a) * cc.radius);
          _a.set(Math.cos(a), 0, -Math.sin(a)).multiplyScalar(cc.dir);
          this._place(this.pos, _a, cc.speed);
        }
        break;
      }
      case 'shadowPass': {
        const line = this._passLine(P);
        this._ai.A = line.from;
        this._ai.B = line.to;
        if (wasHidden || P.teleport !== false && this.pos.distanceTo(line.from) > 1500) {
          _a.subVectors(line.to, line.from).normalize();
          // startOffset > 0 starts further back along the line (more lead time before the crossing)
          _b.copy(line.from).addScaledVector(_a, -(P.startOffset ?? 0));
          this._place(_b, _a, P.speed ?? 31);
        }
        break;
      }
      case 'stalk':
        if (!T) { this.setMode('circle', P); return; }
        if (wasHidden) {
          _a.set(T.vel.x, 0, T.vel.z);
          if (_a.lengthSq() < 4) _a.set(0, 0, 1);
          _a.normalize();
          _b.copy(T.pos).addScaledVector(_a, -(P.behind ?? 100) * 1.8).add(_c.set(0, (P.above ?? 120) * 1.3, 0));
          this._place(_b, _a, Math.max(18, T.vel.length()));
        }
        break;
      case 'dive': {
        if (!T) { this.setMode('circle', P); return; }
        if (wasHidden) {
          _a.copy(this._approachDir(P));
          _b.copy(T.pos).addScaledVector(_a, -260).add(_c.set(0, 300, 0));
          this._place(_b, _a, 26);
        }
        const above = this.pos.y - T.pos.y;
        const dist = this.pos.distanceTo(T.pos);
        const H = Math.hypot(T.pos.x - this.pos.x, T.pos.z - this.pos.z);
        // wing-over into the stoop when there is height to fall from, a direct lunge when close;
        // from too far out it first closes in, high, until the calf is well below it
        if (above > 45 && dist > 120) this._ai.phase = Math.atan2(above, H) > 0.55 ? 'rollin' : 'approach';
        else this._ai.phase = 'flare';
        this._ai.flareT = 0;
        this._ai.approach = this._approachDir(P).clone();
        if (P.screech) this.screech();
        break;
      }
      case 'strike':
        if (!T) { this.setMode('pullout', P); return; }
        this._ai.minDist = Infinity;
        this._ai.resolved = false;
        this._ai.hit = false;
        this._ai.resolveT = 0;
        this._ai.hitRadius = P.hitRadius ?? 6;
        this._ai.aimOff = new Vector3(0, 4.5, -1);
        this._talonPrev.copy(this.talonPos);
        this._tgtPrev.copy(T.pos);
        if (wasHidden) {
          _a.copy(this._approachDir(P));
          _b.copy(T.pos).addScaledVector(_a, -90).add(_c.set(0, 40, 0));
          this._place(_b, _c.subVectors(T.pos, _b).normalize(), 55);
        }
        break;
      case 'pullout':
        this._ai.hd = new Vector3(this.vel.x, 0, this.vel.z);
        if (this._ai.hd.lengthSq() < 1) this._ai.hd.set(this.fwd.x, 0, this.fwd.z);
        if (this._ai.hd.lengthSq() < 1e-4) this._ai.hd.set(0, 0, 1);
        this._ai.hd.normalize();
        this._ai.climbAlt = P.altitude ?? (this.circleCfg ? this.circleCfg.altitude : (T ? T.pos.y + 150 : this.pos.y + 120));
        break;
      case 'knockback':
        this._ai.dur = P.duration ?? 1.2 + 0.9 * (P.strength ?? 1);
        break;
      case 'retreat': {
        this._ai.start = this.pos.clone();
        this._ai.vanish = 0;
        const d = P.dir ? P.dir.clone() : new Vector3();
        if (!P.dir) {
          const from = P.from || (T && T.pos) || null;
          if (from) d.subVectors(this.pos, from); else d.copy(this.vel);
          d.y = 0;
          if (d.lengthSq() < 1) d.set(this.fwd.x, 0, this.fwd.z);
          if (d.lengthSq() < 1e-4) d.set(0, 0, 1);
        }
        this._ai.dir = d.setY(0).normalize();
        break;
      }
      default:
        break;
    }
    if (mode !== 'hidden') this.group.visible = true;
    this.emit('modeChange', { mode, prev, params: this.params });
  }

  /** Sonic-boom hit: tumble away from fromPos. strength 0..2. */
  knockback(fromPos, strength = 1) {
    if (this.mode === 'hidden') return;
    const s = clamp(strength, 0, 2);
    const dir = _a.subVectors(this.pos, fromPos);
    if (dir.lengthSq() < 1) dir.set(0, 1, 0);
    dir.normalize();
    dir.y = Math.max(dir.y, -0.25) + 0.3;
    dir.normalize();
    this.vel.addScaledVector(dir, 9 + 15 * s);
    // tumble: mostly pitch and roll, away from the blast
    _b.crossVectors(dir, UP);
    if (_b.lengthSq() < 1e-3) _b.set(1, 0, 0);
    _b.normalize();
    // body-frame angular velocity
    _q.copy(this.quat).invert();
    _b.applyQuaternion(_q);
    _b.z += (this.r() - 0.5) * 1.2;
    _b.x += (this.r() - 0.5) * 0.4;
    this.tumbleW.copy(_b.normalize()).multiplyScalar(2.3 + 2.4 * s);
    this.anim.jolt(1 + s);
    if (this.fx) this._burstPuffs(this.pos, 22 + 12 * s, 9 + 6 * s, 1.0);
    this.emit('knockback', { strength: s, from: fromPos.clone() });
    if (this.mode === 'retreat') return;
    this.setMode('knockback', { strength: s });
  }

  /** Play the screech (emits 'screech' for audio, even while hidden: a distant cry). */
  screech() {
    const visible = this.mode !== 'hidden';
    if (visible) {
      this.anim.screech();
      if (this.fx) this._screechRing();
    }
    this.emit('screech', { pos: this.pos.clone(), distant: !visible });
  }

  // ---- frame update ------------------------------------------------------------------------------------
  update(dt) {
    if (!(dt > 0)) return;
    if (this.mode === 'hidden') {
      this.group.visible = false;
      this._mover(false);
      return;
    }
    this.group.visible = true;
    this.time += dt;
    this.modeT += dt;
    const cmd = this._guide(dt);
    if (this.posePreview) Object.assign(cmd, this.posePreview);
    if (!this.frozen) {
      const n = Math.max(1, Math.ceil(dt * 60 - 1e-6));
      const h = dt / n;
      for (let i = 0; i < n; i++) this._step(h, cmd);
    }
    this._attitude(dt);
    this._animate(dt, cmd);
    this._post(dt);
  }

  // ---- guidance ------------------------------------------------------------------------------------------
  _resetCmd() {
    const c = this._cmd;
    c.acc.set(0, 0, 0);
    c.poses = this._poses || (this._poses = {});
    for (const k in c.poses) c.poses[k] = 0;
    c.effort = undefined;
    c.burst = 0;
    c.crest = 0;
    c.grip = undefined;
    c.look = this.target ? this.target.pos : null;
    c.focus = 0.4;
    c.wide = 0;
    c.squint = 0;
    c.flail = 0;
    c.updraft = 0;
    c.levelHead = 1;
    c.brake = 0;
    c.jaw = 0;
    c.instant = false;
    c.flapAmp = undefined;
    c.rollBoost = 0;
    c.maxBank = undefined;
    if (c.direct) c.direct.set(0, 0, 0);
    return c;
  }

  _guide(dt) {
    const c = this._resetCmd();
    const ai = this._ai;
    const P = this.params;
    const T = this.target;
    switch (this.mode) {
      case 'circle': {
        const cc = this.circleCfg;
        const C = cc.center;
        _a.set(this.pos.x - C.x, 0, this.pos.z - C.z);
        const d = _a.length() || 1;
        _a.divideScalar(d);
        _b.set(_a.z, 0, -_a.x).multiplyScalar(cc.dir); // tangent
        const err = (d - cc.radius) / cc.radius;
        _c.copy(_b).addScaledVector(_a, -clamp(err * 2.2, -1.2, 1.2)).normalize();
        const vy = clamp((cc.altitude - this.pos.y) * 0.12, -4, 3.5);
        _d.copy(_c).multiplyScalar(cc.speed).setY(vy);
        c.acc.subVectors(_d, this.vel).multiplyScalar(0.55);
        c.acc.addScaledVector(_a, -(cc.speed * cc.speed / cc.radius) * smoothstep(0.6, 0.1, Math.abs(err)));
        c.updraft = SOAR_LIFT;
        c.poses.glide = 1;
        c.burst = this._burst(dt, 8, 14, 2);
        c.look = T ? T.pos : C;
        c.crest = 0.12;
        c.focus = 0.5;
        break;
      }
      case 'shadowPass': {
        const A = ai.A, B = ai.B;
        _a.subVectors(B, A);
        const len = _a.length();
        _a.divideScalar(len || 1);
        const proj = _b.subVectors(this.pos, A).dot(_a);
        _c.copy(A).addScaledVector(_a, Math.max(proj, 0) + 110);
        _c.y = lerp(A.y, B.y, clamp((proj + 110) / len, 0, 1));
        _d.subVectors(_c, this.pos).normalize().multiplyScalar(P.speed ?? 31);
        c.acc.subVectors(_d, this.vel).multiplyScalar(0.7);
        c.updraft = SOAR_LIFT;
        c.poses.glide = 1;
        c.burst = this._burst(dt, 3.5, 5.5, 2.2);
        c.look = T ? T.pos : (P.over || null);
        c.crest = 0.3;
        c.focus = 0.7;
        if (!ai.passDone && proj >= len) {
          ai.passDone = true;
          this.emit('passDone', {});
        }
        if (ai.passDone && proj >= len + (P.exitDistance ?? 900)) {
          if (P.then) this.setMode(P.then, P.thenParams || {});
          else this.setMode('hidden');
          return this._cmd;
        }
        break;
      }
      case 'stalk': {
        if (!T) { this.setMode('circle'); return this._cmd; }
        _a.set(T.vel.x, 0, T.vel.z);
        if (_a.lengthSq() < 4) _a.set(T.pos.x - this.pos.x, 0, T.pos.z - this.pos.z);
        if (_a.lengthSq() < 1e-4) _a.set(0, 0, 1);
        _a.normalize();
        _b.set(_a.z, 0, -_a.x);
        const weave = Math.sin(this.time * 0.15) * (P.weave ?? 40);
        _c.copy(T.pos).addScaledVector(_a, -(P.behind ?? 100)).addScaledVector(_b, weave);
        _c.y += P.above ?? 120;
        _d.subVectors(_c, this.pos).multiplyScalar(0.28).add(T.vel);
        const sp = _d.length();
        if (sp < 16) _d.multiplyScalar(16 / Math.max(sp, 1e-3));
        if (sp > 44) _d.multiplyScalar(44 / sp);
        c.acc.subVectors(_d, this.vel).multiplyScalar(0.8);
        c.updraft = SOAR_LIFT;
        c.poses.glide = 1;
        c.burst = this._burst(dt, 5, 9, 2.2);
        c.crest = 0.45;
        c.focus = 1;
        break;
      }
      case 'dive': {
        if (!T) { this.setMode('circle'); return this._cmd; }
        const speed = this.vel.length();
        if (ai.phase === 'approach') {
          _a.set(T.pos.x - this.pos.x, 0, T.pos.z - this.pos.z);
          const H = _a.length();
          _a.divideScalar(Math.max(H, 1e-3));
          const h = Math.max(this.pos.y - T.pos.y, P.height ?? 140);
          _b.copy(T.pos).addScaledVector(T.vel, 2).addScaledVector(_a, -0.85 * h);
          _b.y = T.pos.y + h;
          _c.subVectors(_b, this.pos);
          const dd = _c.length();
          _d.copy(_c).multiplyScalar((P.approachSpeed ?? 40) / Math.max(dd, 1));
          c.acc.subVectors(_d, this.vel).multiplyScalar(0.8);
          c.updraft = SOAR_LIFT;
          c.poses.climb = 1;
          c.crest = 0.6;
          c.focus = 1;
          if (Math.atan2(this.pos.y - T.pos.y, H) > 0.6 || dd < 40) {
            ai.phase = 'rollin';
            ai.rollT0 = this.modeT;
          }
          this._avoid(c.acc);
          break;
        }
        if (ai.phase === 'rollin' || ai.phase === 'stoop') {
          const dist = this.pos.distanceTo(T.pos);
          const tgo = dist / Math.max(speed, 35);
          // gate: above and short of the calf on the attack line, so the stoop is steep and the
          // final approach after the pull-out is shallow (the J-shaped peregrine stoop)
          _a.copy(T.pos).addScaledVector(T.vel, tgo * 0.85);
          if (!P.approach) {
            // keep the stoop in the vertical plane through the calf, so the pull-out flows
            // straight into the final approach with no late sideways correction
            _e.set(_a.x - this.pos.x, 0, _a.z - this.pos.z);
            if (_e.lengthSq() > 25) ai.approach.lerp(_e.normalize(), 1 - Math.exp(-1.5 * dt)).normalize();
          }
          if (ai.Dg === undefined) {
            // the gate rides with the calf; its offset is fixed when the stoop begins
            const H = Math.hypot(_a.x - this.pos.x, _a.z - this.pos.z);
            ai.Dg = clamp(H * 0.5, 70, P.gate ?? 150);
          }
          const Dg = ai.Dg;
          _a.addScaledVector(ai.approach, -Dg);
          _a.y += 30 + Dg * 0.42;
          (ai.gate || (ai.gate = new Vector3())).copy(_a);
          _b.subVectors(_a, this.pos);
          // lead pursuit of the (moving) gate: a stable first-order turn of the velocity
          _d.copy(_b).normalize().multiplyScalar(Math.max(speed, 20));
          c.acc.subVectors(_d, this.vel).multiplyScalar(1.1).clampLength(0, 40);
          c.crest = 0;
          c.focus = 1;
          c.levelHead = 0.4;
          c.effort = 0;
          if (ai.phase === 'rollin') {
            // wing-over: wings still open so it can roll and pull its nose down hard
            c.poses.glide = 0.55;
            c.poses.cup = 0.45;
            c.rollBoost = 1.2;
            c.acc.y -= 8;
            // tuck only once lined up on the gate: folded wings cannot fix a bad line later
            const sinG = this.vel.y / Math.max(speed, 1);
            const aligned = _b.dot(this.vel) / Math.max(_b.length() * speed, 1e-3) > 0.97;
            if ((sinG < -0.6 && aligned) || this.modeT - (ai.rollT0 || 0) > 4) {
              ai.phase = 'stoop';
              this.emit('stoop', {});
            }
          } else {
            // the teardrop: the tuck opens a little when it must steer harder than folded wings allow
            const need = this._liftNeed(c.acc);
            const lmaxStoop = PHYS.kL * speed * speed * CONFIG.stoop.area;
            const open = smoothstep(1.15, 2.2, need / Math.max(lmaxStoop, 0.5)) * smoothstep(12, 30, speed);
            c.poses.stoop = 1 - open * 0.6;
            c.poses.cup = open * 0.6;
          }
          if (_b.length() < 40 || dist < Dg * 1.1 || (_b.dot(this.vel) < 0 && this.modeT > 1)) ai.phase = 'flare';
        } else {
          ai.flareT += dt;
          // aim above the calf while far, converging on it as the range closes: the pull-out
          // flattens the final approach into a shallow, readable talon strike
          const rr = this.pos.distanceTo(T.pos);
          _a.copy(T.pos).add(_b.set(0, 4.5 + clamp((rr - 80) * 0.3, 0, 30), 0));
          _b.subVectors(_a, this.pos);
          _c.subVectors(T.vel, this.vel);
          this._steerAt(_b, _c, 3.6, c.acc);
          const cupW = 1 - smoothstep(0.3, 0.8, ai.flareT);
          c.poses.cup = cupW;
          c.poses.mshape = 1 - cupW;
          c.maxBank = lerp(1.4, 0.9, smoothstep(0.0, 1.2, ai.flareT));
          c.crest = 0.45;
          c.focus = 1;
          c.levelHead = 0.5;
          c.effort = 0;
          const r = _b.length();
          const vc = -_b.dot(_c) / Math.max(r, 1e-3);
          const tgo = r / Math.max(vc, 5);
          if (tgo < (P.strikeTime ?? 0.95) || r < 32) {
            this.setMode('strike', { hitRadius: P.hitRadius, outcome: P.outcome, reach: P.reach });
            return this._guide(0);
          }
        }
        this._avoid(c.acc);
        if (ai.phase === 'flare' && this.pos.distanceTo(T.pos) < (P.abortRange ?? 95)) {
          // a protecting adult is in the way: sheer off and climb
          const o = this._blocker();
          if (o) { this._blocked(o); return this._cmd; }
        }
        break;
      }
      case 'strike': {
        if (!T) { this.setMode('pullout'); return this._cmd; }
        if (!ai.resolved && this.modeT > 0.1) {
          const o = this._blocker();
          if (o) { this._blocked(o); return this._cmd; }
        }
        // aim the talons, not the body: in the strike pose they reach ~6 m ahead and ~4.5 m
        // below the centre of mass (flight frame)
        ai.aimOff.copy(this.up).multiplyScalar(4.5).addScaledVector(this.vel, -6 / Math.max(this.vel.length(), 1));
        if (P.outcome === 'miss') {
          // a scripted near miss: the talons rake the air a body length beside the calf
          if (!ai.missOff) {
            _e.crossVectors(this.vel, UP);
            if (_e.lengthSq() < 1e-4) _e.set(1, 0, 0);
            ai.missOff = _e.normalize().multiplyScalar((this.r() < 0.5 ? -1 : 1) * (ai.hitRadius + 5)).add(new Vector3(0, 3, 0));
          }
          ai.aimOff.add(ai.missOff);
        }
        _b.copy(T.pos).add(ai.aimOff).sub(this.pos);
        _c.subVectors(T.vel, this.vel);
        if (!ai.resolved) {
          this._steerAt(_b, _c, 4.5, c.acc);
          c.rollBoost = 1.0;
          c.maxBank = 0.9;
          // last-instant reach: legs, tail and a sideslip trim the final few metres
          const r = _b.length();
          const vc = Math.max(-_b.dot(_c) / Math.max(r, 1e-3), 5);
          const tgo = clamp(r / vc, 0.15, 1.5);
          _d.copy(_b).addScaledVector(_c, tgo); // zero-effort miss
          _e.copy(this.vel).normalize();
          _d.addScaledVector(_e, -_d.dot(_e));
          const reach = P.reach ?? (P.outcome === 'hit' ? 30 : 8);
          c.direct = (c.direct || new Vector3()).copy(_d).multiplyScalar(2.5 / (tgo * tgo)).clampLength(0, reach);
        } else c.acc.set(0, 30, 0);
        c.poses.strike = ai.resolved ? 1 - smoothstep(0.1, 0.4, ai.resolveT) : 1;
        c.poses.mshape = ai.resolved ? smoothstep(0.1, 0.4, ai.resolveT) : 0;
        // toes spread wide on the approach and snap shut as the talons pass
        c.grip = ai.closed ? 1 : 0;
        c.crest = 1;
        c.focus = 1;
        c.wide = 0.7;
        c.levelHead = 0.3;
        c.effort = 0;
        c.jaw = 0.25;
        break;
      }
      case 'pullout': {
        const speed = this.vel.length();
        const t = this.modeT;
        const climbA = lerp(0.62, 0.22, smoothstep(1.0, 6.0, t)) * smoothstep(8, 22, speed + 6);
        _a.copy(ai.hd).multiplyScalar(Math.cos(climbA)).add(_b.set(0, Math.sin(climbA), 0));
        _d.copy(_a).multiplyScalar(Math.max(speed, 24));
        c.acc.subVectors(_d, this.vel).multiplyScalar(1.2);
        if (this.vel.y < -8) c.rollBoost = 0.8;
        c.updraft = SOAR_LIFT * smoothstep(1, 4, t);
        const mW = 1 - smoothstep(0.5, 1.4, t);
        c.poses.mshape = P.recover ? 0 : mW;
        c.poses.climb = 1 - c.poses.mshape;
        c.crest = lerp(0.5, 0.15, smoothstep(0, 4, t));
        c.focus = 0.8;
        if (P.recover) {
          c.poses.climb = 1;
          c.squint = 1 - smoothstep(0, 1.5, t);
          c.levelHead = smoothstep(0, 1, t);
        }
        this._avoid(c.acc);
        if ((this.pos.y >= ai.climbAlt - 12 && t > 2.5) || t > (P.maxTime ?? 10)) {
          this.setMode('circle');
          return this._cmd;
        }
        break;
      }
      case 'knockback': {
        const k = clamp(this.modeT / ai.dur, 0, 1);
        c.poses.tumble = 1 - smoothstep(0.55, 1.0, k);
        c.poses.glide = 1 - c.poses.tumble;
        c.flail = 1 - smoothstep(0.4, 0.95, k);
        c.effort = smoothstep(0.7, 1.0, k) * 0.8;
        c.crest = 0;
        c.squint = 1;
        c.levelHead = 0;
        c.focus = 0;
        c.look = null;
        c.jaw = 0.4 * (1 - smoothstep(0.2, 0.6, k));
        if (k >= 1) {
          this.setMode('pullout', { recover: true });
          return this._cmd;
        }
        break;
      }
      case 'retreat': {
        const sp = P.speed ?? 38;
        _d.copy(ai.dir).multiplyScalar(sp).setY(6);
        c.acc.subVectors(_d, this.vel).multiplyScalar(0.6);
        c.poses.climb = 1;
        c.effort = 0.95;
        c.crest = 0;
        c.focus = 0.2;
        c.look = null;
        this._avoid(c.acc);
        const far = this.pos.distanceTo(ai.start) > (P.distance ?? 750);
        if (far || this.modeT > (P.time ?? 10)) {
          ai.vanish = Math.min(1, ai.vanish + dt / (P.fade ?? 2.5));
          this.model.vanish.value = ai.vanish;
          if (this.fx && Math.random() < dt * 14) this._vanishPuff();
          if (ai.vanish >= 1) {
            this.setMode('hidden');
            this.emit('retreated', {});
            return this._cmd;
          }
        }
        break;
      }
      default:
        c.poses.glide = 1;
    }
    return c;
  }

  /** Steering toward a point r (relative) given relative velocity vr: PN near the line of sight, pursuit otherwise. */
  _steerAt(r, vr, N, out) {
    const rl = r.length();
    if (rl < 1e-3) return out.set(0, 0, 0);
    const speed = Math.max(this.vel.length(), 1);
    const cosA = r.dot(this.vel) / (rl * speed);
    // proportional navigation: a = N Vc (Omega x r^)
    _e.crossVectors(r, vr).divideScalar(rl * rl);
    const vc = Math.max(-r.dot(vr) / rl, 8);
    _d.copy(r).divideScalar(rl);
    const pn = _e.cross(_d).multiplyScalar(N * vc);
    // pure pursuit for large heading errors
    const pur = _d.multiplyScalar(speed).sub(this.vel).multiplyScalar(1.6);
    const k = smoothstep(0.3, 0.8, cosA);
    out.copy(pur).multiplyScalar(1 - k).addScaledVector(pn, k);
    return out.clampLength(0, 45);
  }

  _liftNeed(acc) {
    const v = this.vel;
    const sp = v.length();
    if (sp < 1) return 0;
    _e.copy(v).divideScalar(sp);
    const ap = _d.copy(acc).addScaledVector(_e, -acc.dot(_e));
    const gp = _c.copy(_gv).addScaledVector(_e, -_gv.dot(_e));
    return ap.sub(gp).length();
  }

  /** Steer around obstacles (adult whales) so the falcon never flies through them. */
  _avoid(acc) {
    const obs = this.obstacles;
    if (!obs || !obs.length) return;
    const v = this.vel;
    const sp2 = Math.max(v.lengthSq(), 1);
    for (const o of obs) {
      if (!o || !o.pos) continue;
      const R = (o.radius ?? 8) + 10;
      _e.subVectors(o.pos, this.pos);
      if (_e.lengthSq() > 200 * 200) continue;
      const t = clamp(_e.dot(v) / sp2, 0, 1.5);
      _d.copy(this.pos).addScaledVector(v, t).sub(o.pos);
      const d = _d.length();
      if (d < R) {
        if (d < 1e-3) _d.copy(this.up); else _d.divideScalar(d);
        acc.addScaledVector(_d, 30 * (1 - d / R) / (t + 0.4));
      }
    }
  }

  /** An adult shielding the calf on the final attack line (the calf hides between adults). */
  _blocker() {
    const obs = this.obstacles;
    const T = this.target;
    if (!obs || !obs.length || !T) return null;
    const bl = new Vector3();
    _e.subVectors(T.pos, this.pos);
    const L = _e.length();
    if (L < 1e-3) return null;
    _e.divideScalar(L);
    for (const o of obs) {
      if (!o || !o.pos || o === T) continue;
      bl.subVectors(o.pos, this.pos);
      const proj = bl.dot(_e);
      if (proj < 0 || proj > L + 2) continue;
      const off = bl.addScaledVector(_e, -proj).length();
      // the 70 m wings cannot thread a gap the size of a whale's body
      if (off < (o.radius ?? 6) + 9 && o.pos.distanceTo(T.pos) < 50) return o;
    }
    return null;
  }

  _blocked(o) {
    this.emit('strikeMiss', { minDist: Infinity, blocked: true, by: o, target: this.target });
    this.setMode('pullout', { blocked: true });
  }

  _burst(dt, gapMin, gapMax, beats) {
    const ai = this._ai;
    if (ai.burstT === undefined) ai.burstT = 0.5 + this.r() * 2;
    if (ai.bursting > 0) {
      ai.bursting -= dt;
      if (ai.bursting <= 0) ai.burstT = gapMin + this.r() * (gapMax - gapMin);
      return 0.9;
    }
    ai.burstT -= dt;
    if (ai.burstT <= 0) ai.bursting = beats / 0.45;
    return 0;
  }

  /** Horizontal attack direction: 'sun' (out of the sun), 'behind' (along the calf's travel), a Vector3, or from where it is. */
  _approachDir(P) {
    const T = this.target;
    const out = new Vector3();
    if (P.approach && P.approach.isVector3) out.copy(P.approach);
    else if (P.approach === 'sun') out.copy(G.uSunDir.value).negate();
    else if (P.approach === 'behind' && T) out.set(T.vel.x, 0, T.vel.z);
    if (out.x * out.x + out.z * out.z < 1e-4 && T) out.set(T.pos.x - this.pos.x, 0, T.pos.z - this.pos.z);
    out.y = 0;
    if (out.lengthSq() < 1e-4) out.set(0, 0, 1);
    return out.normalize();
  }

  /** Line for a shadow pass: explicit from/to, or computed so the shadow crosses `over`. */
  _passLine(P) {
    if (P.from && P.to) return { from: P.from.clone(), to: P.to.clone() };
    const over = P.over || (this.target && this.target.pos) || this.pos;
    const sun = G.uSunDir.value;
    let h = P.altitude ?? 110;
    const sy = Math.max(sun.y, 0.05);
    // keep the falcon inside the shadow camera's depth range (Shadows.js: ~1200 m sunward)
    h = Math.min(h, 1050 * sy);
    const q = _a.copy(over).addScaledVector(sun, h / sy);
    const hd = new Vector3();
    if (P.heading !== undefined) hd.set(Math.sin(P.heading), 0, Math.cos(P.heading));
    else hd.set(-sun.z, 0, sun.x);
    if (hd.lengthSq() < 1e-4) hd.set(1, 0, 0);
    hd.normalize();
    const L = P.length ?? 900;
    return { from: q.clone().addScaledVector(hd, -L / 2), to: q.clone().addScaledVector(hd, L / 2) };
  }

  _place(p, dir, speed) {
    this.pos.copy(p);
    _e.copy(dir);
    if (_e.lengthSq() < 1e-6) _e.set(0, 0, 1);
    _e.normalize();
    this.vel.copy(_e).multiplyScalar(speed);
    this.up.set(0, 1, 0).addScaledVector(_e, -_e.y).normalize();
    this._vdirPrev.copy(_e);
    this.tumbleQ.identity();
    this.tumbleW.set(0, 0, 0);
    this._attitude(0);
  }

  // ---- physics -----------------------------------------------------------------------------------------------
  _step(h, cmd) {
    const v = this.vel;
    const speed = v.length();
    const vdir = speed > 2 ? _a.copy(v).divideScalar(speed) : _a.copy(this.fwd);
    // wing configuration follows the animated pose (what you see is what flies)
    const w = this.anim.w;
    let area = 0, kD = 0, ws = 0;
    for (const k in CONFIG) {
      const wk = w[k] || 0;
      if (wk <= 0) continue;
      ws += wk; area += wk * CONFIG[k].area; kD += wk * CONFIG[k].kD;
    }
    if (ws > 1e-4) { area /= ws; kD /= ws; } else { area = 1; kD = CONFIG.glide.kD; }
    // lift needed to follow the commanded acceleration
    const aPar = cmd.acc.dot(vdir);
    const L = _b.copy(cmd.acc).addScaledVector(vdir, -aPar);
    const gDot = _gv.dot(vdir);
    L.sub(_c.copy(_gv).addScaledVector(vdir, -gDot));
    // rising air carries part of the weight (its perpendicular part needs no lift)
    const upd = cmd.updraft || 0;
    if (upd) {
      L.y -= upd;
      L.addScaledVector(vdir, upd * vdir.y);
    }
    const Lreq = L.length();
    const Lmax = Math.min(PHYS.kL * speed * speed * area, PHYS.nMax * GRAV);
    let Lmag = Math.min(Lreq, Lmax);
    // bank the lift vector toward where it is needed (finite roll rate: no sliding)
    const up = this.up;
    up.addScaledVector(vdir, -up.dot(vdir));
    if (up.lengthSq() < 1e-6) up.set(0, 1, 0).addScaledVector(vdir, -vdir.y);
    up.normalize();
    let align = 1;
    if (Lreq > 0.8) {
      _d.copy(L).divideScalar(Lreq);
      if (cmd.maxBank !== undefined) {
        // keep the wings within maxBank of level: lift that would need a steeper (or inverted)
        // bank is given up, and gravity does the pushing down
        const lvl = _c.set(0, 1, 0).addScaledVector(vdir, -vdir.y);
        if (lvl.lengthSq() > 1e-4) {
          lvl.normalize();
          const side = _gTmp.crossVectors(vdir, lvl);
          const ang = Math.atan2(_d.dot(side), _d.dot(lvl));
          const angC = clamp(ang, -cmd.maxBank, cmd.maxBank);
          if (angC !== ang) {
            Lmag *= Math.max(0, Math.cos(ang - angC));
            _d.copy(lvl).multiplyScalar(Math.cos(angC)).addScaledVector(side, Math.sin(angC));
          }
        }
      }
      const cosA = clamp(up.dot(_d), -1, 1);
      const ang = Math.acos(cosA);
      const step = PHYS.rollRate * h * (1 + 0.6 * smoothstep(0.3, 1.0, ang / Math.PI) + (cmd.rollBoost || 0));
      if (ang > 1e-4) {
        _e.crossVectors(up, _d);
        if (_e.lengthSq() < 1e-8) _e.copy(vdir);
        _e.normalize();
        _q.setFromAxisAngle(_e, Math.min(step, ang));
        up.applyQuaternion(_q).addScaledVector(vdir, -up.dot(vdir)).normalize();
      }
      align = Math.max(0, up.dot(_d));
    }
    const lift = _e.copy(up).multiplyScalar(Lmag * align);
    // thrust only when the job needs it
    const liftAct = lift.length();
    const D = kD * speed * speed + PHYS.kI * liftAct * liftAct / Math.max(speed * speed, 100);
    const Tav = Math.min(PHYS.tMax, PHYS.pMax / Math.max(speed, 8));
    const Treq = aPar - (gDot + upd * vdir.y) + D;
    let effort = cmd.effort !== undefined ? cmd.effort : clamp(Treq / Tav, 0, 1);
    effort = Math.max(effort, cmd.burst || 0);
    const thrust = effort * Tav;
    // air brakes: spread feathers when it must slow down
    const brake = cmd.effort === undefined ? clamp(-Treq, 0, 4) * 0.6 : 0;
    // integrate
    v.addScaledVector(_gv, h);
    v.y += upd * h;
    v.addScaledVector(lift, h);
    v.addScaledVector(vdir, (thrust - D - brake) * h);
    if (cmd.direct) v.addScaledVector(cmd.direct, h);
    this.pos.addScaledVector(v, h);
    this.effort = effort;
    this.load = liftAct / GRAV;
    this.speed = v.length();
  }

  _attitude(dt) {
    const v = this.vel;
    const speed = v.length();
    const vdir = speed > 2 ? _a.copy(v).divideScalar(speed) : _a.copy(this.fwd);
    const up = this.up;
    up.addScaledVector(vdir, -up.dot(vdir));
    if (up.lengthSq() < 1e-6) up.set(0, 1, 0).addScaledVector(vdir, -vdir.y);
    up.normalize();
    // angle of attack: more at low speed and high load, none in the tucked stoop
    const w = this.anim.w;
    const tuck = (w.stoop || 0) + (w.mshape || 0) * 0.6;
    const aoaT = clamp(0.03 + 0.1 * (this.load - 0.6) * (22 / Math.max(speed, 11)), -0.06, 0.3) * (1 - clamp(tuck, 0, 1));
    this.aoa = dt > 0 ? damp(this.aoa, aoaT, 4, dt) : aoaT;
    const ca = Math.cos(this.aoa), sa = Math.sin(this.aoa);
    const fwd = this.fwd.copy(vdir).multiplyScalar(ca).addScaledVector(up, sa).normalize();
    const upV = _b.copy(up).multiplyScalar(ca).addScaledVector(vdir, -sa).normalize();
    const X = this.right.crossVectors(upV, fwd).normalize();
    _m.makeBasis(X, upV, fwd);
    this.quat.setFromRotationMatrix(_m);
    // rates for the animator (from the change in flight direction)
    if (dt > 0) {
      _c.crossVectors(this._vdirPrev, vdir);
      this.turnRate = damp(this.turnRate, _c.dot(upV) / dt, 6, dt);
      this.pitchRate = damp(this.pitchRate, -_c.dot(X) / dt, 6, dt);
      this._vdirPrev.copy(vdir);
    }
    this.roll = Math.atan2(X.y, upV.y);
    // tumble (knockback): integrate the body-frame spin, then a righting reflex
    const tw = this.tumbleW;
    if (dt > 0 && (tw.lengthSq() > 1e-6 || Math.abs(this.tumbleQ.w) < 0.99999)) {
      const ang = tw.length() * dt;
      if (ang > 1e-6) {
        _q.setFromAxisAngle(_d.copy(tw).normalize(), ang);
        this.tumbleQ.multiply(_q);
      }
      tw.multiplyScalar(Math.exp(-0.9 * dt));
      const rec = this.mode === 'knockback' ? smoothstep(0.45, 1.0, this.modeT / (this._ai.dur || 1.5)) : 1;
      if (rec > 0) {
        this.tumbleQ.slerp(IDQ, 1 - Math.exp(-3.2 * rec * dt));
        tw.multiplyScalar(Math.exp(-3 * rec * dt));
      }
    }
    this.group.position.copy(this.pos);
    this.group.quaternion.copy(this.quat).multiply(this.tumbleQ);
  }

  _animate(dt, cmd) {
    const s = this._as;
    s.poses = cmd.poses;
    s.effort = Math.max(this.effort, cmd.burst || 0);
    s.turn = clamp(this.turnRate / 0.4, -1, 1);
    s.roll = this.roll;
    s.pitchRate = this.pitchRate;
    s.load = this.load;
    s.speed = this.vel.length();
    s.lookAt = cmd.look;
    s.crest = cmd.crest;
    s.grip = cmd.grip;
    s.flail = cmd.flail;
    s.levelHead = cmd.levelHead;
    s.instant = !!cmd.instant;
    s.flapAmp = cmd.flapAmp;
    s.jaw = cmd.jaw;
    this.anim.update(dt, s);
    this.group.updateMatrixWorld(true);
    this.anim.updateFace(dt, { lookAt: cmd.look, intensity: cmd.focus, wide: cmd.wide, squint: cmd.squint });
  }

  _post(dt) {
    // talons: midway between the feet, a little toward the toe tips
    const b = this.model.bones;
    this._talonPrev.copy(this.talonPos);
    _a.set(0, -0.55, 1.35).applyMatrix4(b.footL.matrixWorld);
    _b.set(0, -0.55, 1.35).applyMatrix4(b.footR.matrixWorld);
    this.talonPos.addVectors(_a, _b).multiplyScalar(0.5);
    if (this.mode === 'strike') this._strikeCheck(dt);
    this._mover(true);
    if (this.fx) this._effects(dt);
  }

  _strikeCheck(dt) {
    const ai = this._ai;
    const T = this.target;
    if (!T) return;
    if (ai.resolved) {
      ai.resolveT += dt;
      if (ai.resolveT > 0.3) this.setMode('pullout', { afterHit: ai.hit });
      return;
    }
    // swept test: talon path relative to the moving target this frame
    _a.subVectors(this._talonPrev, this._tgtPrev);
    _b.subVectors(this.talonPos, T.pos);
    _c.subVectors(_b, _a);
    const l2 = _c.lengthSq();
    const t = l2 > 1e-8 ? clamp(-_a.dot(_c) / l2, 0, 1) : 1;
    const dist = _d.copy(_a).addScaledVector(_c, t).length();
    this._tgtPrev.copy(T.pos);
    ai.minDist = Math.min(ai.minDist, dist);
    const closing = _b.dot(_e.subVectors(this.vel, T.vel)) < 0;
    if (!closing) ai.closed = true;
    if (dist <= ai.hitRadius && this.params.outcome !== 'miss') {
      ai.resolved = true;
      ai.hit = true;
      ai.closed = true;
      this.anim.jolt(0.8);
      if (this.fx) this._burstPuffs(this.talonPos, 18, 7, 0.8);
      this.emit('strikeHit', { target: T, pos: this.talonPos.clone(), speed: this.vel.length(), dist });
      return;
    }
    if ((this.modeT > 0.3 && !closing && _b.length() > ai.hitRadius * 1.5) || this.modeT > (this.params.timeout ?? 2.6)) {
      ai.resolved = true;
      ai.hit = false;
      this.emit('strikeMiss', { minDist: ai.minDist, target: T });
    }
  }

  _mover(on) {
    const slot = this.moverSlot;
    if (slot < 0 || !G.uMovers || !G.uMovers.value[slot]) return;
    const m = G.uMovers.value[slot];
    if (on && this.group.visible && this.model.vanish.value < 0.5) m.set(this.pos.x, this.pos.y, this.pos.z, 24);
    else if (m.w === 24) m.w = 0;
  }

  // ---- particles ------------------------------------------------------------------------------------------------
  _effects(dt) {
    const mist = this.game.mist;
    if (!mist) return;
    const speed = this.vel.length();
    // wingtip vapour in hard, fast pulls (the pull-out, the strike flare)
    if (speed > 38 && this.load > 1.6) {
      this._fxT += dt * 60 * smoothstep(1.6, 3.0, this.load);
      while (this._fxT > 1) {
        this._fxT -= 1;
        for (const S of ['L', 'R']) {
          const bone = this.model.bones['wr' + S];
          const s = S === 'L' ? 1 : -1;
          _a.set(s * 13, 0, -3.5).applyMatrix4(bone.matrixWorld);
          mist.emit({
            pos: _a, vel: _b.copy(this.vel).multiplyScalar(0.15), life: 1.1, size: 1.3, sizeEnd: 5,
            color: [1, 1, 1], alpha: 0.22 * smoothstep(38, 60, speed), drag: 1.5, kind: 0, fadeIn: 0.05,
          });
        }
      }
    }
    // punching through cloud: shredded mist streams off the body and wings
    this._cloudT -= dt;
    if (this._cloudT <= 0) {
      this._cloudT = 0.12;
      const cl = this.game.clouds;
      this._inCloud = cl && cl.densityAt ? cl.densityAt(this.pos) : 0;
    }
    if (this._inCloud > 0.12 && speed > 12 && Math.random() < dt * 30) {
      _a.copy(this.pos).addScaledVector(this.right, (Math.random() - 0.5) * 30);
      mist.emit({
        pos: _a, vel: _b.copy(this.vel).multiplyScalar(0.25), life: 2.4, size: 6, sizeEnd: 16,
        color: [1, 1, 1], alpha: 0.35 * this._inCloud, drag: 0.8, kind: 0,
      });
    }
  }

  _flapPuffs(a) {
    const mist = this.game.mist;
    if (!mist || this._inCloud < 0.05) return;
    for (const S of ['L', 'R']) {
      const s = S === 'L' ? 1 : -1;
      _a.set(s * 12, -1, -3).applyMatrix4(this.model.bones['wr' + S].matrixWorld);
      mist.emit({ pos: _a, vel: _b.copy(this.up).multiplyScalar(-8 * a), life: 1.8, size: 4, sizeEnd: 12, color: [1, 1, 1], alpha: 0.3, drag: 1.2 });
    }
  }

  _burstPuffs(p, n, speed, alpha) {
    const mist = this.game.mist;
    if (!mist) return;
    for (let i = 0; i < n; i++) {
      this.r.onSphere(_a);
      const feather = i % 3 === 0;
      mist.emit({
        pos: _b.copy(p).addScaledVector(_a, 3 + this.r() * 4),
        vel: _c.copy(_a).multiplyScalar(speed * (0.5 + this.r())).addScaledVector(this.vel, 0.3),
        life: feather ? 2.8 : 1.6, size: feather ? 0.9 : 3, sizeEnd: feather ? 0.6 : 10,
        color: feather ? [0.7, 0.76, 0.86] : [1, 1, 1], alpha: alpha * (feather ? 0.9 : 0.45),
        drag: feather ? 2.2 : 1.4, gravity: feather ? 1.2 : 0, kind: 0,
      });
    }
  }

  _screechRing() {
    const mist = this.game.mist;
    if (!mist) return;
    const head = this.model.bones.head;
    const origin = _d.set(0, 0, 3.5).applyMatrix4(head.matrixWorld).clone();
    _e.set(0, 0, 1).transformDirection(head.matrixWorld);
    // ring in the plane facing the beak
    _a.crossVectors(_e, UP);
    if (_a.lengthSq() < 1e-4) _a.set(1, 0, 0);
    _a.normalize();
    _b.crossVectors(_a, _e).normalize();
    const n = 18;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      _c.copy(_a).multiplyScalar(Math.cos(ang)).addScaledVector(_b, Math.sin(ang)).addScaledVector(_e, 0.6).normalize();
      mist.emit({
        pos: origin.clone().addScaledVector(_c, 2), vel: _c.clone().multiplyScalar(26).addScaledVector(this.vel, 0.6),
        life: 1.1, size: 2.2, sizeEnd: 7, color: [1, 1, 1], alpha: 0.28, drag: 2.0, kind: 0, fadeIn: 0.05,
      });
    }
  }

  _vanishPuff() {
    const mist = this.game.mist;
    if (!mist) return;
    this.r.inSphere(_a).multiplyScalar(22);
    mist.emit({
      pos: _b.copy(this.pos).add(_a), vel: _c.copy(this.vel).multiplyScalar(0.4), life: 3.5, size: 14, sizeEnd: 30,
      color: [1, 1, 1], alpha: 0.55, drag: 0.6, kind: 0, fadeIn: 0.4,
    });
  }

  dispose() {
    this.game.engine.scene.remove(this.group);
    this.model.removeShadows(this.game.engine.shadows);
    this._mover(false);
  }
}
