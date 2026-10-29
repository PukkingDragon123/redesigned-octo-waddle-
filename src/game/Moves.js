// The calf's moves: tail slaps, spouts and bubble bursts, loops, dashes and dive bombs, chained
// barrel rolls (corkscrews) and breaches. Driven by the PlayerController before the flight step
// (so a move can steer the body), each with its pose (anim gestures), particles, sound and a little
// slow motion for the big ones. Moves emit events ('slap', 'spout', 'loop', 'dash', 'breach', ...)
// that src/game/Activities.js turns into playmate reactions and joy.
import { Vector3 } from 'three';
import { clamp, lerp, smoothstep, TAU, wrapAngle, dirFromYawPitch } from '../core/math.js';
import { seaHeight } from './Swim.js';

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
      if (inp.slapPressed) this.slap(sea);
      if (inp.spoutPressed) this.spout(sea);
      if (inp.loopPressed) this.loop();
      if (inp.dashPressed) this.dash(sea);
    }
    this._rolls(dt);
    this._breach(dt, depth, sea);
    this._run(dt, sea, depth);
    this._trails(dt);
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
      this._spray(p, 1.3, 46, 1.2);
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
      // in the air: a fluke flick that kicks the calf forward, a couple of wind strokes off the flukes
      w.vel.addScaledVector(w.fwd, 5).addScaledVector(w.up, 1.2);
      this._windStroke(p, 0.5, 0.75, 0.4);
      this._windStroke(p, -0.5, 0.75, 0.4);
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
      // a tall column of painted vapour puffs with a crown of drawn droplets falling back
      const E = this._em;
      for (let i = 0; i < 18; i++) {
        const drop = i % 3 === 0;
        E.pos.copy(p);
        E.vel.copy(w.up).multiplyScalar(9 + Math.random() * 6).add(_v2.set((Math.random() - 0.5) * (drop ? 4 : 2), 0, (Math.random() - 0.5) * (drop ? 4 : 2))).addScaledVector(w.vel, 0.6);
        if (drop) { E.life = 1.2 + Math.random() * 0.6; E.size = 0.12 + Math.random() * 0.08; E.sizeEnd = 0.08; E.alpha = 0.85; E.drag = 0.4; E.gravity = 9; E.kind = 3; }
        else { E.life = 1.6 + Math.random(); E.size = 0.4; E.sizeEnd = 2.0 + Math.random() * 1.4; E.alpha = 0.42; E.drag = 1.5; E.gravity = 1.2; E.kind = 0; }
        E.fadeIn = 0.05;
        E.color[0] = 1; E.color[1] = 1; E.color[2] = 1;
        g.mist?.emit(E);
      }
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
      if (w.vel.y > 4.2) {
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
      // in the air: a few short hand-drawn wind streaks trail off the wingtips while the surge lasts
      if (this.zone !== 'under' && c.t < 0.45) {
        c.streakAcc += dt * 9;
        while (c.streakAcc > 1) {
          c.streakAcc -= 1;
          const side = Math.random() < 0.5 ? 'R' : 'L';
          const m = w.model;
          if (m.wingTipPos) m.wingTipPos(side, _v3); else _v3.copy(w.pos).addScaledVector(w.right, (side === 'R' ? 1 : -1) * w.L * 0.5);
          this._windStroke(_v3, 0, 0.85, 0.5);
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
    const rate = (tricking ? 70 : 0) + Math.max(0, this.joy - 0.35) * 40;
    if (rate <= 0 || !g.glow) return;
    this.trailAcc += rate * dt;
    const m = w.model, E = this._em;
    const under = this.zone === 'under';
    while (this.trailAcc > 1) {
      this.trailAcc -= 1;
      const star = Math.random() < 0.22;
      const side = Math.random() < 0.5 ? 'R' : 'L';
      if (m.wingTipPos) m.wingTipPos(side, E.pos); else E.pos.copy(w.pos).addScaledVector(w.right, (side === 'R' ? 1 : -1) * w.L * 0.5);
      E.vel.copy(w.vel).multiplyScalar(0.1).add(_v.set((Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6));
      // mostly soft painted dots, now and then a little four-point star
      E.life = 0.9 + Math.random() * 0.6; E.size = star ? 0.3 + Math.random() * 0.15 : 0.16 + Math.random() * 0.12; E.sizeEnd = 0.05; E.alpha = star ? 0.9 : 0.8;
      E.drag = 1.2; E.gravity = under ? -0.5 : 0.3; E.kind = star ? 2 : 1; E.fadeIn = 0.02;
      const warm = Math.random();
      E.color[0] = lerp(0.55, 1.0, warm); E.color[1] = lerp(0.85, 0.82, warm); E.color[2] = lerp(1.0, 0.55, warm);
      g.glow.emit(E);
    }
  }

  /** A sheet of spray and droplets thrown up from the sea at p. */
  _spray(p, k, n, up) {
    const g = this.game, E = this._em;
    if (!g.mist) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, rr = Math.random();
      E.pos.set(p.x + Math.cos(a) * 1.2 * rr, p.y + 0.2, p.z + Math.sin(a) * 1.2 * rr);
      E.vel.set(Math.cos(a) * (1.5 + 4 * rr) * k, (4 + 8 * Math.random()) * up * Math.min(1.6, 0.5 + k * 0.6), Math.sin(a) * (1.5 + 4 * rr) * k);
      const drop = i % 2 === 0; // half drawn droplets (a crown of teardrops), half painted spray puffs
      E.life = 0.9 + Math.random() * 0.7; E.size = drop ? 0.12 + 0.1 * k : 0.4 + 0.4 * k; E.sizeEnd = drop ? 0.1 : 1.4 + 1.8 * k;
      E.alpha = drop ? 0.9 : 0.55; E.drag = drop ? 0.2 : 0.6; E.gravity = drop ? 9 : 6; E.kind = drop ? 3 : 0; E.fadeIn = 0.03;
      E.color[0] = 0.95; E.color[1] = 0.98; E.color[2] = 1.0;
      g.mist.emit(E);
    }
  }

  _bubbles(p, n, speed) {
    const g = this.game, E = this._em;
    if (!g.mist) return;
    for (let i = 0; i < n; i++) {
      E.pos.set(p.x + (Math.random() - 0.5) * 0.8, p.y + (Math.random() - 0.5) * 0.8, p.z + (Math.random() - 0.5) * 0.8);
      E.vel.set((Math.random() - 0.5) * speed, 1 + Math.random() * speed, (Math.random() - 0.5) * speed);
      E.life = 1.4 + Math.random(); E.size = 0.06 + Math.random() * 0.14; E.sizeEnd = 0.16; E.alpha = 0.75;
      E.drag = 1.0; E.gravity = -2.0; E.kind = 4; E.fadeIn = 0.03;
      E.color[0] = 0.85; E.color[1] = 0.95; E.color[2] = 1.0;
      g.mist.emit(E);
    }
  }

  /**
   * One short hand-drawn wind stroke at p, travelling with the calf (keep 0..1 of its speed) and
   * drifting a little to the side (side -1..1 along w.right), so it trails behind and tapers away.
   */
  _windStroke(p, side, keep, alpha) {
    const g = this.game, w = this.w, E = this._em;
    if (!g.mist) return;
    E.pos.copy(p).addScaledVector(w.fwd, -0.4 - Math.random() * 0.6);
    E.vel.copy(w.vel).multiplyScalar(keep).addScaledVector(w.right, side * 1.5 + (Math.random() - 0.5) * 0.6).addScaledVector(w.up, (Math.random() - 0.5) * 0.6);
    E.life = 0.4 + Math.random() * 0.25; E.size = 0.09 + Math.random() * 0.06; E.sizeEnd = E.size * 0.8;
    E.alpha = alpha; E.drag = 0.6; E.gravity = 0; E.kind = 6; E.fadeIn = 0.02;
    E.color[0] = 1; E.color[1] = 1; E.color[2] = 1;
    E.stretch = 7 + Math.random() * 5;
    g.mist.emit(E);
    E.stretch = 4;
  }
}
