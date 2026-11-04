// The SKYSONG songbook: seven authored pieces in the jam theme's world (F minor / A-flat major,
// a 60 BPM feel, the recorded VSCO instruments), each with its own tune, form and orchestration,
// tied to a story moment (docs/MUSIC.md). They are moods like any other (moods.js), so the story
// cues them with setMood (or AudioSystem.playSong by song name), and they cross-fade the same way.
//
// What makes them authored rather than generated: every section has written chords, a written
// melody and, where needed, written counter-lines (`parts`, played by the 'part' pattern), and
// its own dynamic level (`energy`). The adaptive layer stays on top: `react` sets how far the
// game's intensity leans on the written dynamics (bringing layers in and out), and a section
// can `branch` to another when the play gets intense (or calm), then the form carries on.
// Melodies echo the theme's contour (arpeggios climbing to the sixth degree, the 5 <-> flat-6
// lean, the D-flat - F minor loop) without quoting its notes or rhythm.
import { THEME, THEME_CHORDS, THEME_DARK_CHORDS, SCALES, score as S } from './theory.js';

const HOME = { root: 65, scale: SCALES.minor }; // F aeolian = A-flat major's notes
const F_DORIAN = { root: 65, scale: SCALES.dorian };
const DB_MAJOR = { root: 61, scale: SCALES.major };

const KICK = 'X..x....X..x....';
const SHAKE = '..x...x...x...x.';
const SHAKE_FULL = 'o.x.o.x.o.x.o.xo';

// ---- 1. First Light: the lullaby (the hatching, the first hug and feeding: 'dawn') ---------------
// A rocking music-box tune on the upright piano over harp; the second time a flute sings a
// counter-line, the middle strain climbs (the leitmotif's sequence a fourth up), and the last
// verse floats an octave higher on strings and glockenspiel before the coda rocks to sleep.
const LULLABY_A = ['Ab', 'Db/Ab', 'Ab', 'Eb/G', 'Fm', 'Db', 'Bbm7', 'Eb'];
const LULLABY_TUNE = S('Eb5:2 C5 Ab4 | F5:2 Eb5_ Db5 | C5:3 Ab4_ | Bb4:3 r | Ab4:2 C5 F5 | F5:2 Eb5_ Db5 | Db5:2 C5_ Bb4 | Bb4:4');
const LULLABY_COUNTER = S('Ab4:4 | Ab4:4 | Ab4:2 Bb4:2 | Bb4:4 | C5:4 | Db5:2 C5:2 | Bb4:2 Db5:2 | Eb5:4');

const lullaby = {
  level: 1.55,
  bpm: 56,
  key: HOME,
  sectionEnergy: true,
  react: 0.35,
  sections: {
    a: { bars: LULLABY_A, melody: LULLABY_TUNE, energy: 0.2 },
    a2: { bars: LULLABY_A, melody: LULLABY_TUNE, parts: { counter: LULLABY_COUNTER }, energy: 0.4, branch: { at: 0.75, to: 'a3' } },
    b: {
      bars: ['Db', 'Eb', 'Cm7', 'Fm', 'Bbm7', 'Db', 'Ebsus4:2 Eb:2', 'Ab'],
      melody: S('Ab4 Db5 F5:2 | G5:2 F5_ Eb5 | Eb5:3 C5 | C5:2 Ab4 F4 | Db5:2 F5 Ab5> | Ab5:2 F5 Db5 | Ab4:2 G4:2 | Ab4:4'),
      parts: { counter: S('F4:4 | G4:4 | G4:4 | Ab4:4 | F4:4 | F4:4 | Eb4:4 | Eb4:4') },
      energy: 0.55,
    },
    a3: { bars: LULLABY_A, melody: LULLABY_TUNE, parts: { counter: LULLABY_COUNTER }, energy: 0.72 },
    coda: { bars: ['Db/Ab', 'Ab', 'Db/Ab', 'Ab'], melody: S('Eb5:2 Db5_ C5 | C5:4 | F5:2 Eb5_ Db5 | C5:4'), energy: 0.12 },
  },
  form: ['a', 'a2', 'b', 'a3', 'coda'],
  loopFrom: 1,
  layers: [
    { p: 'melody', inst: 'piano', vel: 0.5, human: 0.03, secs: ['a', 'a2', 'b', 'coda'], melodic: true },
    { p: 'melody', target: 'lead', vel: 0.5, secs: ['a3'], octs: [1], melodic: true },
    { p: 'melody', inst: 'celesta', vel: 0.26, secs: ['a3'], octs: [1], melodic: true },
    { p: 'part', part: 'counter', target: 'flute', vel: 0.42, secs: ['a2', 'b', 'a3'], melodic: true },
    { p: 'pad', target: 'strings', n: 4, lo: 53, hi: 72, gain: 0.24 },
    { p: 'bass', target: 'low', gain: 0.16, single: true, on: [0.3, 0.6] },
    { p: 'arp', inst: 'harp', rate: 2, shape: 'up', lo: 44, hi: 68, vel: 0.3, on: [0.25, 0.5] },
    { p: 'pad', target: 'choir', n: 3, lo: 60, hi: 76, vowel: 'oo', gain: 0.14, on: [0.6, 0.8] },
    { p: 'bells', inst: 'bell', every: 4, lo: 79, hi: 91, vel: 0.22, on: [0.5, 0.8] },
  ],
};

