// The calf's abilities, learnt one by one in ACT I (docs/VUR_SOK.md 0.8: no text; the user's
// "QTE cutscenes ... you unlock your vocal abilities etc"). A newborn can only swim and fly, steer,
// roll and bite. Everything else is found in a short, wordless quick-time scene at a moment of the
// migration that calls for it (src/game/QTE.js cues; never a fail state, a miss only softens it):
//   voice   the Spiral Reach   her song across the morning sea; the calf tries to answer: a croak,
//                              then, holding each of her notes, its first true song (hum, the herd song)
//   spout   the Feasting Shoals she blows at the surface; the calf breathes in, blows: a sputter, then
//                              a real spout (and bubbles under the sea)
//   slap    the Coil Forest     her flukes boom on the water; the calf times its own (tail slap / flick)
//   loop, dash, breach         the Night Passage: down into the glowing plankton after her, then race up
//                              and burst out under the galaxy, twisting at the top
//   boom    the Storm           torn from her, alone in the dark, it gathers its voice and lets go: its
//                              first sonic boom, which she hears and answers
// A locked input is a small, cute failed attempt (a squeak, a hiccup, a wobble), never text.
// Acts II-IV (the grown whale) have everything. The unlocked set is saved with the story's save
// (Story.save writes list()); starting or continuing at a chapter grants whatever earlier chapters teach.
// Debug: ?debug&unlock=all | ?debug&unlock=voice,spout,... (acro = loop,dash,breach);
//        ?debug&chapter=N&scene=voice|spout|slap|acro|boom plays that scene at once.
import { Vector3 } from 'three';
import { clamp, lerp, smoothstep } from '../core/math.js';
import { seaHeight, spoutColumn } from './Swim.js';
import { G } from '../render/Globals.js';

export const ABILITIES = ['voice', 'spout', 'slap', 'loop', 'dash', 'breach', 'boom'];
/** The chapter (MigrationPath id) whose scene teaches each ability. */
export const TAUGHT_IN = { voice: 'valleys', spout: 'krill', slap: 'forest', loop: 'night', dash: 'night', breach: 'night', boom: 'storm' };
const SCENE_OF = { voice: 'voice', spout: 'spout', slap: 'slap', loop: 'acro', dash: 'acro', breach: 'acro', boom: 'boom' };
const ALIAS = { acro: ['loop', 'dash', 'breach'], hum: ['voice'], song: ['voice'], tail: ['slap'], breath: ['spout'], all: ABILITIES };

const _v = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const UP = new Vector3(0, 1, 0);

function parse(str) {
  const out = new Set();
  for (const k of String(str || '').split(/[,\s]+/)) {
    if (!k) continue;
    for (const a of ALIAS[k] || [k]) if (ABILITIES.includes(a)) out.add(a);
  }
  return out;
}

export class Abilities {
  constructor(game, story) {
    this.game = game;
    this.story = story;
    this.set = new Set();
    this.forced = null;
    this.failT = {};
    this.log = [];
    this._at = new Vector3();
    const p = game.params;
    if (game.debug && p?.has?.('unlock')) this.forced = parse(p.get('unlock') || 'all');
    this.pendingScene = game.debug && p?.has?.('scene') ? p.get('scene') : null;
    const s = story.loadSave?.();
    if (s && Array.isArray(s.abilities)) for (const k of s.abilities) if (ABILITIES.includes(k)) this.set.add(k);
    this._applyForced();
  }

  get herd() { return this.story.herd; }

  _applyForced() {
    if (this.forced) for (const k of this.forced) this.set.add(k);
  }

  /** Can the player's whale do this now? (ACT I only gates; the grown whale has it all.) */
  has(k) {
    const S = this.story;
    if (S.act !== 1) return true;
    return this.set.has(k);
  }

  list() { return ABILITIES.filter((k) => this.set.has(k)); }

  /** A new life (New Game): only swimming, steering, rolling and the bite. */
  reset() {
    this._undrive();
    this.set.clear();
    this._applyForced();
  }

  /** Entering chapter i (a new start or a continue): everything earlier chapters teach. */
  enterChapter(i) {
    const ch = this.story.path?.chapters || [];
    for (const k of ABILITIES) {
      const at = ch.findIndex((c) => c.id === TAUGHT_IN[k]);
      if (at >= 0 && at < i) this.set.add(k);
    }
  }

  unlock(keys, save = true) {
    for (const k of [].concat(keys)) for (const a of ALIAS[k] || [k]) if (ABILITIES.includes(a)) this.set.add(a);
    this.log.push({ t: this.game.time, keys: [].concat(keys) });
    if (save && this.story.chapterIndex >= 0) this.story.save?.(this.story.chapterIndex);
  }

