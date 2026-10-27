// Playable instruments for the score.
//   Sampler: pre-rendered notes (piano, harp, celesta...) pitched with playbackRate,
//            with a polyphony cap and voice stealing.
//   Section: a sustained real-time ensemble (string pad, choir "aah", brass, drone) with
//            persistent voices that voice-lead from chord to chord. Built lazily when it
//            becomes audible and torn down after a few silent seconds.
//   Line:    a monophonic legato voice (solo strings, flute) with delayed vibrato.
import {
  clamp, mtof, glide, setAt, cancelFrom, holdAt, rampAt, disconnect, stopAt, startAt,
} from './util.js';

// ---- periodic waves (one set per context) ------------------------------------------

const WAVES = new WeakMap();

export function getWaves(ctx) {
  let w = WAVES.get(ctx);
  if (w) return w;
  const make = (fn, n = 64) => {
    const re = new Float32Array(n + 1);
    const im = new Float32Array(n + 1);
    for (let k = 1; k <= n; k++) im[k] = fn(k);
    return ctx.createPeriodicWave(re, im);
  };
  w = {
    // warm, slightly rounded saw for strings
    strings: make((k) => Math.pow(k, -1.12) / (1 + Math.pow(k / 22, 2))),
    // glottal-ish source for the choir (formants shape the vowel)
    choir: make((k) => Math.pow(k, -1.25) * (k % 2 ? 1 : 0.85) / (1 + Math.pow(k / 30, 2))),
    // bright source; the brass filter opens with loudness
    brass: make((k) => Math.pow(k, -0.9) / (1 + Math.pow(k / 34, 2))),
    flute: make((k) => [0, 1, 0.16, 0.07, 0.025, 0.01][k] || 0, 6),
    drone: make((k) => [0, 1, 0.42, 0.16, 0.08, 0.04, 0.02][k] || 0, 7),
    // whale voices: fundamental-rich moan; the calf a purer, rounder squeak
    whale: make((k) => Math.pow(k, -1.3) * (k === 2 ? 1.25 : 1) / (1 + Math.pow(k / 18, 2)), 40),
    calf: make((k) => Math.pow(k, -1.8) * (k === 2 ? 1.4 : 1), 20),
    // hollow, reedy tone for the falcon and FX
    reed: make((k) => (k % 2 ? 1 / k : 0.25 / k), 30),
  };
  WAVES.set(ctx, w);
  return w;
}

// ---- Sampler ---------------------------------------------------------------------------

export class Sampler {
  constructor(sys, name, notes, o = {}) {
    this.sys = sys;
    this.ctx = sys.ctx;
    this.name = name;
    this.notes = notes || [];
    this.cap = o.cap || 16;
    this.release = o.release ?? 0.25;
    this.active = [];
    this.flip = 0;
    this.bus = [];
    const ctx = this.ctx;
    const pans = o.spread ? [(o.pan || 0) - o.spread, (o.pan || 0) + o.spread] : [o.pan || 0];
    for (const p of pans) {
      const g = ctx.createGain();
      g.gain.value = (o.gain ?? 1) / Math.sqrt(pans.length);
      const sp = ctx.createStereoPanner();
      sp.pan.value = clamp(p, -1, 1);
      g.connect(sp);
      sp.connect(o.out || sys.bus.musicDry);
      if (o.send) {
        const s = ctx.createGain();
        s.gain.value = o.send;
        sp.connect(s);
        s.connect(o.wet || sys.bus.musicWet);
      }
      this.bus.push(g);
    }
  }

  _nearest(midi) {
    const a = this.notes;
    let best = a[0];
    let bd = Infinity;
    for (let i = 0; i < a.length; i++) {
      const d = Math.abs(a[i].midi - midi) + (a[i].midi < midi ? 0.01 : 0); // prefer shifting down
      if (d < bd) {
        bd = d;
        best = a[i];
      }
    }
    return best;
  }

