// The hunt: the calf is a predator too. Told only through the world (no HUD, no score):
//  - the bite (B, gamepad B, a single tap): a quick lunge forward with the jaws flung wide, then a
//    powerful snap; whatever is in the jaws is eaten (eco.biteAt: fish up to lanternjacks, skimmers
//    and coilwings caught in the air, puffers, jellies, eels; never mantas or whales; bugs go in
//    by the open mouth's suction), with the gulp, a crunch and energy. A short cooldown.
//  - hostility: lunging puts the calf in a hunting mood that fades over some seconds. While it
//    lasts, prey fears it (eco.fleeFrom): schools bolt and bait balls tighten, birds flush,
//    puffers inflate, eels dart. Lanternjacks under the sea and skimmers in the air may fight back
//    (one at a time, rarely): a hit makes the calf flinch and costs a little energy, never more.
//    The calf drives them off with a bite (or eats them); after a hit the mother calls and her
//    warning drives the attacker off. No fail state.
// Activities creates it (new Hunt(game, story, activities)) and calls update(dt, playing).
import { Vector3 } from 'three';
import { clamp } from '../core/math.js';
import { seaHeight } from './Swim.js';

const COOLDOWN = 0.8;
const LUNGE = 0.55; // s, the whole lunge
const SNAP_AT = 0.2; // s into the lunge, the jaws shut

const _v = new Vector3();
const _dir = new Vector3();

export class Hunt {
  constructor(game, story, activities) {
    this.game = game;
    this.story = story;
    this.act = activities;
    this.t = -1; // time into the current lunge (-1: none)
    this.snapped = false;
    this.cool = 0;
    /** 0..1 the hunting mood: lunges raise it, it fades; prey fears it, some fight back. */
    this.hunting = 0;
    this.fearT = 0;
    this.helpT = -1;
    this.hits = 0;
    this.bites = 0;
    this.caught = { fish: 0, lanternjack: 0, skimmer: 0, coilwing: 0, puffer: 0, jelly: 0, eel: 0 };
    this.lastKind = '';
    this.mouth = new Vector3();
    /** What eco.hunter sees (pos follows the calf). */
    this.hunter = { pos: new Vector3(), up: new Vector3(0, 1, 0), L: 8, hunting: 0, under: false };
    this._onHit = (kind, pos, k) => this.onHit(kind, pos, k);
    this._eco = null;
  }

  get calf() { return this.story?.herd?.calf; }

  reset() {
    this.t = -1;
    this.cool = 0;
    this.hunting = 0;
    this.helpT = -1;
    if (this._eco && this._eco.hunter === this.hunter) this._eco.hunter = null;
  }

  /** Start a lunge (the bite key; tests call it directly). Returns false while cooling down. */
  bite() {
    const calf = this.calf;
    if (!calf || this.cool > 0 || this.t >= 0) return false;
    this.t = 0;
    this.snapped = false;
    this.cool = COOLDOWN;
    this.bites++;
    this.hunting = Math.min(1, this.hunting + 0.45);
    // the lunge: a burst forward, nudged toward prey right ahead
    const eco = this.story.eco;
    _dir.copy(calf.fwd);
    const n = eco?.nearestSwarm?.(calf.pos);
    if (n && n.pos) {
      _v.copy(n.pos).sub(calf.pos);
      const d = _v.length();
      if (d > 0.1 && d < calf.L * 2.5 + (n.radius || 0) && _v.dot(calf.fwd) > d * 0.55) _dir.addScaledVector(_v.divideScalar(d), 0.5).normalize();
    }
    calf.vel.addScaledVector(_dir, 7 + calf.L * 0.35);
    calf.energy = Math.max(0, calf.energy - 0.01);
    calf.anim.lunge?.(1);
    calf.drive.excite = 1;
    this.story.audio?.sfx?.('whoosh', { position: calf.pos, gain: 0.35 });
    return true;
  }

