// Whale voices: a sung fundamental with portamento, delayed vibrato, a formant pair that
// opens from "oo" to "ah", breath noise and (for adults) a sub-harmonic growl. Every note
// and call snaps to the current key or chord so the herd sings inside the score.
// Spatialised with an HRTF panner, distance attenuation and an air-absorption lowpass;
// the reverb and sky-echo sends are taken before the panner so far voices sound wetter.
// Real humpback song (NOAA, public domain; src/audio/SampleLib.js) is layered in once loaded:
// each call adds a song unit retuned to the call's main note, and a hum adds a looped moan
// whose playback rate follows the sung pitch, so the singing game's pitch control is intact.
// The hum is a playable instrument (see _engine): a breathy onset, a scoop into the note,
// portamento with a small overshoot on leaps (bend() slides a held note), vowels that open
// oo -> oh -> ah and drift on long notes, a third formant's ring, vibrato that blooms as the
// note is held, a growl under loud adult notes, an overtone shimmer, and a shared long hall
// (src/audio/SongSpace.js). sing(midi, { dur, vowel, intensity, ... }) is the same with named
// options; a short calf note slid into (or { crack: 1 }) is the newborn's breaking croak.
import {
  clamp, lerp, mtof, glide, setAt, rampAt, expAt, cancelFrom, holdAt, disconnect, stopAt, startAt,
  finite, smoothstep, driveCurve,
} from './util.js';
import { snapToScale, snapToChord, stepChord, stepScale } from './theory.js';
import { getWaves } from './instruments.js';
import { songSpace } from './SongSpace.js';

// [F1, F2] for a mother-sized throat; scaled by profile.formant
const VOW = { oo: [300, 700], oh: [430, 820], ah: [650, 1080], ee: [330, 1900], eh: [520, 1500] };
// third formant (the ring that makes a sung vowel shine)
const F3 = { oo: 2250, oh: 2400, ah: 2600, ee: 2950, eh: 2700 };

let driveCache = null;

// Glide a param, or (force) jump it: an idle chain's params stay frozen where it last sounded.
const move = (param, v, now, tc, force) => {
  if (force) {
    cancelFrom(param, now);
    setAt(param, v, now);
  } else glide(param, v, now, tc);
};

export class WhaleVoice {
  constructor(sys, profile = {}) {
    this.sys = sys;
    const base = clamp(finite(profile && profile.base, 50), 24, 100);
    this.p = {
      base,
      formant: clamp(finite(profile && profile.formant, 1), 0.5, 2),
      breath: clamp(finite(profile && profile.breath, 0.2), 0, 1),
    };
    this.size = clamp((72 - base) / 34); // 0 calf .. 1 elder
    this.calf = base >= 64;
    this.trim = this.calf ? 0.21 : lerp(0.24, 0.3, this.size);
    this.glideTc = this.calf ? 0.035 : lerp(0.07, 0.15, this.size);
    this.verbBase = lerp(0.38, 0.85, this.size);
    this.echoBase = lerp(0.13, 0.3, this.size);
    this.hallBase = lerp(0.3, 0.62, this.size);
    // the instrument's character by size: a calf bright, breathy and quick to vibrate; an
    // elder dark, slow and growling, with the most real whale in it
    const z = this.size;
    this.tone = {
      vibRate: this.calf ? 6.1 : lerp(5.3, 4.3, z),
      vibDepth: this.calf ? 30 : lerp(24, 16, z),
      bloom: this.calf ? 0.55 : lerp(0.9, 1.4, z),
      bright: this.calf ? 1.1 : lerp(0.9, 0.6, z),
      sub: smoothstep(0.25, 1, z) * 0.6,
      sample: this.calf ? 0.5 : lerp(0.75, 1.0, z),
      shimmer: this.calf ? 0.11 : lerp(0.08, 0.05, z),
    };
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.hasPos = false;
    this.io = null;
    this.eng = null;
    this.charge = null;
    this.humming = false;
    this.humEnd = 0;
    this.prio = 1; // voice stealing: lower goes first
    this._callEnd = 0;
    this.curMidi = base;
    this.lastActive = -1e9;
    this.disposed = false;
  }

  // ---- public API ------------------------------------------------------------------

  setPosition(v) {
    try {
      if (!v) return;
      const x = +v.x;
      const y = +v.y;
      const z = +v.z;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
      this.x = x;
      this.y = y;
      this.z = z;
      this.hasPos = true;
    } catch (e) { /* ignore */ }
  }

