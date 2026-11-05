// Friends (docs/VUR_SOK.md 0.11, "play with friends too"): the playmate calves of the herd play with
// you, and a friend on the same machine can drop in as one of them. All wordless.
//
// FRIENDS IN THE HERD (the playmate calves, src/game/Herd.js CALVES):
//  - a greeting at each chapter start: one or two friends swim up, chirp, spin and bump you, the
//    more exuberant the more you have played together (they remember: `friendship` per calf);
//  - group tag among the sea stacks (2-3 friends): one swims up, wiggles and taps you, and they
//    scatter around a stack (or along the route), glancing back; touch one and it squeals and turns
//    to chase you; a touch swaps who is it (a player or a friend) until everyone is out of breath;
//  - follow the leader: a friend leads a weaving, dipping, rolling path; flying through its wake
//    rings soft chimes that climb with the streak; stick with it to the end for a happy finish;
//  - the breach contest: two friends dive and leap one after the other; then it is your turn: a
//    breach higher than theirs and the herd cheers (adults call out, the friends roll), a lower one
//    gets happy chirps anyway.
// Something with friends every ~55-85 s of free flight in ACT I, never during the mother's lessons,
// races, cinematics, songs, storms, the falcon or the feast. A game claims its calves through
// c.play = { mode: 'friends' } (the herd leaves calves with a play mode alone) and lets go after.
//
// LOCAL CO-OP: press Start or A on a second gamepad, or any key of the keyboard's right half (I J K L
// U O ...; src/core/Input.js SecondInput), to take the playmate calf nearest to you. It flies with
// its own PlayerController and Moves (all the moves), hums (its voice sings, pitch from its nose),
// gathers a sonic boom, bites, and plays the friends' games. Back on the pad or Backspace hands it
// back to the herd. The camera widens to keep both calves in frame (Story.updateCalf calls
// camera(opts)); the story waits for neither: player two is a passenger on a soft leash to player
// one (pulled back past ~70 m, brought back unseen if lost far away). Only in ACT I play; cinematics
// and other acts hand the calf to the AI for the moment.
//
// Activities creates it (new Friends(game, story, activities)) and calls update(dt) and reset().
// Testing: ?coop spawns player two on a scripted input; friends.start('greet' | 'tag' | 'follow' |
// 'breach') forces a game; friends.join('script') / leave(); `.log` and `.stats` show what happened.
import { Vector3 } from 'three';
import { clamp, lerp, smoothstep, TAU, wrapAngle } from '../core/math.js';
import { Script } from './Script.js';
import { seaHeight } from './Swim.js';
import { PlayerController } from './PlayerController.js';
import { fx } from '../fx/FX.js';

const FREE = new Set(['cradle', 'valleys', 'krill', 'forest', 'song', 'night', 'oasis']);
const _v = new Vector3();
const _v2 = new Vector3();

export class Friends {
  constructor(game, story, act) {
    this.game = game;
    this.story = story;
    this.act = act;
    this.script = new Script();
    this.cur = null; // the game in progress
    this.cd = 45;
    this.order = ['tag', 'follow', 'breach'];
    this.next = 0;
    this.greetCh = -1;
    this.greetAt = -1;
    this.friendship = new Map();
    this.claimed = [];
    this.stats = { greet: 0, tag: 0, follow: 0, breach: 0, tags: 0, crumbs: 0, cheers: 0, joins: 0, leaves: 0, p2bites: 0, p2hums: 0 };
    this.log = [];
    this.p2 = null;
    this._mid = new Vector3();
    this._course = [];
    for (let i = 0; i < 8; i++) this._course.push(new Vector3());
    this._so = { arrive: 6, minSpeed: 0, pitchGain: 1, maxPitch: 0.75, sepScale: 0.45, touch: null };
    this._lastP1 = new Vector3();
    this._lessonWas = false;
    const p = game.params;
    this.coopParam = game.debug && p?.has?.('coop') ? (p.get('coop') || 'auto') : null;
    this._coopTried = false;
    // a scripted second player for headless tests (?coop)
    this._sin = {
      enabled: true, swim: 0, brake: 0, surge: false, turn: 0, climb: 0, lookX: 0, lookY: 0, stickLookX: 0, stickLookY: 0,
      rollLeftPressed: false, rollRightPressed: false, rollHeld: false, hum: false, boom: false,
      slapPressed: false, spoutPressed: false, loopPressed: false, dashPressed: false, bitePressed: false,
    };
    story?.player?.moves?.on((e) => this.onMove(e, this.herd?.calf, story.player.moves));
  }

  get herd() { return this.story?.herd; }

  note(s) {
    this.log.push(`${this.game.time.toFixed(1)} ${s}`);
    if (this.log.length > 80) this.log.shift();
  }

  reset() {
    if (this.cur) this.stop('reset');
    this.cd = 45;
    this.greetAt = -1;
    if (this.p2) this.p2.pc.syncAim();
  }

  // ---- per frame (Activities.update, before the herd steps) -----------------------------------
  update(dt) {
    const herd = this.herd;
    if (!herd) return;
    this._coop(dt);
    this._games(dt);
  }

  // ======================================================================================
  // LOCAL CO-OP
  // ======================================================================================
  /** Is player two flying its calf right now (not handed to the AI for a cinematic)? */
  get p2Live() { return !!(this.p2 && this.p2.w.play && this.p2.w.play.mode === 'p2'); }

  /** The calves the players fly: player one's, and player two's while live. */
  players() {
    const out = this._pl || (this._pl = []);
    out.length = 0;
    out.push(this.herd.calf);
    if (this.p2Live) out.push(this.p2.w);
    return out;
  }

