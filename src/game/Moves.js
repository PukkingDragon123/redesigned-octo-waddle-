// The calf's moves: tail slaps, spouts and bubble bursts, loops, dashes and dive bombs, chained
// barrel rolls (corkscrews) and breaches. Driven by the PlayerController before the flight step
// (so a move can steer the body), each with its pose (anim gestures), particles, sound and a little
// slow motion for the big ones. Moves emit events ('slap', 'spout', 'loop', 'dash', 'breach', ...)
// that src/game/Activities.js turns into playmate reactions and joy.
import { Vector3 } from 'three';
import { clamp, smoothstep, TAU, wrapAngle, dirFromYawPitch } from '../core/math.js';
import { seaHeight, spoutColumn } from './Swim.js';
import { fx } from '../fx/FX.js';

const _v = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _fwd = new Vector3();
const _p = new Vector3();

export class Moves {
  constructor(game, whale, player) {
    this.game = game;
    this.w = whale;
    this.player = player;
    this.cur = null; // the body move in progress: { name, t, ... }
    this.listeners = [];
    this.cd = { slap: 0, spout: 0, loop: 0, dash: 0 };
    this.rollQueue = 0;
    this.chain = 0;
    this.lastRollEnd = -9;
    this.wasRolling = false;
    this.breach = { deepT: 0, armed: false, air: false, airT: 0, spin: false, lastDepth: 0 };
    this.slowT = 0;
    this.slowMine = 0;
    this.trailAcc = 0;
    this.joy = 0; // set by Activities: sparkle trails grow with it
    this.zone = 'air';
    this.depth = -99;
    this.count = { slap: 0, flick: 0, spout: 0, bubbles: 0, loop: 0, dash: 0, diveBomb: 0, breach: 0, corkscrew: 0, splashdown: 0 };
    this._ev = { name: '', power: 0, pos: new Vector3(), zone: 'air', chain: 0 };
    this._em = { pos: new Vector3(), vel: new Vector3(), life: 1, size: 0.3, sizeEnd: 1, alpha: 0.6, drag: 1, gravity: 0, kind: 0, color: [1, 1, 1], fadeIn: 0.05, stretch: 4 };
    this._savedMaxPitch = null;
  }

  on(fn) { this.listeners.push(fn); }

  emit(name, power, pos) {
    const e = this._ev;
    e.name = name;
    e.power = power;
    e.pos.copy(pos || this.w.pos);
    e.zone = this.zone;
    e.chain = this.chain;
    if (this.count[name] !== undefined) this.count[name]++;
    for (const f of this.listeners) f(e);
  }

  sfx(name, pos, gain = 1, extra = null) {
    const a = this.game.story?.audio;
    if (!a || !a.sfx) return;
    const o = { position: pos, gain };
    if (extra) Object.assign(o, extra);
    a.sfx(name, o);
  }

  /** Brief slow motion (real seconds); never fights a cinematic or the pause. */
  slowmo(scale, dur) {
    const g = this.game, st = g.story?.state;
    if (st && st !== 'play') return;
    const cur = g.timeScaleTarget ?? 1;
    if (cur !== 1 && cur !== this.slowMine) return;
    g.timeScaleTarget = scale;
    this.slowMine = scale;
    this.slowT = dur;
  }

  reset() {
    this._endLoop();
    this.cur = null;
    this.rollQueue = 0;
    this.chain = 0;
    this.breach.armed = false;
    this.breach.air = false;
    this.breach.deepT = 0;
    if (this.slowMine && this.game.timeScaleTarget === this.slowMine) this.game.timeScaleTarget = 1;
    this.slowMine = 0;
    this.slowT = 0;
    for (const k in this.cd) this.cd[k] = 0;
  }

  queueRoll(dir) {
    // a roll pressed while one is spinning: chain into a corkscrew
    if (this.w.rollSpin > 0.25) this.rollQueue = dir;
  }

