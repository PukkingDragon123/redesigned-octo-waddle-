// The herd song: call and response with the mother, taught only through the whales' bodies,
// breath and voices. No notes, buttons or timing bars. The mother inhales (her body swells,
// fins lift) a beat before each note, sings, then looks at the calf and nods: the calf answers
// by humming the same rhythm. Matching phrases bring the herd in, harmony by harmony; clouds
// ripple, krill spiral, and the score swells.
import { Vector3 } from 'three';
import { clamp, damp } from '../core/math.js';
import { G } from '../render/Globals.js';

const PHRASES = [
  [[0, 1], [2, 1]],
  [[4, 1], [2, 1], [0, 2]],
  [[0, 1], [2, 1], [4, 1], [5, 1]],
  [[7, 2], [4, 1], [5, 1], [4, 2]],
];

export class SongGame {
  constructor(story) {
    this.story = story;
    this.game = story.game;
    this.active = false;
    this.presses = [];
    this.windowStart = 0;
    this.successes = 0;
    this.expect = null;
    this.calfNoteIndex = 0;
  }

  key() {
    const k = this.story.audio.getKey?.();
    if (k && k.scale && k.scale.length >= 7) return k;
    return { rootMidi: 62, scale: [0, 2, 4, 5, 7, 9, 11], beat: 60 / 66 };
  }

  midi(deg, octave = 0) {
    const k = this.key();
    const sc = k.scale;
    const o = Math.floor(deg / sc.length);
    return k.rootMidi + sc[((deg % sc.length) + sc.length) % sc.length] + 12 * (o + octave);
  }

  /** Called by the story when the calf starts/stops humming. */
  humStart() {
    if (!this.listening) return null;
    const t = this.game.time - this.windowStart;
    this.presses.push({ on: t, off: null });
    // the calf sings the next note of the phrase, an octave above its mother
    const i = Math.min(this.presses.length - 1, (this.expect?.length ?? 1) - 1);
    const deg = this.expect ? this.expect[i][0] : 0;
    return this.midi(deg, 1);
  }

  humEnd() {
    if (!this.listening) return;
    const p = this.presses[this.presses.length - 1];
    if (p && p.off === null) p.off = this.game.time - this.windowStart;
  }

  evaluate(phrase, beat) {
    let t = 0;
    const exp = phrase.map(([deg, beats]) => {
      const e = { on: t, dur: beats * beat };
      t += beats * beat;
      return e;
    });
    const P = this.presses.filter((p) => p.on > -0.6);
    if (P.length < phrase.length) return { ok: false, score: P.length / phrase.length };
    let good = 0;
    for (let i = 0; i < exp.length; i++) {
      const p = P[i];
      const e = exp[i];
      const off = p.off ?? (this.game.time - this.windowStart);
      const dur = off - p.on;
      const onOk = Math.abs(p.on - e.on) < beat * 0.6 + 0.3;
      const durOk = dur > e.dur * 0.35 && dur < e.dur * 2.6 + 0.4;
      if (onOk && durOk) good++;
    }
    return { ok: good >= exp.length - (exp.length >= 4 ? 1 : 0), score: good / exp.length };
  }

