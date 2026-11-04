// The adaptive score: one small generative arrangement per mood.
//
// A mood has a tempo, a key, named sections (chord bars, optional written melody) played
// in `form` order, and layers. Each layer runs a pattern (patterns.js) on an instrument
// (`inst`: sampler) or a section (`target`: strings | low | trem | choir | brass | drone |
// lead | flute). `on: [a, b]` fades the layer in as intensity goes from a to b, `off`
// fades it out again; `secs` limits a layer to some sections; `melodic` layers stop as
// soon as the mood is left (accompaniment layers fade out over the new mood's harmony).
//
// The whole score lives in the jam theme's world (docs/MUSIC.md): F minor / A-flat major (one
// set of notes), 60 BPM with a sixteenth-note pulse, the theme's VI - i (D-flat - F minor) loop,
// its B-flat-minor-seventh opening and its dorian lift (B-flat over D) at the close, its soft
// kick (beat 1, the 'a' of 1, beat 3, the 'a' of 3) and off-beat shaker. Side keys stay close:
// F dorian for the forest, F phrygian for danger, D-flat (the theme's VI) for the courtship.
import { THEME, THEME_CHORDS, THEME_DARK_CHORDS, CADENCE_MELODY, CADENCE_CHORDS, SCALES } from './theory.js';
import { SONG_MOODS } from './songs.js';

const F = 65;
const HOME = { root: F, scale: SCALES.minor }; // F aeolian = A-flat major's notes
const F_PHRYGIAN = { root: F, scale: SCALES.phrygian };

const theme = (extra) => ({ bars: THEME_CHORDS, melody: THEME, ...extra });

// the jam theme's groove, on 16 steps of a 4/4 bar
const KICK = 'X..x....X..x....';
const KICK_FULL = 'X..x....X..x..o.';
const SHAKE = '..x...x...x...x.';
const SHAKE_FULL = 'o.x.o.x.o.x.o.xo';
const groove = (on, vel = 0.5, shakeOn = null) => [
  { p: 'drums', inst: 'kick', midi: 36, vel, pats: [{ at: 0, p: KICK }, { at: 0.9, p: KICK_FULL }], on },
  { p: 'drums', inst: 'shaker', midi: 60, vel: vel * 0.9, pats: [{ at: 0, p: SHAKE }, { at: 0.85, p: SHAKE_FULL }], on: shakeOn || [on[0] + 0.1, on[1] + 0.1] },
];