  // ---- per frame (PlayerController.update, before the flight step) ------------------------
  update(dt, inp, enabled) {
    const w = this.w, g = this.game;
    for (const k in this.cd) this.cd[k] = Math.max(0, this.cd[k] - dt);
    const sea = seaHeight(g, w.pos.x, w.pos.z);
    const depth = sea - w.pos.y;
    this.depth = depth;
    this.zone = depth > w.radius * 0.9 ? 'under' : depth > -(w.radius * 1.6 + 1.4) ? 'surface' : 'air';
    if (enabled && inp) {
      // abilities a newborn has not learnt yet are a small failed attempt (src/game/Abilities.js)
      const A = g.story?.abilities;
      const can = (k) => !A || A.has(k) || (A.attempt(k), false);
      if (inp.slapPressed && can('slap')) this.slap(sea);
      if (inp.spoutPressed && can('spout')) this.spout(sea);
      if (inp.loopPressed && can('loop')) this.loop();
      if (inp.dashPressed && can('dash')) this.dash(sea);
    }
    this._rolls(dt);
    this._breach(dt, depth, sea);
    this._run(dt, sea, depth);
    this._trails(dt);
    // the air lines follow this calf's flight: denser in dives, dashes and tricks
    if (g.engine) {
      const c = this.cur;
      const boost = c && (c.name === 'diveBomb' || c.name === 'dash') ? 1 : c && c.name === 'loop' ? 0.6 : this.breach.air ? 0.4 : 0;
      fx(g).wind.track(w, this.zone, boost);
    }
    // slow motion runs on real time
    if (this.slowT > 0) {
      this.slowT -= g.dtReal ?? dt;
      if (this.slowT <= 0 && g.timeScaleTarget === this.slowMine) { g.timeScaleTarget = 1; this.slowMine = 0; }
    }
  }

  // ---- tail slap / tail flick / kick --------------------------------------------------------
  slap(sea) {
    const w = this.w;
    if (this.cd.slap > 0 || (this.cur && this.cur.name === 'loop')) return false;
    this.cd.slap = 1.1;
    w.anim.gesture?.('tailSlap', { speed: this.zone === 'air' ? 2.6 : 1.9 });
    const G = w.anim.gest;
    const hit = G ? G.dur * (G.event ?? 0.68) : 0.9;
    this.cur = { name: 'slap', t: 0, hit, done: false };
    return true;
  }

  _slapHit(sea) {
    const w = this.w, g = this.game;
    const m = w.model;
    const p = m.flukePos ? m.flukePos(null, _v) : _v.copy(w.pos).addScaledVector(w.fwd, -w.L * 0.46);
    // generous: a calf skimming within a few metres of the sea slaps it
    const near = Math.abs(p.y - sea) < 3.5 || w.pos.y - sea < w.radius * 2 + 3;
    if (near && this.zone !== 'under') {
      // a big wet slap: splash, spray sheet, foam and a thump
      p.y = sea;
      _v2.copy(w.up).multiplyScalar(1.3).addScaledVector(w.fwd, -0.7);
      g.ocean?.splash?.(p, 1.5, w.L * 0.75, _v2);
      this._spray(p, 1.3, 46, 1.2, _v2);
      this.sfx('tailSlap', p, 1);
      g.cameraRig?.addShake?.(0.3);
      g.story?.eco?.scatter?.(p, 26, 0.8);
      w.vel.addScaledVector(w.fwd, 3).addScaledVector(w.up, 1.5);
      this.emit('slap', 1, p);
    } else if (this.zone === 'under') {
      // a kick under water: a surge and a burst of bubbles off the flukes
      w.vel.addScaledVector(w.fwd, 5);
      this._bubbles(p, 26, 2.5);
      this.sfx('bubbles', p, 0.7);
      this.emit('kick', 0.6, p);
    } else {
      // in the air: a fluke flick that kicks the calf forward (air shows nothing; at speed a faint
      // breath of condensation curls off the fluke tips)
      w.vel.addScaledVector(w.fwd, 5).addScaledVector(w.up, 1.2);
      if (w.vel.length() > 18) { this._tipVapour(p, 0.5); this._tipVapour(p, -0.5); }
      this.sfx('whoosh', p, 0.5, { pitch: 1.3 });
      this.emit('flick', 0.5, p);
    }
  }