  update(dt, playing) {
    const g = this.game, st = this.story, calf = this.calf;
    if (!calf) return;
    const eco = st.eco;
    if (eco !== this._eco) { this._eco = eco; if (eco) eco.onHit = this._onHit; }
    this.cool = Math.max(0, this.cool - dt);
    const inp = g.input;
    if (playing && st.player?.enabled && inp?.bitePressed) this.bite();
    this.mouth.copy(calf.pos).addScaledVector(calf.fwd, calf.L * 0.48);
    // the lunge: jaws wide, then the snap
    if (this.t >= 0) {
      this.t += dt;
      if (!this.snapped) {
        calf.drive.mouth = 1;
        calf.drive.feed = Math.max(calf.drive.feed, 1);
        calf.vel.addScaledVector(calf.fwd, 10 * dt);
        if (this.t >= SNAP_AT) { this.snapped = true; this._snap(calf); }
      }
      if (this.t >= LUNGE) this.t = -1;
    }
    // the hunting mood fades; prey fears the calf while it lasts
    this.hunting = Math.max(0, this.hunting - dt * 0.08);
    const H = this.hunter;
    H.pos.copy(calf.pos);
    H.up.copy(calf.up);
    H.L = calf.L;
    H.hunting = this.hunting;
    H.under = calf.pos.y < seaHeight(g, calf.pos.x, calf.pos.z) - 1;
    if (eco) eco.hunter = playing && this.hunting > 0.05 ? H : null;
    if (eco && playing && this.hunting > 0.1) {
      this.fearT -= dt;
      if (this.fearT <= 0) {
        this.fearT = 0.3;
        _v.copy(this.mouth).addScaledVector(calf.fwd, calf.L * 0.3);
        eco.fleeFrom(_v, 10 + 18 * this.hunting, 0.6 + 0.6 * this.hunting);
      }
    }
    // the mother's warning after a hit: a deep call and every attacker near the calf flees
    if (this.helpT >= 0) {
      this.helpT -= dt;
      if (this.helpT < 0 && eco) eco.fleeFrom(calf.pos, 45, 2);
    }
  }

  /** The jaws shut: eat what is in them. */
  _snap(calf) {
    const g = this.game, st = this.story, eco = st.eco, act = this.act;
    calf.anim.snap?.(1.4);
    g.cameraRig?.addShake?.(0.08);
    _v.copy(this.mouth).addScaledVector(calf.fwd, calf.L * 0.1);
    const B = eco?.biteAt ? eco.biteAt(_v, calf.L * 0.2 + 0.9, calf) : null;
    const a = st.audio;
    if (B && B.food > 0) {
      const big = B.jacks > 0 || B.birds > 0;
      this.lastKind = B.kind;
      if (B.kind in this.caught) this.caught[B.kind] += Math.max(1, B.fish + B.jacks + B.birds + B.reef);
      calf.energy = Math.min(1, calf.energy + Math.min(0.3, 0.04 + B.food * 0.03));
      calf.drive.happy = Math.max(calf.drive.happy, 0.9);
      // the swallow follows a beat later (Activities' eating: gulp, chew, contented coo)
      if (act) {
        act.morsel += big ? 1 : Math.min(1, 0.4 + B.food * 0.1);
        act.biteT = g.time;
        act.joy += big ? 0.25 : 0.1;
      } else calf.anim.gulp?.(1);
      a?.sfx?.('gulp', { position: _v, gain: big ? 1 : 0.8, pitch: big ? 0.8 : 1 });
      if (big) a?.sfx?.('bonk', { position: _v, gain: 0.5 });
      // the bite itself is a scare
      eco.fleeFrom(_v, 18, 1.2);
    } else {
      // a miss: the jaws clap on water or air
      a?.sfx?.('bonk', { position: _v, gain: 0.25 });
      if (eco) eco.fleeFrom(_v, 14, 1);
    }
  }

  /** A lanternjack or skimmer struck the calf: a flinch, a little energy, the mother comes. */
  onHit(kind, pos, k = 0.5) {
    const g = this.game, st = this.story, calf = this.calf;
    if (!calf || st.state !== 'play') return;
    this.hits++;
    _dir.copy(calf.pos).sub(pos);
    calf.anim.bump?.(_dir, 0.7 + k);
    calf.anim.flinch?.(0.6);
    calf.anim.delightT = 9; // no smile after this bump
    calf.vel.addScaledVector(_dir.normalize(), 3);
    calf.energy = Math.max(0.1, calf.energy - 0.03);
    st.audio?.sfx?.('bonk', { position: pos, gain: 0.6 });
    g.cameraRig?.addShake?.(0.18);
    st.voiceCall?.(calf, 'chirp');
    // startled: the hunting mood drops (attacks get rarer); the mother answers and drives it off
    this.hunting *= 0.6;
    const mom = st.herd?.mother;
    if (mom && mom.pos.distanceTo(calf.pos) < 220) {
      this.act?.schedule?.(mom, 0.35, 'answer');
      this.helpT = 0.8;
    } else this.helpT = 1.6;
    void kind;
  }
}