  /** Play a note at AudioContext time t. dur (s) damps the note; undefined lets it ring. */
  play(midi, t, vel = 0.7, dur, o = {}) {
    if (!this.notes.length || !(vel > 0.0005) || !Number.isFinite(midi) || !Number.isFinite(t)) return null;
    const ctx = this.ctx;
    const s = this._nearest(midi);
    const rate = Math.pow(2, (midi - s.midi) / 12) * (o.rate || 1);
    if (!(rate > 0.05 && rate < 16)) return null;
    const now = ctx.currentTime;
    t = Math.max(t, now);
    const src = ctx.createBufferSource();
    src.buffer = s.buffer;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = Math.min(4, vel);
    src.connect(g);
    const bus = o.bus != null ? this.bus[o.bus % this.bus.length] : this.bus[this.flip++ % this.bus.length];
    g.connect(o.dest || bus);
    let end = t + s.buffer.duration / rate;
    const rel = o.release ?? this.release;
    if (dur != null && Number.isFinite(dur) && rel > 0 && t + dur + rel * 4 < end) {
      setAt(g.gain, Math.min(4, vel), t + dur);
      glide(g.gain, 0, t + dur, rel / 3);
      end = t + dur + rel * 2;
    }
    startAt(src, t);
    stopAt(src, end);
    const rec = { src, g, end };
    src.onended = () => disconnect(g, src);
    this._admit(rec, now);
    return rec;
  }

  _admit(rec, now) {
    const a = this.active;
    let w = 0;
    for (let i = 0; i < a.length; i++) if (a[i].end > now) a[w++] = a[i];
    a.length = w;
    while (a.length >= this.cap) {
      const old = a.shift();
      holdAt(old.g.gain, now);
      rampAt(old.g.gain, 0, now + 0.04);
      stopAt(old.src, now + 0.05);
      old.end = now + 0.05;
    }
    a.push(rec);
  }

  stopAll(t, fade = 0.1) {
    for (const r of this.active) {
      holdAt(r.g.gain, t);
      rampAt(r.g.gain, 0, t + fade);
      stopAt(r.src, t + fade + 0.02);
    }
    this.active.length = 0;
  }
}

// ---- Section ----------------------------------------------------------------------------

// formant centres (Hz) and relative gains for the choir
const VOWELS = {
  ah: [[780, 1], [1180, 0.55], [2850, 0.22]],
  oo: [[330, 1], [720, 0.32], [2650, 0.08]],
  oh: [[480, 1], [860, 0.45], [2750, 0.12]],
  ee: [[290, 0.9], [2250, 0.38], [3000, 0.2]],
};
const FQ = [5.5, 7, 9];

export class Section {
  constructor(sys, o) {
    this.sys = sys;
    this.ctx = sys.ctx;
    this.o = o;
    this.n = o.voices || 4;
    this.notes = [];
    this.vowel = o.vowel || 'ah';
    this.built = false;
    this.zeroSince = 0;
    this.lastLv = -1;
    this.lastLvT = 0;
    const ctx = this.ctx;
    this.art = ctx.createGain(); // articulation (scheduled: swells, stinger envelopes)
    this.art.gain.value = o.artBase ?? 1;
    this.out = ctx.createGain(); // level (real-time control)
    this.out.gain.value = 0;
    this.art.connect(this.out);
    this.out.connect(o.dry || sys.bus.musicDry);
    if (o.send) {
      this.wet = ctx.createGain();
      this.wet.gain.value = o.send;
      this.out.connect(this.wet);
      this.wet.connect(o.wetBus || sys.bus.musicWet);
    }
  }

