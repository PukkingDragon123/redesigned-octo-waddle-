// The conductor: keeps the musical clock, generates the active mood bar by bar, and
// schedules notes ~120 ms ahead on the AudioContext clock.
//
// Mood changes land on the next bar line (or the next beat when the change is urgent).
// The new mood takes over tempo, key and harmony; the old mood's accompaniment keeps
// playing *over the new harmony* while it fades (its melodic layers stop at once), so a
// crossfade never clashes. Sustained sections are shared, so the strings simply re-voice.
import { MOODS } from './moods.js';
import { PATTERNS } from './patterns.js';
import { parseBar, parseChord, bassNote, chordTones, voiceChord, SCALES } from './theory.js';
import { Sampler, Section, Line, getWaves } from './instruments.js';
import { clamp, smoothstep, makeRng } from './util.js';

const LOOKAHEAD = 0.15;
const BURST = 12; // events per frame before deferring the ones not yet due
const DEFAULT_KEY = { root: 62, scale: SCALES.major };

// dev/test: AudioSystem opts.layers = ['harp', 'strings'] keeps only those instruments/sections
const keep = (sys, L) => !sys.opts.layers || sys.opts.layers.includes(L.inst || L.target);

const curve = (L, e) => {
  let v = L.on ? smoothstep(L.on[0], L.on[1], e) : 1;
  if (L.off) v *= 1 - smoothstep(L.off[0], L.off[1], e);
  return v;
};

class MoodInstance {
  constructor(name, def, t0, fade) {
    this.name = name;
    this.def = def;
    this.t0 = t0;
    this.fadeIn = Math.max(0.01, fade);
    this.outT0 = Infinity;
    this.fadeOut = 1;
    this.mem = new Map();
    this.bar = 0;
    this.formIdx = 0;
    this.secName = def.form[0];
    this.sec = def.sections[this.secName];
    this.secBar = 0;
    this.secCounts = { [this.secName]: 1 };
    this.secCount = 0;
  }

  levelAt(t) {
    const a = clamp((t - this.t0) / this.fadeIn);
    let l = Math.sin((a * Math.PI) / 2);
    if (t > this.outT0) l *= Math.cos((clamp((t - this.outT0) / this.fadeOut) * Math.PI) / 2);
    return l;
  }

  dead(t) {
    return t > this.outT0 + this.fadeOut + 0.05;
  }

  nextSection() {
    const def = this.def;
    this.formIdx++;
    if (this.formIdx >= def.form.length) this.formIdx = Math.min(def.loopFrom ?? 0, def.form.length - 1);
    this.secName = def.form[this.formIdx];
    this.sec = def.sections[this.secName];
    this.secBar = 0;
    const n = this.secCounts[this.secName] || 0;
    this.secCount = n;
    this.secCounts[this.secName] = n + 1;
  }
}

export class Conductor {
  constructor(sys) {
    this.sys = sys;
    this.ctx = sys.ctx;
    this.rng = makeRng(sys.seed || 1);
    this.instances = [];
    this.cur = null;
    this.curName = 'silence';
    this.pending = null;
    this.queue = [];
    this.qi = 0;
    this.intensity = 0.5;
    this.intTarget = 0.5;
    this.beatDur = 60 / 66;
    this.barStart = 0;
    this.nextBar = 0;
    this.running = false;
    this.grids = [{ t0: 0, beat: this.beatDur }];
    this.timeline = [{ t: 0, ch: parseChord('D'), key: DEFAULT_KEY }];
    this.levelT = 0;
    this._lv = {};
    this._per = {};
    this._c = { beats: 4 };
    this._buildInstruments();
  }

