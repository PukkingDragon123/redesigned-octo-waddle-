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

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const envCache = new Map();
let core = null; // { promise, stats }

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

function* buildEnv(ctx, sr) {
  const rand = makeRng(20261027);
  const bank = { sr, inst: null, noise: {}, rain: null, ir: null };
  for (const type of ['white', 'pink', 'brown']) {
    yield `noise ${type}`;
    const b = makeBuffer(ctx, 1, Math.floor(sr * 3), sr);
    yield* S.noise(b.getChannelData(0), sr, type, rand);
    bank.noise[type] = b;
  }
  {
    yield 'reverb';
    const b = makeBuffer(ctx, 2, Math.floor(sr * 5), sr);
    yield* S.reverbIR(b.getChannelData(0), b.getChannelData(1), sr, 5, rand);
    bank.ir = b;
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