  _coop(dt) {
    const S = this.story, g = this.game, herd = this.herd;
    const inp = g.input?.p2;
    if (!this.p2) {
      if (S.state !== 'play' || S.act !== 1) return;
      if (inp && inp.joinPad >= 0) this.join('pad', inp.joinPad);
      else if (inp && inp.keysUsed) this.join('keys');
      else if (this.coopParam && !this._coopTried) { this._coopTried = true; this.join('script'); }
      return;
    }
    const P = this.p2, w = P.w;
    if (P.src !== 'script' && inp && (inp.leavePressed || (P.src === 'pad' && inp.padIndex < 0))) { this.leave(); return; }
    const live = S.state === 'play' && S.act === 1 && !S.cine?.active;
    if (!live) {
      // a cinematic, the pause, another act: the herd carries the calf for the moment
      if (w.play && w.play.mode === 'p2') w.play = null;
      if (P.humming) this._hum(false);
      P.pc.enabled = false;
      return;
    }
    if (!w.play || w.play.mode !== 'p2') {
      herd.behaviors?.end?.(w);
      w.play = { mode: 'p2', t: 0 };
      P.pc.syncAim();
    }
    if (w.beh) w.beh.copyT = 1e9; // the calves copy player one's rolls; this one is player two's
    P.pc.enabled = true;
    P.t += dt;
    if (P.src === 'script') this._scripted(dt);
    // the abilities a newborn learns (src/game/Abilities.js) are player one's calf's: the friend's
    // calf already has its whole voice and every move (and a locked one would squeak P1's calf)
    const A0 = S.abilities;
    S.abilities = null;
    try { P.pc.update(dt); } finally { S.abilities = A0; }
    // the air lines stay with player one (player two's moves would take them over)
    const m1 = S.player?.moves;
    if (g.engine && m1) fx(g).wind.track(herd.calf, m1.zone, 0);
    if (P.humming) {
      const midi = this._humMidi(P.pc.aimPitch);
      if (midi !== P.midi) { P.midi = midi; S.voiceOf(w).bend?.(midi); }
    }
    this._bite(dt);
    this._leash(dt);
  }

  /** Player two takes the playmate calf nearest player one. */
  join(src = 'keys', padIndex = -1) {
    const S = this.story, g = this.game, herd = this.herd;
    if (this.p2 || !herd) return false;
    const calf = herd.calf;
    let w = null, bd = Infinity;
    for (const c of herd.calves) {
      if (c.beh && c.beh.netI >= 0) continue;
      const d = c.pos.distanceTo(calf.pos) + (c.play && c.play.mode ? 60 : 0);
      if (d < bd) { bd = d; w = c; }
    }
    if (!w) return false;
    if (this.act?.race && this.act.race.mate === w) this.act.endRace(false);
    if (this.cur && this.claimed.includes(w)) this.stop('p2');
    herd.behaviors?.end?.(w);
    w.play = { mode: 'p2', t: 0 };
    const pc = new PlayerController(g, w);
    pc.input = src === 'script' ? this._sin : g.input.p2;
    pc.enabled = true;
    pc.syncAim();
    if (src === 'pad' && padIndex >= 0) g.input.p2.padIndex = padIndex;
    const P = this.p2 = { w, pc, src, t: 0, humming: false, midi: 0, biteT: -1, snapped: false, cool: 0, apex: 0 };
    pc.on('hum', () => this._hum(true));
    pc.on('humEnd', () => this._hum(false));
    pc.on('roll', () => S.voiceCall(w, 'play'));
    pc.on('boom', (e) => this._boom(e));
    pc.moves.on((e) => this.onMove(e, w, pc.moves));
    // the friend's calf shows itself: a spin and a chirp
    w.barrelRoll(1);
    w.anim.gesture?.('happyWiggle');
    S.voiceCall(w, 'play');
    w.drive.happy = 1;
    this.stats.joins++;
    this.note(`p2 joins (${src}) as ${w.name}`);
    void P;
    return true;
  }

  /** Player two leaves: the calf goes back to its parent's side. */
  leave() {
    const P = this.p2, S = this.story, g = this.game;
    if (!P) return;
    if (P.humming) this._hum(false);
    this.p2 = null;
    const w = P.w;
    P.pc.moves.reset?.();
    if (w.play && w.play.mode === 'p2') w.play = null;
    if (w.beh) w.beh.copyT = -1;
    if (g.input?.p2) g.input.p2.padIndex = -1;
    S.voiceCall(w, 'coo');
    this.stats.leaves++;
    this.note('p2 leaves');
  }

  _humMidi(aimPitch) {
    const k = this.story.song?.key?.() || { rootMidi: 62, scale: [0, 2, 4, 5, 7, 9, 11] };
    const deg = Math.round(clamp((aimPitch + 0.6) * 5, 0, 9));
    return k.rootMidi + 12 + k.scale[deg % 7] + 12 * Math.floor(deg / 7);
  }

