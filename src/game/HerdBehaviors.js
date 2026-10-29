// The herd's social life on top of the story's formation: a small utility-scored behaviour layer.
// Every few seconds an idle whale scores what it could do (calves: bump-tag, rolling together,
// breaching together, tail-slap play, nuzzling a parent; adults: roll-overs, curious approaches,
// surface slaps, synchronized breaches, logging at the surface when the herd rests) and runs the
// winner until it ends. Contacts from WhalePhysics drive reactions to the player (a bumped playmate
// bumps back or starts a chase, a bumped adult turns to look and rumbles, maybe nudges back), and
// the calves copy the player's rolls and hums. The mother's care (nuzzles, escorting the calf low
// over the sea, following its dives, buoying it up when it is tired or out of air) slots into
// Herd.updateMother below the story's own direction. The spiral bubble-net hunt of the Feasting
// Shoals is a group behaviour of the adults (startBubbleNet / stopBubbleNet).
//
// Behaviours only act when the story allows: never in protect / shield / gather (the song), never
// over a motherScript, never on a playmate the story is running a chase with (c.play).
import { Vector3 } from 'three';
import { clamp, damp, lerp, smoothstep, rng, TAU, easeInOut } from '../core/math.js';
import { spoutColumn } from './Swim.js';

const _v = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _look = new Vector3();

const CALF_TYPES = ['tag', 'rollTogether', 'breach', 'surfaceSlap', 'nuzzleParent'];
const ADULT_TYPES = ['rollOver', 'curious', 'surfaceSlap', 'breach'];
const GEST_DUR = { tailSlap: 3.4, finSlap: 3.0, spyhop: 5.0, nuzzle: 2.8, happyWiggle: 1.8, breachArch: 2.6, rollOver: 4.2 };

export class HerdBehaviors {
  constructor(herd) {
    this.herd = herd;
    this.game = herd.game;
    this.enabled = true;
    this.r = rng(4242);
    this.time = 0;
    this.net = null; // the bubble-net hunt
    this.eco = null; // defaults to game.story.eco
    this.low = false; // the herd is close to the sea (surface play allowed)
    this.log = null; // dev: an array to push event strings into
    this._u = new Float32Array(8);
    this._o = { arrive: 10, minSpeed: 0, pitchGain: 0.8, maxPitch: 0.6, sepScale: 1, touch: null };
    this._em = { pos: new Vector3(), vel: new Vector3(), life: 3, size: 0.3, sizeEnd: 0.5, alpha: 0.8, drag: 0.9, gravity: -1.6, color: [1, 1, 1], kind: 4, fadeIn: 0.1 };
    this.careState = { type: null, t: 0, flag: false, nuzzleT: 0, nuzzleCd: 0, snug: 0, nudgeT: 0, voiceT: -99, side: 1, surfacedT: 0 };
    this.RUN = {
      tag: this._tag, rollTogether: this._rollTogether, breach: this._breach, surfaceSlap: this._surfaceSlap,
      nuzzleParent: this._nuzzleParent, curious: this._curious, logRest: this._logRest,
      bumpBack: this._bumpBack, chasePlayer: this._chasePlayer, nudgeBack: this._nudgeBack,
    };
    this._calfRolling = false;
    herd.physics?.addListener?.((a, b, p, k, n) => this.onContact(a, b, p, k, n));
    for (const w of herd.whales) this.attach(w);
  }

  attach(w) {
    if (w.beh) return;
    const r = this.r;
    w.beh = {
      type: null, t: 0, dur: 0, phase: 0, pt: 0, partner: null, group: null, side: 1, k: 0, flag: false,
      tgt: new Vector3(), aux: new Vector3(),
      cd: (w.isCalf ? 4 : 8) + r() * (w.isCalf ? 8 : 22),
      lookT: 0, lookW: null, voiceT: -99, copyT: -1, copyKind: null, copyDir: 1,
      gestT: 4 + r() * 14, spoutT: 6 + r() * 16, logs: r() < 0.75, netI: -1,
    };
    if (w.anim && !w.anim.onGestureEvent) w.anim.onGestureEvent = (name, ev, pos) => this.onGestureEvent(w, name, ev, pos);
  }

  // ---- gates ------------------------------------------------------------------------------
  /** The story's current herd mode leaves room for social behaviour. */
  get active() {
    const h = this.herd;
    return this.enabled && !h.songCenter && h.mode !== 'protect' && h.mode !== 'shield' && h.mode !== 'gather';
  }

  /** Gameplay (not the menu, intro or ending); dev scenes have no story and always play. */
  get playing() {
    const st = this.game.story?.state;
    return !st || st === 'play';
  }

  sea(x, z) {
    const o = this.game.ocean;
    if (!o || o.enabled === false) return 0;
    return o.heightApprox ? o.heightApprox(x, z) : o.heightAt ? o.heightAt(x, z) : 0;
  }

  voice(w, kind, cooldown = 0) {
    const B = w.beh;
    if (B && this.time - B.voiceT < cooldown) return;
    if (B) B.voiceT = this.time;
    this.herd.voiceHooks?.(w, kind);
  }

  _note(s) {
    if (this.log) { this.log.push(`${this.time.toFixed(1)} ${s}`); if (this.log.length > 200) this.log.shift(); }
  }

  // ---- per frame (Herd.update calls update once, then control / care per whale) --------------
  update(dt) {
    this.time += dt;
    const h = this.herd;
    if (!this.active) {
      if (this._wasActive) this.endAll();
      this._wasActive = false;
      return;
    }
    this._wasActive = true;
    const fp = h.frame ? h.frame.pos : h.calf.pos;
    this.seaHere = this.sea(fp.x, fp.z);
    this.low = h.mode === 'rest' || h.mode === 'sleep' || h.mode === 'feed' || fp.y - this.seaHere < 45;
    this._copyPlayer(dt);
    if (this.net) this._updateNet(dt);
    const resting = h.mode === 'rest' || h.mode === 'sleep';
    for (const w of h.whales) {
      if (w.role === 'player' || w === h.mother) continue;
      const B = w.beh;
      if (!B) continue;
      if (B.lookT > 0) B.lookT -= dt;
      if (B.type || B.netI >= 0) continue;
      if (w.role === 'calf' && (w.play && w.play.mode)) continue;
      if (this.net && w.role === 'calf') continue;
      // resting herd: the adults log at the surface straight away
      if (resting && w.role !== 'calf' && B.logs) { this.start(w, 'logRest', Infinity); continue; }
      B.cd -= dt;
      if (B.cd <= 0) this._choose(w);
    }
  }

