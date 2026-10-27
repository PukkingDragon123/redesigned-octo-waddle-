// Offline (pre-rendered) instrument synthesis in plain JS. Every renderer is a generator:
// each `yield` is a cut point so the bank builder can time-slice the work and never block
// the main thread for long. Renderers write into a Float32Array and normalise it.
import { TAU, clamp, lerp, mtof } from './util.js';

// ---- primitives -----------------------------------------------------------------------

/** Add an exponentially decaying sinusoid using the damped-resonator recurrence. */
export function addPartial(out, sr, f, amp, t60, phase = 0, start = 0) {
  if (!(f > 0) || f >= sr * 0.47 || !(amp > 0) || start >= out.length) return;
  const w = (TAU * f) / sr;
  const r = t60 > 0 ? Math.pow(0.001, 1 / (t60 * sr)) : 1;
  const c = 2 * r * Math.cos(w);
  const r2 = r * r;
  const avail = out.length - start;
  let n = avail;
  if (r < 1) n = Math.min(avail, Math.ceil(Math.log(2e-5 / amp) / Math.log(r)));
  let y1 = amp * Math.sin(phase);
  let y2 = (amp * Math.sin(phase - w)) / r;
  for (let i = 0; i < n; i++) {
    out[start + i] += y1;
    const y0 = c * y1 - r2 * y2;
    y2 = y1;
    y1 = y0;
  }
}

/** One-pole lowpass, in place. */
export function lowpass(buf, sr, fc) {
  const k = 1 - Math.exp((-TAU * fc) / sr);
  let y = 0;
  for (let i = 0; i < buf.length; i++) {
    y += k * (buf[i] - y);
    buf[i] = y;
  }
}

/** One-pole highpass, in place. */
export function highpass(buf, sr, fc) {
  const a = Math.exp((-TAU * fc) / sr);
  let y = 0;
  let xp = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    y = a * (y + x - xp);
    xp = x;
    buf[i] = y;
  }
}

/** RBJ biquad, in place. */
export function biquad(buf, sr, type, f, q, gainDb = 0, start = 0, end = buf.length) {
  const w = (TAU * Math.min(f, sr * 0.45)) / sr;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const alpha = sw / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'bandpass') {
    b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  } else if (type === 'peaking') {
    const A = Math.pow(10, gainDb / 40);
    b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
  } else if (type === 'highpass') {
    b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  } else {
    b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  }
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = start; i < end; i++) {
    const x = buf[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    buf[i] = y;
  }
}

function attackRamp(buf, sr, sec) {
  const n = Math.min(buf.length, Math.max(1, Math.floor(sec * sr)));
  for (let i = 0; i < n; i++) buf[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / n);
}

function fadeTail(buf, sr, sec) {
  const n = Math.min(buf.length, Math.max(1, Math.floor(sec * sr)));
  const s = buf.length - n;
  for (let i = 0; i < n; i++) buf[s + i] *= 0.5 + 0.5 * Math.cos((Math.PI * i) / n);
}

export function normalize(buf, peak = 0.9) {
  let p = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (a > p) p = a;
  }
  if (p > 1e-9 && Number.isFinite(p)) {
    const g = peak / p;
    for (let i = 0; i < buf.length; i++) buf[i] *= g;
  } else buf.fill(0);
  return p;
}

const keyPos = (midi, lo = 24, hi = 108) => clamp((midi - lo) / (hi - lo));

// ---- tuned instruments ----------------------------------------------------------------

/** Durations (seconds) per instrument and note. */
export const DUR = {
  piano: (m) => lerp(5.2, 1.8, keyPos(m, 30, 100)),
  harp: (m) => lerp(4.2, 1.6, keyPos(m, 30, 100)),
  celesta: (m) => lerp(3.0, 1.5, keyPos(m, 55, 110)),
  bell: (m) => lerp(5.5, 2.8, keyPos(m, 50, 105)),
  marimba: (m) => lerp(1.8, 0.8, keyPos(m, 40, 100)),
  pizz: (m) => lerp(1.3, 0.6, keyPos(m, 28, 90)),
  stac: () => 0.62,
};

/**
 * Soft "felt" piano: inharmonic partials (stretched by string stiffness), per-partial
 * decay, two or three slightly detuned strings per note (prompt + aftersound), hammer noise.
 */