  _buildInstruments() {
    const sys = this.sys;
    const B = sys.bus;
    const bank = sys.bank;
    const W = getWaves(this.ctx);
    const S = (name, o, out = B.musicDry, wet = B.musicWet) => new Sampler(sys, name, bank.inst[name], { out, wet, ...o });
    this.inst = {
      piano: S('piano', { cap: 24, spread: 0.12, send: 0.3, gain: 2.1, release: 0.35 }),
      harp: S('harp', { cap: 24, pan: -0.22, spread: 0.22, send: 0.36, gain: 1.9 }),
      celesta: S('celesta', { cap: 12, pan: 0.28, spread: 0.18, send: 0.45, gain: 1.0 }),
      bell: S('bell', { cap: 10, pan: 0.15, spread: 0.25, send: 0.5, gain: 1.1 }),
      marimba: S('marimba', { cap: 12, pan: 0.2, spread: 0.15, send: 0.3, gain: 1.3 }),
      pizz: S('pizz', { cap: 16, pan: -0.1, spread: 0.2, send: 0.28, gain: 1.5 }),
      stac: S('stac', { cap: 20, pan: 0.05, spread: 0.18, send: 0.25, gain: 1.2, release: 0.06 }),
      timpani: S('timpani', { cap: 8, pan: 0.1, send: 0.35, gain: 1.4 }),
      taiko: S('taiko', { cap: 8, pan: -0.05, send: 0.3, gain: 1.4 }),
      heart: S('heart', { cap: 4, send: 0.12, gain: 1.6 }),
      swell: S('swell', { cap: 3, spread: 0.3, send: 0.4, gain: 0.6 }),
      crash: S('crash', { cap: 3, spread: 0.3, send: 0.4, gain: 0.7 }),
    };
    // stingers sit outside the mood mix (not ducked, not faded with moods)
    const ST = (name, o) => S(name, o, B.stingDry, B.stingWet);
    this.st = {
      piano: ST('piano', { cap: 12, spread: 0.1, send: 0.35, gain: 1.6, release: 0.5 }),
      harp: ST('harp', { cap: 20, pan: -0.15, spread: 0.3, send: 0.45, gain: 1.4 }),
      celesta: ST('celesta', { cap: 10, pan: 0.2, spread: 0.25, send: 0.55, gain: 1.0 }),
      bell: ST('bell', { cap: 6, pan: 0.1, spread: 0.2, send: 0.55, gain: 0.9 }),
      timpani: ST('timpani', { cap: 4, send: 0.4, gain: 1.5 }),
      taiko: ST('taiko', { cap: 4, send: 0.35, gain: 1.5 }),
      crash: ST('crash', { cap: 2, spread: 0.3, send: 0.45, gain: 0.8 }),
      stac: ST('stac', { cap: 8, spread: 0.2, send: 0.3, gain: 1.2, release: 0.1 }),
    };
    const sec = (o) => new Section(sys, o);
    this.sec = {
      strings: sec({ wave: W.strings, voices: 5, unison: 2, spread: 9, width: 0.42, filter: 2300, attack: 0.9, release: 1.2, vib: [5.2, 9], send: 0.45, gain: 0.4, glide: 0.06, rebow: true }),
      low: sec({ wave: W.strings, voices: 2, unison: 2, spread: 7, width: 0.18, pan: 0.18, filter: 900, attack: 0.7, release: 1.0, vib: [4.8, 6], send: 0.3, gain: 0.28, glide: 0.08 }),
      trem: sec({ wave: W.strings, voices: 3, unison: 2, spread: 8, width: 0.3, filter: 1500, attack: 0.25, release: 0.6, tremolo: { rate: 11.5, depth: 0.85 }, send: 0.3, gain: 0.4, glide: 0.04 }),
      choir: sec({ wave: W.choir, voices: 4, unison: 2, spread: 11, width: 0.5, filter: 5200, formants: true, attack: 1.3, release: 1.6, vib: [4.6, 14], send: 0.6, gain: 0.5, glide: 0.09, breath: 0.035 }),
      brass: sec({ wave: W.brass, voices: 3, unison: 2, spread: 6, width: 0.3, pan: 0.1, filter: 800, filterSwell: 2600, attack: 0.6, release: 0.9, vib: [4.5, 4], send: 0.4, gain: 0.45, artBase: 0.45, glide: 0.07 }),
      drone: sec({ wave: W.drone, voices: 3, unison: 2, spread: 4, width: 0.3, filter: 1100, attack: 2.5, release: 2.5, send: 0.4, gain: 0.4 }),
    };
    this.lines = {
      lead: new Line(sys, { wave: W.strings, unison: 3, spread: 8, filter: 3400, body: [420, 3], attack: 0.2, release: 0.5, vib: { rate: 5.4, depth: 16, delay: 0.3 }, portamento: 0.05, send: 0.5, gain: 0.3, pan: -0.08 }),
      flute: new Line(sys, { wave: W.flute, unison: 1, filter: 5200, attack: 0.08, release: 0.22, vib: { rate: 5, depth: 13, delay: 0.25 }, breath: 0.11, portamento: 0.03, send: 0.5, gain: 0.42, pan: 0.15 }),
    };
    this.stingPad = new Section(sys, { wave: W.strings, voices: 5, unison: 2, spread: 10, width: 0.5, filter: 2800, attack: 0.3, release: 1.5, vib: [5, 8], send: 0.6, gain: 0.45, manual: true, glide: 0.05, dry: B.stingDry, wetBus: B.stingWet });
    for (const k of [...Object.keys(this.sec), ...Object.keys(this.lines)]) {
      this._lv[k] = 0;
      this._per[k] = 0;
    }
  }

