// Ambience: wind with gusts, a rush of air that rises with speed, rain, a storm bed with
// distant thunder, the hush inside clouds, a positional waterfall, night twinkles and
// birdsong. Layers are created lazily when they become audible and stopped when silent.
// setAmbience() only merges numbers; the audio graph is touched at most ~12 times a second.
import { clamp, lerp, smoothstep, glide, setAt, rampAt, expAt, disconnect, stopAt, startAt, finite, makeRng } from './util.js';
import { chordTones } from './theory.js';

const UPDATE_EVERY = 0.08;

export class Ambience {
  constructor(sys) {
    this.sys = sys;
    this.ctx = sys.ctx;
    this.s = { wind: 0.3, rain: 0, storm: 0, speed: 0, inCloud: 0, waterfall: null, night: 0, birds: 0 };
    this.wf = { x: 0, y: 0, z: 0, gain: 0, on: false };
    this.L = {};
    this.acc = 0;
    this.t = 0;
    this.rng = makeRng((sys.seed || 1) * 13 + 5);
    this.nextThunder = 8;
    this.nextTwinkle = 1;
    this.nextBird = 2;
    this.gust = 0;
    this.gustT = 0;
  }

  set(a) {
    if (!a || typeof a !== 'object') return;
    const s = this.s;
    for (const k of ['wind', 'rain', 'storm', 'inCloud', 'night', 'birds']) if (k in a) s[k] = clamp(finite(+a[k], s[k]));
    if ('speed' in a) s.speed = clamp(finite(+a.speed, s.speed), 0, 400);
    if ('waterfall' in a) {
      const w = a.waterfall;
      if (w && w.pos && Number.isFinite(+w.pos.x)) {
        this.wf.x = +w.pos.x;
        this.wf.y = +w.pos.y;
        this.wf.z = +w.pos.z;
        this.wf.gain = clamp(finite(+w.gain, 1), 0, 2);
        this.wf.on = true;
      } else this.wf.on = false;
    }
  }

  // ---- layer helpers ----------------------------------------------------------------

  _loop(type, rate = 1) {
    const src = this.ctx.createBufferSource();
    src.buffer = type === 'rain' ? this.sys.bank.rain : this.sys.bank.noise[type];
    src.loop = true;
    src.playbackRate.value = rate;
    try { src.start(this.ctx.currentTime + 0.01, this.rng() * 2); } catch (e) { /* ignore */ }
    return src;
  }

  _filter(type, f, q) {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  }

  _gain(v = 0) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  /** Create or fetch a layer; `make` returns { nodes, srcs, out, ... }. */
  _layer(name, make) {
    let l = this.L[name];
    if (!l) {
      l = make();
      l.zero = -1;
      this.L[name] = l;
    }
    return l;
  }

  _level(name, v, now, tc = 0.25, make) {
    let l = this.L[name];
    if (v > 0.0005 && !l && make) l = this._layer(name, make);
    if (!l) return null;
    if (v > 0.0005) l.zero = -1;
    else if (l.zero < 0) l.zero = now;
    glide(l.out.gain, v, now, tc);
    if (l.zero >= 0 && now - l.zero > 3) {
      for (const s of l.srcs) stopAt(s, now);
      disconnect(...l.nodes);
      delete this.L[name];
      return null;
    }
    return l;
  }

  // ---- update ----------------------------------------------------------------------