  /** Player two's hum: its own voice sings, nose up for higher; nearby friends chirp along. */
  _hum(on) {
    const P = this.p2, S = this.story;
    if (!P) return;
    const w = P.w, v = S.voiceOf(w);
    if (on) {
      P.humming = true;
      P.midi = this._humMidi(P.pc.aimPitch);
      if (v.sing) v.sing(P.midi, { gain: 0.9, glideFrom: P.midi - 2 });
      else v.hum?.(P.midi, undefined, { gain: 0.9, glideFrom: P.midi - 2 });
      w.drive.hum = 1;
      S.humTimers?.set(w, 99);
      w.drive.happy = Math.max(w.drive.happy, 0.5);
      this.stats.p2hums++;
      for (const c of this.herd.calves) if (c !== w && c.pos.distanceTo(w.pos) < 60 && Math.random() < 0.6) this.act?.schedule?.(c, 0.5 + Math.random() * 0.6, 'chirp');
    } else {
      P.humming = false;
      v.release?.(0.35);
      S.humTimers?.set(w, 0.05);
    }
  }

  _boom(e) {
    const P = this.p2, S = this.story;
    if (!P) return;
    const w = P.w;
    const pos = w.pos.clone().addScaledVector(w.fwd, w.L * 0.6);
    const b = S.booms?.spawn?.(pos, { power: e.power, radius: 16 + 26 * e.power, source: w });
    S.voiceCall(w, 'roar');
    S.audio?.sfx?.('boomSmall', { position: pos, gain: 0.5 + e.power * 0.5 });
    S.eco?.scatter?.(pos, 30 + 40 * e.power, e.power);
    if (b) b.knockFalcon = 0.5 + e.power * 0.6;
  }

  /** Player two's bite: the same lunge and snap as the hunt's (src/game/Hunt.js), on its calf. */
  _bite(dt) {
    const P = this.p2, S = this.story, g = this.game, w = P.w, inp = P.pc.input;
    P.cool = Math.max(0, P.cool - dt);
    if (P.pc.enabled && inp.bitePressed && P.cool <= 0 && P.biteT < 0) {
      P.biteT = 0;
      P.snapped = false;
      P.cool = 0.8;
      w.vel.addScaledVector(w.fwd, 7 + w.L * 0.35);
      w.anim.lunge?.(1);
      w.drive.excite = 1;
      S.audio?.sfx?.('whoosh', { position: w.pos, gain: 0.3 });
    }
    if (P.biteT < 0) return;
    P.biteT += dt;
    if (!P.snapped) {
      w.drive.mouth = 1;
      w.drive.feed = 1;
      w.vel.addScaledVector(w.fwd, 10 * dt);
      if (P.biteT >= 0.2) {
        P.snapped = true;
        this.stats.p2bites++;
        w.anim.snap?.(1.4);
        _v.copy(w.pos).addScaledVector(w.fwd, w.L * 0.58);
        const eco = S.eco;
        const B = eco?.biteAt ? eco.biteAt(_v, w.L * 0.2 + 0.9, w) : null;
        if (B && B.food > 0) {
          w.anim.gulp?.(Math.min(1.3, 0.5 + B.food * 0.1));
          w.energy = Math.min(1, w.energy + Math.min(0.3, 0.04 + B.food * 0.03));
          w.drive.happy = 1;
          S.audio?.sfx?.('gulp', { position: _v, gain: 0.8 });
          eco.fleeFrom?.(_v, 18, 1.2);
        } else {
          S.audio?.sfx?.('bonk', { position: _v, gain: 0.2 });
          eco?.fleeFrom?.(_v, 14, 1);
        }
        g.cameraRig?.addShake?.(0.03);
      }
    }
    if (P.biteT >= 0.55) P.biteT = -1;
  }

  /** The soft leash: player two roams freely near player one; far out it is drawn back. */
  _leash(dt) {
    const P = this.p2, w = P.w, c1 = this.herd.calf;
    const d = w.pos.distanceTo(c1.pos);
    if (d > 70) {
      _v.copy(c1.pos).sub(w.pos).divideScalar(d);
      w.vel.addScaledVector(_v, clamp((d - 70) * 0.05, 0, 14) * dt);
      // past 110 m the nose turns home too
      if (d > 110) P.pc.aimYaw += wrapAngle(Math.atan2(_v.x, _v.z) - P.pc.aimYaw) * Math.min(1, dt * 0.8);
    }
    if (d > 420) {
      // lost (a cut, a storm gust): back in the herd behind player one, out of frame
      w.pos.copy(c1.pos).addScaledVector(c1.fwd, -24).addScaledVector(c1.right, 10);
      w.pos.y = Math.max(w.pos.y, this.herd.floorY(w, w.pos.x, w.pos.z));
      w.vel.copy(c1.vel);
      w._syncTransform?.();
      P.pc.syncAim();
      this.note('p2 brought back');
    }
  }

  /** The camera widens and leans to keep both calves in frame (Story.updateCalf, before follow). */
  camera(opts) {
    if (!this.p2Live) return;
    const c1 = this.herd.calf, w = this.p2.w;
    const d = w.pos.distanceTo(c1.pos);
    const k = smoothstep(8, 70, d);
    if (!opts.lookBias) {
      this._mid.copy(c1.pos).lerp(w.pos, 0.5);
      opts.lookBias = this._mid;
      opts.lookBiasW = 0.15 + 0.4 * k;
      opts.lookBiasMax = Math.max(2, d * 0.5);
    }
    opts.extraDist = (opts.extraDist || 0) + clamp(d * 0.45, 0, 38);
    opts.extraHeight = (opts.extraHeight || 0) + clamp(d * 0.1, 0, 8);
  }

