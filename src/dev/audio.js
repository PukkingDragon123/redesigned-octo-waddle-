// Dev scene: audio test bench for the adaptive score, whale voices, sfx and ambience.
//   ?debug&test=audio[&autostart][&mood=flight][&intensity=0.5][&tour][&norender]
// Click or press a key to start audio (browsers need a gesture). Keys are listed on screen.
// window.__audioTest exposes offline renders (OfflineAudioContext through the real
// AudioSystem code path) and live performance probes for tools/audio-check.mjs.
import { Vector3 } from 'three';
import { AudioSystem } from '../audio/AudioSystem.js';

const MOOD_KEYS = {
  Digit1: 'title', Digit2: 'dawn', Digit3: 'flight', Digit4: 'krill', Digit5: 'forest', Digit6: 'song',
  Digit7: 'night', Digit8: 'storm', Digit9: 'danger', Digit0: 'chase', KeyQ: 'relief', KeyW: 'cloudwall',
  KeyE: 'oasis', KeyR: 'finale', KeyT: 'silence',
};
const STING_KEYS = { KeyZ: 'discover', KeyX: 'boom', KeyC: 'strike', KeyV: 'harmony', KeyB: 'resolve' };
const SFX_KEYS = {
  KeyA: 'boom', KeyS: 'boomSmall', KeyD: 'gulp', KeyF: 'sparkle', KeyG: 'bonk', KeyH: 'wingbeat', KeyJ: 'whoosh',
  KeyK: 'thunder', KeyL: 'lightningCrack', Semicolon: 'falconScreech', Quote: 'falconWing', Comma: 'splash', Period: 'chime',
};
const CALL_KEYS = {
  KeyY: ['calf', 'chirp'], KeyU: ['calf', 'coo'], KeyI: ['mother', 'answer'], KeyO: ['mother', 'warn'],
  KeyP: ['calf', 'yawn'], BracketLeft: ['calf', 'play'], BracketRight: ['mother', 'roar'], Backslash: ['elder', 'answer'],
};
const AMBIENCE = [
  { name: 'calm', wind: 0.3, rain: 0, storm: 0, speed: 6, inCloud: 0, waterfall: null, night: 0, birds: 0.3 },
  { name: 'fast flight', wind: 0.4, rain: 0, storm: 0, speed: 32, inCloud: 0, waterfall: null, night: 0, birds: 0 },
  { name: 'storm', wind: 0.8, rain: 0.9, storm: 1, speed: 12, inCloud: 0, waterfall: null, night: 0, birds: 0 },
  { name: 'in cloud', wind: 0.3, rain: 0, storm: 0, speed: 10, inCloud: 1, waterfall: null, night: 0, birds: 0 },
  { name: 'waterfall', wind: 0.2, rain: 0, storm: 0, speed: 4, inCloud: 0, waterfall: { pos: new Vector3(40, 140, -60), gain: 1 }, night: 0, birds: 0.6 },
  { name: 'night', wind: 0.15, rain: 0, storm: 0, speed: 5, inCloud: 0, waterfall: null, night: 1, birds: 0 },
];
const PROFILES = {
  calf: { base: 72, formant: 1.35, breath: 0.25 },
  mother: { base: 50, formant: 1.0, breath: 0.2 },
  elder: { base: 38, formant: 0.85, breath: 0.25 },
  sage: { base: 55, formant: 1.05, breath: 0.2 },
};

