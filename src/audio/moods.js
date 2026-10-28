// The adaptive score: one small generative arrangement per mood.
//
// A mood has a tempo, a key, named sections (chord bars, optional written melody) played
// in `form` order, and layers. Each layer runs a pattern (patterns.js) on an instrument
// (`inst`: sampler) or a section (`target`: strings | low | trem | choir | brass | drone |
// lead | flute). `on: [a, b]` fades the layer in as intensity goes from a to b, `off`
// fades it out again; `secs` limits a layer to some sections; `melodic` layers stop as
// soon as the mood is left (accompaniment layers fade out over the new mood's harmony).
import { THEME, THEME_CHORDS, CADENCE_MELODY, CADENCE_CHORDS, SCALES } from './theory.js';
import { mod } from './util.js';

const D = 62;
const MAJOR = { root: D, scale: SCALES.major };
const MINOR = { root: D, scale: SCALES.minor };
const E_DORIAN = { root: 64, scale: SCALES.dorian };
const D_PHRYGIAN = { root: D, scale: SCALES.phrygian };

const theme = (extra) => ({ bars: THEME_CHORDS, melody: THEME, ...extra });

// The leitmotif in D minor for the falcon chase climax (F# -> F, C# -> C, B -> Bb).
const MINOR_MAP = { 6: -1, 1: -1, 11: -1 };
const THEME_MINOR = THEME.map((bar, i) => bar.map(([m, d]) => [i === 7 ? m : m + (MINOR_MAP[mod(m, 12)] || 0), d]));
const THEME_MINOR_CHORDS = ['Dm', 'C', 'Bb', 'F', 'Gm', 'Dm/F', 'Em7b5', 'Asus4:2 A:2'];

