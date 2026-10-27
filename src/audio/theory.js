// Music theory for the adaptive score: scales, a small chord parser, voice leading,
// snapping helpers (so whale voices land inside the harmony), and the SKYSONG leitmotif.
import { mod } from './util.js';

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  majPent: [0, 2, 4, 7, 9],
};

const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// Intervals above the root. The first entries are the "core" tones used when voicing
// with few voices; colour tones come last.
const QUALITY = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  5: [0, 7],
  6: [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  9: [0, 4, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  m9: [0, 3, 7, 10, 14],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  '7sus4': [0, 5, 7, 10],
  dim: [0, 3, 6],
  m7b5: [0, 3, 6, 10],
  aug: [0, 4, 8],
  'maj7#11': [0, 4, 7, 11, 18],
  // tension sets for danger music
  cl: [0, 1, 7], // root, minor second, fifth: a dark cluster
  cl4: [0, 6, 7], // tritone rub
  cl2: [0, 1, 5, 8],
};

function parsePc(s) {
  const m = /^([A-G])([#b]?)(.*)$/.exec(s || '');
  if (!m) return { pc: 2, rest: '' };
  let pc = LETTER[m[1]];
  if (m[2] === '#') pc += 1;
  if (m[2] === 'b') pc -= 1;
  return { pc: mod(pc, 12), rest: m[3] };
}

const chordCache = new Map();

/** 'F#m7/C#' -> { name, root, iv, pcs, tones, bass } (pcs are pitch classes, tones keep order). */
export function parseChord(name) {
  let c = chordCache.get(name);
  if (c) return c;
  const [main, slash] = String(name).split('/');
  const r = parsePc(main);
  const iv = QUALITY[r.rest] || QUALITY[''];
  const tones = [];
  for (const i of iv) {
    const pc = mod(r.pc + i, 12);
    if (!tones.includes(pc)) tones.push(pc);
  }
  c = {
    name,
    root: r.pc,
    iv,
    tones,
    pcs: new Set(tones),
    bass: slash ? parsePc(slash).pc : r.pc,
  };
  chordCache.set(name, c);
  return c;
}

/**
 * Parse one bar: 'D' or 'Asus4:2 A:2' (chord:beats). Without beats the bar is split evenly.
 * Returns [{ ch, start, len }] in beats.
 */
export function parseBar(spec, beats = 4) {
  const parts = String(spec).trim().split(/\s+/);
  const out = [];
  let explicit = 0;
  let unspecified = 0;
  for (const p of parts) {
    const [n, b] = p.split(':');
    if (b) explicit += +b;
    else unspecified++;
  }
  const each = unspecified ? Math.max(0, beats - explicit) / unspecified : 0;
  let t = 0;
  for (const p of parts) {
    const [n, b] = p.split(':');
    const len = b ? +b : each;
    out.push({ ch: parseChord(n), start: t, len });
    t += len;
  }
  return out;
}

/** Nearest midi note >= lo with pitch class pc. */
export function noteAbove(pc, lo) {
  let m = Math.ceil(lo);
  while (mod(m, 12) !== pc) m++;
  return m;
}

/** The chord's bass note inside [lo, hi] (closest to the middle). */
export function bassNote(ch, lo = 36, hi = 50) {
  let m = noteAbove(ch.bass, lo);
  if (m > hi) m -= 12;
  return m;
}

/** All chord tones within [lo, hi], ascending. */
export function chordTones(ch, lo, hi, out = []) {
  out.length = 0;
  for (let m = Math.ceil(lo); m <= hi; m++) if (ch.pcs.has(mod(m, 12))) out.push(m);
  return out;
}

/** All scale tones within [lo, hi], ascending. */
export function scaleTones(root, scale, lo, hi, out = []) {
  out.length = 0;
  for (let m = Math.ceil(lo); m <= hi; m++) if (scale.includes(mod(m - root, 12))) out.push(m);
  return out;
}

/**
 * Voice-led chord: n notes inside [lo, hi] in close position (optionally "drop 2" for an
 * open string sound), chosen to move as little as possible from the previous voicing.
 */
export function voiceChord(ch, n, lo, hi, prev, open = false) {
  let pcs = ch.tones;
  if (n < pcs.length) {
    // drop the fifth first, then upper colour tones
    const fifth = mod(ch.root + 7, 12);
    pcs = pcs.filter((p) => p !== fifth || pcs.length - 1 < n);
    if (pcs.length > n) pcs = pcs.slice(0, n);
  }
  const k = pcs.length;
  const cands = [];
  for (let inv = 0; inv < k; inv++) {
    const first = noteAbove(pcs[inv], lo);
    for (let oct = 0; oct < 3; oct++) {
      const v = [first + oct * 12];
      let j = 1;
      while (v.length < n) {
        const pc = pcs[(inv + j) % k];
        j++;
        let nx = v[v.length - 1] + 1;
        while (mod(nx, 12) !== pc) nx++;
        v.push(nx);
      }
      if (open && n >= 4) {
        const d = v.splice(n - 2, 1)[0] - 12; // drop the second-highest voice an octave
        v.unshift(d);
      }
      if (v[0] >= lo - (open ? 12 : 0) && v[v.length - 1] <= hi) cands.push(v);
    }
  }
  if (!cands.length) {
    const v = [];
    let m = noteAbove(pcs[0], lo);
    for (let i = 0; i < n; i++) {
      v.push(m);
      const pc = pcs[(i + 1) % k];
      m++;
      while (mod(m, 12) !== pc) m++;
    }
    return v;
  }
  let best = cands[0];
  let bs = Infinity;
  const center = (lo + hi) / 2;
  for (const c of cands) {
    let s = 0;
    if (prev && prev.length === c.length) for (let i = 0; i < c.length; i++) s += Math.abs(c[i] - prev[i]);
    else s = Math.abs((c[0] + c[c.length - 1]) / 2 - center) * 1.5;
    if (s < bs) {
      bs = s;
      best = c;
    }
  }
  return best;
}

/** Nearest scale tone to a (possibly fractional) midi note. Ties go down. */
export function snapToScale(m, root, scale) {
  if (!Number.isFinite(m)) return root;
  const r = Math.round(m);
  if (!scale || !scale.length) return r;
  let best = r;
  let bd = Infinity;
  for (let d = -6; d <= 6; d++) {
    const c = r + d;
    if (!scale.includes(mod(c - root, 12))) continue;
    const dist = Math.abs(c - m) + (c > m ? 1e-3 : 0);
    if (dist < bd) {
      bd = dist;
      best = c;
    }
  }
  return best;
}

/** Nearest chord tone to m (pcs: Set or array of pitch classes). */
export function snapToChord(m, pcs) {
  if (!Number.isFinite(m)) return 60;
  const has = pcs instanceof Set ? (p) => pcs.has(p) : (p) => pcs.includes(p);
  const r = Math.round(m);
  let best = r;
  let bd = Infinity;
  for (let d = -7; d <= 7; d++) {
    const c = r + d;
    if (!has(mod(c, 12))) continue;
    const dist = Math.abs(c - m) + (c > m ? 1e-3 : 0);
    if (dist < bd) {
      bd = dist;
      best = c;
    }
  }
  return best;
}

/** k-th chord tone above (k > 0) or below (k < 0) m. */
export function stepChord(m, pcs, k) {
  const has = pcs instanceof Set ? (p) => pcs.has(p) : (p) => pcs.includes(p);
  let c = Math.round(m);
  const dir = Math.sign(k);
  let left = Math.abs(k);
  let guard = 0;
  while (left > 0 && guard++ < 48) {
    c += dir;
    if (has(mod(c, 12))) left--;
  }
  return c;
}

/** k-th scale tone above/below m. */
export function stepScale(m, root, scale, k) {
  let c = snapToScale(m, root, scale);
  const dir = Math.sign(k);
  let left = Math.abs(k);
  let guard = 0;
  while (left > 0 && guard++ < 48) {
    c += dir;
    if (scale.includes(mod(c - root, 12))) left--;
  }
  return c;
}

// ---- The SKYSONG leitmotif (D major, 4/4, ~66 BPM) -----------------------------------
// One entry per bar: [midi, beats]. F#4 = 66, A4 = 69, D5 = 74, C#5 = 73, B4 = 71, E4 = 64,
// G4 = 67, E5 = 76.
export const THEME = [
  [[66, 2], [69, 1], [74, 1]],
  [[73, 3], [71, 1]],
  [[69, 2], [66, 1], [64, 1]],
  [[66, 4]],
  [[67, 2], [71, 1], [76, 1]],
  [[74, 3], [73, 1]],
  [[71, 2], [69, 1], [67, 1]],
  [[69, 4]],
];
export const THEME_CHORDS = ['D', 'A/C#', 'Bm', 'F#m', 'G', 'D/F#', 'Em7', 'Asus4:2 A:2'];

// The ending: the last phrase turns toward home (leading tone C#5 -> D5) and rests on D.
export const CADENCE_MELODY = [
  [[67, 2], [71, 1], [76, 1]],
  [[74, 3], [73, 1]],
  [[71, 2], [69, 1], [67, 1]],
  [[69, 2], [73, 2]],
  [[74, 4]],
  [[74, 4]],
];
export const CADENCE_CHORDS = ['G', 'D/F#', 'Em7', 'Asus4:2 A:2', 'D', 'D'];