export default async function (game) {
  const p = game.params;
  const cam = game.engine.camera;
  const EYE = new Vector3(0, 150, 0);
  game.cameraRig.update = () => {
    cam.position.copy(EYE);
    cam.lookAt(EYE.x, EYE.y, EYE.z - 10);
  };
  if (p.has('norender')) game.engine.render = () => {};
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String(e.message || e)));
  window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason && e.reason.stack || e.reason)));

  const audio = game.audio || new AudioSystem(game);
  game.audio = audio;
  window.__audio = audio;
  const voices = {};
  for (const k of Object.keys(PROFILES)) voices[k] = audio.createVoice(PROFILES[k]);
  const pos = { calf: new Vector3(), mother: new Vector3(), elder: new Vector3(), sage: new Vector3() };

  // ---- overlay ---------------------------------------------------------------------
  const ui = document.createElement('pre');
  ui.style.cssText = 'position:fixed;left:12px;top:10px;margin:0;padding:10px 12px;max-width:min(560px,92vw);'
    + 'background:rgba(8,12,26,.72);color:#dfe6f5;font:12px/1.45 ui-monospace,Menlo,monospace;border-radius:8px;'
    + 'pointer-events:none;white-space:pre-wrap;z-index:5';
  document.body.appendChild(ui);
  const help = [
    'click / any key: start audio',
    '1-0 Q W E R T: title dawn flight krill forest song night storm danger chase relief cloudwall oasis finale silence',
    'up/down: intensity   Z X C V B: stingers discover boom strike harmony resolve',
    "A S D F G H J K L ; ' , . : boom boomSmall gulp sparkle bonk wingbeat whoosh thunder lightningCrack falconScreech falconWing splash chime",
    'Y U I O P [ ] \\ : calf chirp, calf coo, mother answer, mother warn, calf yawn, calf play, mother roar, elder answer',
    'N: calf hum (hold)   M: mother phrase   space (hold): charge, release = roar + boomSmall   `: ambience preset',
  ].join('\n');

  let intensity = Number.isFinite(+p.get('intensity')) && p.has('intensity') ? +p.get('intensity') : 0.5;
  let ambIdx = 0;
  let charge = 0;
  let charging = false;
  let started = false;

  const start = async () => {
    if (started) return audio.ready;
    started = true;
    const ok = await audio.start();
    audio.setIntensity(intensity);
    audio.setMood(p.get('mood') || 'title', { fade: 2 });
    audio.setAmbience(AMBIENCE[ambIdx]);
    return ok;
  };
  const gesture = () => {
    if (!started) start();
    else audio.start();
  };
  window.addEventListener('pointerdown', gesture);

  const humPhrase = () => {
    const k = audio.getKey();
    const deg = [0, 2, 4, 2, 0];
    const beat = k.beat;
    deg.forEach((d, i) => {
      setTimeout(() => voices.mother.hum(k.rootMidi - 12 + k.scale[d % 7], beat * 0.92), i * beat * 1000);
    });
  };

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    gesture();
    const c = e.code;
    if (MOOD_KEYS[c]) audio.setMood(MOOD_KEYS[c], { fade: 4 });
    else if (STING_KEYS[c]) audio.stinger(STING_KEYS[c]);
    else if (SFX_KEYS[c]) {
      const name = SFX_KEYS[c];
      const where = name === 'thunder' ? new Vector3(-900, 400, -1200) : name === 'boom' ? new Vector3(0, 150, -40) : new Vector3((Math.random() - 0.5) * 60, 150, -20 - Math.random() * 40);
      audio.sfx(name, { position: where, gain: 1 });
    } else if (CALL_KEYS[c]) voices[CALL_KEYS[c][0]].call(CALL_KEYS[c][1]);
    else if (c === 'ArrowUp' || c === 'ArrowDown') {
      intensity = Math.max(0, Math.min(1, intensity + (c === 'ArrowUp' ? 0.1 : -0.1)));
      audio.setIntensity(intensity);
    } else if (c === 'KeyN') {
      const k = audio.getKey();
      voices.calf.hum(k.rootMidi + 12 + k.scale[4], undefined, { glideFrom: k.rootMidi + 10 });
    } else if (c === 'KeyM') humPhrase();
    else if (c === 'Space') charging = true;
    else if (c === 'Backquote') {
      ambIdx = (ambIdx + 1) % AMBIENCE.length;
      audio.setAmbience(AMBIENCE[ambIdx]);
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'KeyN') voices.calf.release(0.35);
    if (e.code === 'Space') {
      charging = false;
      if (charge > 0.2) {
        voices.calf.call('roar');
        audio.sfx('boomSmall', { position: pos.calf, gain: 0.6 + charge * 0.5 });
        audio.duck(0.4, 1);
      }
      charge = 0;
      voices.calf.setChargeLevel(0);
    }
  });

  // ---- per frame -----------------------------------------------------------------------
  let uiT = 0;
  let tourT = 0;
  let tourI = 0;
  const tour = p.has('tour') ? ['title', 'dawn', 'flight', 'krill', 'forest', 'song', 'night', 'storm', 'danger', 'chase', 'relief', 'cloudwall', 'oasis', 'finale'] : null;
  game.devUpdate = (dt) => {
    const t = game.time;
    pos.calf.set(EYE.x + 2 + Math.sin(t * 0.7) * 1.5, EYE.y - 1, EYE.z - 7);
    pos.mother.set(EYE.x + Math.cos(t * 0.15) * 26, EYE.y - 4, EYE.z - 20 + Math.sin(t * 0.15) * 26);
    pos.elder.set(EYE.x - 90, EYE.y + 12, EYE.z - 220);
    pos.sage.set(EYE.x + 60, EYE.y - 5, EYE.z - 70);
    for (const k of Object.keys(voices)) voices[k].setPosition(pos[k]);
    if (charging) {
      charge = Math.min(1, charge + dt * 0.45);
      voices.calf.setChargeLevel(charge);
    }
    if (tour && audio.ready) {
      tourT -= dt;
      if (tourT <= 0) {
        audio.setMood(tour[tourI++ % tour.length], { fade: 4 });
        tourT = 20;
      }
    }
    audio.update(dt);
    uiT -= dt;
    if (uiT <= 0) {
      uiT = 0.25;
      const k = audio.getKey();
      const s = audio.stats;
      ui.textContent = `SKYSONG audio bench\n${help}\n\n`
        + `ready ${audio.ready}  ctx ${audio.ctx ? audio.ctx.state : '-'}  mood ${k.mood}  intensity ${intensity.toFixed(1)}  ambience ${AMBIENCE[ambIdx].name}\n`
        + `key root ${k.rootMidi}  chord ${k.chordName} [${k.chord.join(' ')}]  beat ${k.beat.toFixed(3)} s  next ${k.nextBeatTime.toFixed(2)}\n`
        + `update ${s.updateMs.toFixed(3)} ms (max ${s.maxUpdateMs.toFixed(2)})  bank ${Math.round(s.buildMs)} ms (longest slice ${s.maxSliceMs.toFixed(1)} ms)  errors ${s.errors}`
        + (charging ? `\ncharge ${charge.toFixed(2)}` : '');
    }
  };

  // ---- test hooks ----------------------------------------------------------------------
  window.__audioTest = makeHooks(game, audio, voices, errors, start);
  if (p.has('autostart')) start();
}