  // ---- spout / bubbles / puff -------------------------------------------------------------------
  spout(sea) {
    const w = this.w, g = this.game;
    if (this.cd.spout > 0) return false;
    this.cd.spout = 1.0;
    if (this.zone === 'under') {
      const p = w.model.blowholePos ? w.model.blowholePos(_v) : _v.copy(w.pos).addScaledVector(w.up, w.radius);
      this._bubbles(p, 60, 4);
      w.anim.breathe?.(0.6);
      if (w.water) w.water.air = Math.max(0, w.water.air - 0.04);
      this.sfx('bubbles', p, 1);
      g.story?.eco?.scatter?.(p, 12, 0.5);
      this.emit('bubbles', 0.7, p);
      return true;
    }
    const k = this.zone === 'surface' ? 1.7 : 0.9;
    const p = w.blow ? w.blow(g, k) : w.pos;
    if (this.zone === 'surface') {
      // a tall column of fine vapour drifting off with the wind, a little rain of drops falling back
      spoutColumn(g, p, w, 1);
    }
    this.sfx('spout', p, this.zone === 'surface' ? 1 : 0.55);
    this.emit(this.zone === 'surface' ? 'spout' : 'puff', k, p);
    return true;
  }

  // ---- loop ---------------------------------------------------------------------------------------
  loop() {
    const w = this.w;
    if (this.cd.loop > 0 || (this.cur && this.cur.name !== 'dash')) return false;
    if (this.zone === 'surface' && w.pitch < 0.2) return false; // no room: it would plough into the sea
    this.cd.loop = 0.6;
    const speed = Math.max(w.vel.length(), this.zone === 'under' ? 9 : 13);
    this._savedMaxPitch = w.phys.maxPitch;
    w.phys.maxPitch = 100;
    this.cur = { name: 'loop', t: 0, dur: this.zone === 'under' ? 2.0 : 2.3, p0: clamp(w.pitch, -0.6, 0.6), yaw: w.yaw, speed, top: false };
    this.sfx('whoosh', w.pos, 0.7, { pitch: 1.1 });
    w.drive.excite = 1;
    return true;
  }

  _endLoop() {
    const w = this.w;
    if (this._savedMaxPitch !== null) {
      w.phys.maxPitch = this._savedMaxPitch;
      this._savedMaxPitch = null;
      w.pitch = clamp(wrapAngle(w.pitch), -w.phys.maxPitch, w.phys.maxPitch);
      w.ctl.targetPitch = w.pitch;
      if (this.player) { this.player.aimPitch = w.pitch; this.player.aimYaw = w.yaw; }
    }
  }

  // ---- dash / dive bomb -----------------------------------------------------------------------
  dash(sea) {
    const w = this.w, g = this.game;
    if (this.cd.dash > 0 || w.energy < 0.1 || (this.cur && this.cur.name === 'loop')) return false;
    this.cd.dash = 1.0;
    w.energy = Math.max(0, w.energy - 0.05);
    const height = w.pos.y - sea;
    const p = _p.copy(w.pos).addScaledVector(w.fwd, -w.L * 0.3);
    if (this.zone === 'air' && w.pitch < -0.4 && height < 110) {
      // dive bomb: wings tucked, straight down into the sea
      w.vel.copy(w.fwd).multiplyScalar(Math.max(w.vel.length(), 12) + 12);
      this.cur = { name: 'diveBomb', t: 0, hit: false };
      w.anim.gesture?.('breachArch', { speed: 1.4 });
      this.sfx('dash', w.pos, 1, { pitch: 0.8 });
      this.emit('diveBombStart', 1, w.pos);
    } else {
      const sp = w.vel.length();
      w.vel.addScaledVector(w.fwd, Math.max(0, Math.min(14, 32 - sp)));
      this.cur = { name: 'dash', t: 0, dur: 0.7, streakAcc: 0 };
      if (this.zone === 'under') { this._bubbles(p, 30, 1.5); this.sfx('bubbles', p, 0.8, { pitch: 0.8 }); }
      else if (height < w.radius * 2 + 2.5) {
        // skimming: the downwash tears a burst of spray and mist off the sea behind the flukes
        _v.copy(p).setY(sea);
        _v2.copy(w.fwd).multiplyScalar(-1).setY(0.6);
        g.ocean?.splash?.(_v, 0.45, w.L * 0.35, _v2);
        this._spray(_v, 0.6, 26, 0.7, _v2);
      }
      this.sfx('dash', w.pos, 0.9);
      g.cameraRig?.addShake?.(0.12);
      this.emit('dash', 1, w.pos);
    }
    w.drive.excite = 1;
    return true;
  }