  /** Steer an NPC whale if a behaviour owns it this frame (true), else leave it to the formation. */
  control(w, dt) {
    if (!this.active) return false;
    const B = w.beh;
    if (!B) return false;
    if (this.net) {
      if (B.netI >= 0) return this._netMember(w, dt);
      if (w.role === 'calf' && !(w.play && w.play.mode)) return this._netWatch(w, dt);
    }
    if (!B.type) return false;
    B.t += dt;
    const fn = this.RUN[B.type];
    const keep = fn ? fn.call(this, w, B, dt) : false;
    if (!keep || B.t > B.dur) {
      this.end(w);
      return false;
    }
    return true;
  }

  /** After the formation / behaviour steering: gaze overrides (a whale turned to look). */
  post(w) {
    const B = w.beh;
    if (B && B.lookT > 0 && B.lookW) w.drive.lookAt = B.lookW.pos;
  }

  start(w, type, dur, partner = null, group = null) {
    const B = w.beh;
    B.type = type;
    B.t = 0;
    B.dur = dur;
    B.phase = 0;
    B.pt = 0;
    B.k = 0;
    B.flag = false;
    B.partner = partner;
    B.group = group;
    B.side = this.r() < 0.5 ? 1 : -1;
    this._note(`${w.name} ${type}${partner ? ' with ' + partner.name : ''}`);
  }

  end(w) {
    const B = w.beh;
    if (!B || !B.type) return;
    const G = B.group;
    B.type = null;
    B.group = null;
    B.partner = null;
    B.cd = w.isCalf ? lerp(5, 11, this.r()) : lerp(12, 30, this.r());
    if (G && !G.done) {
      G.left = (G.left || 0) + 1;
      if (G.type === 'tag' || G.type === 'roll' || G.left >= G.members.length) {
        G.done = true;
        for (const o of G.members) if (o !== w && o.beh.group === G) this.end(o);
      }
    }
  }

  endAll() {
    for (const w of this.herd.whales) if (w.beh) { this.end(w); w.beh.netI = -1; w.beh.lookT = 0; }
    if (this.net) this._endNet();
    this.careState.type = null;
  }

  /** Teleports and chapter starts. */
  reset() {
    this.endAll();
    this.net = null;
    const C = this.careState;
    C.type = null; C.nuzzleT = 0; C.nudgeT = 0; C.snug = 0;
  }

  // ---- choosing -------------------------------------------------------------------------------
  _choose(w) {
    const h = this.herd, r = this.r, B = w.beh, mode = h.mode, u = this._u;
    B.cd = w.isCalf ? lerp(4, 10, r()) : lerp(14, 40, r());
    if (mode !== 'travel' && mode !== 'rest' && mode !== 'feed') return;
    const calf = h.calf;
    const types = w.role === 'calf' ? CALF_TYPES : ADULT_TYPES;
    let sum = 0;
    let mate = null;
    if (w.role === 'calf') {
      mate = this._freeNear(w, h.calves, 90);
      u[0] = mate ? 0.5 : 0; // tag
      u[1] = mode === 'travel' && w.vel.length() > 3 ? 0.3 : 0; // roll together (a mate or the parent)
      u[2] = this.low ? (mate ? 0.45 : 0.15) : 0; // breach
      u[3] = this.low ? 0.25 : 0; // tail-slap play
      u[4] = w.parent && !w.parent.beh?.type && w.parent.beh?.netI < 0 && w.pos.distanceTo(w.parent.pos) < 70 ? 0.25 : 0;
    } else {
      mate = this._freeNear(w, h.adults, 150);
      u[0] = mode === 'travel' ? 0.35 : 0; // roll over
      u[1] = this.playing && calf.pos.distanceTo(w.pos) < 90 && calf.vel.length() < 11 ? 0.25 : 0; // curious
      u[2] = this.low ? 0.22 : 0; // surface slap
      u[3] = this.low && mate ? 0.16 : 0; // synchronized breach
    }
    for (let i = 0; i < types.length; i++) sum += u[i];
    if (sum <= 0) return;
    let x = r() * sum, pick = 0;
    for (let i = 0; i < types.length; i++) { x -= u[i]; if (x <= 0) { pick = i; break; } }
    const type = types[pick];
    if (type === 'rollOver') { w.anim?.gesture?.('rollOver'); this._note(`${w.name} rollOver`); return; }
    if (type === 'tag') {
      const G = { type: 'tag', members: [w, mate], it: w, grace: 1.2, done: false };
      const dur = lerp(16, 28, r());
      this.start(w, 'tag', dur, mate, G);
      this.start(mate, 'tag', dur, w, G);
      this.voice(w, 'play', 2);
      return;
    }
    if (type === 'rollTogether') {
      const par = w.parent && w.parent !== h.mother && !w.parent.beh?.type && w.parent.beh?.netI < 0 ? w.parent : null;
      const other = mate && w.pos.distanceTo(mate.pos) < 60 ? mate : par;
      if (!other) return;
      const G = { type: 'roll', members: [other, w], lead: other, rolled: -1, done: false, side: r() < 0.5 ? 1 : -1 };
      this.start(w, 'rollTogether', 13, other, G);
      if (other.role === 'calf') this.start(other, 'rollTogether', 13, w, G);
      return;
    }
    if (type === 'breach') {
      const members = [w];
      if (mate) members.push(mate);
      if (w.role === 'calf' && mate) {
        const third = this._freeNear(w, h.calves, 90, mate);
        if (third) members.push(third);
      }
      const G = { type: 'breach', members, phase: 0, t0: this.time, done: false };
      for (const m of members) {
        this.start(m, 'breach', 30, null, G);
        // dive ahead along the herd's course, side by side
        const f = h.frame?.fwd || m.fwd;
        m.beh.tgt.copy(m.pos).addScaledVector(f, m.L * 2.5);
      }
      return;
    }
    if (type === 'surfaceSlap') { this.start(w, 'surfaceSlap', 26); return; }
    if (type === 'nuzzleParent') { this.start(w, 'nuzzleParent', 12, w.parent); return; }
    if (type === 'curious') { this.start(w, 'curious', lerp(7, 12, r()), calf); return; }
  }

