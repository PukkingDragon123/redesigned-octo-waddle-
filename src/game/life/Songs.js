// Singing, the heart of the whale's life (the user's "more songs, the whale singing instrument really
// cool, more singing QTE"). Wordless call-and-response scenes across the whole life, each a short
// film: a phrase is sung to you (the singer inhales, the crest flares, the notes land on the score's
// beat), then a hold cue (src/game/QTE.js) for each note of your answer: hold it and your whale sings
// it, as long as the cue fills. A held note is answered by the world; a missed one slips out thin and
// the song simply carries on (no fail state; ?auto always succeeds).
//   herd     ACT I, the Herd Song (ch4): the mother and the elder call, the calf answers; every note it
//            holds brings one more adult in, until the whole ring sings and the clouds ripple
//   plankton ACT I, Night Passage (ch5): low over the black sea; each held note sends a wave of
//            plankton light racing out across the water; the mother's voice joins on the second phrase
//   duet     ACT II, courtship: her phrase, your answer, three times, then one long note together in
//            harmony, a crescendo, the camera circling the pair as they rise
//   lullaby  ACT III: the egg in the whirlpool's eye; its light pulses a rhythm, you sing it back, and
//            the embryo inside glows and settles with each note
//   lastSong ACT IV: the elder sings, the herd answers each phrase with more voices, the final note
//            held under the galaxy as everyone joins
// Every shot goes through clearCam (never inside a body, rock or the sea floor); faces through faceShot.
// Debug: ?debug&chapter=4&scene=herd | ?debug&chapter=5&scene=plankton (acts II-IV run in their acts:
// ?debug&act=2|3|4 with ?auto reaches them); story.songs.cur names the scene playing.
import { Vector3 } from 'three';
import { clamp, lerp, smoothstep } from '../../core/math.js';
import { seaHeight } from '../Swim.js';
import { G } from '../../render/Globals.js';
import { clearCam, faceShot } from '../Abilities.js';

const _v = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const UP = new Vector3(0, 1, 0);
const TEAL = [0.35, 1.0, 0.85];
const GOLD = [1.0, 0.82, 0.55];

export class Songs {
  constructor(story) {
    this.story = story;
    this.game = story.game;
    this.cur = null;
    this.log = [];
    this._hits = 0;
    this._at = new Vector3();
  }

  get herd() { return this.story.herd; }

  // ---- helpers ------------------------------------------------------------------------------------
  /** C.play with the camera kept clear of bodies, rock and the sea floor. */
  _play(fn, dur, opts = {}) {
    const S = this.story;
    return S.cine.play((k, t, s) => { fn(k, t, s); clearCam(S, s); }, dur, opts);
  }

  qte() {
    const q = this.game.qte;
    if (q) return q;
    const done = () => ({ done: true, ok: true, score: 1, progress: 1, cancel() {} });
    return { hold: done, press: done, *wait(h) { return h; }, clear() {} };
  }

  key() { return this.story.song.key(); }
  midi(deg, oct = 0) { return this.story.song.midi(deg, oct); }

  /** One sung note: the new singing voice when the audio has it, else the hum. */
  sing(w, midi, dur, opts = {}) {
    const S = this.story, v = S.voiceOf(w);
    if (v?.sing) {
      try { v.sing(midi, { dur, vowel: opts.vowel || 'ah', intensity: opts.intensity ?? 0.85 }); } catch (e) { S.voiceHum(w, midi, dur); }
      w.drive.hum = 1;
      S.humTimers.set(w, dur);
    } else S.voiceHum(w, midi, dur);
    w.drive.sing = Math.max(w.drive.sing, 0.8);
  }

  head(w, out = this._at) {
    const sc = w.group.scale?.x || 1;
    return out.copy(w.pos).addScaledVector(w.fwd, w.L * sc * 0.36).addScaledVector(w.up, w.L * sc * 0.08);
  }

  /** Which side of `w` faces `p` (+1 its right, -1 its left). */
  sideToward(w, p) { return _v.copy(p).sub(w.pos).dot(w.right) >= 0 ? 1 : -1; }

