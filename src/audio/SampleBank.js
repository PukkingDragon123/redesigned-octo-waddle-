// Builds every pre-rendered instrument, noise loop and the reverb impulse response,
// time-sliced so the main thread is never blocked for long. AudioBuffers are
// context-independent, so every context (including an OfflineAudioContext) shares them.
//
// Two parts:
//   core: the instruments, stored at fixed reduced rates. It needs no AudioContext, so it
//         can be synthesised early (preloadBank) before the first user gesture.
//   env:  noise loops, rain and the reverb IR at the context's own rate (the convolver
//         requires a matching rate). Built per sample rate once the context exists.
import { makeRng, runSliced } from './util.js';
import * as S from './synthesis.js';
import { MUSIC_SAMPLES, MUSIC_SAMPLE_BASE } from './musicSamples.js';

// Pitched instruments: sampled every `step` semitones and pitch-shifted in between.
// They are rendered with gentle highs (lowpassed at 4-9 kHz), so they are stored at a
// reduced rate (playback resamples them): about half the memory and synthesis time.
const RANGES = {
  piano: { lo: 33, hi: 99, step: 3, rate: 24000 },
  harp: { lo: 35, hi: 99, step: 4, rate: 24000 },
  celesta: { lo: 60, hi: 108, step: 4, rate: 32000 },
  bell: { lo: 55, hi: 101, step: 6, rate: 32000 },
  marimba: { lo: 43, hi: 95, step: 4, rate: 24000 },
  pizz: { lo: 31, hi: 83, step: 4, rate: 24000 },
  stac: { lo: 31, hi: 83, step: 4, rate: 24000 },
};
const DRUM_RATE = 24000;
const CYMBAL_RATE = 32000;
export const IR_SECONDS = 5;
export const IR_SPLIT = 2.5;

// Real instruments (src/audio/musicSamples.js) replace the synthesized ones when their files load;
// a start does not wait for them longer than this (they swap in later through bank.samplesLate).
const SAMPLE_WAIT_MS = 2500;
const SAMPLE_RATE = 32000;
const SAMPLE_JOBS = 6;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const envCache = new Map();
let core = null; // { promise, stats }
let samples = null; // promise of { name: [{ midi, buffer, loop? }] } or null

function makeBuffer(ctx, channels, length, sr) {
  try {
    return new AudioBuffer({ numberOfChannels: channels, length: Math.max(1, length), sampleRate: sr });
  } catch (e) {
    if (!ctx) throw e;
    return ctx.createBuffer(channels, Math.max(1, length), sr);
  }
}

function canBuildWithoutContext() {
  try {
    return typeof AudioBuffer !== 'undefined' && !!new AudioBuffer({ length: 1, sampleRate: 24000 });
  } catch (e) {
    return false;
  }
}

function track(gen) {
  const stats = { maxSliceMs: 0, maxStepMs: 0, maxStepLabel: '', ms: 0 };
  const t0 = now();
  const promise = runSliced(gen, 8, stats).then((v) => {
    stats.ms = now() - t0;
    return v;
  });
  return { promise, stats };
}

/**
 * Start synthesising the instruments now (no AudioContext needed). Safe to call often;
 * returns the shared promise, or null where AudioBuffers need a context (old Safari).
 */
export function preloadBank(ctx = null) {
  preloadSamples();
  if (!core) {
    if (!ctx && !canBuildWithoutContext()) return null;
    core = track(buildCore(ctx));
    core.promise.catch(() => {
      core = null;
    });
  }
  return core.promise;
}

