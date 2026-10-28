// The Spiral Maelstrom nursery (docs/VUR_SOK.md 0.7): the slow sea vortex the herd returns to each
// season, the single embryo-like egg in its calm eye, the males circling on guard, and the predators
// drawn by the egg's glow (lanternjacks from below, skimmers from above), driven off by the guards
// or, in Act III, by the player (getting close, tail slaps, dashes, breaches, sonic booms).
//
// Built against the maelstrom builder's API, defensively:
//   game.ocean.setWhirlpool(id, { center, radius, depth, spin }) / clearWhirlpool(id)
//   new WhaleEgg(game, opts) from src/creatures/egg/WhaleEgg.js (falls back to EggStandIn)
import { Vector3 } from 'three';
import { EggStandIn } from './EggStandIn.js';
import { seaHeight } from '../Swim.js';
import { TAU } from '../../core/math.js';

const EGG = import.meta.glob('../../creatures/egg/WhaleEgg.js');
const _v = new Vector3();
const _w = new Vector3();
const ID = 'nursery';
const LURE = [0.55, 1.0, 0.85];
const WINGS = [1, 0.9, 0.75];

export class Nursery {
  constructor(story) {
    this.story = story;
    this.game = story.game;
    this.center = new Vector3();
    this.radius = 110;
    this.on = false;
    this.egg = null;
    this.EggClass = null;
    this.threats = [];
    this.guards = [];
    this.strikes = 0; // threats that reached the egg
    this.repelled = 0; // threats driven off
    this.repelledBy = null; // the last whale that drove one off
    this._em = { pos: new Vector3(), vel: new Vector3(), life: 1.4, size: 0.5, sizeEnd: 0.1, alpha: 0.9, drag: 1, kind: 0, color: [0.55, 1.0, 0.85], fadeIn: 0.1 };
    const m = EGG['../../creatures/egg/WhaleEgg.js'];
    if (m) m().then((mod) => { this.EggClass = mod.WhaleEgg || mod.default || null; }).catch(() => {});
    // the guards' circling, as a herd behaviour the formation leaves alone (HerdBehaviors.RUN)
    const B = story.herd?.behaviors;
    if (B && B.RUN && !B.RUN.docGuard) {
      const self = this;
      B.RUN.docGuard = function (w, st, dt) { return self._guardStep(w, st, dt, this); };
    }
    // the player's moves can drive predators off
    story.player?.moves?.on?.((e) => this.onMove(e));
  }

  // ---- the vortex ----------------------------------------------------------------------------------
  open(center, opts = {}) {
    this.center.copy(center);
    this.center.y = 0;
    this.radius = opts.radius ?? 110;
    this.on = true;
    this.depth = 0;
    try {
      if (this.game.ocean?.setWhirlpool) {
        this.game.ocean.setWhirlpool(ID, { center: this.center.clone(), radius: this.radius, depth: opts.depth ?? 7, spin: opts.spin ?? 0.22 });
        this.depth = opts.depth ?? 7;
      }
    } catch (e) { console.warn('[skysong] whirlpool unavailable', e); }
  }

  /** Ease the vortex (calmer as the season ends) without removing it. */
  settle(depth = 3, spin = 0.12) {
    if (!this.on) return;
    if (this.depth > 0) this.depth = depth;
    try { this.game.ocean?.setWhirlpool?.(ID, { center: this.center.clone(), radius: this.radius, depth, spin }); } catch (e) { /* older ocean */ }
    // the egg stays where it is: the eye only gets shallower
  }

  close() {
    if (this.on) {
      try { this.game.ocean?.clearWhirlpool?.(ID); } catch (e) { /* older ocean */ }
    }
    this.on = false;
    this.removeEgg();
    this.unguard();
    this.clearThreats();
  }

  /** Height of the calm eye's water: the funnel's full dip (it eases in over a few seconds). */
  eyeY() {
    return Math.min(seaHeight(this.game, this.center.x, this.center.z), -this.depth);
  }