export const MOODS = {
  // the authored songs (songs.js): dawn, flight, forest, storm, courtship, birth, rest
  ...SONG_MOODS,

  title: {
    level: 1.33,
    bpm: 60,
    key: HOME,
    sections: {
      intro: { bars: ['Bbm7', 'Dbmaj7', 'Fm9', 'Ebsus4:2 Eb:2'] },
      theme: theme(),
      inter: { bars: ['Db', 'Fm', 'Db', 'Ebsus4:2 Eb:2'] },
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

  krill: {
    level: 1.9,
    bpm: 80,
    key: HOME,
    sections: {
      a: { bars: ['Ab', 'Db', 'Fm7', 'Eb'] },
      b: { bars: ['Cm', 'Db', 'Ab', 'Ebsus4:2 Eb:2'] },
      c: { bars: ['Db', 'Eb', 'Cm', 'Fm', 'Db', 'Eb', 'Ab', 'Ab'] },
    },
    form: ['a', 'b', 'a', 'c'],
    layers: [
      { p: 'bounce', inst: 'pizz', lo: 38, mid: [62, 76], vel: 0.72, dens: [0.6, 1] },
      { p: 'arp', inst: 'harp', rate: 2, shape: 'broken', lo: 64, hi: 88, vel: 0.36, prob: 0.7 },
      { p: 'sparkle', inst: 'celesta', rate: 4, lo: 79, hi: 98, prob: 0.1, vel: 0.45, dens: [0.8, 2] },
      { p: 'pad', target: 'strings', n: 4, lo: 62, hi: 81, gain: 0.14 },
      { p: 'rhythm', inst: 'marimba', pat: 'x.xx.x.x', lo: 62, hi: 79, vel: 0.52, on: [0.35, 0.6] },
      { p: 'gen', target: 'flute', lo: 71, hi: 88, vel: 0.5, phrase: 2, restProb: 0.5, cells: [[0.5, 0.5, 1, 2], [1, 0.5, 0.5, 2], [1, 1, 2]], melodic: true, on: [0.6, 0.9] },
      { p: 'drums', inst: 'shaker', midi: 60, vel: 0.42, pats: [{ at: 0, p: SHAKE }, { at: 0.7, p: SHAKE_FULL }], on: [0.4, 0.7] },
    ],
  },

  song: {
    level: 1.12,
    bpm: 60,
    key: HOME,
    steady: true,
    sections: {
      a: { bars: ['Fm', 'Fm', 'Db/F', 'Fm'] },
      b: { bars: ['Db', 'Bbm7', 'Fm', 'Ebsus4:2 Eb:2'] },
      c: { bars: ['Db', 'Ab/C', 'Bbm7', 'Eb'] },
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
      ...groove([0.55, 0.85], 0.5),
    ],
  },

  night: {
    level: 1.33,
    bpm: 56,
    key: HOME,
    sections: {
      a: { bars: ['Dbmaj7', 'Fm9', 'Bbm9', 'Ebsus4:2 Eb:2'] },
      b: { bars: ['Dbmaj7', 'Cm7', 'Bbm9', 'Ebsus4'] },
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

  danger: {
    level: 1.26,
    bpm: 80,
    key: F_PHRYGIAN,
    sections: {
      a: { bars: ['Fcl', 'Fcl', 'Dbcl4/F', 'Edim/F'] },
      b: { bars: ['Fcl', 'Gbmaj7/F', 'Fcl', 'Dbcl4/F'] },
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
    bpm: 120,
    key: HOME,
    sections: {
      a: { bars: ['Fm', 'Fm', 'Db', 'Eb', 'Fm', 'Fm', 'Bbm', 'C'] },
      b: { bars: ['Bbm', 'Db', 'Eb', 'C', 'Bbm', 'Db', 'Csus4:2 C:2', 'C'] },
      climax: { bars: THEME_DARK_CHORDS, melody: THEME },
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
    bpm: 60,
    key: HOME,
    sections: {
      theme: theme(),
      b: { bars: ['Db', 'Ab/C', 'Bbm7', 'Ebsus4:2 Eb:2'] },
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
    bpm: 60,
    key: HOME,
    sections: {
      a: { bars: ['Ab/Eb', 'Bbm/Eb', 'Ab/Eb', 'Ebsus4:2 Eb:2'] },
      b: { bars: ['Cm/Eb', 'Db/Eb', 'Fm/Eb', 'Ebsus4:2 Eb:2'] },
    },
    form: ['a', 'b'],
    layers: [
      { p: 'drone', target: 'drone', pc: 3, lo: 33, notes: [0, 12], gain: 0.2 },
      { p: 'pad', target: 'strings', n: 4, lo: 69, hi: 88, gain: 0.2 },
      { p: 'pad', target: 'choir', n: 3, lo: 62, hi: 76, vowel: 'oo', gain: 0.18 },
      { p: 'rising', inst: 'celesta', lo: 69, vel: 0.3, dens: [0.45, 1] },
      { p: 'rising', inst: 'harp', lo: 57, rate: 2, vel: 0.24, on: [0.4, 0.7] },
      { p: 'swell', inst: 'swell', every: 4, vel: 0.35, on: [0.3, 0.7] },
    ],
  },

  oasis: {
    level: 1.06,
    bpm: 60,
    key: HOME,
    sections: {
      theme: theme(),
      b: { bars: ['Db', 'Eb', 'Cm', 'Fm', 'Bbm7', 'Eb/G', 'Ab', 'Ebsus4:2 Eb:2'] },
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
      ...groove([0.4, 0.7], 0.45),
    ],
  },

  finale: {
    level: 1.12,
    bpm: 60,
    key: HOME,
    sectionEnergy: true,
    sections: {
      soft: theme({ energy: 0.25 }),
      full: theme({ energy: 0.88 }),
      cadence: { bars: CADENCE_CHORDS, melody: CADENCE_MELODY, energy: 1 },
      coda: { bars: ['Fm9', 'Bb/F', 'Fm9', 'Dbmaj7/F:2 Fm9:2'], energy: 0.12 },
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
      ...groove([0.8, 0.95], 0.5),
    ],
  },

};

export const MOOD_NAMES = [...Object.keys(MOODS), 'silence'];