  // ---- control --------------------------------------------------------------------------

  setIntensity(x, immediate = false) {
    this.intTarget = clamp(Number.isFinite(x) ? x : 0.5);
    if (immediate) this.intensity = this.intTarget;
  }

  setMood(name, fade = 6) {
    fade = clamp(Number.isFinite(fade) ? fade : 6, 0, 60);
    if (name !== 'silence' && !MOODS[name]) return false;
    const now = this.ctx.currentTime;
    if (this.pending) {
      if (this.pending.name === name) return true;
      this.pending = null;
    }
    if (name === this.curName) return true;
    if (!this.running) {
      this.running = true;
      const t = now + 0.06;
      this.nextBar = t;
      this.barStart = t;
      this.pending = { name, fade, ts: t };
      return true;
    }
    let ts;
    if (name === 'silence') ts = now + 0.03;
    else if (this.nextBar - now <= Math.max(0.75, fade * 0.5)) ts = this.nextBar;
    else {
      const k = Math.ceil((now + 0.15 - this.barStart) / this.beatDur);
      ts = Math.min(this.nextBar, this.barStart + k * this.beatDur);
    }
    this.pending = { name, fade, ts: Math.max(ts, now + 0.02) };
    return true;
  }

  _applySwitch(p) {
    const t = p.ts;
    for (const inst of this.instances) {
      if (inst.outT0 === Infinity) {
        inst.outT0 = t;
        inst.fadeOut = Math.max(0.05, p.fade);
      }
    }
    const def = MOODS[p.name];
    this.curName = p.name;
    if (!def) {
      this.cur = null;
      return;
    }
    const inst = new MoodInstance(p.name, def, t, p.fade);
    this.instances.push(inst);
    while (this.instances.length > 3) this.instances.shift();
    this.cur = inst;
    this.beatDur = 60 / def.bpm;
    this.barStart = t;
    this.grids.push({ t0: t, beat: this.beatDur });
  }

  // ---- scheduling --------------------------------------------------------------------

  /** Generate bars and dispatch every event that falls inside the lookahead window. */
  schedule(now) {
    if (!this.running) return;
    // a long stall (hidden tab, breakpoint): jump the clock forward instead of bursting
    if (this.nextBar < now - 0.25) {
      const bar = this.beatDur * 4;
      const n = Math.ceil((now + 0.05 - this.nextBar) / bar);
      this.nextBar += n * bar;
      this.barStart = this.nextBar - bar;
      this._cutQueue(-Infinity);
      if (this.pending && this.pending.ts < now) this.pending.ts = now + 0.05;
    }
    const until = now + LOOKAHEAD;
    for (let guard = 0; guard < 16; guard++) {
      const p = this.pending;
      if (p && p.ts <= until && p.ts <= this.nextBar + 1e-6) {
        this.pending = null;
        this._cutQueue(p.ts);
        this._applySwitch(p);
        this.nextBar = p.ts;
        continue;
      }
      if (this.nextBar <= until) {
        this._genBar(this.nextBar);
        continue;
      }
      break;
    }
    this._flush(now, until);
    // drop dead instances and old grid/timeline entries
    if (this.instances.length && this.instances[0].dead(now) && this.instances[0] !== this.cur) this.instances.shift();
    while (this.grids.length > 1 && this.grids[1].t0 <= now) this.grids.shift();
    while (this.timeline.length > 1 && this.timeline[1].t <= now) this.timeline.shift();
  }