  /** Two whales in one frame, from the side of the line between them (side +1/-1), a little high. */
  pairShot(a, b, { side = 1, dist = 1.15, up = 0.25, lookUp = 0, fov = 40, min = 10 } = {}) {
    const mid = new Vector3(), perp = new Vector3();
    const R = (v, k) => (Array.isArray(v) ? lerp(v[0], v[1], k) : v);
    return (k, t, s) => {
      const A = a.pos || a, B = b.pos || b;
      mid.copy(A).lerp(B, 0.5);
      perp.copy(B).sub(A);
      const sep = Math.max(perp.length(), 1);
      perp.cross(UP).normalize().multiplyScalar(side);
      const d = Math.max(min, sep * R(dist, k) + (a.L || 4) * 0.6);
      s.pos.copy(mid).addScaledVector(perp, d).addScaledVector(UP, d * R(up, k));
      s.look.copy(mid);
      s.look.y += R(lookUp, k);
      s.fov = R(fov, k);
      s.roll = 0;
    };
  }

  /** The singer's phrase (a coroutine): inhale, crest, each note on the beat. onNote(i, midi, dur). */
  *phrase(w, phrase, octave = -1, opts = {}) {
    const S = this.story, beat = this.key().beat;
    yield* S.untilNextBeat(beat * 1.5, beat * 0.35);
    for (let i = 0; i < phrase.length; i++) {
      const [deg, beats] = phrase[i];
      w.drive.sing = 1;
      w.anim.sHeadPitch?.impulse?.(-1.1);
      yield beat * 0.3;
      const midi = this.midi(deg, octave), dur = (beats - 0.3) * beat;
      this.sing(w, midi, dur * 0.95, { vowel: opts.vowel });
      opts.onNote?.(i, midi, dur);
      yield dur;
    }
    w.drive.sing = 0.4;
  }

  /**
   * Your answer (a coroutine): one hold cue per note, each opening on the beat where that note falls.
   * While the cue fills, `singer` sings the note. onNote(i, ok, midi, dur) after each; onHold(i, k).
   * Leaves the number of held notes in this._hits.
   */
  *answer(singer, phrase, octave = 1, opts = {}) {
    const S = this.story, g = this.game, Q = this.qte(), beat = this.key().beat, v = S.voiceOf(singer);
    this._hits = 0;
    yield* S.untilNextBeat(beat * 1.2);
    let next = g.time;
    for (let i = 0; i < phrase.length; i++) {
      const [deg, beats] = phrase[i];
      const dur = beats * beat, midi = this.midi(deg, octave);
      const wait = next - g.time - 0.12;
      if (wait > 0) yield wait;
      const h = Q.hold({ at: opts.at || (() => this.head(singer)), time: Math.max(0.45, dur * 0.62), grace: Math.max(0.7, beat * 1.1), size: opts.size });
      let singing = false, prev = 0, tt = 0;
      while (!h.done && tt < dur + beat * 2) {
        const dt = yield 0;
        tt += dt;
        const rising = h.progress > prev + 1e-5;
        prev = h.progress;
        if (rising && !singing) {
          singing = true;
          v?.hum?.(midi, undefined, { gain: 1, glideFrom: midi - 2 });
          singer.drive.hum = 1;
          S.humTimers.set(singer, 99);
        }
        singer.drive.sing = singing ? 1 : 0.4;
        opts.onHold?.(i, h.progress);
      }
      if (!singing) v?.hum?.(midi, undefined, { gain: h.ok ? 0.9 : 0.45, glideFrom: midi - 3 });
      singer.drive.hum = 1;
      S.humTimers.set(singer, 99);
      if (h.ok) this._hits++;
      opts.onNote?.(i, h.ok, midi, dur);
      yield Math.min(0.45, dur * 0.35);
      v?.release?.(0.3);
      S.humTimers.set(singer, 0.05);
      singer.drive.sing = 0.3;
      next = Math.max(g.time + beat * 0.25, next + dur);
    }
  }

  /** Run a coroutine as its own task while the camera plays `shot`; returns when the task ends. */
  *_with(gen, shot, maxT = 40, name = 'songPart') {
    const S = this.story;
    const task = S.script.run(gen, name);
    yield* this._play(shot, maxT, { until: () => task.done });
    // a skip ends the shot early: let the part finish quietly
    while (!task.done) yield 0;
  }

  /** Played in the last minute or so (a debug jump may already have played the chapter's song). */
  recent(name) { return this.game.time - (this.played?.[name] ?? -999) < 90; }

  _begin(name) {
    (this.played ||= {})[name] = this.game.time;
    this.cur = name;
    this.log.push({ t: this.game.time, name });
    this.story.song.active = true;
  }