  // ---- the egg ---------------------------------------------------------------------------------------
  layEgg(pos, opts = {}) {
    this.removeEgg();
    const g = this.game;
    let egg = null;
    if (this.EggClass) {
      try {
        egg = new this.EggClass(g, { position: pos.clone(), length: 3.2, float: false, glow: 0.2, pulse: 1.1, yaw: opts.yaw ?? 0 });
        // held under the water in the calm eye (the calf rises to its first breath)
        egg.position?.copy?.(pos);
      } catch (e) { console.warn('[skysong] WhaleEgg failed, using the stand-in', e); egg = null; }
    }
    if (!egg) egg = new EggStandIn(g, { position: pos });
    this.egg = egg;
    egg.setGlow?.(0.2);
    return egg;
  }

  /** Build one egg out of sight behind the title so its shaders are compiled before the opening. */
  warm() {
    if (this.warmEgg || !this.EggClass) return;
    try {
      this.warmEgg = new this.EggClass(this.game, { position: new Vector3(0, -900, 0), float: false });
      this.warmEgg.precompile?.();
      this.warmEgg.group.visible = false;
    } catch (e) { this.warmEgg = null; }
  }

  removeEgg() {
    if (!this.egg) return;
    try { this.egg.dispose?.(); } catch (e) { /* already gone */ }
    if (this.egg.group?.parent) this.egg.group.parent.remove(this.egg.group);
    this.egg = null;
  }

  get eggPos() {
    return this.egg?.position || this.egg?.group?.position || this.center;
  }

  // ---- the guards --------------------------------------------------------------------------------------
  /** The given whales circle the egg at the surface, alternating directions. */
  guard(whales, radius = 46, place = true) {
    const B = this.story.herd?.behaviors;
    this.unguard();
    whales.forEach((w, i) => {
      w.docGuard = { a: (i / whales.length) * TAU, dir: i % 2 ? -1 : 1, r: radius + (i % 3) * 14, speed: 4.5 + (i % 2), alert: 0, target: null };
      if (place) {
        // already on their circle, heading along it
        const G = w.docGuard, c = this.center;
        _v.set(c.x + Math.cos(G.a) * G.r, 0, c.z + Math.sin(G.a) * G.r);
        _v.y = seaHeight(this.game, _v.x, _v.z) - w.radius * 0.35;
        w.place(_v, Math.atan2(-Math.sin(G.a) * G.dir, Math.cos(G.a) * G.dir), 0);
      }
      this.guards.push(w);
      if (B && B.RUN?.docGuard && w.beh) B.start(w, 'docGuard', Infinity);
    });
  }

  unguard() {
    const B = this.story.herd?.behaviors;
    for (const w of this.guards) {
      w.docGuard = null;
      if (B && w.beh && w.beh.type === 'docGuard') B.end(w);
    }
    this.guards.length = 0;
  }

  _guardStep(w, st, dt, B) {
    const G = w.docGuard;
    if (!G || !this.on) return false;
    const c = this.eggPos;
    let speed = G.speed;
    if (G.target && G.target.state === 'approach') {
      // break from the circle to drive the predator off
      _v.copy(G.target.pos);
      _v.y = Math.max(_v.y, this.eyeY() - w.radius * 0.6);
      speed = 11;
    } else {
      G.target = null;
      G.a += (G.dir * G.speed / G.r) * dt;
      _v.set(c.x + Math.cos(G.a) * G.r, 0, c.z + Math.sin(G.a) * G.r);
      // backs just out of the water, as resting humpbacks circle
      _v.y = seaHeight(this.game, _v.x, _v.z) - w.radius * 0.35;
    }
    B._steer(w, _v, speed, dt, 6, speed * 0.6, 1.0, 0.6);
    if (w.pos.y < this.eyeY()) B.ballast?.(w, _v.y, dt, 0.6);
    w.drive.lookAt = G.target ? G.target.pos : c;
    return true;
  }