// ---- 2. Skyward: the travel song (open flight) ----------------------------------------------------
// Harp sixteenths (the theme's pulse) under a long-breathed tune on solo strings that leaps up
// in sixths; the B strain climbs through the D-flat - E-flat - C minor - F minor rise with a
// flute and piano on top and the strings' counter below; the climax is the leitmotif in full,
// with the theme's kick and shaker. Intense flying reaches the climax sooner.
const skyward = {
  level: 1.26,
  bpm: 60,
  key: HOME,
  sectionEnergy: true,
  react: 0.45,
  sections: {
    intro: { bars: ['Db', 'Ab/C', 'Bbm7', 'Eb'], energy: 0.3 },
    a: {
      bars: ['Ab', 'Eb/G', 'Fm', 'Db', 'Ab/C', 'Bbm7', 'Ebsus4:2 Eb:2', 'Ab'],
      melody: S('Eb4 Ab4 C5:2 | Bb4:3 G4 | Ab4 C5 F5:2 | Eb5:2 Db5 C5 | C5 Eb5 Ab5:2> | F5:2 Db5 F5 | Eb5:2 Bb4 G4 | Ab4:4'),
      energy: 0.45,
      branch: { at: 0.8, to: 'climax' },
    },
    b: {
      bars: ['Db', 'Eb', 'Cm', 'Fm', 'Db', 'Eb', 'Fm', 'Fm'],
      melody: S('F5:2 Ab5 F5 | G5:3 Eb5 | Eb5:2 G5 C6 | C6:3 Ab5 | Db6:2 C6_ Ab5 | Bb5:2 G5 Eb5 | F5:2 Ab5 C6> | C6:4'),
      parts: { counter: S('Ab3:4 | Bb3:4 | G3:4 | Ab3:4 | F3:4 | G3:4 | F3:2 Eb3:2 | C4:4') },
      energy: 0.68,
    },
    climax: { bars: THEME_CHORDS, melody: THEME, energy: 0.95 },
    a2: {
      bars: ['Ab', 'Eb/G', 'Fm', 'Db', 'Ab/C', 'Bbm7', 'Ebsus4:2 Eb:2', 'Ab'],
      melody: S('Eb4 Ab4 C5:2 | Bb4:3 G4 | Ab4 C5 F5:2 | Eb5:2 Db5 C5 | C5 Eb5 Ab5:2 | F5:2 Db5 F5 | Eb5:2 Bb4 G4 | Ab4:4'),
      energy: 0.38,
    },
  },
  form: ['intro', 'a', 'b', 'climax', 'a2'],
  loopFrom: 1,
  layers: [
    { p: 'arp', inst: 'harp', rate: 4, shape: 'updown', lo: 50, hi: 81, vel: 0.36, dens: [0.6, 1] },
    { p: 'pad', target: 'strings', n: 4, lo: 54, hi: 76, gain: 0.3 },
    { p: 'bass', target: 'low', gain: 0.22 },
    { p: 'melody', target: 'lead', vel: 0.6, secs: ['a', 'a2'], melodic: true },
    { p: 'melody', inst: 'piano', vel: 0.3, secs: ['a'], octs: [1], melodic: true, on: [0.4, 0.6] },
    { p: 'melody', target: 'flute', vel: 0.55, secs: ['b'], melodic: true },
    { p: 'melody', inst: 'piano', vel: 0.42, secs: ['b'], melodic: true },
    { p: 'part', part: 'counter', target: 'lead', vel: 0.5, secs: ['b'], melodic: true },
    { p: 'melody', target: 'lead', vel: 0.66, secs: ['climax'], melodic: true },
    { p: 'melody', inst: 'piano', vel: 0.4, secs: ['climax'], octs: [1], melodic: true },
    { p: 'comp', inst: 'piano', lo: 50, hi: 64, vel: 0.3, secs: ['intro', 'a2'] },
    { p: 'pad', target: 'choir', n: 4, lo: 57, hi: 79, vowel: 'ah', gain: 0.26, on: [0.6, 0.9] },
    { p: 'pad', target: 'brass', n: 3, lo: 50, hi: 67, gain: 0.3, on: [0.85, 1] },
    { p: 'swell', target: 'brass', every: 4, on: [0.85, 1] },
    { p: 'bells', inst: 'bell', every: 4, lo: 78, hi: 93, vel: 0.28, on: [0.7, 1] },
    { p: 'swell', inst: 'swell', every: 4, vel: 0.5, on: [0.85, 1] },
    { p: 'drums', inst: 'kick', midi: 36, vel: 0.5, pat: KICK, on: [0.6, 0.8] },
    { p: 'drums', inst: 'shaker', midi: 60, vel: 0.45, pats: [{ at: 0, p: SHAKE }, { at: 0.9, p: SHAKE_FULL }], on: [0.65, 0.85] },
    { p: 'drums', inst: 'timpani', pitch: 'root', lo: 38, hi: 45, vel: 0.5, pat: ['X...............', '................', '........x.......', '............r.r.'], on: [0.88, 1] },
  ],
};