  _build(t) {
    const ctx = this.ctx;
    const o = this.o;
    const nch = o.width ? 2 : 1;
    const U = o.unison || 1;
    this.chains = [];
    for (let c = 0; c < nch; c++) {
      const input = ctx.createGain();
      input.gain.value = 1 / Math.sqrt(Math.max(1, (this.n / nch) * U));
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = o.filter || 3000;
      lp.Q.value = o.q ?? 0.4;
      input.connect(lp);
      let last = lp;
      let formants = null;
      if (o.formants) {
        const sum = ctx.createGain();
        sum.gain.value = 1;
        formants = [];
        const V = VOWELS[this.vowel] || VOWELS.ah;
        for (let k = 0; k < 3; k++) {
          const bp = ctx.createBiquadFilter();
          bp.type = 'bandpass';
          bp.frequency.value = V[k][0];
          bp.Q.value = FQ[k];
          const g = ctx.createGain();
          g.gain.value = V[k][1] * 3.2;
          lp.connect(bp);
          bp.connect(g);
          g.connect(sum);
          formants.push({ bp, g });
        }
        last = sum;
      }
      let trem = null;
      if (o.tremolo) {
        trem = ctx.createGain();
        trem.gain.value = 1 - o.tremolo.depth * 0.5;
        last.connect(trem);
        last = trem;
      }
      const pan = ctx.createStereoPanner();
      pan.pan.value = clamp((o.pan || 0) + (nch > 1 ? (c ? 1 : -1) * o.width : 0), -1, 1);
      last.connect(pan);
      pan.connect(this.art);
      this.chains.push({ input, lp, formants, trem, pan });
    }
    this.lfos = [];
    const vib = o.vib;
    if (vib) {
      for (let k = 0; k < 2; k++) {
        const l = ctx.createOscillator();
        l.frequency.value = vib[0] * (k ? 1.13 : 0.93);
        const g = ctx.createGain();
        g.gain.value = vib[1];
        l.connect(g);
        startAt(l, t + k * 0.05);
        this.lfos.push({ l, g });
      }
    }
    if (o.tremolo) {
      const l = ctx.createOscillator();
      l.frequency.value = o.tremolo.rate;
      const g = ctx.createGain();
      g.gain.value = o.tremolo.depth * 0.5;
      l.connect(g);
      for (const ch of this.chains) g.connect(ch.trem.gain);
      startAt(l, t);
      this.tremLfo = { l, g };
    }
    if (o.breath && this.sys.bank) {
      const src = ctx.createBufferSource();
      src.buffer = this.sys.bank.noise.white;
      src.loop = true;
      const g = ctx.createGain();
      g.gain.value = o.breath;
      src.connect(g);
      for (const ch of this.chains) g.connect(ch.input);
      startAt(src, t);
      this.breath = { src, g };
    }
    this.voices = [];
    for (let i = 0; i < this.n; i++) {
      const vg = ctx.createGain();
      vg.gain.value = 0;
      vg.connect(this.chains[i % nch].input);
      const oscs = [];
      for (let u = 0; u < U; u++) {
        const osc = ctx.createOscillator();
        osc.setPeriodicWave(o.wave);
        osc.frequency.value = 220;
        osc.detune.value = U > 1 ? ((u / (U - 1)) * 2 - 1) * (o.spread || 0) : 0;
        if (this.lfos.length) this.lfos[(i + u) % this.lfos.length].g.connect(osc.detune);
        osc.connect(vg);
        startAt(osc, t + (i * U + u) * 0.0037);
        oscs.push(osc);
      }
      this.voices.push({ vg, oscs, note: null });
    }
    this.built = true;
    this._apply(this.notes, t, true);
  }

  _teardown(t) {
    if (!this.built) return;
    for (const v of this.voices) {
      for (const o of v.oscs) stopAt(o, t);
      disconnect(v.vg, ...v.oscs);
    }
    for (const l of this.lfos) {
      stopAt(l.l, t);
      disconnect(l.l, l.g);
    }
    if (this.tremLfo) {
      stopAt(this.tremLfo.l, t);
      disconnect(this.tremLfo.l, this.tremLfo.g);
      this.tremLfo = null;
    }
    if (this.breath) {
      stopAt(this.breath.src, t);
      disconnect(this.breath.src, this.breath.g);
      this.breath = null;
    }
    for (const ch of this.chains) {
      disconnect(ch.input, ch.lp, ch.trem, ch.pan);
      if (ch.formants) for (const f of ch.formants) disconnect(f.bp, f.g);
    }
    this.voices = [];
    this.chains = [];
    this.lfos = [];
    this.built = false;
    this.lastLv = -1;
    setAt(this.out.gain, 0, t);
  }