  /**
   * Sing `midi` (snapped to the key). Without a duration it sustains until release().
   * opts: gain (0..2), glideFrom (midi to slide in from), snap (false: no key snap), prio,
   * vibrato (cents), vowel ('oo' | 'oh' | 'ah' | 'ee' | 'eh': where the note opens to),
   * intensity (0..1: growl, brightness, shimmer; default from gain), crack (0..1: the newborn's
   * cracked croak; a short calf note slid into is taken as one when not given).
   */
  hum(midi, duration, opts = {}) {
    try {
      const sys = this.sys;
      if (!sys.ready || this.disposed) return;
      opts = opts || {};
      const now = sys.ctx.currentTime;
      const t = now + 0.008;
      let m = finite(midi, this.p.base);
      const key = sys._keyNow();
      if (opts.snap !== false) m = snapToScale(m, key.root, key.scale);
      // the game hums the player and the mother at gain 1, everyone else softer
      const g0 = clamp(finite(opts.gain, 1), 0, 2);
      this.prio = finite(opts.prio, g0);
      const e = this._engine(t);
      if (!e) return;
      const T = this.tone;
      const k = this.p.formant;
      const f = mtof(m);
      const gain = g0 * this.trim;
      const I = clamp(finite(opts.intensity, 0.35 + 0.55 * Math.min(1, g0)));
      const dur = duration != null && Number.isFinite(+duration) ? Math.max(0.08, +duration) : null;
      const crack = clamp(finite(opts.crack, this.calf && dur !== null && dur < 0.4 && opts.glideFrom != null ? 1 : 0));
      const vib = clamp(finite(opts.vibrato, T.vibDepth), 0, 120) * (1 - crack);
      const legato = this.humming && now < this.humEnd;
      // the previous note's release tail is still audible: slide out of it, don't jump
      const tail = !legato && now - this.humEnd < 0.6;
      this._cancel(e, t);
      // ---- pitch: scoop in, portamento between notes (with a little overshoot on leaps)
      const from = this.curMidi;
      if (opts.glideFrom != null && Number.isFinite(+opts.glideFrom)) {
        setAt(e.pitch.offset, mtof(+opts.glideFrom), t);
        glide(e.pitch.offset, f, t, this.glideTc * (crack ? 0.6 : 1.4));
      } else if (legato) {
        const leap = m - from;
        if (Math.abs(leap) >= 3) {
          glide(e.pitch.offset, mtof(m + Math.sign(leap) * 0.35), t, this.glideTc);
          glide(e.pitch.offset, f, t + this.glideTc * 2.4, 0.07);
        } else glide(e.pitch.offset, f, t, this.glideTc);
      } else if (tail) {
        glide(e.pitch.offset, f, t, 0.03);
      } else {
        setAt(e.pitch.offset, f * Math.pow(2, -0.9 / 12), t); // a natural scoop into the note
        glide(e.pitch.offset, f, t, 0.05);
      }
      // ---- level: a breathy start, then the note swells as it is held
      const att = this.calf ? 0.045 : lerp(0.08, 0.18, this.size);
      if (legato) {
        glide(e.amp.gain, gain * 0.86, t, 0.03);
        glide(e.amp.gain, gain, t + 0.08, att / 2);
      } else {
        glide(e.amp.gain, gain * 0.72, t, att / 3);
        glide(e.amp.gain, gain, t + att, 0.35);
      }
      // ---- vowel: oo -> oh -> the open vowel, drifting on long notes
      const V = VOW[opts.vowel] || (this.calf ? VOW.eh : VOW.ah);
      const V3 = F3[opts.vowel] || (this.calf ? F3.eh : F3.ah);
      const S0 = legato ? VOW.oh : VOW.oo;
      const mv = !legato && !tail ? (p, v) => setAt(p, v, t) : (p, v) => glide(p, v, t, 0.04);
      mv(e.f1.frequency, S0[0] * k);
      mv(e.f2.frequency, S0[1] * k);
      mv(e.f3.frequency, F3.oo * k);
      glide(e.f1.frequency, lerp(S0[0], V[0], 0.6) * k, t + 0.04, 0.07);
      glide(e.f2.frequency, lerp(S0[1], V[1], 0.6) * k, t + 0.04, 0.08);
      glide(e.f1.frequency, V[0] * k, t + 0.16, 0.3);
      glide(e.f2.frequency, V[1] * k, t + 0.16, 0.34);
      glide(e.f3.frequency, V3 * k, t + 0.1, 0.3);
      if (dur === null || dur > 1.4) {
        // a long note keeps moving: the mouth slowly rounds toward "oh"
        glide(e.f1.frequency, lerp(V[0], VOW.oh[0], 0.55) * k, t + 1.3, 1.6);
        glide(e.f2.frequency, lerp(V[1], VOW.oh[1], 0.55) * k, t + 1.3, 1.8);
      }
      glide(e.g3.gain, (0.25 + 0.55 * I) * T.bright, t, 0.2);
      // ---- breath: a puff on the onset, a thread of air under the tone
      const br = this.p.breath * gain;
      glide(e.ng.gain, br * (legato ? 0.7 : 1.7), t, 0.008);
      glide(e.ng.gain, br * (0.25 + 0.9 * crack), t + 0.09, 0.12);
      glide(e.nbp.frequency, V[1] * k, t, 0.2);
      // ---- vibrato blooms on a held note (deeper and a little faster as it opens)
      glide(e.vibG.gain, 0, t, 0.03);
      glide(e.vibG.gain, vib * 0.3, t + 0.16, 0.18);
      glide(e.vibG.gain, vib, t + 0.5, T.bloom);
      setAt(e.vib.frequency, T.vibRate * 0.78, t);
      glide(e.vib.frequency, T.vibRate, t + 0.3, T.bloom);
      // ---- growl under loud adult notes
      if (e.subG) {
        const gr = T.sub * smoothstep(0.45, 1, I);
        glide(e.subG.gain, gr, t, 0.15);
        glide(e.growlD.gain, gr * 0.7, t, 0.15);
      }
      // ---- the real humpback moan, brighter as the note opens; the overtone shimmer blooms late
      if (e.hg) {
        glide(e.hg.gain, T.sample * (0.65 + 0.35 * I), t, 0.05);
        glide(e.hpk.frequency, V[1] * k, t + 0.1, 0.3);
        glide(e.hlp.frequency, (this.calf ? 2200 : 1300) * k * (0.7 + 0.8 * I), t, 0.2);
      }
      glide(e.shG.gain, 0, t, 0.05);
      glide(e.shG.gain, T.shimmer * (0.4 + 0.6 * I), t + 0.35, 0.9);
      // ---- the newborn's croak: the pitch wobbles and breaks, then gives out
      glide(e.crG.gain, crack * 85, t, 0.02);
      if (crack > 0 && dur !== null) {
        glide(e.pitch.offset, f * Math.pow(2, -5 * crack / 12), t + dur * 0.7, dur * 0.12);
        glide(e.crG.gain, crack * 160, t + dur * 0.6, 0.04);
      }
      this.humming = true;
      this.curMidi = m;
      this.lastActive = now;
      if (dur !== null) {
        const end = t + dur;
        this.humEnd = end;
        this._releaseAt(end, this.calf ? 0.25 : 0.5);
      } else this.humEnd = Infinity;
    } catch (err) {
      this.sys._warn(err);
    }
  }