  _end() {
    const S = this.story;
    this.cur = null;
    S.song.active = false;
    G.uSongAmp.value = 0;
    if (S.eco) { S.eco.songFocus = null; S.eco.songRadius = 16; }
    for (const w of S.herd.whales) { w.drive.sing = 0; }
    this.qte().clear?.();
  }

  /** The clouds and sea ripple out from p; the score lifts. */
  _ripple(p, amp) {
    G.uSongRipple.value.set(p.x, p.y, p.z, this.game.time);
    G.uSongAmp.value = Math.max(G.uSongAmp.value, amp);
  }

  // ---- 1. ACT I · THE HERD SONG ---------------------------------------------------------------------
  *herdSong() {
    const S = this.story, g = this.game, herd = this.herd, mom = herd.mother, calf = herd.calf, elder = herd.elder, C = S.cine;
    this._begin('herd');
    S.audio.setMood?.('song', { fade: 5 });
    S.audio.setIntensity?.(0.15);
    const center = (herd.songCenter || calf.pos).clone();
    this._ripple(center, 0.3);
    if (S.eco) { S.eco.songFocus = center; S.eco.songRadius = 44; }
    C.begin({ focus: calf, rate: 0.45, lead: mom });
    // the elder's low drone opens it; the ring of whales settles in the golden light
    S.voiceHum(elder, this.midi(0, -2), 7);
    const a0 = Math.atan2(calf.pos.z - center.z, calf.pos.x - center.x);
    yield* this._play(C.orbit({ center, radius: [150, 115], height: [34, 16], angle: [a0 + 0.5, a0 + 0.8], fov: [46, 42], look: center }), 4);
    const PH = [[[0, 1], [2, 1]], [[4, 1], [2, 1], [0, 2]], [[0, 1], [2, 1], [4, 1], [5, 1]], [[7, 2], [4, 1], [5, 1], [4, 2]]];
    const joiners = herd.adults.filter((w) => w !== mom && w !== elder);
    let chorus = 0;
    for (let pi = 0; pi < PH.length; pi++) {
      const caller = pi % 2 ? elder : mom;
      caller.drive.lookAt = calf.pos;
      // the caller sings to the calf (close on its face, the crest flaring)
      C.setFocus(caller);
      const side = this.sideToward(caller, calf);
      yield* this._with(this.phrase(caller, PH[pi], -1), faceShot(caller, { side, dist: [1.25, 1.05], around: [0.45, 0.7], up: 0.12, fov: [36, 33] }));
      // its turn: the calf with the caller beyond, over its shoulder
      C.setFocus(calf);
      const shot = (k, t, s) => {
        _v.copy(calf.pos).sub(caller.pos).setY(0);
        if (_v.lengthSq() < 1) _v.copy(calf.fwd);
        _v.normalize();
        _v2.crossVectors(_v, UP).normalize();
        s.pos.copy(calf.pos).addScaledVector(_v, lerp(9, 7, k)).addScaledVector(_v2, 3.5).addScaledVector(UP, 2.2);
        s.look.copy(calf.pos).lerp(caller.pos, 0.35);
        s.fov = lerp(42, 38, k);
        s.roll = 0;
      };
      yield* this._with(this.answer(calf, PH[pi], 1, {
        onNote: (i, ok, midi, dur) => {
          if (!ok) return;
          // a held note brings one more voice into the ring
          chorus++;
          const w = joiners[(chorus - 1) % Math.max(1, joiners.length)] || mom;
          this.sing(w, this.midi([0, 4, 2, 7][chorus % 4], -2), dur * 2.2, { vowel: 'oh', intensity: 0.6 });
          w.drive.sing = 0.8;
          this._ripple(calf.pos, Math.min(1.6, 0.35 + chorus * 0.1));
          S.audio.setIntensity?.(Math.min(1, 0.2 + chorus * 0.06));
          calf.drive.happy = 1;
        },
      }), shot);
      // the ring answers the whole phrase in harmony
      if (this._hits >= PH[pi].length - 1) {
        const chord = [0, 2, 4];
        herd.adults.forEach((w, i) => { if (i < 6) this.sing(w, this.midi(chord[i % 3] + (i % 2 ? 7 : 0), -2), this.key().beat * 3, { vowel: 'oh', intensity: 0.55 }); });
        S.audio.stinger?.('harmony');
      }
      yield* C.wait(this.key().beat * 1.2);
    }
    // the finale: one long note, everyone with it; the camera rises out of the ring
    const beat = this.key().beat;
    S.audio.setIntensity?.(1);
    herd.whales.forEach((w, i) => {
      if (w === calf) return;
      this.sing(w, this.midi([0, 4, 2, 7, 9][i % 5], w.isCalf ? 1 : -2 + (i % 2)), beat * 8, { vowel: 'ah', intensity: 0.8 });
      w.drive.sing = 1;
    });
    this._ripple(center, 2);
    S.audio.stinger?.('harmony');
    yield* this._with(this.answer(calf, [[0, 6]], 1, { onHold: (i, k) => { G.uSongAmp.value = 1 + k; } }),
      C.orbit({ center: calf, radius: [16, 60], height: [3, 34], angle: [calf.yaw + 2.2, calf.yaw + 1.6], fov: [40, 50], look: center }));
    yield* this._play(C.orbit({ center: calf, radius: [60, 150], height: [34, 90], angle: [calf.yaw + 1.6, calf.yaw + 1.2], fov: [50, 54], look: center }), 4);
    calf.drive.happy = mom.drive.happy = 1;
    this._end();
    C.end({ rate: 0.4 });
  }