// ---- 3. Coil Wonder: discovery (the Coil Forest; F dorian) -----------------------------------------
// Marimba and glockenspiel glitter over a i - IV vamp whose D natural is the theme's own dorian
// colour; the flute asks a question, the B strain turns warm (A-flat major seventh), and the C
// strain blooms (E-flat - B-flat/D) with choir and bells when something is found.
const wonder = {
  level: 1.26,
  bpm: 60,
  key: F_DORIAN,
  sectionEnergy: true,
  react: 0.4,
  sections: {
    a: { bars: ['Fm9', 'Bb/F', 'Fm9', 'Bb/F'], melody: S('C5:1.5 Eb5:0.5 F5:2 | D5:3 F5 | Ab5:1.5 G5:0.5 F5:2 | D5:4'), energy: 0.3 },
    a2: { bars: ['Fm9', 'Bb/F', 'Fm9', 'Bb/F'], melody: S('C5:1.5 Eb5:0.5 F5:2 | D5:3 F5 | Ab5:1.5 G5:0.5 F5:2 | D5:2 C5:2'), energy: 0.45, branch: { at: 0.75, to: 'c' } },
    b: { bars: ['Abmaj7', 'Bb', 'Cm7', 'Gm7'], melody: S('G5:2 Eb5 C5 | D5:2 F5 Bb5 | G5:2 Eb5 Bb4 | D5:2 F5:2'), parts: { low: S('C4:4 | D4:4 | Eb4:4 | D4:4') }, energy: 0.58 },
    c: { bars: ['Eb', 'Bb/D', 'Abmaj7', 'Bb'], melody: S('Bb5:2> G5 Eb5 | F5:3 D5 | Eb5:2 G5:2 | F5:4'), parts: { low: S('G4:4 | F4:4 | C4:4 | D4:4') }, energy: 0.82 },
  },
  form: ['a', 'a2', 'b', 'c', 'a'],
  loopFrom: 0,
  layers: [
    { p: 'drone', target: 'drone', lo: 41, notes: [0, 7], gain: 0.22 },
    { p: 'pad', target: 'strings', n: 4, lo: 55, hi: 74, gain: 0.2 },
    { p: 'melody', target: 'flute', vel: 0.5, human: 0.02, melodic: true },
    { p: 'part', part: 'low', target: 'lead', vel: 0.42, secs: ['b', 'c'], melodic: true },
    { p: 'rhythm', inst: 'marimba', pat: 'x.x..x.x', lo: 59, hi: 76, vel: 0.55, prob: 0.9 },
    { p: 'arp', inst: 'celesta', rate: 2, shape: 'broken', lo: 77, hi: 94, vel: 0.24, prob: 0.8, on: [0.35, 0.6] },
    { p: 'sparkle', inst: 'harp', lo: 76, hi: 91, prob: 0.08, vel: 0.4 },
    { p: 'bounce', inst: 'pizz', lo: 41, mid: [59, 71], vel: 0.36, prob: 0.5, on: [0.5, 0.75] },
    { p: 'pad', target: 'choir', n: 3, lo: 59, hi: 76, vowel: 'ah', gain: 0.18, on: [0.7, 0.9] },
    { p: 'bells', inst: 'bell', every: 2, lo: 77, hi: 91, vel: 0.3, on: [0.75, 0.95] },
    { p: 'swell', inst: 'swell', every: 4, vel: 0.4, on: [0.75, 1] },
  ],
};