  _driver() {
    if (this.cur) return this.cur;
    for (let i = this.instances.length - 1; i >= 0; i--) if (this.instances[i].outT0 !== Infinity) return this.instances[i];
    return null;
  }

  _energy(inst, drv) {
    const sec = inst === drv ? inst.sec : null;
    let e = this.intensity;
    if (sec && sec.energy != null) e = inst.def.sectionEnergy ? clamp(sec.energy + (this.intensity - 0.5) * 0.2) : Math.max(e, sec.energy);
    return e;
  }

  _targetOwner(target, drv) {
    for (let i = this.instances.length - 1; i >= 0; i--) {
      const inst = this.instances[i];
      for (const L of inst.def.layers) {
        if (L.target !== target) continue;
        if (inst !== drv && (L.melodic || L.secs)) continue;
        return inst;
      }
    }
    return null;
  }

  _genBar(t) {
    const drv = this._driver();
    const beat = this.beatDur;
    this.nextBar = t + 4 * beat;
    this.barStart = t;
    if (!drv || drv.dead(t)) return;
    const sec = drv.sec;
    const chords = parseBar(sec.bars[drv.secBar % sec.bars.length], 4);
    const c = this._c;
    c.beats = 4;
    c.beatDur = beat;
    c.chords = chords;
    c.chordAt = (b) => {
      let ch = chords[0].ch;
      for (const k of chords) if (k.start <= b + 1e-6) ch = k.ch;
      return ch;
    };
    c.melody = sec.melody ? sec.melody[drv.secBar % sec.melody.length] : null;
    c.key = drv.def.key;
    c.secBar = drv.secBar;
    c.secLen = sec.bars.length;
    c.secName = drv.secName;
    c.secCount = drv.secCount;
    c.rng = this.rng;
    for (const k of chords) this.timeline.push({ t: t + k.start * beat, ch: k.ch, key: drv.def.key, bar: t, beat });
    const owners = {};
    for (const inst of this.instances) {
      if (inst.dead(t)) continue;
      c.energy = this._energy(inst, drv);
      c.bar = inst.bar;
      for (const L of inst.def.layers) {
        if (inst !== drv && (L.melodic || L.secs)) continue;
        if (L.secs && !L.secs.includes(drv.secName)) continue;
        if (!keep(this.sys, L)) continue;
        if (L.target) {
          if (!(L.target in owners)) owners[L.target] = this._targetOwner(L.target, drv);
          if (owners[L.target] !== inst) continue;
        }
        const g = (L.gain ?? 1) * curve(L, c.energy) * (inst.def.level ?? 1);
        if (!L.target && g < 0.01) continue;
        const fn = PATTERNS[L.p];
        if (!fn) continue;
        let mem = inst.mem.get(L);
        if (!mem) inst.mem.set(L, (mem = {}));
        let evs;
        try {
          evs = fn(c, L, mem);
        } catch (e) {
          this.sys._warn(e);
          continue;
        }
        for (const ev of evs) {
          ev.t = t + ev.at * beat;
          if (ev.dur != null) ev.dur *= beat;
          ev.mi = inst;
          ev.g = g;
          this.queue.push(ev);
        }
      }
      inst.bar++;
    }
    drv.secBar++;
    if (drv.secBar >= sec.bars.length) drv.nextSection();
    // keep the pending part of the queue sorted
    const pend = this.queue.splice(this.qi);
    pend.sort((a, b) => a.t - b.t);
    this.queue = pend;
    this.qi = 0;
  }

  _cutQueue(ts) {
    const q = this.queue;
    let w = this.qi;
    for (let i = this.qi; i < q.length; i++) if (q[i].t < ts) q[w++] = q[i];
    q.length = w;
  }

  _flush(now, until) {
    const q = this.queue;
    let n = 0;
    while (this.qi < q.length && q[this.qi].t < until) {
      // spread a dense downbeat over a few frames: only events due very soon must go now
      if (n++ >= BURST && q[this.qi].t > now + 0.05) break;
      const ev = q[this.qi++];
      try {
        this._dispatch(ev);
      } catch (e) {
        this.sys._warn(e);
      }
    }
    if (this.qi > 64) {
      q.splice(0, this.qi);
      this.qi = 0;
    }
  }