  /** ?coop: player two on a scripted input, weaving around player one and using everything. */
  _scripted(dt) {
    const I = this._sin, P = this.p2, w = P.w, c1 = this.herd.calf, pc = P.pc, t = P.t;
    I.rollLeftPressed = I.rollRightPressed = I.slapPressed = I.spoutPressed = I.loopPressed = I.dashPressed = I.bitePressed = false;
    // a game target first (a friend to tag, the leader's wake), else weave around player one
    const goal = this._p2Goal || _v2.copy(c1.pos).addScaledVector(c1.right, 14 + 20 * Math.sin(t * 0.25)).addScaledVector(c1.fwd, 6 * Math.cos(t * 0.4));
    if (!this._p2Goal) goal.y += 4 * Math.sin(t * 0.33);
    _v.copy(goal).sub(w.pos);
    const d = _v.length();
    const err = wrapAngle(Math.atan2(_v.x, _v.z) - pc.aimYaw);
    I.turn = clamp(-err * 2, -1, 1);
    I.climb = clamp((Math.asin(clamp(_v.y / Math.max(d, 1), -1, 1)) - pc.aimPitch) * 3, -1, 1);
    I.swim = d > 6 ? 1 : 0.35;
    I.surge = d > 45;
    const tick = (period, at = 0) => Math.floor((t - at) / period) !== Math.floor((t - at - dt) / period);
    if (tick(6.1)) { if (Math.random() < 0.5) I.rollLeftPressed = true; else I.rollRightPressed = true; }
    if (tick(5.3, 1)) I.bitePressed = true;
    if (tick(7.7, 2)) I.slapPressed = true;
    if (tick(11.3, 3)) I.spoutPressed = true;
    I.hum = (t % 9) > 7.4;
  }

  // ======================================================================================
  // FRIENDS' GAMES
  // ======================================================================================
  free() {
    const S = this.story, herd = this.herd, g = this.game, A = this.act;
    if (S.state !== 'play' || S.act !== 1 || S.cine?.active) return false;
    if (herd.mode !== 'travel' || herd.motherScript || herd.songCenter || herd.protectCenter || herd.behaviors?.net) return false;
    if (A?.race || A?.lessons?.cur) return false;
    if (S.song?.active || S.song?.listening || S.feastInvite) return false;
    if ((g.timeScaleTarget ?? 1) !== 1 || (S.weather?.level ?? 0) > 0.3) return false;
    const now = g.time;
    if (A && (now - A.lastCatch < 3 || (A.hunt && A.hunt.t >= 0) || A.bugs?.mouthWant > 0)) return false;
    const N = S.needs;
    if (N && (N.lead || N.nurse)) return false;
    const ch = S.path?.chapters[S.chapterIndex];
    if (!ch || !FREE.has(ch.id)) return false;
    const nx = S.path.chapters[S.chapterIndex + 1];
    if (nx && herd.s > nx.start - 240) return false;
    return true;
  }

  /** Up to n friends free to play, nearest player one first. */
  friends(n) {
    const herd = this.herd, calf = herd.calf;
    const out = [];
    for (const c of herd.calves) {
      if ((c.play && c.play.mode) || (c.beh && c.beh.netI >= 0)) continue;
      if (c.pos.distanceTo(calf.pos) > 220) continue;
      out.push(c);
    }
    out.sort((a, b) => a.pos.distanceTo(calf.pos) - b.pos.distanceTo(calf.pos));
    return out.slice(0, n);
  }

  _claim(c) {
    this.herd.behaviors?.end?.(c);
    c.play = { mode: 'friends', t: 0 };
    this.claimed.push(c);
  }

  _releaseAll() {
    for (const c of this.claimed) if (c.play && c.play.mode === 'friends') c.play = null;
    this.claimed.length = 0;
  }

  _steer(c, target, speed, dt, arrive = 6, minSpeed = 0, touch = null) {
    const o = this._so;
    o.arrive = arrive;
    o.minSpeed = minSpeed;
    o.touch = touch;
    _v2.copy(target);
    _v2.y = Math.max(_v2.y, seaHeight(this.game, _v2.x, _v2.z) - 9);
    return this.herd.steer(c, _v2, speed, dt, o);
  }

  _touching(a, b) { return a.pos.distanceTo(b.pos) < a.radius + b.radius + 1.8; }

  _bond(c, k = 1) { this.friendship.set(c, (this.friendship.get(c) || 0) + k); }

  _games(dt) {
    const S = this.story, g = this.game, herd = this.herd, A = this.act;
    const calf = herd.calf;
    const jumped = calf.pos.distanceTo(this._lastP1) > 60;
    this._lastP1.copy(calf.pos);
    // a lesson just ended: give the mother's lesson a moment before the friends come
    const lc = !!A?.lessons?.cur;
    if (this._lessonWas && !lc) this.cd = Math.max(this.cd, 20);
    this._lessonWas = lc;
    if (this.cur) {
      this.cur.t += dt;
      const lost = this.claimed.some((c) => !c.play || c.play.mode !== 'friends');
      const why = S.state !== 'play' && S.state !== 'paused' ? 'state' : S.cine?.active ? 'cinematic' : herd.mode !== 'travel' ? 'mode'
        : jumped ? 'cut' : lost ? 'taken' : herd.motherScript && !this.cur.momOk ? 'mother' : this.cur.t > 90 ? 'long' : null;
      if (why) { this.stop(why); return; }
      if (S.state === 'paused') return;
      if (A) A.raceCd = Math.max(A.raceCd, 15);
      this.script.update(dt);
      if (this.cur && !this.script.tasks.length) this.stop('done');
      return;
    }
    this._p2Goal = null;
    // friends remember you: they come to greet you as each chapter begins
    if (S.state === 'play' && S.act === 1 && S.chapterIndex !== this.greetCh && S.chapterIndex >= 0) {
      this.greetCh = S.chapterIndex;
      this.greetAt = g.time + 4 + Math.random() * 3;
    }
    if (this.greetAt > 0 && g.time > this.greetAt) {
      if (this.free() && this.start('greet')) this.greetAt = -1;
      else if (g.time > this.greetAt + 25) this.greetAt = -1;
      return;
    }
    if (!this.free()) return;
    this.cd -= dt;
    if (this.cd > 0) return;
    for (let k = 0; k < this.order.length; k++) {
      const kind = this.order[(this.next + k) % this.order.length];
      if (this.start(kind)) { this.next = (this.next + k + 1) % this.order.length; return; }
    }
    this.cd = 8;
  }