/** Promise of the complete bank for this context's sample rate. */
export function loadBank(ctx, stats = null) {
  const sr = ctx.sampleRate;
  let p = envCache.get(sr);
  if (!p) {
    p = (async () => {
      const t0 = now();
      const inst = await preloadBank(ctx);
      const env = track(buildEnv(ctx, sr));
      const bank = await env.promise;
      bank.inst = inst;
      bank.sus = {};
      const smp = preloadSamples();
      const got = await Promise.race([smp, new Promise((r) => setTimeout(() => r(undefined), SAMPLE_WAIT_MS))]);
      if (got) applySamples(bank, got);
      else if (got === undefined) bank.samplesLate = smp.then((x) => (x ? applySamples(bank, x) : null));
      bank.buildMs = core.stats.ms + env.stats.ms;
      bank.waitMs = now() - t0;
      const worst = core.stats.maxStepMs > env.stats.maxStepMs ? core.stats : env.stats;
      bank.maxSliceMs = Math.max(core.stats.maxSliceMs, env.stats.maxSliceMs);
      bank.maxStepMs = worst.maxStepMs;
      bank.maxStepLabel = worst.maxStepLabel;
      return bank;
    })();
    envCache.set(sr, p);
    p.catch(() => envCache.delete(sr));
  }
  if (stats) {
    p.then((b) => {
      stats.buildMs = b.buildMs;
      stats.maxSliceMs = b.maxSliceMs;
      stats.maxStepMs = b.maxStepMs;
      stats.maxStepLabel = b.maxStepLabel;
    }).catch(() => {});
  }
  return p;
}

/**
 * Fetch and decode the real instrument samples (once; shared by every context). Decoding runs
 * on a tiny OfflineAudioContext, so it needs no user gesture. Resolves to null when the files
 * cannot be had (the synthesized instruments then stay). Never rejects.
 */
export function preloadSamples() {
  if (samples) return samples;
  samples = (async () => {
    if (typeof fetch === 'undefined' || typeof OfflineAudioContext === 'undefined') return null;
    let dec;
    try {
      dec = new OfflineAudioContext(1, 1, SAMPLE_RATE);
    } catch (e) {
      try { dec = new OfflineAudioContext(1, 1, 44100); } catch (e2) { return null; }
    }
    const jobs = [];
    const out = {};
    for (const name of Object.keys(MUSIC_SAMPLES)) {
      const set = MUSIC_SAMPLES[name];
      const notes = (out[name] = []);
      for (const [midi, file, cents, loop] of set.notes) {
        jobs.push(async () => {
          const res = await fetch(`${MUSIC_SAMPLE_BASE}${name}/${file}.ogg`);
          if (!res.ok || (res.headers.get('content-type') || '').includes('text/html')) return;
          const data = await res.arrayBuffer();
          const buffer = await dec.decodeAudioData(data);
          const k = set.level ?? 1;
          if (k !== 1) for (let c = 0; c < buffer.numberOfChannels; c++) {
            const d = buffer.getChannelData(c);
            for (let i = 0; i < d.length; i++) d[i] *= k;
          }
          // the measured tuning (cents) becomes a fractional nominal pitch: the sampler retunes it
          const n = { midi: midi + Math.max(-0.3, Math.min(0.3, (cents || 0) / 100)), buffer };
          if (loop) n.loop = loop;
          notes.push(n);
        });
      }
    }
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        try { await job(); } catch (e) { /* that note stays missing */ }
      }
    };
    await Promise.all(Array.from({ length: SAMPLE_JOBS }, worker));
    let any = false;
    for (const name of Object.keys(out)) {
      // a set with gaps would jump in timbre and pitch-shift too far: keep the synthesis then
      if (out[name].length < MUSIC_SAMPLES[name].notes.length * 0.75) delete out[name];
      else {
        out[name].sort((a, b) => a.midi - b.midi);
        any = true;
      }
    }
    return any ? out : null;
  })().catch(() => null);
  return samples;
}

/** Swap the loaded samples into a bank (a fresh object: the synthesized core stays shared). */
function applySamples(bank, smp) {
  const inst = Object.assign({}, bank.inst);
  const sus = Object.assign({}, bank.sus);
  for (const name of Object.keys(smp)) {
    if (smp[name][0] && smp[name][0].loop) sus[name] = smp[name];
    else inst[name] = smp[name];
  }
  bank.inst = inst;
  bank.sus = sus;
  bank.sampled = Object.keys(smp);
  return bank;
}