export const MOODS = {
  title: {
    level: 1.33,
    bpm: 64,
    key: MAJOR,
    sections: {
      intro: { bars: ['Bm7', 'Gmaj7', 'D/F#', 'Asus4:2 A:2'] },
      theme: theme(),
      inter: { bars: ['G', 'D/F#', 'Em7', 'Asus4:2 A:2'] },
    },
    form: ['intro', 'theme', 'inter', 'theme'],
    layers: [
      { p: 'melody', inst: 'piano', vel: 0.62, human: 0.03, vary: 0.25, melodic: true },
      { p: 'gen', inst: 'piano', lo: 66, hi: 81, vel: 0.46, secs: ['intro', 'inter'], phrase: 1, restProb: 0.5, cells: [[3, 1], [2, 2], [2, 1, 1], [4]], melodic: true },
      { p: 'comp', inst: 'piano', lo: 50, hi: 64, vel: 0.36, prob: 0.8 },
      { p: 'pad', target: 'strings', n: 4, lo: 52, hi: 74, gain: 0.3 },
      { p: 'bass', target: 'low', gain: 0.22, on: [0.3, 0.7] },
      { p: 'sparkle', inst: 'celesta', lo: 79, hi: 98, prob: 0.07, vel: 0.46 },
      { p: 'pad', target: 'choir', n: 4, lo: 57, hi: 76, vowel: 'oo', gain: 0.14, on: [0.5, 0.9] },
    ],
  },

  dawn: {
    level: 1.33,
    bpm: 62,
    key: MAJOR,
    sections: {
      a: { bars: ['Dadd9', 'G/D', 'Dadd9', 'Asus4/D:2 A/D:2'] },
      frag: theme(),
      b: { bars: ['Bm7', 'Gmaj7', 'Em7', 'Asus4:2 A:2'] },
    },
    form: ['a', 'frag', 'a', 'b'],
    layers: [
      { p: 'pad', target: 'strings', n: 4, lo: 57, hi: 79, gain: 0.28 },
      { p: 'bass', target: 'low', gain: 0.16, single: true, on: [0.15, 0.5] },
      { p: 'melody', inst: 'piano', vel: 0.5, prob: 0.55, keepFirst: true, human: 0.04, secs: ['frag'], melodic: true },
      { p: 'gen', inst: 'piano', lo: 66, hi: 81, vel: 0.4, secs: ['a', 'b'], phrase: 1, restProb: 0.7, cells: [[3, 1], [2, 2], [4]], melodic: true },
      { p: 'bells', inst: 'bell', every: 2, lo: 74, hi: 93, vel: 0.48, pair: true },
      { p: 'arp', inst: 'harp', rate: 1, shape: 'up', lo: 50, hi: 74, vel: 0.34, on: [0.3, 0.6] },
      { p: 'gen', target: 'flute', lo: 69, hi: 86, vel: 0.55, phrase: 2, melodic: true, on: [0.55, 0.85] },
      { p: 'sparkle', inst: 'celesta', lo: 81, hi: 98, prob: 0.05, vel: 0.3, on: [0.4, 0.8] },
    ],
  },

  flight: {
    level: 1.26,
    bpm: 66,
    key: MAJOR,
    sections: {
      a: { bars: ['D', 'G', 'Bm', 'A'] },
      b: { bars: ['G', 'D/F#', 'Em7', 'Asus4:2 A:2'] },
      theme: theme(),
      c: { bars: ['Bm', 'G', 'D', 'A'] },
    },
    form: ['a', 'b', 'theme', 'c', 'b', 'theme'],
    layers: [
      { p: 'arp', inst: 'harp', rate: 4, shape: 'updown', lo: 50, hi: 81, vel: 0.4, dens: [0.7, 1] },
      { p: 'pad', target: 'strings', n: 4, lo: 54, hi: 76, gain: 0.32 },
      { p: 'bass', target: 'low', gain: 0.22 },
      { p: 'melody', inst: 'piano', vel: 0.56, vary: 0.45, human: 0.02, secs: ['theme'], melodic: true, off: [0.75, 1] },
      { p: 'gen', inst: 'piano', lo: 66, hi: 83, vel: 0.44, secs: ['a', 'b', 'c'], melodic: true, off: [0.65, 0.95] },
      { p: 'melody', target: 'lead', vel: 0.6, secs: ['theme'], melodic: true, on: [0.55, 0.85] },
      { p: 'counter', target: 'lead', lo: 74, hi: 88, vel: 0.55, secs: ['a', 'b', 'c'], melodic: true, on: [0.4, 0.75] },
      { p: 'pad', target: 'choir', n: 4, lo: 57, hi: 79, vowel: 'ah', gain: 0.28, on: [0.6, 0.95] },
      { p: 'bells', inst: 'bell', every: 4, lo: 78, hi: 93, vel: 0.3, on: [0.7, 1] },
      { p: 'swell', inst: 'swell', every: 4, vel: 0.6, on: [0.8, 1] },
    ],
  },

  krill: {
    level: 1.9,
    bpm: 76,
    key: MAJOR,
    sections: {
      a: { bars: ['D', 'G', 'Em7', 'A'] },
      b: { bars: ['Bm', 'G', 'D', 'Asus4:2 A:2'] },
      c: { bars: ['G', 'A', 'F#m', 'Bm', 'G', 'A', 'D', 'D'] },
    },
    form: ['a', 'b', 'a', 'c'],
    layers: [
      { p: 'bounce', inst: 'pizz', lo: 38, mid: [62, 76], vel: 0.72, dens: [0.6, 1] },
      { p: 'arp', inst: 'harp', rate: 2, shape: 'broken', lo: 64, hi: 88, vel: 0.36, prob: 0.7 },
      { p: 'sparkle', inst: 'celesta', rate: 4, lo: 79, hi: 98, prob: 0.1, vel: 0.45, dens: [0.8, 2] },
      { p: 'pad', target: 'strings', n: 4, lo: 62, hi: 81, gain: 0.14 },
      { p: 'rhythm', inst: 'marimba', pat: 'x.xx.x.x', lo: 62, hi: 79, vel: 0.52, on: [0.35, 0.6] },
      { p: 'gen', target: 'flute', lo: 71, hi: 88, vel: 0.5, phrase: 2, restProb: 0.5, cells: [[0.5, 0.5, 1, 2], [1, 0.5, 0.5, 2], [1, 1, 2]], melodic: true, on: [0.6, 0.9] },
    ],
  },

  forest: {
    level: 1.26,
    bpm: 60,
    key: E_DORIAN,
    sections: {
      a: { bars: ['Em9', 'A/E', 'Em9', 'Gmaj7:2 A:2'] },
      b: { bars: ['Bm7', 'Gmaj7', 'Em7', 'F#m7'] },
    },
    form: ['a', 'a', 'b', 'a'],
    layers: [
      { p: 'drone', target: 'drone', lo: 40, notes: [0, 7], gain: 0.28 },
      { p: 'pad', target: 'strings', n: 4, lo: 55, hi: 74, gain: 0.2 },
      { p: 'gen', target: 'flute', lo: 71, hi: 88, vel: 0.46, phrase: 2, restProb: 0.5, cells: [[2, 1, 1], [3, 1], [1.5, 0.5, 2], [4], [1, 1, 2]], melodic: true },
      { p: 'rhythm', inst: 'marimba', pat: 'x.x..x.x', lo: 59, hi: 76, vel: 0.62, prob: 0.85 },
      { p: 'sparkle', inst: 'harp', lo: 76, hi: 91, prob: 0.08, vel: 0.45 },
      { p: 'pad', target: 'choir', n: 3, lo: 59, hi: 74, vowel: 'oo', gain: 0.11, on: [0.3, 0.7] },
      { p: 'bounce', inst: 'pizz', lo: 40, mid: [59, 71], vel: 0.38, prob: 0.4, on: [0.55, 0.85] },
    ],
  },

  song: {
    level: 1.12,
    bpm: 66,
    key: MAJOR,
    steady: true,
    sections: {
      a: { bars: ['D', 'D', 'G/D', 'D'] },
      b: { bars: ['Bm', 'G', 'D', 'Asus4:2 A:2'] },
      c: { bars: ['G', 'D/F#', 'Em7', 'A'] },
    },
    form: ['a', 'b', 'a', 'c'],
    layers: [
      { p: 'drone', target: 'drone', lo: 38, notes: [0, 7, 12], gain: 0.26 },
      { p: 'pad', target: 'choir', n: 4, lo: 57, hi: 76, vowel: (e) => (e > 0.55 ? 'ah' : 'oo'), gain: 0.22 },
      { p: 'pad', target: 'strings', n: 4, lo: 54, hi: 74, gain: 0.24, on: [0.15, 0.5] },
      { p: 'pulse', inst: 'harp', lo: 50, hi: 69, vel: 0.34 },
      { p: 'arp', inst: 'harp', rate: 2, shape: 'updown', lo: 62, hi: 86, vel: 0.32, on: [0.35, 0.6] },
      { p: 'bass', target: 'low', gain: 0.26, on: [0.45, 0.75] },
      { p: 'comp', inst: 'piano', vel: 0.34, on: [0.5, 0.8] },
      { p: 'bells', inst: 'bell', every: 2, lo: 74, hi: 91, vel: 0.32, on: [0.6, 0.85] },
      { p: 'sparkle', inst: 'celesta', lo: 81, hi: 98, prob: 0.1, vel: 0.3, on: [0.6, 0.9] },
      { p: 'drums', inst: 'timpani', pitch: 'root', lo: 38, hi: 45, vel: 0.6, pats: [{ at: 0.75, p: 'X.......x.......' }, { at: 0.92, p: 'X.......x...r...' }], on: [0.75, 0.95] },
      { p: 'pad', target: 'brass', n: 3, lo: 50, hi: 67, gain: 0.4, on: [0.85, 1] },
      { p: 'swell', target: 'brass', every: 4, on: [0.85, 1] },
      { p: 'swell', inst: 'swell', every: 4, vel: 0.45, on: [0.85, 1] },
    ],
  },

  night: {
    level: 1.33,
    bpm: 58,
    key: MAJOR,
    sections: {
      a: { bars: ['Dmaj7', 'Gmaj7', 'Bm9', 'Asus4:2 A:2'] },
      b: { bars: ['Gmaj7', 'F#m7', 'Em9', 'Asus4'] },
    },
    form: ['a', 'a', 'b', 'a'],
    layers: [
      { p: 'pad', target: 'strings', n: 4, lo: 45, hi: 64, gain: 0.24 },
      { p: 'drone', target: 'drone', lo: 38, notes: [0, 12], gain: 0.2 },
      { p: 'sparkle', inst: 'celesta', lo: 74, hi: 96, prob: 0.09, vel: 0.5, dens: [0.7, 1.4] },
      { p: 'arp', inst: 'celesta', rate: 1, shape: 'up', lo: 69, hi: 90, vel: 0.28, prob: 0.6, on: [0.3, 0.6] },
      { p: 'gen', inst: 'piano', lo: 62, hi: 78, vel: 0.34, phrase: 1, restProb: 0.75, cells: [[2, 2], [4], [3, 1]], melodic: true, on: [0.2, 0.5] },
      { p: 'pad', target: 'choir', n: 3, lo: 62, hi: 79, vowel: 'oo', gain: 0.14, on: [0.5, 0.85] },
      { p: 'bells', inst: 'bell', every: 4, lo: 81, hi: 93, vel: 0.22 },
    ],
  },

  storm: {
    level: 1.6,
    bpm: 72,
    key: MINOR,
    sections: {
      a: { bars: ['Dm', 'Dm', 'Bb', 'Asus4:2 A:2'] },
      b: { bars: ['Gm', 'Bb', 'Dm/A', 'A'] },
      c: { bars: ['Dm', 'C', 'Bb', 'A'] },
    },
    form: ['a', 'b', 'a', 'c'],
    layers: [
      { p: 'bass', target: 'trem', lo: 38, hi: 50, fifth: true, gain: 0.42 },
      { p: 'ostinato', inst: 'stac', rate: 2, fastAt: 0.6, cells: [0, 0, 2, 0, 3, 0, 2, 1], accent: [0, 4], lo: 38, vel: 0.5, on: [0.12, 0.4] },
      { p: 'pad', target: 'strings', n: 4, lo: 55, hi: 74, gain: 0.24 },
      { p: 'drums', inst: 'timpani', pitch: 'root', lo: 38, hi: 45, vel: 0.5, pats: [{ at: 0.3, p: 'X.......x.......' }, { at: 0.6, p: 'X.......X...r...' }, { at: 0.85, p: 'X..x..x.X...rrrr' }], on: [0.25, 0.5] },
      { p: 'pad', target: 'brass', n: 3, lo: 50, hi: 65, gain: 0.42, on: [0.5, 0.8] },
      { p: 'swell', target: 'brass', every: 2, on: [0.5, 0.8] },
      { p: 'pad', target: 'choir', n: 4, lo: 57, hi: 76, vowel: 'ah', gain: 0.24, on: [0.75, 1] },
      { p: 'drums', inst: 'taiko', midi: 36, vel: 0.8, pats: [{ at: 0.85, p: 'X.......x.......' }], on: [0.85, 1] },
      { p: 'swell', inst: 'swell', every: 4, vel: 0.5, on: [0.6, 0.9] },
    ],
  },

  danger: {
    level: 1.26,
    bpm: 84,
    key: D_PHRYGIAN,
    sections: {
      a: { bars: ['Dcl', 'Dcl', 'Bbcl4/D', 'C#dim/D'] },
      b: { bars: ['Dcl', 'Ebmaj7/D', 'Dcl', 'Bbcl4/D'] },
    },
    form: ['a', 'b'],
    layers: [
      { p: 'drone', target: 'drone', lo: 38, notes: [0, 12, 19], gain: 0.2 },
      { p: 'pad', target: 'strings', n: 3, lo: 62, hi: 80, gain: 0.26 },
      { p: 'heart', inst: 'heart', vel: 0.42, fastAt: 0.5 },
      { p: 'bass', target: 'trem', lo: 38, hi: 50, single: true, gain: 0.22, on: [0.45, 0.85] },
      { p: 'sparkle', inst: 'celesta', lo: 84, hi: 98, prob: 0.07, vel: 0.24, on: [0.3, 0.7] },
      { p: 'pad', target: 'brass', n: 2, lo: 38, hi: 52, gain: 0.26, on: [0.7, 1] },
      { p: 'swell', target: 'brass', every: 2, on: [0.7, 1] },
      { p: 'drums', inst: 'taiko', midi: 31, vel: 0.5, pats: [{ at: 0.8, p: 'x...............' }], on: [0.8, 1] },
    ],
  },

  chase: {
    level: 1.25,
    bpm: 132,
    key: MINOR,
    sections: {
      a: { bars: ['Dm', 'Dm', 'Bb', 'C', 'Dm', 'Dm', 'Gm', 'A'] },
      b: { bars: ['Gm', 'Bb', 'C', 'A', 'Gm', 'Bb', 'Asus4:2 A:2', 'A'] },
      climax: { bars: THEME_MINOR_CHORDS, melody: THEME_MINOR },
    },
    form: ['a', 'b', 'a', 'climax'],
    layers: [
      { p: 'ostinato', inst: 'stac', rate: 2, cells: [0, 0, 2, 0, 3, 0, 2, 0], accent: [0, 3, 6], lo: 38, vel: 0.6 },
      { p: 'ostinato', inst: 'stac', rate: 2, cells: [3, 2, 3, 4, 3, 2, 3, 1], accent: [0, 4], lo: 50, vel: 0.38, on: [0.35, 0.6] },
      { p: 'drums', inst: 'taiko', midi: 36, vel: 0.44, pats: [{ at: 0, p: 'X.....x.X.......' }, { at: 0.45, p: 'X..x..x.X..x.x..' }, { at: 0.8, p: 'X..x..x.X.xx.xXx' }] },
      { p: 'drums', inst: 'timpani', pitch: 'root', lo: 38, hi: 45, vel: 0.6, pats: [{ at: 0.5, p: 'X...............' }, { at: 0.8, p: 'X.......X.......' }], on: [0.5, 0.8] },
      { p: 'pad', target: 'strings', n: 4, lo: 55, hi: 74, gain: 0.24 },
      { p: 'bass', target: 'low', gain: 0.3 },
      { p: 'pad', target: 'brass', n: 3, lo: 50, hi: 67, gain: 0.42, on: [0.5, 0.8] },
      { p: 'swell', target: 'brass', every: 2, on: [0.5, 0.8] },
      { p: 'melody', target: 'lead', vel: 0.66, secs: ['climax'], melodic: true, on: [0.55, 0.85] },
      { p: 'counter', target: 'lead', lo: 69, hi: 84, vel: 0.55, secs: ['a', 'b'], melodic: true, on: [0.6, 0.9] },
      { p: 'pad', target: 'choir', n: 4, lo: 57, hi: 77, vowel: 'ah', gain: 0.26, on: [0.75, 1] },
      { p: 'swell', inst: 'swell', every: 4, vel: 0.5, on: [0.6, 0.9] },
    ],
  },

  relief: {
    level: 1.12,
    bpm: 63,
    key: MAJOR,
    sections: {
      theme: theme(),
      b: { bars: ['G', 'D/F#', 'Em7', 'Asus4:2 A:2'] },
    },
    form: ['theme', 'b', 'theme'],
    layers: [
      { p: 'melody', target: 'lead', octs: [-1, 0], vel: 0.56, secs: ['theme'], melodic: true },
      { p: 'gen', target: 'lead', lo: 62, hi: 79, vel: 0.55, secs: ['b'], cells: [[2, 2], [3, 1], [4]], phrase: 4, melodic: true },
      { p: 'pad', target: 'strings', n: 4, lo: 54, hi: 74, gain: 0.3 },
      { p: 'bass', target: 'low', gain: 0.26 },
      { p: 'arp', inst: 'harp', rate: 2, shape: 'updown', lo: 50, hi: 79, vel: 0.32 },
      { p: 'pad', target: 'choir', n: 3, lo: 62, hi: 76, vowel: 'oo', gain: 0.16, on: [0.4, 0.8] },
      { p: 'bells', inst: 'bell', every: 4, vel: 0.26, on: [0.5, 0.9] },
    ],
  },

  cloudwall: {
    level: 1.26,
    bpm: 66,
    key: MAJOR,
    sections: {
      a: { bars: ['D/A', 'Em/A', 'D/A', 'Asus4:2 A:2'] },
      b: { bars: ['F#m/A', 'G/A', 'Bm/A', 'Asus4:2 A:2'] },
    },
    form: ['a', 'b'],
    layers: [
      { p: 'drone', target: 'drone', pc: 9, lo: 33, notes: [0, 12], gain: 0.2 },
      { p: 'pad', target: 'strings', n: 4, lo: 69, hi: 88, gain: 0.2 },
      { p: 'pad', target: 'choir', n: 3, lo: 62, hi: 76, vowel: 'oo', gain: 0.18 },
      { p: 'rising', inst: 'celesta', lo: 69, vel: 0.3, dens: [0.45, 1] },
      { p: 'rising', inst: 'harp', lo: 57, rate: 2, vel: 0.24, on: [0.4, 0.7] },
      { p: 'swell', inst: 'swell', every: 4, vel: 0.35, on: [0.3, 0.7] },
    ],
  },

  oasis: {
    level: 1.06,
    bpm: 66,
    key: MAJOR,
    sections: {
      theme: theme(),
      b: { bars: ['G', 'A', 'F#m', 'Bm', 'Em7', 'A/C#', 'D', 'Asus4:2 A:2'] },
    },
    form: ['theme', 'theme', 'b', 'theme'],
    layers: [
      { p: 'melody', target: 'lead', octs: [0, 1], vel: 0.66, secs: ['theme'], melodic: true },
      { p: 'gen', target: 'lead', lo: 69, hi: 86, vel: 0.56, secs: ['b'], cells: [[2, 2], [3, 1], [2, 1, 1]], phrase: 8, melodic: true },
      { p: 'pad', target: 'choir', n: 4, lo: 57, hi: 79, vowel: 'ah', gain: 0.3 },
      { p: 'pad', target: 'strings', n: 4, lo: 54, hi: 76, gain: 0.34 },
      { p: 'bass', target: 'low', gain: 0.3 },
      { p: 'comp', inst: 'piano', vel: 0.38 },
      { p: 'arp', inst: 'harp', rate: 4, shape: 'updown', lo: 55, hi: 86, vel: 0.28 },
      { p: 'gliss', inst: 'harp', every: 4, vel: 0.3 },
      { p: 'bells', inst: 'bell', every: 4, lo: 74, hi: 91, vel: 0.46 },
      { p: 'drums', inst: 'timpani', pitch: 'root', lo: 38, hi: 45, vel: 0.5, pat: ['X...............', '................', '................', '................'] },
      { p: 'pad', target: 'brass', n: 3, lo: 50, hi: 67, gain: 0.2, on: [0.6, 0.9] },
      { p: 'swell', target: 'brass', every: 4, on: [0.6, 0.9] },
    ],
  },

  finale: {
    level: 1.12,
    bpm: 64,
    key: MAJOR,
    sectionEnergy: true,
    sections: {
      soft: theme({ energy: 0.25 }),
      full: theme({ energy: 0.88 }),
      cadence: { bars: CADENCE_CHORDS, melody: CADENCE_MELODY, energy: 1 },
      coda: { bars: ['D', 'G/D', 'D', 'Gmaj7/D:2 D:2'], energy: 0.12 },
    },
    form: ['soft', 'full', 'cadence', 'coda'],
    loopFrom: 3,
    layers: [
      // no melody in 'soft': the mother hums the theme there (Story.ending), a canon otherwise
      { p: 'melody', target: 'lead', octs: [0], vel: 0.68, secs: ['full', 'cadence'], melodic: true },
      { p: 'pad', target: 'strings', n: 4, lo: 54, hi: 76, gain: 0.34 },
      { p: 'bass', target: 'low', gain: 0.3, on: [0.2, 0.5] },
      { p: 'comp', inst: 'piano', vel: 0.36, off: [0.95, 1.01] },
      { p: 'arp', inst: 'harp', rate: 2, shape: 'updown', lo: 55, hi: 86, vel: 0.3, on: [0.2, 0.5] },
      { p: 'arp', inst: 'harp', rate: 4, shape: 'updown', lo: 55, hi: 86, vel: 0.26, on: [0.8, 0.95] },
      { p: 'pad', target: 'choir', n: 4, lo: 57, hi: 79, vowel: (e) => (e > 0.5 ? 'ah' : 'oo'), gain: 0.3, on: [0.3, 0.8] },
      { p: 'bells', inst: 'bell', every: 2, lo: 74, hi: 93, vel: 0.36, on: [0.6, 0.9] },
      { p: 'sparkle', inst: 'celesta', lo: 81, hi: 98, prob: 0.08, vel: 0.3, off: [0.4, 0.8] },
      { p: 'gliss', inst: 'harp', every: 4, vel: 0.3, on: [0.8, 1] },
      { p: 'drums', inst: 'timpani', pitch: 'root', lo: 38, hi: 45, vel: 0.55, pat: ['X...............', '................', '........x.......', '............r.r.'], on: [0.85, 1] },
      { p: 'pad', target: 'brass', n: 3, lo: 50, hi: 67, gain: 0.24, on: [0.85, 1] },
      { p: 'swell', target: 'brass', every: 4, on: [0.85, 1] },
      { p: 'swell', inst: 'swell', every: 4, vel: 0.42, on: [0.9, 1] },
    ],
  },

  // ---- the life cycle (src/game/life) -------------------------------------------------------
  // Act II: the courtship duet and spiral dance at golden hour (warm, lilting, a little waltz).
  courtship: {
    level: 1.2,
    bpm: 68,
    key: { root: 64, scale: SCALES.major },
    sections: {
      a: { bars: ['E', 'A/E', 'C#m7', 'Bsus4:2 B:2'] },
      b: { bars: ['Amaj7', 'F#m7', 'G#m7', 'Bsus4:2 B:2'] },
      c: { bars: ['C#m', 'Amaj7', 'E/B', 'B'] },
    },
    form: ['a', 'b', 'a', 'c'],
    layers: [
      { p: 'pad', target: 'strings', n: 4, lo: 56, hi: 78, gain: 0.28 },
      { p: 'arp', inst: 'harp', rate: 2, shape: 'updown', lo: 52, hi: 81, vel: 0.32 },
      { p: 'gen', target: 'flute', lo: 71, hi: 88, vel: 0.5, phrase: 2, cells: [[3, 1], [2, 2], [4]], melodic: true, on: [0.3, 0.6] },
      { p: 'bass', target: 'low', gain: 0.2, on: [0.2, 0.5] },
      { p: 'pad', target: 'choir', n: 3, lo: 62, hi: 79, vowel: (e) => (e > 0.6 ? 'ah' : 'oo'), gain: 0.18, on: [0.45, 0.8] },
      { p: 'bells', inst: 'bell', every: 2, lo: 76, hi: 93, vel: 0.3, on: [0.55, 0.85] },
      { p: 'sparkle', inst: 'celesta', lo: 81, hi: 98, prob: 0.07, vel: 0.3, on: [0.6, 0.9] },
      { p: 'swell', inst: 'swell', every: 4, vel: 0.4, on: [0.8, 1] },
    ],
  },

  // Act III: new life in the lagoon at dawn (hushed, a lullaby on celesta and harp over strings).
  birth: {
    level: 1.3,
    bpm: 58,
    key: MAJOR,
    sections: {
      a: { bars: ['Dmaj7', 'Gmaj7/D', 'Bm9', 'Asus4:2 A:2'] },
      frag: theme(),
      b: { bars: ['Gmaj7', 'D/F#', 'Em9', 'Asus4:2 A:2'] },
    },
    form: ['a', 'a', 'frag', 'b'],
    layers: [
      { p: 'pad', target: 'strings', n: 4, lo: 55, hi: 76, gain: 0.26 },
      { p: 'drone', target: 'drone', lo: 38, notes: [0, 12], gain: 0.14 },
      { p: 'melody', inst: 'celesta', vel: 0.42, prob: 0.7, keepFirst: true, human: 0.04, secs: ['frag'], melodic: true },
      { p: 'gen', inst: 'celesta', lo: 74, hi: 91, vel: 0.36, secs: ['a', 'b'], phrase: 1, restProb: 0.6, cells: [[2, 2], [4], [3, 1]], melodic: true },
      { p: 'arp', inst: 'harp', rate: 1, shape: 'up', lo: 50, hi: 74, vel: 0.3, on: [0.3, 0.6] },
      { p: 'pad', target: 'choir', n: 3, lo: 62, hi: 79, vowel: 'oo', gain: 0.16, on: [0.5, 0.85] },
      { p: 'bells', inst: 'bell', every: 4, lo: 79, hi: 93, vel: 0.26, on: [0.6, 0.9] },
    ],
  },

  // Act IV: the elder's rest (slow, deep and luminous; the theme once more, very far away).
  rest: {
    level: 1.33,
    bpm: 52,
    key: MAJOR,
    sections: {
      a: { bars: ['D/A', 'Gmaj7/A', 'Bm7/A', 'Asus4:2 A:2'] },
      theme: theme({ energy: 0.3 }),
      b: { bars: ['Gmaj7', 'Em9', 'F#m7', 'Asus4'] },
    },
    form: ['a', 'theme', 'b', 'a'],
    layers: [
      { p: 'drone', target: 'drone', pc: 9, lo: 33, notes: [0, 7, 12], gain: 0.22 },
      { p: 'pad', target: 'strings', n: 4, lo: 50, hi: 72, gain: 0.26 },
      { p: 'pad', target: 'choir', n: 4, lo: 55, hi: 76, vowel: 'oo', gain: 0.2 },
      { p: 'melody', target: 'lead', octs: [-1], vel: 0.45, secs: ['theme'], melodic: true, on: [0.3, 0.6] },
      { p: 'sparkle', inst: 'celesta', lo: 79, hi: 98, prob: 0.06, vel: 0.28 },
      { p: 'bells', inst: 'bell', every: 4, lo: 74, hi: 91, vel: 0.22 },
      { p: 'swell', inst: 'swell', every: 4, vel: 0.32, on: [0.5, 0.9] },
    ],
  },
};

export const MOOD_NAMES = [...Object.keys(MOODS), 'silence'];
