// Generative patterns. Each pattern turns one bar of harmony into events:
//   { at (beats from bar start), kind: 'hit' | 'chord' | 'line' | 'swell', inst | target,
//     midi | notes, vel, dur (beats) }
// `c` is the bar context built by the Conductor (chords, melody, key, energy, rng...),
// `L` the layer spec from moods.js, `mem` per-layer memory that persists across bars.
import {
  chordTones, scaleTones, voiceChord, bassNote, snapToScale, snapToChord, stepScale, noteAbove,
} from './theory.js';
import { clamp, lerp, mod, pick } from './util.js';

const tmp = [];
const tmp2 = [];
const human = (r, amt = 0.012) => (r() - 0.5) * amt;
const dens = (L, e) => (L.dens ? lerp(L.dens[0], L.dens[1], e) : 1);

function emit(L, at, midi, vel, dur) {
  if (L.target) return { at, kind: 'line', target: L.target, midi, vel, dur };
  return { at, kind: 'hit', inst: L.inst, midi, vel, dur };
}

/** Optional ornaments on a melody bar (piano variations). */
function vary(bar, c, L) {
  if (!L.vary || c.rng() > L.vary) return bar;
  const out = [];
  const kind = Math.floor(c.rng() * 3);
  for (let i = 0; i < bar.length; i++) {
    const [m, d] = bar[i];
    const next = bar[i + 1];
    if (kind === 0 && next && d >= 1 && Math.abs(next[0] - m) >= 3 && Math.abs(next[0] - m) <= 4) {
      // passing tone
      const pass = stepScale(m, c.key.root, c.key.scale, Math.sign(next[0] - m));
      out.push([m, d - 0.5], [pass, 0.5]);
    } else if (kind === 1 && d >= 3) {
      // a gentle turn on a long note
      const up = stepScale(m, c.key.root, c.key.scale, 1);
      out.push([m, d - 1], [up, 0.5], [m, 0.5]);
    } else if (kind === 2 && d >= 2) {
      // answer the long note an octave up, softly
      out.push([m, d - 1], [m + 12, 1, 0.55]);
    } else out.push(bar[i]);
  }
  return out;
}