  update(dt, now) {
    this.acc += Math.max(0, dt || 0);
    this.t += Math.max(0, dt || 0);
    if (this.acc < UPDATE_EVERY) return;
    const step = this.acc;
    this.acc = 0;
    const s = this.s;
    const sys = this.sys;
    const amb = sys.bus.amb;
    const r = this.rng;

    // gusts: follow the game's wind when available, else our own smooth noise
    const gw = sys.game && sys.game.wind;
    let gust;
    if (gw && Number.isFinite(gw.gust)) gust = clamp(gw.gust, 0, 2);
    else {
      this.gustT += step;
      const t = this.gustT;
      gust = clamp(0.5 + 0.3 * Math.sin(t * 0.37) + 0.25 * Math.sin(t * 0.91 + 1.3) + 0.15 * Math.sin(t * 2.3 + 0.7), 0, 1.2);
    }
    this.gust += (gust - this.gust) * 0.3;
    const windAmt = clamp(Math.max(s.wind, s.storm * 0.9));

    // wind: two decorrelated bands of pink noise, panned apart
    const wl = this._level('wind', windAmt * (0.55 + 0.45 * this.gust) * 0.2, now, 0.3, () => {
      const out = this._gain();
      const nodes = [out];
      const srcs = [];
      const bps = [];
      for (const pan of [-0.6, 0.6]) {
        const src = this._loop('pink', 0.9 + this.rng() * 0.2);
        const bp = this._filter('bandpass', 380, 0.55);
        const sp = this.ctx.createStereoPanner();
        sp.pan.value = pan;
        src.connect(bp); bp.connect(sp); sp.connect(out);
        nodes.push(src, bp, sp);
        srcs.push(src);
        bps.push(bp);
      }
      out.connect(amb);
      return { out, nodes, srcs, bps };
    });
    if (wl) for (const bp of wl.bps) glide(bp.frequency, 240 + 420 * this.gust + 260 * windAmt, now, 0.35);

    // whistle: a faint narrow band wandering with the gusts
    const wh = this._level('whistle', windAmt * windAmt * this.gust * 0.025, now, 0.4, () => {
      const out = this._gain();
      const src = this._loop('white');
      const bp = this._filter('bandpass', 1200, 9);
      src.connect(bp); bp.connect(out); out.connect(amb);
      return { out, nodes: [out, src, bp], srcs: [src], bp };
    });
    if (wh) glide(wh.bp.frequency, 900 + 900 * this.gust + 200 * Math.sin(this.t * 0.7), now, 0.5);

    // rush of air with speed
    const sp = s.speed;
    const rl = this._level('rush', smoothstep(3, 45, sp) * 0.2 * (0.85 + 0.15 * this.gust), now, 0.15, () => {
      const out = this._gain();
      const src = this._loop('pink', 1.1);
      const hp = this._filter('highpass', 300, 0.6);
      const bp = this._filter('bandpass', 700, 0.5);
      src.connect(hp); hp.connect(bp); bp.connect(out); out.connect(amb);
      return { out, nodes: [out, src, hp, bp], srcs: [src], bp };
    });
    if (rl) glide(rl.bp.frequency, clamp(350 + sp * 38, 350, 3200), now, 0.2);

    // rain bed
    this._level('rain', s.rain * 0.3, now, 0.6, () => {
      const out = this._gain();
      const src = this._loop('rain');
      const lp = this._filter('lowpass', 7000, 0.5);
      src.connect(lp); lp.connect(out); out.connect(amb);
      return { out, nodes: [out, src, lp], srcs: [src] };
    });

    // storm: a low rumbling bed and distant thunder now and then
    const stl = this._level('storm', s.storm * 0.32 * (0.8 + 0.3 * Math.sin(this.t * 0.23)), now, 0.8, () => {
      const out = this._gain();
      const src = this._loop('brown', 0.8);
      const lp = this._filter('lowpass', 140, 0.5);
      src.connect(lp); lp.connect(out); out.connect(amb);
      return { out, nodes: [out, src, lp], srcs: [src] };
    });
    if (stl && s.storm > 0.35) {
      this.nextThunder -= step;
      if (this.nextThunder <= 0) {
        this.nextThunder = lerp(22, 7, s.storm) * (0.6 + r() * 0.8);
        const L = sys.listener;
        const a = r() * Math.PI * 2;
        const d = 1500 + r() * 4500;
        sys.sfx('thunder', { position: { x: L.x + Math.cos(a) * d, y: L.y + 200 + r() * 400, z: L.z + Math.sin(a) * d }, gain: 0.5 + 0.4 * s.storm });
      }
    }

    // inside a cloud: a soft hush (the muffling itself is a bus filter)
    this._level('hush', s.inCloud * 0.05, now, 0.4, () => {
      const out = this._gain();
      const src = this._loop('pink');
      const bp = this._filter('bandpass', 2000, 0.45);
      src.connect(bp); bp.connect(out); out.connect(amb);
      return { out, nodes: [out, src, bp], srcs: [src] };
    });
    sys._setCloud(s.inCloud, now);

    // waterfall: positional roar
    const wf = this.wf;
    const wfl = this._level('waterfall', wf.on ? wf.gain * 0.55 : 0, now, 0.5, () => {
      const out = this._gain();
      const ctx = this.ctx;
      const a = this._loop('brown', 1.2);
      const b = this._loop('pink', 0.85);
      const lp = this._filter('lowpass', 2600, 0.5);
      const bp = this._filter('bandpass', 420, 0.5);
      const bg = this._gain(0.8);
      const pan = ctx.createPanner();
      pan.panningModel = 'equalpower';
      pan.distanceModel = 'inverse';
      pan.refDistance = 45;
      pan.rolloffFactor = 1;
      pan.maxDistance = 20000;
      a.connect(bp); bp.connect(bg); bg.connect(out);
      b.connect(lp); lp.connect(out);
      out.connect(pan);
      pan.connect(sys.bus.sfx);
      const w = this._gain(0.25);
      out.connect(w);
      w.connect(sys.bus.worldWet);
      return { out, nodes: [out, a, b, lp, bp, bg, pan, w], srcs: [a, b], pan };
    });
    if (wfl && wf.on) {
      const p = wfl.pan;
      if (p.positionX) {
        glide(p.positionX, wf.x, now, 0.1);
        glide(p.positionY, wf.y, now, 0.1);
        glide(p.positionZ, wf.z, now, 0.1);
      } else p.setPosition(wf.x, wf.y, wf.z);
    }

    // night: sparse tuned twinkles high up
    if (s.night > 0.05) {
      this.nextTwinkle -= step;
      if (this.nextTwinkle <= 0) {
        this.nextTwinkle = lerp(4, 0.9, s.night) * (0.5 + r());
        this._twinkle(now, s.night);
      }
    }
    // birds
    if (s.birds > 0.03) {
      this.nextBird -= step;
      if (this.nextBird <= 0) {
        this.nextBird = lerp(7, 1.4, s.birds) * (0.5 + r());
        this._bird(now, s.birds);
      }
    }
  }

