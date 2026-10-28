// The whole life of a flying whale, after the first migration (Act I, Story.js chapters):
//   Act II  · THE SONG OF TWO  courtship at golden hour: a duet, a mirrored spiral dance, the rise
//   Act III · NEW LIFE         a birth in the lagoon, lifting the newborn to its first breath, teaching it
//   Act IV  · THE ELDER        leading the herd, the last song under the galaxy, the rest in the deep,
//                              a whale fall that becomes a garden, and a new calf waking at dawn.
// The acts reuse the world and the route. Between them the player's whale is swapped for an older
// one (WhaleTypes YOUNG, ELDER_SELF); the mate and the newborn are extra whales stepped here.
import { Vector3 } from 'three';
import { Whale } from '../../creatures/Whale.js';
import { YOUNG, MATE, NEWBORN, ELDER_SELF } from '../../creatures/WhaleTypes.js';
import { waterStep, seaHeight } from '../Swim.js';
import { until } from '../Script.js';
import { G } from '../../render/Globals.js';
import { clamp, lerp, smoothstep, easeInOut, TAU } from '../../core/math.js';
import { ACTS, SKIPS, MOMENTS } from './text.js';
import { Nursery } from './Nursery.js';
import { maelstromCenter, maelstromS } from './Hatching.js';
import { SPECIES, PLACES, NARRATION as N } from './doc.js';

const _v = new Vector3();
const _v2 = new Vector3();
const _p = new Vector3();

// a grown whale the player steers: far nimbler than the herd's adults, heavier than the calf
const PHYS_PLAYER_ADULT = {
  maxYawRate: 1.15, yawStiff: 9, yawDamp: 5.2, maxPitchRate: 1.0, pitchStiff: 8, pitchDamp: 4.8, maxPitch: 1.05,
  bankGain: 0.6, maxBank: 0.7, bankRate: 2.6, thrust: 8.5, surgeMul: 1.9, drag: 0.035, sideDrag: 2.4, sink: 0.8,
  brake: 1.3, diveGain: 6, climbCost: 0.3,
};

export class LifeCycle {
  constructor(story) {
    this.story = story;
    this.game = story.game;
    this.cast = null; // { young, mate, newborn, elder } built behind the title
    this.extras = []; // visible extra whales stepped here (the mate, the newborn)
    this.kin = new Set(); // whales whose transform the act scripts set directly
    this.autoGoal = null; // headless autopilot goal (Story's ?auto)
    this.calls = 0;
    this.rolls = 0;
    this.lastRollT = -99;
    this.free = false; // the player may leave the herd's leash (kinematic acts)
    this.helixC = new Vector3();
    // the Spiral Maelstrom: the whirlpool, the egg, its guards and its predators
    this.nursery = new Nursery(story);
  }

  // ---- the cast ---------------------------------------------------------------------------------
  _make(genome, phys) {
    const g = this.game;
    const w = new Whale(genome, phys ? { phys } : {});
    w.furQuality = g.furQuality ?? 1;
    w.group.visible = false;
    g.engine.scene.add(w.group);
    // the fields Herd keeps on its whales (separation and behaviours read some of them)
    Object.assign(w, { phase: w.L * 3.1, playT: 20, state: 'travel', stateT: 0, homeOffset: new Vector3(), target: new Vector3(), desiredSpeed: 0, fearT: 0 });
    w.lc = { mode: 'off', target: new Vector3(), speed: 6, side: 1, back: 6 };
    return w;
  }

  /** Build the life-cycle whales quietly in the background (after the world). */
  prepare() {
    this.nursery.warm();
    if (this.cast || this._preparing) return;
    this._preparing = true;
    const order = [['young', YOUNG, PHYS_PLAYER_ADULT], ['mate', MATE], ['newborn', NEWBORN], ['elder', ELDER_SELF, PHYS_PLAYER_ADULT]];
    const cast = {};
    const step = () => {
      if (this.cast) return;
      const [k, gen, phys] = order.shift();
      cast[k] = this._make(gen, phys);
      if (order.length) setTimeout(step, 40);
      else { this.cast = cast; this._preparing = false; }
    };
    setTimeout(step, 40);
  }

  /** The cast, built now if the background build has not finished (debug jumps). */
  ensure() {
    if (this.cast) return this.cast;
    const c = {};
    c.young = this._make(YOUNG, PHYS_PLAYER_ADULT);
    c.mate = this._make(MATE);
    c.newborn = this._make(NEWBORN);
    c.elder = this._make(ELDER_SELF, PHYS_PLAYER_ADULT);
    this.cast = c;
    return c;
  }

  /** Swap the whale the player steers (the herd, physics, controller and camera follow). */
  setPlayer(w) {
    const S = this.story, g = this.game, herd = S.herd;
    const old = herd.calf;
    if (!this.calf0) this.calf0 = old;
    if (old === w) return;
    old.group.visible = false;
    herd.physics.remove(old);
    const i = herd.whales.indexOf(old);
    if (i >= 0) herd.whales[i] = w;
    old.role = 'off';
    w.role = 'player';
    herd.calf = w;
    w.group.visible = true;
    if (!w._shadowed) { w.model.castShadows(g.engine.shadows); w._shadowed = true; }
    herd.physics.add(w);
    herd.behaviors?.attach?.(w);
    w.pos.copy(old.pos);
    w.vel.set(0, 0, 0);
    S.player.w = w;
    if (S.player.moves) S.player.moves.w = w; // tail slaps, dashes and breaches move with the player
    S.player.syncAim();
    w.energy = 1;
    w.furQuality = g.furQuality ?? 1;
    g.cameraRig.initialized = false;
  }

  /** Show an extra whale (the mate, the newborn) and step it here. */
  show(w, mode = 'follow') {
    if (!w.group.visible) {
      w.group.visible = true;
      if (!w._shadowed) { w.model.castShadows(this.game.engine.shadows); w._shadowed = true; }
    }
    w.lc.mode = mode;
    if (!this.extras.includes(w)) this.extras.push(w);
    this.story.herd.extraWhales = this.extras;
  }

  hide(w) {
    w.group.visible = false;
    w.lc.mode = 'off';
    this.kin.delete(w);
    const i = this.extras.indexOf(w);
    if (i >= 0) this.extras.splice(i, 1);
    const herd = this.story.herd;
    if (herd.extraWhales === this.extras && !this.extras.length) herd.extraWhales = null;
  }