export function* piano(out, sr, midi, rand) {
  const f0 = mtof(midi);
  const x = keyPos(midi, 21, 108);
  const B = 0.00032 * Math.pow(2, (midi - 60) / 12);
  const fmax = Math.min(sr * 0.45, lerp(5200, 8000, x));
  const t60base = lerp(13, 2.2, Math.pow(x, 0.85));
  const strings = midi < 38 ? 2 : 3;
  const cents = lerp(0.8, 1.7, x);
  const tilt = lerp(1.15, 1.5, x);
  const decays = strings === 3 ? [0.32, 1.0, 0.78] : [0.36, 1.0];
  const amps = strings === 3 ? [0.44, 0.31, 0.25] : [0.55, 0.45];
  const strike = 1 / 7.6;
  for (let n = 1; n <= 40; n++) {
    const fn = f0 * n * Math.sqrt(1 + B * n * n);
    if (fn > fmax) break;
    const a = Math.pow(n, -tilt) * (0.3 + 0.7 * Math.abs(Math.sin(Math.PI * n * strike)));
    const t60 = t60base / (1 + 0.085 * Math.pow(n - 1, 1.4) * lerp(1, 2.4, x));
    for (let s = 0; s < strings; s++) {
      const dc = (s - (strings - 1) / 2) * cents + (rand() - 0.5) * 0.3;
      addPartial(out, sr, fn * Math.pow(2, dc / 1200), a * amps[s], t60 * decays[s], rand() * TAU);
      if (n < 4) yield;
    }
    yield;
  }
  // hammer: a short felt thump and a little noise
  const hn = Math.min(out.length, Math.floor(sr * 0.04));
  const k = 1 - Math.exp((-TAU * lerp(900, 3200, x)) / sr);
  let lp = 0;
  for (let i = 0; i < hn; i++) {
    const t = i / sr;
    const env = Math.exp(-t / 0.007) * (1 - Math.exp(-t / 0.0007));
    lp += k * (rand() * 2 - 1 - lp);
    out[i] += lp * env * 0.22 + Math.sin(TAU * f0 * 0.5 * t) * env * 0.05;
  }
  yield;
  lowpass(out, sr, lerp(5200, 8500, x));
  attackRamp(out, sr, 0.0018);
  fadeTail(out, sr, 0.35);
  normalize(out, 0.9);
}

/** Harp: Karplus-Strong with an allpass fractional delay (accurate tuning) and a soft pluck. */
export function* harp(out, sr, midi, rand, opts = {}) {
  const f0 = mtof(midi);
  const x = keyPos(midi, 30, 100);
  const t60 = opts.t60 ? opts.t60(x) : lerp(6.5, 1.3, x);
  const P = sr / f0;
  const target = P - 0.5; // the two-point average adds half a sample
  const L = Math.max(2, Math.floor(target - 0.2));
  const frac = target - L;
  const a = (1 - frac) / (1 + frac);
  const g = Math.pow(0.001, 1 / (f0 * t60));
  const line = new Float32Array(L);
  // soft pluck: smoothed noise, then a pluck-position comb
  for (let i = 0; i < L; i++) line[i] = rand() * 2 - 1;
  const passes = opts.passes ?? Math.round(lerp(4, 1, x));
  for (let p = 0; p < passes; p++) {
    let prev = line[L - 1];
    for (let i = 0; i < L; i++) {
      const v = line[i];
      line[i] = 0.5 * (v + prev);
      prev = v;
    }
  }
  const pos = Math.max(1, Math.round(L * (opts.pluck ?? 0.27)));
  const tmp = line.slice();
  let mean = 0;
  for (let i = 0; i < L; i++) {
    line[i] = tmp[i] - tmp[(i - pos + L) % L];
    mean += line[i];
  }
  mean /= L;
  for (let i = 0; i < L; i++) line[i] -= mean;
  let idx = 0;
  let prev = 0;
  let apx = 0;
  let apy = 0;
  const N = out.length;
  const chunk = 16384;
  for (let s = 0; s < N; s += chunk) {
    const e = Math.min(N, s + chunk);
    for (let i = s; i < e; i++) {
      const v = line[idx];
      const avg = 0.5 * (v + prev) * g;
      prev = v;
      const y = a * avg + apx - a * apy;
      apx = avg;
      apy = y;
      line[idx] = y;
      out[i] = y;
      if (++idx >= L) idx = 0;
    }
    yield;
  }
  lowpass(out, sr, opts.lp ? opts.lp(x) : lerp(3400, 8500, x));
  yield;
  if (opts.body) biquad(out, sr, 'peaking', opts.body, 1.2, 4);
  attackRamp(out, sr, 0.0015);
  fadeTail(out, sr, 0.25);
  normalize(out, 0.9);
}