  // ---- predators ------------------------------------------------------------------------------------------
  /**
   * A predator drawn by the egg's glow, approaching from bearing `angle` at distance `dist`.
   * kind: 'lanternjack' (underwater) or 'skimmer' (diving from the air).
   */
  spawnThreat(kind, angle, dist = 120, speed = null) {
    const S = this.story, eco = S.eco, c = this.eggPos;
    const t = {
      kind, pos: new Vector3(c.x + Math.cos(angle) * dist, 0, c.z + Math.sin(angle) * dist), vel: new Vector3(),
      state: 'approach', t: 0, speed: speed ?? (kind === 'skimmer' ? 9 : 4.2), school: null, glowT: 0,
    };
    t.pos.y = kind === 'skimmer' ? this.eyeY() + 60 : this.eyeY() - 5;
    try {
      if (kind === 'skimmer') t.school = eco?.addReptileFlock?.(t.pos.clone(), 'skimmer', 3, { anchor: t.pos, leash: 30, perch: false, roost: false }) || null;
      else t.school = eco?.addFishSchool?.(t.pos.clone(), 'lanternjack', 2, { anchor: t.pos, leash: 30 }) || null;
    } catch (e) { t.school = null; }
    this.threats.push(t);
    return t;
  }

  clearThreats() {
    const eco = this.story.eco;
    for (const t of this.threats) this._release(t, eco);
    this.threats.length = 0;
  }

  _release(t, eco) {
    if (!t.school) return;
    try {
      if (t.kind === 'skimmer') {
        // send the flock far away; the ecosystem prunes it later
        t.school.anchor = null;
        t.school.home?.set?.(t.pos.x * 3 - this.center.x * 2, 120, t.pos.z * 3 - this.center.z * 2);
      } else eco?.fish?.removeSchool?.(t.school);
    } catch (e) { /* the ecosystem changed */ }
    t.school = null;
  }

  /** Drive a predator off: it turns and flees from `from`. */
  repel(t, from, by = null) {
    if (t.state !== 'approach' && t.state !== 'strike') return false;
    t.state = 'flee';
    t.t = 0;
    _w.copy(t.pos).sub(from).setY(0);
    if (_w.lengthSq() < 1e-3) _w.set(1, 0, 0);
    _w.normalize();
    t.vel.copy(_w).multiplyScalar(t.kind === 'skimmer' ? 22 : 13);
    if (t.kind === 'skimmer') t.vel.y = 14;
    this.repelled++;
    this.repelledBy = by;
    this.story.eco?.scatter?.(t.pos, 20, 1.2);
    for (const w of this.guards) if (w.docGuard?.target === t) w.docGuard.target = null;
    return true;
  }

  onMove(e) {
    if (!this.threats.length) return;
    const big = e.name === 'slap' || e.name === 'breach' || e.name === 'splashdown' || e.name === 'diveBomb' || e.name === 'dash';
    if (!big) return;
    const r = e.name === 'dash' ? 16 : 34;
    const me = this.story.herd.calf;
    for (const t of this.threats) if (t.pos.distanceTo(e.pos) < r + me.L * 0.5) this.repel(t, e.pos, me);
  }

  /** The number of predators still closing in. */
  get approaching() {
    let n = 0;
    for (const t of this.threats) if (t.state === 'approach') n++;
    return n;
  }