  /**
   * The same, with named options (for scenes and QTEs):
   *   voice.sing(midi, { dur, vowel, intensity, gain, glideFrom, vibrato, snap, crack })
   */
  sing(midi, o = {}) {
    o = o || {};
    this.hum(midi, o.dur, o);
  }

  /**
   * Slide a held note to `midi` without a new attack (follow a steering input while humming).
   * Snapped to the key unless o.snap === false. Returns false when nothing is being sung.
   */
  bend(midi, o = {}) {
    try {
      const sys = this.sys;
      const e = this.eng;
      if (!sys.ready || !e || !this.humming) return false;
      const now = sys.ctx.currentTime;
      if (now > this.humEnd) return false;
      let m = finite(midi, this.curMidi);
      if (!o || o.snap !== false) {
        const key = sys._keyNow();
        m = snapToScale(m, key.root, key.scale);
      }
      if (m === this.curMidi) return true;
      const t = now + 0.008;
      const leap = m - this.curMidi;
      cancelFrom(e.pitch.offset, t);
      glide(e.pitch.offset, mtof(m + Math.sign(leap) * Math.min(0.35, Math.abs(leap) * 0.1)), t, this.glideTc);
      glide(e.pitch.offset, mtof(m), t + this.glideTc * 2.4, 0.07);
      // the mouth flexes a little with the move, and the vibrato settles in again
      cancelFrom(e.vibG.gain, t);
      glide(e.vibG.gain, this.tone.vibDepth * 0.4, t, 0.05);
      glide(e.vibG.gain, this.tone.vibDepth, t + 0.3, this.tone.bloom * 0.7);
      this.curMidi = m;
      this.lastActive = now;
      return true;
    } catch (err) {
      this.sys._warn(err);
      return false;
    }
  }

  /** True while a hum is sounding (held, or before its duration ends). */
  get singing() {
    return !!(this.humming && this.sys.ctx && this.sys.ctx.currentTime < this.humEnd);
  }

  release(fadeSec = 0.4) {
    try {
      // not `ready`: on a suspended or interrupted context the fade plays out on resume
      if (!this.eng || !this.sys.ctx) {
        this.humming = false;
        return;
      }
      const now = this.sys.ctx.currentTime;
      const t = now + 0.01;
      this._cancel(this.eng, t);
      this._releaseAt(t, clamp(finite(fadeSec, 0.4), 0.02, 10));
      this.humEnd = t;
      this.humming = false;
      this.lastActive = now;
    } catch (err) {
      this.sys._warn(err);
    }
  }

  /** Short vocal gestures: chirp | coo | answer | warn | yawn | play | roar. */
  call(kind) {
    try {
      const sys = this.sys;
      if (!sys.ready || this.disposed) return;
      const io = this._io();
      if (!io) return;
      const def = this._callDef(String(kind));
      if (!def) return;
      const now = sys.ctx.currentTime;
      if (!this._attached(now)) this._place(now, true);
      this._playCall(def, now + 0.02);
      this._playRecCall(String(kind), def, now + 0.02);
      this.lastActive = now;
    } catch (err) {
      this.sys._warn(err);
    }
  }