  /** The whole song, as a coroutine. */
  *run() {
    const S = this.story;
    const herd = S.herd;
    const mom = herd.mother;
    const calf = herd.calf;
    this.active = true;
    S.audio.setMood?.('song', { fade: 5 });
    S.audio.setIntensity?.(0.15);
    const center = herd.songCenter || calf.pos.clone();
    G.uSongRipple.value.set(center.x, center.y, center.z, this.game.time);
    if (S.eco) S.eco.songFocus = center;
    // the elder opens with a long low drone; the ring settles
    yield 2.0;
    S.voiceHum(herd.elder, this.midi(0, -2), 6);
    yield 3.5;
    for (let pi = 0; pi < PHRASES.length; pi++) {
      const phrase = PHRASES[pi];
      let tries = 0;
      for (;;) {
        const beat = this.key().beat;
        // the mother turns to the calf and breathes in
        herd.motherScript = (m) => ({ target: calf.pos.clone().add(new Vector3(-10, 3, 8)), speed: 4, arrive: 14, lookAt: calf.pos, face: calf.pos });
        mom.drive.sing = 0.6;
        yield beat * 0.5;
        // the first inhale ends on a beat of the score; each later one borrows the end of the note before
        yield* S.untilNextBeat(beat * 1.5, beat * 0.35);
        for (const [deg, beats] of phrase) {
          // inhale: the body swells, the head lifts
          mom.drive.sing = 1;
          mom.anim.sHeadPitch.impulse(-1.2);
          yield beat * 0.35;
          S.voiceHum(mom, this.midi(deg, -1), (beats - 0.35) * beat * 0.95);
          mom.drive.hum = 1;
          yield (beats - 0.35) * beat;
          mom.drive.hum = 0;
        }
        mom.drive.sing = 0.4;
        // a look and a nod: your turn
        yield beat * 0.6;
        mom.anim.sHeadPitch.impulse(2.4);
        mom.drive.happy = 0.6;
        yield beat * 0.4;
        // the calf's window opens on a beat, so the herd's breathing pulse and the music agree
        yield* S.untilNextBeat(beat * 1.2);
        this.expect = phrase;
        this.presses = [];
        this.windowStart = this.game.time;
        this.listening = true;
        const total = phrase.reduce((a, n) => a + n[1], 0) * beat;
        // the herd breathes the beat for the calf: adults pulse gently in time
        let waited = 0;
        while (waited < total + beat * 1.4) {
          const t = this.game.time - this.windowStart;
          const ph = (t / beat) % 1;
          for (const w of herd.adults) if (w !== mom) w.drive.sing = 0.35 + 0.25 * Math.exp(-ph * 6);
          // stop early once every note has been answered and released
          if (this.presses.length >= phrase.length && this.presses[this.presses.length - 1].off !== null && t > total * 0.6) break;
          waited += yield 0;
        }
        this.listening = false;
        const res = this.evaluate(phrase, beat);
        if (res.ok) {
          this.successes++;
          S.onSongSuccess(pi, phrase);
          // the herd answers in harmony
          const chord = [0, 2, 4];
          herd.adults.forEach((w, i) => {
            if (w === mom) return;
            setTimeout(() => S.voiceHum(w, this.midi(chord[i % 3] + (i % 2 ? 7 : 0), -2), beat * 3), i * 120);
            w.drive.sing = 0.8;
          });
          S.voiceHum(mom, this.midi(phrase[phrase.length - 1][0], -1), beat * 3);
          calf.drive.happy = 1;
          S.audio.stinger?.('harmony');
          S.audio.setIntensity?.(clamp(0.3 + pi * 0.2, 0, 1));
          G.uSongAmp.value = Math.min(1.5, 0.5 + pi * 0.3);
          G.uSongRipple.value.w = this.game.time;
          yield beat * 3.5;
          break;
        }
        tries++;
        if (tries >= 3) {
          // the herd carries the calf along anyway
          S.audio.setIntensity?.(clamp(0.25 + pi * 0.15, 0, 1));
          break;
        }
        // gently again, a little slower
        mom.drive.happy = 0.2;
        yield beat * 1.2;
      }
    }
    // the finale: everyone sings; the calf holds one long note with them
    const beat = this.key().beat;
    S.audio.setIntensity?.(1);
    herd.whales.forEach((w, i) => {
      if (w === calf) return;
      w.drive.sing = 1;
      const deg = [0, 4, 2, 7, 9][i % 5];
      S.voiceHum(w, this.midi(deg, w.isCalf ? 1 : -2 + (i % 2)), beat * 8);
    });
    this.expect = [[0, 8]];
    this.presses = [];
    this.windowStart = this.game.time;
    this.listening = true;
    G.uSongAmp.value = 2;
    G.uSongRipple.value.w = this.game.time;
    S.audio.stinger?.('harmony');
    yield beat * 8.5;
    this.listening = false;
    for (const w of herd.whales) { w.drive.sing = 0; w.drive.hum = 0; }
    calf.drive.happy = 1;
    mom.drive.happy = 1;
    herd.motherScript = null;
    yield 2;
    G.uSongAmp.value = 0;
    if (S.eco) S.eco.songFocus = null;
    this.active = false;
  }
  /**
   * A duet (Act II): `partner` sings a phrase, the player's whale answers it, three times, each
   * success drawing the two closer (opts.onSuccess(i)). Returns the number of phrases matched.
   * The player always gets through: after two misses a phrase is let go.
   */
  *duet(partner, opts = {}) {
    const S = this.story;
    const me = S.herd.calf;
    const phrases = opts.phrases || [[[0, 1], [2, 1], [4, 2]], [[4, 1], [5, 1], [4, 1], [2, 1]], [[7, 2], [5, 1], [4, 1], [2, 2]]];
    this.active = true;
    let wins = 0;
    for (let pi = 0; pi < phrases.length; pi++) {
      const phrase = phrases[pi];
      for (let tries = 0; tries < 2; tries++) {
        const beat = this.key().beat;
        yield* S.untilNextBeat(beat * 1.5, beat * 0.35);
        for (const [deg, beats] of phrase) {
          partner.drive.sing = 1;
          partner.anim.sHeadPitch?.impulse(-1.2);
          yield beat * 0.3;
          S.voiceHum(partner, this.midi(deg, 0), (beats - 0.3) * beat * 0.95);
          yield (beats - 0.3) * beat;
        }
        partner.drive.sing = 0.4;
        yield beat * 0.5;
        partner.anim.sHeadPitch?.impulse(2.2);
        yield* S.untilNextBeat(beat * 1.2);
        this.expect = phrase;
        this.presses = [];
        this.windowStart = this.game.time;
        this.listening = true;
        // the answer an octave below hers (humStart sings expect degrees an octave above the key's root)
        const total = phrase.reduce((a, n) => a + n[1], 0) * beat;
        let waited = 0;
        while (waited < total + beat * 1.6) {
          const t = this.game.time - this.windowStart;
          if (opts.auto && this.presses.length < phrase.length) {
            // headless autopilot: answer in time
            let on = 0;
            for (let i = 0; i < this.presses.length; i++) on += phrase[i][1] * beat;
            if (t >= on) { this.presses.push({ on: t, off: t + phrase[this.presses.length][1] * beat * 0.8 }); }
          }
          if (this.presses.length >= phrase.length && this.presses[this.presses.length - 1].off !== null && t > total * 0.6) break;
          waited += yield 0;
        }
        this.listening = false;
        const res = this.evaluate(phrase, beat);
        if (res.ok) {
          wins++;
          S.voiceHum(partner, this.midi(phrase[phrase.length - 1][0] + 2, 0), beat * 3);
          S.voiceHum(me, this.midi(phrase[phrase.length - 1][0], 0), beat * 3);
          partner.drive.happy = 1;
          me.drive.happy = 1;
          S.audio.stinger?.('harmony');
          S.audio.setIntensity?.(clamp(0.35 + pi * 0.25, 0, 1));
          G.uSongAmp.value = Math.min(1.4, 0.5 + pi * 0.35);
          G.uSongRipple.value.set(partner.pos.x, partner.pos.y, partner.pos.z, this.game.time);
          opts.onSuccess?.(pi);
          yield beat * 3.5;
          break;
        }
        partner.drive.happy = 0.3;
        yield beat * 1.5;
      }
    }
    G.uSongAmp.value = 0;
    this.active = false;
    return wins;
  }
}