  // ---- 2. ACT I · SINGING TO THE PLANKTON ------------------------------------------------------------
  /** A wave of light across the night sea, out from p along dir (k 0..1 its strength). */
  lightWave(p, dir, k = 1) {
    const S = this.story, g = this.game, oc = g.ocean;
    const d = _v3.copy(dir).setY(0);
    if (d.lengthSq() < 1e-4) d.set(0, 0, 1);
    d.normalize();
    const start = p.clone();
    const dd = d.clone();
    S.script.run((function* () {
      for (let i = 0; i < 9; i++) {
        const q = _v.copy(start).addScaledVector(dd, 6 + i * 9);
        q.y = seaHeight(g, q.x, q.z);
        oc?.ringWave?.(q, 0.35 + 0.5 * k, 10 + i * 2.5);
        const n = 6 + i;
        for (let j = 0; j < n; j++) {
          const side = (j / (n - 1) - 0.5) * (8 + i * 4);
          _v2.copy(q).addScaledVector(_v3.set(-dd.z, 0, dd.x), side);
          _v2.y = seaHeight(g, _v2.x, _v2.z) + 0.15;
          g.glow?.emit?.({ pos: _v2.clone(), vel: new Vector3(dd.x * 2, 0.15, dd.z * 2), life: 2.2 + Math.random(), size: 0.35 + Math.random() * 0.4, sizeEnd: 0.1, color: TEAL, alpha: 0.85 * k, drag: 0.8, kind: 0, fadeIn: 0.15 });
        }
        yield 0.09;
      }
    })(), 'songWave');
  }

