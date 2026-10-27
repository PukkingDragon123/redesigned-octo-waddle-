// The herd: formation along the migration path, individual behaviours (travel, rest, feed,
// play, gather to sing, protect calves, storm shield), the mother's care for the calf
// (leading, waiting, calling, fetching, answering hums), separation and obstacle avoidance.
import { Vector3, Quaternion } from 'three';
import { Whale } from '../creatures/Whale.js';
import { CALF, MOTHER, ELDER, ADULTS, CALVES } from '../creatures/WhaleTypes.js';
import { clamp, damp, lerp, smoothstep, wrapAngle, rng, TAU } from '../core/math.js';
import { noise } from '../core/noise.js';

const _v = new Vector3();
const _v2 = new Vector3();
const UP = new Vector3(0, 1, 0);

export class Herd {
  constructor(game, path, world) {
    this.game = game;
    this.path = path;
    this.world = world;
    this.s = 60; // arc length of the herd anchor
    this.speed = 0; // anchor speed along the path (m/s)
    this.targetSpeed = 0;
    this.mode = 'rest'; // travel | rest | feed | gather | protect | shield | sleep
    this.whales = [];
    this.adults = [];
    this.calves = [];
    this.time = 0;
    const r = rng(17);

    this.calf = this.add(new Whale(CALF), 'player');
    this.mother = this.add(new Whale(MOTHER), 'mother');
    this.elder = this.add(new Whale(ELDER), 'elder');
    // formation slots in the path frame: lateral, vertical, along (ahead +)
    this.mother.slot = new Vector3(-10, 4, 6);
    this.elder.slot = new Vector3(14, 18, 70);
    const slots = [
      [-58, 10, 38], [54, -4, 30], [-36, 26, 82], [40, 30, 96], [-80, -6, -10], [78, 14, -24],
    ];
    ADULTS.forEach((g, i) => {
      const w = this.add(new Whale(g), 'adult');
      w.slot = new Vector3(...slots[i % slots.length]);
    });
    // playmate calves with their parents
    CALVES.forEach((g, i) => {
      const c = this.add(new Whale(g), 'calf');
      c.parent = this.adults[i % this.adults.length];
      c.slotOffset = new Vector3(lerp(-8, 8, r()), lerp(-6, 4, r()), lerp(-6, 6, r()));
    });
    for (const w of this.whales) {
      w.phase = r() * 100;
      w.state = 'travel';
      w.stateT = 0;
      w.homeOffset = new Vector3();
      w.target = new Vector3();
      w.desiredSpeed = 0;
      w.furQuality = game.furQuality ?? 1;
      w.fearT = 0;
    }
    // mother's care state
    this.care = { mode: 'lead', callT: 0, waitT: 0, lastCalfHum: -100, answerAt: -1, nuzzleT: 0 };
    this.formationTight = 0;
    this.songCenter = null;
    this.protectCenter = null;
    this.feedTargets = new Map();
    this.windShelter = 1; // wind multiplier for the calf (mother's lee)
    this.voiceHooks = null; // set by Story: (whale, kind) => void
  }

  add(w, role) {
    w.role = role;
    this.whales.push(w);
    if (role === 'adult' || role === 'mother' || role === 'elder') this.adults.push(w);
    if (role === 'calf') this.calves.push(w);
    this.game.engine.scene.add(w.group);
    w.model.castShadows(this.game.engine.shadows);
    return w;
  }

  /** Place the whole herd around arc length s. */
  placeAt(s, opts = {}) {
    this.s = s;
    const f = this.path.frameAt(s);
    const yaw = Math.atan2(f.fwd.x, f.fwd.z);
    for (const w of this.whales) {
      let p;
      if (w.role === 'player') p = this.slotWorld(new Vector3(-4, -2, -8), s);
      else if (w.role === 'calf') p = this.slotWorld(w.parent.slot, s).add(w.slotOffset);
      else p = this.slotWorld(w.slot, s);
      w.place(p, yaw, 0);
      w.vel.copy(f.fwd).multiplyScalar(opts.speed ?? 0);
    }
  }

  slotWorld(slot, s = this.s, out = new Vector3()) {
    const f = this.path.frameAt(s + slot.z);
    return out.copy(f.pos).addScaledVector(f.right, slot.x).addScaledVector(f.up, slot.y);
  }

  get anchor() {
    return this.path.pointAt(this.s);
  }