// ---- 4. Tempest: the storm (chapter 6) ---------------------------------------------------------------
// Spiccato sixteenths and timpani drive a minor tune on the strings (F - A-flat - C, then the
// flat-6 lean down); the B strain rises to the raised dominant (C major, E natural); the climax
// is the leitmotif darkened, with brass, taiko and choir; a two-bar hush lets the wind through
// before the storm comes round again.
const tempest = {
  level: 1.2,
  bpm: 72,
  key: HOME,
  sectionEnergy: true,
  react: 0.4,
  sections: {
    a: { bars: ['Fm', 'Fm', 'Db', 'C'], melody: S('F4:1.5 Ab4:0.5 C5:2 | Db5> C5 Ab4 F4 | F4:1.5 Ab4:0.5 Db5:2 | C5:2 Bb4 G4'), energy: 0.5 },
    a2: { bars: ['Fm', 'Fm', 'Db', 'C'], melody: S('F4:1.5 Ab4:0.5 C5:2 | Db5> C5 Ab4 F4 | F4:1.5 Ab4:0.5 Db5:2 | E5:2> G5:2'), energy: 0.65, branch: { at: 0.85, to: 'climax' } },
    b: { bars: ['Bbm', 'Db', 'Eb', 'C'], melody: S('Db5:2 F5:2 | Ab5:2 F5 Db5 | G5:2 Bb5 G5 | G5:2> E5:2'), parts: { low: S('Bb3:4 | Ab3:4 | G3:4 | C4:2 Bb3:2') }, energy: 0.8 },
    climax: { bars: THEME_DARK_CHORDS, melody: THEME, energy: 1 },
    hush: { bars: ['Fm', 'C'], energy: 0.3 },
  },
  form: ['a', 'a2', 'b', 'climax', 'hush'],
  loopFrom: 0,
  layers: [
    { p: 'bass', target: 'trem', lo: 41, hi: 53, fifth: true, gain: 0.4 },
    { p: 'ostinato', inst: 'stac', rate: 4, cells: [0, 0, 2, 0, 3, 0, 2, 1], accent: [0, 4], lo: 41, vel: 0.46, on: [0.35, 0.55] },
    { p: 'pad', target: 'strings', n: 4, lo: 55, hi: 74, gain: 0.22 },
    { p: 'melody', target: 'lead', vel: 0.62, secs: ['a', 'a2', 'b', 'climax'], melodic: true },
    { p: 'melody', inst: 'piano', vel: 0.34, secs: ['b', 'climax'], octs: [1], melodic: true },
    { p: 'part', part: 'low', inst: 'pizz', vel: 0.55, secs: ['b'], melodic: true },
    { p: 'drums', inst: 'timpani', pitch: 'root', lo: 38, hi: 45, vel: 0.5, pats: [{ at: 0.3, p: 'X.......x.......' }, { at: 0.6, p: 'X.......X...r...' }, { at: 0.85, p: 'X..x..x.X...rrrr' }], on: [0.3, 0.5] },
    { p: 'drums', inst: 'kick', midi: 36, vel: 0.55, pat: KICK, on: [0.55, 0.75] },
    { p: 'pad', target: 'brass', n: 3, lo: 50, hi: 65, gain: 0.42, on: [0.7, 0.9] },
    { p: 'swell', target: 'brass', every: 2, on: [0.7, 0.9] },
    { p: 'pad', target: 'choir', n: 4, lo: 57, hi: 76, vowel: 'ah', gain: 0.24, on: [0.85, 1] },
    { p: 'drums', inst: 'taiko', midi: 36, vel: 0.75, pats: [{ at: 0.9, p: 'X.......x.....x.' }], on: [0.9, 1] },
    { p: 'swell', inst: 'swell', every: 4, vel: 0.5, on: [0.6, 0.9] },
  ],
};