  _dispatch(ev) {
    const il = ev.mi ? ev.mi.levelAt(ev.t) : 1;
    const log = this.sys.opts.log;
    if (log && log.length < 20000) {
      const h = this._harmonyAt(ev.t);
      log.push({ t: ev.t, k: ev.kind, i: ev.inst || ev.target, m: ev.midi, n: ev.notes, ch: h.ch.name, root: h.key.root, sc: h.key.scale, mood: ev.mi && ev.mi.name, lv: il });
    }
    switch (ev.kind) {
      case 'hit': {
        const v = (ev.vel ?? 0.7) * (ev.g ?? 1) * il;
        if (v < 0.003) return;
        const s = this.inst[ev.inst];
        if (s) s.play(ev.midi, ev.t, v, ev.dur);
        return;
      }
      case 'chord': {
        const s = this.sec[ev.target];
        if (!s) return;
        s.setNotes(ev.notes, ev.t);
        if (ev.vowel) s.setVowel(ev.vowel, ev.t);
        return;
      }
      case 'line': {
        const l = this.lines[ev.target];
        if (l && il > 0.02) l.note(ev.midi, ev.t, ev.dur ?? 0.5, ev.vel ?? 0.7);
        return;
      }
      case 'swell': {
        const s = this.sec[ev.target];
        if (s) s.swell(ev.t, ev.dur ?? 4, (ev.vel ?? 1) * (ev.g ?? 1));
        return;
      }
      default:
    }
  }

  /** Real-time section/line levels from all live mood instances (power-preserving mix). */
  _levels(now) {
    const lv = this._lv;
    const per = this._per;
    for (const k in lv) lv[k] = 0;
    const drv = this._driver();
    for (const inst of this.instances) {
      const il = inst.levelAt(now);
      if (il <= 0.0005) continue;
      const w = il * il;
      const e = this._energy(inst, drv);
      for (const k in per) per[k] = 0;
      for (const L of inst.def.layers) {
        if (!L.target || L.p === 'swell') continue;
        if (inst !== drv && L.melodic) continue;
        if (!keep(this.sys, L)) continue;
        const v = (L.gain ?? 1) * curve(L, e) * (inst.def.level ?? 1);
        if (v > per[L.target]) per[L.target] = v;
      }
      for (const k in per) lv[k] += per[k] * w;
    }
    for (const k in this.sec) this.sec[k].setLevel(lv[k], now);
    for (const k in this.lines) this.lines[k].setLevel(lv[k], now);
  }

  update(dt, now) {
    const k = 1 - Math.exp(-Math.max(0, dt || 0) / 1.2);
    this.intensity += (this.intTarget - this.intensity) * k;
    this.schedule(now);
    if (now - this.levelT > 0.04 || now < this.levelT) {
      this.levelT = now;
      this._levels(now);
      this.stingPad.idle(now);
    }
  }

  // ---- key / clock ---------------------------------------------------------------------

  _harmonyAt(t) {
    let h = this.timeline[0];
    for (const e of this.timeline) {
      if (e.t <= t + 1e-6) h = e;
      else break;
    }
    return h;
  }

  getKey(now) {
    const h = this._harmonyAt(now);
    let g = this.grids[0];
    for (const x of this.grids) if (x.t0 <= now + 1e-9) g = x;
    let next = g.t0 + Math.ceil((now - g.t0) / g.beat - 1e-9) * g.beat;
    if (next < now) next += g.beat;
    for (const x of this.grids) if (x.t0 > now && x.t0 < next) next = x.t0;
    const ch = h.ch;
    const tones = chordTones(ch, 60, 71, []);
    return {
      rootMidi: h.key.root,
      scale: h.key.scale.slice(),
      chord: [bassNote(ch, 38, 49), ...tones],
      chordName: ch.name,
      chordPcs: ch.tones.slice(),
      beat: g.beat,
      nextBeatTime: next,
      mood: this.curName,
      intensity: this.intensity,
    };
  }

  // ---- stingers ------------------------------------------------------------------------