  /** Steer an NPC whale toward a point at a desired speed, avoiding neighbours and rock. */
  steer(w, target, speed, dt, opts = {}) {
    const to = _v.copy(target).sub(w.pos);
    const dist = to.length();
    // separation from other whales
    for (const o of this.whales) {
      if (o === w) continue;
      const d = w.pos.distanceTo(o.pos);
      const min = (w.radius + o.radius) * 1.8 + 2;
      if (d < min && d > 0.01) {
        _v2.copy(w.pos).sub(o.pos).multiplyScalar(((min - d) / d) * (o.role === 'player' ? 2.2 : 1.2) * 3);
        to.add(_v2);
      }
    }
    // look ahead for rock
    if (this.world) {
      const ahead = _v2.copy(w.pos).addScaledVector(w.fwd, Math.max(w.L * 1.5, w.vel.length() * 2.5));
      const d = this.world.distance(ahead, w.L * 2);
      if (d < w.L * 1.6) {
        const push = this.world.collide(ahead, w.L * 1.6, new Vector3());
        to.addScaledVector(push, 4);
      }
    }
    const len = to.length() || 1;
    const dir = to.divideScalar(len);
    w.ctl.targetYaw = Math.atan2(dir.x, dir.z);
    w.ctl.targetPitch = clamp(Math.asin(clamp(dir.y, -1, 1)) * (opts.pitchGain ?? 0.8), -0.6, 0.6);
    // arrival: slow near the target
    const arrive = opts.arrive ?? 20;
    const want = speed * smoothstep(0, arrive, dist) + (opts.minSpeed ?? 0);
    const cur = w.vel.dot(w.fwd);
    w.ctl.thrust = clamp((want - cur) * (w.isCalf ? 0.6 : 0.35) + want * 0.06, 0, 1);
    w.ctl.brake = cur > want + 2 ? clamp((cur - want) * 0.25, 0, 1) : 0;
    w.ctl.surge = w.isCalf && want - cur > 6;
    w.drive.effort = clamp(w.ctl.thrust * 1.1, 0, 1);
    w.drive.glide = want > 3 && w.ctl.thrust < 0.35 ? 1 : 0.3;
    w.drive.climb = clamp(Math.sin(w.pitch) * 1.6, -1, 1);
    return dist;
  }