  /** Start a game now (tests may call it). False when there are not enough friends or room. */
  start(kind) {
    const S = this.story, herd = this.herd;
    if (this.cur || S.state !== 'play' || !herd) return false;
    const calf = herd.calf;
    const need = kind === 'tag' ? 2 : kind === 'breach' ? 2 : 1;
    const fs = this.friends(kind === 'tag' ? 3 : kind === 'follow' ? 1 : 2);
    if (fs.length < need) return false;
    if (kind === 'breach') {
      // over the open sea, low enough to dive and leap
      const sea = seaHeight(this.game, calf.pos.x, calf.pos.z);
      if (calf.pos.y - sea > 60) return false;
    }
    const G = { kind, t: 0, fs, momOk: false };
    const gen = kind === 'greet' ? this._greet(G) : kind === 'tag' ? this._tag(G) : kind === 'follow' ? this._follow(G) : kind === 'breach' ? this._breach(G) : null;
    if (!gen) return false;
    for (const c of fs) this._claim(c);
    this.cur = G;
    this.stats[kind]++;
    this.script.run(gen, kind);
    this.note(`start ${kind} with ${fs.map((c) => c.name).join(' ')}`);
    return true;
  }

  stop(why = 'done') {
    const G = this.cur;
    if (!G) return;
    this.cur = null;
    this.script.cancel();
    this._releaseAll();
    this._p2Goal = null;
    this.cd = why === 'done' ? lerp(55, 85, Math.random()) : lerp(20, 35, Math.random());
    this.note(`end ${G.kind} (${why})`);
  }

  /** Moves of either player (Moves.js events): the breach contest listens for leaps. */
  onMove(e, w, moves) {
    const G = this.cur;
    if (!G || G.kind !== 'breach' || !G.turn || !w) return;
    const sea = seaHeight(this.game, w.pos.x, w.pos.z);
    if (e.name === 'breach') {
      G.leaps.set(w, { apex: w.pos.y - sea, moves });
      w.drive.happy = 1;
    } else if (e.name === 'splashdown') {
      const L = G.leaps.get(w);
      if (L) { G.leaps.delete(w); G.landed.push({ w, apex: L.apex }); }
    }
  }

  // ---- a greeting ------------------------------------------------------------------------------
  *_greet(G) {
    const S = this.story, herd = this.herd, calf = herd.calf, A = this.act;
    const fs = G.fs;
    fs.forEach((c, i) => this.act?.schedule?.(c, 0.2 + i * 0.5, 'chirp'));
    const done = new Set();
    let t = 0;
    while (t < 12 && done.size < fs.length) {
      const dt = yield 0;
      t += dt;
      const cs = calf.vel.length();
      fs.forEach((c, i) => {
        const side = i === 0 ? 1 : -1;
        _v.copy(calf.pos).addScaledVector(calf.right, side * (c.radius + calf.radius + 2.2)).addScaledVector(calf.fwd, 2).addScaledVector(calf.vel, 0.4);
        const d = this._steer(c, _v, cs + 5 + c.pos.distanceTo(_v) * 0.15, dt, 3, cs * 0.6, calf);
        c.drive.lookAt = calf.pos;
        c.drive.excite = 1;
        if (!done.has(c) && d < 6) {
          done.add(c);
          // hello: the more you have played, the bigger it is
          const f = this.friendship.get(c) || 0;
          S.voiceCall(c, f > 2 ? 'play' : 'chirp');
          c.anim.gesture?.('happyWiggle');
          c.barrelRoll(side);
          if (f > 1) { _v.copy(calf.pos).sub(c.pos).normalize(); calf.anim.bump?.(_v, 0.35); }
          c.drive.happy = 1;
        }
      });
    }
    calf.drive.happy = 1;
    if (A) A.joy += 0.3;
    if (done.size) this.act?.schedule?.(calf, 0.6, 'chirp');
    // a moment side by side, then back to their parents
    t = 0;
    while (t < 3) {
      const dt = yield 0;
      t += dt;
      fs.forEach((c, i) => {
        _v.copy(calf.pos).addScaledVector(calf.right, (i === 0 ? 1 : -1) * (c.radius + calf.radius + 4)).addScaledVector(calf.vel, 0.4);
        this._steer(c, _v, calf.vel.length() + 2, dt, 6, 0, calf);
      });
    }
    for (const c of fs) this._bond(c, 0.5);
  }