  _twinkle(now, amt) {
    const sys = this.sys;
    const notes = sys.bank.inst.celesta;
    if (!notes) return;
    const key = sys._keyNow();
    const tones = chordTones(key.ch, 86, 101, []);
    if (!tones.length) return;
    const m = tones[Math.floor(this.rng() * tones.length)];
    let s = notes[0];
    for (const n of notes) if (Math.abs(n.midi - m) < Math.abs(s.midi - m)) s = n;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = s.buffer;
    src.playbackRate.value = Math.pow(2, (m - s.midi) / 12);
    const g = this._gain(0.035 * amt * (0.5 + this.rng() * 0.5));
    const p = ctx.createStereoPanner();
    p.pan.value = this.rng() * 1.6 - 0.8;
    const w = this._gain(0.8);
    src.connect(g); g.connect(p); p.connect(sys.bus.amb); g.connect(w); w.connect(sys.bus.worldWet);
    startAt(src, now + 0.02);
    src.onended = () => disconnect(src, g, p, w);
  }

  _bird(now, amt) {
    const ctx = this.ctx;
    const sys = this.sys;
    const r = this.rng;
    const t = now + 0.02;
    const notes = 2 + Math.floor(r() * 4);
    const base = 2600 + r() * 2200;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const g = this._gain(0);
    const p = ctx.createStereoPanner();
    p.pan.value = r() * 1.8 - 0.9;
    const lp = this._filter('lowpass', 3000 + r() * 5000, 0.5);
    const w = this._gain(0.4);
    o.connect(g); g.connect(lp); lp.connect(p); p.connect(sys.bus.amb); lp.connect(w); w.connect(sys.bus.worldWet);
    const vol = 0.03 * amt * (0.4 + r() * 0.6);
    let tt = t;
    setAt(o.frequency, base, t);
    setAt(g.gain, 0, t);
    for (let i = 0; i < notes; i++) {
      const d = 0.05 + r() * 0.08;
      const f0 = base * (0.85 + r() * 0.35);
      const f1 = f0 * (r() < 0.5 ? 1.35 : 0.72);
      setAt(o.frequency, f0, tt);
      expAt(o.frequency, f1, tt + d);
      rampAt(g.gain, vol, tt + 0.008);
      rampAt(g.gain, vol * 0.6, tt + d * 0.8);
      rampAt(g.gain, 0, tt + d);
      tt += d + 0.04 + r() * 0.1;
    }
    startAt(o, t);
    stopAt(o, tt + 0.05);
    o.onended = () => disconnect(o, g, p, lp, w);
  }
}