  // ---- chained rolls (corkscrew) ------------------------------------------------------------
  _rolls(dt) {
    const w = this.w, g = this.game;
    const rolling = w.rollSpin > 0;
    if (rolling && !this.wasRolling) {
      this.chain = g.time - this.lastRollEnd < 0.45 ? this.chain + 1 : 1;
      if (this.chain >= 2) {
        this.emit('corkscrew', this.chain, w.pos);
        this.sfx('whoosh', w.pos, 0.4, { pitch: 1 + this.chain * 0.12 });
      }
    }
    if (!rolling && this.wasRolling) this.lastRollEnd = g.time;
    this.wasRolling = rolling;
    if (!rolling && this.rollQueue) {
      const dir = this.rollQueue;
      this.rollQueue = 0;
      if (w.barrelRoll(dir)) this.player?.emit?.('roll', dir);
    }
    // chained rolls spin faster and faster
    if (rolling && this.chain >= 2) w.rollSpin = Math.min(0.9999, w.rollSpin + (dt / 0.95) * Math.min(1.2, 0.35 * (this.chain - 1)));
    if (!rolling && g.time - this.lastRollEnd > 0.45) this.chain = 0;
  }

  // ---- breach -----------------------------------------------------------------------------------
  _breach(dt, depth, sea) {
    const w = this.w, B = this.breach, g = this.game;
    if (depth > 2.2) { B.deepT += dt; if (B.deepT > 0.35) B.armed = true; } else if (depth < -2) B.deepT = 0;
    const last = B.lastDepth;
    B.lastDepth = depth;
    // bursting out of the sea, fast and steep: launch into an arching leap
    if (B.armed && last > -w.radius * 0.3 && depth <= -w.radius * 0.3) {
      B.armed = false;
      B.deepT = 0;
      const A = g.story?.abilities;
      if (w.vel.y > 4.2 && (!A || A.has('breach'))) {
        const k = clamp(w.vel.y / 10, 0.6, 1.6);
        w.vel.y = Math.max(w.vel.y, 8 + w.vel.y * 0.35);
        w.vel.addScaledVector(w.fwd, 2);
        w.anim.gesture?.('breachArch', { speed: 0.9 });
        B.air = true;
        B.airT = 0;
        B.spin = w.rollSpin > 0;
        _v.copy(w.pos).setY(sea);
        g.ocean?.splash?.(_v, 1.4 * k, w.L * 0.7, w.up);
        this._spray(_v, 1.4 * k, 50, 1.6);
        this.sfx('splash', _v, 1);
        this.sfx('trick', w.pos, 0.8, { step: 2 });
        g.cameraRig?.addShake?.(0.25);
        this.slowmo(0.38, 0.65);
        w.drive.happy = 1;
        w.drive.excite = 1;
        this.emit('breach', k, _v);
      }
    }
    if (B.air) {
      B.airT += dt;
      // the arc: a little extra weight while it soars out
      if (B.airT < 1.0) w.vel.y -= 5 * dt;
      if (!B.spin && w.rollSpin > 0 && B.airT < 2) { B.spin = true; this.emit('breachSpin', 1.2, w.pos); this.sfx('trick', w.pos, 0.9, { step: 4 }); }
      if (depth > 0 && B.airT > 0.3) {
        // splashdown
        B.air = false;
        _v.copy(w.pos).setY(sea);
        const k = clamp(-w.vel.y / 8, 0.6, 1.8);
        g.ocean?.splash?.(_v, 1.6 * k, w.L * 0.9, null);
        this._spray(_v, 1.5 * k, 60, 1.2);
        this.sfx('tailSlap', _v, 0.9, { pitch: 0.75 });
        g.cameraRig?.addShake?.(0.3);
        this.emit('splashdown', k, _v);
      }
      if (B.airT > 6) B.air = false;
    }
  }