  update(dt) {
    this.time += dt;
    const calf = this.calf;
    // anchor progression
    this.speed = damp(this.speed, this.targetSpeed, 0.6, dt);
    // the herd waits for a lagging calf: progress slows if the calf falls far behind
    const calfS = this.path.project(calf.pos, this.s, 900).s;
    this.calfS = calfS;
    const lag = this.s - calfS;
    const wait = smoothstep(90, 260, lag);
    this.s += this.speed * (1 - wait * 0.92) * dt;
    this.s = Math.min(this.s, this.path.length - 20);

    const f = this.path.frameAt(this.s);
    this.frame = f;
    const fearAll = this.mode === 'protect' ? 0.7 : this.mode === 'shield' ? 0.4 : 0;

    for (const w of this.whales) {
      if (w.role === 'player') continue;
      w.stateT += dt;
      w.phase += dt;
      // organic drift around the slot
      const drift = _v.set(
        noise.noise2(w.phase * 0.05, w.genome.seed) * 10,
        noise.noise2(w.phase * 0.04 + 9, w.genome.seed) * 6,
        noise.noise2(w.phase * 0.03 - 4, w.genome.seed) * 8,
      );
      let target, speed;
      if (w === this.mother) {
        this.updateMother(dt);
        continue;
      }
      if (w.role === 'calf') {
        this.updatePlaymate(w, dt);
        continue;
      }
      const tight = this.formationTight;
      const slot = w.slot.clone().multiplyScalar(lerp(1, 0.45, tight));
      if (this.mode === 'gather' && this.songCenter) {
        // a ring around the song centre, facing inward
        const idx = this.adults.indexOf(w);
        const a = (idx / this.adults.length) * TAU;
        const rad = 70 + (idx % 2) * 18;
        target = this.songCenter.clone().add(new Vector3(Math.cos(a) * rad, (idx % 3 - 1) * 10, Math.sin(a) * rad));
        speed = 6;
        const dist = this.steer(w, target, speed, dt, { arrive: 30 });
        if (dist < 25) {
          // hover and face the centre
          _v2.copy(this.songCenter).sub(w.pos);
          w.ctl.targetYaw = Math.atan2(_v2.x, _v2.z);
          w.ctl.targetPitch = 0.05;
        }
        w.drive.lookAt = this.songCenter;
      } else if (this.mode === 'protect' && this.protectCenter) {
        // a shell of adults around the calves, facing outward
        const idx = this.adults.indexOf(w);
        const n = this.adults.length;
        const phi = Math.acos(1 - (2 * (idx + 0.5)) / n);
        const th = Math.PI * (1 + Math.sqrt(5)) * idx;
        const rad = 36;
        const dir = new Vector3(Math.cos(th) * Math.sin(phi), Math.cos(phi) * 0.7, Math.sin(th) * Math.sin(phi));
        target = this.protectCenter.clone().addScaledVector(dir, rad);
        const dist = this.steer(w, target, 9, dt, { arrive: 20 });
        if (dist < 18) {
          w.ctl.targetYaw = Math.atan2(dir.x, dir.z);
          w.ctl.targetPitch = clamp(dir.y, -0.4, 0.4);
        }
        w.drive.lookAt = this.threat || null;
      } else if (this.mode === 'feed' && this.feedHook) {
        const ft = this.feedHook(w);
        if (ft) {
          this.steer(w, ft, 11, dt, { arrive: 4, minSpeed: 6 });
          const near = w.pos.distanceTo(ft) < 40;
          w.drive.feed = damp(w.drive.feed, near ? 1 : 0, 3, dt);
          w.drive.mouth = w.drive.feed;
        } else {
          target = this.slotWorld(slot).add(drift);
          this.steer(w, target, this.speed + 2, dt, { arrive: 40, minSpeed: this.speed * 0.6 });
        }
      } else if (this.mode === 'rest' || this.mode === 'sleep') {
        target = this.slotWorld(slot).add(drift.multiplyScalar(0.4));
        this.steer(w, target, 3, dt, { arrive: 30 });
        w.drive.sleep = this.mode === 'sleep' ? 1 : 0;
      } else {
        target = this.slotWorld(slot).add(drift);
        this.steer(w, target, this.speed + 3, dt, { arrive: 50, minSpeed: this.speed * 0.7 });
        w.drive.feed = damp(w.drive.feed, 0, 2, dt);
        w.drive.mouth = damp(w.drive.mouth, 0, 3, dt);
      }
      if (this.mode !== 'gather' && this.mode !== 'protect') {
        // adults glance at the calf now and then
        w.drive.lookAt = (Math.sin(w.phase * 0.21) > 0.6 && calf.pos.distanceTo(w.pos) < 160) ? calf.pos : null;
      }
      w.drive.fear = damp(w.drive.fear, fearAll, 1, dt);
      if (this.mode !== 'rest' && this.mode !== 'sleep') w.drive.sleep = damp(w.drive.sleep, 0, 1, dt);
    }

    // wind shelter: the calf flying in its mother's lee feels less wind
    const wind = this.game.wind.base;
    const ws = wind.length();
    if (ws > 0.5) {
      const rel = _v.copy(calf.pos).sub(this.mother.pos);
      const downwind = rel.dot(_v2.copy(wind).normalize());
      const side = Math.sqrt(Math.max(0, rel.lengthSq() - downwind * downwind));
      const inLee = downwind > 0 && downwind < 45 && side < 16;
      this.windShelter = damp(this.windShelter, inLee ? 0.3 : 1, 2, dt);
    } else this.windShelter = 1;

    for (const w of this.whales) {
      if (w.role === 'player') continue;
      this.game.wind.sample(w.pos, w.wind).multiplyScalar(w.isCalf ? 0.6 : 0.25);
      w.step(dt);
      // never pass through rock
      if (this.world) {
        const push = this.world.collide(w.pos, w.radius * 0.9, _v);
        if (push.lengthSq() > 0) {
          w.pos.add(push);
          w.vel.addScaledVector(push, 2);
          w._syncTransform();
        }
      }
    }
  }

