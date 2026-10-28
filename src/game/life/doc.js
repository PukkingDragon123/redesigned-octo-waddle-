// The documentary's words: lower-third captions (places and species, with invented scientific names)
// and the narrator's sparse subtitle lines. Shown only at cinematic moments (Cinematics.lower / say).
// No real broadcaster's name or branding: an invented natural-history voice.

/** Lower-thirds for species: { name, sci }. */
export const SPECIES = {
  whale: { name: 'Skysong whale', sci: 'Cetocaelum cantor' },
  egg: { name: 'Skysong egg', sci: 'Cetocaelum cantor · day one' },
  calf: { name: 'Skysong calf', sci: 'Cetocaelum cantor · hatchling' },
  mother: { name: 'The mother', sci: 'Cetocaelum cantor · female' },
  males: { name: 'The guardians', sci: 'Cetocaelum cantor · adult males' },
  elder: { name: 'The elder', sci: 'Cetocaelum cantor · ninety winters' },
  glintfin: { name: 'Glintfin', sci: 'Argentichthys spiralis' },
  spiralback: { name: 'Spiralback', sci: 'Helicopisces torquatus' },
  lanternjack: { name: 'Lanternjack', sci: 'Lucernodon abyssalis' },
  skimmer: { name: 'Skimmer', sci: 'Pteroserra helicocrista' },
  coilwing: { name: 'Coilwing', sci: 'Tetrapteryx volutus' },
  crab: { name: 'Reef crab', sci: 'Carcinella vursokensis' },
  jelly: { name: 'Bell jelly', sci: 'Campanomedusa lucens' },
  ray: { name: 'Veil ray', sci: 'Velobatis aurorae' },
  moth: { name: 'Lumen moth', sci: 'Noctiluca papilio' },
  bug: { name: 'Drift beetle', sci: 'Aerocoleus vagans' },
  falcon: { name: 'Storm falcon', sci: 'Tempestaquila rex' },
  plankton: { name: 'Sea-glow', sci: 'Photoplankta vursokii' },
  tree: { name: 'The Mother Tree', sci: 'Arbor matrix spiralis' },
};

/** Lower-thirds for places: { place, name }. */
export const PLACES = {
  maelstrom: { place: 'VUR SOK', name: 'The Spiral Maelstrom' },
  lagoon: { place: 'VUR SOK', name: 'The Dawn Lagoon' },
  reach: { place: 'VUR SOK', name: 'The Spiral Reach' },
  shoals: { place: 'VUR SOK', name: 'The Feasting Shoals' },
  forest: { place: 'VUR SOK', name: 'The Coil Forest' },
  ring: { place: 'VUR SOK', name: 'The Ring of Stacks' },
  night: { place: 'VUR SOK', name: 'The Night Passage' },
  storm: { place: 'VUR SOK', name: 'The Storm Belt' },
  falcon: { place: 'VUR SOK', name: 'The Falcon Skies' },
  wall: { place: 'VUR SOK', name: 'The Fog Wall' },
  oasis: { place: 'VUR SOK', name: 'The Oasis' },
};

/** Chapter id -> the place caption shown at its opening. */
export const CHAPTER_PLACE = {
  cradle: 'lagoon', valleys: 'reach', krill: 'shoals', forest: 'forest', song: 'ring',
  night: 'night', storm: 'storm', falcon: 'falcon', wall: 'wall', oasis: 'oasis',
};

/** The narrator. Short, poetic, informative; one line at a time. */
export const NARRATION = {
  // ACT I: the hatching
  dawn: 'Every season, the herd returns to the maelstrom.',
  vortex: 'A slow sea vortex, a mile across. At its heart, the water is perfectly still.',
  lay: 'Here, the female lays a single egg.',
  leave: 'She has not eaten in weeks. Now she must leave, to feed.',
  guard: 'The males stay. They will circle the egg, day and night.',
  threat: 'The glow of the egg does not go unnoticed.',
  driven: 'A slap of the tail, a wall of sound. The hunter turns away.',
  macro: 'Inside, curled tight, a calf. Its heart beats eighty times a minute.',
  lapse: 'Days pass. The maelstrom turns. The heart quickens.',
  crack: 'And then, one morning, the shell begins to give.',
  push: 'Push.',
  free: 'For the first time, there is water all around it.',
  rise: 'It knows one thing already: it must reach the air.',
  breath: 'Its first breath.',
  mother: 'Its mother returns, with the first meal of its life.',
  migrate: 'Within hours, it will begin its first migration, across the whole of the sea.',
  // ACT I: on the way
  reach: 'Stone coils out of the sea here. The islands are still being born.',
  coilwing: 'Coilwings ride the herd for days, picking parasites from the fur.',
  shoals: 'Glintfin gather in their millions where cold water rises.',
  net: 'The adults blow a spiral of bubbles. The fish will not cross it.',
  lunge: 'Then, together, they rise through the middle.',
  feast: 'For the calf, a first lesson: dive.',
  forest: 'The trees here grow in spirals, turning with the sun.',
  skimmer: 'Skimmers nest on the ledges. They hunt the same fish as the herd.',
  song: 'At golden hour, every voice in the herd joins one song.',
  night: 'At night, the sea itself lights up wherever it is touched.',
  storm: 'The storm belt. Calves are lost here every year.',
  storm2: 'The only shelter is the mother\'s lee.',
  falcon: 'Something has followed the herd for days.',
  falcon2: 'The storm falcon. It takes only the young.',
  falcon3: 'The herd closes ranks. Together, they are too loud to hunt.',
  wall: 'In the fog, the calf cannot see. It can only listen.',
  oasis: 'The Oasis. Every herd on Vur Sok ends its journey here.',
  // ACT II
  court: 'Years later. The calf is grown, and the herd has gathered to sing.',
  court2: 'A female answers. Courtship begins with a duet.',
  dance: 'Then a dance: every turn mirrored, every roll returned.',
  // ACT III
  return: 'A season turns. Two whales return to the maelstrom where one of them was born.',
  lay3: 'Your mate lays your egg in the calm at its heart.',
  feed3: 'She must feed now. The egg is yours to guard.',
  guard3: 'Circle it. Drive off anything that comes close.',
  threat3: 'Lanternjacks. They hunt by the glow.',
  above3: 'Skimmers, from above.',
  held3: 'The egg is safe.',
  hatch3: 'Weeks later, the shell gives.',
  lift3: 'It cannot reach the surface alone. Lift it.',
  breath3: 'A first breath. A first sound.',
  mate3: 'She returns, full of food, to meet her calf.',
  teach3: 'Now it must learn to follow your voice.',
  // ACT IV
  elder: 'Many winters later. The herd follows your voice now.',
  lastSong: 'An elder sings the last song of the season.',
  rest: 'And then it rests, in the deep.',
  garden: 'A whale fall feeds the sea for a hundred years.',
  cycle: 'And somewhere, in the eye of the maelstrom, a new heart is beating.',
};