// ---- 5. Two Voices: the courtship duet (Act II, golden hour; D-flat major) ------------------------
// He (solo strings, low) sings four bars, she (flute, high) answers four; then they sing
// together in thirds and sixths; the C strain is the spiral dance (harp and bells, both voices
// high); a short coda lets the last two notes hang. Intense dancing takes the dance strain again.
const duet = {
  level: 1.2,
  bpm: 66,
  key: DB_MAJOR,
  sectionEnergy: true,
  react: 0.4,
  sections: {
    call: {
      bars: ['Db', 'Gb/Db', 'Bbm7', 'Absus4:2 Ab:2', 'Gbmaj7', 'Fm7', 'Ebm7', 'Absus4:2 Ab:2'],
      parts: {
        him: S('F4:2 Ab4 Db5 | Db5:2 Bb4 Gb4 | F4:2 Ab4 Bb4 | Db5:2 C5:2 | r:4 | r:4 | r:4 | r:4'),
        her: S('r:4 | r:4 | r:4 | r:4 | Bb5:2 F5 Db5 | Ab5:2 Eb5 C5 | Gb5:2 Db5 Bb4 | Db5:2 C5:2'),
      },
      energy: 0.35,
    },
    together: {
      bars: ['Bbm', 'Gbmaj7', 'Db/F', 'Gb', 'Ebm7', 'Db/F', 'Gb', 'Absus4:2 Ab:2'],
      parts: {
        her: S('F5:2 Bb5:2 | Bb5:3 Ab5 | Ab5:2 F5:2 | Gb5:2 Bb5 Db6 | Db6:2 Bb5 Gb5 | Ab5:2 F5 Db5 | Eb5:2 Gb5 Bb5 | Db6:2 C6:2'),
        him: S('Db5:2 F5:2 | Db5:3 F5 | F5:2 Db5:2 | Bb4:2 Db5:2 | Bb4:2 Gb4:2 | F4:2 Ab4:2 | Bb4:2 Db5:2 | Ab4:4'),
      },
      energy: 0.6,
    },
    dance: {
      bars: ['Db', 'Ab/C', 'Bbm7', 'Gb:2 Ab:2', 'Db', 'Ab/C', 'Bbm7', 'Gb:2 Ab:2'],
      parts: {
        her: S('Db6 C6 Ab5:2 | C6 Ab5 Eb5:2 | F5:2 Ab5 Db6> | Bb5:2 C6:2 | Db6 C6 Ab5:2 | C6 Ab5 Eb5:2 | F5:2 Ab5 Db6> | Bb5:2 C6:2'),
        him: S('F5:4 | Eb5:4 | Db5:4 | Db5:2 Eb5:2 | F4 Ab4 Db5:2 | Eb4 Ab4 C5:2 | Db5:2 F5:2 | Db5:2 Eb5:2'),
      },
      energy: 0.85,
      branch: { at: 0.8, to: 'dance' },
    },
    coda: { bars: ['Gb/Db', 'Db'], parts: { her: S('Bb5:2 Ab5:2 | F5:4'), him: S('Db5:2 Bb4:2 | Ab4:4') }, energy: 0.3 },
  },
  form: ['call', 'together', 'call', 'dance', 'together', 'coda'],
  loopFrom: 0,
  layers: [
    { p: 'part', part: 'him', target: 'lead', vel: 0.58, melodic: true },
    { p: 'part', part: 'her', target: 'flute', vel: 0.56, melodic: true },
    { p: 'pad', target: 'strings', n: 4, lo: 53, hi: 72, gain: 0.26 },
    { p: 'arp', inst: 'harp', rate: 2, shape: 'updown', lo: 49, hi: 78, vel: 0.3 },
    { p: 'arp', inst: 'harp', rate: 4, shape: 'up', lo: 61, hi: 89, vel: 0.22, secs: ['dance'], on: [0.7, 0.9] },
    { p: 'bass', target: 'low', gain: 0.2, on: [0.3, 0.5] },
    { p: 'comp', inst: 'piano', lo: 49, hi: 63, vel: 0.28, on: [0.45, 0.7] },
    { p: 'pad', target: 'choir', n: 3, lo: 61, hi: 77, vowel: (e) => (e > 0.6 ? 'ah' : 'oo'), gain: 0.16, on: [0.55, 0.85] },
    { p: 'bells', inst: 'bell', every: 2, lo: 77, hi: 92, vel: 0.28, on: [0.75, 0.95] },
    { p: 'sparkle', inst: 'celesta', lo: 80, hi: 97, prob: 0.07, vel: 0.26, on: [0.6, 0.9] },
    { p: 'drums', inst: 'shaker', midi: 60, vel: 0.36, pat: SHAKE, on: [0.75, 0.9] },
    { p: 'swell', inst: 'swell', every: 4, vel: 0.36, on: [0.8, 1] },
  ],
};