  // ---- the mother -----------------------------------------------------------------------
  updateMother(dt) {
    const m = this.mother, calf = this.calf, care = this.care;
    const d = m.pos.distanceTo(calf.pos);
    const calfSpeed = calf.vel.length();
    care.callT -= dt;
    let target, speed;
    if (this.motherScript) {
      // the story is directing her (demonstrations, cinematics)
      const r = this.motherScript(m, dt);
      if (r && r.target) this.steer(m, r.target, r.speed ?? 8, dt, { arrive: r.arrive ?? 8, minSpeed: r.minSpeed ?? 0 });
      m.drive.lookAt = r?.lookAt ?? calf.pos;
      if (r?.face) {
        _v.copy(r.face).sub(m.pos);
        m.ctl.targetYaw = Math.atan2(_v.x, _v.z);
      }
      return;
    }
    if (this.mode === 'gather' && this.songCenter) {
      // beside the calf in the ring, facing the centre
      target = this.songCenter.clone().add(new Vector3(-28, 4, 46));
      this.steer(m, target, 6, dt, { arrive: 25 });
      m.drive.lookAt = calf.pos;
      return;
    }
    if (this.mode === 'protect' && this.protectCenter) {
      // inside the shell, calling her calf in to her side
      const inside = calf.pos.distanceTo(this.protectCenter) < 30;
      target = this.protectCenter.clone().add(new Vector3(-6, 2, 0));
      if (inside) target.lerp(calf.pos, 0.3);
      this.steer(m, target, 9, dt, { arrive: 12, minSpeed: 0 });
      _v.copy(calf.pos).sub(m.pos);
      if (_v.length() > 6) m.ctl.targetYaw = Math.atan2(_v.x, _v.z);
      m.drive.lookAt = calf.pos;
      m.drive.fear = damp(m.drive.fear, inside ? 0.3 : 0.7, 1, dt);
      if (!inside && care.callT <= 0) { this.voiceHooks?.(m, 'warn'); care.callT = 3.5; }
      return;
    }
    if (this.mode === 'shield') {
      // upwind of the calf: her body breaks the gale
      const wdir = _v.copy(this.game.wind.base).normalize();
      target = calf.pos.clone().addScaledVector(wdir, -14).add(new Vector3(0, 2, 0));
      this.steer(m, target, Math.max(8, calfSpeed + 3), dt, { arrive: 8, minSpeed: 2 });
      m.drive.lookAt = calf.pos;
      return;
    }
    if (this.mode === 'rest' || this.mode === 'sleep') {
      target = calf.pos.clone().add(new Vector3(-9, 3, 4));
      this.steer(m, target, 3, dt, { arrive: 14 });
      m.drive.lookAt = calf.pos;
      m.drive.sleep = this.mode === 'sleep' ? 1 : damp(m.drive.sleep, 0, 1, dt);
      return;
    }
    // travelling: lead the calf along the route, adapting to how it follows
    const f = this.frame;
    if (d > 150) care.mode = 'fetch';
    else if (care.mode === 'fetch' && d < 30) care.mode = 'lead';
    else if (d > 60 && care.mode === 'lead') care.mode = 'wait';
    else if (care.mode === 'wait' && d < 28) care.mode = 'lead';
    if (care.mode === 'fetch') {
      target = calf.pos.clone().add(new Vector3(0, 4, 0));
      this.steer(m, target, 16, dt, { arrive: 20, minSpeed: 4 });
      if (care.callT <= 0) { this.voiceHooks?.(m, 'answer'); care.callT = 5; }
      m.drive.lookAt = calf.pos;
      m.drive.happy = damp(m.drive.happy, 0, 1, dt);
    } else if (care.mode === 'wait') {
      // hover near her slot facing the calf, calling gently
      target = this.slotWorld(m.slot).lerp(calf.pos, 0.35);
      this.steer(m, target, 4, dt, { arrive: 25 });
      if (d < 120) {
        _v.copy(calf.pos).sub(m.pos);
        m.ctl.targetYaw = Math.atan2(_v.x, _v.z);
      }
      if (care.callT <= 0) { this.voiceHooks?.(m, 'answer'); care.callT = 7; }
      m.drive.lookAt = calf.pos;
    } else {
      // lead: ahead of the calf, beside the route, matching its pace
      const ahead = clamp(this.calfS + 18, this.s - 40, this.s + 30);
      target = this.path.frameAt(ahead).pos.clone().addScaledVector(f.right, -10).add(new Vector3(0, 4, 0));
      // drift toward the calf's line so she stays visible
      target.lerp(calf.pos.clone().addScaledVector(calf.fwd, 22), 0.35);
      const pace = Math.max(this.speed, Math.min(calfSpeed, 14)) + 1;
      this.steer(m, target, pace, dt, { arrive: 25, minSpeed: this.speed * 0.5 });
      m.drive.lookAt = Math.sin(this.time * 0.35) > -0.2 ? calf.pos : null;
    }
    // answer the calf's hums
    if (care.answerAt > 0 && this.time >= care.answerAt) {
      care.answerAt = -1;
      this.voiceHooks?.(m, 'answer');
      m.drive.happy = 1;
      care.happyT = 3;
    }
    if (care.happyT > 0) {
      care.happyT -= dt;
      if (care.happyT <= 0) m.drive.happy = 0.3;
    }
  }

