// SKYSONG audio: everything is synthesised at runtime with the Web Audio API.
//
//   const audio = new AudioSystem(game);          // nothing audible is created yet
//   canvas.onclick = () => audio.start();         // from a user gesture; safe to repeat
//   each frame: audio.update(dt); audio.setAmbience({...}); voice.setPosition(pos)
//
// Every method is safe before start()/ready (it no-ops, or remembers the request) and
// never throws. Pass { context } to run on an injected (e.g. Offline) AudioContext.
//
// Signal flow
//   score instruments ─► musicDry ─► duck ─► musicVol ─► musicLP ─┐
//                      └► musicWet ─► duckW ─► musicVolW ─► reverb  │
//   stingers ─► stingDry/stingWet (join after the duck)             ├─► master ─► shelf
//   voices / sfx / ambience ─► world (sound vol) ─► worldLP ────────┤   ─► compressor
//   sends ─► worldWet ─► reverb (convolver, 5 s) ─► verbLP ─────────┤   ─► limiter ─► soft clip
//   whale calls ─► echo ─► sky echo (ping-pong feedback delay) ─────┘   (ceiling -1.1 dBFS)
import { Conductor } from './Conductor.js';
import { WhaleVoice } from './WhaleVoice.js';
import { Sfx } from './Sfx.js';
import { Ambience } from './Ambience.js';
import { loadBank, preloadBank } from './SampleBank.js';
import { MOODS, MOOD_NAMES } from './moods.js';
import { parseChord, SCALES, bassNote, chordTones } from './theory.js';
import { clamp, glide, setAt, holdAt, finite, softClipCurve } from './util.js';

const SFX_NAMES = ['boom', 'boomSmall', 'gulp', 'sparkle', 'bonk', 'wingbeat', 'whoosh', 'thunder', 'lightningCrack', 'falconScreech', 'falconWing', 'splash', 'chime'];
const STINGERS = ['discover', 'boom', 'strike', 'harmony', 'resolve'];
const MAX_VOICE_ENGINES = 16;
const DEFAULT_CHORD = parseChord('D');
const MUSIC_TRIM = 0.55;
const WORLD_TRIM = 1.0;

const volCurve = (v) => {
  const x = clamp(finite(+v, 1));
  return x * x;
};

export class AudioSystem {
  constructor(game, opts = {}) {
    this.game = game || null;
    this.opts = opts || {};
    this.ctx = null;
    this.offline = false;
    this.hrtf = this.opts.hrtf !== false;
    this.seed = Number.isFinite(this.opts.seed) ? this.opts.seed : (Date.now() & 0xffff) + 1;
    this._built = false;
    this._starting = null;
    const s = (game && game.settings) || {};
    this.vol = { music: clamp(finite(+s.music, 0.8)), sound: clamp(finite(+s.sound, 1)) };
    this._seen = { music: s.music, sound: s.sound };
    this._mood = null;
    this._intensity = 0.5;
    this._amb = {};
    this.voices = new Set();
    this._engines = new Set();
    this.listener = { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0 };
    this._lp = { x: NaN, y: NaN, z: NaN, fx: NaN, fy: NaN, fz: NaN, ux: NaN, uy: NaN, uz: NaN };
    this._cloud = -1;
    this._duck = { until: 0, depth: 0 };
    this._lastUpdate = 0;
    this.stats = { updateMs: 0, maxUpdateMs: 0, buildMs: 0, maxSliceMs: 0, errors: 0 };
    this.lastError = null;
    this._warned = new Set();
    // Synthesise the instruments early (time-sliced, no AudioContext needed) so the score
    // can begin as soon as start() is called from the first user gesture.
    if (this.opts.preload !== false && typeof setTimeout !== 'undefined') {
      setTimeout(() => {
        try { preloadBank(); } catch (e) { /* built later by start() */ }
      }, 0);
    }
  }

  /** True once the context is running and the instrument bank is built. */
  get ready() {
    return !!(this._built && this.ctx && (this.offline || this.ctx.state === 'running'));
  }

  // ---- lifecycle -------------------------------------------------------------------------