export const PATTERNS = {
  /** Sustained voicing for a Section (strings, choir, brass), optional bass voice. */
  pad(c, L, mem) {
    const out = [];
    const vowel = typeof L.vowel === 'function' ? L.vowel(c.energy) : L.vowel;
    for (const k of c.chords) {
      const v = voiceChord(k.ch, L.n || 4, L.lo ?? 55, L.hi ?? 76, mem.prev, L.open);
      mem.prev = v;
      const notes = L.bass ? [bassNote(k.ch, L.bass[0], L.bass[1]), ...v] : v.slice();
      out.push({ at: k.start, kind: 'chord', target: L.target, notes, vowel });
    }
    return out;
  },

  /** Low strings: the chord's bass note with an octave (or a fifth) above. */
  bass(c, L) {
    const out = [];
    for (const k of c.chords) {
      const b = bassNote(k.ch, L.lo ?? 36, L.hi ?? 49);
      const notes = L.fifth ? [b, b + 7] : L.single ? [b] : [b, b + 12];
      out.push({ at: k.start, kind: 'chord', target: L.target, notes });
    }
    return out;
  },

  /** Tonic (or given pitch-class) pedal; re-sent only when it changes. */
  drone(c, L, mem) {
    const pc = L.pc ?? mod(c.key.root, 12);
    const root = noteAbove(pc, L.lo ?? 38);
    const notes = (L.notes || [0, 7, 12]).map((x) => root + x);
    const sig = notes.join(',');
    if (mem.sig === sig) return [];
    mem.sig = sig;
    return [{ at: 0, kind: 'chord', target: L.target, notes }];
  },

  /** The section's written melody (the leitmotif), optionally varied or thinned. */
  melody(c, L) {
    if (!c.melody) return [];
    const out = [];
    const octs = L.octs || [L.oct || 0];
    const oct = 12 * octs[c.secCount % octs.length];
    const bar = vary(c.melody, c, L);
    let at = 0;
    for (let i = 0; i < bar.length; i++) {
      const [m, d, accent = 1] = bar[i];
      if (m != null && (L.prob == null || c.rng() < L.prob || (i === 0 && L.keepFirst))) {
        const vel = (L.vel ?? 0.6) * accent * (at === 0 ? 1 : 0.9) * (1 + (c.rng() - 0.5) * 0.12);
        out.push(emit(L, at + (L.human ? human(c.rng, L.human) : 0), m + oct, vel, d * (L.legato ?? 0.96)));
        if (L.double) out.push(emit({ inst: L.inst }, at, m + oct + L.double, vel * 0.5, d * 0.9));
      }
      at += d;
    }
    return out;
  },

  /** Arpeggio over the current chord (harp, celesta, piano). */
  arp(c, L, mem) {
    const out = [];
    const rate = L.rate || 2;
    const steps = Math.round(c.beats * rate);
    const p = (L.prob ?? 1) * dens(L, c.energy);
    mem.i = mem.i || 0;
    for (let s = 0; s < steps; s++) {
      const at = s / rate;
      const tones = chordTones(c.chordAt(at), L.lo ?? 50, L.hi ?? 84, tmp);
      const n = tones.length;
      if (!n) continue;
      const i = mem.i++;
      let idx;
      switch (L.shape) {
        case 'down': idx = n - 1 - (i % n); break;
        case 'updown': {
          const per = Math.max(1, 2 * n - 2);
          const k = i % per;
          idx = k < n ? k : per - k;
          break;
        }
        case 'random': idx = Math.floor(c.rng() * n); break;
        case 'broken': idx = [0, 2, 1, 3, 2, 4, 3, 5][i % 8] % n; break;
        default: idx = i % n;
      }
      if (c.rng() > p) continue;
      const accent = s % rate === 0 ? 1 : 0.8;
      out.push({ at: at + human(c.rng, 0.01), kind: 'hit', inst: L.inst, midi: tones[idx], vel: (L.vel ?? 0.5) * accent * (0.88 + c.rng() * 0.24), dur: L.dur });
    }
    return out;
  },

  /** Random chord (or scale) tones high up: stars, krill glitter. */
  sparkle(c, L) {
    const out = [];
    const rate = L.rate || 2;
    const steps = Math.round(c.beats * rate);
    const p = (L.prob ?? 0.15) * dens(L, c.energy);
    for (let s = 0; s < steps; s++) {
      if (c.rng() > p) continue;
      const at = s / rate;
      const pool = L.scale
        ? scaleTones(c.key.root, c.key.scale, L.lo ?? 76, L.hi ?? 96, tmp)
        : chordTones(c.chordAt(at), L.lo ?? 76, L.hi ?? 96, tmp);
      if (!pool.length) continue;
      out.push({ at: at + human(c.rng, 0.03), kind: 'hit', inst: L.inst, midi: pick(c.rng, pool), vel: (L.vel ?? 0.3) * (0.55 + c.rng() * 0.5) });
    }
    return out;
  },

  /** Piano accompaniment: bass on the chord change, then a flowing broken chord in 8ths. */
  comp(c, L) {
    const out = [];
    const v = L.vel ?? 0.4;
    const p = (L.prob ?? 1) * dens(L, c.energy);
    for (const k of c.chords) {
      const b = bassNote(k.ch, L.bassLo ?? 38, L.bassHi ?? 50);
      out.push({ at: k.start + human(c.rng, 0.01), kind: 'hit', inst: L.inst, midi: b, vel: v, dur: k.len * 0.98 });
      if (L.octave) out.push({ at: k.start, kind: 'hit', inst: L.inst, midi: b + 12, vel: v * 0.55, dur: k.len * 0.98 });
      const tones = chordTones(k.ch, L.lo ?? 54, L.hi ?? 69, tmp2);
      if (!tones.length) continue;
      if (L.style === 'block') {
        for (let s = 1; s < k.len; s += 2) {
          for (const m of tones.slice(-3)) out.push({ at: k.start + s + human(c.rng, 0.01), kind: 'hit', inst: L.inst, midi: m, vel: v * 0.42, dur: 0.9 });
        }
        continue;
      }
      const seq = [0, 1, 2, 1, 3, 2, 1, 2];
      const steps = Math.round(k.len * 2);
      for (let s = 1; s < steps; s++) {
        if (c.rng() > p) continue;
        const m = tones[Math.min(tones.length - 1, seq[s % 8])];
        out.push({ at: k.start + s * 0.5 + human(c.rng, 0.014), kind: 'hit', inst: L.inst, midi: m, vel: v * (s % 2 ? 0.48 : 0.6) * (0.9 + c.rng() * 0.2), dur: 1.2 });
      }
    }
    return out;
  },

  /** Quarter-note pulse (bass on 1, chord tones after) so the beat can be felt. */
  pulse(c, L) {
    const out = [];
    for (let b = 0; b < c.beats; b++) {
      const ch = c.chordAt(b);
      let m;
      if (b === 0) m = bassNote(ch, L.lo ?? 50, (L.lo ?? 50) + 11);
      else {
        const tones = chordTones(ch, (L.lo ?? 50) + 5, L.hi ?? 69, tmp);
        m = tones.length ? tones[(b * 2 + c.bar) % tones.length] : null;
      }
      if (m == null) continue;
      out.push({ at: b, kind: 'hit', inst: L.inst, midi: m, vel: (L.vel ?? 0.35) * (b === 0 ? 1 : 0.7) });
    }
    return out;
  },

  /** Bouncy "oom-pah": bass on the beat, a chord tone on the off-beat (krill). */
  bounce(c, L) {
    const out = [];
    for (let b = 0; b < c.beats; b++) {
      const ch = c.chordAt(b);
      const root = bassNote(ch, L.lo ?? 38, (L.lo ?? 38) + 11);
      const bass = b % 2 ? root + 7 : root;
      out.push({ at: b, kind: 'hit', inst: L.inst, midi: bass, vel: (L.vel ?? 0.5) * (b === 0 ? 1 : 0.8) });
      const tones = chordTones(ch, L.mid?.[0] ?? 62, L.mid?.[1] ?? 76, tmp);
      if (tones.length && c.rng() < (L.prob ?? 0.85) * dens(L, c.energy)) {
        out.push({ at: b + 0.5 + human(c.rng, 0.01), kind: 'hit', inst: L.inst, midi: pick(c.rng, tones), vel: (L.vel ?? 0.5) * 0.6 });
      }
    }
    return out;
  },

  /** Rhythmic chord-tone pattern from a step string ('x' hit, '.' rest), random-walk pitch. */
  rhythm(c, L, mem) {
    const out = [];
    const pat = L.pat || 'x.x..x.x';
    const steps = pat.length;
    const per = c.beats / steps;
    for (let s = 0; s < steps; s++) {
      const ch = pat[s];
      if (ch === '.') continue;
      if (c.rng() > (L.prob ?? 1) * dens(L, c.energy)) continue;
      const at = s * per;
      const tones = chordTones(c.chordAt(at), L.lo ?? 59, L.hi ?? 79, tmp);
      if (!tones.length) continue;
      mem.k = clamp((mem.k ?? Math.floor(tones.length / 2)) + Math.round((c.rng() - 0.5) * 3), 0, tones.length - 1);
      out.push({ at: at + human(c.rng, 0.01), kind: 'hit', inst: L.inst, midi: tones[mem.k], vel: (L.vel ?? 0.4) * (ch === 'X' ? 1 : 0.75) * (0.9 + c.rng() * 0.2) });
    }
    return out;
  },

  /** Driving ostinato on chord degrees (0 root, 1 third, 2 fifth, 3 octave). */
  ostinato(c, L) {
    const out = [];
    const fast = L.fastAt != null && c.energy >= L.fastAt;
    const rate = (L.rate || 2) * (fast ? 2 : 1);
    const cells = L.cells || [0, 0, 2, 0, 3, 0, 2, 1];
    const steps = Math.round(c.beats * rate);
    const acc = L.accent || [0];
    for (let s = 0; s < steps; s++) {
      const d = cells[s % cells.length];
      if (d == null) continue;
      const at = s / rate;
      const ch = c.chordAt(at);
      const root = noteAbove(ch.root, L.lo ?? 38);
      const iv = d >= ch.iv.length ? 12 * Math.floor(d / ch.iv.length) + ch.iv[d % ch.iv.length] : ch.iv[d];
      const accent = acc.includes(s % cells.length) ? 1 : 0.68;
      out.push({ at, kind: 'hit', inst: L.inst, midi: root + iv, vel: (L.vel ?? 0.55) * accent * (0.92 + c.rng() * 0.16), dur: (1 / rate) * 0.9 });
    }
    return out;
  },

  /** Drum patterns from step strings ('X' accent, 'x' hit, 'o' ghost, 'r' roll). */
  drums(c, L) {
    const out = [];
    let pat = L.pat;
    if (L.pats) {
      pat = null;
      for (const p of L.pats) if (c.energy >= (p.at ?? 0)) pat = p.p;
    }
    if (!pat) return out;
    if (Array.isArray(pat)) pat = pat[c.secBar % pat.length];
    const steps = pat.length;
    const per = c.beats / steps;
    for (let s = 0; s < steps; s++) {
      const ch = pat[s];
      if (ch === '.' || ch === ' ') continue;
      const at = s * per;
      const midi = L.pitch === 'root' ? bassNote(c.chordAt(at), L.lo ?? 38, L.hi ?? 49) : L.midi ?? 40;
      if (ch === 'r') {
        for (let k = 0; k < 4; k++) out.push({ at: at + (k * per) / 4, kind: 'hit', inst: L.inst, midi, vel: (L.vel ?? 0.7) * (0.3 + 0.14 * k) });
        continue;
      }
      const v = ch === 'X' ? 1 : ch === 'x' ? 0.7 : ch === 'o' ? 0.38 : 0.55;
      out.push({ at: at + human(c.rng, 0.006), kind: 'hit', inst: L.inst, midi, vel: (L.vel ?? 0.7) * v });
    }
    return out;
  },

  /** Heartbeat: lub-dub every beat when tense, every other beat when calmer. */
  heart(c, L) {
    const out = [];
    const every = c.energy >= (L.fastAt ?? 0.55) ? 1 : 2;
    const dub = 0.29 / c.beatDur;
    for (let b = 0; b < c.beats; b += every) {
      out.push({ at: b, kind: 'hit', inst: L.inst || 'heart', midi: 30, vel: L.vel ?? 0.8 });
      out.push({ at: b + dub, kind: 'hit', inst: L.inst || 'heart', midi: 32, vel: (L.vel ?? 0.8) * 0.62 });
    }
    return out;
  },

  /** Phrase swells: brass crescendo (Section) or a cymbal roll landing on the next phrase. */
  swell(c, L) {
    const every = L.every || 4;
    if (L.inst) {
      // a sample swell timed to peak on the downbeat after this phrase
      if (c.secBar % every !== every - 1) return [];
      const at = Math.max(0, c.beats - (L.peak ?? 2.8) / c.beatDur);
      return [{ at, kind: 'hit', inst: L.inst, midi: 60, vel: L.vel ?? 0.6 }];
    }
    if (c.secBar % every !== (L.phase || 0)) return [];
    return [{ at: 0, kind: 'swell', target: L.target, dur: (L.len ?? every * c.beats * 0.8), vel: L.vel ?? 1 }];
  },

  /** Generative melody: chord tones on strong beats, stepwise between, phrases with rests. */
  gen(c, L, mem) {
    const out = [];
    if (mem.rest > 0) {
      mem.rest--;
      return out;
    }
    const { root, scale } = c.key;
    const lo = L.lo ?? 64;
    const hi = L.hi ?? 81;
    const center = (lo + hi) / 2;
    const cells = L.cells || [[2, 1, 1], [1, 1, 2], [3, 1], [2, 2], [1.5, 0.5, 2], [4]];
    const cell = pick(c.rng, cells);
    let m = mem.last ?? snapToScale(center, root, scale);
    let at = 0;
    for (const d of cell) {
      const strong = at === 0 || at === 2;
      let step = Math.round((c.rng() - 0.5) * 4.4);
      if (m > center + 5) step -= 1;
      if (m < center - 5) step += 1;
      if (step === 0 && c.rng() < 0.6) step = c.rng() < 0.5 ? 1 : -1;
      m = stepScale(m, root, scale, step);
      if (strong) m = snapToChord(m, c.chordAt(at).pcs);
      m = snapToScale(clamp(m, lo, hi), root, scale);
      out.push(emit(L, at + human(c.rng, L.human ?? 0.015), m, (L.vel ?? 0.5) * (strong ? 1 : 0.85), d * (L.legato ?? 0.95)));
      at += d;
    }
    mem.last = m;
    mem.count = (mem.count || 0) + 1;
    if (mem.count >= (L.phrase ?? 2)) {
      mem.count = 0;
      mem.rest = c.rng() < (L.restProb ?? 0.6) ? 1 : 0;
    }
    return out;
  },

  /** A soaring line: long chord tones high up, arching up and down. */
  counter(c, L, mem) {
    const out = [];
    const lo = L.lo ?? 74;
    const hi = L.hi ?? 88;
    mem.dir = mem.dir || 1;
    for (const k of c.chords) {
      const tones = chordTones(k.ch, lo, hi, tmp);
      if (!tones.length) continue;
      let m = mem.last ?? tones[Math.floor(tones.length / 2)];
      let best = null;
      for (const t of tones) {
        if (t === m || Math.sign(t - m) !== mem.dir) continue;
        if (best == null || Math.abs(t - m) < Math.abs(best - m)) best = t;
      }
      if (best == null) {
        mem.dir = -mem.dir;
        for (const t of tones) if (t !== m && (best == null || Math.abs(t - m) < Math.abs(best - m))) best = t;
      }
      if (c.rng() < 0.25) mem.dir = -mem.dir;
      m = best ?? m;
      mem.last = m;
      if (k.len >= 4 && c.rng() < 0.4) {
        // a passing step into the next bar
        const pass = stepScale(m, c.key.root, c.key.scale, mem.dir);
        out.push(emit(L, k.start, m, L.vel ?? 0.6, 2.9));
        out.push(emit(L, k.start + 3, pass, (L.vel ?? 0.6) * 0.85, 0.98));
      } else out.push(emit(L, k.start, m, L.vel ?? 0.6, k.len * 0.98));
    }
    return out;
  },

  /** Bells on phrase downbeats. */
  bells(c, L) {
    const every = L.every || 2;
    if (c.secBar % every !== 0) return [];
    const tones = chordTones(c.chordAt(0), L.lo ?? 74, L.hi ?? 91, tmp);
    if (!tones.length) return [];
    const out = [];
    const m = L.top ? tones[tones.length - 1] : pick(c.rng, tones);
    out.push({ at: 0, kind: 'hit', inst: L.inst || 'bell', midi: m, vel: L.vel ?? 0.4 });
    if (L.pair && c.rng() < 0.65) {
      const other = tones.filter((x) => x !== m);
      if (other.length) out.push({ at: c.rng() < 0.5 ? 1.5 : 2, kind: 'hit', inst: L.inst || 'bell', midi: pick(c.rng, other), vel: (L.vel ?? 0.4) * 0.7 });
    }
    return out;
  },

  /** Harp glissando sweeping up the chord at phrase starts. */
  gliss(c, L) {
    const every = L.every || 4;
    if (c.secBar % every !== 0) return [];
    const tones = chordTones(c.chordAt(0), L.lo ?? 55, L.hi ?? 91, tmp).slice();
    const n = tones.length;
    const span = L.span ?? 1;
    return tones.map((m, i) => ({ at: (L.at ?? 0) + (i / n) * span, kind: 'hit', inst: L.inst || 'harp', midi: m, vel: (L.vel ?? 0.35) * (0.55 + (0.45 * i) / n) }));
  },

  /** Rising shimmer (cloud wall): 16ths climbing a little higher each bar of the phrase. */
  rising(c, L) {
    const out = [];
    const cyc = L.cycle ?? 4;
    const base = (L.lo ?? 67) + (c.secBar % cyc) * (L.climb ?? 3) + Math.round(c.energy * 5);
    const tones = chordTones(c.chordAt(0), base, base + (L.span ?? 16), tmp).slice();
    if (!tones.length) return out;
    const rate = L.rate || 4;
    const steps = Math.round(c.beats * rate);
    const p = (L.prob ?? 0.8) * dens(L, c.energy);
    for (let s = 0; s < steps; s++) {
      if (c.rng() > p) continue;
      const k = s % tones.length;
      out.push({ at: s / rate, kind: 'hit', inst: L.inst, midi: tones[k], vel: (L.vel ?? 0.3) * (0.5 + (0.5 * s) / steps) });
    }
    return out;
  },
};
