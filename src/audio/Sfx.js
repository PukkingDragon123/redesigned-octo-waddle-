// One-shot sound effects, synthesised per trigger from short-lived node graphs. Optional
// world positions are spatialised (equal-power panner + distance + air absorption);
// thunder is delayed by its distance at 343 m/s. Musical effects (sparkle, chime) are
// tuned to the current chord.
import { clamp, lerp, mtof, glide, setAt, rampAt, expAt, disconnect, stopAt, startAt, finite, driveCurve, makeRng } from './util.js';
import { chordTones } from './theory.js';
import { getWaves } from './instruments.js';

const SPEED_OF_SOUND = 343;
const MAX_ACTIVE = 40;

let screechCurve = null;

export class Sfx {
  constructor(sys) {
    this.sys = sys;
    this.ctx = sys.ctx;
    this.active = [];
    this.rng = makeRng((sys.seed || 1) * 7 + 3);
    this.lastT = {};
  }

  /** Free finished effects and report whether there is room for one more. */
  _room(now) {
    const a = this.active;
    let w = 0;
    for (let i = 0; i < a.length; i++) if (a[i] > now) a[w++] = a[i];
    a.length = w;
    return a.length < MAX_ACTIVE;
  }

  play(name, o = {}) {
    const fn = this[`_${name}`];
    if (typeof fn !== 'function') return false;
    const now = this.ctx.currentTime;
    if (!this._room(now)) return false;
    // rate limit very frequent effects so a spammy caller cannot flood the graph
    const minGap = name === 'wingbeat' || name === 'falconWing' || name === 'sparkle' ? 0.06 : 0.015;
    if (now - (this.lastT[name] ?? -1) < minGap) return false;
    this.lastT[name] = now;
    const gain = clamp(finite(o.gain, 1), 0, 4);
    const pitch = clamp(finite(o.pitch, 1), 0.25, 4);
    const pos = o.position && Number.isFinite(+o.position.x) ? o.position : null;
    const end = fn.call(this, now + 0.01, gain, pitch, pos, o);
    if (Number.isFinite(end)) this.active.push(end);
    return true;
  }

  // ---- routing helpers -------------------------------------------------------------------

  _distance(pos) {
    if (!pos) return 0;
    const L = this.sys.listener;
    const dx = pos.x - L.x;
    const dy = pos.y - L.y;
    const dz = pos.z - L.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * Output node for an effect. Positional effects get a panner with distance attenuation
   * and an air-absorption lowpass; `nodes` collects everything for cleanup.
   */
  _out(t, pos, nodes, o = {}) {
    const ctx = this.ctx;
    const bus = this.sys.bus;
    const input = ctx.createGain();
    nodes.push(input);
    let last = input;
    if (pos) {
      const d = this._distance(pos);
      const air = ctx.createBiquadFilter();
      air.type = 'lowpass';
      air.frequency.value = clamp(20000 / (1 + d / (o.airK || 120)), 400, 20000);
      const p = ctx.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = o.ref || 20;
      p.rolloffFactor = o.rolloff ?? 1;
      p.maxDistance = 20000;
      if (p.positionX) {
        p.positionX.value = pos.x;
        p.positionY.value = pos.y;
        p.positionZ.value = pos.z;
      } else p.setPosition(pos.x, pos.y, pos.z);
      input.connect(air);
      air.connect(p);
      p.connect(bus.sfx);
      nodes.push(air, p);
      last = p;
      if (o.wet) {
        // the reverb send is taken before the panner (distant sounds are wetter)
        const w = ctx.createGain();
        w.gain.value = o.wet * Math.sqrt((o.ref || 20) / Math.max(o.ref || 20, d));
        air.connect(w);
        w.connect(bus.worldWet);
        nodes.push(w);
      }
    } else {
      input.connect(bus.sfx);
      if (o.wet) {
        const w = ctx.createGain();
        w.gain.value = o.wet;
        input.connect(w);
        w.connect(bus.worldWet);
        nodes.push(w);
      }
    }
    if (o.echo) {
      const e = ctx.createGain();
      e.gain.value = o.echo;
      input.connect(e);
      e.connect(bus.echo);
      nodes.push(e);
    }
    return input;
  }

  _noise(type, t, end, nodes, rate = 1) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.sys.bank.noise[type];
    src.loop = true;
    src.playbackRate.value = rate;
    try { src.start(t, this.rng() * 2); } catch (e) { /* ignore */ }
    stopAt(src, end);
    nodes.push(src);
    return src;
  }