  /** The calf hummed: its mother turns to it and answers. */
  calfHummed() {
    const care = this.care;
    if (this.time - care.lastCalfHum < 1.2) return;
    care.lastCalfHum = this.time;
    if (care.answerAt < 0) care.answerAt = this.time + 0.7 + Math.random() * 0.4;
  }

  // ---- playmates ------------------------------------------------------------------------
  updatePlaymate(c, dt) {
    const calf = this.calf;
    let target;
    if (c.play && c.play.mode) {
      const P = c.play;
      P.t += dt;
      if (P.mode === 'invite') {
        // swim up to the player, chirp and spin, then dart away
        target = calf.pos.clone().addScaledVector(calf.fwd, 10).add(new Vector3(0, 2, 0));
        const d = this.steer(c, target, Math.max(10, calf.vel.length() + 5), dt, { arrive: 6 });
        c.drive.lookAt = calf.pos;
        c.drive.happy = 1;
        c.drive.excite = 1;
        if (d < 12 && P.t > 1.5) {
          P.mode = 'flee';
          P.t = 0;
          c.barrelRoll(Math.random() < 0.5 ? 1 : -1);
          this.voiceHooks?.(c, 'play');
          P.goal = this.slotWorld(new Vector3((Math.random() - 0.5) * 120, (Math.random() - 0.3) * 40, 60 + Math.random() * 60));
        }
      } else if (P.mode === 'flee') {
        // lead the player on a chase, weaving
        const d = this.steer(c, P.goal, 13 + Math.sin(P.t * 2) * 2, dt, { arrive: 10, minSpeed: 6 });
        c.drive.lookAt = calf.pos;
        c.drive.excite = 1;
        if (d < 25 || P.t > 9) {
          P.goal = this.slotWorld(new Vector3((Math.random() - 0.5) * 140, (Math.random() - 0.3) * 50, 40 + Math.random() * 90));
          P.t = 0;
          if (Math.random() < 0.5) c.barrelRoll(Math.random() < 0.5 ? 1 : -1);
        }
        if (calf.pos.distanceTo(c.pos) < 7) {
          // caught! a happy squeal, and the chase reverses
          P.caught = (P.caught || 0) + 1;
          this.voiceHooks?.(c, 'chirp');
          P.mode = 'chase';
          P.t = 0;
          this.onCaught?.(c);
        }
      } else if (P.mode === 'chase') {
        target = calf.pos.clone();
        this.steer(c, target, Math.max(9, calf.vel.length() * 0.9), dt, { arrive: 4 });
        c.drive.lookAt = calf.pos;
        if (P.t > 6) { P.mode = 'flee'; P.t = 0; }
      }
      return;
    }
    // stay near the parent, wobbly and curious
    const par = c.parent;
    target = par.pos.clone().add(c.slotOffset).addScaledVector(par.right, 0).add(new Vector3(0, -4, 0));
    target.addScaledVector(par.fwd, -par.L * 0.2);
    if (this.mode === 'protect' && this.protectCenter) target = this.protectCenter.clone().add(c.slotOffset.clone().multiplyScalar(0.6));
    if (this.mode === 'gather' && this.songCenter) target = par.pos.clone().add(new Vector3(0, -6, 0)).addScaledVector(par.fwd, 6);
    this.steer(c, target, Math.max(4, par.vel.length() + 3), dt, { arrive: 10, minSpeed: 0 });
    c.drive.lookAt = Math.sin(c.phase * 0.4) > 0.3 ? calf.pos : par.pos;
    c.drive.fear = damp(c.drive.fear, this.mode === 'protect' ? 0.9 : 0, 1, dt);
  }

  startPlay(c) {
    c.play = { mode: 'invite', t: 0 };
  }

  stopPlay() {
    for (const c of this.calves) c.play = null;
  }

  /** Whales within radius of the calf that are adults (for the safe zone). */
  safeZoneAt(p) {
    let n = 0;
    for (const w of this.adults) if (w.pos.distanceTo(p) < w.L * 1.3 + 8) n++;
    return n;
  }
}