function analyze(buf) {
  const chs = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
  const n = buf.length;
  const win = Math.max(1, Math.floor(buf.sampleRate * 0.4));
  let peak = 0;
  let sum = 0;
  let nan = 0;
  let over = 0;
  let wsum = 0;
  let wn = 0;
  let maxWin = 0;
  let silentWins = 0;
  let wins = 0;
  for (let i = 0; i < n; i++) {
    let s2 = 0;
    for (const d of chs) {
      const x = d[i];
      if (!Number.isFinite(x)) {
        nan++;
        continue;
      }
      const a = Math.abs(x);
      if (a > peak) peak = a;
      if (a >= 0.891) over++;
      s2 += x * x;
    }
    s2 /= chs.length;
    sum += s2;
    wsum += s2;
    if (++wn === win) {
      const r = Math.sqrt(wsum / wn);
      if (r > maxWin) maxWin = r;
      if (r < 1e-4) silentWins++;
      wins++;
      wsum = 0;
      wn = 0;
    }
  }
  const db = (x) => (x > 0 ? Math.round(2000 * Math.log10(x)) / 100 : -Infinity);
  const rms = Math.sqrt(sum / Math.max(1, n));
  return { peakDb: db(peak), rmsDb: db(rms), maxRms400Db: db(maxWin), nan, overMinus1dB: over, silentFrac: wins ? silentWins / wins : 1, seconds: n / buf.sampleRate };
}

function toWav(buf) {
  const ch = Math.min(2, buf.numberOfChannels);
  const n = buf.length;
  const sr = buf.sampleRate;
  const bytes = 44 + n * ch * 2;
  const dv = new DataView(new ArrayBuffer(bytes));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, bytes - 8, true); w(8, 'WAVE'); w(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true); dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true);
  w(36, 'data'); dv.setUint32(40, n * ch * 2, true);
  const data = [];
  for (let c = 0; c < ch; c++) data.push(buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const x = Math.max(-1, Math.min(1, data[c][i] || 0));
      dv.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true);
      o += 2;
    }
  }
  const u8 = new Uint8Array(dv.buffer);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