  /** Throat charge for the sonic boom: a stepped rising chord-tone ladder, louder, with sub rumble. */
  setChargeLevel(x) {
    try {
      const sys = this.sys;
      x = clamp(finite(x, 0));
      if (!sys.ready || this.disposed) return;
      const now = sys.ctx.currentTime;
      if (x <= 0.002) {
        const c = this.charge;
        if (c && !c.stopping) {
          glide(c.g.gain, 0, now, 0.04);
          glide(c.rg.gain, 0, now, 0.07);
          c.stopping = true;
          c.killAt = now + 0.5;
        }
        return;
      }
      if (this.charge && this.charge.stopping) this._killCharge(now);
      if (!this.charge) this._buildCharge(now);
      const c = this.charge;
      if (!c || Math.abs(x - c.x) < 0.004) return;
      c.x = x;
      this.lastActive = now;
      const key = sys._keyNow();
      const target = this.p.base - 7 + x * 19;
      let m = snapToChord(target, key.pcs);
      if (m > target + 0.5) m = stepChord(m, key.pcs, -1);
      if (m !== c.m) {
        glide(c.osc.frequency, mtof(m), now, 0.025);
        glide(c.sub.frequency, mtof(m - 12), now, 0.025);
        c.m = m;
      }
      const k = this.p.formant;
      glide(c.g.gain, (0.1 + 0.62 * Math.pow(x, 1.5)) * this.trim, now, 0.05);
      glide(c.rg.gain, Math.pow(x, 2) * 0.9 * this.trim, now, 0.08);
      glide(c.lfo.frequency, 3 + 10 * x, now, 0.1);
      glide(c.lfoG.gain, 0.12 + 0.38 * x, now, 0.1);
      glide(c.lp.frequency, (700 + 2600 * x) * k, now, 0.08);
    } catch (err) {
      this.sys._warn(err);
    }
  }

  dispose() {
    try {
      const now = this.sys.ctx ? this.sys.ctx.currentTime : 0;
      this._killEngine(now);
      this._killCharge(now);
      if (this.io) disconnect(this.io.air, this.io.pan, this.io.verb, this.io.echo, this.io.hall);
      this.io = null;
    } catch (e) { /* ignore */ }
    this.disposed = true;
    this.sys.voices.delete(this);
  }

  // ---- internals -----------------------------------------------------------------------

  _io() {
    if (this.io) return this.io;
    const sys = this.sys;
    if (!sys._built) return null;
    const ctx = sys.ctx;
    const air = ctx.createBiquadFilter();
    air.type = 'lowpass';
    air.frequency.value = 18000;
    air.Q.value = 0.5;
    const pan = ctx.createPanner();
    pan.panningModel = sys.hrtf ? 'HRTF' : 'equalpower';
    pan.distanceModel = 'inverse';
    pan.refDistance = lerp(6, 30, this.size);
    pan.maxDistance = 20000;
    pan.rolloffFactor = 1;
    air.connect(pan);
    pan.connect(sys.bus.voices);
    const verb = ctx.createGain();
    verb.gain.value = this.verbBase;
    air.connect(verb);
    verb.connect(sys.bus.worldWet);
    const echo = ctx.createGain();
    echo.gain.value = this.echoBase;
    air.connect(echo);
    echo.connect(sys.bus.echo);
    // the song space: the long ringing hall every whale shares
    const hall = ctx.createGain();
    hall.gain.value = this.hallBase;
    air.connect(hall);
    hall.connect(songSpace(sys).input);
    this.io = { air, pan, verb, echo, hall, lastD: -1, px: NaN, py: NaN, pz: NaN };
    this._place(ctx.currentTime, true);
    return this.io;
  }

  _place(now, force) {
    const io = this.io;
    if (!io) return;
    const L = this.sys.listener;
    let x, y, z;
    if (this.hasPos) {
      x = this.x; y = this.y; z = this.z;
    } else {
      x = L.x + L.fx * 1.5; y = L.y + L.fy * 1.5; z = L.z + L.fz * 1.5;
    }
    const p = io.pan;
    if (force || Math.abs(x - io.px) + Math.abs(y - io.py) + Math.abs(z - io.pz) > 0.02) {
      io.px = x; io.py = y; io.pz = z;
      if (p.positionX) {
        move(p.positionX, x, now, 0.03, force); move(p.positionY, y, now, 0.03, force); move(p.positionZ, z, now, 0.03, force);
      } else if (p.setPosition) p.setPosition(x, y, z);
    }
    const dx = x - L.x;
    const dy = y - L.y;
    const dz = z - L.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (force || Math.abs(d - io.lastD) > Math.max(0.5, io.lastD * 0.04)) {
      io.lastD = d;
      move(io.air.frequency, clamp(20000 / (1 + d / 80), 500, 20000), now, 0.08, force);
      const ref = p.refDistance;
      const dry = ref / Math.max(ref, d);
      move(io.verb.gain, this.verbBase * Math.sqrt(dry), now, 0.1, force);
      move(io.echo.gain, this.echoBase * Math.sqrt(dry), now, 0.1, force);
      // the hall falls off slower than the dry voice: a far whale is mostly its space
      move(io.hall.gain, this.hallBase * Math.pow(dry, 0.3), now, 0.1, force);
    }
  }

  /** True while a source feeds the io chain (only then are its params processed). */
  _attached(now) {
    return !!(this.eng || this.charge || now < this._callEnd);
  }