  // ---- per frame -----------------------------------------------------------------------------------------
  update(dt) {
    this.egg?.update?.(dt);
    if (!this.threats.length) return;
    const S = this.story, g = this.game, c = this.eggPos, me = S.herd.calf;
    const booms = S.booms?.active || [];
    for (let i = this.threats.length - 1; i >= 0; i--) {
      const t = this.threats[i];
      t.t += dt;
      if (t.state === 'approach') {
        _v.copy(c).sub(t.pos);
        if (t.kind !== 'skimmer') _v.y = c.y - 1 - t.pos.y;
        const d = _v.length();
        // a lazy weave, as a hunter that is not yet sure
        _w.set(-_v.z, 0, _v.x).normalize().multiplyScalar(Math.sin(t.t * 0.9) * 0.4);
        t.vel.copy(_v).divideScalar(Math.max(d, 1e-3)).add(_w).multiplyScalar(t.speed * (d < 30 ? 1.3 : 1));
        if (d < 5) {
          t.state = 'strike';
          t.t = 0;
          this.strikes++;
          this.egg?.embryo?.kick?.();
          this.egg?.setGlow?.(0.35);
        }
        // any whale close by drives it off (the guards, the player)
        for (const w of this.guards) {
          if (w.pos.distanceTo(t.pos) < w.L * 0.6 + 8) { this.repel(t, w.pos, w); break; }
        }
        if (t.state === 'approach' && me.pos.distanceTo(t.pos) < me.L * 0.6 + 9) this.repel(t, me.pos, me);
        // a sonic boom's front reaching it
        for (const b of booms) {
          const front = Math.min(b.radius, b.t * (b.speed || 60)) + 6;
          if (b.center && b.center.distanceTo(t.pos) < front) { this.repel(t, b.center, b.source || me); break; }
        }
      } else if (t.state === 'strike') {
        // it circles the egg, nosing at it, until something drives it off
        t.vel.set(Math.cos(t.t * 1.4), 0, Math.sin(t.t * 1.4)).multiplyScalar(3);
        if (t.t > 2.5 && this.guards.length) {
          // the nearest guard comes for it
          let best = null, bd = Infinity;
          for (const w of this.guards) { const d = w.pos.distanceTo(t.pos); if (d < bd) { bd = d; best = w; } }
          if (best && best.docGuard) best.docGuard.target = t;
        }
        for (const w of this.guards) if (w.pos.distanceTo(t.pos) < w.L * 0.6 + 8) { this.repel(t, w.pos, w); break; }
        if (t.state === 'strike' && me.pos.distanceTo(t.pos) < me.L * 0.6 + 9) this.repel(t, me.pos, me);
        for (const b of booms) {
          if (b.center && b.center.distanceTo(t.pos) < Math.min(b.radius, b.t * (b.speed || 60)) + 6) { this.repel(t, b.center, b.source || me); break; }
        }
      } else {
        // fleeing: away, and gone
        t.vel.multiplyScalar(1 - Math.min(1, dt * 0.2));
        if (t.t > 6) {
          this._release(t, S.eco);
          this.threats.splice(i, 1);
          continue;
        }
      }
      t.pos.addScaledVector(t.vel, dt);
      if (t.kind !== 'skimmer') t.pos.y = Math.min(t.pos.y, seaHeight(g, t.pos.x, t.pos.z) - 1.5);
      else t.pos.y = Math.max(t.pos.y, seaHeight(g, t.pos.x, t.pos.z) + 2);
      // the hunter's lure, or a glint of wings (also stands in when the ecosystem is missing)
      if ((t.glowT += dt) > (t.school ? 0.35 : 0.08)) {
        t.glowT = 0;
        const E = this._em;
        E.pos.copy(t.pos);
        E.vel.set(0, t.kind === 'skimmer' ? 0 : 0.3, 0);
        E.color = t.kind === 'skimmer' ? WINGS : LURE;
        E.size = t.school ? 0.35 : 0.7;
        g.glow?.emit?.(E);
      }
    }
  }

  /** The nearest predator still closing in (for cameras and the autopilot). */
  nearestThreat(p) {
    let best = null, bd = Infinity;
    for (const t of this.threats) {
      if (t.state === 'flee') continue;
      const d = t.pos.distanceTo(p);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }
}

