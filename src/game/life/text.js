// Every word the game shows: chapter and act title cards. Brief and poetic, shown only at
// cinematic moments (src/game/Cinematics.js renders them).

export const ACTS = {
  1: { kicker: 'ACT I · THE CALF' },
  2: { kicker: 'ACT II · THE SONG OF TWO', title: 'Golden Hour', line: 'Across the water, another voice answers yours.' },
  3: { kicker: 'ACT III · NEW LIFE', title: 'The Sheltered Lagoon', line: 'Where you were born, a new heart is beating.' },
  4: { kicker: 'ACT IV · THE ELDER', title: 'The Last Migration', line: 'Now the herd follows your voice.' },
};

/** Lines beneath each chapter's name in Act I (MigrationPath CHAPTERS order). */
export const CHAPTER_LINES = {
  cradle: 'This season, the great migration begins.',
  valleys: 'Stone coils out of the sea, and the sea falls back as rain.',
  krill: 'Where the water turns to silver, the great ones dive.',
  forest: 'Trees twist toward the light, and wings live among them.',
  song: 'At golden hour, every voice becomes one.',
  night: 'The galaxy turns above. The sea glows below.',
  storm: 'Stay in her shadow. Stay close.',
  falcon: 'Something vast moves between the herd and the sun.',
  wall: 'When you cannot see her, listen.',
  oasis: 'The end of every migration, and the beginning.',
};

export const SKIPS = {
  toAct2: [
    { title: 'Seasons turn', line: 'The calf grows. Its horns come in, its voice deepens.' },
    { title: 'Many migrations later', line: 'Every year, the herd returns to the song.' },
  ],
  toAct3: [
    { title: 'The year turns', line: 'Two whales return to the lagoon where one of them was born.' },
  ],
  toAct4: [
    { title: 'Years pass', line: 'The old ones rest. The calves grow. Your horns curl with age.' },
    { title: 'You lead the herd now', line: 'The elder flies first, and sings last.' },
  ],
};

export const MOMENTS = {
  arch: { title: 'The Spiral Arch', line: 'The gate of the Reach.' },
  bond: { title: 'Two voices', line: 'one song.' },
  breath: { title: 'First breath', line: '' },
  answer: { title: 'It answers when you call', line: '' },
  lastSong: { title: 'The last song', line: 'under the turning galaxy' },
  garden: { title: '', line: 'And the sea takes the song back, and makes of it a garden.' },
  cycle: { title: 'SKYSONG', line: 'The cycle continues.', logo: true },
};