  stinger(name, now) {
    const h = this._harmonyAt(now);
    const ch = h.ch;
    const st = this.st;
    const t = now + 0.03;
    switch (name) {
      case 'discover': {
        const tones = chordTones(ch, 79, 98, []);
        const run = tones.slice(0, 6);
        run.forEach((m, i) => st.celesta.play(m, t + i * 0.085, 0.5 + i * 0.06));
        if (run.length) st.bell.play(run[run.length - 1], t + run.length * 0.085 + 0.05, 0.55);
        const gl = chordTones(ch, 62, 88, []);
        gl.forEach((m, i) => st.harp.play(m, t + 0.05 + (i / gl.length) * 0.55, 0.16 + 0.2 * (i / gl.length)));
        this.stingPad.hit(voiceChord(ch, 4, 69, 86), t, 0.32, 0.5, 0.6, 2.4);
        return true;
      }
      case 'boom': {
        const r = bassNote(ch, 26, 37);
        st.timpani.play(bassNote(ch, 38, 45), t, 1);
        st.taiko.play(36, t, 0.75);
        this.stingPad.hit([r, r + 12, r + 19, r + 24], t, 0.55, 0.12, 0.45, 2.8);
        return true;
      }
      case 'strike': {
        const r = bassNote(ch, 38, 49);
        st.taiko.play(36, t, 1);
        st.timpani.play(bassNote(ch, 38, 45), t + 0.01, 0.9);
        st.crash.play(60, t, 0.6);
        for (const m of [r, r + 1, r + 6, r + 12]) st.stac.play(m, t, 0.9);
        this.stingPad.hit([r + 12, r + 13, r + 18, r + 19, r + 24], t, 0.45, 0.02, 0.15, 1.0);
        this.sys.duck(0.35, 0.8);
        return true;
      }
      case 'harmony': {
        const gl = chordTones(ch, 55, 91, []);
        gl.forEach((m, i) => st.harp.play(m, t + (i / gl.length) * 0.6, 0.3 + 0.25 * (i / gl.length)));
        const top = gl[gl.length - 1];
        if (top) st.bell.play(top, t + 0.62, 0.45);
        const sp = chordTones(ch, 84, 98, []);
        for (let i = 0; i < 3 && sp.length; i++) st.celesta.play(sp[(i * 2) % sp.length], t + 0.75 + i * 0.12, 0.35);
        this.stingPad.hit(voiceChord(ch, 4, 62, 81), t, 0.4, 0.35, 1.0, 2.2);
        return true;
      }
      case 'resolve': {
        const g = this.getKey(now);
        const b = clamp(g.beat, 0.5, 1.1);
        const t0 = g.nextBeatTime - now < 0.6 ? Math.max(t, g.nextBeatTime) : t;
        const t1 = t0 + b;
        const t2 = t1 + b;
        const sus = parseChord('Asus4');
        const A = parseChord('A');
        const Dm = parseChord('D');
        const v0 = voiceChord(sus, 4, 57, 76);
        const v1 = voiceChord(A, 4, 57, 76, v0);
        const v2 = voiceChord(Dm, 4, 57, 76, v1);
        this.stingPad.hit([45, ...v0], t0, 0.5, 0.25, 2 * b + 2.2, 3.2);
        this.stingPad.setNotes([45, ...v1], t1);
        this.stingPad.setNotes([38, ...v2], t2);
        st.piano.play(45, t0, 0.5, b * 2);
        st.piano.play(69, t0, 0.55, b);
        st.piano.play(73, t1, 0.55, b);
        st.piano.play(38, t2, 0.6, 4);
        st.piano.play(74, t2, 0.65, 4);
        for (const m of [62, 66, 69]) st.piano.play(m, t2 + 0.02, 0.35, 4);
        const gl = chordTones(Dm, 50, 86, []);
        gl.forEach((m, i) => st.harp.play(m, t2 + (i / gl.length) * 0.7, 0.25 + 0.2 * (i / gl.length)));
        st.bell.play(86, t2 + 0.05, 0.5);
        st.bell.play(78, t2 + 0.75, 0.35);
        st.timpani.play(38, t2, 0.6);
        this.sys.duck(0.6, t2 - now + 2.5);
        return true;
      }
      default:
        return false;
    }
  }
}