/** Pizzicato string section: three detuned, short Karplus-Strong strings with a body. */
export function* pizz(out, sr, midi, rand) {
  const tmp = new Float32Array(out.length);
  const x = keyPos(midi, 28, 90);
  for (let s = 0; s < 3; s++) {
    tmp.fill(0);
    const det = (s - 1) * 6 + (rand() - 0.5) * 3;
    yield* harp(tmp, sr, midi + det / 100, rand, {
      t60: () => lerp(1.1, 0.42, x),
      passes: 2,
      pluck: 0.18,
      lp: () => lerp(1800, 4200, x),
    });
    const off = Math.floor((s * 0.004 + rand() * 0.003) * sr);
    for (let i = off; i < out.length; i++) out[i] += tmp[i - off] * 0.33;
  }
  biquad(out, sr, 'peaking', 260, 1.4, 5);
  biquad(out, sr, 'peaking', 1100, 2, -3);
  fadeTail(out, sr, 0.15);
  normalize(out, 0.9);
}

/** Celesta: struck steel plates over wooden resonators: sweet fundamental, quick sparkle. */
export function* celesta(out, sr, midi, rand) {
  const f0 = mtof(midi);
  const x = keyPos(midi, 55, 110);
  const P = [[1, 1, 2.6], [2, 0.13, 1.2], [2.76, 0.22, 0.38], [5.4, 0.09, 0.16], [8.93, 0.035, 0.08]];
  for (const [r, a, t] of P) {
    addPartial(out, sr, f0 * r, a, t * lerp(1.25, 0.6, x), rand() * TAU);
    yield;
  }
  const n = Math.floor(sr * 0.006);
  for (let i = 0; i < n && i < out.length; i++) out[i] += (rand() * 2 - 1) * 0.03 * (1 - i / n);
  lowpass(out, sr, 9000);
  attackRamp(out, sr, 0.0012);
  fadeTail(out, sr, 0.3);
  normalize(out, 0.9);
}

/** Soft glass/tubular bell: nearly harmonic modes with slight stretch and a beating prime. */
export function* bell(out, sr, midi, rand) {
  const f0 = mtof(midi);
  const x = keyPos(midi, 50, 105);
  const T = lerp(6.5, 3.0, x);
  const P = [
    [0.5, 0.06, 1.0], [1, 0.62, 1.0], [1.0021, 0.4, 0.85], [2.008, 0.42, 0.6], [2.52, 0.16, 0.42],
    [3.013, 0.18, 0.33], [4.07, 0.11, 0.2], [5.43, 0.06, 0.11], [6.8, 0.03, 0.07],
  ];
  for (const [r, a, t] of P) {
    addPartial(out, sr, f0 * r, a, T * t, rand() * TAU);
    yield;
  }
  const n = Math.floor(sr * 0.01);
  let lp = 0;
  for (let i = 0; i < n && i < out.length; i++) {
    lp += 0.3 * (rand() * 2 - 1 - lp);
    out[i] += lp * 0.06 * (1 - i / n);
  }
  lowpass(out, sr, 8500);
  attackRamp(out, sr, 0.0015);
  fadeTail(out, sr, 0.5);
  normalize(out, 0.9);
}

/** Marimba: tuned wooden bar (modes 1 : 3.93 : 9.2) with a soft yarn mallet. */
export function* marimba(out, sr, midi, rand) {
  const f0 = mtof(midi);
  const x = keyPos(midi, 40, 100);
  const T = lerp(1.5, 0.55, x);
  addPartial(out, sr, f0, 1, T, 0);
  yield;
  addPartial(out, sr, f0 * 3.93, 0.32, T * 0.28, rand() * TAU);
  addPartial(out, sr, f0 * 9.2, 0.06, T * 0.09, rand() * TAU);
  addPartial(out, sr, f0 * 2, 0.04, T * 0.5, rand() * TAU);
  yield;
  const n = Math.floor(sr * 0.008);
  for (let i = 0; i < n && i < out.length; i++) out[i] += (rand() * 2 - 1) * 0.04 * (1 - i / n);
  lowpass(out, sr, 6000);
  attackRamp(out, sr, 0.004);
  fadeTail(out, sr, 0.12);
  normalize(out, 0.9);
}