  _freeNear(w, list, maxD, not = null) {
    let best = null, bd = maxD;
    for (const o of list) {
      if (o === w || o === not || !o.beh || o.beh.type || o.beh.netI >= 0 || (o.play && o.play.mode)) continue;
      if (o === this.herd.mother) continue;
      const d = o.pos.distanceTo(w.pos);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  // ---- helpers ----------------------------------------------------------------------------------
  _steer(w, target, speed, dt, arrive = 10, minSpeed = 0, pitchGain = 0.8, maxPitch = 0.6, sepScale = 1, touch = null) {
    const o = this._o;
    o.arrive = arrive; o.minSpeed = minSpeed; o.pitchGain = pitchGain; o.maxPitch = maxPitch;
    o.sepScale = sepScale; o.touch = touch;
    return this.herd.steer(w, target, speed, dt, o);
  }

  /** Hold a depth against the whale's buoyancy (Swim.js floats a submerged whale up). */
  ballast(w, targetY, dt, k = 1) {
    const s = w.water;
    const sub = s ? s.sub : 0;
    w.vel.y += (w.phys.sink + 3.2) * sub * dt * k;
    const err = targetY - w.pos.y;
    w.vel.y += clamp(err * 0.9 - w.vel.y * 0.7, -5, 5) * dt * k * Math.max(sub, 0.25);
  }

  /** Lowest comfortable cruising height over the sea at (x, z) for this whale. */
  floor(w, x, z) {
    return this.herd.floorY ? this.herd.floorY(w, x, z) : this.sea(x, z) + w.radius * 1.6 + 2;
  }

  _depth(w) {
    return w.water ? w.water.depth : this.sea(w.pos.x, w.pos.z) - w.pos.y;
  }

  // ---- calf behaviours ------------------------------------------------------------------------
  /** Bump-tag: whoever is "it" chases the other; a bump swaps the roles. */
  _tag(w, B, dt) {
    const G = B.group;
    if (!G || G.done) return false;
    const other = G.members[0] === w ? G.members[1] : G.members[0];
    if (other.beh.group !== G) return false;
    const h = this.herd;
    if (G.it === w) {
      if (G.grace > 0) {
        G.grace -= dt;
        _v.copy(w.pos).addScaledVector(w.fwd, 6);
        _v.y = Math.max(_v.y, this.floor(w, _v.x, _v.z));
        this._steer(w, _v, 3, dt, 4);
      } else {
        _v.copy(other.pos).addScaledVector(other.vel, 0.35);
        _v.y = Math.max(_v.y, this.floor(w, _v.x, _v.z) - 1);
        this._steer(w, _v, other.vel.length() + 4.5, dt, 1, 4, 1.0, 0.7, 0, other);
      }
    } else {
      // flee and weave, on a leash around home (the parent, or the herd)
      const home = w.parent ? w.parent.pos : h.frame.pos;
      _v.copy(w.pos).sub(G.it.pos);
      _v.y *= 0.3;
      _v.normalize();
      _v2.copy(w.pos).addScaledVector(_v, 26).addScaledVector(w.right, Math.sin(B.t * 1.7) * 12);
      _v2.lerp(home, smoothstep(40, 95, w.pos.distanceTo(home)) * 0.8);
      _v2.y = Math.max(_v2.y, this.floor(w, _v2.x, _v2.z));
      this._steer(w, _v2, 11, dt, 6, 5);
    }
    w.drive.happy = 1;
    w.drive.excite = 1;
    w.drive.lookAt = other.pos;
    return true;
  }

  /** Two whales side by side, then a barrel roll together and a happy wiggle. */
  _rollTogether(w, B, dt) {
    const G = B.group;
    if (!G || G.done) return false;
    const lead = G.lead;
    const h = this.herd;
    if (w === lead) {
      // the leader swims on along the herd's course
      _v.copy(w.pos).addScaledVector(h.frame.fwd, 30);
      _v.y = Math.max(lerp(_v.y, h.frame.pos.y, 0.3), this.floor(w, _v.x, _v.z));
      this._steer(w, _v, h.speed + 4, dt, 10, 3);
    } else {
      const gap = lead.radius + w.radius + 3;
      _v.copy(lead.pos).addScaledVector(lead.right, G.side * gap).addScaledVector(lead.vel, 0.3);
      const d = this._steer(w, _v, lead.vel.length() + (w.pos.distanceTo(_v) > 6 ? 5 : 0.5), dt, 3, 2, 0.8, 0.6, 0.2, lead);
      if (G.rolled < 0 && d < 4 && B.t > 2 && lead.vel.length() > 3) {
        G.rolled = B.t;
        const dir = this.r() < 0.5 ? 1 : -1;
        w.barrelRoll(dir);
        lead.barrelRoll(dir);
        w.drive.happy = lead.drive.happy = 1;
        this.voice(w, 'play', 2);
        this._note(`${w.name} rolls with ${lead.name}`);
      }
      if (G.rolled >= 0 && B.t - G.rolled > 2.2 && !B.flag) {
        B.flag = true;
        w.anim?.gesture?.('happyWiggle');
        lead.anim?.gesture?.('happyWiggle');
      }
      if (G.rolled >= 0 && B.t - G.rolled > 4) return false;
      w.drive.lookAt = lead.pos;
    }
    return true;
  }

  /** Dive, rise together, burst out of the sea, arch and fall back with a crash (calves or adults). */
  _breach(w, B, dt) {
    const G = B.group;
    if (!G || G.done) return false;
    const sea = this.sea(w.pos.x, w.pos.z);
    const depth = this._depth(w);
    const D = w.isCalf ? 6 : 13;
    const gt = this.time - G.t0;
    if (G.phase === 0) {
      // everyone deep enough (or time is up): rise together
      let ready = true;
      for (const m of G.members) if (m.beh.group === G && !m.beh.flag) ready = false;
      if (ready || gt > 11) G.phase = 1;
    }
    if (G.phase === 0) {
      // down to depth, ahead along the course
      _v.copy(B.tgt);
      _v.y = sea - D;
      this._steer(w, _v, w.isCalf ? 9 : 8, dt, 4, 4, 1.5, 0.9, 0.5);
      if (depth > 0.5) this.ballast(w, sea - D, dt, 0.7);
      if (depth > D * 0.7) B.flag = true;
      return true;
    }
    if (B.phase === 0) {
      // the rise: straight up through the surface
      _v.copy(w.pos).addScaledVector(w.fwd, w.L * 0.4);
      _v.y = sea + w.L;
      this._steer(w, _v, w.isCalf ? 13 : 14, dt, 1, 10, 2.2, 1.2, 0.4);
      if (depth > 0) w.vel.y += (w.isCalf ? 9 : 6.5) * dt;
      w.drive.effort = 1;
      if (depth < -w.radius * 0.3 && w.vel.y > 1.5) {
        B.phase = 1;
        B.pt = 0;
        w.anim?.gesture?.('breachArch');
        this._note(`${w.name} breaches`);
        if (this.r() < 0.4) this.voice(w, w.isCalf ? 'play' : 'answer', 3);
      }
      if (gt > 26) B.phase = 1;
      return true;
    }
    if (B.phase === 1) {
      // airborne: no thrust, the arch, and gravity wins
      B.pt += dt;
      w.ctl.thrust = 0;
      w.ctl.brake = 0;
      w.ctl.targetPitch = -0.35;
      w.drive.effort = 0.1;
      w.drive.glide = 1;
      w.vel.y -= 8.5 * dt;
      if (depth > w.radius * 0.2 || B.pt > 4) { B.phase = 2; B.pt = 0; }
      return true;
    }
    // back in the sea: a few seconds at the surface (Swim.js already threw the crash splash)
    B.pt += dt;
    _v.copy(w.pos).addScaledVector(w.fwd, 10);
    _v.y = sea - w.radius * 0.5;
    this._steer(w, _v, 3, dt, 4);
    this.ballast(w, sea - w.radius * 0.5, dt, 0.6);
    if (B.pt > 3) { B.phase = 3; return false; }
    return true;
  }

  /** Dip to the sea, then tail slaps, fin slaps or a spyhop at the surface. */
  _surfaceSlap(w, B, dt) {
    const sea = this.sea(w.pos.x, w.pos.z);
    const depth = this._depth(w);
    if (B.phase === 0) {
      _v.copy(w.pos).addScaledVector(w.fwd, w.L * 1.5);
      _v.y = sea - w.radius * 0.5;
      this._steer(w, _v, w.isCalf ? 8 : 7, dt, 6, 3, 1.3, 0.8);
      if (Math.abs(depth) < w.radius * 0.9) { B.phase = 1; B.pt = 0; B.k = 0; }
      return B.t < 18;
    }
    // at the surface: slow, hold the waterline, gesture
    B.pt += dt;
    _v.copy(w.pos).addScaledVector(w.fwd, 8);
    _v.y = sea - w.radius * 0.5;
    this._steer(w, _v, 1.5, dt, 6);
    this.ballast(w, sea - w.radius * 0.5, dt, 0.8);
    if (B.pt > B.k) {
      if (B.phase > 2) return false;
      const x = this.r();
      const g = w.isCalf ? (x < 0.5 ? 'tailSlap' : x < 0.8 ? 'finSlap' : 'rollOver') : (x < 0.4 ? 'tailSlap' : x < 0.75 ? 'finSlap' : 'spyhop');
      w.anim?.gesture?.(g);
      this._note(`${w.name} ${g}`);
      B.k = B.pt + (GEST_DUR[g] || 3) + 0.6;
      B.phase += this.r() < 0.55 ? 1 : 2;
    }
    w.drive.happy = Math.max(w.drive.happy, 0.6);
    return true;
  }

  /** A playmate swims up to its parent's head and nuzzles it. */
  _nuzzleParent(w, B, dt) {
    const p = B.partner;
    if (!p || p.beh?.netI >= 0) return false;
    _v.copy(p.pos).addScaledVector(p.fwd, p.L * 0.3).addScaledVector(p.right, B.side * (p.radius * 0.75 + w.radius));
    _v.addScaledVector(p.vel, 0.25);
    const d = this._steer(w, _v, p.vel.length() + (w.pos.distanceTo(_v) > 5 ? 4 : 0.6), dt, 2.5, 0, 0.8, 0.6, 0, p);
    w.drive.lookAt = p.pos;
    if (!B.flag && (d < 2.5 || this.herd.physics?.touching(w, p, 0.3))) {
      B.flag = true;
      B.pt = B.t;
      w.anim?.gesture?.('nuzzle', { side: -B.side });
      if (!p.beh?.type) p.anim?.gesture?.('nuzzle', { side: B.side });
      w.drive.happy = p.drive.happy = 1;
      this.voice(w, 'coo', 3);
    }
    return !(B.flag && B.t - B.pt > 3);
  }

  // ---- adult behaviours --------------------------------------------------------------------------
  /** Swim over to look at the calf for a while. */
  _curious(w, B, dt) {
    const calf = this.herd.calf;
    const d = w.pos.distanceTo(calf.pos);
    if (d > 170) return false;
    _v.copy(w.pos).sub(calf.pos).normalize();
    _v2.copy(calf.pos).addScaledVector(_v, w.L * 0.6 + 7).addScaledVector(calf.vel, 0.5);
    _v2.y = Math.max(_v2.y, this.floor(w, _v2.x, _v2.z));
    this._steer(w, _v2, calf.vel.length() + 2.5, dt, 10, 0, 0.8, 0.6, 0.35);
    w.drive.lookAt = calf.pos;
    B.lookT = 1;
    B.lookW = calf;
    if (B.t > B.dur - 0.1 && !B.flag) {
      B.flag = true;
      if (this.r() < 0.35) this.voice(w, 'answer', 6);
    }
    return true;
  }

  /** The resting herd: lie at the surface like logs, breathing, now and then a spyhop or a slap. */
  _logRest(w, B, dt) {
    const h = this.herd;
    if (h.mode !== 'rest' && h.mode !== 'sleep') return false;
    // the slot's place on the water
    h.slotWorld(w.slot || _v3.set(0, 0, 0), h.s, _v);
    _v.x += Math.sin(w.phase * 0.03 + w.genome.seed) * 6;
    _v.z += Math.cos(w.phase * 0.025 + w.genome.seed) * 6;
    const sea = this.sea(_v.x, _v.z);
    const restY = sea - w.radius * 0.4;
    _v.y = restY;
    const flat = Math.hypot(_v.x - w.pos.x, _v.z - w.pos.z);
    const depth = this._depth(w);
    if (flat > 12 || depth < -w.radius * 2) {
      // drift down onto the water
      this._steer(w, _v, Math.min(5, 1.5 + flat * 0.08), dt, 20, 0, 0.9, 0.5);
    } else {
      // afloat: hardly moving, level, the slot's heading
      w.ctl.thrust = clamp(flat * 0.01, 0, 0.08);
      w.ctl.brake = 0.4;
      w.ctl.targetPitch = 0;
      w.drive.effort = 0.05;
      w.drive.glide = 0.2;
      w.vel.x = damp(w.vel.x, (_v.x - w.pos.x) * 0.05, 0.5, dt);
      w.vel.z = damp(w.vel.z, (_v.z - w.pos.z) * 0.05, 0.5, dt);
      this.ballast(w, restY, dt, 0.6);
      if (h.mode === 'rest' && Math.abs(depth) < w.radius) {
        B.gestT -= dt;
        if (B.gestT <= 0) {
          B.gestT = lerp(16, 45, this.r());
          const x = this.r();
          const g = x < 0.4 ? 'spyhop' : x < 0.7 ? 'tailSlap' : 'finSlap';
          w.anim?.gesture?.(g);
          this._note(`${w.name} ${g} (resting)`);
        }
        B.spoutT -= dt;
        if (B.spoutT <= 0) {
          B.spoutT = lerp(18, 40, this.r());
          this._spout(w, 0.6);
        }
      }
    }
    w.drive.sleep = h.mode === 'sleep' ? 1 : damp(w.drive.sleep, 0.35, 0.5, dt);
    return true;
  }

  // ---- reactions to the player ----------------------------------------------------------------------
  /** A bumped playmate bumps the player right back, then darts away. */
  _bumpBack(w, B, dt) {
    const calf = this.herd.calf;
    if (B.phase === 0) {
      _v.copy(calf.pos).addScaledVector(calf.vel, 0.3);
      this._steer(w, _v, calf.vel.length() + 5, dt, 0.5, 5, 1.0, 0.7, 0, calf);
      w.drive.lookAt = calf.pos;
      w.drive.excite = 1;
      if (B.flag || B.t > 6) { B.phase = 1; B.pt = B.t; B.flag = false; w.barrelRoll(this.r() < 0.5 ? 1 : -1); }
      return true;
    }
    _v.copy(w.pos).sub(calf.pos).normalize();
    _v2.copy(w.pos).addScaledVector(_v, 25);
    _v2.y = Math.max(_v2.y, this.floor(w, _v2.x, _v2.z));
    this._steer(w, _v2, 12, dt, 5, 6);
    w.drive.happy = 1;
    return B.t - B.pt < 2.5;
  }

  /** Bump-tag with the player: chase until it touches, then flee and let the player chase. */
  _chasePlayer(w, B, dt) {
    const calf = this.herd.calf;
    if (calf.pos.distanceTo(w.pos) > 180) return false;
    if (B.phase === 0) {
      _v.copy(calf.pos).addScaledVector(calf.vel, 0.4);
      _v.y = Math.max(_v.y, this.floor(w, _v.x, _v.z) - 1);
      this._steer(w, _v, Math.max(8, calf.vel.length() + 3.5), dt, 1, 5, 1.0, 0.7, 0, calf);
      if (B.flag) {
        B.flag = false;
        B.phase = 1;
        B.pt = B.t;
        this.voice(w, 'play', 1);
        w.barrelRoll(this.r() < 0.5 ? 1 : -1);
        this._note(`${w.name} tagged the calf`);
      }
    } else {
      const home = w.parent ? w.parent.pos : this.herd.frame.pos;
      _v.copy(w.pos).sub(calf.pos);
      _v.y *= 0.3;
      _v.normalize();
      _v2.copy(w.pos).addScaledVector(_v, 24).addScaledVector(w.right, Math.sin(B.t * 1.9) * 10);
      _v2.lerp(home, smoothstep(50, 110, w.pos.distanceTo(home)) * 0.8);
      _v2.y = Math.max(_v2.y, this.floor(w, _v2.x, _v2.z));
      this._steer(w, _v2, 10.5, dt, 6, 5);
      // tagged back by the player: chase again
      if (B.flag && B.t - B.pt > 1) { B.flag = false; B.phase = 0; this.voice(w, 'chirp', 1); }
      if (B.t - B.pt > 7) { B.phase = 0; }
    }
    w.drive.lookAt = calf.pos;
    w.drive.happy = 1;
    w.drive.excite = 1;
    return true;
  }

  /** A big whale nudges the calf back, gently. */
  _nudgeBack(w, B, dt) {
    const calf = this.herd.calf;
    this._steer(w, calf.pos, calf.vel.length() + 1.6, dt, 2, 0.8, 0.8, 0.6, 0, calf);
    w.drive.lookAt = calf.pos;
    return !B.flag && B.t < 4;
  }

  onContact(a, b, p, k) {
    if (!this.active) return;
    const h = this.herd, calf = h.calf;
    const Ba = a.beh, Bb = b.beh;
    // tag swaps between playmates
    if (Ba && Bb && Ba.group && Ba.group === Bb.group && Ba.group.type === 'tag') {
      const G = Ba.group;
      if (G.grace <= 0) {
        const was = G.it;
        G.it = was === a ? b : a;
        G.grace = 1.1;
        this.voice(was, 'chirp', 1);
        was.anim?.gesture?.('happyWiggle');
        this._note(`${was.name} tags ${G.it.name}`);
      }
      return;
    }
    if (a !== calf && b !== calf) {
      // two NPCs bumped: a glance at each other
      if (k > 0.3) {
        if (Ba) { Ba.lookT = 1.5; Ba.lookW = b; }
        if (Bb) { Bb.lookT = 1.5; Bb.lookW = a; }
      }
      return;
    }
    const o = a === calf ? b : a;
    this.playerBumped(o, k);
  }

  /** The player's calf touched whale o (strength k 0..2). */
  playerBumped(o, k) {
    const h = this.herd, B = o.beh, calf = h.calf;
    if (!B) return;
    this._note(`calf bumps ${o.name} k=${k.toFixed(2)}`);
    if (o === h.mother) { this._motherBumped(k); return; }
    if (B.type === 'bumpBack' || B.type === 'chasePlayer' || B.type === 'nudgeBack') { B.flag = true; return; }
    B.lookT = 2.5 + k * 2;
    B.lookW = calf;
    if (B.netI >= 0 || (o.play && o.play.mode)) return;
    const mode = h.mode;
    if (mode !== 'travel' && mode !== 'rest' && mode !== 'feed') return;
    if (o.role === 'calf') {
      if (B.type && B.type !== 'surfaceSlap' && B.type !== 'nuzzleParent' && B.type !== 'rollTogether') return;
      this.end(o);
      this.voice(o, 'play', 1.5);
      if (this.r() < 0.5) this.start(o, 'bumpBack', 7);
      else this.start(o, 'chasePlayer', lerp(14, 22, this.r()));
      return;
    }
    // an adult: turns to look, rumbles, sometimes nudges back
    if (k > 0.15) this.voice(o, 'answer', 6);
    if (!B.type && k < 1.4 && this.r() < 0.35) this.start(o, 'nudgeBack', 4);
  }

  _motherBumped(k) {
    const h = this.herd, m = h.mother, C = this.careState, B = m.beh;
    B.lookT = 3 + k * 2;
    B.lookW = h.calf;
    m.drive.happy = Math.max(m.drive.happy, 0.6);
    if (k < 0.4) {
      if (C.nuzzleCd <= 0) { C.nuzzleT = 3.2; C.nuzzleCd = 8; this.voice(m, 'answer', 3); }
    } else {
      this.voice(m, 'answer', 4);
      if (this.r() < 0.3) C.nudgeT = 2.5;
    }
  }

  // ---- copying the player --------------------------------------------------------------------------
  _copyPlayer(dt) {
    const h = this.herd, calf = h.calf, r = this.r;
    const rolling = calf.rollSpin > 0;
    if (rolling && !this._calfRolling && this.playing) {
      for (const c of h.calves) {
        if (c.pos.distanceTo(calf.pos) < 50 && c.beh.copyT < 0) { c.beh.copyT = 0.25 + r() * 0.5; c.beh.copyKind = 'roll'; c.beh.copyDir = calf.rollDir; }
      }
      for (const w of h.adults) {
        if (w !== h.mother && w.pos.distanceTo(calf.pos) < w.L * 1.6 + 10 && r() < 0.3 && w.beh.copyT < 0) { w.beh.copyT = 0.6 + r(); w.beh.copyKind = 'rollOver'; }
      }
    }
    this._calfRolling = rolling;
    for (const w of h.whales) {
      const B = w.beh;
      if (!B || B.copyT < 0) continue;
      B.copyT -= dt;
      if (B.copyT > 0) continue;
      B.copyT = -1;
      if (B.netI >= 0) continue;
      if (B.copyKind === 'roll') {
        w.barrelRoll(B.copyDir);
        w.drive.happy = 1;
        if (r() < 0.4) this.voice(w, 'play', 2);
        this._note(`${w.name} copies the roll`);
      } else if (B.copyKind === 'hum') {
        this.voice(w, 'chirp', 1.5);
        w.anim?.gesture?.('happyWiggle');
        w.drive.happy = 1;
        this._note(`${w.name} hums along`);
      } else if (B.copyKind === 'rollOver') {
        w.anim?.gesture?.('rollOver');
      }
    }
  }

  /** The calf hummed (Herd.calfHummed): nearby playmates answer with a chirp and a wiggle. */
  onCalfHum() {
    if (!this.active) return;
    const h = this.herd, calf = h.calf;
    for (const c of h.calves) {
      if (c.pos.distanceTo(calf.pos) < 60 && c.beh.copyT < 0) { c.beh.copyT = 0.35 + this.r() * 0.7; c.beh.copyKind = 'hum'; }
    }
  }

  // ---- the mother's care -------------------------------------------------------------------------------
  /**
   * Called by Herd.updateMother when the story is not directing her. Returns true if a care
   * behaviour steers her this frame (buoy, followDive, nudge, nuzzle, escort).
   */
  care(m, dt) {
    const h = this.herd, C = this.careState;
    if (C.nuzzleCd > 0) C.nuzzleCd -= dt;
    if (!this.active || !this.playing || h.motherScript || h.care.mode === 'fetch') { C.type = null; return false; }
    if (h.mode !== 'travel' && h.mode !== 'rest' && h.mode !== 'feed') { C.type = null; return false; }
    const calf = h.calf, ws = calf.water;
    const depth = ws ? ws.depth : -99, air = ws ? ws.air : 1;
    const cs = calf.vel.length();
    const dist = m.pos.distanceTo(calf.pos);
    if (C.nudgeT > 0) C.nudgeT -= dt;
    if (C.nuzzleT > 0) C.nuzzleT -= dt;
    // a calf lingering by her head gets a nuzzle
    const near = dist < m.L * 0.55 + calf.L && cs < 4.5;
    C.snug = near ? C.snug + dt : 0;
    if (C.snug > 1 && C.nuzzleCd <= 0) { C.nuzzleT = 3.2; C.nuzzleCd = 10; C.snug = 0; }
    let want = null;
    const tired = calf.energy < 0.25 || calf.drive.tired > 0.6;
    if ((depth > 0.5 && air < 0.4) || tired || (C.type === 'buoy' && C.t < 30 && !(air > 0.85 && depth < -0.5 && !tired))) want = 'buoy';
    else if (depth > 2.5 || (C.type === 'followDive' && C.surfacedT < 1.5)) want = 'followDive';
    else if (C.nudgeT > 0) want = 'nudge';
    else if (C.nuzzleT > 0) want = 'nuzzle';
    else if (h.mode === 'travel' && depth > -calf.radius * 4 && cs > 3 && dist < 70) want = 'escort';
    if (want !== C.type) {
      C.type = want;
      C.t = 0;
      C.flag = false;
      C.side = _v.copy(m.pos).sub(calf.pos).dot(calf.right) > 0 ? 1 : -1;
      if (want) this._note(`mother ${want}`);
    }
    if (!want) return false;
    C.t += dt;
    C.surfacedT = depth < 0.5 ? C.surfacedT + dt : 0;
    const rm = m.radius, rc = calf.radius;
    m.drive.lookAt = calf.pos;
    if (want === 'buoy') {
      // beneath the calf, matching its heading, lifting it to the air
      _v.copy(calf.pos).addScaledVector(calf.vel, 0.3);
      _v.y -= rc + rm * 0.9;
      this._steer(m, _v, Math.max(cs + 3, 6), dt, 3, 0, 1.2, 0.8, 0, calf);
      if (m.pos.distanceTo(_v) < rm * 1.5) m.ctl.targetYaw = calf.yaw;
      const under = Math.hypot(m.pos.x - calf.pos.x, m.pos.z - calf.pos.z) < rm * 1.2 && m.pos.y < calf.pos.y;
      if (under) calf.vel.y += (depth > 0 ? 3.6 : 1.4) * dt;
      if (this._depth(m) > 0.3) this.ballast(m, _v.y, dt, 0.8);
      if (!C.flag && under) { C.flag = true; this.voice(m, 'coo', 4); }
      return true;
    }
    if (want === 'followDive') {
      _v.copy(calf.pos).addScaledVector(calf.right, C.side * (rm + rc + 7)).addScaledVector(calf.fwd, 2);
      _v.y -= 1.5;
      this._steer(m, _v, cs + 2, dt, 6, 0, 1.3, 0.8, 0.6, calf);
      if (this._depth(m) > 0.3) this.ballast(m, _v.y, dt, 0.9);
      return true;
    }
    if (want === 'nudge') {
      this._steer(m, calf.pos, cs + 1.4, dt, 2, 0.5, 0.8, 0.6, 0, calf);
      return true;
    }
    if (want === 'nuzzle') {
      if (!C.flag) {
        C.flag = true;
        m.anim?.gesture?.('nuzzle', { side: -C.side });
        m.drive.happy = 1;
      }
      // her head to the calf
      _v.copy(calf.pos).addScaledVector(m.fwd, -m.L * 0.33).addScaledVector(calf.vel, 0.3);
      this._steer(m, _v, cs + 0.8, dt, 4, 0, 0.8, 0.6, 0, calf);
      return true;
    }
    // escort: the calf skims the sea, she flies just above and beside it
    // (a comfortable gap: close enough to read as hers, far enough never to fill the frame)
    _v.copy(calf.pos).addScaledVector(calf.right, C.side * (rm * 1.6 + rc + 14)).addScaledVector(calf.fwd, 6).addScaledVector(calf.vel, 0.6);
    _v.y = Math.max(calf.pos.y + 5, this.floor(m, _v.x, _v.z) - rm * 0.5);
    this._steer(m, _v, cs + 1, dt, 10, 0, 0.8, 0.6, 0.6);
    return true;
  }

  // ---- the bubble net ---------------------------------------------------------------------------------
  /** The Feasting Shoals: the adults spiral beneath the school blowing a curtain of bubbles, then lunge. */
  startBubbleNet(center) {
    const h = this.herd;
    if (!center) return;
    if (this.net) {
      this.net.center.copy(center);
      this.net.active = true;
      return;
    }
    const members = h.adults.filter((w) => w !== h.mother && w.beh).slice(0, 7);
    if (!members.length) return;
    const r = this.r;
    const sea = this.sea(center.x, center.z);
    this.net = {
      center: new Vector3().copy(center), schoolY: Math.min(center.y, sea - 5), sea, depthY: sea - 18,
      active: true, phase: 'gather', t: 0, cycle: 0, members, T: 18, w: 0.3,
      // room for every body on the ring, the spiral closes until they nearly touch
      R0: 30 + members.length * 2.5, R1: Math.max(10, members.length * 2), Rl: Math.max(5, members.length * 1.3),
      a0: r() * TAU, dir: r() < 0.5 ? 1 : -1, ecoT: 0,
    };
    members.forEach((w, i) => {
      this.end(w);
      w.beh.netI = i;
      w.beh.phase = 0;
      w.beh.k = 0;
    });
    this._note(`bubble net starts with ${members.length}`);
  }

  stopBubbleNet() {
    const N = this.net;
    if (!N) return;
    N.active = false;
    (this.eco || this.game.story?.eco)?.stopBubbleNet?.();
    if (N.phase === 'gather') this._endNet();
  }

  _endNet() {
    const N = this.net;
    if (!N) return;
    for (const w of N.members) {
      w.beh.netI = -1;
      w.beh.phase = 0;
      w.beh.cd = lerp(8, 20, this.r());
    }
    this.net = null;
    this._note('bubble net ends');
  }

  _updateNet(dt) {
    const N = this.net;
    N.t += dt;
    const eco = this.eco || this.game.story?.eco;
    // follow the school
    const sch = eco?.nearestSwarm?.(N.center);
    if (sch && sch.dist < 160 && sch.pos) {
      N.center.x = damp(N.center.x, sch.pos.x, 0.5, dt);
      N.center.z = damp(N.center.z, sch.pos.z, 0.5, dt);
      N.schoolY = sch.pos.y;
    }
    N.sea = this.sea(N.center.x, N.center.z);
    N.schoolY = Math.min(N.schoolY, N.sea - 3);
    N.depthY = clamp(N.schoolY - 12, N.sea - 34, N.sea - 13);
    if (N.phase === 'gather') {
      let ready = 0;
      for (const w of N.members) if (w.beh.k > 0) ready++;
      if (!N.active) { this._endNet(); return; }
      if (ready >= N.members.length || N.t > 16) {
        N.phase = 'spiral';
        N.t = 0;
        eco?.bubbleNet?.(N.center, N.R0, 1, N.T + 6);
        this._note('spiral');
      }
    } else if (N.phase === 'spiral') {
      N.ecoT -= dt;
      if (N.ecoT <= 0) {
        N.ecoT = 3;
        eco?.bubbleNet?.(N.center, lerp(N.R0, N.R1, easeInOut(clamp(N.t / N.T, 0, 1))) + 4, 1, 6);
      }
      if (N.t > N.T || (!N.active && N.t > 2)) {
        N.phase = 'lunge';
        N.t = 0;
        for (const w of N.members) { w.beh.phase = 0; w.beh.pt = 0; }
        this._note('lunge');
      }
    } else if (N.phase === 'lunge') {
      let back = 0;
      for (const w of N.members) if (w.beh.phase >= 2) back++;
      if (back >= N.members.length || N.t > 13) { N.phase = 'surface'; N.t = 0; }
    } else if (N.phase === 'surface') {
      if (N.t > 7) {
        if (N.active) { N.phase = 'gather'; N.t = 0; N.cycle++; for (const w of N.members) w.beh.k = 0; N.a0 += 1.3; }
        else this._endNet();
      }
    }
  }

  _netMember(w, dt) {
    const N = this.net, B = w.beh;
    const n = N.members.length;
    const sea = N.sea;
    const c = N.center;
    const base = N.a0 + (B.netI / n) * TAU;
    const depth = this._depth(w);
    // three depth layers, so neighbours on the ring pass over and under each other
    const layer = -(B.netI % 3) * 8;
    _look.copy(c);
    _look.y = N.schoolY;
    w.drive.lookAt = _look;
    if (N.phase === 'gather') {
      _v.set(c.x + Math.cos(base) * N.R0, N.depthY + layer, c.z + Math.sin(base) * N.R0);
      const d = this._steer(w, _v, 9, dt, 10, 2, 1.4, 0.8, 0.5);
      if (depth > 0.5) this.ballast(w, N.depthY + layer, dt, 0.8);
      if (d < 18 && depth > 6) B.k = 1;
      w.drive.mouth = damp(w.drive.mouth, 0, 3, dt);
      w.drive.feed = damp(w.drive.feed, 0, 3, dt);
      if (depth > 3) this._bubbles(w, dt, 3);
      return true;
    }
    if (N.phase === 'spiral') {
      const k = clamp(N.t / N.T, 0, 1);
      const R = lerp(N.R0, N.R1, easeInOut(k));
      const ang = base + N.dir * N.w * N.t;
      const lead = N.dir * 0.55;
      const y = lerp(N.depthY + layer, N.depthY + 5 + layer * 0.5, k);
      _v.set(c.x + Math.cos(ang + lead) * R, y, c.z + Math.sin(ang + lead) * R);
      this._steer(w, _v, Math.max(4, N.w * R * 1.25), dt, 2, 3, 1.3, 0.8, 0.35);
      if (depth > 0.3) this.ballast(w, y, dt, 0.9);
      this._bubbles(w, dt, 10);
      // where the curtain breaks the surface: a ring of froth tracing the spiral
      this._froth(w, dt, sea);
      return true;
    }
    if (N.phase === 'lunge') {
      if (B.phase === 0) {
        // up through the fish, mouths wide, all together
        _v.set(c.x + Math.cos(base) * N.Rl, sea + w.L * 0.8, c.z + Math.sin(base) * N.Rl);
        this._steer(w, _v, 15, dt, 1, 10, 2.2, 1.2, 0.2);
        if (depth > 0) w.vel.y += 6 * dt;
        w.drive.effort = 1;
        const near = Math.hypot(w.pos.x - c.x, w.pos.z - c.z) < 22;
        w.drive.mouth = damp(w.drive.mouth, near ? 1 : 0.55, 4, dt);
        w.drive.feed = w.drive.mouth;
        if (depth < -w.radius * 0.25 && w.vel.y > 1.5) {
          B.phase = 1;
          B.pt = 0;
          w.anim?.gesture?.('breachArch');
          this._note(`${w.name} lunges out`);
          if (this.r() < 0.35) this.voice(w, 'answer', 4);
        }
        if (N.t > 9) B.phase = 1;
        return true;
      }
      if (B.phase === 1) {
        B.pt += dt;
        w.ctl.thrust = 0;
        w.ctl.brake = 0;
        w.ctl.targetPitch = -0.3;
        w.drive.effort = 0.1;
        w.drive.glide = 1;
        w.vel.y -= 8 * dt;
        w.drive.mouth = damp(w.drive.mouth, 0.4, 1.5, dt);
        w.drive.feed = w.drive.mouth;
        if (depth > w.radius * 0.2 || B.pt > 4) B.phase = 2;
        return true;
      }
    }
    // after the lunge: lie at the surface, breathe (Swim.js spouts after the dive), mouths close
    const ang = base + 0.4;
    _v.set(c.x + Math.cos(ang) * N.R0 * 0.7, sea - w.radius * 0.5, c.z + Math.sin(ang) * N.R0 * 0.7);
    this._steer(w, _v, 3, dt, 8, 0, 0.9, 0.6, 0.6);
    this.ballast(w, sea - w.radius * 0.5, dt, 0.7);
    w.drive.mouth = damp(w.drive.mouth, 0, 2, dt);
    w.drive.feed = damp(w.drive.feed, 0, 2, dt);
    if (N.phase === 'lunge' && B.phase < 2) B.phase = 2;
    return true;
  }

  /** Playmates watch the hunt from the surface at the rim, slapping now and then. */
  _netWatch(w, dt) {
    const N = this.net, B = w.beh;
    const i = this.herd.calves.indexOf(w);
    const ang = N.a0 + 0.6 + i * 0.5;
    const R = N.R0 + 18;
    const floatY = N.sea - w.radius * 0.5;
    _v.set(N.center.x + Math.cos(ang) * R, floatY, N.center.z + Math.sin(ang) * R);
    this._steer(w, _v, 5, dt, 8, 0, 0.9, 0.6, 0.6);
    if (this._depth(w) > -w.radius) this.ballast(w, floatY, dt, 0.7);
    w.drive.lookAt = N.center;
    w.drive.excite = damp(w.drive.excite, 0.6, 1, dt);
    if (Math.abs(this._depth(w)) < w.radius * 2.5) {
      B.gestT -= dt;
      if (B.gestT <= 0) {
        B.gestT = lerp(6, 14, this.r());
        w.anim?.gesture?.(this.r() < 0.6 ? 'tailSlap' : 'finSlap');
      }
    }
    return true;
  }

  /** A curtain of bubbles from the blowholes (mist particles, kind 4), rising to the surface. */
  _bubbles(w, dt, rate) {
    const mist = this.game.mist;
    if (!mist) return;
    const B = w.beh;
    B.aux.x = (B.aux.x || 0) + rate * dt;
    if (B.aux.x < 1) return;
    const r = this.r;
    const em = this._em;
    const surf = this.sea(w.pos.x, w.pos.z);
    while (B.aux.x >= 1) {
      B.aux.x -= 1;
      em.pos.copy(w.pos).addScaledVector(w.fwd, w.L * (0.2 - r() * 0.15)).addScaledVector(w.up, w.radius * 0.7);
      em.pos.x += (r() - 0.5) * 1.2;
      em.pos.z += (r() - 0.5) * 1.2;
      const depth = surf - em.pos.y;
      if (depth < 0.5) continue;
      em.vel.set((r() - 0.5) * 0.5, 0.3 + r() * 0.5, (r() - 0.5) * 0.5);
      // a curtain of every size: mostly fine, a few big wobbling caps that race ahead
      const u = r();
      em.size = (0.005 + 0.16 * u * u * u) * clamp(w.L / 20, 0.4, 1.6);
      em.sizeEnd = em.size * 1.3;
      em.life = clamp(depth / 0.35, 2, 14);
      em.alpha = 0.85;
      em.drag = 1.6; em.gravity = 0; em.kind = 4; em.fadeIn = 0.1;
      em.color[0] = 1; em.color[1] = 1; em.color[2] = 1;
      mist.emit(em);
    }
  }

  /** Bubbles breaking the surface above a circling whale: soft froth puffs and a little foam. */
  _froth(w, dt, sea) {
    const B = w.beh, r = this.r;
    B.aux.y = (B.aux.y || 0) + dt * 4;
    B.aux.z = (B.aux.z || 0) + dt;
    const mist = this.game.mist;
    const em = this._em;
    while (B.aux.y >= 1) {
      B.aux.y -= 1;
      if (!mist) continue;
      // bubbles bursting: spreading rings on the water and a few jet drops
      em.pos.set(w.pos.x + (r() - 0.5) * 4, sea + 0.04, w.pos.z + (r() - 0.5) * 4);
      em.vel.set(0, 0, 0);
      em.life = 0.9 + r() * 0.8;
      em.size = 0.1;
      em.sizeEnd = 0.6 + r() * 0.9;
      em.alpha = 0.45;
      em.drag = 0;
      em.gravity = 0;
      em.kind = 8;
      em.stretch = 0.08;
      em.fadeIn = 0.03;
      mist.emit(em);
      em.stretch = 4;
      em.pos.y = sea + 0.05;
      em.vel.set((r() - 0.5) * 0.8, 1.5 + r() * 2, (r() - 0.5) * 0.8);
      em.life = 0.5; em.size = 0.006; em.sizeEnd = 0.006; em.alpha = 0.9; em.drag = 0.3; em.gravity = 9.8; em.kind = 3; em.fadeIn = 0.01;
      mist.emit(em);
    }
    em.drag = 0.9; em.gravity = -1.6; em.kind = 4; em.fadeIn = 0.1;
    if (B.aux.z > 1.4) {
      B.aux.z = 0;
      _v2.set(w.pos.x, sea, w.pos.z);
      this.game.ocean?.splash?.(_v2, 0.15, 2.5 + w.L * 0.06);
    }
  }

  /** A breath at the surface: the blowholes open and a vapour spout rises. */
  _spout(w, k) {
    w.anim?.breathe?.(k);
    const mist = this.game.mist;
    if (!mist) return;
    const em = this._em;
    const base = _v3.copy(w.pos).addScaledVector(w.fwd, w.L * 0.22).addScaledVector(w.up, w.radius);
    // a tall column of fine vapour drifting off with the wind
    spoutColumn(this.game, base, w, k ?? 1);
    em.drag = 0.9; em.gravity = -1.6; em.kind = 4;
  }

  /** Slap gestures hitting the water throw a splash (Ocean.splash, with a direction). */
  onGestureEvent(w, name, ev, pos) {
    if (ev !== 'slap') return;
    const p = _v3;
    if (pos) p.copy(pos);
    else if (name === 'tailSlap') p.copy(w.pos).addScaledVector(w.fwd, -w.L * 0.46);
    else p.copy(w.pos).addScaledVector(w.right, (w.anim?.gest?.side ?? 1) * w.L * 0.4);
    const sea = this.sea(p.x, p.z);
    if (Math.abs(p.y - sea) > Math.max(2, w.L * 0.22)) return; // in the air: no water to hit
    p.y = sea;
    const tail = name === 'tailSlap';
    const k = (tail ? 1.25 : 0.9) * clamp(w.L / 20, 0.3, 1.5);
    _v2.copy(w.up).multiplyScalar(1.2);
    if (tail) _v2.addScaledVector(w.fwd, -0.6);
    this.game.ocean?.splash?.(p, k, w.L * (tail ? 0.22 : 0.18), _v2);
    this.herd.onSplash?.('slap', p, k);
    this._note(`${w.name} ${name} splash`);
  }
}