  /** Back to Act I's cast: the calf is the player again, the old elder returns. */
  restore() {
    const S = this.story, herd = S.herd;
    this.autoGoal = null;
    this.free = false;
    this.kin.clear();
    if (this.cast) for (const k of ['mate', 'newborn']) this.hide(this.cast[k]);
    if (this.calf0 && herd.calf !== this.calf0) this.setPlayer(this.calf0);
    if (this.cast) for (const k of ['young', 'elder']) if (herd.calf !== this.cast[k]) this.cast[k].group.visible = false;
    this.elderBack();
    S.act = 1;
  }

  elderGone() {
    const herd = this.story.herd, e = herd.elder;
    if (e.lcGone) return;
    e.lcGone = { slot: e.slot.clone() };
    e.group.visible = false;
    herd.physics.remove(e);
    e.slot.set(0, 260, -400);
  }

  elderBack() {
    const herd = this.story.herd, e = herd.elder;
    if (!e.lcGone) return;
    e.slot.copy(e.lcGone.slot);
    e.lcGone = null;
    e.group.visible = true;
    herd.physics.add(e);
  }

  // ---- per frame -----------------------------------------------------------------------------------
  isKinematic(w) {
    return this.kin.has(w);
  }

  /** Place a whale by hand (kinematic): position, and a heading from its motion. */
  pose(w, pos, dt, faceDir = null) {
    if (dt > 0) w.vel.copy(pos).sub(w.pos).divideScalar(dt);
    w.pos.copy(pos);
    const d = faceDir || w.vel;
    const L = Math.hypot(d.x, d.z);
    if (L > 1e-3) { w.yaw = Math.atan2(d.x, d.z); w.ctl.targetYaw = w.yaw; }
    const sp = d.length();
    if (sp > 1e-3) { w.pitch = clamp(Math.asin(clamp(d.y / sp, -1, 1)), -0.9, 0.9); w.ctl.targetPitch = w.pitch; }
    w._syncTransform();
  }

  update(dt) {
    const S = this.story, g = this.game, herd = S.herd;
    this.nursery.update(dt);
    if (!this.extras.length) return;
    const me = herd.calf;
    const cam = g.engine.camera.position;
    for (const w of this.extras) {
      const c = w.lc;
      if (!this.kin.has(w)) {
        if (c.mode === 'follow') {
          // beside and a little behind the player, on the given side
          const off = (me.L + w.L) * 0.42 + 2;
          c.target.copy(me.pos).addScaledVector(me.right, c.side * off).addScaledVector(me.fwd, -c.back);
          const d = w.pos.distanceTo(c.target);
          herd.steer(w, c.target, clamp(me.vel.length() + d * 0.25, 2, 18), dt, herd._opts(8, 0, me, 0.9, 1));
        } else if (c.mode === 'steer') {
          herd.steer(w, c.target, c.speed, dt, herd._opts(c.arrive ?? 6, c.minSpeed ?? 0, me, 1.0, 1.1));
        } else {
          w.ctl.thrust = 0;
          w.ctl.targetYaw = w.yaw;
        }
        w.step(dt);
        waterStep(w, dt, g, { onSplash: S._onSplash });
      }
      S.voices.get(w)?.setPosition?.(w.pos);
      const ht = S.humTimers.get(w);
      if (ht !== undefined) {
        const nt = ht - dt;
        if (nt <= 0) { w.drive.hum = 0; S.humTimers.delete(w); } else S.humTimers.set(w, nt);
      }
      w.animate(dt, cam);
    }
  }

  /** Progress marker (headless checks and the pacing table read stageLog). */
  mark(stage) {
    this.stage = stage;
    (this.stageLog ||= []).push([stage, Math.round(this.game.time * 10) / 10]);
  }

  // ---- events from the story -------------------------------------------------------------------------
  onHum() {
    const S = this.story;
    this.calls++;
    const c = this.cast;
    if (!c) return;
    const nb = c.newborn;
    if (S.act === 3 && nb.group.visible && !this._answering) {
      // it answers when you call
      this._answering = true;
      const self = this;
      S.script.run((function* () {
        yield 0.55;
        S.voiceCall(nb, 'chirp');
        nb.drive.happy = 1;
        self._answering = false;
      })(), 'answer');
    }
    if (S.act === 4 && !this._herdAnswer) {
      // the herd answers its elder, voice after voice
      this._herdAnswer = true;
      const self = this;
      S.script.run((function* () {
        const ws = S.herd.adults.filter((w) => w.group.visible).slice(0, 4);
        for (const w of ws) { yield 0.45; S.voiceCall(w, 'answer'); }
        yield 1.5;
        self._herdAnswer = false;
      })(), 'answer');
    }
  }

  onRoll() {
    this.rolls++;
    this.lastRollT = this.game.time;
  }

  // ---- running the acts -------------------------------------------------------------------------------
  /** Start an act directly (Continue, debug ?act=N). */
  start(act) {
    const S = this.story;
    this.ensure();
    S.script.cancel('chapter');
    S.script.run(this.runFrom(act), 'chapter');
  }

  *runFrom(act) {
    if (act <= 2) yield* this.act2();
    if (act <= 3) yield* this.act3();
    yield* this.act4();
  }

  /** Common set-up for an act: the herd at arc length s, a time of day, a mood. */
  setup(act, s, time, mood, player) {
    const S = this.story, g = this.game, herd = S.herd;
    this.ensure();
    S.script.cancel('answer');
    S.resetWorldState();
    S.act = act;
    S.state = 'play';
    S.completed = S.completed || act > 1;
    S.save(act === 4 ? 6 : 4, act);
    this.restoreExtras();
    this.setPlayer(player);
    if (act === 4) this.elderGone(); else this.elderBack();
    herd.placeAt(s, { speed: 0 });
    herd.mode = 'rest';
    herd.targetSpeed = 0;
    herd.calf.drive.sleep = 0;
    herd.mother.drive.sleep = 0;
    S.chapterIndex = S.path.chapterAt(s).index;
    S.populateEcosystem(S.chapterIndex);
    g.atmosphere.set(time);
    S.audio.setMood?.(mood, { fade: 5 });
    S.audio.setIntensity?.(0.4);
    S.menu.hide();
    S.player.enabled = true;
    S.player.syncAim();
    g.input.setGameplayMode(true);
    document.body.classList.add('playing');
    g.cameraRig.cineTarget = 0;
    g.cameraRig.cineW = 0;
    g.cameraRig.initialized = false;
    g.engine.setLook?.('gameplay', { focusOn: herd.calf.pos, ease: 0 });
    this.calls = 0;
    this.rolls = 0;
    this.free = false;
    this.kin.clear();
  }