  _apply(notes, t, immediate) {
    const o = this.o;
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i];
      const m = notes[i];
      if (m == null) {
        if (v.note != null) glide(v.vg.gain, 0, t, (o.release || 1) / 3);
        v.note = null;
        continue;
      }
      const f = mtof(m);
      if (immediate) {
        for (const osc of v.oscs) setAt(osc.frequency, f, t);
        glide(v.vg.gain, 1, t, (o.attack || 0.5) / 3);
      } else if (v.note == null) {
        for (const osc of v.oscs) glide(osc.frequency, f, t, 0.012);
        glide(v.vg.gain, 1, t, (o.attack || 0.5) / 3);
      } else if (v.note !== m) {
        for (const osc of v.oscs) glide(osc.frequency, f, t, o.glide ?? 0.05);
        if (o.rebow) {
          glide(v.vg.gain, 0.7, t, 0.035);
          glide(v.vg.gain, 1, t + 0.1, 0.12);
        }
      }
      v.note = m;
    }
  }

  /** Voice the section on a chord at time t (notes: midi array, lowest first). */
  setNotes(notes, t) {
    this.notes = (notes || []).slice(0, this.n);
    if (this.built) this._apply(this.notes, t, false);
  }

  setVowel(vowel, t, tc = 0.3) {
    if (!VOWELS[vowel] || vowel === this.vowel) return;
    this.vowel = vowel;
    if (!this.built) return;
    const V = VOWELS[vowel];
    for (const ch of this.chains) {
      if (!ch.formants) continue;
      ch.formants.forEach((f, k) => {
        glide(f.bp.frequency, V[k][0], t, tc);
        glide(f.g.gain, V[k][1] * 3.2, t, tc);
      });
    }
  }

  /** Real-time level (0..1 before the section trim). Builds or tears down the voices. */
  setLevel(v, now) {
    v = clamp(v, 0, 2);
    if (v > 0.0008) {
      this.zeroSince = -1;
      // at most one section is built per frame, to keep frame times flat
      if (!this.built && this.sys._buildTicket !== now) {
        this.sys._buildTicket = now;
        this._build(now + 0.01);
      }
    } else if (this.zeroSince < 0) this.zeroSince = now;
    if (!this.built) return;
    if (Math.abs(v - this.lastLv) > 0.003 || now - this.lastLvT > 0.5) {
      glide(this.out.gain, v * (this.o.gain ?? 1), now, this.o.levelTc ?? 0.3);
      this.lastLv = v;
      this.lastLvT = now;
    }
    if (this.zeroSince >= 0 && now - this.zeroSince > 4 && !this.o.manual) this._teardown(now);
  }

  /** Crescendo-diminuendo on the articulation gain (and the filter, for brass). */
  swell(t, dur, amt = 1) {
    if (!this.built) return;
    const o = this.o;
    const base = o.artBase ?? 1;
    const peak = base + (1.5 - base) * clamp(amt, 0, 1);
    glide(this.art.gain, peak, t, dur * 0.28);
    glide(this.art.gain, base, t + dur * 0.62, dur * 0.16);
    if (o.filterSwell) {
      for (const ch of this.chains) {
        glide(ch.lp.frequency, o.filterSwell, t, dur * 0.28);
        glide(ch.lp.frequency, o.filter || 1000, t + dur * 0.62, dur * 0.16);
      }
    }
  }

  /** Manual envelope (stingers): sound notes with attack/hold/release at time t. */
  hit(notes, t, peak, attack, hold, release) {
    const now = this.ctx.currentTime;
    if (!this.built) this._build(now);
    this.zeroSince = -1;
    this.setNotes(notes, t);
    holdAt(this.out.gain, t);
    glide(this.out.gain, peak * (this.o.gain ?? 1), t, attack / 3);
    glide(this.out.gain, 0, t + attack + hold, release / 3);
    this.manualEnd = Math.max(this.manualEnd || 0, t + attack + hold + release * 2);
  }

  /** For manual sections: tear down after the last envelope has finished. */
  idle(now) {
    if (this.built && this.o.manual && now > (this.manualEnd || 0) + 1) this._teardown(now);
  }
}

// ---- Line (monophonic, legato) -------------------------------------------------------

export class Line {
  constructor(sys, o) {
    this.sys = sys;
    this.ctx = sys.ctx;
    this.o = o;
    this.built = false;
    this.endT = 0;
    this.lastLv = -1;
    this.lastLvT = 0;
    this.zeroSince = 0;
    const ctx = this.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    const pan = ctx.createStereoPanner();
    pan.pan.value = o.pan || 0;
    this.out.connect(pan);
    pan.connect(o.dry || sys.bus.musicDry);
    if (o.send) {
      const s = ctx.createGain();
      s.gain.value = o.send;
      pan.connect(s);
      s.connect(o.wetBus || sys.bus.musicWet);
    }
  }