  /** The QTE cues (src/game/QTE.js); a stand-in that simply succeeds if they are missing. */
  qte() {
    const q = this.game.qte;
    if (q) return q;
    const done = () => ({ done: true, ok: true, score: 1, progress: 1, cancel() {} });
    return { press: done, mash: done, hold: done, steer: done, *wait(h) { return h; }, clear() {} };
  }

  // ---- a locked ability: a small, cute failed attempt (no text) ---------------------------------
  attempt(k) {
    const g = this.game, S = this.story, calf = this.herd?.calf;
    if (!calf) return;
    const now = g.time;
    if (now - (this.failT[k] ?? -9) < 0.7) return;
    this.failT[k] = now;
    const a = calf.anim, v = S.voiceOf?.(calf);
    const key = S.song?.key?.() || { rootMidi: 62, scale: [0, 2, 4, 5, 7, 9, 11] };
    const top = key.rootMidi + 24 + key.scale[4];
    if (k === 'voice') {
      // a thin squeak that cracks and gives out; the head ducks
      v?.hum?.(top, 0.16, { gain: 0.4, glideFrom: top - 6 });
      calf.drive.hum = 0.4;
      S.humTimers?.set(calf, 0.2);
      a.sHeadPitch?.impulse?.(1.4);
      a.blinkT = 0;
    } else if (k === 'boom') {
      // the throat puffs and lets out a hiccup
      calf.drive.charge = 0.35;
      S.script.run((function* () { yield 0.25; calf.drive.charge = 0; })(), 'abilityFail');
      S.audio?.sfx?.('bonk', { position: calf.pos, gain: 0.22, pitch: 1.9 });
      v?.hum?.(top - 5, 0.09, { gain: 0.3, glideFrom: top + 2 });
      a.flinch?.(0.35);
    } else if (k === 'slap') {
      // a little wiggle of the tail stock, nothing more
      a.gesture?.('happyWiggle', { speed: 1.6 });
      a.flinch?.(0.15);
      S.audio?.sfx?.('whoosh', { position: calf.pos, gain: 0.12, pitch: 1.8 });
    } else if (k === 'spout') {
      // a tiny wet sneeze at the surface, three bubbles under it
      const mv = S.player?.moves;
      if (mv && mv.zone === 'under') {
        const p = calf.model.blowholePos ? calf.model.blowholePos(_v) : _v.copy(calf.pos).addScaledVector(calf.up, calf.radius);
        mv._bubbles?.(p, 4, 0.5);
      } else calf.blow?.(g, 0.12);
      S.audio?.sfx?.('spout', { position: calf.pos, gain: 0.14, pitch: 1.9 });
      a.flinch?.(0.3);
    } else if (k === 'loop' || k === 'dash') {
      // the nose lifts eagerly... and the calf wobbles back level
      a.sHeadPitch?.impulse?.(k === 'loop' ? -2 : -0.8);
      a.flinch?.(0.25);
      calf.vel.addScaledVector(k === 'loop' ? UP : calf.fwd, k === 'loop' ? 1.5 : 1.2);
      S.audio?.sfx?.('whoosh', { position: calf.pos, gain: 0.15, pitch: 1.6 });
    }
    calf.drive.excite = Math.max(calf.drive.excite, 0.4);
  }

  // ---- per frame (Story.update) ------------------------------------------------------------------
  update() {
    const S = this.story;
    // a scene cut short (the menu): the calf's steering goes back to the player
    if (this._auto && (S.state === 'menu' || S.state === 'intro')) this._undrive();
    // debug: ?debug&chapter=N&scene=... plays a scene as soon as the chapter is in play
    if (this.pendingScene && S.state === 'play' && S.chapterIndex >= 0 && !S.cine?.active && this.game.time > 2) {
      const name = this.pendingScene;
      this.pendingScene = null;
      if (name === 'mouth' || name === 'bonds') { if (S.bonds) S.script.run(S.bonds.danger({ force: true }), 'bondsScene'); return; }
      for (const k of ALIAS[name] || [name]) this.set.delete(k);
      S.script.run(this.scene(name), 'abilityScene');
    }
  }

  // ---- the scenes ---------------------------------------------------------------------------------
  /**
   * Play the scene that teaches `name` (an ability or 'acro') unless it is already known. Runs inside
   * a chapter coroutine: `yield* this.abilities.scene('voice')`. Always ends with it unlocked.
   */
  *scene(name) {
    const S = this.story;
    const keys = ALIAS[name] || [name];
    if (keys.every((k) => this.set.has(k))) return;
    // only in free play (never on top of another cinematic); give up waiting after a while
    let t = 0;
    while ((S.state !== 'play' || S.cine?.active) && t < 20) t += yield 0;
    if (S.state !== 'play' || S.cine?.active || S.act !== 1) { this.unlock(keys); return; }
    const gen = { voice: this.voiceScene, spout: this.spoutScene, slap: this.slapScene, acro: this.acroScene, boom: this.boomScene }[SCENE_OF[keys[0]] || name];
    const herd = this.herd;
    const saved = { speed: herd.targetSpeed, mode: herd.mode };
    try {
      if (gen) yield* gen.call(this);
    } finally {
      this.qte().clear?.();
      if (S.cine?.active) S.cine.end();
      if (this._auto) { if (S.player.autopilot === this._auto) S.player.autopilot = this._prevAuto; this._auto = null; }
      herd.motherScript = null;
      if (herd.mode === saved.mode) herd.targetSpeed = saved.speed;
      this.unlock(keys);
    }
  }

