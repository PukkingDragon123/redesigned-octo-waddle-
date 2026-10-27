// Builds every pre-rendered instrument, noise loop and the reverb impulse response once
// per sample rate, time-sliced so the main thread is never blocked for long. AudioBuffers
// are context-independent, so an OfflineAudioContext at the same rate reuses the bank.
import { makeRng, runSliced } from './util.js';
import * as S from './synthesis.js';

// Pitched instruments: sampled every `step` semitones and pitch-shifted in between.
// They are rendered with gentle highs (lowpassed at 4-9 kHz), so they are stored at a
// reduced rate (playback resamples them): about half the memory and synthesis time.
// Noise, rain and the reverb IR stay at the context rate (the convolver requires it).
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

const cache = new Map();

function makeBuffer(ctx, channels, length, sr) {
  try {
    return new AudioBuffer({ numberOfChannels: channels, length: Math.max(1, length), sampleRate: sr });
  } catch (e) {
    return ctx.createBuffer(channels, Math.max(1, length), sr);
  }
}

/** Promise of the bank for this context's sample rate (shared across contexts). */
export function loadBank(ctx, stats = null) {
  const sr = ctx.sampleRate;
  let p = cache.get(sr);
  if (!p) {
    const st = stats || {};
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    p = runSliced(build(ctx, sr), 8, st).then((bank) => {
      bank.buildMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
      bank.maxSliceMs = st.maxSliceMs || 0;
      bank.maxStepMs = st.maxStepMs || 0;
      bank.maxStepLabel = st.maxStepLabel || '';
      return bank;
    });
    cache.set(sr, p);
    p.catch(() => cache.delete(sr));
  }
  return p;
}

function* build(ctx, sr) {
  const rand = makeRng(20261027);
  const bank = { sr, inst: {}, noise: {}, rain: null, ir: null };
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
  for (const name of Object.keys(RANGES)) {
    const { lo, hi, step } = RANGES[name];
    const rate = Math.min(sr, RANGES[name].rate || sr);
    const notes = [];
    for (let m = lo; m <= hi; m += step) {
      yield `${name} ${m}`;
      const b = makeBuffer(ctx, 1, Math.floor(S.DUR[name](m) * rate), rate);
      yield* S[name](b.getChannelData(0), rate, m, rand);
      notes.push({ midi: m, buffer: b });
    }
    bank.inst[name] = notes;
  }
  // percussion, tagged with nominal pitches so the sampler can retune them
  yield 'percussion';
  const one = (sec, gen, rate = Math.min(sr, DRUM_RATE)) => {
    const b = makeBuffer(ctx, 1, Math.floor(sec * rate), rate);
    return { b, gen: gen(b.getChannelData(0), rate) };
  };
  const timp = [];
  for (const m of [38, 43, 48]) {
    const { b, gen } = one(3.2, (d, r) => S.timpani(d, r, m, rand));
    yield* gen;
    timp.push({ midi: m, buffer: b });
  }
  bank.inst.timpani = timp;
  const taiko = [];
  for (const [m, f0, f1] of [[31, 95, 42], [36, 112, 50], [43, 150, 72]]) {
    const { b, gen } = one(2.2, (d, r) => S.taiko(d, r, rand, f0, f1));
    yield* gen;
    taiko.push({ midi: m, buffer: b });
  }
  bank.inst.taiko = taiko;
  {
    const { b, gen } = one(0.45, (d, r) => S.heart(d, r, rand));
    yield* gen;
    bank.inst.heart = [{ midi: 30, buffer: b }];
  }
  {
    const { b, gen } = one(3.0, (d, r) => S.cymbalSwell(d, r, rand), Math.min(sr, CYMBAL_RATE));
    yield* gen;
    bank.inst.swell = [{ midi: 60, buffer: b }];
  }
  {
    const { b, gen } = one(3.5, (d, r) => S.crash(d, r, rand), Math.min(sr, CYMBAL_RATE));
    yield* gen;
    bank.inst.crash = [{ midi: 60, buffer: b }];
  }
  return bank;
}