/** Short bowed strings (spiccato/marcato) for ostinati: additive ensemble with a body. */
export function* stac(out, sr, midi, rand) {
  const f0 = mtof(midi);
  const fmax = Math.min(sr * 0.45, 6500);
  const body = (f) => (1 + 0.8 * Math.exp(-Math.pow(Math.log2(f / 290) / 0.5, 2)) + 0.45 * Math.exp(-Math.pow(Math.log2(f / 2600) / 0.6, 2))) / (1 + Math.pow(f / 4200, 2));
  for (let v = 0; v < 3; v++) {
    const det = (v - 1) * 9 + (rand() - 0.5) * 4;
    const fv = f0 * Math.pow(2, det / 1200);
    const off = Math.floor(rand() * 0.007 * sr);
    for (let n = 1; n <= 48; n++) {
      const fn = fv * n;
      if (fn > fmax) break;
      addPartial(out, sr, fn, (body(fn) / n) / 3, 0, rand() * TAU, off);
      if (n % 6 === 0) yield;
    }
    yield;
  }
  const len = out.length;
  const att = 0.028;
  const hold = 0.13;
  const rel = 0.11;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    let e;
    if (t < att) e = Math.sin((t / att) * Math.PI * 0.5);
    else if (t < att + hold) e = 1 - 0.35 * ((t - att) / hold);
    else e = 0.65 * Math.exp(-(t - att - hold) / rel);
    out[i] *= e;
  }
  // bow scrape at the attack
  const n = Math.floor(sr * 0.035);
  const nb = new Float32Array(n);
  for (let i = 0; i < n; i++) nb[i] = (rand() * 2 - 1) * Math.sin((Math.PI * i) / n);
  biquad(nb, sr, 'bandpass', 2800, 0.8);
  for (let i = 0; i < n && i < len; i++) out[i] += nb[i] * 0.12;
  fadeTail(out, sr, 0.05);
  normalize(out, 0.9);
}

// ---- percussion -----------------------------------------------------------------------

/** Taiko-like big drum: a pitched membrane with a pitch drop plus a soft skin slap. */
export function* taiko(out, sr, rand, f0 = 120, f1 = 56) {
  let ph = 0;
  let ph2 = 0;
  let lp = 0;
  for (let s = 0; s < out.length; s += 32768) {
    const e = Math.min(out.length, s + 32768);
    for (let i = s; i < e; i++) {
      const t = i / sr;
      const f = f1 + (f0 - f1) * Math.exp(-t / 0.045);
      ph += (TAU * f) / sr;
      ph2 += (TAU * f * 2.32) / sr;
      const env = Math.exp(-t / 0.42) * (1 - Math.exp(-t / 0.0015));
      lp += 0.2 * (rand() * 2 - 1 - lp);
      out[i] = 0.85 * Math.sin(ph) * env + Math.sin(ph2) * 0.34 * Math.exp(-t / 0.09) + lp * 0.8 * Math.exp(-t / 0.03);
    }
    yield;
  }
  lowpass(out, sr, 2500);
  fadeTail(out, sr, 0.2);
  normalize(out, 0.9);
}

/** Timpani: pitched kettle modes with a small downward settle and a felt mallet thump. */
export function* timpani(out, sr, midi, rand) {
  const f0 = mtof(midi);
  const modes = [[1, 1, 2.6], [1.5, 0.5, 1.8], [1.98, 0.3, 1.3], [2.44, 0.16, 0.9], [2.94, 0.08, 0.6]];
  for (const [r, a, t] of modes) {
    let ph = rand() * TAU;
    const decay = Math.pow(0.001, 1 / (t * sr));
    let amp = a;
    const chunk = 32768;
    for (let s = 0; s < out.length; s += chunk) {
      const e = Math.min(out.length, s + chunk);
      for (let i = s; i < e; i++) {
        const tt = i / sr;
        const f = f0 * r * (1 + 0.012 * Math.exp(-tt / 0.08));
        ph += (TAU * f) / sr;
        out[i] += Math.sin(ph) * amp;
        amp *= decay;
      }
      yield;
    }
  }
  let lp = 0;
  const n = Math.floor(sr * 0.05);
  for (let i = 0; i < n && i < out.length; i++) {
    lp += 0.06 * (rand() * 2 - 1 - lp);
    out[i] += lp * 1.6 * Math.exp(-i / (sr * 0.012));
  }
  lowpass(out, sr, 3000);
  attackRamp(out, sr, 0.002);
  fadeTail(out, sr, 0.3);
  normalize(out, 0.9);
}