  /** Steer the calf by hand for a scene (restored at its end). fn(dt) -> {swim, yaw, pitch, surge}. */
  _drive(fn) {
    const P = this.story.player;
    if (!this._auto) this._prevAuto = P.autopilot === this.story.cine?.carry ? this.story.cine?.held?.auto ?? null : P.autopilot;
    this._auto = fn;
    P.autopilot = fn;
  }

  _undrive() {
    const S = this.story, P = S.player;
    if (!this._auto) return;
    if (P.autopilot === this._auto) P.autopilot = S.cine?.held ? S.cine.carry : this._prevAuto;
    this._auto = null;
  }

  /** Aim the calf at a point (for _drive). */
  _toward(goal, swimFar = 1, near = 6) {
    const calf = this.herd.calf;
    const to = _v3.copy(goal).sub(calf.pos);
    const d = to.length();
    return { swim: d > near ? swimFar : 0.3, yaw: Math.atan2(to.x, to.z), pitch: Math.asin(clamp(to.y / Math.max(d, 1), -1, 1)) * 0.85, surge: d > 40 };
  }

  /** Mother flies on along the route at `speed`, beside her calf, her head turned to it. */
  _momBeside(speed, opts = {}) {
    const herd = this.herd, calf = herd.calf;
    const fwd = new Vector3();
    const tgt = new Vector3();
    return (m) => {
      fwd.copy(herd.frame?.fwd || m.fwd).setY(0);
      if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, 1);
      fwd.normalize();
      tgt.copy(m.pos).addScaledVector(fwd, 40);
      if (opts.y !== undefined) tgt.y = typeof opts.y === 'function' ? opts.y(m) : opts.y;
      return { target: tgt, speed, arrive: 10, minSpeed: Math.min(speed, 3), lookAt: opts.look ? opts.look() : calf.pos };
    };
  }

  _calfHead(out = this._at) {
    const c = this.herd.calf;
    return out.copy(c.pos).addScaledVector(c.fwd, c.L * 0.36).addScaledVector(c.up, c.L * 0.08);
  }

  // ---- VOICE: the Spiral Reach, her song across the morning sea ------------------------------------
  *voiceScene() {
    const S = this.story, g = this.game, herd = this.herd, mom = herd.mother, calf = herd.calf, C = S.cine;
    const Q = this.qte(), song = S.song;
    herd.targetSpeed = Math.min(herd.targetSpeed, 10);
    herd.motherScript = this._momBeside(10);
    C.begin({ focus: calf, rate: 0.5, lead: mom });
    C.sway = 1.2;
    const beat = song.key().beat;
    const head = () => this._calfHead();
    // 1. the pair over the sea, the camera on the calf's far side, her head turned toward it
    yield* C.play(C.rel({ subject: calf, side: [9, 6.5], up: [0.6, 1.4], back: [5, 3.5], ahead: [-2, 2], lookSide: [-6, -4], fov: [40, 34] }), 3.2);
    // 2. she breathes in and sings to it: two notes (close on her eye, her crest flaring)
    C.setFocus(mom);
    const phrase1 = [[0, 1.2], [2, 1.4]];
    const sing = function* (phrase, octave = -1) {
      for (const [deg, beats] of phrase) {
        mom.drive.sing = 1;
        mom.anim.sHeadPitch?.impulse?.(-1.1);
        yield beat * 0.3;
        S.voiceHum(mom, song.midi(deg, octave), (beats - 0.3) * beat * 0.95);
        mom.drive.hum = 1;
        yield (beats - 0.3) * beat;
      }
      mom.drive.sing = 0.4;
    };
    const eyeShot = C.eye({ whale: mom, side: 1, dist: [0.5, 0.4], fov: [34, 28] });
    S.script.run(sing(phrase1), 'abilitySing');
    yield* C.play(eyeShot, phrase1.reduce((a, n) => a + n[1], 0) * beat + 0.4);
    // 3. its turn: the camera finds the calf's face; it tries... (hold the cue)
    C.setFocus(calf);
    calf.drive.lookAt = mom.pos;
    const face = C.rel({ subject: calf, side: [3.4, 2.6], up: [0.5, 0.3], back: [-4.2, -3.4], ahead: 0.6, lookUp: 0.2, fov: [32, 28] });
    let h = Q.hold({ at: head, time: 1.1, grace: 4 });
    let prev = 0, croaked = false;
    yield* C.play(face, 9, {
      until: () => h.done,
      onFrame: () => {
        // the throat swells while the cue is held
        calf.drive.charge = h.progress * 0.25;
        calf.drive.sing = h.progress;
        if (!croaked && h.progress > 0.35 && h.progress > prev) {
          croaked = true;
          this._croak();
        }
        prev = h.progress;
      },
    });
    if (!croaked) this._croak();
    calf.drive.charge = 0;
    calf.drive.sing = 0;
    // a croak: the calf startles at its own voice, ducks its head; she coos, amused, and tries again
    yield* C.play(face, 1.8, { onFrame: (k, t) => { if (t > 0.6 && !this._cooed) { this._cooed = true; S.voiceCall(mom, 'coo'); mom.drive.happy = 1; } } });
    this._cooed = false;
    // 4. her phrase again, three notes now; this time each of her notes is held with her
    const phrase2 = [[0, 1.2], [2, 1.2], [4, 2]];
    C.setFocus(mom);
    S.script.run(sing(phrase2), 'abilitySing');
    yield* C.play(C.rel({ subject: mom, side: [-14, -11], up: [2, 3], back: [-10, -6], ahead: 4, lookUp: 1, fov: [36, 32] }), phrase2.reduce((a, n) => a + n[1], 0) * beat + 0.3);
    // the calf answers, note by note: hold each one as long as she did
    C.setFocus(calf);
    const two = C.rel({ subject: calf, side: 8.5, up: 1.4, back: 1, ahead: -1.5, lookSide: -4, fov: 38 });
    let good = 0;
    const v = S.voiceOf(calf);
    for (let i = 0; i < phrase2.length; i++) {
      const [deg, beats] = phrase2[i];
      const dur = beats * beat;
      h = Q.hold({ at: head, time: Math.max(0.6, dur * 0.75), grace: 2.6 });
      let on = false, t0 = 0;
      const midi = song.midi(deg, 1);
      yield* C.play(two, 6, {
        ease: (x) => x,
        until: () => h.done,
        onFrame: (k, t) => {
          const holding = h.progress > prev + 1e-5 || (h.progress >= 1);
          prev = h.progress;
          if (holding && !on) { on = true; t0 = t; v.hum?.(midi, undefined, { gain: 1, glideFrom: midi - 2 }); calf.drive.hum = 1; S.humTimers.set(calf, 99); }
          if (!holding && on && t - t0 > 0.25) { on = false; v.release?.(0.2); S.humTimers.set(calf, 0.05); }
          calf.drive.sing = on ? 1 : 0.3;
        },
      });
      if (!on) v.hum?.(midi, undefined, { gain: h.ok ? 1 : 0.55, glideFrom: midi - 2 });
      calf.drive.hum = 1;
      S.humTimers.set(calf, 99);
      if (h.ok) good++;
      // her voice joins it under the note
      S.voiceHum(mom, song.midi(deg, -1), dur * 0.9);
      mom.drive.hum = 1;
      yield* C.wait(Math.min(dur * 0.6, 0.8));
      v.release?.(0.3);
      S.humTimers.set(calf, 0.05);
      prev = 0;
      yield* C.wait(0.15);
    }
    // 5. a true voice: her answer swells, the herd joins in harmony, the camera rises and lets them go
    calf.drive.happy = 1;
    mom.drive.happy = 1;
    S.audio.stinger?.('harmony');
    G.uSongRipple.value.set(calf.pos.x, calf.pos.y, calf.pos.z, g.time);
    G.uSongAmp.value = 0.6 + 0.2 * good;
    S.voiceHum(mom, song.midi(4, -1), beat * 4);
    S.voiceHum(calf, song.midi(4, 1), beat * 3.5);
    herd.adults.forEach((w, i) => {
      if (w === mom || i > 4) return;
      S.script.run((function* () { yield 0.25 + i * 0.18; S.voiceHum(w, song.midi([0, 2, 4][i % 3], -2), beat * 3); w.drive.sing = 0.8; })(), 'abilityHarmony');
    });
    C.slowmo(0.75);
    C.setFocus(calf);
    yield* C.play(C.blend(two, C.orbit({ center: calf, radius: [14, 34], height: [3, 16], angle: [calf.yaw - 0.9, calf.yaw - 0.5], fov: [42, 46], look: mom })), 4.2);
    C.slowmo(1);
    G.uSongAmp.value = 0;
    for (const w of herd.adults) w.drive.sing = 0;
    calf.drive.sing = 0;
    C.end({ rate: 0.45 });
  }

  /** The first try: a cracked croak that gives out. */
  _croak() {
    const S = this.story, calf = this.herd.calf, v = S.voiceOf(calf), song = S.song;
    const m = song.midi(0, 0);
    v.hum?.(m - 5, 0.32, { gain: 0.75, glideFrom: m + 4 });
    S.audio?.sfx?.('bonk', { position: calf.pos, gain: 0.18, pitch: 0.7 });
    calf.drive.hum = 1;
    S.humTimers.set(calf, 0.35);
    calf.anim.flinch?.(0.6);
    calf.anim.sHeadPitch?.impulse?.(1.8);
    this.game.cameraRig?.addShake?.(0.05);
  }

  // ---- SPOUT: the Feasting Shoals, a breath at the surface ---------------------------------------
  *spoutScene() {
    const S = this.story, g = this.game, herd = this.herd, mom = herd.mother, calf = herd.calf, C = S.cine;
    const Q = this.qte();
    // the pair settles onto the sea
    herd.targetSpeed = Math.min(herd.targetSpeed, 5);
    herd.motherScript = this._momBeside(4, { y: (m) => seaHeight(g, m.pos.x, m.pos.z) + m.radius * 0.15 });
    C.begin({ focus: mom, rate: 0.5, lead: mom });
    // 1. down to the water: a long low glide beside them
    yield* C.play(C.low({ subject: mom, side: [44, 34], back: [-30, -10], height: [2.5, 1.2], fov: [40, 34], lookUp: [2, 4] }), 3.6);
    // 2. her spout: a tall column against the sun, the camera low at the waterline
    const bh = () => (mom.model.blowholePos ? mom.model.blowholePos(_v) : _v.copy(mom.pos).addScaledVector(mom.up, mom.radius));
    let blown = false;
    yield* C.play(C.low({ subject: mom, side: [26, 22], back: [8, 14], height: [0.8, 0.6], fov: [38, 34], lookUp: [3, 7] }), 3.2, {
      onFrame: (k, t) => {
        if (!blown && t > 0.6) {
          blown = true;
          const p = mom.blow?.(g, 1.5) || bh();
          spoutColumn(g, p, mom, 1.4);
          S.audio?.sfx?.('spout', { position: p, gain: 1 });
          calf.drive.lookAt = p.clone();
          calf.drive.excite = 1;
        }
      },
    });
    // 3. the calf: breathe in (hold), blow (press). The first one only sputters.
    C.setFocus(calf);
    const close = C.rel({ subject: calf, side: 2.9, up: 1.6, back: 2.9, ahead: 0.4, lookUp: 0.4, fov: 32 });
    let good = false;
    for (let tries = 0; tries < 2 && !good; tries++) {
      const hin = Q.hold({ at: () => (calf.model.blowholePos ? calf.model.blowholePos(this._at) : this._calfHead()), time: 1.0, grace: 3.5 });
      yield* C.play(close, 7, { until: () => hin.done, onFrame: () => { calf.drive.charge = hin.progress * 0.15; } });
      calf.drive.charge = 0;
      const hp = Q.press({ at: () => (calf.model.blowholePos ? calf.model.blowholePos(this._at) : this._calfHead()), lead: 0.9, window: 0.4 });
      yield* C.play(close, 3, { until: () => hp.done });
      const p = calf.model.blowholePos ? calf.model.blowholePos(new Vector3()) : this._calfHead(new Vector3());
      if (tries === 0 || !(hp.ok || hin.ok)) {
        // a sputter: a wet sneeze and a dribble of spray; she rumbles, amused
        calf.blow?.(g, 0.2);
        S.audio?.sfx?.('spout', { position: p, gain: 0.25, pitch: 1.8 });
        calf.anim.flinch?.(0.5);
        calf.anim.sHeadPitch?.impulse?.(1.5);
        yield* C.play(close, 1.2, { onFrame: (k, t) => { if (t > 0.5 && !this._cooed) { this._cooed = true; S.voiceCall(mom, 'coo'); mom.drive.happy = 1; } } });
        this._cooed = false;
        if (tries === 1) good = true; // a second miss: it still gets there, a little smaller
        else continue;
      }
      good = true;
      // its first real spout, in slow motion from the waterline
      C.slowmo(0.45);
      const k = hp.ok ? 1.1 : 0.75;
      const at = calf.blow?.(g, k) || p;
      spoutColumn(g, at, calf, k);
      S.audio?.sfx?.('spout', { position: at, gain: 0.9, pitch: 1.25 });
      S.audio.stinger?.('discover');
      S.voiceCall(calf, 'chirp');
      calf.drive.happy = 1;
      mom.drive.happy = 1;
      yield* C.play(C.low({ subject: calf, side: [7, 9], back: [-5, -7], height: [0.5, 0.7], fov: [36, 40], lookUp: [1.5, 4] }), 2.6);
      C.slowmo(1);
      S.voiceCall(mom, 'answer');
    }
    C.end({ rate: 0.45 });
  }

  // ---- SLAP: the Coil Forest, flukes on the water --------------------------------------------------
  *slapScene() {
    const S = this.story, g = this.game, herd = this.herd, mom = herd.mother, calf = herd.calf, C = S.cine;
    const Q = this.qte();
    const lowY = (m) => seaHeight(g, m.pos.x, m.pos.z) + m.radius * 0.55;
    herd.targetSpeed = Math.min(herd.targetSpeed, 7);
    herd.motherScript = this._momBeside(6, { y: lowY });
    C.begin({ focus: mom, rate: 0.5, lead: mom });
    // 1. she lifts her flukes high behind her and brings them down: a boom through the forest
    const flukes = (w, out) => (w.model.flukePos ? w.model.flukePos(null, out) : out.copy(w.pos).addScaledVector(w.fwd, -w.L * 0.46));
    yield* C.play(C.rel({ subject: mom, side: [-26, -22], up: [2.5, 1.5], back: [24, 18], ahead: -6, lookUp: 1, fov: [40, 36], worldUp: true }), 1.2);
    mom.anim.gesture?.('tailSlap', { speed: 1.2 });
    const G0 = mom.anim.gest;
    const hitT = G0 ? G0.dur * (G0.event ?? 0.68) : 1.9;
    let hit = false;
    yield* C.play(C.rel({ subject: mom, side: [-22, -18], up: [1.2, 0.8], back: [20, 26], ahead: -10, lookUp: 0, fov: [36, 32], worldUp: true }), hitT + 1.6, {
      onFrame: (k, t) => {
        if (!hit && t >= hitT) {
          hit = true;
          const p = flukes(mom, new Vector3());
          p.y = seaHeight(g, p.x, p.z);
          g.ocean?.splash?.(p, 2.2, mom.L * 0.6, _v2.copy(mom.up).multiplyScalar(1.3).addScaledVector(mom.fwd, -0.6));
          S.player?.moves?._spray?.(p, 2.2, 70, 1.6, _v2);
          S.audio?.sfx?.('tailSlap', { position: p, gain: 1.2, pitch: 0.8 });
          S.eco?.scatter?.(p, 60, 1.2);
          g.cameraRig?.addShake?.(0.35);
          C.slowmo(0.5);
        }
      },
    });
    C.slowmo(1);
    S.voiceCall(mom, 'answer');
    // 2. the calf's turn: its flukes rise; act when they reach the top
    C.setFocus(calf);
    herd.motherScript = this._momBeside(5, { y: lowY });
    let good = false;
    for (let tries = 0; tries < 2 && !good; tries++) {
      calf.anim.gesture?.('tailSlap', { speed: 1.9 });
      const Gc = calf.anim.gest;
      const lead = Gc ? Gc.dur * (Gc.event ?? 0.68) : 1.2;
      const h = Q.press({ at: () => flukes(calf, this._at), lead, window: 0.4 });
      const cam = C.rel({ subject: calf, side: [5.5, 4.5], up: [0.5, 0.3], back: [6, 7.5], ahead: -2.5, lookUp: 0.3, fov: [34, 30], worldUp: true });
      yield* C.play(cam, lead + 1.2, { until: () => h.done });
      const sea = seaHeight(g, calf.pos.x, calf.pos.z);
      if (h.ok) {
        good = true;
        C.slowmo(0.45);
        S.player?.moves?._slapHit?.(sea);
        S.audio.stinger?.('discover');
        calf.drive.happy = 1;
        yield* C.play(C.low({ subject: calf, side: [6, 8], back: [8, 5], height: [0.4, 0.6], fov: [32, 38], lookUp: 0.5 }), 2.2);
        C.slowmo(1);
      } else {
        // a feeble flick: a plip of spray; she nods, try again
        const p = flukes(calf, new Vector3());
        p.y = sea;
        g.ocean?.splash?.(p, 0.35, calf.L * 0.3, UP);
        S.audio?.sfx?.('tailSlap', { position: p, gain: 0.25, pitch: 1.7 });
        yield* C.play(cam, 1.4, { onFrame: (k, t) => { if (t > 0.4 && !this._cooed) { this._cooed = true; S.voiceCall(mom, 'coo'); mom.anim.sHeadPitch?.impulse?.(1.2); } } });
        this._cooed = false;
        if (tries === 1) {
          good = true;
          S.player?.moves?._slapHit?.(sea);
          yield* C.wait(1);
        }
      }
    }
    S.voiceCall(mom, 'answer');
    mom.drive.happy = 1;
    C.end({ rate: 0.45 });
  }

  // ---- LOOP / DASH / BREACH: the Night Passage, out through the glowing sea ----------------------
  *acroScene() {
    const S = this.story, g = this.game, herd = this.herd, mom = herd.mother, calf = herd.calf, C = S.cine;
    const Q = this.qte();
    herd.targetSpeed = Math.min(herd.targetSpeed, 9);
    // she drops to the sea and slides under it, calling her calf down after her
    const under = (m) => seaHeight(g, m.pos.x, m.pos.z) - m.radius * 1.8;
    herd.motherScript = this._momBeside(8, { y: under });
    S.voiceCall(mom, 'play');
    C.begin({ focus: mom, rate: 0.6, lead: mom });
    yield* C.play(C.track({ subject: mom, side: [-34, -26], up: [5, 2], ahead: [8, 16], fov: [44, 40] }), 2.6);
    C.end({ rate: 0.8 });
    // 1. follow her down (steer)
    const down = new Vector3();
    const dirDown = () => down.copy(calf.fwd).setY(0).normalize().multiplyScalar(0.6).add(_v.set(0, -0.8, 0)).normalize();
    const hs = Q.steer({ dir: dirDown(), from: calf.pos, time: 4, tol: 0.6 });
    let t = 0;
    while (!hs.done) t += yield 0;
    // whatever the player did, the calf goes down after her (gently guided)
    const sea0 = () => seaHeight(g, calf.pos.x, calf.pos.z);
    const goalDown = new Vector3();
    this._drive(() => {
      goalDown.copy(calf.pos).addScaledVector(_v.copy(calf.fwd).setY(0).normalize(), 14);
      goalDown.y = sea0() - 10;
      return this._toward(goalDown, 1, 2);
    });
    t = 0;
    while ((sea0() - calf.pos.y < 8.5) && t < 7) t += yield 0;
    // 2. race up: mash to drive the flukes; the plankton blazes in its wake
    this.unlock(['breach'], false);
    const goalUp = new Vector3();
    let power = 0;
    this._drive(() => {
      goalUp.copy(calf.pos).addScaledVector(_v.copy(calf.fwd).setY(0).normalize(), 6);
      goalUp.y = calf.pos.y + 20;
      const a = this._toward(goalUp, 1, 1);
      a.pitch = 1.05;
      a.surge = true;
      return a;
    });
    S.player.enabled = false;
    const hm = Q.mash({ at: () => this._calfHead(), need: 8, time: 3.2, onPress: () => { calf.vel.addScaledVector(calf.fwd, 1.1); power += 1; } });
    C.begin({ focus: calf, rate: 1.2, hold: false });
    const shot = C.rel({ subject: calf, side: [6, 4], up: [-2.5, -1], back: [7, 5], ahead: 3, lookUp: [2, 6], fov: [44, 38], worldUp: true });
    t = 0;
    let crossed = false;
    while (t < 6) {
      const dt = yield 0;
      t += dt;
      shot(clamp(t / 3, 0, 1), t, C.shot);
      C.handheld(C.shot, 1.3);
      // never too slow to break out: a softer leap with no mashing
      if (calf.vel.y < 6 + Math.min(power, 8) * 0.9) calf.vel.y += dt * 9;
      if (sea0() - calf.pos.y < 1.5) { crossed = true; break; }
    }
    if (!hm.done) hm.cancel?.();
    // 3. out under the galaxy: slow motion at the waterline, glowing water streaming off it
    C.slowmo(0.35);
    S.audio.stinger?.('discover');
    const lowShot = C.low({ subject: calf, side: [9, 7], back: [-6, 2], height: [0.5, 0.9], fov: [40, 46], lookUp: [3, 8] });
    let spun = false;
    let hp = null;
    t = 0;
    while (t < 3.4 && !C.skipped) {
      const dt = yield 0;
      t += g.dtReal ?? dt;
      lowShot(clamp(t / 3.4, 0, 1), t, C.shot);
      C.handheld(C.shot, 1);
      // at the top of the arc: twist (press)
      if (!hp && crossed && calf.pos.y > sea0() + 1) hp = Q.press({ at: () => this._calfHead(), lead: 0.8, window: 0.45 });
      if (hp && hp.done && !spun) {
        spun = true;
        if (hp.ok && calf.barrelRoll(1)) { S.player.emit('roll', 1); calf.drive.happy = 1; }
      }
    }
    this._undrive();
    S.player.enabled = S.state === 'play';
    S.player.syncAim?.();
    C.slowmo(1);
    this.unlock(['loop', 'dash'], false);
    S.voiceCall(mom, 'play');
    calf.drive.happy = 1;
    C.end({ rate: 0.6 });
    herd.motherScript = null;
  }

  // ---- BOOM: the Storm, alone in the dark ----------------------------------------------------------
  *boomScene() {
    const S = this.story, g = this.game, herd = this.herd, mom = herd.mother, calf = herd.calf, C = S.cine;
    const Q = this.qte();
    // she is lost in the rain beyond the next squall line (held away until she hears it)
    const far = new Vector3();
    const dirAway = _v.copy(mom.pos).sub(calf.pos).setY(0);
    if (dirAway.lengthSq() < 1) dirAway.set(1, 0, 0);
    dirAway.normalize();
    herd.motherScript = (m) => { far.copy(calf.pos).addScaledVector(dirAway, 150); far.y = Math.max(calf.pos.y + 10, seaHeight(g, far.x, far.z) + 20); return { target: far, speed: 12, arrive: 30, lookAt: far }; };
    C.begin({ focus: calf, rate: 0.7 });
    this._drive(() => ({ swim: 0.25, yaw: calf.yaw, pitch: 0 }));
    S.audio.setIntensity?.(0.4);
    // 1. alone: it calls into the rain; nothing answers but the thunder
    const lonely = C.rel({ subject: calf, side: [-9, -6], up: [2, 1], back: [9, 6], ahead: 2, lookUp: 0.5, fov: [44, 36], worldUp: true });
    let called = 0;
    yield* C.play(lonely, 3.4, {
      onFrame: (k, t) => {
        if (called === 0 && t > 0.4) { called = 1; S.voiceCall(calf, 'chirp'); }
        if (called === 1 && t > 2.2) { called = 2; S.voiceCall(calf, 'coo'); S.weather?.strike?.(calf.pos.clone().add(_v2.set(-160, 180, -220))); }
      },
    });
    // 2. it gathers its voice: hold. The throat swells and glows, the rain bends around it.
    const front = () => this._at.copy(calf.pos).addScaledVector(calf.fwd, calf.L * 0.55);
    const push = C.rel({ subject: calf, side: [4.2, 2.6], up: [0.4, 0.2], back: [-3.2, -2.2], ahead: 0.6, fov: [36, 28], worldUp: true });
    let power = 0.35;
    for (let tries = 0; tries < 2; tries++) {
      const h = Q.hold({ at: front, time: 2.0, grace: 4 });
      yield* C.play(push, 8, {
        until: () => h.done,
        onFrame: () => {
          const ch = h.progress;
          calf.drive.charge = ch;
          S.voiceOf(calf).setChargeLevel?.(ch);
          S.booms.charge = ch > 0.02 ? { pos: front().clone(), amount: ch } : null;
          g.cameraRig?.addShake?.(ch * 0.012);
        },
      });
      calf.drive.charge = 0;
      S.voiceOf(calf).setChargeLevel?.(0);
      S.booms.charge = null;
      if (h.ok) { power = 1.2; break; }
      // it lets go too soon: a little pop of air; it shakes itself and tries again
      const p = front().clone();
      S.booms.spawn(p, { power: 0.25, radius: 10, source: calf });
      S.audio?.sfx?.('boomSmall', { position: p, gain: 0.35, pitch: 1.4 });
      calf.anim.flinch?.(0.6);
      power = tries === 0 ? 0.35 : 0.8;
      if (tries === 1) break;
      yield* C.wait(0.6);
    }
    // 3. the first boom: slow motion as the front tears through the rain and out over the sea
    this.unlock(['boom'], false);
    const p = front().clone();
    calf.anim.blast?.(0.8 + power * 0.5);
    S.voiceCall(calf, 'roar');
    const b = S.booms.spawn(p, { power, radius: 40 + 60 * power, speed: 90, source: calf });
    if (b) b.knockFalcon = 0.5 + power * 0.6;
    S.audio?.sfx?.('boom', { position: p, gain: 0.7 + power * 0.4 });
    S.audio.stinger?.('boom');
    S.audio.duck?.(0.45, 1.4);
    S.eco?.scatter?.(p, 80, power);
    calf.vel.addScaledVector(calf.fwd, -6 * power);
    g.cameraRig?.addShake?.(0.5 + power * 0.3);
    C.slowmo(0.3);
    yield* C.play(C.blend(push, C.orbit({ center: calf, radius: [16, 70], height: [2, 26], angle: [calf.yaw + 2.4, calf.yaw + 2.0], fov: [40, 52], look: calf })), 3.2);
    C.slowmo(1);
    // 4. far off, through the rain, she hears it: her answering roar, and she turns
    herd.motherScript = null;
    S.voiceCall(mom, 'roar');
    mom.anim.blast?.(0.9);
    mom.drive.fear = 0.6;
    S.booms.spawn(mom.pos.clone().addScaledVector(mom.fwd, mom.L * 0.5), { power: 1, radius: 80, source: mom });
    C.setFocus(mom);
    yield* C.play(C.rel({ subject: calf, side: [2.5, 3], up: [1, 1.4], back: [5, 6], ahead: 0, lookSide: 0, fov: [30, 26], frame: () => ({ fwd: _v3.copy(mom.pos).sub(calf.pos).normalize() }) }), 2.4, { onFrame: () => { calf.drive.lookAt = mom.pos; } });
    this._undrive();
    C.end({ rate: 0.5 });
  }
}