  *planktonSong() {
    const S = this.story, g = this.game, herd = this.herd, mom = herd.mother, calf = herd.calf, C = S.cine;
    this._begin('plankton');
    const speed0 = herd.targetSpeed;
    herd.targetSpeed = Math.min(herd.targetSpeed, 9);
    // low over the black water, side by side
    const fwd = new Vector3(), tgt = new Vector3();
    herd.motherScript = (m) => {
      fwd.copy(herd.frame?.fwd || m.fwd).setY(0).normalize();
      tgt.copy(m.pos).addScaledVector(fwd, 40);
      tgt.y = seaHeight(g, tgt.x, tgt.z) + m.radius * 0.9 + 1.5;
      return { target: tgt, speed: 9, arrive: 10, minSpeed: 6, lookAt: calf.pos };
    };
    C.begin({ focus: calf, rate: 0.45, lead: mom });
    S.audio.setIntensity?.(0.25);
    // the descent: the pair skimming the dark sea, the galaxy over them
    yield* this._play(C.track({ subject: mom, side: [-46, -30], up: [16, 4], ahead: [-6, 10], fov: [46, 42] }), 4);
    const PH = [[[0, 1], [2, 1], [4, 2]], [[4, 1], [5, 1], [4, 1], [2, 1], [0, 2]]];
    for (let pi = 0; pi < PH.length; pi++) {
      // she hums it first, softly, her wake glowing
      C.setFocus(mom);
      yield* this._with(this.phrase(mom, PH[pi], -1, { vowel: 'oo', onNote: (i, midi, dur) => this.lightWave(mom.pos.clone().setY(seaHeight(g, mom.pos.x, mom.pos.z)), mom.fwd, 0.35) }),
        faceShot(mom, { side: this.sideToward(mom, calf), dist: [1.3, 1.15], around: [0.4, 0.6], up: 0.2, fov: [38, 35] }));
      // the calf sings to the sea: each held note sends light racing out over the water
      C.setFocus(calf);
      const low = (k, t, s) => {
        _v.copy(calf.fwd).setY(0).normalize();
        s.pos.copy(calf.pos).addScaledVector(_v, -lerp(10, 8, k)).addScaledVector(_v2.crossVectors(_v, UP).normalize(), -4);
        s.pos.y = Math.max(seaHeight(g, s.pos.x, s.pos.z) + 1.2, calf.pos.y - 1.5);
        s.look.copy(calf.pos).addScaledVector(_v, 22);
        s.look.y = seaHeight(g, s.look.x, s.look.z) + 1;
        s.fov = lerp(48, 44, k);
        s.roll = 0;
      };
      yield* this._with(this.answer(calf, PH[pi], 1, {
        onNote: (i, ok, midi, dur) => {
          const p = calf.pos.clone();
          p.y = seaHeight(g, p.x, p.z);
          this.lightWave(p, calf.fwd, ok ? 1 : 0.4);
          if (ok) { this._ripple(calf.pos, 0.6); calf.drive.happy = 1; }
          // on the second phrase her voice joins it, a fifth below
          if (pi === 1 && ok) this.sing(mom, this.midi(PH[pi][i][0] - 3, -1), dur * 0.95, { vowel: 'oo', intensity: 0.6 });
        },
      }), low);
    }
    // the whole sea answers: rings of light all around, seen from high above
    for (let i = 0; i < 5; i++) {
      const a = i * 1.26;
      const p = calf.pos.clone().add(_v.set(Math.cos(a) * 30, 0, Math.sin(a) * 30));
      p.y = seaHeight(g, p.x, p.z);
      this.lightWave(p, _v2.set(Math.cos(a), 0, Math.sin(a)), 0.8);
    }
    S.audio.stinger?.('harmony');
    S.voiceCall(mom, 'coo');
    yield* this._play(C.drone({ center: calf, radius: [40, 70], height: [40, 90], angle: [calf.yaw + 2.4, calf.yaw + 2.0], fov: [46, 50], tilt: 6 }), 4.2);
    herd.motherScript = null;
    herd.targetSpeed = speed0;
    this._end();
    C.end({ rate: 0.4 });
  }