/**
 * One heartbeat thump ("lub"); "dub" is the same sample played higher and softer. Besides
 * the deep body it carries a 110 Hz knock and a muffled click so small speakers hear it too.
 */
export function* heart(out, sr, rand = Math.random) {
  let ph = 0;
  let ph2 = 0;
  let lp = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const f = 40 + 30 * Math.exp(-t / 0.03);
    ph += (TAU * f) / sr;
    ph2 += (TAU * (110 + 40 * Math.exp(-t / 0.02))) / sr;
    const env = Math.exp(-t / 0.075) * (1 - Math.exp(-t / 0.004));
    lp += 0.09 * (rand() * 2 - 1 - lp);
    out[i] = 0.75 * Math.sin(ph) * env + Math.sin(ph2) * 0.6 * Math.exp(-t / 0.04) * (1 - Math.exp(-t / 0.003)) + lp * 0.6 * Math.exp(-t / 0.012);
  }
  yield;
  lowpass(out, sr, 1400);
  normalize(out, 0.9);
}

/** Suspended-cymbal roll swell: rising soft noise with a metallic sheen, gentle highs. */
export function* cymbalSwell(out, sr, rand) {
  const len = out.length;
  for (let i = 0; i < len; i++) out[i] = rand() * 2 - 1;
  yield;
  biquad(out, sr, 'bandpass', 4200, 0.6);
  yield;
  biquad(out, sr, 'peaking', 7500, 1, -6);
  yield;
  for (let i = 0; i < len; i++) {
    const t = i / len;
    out[i] *= Math.pow(t, 2.4) * (t > 0.94 ? (1 - t) / 0.06 : 1);
  }
  normalize(out, 0.9);
}

/** Soft crash: a dark, wide cymbal with shimmer partials (no harsh top). */
export function* crash(out, sr, rand) {
  const len = out.length;
  for (let i = 0; i < len; i++) out[i] = (rand() * 2 - 1) * Math.exp(-i / (sr * 0.9));
  yield;
  biquad(out, sr, 'highpass', 350, 0.7);
  lowpass(out, sr, 6500);
  for (let k = 0; k < 18; k++) {
    addPartial(out, sr, 420 + rand() * 3200, 0.05 + rand() * 0.04, 0.6 + rand() * 1.6, rand() * TAU);
    if (k % 3 === 2) yield;
  }
  yield;
  attackRamp(out, sr, 0.002);
  fadeTail(out, sr, 0.4);
  normalize(out, 0.9);
}

// ---- noise, rain and space ------------------------------------------------------------

/** Seamlessly looping noise: 'white' | 'pink' | 'brown'. */
export function* noise(out, sr, type, rand) {
  const len = out.length;
  const m = Math.floor(Math.min(len / 4, sr * 0.15));
  // the generator runs on past the end into `tail`, which is crossfaded into the head
  const tail = new Float32Array(m);
  const n = len + m;
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, y = 0;
  for (let s = 0; s < n; s += 32768) {
    const e = Math.min(n, s + 32768);
    for (let i = s; i < e; i++) {
      const w = rand() * 2 - 1;
      let v;
      if (type === 'white') v = w;
      else if (type === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        v = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
        b6 = w * 0.115926;
      } else {
        y = (y + 0.02 * w) / 1.02;
        v = y;
      }
      if (i < len) out[i] = v;
      else tail[i - len] = v;
    }
    yield;
  }
  let mean = 0;
  for (let i = 0; i < len; i++) mean += out[i];
  for (let i = 0; i < m; i++) mean += tail[i];
  mean /= n;
  for (let i = 0; i < len; i++) out[i] -= mean;
  // seamless loop of period len: the head is crossfaded with the overhang past the end
  for (let i = 0; i < m; i++) {
    const a = i / m;
    out[i] = out[i] * Math.sqrt(a) + (tail[i] - mean) * Math.sqrt(1 - a);
  }
  yield;
  normalize(out, 0.7);
}