function makeHooks(game, live, liveVoices, errors, start) {
  /**
   * Render `seconds` through a fresh AudioSystem on an OfflineAudioContext.
   * script(sys, voices) returns { at: [[time, fn(sys, t)]], each(sys, t) }.
   */
  async function render(seconds, script, o = {}) {
    const sr = o.sampleRate || (live.ctx ? live.ctx.sampleRate : 48000);
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil(sr * seconds), sampleRate: sr });
    const sys = new AudioSystem(game, { context: ctx, seed: o.seed ?? 7, layers: o.layers, log: o.log ? [] : undefined, hrtf: o.hrtf });
    const errs = [];
    const before = errors.length;
    const tb = performance.now();
    await sys.start();
    const buildMs = performance.now() - tb;
    const vs = {};
    for (const k of Object.keys(PROFILES)) vs[k] = sys.createVoice(PROFILES[k]);
    const sc = script(sys, vs) || {};
    const at = (sc.at || []).slice().sort((a, b) => a[0] - b[0]);
    let ai = 0;
    const step = o.step || 0.05;
    let maxUpdate = 0;
    let sumUpdate = 0;
    let nUpdate = 0;
    const tick = (t) => {
      try {
        while (ai < at.length && at[ai][0] <= t + 1e-9) at[ai++][1](sys, t, vs);
        if (sc.each) sc.each(sys, t, vs);
        const a = performance.now();
        sys.update(step);
        const d = performance.now() - a;
        maxUpdate = Math.max(maxUpdate, d);
        sumUpdate += d;
        nUpdate++;
      } catch (e) {
        errs.push(String(e && e.stack || e));
      }
    };
    tick(0);
    for (let k = 1; k * step < seconds - 1e-6; k++) {
      const t = k * step;
      ctx.suspend(t).then(() => {
        tick(t);
        ctx.resume();
      });
    }
    const tr = performance.now();
    const buf = await ctx.startRendering();
    const res = analyze(buf);
    res.renderMs = Math.round(performance.now() - tr);
    res.buildMs = Math.round(buildMs);
    res.maxUpdateMs = Math.round(maxUpdate * 1000) / 1000;
    res.avgUpdateMs = Math.round((sumUpdate / Math.max(1, nUpdate)) * 1000) / 1000;
    res.errors = errs.concat(errors.slice(before));
    res.sysErrors = sys.stats.errors;
    res.lastError = sys.lastError ? String(sys.lastError.stack || sys.lastError) : null;
    if (o.wav) res.wav = toWav(buf);
    if (o.log) res.log = sys.opts.log;
    return res;
  }

  const SCENES = {
    /** One mood, intensity stepping 0.2 -> 0.55 -> 0.95 over the render. */
    mood: (name, seconds) => () => ({
      at: [
        [0, (s) => { s.setIntensity(0.2); s.setMood(name, { fade: 0.5 }); }],
        [seconds * 0.33, (s) => s.setIntensity(0.55)],
        [seconds * 0.66, (s) => s.setIntensity(0.95)],
      ],
    }),
    /** Crossfades through several moods. */
    transitions: () => ({
      at: [
        [0, (s) => { s.setIntensity(0.6); s.setMood('flight', { fade: 1 }); }],
        [5, (s) => s.setMood('krill', { fade: 4 })],
        [11, (s) => { s.setMood('danger', { fade: 1.5 }); s.setIntensity(0.8); }],
        [16, (s) => { s.setMood('chase', { fade: 2 }); s.setIntensity(1); }],
        [22, (s) => { s.setMood('relief', { fade: 5 }); s.stinger('resolve'); s.setIntensity(0.5); }],
        [29, (s) => s.setMood('silence', { fade: 3 })],
      ],
    }),
    /** Whale voices alone: hums, glides, every call, the charge ladder and a roar. */
    voices: () => ({
      at: [
        [0, (s, t, v) => { s.setMood('silence'); v.calf.setPosition({ x: 2, y: 149, z: -7 }); v.mother.setPosition({ x: -15, y: 146, z: -25 }); v.elder.setPosition({ x: -90, y: 162, z: -220 }); v.sage.setPosition({ x: 60, y: 145, z: -70 }); }],
        [0.2, (s, t, v) => v.mother.hum(50, 1.6)],
        [1.9, (s, t, v) => v.mother.hum(54, 1.2)],
        [3.0, (s, t, v) => v.mother.hum(57, 1.8)],
        [0.5, (s, t, v) => v.elder.hum(38, 5)],
        [1.2, (s, t, v) => v.sage.hum(55, 3)],
        [2.2, (s, t, v) => v.calf.hum(74, undefined, { glideFrom: 72 })],
        [3.2, (s, t, v) => v.calf.hum(78)],
        [4.2, (s, t, v) => v.calf.release(0.35)],
        [5.0, (s, t, v) => v.calf.call('chirp')],
        [5.8, (s, t, v) => v.calf.call('coo')],
        [6.8, (s, t, v) => v.mother.call('answer')],
        [9.2, (s, t, v) => v.mother.call('warn')],
        [10.6, (s, t, v) => v.calf.call('yawn')],
        [12.6, (s, t, v) => v.calf.call('play')],
        [13.6, (s, t, v) => v.elder.call('answer')],
        [16.0, (s, t, v) => v.mother.call('roar')],
      ],
      each: (s, t, v) => {
        if (t >= 18 && t < 21) v.calf.setChargeLevel((t - 18) / 3);
        if (t >= 21 && t < 21.04) { v.calf.setChargeLevel(0); v.calf.call('roar'); s.sfx('boomSmall', { position: { x: 2, y: 149, z: -7 }, gain: 1.1 }); }
      },
    }),
    /** The herd song: song mood with the mother's phrases and the calf answering on the beat. */
    song: () => ({
      at: [[0, (s) => { s.setIntensity(0.3); s.setMood('song', { fade: 1 }); }], [10, (s) => s.setIntensity(0.7)], [15, (s) => s.stinger('harmony')], [16, (s) => s.setIntensity(1)]],
      each: (s, t, v) => {
        v.mother.setPosition({ x: -15, y: 146, z: -25 });
        v.calf.setPosition({ x: 2, y: 149, z: -7 });
        const k = s.getKey();
        const beatIdx = Math.round(t / k.beat);
        if (Math.abs(t - beatIdx * k.beat) < 0.025 && beatIdx > 2) {
          const deg = [0, 2, 4, 2][beatIdx % 4];
          if (beatIdx % 8 < 4) v.mother.hum(k.rootMidi - 12 + k.scale[deg], k.beat * 0.9);
          else v.calf.hum(k.rootMidi + 12 + k.scale[deg], k.beat * 0.9);
        }
      },
    }),
    /** All stingers over silence. */
    stingers: () => ({
      at: [
        [0, (s) => s.setMood('silence')],
        [0.2, (s) => s.stinger('discover')], [3.5, (s) => s.stinger('boom')], [7, (s) => s.stinger('strike')],
        [10, (s) => s.stinger('harmony')], [13.5, (s) => s.stinger('resolve')],
      ],
    }),
    /** Ambience presets in turn. */
    ambience: () => ({
      at: AMBIENCE.map((a, i) => [i * 3.5, (s) => { s.setMood('silence'); s.setAmbience(a); }]),
    }),
    /** A single sfx (gain 1, positioned 30 m ahead unless given). */
    sfx: (name, gain = 1, position) => () => ({
      at: [[0.1, (s) => s.sfx(name, { position: position || { x: 0, y: 150, z: -30 }, gain })]],
    }),
    /** Busy game-like scene to check the mix: chase at full intensity with everything going. */
    busy: () => ({
      at: [
        [0, (s, t, v) => { s.setIntensity(1); s.setMood('chase', { fade: 0.5 }); s.setAmbience({ wind: 0.8, rain: 0.6, storm: 0.8, speed: 30 }); }],
        [1, (s) => s.sfx('falconScreech', { position: { x: 30, y: 160, z: -40 }, gain: 1 })],
        [2, (s, t, v) => v.mother.call('warn')],
        [3, (s) => s.stinger('strike')],
        [3.1, (s) => s.sfx('lightningCrack', { position: { x: -40, y: 200, z: -100 }, gain: 1 })],
        [5, (s, t, v) => { v.mother.call('roar'); v.elder.call('roar'); v.sage.call('roar'); }],
        [6, (s) => { s.sfx('boom', { position: { x: 0, y: 150, z: -30 }, gain: 1.2 }); s.stinger('boom'); s.duck(0.4, 1.2); }],
        [9, (s) => s.sfx('thunder', { position: { x: 300, y: 400, z: -600 }, gain: 1 })],
      ],
      each: (s, t, v) => {
        v.calf.setPosition({ x: 2, y: 149, z: -7 });
        v.mother.setPosition({ x: -15, y: 146, z: -25 });
        v.elder.setPosition({ x: -30, y: 152, z: -60 });
        v.sage.setPosition({ x: 25, y: 148, z: -45 });
      },
    }),
  };

  return {
    live,
    liveVoices,
    errors,
    start,
    moods: AudioSystem.moods,
    sfxNames: AudioSystem.sfxNames,
    stingers: AudioSystem.stingers,
    render,
    renderMood: (name, seconds = 18, o = {}) => render(seconds, SCENES.mood(name, seconds), o),
    renderScene: (name, seconds = 20, o = {}) => render(seconds, SCENES[name], o),
    renderSfx: (name, seconds = 5, o = {}) => render(seconds, SCENES.sfx(name, o.gain ?? 1, o.position), o),
    /** Static gain of the master chain for a quiet tone (dB): checks the compressor trims. */
    async chainGain(levelDb = -30) {
      const sr = live.ctx ? live.ctx.sampleRate : 48000;
      const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: sr * 2, sampleRate: sr });
      const sys = new AudioSystem(game, { context: ctx, seed: 1 });
      await sys.start();
      const o = ctx.createOscillator();
      o.frequency.value = 440;
      const g = ctx.createGain();
      g.gain.value = Math.pow(10, levelDb / 20);
      o.connect(g);
      g.connect(sys.bus.master);
      o.start(0);
      const buf = await ctx.startRendering();
      const d = buf.getChannelData(0);
      let pk = 0;
      for (let i = buf.length >> 1; i < buf.length; i++) pk = Math.max(pk, Math.abs(d[i]));
      return Math.round((20 * Math.log10(pk) - levelDb) * 100) / 100;
    },
    /** Live probe: drive the real-time system hard for `seconds` and report update() cost. */
    async perf(seconds = 6) {
      await start();
      live.stats.maxUpdateMs = 0;
      live.setMood('chase', { fade: 1 });
      live.setIntensity(1);
      live.setAmbience({ wind: 0.8, rain: 0.7, storm: 0.8, speed: 30, birds: 0.5, night: 0.5, waterfall: { pos: new Vector3(40, 140, -60), gain: 1 } });
      const k = live.getKey();
      liveVoices.mother.hum(k.rootMidi - 12, seconds);
      liveVoices.elder.hum(k.rootMidi - 24, seconds);
      liveVoices.sage.hum(k.rootMidi - 5, seconds);
      liveVoices.calf.hum(k.rootMidi + 12, seconds);
      const times = [];
      const warm = [];
      const orig = live.update.bind(live);
      const tStart = performance.now();
      live.update = (dt) => {
        const a = performance.now();
        orig(dt);
        // the first second includes one-time costs (first section builds, first voices)
        (performance.now() - tStart < 1000 ? warm : times).push(performance.now() - a);
      };
      const t0 = performance.now();
      let n = 0;
      await new Promise((resolve) => {
        const iv = setInterval(() => {
          live.sfx(['wingbeat', 'sparkle', 'gulp', 'whoosh', 'chime'][n++ % 5], { position: new Vector3(Math.random() * 40 - 20, 150, -20), gain: 0.5 });
          if (n % 7 === 0) liveVoices.calf.call('chirp');
          if (performance.now() - t0 > seconds * 1000) {
            clearInterval(iv);
            resolve();
          }
        }, 150);
      });
      live.update = orig;
      times.sort((a, b) => a - b);
      const avg = times.reduce((a, b) => a + b, 0) / Math.max(1, times.length);
      return {
        firstSecondMaxMs: Math.round(Math.max(0, ...warm) * 1000) / 1000,
        frames: times.length,
        avgMs: Math.round(avg * 1000) / 1000,
        p95Ms: Math.round((times[Math.floor(times.length * 0.95)] || 0) * 1000) / 1000,
        maxMs: Math.round((times[times.length - 1] || 0) * 1000) / 1000,
        ctxState: live.ctx.state,
        sampleRate: live.ctx.sampleRate,
        ready: live.ready,
        errors: live.stats.errors,
        lastError: live.lastError ? String(live.lastError.stack || live.lastError) : null,
      };
    },
  };
}