  _filter(type, f, q, nodes) {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    nodes.push(b);
    return b;
  }

  _gain(v, nodes) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    nodes.push(g);
    return g;
  }

  _osc(type, f, t, end, nodes) {
    const o = this.ctx.createOscillator();
    if (typeof type === 'string') o.type = type;
    else o.setPeriodicWave(type);
    o.frequency.value = f;
    startAt(o, t);
    stopAt(o, end);
    nodes.push(o);
    return o;
  }

  _cleanup(src, nodes) {
    src.onended = () => disconnect(...nodes);
  }

  /** Attack-decay envelope on a gain param. */
  _env(param, t, peak, attack, decayTau, end) {
    setAt(param, 0, t);
    rampAt(param, peak, t + attack);
    glide(param, 0, t + attack, decayTau);
    if (end) setAt(param, 0, end);
  }

  /** Play a bank sample into dest; returns { end, src } so the caller can track the last one. */
  _sample(inst, midi, t, vel, dest, nodes) {
    const notes = this.sys.bank.inst[inst];
    if (!notes || !notes.length) return { end: t, src: null };
    let s = notes[0];
    for (const n of notes) if (Math.abs(n.midi - midi) < Math.abs(s.midi - midi)) s = n;
    const src = this.ctx.createBufferSource();
    src.buffer = s.buffer;
    src.playbackRate.value = Math.pow(2, (midi - s.midi) / 12);
    const g = this._gain(vel, nodes);
    src.connect(g);
    g.connect(dest);
    startAt(src, t);
    nodes.push(src);
    return { end: t + s.buffer.duration / src.playbackRate.value, src };
  }

  // ---- effects (each returns its end time) ----------------------------------------------

  /** Sonic boom: pressure thump, a deep whoomph and a long rolling tail. */
  _boom(t, gain, pitch, pos, o, small = false) {
    const nodes = [];
    const len = small ? 1.6 : 4.5;
    const end = t + len;
    const out = this._out(t, pos, nodes, { ref: small ? 25 : 60, airK: 400, wet: small ? 0.35 : 0.6 });
    const amp = this._gain(gain * (small ? 0.55 : 0.85), nodes);
    amp.connect(out);
    // thump
    const th = this._osc('sine', 62 * pitch * (small ? 1.5 : 1), t, end, nodes);
    expAt(th.frequency, 26 * pitch * (small ? 1.6 : 1), t + 0.3);
    const tg = this._gain(0, nodes);
    this._env(tg.gain, t, 0.95, 0.008, small ? 0.16 : 0.32);
    if (!screechCurve) screechCurve = driveCurve(2.2);
    const sh = this.ctx.createWaveShaper();
    sh.curve = screechCurve;
    nodes.push(sh);
    th.connect(tg);
    tg.connect(sh);
    sh.connect(amp);
    // whoomph body
    const n1 = this._noise('brown', t, end, nodes);
    const lp = this._filter('lowpass', 900 * pitch, 0.8, nodes);
    expAt(lp.frequency, 110 * pitch, t + (small ? 0.35 : 0.7));
    const ng = this._gain(0, nodes);
    this._env(ng.gain, t, small ? 0.8 : 1.0, 0.015, small ? 0.22 : 0.5);
    n1.connect(lp); lp.connect(ng); ng.connect(amp);
    // soft air crack
    const n2 = this._noise('pink', t, t + 0.4, nodes);
    const bp = this._filter('bandpass', 1700 * pitch, 0.7, nodes);
    const cg = this._gain(0, nodes);
    this._env(cg.gain, t, small ? 0.25 : 0.32, 0.003, 0.05);
    n2.connect(bp); bp.connect(cg); cg.connect(amp);
    // rolling tail
    if (!small) {
      const n3 = this._noise('brown', t, end, nodes, 0.7);
      const lp3 = this._filter('lowpass', 190, 0.5, nodes);
      const rg = this._gain(0, nodes);
      setAt(rg.gain, 0, t);
      rampAt(rg.gain, 0.6, t + 0.35);
      glide(rg.gain, 0, t + 0.4, 1.1);
      n3.connect(lp3); lp3.connect(rg); rg.connect(amp);
    }
    this._cleanup(th, nodes);
    return end;
  }

  _boomSmall(t, gain, pitch, pos, o) {
    return this._boom(t, gain, pitch, pos, o, true);
  }

  /** Krill gulp: two little throat glugs and a bubble. */
  _gulp(t, gain, pitch, pos) {
    const nodes = [];
    const end = t + 0.5;
    const out = this._out(t, pos, nodes, { ref: 6, wet: 0.15 });
    const amp = this._gain(gain * 0.55, nodes);
    amp.connect(out);
    const bp = this._filter('bandpass', 420 * pitch, 1.5, nodes);
    bp.connect(amp);
    const dry = this._gain(0.6, nodes);
    dry.connect(amp);
    for (let i = 0; i < 2; i++) {
      const tt = t + i * 0.13;
      const f0 = (i ? 160 : 190) * pitch;
      const o1 = this._osc('sine', f0, tt, tt + 0.2, nodes);
      expAt(o1.frequency, f0 * 0.5, tt + 0.12);
      const g = this._gain(0, nodes);
      this._env(g.gain, tt, i ? 0.7 : 1, 0.008, 0.04);
      o1.connect(g); g.connect(bp); g.connect(dry);
    }
    const n = this._noise('white', t + 0.05, t + 0.3, nodes);
    const nb = this._filter('bandpass', 900 * pitch, 3, nodes);
    const ng = this._gain(0, nodes);
    this._env(ng.gain, t + 0.05, 0.15, 0.01, 0.04);
    n.connect(nb); nb.connect(ng); ng.connect(amp);
    this._cleanup(n, nodes);
    return end;
  }

  /** Glitter: a quick run of high celesta notes on the current chord. */
  _sparkle(t, gain, pitch, pos) {
    const nodes = [];
    const out = this._out(t, pos, nodes, { ref: 10, wet: 0.5 });
    const amp = this._gain(gain * 0.22, nodes);
    amp.connect(out);
    const key = this.sys._keyNow();
    const tones = chordTones(key.ch, 81, 100, []);
    let last = { end: t + 0.4, src: null };
    const n = 4 + Math.floor(this.rng() * 3);
    const start = Math.floor(this.rng() * Math.max(1, tones.length - n));
    for (let i = 0; i < n && tones.length; i++) {
      const m = tones[Math.min(tones.length - 1, start + i)] + 12 * Math.log2(pitch);
      const r = this._sample('celesta', m, t + i * (0.04 + this.rng() * 0.03), 0.5 + this.rng() * 0.5, amp, nodes);
      if (r.src && r.end >= last.end) last = r;
    }
    const ns = this._noise('white', t, t + 0.4, nodes);
    const hp = this._filter('highpass', 7000, 0.7, nodes);
    const sg = this._gain(0, nodes);
    this._env(sg.gain, t, 0.04, 0.02, 0.1);
    ns.connect(hp); hp.connect(sg); sg.connect(amp);
    this._cleanup(last.src || ns, nodes);
    return Math.min(last.end, t + 3);
  }

  /** Soft collision: a muffled round "bonk". */
  _bonk(t, gain, pitch, pos) {
    const nodes = [];
    const end = t + 0.4;
    const out = this._out(t, pos, nodes, { ref: 6, wet: 0.2 });
    const amp = this._gain(gain * 0.7, nodes);
    amp.connect(out);
    const o1 = this._osc('sine', 210 * pitch, t, end, nodes);
    expAt(o1.frequency, 105 * pitch, t + 0.07);
    const g = this._gain(0, nodes);
    this._env(g.gain, t, 1, 0.002, 0.06);
    o1.connect(g); g.connect(amp);
    const n = this._noise('pink', t, t + 0.1, nodes);
    const bp = this._filter('bandpass', 750 * pitch, 3, nodes);
    const ng = this._gain(0, nodes);
    this._env(ng.gain, t, 0.5, 0.001, 0.012);
    n.connect(bp); bp.connect(ng); ng.connect(amp);
    this._cleanup(o1, nodes);
    return end;
  }

  /** A whale wing stroke: a soft whump of air with a feathery edge. */
  _wingbeat(t, gain, pitch, pos) {
    const nodes = [];
    const end = t + 0.7;
    const out = this._out(t, pos, nodes, { ref: 12, wet: 0.12 });
    const amp = this._gain(gain * 0.5, nodes);
    amp.connect(out);
    const n = this._noise('pink', t, end, nodes);
    const b1 = this._filter('bandpass', 240 * pitch, 0.9, nodes);
    const b2 = this._filter('bandpass', 950 * pitch, 1.2, nodes);
    const g = this._gain(0, nodes);
    setAt(g.gain, 0, t);
    rampAt(g.gain, 1, t + 0.08);
    glide(g.gain, 0, t + 0.09, 0.11);
    const g2 = this._gain(0.25, nodes);
    n.connect(b1); b1.connect(g); n.connect(b2); b2.connect(g2); g2.connect(g); g.connect(amp);
    this._cleanup(n, nodes);
    return end;
  }

  /** Air rushing past: a band of noise sweeping up and down, panning across. */
  _whoosh(t, gain, pitch, pos) {
    const nodes = [];
    const end = t + 1.1;
    const out = this._out(t, pos, nodes, { ref: 15, wet: 0.15 });
    const amp = this._gain(gain * 0.5, nodes);
    let dest = out;
    if (!pos) {
      const sp = this.ctx.createStereoPanner();
      sp.pan.value = -0.6;
      rampAt(sp.pan, 0.6, t + 1);
      sp.connect(out);
      nodes.push(sp);
      dest = sp;
    }
    amp.connect(dest);
    const n = this._noise('white', t, end, nodes);
    const bp = this._filter('bandpass', 400 * pitch, 1.1, nodes);
    expAt(bp.frequency, 1700 * pitch, t + 0.4);
    expAt(bp.frequency, 550 * pitch, t + 1.0);
    const g = this._gain(0, nodes);
    setAt(g.gain, 0, t);
    rampAt(g.gain, 0.7, t + 0.38);
    rampAt(g.gain, 0, t + 1.05);
    n.connect(bp); bp.connect(g); g.connect(amp);
    this._cleanup(n, nodes);
    return end;
  }

  /** Thunder: a crack and a long rolling rumble, both delayed and darkened by distance. */
  _thunder(t, gain, pitch, pos) {
    const nodes = [];
    const d = pos ? this._distance(pos) : 900;
    const t0 = t + (pos ? Math.min(12, d / SPEED_OF_SOUND) : 0);
    const roll = lerp(3.5, 7.5, clamp(d / 4000));
    const end = t0 + roll + 1;
    // direction only: distance is handled here (crack fades faster than rumble)
    const ctx = this.ctx;
    const input = this._gain(1, nodes);
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'linear';
      p.rolloffFactor = 0;
      if (p.positionX) {
        p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
      } else p.setPosition(pos.x, pos.y, pos.z);
      input.connect(p);
      p.connect(this.sys.bus.sfx);
      nodes.push(p);
    } else input.connect(this.sys.bus.sfx);
    const w = this._gain(0.4, nodes);
    input.connect(w);
    w.connect(this.sys.bus.worldWet);
    const amp = this._gain(gain, nodes);
    amp.connect(input);
    const crackG = 0.9 / Math.pow(1 + d / 500, 1.5);
    const rumbleG = 0.85 / (1 + d / 2500);
    const cut = clamp(7000 / (1 + d / 450), 350, 7000) * pitch;
    if (crackG > 0.01) {
      const n = this._noise('white', t0, t0 + 0.6, nodes);
      const hp = this._filter('highpass', 300, 0.7, nodes);
      const lp = this._filter('lowpass', cut, 0.7, nodes);
      const g = this._gain(0, nodes);
      setAt(g.gain, 0, t0);
      let tt = t0;
      for (let i = 0; i < 4; i++) {
        rampAt(g.gain, crackG * (1 - i * 0.18), tt + 0.003);
        glide(g.gain, 0, tt + 0.004, 0.025 + this.rng() * 0.04);
        tt += 0.05 + this.rng() * 0.09;
      }
      n.connect(hp); hp.connect(lp); lp.connect(g); g.connect(amp);
    }
    const n2 = this._noise('brown', t0, end, nodes, 0.8);
    const lp2 = this._filter('lowpass', clamp(320 / (1 + d / 3000), 90, 320) * pitch, 0.5, nodes);
    const g2 = this._gain(0, nodes);
    setAt(g2.gain, 0, t0);
    let tt = t0 + 0.05;
    const bumps = 3 + Math.floor(this.rng() * 3);
    for (let i = 0; i < bumps; i++) {
      const pk = rumbleG * (1 - (i / bumps) * 0.6) * (0.7 + this.rng() * 0.3);
      rampAt(g2.gain, pk, tt + 0.15 + this.rng() * 0.2);
      tt += roll / bumps;
      rampAt(g2.gain, pk * 0.35, tt);
    }
    rampAt(g2.gain, 0, end - 0.05);
    n2.connect(lp2); lp2.connect(g2); g2.connect(amp);
    this._cleanup(n2, nodes);
    return end;
  }

  /** A close lightning strike: a sharp (not harsh) crack, sizzle and a deep body hit. */
  _lightningCrack(t, gain, pitch, pos) {
    const nodes = [];
    const end = t + 2.2;
    const out = this._out(t, pos, nodes, { ref: 80, airK: 600, wet: 0.5 });
    const amp = this._gain(gain * 0.75, nodes);
    amp.connect(out);
    const n = this._noise('white', t, t + 0.6, nodes);
    const bp = this._filter('bandpass', 2600 * pitch, 0.45, nodes);
    const lp = this._filter('lowpass', 7500, 0.7, nodes);
    const g = this._gain(0, nodes);
    setAt(g.gain, 0, t);
    rampAt(g.gain, 0.9, t + 0.001);
    glide(g.gain, 0.25, t + 0.002, 0.012);
    glide(g.gain, 0, t + 0.06, 0.08);
    n.connect(bp); bp.connect(lp); lp.connect(g); g.connect(amp);
    // sizzle
    const n2 = this._noise('white', t, t + 0.5, nodes);
    const hp = this._filter('bandpass', 4200, 1.5, nodes);
    const sz = this._gain(0, nodes);
    const am = this._osc('square', 55, t, t + 0.5, nodes);
    const amg = this._gain(0.05, nodes);
    am.connect(amg);
    amg.connect(sz.gain);
    setAt(sz.gain, 0.06, t);
    glide(sz.gain, 0, t + 0.1, 0.1);
    n2.connect(hp); hp.connect(sz); sz.connect(amp);
    // body
    const o = this._osc('sine', 75 * pitch, t, end, nodes);
    expAt(o.frequency, 32 * pitch, t + 0.5);
    const og = this._gain(0, nodes);
    this._env(og.gain, t, 0.85, 0.005, 0.35);
    o.connect(og); og.connect(amp);
    const n3 = this._noise('brown', t, end, nodes);
    const lp3 = this._filter('lowpass', 220, 0.5, nodes);
    const rg = this._gain(0, nodes);
    this._env(rg.gain, t, 0.7, 0.03, 0.5);
    n3.connect(lp3); lp3.connect(rg); rg.connect(amp);
    this._cleanup(o, nodes);
    return end;
  }

  /** Storm falcon: an FM "kee-eee-arr" through a formant, gently driven, with echo. */
  _falconScreech(t, gain, pitch, pos) {
    const nodes = [];
    const len = 0.95;
    const end = t + len + 0.1;
    const out = this._out(t, pos, nodes, { ref: 30, airK: 250, wet: 0.45, echo: 0.35 });
    const amp = this._gain(gain * 0.42, nodes);
    amp.connect(out);
    const f0 = 2100 * pitch;
    const car = this._osc(getWaves(this.ctx).reed, f0, t, end, nodes);
    const mod = this._osc('sine', f0 * 1.5, t, end, nodes);
    const mg = this._gain(f0 * 0.8, nodes);
    mod.connect(mg);
    mg.connect(car.frequency);
    // pitch contour: rise, hold, fall away
    setAt(car.frequency, f0 * 0.82, t);
    expAt(car.frequency, f0 * 1.28, t + 0.12);
    expAt(car.frequency, f0 * 1.18, t + 0.45);
    expAt(car.frequency, f0 * 0.86, t + len);
    setAt(mod.frequency, f0 * 0.82 * 1.5, t);
    expAt(mod.frequency, f0 * 1.28 * 1.5, t + 0.12);
    expAt(mod.frequency, f0 * 1.18 * 1.5, t + 0.45);
    expAt(mod.frequency, f0 * 0.86 * 1.5, t + len);
    setAt(mg.gain, f0 * 0.4, t);
    rampAt(mg.gain, f0 * 1.6, t + 0.2);
    rampAt(mg.gain, f0 * 0.9, t + len);
    // vibrato flutter
    const fl = this._osc('sine', 23, t, end, nodes);
    const flg = this._gain(28, nodes);
    fl.connect(flg);
    flg.connect(car.detune);
    const form = this._filter('bandpass', 2900 * pitch, 1.6, nodes);
    const body = this._filter('peaking', 1300 * pitch, 1, nodes);
    body.gain.value = 5;
    if (!screechCurve) screechCurve = driveCurve(2.2);
    const sh = this.ctx.createWaveShaper();
    sh.curve = screechCurve;
    nodes.push(sh);
    const lp = this._filter('lowpass', 6200, 0.7, nodes);
    const env = this._gain(0, nodes);
    setAt(env.gain, 0, t);
    rampAt(env.gain, 1, t + 0.035);
    rampAt(env.gain, 0.85, t + 0.5);
    rampAt(env.gain, 0, t + len);
    car.connect(form); form.connect(body); body.connect(sh); sh.connect(lp); lp.connect(env); env.connect(amp);
    // breathy rasp
    const n = this._noise('white', t, end, nodes);
    const nb = this._filter('bandpass', 3400 * pitch, 2, nodes);
    const ng = this._gain(0.12, nodes);
    n.connect(nb); nb.connect(ng); ng.connect(env);
    this._cleanup(car, nodes);
    return end;
  }

  /** Falcon wing: a sharp feathered snap with flutter. */
  _falconWing(t, gain, pitch, pos) {
    const nodes = [];
    const end = t + 0.45;
    const out = this._out(t, pos, nodes, { ref: 12, wet: 0.15 });
    const amp = this._gain(gain * 0.5, nodes);
    amp.connect(out);
    const n = this._noise('white', t, end, nodes);
    const bp = this._filter('bandpass', 1400 * pitch, 1.2, nodes);
    const low = this._filter('bandpass', 320 * pitch, 1, nodes);
    const g = this._gain(0, nodes);
    setAt(g.gain, 0, t);
    rampAt(g.gain, 1, t + 0.015);
    glide(g.gain, 0, t + 0.02, 0.07);
    const fl = this._osc('sine', 34, t, end, nodes);
    const flg = this._gain(0.4, nodes);
    fl.connect(flg);
    flg.connect(g.gain);
    const lg = this._gain(0.6, nodes);
    n.connect(bp); bp.connect(g); n.connect(low); low.connect(lg); lg.connect(g); g.connect(amp);
    this._cleanup(n, nodes);
    return end;
  }

  /** Water splash: a broadband burst, a low plunge and scattered droplets. */
  _splash(t, gain, pitch, pos) {
    const nodes = [];
    const end = t + 1.4;
    const out = this._out(t, pos, nodes, { ref: 15, wet: 0.3 });
    const amp = this._gain(gain * 0.55, nodes);
    amp.connect(out);
    const n = this._noise('white', t, end, nodes);
    const bp = this._filter('bandpass', 1300 * pitch, 0.6, nodes);
    const lp = this._filter('lowpass', 6000, 0.7, nodes);
    const g = this._gain(0, nodes);
    this._env(g.gain, t, 0.8, 0.006, 0.2);
    n.connect(bp); bp.connect(lp); lp.connect(g); g.connect(amp);
    const pl = this._osc('sine', 130 * pitch, t, t + 0.4, nodes);
    expAt(pl.frequency, 55 * pitch, t + 0.25);
    const pg = this._gain(0, nodes);
    this._env(pg.gain, t, 0.6, 0.01, 0.08);
    pl.connect(pg); pg.connect(amp);
    for (let i = 0; i < 8; i++) {
      const tt = t + 0.05 + this.rng() * 0.8;
      const f = (800 + this.rng() * 1800) * pitch;
      const o = this._osc('sine', f, tt, tt + 0.08, nodes);
      expAt(o.frequency, f * 1.6, tt + 0.05);
      const dg = this._gain(0, nodes);
      this._env(dg.gain, tt, 0.12 + this.rng() * 0.15, 0.002, 0.015);
      o.connect(dg); dg.connect(amp);
    }
    this._cleanup(n, nodes);
    return end;
  }

  /** A small magical chime: bell notes on the current chord. */
  _chime(t, gain, pitch, pos) {
    const nodes = [];
    const out = this._out(t, pos, nodes, { ref: 12, wet: 0.55 });
    const amp = this._gain(gain * 0.3, nodes);
    amp.connect(out);
    const key = this.sys._keyNow();
    const tones = chordTones(key.ch, 79, 96, []);
    const n = Math.min(3, tones.length);
    const s0 = Math.max(0, tones.length - n - Math.floor(this.rng() * 2));
    let last = { end: t + 1, src: null };
    for (let i = 0; i < n; i++) {
      const r = this._sample('bell', tones[s0 + i] + 12 * Math.log2(pitch), t + i * 0.09, 0.8 - i * 0.12, amp, nodes);
      if (r.src && r.end >= last.end) last = r;
    }
    if (last.src) this._cleanup(last.src, nodes);
    return Math.min(last.end, t + 5);
  }
}