  // ---- 3. ACT II · THE DUET --------------------------------------------------------------------------
  /** Her phrase, your answer, three times; then one long note together, in harmony, rising. */
  *duet(mate, opts = {}) {
    const S = this.story, g = this.game, herd = this.herd, me = herd.calf, C = S.cine;
    this._begin('duet');
    C.begin({ focus: mate, rate: 0.45, lead: mate });
    const PH = [[[0, 1], [2, 1], [4, 2]], [[4, 1], [5, 1], [4, 1], [2, 1]], [[7, 2], [5, 1], [4, 1], [2, 2]]];
    let wins = 0;
    for (let pi = 0; pi < PH.length; pi++) {
      C.setFocus(mate);
      yield* this._with(this.phrase(mate, PH[pi], 0, { vowel: 'ah' }), faceShot(mate, { side: this.sideToward(mate, me), dist: [1.35, 1.15], around: [0.5, 0.75], up: 0.12, fov: [36, 33] }));
      C.setFocus(me);
      yield* this._with(this.answer(me, PH[pi], 0, {
        onNote: (i, ok) => { if (ok) { opts.onSuccess?.(pi); me.drive.happy = 1; } },
      }), faceShot(me, { side: this.sideToward(me, mate), dist: [1.5, 1.3], around: [0.55, 0.8], up: 0.1, fov: [36, 33] }));
      if (this._hits >= PH[pi].length - 1) {
        wins++;
        // she answers your answer: a third above, both voices ringing; they drift closer
        this.sing(mate, this.midi(PH[pi][PH[pi].length - 1][0] + 2, 0), this.key().beat * 3, { vowel: 'ah' });
        mate.drive.happy = 1;
        S.audio.stinger?.('harmony');
        S.audio.setIntensity?.(clamp(0.35 + pi * 0.22, 0, 1));
        this._ripple(_v.copy(me.pos).lerp(mate.pos, 0.5), 0.5 + pi * 0.3);
        S.life?.motes?.(_v.copy(me.pos).lerp(mate.pos, 0.5), 18, 10, GOLD);
      }
      yield* C.wait(this.key().beat);
    }
    // together: one long note in harmony, held; the camera circles the pair as the crescendo builds
    const beat = this.key().beat;
    this.sing(mate, this.midi(4, 0), beat * 7, { vowel: 'ah', intensity: 1 });
    S.audio.setIntensity?.(1);
    S.audio.stinger?.('discover');
    const mid = new Vector3();
    const around = (k, t, s) => {
      mid.copy(me.pos).lerp(mate.pos, 0.5);
      const a = me.yaw + 1.4 + k * 1.6;
      const r = lerp(26, 40, k);
      s.pos.set(mid.x + Math.cos(a) * r, mid.y + lerp(1, 12, k), mid.z + Math.sin(a) * r);
      s.look.copy(mid);
      s.fov = lerp(40, 46, k);
      s.roll = 0.03 * Math.sin(t * 0.6);
    };
    yield* this._with(this.answer(me, [[0, 6]], 0, {
      onHold: (i, k) => {
        G.uSongAmp.value = 0.8 + k;
        if (Math.random() < 0.3) S.life?.motes?.(_v.copy(me.pos).lerp(mate.pos, Math.random()), 1, 5, GOLD, { rise: 0.4, life: 2.5 });
        me.vel.y += 1.5 * k * (1 / 60);
        mate.vel.y += 1.5 * k * (1 / 60);
      },
    }), around);
    this._ripple(_v.copy(me.pos).lerp(mate.pos, 0.5), 1.6);
    me.drive.happy = mate.drive.happy = 1;
    yield* this._play(around, 2.4);
    this._end();
    G.uSongAmp.value = 0.6;
    C.end({ rate: 0.4 });
    return wins;
  }

  // ---- 4. ACT III · A LULLABY FOR THE EGG -----------------------------------------------------------
  *lullaby(egg, eggP, opts = {}) {
    const S = this.story, g = this.game, herd = this.herd, me = herd.calf, C = S.cine;
    this._begin('lullaby');
    S.audio.setMood?.('birth', { fade: 4 });
    S.audio.setIntensity?.(0.2);
    // he settles above the eye, close over the egg
    const post = { pos: eggP.clone().add(_v.set(0, 6, 0)), right: opts.right || new Vector3(1, 0, 0), fwd: opts.fwd || new Vector3(0, 0, 1), L: 1 };
    C.begin({ focus: eggP, rate: 0.45, lead: post });
    const beat = this.key().beat;
    const PH = [[[4, 1], [2, 1], [0, 2]], [[2, 1], [4, 1], [2, 1], [0, 2]], [[0, 3]]];
    const macro = S.cine.macro({ subject: eggP, dist: [9, 7.5], angle: [me.yaw + 2.2, me.yaw + 2.5], height: [-0.6, 0.6], fov: [34, 30], under: true });
    for (let pi = 0; pi < PH.length; pi++) {
      // the egg's light pulses the rhythm (its call), the embryo stirring inside
      C.setFocus(eggP);
      const pulses = function* () {
        yield* S.untilNextBeat(beat * 1.5, beat * 0.2);
        for (const [, beats] of PH[pi]) {
          egg?.setGlow?.(1.6, 0.2);
          egg?.embryo?.kick?.();
          S.audio?.sfx?.('chime', { position: eggP, gain: 0.25, pitch: 0.75 });
          yield beat * 0.35;
          egg?.setGlow?.(0.8, 0.6);
          yield beats * beat - beat * 0.35;
        }
      };
      yield* this._with(pulses(), macro);
      // he sings it back: each held note bathes it in warm light, and it settles
      yield* this._with(this.answer(me, PH[pi], 0, {
        at: () => eggP,
        onHold: (i, k) => { egg?.setGlow?.(0.8 + 0.8 * k, 0.3); },
        onNote: (i, ok) => {
          if (ok) {
            S.life?.motes?.(eggP, 10, 3, [1.0, 0.9, 0.72], { rise: 0.45, life: 3 });
            egg?.setPulse?.(Math.max(0.7, 1.1 - 0.12 * (pi + 1)));
            this._ripple(eggP, 0.4);
          }
        },
      }), (k, t, s) => {
        // up past the egg to the father hanging over it, his song coming down through the water
        s.pos.copy(eggP).add(_v.set(Math.cos(me.yaw + 2.4) * 6, -2.5, Math.sin(me.yaw + 2.4) * 6));
        s.pos.y = Math.min(s.pos.y, seaHeight(g, s.pos.x, s.pos.z) - 1.2);
        s.look.copy(eggP).lerp(me.pos, 0.55);
        s.fov = lerp(44, 40, k);
        s.roll = 0;
      });
    }
    // asleep: the light steadies, a last slow pulse
    egg?.setGlow?.(1.1, 2);
    egg?.setPulse?.(0.8);
    S.voiceCall(me, 'coo');
    yield* this._play(macro, 2.6);
    this._end();
    C.end({ rate: 0.4 });
  }