// ---- 6. The Guardian: the egg watch (Act III) -------------------------------------------------------
// The lullaby comes back a generation on: first low and slow on solo strings (the parent's
// voice, an octave down, over F minor instead of A-flat), then high on the glockenspiel as the
// egg glows; the C strain rises in steps (the guard standing up: D-flat - E-flat - F minor -
// C) with horns and a soft drum; then the watch goes quiet again.
const GUARD_A = ['Fm7', 'Db', 'Fm/Ab', 'Eb/G', 'Fm', 'Db', 'Bbm7', 'C7sus4:2 C:2'];
const guardian = {
  level: 1.3,
  bpm: 56,
  key: HOME,
  sectionEnergy: true,
  react: 0.4,
  sections: {
    low: { bars: GUARD_A, melody: LULLABY_TUNE, energy: 0.22 },
    high: { bars: GUARD_A, melody: LULLABY_TUNE, energy: 0.42 },
    rise: { bars: ['Db', 'Eb', 'Fm', 'C', 'Db', 'Eb', 'Fm', 'Csus4:2 C:2'], melody: S('F5:2 Ab5:2 | G5:2 Bb5:2 | Ab5:2 C6:2> | C6:2 Bb5 G5 | F5:2 Ab5:2 | G5:2 Bb5:2 | C6:2 Ab5 F5 | F5:2 E5:2'), energy: 0.78, branch: { below: 0.3, to: 'high' } },
  },
  form: ['low', 'high', 'rise', 'high'],
  loopFrom: 0,
  layers: [
    { p: 'melody', target: 'lead', vel: 0.5, secs: ['low'], octs: [-1], melodic: true },
    { p: 'melody', inst: 'celesta', vel: 0.36, secs: ['high'], human: 0.03, melodic: true },
    { p: 'melody', inst: 'piano', vel: 0.32, secs: ['high'], octs: [-1], melodic: true },
    { p: 'melody', target: 'lead', vel: 0.6, secs: ['rise'], melodic: true },
    { p: 'pad', target: 'strings', n: 4, lo: 53, hi: 72, gain: 0.24 },
    { p: 'drone', target: 'drone', lo: 41, notes: [0, 12], gain: 0.14 },
    { p: 'bass', target: 'low', gain: 0.2, on: [0.35, 0.6] },
    { p: 'arp', inst: 'harp', rate: 1, shape: 'up', lo: 48, hi: 72, vel: 0.28, on: [0.3, 0.5] },
    { p: 'drums', inst: 'kick', midi: 36, vel: 0.4, pat: 'X.......x.......', on: [0.6, 0.8] },
    { p: 'pad', target: 'brass', n: 3, lo: 50, hi: 65, gain: 0.3, on: [0.7, 0.9] },
    { p: 'swell', target: 'brass', every: 4, on: [0.7, 0.9] },
    { p: 'pad', target: 'choir', n: 3, lo: 60, hi: 76, vowel: 'oo', gain: 0.14, on: [0.45, 0.75] },
    { p: 'bells', inst: 'bell', every: 4, lo: 79, hi: 91, vel: 0.22, on: [0.5, 0.8] },
  ],
};

