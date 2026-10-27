// Shared helpers for the SKYSONG audio system: math, a seeded RNG, cooperative time
// slicing, and AudioParam wrappers that never throw (a bad value is dropped, not fatal).

export const TAU = Math.PI * 2;
export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0 || 1e-9));
  return t * t * (3 - 2 * t);
};
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const ftom = (f) => 69 + 12 * Math.log2(Math.max(1e-6, f) / 440);
export const dbToGain = (db) => Math.pow(10, db / 20);
export const gainToDb = (g) => 20 * Math.log10(Math.max(1e-12, Math.abs(g)));
export const mod = (n, m) => ((n % m) + m) % m;
export const finite = (x, d = 0) => (Number.isFinite(x) ? x : d);

/** Mulberry32: tiny deterministic RNG returning floats in [0, 1). */
export function makeRng(seed = 1) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = (r, arr) => arr[Math.min(arr.length - 1, Math.floor(r() * arr.length))];

// ---- cooperative scheduling -------------------------------------------------------

let channel = null;
const waiting = [];
/** Yield to the event loop without setTimeout's 4 ms clamp (and without background throttling). */
export function yieldNow() {
  return new Promise((resolve) => {
    if (typeof MessageChannel === 'undefined') {
      setTimeout(resolve, 0);
      return;
    }
    if (!channel) {
      channel = new MessageChannel();
      channel.port1.onmessage = () => {
        const f = waiting.shift();
        if (f) f();
      };
    }
    waiting.push(resolve);
    channel.port2.postMessage(0);
  });
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Drive a generator, yielding to the event loop whenever `budgetMs` of work has been done.
 * Every `yield` inside the generator is a safe cut point (keep steps well under the budget).
 * Records the longest uninterrupted slice in `stats.maxSliceMs`.
 */
export async function runSliced(gen, budgetMs = 8, stats = null) {
  let t0 = now();
  let label = '';
  for (;;) {
    const s0 = now();
    const r = gen.next();
    const t1 = now();
    if (typeof r.value === 'string') label = r.value;
    if (stats && t1 - s0 > (stats.maxStepMs || 0)) {
      stats.maxStepMs = t1 - s0;
      stats.maxStepLabel = label;
    }
    const el = t1 - t0;
    if (r.done) {
      if (stats) stats.maxSliceMs = Math.max(stats.maxSliceMs || 0, el);
      return r.value;
    }
    if (el > budgetMs) {
      if (stats) stats.maxSliceMs = Math.max(stats.maxSliceMs || 0, el);
      await yieldNow();
      t0 = now();
    }
  }
}

// ---- AudioParam helpers (never throw) --------------------------------------------

export function setAt(param, v, t) {
  if (!param || !Number.isFinite(v) || !Number.isFinite(t)) return;
  try { param.setValueAtTime(v, Math.max(0, t)); } catch (e) { /* ignore */ }
}

export function glide(param, v, t, tc) {
  if (!param || !Number.isFinite(v) || !Number.isFinite(t)) return;
  try { param.setTargetAtTime(v, Math.max(0, t), Math.max(0.0008, finite(tc, 0.05))); } catch (e) { /* ignore */ }
}

export function rampAt(param, v, t) {
  if (!param || !Number.isFinite(v) || !Number.isFinite(t)) return;
  try { param.linearRampToValueAtTime(v, Math.max(0, t)); } catch (e) { /* ignore */ }
}

export function expAt(param, v, t) {
  if (!param || !Number.isFinite(v) || !Number.isFinite(t)) return;
  try { param.exponentialRampToValueAtTime(Math.max(1e-5, v), Math.max(0, t)); } catch (e) { /* ignore */ }
}

/** Cancel future automation from t and hold the value the param has at t. */
export function holdAt(param, t) {
  if (!param || !Number.isFinite(t)) return;
  try {
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(Math.max(0, t));
    else {
      const v = param.value;
      param.cancelScheduledValues(Math.max(0, t));
      param.setValueAtTime(v, Math.max(0, t));
    }
  } catch (e) { /* ignore */ }
}

export function cancelFrom(param, t) {
  if (!param || !Number.isFinite(t)) return;
  try { param.cancelScheduledValues(Math.max(0, t)); } catch (e) { /* ignore */ }
}

export function disconnect(...nodes) {
  for (const n of nodes) {
    if (!n) continue;
    try { n.disconnect(); } catch (e) { /* ignore */ }
  }
}

export function stopAt(node, t) {
  if (!node) return;
  try { node.stop(Math.max(0, finite(t, 0))); } catch (e) { /* ignore */ }
}

export function startAt(node, t) {
  try { node.start(Math.max(0, finite(t, 0))); } catch (e) { /* ignore */ }
}

/** Equal-power-ish soft clip curve with a hard ceiling. */
export function softClipCurve(n = 4096, knee = 0.6, ceiling = 0.88, inputScale = 2) {
  const c = new Float32Array(n);
  const span = ceiling - knee;
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * inputScale;
    const a = Math.abs(x);
    const y = a < knee ? a : knee + span * Math.tanh((a - knee) / span);
    c[i] = Math.sign(x) * y;
  }
  return c;
}

/** Gentle saturation curve for growls and screeches. */
export function driveCurve(amount = 2, n = 2048) {
  const c = new Float32Array(n);
  const k = Math.tanh(amount);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(amount * x) / k;
  }
  return c;
}