  _build(t) {
    const ctx = this.ctx;
    const o = this.o;
    const U = o.unison || 1;
    this.vg = ctx.createGain();
    this.vg.gain.value = 0;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = o.filter || 4000;
    this.lp.Q.value = 0.5;
    this.vg.connect(this.lp);
    let last = this.lp;
    if (o.body) {
      this.body = ctx.createBiquadFilter();
      this.body.type = 'peaking';
      this.body.frequency.value = o.body[0];
      this.body.Q.value = 1.2;
      this.body.gain.value = o.body[1];
      last.connect(this.body);
      last = this.body;
    }
    last.connect(this.out);
    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = o.vib ? o.vib.rate : 5;
    this.vibG = ctx.createGain();
    this.vibG.gain.value = 0;
    this.lfo.connect(this.vibG);
    startAt(this.lfo, t);
    this.oscs = [];
    for (let u = 0; u < U; u++) {
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(o.wave);
      osc.frequency.value = 440;
      osc.detune.value = U > 1 ? ((u / (U - 1)) * 2 - 1) * (o.spread || 0) : 0;
      this.vibG.connect(osc.detune);
      osc.connect(this.vg);
      startAt(osc, t + u * 0.0041);
      this.oscs.push(osc);
    }
    this.vg.gain.value = 0;
    if (o.breath && this.sys.bank) {
      this.nsrc = ctx.createBufferSource();
      this.nsrc.buffer = this.sys.bank.noise.white;
      this.nsrc.loop = true;
      this.nbp = ctx.createBiquadFilter();
      this.nbp.type = 'bandpass';
      this.nbp.frequency.value = 2200;
      this.nbp.Q.value = 0.8;
      this.bg = ctx.createGain();
      this.bg.gain.value = 0;
      this.nsrc.connect(this.nbp);
      this.nbp.connect(this.bg);
      this.bg.connect(this.lp);
      startAt(this.nsrc, t);
    }
    this.built = true;
  }

  _teardown(t) {
    if (!this.built) return;
    for (const o of this.oscs) stopAt(o, t);
    stopAt(this.lfo, t);
    if (this.nsrc) stopAt(this.nsrc, t);
    disconnect(...this.oscs, this.lfo, this.vibG, this.vg, this.lp, this.body, this.nsrc, this.nbp, this.bg);
    this.oscs = [];
    this.nsrc = this.nbp = this.bg = this.body = null;
    this.built = false;
    this.lastLv = -1;
    setAt(this.out.gain, 0, t);
  }

  /** Sing/play a note: legato (glide) if the previous one is still sounding. */
  note(m, t, dur, vel = 0.7) {
    if (!Number.isFinite(m) || !Number.isFinite(t)) return;
    const o = this.o;
    const now = this.ctx.currentTime;
    if (!this.built) this._build(Math.min(t, now + 0.01));
    t = Math.max(t, now);
    const f = mtof(m);
    const legato = this.endT > t - 0.04;
    cancelFrom(this.vg.gain, t);
    cancelFrom(this.vibG.gain, t);
    if (this.bg) cancelFrom(this.bg.gain, t);
    for (const osc of this.oscs) {
      cancelFrom(osc.frequency, t);
      if (this.endT <= 0) setAt(osc.frequency, f, t);
      else glide(osc.frequency, f, t, legato ? o.portamento ?? 0.05 : 0.01);
    }
    const a = o.attack || 0.1;
    if (legato) {
      glide(this.vg.gain, vel * 0.82, t, 0.03);
      glide(this.vg.gain, vel, t + 0.06, a / 3);
    } else glide(this.vg.gain, vel, t, a / 3);
    if (o.vib) {
      glide(this.vibG.gain, o.vib.depth * 0.15, t, 0.05);
      glide(this.vibG.gain, o.vib.depth, t + (o.vib.delay ?? 0.3), 0.25);
    }
    if (this.bg) {
      glide(this.bg.gain, o.breath * vel * 1.8, t, 0.01);
      glide(this.bg.gain, o.breath * vel, t + 0.06, 0.06);
      glide(this.nbp.frequency, clamp(f * 2.2, 900, 6000), t, 0.05);
    }
    const end = t + Math.max(0.05, dur);
    glide(this.vg.gain, 0, end, (o.release || 0.3) / 3);
    if (this.bg) glide(this.bg.gain, 0, end, 0.05);
    this.endT = end;
  }

  setLevel(v, now) {
    v = clamp(v, 0, 2);
    if (v > 0.0008) this.zeroSince = -1;
    else if (this.zeroSince < 0) this.zeroSince = now;
    if (!this.built) return;
    if (Math.abs(v - this.lastLv) > 0.003 || now - this.lastLvT > 0.5) {
      glide(this.out.gain, v * (this.o.gain ?? 1), now, 0.3);
      this.lastLv = v;
      this.lastLvT = now;
    }
    if (this.zeroSince >= 0 && now - this.zeroSince > 4 && now > this.endT + 2) this._teardown(now);
  }
}
