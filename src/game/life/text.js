// Every title card the game shows, written as a wildlife film crew's field journal: dated, located,
// specific, restrained. Shown only at cinematic moments (src/game/Cinematics.js renders them).
// Narration and lower-third captions live in ./doc.js.

/** Opening cards of each part of the life: a journal dateline (kicker), a place, a field note. */
export const ACTS = {
  1: { kicker: 'SEASON ONE · DAY 1 · 05:40', title: 'The Spiral Maelstrom', line: '' },
  2: { kicker: 'YEAR 9 · 18:10', title: 'Golden Hour', line: 'The herd is singing. One voice keeps answering his.' },
  3: { kicker: 'YEAR 11 · DAY 1 · 06:05', title: 'The Spiral Maelstrom', line: 'Back where he hatched. This time the egg is his.' },
  4: { kicker: 'YEAR 31 · 19:40', title: 'The Last Migration', line: 'He flies at the front now.' },
};

/** Journal datelines for the first migration's chapters (MigrationPath CHAPTERS order). */
export const CHAPTER_DATES = {
  cradle: 'DAY 38 · 07:15',
  valleys: 'DAY 40 · 09:30',
  krill: 'DAY 44 · 11:05',
  forest: 'DAY 47 · 15:20',
  song: 'DAY 51 · 18:20',
  night: 'DAY 51 · 23:05',
  storm: 'DAY 56 · 04:10',
  falcon: 'DAY 57 · 06:30',
  wall: 'DAY 60 · 08:45',
  oasis: 'DAY 63 · 10:00',
};

/** A field note beneath each chapter's name (kept short; the narrator says the rest). */
export const CHAPTER_LINES = {
  cradle: 'The lagoon inside the atoll. The herd rests here before it leaves.',
  valleys: 'Islands still rising out of the sea. Waterfalls on every side.',
  krill: 'Cold water comes up here. The fish follow it.',
  forest: 'Trees on the coiled islands, and rookeries on every ledge.',
  song: 'A ring of sea stacks around flat water.',
  night: 'No moon until two. The sea gives its own light.',
  storm: 'Swells of ten metres. We filmed from the lee of an island.',
  falcon: 'Clear after the storm. Something has been following the herd.',
  wall: 'Fog down to the water. Visibility about thirty metres.',
  oasis: 'The atoll at the end of the route. Turquoise, and full of whales.',
};

/** Between the parts of the life: a fade, and a line or two from the journal. */
export const SKIPS = {
  toAct2: [
    { title: 'Year 9', line: 'The horns came in around year four. His voice has dropped an octave.' },
    { title: 'Nine migrations', line: 'He has made the crossing every season since.' },
  ],
  toAct3: [
    { title: 'Year 11', line: 'The two of them turn back toward the maelstrom.' },
  ],
  toAct4: [
    { title: 'Year 31', line: 'Most of the herd we first filmed are gone.' },
    { title: 'He leads now', line: 'The others wait for his call before they move.' },
  ],
};

export const MOMENTS = {
  arch: { title: 'The Spiral Arch', line: 'The herd passes under it every year, always on the east side.' },
  bond: { title: '', line: 'They climbed together for eleven minutes. We lost them in the cloud.' },
  breath: { title: 'First breath', line: '' },
  answer: { title: '', line: 'It answers his call. It ignores everyone else\'s.' },
  lastSong: { title: '', line: 'The others stopped to listen.' },
  garden: { title: '', line: 'A whale fall feeds the sea floor for a hundred years.' },
  home: { kicker: 'DAY 63 · THE OASIS', title: 'The Oasis', line: 'Sixty-three days. The calf flew every one of them.' },
  cycle: { title: 'SKYSONG', line: 'Filmed on Vur Sok over thirty-one years.', logo: true },
};