// ---- 7. Elegy: the elder's rest (Act IV) -------------------------------------------------------------
// A slow lament on solo strings over the dominant (C) pedal, answered by the choir; the
// leitmotif returns once, very far away; the farewell strain walks the jam theme's own opening
// chords (B-flat minor seventh - D-flat - F minor) and stops open on E-flat, so the theme track
// that plays at the ending (from the last dawn) sounds like its continuation.
const elegy = {
  level: 1.33,
  bpm: 50,
  key: HOME,
  sectionEnergy: true,
  react: 0.3,
  sections: {
    a: {
      bars: ['Fm', 'Db/F', 'Bbm7/F', 'C7sus4:2 C:2', 'Fm/Ab', 'Db', 'Bbm7', 'Csus4:2 C:2'],
      melody: S('C5:3 Ab4 | F4:2 Ab4 Db5 | Db5:3 Bb4 | F4:2 E4:2 | Ab4:2 C5 F5 | F5:3 Eb5_ | Db5:2 C5 Bb4 | C5:4'),
      energy: 0.2,
    },
    a2: {
      bars: ['Fm', 'Db/F', 'Bbm7/F', 'C7sus4:2 C:2', 'Fm/Ab', 'Db', 'Bbm7', 'Csus4:2 C:2'],
      melody: S('C5:3 Ab4 | F4:2 Ab4 Db5 | Db5:3 Bb4 | F4:2 E4:2 | Ab4:2 C5 F5> | Ab5:3 G5_ | F5:2 Eb5 Db5 | C5:4'),
      energy: 0.4,
    },
    theme: { bars: THEME_CHORDS, melody: THEME, energy: 0.3 },
    farewell: { bars: ['Bbm7', 'Dbmaj7', 'Fm9', 'Ebsus4:2 Eb:2'], melody: S('F5:2 Db5:2 | C5:3 Ab4 | G4:2 Ab4:2 | Bb4:4'), energy: 0.45 },
  },
  form: ['a', 'a2', 'theme', 'farewell'],
  loopFrom: 0,
  layers: [
    { p: 'drone', target: 'drone', pc: 0, lo: 33, notes: [0, 7, 12], gain: 0.2 },
    { p: 'pad', target: 'strings', n: 4, lo: 50, hi: 72, gain: 0.26 },
    { p: 'pad', target: 'choir', n: 4, lo: 55, hi: 76, vowel: 'oo', gain: 0.18, on: [0.3, 0.5] },
    { p: 'melody', target: 'lead', vel: 0.55, secs: ['a', 'a2', 'farewell'], octs: [-1], melodic: true },
    { p: 'melody', inst: 'piano', vel: 0.34, secs: ['farewell'], melodic: true },
    { p: 'melody', inst: 'celesta', vel: 0.28, secs: ['theme'], octs: [1], human: 0.04, melodic: true },
    { p: 'melody', target: 'flute', vel: 0.36, secs: ['theme'], melodic: true },
    { p: 'bass', target: 'low', gain: 0.18, on: [0.3, 0.5] },
    { p: 'sparkle', inst: 'celesta', lo: 79, hi: 98, prob: 0.05, vel: 0.24 },
    { p: 'bells', inst: 'bell', every: 4, lo: 74, hi: 91, vel: 0.2 },
    { p: 'swell', inst: 'swell', every: 4, vel: 0.3, on: [0.4, 0.7] },
  ],
};

/** The songs as moods, under the mood names the story already sets at their moments. */
export const SONG_MOODS = {
  dawn: lullaby,
  flight: skyward,
  forest: wonder,
  storm: tempest,
  courtship: duet,
  birth: guardian,
  rest: elegy,
};

/** Song name -> mood (AudioSystem.playSong). */
export const SONGS = {
  lullaby: 'dawn',
  skyward: 'flight',
  wonder: 'forest',
  tempest: 'storm',
  duet: 'courtship',
  guardian: 'birth',
  elegy: 'rest',
};