function* buildEnv(ctx, sr) {
  const rand = makeRng(20261027);
  const bank = { sr, inst: null, noise: {}, rain: null, irHead: null, irTail: null };
  for (const type of ['white', 'pink', 'brown']) {
    yield `noise ${type}`;
    const b = makeBuffer(ctx, 1, Math.floor(sr * 3), sr);
    yield* S.noise(b.getChannelData(0), sr, type, rand);
    bank.noise[type] = b;
  }
  {
    // The 5 s IR is split into a head and a tail (the tail is fed through a delay of
    // IR_SPLIT seconds): assigning a convolver buffer costs main-thread FFT work in
    // proportion to its length, so two halves can be installed in two short tasks.
    yield 'reverb';
    const len = Math.floor(sr * IR_SECONDS);
    const L = new Float32Array(len);
    const R = new Float32Array(len);
    yield* S.reverbIR(L, R, sr, IR_SECONDS, rand);
    const cut = Math.floor(sr * IR_SPLIT);
    const head = makeBuffer(ctx, 2, cut, sr);
    const tail = makeBuffer(ctx, 2, len - cut, sr);
    head.copyToChannel(L.subarray(0, cut), 0);
    head.copyToChannel(R.subarray(0, cut), 1);
    tail.copyToChannel(L.subarray(cut), 0);
    tail.copyToChannel(R.subarray(cut), 1);
    bank.irHead = head;
    bank.irTail = tail;
  }
  {
    yield 'rain';
    const b = makeBuffer(ctx, 2, Math.floor(sr * 3), sr);
    yield* S.rain(b.getChannelData(0), b.getChannelData(1), sr, rand);
    bank.rain = b;
  }
  return bank;
}

function* buildCore(ctx) {
  const rand = makeRng(20261103);
  const inst = {};
  for (const name of Object.keys(RANGES)) {
    const { lo, hi, step, rate } = RANGES[name];
    const notes = [];
    for (let m = lo; m <= hi; m += step) {
      yield `${name} ${m}`;
      const b = makeBuffer(ctx, 1, Math.floor(S.DUR[name](m) * rate), rate);
      yield* S[name](b.getChannelData(0), rate, m, rand);
      notes.push({ midi: m, buffer: b });
    }
    inst[name] = notes;
  }
  // percussion, tagged with nominal pitches so the sampler can retune them
  yield 'percussion';
  const one = (sec, gen, rate = DRUM_RATE) => {
    const b = makeBuffer(ctx, 1, Math.floor(sec * rate), rate);
    return { b, gen: gen(b.getChannelData(0), rate) };
  };
  const timp = [];
  for (const m of [38, 43, 48]) {
    yield `timpani ${m}`;
    const { b, gen } = one(3.2, (d, r) => S.timpani(d, r, m, rand));
    yield* gen;
    timp.push({ midi: m, buffer: b });
  }
  inst.timpani = timp;
  const taiko = [];
  for (const [m, f0, f1] of [[31, 100, 48], [36, 120, 56], [43, 155, 76]]) {
    yield `taiko ${m}`;
    const { b, gen } = one(2.2, (d, r) => S.taiko(d, r, rand, f0, f1));
    yield* gen;
    taiko.push({ midi: m, buffer: b });
  }
  inst.taiko = taiko;
  {
    yield 'heart';
    const { b, gen } = one(0.45, (d, r) => S.heart(d, r, rand));
    yield* gen;
    inst.heart = [{ midi: 30, buffer: b }];
  }
  {
    yield 'cymbal swell';
    const { b, gen } = one(3.0, (d, r) => S.cymbalSwell(d, r, rand), CYMBAL_RATE);
    yield* gen;
    inst.swell = [{ midi: 60, buffer: b }];
  }
  {
    yield 'crash';
    const { b, gen } = one(3.5, (d, r) => S.crash(d, r, rand), CYMBAL_RATE);
    yield* gen;
    inst.crash = [{ midi: 60, buffer: b }];
  }
  return inst;
}