  // ---- group tag -------------------------------------------------------------------------------
  /** A weaving course around a sea stack near player one, or zigzags along the route ahead. */
  _courseAround() {
    const S = this.story, herd = this.herd, calf = herd.calf, C = this._course;
    let stack = null, bd = 240;
    for (const isl of S.world?.islands || []) {
      if (!isl.pos || isl.R > 70 || (isl.H ?? 0) < 20) continue;
      const d = Math.hypot(isl.pos.x - calf.pos.x, isl.pos.z - calf.pos.z) - isl.R;
      if (d < bd) { bd = d; stack = isl; }
    }
    if (stack) {
      const R = stack.R + 12;
      const a0 = Math.atan2(calf.pos.z - stack.pos.z, calf.pos.x - stack.pos.x);
      for (let i = 0; i < C.length; i++) {
        const a = a0 + (i + 1) * (TAU / 6);
        const p = C[i].set(stack.pos.x + Math.cos(a) * (R + (i % 2) * 8), 0, stack.pos.z + Math.sin(a) * (R + (i % 2) * 8));
        p.y = herd.floorY(calf, p.x, p.z) + 3 + (i % 3) * 6;
      }
      return C;
    }
    const s0 = herd.calfS ?? herd.s;
    for (let i = 0; i < C.length; i++) {
      const p = S.path.offsetAt(Math.min(S.path.length - 1, s0 + 30 + i * 30), (i % 2 ? 1 : -1) * (20 + Math.random() * 25), 0, 0, C[i]);
      p.y = Math.max(calf.pos.y + (Math.random() - 0.4) * 12, herd.floorY(calf, p.x, p.z) + 2);
    }
    return C;
  }

  *_tag(G) {
    const S = this.story, herd = this.herd, calf = herd.calf, A = this.act, g = this.game;
    const fs = G.fs;
    const inv = fs[0];
    // the invitation: a wiggle, a chirp, a nudge... you're it
    inv.anim.gesture?.('happyWiggle');
    S.voiceCall(inv, 'play');
    let t = 0, tapped = false;
    while (t < 10) {
      const dt = yield 0;
      t += dt;
      const cs = calf.vel.length();
      _v.copy(calf.pos).addScaledVector(calf.right, inv.radius + calf.radius + 0.5).addScaledVector(calf.vel, 0.4);
      this._steer(inv, _v, cs + 5, dt, 2, cs * 0.7, calf);
      inv.drive.lookAt = calf.pos;
      for (let i = 1; i < fs.length; i++) {
        _v.copy(calf.pos).addScaledVector(calf.right, (i % 2 ? -1 : 1) * 12).addScaledVector(calf.fwd, 10 + i * 4);
        this._steer(fs[i], _v, cs + 3, dt, 8, 0);
        fs[i].drive.lookAt = calf.pos;
      }
      if (this._touching(inv, calf)) { tapped = true; break; }
    }
    if (tapped) {
      _v.copy(calf.pos).sub(inv.pos).normalize();
      calf.anim.bump?.(_v, 0.5);
      calf.vel.addScaledVector(_v, 2);
    }
    S.voiceCall(inv, 'play');
    for (const c of fs) { c.barrelRoll(Math.random() < 0.5 ? 1 : -1); c.drive.excite = 1; }
    const course = this._courseAround();
    const wi = fs.map((c, i) => (i * 2) % course.length);
    let it = calf, grace = 1.5, tags = 0;
    t = 0;
    while (t < 50 && tags < 5) {
      const dt = yield 0;
      t += dt;
      grace -= dt;
      const pls = this.players();
      if (!pls.includes(it) && !fs.includes(it)) it = calf; // player two left
      const itIsPlayer = pls.includes(it);
      for (let i = 0; i < fs.length; i++) {
        const c = fs[i];
        if (c === it) continue;
        // flee along the course, just out of reach of whoever is it
        const wp = course[wi[i]];
        if (c.pos.distanceTo(wp) < 10) wi[i] = (wi[i] + 1) % course.length;
        const d = c.pos.distanceTo(it.pos);
        const ps = it.vel.length();
        let sp = d > 45 ? 5 : d > 22 ? ps * 0.85 + 1 : ps + 2.5;
        if (t > 35) sp *= 0.7; // out of breath
        this._steer(c, wp, clamp(sp, 4, 19), dt, 5, 2);
        c.drive.lookAt = d > 18 ? it.pos : null;
        c.drive.excite = 1;
        if (itIsPlayer && grace <= 0 && this._touching(c, it)) {
          // tagged! a squeal, a wiggle: now that friend is it
          S.voiceCall(c, 'chirp');
          c.anim.gesture?.('happyWiggle');
          it.drive.happy = 1;
          if (A) A.joy += 0.25;
          S.audio?.sfx?.('chime', { position: c.pos, gain: 0.5, pitch: 1 + tags * 0.1 });
          it = c;
          grace = 1.4;
          tags++;
          this.stats.tags++;
          this.note(`tag: ${c.name} is it`);
          break;
        }
      }
      if (!itIsPlayer) {
        // the friend who is it counts a beat (a wiggle), then chases the nearest player
        let tgt = calf, bd = Infinity;
        for (const p of pls) { const d = p.pos.distanceTo(it.pos); if (d < bd) { bd = d; tgt = p; } }
        if (grace > 0) {
          _v.copy(it.pos).addScaledVector(it.vel, 0.3);
          this._steer(it, _v, 3, dt, 4);
        } else {
          _v.copy(tgt.pos).addScaledVector(tgt.vel, 0.4);
          this._steer(it, _v, clamp(tgt.vel.length() * 0.85 + 3, 6, 18), dt, 2, 2, tgt);
        }
        it.drive.lookAt = tgt.pos;
        it.drive.excite = 1;
        if (this.p2Live && tgt === this.p2.w) this._p2Goal = null;
        if (grace <= 0 && this._touching(it, tgt)) {
          S.voiceCall(it, 'play');
          it.barrelRoll(Math.random() < 0.5 ? 1 : -1);
          _v.copy(tgt.pos).sub(it.pos).normalize();
          tgt.anim.bump?.(_v, 0.45);
          tgt.drive.happy = 1;
          if (A) A.joy += 0.15;
          it = tgt;
          grace = 1.6;
          tags++;
          this.stats.tags++;
          this.note('tag: a player is it');
        }
      } else if (this.p2Live && it === this.p2.w) {
        // the scripted player two chases the nearest friend
        let bd = Infinity;
        for (const c of fs) { const d = c.pos.distanceTo(it.pos); if (d < bd) { bd = d; this._p2Goal = this._p2GoalV || (this._p2GoalV = new Vector3()); this._p2Goal.copy(c.pos); } }
      } else this._p2Goal = null;
    }
    this._p2Goal = null;
    // out of breath: everyone happy
    for (const c of fs) { c.anim.gesture?.('happyWiggle'); c.drive.happy = 1; this._bond(c); }
    S.voiceCall(fs[0], 'play');
    if (fs[1]) this.act?.schedule?.(fs[1], 0.4, 'chirp');
    calf.drive.happy = 1;
    if (A) A.joy += 0.5;
    if (tags > 0) S.audio?.stinger?.('harmony');
    yield 2;
    void g;
  }

