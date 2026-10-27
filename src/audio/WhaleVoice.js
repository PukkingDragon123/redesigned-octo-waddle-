// Whale voices: a sung fundamental with portamento, delayed vibrato, a formant pair that
// opens from "oo" to "ah", breath noise and (for adults) a sub-harmonic growl. Every note
// and call snaps to the current key or chord so the herd sings inside the score.
// Spatialised with an HRTF panner, distance attenuation and an air-absorption lowpass;
// the reverb and sky-echo sends are taken before the panner so far voices sound wetter.
import {
  clamp, lerp, mtof, glide, setAt, rampAt, expAt, cancelFrom, disconnect, stopAt, startAt,
  finite, smoothstep, driveCurve,
} from './util.js';
import { snapToScale, snapToChord, stepChord, stepScale } from './theory.js';
import { getWaves } from './instruments.js';

// [F1, F2] for a mother-sized throat; scaled by profile.formant
const VOW = { oo: [300, 700], oh: [430, 820], ah: [650, 1080], ee: [330, 1900], eh: [520, 1500] };

let driveCache = null;

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
    this.trim = this.calf ? 0.25 : lerp(0.28, 0.36, this.size);
    this.glideTc = this.calf ? 0.035 : lerp(0.06, 0.11, this.size);
    this.verbBase = lerp(0.35, 0.55, this.size);
    this.echoBase = lerp(0.12, 0.22, this.size);
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.hasPos = false;
    this.io = null;
    this.eng = null;
    this.charge = null;
    this.humming = false;
    this.humEnd = 0;
    this.curMidi = base;
    this.lastActive = -1e9;
    this.disposed = false;
  }

  // ---- public API ------------------------------------------------------------------

  setPosition(v) {
    if (!v) return;
    const x = +v.x;
    const y = +v.y;
    const z = +v.z;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    this.x = x;
    this.y = y;
    this.z = z;
    this.hasPos = true;
  }

  /** Sing `midi` (snapped to the key). Without a duration it sustains until release(). */
  hum(midi, duration, opts = {}) {
    try {
      const sys = this.sys;
      if (!sys.ready || this.disposed) return;
      opts = opts || {};
      const now = sys.ctx.currentTime;
      const t = now + 0.012;
      let m = finite(midi, this.p.base);
      const key = sys._keyNow();
      if (opts.snap !== false) m = snapToScale(m, key.root, key.scale);
      const e = this._engine(t);
      if (!e) return;
      const k = this.p.formant;
      const f = mtof(m);
      const gain = clamp(finite(opts.gain, 1), 0, 2) * this.trim;
      const vib = clamp(finite(opts.vibrato, lerp(30, 18, this.size)), 0, 120);
      const legato = this.humming && now < this.humEnd;
      for (const p of [e.amp.gain, e.pitch.offset, e.f1.frequency, e.f2.frequency, e.vibG.gain, e.ng.gain, e.nbp.frequency]) cancelFrom(p, t);
      if (opts.glideFrom != null && Number.isFinite(+opts.glideFrom)) {
        setAt(e.pitch.offset, mtof(+opts.glideFrom), t);
        glide(e.pitch.offset, f, t, this.glideTc * 1.4);
      } else if (legato) {
        glide(e.pitch.offset, f, t, this.glideTc);
      } else {
        setAt(e.pitch.offset, f * Math.pow(2, -0.8 / 12), t); // a natural scoop into the note
        glide(e.pitch.offset, f, t, 0.045);
      }
      const att = this.calf ? 0.05 : lerp(0.1, 0.22, this.size);
      if (legato) {
        glide(e.amp.gain, gain * 0.85, t, 0.03);
        glide(e.amp.gain, gain, t + 0.08, att / 2);
      } else glide(e.amp.gain, gain, t, att / 2.5);
      const V0 = legato ? VOW.oh : VOW.oo;
      if (!legato) {
        setAt(e.f1.frequency, V0[0] * k, t);
        setAt(e.f2.frequency, V0[1] * k, t);
      } else {
        glide(e.f1.frequency, V0[0] * k, t, 0.04);
        glide(e.f2.frequency, V0[1] * k, t, 0.04);
      }
      const open = this.calf ? VOW.eh : VOW.ah;
      glide(e.f1.frequency, open[0] * k, t + 0.06, 0.16);
      glide(e.f2.frequency, open[1] * k, t + 0.06, 0.2);
      const br = this.p.breath * gain;
      glide(e.ng.gain, br * 1.2, t, 0.01);
      glide(e.ng.gain, br * 0.3, t + 0.09, 0.12);
      glide(e.nbp.frequency, open[1] * k, t, 0.2);
      glide(e.vibG.gain, 0, t, 0.03);
      glide(e.vibG.gain, vib, t + (this.calf ? 0.18 : 0.32), 0.3);
      this.humming = true;
      this.curMidi = m;
      this.lastActive = now;
      if (duration != null && Number.isFinite(+duration)) {
        const end = t + Math.max(0.08, +duration);
        this.humEnd = end;
        this._releaseAt(end, this.calf ? 0.25 : 0.5);
      } else this.humEnd = Infinity;
    } catch (err) {
      this.sys._warn(err);
    }
  }

  release(fadeSec = 0.4) {
    try {
      if (!this.eng || !this.sys.ready) {
        this.humming = false;
        return;
      }
      const now = this.sys.ctx.currentTime;
      const t = now + 0.01;
      const e = this.eng;
      for (const p of [e.amp.gain, e.pitch.offset, e.f1.frequency, e.f2.frequency, e.vibG.gain, e.ng.gain]) cancelFrom(p, t);
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
      this._playCall(def, now + 0.02);
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
      if (this.io) disconnect(this.io.air, this.io.pan, this.io.verb, this.io.echo);
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
    this.io = { air, pan, verb, echo, lastD: -1, px: NaN, py: NaN, pz: NaN };
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
        if (force) {
          setAt(p.positionX, x, now); setAt(p.positionY, y, now); setAt(p.positionZ, z, now);
        } else {
          glide(p.positionX, x, now, 0.03); glide(p.positionY, y, now, 0.03); glide(p.positionZ, z, now, 0.03);
        }
      } else if (p.setPosition) p.setPosition(x, y, z);
    }
    const dx = x - L.x;
    const dy = y - L.y;
    const dz = z - L.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (force || Math.abs(d - io.lastD) > Math.max(0.5, io.lastD * 0.04)) {
      io.lastD = d;
      glide(io.air.frequency, clamp(20000 / (1 + d / 80), 500, 20000), now, 0.08);
      const ref = p.refDistance;
      const dry = ref / Math.max(ref, d);
      glide(io.verb.gain, this.verbBase * Math.sqrt(dry), now, 0.1);
      glide(io.echo.gain, this.echoBase * Math.sqrt(dry), now, 0.1);
    }
  }

  _engine(t) {
    if (this.eng) return this.eng;
    const io = this._io();
    const sys = this.sys;
    if (!io || !sys.bank) return null;
    sys._admitVoiceEngine(this);
    const ctx = sys.ctx;
    const W = getWaves(ctx);
    const k = this.p.formant;
    const G = (v) => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };
    const pitch = ctx.createConstantSource();
    pitch.offset.value = mtof(this.p.base);
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(this.calf ? W.calf : W.whale);
    osc.frequency.value = 0;
    pitch.connect(osc.frequency);
    const vib = ctx.createOscillator();
    vib.frequency.value = lerp(6.2, 4.2, this.size) * (0.95 + Math.random() * 0.1);
    const vibG = G(0);
    vib.connect(vibG);
    vibG.connect(osc.detune);
    const mix = G(1);
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.Q.value = 4.5;
    f1.frequency.value = VOW.oo[0] * k;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.Q.value = 6;
    f2.frequency.value = VOW.oo[1] * k;
    const dry = ctx.createBiquadFilter();
    dry.type = 'lowpass';
    dry.frequency.value = 520 * k;
    dry.Q.value = 0.6;
    const g1 = G(2.2);
    const g2 = G(1.4);
    const gd = G(this.calf ? 0.7 : 0.45);
    osc.connect(f1); f1.connect(g1); g1.connect(mix);
    osc.connect(f2); f2.connect(g2); g2.connect(mix);
    osc.connect(dry); dry.connect(gd); gd.connect(mix);
    let sub = null, subG = null, half = null, growl = null, growlD = null;
    const growlAmt = smoothstep(0.3, 1, this.size) * 0.5;
    if (growlAmt > 0.02) {
      sub = ctx.createOscillator();
      sub.type = 'triangle';
      sub.frequency.value = 0;
      half = G(0.5);
      pitch.connect(half);
      half.connect(sub.frequency);
      vibG.connect(sub.detune);
      subG = G(growlAmt);
      growl = ctx.createOscillator();
      growl.frequency.value = 24 + Math.random() * 9;
      growlD = G(growlAmt * 0.7);
      growl.connect(growlD);
      growlD.connect(subG.gain);
      sub.connect(subG);
      subG.connect(mix);
    }
    const nsrc = ctx.createBufferSource();
    nsrc.buffer = sys.bank.noise.pink;
    nsrc.loop = true;
    const nbp = ctx.createBiquadFilter();
    nbp.type = 'bandpass';
    nbp.frequency.value = VOW.ah[1] * k;
    nbp.Q.value = 1.3;
    const ng = G(0);
    nsrc.connect(nbp); nbp.connect(ng); ng.connect(mix);
    const amp = G(0);
    mix.connect(amp);
    amp.connect(io.air);
    startAt(pitch, t); startAt(osc, t); startAt(vib, t);
    if (sub) { startAt(sub, t); startAt(growl, t); }
    try { nsrc.start(t, Math.random() * (nsrc.buffer.duration - 0.1)); } catch (e) { /* ignore */ }
    this.eng = { pitch, osc, vib, vibG, mix, f1, f2, dry, g1, g2, gd, sub, subG, half, growl, growlD, nsrc, nbp, ng, amp };
    return this.eng;
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
  }

  _killEngine(now) {
    const e = this.eng;
    if (!e) return;
    this.eng = null;
    this.humming = false;
    for (const n of [e.pitch, e.osc, e.vib, e.sub, e.growl, e.nsrc]) if (n) stopAt(n, now);
    disconnect(e.pitch, e.osc, e.vib, e.vibG, e.mix, e.f1, e.f2, e.dry, e.g1, e.g2, e.gd, e.sub, e.subG, e.half, e.growl, e.growlD, e.nsrc, e.nbp, e.ng, e.amp);
    this.sys._releaseVoiceEngine(this);
  }

  _buildCharge(now) {
    const io = this._io();
    const sys = this.sys;
    if (!io || !sys.bank) return;
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
    this._place(now, false);
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