  // ---- 5. ACT IV · THE ELDER'S LAST SONG ------------------------------------------------------------
  *lastSong(me, mate, center) {
    const S = this.story, g = this.game, herd = this.herd, C = S.cine;
    this._begin('lastSong');
    S.audio.setMood?.('song', { fade: 4 });
    C.begin({ focus: me, rate: 0.35, lead: mate?.group?.visible ? mate : null });
    const choir = herd.whales.filter((w) => w !== me && w.group.visible).concat(mate?.group?.visible ? [mate] : []);
    const PH = [[[0, 2], [4, 2]], [[2, 1], [4, 1], [5, 2]], [[7, 2], [4, 1], [2, 1], [0, 3]]];
    let voices = 0;
    for (let pi = 0; pi < PH.length; pi++) {
      // the elder sings (you): hold each note
      C.setFocus(me);
      yield* this._with(this.answer(me, PH[pi], -1, {
        onNote: (i, ok) => { if (ok) this._ripple(me.pos, 0.5 + pi * 0.3); },
      }), faceShot(me, { side: 1, dist: [1.2, 1.0], around: [0.5, 0.75], up: 0.14, fov: [38, 34] }));
      // and the herd answers the phrase, more of them each time
      voices = Math.min(choir.length, voices + Math.max(2, Math.ceil(choir.length / 3)));
      const singers = choir.slice(0, voices);
      const answerGen = function* (self) {
        for (const [deg, beats] of PH[pi]) {
          const dur = beats * self.key().beat;
          singers.forEach((w, i) => self.sing(w, self.midi(deg + [0, 2, 4][i % 3], w.isCalf ? 0 : -2), dur * 0.95, { vowel: 'oh', intensity: 0.65 }));
          yield dur;
        }
      };
      S.audio.setIntensity?.(Math.min(1, 0.4 + pi * 0.2));
      C.setFocus(center);
      yield* this._with(answerGen(this), C.orbit({ center, radius: [90, 120], height: [14, 26], angle: [me.yaw + 1.2 + pi * 0.5, me.yaw + 1.5 + pi * 0.5], fov: [46, 44], look: center }));
    }
    // the last note, held under the galaxy, everyone with it, the camera rising to the stars
    const beat = this.key().beat;
    choir.forEach((w, i) => { if (i < 9) this.sing(w, this.midi([0, 4, 2, 7, 9][i % 5], w.isCalf ? 1 : -2 + (i % 2)), beat * 9, { vowel: 'ah', intensity: 0.8 }); });
    this._ripple(center, 2);
    S.audio.setIntensity?.(1);
    S.audio.stinger?.('harmony');
    yield* this._with(this.answer(me, [[0, 7]], -1, { onHold: (i, k) => { G.uSongAmp.value = 1 + k; } }),
      C.orbit({ center: me, radius: [40, 110], height: [6, 80], angle: [me.yaw + 1.2, me.yaw + 1.8], fov: [44, 52], lookUp: [0, 90] }));
    yield* this._play(C.orbit({ center: me, radius: [110, 150], height: [80, 120], angle: [me.yaw + 1.8, me.yaw + 2.1], fov: [52, 54], lookUp: [90, 140] }), 3.5);
    this._end();
    // (the cinematic stays on: the descent into the deep follows straight on, LifeCycle.act4)
  }
}