  // ---- follow the leader -----------------------------------------------------------------------
  *_follow(G) {
    const S = this.story, herd = this.herd, calf = herd.calf, A = this.act, g = this.game;
    const L = G.fs[0];
    // come on: it swims up, chirps, spins and darts off ahead
    S.voiceCall(L, 'play');
    let t = 0;
    while (t < 8) {
      const dt = yield 0;
      t += dt;
      _v.copy(calf.pos).addScaledVector(calf.fwd, 8).addScaledVector(calf.right, 4).addScaledVector(calf.vel, 0.4);
      const d = this._steer(L, _v, calf.vel.length() + 5, dt, 3, 2);
      L.drive.lookAt = calf.pos;
      if (d < 7) break;
    }
    L.barrelRoll(1);
    L.anim.gesture?.('happyWiggle');
    S.voiceCall(L, 'chirp');
    // the path: the course, every other point skimming the sea (its wake throws spray)
    const course = this._courseAround();
    for (let i = 0; i < course.length; i++) if (i % 2 === 1) course[i].y = seaHeight(g, course[i].x, course[i].z) + L.radius * 1.3 + 0.6;
    const crumbs = [];
    let wi = 0, drop = 0, streak = 0, hits = 0, lastHit = -9, callT = 5, laps = 0;
    t = 0;
    while (t < 34 && laps < 2) {
      const dt = yield 0;
      t += dt;
      callT -= dt;
      const wp = course[wi];
      if (L.pos.distanceTo(wp) < 9) {
        wi = (wi + 1) % course.length;
        if (wi === 0) laps++;
        // a flourish at some turns, for the followers to copy
        if (wi % 3 === 1) L.barrelRoll(wi % 2 ? 1 : -1);
      }
      const pls = this.players();
      let lag = Infinity, ps = 0;
      for (const p of pls) { const d = p.pos.distanceTo(L.pos); if (d < lag) { lag = d; ps = p.vel.length(); } }
      const sp = lag > 45 ? 4 : lag > 25 ? ps * 0.9 : clamp(ps + 2, 9, 18);
      this._steer(L, wp, sp, dt, 4, 2);
      L.drive.lookAt = lag > 30 ? calf.pos : null;
      L.drive.excite = 1;
      if (lag > 45 && callT <= 0) { S.voiceCall(L, 'chirp'); callT = 5; }
      // its wake: breadcrumbs the followers fly through
      drop -= dt;
      if (drop <= 0) { drop = 0.5; crumbs.push({ p: L.pos.clone(), t: g.time, hit: false }); if (crumbs.length > 70) crumbs.shift(); }
      for (const p of pls) {
        for (const c of crumbs) {
          if (c.hit || g.time - c.t < 0.6) continue;
          if (p.pos.distanceToSquared(c.p) < 42) {
            c.hit = true;
            hits++;
            streak = g.time - lastHit < 2.2 ? streak + 1 : 0;
            lastHit = g.time;
            this.stats.crumbs++;
            p.drive.happy = Math.max(p.drive.happy, 0.6);
            if (streak % 2 === 0) S.audio?.sfx?.('chime', { position: p.pos, gain: 0.25 + Math.min(0.3, streak * 0.02), pitch: 1 + Math.min(0.8, streak * 0.05) });
            if (A) A.joy += 0.03;
          }
        }
      }
      if (this.p2Live) { const pc = crumbs.length > 3 ? crumbs[crumbs.length - 3].p : L.pos; this._p2Goal = this._p2GoalV || (this._p2GoalV = new Vector3()); this._p2Goal.copy(pc); }
    }
    this._p2Goal = null;
    this.note(`follow: ${hits} crumbs`);
    if (hits >= 12) {
      // stuck with it to the end: a happy spin and the music lifts
      L.barrelRoll(-1);
      L.anim.gesture?.('happyWiggle');
      S.voiceCall(L, 'play');
      S.audio?.stinger?.('harmony');
      if (A) A.joy += 0.7;
      calf.drive.happy = 1;
      this._bond(L, 1.5);
    } else {
      S.voiceCall(L, 'chirp');
      if (A) A.joy += 0.2;
      this._bond(L, 0.5);
    }
    yield 1.5;
  }