  // ---- the move in progress ---------------------------------------------------------------------
  _run(dt, sea, depth) {
    const w = this.w, g = this.game, c = this.cur;
    if (!c) return;
    c.t += dt;
    if (c.name === 'slap') {
      if (!c.done && c.t >= c.hit) { c.done = true; this._slapHit(sea); }
      if (c.t > c.hit + 0.4) this.cur = null;
      return;
    }
    if (c.name === 'loop') {
      const u = clamp(c.t / c.dur, 0, 1);
      // a smooth vertical loop: steady through the top, easing in and out
      const a = TAU * (u - Math.sin(TAU * u) * 0.12);
      const pitch = c.p0 + a;
      w.pitch = pitch;
      w.pitchRate = 0;
      w.yaw = c.yaw;
      w.yawRate = 0;
      w.ctl.targetPitch = pitch;
      w.ctl.targetYaw = c.yaw;
      w.ctl.thrust = 1;
      dirFromYawPitch(c.yaw, pitch, _fwd);
      const sp = c.speed * (1 - 0.18 * Math.sin(Math.PI * u));
      w.vel.copy(_fwd).multiplyScalar(sp);
      w.drive.effort = 1;
      w.drive.excite = 1;
      if (!c.top && u > 0.5) {
        c.top = true;
        this.sfx('trick', w.pos, 0.8, { step: 1 + this.chain });
        this.emit('loop', w.rollSpin > 0 ? 1.5 : 1, w.pos);
      }
      if (u >= 1) {
        w.pitch = c.p0;
        this._endLoop();
        this.cur = null;
      }
      return;
    }
    if (c.name === 'dash') {
      w.ctl.thrust = 1;
      w.drive.effort = 1;
      // in the air at speed: faint condensation trails off the wingtips while the surge lasts
      const sp = w.vel.length();
      if (this.zone !== 'under' && c.t < 0.6 && sp > 16) {
        c.streakAcc += dt * 70 * smoothstep(16, 26, sp);
        while (c.streakAcc > 1) {
          c.streakAcc -= 1;
          c.tip = !c.tip;
          const side = c.tip ? 'R' : 'L';
          const m = w.model;
          if (m.wingTipPos) m.wingTipPos(side, _v3); else _v3.copy(w.pos).addScaledVector(w.right, (side === 'R' ? 1 : -1) * w.L * 0.5);
          this._tipVapour(_v3, 0, 0.16 * (1 - c.t / 0.6));
        }
      }
      if (c.t > c.dur) this.cur = null;
      return;
    }
    if (c.name === 'diveBomb') {
      w.ctl.thrust = 1;
      w.ctl.targetPitch = Math.min(w.ctl.targetPitch, -0.9);
      w.drive.effort = 0.2;
      w.drive.glide = 1;
      if (!c.hit && depth > -w.radius * 0.2) {
        c.hit = true;
        _v.copy(w.pos).setY(sea);
        const k = clamp(w.vel.length() / 16, 0.8, 2);
        g.ocean?.splash?.(_v, 1.9 * k, w.L * 1.1, null);
        this._spray(_v, 1.7 * k, 80, 2.0);
        this._bubbles(_v2.copy(w.pos).addScaledVector(w.fwd, -1), 40, 3);
        this.sfx('tailSlap', _v, 1, { pitch: 0.65 });
        this.sfx('bubbles', w.pos, 0.8, { pitch: 0.7 });
        g.cameraRig?.addShake?.(0.45);
        g.story?.eco?.scatter?.(_v, 30, 1);
        this.slowmo(0.4, 0.5);
        this.emit('diveBomb', k, _v);
      }
      if (c.t > 3 || (c.hit && depth > 3)) this.cur = null;
    }
  }

  // ---- effects --------------------------------------------------------------------------------
  _trails(dt) {
    const w = this.w, g = this.game, c = this.cur;
    const tricking = (c && (c.name === 'loop' || c.name === 'dash' || c.name === 'diveBomb')) || this.chain >= 2 || this.breach.air;
    const under = this.zone === 'under';
    const sp = w.vel.length();
    // real trails only: wingtip vortices condense in the air at speed; under water they cavitate
    // into fine streams of bubbles
    const rate = ((tricking ? 50 : 0) + Math.max(0, this.joy - 0.35) * 24) * (under ? smoothstep(5, 12, sp) : smoothstep(13, 24, sp));
    if (rate <= 0 || !g.mist) return;
    this.trailAcc += rate * dt;
    const m = w.model, E = this._em;
    while (this.trailAcc > 1) {
      this.trailAcc -= 1;
      const side = Math.random() < 0.5 ? 'R' : 'L';
      if (m.wingTipPos) m.wingTipPos(side, _v3); else _v3.copy(w.pos).addScaledVector(w.right, (side === 'R' ? 1 : -1) * w.L * 0.5);
      if (!under) { this._tipVapour(_v3, 0, 0.12); continue; }
      E.pos.copy(_v3);
      E.vel.copy(w.vel).multiplyScalar(0.05).add(_v.set((Math.random() - 0.5) * 0.3, Math.random() * 0.3, (Math.random() - 0.5) * 0.3));
      const u = Math.random();
      E.life = 6; E.size = 0.004 + 0.02 * u * u * u; E.sizeEnd = E.size * 1.15; E.alpha = 0.8;
      E.drag = 2; E.gravity = 0; E.kind = 4; E.fadeIn = 0.05;
      E.color[0] = 1; E.color[1] = 1; E.color[2] = 1;
      g.mist.emit(E);
    }
  }