/** Rain bed: a soft hiss plus individual drops, looping seamlessly. */
export function* rain(L, R, sr, rand) {
  const len = L.length;
  for (const ch of [L, R]) {
    // hiss
    let b0 = 0, b1 = 0, b2 = 0;
    for (let s = 0; s < len; s += 32768) {
      const e = Math.min(len, s + 32768);
      for (let i = s; i < e; i++) {
        const w = rand() * 2 - 1;
        b0 = 0.99 * b0 + w * 0.08;
        b1 = 0.95 * b1 + w * 0.2;
        b2 = 0.6 * b2 + w * 0.4;
        ch[i] = (b0 + b1 + b2 + w * 0.3) * 0.12;
      }
      yield;
    }
    highpass(ch, sr, 700);
    yield;
    // drops: tiny decaying "plinks", wrapped around the loop
    const count = Math.floor((len / sr) * 150);
    for (let k = 0; k < count; k++) {
      const start = Math.floor(rand() * len);
      const big = rand() < 0.07;
      const f = big ? 1200 + rand() * 1400 : 2600 + rand() * 3800;
      const tau = (big ? 0.012 : 0.003) + rand() * 0.004;
      let amp = (big ? 0.35 : 0.12) * Math.pow(rand(), 1.5);
      const n = Math.floor(tau * sr * 6);
      const dec = Math.exp(-1 / (tau * sr));
      const w0 = (TAU * f) / sr;
      const chirp = (0.25 * w0) / n;
      let ph = rand() * TAU;
      for (let i = 0; i < n; i++) {
        ph += w0 + chirp * i;
        ch[(start + i) % len] += Math.sin(ph) * amp;
        amp *= dec;
      }
      if ((k & 31) === 31) yield;
    }
    yield;
    lowpass(ch, sr, 9000);
    yield;
    normalize(ch, 0.7);
  }
}

/**
 * Stereo hall/sky impulse response: early reflections, then a diffuse exponential tail
 * whose lowpass closes over time (the tail darkens as it decays).
 */
export function* reverbIR(L, R, sr, seconds, rand) {
  const len = L.length;
  const pre = Math.floor(0.016 * sr);
  const T60 = seconds * 0.92;
  let ch = 0;
  for (const buf of [L, R]) {
    let lp = 0;
    let lp2 = 0;
    const chunk = 12000;
    for (let s = 0; s < len; s += chunk) {
      const e = Math.min(len, s + chunk);
      for (let i = s; i < e; i++) {
        if (i < pre) {
          buf[i] = 0;
          continue;
        }
        const t = (i - pre) / sr;
        const env = Math.exp((-6.9 * t) / T60) * (1 - Math.exp(-t / 0.03));
        const fc = 650 + 7800 * Math.exp(-t / 0.75);
        const k = 1 - Math.exp((-TAU * fc) / sr);
        lp += k * (rand() * 2 - 1 - lp);
        lp2 += k * (lp - lp2);
        buf[i] = lp2 * env;
      }
      yield;
    }
    // early reflections
    for (let k = 0; k < 14; k++) {
      const t = 0.008 + rand() * 0.085 + ch * 0.003;
      const i = pre + Math.floor(t * sr);
      if (i < len) buf[i] += (rand() < 0.5 ? -1 : 1) * 0.5 * Math.exp(-t / 0.06) * (0.4 + rand() * 0.6);
    }
    highpass(buf, sr, 110);
    ch++;
  }
  // the very start fades in a little (no "pop" from the first reflection)
  attackRamp(L, sr, 0.004);
  attackRamp(R, sr, 0.004);
  fadeTail(L, sr, 0.4);
  fadeTail(R, sr, 0.4);
  // energy normalisation: broadband input returns at about -9 dB
  let E = 0;
  for (let i = 0; i < len; i++) E += L[i] * L[i] + R[i] * R[i];
  E /= 2;
  const g = E > 0 ? 0.35 / Math.sqrt(E) : 0;
  for (let i = 0; i < len; i++) {
    L[i] *= g;
    R[i] *= g;
  }
}