  // ---- the breach contest ----------------------------------------------------------------------
  *_breach(G) {
    const S = this.story, herd = this.herd, calf = herd.calf, A = this.act, g = this.game;
    const fs = G.fs;
    G.leaps = new Map();
    G.landed = [];
    S.voiceCall(fs[0], 'play');
    this.act?.schedule?.(fs[1], 0.5, 'chirp');
    // the spot: just ahead of player one, on the sea
    const spot = new Vector3().copy(calf.pos).addScaledVector(calf.fwd, 30);
    let best = 0;
    for (let i = 0; i < fs.length; i++) {
      const c = fs[i];
      const side = i === 0 ? 1 : -1;
      // down under the sea...
      let t = 0, ph = 0, apex = 0;
      while (t < 22 && ph < 3) {
        const dt = yield 0;
        t += dt;
        const sea = seaHeight(g, c.pos.x, c.pos.z);
        const depth = sea - c.pos.y;
        // the other friend floats at the surface watching
        const o = fs[1 - i];
        _v.copy(spot).addScaledVector(calf.right, -side * 16);
        _v.y = seaHeight(g, _v.x, _v.z) - o.radius * 0.4;
        this._steer(o, _v, 6, dt, 6);
        if (o.pos.y < _v.y + 2) herd.behaviors?.ballast?.(o, _v.y, dt, 0.7);
        o.drive.lookAt = c.pos;
        if (ph === 0) {
          _v.copy(spot).addScaledVector(calf.right, side * 8);
          _v.y = seaHeight(g, _v.x, _v.z) - 8;
          this._steer(c, _v, 10, dt, 3, 4);
          if (depth > 0.5) herd.behaviors?.ballast?.(c, _v.y, dt, 0.8);
          if (depth > 5.5 || t > 12) ph = 1;
        } else if (ph === 1) {
          // ...and up, fast
          _v.copy(c.pos).addScaledVector(c.fwd, 3);
          _v.y = sea + 10;
          this._steer(c, _v, 14, dt, 1, 10);
          if (depth > 0) c.vel.y += 10 * dt;
          c.drive.effort = 1;
          if (depth < -c.radius * 0.3 && c.vel.y > 1.5) {
            ph = 2;
            c.anim.gesture?.('breachArch');
            S.voiceCall(c, 'play');
          }
          if (t > 20) ph = 3;
        } else {
          // airborne: the arc, then the splash
          c.ctl.thrust = 0;
          c.ctl.targetPitch = -0.4;
          c.vel.y -= 8 * dt;
          apex = Math.max(apex, -depth);
          if (depth > c.radius * 0.2 && apex > 0.5) ph = 3;
        }
      }
      best = Math.max(best, apex);
      this.note(`breach: ${c.name} ${apex.toFixed(1)} m`);
    }
    // your turn: they float at the surface, facing you, calling
    G.turn = true;
    G.best = Math.max(best, 2);
    let t = 0, callT = 0, cheered = false, tries = 0;
    while (t < 30 && !cheered && tries < 3) {
      const dt = yield 0;
      t += dt;
      callT -= dt;
      fs.forEach((c, i) => {
        _v.copy(spot).addScaledVector(calf.right, (i === 0 ? 1 : -1) * 18);
        _v.y = seaHeight(g, _v.x, _v.z) - c.radius * 0.4;
        this._steer(c, _v, 5, dt, 6);
        if (c.pos.y < _v.y + 2) herd.behaviors?.ballast?.(c, _v.y, dt, 0.7);
        c.drive.lookAt = calf.pos;
      });
      if (callT <= 0) { S.voiceCall(fs[(Math.random() * 2) | 0], 'chirp'); callT = 6; }
      // a leap in progress: follow its height
      for (const [w, L] of G.leaps) L.apex = Math.max(L.apex, w.pos.y - seaHeight(g, w.pos.x, w.pos.z));
      // headless testing: the scripted second player and the autopilot do not breach; force a leap
      if (S.autoplay && t > 4 && !G.forced) {
        G.forced = true;
        G.landed.push({ w: calf, apex: G.best + 1 });
      }
      while (G.landed.length) {
        const { w, apex } = G.landed.shift();
        tries++;
        this.note(`breach: player ${apex.toFixed(1)} m vs ${G.best.toFixed(1)}`);
        if (apex > G.best * 0.95) {
          cheered = true;
          this._cheer(w, fs);
        } else {
          for (const c of fs) this.act?.schedule?.(c, 0.3 + Math.random() * 0.4, 'chirp');
          if (A) A.joy += 0.25;
          w.drive.happy = 1;
        }
      }
    }
    for (const c of fs) this._bond(c);
    yield cheered ? 2.5 : 1;
  }

  /** The herd cheers a leap: adults call out together, the friends roll, the music lifts. */
  _cheer(w, fs) {
    const S = this.story, herd = this.herd, A = this.act;
    let n = 0;
    for (const a of herd.adults) {
      if (n >= 4 || a.pos.distanceTo(w.pos) > 260) continue;
      this.act?.schedule?.(a, 0.3 + n * 0.35, 'answer');
      if (a.beh) { a.beh.lookT = 3; a.beh.lookW = w; }
      n++;
    }
    for (const c of fs) { c.barrelRoll(Math.random() < 0.5 ? 1 : -1); this.act?.schedule?.(c, 0.2 + Math.random() * 0.3, 'chirp'); c.drive.happy = 1; }
    S.audio?.stinger?.('harmony');
    S.audio?.sfx?.('sparkle', { position: w.pos, gain: 0.8 });
    if (A) A.joy += 1;
    w.drive.happy = 1;
    this.stats.cheers++;
  }
}