  /**
   * Whitewater thrown up from the sea at p: the crown sheet breaking into fine droplets (spray
   * clusters), heavier drops arcing out and falling back, and a veil of mist drifting downwind.
   * k scales the impact (0.5 a skim .. 3 a dive bomb), n the number of pieces, up the throw;
   * dir (optional) fans it one way, as from a slap.
   */
  _spray(p, k, n, up, dir = null) {
    const g = this.game, E = this._em;
    if (!g.mist) return;
    let fx = 0, fz = 0;
    if (dir) { const l = Math.hypot(dir.x, dir.z); if (l > 1e-4) { fx = dir.x / l; fz = dir.z / l; } }
    const fan = fx !== 0 || fz !== 0;
    const R = 0.6 + 0.5 * k;
    for (let i = 0; i < n; i++) {
      const a = fan ? Math.atan2(fz, fx) + (Math.random() - 0.5) * 1.8 : Math.random() * TAU;
      const rr = Math.sqrt(Math.random());
      E.pos.set(p.x + Math.cos(a) * R * rr, p.y + 0.1, p.z + Math.sin(a) * R * rr);
      const vu = (2.5 + 5.5 * Math.random()) * up * Math.sqrt(k) * 0.8;
      const vo = (1 + 3.5 * rr) * Math.sqrt(k) * (fan ? 2 : 1);
      E.vel.set(Math.cos(a) * vo, vu, Math.sin(a) * vo);
      const kind = i % 4 === 0 ? 3 : 9;
      if (kind === 3) {
        // a heavier drop: a refractive sphere of a centimetre or two
        E.life = 0.8 + Math.random() * 0.9; E.size = 0.008 + 0.014 * Math.random(); E.sizeEnd = E.size;
        E.alpha = 0.95; E.drag = 0.15; E.gravity = 9.8; E.fadeIn = 0.01;
      } else {
        // a torn piece of the sheet, breaking up into fine droplets as it flies
        E.life = 0.7 + Math.random() * 0.7; E.size = 0.14 + 0.12 * k * Math.random(); E.sizeEnd = E.size * 2.4;
        E.alpha = 0.85; E.drag = 0.5; E.gravity = 9.8; E.fadeIn = 0.01;
      }
      E.kind = kind;
      E.color[0] = 0.96; E.color[1] = 0.98; E.color[2] = 1.0;
      g.mist.emit(E);
    }
    // (the crown, foam and the rest of the water are src/fx/Splash.js, through ocean.splash)
  }

  /** A burst of air: bubbles of many sizes (mostly millimetres, a few big wobbling ones). */
  _bubbles(p, n, speed) {
    const g = this.game, E = this._em;
    if (!g.mist) return;
    for (let i = 0; i < n; i++) {
      E.pos.set(p.x + (Math.random() - 0.5) * 0.8, p.y + (Math.random() - 0.5) * 0.8, p.z + (Math.random() - 0.5) * 0.8);
      E.vel.set((Math.random() - 0.5) * speed, Math.random() * speed * 0.6, (Math.random() - 0.5) * speed);
      const u = Math.random();
      E.life = 8; E.size = 0.004 + 0.07 * u * u * u; E.sizeEnd = E.size * 1.25; E.alpha = 0.85;
      E.drag = 1.6; E.gravity = 0; E.kind = 4; E.fadeIn = 0.03;
      E.color[0] = 1; E.color[1] = 1; E.color[2] = 1;
      g.mist.emit(E);
    }
  }

  /** A wingtip vortex at p (formerly a vapour wisp): now it only feeds the wind lines' trails. */
  _tipVapour(p, side, alpha = 0.14) {
    // the wingtip vortices are drawn as trails by src/fx/WindLines.js (no vapour puffs): a flick or
    // a burst of speed only thickens the air lines for a moment
    if (this.game.engine) fx(this.game).wind.boost = Math.max(fx(this.game).wind.boost, Math.min(1, alpha * 4));
  }
}