  restoreExtras() {
    if (!this.cast) return;
    for (const k of ['mate', 'newborn']) this.hide(this.cast[k]);
    this.cast.newborn.group.scale.setScalar(1);
  }

  get auto() {
    return !!this.story.autoplay;
  }

  /** "Seasons turn...": a fade to black and a few lines between acts. */
  *seasonsTurn(lines) {
    const S = this.story, g = this.game, C = S.cine;
    this.mark('skip');
    C.begin({ letterbox: true, hold: true });
    g.fadeRate = 0.5;
    let t = 0;
    while (t < 2.6 && !C.skipped) t += yield 0;
    for (const l of lines) {
      if (C.skipped) break;
      yield* C.showCard({ title: l.title, line: l.line }, 3.4);
    }
    C.end({ release: false });
  }

  /** Emit soft light motes around a point (birth, the bond, the whale-fall garden). */
  motes(at, n, spread, color, opts = {}) {
    const g = this.game;
    for (let i = 0; i < n; i++) {
      _p.set((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread * (opts.flat ?? 0.6), (Math.random() - 0.5) * spread).add(at);
      g.glow.emit({
        pos: _p.clone(), vel: new Vector3((Math.random() - 0.5) * 0.6, opts.rise ?? 0.5 + Math.random() * 0.6, (Math.random() - 0.5) * 0.6),
        life: opts.life ?? 3 + Math.random() * 2, size: opts.size ?? 0.25 + Math.random() * 0.25, sizeEnd: opts.sizeEnd ?? 0.05,
        color, alpha: opts.alpha ?? 0.8, drag: 0.6, kind: 0, fadeIn: 0.4,
      });
    }
  }

  // ======================================================================================================
  // ACT II · THE SONG OF TWO
  // ======================================================================================================
  *act2() {
    const S = this.story, g = this.game, herd = S.herd, C = S.cine;
    const { young, mate } = this.ensure();
    const s0 = 5560;
    this.setup(2, s0, 'golden', 'courtship', young);
    const me = herd.calf;
    const center = (S.world.songCenter || S.path.pointAt(5800)).clone();
    // the mate glides in from across the ring of sea stacks
    const f = S.path.frameAt(s0);
    mate.place(_v.copy(me.pos).addScaledVector(f.fwd, 160).addScaledVector(f.right, -70).setY(me.pos.y + 6), Math.atan2(-f.fwd.x, -f.fwd.z) + 0.6);
    this.show(mate, 'steer');
    mate.lc.target.copy(me.pos).addScaledVector(f.right, 30).setY(me.pos.y + 4);
    mate.lc.speed = 9;
    this.autoGoal = () => mate.pos;
    this.mark('act2');
    // ---- the meeting, as a cinematic
    C.begin({ focus: me, rate: 0.5, snap: true });
    C.card(ACTS[2]);
    yield* C.play(C.orbit({ center, radius: [420, 260], height: [140, 60], angle: [2.4, 2.9], fov: 48, look: me }), 7);
    C.hideCard();
    C.setFocus(mate);
    yield* C.play(C.rel({ subject: me, side: [-6, -3], up: [3, 2], back: [-2, -6], ahead: 60, fov: 34, lookSide: -10 }), 4);
    mate.lc.target.copy(me.pos).addScaledVector(me.right, 14).addScaledVector(me.fwd, 4);
    C.lower(SPECIES.mate, 5);
    C.say(N.court2, 4.5);
    yield* C.play(C.flyby({ subject: mate, side: -10, up: 1.5, to: 18, fov: 36 }), 4.5);
    S.voiceCall(mate, 'answer');
    yield* C.play(C.eye({ whale: mate, side: 1, dist: [0.38, 0.3], fov: [32, 28] }), 3.5);
    C.end();
    this.mark('circle');
    // ---- she circles, and calls; the player comes to her
    mate.lc.mode = 'steer';
    let a = 0;
    let t = 0, lastCall = -9;
    while (t < 30) {
      a += 0.18 * (yield 0);
      t = g.time - (this._t0 ??= g.time);
      mate.lc.target.copy(me.pos).add(_v.set(Math.cos(a) * 34, 3, Math.sin(a) * 34));
      mate.lc.speed = 8;
      if (t - lastCall > 6) { lastCall = t; S.voiceCall(mate, 'answer'); }
      if (me.pos.distanceTo(mate.pos) < 45 && t > 4) break;
    }
    this._t0 = undefined;
    this.mark('duet');
    // ---- the duet: she sings, the player answers
    mate.lc.mode = 'steer';
    const faceSpot = () => mate.lc.target.copy(me.pos).addScaledVector(me.fwd, 22).addScaledVector(me.right, 6).setY(me.pos.y + 2);
    const keep = S.script.run((function* () { for (;;) { faceSpot(); mate.lc.speed = Math.max(3, me.vel.length()); mate.drive.lookAt = me.pos; yield 0; } })(), 'mateFace');
    S.audio.setIntensity?.(0.3);
    yield* S.song.duet(mate, {
      auto: this.auto,
      onSuccess: () => this.motes(_v2.copy(me.pos).lerp(mate.pos, 0.5), 18, 10, [1.0, 0.8, 0.55]),
    });
    keep.done = true;
    S.script.cancel('mateFace');
    mate.drive.lookAt = null;
    this.mark('dance');
    // ---- the spiral dance: follow her spirals, mirror her rolls, rise together
    S.audio.setIntensity?.(0.6);
    const C0 = _v.copy(me.pos).addScaledVector(me.fwd, 45);
    C0.y = Math.max(C0.y, seaHeight(g, C0.x, C0.z) + 30);
    const spiralC = C0.clone();
    let ang = Math.atan2(mate.pos.z - spiralC.z, mate.pos.x - spiralC.x);
    let rise = 0, harmony = 0, mirrors = 0, nextRoll = 7, rollAt = -99, rollDir = 1, sparkT = 0;
    this.rolls = 0;
    this.free = true;
    t = 0;
    S.voiceCall(mate, 'play');
    while (t < 80) {
      const dt = yield 0;
      t += dt;
      ang += 0.26 * dt;
      rise = Math.min(rise + 1.1 * dt, 140);
      mate.lc.mode = 'steer';
      mate.lc.target.set(spiralC.x + Math.cos(ang + 0.5) * 30, spiralC.y + rise + 4, spiralC.z + Math.sin(ang + 0.5) * 30);
      mate.lc.speed = 9.5;
      mate.lc.minSpeed = 6;
      this.autoGoal = () => _v2.copy(mate.pos).addScaledVector(mate.fwd, -12).addScaledVector(mate.right, 8);
      const close = me.pos.distanceTo(mate.pos) < 38;
      if (close) harmony += dt;
      // her roll: an invitation to mirror
      if (t > nextRoll) {
        nextRoll = t + 7.5;
        rollDir = -rollDir;
        if (mate.barrelRoll(rollDir)) { rollAt = g.time; S.voiceCall(mate, 'play'); this.rolls = 0; }
      }
      if (this.auto && rollAt > 0 && g.time - rollAt > 0.8 && this.rolls === 0) { me.barrelRoll(rollDir); this.onRoll(); }
      if (rollAt > 0 && this.rolls > 0 && g.time - rollAt < 4 && close) {
        // mirrored: a chime, light between them, the music lifts
        mirrors++;
        rollAt = -99;
        S.audio.sfx?.('chime', { position: mate.pos, gain: 0.6 });
        S.audio.stinger?.('harmony');
        S.voiceCall(me, 'answer');
        mate.drive.happy = 1;
        me.drive.happy = 1;
        this.motes(_v2.copy(me.pos).lerp(mate.pos, 0.5), 24, 12, [1.0, 0.75, 0.6]);
        S.audio.setIntensity?.(clamp(0.6 + mirrors * 0.12, 0, 1));
      }
      if (close && (sparkT += dt) > 0.12) {
        sparkT = 0;
        this.motes(_v2.copy(me.pos).lerp(mate.pos, Math.random()), 1, 4, [1.0, 0.85, 0.6], { rise: 0.2, life: 2.2 });
      }
      if (mirrors >= 3 && harmony > 16) break;
      if (t > 50 && harmony > 25) break;
    }
    this.autoGoal = null;
    this.mark('helix');
    this.mirrors = mirrors;
    // ---- the rise: an intertwined spiral up through the clouds under the twin moons
    yield* this.helixRise(me, mate);
    this.free = false;
    yield* this.seasonsTurn(SKIPS.toAct3);
  }

  *helixRise(me, mate) {
    const S = this.story, g = this.game, C = S.cine;
    C.begin({ focus: this.helixC, rate: 0.35 });
    S.audio.setIntensity?.(1);
    S.audio.stinger?.('discover');
    g.atmosphere.transition('night', 16);
    this.kin.add(me);
    this.kin.add(mate);
    const base = _v.copy(me.pos).lerp(mate.pos, 0.5);
    const c = this.helixC.copy(base);
    const a0 = Math.atan2(me.pos.z - base.z, me.pos.x - base.x);
    let t = 0, a = a0;
    const T = 22;
    const pA = new Vector3(), pB = new Vector3(), dA = new Vector3(), dB = new Vector3();
    const fromA = me.pos.clone(), fromB = mate.pos.clone();
    const shot = C.orbit({ center: c, radius: [70, 120], height: [-25, -60], angle: [a0 + 2, a0 + 3.6], fov: [44, 56], lookUp: [0, 60] });
    G.uSongAmp.value = 1.2;
    while (t < T && !C.skipped) {
      const dt = yield 0;
      t += dt;
      const k = t / T;
      a += (0.5 + k * 0.4) * dt;
      c.y = base.y + 160 * easeInOut(Math.min(1, k * 1.15)) + k * 30;
      const r = lerp(14, 7, k);
      pA.set(c.x + Math.cos(a) * r, c.y, c.z + Math.sin(a) * r);
      pB.set(c.x + Math.cos(a + Math.PI) * r, c.y + 1.5, c.z + Math.sin(a + Math.PI) * r);
      // tangent of the helix: along the circle and upward
      dA.set(-Math.sin(a), 0.55, Math.cos(a));
      dB.set(-Math.sin(a + Math.PI), 0.55, Math.cos(a + Math.PI));
      // ease from where they were onto the helix
      const join = smoothstep(0, 3, t);
      if (join < 1) { pA.lerp(fromA, 1 - join); pB.lerp(fromB, 1 - join); }
      this.pose(me, pA, dt, dA);
      this.pose(mate, pB, dt, dB);
      me.drive.effort = mate.drive.effort = 0.7;
      me.drive.happy = mate.drive.happy = 1;
      if (Math.random() < 0.5) this.motes(_v2.copy(pA).lerp(pB, Math.random()), 1, 3, [0.85, 0.85, 1.0], { rise: -0.5, life: 3 });
      shot(clamp(k, 0, 1), t, C.shot);
      if (k > 0.72) C.shot.look.lerp(_v2.copy(c).add(_p.set(0, 400, 0)), (k - 0.72) / 0.28 * 0.8);
      if (k > 0.55 && !this._bondCard) { this._bondCard = true; C.say(MOMENTS.bond.line, 6); }
    }
    this._bondCard = false;
    // fade to stars
    g.fadeRate = 0.35;
    yield* C.wait(3);
    G.uSongAmp.value = 0;
    this.kin.delete(me);
    this.kin.delete(mate);
    C.end({ release: false });
  }

  // ======================================================================================================
  // ACT III · NEW LIFE
  // ======================================================================================================
  *act3() {
    const S = this.story, g = this.game, herd = S.herd, C = S.cine, nur = this.nursery;
    const { young, mate, newborn } = this.ensure();
    this.setup(3, maelstromS(S), 'dawn', 'birth', young);
    g.fadeRate = -0.5;
    const me = herd.calf;
    // back at the Spiral Maelstrom, where he hatched
    const c = maelstromCenter(S);
    nur.open(c, { radius: 120, depth: 7, spin: 0.22 });
    const eye = nur.eyeY();
    const bed = S.world.seabedAt ? S.world.seabedAt(c.x, c.z) : -60;
    const eggP = new Vector3(c.x, Math.max(eye - 6, bed + 3), c.z);
    const f = S.path.frameAt(110);
    const yaw = Math.atan2(f.fwd.x, f.fwd.z);
    mate.place(_v.set(c.x, eye - mate.radius * 0.3, c.z), yaw);
    this.show(mate, 'hold');
    this.kin.add(mate);
    me.place(_v.copy(c).addScaledVector(f.right, -42).addScaledVector(f.fwd, -20).setY(eye + 2), yaw + 0.6);
    S.player.syncAim();
    newborn.group.scale.setScalar(1);
    this.mark('act3');
    // ---- the return, the laying, her leaving (skippable) ----
    C.begin({ focus: mate, rate: 0.5, snap: true, lead: mate });
    C.card(ACTS[3]);
    yield* C.play(C.drone({ center: c, radius: [460, 340], height: [240, 150], angle: [yaw + 1.2, yaw + 1.6], fov: 46 }), 6);
    C.hideCard();
    C.lower(PLACES.maelstrom3, 5.5);
    C.say(N.return, 5);
    yield* C.play(C.longLens({ subject: me, dist: 240, angle: [yaw - 2.2, yaw - 2.1], height: 4, fov: [14, 12] }), 5);
    let egg = null, t = 0;
    C.setFocus(mate);
    C.slowmo(0.6);
    C.say(N.lay3, 4.5);
    const lay = C.orbit({ center: mate, radius: [mate.L * 1.7, mate.L * 1.3], height: [mate.L * 0.35, mate.L * 0.1], angle: [yaw + 0.4, yaw + 1.1], fov: [40, 36] });
    while (t < 6 && !C.skipped) {
      const dt = yield 0;
      t += dt;
      lay(easeInOut(t / 6), t, C.shot);
      this.pose(mate, _v2.set(c.x, nur.eyeY() - mate.radius * 0.3 + Math.sin(t * 0.8) * 0.2, c.z), dt, f.fwd);
      if (!egg && t > 2.2) { egg = nur.layEgg(eggP, { yaw }); S.audio.stinger?.('harmony'); this.motes(eggP, 26, 4, [1.0, 0.85, 0.7], { rise: 0.5, life: 3 }); }
      if (egg) egg.setGlow?.(clamp((t - 2.2) / 3, 0.2, 1));
    }
    C.slowmo(1);
    if (!egg) egg = nur.layEgg(eggP, { yaw });
    egg.setGlow?.(1);
    egg.setPulse?.(1.1);
    if (egg.position) eggP.copy(egg.position);
    // she leaves to feed; he stays by the egg (the carried whale holds a post beside the eye)
    C.lead = { pos: _p.copy(eggP).addScaledVector(f.right, -30).setY(nur.eyeY() + 1).clone(), right: f.right, fwd: f.fwd, L: 4 };
    this.kin.delete(mate);
    mate.lc.mode = 'steer';
    mate.lc.target.copy(c).addScaledVector(f.fwd, 900).setY(eye + 50);
    mate.lc.speed = 12;
    S.voiceCall(mate, 'answer');
    C.say(N.feed3, 4.8);
    C.setFocus(mate);
    yield* C.play(C.longLens({ subject: mate, dist: 200, angle: [yaw + 2.6, yaw + 2.5], height: 3, fov: [18, 22], lag: 1.2 }), 4.8);
    C.end();
    // ---- he guards the egg: three waves of predators ----
    this.mark('guard');
    S.audio.setMood?.('chase', { fade: 4 });
    S.audio.setIntensity?.(0.4);
    C.say(N.guard3, 5);
    const ring = new Vector3();
    let ringA = Math.atan2(me.pos.z - c.z, me.pos.x - c.x);
    this.autoGoal = () => {
      const th = nur.nearestThreat(eggP);
      if (th) return th.pos;
      ringA += 0.004;
      return ring.set(c.x + Math.cos(ringA) * 40, nur.eyeY() + 2, c.z + Math.sin(ringA) * 40);
    };
    this.free = true;
    // three waves, about a minute and a half in all: one hunter, a pair, then from both sides at once
    const waves = [
      [['lanternjack', 0.4, 110]],
      [['lanternjack', 2.6, 110], ['lanternjack', 3.4, 120]],
      [['skimmer', 1.6, 140], ['lanternjack', 5.0, 110]],
    ];
    const strikes0 = nur.strikes;
    yield 4;
    for (let wv = 0; wv < waves.length; wv++) {
      const ths = waves[wv].map(([k, a, d]) => nur.spawnThreat(k, a + yaw, d, k === 'skimmer' ? 9 : 5.2));
      const kinds = waves[wv].map((x) => x[0]);
      if (kinds.includes('lanternjack') && C.lower(SPECIES.lanternjack, 5, 'lanternjack3')) C.say(N.threat3, 4.5);
      else if (kinds.includes('skimmer') && C.lower(SPECIES.skimmer, 5, 'skimmer3')) C.say(N.above3, 4.5);
      S.voiceCall(me, 'warn');
      t = 0;
      while (t < 28 && ths.some((h) => h.state !== 'flee')) {
        const dt = yield 0;
        t += dt;
        for (const h of ths) {
          // a predator nosing at the egg for too long leaves on its own (the egg dims a little)
          if (h.state === 'strike' && h.t > 7) nur.repel(h, eggP);
          // headless: the autopilot's sonic boom, when close
          if (this.auto && h.state !== 'flee' && h.pos.distanceTo(me.pos) < 30 && Math.random() < dt) nur.repel(h, me.pos, me);
        }
        egg.setGlow?.(clamp((egg.glowT ?? 1) + dt * 0.1, 0, 1));
      }
      for (const h of ths) if (h.state !== 'flee') nur.repel(h, eggP);
      S.audio.setIntensity?.(0.45 + wv * 0.15);
      yield 3;
    }
    this.autoGoal = null;
    this.free = false;
    egg.setGlow?.(1);
    C.say(nur.strikes === strikes0 ? N.held3 : 'It took a knock or two. It is still glowing.', 4.5);
    S.audio.setMood?.('birth', { fade: 5 });
    S.audio.stinger?.('resolve');
    yield 4;
    // ---- weeks pass; the shell gives (a time-lapse, then a macro) ----
    this.mark('hatch3');
    C.begin({ focus: eggP, rate: 0.6 });
    C.timelapse(4);
    egg.setPulse?.(2);
    g.atmosphere.transition('night', 5);
    yield* C.play(C.drone({ center: c, radius: [220, 260], height: [100, 140], angle: [yaw + 3, yaw + 4], fov: 50 }), 16, {
      sway: 0, onFrame: (k) => { if (k > 0.55 && !this._lapse) { this._lapse = true; g.atmosphere.transition('dawn', 6); } },
    });
    this._lapse = false;
    C.timelapse(1);
    if (C.skipped) g.atmosphere.set('dawn');
    C.say(N.hatch3, 4);
    let kicks = 0;
    yield* C.play(C.macro({ subject: eggP, dist: [9, 7.5], angle: [yaw + 1, yaw + 1.4], height: [0.8, 0.3], fov: [30, 26], under: true }), 5, {
      onFrame: (k) => { if (kicks < 3 && k > 0.2 + kicks * 0.25) { kicks++; egg.embryo?.kick?.(); egg.crack?.(kicks * 0.3); } },
    });
    egg.hatch?.();
    if (egg.embryo?.mesh) egg.embryo.mesh.visible = false;
    S.audio.stinger?.('discover');
    newborn.place(eggP.clone(), yaw);
    this.show(newborn, 'hold');
    this.kin.add(newborn);
    S.voiceCall(newborn, 'coo');
    this.motes(eggP, 30, 5, [1.0, 0.92, 0.8], { rise: 0.6, life: 3.5 });
    yield* C.play(C.macro({ subject: newborn, dist: [5, 6], angle: [yaw + 1.4, yaw + 1.6], height: [0.2, 0.5], fov: 30, under: true }), 3);
    C.end();
    this.mark('lift');
    // ---- lift the newborn to the surface for its first breath ----
    newborn.lc.mode = 'hold';
    this.autoGoal = () => _v2.copy(newborn.pos).add(_p.set(0, -(me.radius + newborn.radius + 0.6), 0));
    C.say(N.lift3, 5);
    t = 0;
    let lastCall = 0;
    for (;;) {
      const dt = yield 0;
      t += dt;
      const sy = seaHeight(g, newborn.pos.x, newborn.pos.z);
      // it sinks, flippers fluttering
      _v2.copy(newborn.pos);
      _v2.y = Math.max(bed + 1.5, _v2.y - 0.32 * dt);
      const hx = me.pos.x - newborn.pos.x, hz = me.pos.z - newborn.pos.z;
      const below = newborn.pos.y - me.pos.y;
      const support = Math.hypot(hx, hz) < me.radius * 1.2 + 2.5 && below > 0 && below < me.radius + newborn.radius + 3;
      if (support) {
        // carried on its parent's back, rising with it
        _v2.y = Math.max(_v2.y, me.pos.y + me.radius * 0.9 + newborn.radius * 0.7);
        _v2.x += hx * Math.min(1, dt * 1.5);
        _v2.z += hz * Math.min(1, dt * 1.5);
      }
      // nobody is left stranded: after a while it finds the strength itself
      if (t > 45) _v2.y += 1.4 * dt;
      newborn.drive.effort = 0.6;
      this.pose(newborn, _v2, dt, f.fwd);
      if (t - lastCall > 9) { lastCall = t; S.voiceCall(newborn, 'coo'); }
      if (newborn.pos.y > sy - newborn.radius * 0.6) break;
      if (t > 90) break;
    }
    this.mark('breath');
    // ---- the first breath ----
    newborn.pos.y = seaHeight(g, newborn.pos.x, newborn.pos.z) + 0.1;
    newborn.blow(g, 0.9);
    S.voiceCall(newborn, 'chirp');
    S.audio.stinger?.('discover');
    newborn.drive.happy = 1;
    me.drive.happy = 1;
    this.kin.delete(newborn);
    newborn.lc.mode = 'follow';
    newborn.lc.side = 1;
    newborn.lc.back = 4;
    // she comes back, full of fish
    mate.place(_v.copy(me.pos).addScaledVector(f.fwd, 200).setY(seaHeight(g, me.pos.x, me.pos.z) + 16), yaw + Math.PI);
    mate.lc.mode = 'steer';
    mate.lc.target.copy(me.pos).addScaledVector(me.right, -14);
    mate.lc.speed = 10;
    C.begin({ focus: newborn, rate: 0.6 });
    C.say(N.breath3, 4);
    C.lower(SPECIES.newborn, 5);
    yield* C.play(C.low({ subject: newborn, side: [9, 7], back: [-10, -6], height: [0.8, 1.4], fov: 40, lookUp: 0.6 }), 4.5);
    C.setFocus(mate);
    C.say(N.mate3, 4.5);
    S.voiceCall(mate, 'answer');
    yield* C.play(C.longLens({ subject: mate, dist: 150, angle: [yaw + 0.8, yaw + 0.9], height: 2, fov: [20, 26], lag: 1 }), 4.5);
    C.end();
    mate.lc.mode = 'follow';
    mate.lc.side = -1;
    nur.settle(3, 0.12);
    this.mark('teach');
    // ---- teach it to follow: it answers when he calls ----
    C.say(N.teach3, 4.5);
    this.calls = 0;
    this.autoGoal = () => _v2.copy(herd.mother.pos).add(_p.set(20, 14, 0));
    t = 0;
    let autoHum = 0;
    while (t < 30 && this.calls < 3) {
      const dt = yield 0;
      t += dt;
      if (this.auto && (autoHum += dt) > 4) { autoHum = 0; this.onHum(); }
      // without a call for a while, the little one calls first
      if (t > 8 && Math.floor(t) % 10 === 0 && Math.floor(t - dt) % 10 !== 0) S.voiceCall(newborn, 'coo');
    }
    this.mark('lead');
    // ---- lead it to feed: a shoal in the shallows ahead ----
    const shoal = S.path.offsetAt(330, -25, 0);
    shoal.y = seaHeight(g, shoal.x, shoal.z) - 3;
    S.eco?.addFishSchool?.(shoal.clone(), 'glintfin', 260);
    this.autoGoal = () => _v2.copy(shoal).add(_p.set(0, 7, 0));
    S.voiceCall(mate, 'answer');
    yield* until(() => me.pos.distanceTo(shoal) < 60, 50);
    newborn.lc.mode = 'steer';
    let ate = 0;
    t = 0;
    while (t < 20 && ate < 4) {
      const dt = yield 0;
      t += dt;
      const n = S.eco?.nearestSwarm?.(newborn.pos);
      newborn.lc.target.copy(n && n.dist < 120 ? n.pos : shoal);
      newborn.lc.speed = 7;
      const near = newborn.pos.distanceTo(newborn.lc.target) < 14;
      newborn.drive.feed = newborn.drive.mouth = near ? 1 : 0;
      if (near && S.eco) ate += S.eco.eat?.(_v.copy(newborn.pos).addScaledVector(newborn.fwd, newborn.L * 0.48), newborn.L * 0.4 + 0.6, dt, newborn) || 0;
      if (!S.eco) ate += near ? dt : 0;
    }
    newborn.drive.feed = newborn.drive.mouth = 0;
    newborn.lc.mode = 'follow';
    newborn.drive.happy = 1;
    S.voiceCall(newborn, 'chirp');
    this.autoGoal = null;
    this.mark('family');
    // ---- three of them, flying ----
    C.begin({ focus: me, rate: 0.5 });
    C.say(MOMENTS.answer.line, 5);
    yield* C.play(C.track({ subject: me, side: [-34, -26], up: [6, 10], ahead: 12, fov: 42 }), 6);
    yield* C.play(C.orbit({ center: me, radius: [60, 120], height: [14, 50], angle: [me.yaw + 2, me.yaw + 2.7], fov: 46 }), 6);
    C.end({ release: false });
    yield* this.seasonsTurn(SKIPS.toAct4);
  }

  /** The newborn appears beside its mother, under her, in a cloud of light and bubbles. */
  bear(newborn, mate) {
    const S = this.story, g = this.game;
    newborn.place(_v.copy(mate.pos).addScaledVector(mate.up, -mate.radius * 1.1).addScaledVector(mate.fwd, -mate.L * 0.12).addScaledVector(mate.right, 1.5), mate.yaw);
    this.show(newborn, 'hold');
    this.kin.add(newborn);
    newborn.drive.sleep = 0.4;
    S.voiceCall(newborn, 'coo');
    S.voiceCall(mate, 'coo');
    mate.anim.gesture?.('nuzzle');
    this.motes(newborn.pos, 30, 5, [1.0, 0.92, 0.8], { rise: 0.6, life: 3.5 });
    for (let i = 0; i < 18; i++) {
      g.mist.emit({ pos: _v2.copy(newborn.pos).add(_p.set((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3)).clone(), vel: new Vector3(0, 1 + Math.random(), 0), life: 2.5, size: 0.12, sizeEnd: 0.3, alpha: 0.6, drag: 0.4, kind: 0 });
    }
    S.audio.stinger?.('harmony');
  }

  // ======================================================================================================
  // ACT IV · THE ELDER
  // ======================================================================================================
  *act4() {
    const S = this.story, g = this.game, herd = S.herd, C = S.cine;
    const { elder, mate } = this.ensure();
    const s0 = 6290;
    this.setup(4, s0, 'dusk', 'night', elder);
    this.mark('act4');
    g.fadeRate = -0.5;
    g.atmosphere.transition('night', 50);
    const me = herd.calf;
    // you fly first now; your mate, grey-muzzled, still at your side
    me.place(S.path.offsetAt(s0 + 60, 0, 6), me.yaw);
    S.player.syncAim();
    mate.place(_v.copy(me.pos).addScaledVector(me.right, -30), me.yaw);
    this.show(mate, 'follow');
    mate.lc.side = -1;
    herd.mode = 'travel';
    herd.targetSpeed = 5;
    C.begin({ focus: me, rate: 0.5, snap: true });
    C.card(ACTS[4]);
    C.say(N.elder, 5);
    yield* C.play(C.track({ subject: me, side: [70, 50], up: [20, 8], ahead: [-40, 10], fov: 44 }), 7);
    C.hideCard();
    yield* C.play(C.low({ subject: me, side: [26, 22], back: [-50, -30], height: [1.5, 2.5], fov: 46, lookUp: 4 }), 5);
    C.end();
    this.mark('leadHerd');
    // ---- leading the migration: the herd keeps pace with its elder
    const sStart = herd.s;
    let t = 0, projT = 0, myS = herd.s + 60;
    this.autoGoal = () => S.path.offsetAt(herd.s + 120, 0, 8, 0, _v2);
    while (herd.s < sStart + 420 && t < 80) {
      const dt = yield 0;
      t += dt;
      if ((projT += dt) > 0.25) { projT = 0; myS = S.path.project(me.pos, myS, 300).s; }
      herd.mode = 'travel';
      herd.targetSpeed = clamp((myS - herd.s - 30) * 0.18, t > 60 ? 6 : 2.5, 13);
    }
    this.mark('lastSong');
    // ---- the last song, under the spiral galaxy
    const center = _v.copy(me.pos).addScaledVector(me.fwd, 50);
    center.y += 12;
    herd.mode = 'gather';
    herd.songCenter = center.clone();
    herd.targetSpeed = 0;
    S.audio.setMood?.('song', { fade: 4 });
    this.autoGoal = () => _v2.copy(center).add(_p.set(0, -6, 30));
    const hums0 = this.calls;
    yield* until(() => this.calls > hums0 || this.auto, 14);
    C.begin({ focus: me, rate: 0.3 });
    C.say(N.lastSong, 5);
    const beat = S.song.key().beat;
    herd.whales.concat([mate]).forEach((w, i) => {
      if (!w.group.visible) return;
      w.drive.sing = 1;
      const deg = [0, 4, 2, 7, 9][i % 5];
      if (i < 9) setTimeout(() => S.voiceHum(w, S.song.midi(deg, w === me ? -1 : w.isCalf ? 1 : -2 + (i % 2)), beat * 9), i * 160);
    });
    G.uSongRipple.value.set(center.x, center.y, center.z, g.time);
    G.uSongAmp.value = 2;
    S.audio.setIntensity?.(1);
    S.audio.stinger?.('harmony');
    yield* C.play(C.orbit({ center: me, radius: [40, 170], height: [6, 150], angle: [me.yaw + 1.2, me.yaw + 2.3], fov: [44, 58], lookUp: [0, 160] }), 13);
    C.hideCard();
    for (const w of herd.whales) w.drive.sing = 0;
    mate.drive.sing = 0;
    G.uSongAmp.value = 0;
    this.mark('descend');
    // ---- rest: the elder descends into the deep
    S.audio.setMood?.('rest', { fade: 6 });
    S.audio.setIntensity?.(0.5);
    herd.songCenter = null;
    this.free = true;
    this.kin.add(me);
    const start = me.pos.clone();
    const fwd = _p.copy(me.fwd).setY(0).normalize().clone();
    const surf = start.clone().addScaledVector(fwd, 70);
    surf.y = seaHeight(g, surf.x, surf.z) + 1;
    const bedHere = S.world.seabedAt ? S.world.seabedAt(surf.x + fwd.x * 40, surf.z + fwd.z * 40) : -80;
    const deep = surf.clone().addScaledVector(fwd, 40);
    deep.y = Math.max(bedHere + me.radius * 1.2, -16);
    C.say(N.rest, 5);
    C.lower(SPECIES.elder, 5);
    const descend = C.rel({ subject: me, side: [36, 30], up: [10, 2], back: [30, 22], ahead: 4, fov: [46, 40], worldUp: true });
    t = 0;
    const T1 = 9, T2 = 16;
    const pos = new Vector3();
    while (t < T1 + T2 && !C.skipped) {
      const dt = yield 0;
      t += dt;
      if (t < T1) {
        const k = easeInOut(t / T1);
        pos.copy(start).lerp(surf, k);
        pos.y = lerp(start.y, surf.y, k * k);
      } else {
        const k = easeInOut((t - T1) / T2);
        pos.copy(surf).lerp(deep, k);
      }
      this.pose(me, pos, dt);
      me.drive.sleep = smoothstep(T1 * 0.6, T1 + T2, t);
      me.drive.effort = 0.2 * (1 - me.drive.sleep);
      descend(clamp(t / (T1 + T2), 0, 1), t, C.shot);
      if (t > T1 && seaHeight(g, C.shot.pos.x, C.shot.pos.z) < C.shot.pos.y && C.shot.pos.y - pos.y > 2) C.shot.pos.y = Math.min(C.shot.pos.y, pos.y + 2);
    }
    this.pose(me, deep, 0);
    me.drive.sleep = 1;
    this.mark('garden');
    // ---- the whale fall becomes a garden: a time-lapse
    for (let i = 0; i < 3; i++) S.eco?.addFishSchool?.(_v2.copy(deep).add(_v.set((i - 1) * 18, 4 + i * 2, (i % 2) * 14 - 7)).clone(), i === 1 ? 'spiralback' : 'glintfin', 160);
    C.say(N.garden, 6);
    C.slowmo(2.5);
    g.atmosphere.transition('dawn', 9);
    const garden = C.orbit({ center: deep, radius: [me.L * 1.1, me.L * 1.7], height: [me.L * 0.1, me.L * 0.3], angle: [me.yaw + 1.6, me.yaw + 3.4], fov: [42, 48] });
    t = 0;
    while (t < 22 && !C.skipped) {
      const dt = yield 0;
      t += dt;
      garden(easeInOut(t / 22), t, C.shot);
      // stay under the water, beside the resting body
      C.shot.pos.y = Math.min(C.shot.pos.y, seaHeight(g, C.shot.pos.x, C.shot.pos.z) - 2.5);
      const n = Math.min(5, 2 + Math.floor(t / 4));
      for (let i = 0; i < n; i++) {
        const u = (Math.random() - 0.5) * me.L;
        this.motes(_v2.copy(me.pos).addScaledVector(me.fwd, u).add(_p.set(0, me.radius * 0.6, 0)), 1, me.radius * 2.2,
          Math.random() < 0.6 ? [0.35, 1.0, 0.85] : [1.0, 0.75, 0.9], { rise: 0.15, life: 3.5 + Math.random() * 2.5, size: 0.45 + Math.random() * 0.45, alpha: 1 });
      }
    }
    C.slowmo(1);
    g.fadeRate = 0.4;
    yield* C.wait(3);
    C.end({ release: false });
    yield* this.dawnAgain();
  }

  /** Year 32: in the eye of the maelstrom, another egg. The title. */
  *dawnAgain() {
    const S = this.story, g = this.game, herd = S.herd, C = S.cine, nur = this.nursery;
    this.mark('dawn');
    this.restore();
    S.resetWorldState();
    S.state = 'intro';
    S.player.enabled = false;
    herd.placeAt(maelstromS(S));
    herd.mode = 'rest';
    herd.targetSpeed = 0;
    g.atmosphere.set('dawn');
    S.audio.setMood?.('dawn', { fade: 4 });
    const c = maelstromCenter(S);
    nur.open(c, { radius: 120, depth: 7, spin: 0.22 });
    const eye = nur.eyeY();
    const bed = S.world.seabedAt ? S.world.seabedAt(c.x, c.z) : -60;
    const egg = nur.layEgg(new Vector3(c.x, Math.max(eye - 6, bed + 3), c.z));
    egg.setGlow?.(1);
    egg.setPulse?.(1.2);
    const eggP = egg.position || nur.eggPos;
    // a few of the herd circle it, as they always have
    nur.guard(herd.adults.filter((w) => w !== herd.mother).slice(0, 4), 52);
    C.begin({ focus: eggP, rate: 1, snap: true, hold: false });
    g.fadeRate = -0.4;
    C.say(N.cycle, 6);
    const shot = C.macro({ subject: eggP, dist: [10, 8], angle: [0.6, 1.2], height: [1.6, 0.6], fov: [32, 28], under: true });
    let t = 0, kicked = false;
    while (t < 13) {
      const dt = yield 0;
      t += dt;
      shot(clamp(t / 13, 0, 1), t, C.shot);
      C.handheld(C.shot, 1);
      if (t > 5 && !kicked) { kicked = true; egg.embryo?.kick?.(); }
      if (t > 7.5 && !this._cycle) { this._cycle = true; C.card(MOMENTS.cycle); }
    }
    this._cycle = false;
    S.completed = true;
    S.save(0, 1, true);
    yield 5;
    C.hideCard();
    g.fadeRate = 0.3;
    yield* until(() => g.engine.post.grade.uFade.value >= 0.99 || g.debug, 6);
    C.end({ release: false });
    this.mark('title');
    S.enterMenu();
  }
}

export { TAU };