  async start() {
    try {
      if (!this.ctx && !this._createContext()) return false;
      const ctx = this.ctx;
      // resume synchronously inside the gesture (Safari needs that), then build
      if (!this.offline && ctx.state !== 'running' && ctx.state !== 'closed') {
        try {
          const p = ctx.resume();
          if (p && p.catch) p.catch(() => {});
        } catch (e) { /* ignore */ }
      }
      if (!this._starting) {
        this._starting = this._init().catch((e) => {
          this._starting = null; // allow a later start() to retry
          throw e;
        });
      }
      await this._starting;
      if (!this.offline && ctx.state === 'suspended') {
        await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 400))]);
      }
      return this.ready;
    } catch (e) {
      this._warn(e);
      return false;
    }
  }

  _createContext() {
    if (this.opts.context) {
      this.ctx = this.opts.context;
      this.offline = typeof OfflineAudioContext !== 'undefined' && this.ctx instanceof OfflineAudioContext;
    } else {
      const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
      if (!AC) return false;
      try {
        this.ctx = new AC({ latencyHint: 'interactive' });
      } catch (e) {
        this.ctx = new AC();
      }
      if (typeof document !== 'undefined') {
        this._onVis = () => {
          try {
            if (document.hidden) {
              if (this.ctx.state === 'running') {
                this._hiddenSuspend = true;
                this.ctx.suspend();
              }
            } else if (this._hiddenSuspend) {
              this._hiddenSuspend = false;
              this.ctx.resume();
            }
          } catch (e) { /* ignore */ }
        };
        document.addEventListener('visibilitychange', this._onVis);
      }
    }
    this._buildGraph();
    return true;
  }

  _buildGraph() {
    const ctx = this.ctx;
    const g = (v = 1) => {
      const n = ctx.createGain();
      n.gain.value = v;
      return n;
    };
    const lp = (f) => {
      const b = ctx.createBiquadFilter();
      b.type = 'lowpass';
      b.frequency.value = f;
      b.Q.value = 0.5;
      return b;
    };
    const B = (this.bus = {});
    // master chain
    B.master = g(1);
    // no infrasonic rumble: synthesized drums and drones carry a lot of sub energy
    B.lowcut = ctx.createBiquadFilter();
    B.lowcut.type = 'highpass';
    B.lowcut.frequency.value = 32;
    B.lowcut.Q.value = 0.6;
    B.shelf = ctx.createBiquadFilter();
    B.shelf.type = 'highshelf';
    B.shelf.frequency.value = 9000;
    B.shelf.gain.value = -1;
    B.comp = ctx.createDynamicsCompressor();
    B.comp.threshold.value = -16;
    B.comp.knee.value = 10;
    B.comp.ratio.value = 2.5;
    B.comp.attack.value = 0.012;
    B.comp.release.value = 0.28;
    B.limit = ctx.createDynamicsCompressor();
    B.limit.threshold.value = -4;
    B.limit.knee.value = 0;
    B.limit.ratio.value = 20;
    B.limit.attack.value = 0.001;
    B.limit.release.value = 0.12;
    B.trim = g(0.62);
    B.pre = g(0.5);
    B.clip = ctx.createWaveShaper();
    B.clip.curve = softClipCurve(4096, 0.62, 0.88, 2);
    B.clip.oversample = 'none';
    B.master.connect(B.lowcut);
    B.lowcut.connect(B.shelf);
    B.shelf.connect(B.comp);
    B.comp.connect(B.trim);
    B.trim.connect(B.limit);
    B.limit.connect(B.pre);
    B.pre.connect(B.clip);
    B.clip.connect(ctx.destination);
    // reverb
    B.verbIn = g(1);
    B.convolver = ctx.createConvolver();
    B.convolver.normalize = false;
    B.verbOut = g(1);
    B.verbLP = lp(20000);
    B.verbIn.connect(B.convolver);
    B.convolver.connect(B.verbOut);
    B.verbOut.connect(B.verbLP);
    B.verbLP.connect(B.master);
    // music
    const mv = volCurve(this.vol.music) * MUSIC_TRIM;
    B.musicDry = g(1);
    B.musicWet = g(1);
    B.duck = g(1);
    B.duckW = g(1);
    B.musicVol = g(mv);
    B.musicVolW = g(mv);
    B.musicLP = lp(20000);
    // tame the bass build-up of the arrangement (and of its reverb) a little
    B.musicShelf = ctx.createBiquadFilter();
    B.musicShelf.type = 'lowshelf';
    B.musicShelf.frequency.value = 110;
    B.musicShelf.gain.value = -3;
    B.musicDry.connect(B.duck);
    B.duck.connect(B.musicVol);
    B.musicVol.connect(B.musicShelf);
    B.musicShelf.connect(B.musicLP);
    B.musicLP.connect(B.master);
    B.musicWet.connect(B.duckW);
    B.duckW.connect(B.musicVolW);
    B.musicVolW.connect(B.verbIn);
    B.stingDry = g(1);
    B.stingWet = g(1);
    B.stingDry.connect(B.musicVol);
    B.stingWet.connect(B.musicVolW);
    // world: voices, sfx, ambience
    const sv = volCurve(this.vol.sound) * WORLD_TRIM;
    B.voices = g(1);
    B.sfx = g(1);
    B.amb = g(1);
    B.world = g(sv);
    B.worldLP = lp(20000);
    B.voices.connect(B.world);
    B.sfx.connect(B.world);
    B.amb.connect(B.world);
    B.world.connect(B.worldLP);
    B.worldLP.connect(B.master);
    B.worldWet = g(1);
    B.worldVolW = g(sv);
    B.worldWet.connect(B.worldVolW);
    B.worldVolW.connect(B.verbIn);
    // sky echo: ping-pong feedback delay, darker on every repeat
    B.echo = g(1);
    B.echoVol = g(sv);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 160;
    const dL = ctx.createDelay(2);
    const dR = ctx.createDelay(2);
    dL.delayTime.value = 0.43;
    dR.delayTime.value = 0.61;
    const fb = g(0.42);
    const elp = lp(2400);
    const merge = ctx.createChannelMerger(2);
    const eOut = g(0.55);
    const eVerb = g(0.25);
    B.echo.connect(B.echoVol);
    B.echoVol.connect(hp);
    hp.connect(dL);
    dL.connect(merge, 0, 0);
    dL.connect(dR);
    dR.connect(merge, 0, 1);
    dR.connect(elp);
    elp.connect(fb);
    fb.connect(dL);
    merge.connect(eOut);
    eOut.connect(B.worldLP);
    eOut.connect(eVerb);
    eVerb.connect(B.verbIn);
  }

  async _init() {
    const bank = await loadBank(this.ctx);
    this.bank = bank;
    this.stats.buildMs = bank.buildMs || 0;
    this.stats.waitMs = bank.waitMs || 0;
    this.stats.maxSliceMs = bank.maxSliceMs || 0;
    this.stats.maxStepMs = bank.maxStepMs || 0;
    this.stats.maxStepLabel = bank.maxStepLabel || '';
    try {
      this.bus.convolver.buffer = bank.ir;
    } catch (e) {
      this._warn(e);
    }
    this.conductor = new Conductor(this);
    this.sfxEngine = new Sfx(this);
    this.ambience = new Ambience(this);
    this.ambience.set(this._amb);
    this.conductor.setIntensity(this._intensity, true);
    this._built = true;
    if (this._mood) this.conductor.setMood(this._mood.name, this._mood.fade);
    if (!this.offline && typeof setInterval !== 'undefined') {
      // keeps the score going through long frames or a paused game loop
      this._pump = setInterval(() => {
        try {
          if (this.ready && performance.now() - this._lastUpdate > 80) this.conductor.update(0.05, this.ctx.currentTime);
        } catch (e) { /* ignore */ }
      }, 50);
    }
  }

  /** Stop timers and close the context (optional; for hot reload / teardown). */
  dispose() {
    try {
      if (this._pump) clearInterval(this._pump);
      if (this._onVis) document.removeEventListener('visibilitychange', this._onVis);
      if (this.ctx && !this.offline && this.ctx.close) this.ctx.close();
    } catch (e) { /* ignore */ }
    this._built = false;
  }

  // ---- per frame ---------------------------------------------------------------------

  update(dt) {
    if (!this._built || !this.ctx) return;
    const p0 = typeof performance !== 'undefined' ? performance.now() : 0;
    try {
      const now = this.ctx.currentTime;
      dt = clamp(finite(+dt, 1 / 60), 0, 0.5);
      this._syncSettings();
      this._updateListener(now);
      this.conductor.update(dt, now);
      this.ambience.update(dt, now);
      for (const v of this.voices) v.update(now);
    } catch (e) {
      this._warn(e);
    }
    if (p0) {
      const ms = performance.now() - p0;
      this._lastUpdate = performance.now();
      this.stats.updateMs = this.stats.updateMs * 0.95 + ms * 0.05;
      if (ms > this.stats.maxUpdateMs) this.stats.maxUpdateMs = ms;
    }
  }

  _syncSettings() {
    const s = this.game && this.game.settings;
    if (!s) return;
    if (s.music !== this._seen.music || s.sound !== this._seen.sound) {
      this._seen.music = s.music;
      this._seen.sound = s.sound;
      this.setVolumes(s.music, s.sound);
    }
  }

  _updateListener(now) {
    const cam = this.game && this.game.engine && this.game.engine.camera;
    const m = cam && cam.matrixWorld && cam.matrixWorld.elements;
    if (!m) return;
    const x = m[12], y = m[13], z = m[14];
    let fx = -m[8], fy = -m[9], fz = -m[10];
    let ux = m[4], uy = m[5], uz = m[6];
    const fl = Math.hypot(fx, fy, fz);
    const ul = Math.hypot(ux, uy, uz);
    if (!(fl > 1e-6) || !(ul > 1e-6) || !Number.isFinite(x + y + z)) return;
    fx /= fl; fy /= fl; fz /= fl;
    ux /= ul; uy /= ul; uz /= ul;
    const L = this.listener;
    L.x = x; L.y = y; L.z = z; L.fx = fx; L.fy = fy; L.fz = fz; L.ux = ux; L.uy = uy; L.uz = uz;
    const P = this._lp;
    // (the first pose is NaN, and NaN comparisons are false: test `first` explicitly)
    const first = !Number.isFinite(P.x);
    const moved = first || Math.abs(x - P.x) + Math.abs(y - P.y) + Math.abs(z - P.z) > 0.01;
    const turned = first || Math.abs(fx - P.fx) + Math.abs(fy - P.fy) + Math.abs(fz - P.fz) + Math.abs(ux - P.ux) + Math.abs(uy - P.uy) + Math.abs(uz - P.uz) > 0.0005;
    if (!moved && !turned) return;
    const al = this.ctx.listener;
    Object.assign(P, L);
    if (al.positionX) {
      const set = (param, v) => (first ? setAt(param, v, now) : glide(param, v, now, 0.02));
      if (moved || first) {
        set(al.positionX, x); set(al.positionY, y); set(al.positionZ, z);
      }
      if (turned || first) {
        set(al.forwardX, fx); set(al.forwardY, fy); set(al.forwardZ, fz);
        set(al.upX, ux); set(al.upY, uy); set(al.upZ, uz);
      }
    } else {
      try {
        al.setPosition(x, y, z);
        al.setOrientation(fx, fy, fz, ux, uy, uz);
      } catch (e) { /* ignore */ }
    }
  }

  // ---- mix ---------------------------------------------------------------------------

  setVolumes(music, sound) {
    try {
      if (Number.isFinite(+music)) this.vol.music = clamp(+music);
      if (Number.isFinite(+sound)) this.vol.sound = clamp(+sound);
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const B = this.bus;
      const mv = volCurve(this.vol.music) * MUSIC_TRIM;
      const sv = volCurve(this.vol.sound) * WORLD_TRIM;
      glide(B.musicVol.gain, mv, now, 0.05);
      glide(B.musicVolW.gain, mv, now, 0.05);
      glide(B.world.gain, sv, now, 0.05);
      glide(B.worldVolW.gain, sv, now, 0.05);
      glide(B.echoVol.gain, sv, now, 0.05);
    } catch (e) {
      this._warn(e);
    }
  }

  /** Dip the music under a big moment: fast attack, hold, gentle recovery. */
  duck(amount = 0.5, seconds = 1) {
    try {
      if (!this.ctx || !this.bus) return;
      const now = this.ctx.currentTime;
      const a = clamp(finite(+amount, 0.5));
      const sec = clamp(finite(+seconds, 1), 0, 60);
      const d = this._duck;
      const active = now < d.until;
      d.depth = active ? Math.max(d.depth, a) : a;
      d.until = Math.max(active ? d.until : 0, now + sec);
      for (const p of [this.bus.duck.gain, this.bus.duckW.gain]) {
        holdAt(p, now);
        glide(p, 1 - d.depth, now, 0.05);
        glide(p, 1, d.until, 0.45);
      }
    } catch (e) {
      this._warn(e);
    }
  }

  /** Called by the ambience: muffle the world (and a little of the music) inside clouds. */
  _setCloud(x, now) {
    if (Math.abs(x - this._cloud) < 0.01) return;
    this._cloud = x;
    const B = this.bus;
    const f = (lo) => 20000 * Math.pow(lo / 20000, x);
    glide(B.worldLP.frequency, f(950), now, 0.2);
    glide(B.musicLP.frequency, f(4200), now, 0.3);
    glide(B.verbLP.frequency, f(2400), now, 0.3);
  }

  // ---- score -------------------------------------------------------------------------

  setMood(name, opts = {}) {
    try {
      name = String(name);
      if (!MOODS[name] && name !== 'silence') return;
      const fade = clamp(finite(+(opts && opts.fade), 6), 0, 60);
      this._mood = { name, fade };
      if (this._built) this.conductor.setMood(name, fade);
    } catch (e) {
      this._warn(e);
    }
  }

  setIntensity(x) {
    try {
      this._intensity = clamp(finite(+x, 0.5));
      if (this._built) this.conductor.setIntensity(this._intensity);
    } catch (e) {
      this._warn(e);
    }
  }

  stinger(name) {
    try {
      if (!this.ready || !STINGERS.includes(name)) return;
      this.conductor.stinger(name, this.ctx.currentTime);
    } catch (e) {
      this._warn(e);
    }
  }

  getKey() {
    try {
      if (this._built) return this.conductor.getKey(this.ctx.currentTime);
    } catch (e) {
      this._warn(e);
    }
    const now = this.ctx ? this.ctx.currentTime : 0;
    const beat = 60 / 66;
    return {
      rootMidi: 62,
      scale: SCALES.major.slice(),
      chord: [bassNote(DEFAULT_CHORD, 38, 49), ...chordTones(DEFAULT_CHORD, 60, 71, [])],
      chordName: 'D',
      chordPcs: DEFAULT_CHORD.tones.slice(),
      beat,
      nextBeatTime: Math.ceil(now / beat) * beat,
      mood: this._mood ? this._mood.name : 'silence',
      intensity: this._intensity,
    };
  }

  /** Compact harmony snapshot for voices and tuned effects. */
  _keyNow() {
    if (this._built) {
      const h = this.conductor._harmonyAt(this.ctx.currentTime);
      return { root: h.key.root, scale: h.key.scale, ch: h.ch, pcs: h.ch.pcs };
    }
    return { root: 62, scale: SCALES.major, ch: DEFAULT_CHORD, pcs: DEFAULT_CHORD.pcs };
  }

  // ---- voices ------------------------------------------------------------------------

  createVoice(profile) {
    try {
      const v = new WhaleVoice(this, profile || {});
      this.voices.add(v);
      return v;
    } catch (e) {
      this._warn(e);
      const noop = () => {};
      return { setPosition: noop, hum: noop, release: noop, call: noop, setChargeLevel: noop, dispose: noop };
    }
  }

  _admitVoiceEngine(v) {
    this._engines.add(v);
    if (this._engines.size <= MAX_VOICE_ENGINES) return;
    // steal the quietest-looking engine: not humming, least recently active
    let victim = null;
    for (const e of this._engines) {
      if (e === v) continue;
      if (!victim || (victim.humming && !e.humming) || (e.humming === victim.humming && e.lastActive < victim.lastActive)) victim = e;
    }
    if (victim) victim._killEngine(this.ctx.currentTime, 0.03);
  }

  _releaseVoiceEngine(v) {
    this._engines.delete(v);
  }

  // ---- sfx & ambience ------------------------------------------------------------------

  sfx(name, opts = {}) {
    try {
      if (!this.ready || !SFX_NAMES.includes(name)) return;
      this.sfxEngine.play(name, opts || {});
    } catch (e) {
      this._warn(e);
    }
  }

  setAmbience(a) {
    try {
      if (!a || typeof a !== 'object') return;
      Object.assign(this._amb, a);
      if (this._built) this.ambience.set(a);
    } catch (e) {
      this._warn(e);
    }
  }

  // ---- diagnostics -------------------------------------------------------------------

  _warn(e) {
    this.stats.errors++;
    this.lastError = e;
    const msg = String((e && e.message) || e);
    if (this._warned.has(msg) || this._warned.size > 20) return;
    this._warned.add(msg);
    console.warn('[skysong audio]', e);
  }

  static get moods() {
    return MOOD_NAMES.slice();
  }

  static get sfxNames() {
    return SFX_NAMES.slice();
  }

  static get stingers() {
    return STINGERS.slice();
  }
}