  /**
   * The singing instrument, built on the first hum and kept while in use:
   *   pitch (Hz) drives a vocal tone (three formants + a chesty low pass), a sub-octave growl
   *   (adults), a looped real humpback moan resampled to the pitch, and an octave + twelfth
   *   overtone shimmer; vibrato, a slow drift and the croak's wobble move them all together.
   */
  _engine(t) {
    if (this.eng) return this.eng;
    const io = this._io();
    const sys = this.sys;
    if (!io || !sys.bank) return null;
    const now = sys.ctx.currentTime;
    if (!this._attached(now)) this._place(now, true);
    sys._admitVoiceEngine(this);
    const ctx = sys.ctx;
    const W = getWaves(ctx);
    const k = this.p.formant;
    const T = this.tone;
    const G = (v) => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };
    const BQ = (type, f, q) => {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      return b;
    };
    const pitch = ctx.createConstantSource();
    pitch.offset.value = mtof(this.p.base);
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(this.calf ? W.calf : W.whale);
    osc.frequency.value = 0;
    pitch.connect(osc.frequency);
    // pitch movement shared by every layer (cents): vibrato, a slow drift, the croak's wobble
    const det = G(1);
    const vib = ctx.createOscillator();
    vib.frequency.value = T.vibRate * (0.95 + Math.random() * 0.1);
    const vibG = G(0);
    vib.connect(vibG); vibG.connect(det);
    const drift = ctx.createOscillator();
    drift.frequency.value = 0.17 + Math.random() * 0.12;
    const driftG = G(this.calf ? 7 : 5);
    drift.connect(driftG); driftG.connect(det);
    const cr = ctx.createOscillator();
    cr.type = 'sawtooth';
    cr.frequency.value = 13 + Math.random() * 4;
    const crG = G(0);
    cr.connect(crG); crG.connect(det);
    det.connect(osc.detune);
    const mix = G(1);
    const f1 = BQ('bandpass', VOW.oo[0] * k, 4.5);
    const f2 = BQ('bandpass', VOW.oo[1] * k, 6);
    const f3 = BQ('bandpass', F3.oo * k, 8);
    const dry = BQ('lowpass', 520 * k, 0.6);
    const g1 = G(2.2);
    const g2 = G(1.4);
    const g3 = G(0.4);
    const gd = G(this.calf ? 0.7 : 0.45);
    osc.connect(f1); f1.connect(g1); g1.connect(mix);
    osc.connect(f2); f2.connect(g2); g2.connect(mix);
    osc.connect(f3); f3.connect(g3); g3.connect(mix);
    osc.connect(dry); dry.connect(gd); gd.connect(mix);
    let sub = null, subG = null, half = null, growl = null, growlD = null;
    if (T.sub > 0.02) {
      sub = ctx.createOscillator();
      sub.type = 'triangle';
      sub.frequency.value = 0;
      half = G(0.5);
      pitch.connect(half);
      half.connect(sub.frequency);
      det.connect(sub.detune);
      subG = G(0);
      growl = ctx.createOscillator();
      growl.frequency.value = 24 + Math.random() * 9;
      growlD = G(0);
      growl.connect(growlD);
      growlD.connect(subG.gain);
      sub.connect(subG);
      subG.connect(mix);
    }
    const nsrc = ctx.createBufferSource();
    nsrc.buffer = sys.bank.noise.pink;
    nsrc.loop = true;
    const nbp = BQ('bandpass', VOW.ah[1] * k, 1.3);
    const ng = G(0);
    nsrc.connect(nbp); nbp.connect(ng); ng.connect(mix);
    // a real humpback moan looped under the tone, its rate driven by the sung pitch (Hz / f0)
    let hsrc = null, hscale = null, hpk = null, hlp = null, hg = null;
    const hum = sys.samples && sys.samples.pick('wHum');
    if (hum && hum.f0) {
      hsrc = ctx.createBufferSource();
      hsrc.buffer = hum.buffer;
      hsrc.loop = true;
      hsrc.playbackRate.value = 0;
      hscale = G(1 / hum.f0);
      pitch.connect(hscale);
      hscale.connect(hsrc.playbackRate);
      det.connect(hsrc.detune);
      hpk = BQ('peaking', VOW.ah[1] * k, 1.2);
      hpk.gain.value = 7;
      hlp = BQ('lowpass', (this.calf ? 2600 : 1700) * k, 0.6);
      hg = G(0);
      hsrc.connect(hpk); hpk.connect(hlp); hlp.connect(hg); hg.connect(mix);
    }
    // shimmer: the octave and the twelfth, detuned a few cents apart so they beat slowly
    const sh1 = ctx.createOscillator();
    const sh2 = ctx.createOscillator();
    const x2 = G(2);
    const x3 = G(3);
    sh1.frequency.value = 0;
    sh2.frequency.value = 0;
    pitch.connect(x2); x2.connect(sh1.frequency);
    pitch.connect(x3); x3.connect(sh2.frequency);
    det.connect(sh1.detune); det.connect(sh2.detune);
    sh1.detune.value = 4;
    sh2.detune.value = -6;
    const sh2g = G(0.55);
    const shG = G(0);
    const shTrem = G(1);
    sh1.connect(shG); sh2.connect(sh2g); sh2g.connect(shG); shG.connect(shTrem); shTrem.connect(mix);
    const shMod = G(0.35);
    drift.connect(shMod); shMod.connect(shTrem.gain); // the same slow drift swells the shimmer
    const amp = G(0);
    mix.connect(amp);
    amp.connect(io.air);
    for (const n of [pitch, osc, vib, drift, cr, sh1, sh2]) startAt(n, t);
    if (sub) { startAt(sub, t); startAt(growl, t); }
    try { nsrc.start(t, Math.random() * (nsrc.buffer.duration - 0.1)); } catch (e) { /* ignore */ }
    if (hsrc) try { hsrc.start(t, Math.random() * hsrc.buffer.duration); } catch (e) { /* ignore */ }
    this.eng = {
      pitch, osc, det, vib, vibG, drift, driftG, cr, crG, mix, f1, f2, f3, dry, g1, g2, g3, gd,
      sub, subG, half, growl, growlD, nsrc, nbp, ng, hsrc, hscale, hpk, hlp, hg,
      sh1, sh2, x2, x3, sh2g, shG, shTrem, shMod, amp,
    };
    return this.eng;
  }

  /** Cancel the scheduled automation of every expressive param from t on. */
  _cancel(e, t) {
    for (const p of [e.amp.gain, e.pitch.offset, e.f1.frequency, e.f2.frequency, e.f3.frequency, e.g3.gain, e.vibG.gain, e.vib.frequency, e.ng.gain, e.nbp.frequency, e.shG.gain, e.crG.gain]) cancelFrom(p, t);
    if (e.subG) { cancelFrom(e.subG.gain, t); cancelFrom(e.growlD.gain, t); }
    if (e.hg) { cancelFrom(e.hg.gain, t); cancelFrom(e.hpk.frequency, t); cancelFrom(e.hlp.frequency, t); }
  }

  _releaseAt(t, fade) {
    const e = this.eng;
    if (!e) return;
    const k = this.p.formant;
    glide(e.amp.gain, 0, t, fade / 3);
    glide(e.pitch.offset, mtof(this.curMidi - 0.6), t, fade / 2);
    glide(e.f1.frequency, VOW.oo[0] * k, t, fade / 2);
    glide(e.f2.frequency, VOW.oo[1] * k, t, fade / 2);
    glide(e.ng.gain, 0, t, fade / 3);
    glide(e.vibG.gain, 0, t, fade);
    glide(e.shG.gain, 0, t, fade / 4);
    glide(e.crG.gain, 0, t, fade / 4);
  }

  /** Tear the tone engine down; with `fade` it is first faded out (voice stealing). */
  _killEngine(now, fade = 0) {
    const e = this.eng;
    if (!e) return;
    this.eng = null;
    this.humming = false;
    const nodes = Object.values(e).filter(Boolean);
    const srcs = [e.pitch, e.osc, e.vib, e.drift, e.cr, e.sh1, e.sh2, e.sub, e.growl, e.nsrc, e.hsrc].filter(Boolean);
    if (fade > 0) {
      holdAt(e.amp.gain, now);
      rampAt(e.amp.gain, 0, now + fade);
      for (const n of srcs) stopAt(n, now + fade + 0.02);
      e.osc.onended = () => disconnect(...nodes);
    } else {
      for (const n of srcs) stopAt(n, now);
      disconnect(...nodes);
    }
    this.sys._releaseVoiceEngine(this);
  }

  _buildCharge(now) {
    const io = this._io();
    const sys = this.sys;
    if (!io || !sys.bank) return;
    if (!this._attached(now)) this._place(now, true);
    const ctx = sys.ctx;
    const W = getWaves(ctx);
    const G = (v) => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(this.calf ? W.calf : W.whale);
    osc.frequency.value = mtof(this.p.base - 7);
    const sub = ctx.createOscillator();
    sub.frequency.value = mtof(this.p.base - 19);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.Q.value = 2;
    const sg = G(0.5);
    const g = G(0);
    const trem = G(1);
    osc.connect(lp); lp.connect(g);
    sub.connect(sg); sg.connect(g);
    g.connect(trem); trem.connect(io.air);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 3;
    const lfoG = G(0.12);
    lfo.connect(lfoG); lfoG.connect(trem.gain);
    const nsrc = ctx.createBufferSource();
    nsrc.buffer = sys.bank.noise.brown;
    nsrc.loop = true;
    const nlp = ctx.createBiquadFilter();
    nlp.type = 'lowpass';
    nlp.frequency.value = 110;
    const rg = G(0);
    nsrc.connect(nlp); nlp.connect(rg); rg.connect(io.air);
    const t = now + 0.005;
    startAt(osc, t); startAt(sub, t); startAt(lfo, t); startAt(nsrc, t);
    this.charge = { osc, sub, lp, sg, g, trem, lfo, lfoG, nsrc, nlp, rg, m: null, x: -1, stopping: false, killAt: 0 };
  }

  _killCharge(now) {
    const c = this.charge;
    if (!c) return;
    this.charge = null;
    for (const n of [c.osc, c.sub, c.lfo, c.nsrc]) stopAt(n, now);
    disconnect(c.osc, c.sub, c.lp, c.sg, c.g, c.trem, c.lfo, c.lfoG, c.nsrc, c.nlp, c.rg);
  }

  /** Called by AudioSystem.update each frame. */
  update(now) {
    if (!this.io) return;
    if (this.humming && now > this.humEnd) this.humming = false;
    // idle: leave the params alone (gliding them would only queue events); placed on attach
    if (this._attached(now)) this._place(now, false);
    if (this.charge && this.charge.stopping && now > this.charge.killAt) this._killCharge(now);
    if (this.eng && !this.humming && now - Math.max(this.lastActive, this.humEnd) > 3) this._killEngine(now);
  }

  // ---- calls -------------------------------------------------------------------------------

  _callDef(kind) {
    const key = this.sys._keyNow();
    const pcs = key.pcs;
    const b = this.p.base;
    const ct = (m) => snapToChord(m, pcs);
    const up = (m, n) => stepChord(m, pcs, n);
    const S = (t, m, g, v) => ({ t, m, g, v });
    switch (kind) {
      case 'chirp': {
        const p0 = ct(b + 4);
        const p1 = up(p0, 1);
        return {
          gain: 0.75, vib: [9, 25], breath: 0.15,
          segs: [S(0, p0 - 4, 0, 'ee'), S(0.035, p0, 1, 'ee'), S(0.11, p0 + 1.5, 0.85, 'ee'), S(0.15, p0 + 2, 0, 'eh'),
            S(0.2, p1 - 3, 0, 'ee'), S(0.235, p1, 1, 'ee'), S(0.33, p1 + 2, 0.7, 'ah'), S(0.4, p1 + 3, 0, 'ah')],
        };
      }
      case 'coo': {
        const p0 = ct(b);
        const p1 = up(p0, 1);
        return {
          gain: 0.85, vib: [this.calf ? 6.5 : 5, 20], breath: 0.25, sub: this.calf ? 0 : 0.25,
          segs: [S(0, p0 - 1, 0, 'oo'), S(0.07, p0, 0.85, 'oo'), S(0.3, p1, 1, 'oh'), S(0.55, p1, 0.8, 'oh'), S(0.75, p0, 0.6, 'oo'), S(0.95, p0 - 0.5, 0, 'oo')],
        };
      }
      case 'answer': {
        const r = ct(b);
        const u1 = up(r, 1);
        const u2 = up(r, 2);
        return {
          gain: 0.9, vib: [lerp(5.6, 4.4, this.size), 24], breath: 0.2, sub: this.calf ? 0 : 0.35,
          segs: [S(0, r - 2, 0, 'oo'), S(0.15, r, 0.9, 'oo'), S(0.55, u2, 1, 'ah'), S(1.0, u2, 0.95, 'ah'), S(1.25, u1, 0.9, 'oh'), S(1.8, u1, 0.7, 'oo'), S(2.15, u1 - 1, 0, 'oo')],
        };
      }
      case 'warn': {
        const low = ct(b - 5);
        const segs = [];
        for (let i = 0; i < 3; i++) {
          const o = i * 0.36;
          const p = low - i * 0.3;
          segs.push(S(o, p - 1, 0, 'ah'), S(o + 0.04, p, 1, 'ah'), S(o + 0.22, p - 0.3, 0.8, 'ah'), S(o + 0.28, p - 0.6, 0, 'oh'));
        }
        return { gain: 1, vib: [7, 12], breath: 0.3, sub: this.calf ? 0.1 : 0.7, segs };
      }
      case 'yawn': {
        const p = ct(b + 5);
        return {
          gain: 0.7, vib: [3.5, 30], breath: 0.6, sub: this.calf ? 0 : 0.2,
          segs: [S(0, p, 0, 'ah'), S(0.25, p + 1, 0.7, 'ah'), S(0.9, p - 3, 0.6, 'oh'), S(1.5, p - 7, 0.45, 'oo'), S(1.9, p - 9, 0, 'oo')],
        };
      }
      case 'play': {
        const a = ct(b + 2);
        const c = stepScale(a, key.root, key.scale, 1);
        const top = up(a, 2);
        const segs = [S(0, a, 0, 'ah')];
        for (let i = 0; i < 8; i++) {
          const t = 0.02 + i * 0.068;
          const m = i % 2 ? c : a;
          segs.push(S(t, m, 0.85, i % 2 ? 'ee' : 'ah'), S(t + 0.045, m, 0.8, i % 2 ? 'ee' : 'ah'));
        }
        segs.push(S(0.62, top, 0.9, 'ah'), S(0.82, top + 1, 0, 'ah'));
        return { gain: 0.8, vib: [8, 15], breath: 0.15, segs };
      }
      case 'roar': {
        const low = ct(b - 7);
        return {
          gain: 1.35, vib: [6, 22], breath: 0.7, sub: this.calf ? 0.3 : 0.9, drive: 2.6, wet: 0.5,
          segs: [S(0, low - 5, 0, 'ah'), S(0.12, low, 1, 'ah'), S(0.55, low + 4, 1, 'ah'), S(1.05, low + 2, 0.85, 'ah'), S(1.4, low - 3, 0.5, 'oh'), S(1.7, low - 5, 0, 'oo')],
        };
      }
      default:
        return null;
    }
  }

  /** Layer a real humpback song unit under a call, retuned (by octaves) to its main note. */
  _playRecCall(kind, def, t) {
    const lib = this.sys.samples;
    const group = { chirp: 'wChirp', play: 'wChirp', coo: 'wCoo', answer: 'wMoan', warn: 'wGrunt', yawn: 'wLong', roar: 'wLong' }[kind];
    if (!lib || !group || !this.io) return;
    const takes = [lib.pick(group)];
    if (kind === 'roar') takes.push(lib.pick('wGrunt'));
    let m = def.segs[0].m;
    let top = -1;
    for (const s of def.segs) if (s.g > top) { top = s.g; m = s.m; }
    const ctx = this.sys.ctx;
    const k = this.p.formant;
    takes.forEach((take, i) => {
      if (!take || !take.f0) return;
      let rate = mtof(m - i * 12) / take.f0;
      while (rate > 2.4) rate /= 2;
      while (rate < 0.5) rate *= 2;
      if (kind === 'play') rate = Math.min(2.4, rate * 1.25);
      const src = ctx.createBufferSource();
      src.buffer = take.buffer;
      src.playbackRate.value = rate;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = (this.calf ? 3200 : 2200) * k;
      const g = ctx.createGain();
      g.gain.value = 0;
      const vol = def.gain * this.trim * (kind === 'roar' ? 2.4 : this.calf ? 1.4 : 1.8) * (i ? 0.8 : 1);
      const dur = take.buffer.duration / rate;
      setAt(g.gain, 0, t);
      rampAt(g.gain, vol, t + 0.04);
      setAt(g.gain, vol, Math.max(t + 0.05, t + dur - 0.2));
      rampAt(g.gain, 0, t + dur);
      src.connect(lp); lp.connect(g); g.connect(this.io.air);
      if (def.wet) {
        const w = ctx.createGain();
        w.gain.value = def.wet;
        g.connect(w);
        w.connect(this.sys.bus.worldWet);
        src.onended = () => disconnect(src, lp, g, w);
      } else src.onended = () => disconnect(src, lp, g);
      startAt(src, t);
      stopAt(src, t + dur + 0.05);
      this._callEnd = Math.max(this._callEnd, t + dur + 0.05);
    });
  }

  _playCall(def, t) {
    const sys = this.sys;
    const ctx = sys.ctx;
    const io = this.io;
    const W = getWaves(ctx);
    const k = this.p.formant;
    const segs = def.segs;
    const T = segs[segs.length - 1].t;
    const G = (v) => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };
    const nodes = [];
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(this.calf ? W.calf : W.whale);
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.Q.value = 4;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.Q.value = 5.5;
    const dry = ctx.createBiquadFilter();
    dry.type = 'lowpass';
    dry.frequency.value = 560 * k;
    const g1 = G(2.1);
    const g2 = G(1.4);
    const gd = G(this.calf ? 0.7 : 0.45);
    const mix = G(1);
    const env = G(0);
    osc.connect(f1); f1.connect(g1); g1.connect(mix);
    osc.connect(f2); f2.connect(g2); g2.connect(mix);
    osc.connect(dry); dry.connect(gd); gd.connect(mix);
    nodes.push(osc, f1, f2, dry, g1, g2, gd, mix, env);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = def.vib[0];
    const lg = G(def.vib[1]);
    lfo.connect(lg); lg.connect(osc.detune);
    nodes.push(lfo, lg);
    let sub = null;
    if (def.sub) {
      sub = ctx.createOscillator();
      sub.type = 'triangle';
      const sg = G(def.sub);
      lg.connect(sub.detune);
      sub.connect(sg); sg.connect(mix);
      nodes.push(sub, sg);
    }
    let nsrc = null;
    if (def.breath && sys.bank) {
      nsrc = ctx.createBufferSource();
      nsrc.buffer = sys.bank.noise.pink;
      nsrc.loop = true;
      const nbp = ctx.createBiquadFilter();
      nbp.type = 'bandpass';
      nbp.frequency.value = VOW.ah[1] * k;
      nbp.Q.value = 1.2;
      const ng = G(def.breath * this.p.breath * 2.5);
      nsrc.connect(nbp); nbp.connect(ng); ng.connect(mix);
      nodes.push(nsrc, nbp, ng);
    }
    let last = mix;
    if (def.drive) {
      if (!driveCache) driveCache = driveCurve(def.drive);
      const pre = G(1.6);
      const sh = ctx.createWaveShaper();
      sh.curve = driveCache;
      const post = G(0.6);
      mix.connect(pre); pre.connect(sh); sh.connect(post);
      last = post;
      nodes.push(pre, sh, post);
    }
    last.connect(env);
    env.connect(io.air);
    if (def.wet) {
      const w = G(def.wet);
      env.connect(w);
      w.connect(sys.bus.worldWet);
      nodes.push(w);
    }
    const gain = def.gain * this.trim;
    segs.forEach((s, i) => {
      const tt = t + s.t;
      const f = mtof(s.m);
      const V = VOW[s.v] || VOW.ah;
      if (i === 0) {
        setAt(osc.frequency, f, tt);
        if (sub) setAt(sub.frequency, f / 2, tt);
        setAt(env.gain, s.g * gain, tt);
        setAt(f1.frequency, V[0] * k, tt);
        setAt(f2.frequency, V[1] * k, tt);
      } else {
        expAt(osc.frequency, f, tt);
        if (sub) expAt(sub.frequency, f / 2, tt);
        rampAt(env.gain, s.g * gain, tt);
        expAt(f1.frequency, V[0] * k, tt);
        expAt(f2.frequency, V[1] * k, tt);
      }
    });
    const end = t + T + 0.06;
    this._callEnd = Math.max(this._callEnd, end);
    for (const n of [osc, lfo, sub, nsrc]) {
      if (!n) continue;
      if (n === nsrc) {
        try { n.start(t, Math.random() * 2); } catch (e) { /* ignore */ }
      } else startAt(n, t);
      stopAt(n, end);
    }
    osc.onended = () => disconnect(...nodes);
  }
}
